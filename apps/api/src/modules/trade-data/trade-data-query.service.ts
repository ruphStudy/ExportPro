import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  TradeDataIngestionRun,
  TradeDataSource,
  TradeFact,
} from '@prisma/client';
import type {
  DataProvenance,
  IngestionRunDetail,
  IngestionRunSummary,
  TradeDataIssue,
  TradeDataQualitySummary,
  TradeDataSourceSummary,
  TradeFactProvenance,
  TradeFactQuery,
  TradeFactRow,
  TradeDataIssueKind,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { computeFreshness, sourceConfidence } from './reliability';
import { TradeDataIngestionService } from './ingestion.service';

type RunWithSource = TradeDataIngestionRun & { source: { name: string } };

@Injectable()
export class TradeDataQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: TradeDataIngestionService,
  ) {}

  private runSummary(
    r: RunWithSource,
    userNames: Map<string, string>,
  ): IngestionRunSummary {
    return {
      id: r.id,
      sourceId: r.sourceId,
      sourceName: r.source.name,
      status: r.status,
      mode: r.mode,
      datasetKeys: r.datasetKeys,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      recordsFetched: r.recordsFetched,
      recordsAccepted: r.recordsAccepted,
      recordsRejected: r.recordsRejected,
      recordsInserted: r.recordsInserted,
      recordsUpdated: r.recordsUpdated,
      duplicatesSkipped: r.duplicatesSkipped,
      unresolvedMappings: r.unresolvedMappings,
      qualityScore: r.qualityScore,
      sourceVersion: r.sourceVersion,
      transformVersion: r.transformVersion,
      fileName: r.fileName,
      errorSummary: r.errorSummary,
      initiatedBy: r.initiatedByUserId
        ? (userNames.get(r.initiatedByUserId) ?? 'Administrator')
        : null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
    );
  }

  private toSourceSummary(
    s: TradeDataSource,
    latest: RunWithSource | null,
    factCount: number,
    recentFailures: number,
    names: Map<string, string>,
  ): TradeDataSourceSummary {
    const freshness = computeFreshness(
      s.updateFrequency,
      s.latestPeriodEnd,
      s.expectedLagDays,
    );
    const adapter = this.ingestion.adapterFor(s.code);
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      authority: s.authority,
      sourceType: s.sourceType,
      accessMethod: s.accessMethod,
      qualityTier: s.qualityTier,
      official: s.official,
      enabled: s.enabled,
      automated: adapter?.mode === 'API',
      manualImport: adapter?.mode === 'MANUAL_IMPORT',
      datasets: adapter?.datasets ?? [],
      dataDomains: s.dataDomains as TradeDataSourceSummary['dataDomains'],
      updateFrequency: s.updateFrequency,
      expectedLagDays: s.expectedLagDays,
      baseUrl: s.baseUrl,
      termsUrl: s.termsUrl,
      description: s.description,
      notes: s.notes,
      lastSuccessfulRunAt: s.lastSuccessfulRunAt?.toISOString() ?? null,
      latestSourcePeriod: s.latestSourcePeriod,
      nextExpectedRefreshAt: s.nextExpectedRefreshAt?.toISOString() ?? null,
      freshness,
      confidence: sourceConfidence({
        tier: s.qualityTier,
        freshness,
        fetched:
          latest?.status === 'SUCCEEDED' || latest?.status === 'PARTIAL'
            ? latest.recordsFetched
            : undefined,
        accepted: latest?.recordsAccepted,
        unresolved: latest?.unresolvedMappings,
      }),
      factCount,
      latestRun: latest ? this.runSummary(latest, names) : null,
      recentFailures,
      // Adapter config problems only — never secret values.
      configurationProblems: adapter ? adapter.validateConfiguration() : [],
    };
  }

  async listSources(): Promise<TradeDataSourceSummary[]> {
    const [sources, runs, counts] = await Promise.all([
      this.prisma.tradeDataSource.findMany({
        orderBy: [{ qualityTier: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.tradeDataIngestionRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { source: { select: { name: true } } },
      }),
      this.prisma.tradeFact.groupBy({
        by: ['sourceId'],
        _count: { _all: true },
      }),
    ]);
    const names = await this.userNames(runs.map((r) => r.initiatedByUserId));
    const countBy = new Map(counts.map((c) => [c.sourceId, c._count._all]));
    return sources.map((s) => {
      const sRuns = runs.filter((r) => r.sourceId === s.id);
      return this.toSourceSummary(
        s,
        sRuns[0] ?? null,
        countBy.get(s.id) ?? 0,
        sRuns.slice(0, 5).filter((r) => r.status === 'FAILED').length,
        names,
      );
    });
  }

  async getSource(
    id: string,
  ): Promise<TradeDataSourceSummary & { runs: IngestionRunSummary[] }> {
    const s = await this.prisma.tradeDataSource.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Source not found.');
    const runs = await this.prisma.tradeDataIngestionRun.findMany({
      where: { sourceId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { source: { select: { name: true } } },
    });
    const names = await this.userNames(runs.map((r) => r.initiatedByUserId));
    const count = await this.prisma.tradeFact.count({
      where: { sourceId: id },
    });
    return {
      ...this.toSourceSummary(
        s,
        runs[0] ?? null,
        count,
        runs.slice(0, 5).filter((r) => r.status === 'FAILED').length,
        names,
      ),
      runs: runs.map((r) => this.runSummary(r, names)),
    };
  }

  async listRuns(sourceId: string | undefined, page = 1, pageSize = 20) {
    const where: Prisma.TradeDataIngestionRunWhereInput = sourceId
      ? { sourceId }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.tradeDataIngestionRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { source: { select: { name: true } } },
      }),
      this.prisma.tradeDataIngestionRun.count({ where }),
    ]);
    const names = await this.userNames(rows.map((r) => r.initiatedByUserId));
    return {
      items: rows.map((r) => this.runSummary(r, names)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async getRun(id: string): Promise<IngestionRunDetail> {
    const run = await this.prisma.tradeDataIngestionRun.findUnique({
      where: { id },
      include: { source: { select: { name: true } } },
    });
    if (!run) throw new NotFoundException('Run not found.');
    const [issues, grouped] = await Promise.all([
      this.prisma.tradeDataIssueRecord.findMany({
        where: { runId: id },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      this.prisma.tradeDataIssueRecord.groupBy({
        by: ['kind'],
        where: { runId: id },
        _count: { _all: true },
      }),
    ]);
    const names = await this.userNames([run.initiatedByUserId]);
    return {
      ...this.runSummary(run, names),
      issues: issues.map((i) => this.issue(i)),
      issueCounts: Object.fromEntries(
        grouped.map((g) => [g.kind, g._count._all]),
      ) as Partial<Record<TradeDataIssueKind, number>>,
      checkpoint: (run.checkpoint as Record<string, unknown>) ?? null,
    };
  }

  private issue(i: {
    id: string;
    runId: string;
    kind: string;
    severity: TradeDataIssue['severity'];
    field: string | null;
    sourceValue: string | null;
    message: string;
    rowRef: string | null;
    createdAt: Date;
  }): TradeDataIssue {
    return {
      id: i.id,
      runId: i.runId,
      kind: i.kind as TradeDataIssueKind,
      severity: i.severity,
      field: i.field,
      sourceValue: i.sourceValue,
      message: i.message,
      rowRef: i.rowRef,
      createdAt: i.createdAt.toISOString(),
    };
  }

  async listIssues(q: {
    sourceId?: string;
    kind?: string;
    severity?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.TradeDataIssueRecordWhereInput = {
      ...(q.sourceId ? { sourceId: q.sourceId } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.severity
        ? { severity: q.severity as TradeDataIssue['severity'] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.tradeDataIssueRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.tradeDataIssueRecord.count({ where }),
    ]);
    return {
      items: rows.map((i) => this.issue(i)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private factRow(f: TradeFact & { source: TradeDataSource }): TradeFactRow {
    const n = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
    return {
      id: f.id,
      tradeDirection: f.tradeDirection,
      codeSystem: f.codeSystem,
      hsCode: f.hsCode,
      hsLevel: f.hsLevel,
      sourceHsCode: f.sourceHsCode,
      reporterCountryCode: f.reporterCountryCode,
      partnerCountryCode: f.partnerCountryCode,
      partnerEntityType: f.partnerEntityType,
      partnerLabel: f.partnerLabel,
      periodType: f.periodType,
      year: f.year,
      month: f.month,
      period: f.month
        ? `${f.year}-${String(f.month).padStart(2, '0')}`
        : String(f.year),
      tradeValue: n(f.tradeValue),
      currency: f.currency,
      valueBasis: f.valueBasis,
      quantity: n(f.quantity),
      quantityUnit: f.quantityUnit,
      normalizedQuantity: n(f.normalizedQuantity),
      normalizedUnit: f.normalizedUnit,
      unitMappingStatus: f.unitMappingStatus,
      portCode: f.portCode,
      stateCode: f.stateCode,
      isEstimated: f.isEstimated,
      sourceId: f.sourceId,
      sourceName: f.source.name,
      freshness: computeFreshness(
        f.source.updateFrequency,
        f.source.latestPeriodEnd,
        f.source.expectedLagDays,
      ),
      revision: f.revision,
      ingestedAt: f.ingestedAt.toISOString(),
    };
  }

  async listFacts(q: TradeFactQuery) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 100);
    const where: Prisma.TradeFactWhereInput = {
      ...(q.tradeDirection ? { tradeDirection: q.tradeDirection } : {}),
      ...(q.hsCode
        ? { hsCode: { startsWith: q.hsCode.replace(/[\s.]/g, '') } }
        : {}),
      ...(q.reporter ? { reporterCountryCode: q.reporter.toUpperCase() } : {}),
      ...(q.partner
        ? q.partner.toUpperCase() === 'WORLD'
          ? { partnerEntityType: 'WORLD' as const }
          : { partnerCountryCode: q.partner.toUpperCase() }
        : {}),
      ...(q.year ? { year: q.year } : {}),
      ...(q.month ? { month: q.month } : {}),
      ...(q.port ? { portCode: q.port } : {}),
      ...(q.state ? { stateCode: q.state.toUpperCase() } : {}),
      ...(q.sourceId ? { sourceId: q.sourceId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.tradeFact.findMany({
        where,
        orderBy: [
          { year: 'desc' },
          { hsCode: 'asc' },
          { normalizedValueUsd: { sort: 'desc', nulls: 'last' } },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { source: true },
      }),
      this.prisma.tradeFact.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.factRow(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async factProvenance(id: string): Promise<TradeFactProvenance> {
    const f = await this.prisma.tradeFact.findUnique({
      where: { id },
      include: { source: true, run: true, rawRecord: true },
    });
    if (!f) throw new NotFoundException('Fact not found.');
    const row = this.factRow(f);
    const freshness = row.freshness;
    // Locate the exact source row inside the raw unit for an excerpt.
    let excerpt: unknown = null;
    const payload = f.rawRecord?.payload as
      | {
          data?: Record<string, unknown>[];
          rows?: Record<string, string>[];
          firstRow?: number;
        }
      | undefined;
    if (payload?.data && f.sourceRecordKey) {
      const partner = f.sourceRecordKey.split(':').pop();
      excerpt =
        payload.data.find(
          (d) =>
            String(d.partnerCode) === partner &&
            Number(d.partner2Code) === 0 &&
            Number(d.motCode) === 0,
        ) ?? null;
    } else if (payload?.rows && f.sourceRecordKey) {
      const m = /row (\d+)$/.exec(f.sourceRecordKey);
      if (m)
        excerpt = payload.rows[Number(m[1]) - (payload.firstRow ?? 2)] ?? null;
    }
    const provenance: DataProvenance = {
      sourceId: f.sourceId,
      sourceCode: f.source.code,
      sourceName: f.source.name,
      sourceType: f.source.sourceType,
      authority: f.source.authority,
      official: f.source.official,
      sourceQuality: f.source.qualityTier,
      sourceDate: row.period,
      lastIngestedAt: f.updatedAt.toISOString(),
      freshness,
      confidence: sourceConfidence({
        tier: f.source.qualityTier,
        freshness,
        fetched: f.run?.recordsFetched,
        accepted: f.run?.recordsAccepted,
        unresolved: f.run?.unresolvedMappings,
      }),
      provenanceType: 'SOURCE_NORMALIZED',
      datasetVersion: f.run?.sourceVersion ?? null,
      derived: false,
      methodology: `Normalized by ${f.transformVersion}; original code "${f.sourceHsCode}", partner "${f.sourcePartner ?? f.partnerLabel}".`,
    };
    return {
      fact: row,
      provenance,
      run: f.run
        ? {
            id: f.run.id,
            status: f.run.status,
            startedAt: f.run.startedAt?.toISOString() ?? null,
            finishedAt: f.run.finishedAt?.toISOString() ?? null,
            transformVersion: f.run.transformVersion,
          }
        : null,
      raw: f.rawRecord
        ? {
            rawRecordId: f.rawRecord.id,
            datasetKey: f.rawRecord.datasetKey,
            sourceRecordKey: f.sourceRecordKey,
            sourcePeriod: f.rawRecord.sourcePeriod,
            checksum: f.rawRecord.checksum,
            importedAt: f.rawRecord.importedAt.toISOString(),
            excerpt,
          }
        : null,
      original: {
        hsCode: f.sourceHsCode,
        partner: f.sourcePartner,
        value: row.tradeValue,
        quantity: row.quantity,
        unit: f.quantityUnit,
      },
      transformVersion: f.transformVersion,
    };
  }

  async quality(): Promise<TradeDataQualitySummary> {
    const sources = await this.listSources();
    const [runs, totals] = await Promise.all([
      this.prisma.tradeDataIngestionRun.count(),
      this.prisma.tradeDataIngestionRun.aggregate({
        _sum: {
          recordsFetched: true,
          recordsRejected: true,
          unresolvedMappings: true,
          duplicatesSkipped: true,
        },
      }),
    ]);
    const fetched = totals._sum.recordsFetched ?? 0;
    return {
      sources: sources.length,
      enabledSources: sources.filter((s) => s.enabled).length,
      officialOrPublicSources: sources.filter(
        (s) => s.sourceType !== 'DEMO' && s.sourceType !== 'INTERNAL',
      ).length,
      totalFacts: sources.reduce((s, x) => s + x.factCount, 0),
      runs,
      latestRunsFailed: sources.filter((s) => s.latestRun?.status === 'FAILED')
        .length,
      staleSources: sources.filter(
        (s) =>
          s.enabled &&
          s.sourceType !== 'DEMO' &&
          (s.freshness === 'STALE' || s.freshness === 'VERY_STALE'),
      ).length,
      rejectedPercent: fetched
        ? Math.round((1000 * (totals._sum.recordsRejected ?? 0)) / fetched) / 10
        : null,
      unresolvedMappings: totals._sum.unresolvedMappings ?? 0,
      duplicatesSkipped: totals._sum.duplicatesSkipped ?? 0,
    };
  }
}
