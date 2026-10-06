import type { CompetitionLevel, ComplianceDifficulty, SeasonalityLevel } from "./enums";
import type { OpportunitySourceMetadata } from "./opportunities";
import type { ProductSummary } from "./products";
import type { SectionProvenance } from "./trade-data";

/**
 * Sprint 6 Product Intelligence contracts. All metrics (YoY, CAGR,
 * concentration, seasonality, scores) are computed server-side — the
 * frontend only formats them. Trade data is global (keyed by HS code);
 * a saved organization product only references it.
 */

/** Reuses Sprint 4 source/freshness conventions, plus the period the data covers. */
export interface SourceMetadata extends OpportunitySourceMetadata {
  datasetVersion: string;
  coverageFrom: string;
  coverageTo: string;
  /** True for DEMO/sample datasets — UI must label them as not official statistics. */
  isSample: boolean;
}

export type IntelligenceLevel = "LOW" | "MODERATE" | "HIGH";
export type IntelligenceMatchLevel = "ITC_HS" | "HS_SUBHEADING" | "HS_HEADING";

export type ProductIntelligenceStatus =
  | "AVAILABLE"
  | "CLASSIFICATION_REQUIRED"
  | "NO_DATA"
  | "NOT_GENERATED";

export interface TradeTrendPoint {
  period: string;
  exportValue: number | null;
  exportQuantity: number | null;
  /** YoY (yearly) or vs-same-month-last-year (monthly), %; null when not computable. */
  growthPercent: number | null;
}

export interface ExportValueMetric {
  latestPeriod: string;
  latestValue: number;
  previousValue: number | null;
  yoyGrowthPercent: number | null;
  currency: string;
}

export interface ExportQuantityMetric {
  available: boolean;
  unit: string | null;
  latestValue: number | null;
  yoyGrowthPercent: number | null;
}

export interface CAGRMetric {
  available: boolean;
  valuePercent: number | null;
  fromPeriod: string | null;
  toPeriod: string | null;
  years: number | null;
  reason: string | null;
}

export interface TrendPeriodOption {
  key: "3Y" | "5Y" | "ALL";
  label: string;
  fromPeriod: string;
  toPeriod: string;
  cagr: CAGRMetric;
}

export interface ExportTrendIntelligence {
  currency: string;
  value: ExportValueMetric;
  quantity: ExportQuantityMetric;
  cagr: CAGRMetric;
  yearly: TradeTrendPoint[];
  /** Empty when the dataset has no monthly resolution — never synthesized. */
  monthly: TradeTrendPoint[];
  periodOptions: TrendPeriodOption[];
  confidence: number;
}

export interface SeasonalityInsight {
  available: boolean;
  level: SeasonalityLevel | null;
  strongestMonths: string[];
  weakestMonths: string[];
  strongestQuarter: string | null;
  weakestQuarter: string | null;
  /** Share of a typical year's value in the strongest quarter, %. */
  peakQuarterSharePercent: number | null;
  monthsOfData: number;
  explanation: string;
  confidence: number;
}

export interface StateExportMetric {
  rank: number;
  stateCode: string;
  stateName: string;
  region: string;
  contributionPercent: number;
  /** Derived from contribution × latest national value; null if not computable. */
  indicativeExportValue: number | null;
}

export interface DistrictExportMetric {
  rank: number;
  district: string;
  stateName: string;
  contributionPercent: number;
}

export interface PortExportMetric {
  rank: number;
  portName: string;
  stateName: string;
  contributionPercent: number;
  indicativeExportValue: number | null;
}

export interface RegionalContribution {
  region: string;
  contributionPercent: number;
  stateCount: number;
}

export interface IndiaEcosystemIntelligence {
  states: StateExportMetric[];
  districtsAvailable: boolean;
  districts: DistrictExportMetric[];
  ports: PortExportMetric[];
  regions: RegionalContribution[];
  stateConcentration: { topTwoSharePercent: number; hhi: number; level: IntelligenceLevel };
  confidence: number;
}

export interface DestinationMetric {
  rank: number;
  countryCode: string;
  sharePercent: number;
  indicativeExportValue: number | null;
  growthPercent: number | null;
}

export interface ExportConcentration {
  topThreeSharePercent: number;
  topFiveSharePercent: number;
  /** Herfindahl–Hirschman Index on % shares (0–10,000). */
  hhi: number;
  level: IntelligenceLevel;
  explanation: string;
}

export interface DestinationIntelligence {
  /** Descriptive: where India currently exports this product — not a "best markets" recommendation. */
  destinations: DestinationMetric[];
  concentration: ExportConcentration;
  confidence: number;
}

export type RiskSignalKey =
  | "demand"
  | "competition"
  | "compliance"
  | "logistics"
  | "supply"
  | "seasonality"
  | "capital"
  | "margin";

export interface RiskSignal {
  key: RiskSignalKey;
  label: string;
  /** 0–100, always "higher = more favorable". */
  score: number;
  /** Human status, e.g. "High demand", "Moderate competition", "Complex". */
  status: string;
  level: IntelligenceLevel | CompetitionLevel | ComplianceDifficulty;
  explanation: string;
  confidence: number;
}

export interface ProductRiskBreakdown {
  signals: RiskSignal[];
  capitalIntensity: IntelligenceLevel;
  /** Indicative dataset signal only — not actual profitability (full costing is a later module). */
  indicativeMarginNote: string;
}

export interface OpportunityScoreComponent {
  key: string;
  label: string;
  weight: number;
  score: number;
}

export interface ProductOpportunityScore {
  score: number;
  components: OpportunityScoreComponent[];
  strengths: string[];
  risks: string[];
}

export interface ProductIntelligence {
  product: ProductSummary;
  status: "AVAILABLE";
  match: { level: IntelligenceMatchLevel; matchedCode: string; datasetLabel: string };
  source: SourceMetadata;
  opportunity: ProductOpportunityScore;
  /** Data confidence — separate from the opportunity score. */
  confidence: number;
  trend: ExportTrendIntelligence;
  seasonality: SeasonalityInsight;
  ecosystem: IndiaEcosystemIntelligence;
  markets: DestinationIntelligence;
  risk: ProductRiskBreakdown;
  /**
   * Sprint 9 per-section provenance: exportTrend, destinations, seasonality,
   * ecosystem, productSignals, opportunityScore. Real and demo sections are
   * labelled individually.
   */
  provenance: SectionProvenance;
  /** Contextual notes from the exporter profile; never changes the product score. */
  personalFit: string[];
  generatedAt: string;
}

export interface ProductIntelligenceUnavailable {
  product: ProductSummary;
  status: "CLASSIFICATION_REQUIRED" | "NO_DATA";
  message: string;
}

export type ProductIntelligenceResponse = ProductIntelligence | ProductIntelligenceUnavailable;

export interface ProductIntelligenceSummaryItem {
  productId: string;
  status: ProductIntelligenceStatus;
  opportunityScore: number | null;
  confidence: number | null;
}
