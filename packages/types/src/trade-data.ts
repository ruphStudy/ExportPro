import type { PaginationMeta } from "./api";
import type { FreshnessStatus, TradeDirection } from "./enums";

/**
 * Sprint 9 trade-data platform contracts. Raw source data, normalized
 * facts, system-derived metrics, AI-derived output, user-provided data
 * and demo data are always distinguishable via `ProvenanceType`.
 */

export const TradeDataSourceType = {
  GOVERNMENT: "GOVERNMENT",
  INTERGOVERNMENTAL: "INTERGOVERNMENTAL",
  PUBLIC: "PUBLIC",
  COMMERCIAL: "COMMERCIAL",
  INTERNAL: "INTERNAL",
  DEMO: "DEMO",
} as const;
export type TradeDataSourceType = (typeof TradeDataSourceType)[keyof typeof TradeDataSourceType];

export const DataAccessMethod = {
  API: "API",
  CSV: "CSV",
  XLSX: "XLSX",
  JSON: "JSON",
  ZIP: "ZIP",
  MANUAL_IMPORT: "MANUAL_IMPORT",
} as const;
export type DataAccessMethod = (typeof DataAccessMethod)[keyof typeof DataAccessMethod];

/** A = official government/authoritative, B = intergovernmental / trusted public institution, C = reliable public/partner, D = internal derived, DEMO = synthetic. Independent of freshness. */
export const SourceQualityTier = { A: "A", B: "B", C: "C", D: "D", DEMO: "DEMO" } as const;
export type SourceQualityTier = (typeof SourceQualityTier)[keyof typeof SourceQualityTier];

export const SOURCE_QUALITY_LABELS: Record<SourceQualityTier, string> = {
  A: "Tier A — official government / authoritative",
  B: "Tier B — intergovernmental / trusted public institution",
  C: "Tier C — reliable public or partner dataset",
  D: "Tier D — internal derived dataset",
  DEMO: "Demo — synthetic development dataset",
};

export const TradeDataDomain = {
  TRADE_VALUE: "TRADE_VALUE",
  TRADE_QUANTITY: "TRADE_QUANTITY",
  HS_CLASSIFICATION: "HS_CLASSIFICATION",
  COUNTRY: "COUNTRY",
  PORT: "PORT",
  STATE_EXPORT: "STATE_EXPORT",
  DISTRICT_EXPORT: "DISTRICT_EXPORT",
  TARIFF: "TARIFF",
  COMMODITY: "COMMODITY",
  UNIT_REFERENCE: "UNIT_REFERENCE",
} as const;
export type TradeDataDomain = (typeof TradeDataDomain)[keyof typeof TradeDataDomain];

export const UpdateFrequency = {
  DAILY: "DAILY",
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
  ANNUAL: "ANNUAL",
  AD_HOC: "AD_HOC",
  STATIC: "STATIC",
} as const;
export type UpdateFrequency = (typeof UpdateFrequency)[keyof typeof UpdateFrequency];

export const IngestionRunStatus = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type IngestionRunStatus = (typeof IngestionRunStatus)[keyof typeof IngestionRunStatus];

/** Shared provenance vocabulary for Sprints 4–9. */
export const ProvenanceType = {
  SOURCE_RAW: "SOURCE_RAW",
  SOURCE_NORMALIZED: "SOURCE_NORMALIZED",
  SYSTEM_DERIVED: "SYSTEM_DERIVED",
  AI_DERIVED: "AI_DERIVED",
  USER_PROVIDED: "USER_PROVIDED",
  DEMO: "DEMO",
} as const;
export type ProvenanceType = (typeof ProvenanceType)[keyof typeof ProvenanceType];

export const MappingStatus = {
  EXACT: "EXACT",
  HIGH_CONFIDENCE: "HIGH_CONFIDENCE",
  APPROXIMATE: "APPROXIMATE",
  UNRESOLVED: "UNRESOLVED",
} as const;
export type MappingStatus = (typeof MappingStatus)[keyof typeof MappingStatus];

export const PeriodType = { YEAR: "YEAR", QUARTER: "QUARTER", MONTH: "MONTH" } as const;
export type PeriodType = (typeof PeriodType)[keyof typeof PeriodType];

export const PartnerEntityType = {
  COUNTRY: "COUNTRY",
  WORLD: "WORLD",
  AGGREGATE: "AGGREGATE",
  OTHER: "OTHER",
} as const;
export type PartnerEntityType = (typeof PartnerEntityType)[keyof typeof PartnerEntityType];

export type TradeDataIssueKind =
  | "SCHEMA_MISMATCH"
  | "MALFORMED_HS"
  | "UNKNOWN_COUNTRY"
  | "UNKNOWN_UNIT"
  | "INCOMPATIBLE_UNIT"
  | "INVALID_VALUE"
  | "INVALID_PERIOD"
  | "INVALID_CURRENCY"
  | "UNKNOWN_PORT"
  | "UNKNOWN_STATE"
  | "UNRESOLVED_DISTRICT"
  | "CONFLICTING_DUPLICATE"
  | "REVISED_RECORD"
  | "FETCH_FAILED";

export type TradeDataIssueSeverity = "REJECTED" | "UNRESOLVED" | "WARNING";

