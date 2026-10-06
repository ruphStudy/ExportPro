import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TradeDataIngestionRun, TradeDataSource } from '@prisma/client';
import { createHash } from 'crypto';
import type { ManualImportPreview, TradeDataIssueKind } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  MAX_DATA_IMPORT_BYTES,
  StorageService,
} from '../storage/storage.service';
import { AppConfig } from '../../config/configuration';
import {
  FetchedUnit,
  HsReferenceRow,
  SchemaMismatchError,
  TradeDataSourceAdapter,
} from './adapters/adapter';
import {
  dedupeFacts,
  NormalizedFact,
  normalizeRecord,
  PipelineIssue,
} from './normalization/pipeline';
import { TRANSFORM_VERSION } from './normalization/normalizers';
import { nextExpectedRefresh, runQualityScore } from './reliability';
import { SOURCE_DEFINITIONS } from './source-registry';
import { TRADE_DATA_ADAPTERS } from './trade-data.tokens';
import { TradeDataOverlayService } from './overlay/trade-data-overlay.service';

const BATCH = 500;
const MAX_STORED_ISSUES = 1000;
const ALLOWED_IMPORT_TYPES: Record<string, string[]> = {
  csv: [
    'text/csv',
    'application/vnd.ms-excel',
    'text/plain',
    'application/csv',
  ],
  json: ['application/json', 'text/json', 'text/plain'],
};

export interface Actor {
  userId: string;
  email: string;
  organizationId: string | null;
}

type UnitFact = NormalizedFact & { unitKey: string; datasetKey: string };

interface ProcessResult {
  facts: UnitFact[];
  issues: PipelineIssue[];
  fetched: number;
  rejected: number;
  unresolved: number;
  exactDuplicatesInRun: number;
  skipped: number;
  reference: HsReferenceRow[];
}

/**
 * Staged, fail-safe ingestion: fetch → raw → parse (schema check) →
 * validate/normalize → dedupe → idempotent upsert. Nothing is written to
 * canonical tables until parsing has succeeded for the whole run, and
 * nothing existing is ever deleted — a failed refresh leaves last-known-good
 * facts untouched.
 */
