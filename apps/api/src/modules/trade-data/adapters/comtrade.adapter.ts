import type { PartnerEntityType } from '@exportpro/types';
import type { SourceRecord } from '../normalization/pipeline';
import {
  AdapterContext,
  FetchFailure,
  FetchedUnit,
  ParsedUnit,
  SchemaMismatchError,
  TradeDataSourceAdapter,
} from './adapter';
import { PoliteHttpClient } from './http';

export interface ComtradeConfig {
  baseUrl: string;
  requestGapMs: number;
  hsCodes: string[];
  exportYears: number[];
  importYears: number[];
  importReporters: string[];
}

const DATA_FIELDS = [
  'period',
  'reporterCode',
  'flowCode',
  'partnerCode',
  'partner2Code',
  'cmdCode',
  'primaryValue',
  'qtyUnitCode',
  'qty',
  'motCode',
  'customsCode',
  'classificationCode',
];

interface PartnerRef {
  code: number;
  iso2: string | null;
  desc: string;
  isGroup: boolean;
}
interface ReporterRef {
  code: number;
  iso2: string | null;
  desc: string;
}

/**
 * UN Comtrade public preview adapter (annual, HS6, no key).
 * Datasets:
 *  - INDIA_EXPORTS: reporter India (699), flow X, all partners — per HS code × year.
 *  - PARTNER_IMPORTS: selected destination reporters, flow M, all partners — per reporter × HS code × year.
 * Only total rows (partner2 = 0, mode of transport = 0, customs = C00) are kept.
 */
export class ComtradeAdapter implements TradeDataSourceAdapter {
  readonly sourceCode = 'UN_COMTRADE';
  readonly output = 'TRADE_FACTS' as const;
  readonly mode = 'API' as const;
  readonly datasets = ['INDIA_EXPORTS', 'PARTNER_IMPORTS'];
  private readonly http: PoliteHttpClient;

  constructor(private readonly config: ComtradeConfig) {
    this.http = new PoliteHttpClient(config.requestGapMs);
  }