/** Reusable transparency contract for any analytical result (Sprint 9+). */
export interface DataProvenance {
  sourceId: string | null;
  sourceCode: string;
  sourceName: string;
  sourceType: TradeDataSourceType;
  authority: string;
  official: boolean;
  sourceQuality: SourceQualityTier;
  /** Latest period covered by the data, e.g. "2024". */
  sourceDate: string | null;
  lastIngestedAt: string | null;
  freshness: FreshnessStatus;
  confidence: number;
  provenanceType: ProvenanceType;
  datasetVersion: string | null;
  derived: boolean;
  methodology: string | null;
}

/** Section key → provenance, so mixed real/demo pages label each section separately. */
export type SectionProvenance = Record<string, DataProvenance>;

export interface TradeDataSourceSummary {
  id: string;
  code: string;
  name: string;
  authority: string;
  sourceType: TradeDataSourceType;
  accessMethod: DataAccessMethod;
  qualityTier: SourceQualityTier;
  official: boolean;
  enabled: boolean;
  /** True when an adapter can fetch this source automatically (API). */
  automated: boolean;
  /** True when admins can upload files for this source. */
  manualImport: boolean;
  /** Datasets the adapter can ingest (e.g. INDIA_EXPORTS, PARTNER_IMPORTS). */
  datasets: string[];
  dataDomains: TradeDataDomain[];
  updateFrequency: UpdateFrequency;
  expectedLagDays: number;
  baseUrl: string | null;
  termsUrl: string | null;
  description: string;
  notes: string | null;
  lastSuccessfulRunAt: string | null;
  latestSourcePeriod: string | null;
  nextExpectedRefreshAt: string | null;
  freshness: FreshnessStatus;
  confidence: number;
  factCount: number;
  latestRun: IngestionRunSummary | null;
  recentFailures: number;
  configurationProblems: string[];
}

export interface IngestionRunSummary {
  id: string;
  sourceId: string;
  sourceName: string;
  status: IngestionRunStatus;
  mode: "API" | "MANUAL_IMPORT" | "REFERENCE";
  datasetKeys: string[];
  startedAt: string | null;
  finishedAt: string | null;
  recordsFetched: number;
  recordsAccepted: number;
  recordsRejected: number;
  recordsInserted: number;
  recordsUpdated: number;
  duplicatesSkipped: number;
  unresolvedMappings: number;
  qualityScore: number | null;
  sourceVersion: string | null;
  transformVersion: string;
  fileName: string | null;
  errorSummary: string | null;
  initiatedBy: string | null;
  createdAt: string;
}

export interface TradeDataIssue {
  id: string;
  runId: string;
  kind: TradeDataIssueKind;
  severity: TradeDataIssueSeverity;
  field: string | null;
  sourceValue: string | null;
  message: string;
  rowRef: string | null;
  createdAt: string;
}

export interface IngestionRunDetail extends IngestionRunSummary {
  issues: TradeDataIssue[];
  issueCounts: Partial<Record<TradeDataIssueKind, number>>;
  checkpoint: Record<string, unknown> | null;
}

export interface TradeFactRow {
  id: string;
  tradeDirection: TradeDirection;
  codeSystem: string;
  hsCode: string;
  hsLevel: number;
  sourceHsCode: string;
  reporterCountryCode: string;
  partnerCountryCode: string | null;
  partnerEntityType: PartnerEntityType;
  partnerLabel: string;
  periodType: PeriodType;
  year: number;
  month: number | null;
  period: string;
  tradeValue: number | null;
  currency: string;
  valueBasis: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  normalizedQuantity: number | null;
  normalizedUnit: string | null;
  unitMappingStatus: MappingStatus;
  portCode: string | null;
  stateCode: string | null;
  isEstimated: boolean | null;
  sourceId: string;
  sourceName: string;
  freshness: FreshnessStatus;
  revision: number;
  ingestedAt: string;
}

export interface TradeFactQuery {
  tradeDirection?: TradeDirection;
  hsCode?: string;
  reporter?: string;
  partner?: string;
  year?: number;
  month?: number;
  port?: string;
  state?: string;
  sourceId?: string;
  page?: number;
  pageSize?: number;
}

export interface TradeFactListResponse {
  items: TradeFactRow[];
  meta: PaginationMeta;
}

export interface TradeFactProvenance {
  fact: TradeFactRow;
  provenance: DataProvenance;
  run: { id: string; status: IngestionRunStatus; startedAt: string | null; finishedAt: string | null; transformVersion: string } | null;
  raw: { rawRecordId: string; datasetKey: string; sourceRecordKey: string | null; sourcePeriod: string | null; checksum: string; importedAt: string; excerpt: unknown } | null;
  original: { hsCode: string; partner: string | null; value: number | null; quantity: number | null; unit: string | null };
  transformVersion: string;
}

export interface TradeDataQualitySummary {
  sources: number;
  enabledSources: number;
  officialOrPublicSources: number;
  totalFacts: number;
  runs: number;
  latestRunsFailed: number;
  staleSources: number;
  rejectedPercent: number | null;
  unresolvedMappings: number;
  duplicatesSkipped: number;
}

export interface ManualImportPreview {
  fileName: string;
  checksum: string;
  alreadyImported: boolean;
  detectedFormat: "CSV" | "JSON";
  rows: number;
  valid: number;
  rejected: number;
  duplicatesInFile: number;
  existingFacts: number;
  unresolvedMappings: number;
  issues: Omit<TradeDataIssue, "id" | "runId" | "createdAt">[];
  sampleFacts: Pick<TradeFactRow, "hsCode" | "partnerLabel" | "period" | "tradeValue" | "currency" | "normalizedQuantity" | "normalizedUnit">[];
}

export interface IngestRequest {
  datasets?: string[];
}