@Injectable()
export class TradeDataIngestionService implements OnModuleInit {
  private readonly logger = new Logger(TradeDataIngestionService.name);
  private readonly adapters: Map<string, TradeDataSourceAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly overlay: TradeDataOverlayService,
    @Inject(TRADE_DATA_ADAPTERS) adapters: TradeDataSourceAdapter[],
  ) {
    this.adapters = new Map(adapters.map((a) => [a.sourceCode, a]));
  }

  async onModuleInit() {
    await this.syncRegistry();
    // Runs interrupted by a restart can never finish — close them honestly.
    await this.prisma.tradeDataIngestionRun.updateMany({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorSummary: 'Interrupted by a server restart before completion.',
      },
    });
  }

  adapterFor(code: string) {
    return this.adapters.get(code) ?? null;
  }

  /** Static registry metadata is synced from code; `enabled` and run results are left alone. */
  async syncRegistry() {
    for (const d of SOURCE_DEFINITIONS) {
      const { enabledByDefault, ...meta } = d;
      await this.prisma.tradeDataSource.upsert({
        where: { code: d.code },
        create: { ...meta, enabled: enabledByDefault },
        update: meta,
      });
    }
  }

  /** Global data: role permission AND platform-admin allowlist (required in production). */
  assertPlatformAdmin(actor: Actor) {
    const list = (
      this.config.get('tradeDataPlatform', { infer: true }).adminEmails ?? ''
    )
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (list.length === 0) {
      if (this.config.get('app.nodeEnv', { infer: true }) === 'production') {
        throw new ForbiddenException(
          'Trade-data administration is not configured for this environment.',
        );
      }
      return;
    }
    if (!list.includes(actor.email.toLowerCase()))
      throw new ForbiddenException(
        'Only platform data administrators can change global trade-data sources.',
      );
  }

  private async getSource(id: string) {
    const source = await this.prisma.tradeDataSource.findUnique({
      where: { id },
    });
    if (!source) throw new NotFoundException('Source not found.');
    return source;
  }

  async setEnabled(id: string, enabled: boolean, actor: Actor) {
    this.assertPlatformAdmin(actor);
    const source = await this.getSource(id);
    const updated = await this.prisma.tradeDataSource.update({
      where: { id },
      data: { enabled },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: enabled
        ? 'trade_data.source_enabled'
        : 'trade_data.source_disabled',
      entityType: 'TradeDataSource',
      entityId: id,
      metadata: { code: source.code },
    });
    await this.overlay.reload();
    return updated;
  }

  // --- API ingestion --------------------------------------------------------

  async startApiRun(
    sourceId: string,
    datasetsRequested: string[] | undefined,
    actor: Actor,
  ): Promise<TradeDataIngestionRun> {
    this.assertPlatformAdmin(actor);
    const source = await this.getSource(sourceId);
    const adapter = this.adapterFor(source.code);
    if (!adapter || adapter.mode !== 'API')
      throw new BadRequestException(
        'This source has no automated adapter. Use manual import if supported.',
      );
    if (!source.enabled) throw new BadRequestException('Source is disabled.');
    const problems = adapter.validateConfiguration();
    if (problems.length)
      throw new BadRequestException(
        `Source is not configured: ${problems.join(' ')}`,
      );
    const datasets = datasetsRequested?.length
      ? datasetsRequested
      : adapter.datasets;
    const unknown = datasets.filter((d) => !adapter.datasets.includes(d));
    if (unknown.length)
      throw new BadRequestException(
        `Unknown dataset(s): ${unknown.join(', ')}.`,
      );
    await this.assertNoActiveRun(source.id);

    const run = await this.prisma.tradeDataIngestionRun.create({
      data: {
        sourceId: source.id,
        status: 'RUNNING',
        mode: adapter.output === 'HS_REFERENCE' ? 'REFERENCE' : 'API',
        datasetKeys: datasets,
        startedAt: new Date(),
        transformVersion: TRANSFORM_VERSION,
        initiatedByUserId: actor.userId,
        organizationId: actor.organizationId,
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: 'trade_data.ingestion_started',
      entityType: 'TradeDataIngestionRun',
      entityId: run.id,
      metadata: { source: source.code, datasets },
    });
    // Background task: the HTTP request returns immediately; the UI polls the run.
    void this.executeApiRun(run, source, adapter, datasets, actor).catch(
      (error) =>
        this.logger.error(`Run ${run.id} crashed: ${(error as Error).message}`),
    );
    return run;
  }

  private async assertNoActiveRun(sourceId: string) {
    const active = await this.prisma.tradeDataIngestionRun.findFirst({
      where: { sourceId, status: { in: ['PENDING', 'RUNNING'] } },
    });
    if (active)
      throw new ConflictException(
        'An ingestion run for this source is already in progress.',
      );
  }

  private async executeApiRun(
    run: TradeDataIngestionRun,
    source: TradeDataSource,
    adapter: TradeDataSourceAdapter,
    datasets: string[],
    actor: Actor,
  ) {
    const units: FetchedUnit[] = [];
    const fetchIssues: PipelineIssue[] = [];
    let metadata: Record<string, unknown> = {};
    try {
      metadata = adapter.fetchMetadata
        ? await adapter.fetchMetadata({ datasets })
        : {};
      for await (const u of adapter.fetchData!({ datasets }, metadata)) {
        if ('failed' in u)
          fetchIssues.push({
            kind: 'FETCH_FAILED',
            severity: 'REJECTED',
            field: null,
            sourceValue: u.sourceRecordKey,
            message: u.message,
            rowRef: u.sourceRecordKey,
          });
        else units.push(u);
      }
    } catch (error) {
      return this.failRun(run, source, error, actor, fetchIssues);
    }
    if (units.length === 0)
      return this.failRun(
        run,
        source,
        new Error(`No data fetched (${fetchIssues.length} request(s) failed).`),
        actor,
        fetchIssues,
      );
    await this.processAndPersist(
      run,
      source,
      adapter,
      units,
      metadata,
      fetchIssues,
      actor,
    );
  }

  // --- Manual import --------------------------------------------------------

  private validateUpload(file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Attach a CSV or JSON file.');
    if (file.size > MAX_DATA_IMPORT_BYTES)
      throw new BadRequestException('File must be 10MB or smaller.');
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_IMPORT_TYPES[ext])
      throw new BadRequestException(
        'Only .csv and .json files are supported for this source.',
      );
    if (!ALLOWED_IMPORT_TYPES[ext].includes(file.mimetype))
      throw new BadRequestException(
        `File type ${file.mimetype} does not match .${ext}.`,
      );
    return {
      ext: ext as 'csv' | 'json',
      checksum: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  private manualAdapter(source: TradeDataSource) {
    const adapter = this.adapterFor(source.code);
    if (!adapter || adapter.mode !== 'MANUAL_IMPORT' || !adapter.readFile)
      throw new BadRequestException(
        'This source does not accept manual imports.',
      );
    return adapter;
  }

  /** Parse + validate + normalize without writing anything. */
  async preview(
    sourceId: string,
    file: Express.Multer.File | undefined,
    actor: Actor,
  ): Promise<ManualImportPreview> {
    this.assertPlatformAdmin(actor);
    const source = await this.getSource(sourceId);
    const adapter = this.manualAdapter(source);
    const { checksum } = this.validateUpload(file);
    const already = await this.findImportedChecksum(source.id, checksum);
    let read: ReturnType<NonNullable<TradeDataSourceAdapter['readFile']>>;
    try {
      read = adapter.readFile!(file!.buffer, file!.originalname);
    } catch (error) {
      if (error instanceof SchemaMismatchError)
        throw new BadRequestException({
          message: error.message,
          details: { expected: error.expected, actual: error.actual },
        });
      throw error;
    }
    const result = this.process(source, adapter, read.units, {});
    const existing = result.facts.length
      ? await this.prisma.tradeFact.count({
          where: { factKey: { in: result.facts.map((f) => f.factKey) } },
        })
      : 0;
    return {
      fileName: file!.originalname,
      checksum,
      alreadyImported: Boolean(already),
      detectedFormat: read.format,
      rows: read.rows,
      valid: result.facts.length + result.exactDuplicatesInRun,
      rejected: result.rejected,
      duplicatesInFile: result.exactDuplicatesInRun,
      existingFacts: existing,
      unresolvedMappings: result.unresolved,
      issues: result.issues
        .slice(0, 50)
        .map(({ kind, severity, field, sourceValue, message, rowRef }) => ({
          kind,
          severity,
          field,
          sourceValue,
          message,
          rowRef,
        })),
      sampleFacts: result.facts.slice(0, 8).map((f) => ({
        hsCode: f.hsCode,
        partnerLabel: f.partnerLabel,
        period: f.month
          ? `${f.year}-${String(f.month).padStart(2, '0')}`
          : String(f.year),
        tradeValue: f.tradeValue,
        currency: f.currency,
        normalizedQuantity: f.normalizedQuantity,
        normalizedUnit: f.normalizedUnit,
      })),
    };
  }

  async importFile(
    sourceId: string,
    file: Express.Multer.File | undefined,
    actor: Actor,
  ): Promise<TradeDataIngestionRun> {
    this.assertPlatformAdmin(actor);
    const source = await this.getSource(sourceId);
    const adapter = this.manualAdapter(source);
    if (!source.enabled) throw new BadRequestException('Source is disabled.');
    const { ext, checksum } = this.validateUpload(file);
    const already = await this.findImportedChecksum(source.id, checksum);
    if (already)
      throw new ConflictException({
        message:
          'This exact file was already imported; skipped to avoid duplicates.',
        details: { runId: already.id },
      });
    let read: ReturnType<NonNullable<TradeDataSourceAdapter['readFile']>>;
    try {
      read = adapter.readFile!(file!.buffer, file!.originalname);
    } catch (error) {
      if (error instanceof SchemaMismatchError)
        throw new BadRequestException({
          message: error.message,
          details: { expected: error.expected, actual: error.actual },
        });
      throw error;
    }
    await this.assertNoActiveRun(source.id);
    const { storageKey } = await this.storage.savePrivateDataFile(
      file!.buffer,
      ext,
    );
    const run = await this.prisma.tradeDataIngestionRun.create({
      data: {
        sourceId: source.id,
        status: 'RUNNING',
        mode: 'MANUAL_IMPORT',
        datasetKeys: adapter.datasets,
        startedAt: new Date(),
        transformVersion: TRANSFORM_VERSION,
        fileName: file!.originalname.slice(0, 200),
        fileChecksum: checksum,
        storageKey,
        initiatedByUserId: actor.userId,
        organizationId: actor.organizationId,
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: 'trade_data.manual_import_uploaded',
      entityType: 'TradeDataIngestionRun',
      entityId: run.id,
      metadata: {
        source: source.code,
        fileName: run.fileName,
        checksum,
        rows: read.rows,
      },
    });
    void this.processAndPersist(
      run,
      source,
      adapter,
      read.units,
      {},
      [],
      actor,
    ).catch((error) =>
      this.logger.error(`Run ${run.id} crashed: ${(error as Error).message}`),
    );
    return run;
  }

  private findImportedChecksum(sourceId: string, checksum: string) {
    return this.prisma.tradeDataIngestionRun.findFirst({
      where: {
        sourceId,
        fileChecksum: checksum,
        status: { in: ['SUCCEEDED', 'PARTIAL'] },
      },
    });
  }

  // --- Shared pipeline -------------------------------------------------------

  /** Parse (schema-checked) and normalize all units in memory. Throws SchemaMismatchError before anything is written. */
  private process(
    source: TradeDataSource,
    adapter: TradeDataSourceAdapter,
    units: FetchedUnit[],
    metadata: Record<string, unknown>,
  ): ProcessResult {
    const normalized: UnitFact[] = [];
    const issues: PipelineIssue[] = [];
    const reference: HsReferenceRow[] = [];
    let fetched = 0;
    let rejected = 0;
    let skipped = 0;
    for (const unit of units) {
      const parsed = adapter.parse(unit, metadata);
      skipped += parsed.skipped ?? 0;
      if (parsed.reference) {
        reference.push(...parsed.reference);
        fetched += parsed.reference.length;
      }
      for (const rec of parsed.records ?? []) {
        fetched++;
        const { fact, issues: recIssues } = normalizeRecord(rec, source.id);
        issues.push(...recIssues);
        if (fact)
          normalized.push({
            ...fact,
            unitKey: unit.sourceRecordKey,
            datasetKey: unit.datasetKey,
          });
        else rejected++;
      }
    }
    const dedup = dedupeFacts(normalized);
    issues.push(...dedup.issues);
    const unresolved = issues.filter((i) => i.severity === 'UNRESOLVED').length;
    return {
      facts: dedup.facts as UnitFact[],
      issues,
      fetched,
      rejected,
      unresolved,
      exactDuplicatesInRun: dedup.exactDuplicates,
      skipped,
      reference,
    };
  }

  private async processAndPersist(
    run: TradeDataIngestionRun,
    source: TradeDataSource,
    adapter: TradeDataSourceAdapter,
    units: FetchedUnit[],
    metadata: Record<string, unknown>,
    priorIssues: PipelineIssue[],
    actor: Actor,
  ) {
    let result: ProcessResult;
    try {
      result = this.process(source, adapter, units, metadata);
    } catch (error) {
      const issues = [...priorIssues];
      if (error instanceof SchemaMismatchError) {
        issues.push({
          kind: 'SCHEMA_MISMATCH',
          severity: 'REJECTED',
          field: null,
          sourceValue: `expected: ${error.expected.slice(0, 15).join(', ')} | actual: ${error.actual.slice(0, 15).join(', ')}`,
          message: error.message,
          rowRef: null,
        });
      }
      return this.failRun(run, source, error, actor, issues);
    }

    try {
      const rawIds = await this.storeRaw(run, source, units);
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      const writeIssues: PipelineIssue[] = [];
      if (adapter.output === 'HS_REFERENCE') {
        ({ inserted, updated, unchanged } = await this.persistReference(
          source,
          result.reference,
        ));
      } else {
        ({ inserted, updated, unchanged } = await this.persistFacts(
          run,
          source,
          result.facts,
          rawIds,
          writeIssues,
        ));
      }
      const issues = [...priorIssues, ...result.issues, ...writeIssues];
      await this.storeIssues(run, source, issues);

      const accepted =
        adapter.output === 'HS_REFERENCE'
          ? result.reference.length
          : result.facts.length + result.exactDuplicatesInRun;
      const fetchFailures = priorIssues.filter(
        (i) => i.kind === 'FETCH_FAILED',
      ).length;
      const status =
        accepted === 0
          ? 'FAILED'
          : fetchFailures > 0 || result.rejected > 0
            ? 'PARTIAL'
            : 'SUCCEEDED';
      const issueCounts: Partial<Record<TradeDataIssueKind, number>> = {};
      for (const i of issues)
        issueCounts[i.kind] = (issueCounts[i.kind] ?? 0) + 1;

      await this.prisma.tradeDataIngestionRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          recordsFetched: result.fetched,
          recordsAccepted: accepted,
          recordsRejected: result.rejected,
          recordsInserted: inserted,
          recordsUpdated: updated,
          duplicatesSkipped: unchanged + result.exactDuplicatesInRun,
          unresolvedMappings: result.unresolved,
          qualityScore: runQualityScore(
            result.fetched,
            accepted,
            result.unresolved,
            true,
          ),
          sourceVersion: adapter.sourceVersion(units),
          checkpoint: {
            units: units.length,
            fetchFailures,
            breakdownRowsSkipped: result.skipped,
            issueCounts,
          } as Prisma.InputJsonValue,
          errorSummary: status === 'SUCCEEDED' ? null : summarize(issues),
        },
      });
      if (accepted > 0) await this.refreshSourceCoverage(source);
      if (adapter.output === 'TRADE_FACTS') await this.overlay.reload();
      await this.audit.record({
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action:
          status === 'FAILED'
            ? 'trade_data.ingestion_failed'
            : 'trade_data.ingestion_completed',
        entityType: 'TradeDataIngestionRun',
        entityId: run.id,
        metadata: {
          source: source.code,
          status,
          inserted,
          updated,
          rejected: result.rejected,
          unresolved: result.unresolved,
        },
      });
    } catch (error) {
      return this.failRun(run, source, error, actor, [
        ...priorIssues,
        ...result.issues,
      ]);
    }
  }

  /** Raw lineage per fetched unit; identical payloads (same checksum) are reused, not duplicated. */
  private async storeRaw(
    run: TradeDataIngestionRun,
    source: TradeDataSource,
    units: FetchedUnit[],
  ) {
    const ids = new Map<string, string>();
    for (const u of units) {
      const checksum = createHash('sha256')
        .update(JSON.stringify(u.payload))
        .digest('hex');
      const existing = await this.prisma.tradeDataRawRecord.findFirst({
        where: { sourceId: source.id, datasetKey: u.datasetKey, checksum },
        select: { id: true },
      });
      const id = existing
        ? existing.id
        : (
            await this.prisma.tradeDataRawRecord.create({
              data: {
                sourceId: source.id,
                ingestionRunId: run.id,
                datasetKey: u.datasetKey,
                sourceRecordKey: u.sourceRecordKey,
                payload: u.payload as Prisma.InputJsonValue,
                sourcePeriod: u.sourcePeriod,
                checksum,
              },
              select: { id: true },
            })
          ).id;
      ids.set(u.sourceRecordKey, id);
    }
    return ids;
  }

  /** Idempotent upsert by deterministic factKey: new → insert, same content → skip, changed → revision + warning. */
  private async persistFacts(
    run: TradeDataIngestionRun,
    source: TradeDataSource,
    facts: UnitFact[],
    rawIds: Map<string, string>,
    issues: PipelineIssue[],
  ) {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (let i = 0; i < facts.length; i += BATCH) {
      const batch = facts.slice(i, i + BATCH);
      const existing = new Map(
        (
          await this.prisma.tradeFact.findMany({
            where: { factKey: { in: batch.map((f) => f.factKey) } },
            select: {
              factKey: true,
              contentHash: true,
              id: true,
              tradeValue: true,
            },
          })
        ).map((e) => [e.factKey, e]),
      );
      const toCreate: Prisma.TradeFactCreateManyInput[] = [];
      const updates: Prisma.PrismaPromise<unknown>[] = [];
      for (const f of batch) {
        const { unitKey, ...data } = f;
        const row = {
          ...data,
          sourceId: source.id,
          ingestionRunId: run.id,
          rawRecordId: rawIds.get(unitKey) ?? null,
        };
        const prev = existing.get(f.factKey);
        if (!prev) toCreate.push(row as Prisma.TradeFactCreateManyInput);
        else if (prev.contentHash === f.contentHash) unchanged++;
        else {
          updates.push(
            this.prisma.tradeFact.update({
              where: { id: prev.id },
              data: {
                ...(row as Prisma.TradeFactUncheckedUpdateInput),
                revision: { increment: 1 },
              },
            }),
          );
          issues.push({
            kind: 'REVISED_RECORD',
            severity: 'WARNING',
            field: 'value',
            sourceValue: `${prev.tradeValue?.toString() ?? 'null'} → ${f.tradeValue ?? 'null'}`,
            message: `Source revised ${f.hsCode} / ${f.partnerLabel} / ${f.year}; newer value kept (revision tracked)`,
            rowRef: f.sourceRecordKey,
          });
        }
      }
      await this.prisma.$transaction([
        ...(toCreate.length
          ? [
              this.prisma.tradeFact.createMany({
                data: toCreate,
                skipDuplicates: true,
              }),
            ]
          : []),
        ...updates,
      ]);
      inserted += toCreate.length;
      updated += updates.length;
    }
    return { inserted, updated, unchanged };
  }

  /** Official HS rows replace development-sample rows for the same code; ITC-HS sample rows are untouched. */
  private async persistReference(
    source: TradeDataSource,
    rows: HsReferenceRow[],
  ) {
    const existing = new Map(
      (
        await this.prisma.tariffCode.findMany({
          where: { codeSystem: 'HS' },
          select: { code: true, description: true, sourceType: true },
        })
      ).map((e) => [e.code, e]),
    );
    const toCreate: Prisma.TariffCodeCreateManyInput[] = [];
    const updates: Prisma.PrismaPromise<unknown>[] = [];
    let unchanged = 0;
    for (const r of rows) {
      const prev = existing.get(r.code);
      const data = {
        level: r.level,
        description: r.description,
        parentCode: r.parentCode,
        sourceType: 'OFFICIAL' as const,
        sourceName: source.name,
        isActive: true,
      };
      if (!prev) toCreate.push({ codeSystem: 'HS', code: r.code, ...data });
      else if (
        prev.sourceType === 'OFFICIAL' &&
        prev.description === r.description
      )
        unchanged++;
      else
        updates.push(
          this.prisma.tariffCode.update({
            where: { codeSystem_code: { codeSystem: 'HS', code: r.code } },
            data,
          }),
        );
    }
    if (toCreate.length)
      await this.prisma.tariffCode.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    for (let i = 0; i < updates.length; i += BATCH)
      await this.prisma.$transaction(updates.slice(i, i + BATCH));
    return { inserted: toCreate.length, updated: updates.length, unchanged };
  }

  private async storeIssues(
    run: TradeDataIngestionRun,
    source: TradeDataSource,
    issues: PipelineIssue[],
  ) {
    const rows = issues
      .slice(0, MAX_STORED_ISSUES)
      .map((i) => ({ ...i, runId: run.id, sourceId: source.id }));
    if (rows.length)
      await this.prisma.tradeDataIssueRecord.createMany({ data: rows });
  }

  /** Latest covered period drives freshness; only updated after a run that accepted data. */
  private async refreshSourceCoverage(source: TradeDataSource) {
    const latest = await this.prisma.tradeFact.findFirst({
      where: { sourceId: source.id },
      orderBy: { periodEnd: 'desc' },
      select: { periodEnd: true, year: true, month: true },
    });
    const periodEnd =
      latest?.periodEnd ??
      (source.updateFrequency === 'STATIC' ? new Date() : null);
    await this.prisma.tradeDataSource.update({
      where: { id: source.id },
      data: {
        lastSuccessfulRunAt: new Date(),
        latestSourcePeriod: latest
          ? latest.month
            ? `${latest.year}-${String(latest.month).padStart(2, '0')}`
            : String(latest.year)
          : source.updateFrequency === 'STATIC'
            ? 'Current reference'
            : null,
        latestPeriodEnd: periodEnd,
        nextExpectedRefreshAt: nextExpectedRefresh(
          source.updateFrequency,
          periodEnd,
          source.expectedLagDays,
        ),
      },
    });
  }

  private async failRun(
    run: TradeDataIngestionRun,
    source: TradeDataSource,
    error: unknown,
    actor: Actor,
    issues: PipelineIssue[],
  ) {
    const message =
      error instanceof SchemaMismatchError
        ? error.message
        : `Ingestion failed: ${(error as Error)?.message ?? 'unknown error'}`;
    this.logger.warn(`Run ${run.id} (${source.code}) failed: ${message}`);
    await this.storeIssues(run, source, issues).catch(() => undefined);
    await this.prisma.tradeDataIngestionRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorSummary: message.slice(0, 500),
        recordsRejected: issues.filter((i) => i.severity === 'REJECTED').length,
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: 'trade_data.ingestion_failed',
      entityType: 'TradeDataIngestionRun',
      entityId: run.id,
      metadata: { source: source.code, error: message.slice(0, 200) },
    });
  }
}

function summarize(issues: PipelineIssue[]): string {
  const counts = new Map<string, number>();
  for (const i of issues) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([k, n]) => `${n} × ${k.toLowerCase().replace(/_/g, ' ')}`)
    .join('; ')
    .slice(0, 500);
}
