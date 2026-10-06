import type { SourceRecord } from '../normalization/pipeline';

/** One fetched unit (an API response page or an uploaded file chunk) — stored as raw lineage. */
export interface FetchedUnit {
  datasetKey: string;
  sourceRecordKey: string;
  sourcePeriod: string | null;
  payload: unknown;
}

export interface FetchFailure {
  failed: true;
  datasetKey: string;
  sourceRecordKey: string;
  message: string;
}

export interface HsReferenceRow {
  code: string;
  level: number;
  parentCode: string | null;
  description: string;
}

export interface ParsedUnit {
  records?: SourceRecord[];
  reference?: HsReferenceRow[];
  /** Rows deliberately not used (e.g. mode-of-transport breakdowns of a total) — counted, not rejected. */
  skipped?: number;
}

/** Thrown when a source's columns/shape differ from what the adapter expects — the run fails without writing. */
export class SchemaMismatchError extends Error {
  constructor(
    readonly expected: string[],
    readonly actual: string[],
    detail: string,
  ) {
    super(`Schema mismatch: ${detail}`);
    this.name = 'SchemaMismatchError';
  }
}

export interface AdapterContext {
  datasets: string[];
}

/**
 * Source adapter. All portal/API/file specifics (endpoints, field names,
 * code lists) live here — downstream normalization and intelligence never
 * know how a source works.
 */
export interface TradeDataSourceAdapter {
  readonly sourceCode: string;
  readonly output: 'TRADE_FACTS' | 'HS_REFERENCE';
  readonly mode: 'API' | 'MANUAL_IMPORT';
  readonly datasets: string[];
  /** Problems that block ingestion (missing config etc.). Empty = ready. Never includes secret values. */
  validateConfiguration(): string[];
  /** Reference/metadata needed to parse (e.g. partner code lists). */
  fetchMetadata?(ctx: AdapterContext): Promise<Record<string, unknown>>;
  fetchData?(
    ctx: AdapterContext,
    metadata: Record<string, unknown>,
  ): AsyncGenerator<FetchedUnit | FetchFailure>;
  /** Manual imports: split an uploaded file into units. Throws SchemaMismatchError on unexpected columns. */
  readFile?(
    buffer: Buffer,
    fileName: string,
  ): { format: 'CSV' | 'JSON'; units: FetchedUnit[]; rows: number };
  parse(unit: FetchedUnit, metadata: Record<string, unknown>): ParsedUnit;
  /** Logical source version for this run (publication marker / fetch date). */
  sourceVersion(units: FetchedUnit[]): string | null;
}