  validateConfiguration(): string[] {
    const problems: string[] = [];
    if (!/^https:\/\//.test(this.config.baseUrl))
      problems.push('COMTRADE_BASE_URL must be an https URL.');
    if (
      !this.config.hsCodes.length ||
      this.config.hsCodes.some((c) => !/^\d{6}$/.test(c))
    )
      problems.push('COMTRADE_HS_CODES must list 6-digit HS codes.');
    if (!this.config.exportYears.length)
      problems.push('No export years configured.');
    if (this.config.requestGapMs < 1000)
      problems.push('Request gap below 1s is not allowed for a public API.');
    return problems;
  }

  async fetchMetadata(): Promise<Record<string, unknown>> {
    const root = this.config.baseUrl.replace(/\/public\/v1\/preview\/?$/, '');
    const [partners, reporters, units] = await Promise.all([
      this.http.getJson(`${root}/files/v1/app/reference/partnerAreas.json`),
      this.http.getJson(`${root}/files/v1/app/reference/Reporters.json`),
      this.http.getJson(`${root}/files/v1/app/reference/QuantityUnits.json`),
    ]);
    const list = (x: unknown, name: string) => {
      const r = (x as { results?: unknown[] })?.results;
      if (!Array.isArray(r) || !r.length)
        throw new SchemaMismatchError(
          ['results[]'],
          Object.keys((x as object) ?? {}),
          `${name} reference has no results array`,
        );
      return r as Record<string, unknown>[];
    };
    const partnerRefs: PartnerRef[] = list(partners, 'partnerAreas').map(
      (p) => ({
        code: Number(p.PartnerCode),
        iso2: (p.PartnerCodeIsoAlpha2 as string | null) ?? null,
        desc: String(p.PartnerDesc ?? ''),
        isGroup: Boolean(p.isGroup),
      }),
    );
    const reporterRefs: ReporterRef[] = list(reporters, 'Reporters').map(
      (r) => ({
        code: Number(r.reporterCode),
        iso2: (r.reporterCodeIsoAlpha2 as string | null) ?? null,
        desc: String(r.reporterDesc ?? ''),
      }),
    );
    const unitRefs = Object.fromEntries(
      list(units, 'QuantityUnits').map((u) => [
        Number(u.qtyCode),
        String(u.qtyAbbr ?? ''),
      ]),
    );
    return { partners: partnerRefs, reporters: reporterRefs, units: unitRefs };
  }

  async *fetchData(
    ctx: AdapterContext,
    metadata: Record<string, unknown>,
  ): AsyncGenerator<FetchedUnit | FetchFailure> {
    const reporters = metadata.reporters as ReporterRef[];
    // Current (non-historical) Comtrade reporter code per ISO2, e.g. India = 699 (356 is "India (...1974)").
    const reporterCode = (iso2: string) =>
      reporters.find((r) => r.iso2 === iso2 && !r.desc.includes('(...'))
        ?.code ?? null;
    const jobs: {
      datasetKey: string;
      reporter: number;
      flow: 'X' | 'M';
      hs: string;
      year: number;
    }[] = [];
    if (ctx.datasets.includes('INDIA_EXPORTS')) {
      const india = reporterCode('IN');
      if (india)
        for (const hs of this.config.hsCodes)
          for (const year of this.config.exportYears)
            jobs.push({
              datasetKey: 'INDIA_EXPORTS',
              reporter: india,
              flow: 'X',
              hs,
              year,
            });
    }
    if (ctx.datasets.includes('PARTNER_IMPORTS')) {
      for (const iso2 of this.config.importReporters) {
        const code = reporterCode(iso2);
        if (!code) continue;
        for (const hs of this.config.hsCodes)
          for (const year of this.config.importYears)
            jobs.push({
              datasetKey: 'PARTNER_IMPORTS',
              reporter: code,
              flow: 'M',
              hs,
              year,
            });
      }
    }
    for (const job of jobs) {
      const key = `${job.reporter}:${job.flow}:${job.hs}:${job.year}`;
      const url = `${this.config.baseUrl}/C/A/HS?reporterCode=${job.reporter}&period=${job.year}&cmdCode=${job.hs}&flowCode=${job.flow}`;
      try {
        const payload = await this.http.getJson(url);
        yield {
          datasetKey: job.datasetKey,
          sourceRecordKey: key,
          sourcePeriod: String(job.year),
          payload,
        };
      } catch (error) {
        yield {
          failed: true,
          datasetKey: job.datasetKey,
          sourceRecordKey: key,
          message: (error as Error).message,
        };
      }
    }
  }

  parse(unit: FetchedUnit, metadata: Record<string, unknown>): ParsedUnit {
    const body = unit.payload as { data?: unknown; error?: unknown };
    if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
      throw new SchemaMismatchError(
        ['data[]', 'error'],
        Object.keys(body ?? {}),
        `response for ${unit.sourceRecordKey} has no data array`,
      );
    }
    if (typeof body.error === 'string' && body.error)
      throw new Error(`Source error: ${body.error}`);
    const partners = new Map(
      (metadata.partners as PartnerRef[]).map((p) => [p.code, p]),
    );
    const reporters = new Map(
      (metadata.reporters as ReporterRef[]).map((r) => [r.code, r]),
    );
    const units = metadata.units as Record<number, string>;
    const records: SourceRecord[] = [];
    let skipped = 0;
    for (const row of body.data as Record<string, unknown>[]) {
      const missing = DATA_FIELDS.filter((f) => !(f in row));
      if (missing.length)
        throw new SchemaMismatchError(
          DATA_FIELDS,
          Object.keys(row),
          `row missing ${missing.join(', ')}`,
        );
      if (
        Number(row.partner2Code) !== 0 ||
        Number(row.motCode) !== 0 ||
        row.customsCode !== 'C00'
      ) {
        skipped++;
        continue;
      }
      const reporter = reporters.get(Number(row.reporterCode));
      const partner = partners.get(Number(row.partnerCode));
      const entityType: PartnerEntityType | undefined =
        Number(row.partnerCode) === 0
          ? 'WORLD'
          : partner?.isGroup
            ? 'AGGREGATE'
            : partner && !partner.iso2
              ? 'OTHER'
              : undefined;
      const unitCode = Number(row.qtyUnitCode);
      const flow = String(row.flowCode);
      records.push({
        rowRef: `${unit.sourceRecordKey}:${String(row.partnerCode)}`,
        sourceRecordKey: `${String(row.reporterCode)}:${flow}:${String(row.cmdCode)}:${String(row.period)}:${String(row.partnerCode)}`,
        direction: flow === 'X' ? 'EXPORT' : 'IMPORT',
        hsCode: row.cmdCode,
        allowItc: false,
        reporter: {
          iso2: reporter?.iso2 ?? null,
          name: reporter?.desc ?? String(row.reporterCode),
        },
        partner: {
          iso2: entityType ? null : (partner?.iso2 ?? null),
          name: partner?.desc ?? `Comtrade partner ${String(row.partnerCode)}`,
          entityType,
        },
        year: row.period,
        value: row.primaryValue,
        currency: 'USD',
        valueBasis: flow === 'X' ? 'FOB' : 'CIF',
        quantity: unitCode === -1 ? null : row.qty,
        unit:
          unitCode === -1
            ? null
            : (units[unitCode] ?? `comtrade-unit-${unitCode}`),
        netWeightKg: row.netWgt ?? null,
        estimated:
          typeof row.isQtyEstimated === 'boolean' ? row.isQtyEstimated : null,
      });
    }
    return { records, skipped };
  }

  sourceVersion(): string {
    return `comtrade-preview:${new Date().toISOString().slice(0, 10)}`;
  }
}
