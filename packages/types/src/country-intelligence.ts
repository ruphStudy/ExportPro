import type { PaginationMeta } from "./api";
import type { CountryMeta } from "./countries";
import type { CAGRMetric, IntelligenceLevel, IntelligenceMatchLevel, SourceMetadata, TradeTrendPoint } from "./product-intelligence";
import type { ProductSummary } from "./products";
import type { SectionProvenance } from "./trade-data";

/**
 * Sprint 7 Country Intelligence contracts. Scores are 0–100, higher =
 * better opportunity (tariff/competition/risk are inverted before use).
 * Market data is global; personal fit is computed per organization and
 * never changes the base market score.
 */

/** Verification state for legally sensitive items. VERIFIED_SOURCE only for authoritative, verified data. */
export type MarketVerificationStatus = "DATASET_ONLY" | "INFORMATIONAL" | "PENDING_VERIFICATION" | "VERIFIED_SOURCE";

export type MarketEntryDifficulty = "EASY" | "MODERATE" | "DIFFICULT";

export interface MarketScoreComponents {
  demand: number;
  growth: number;
  indiaPresence: number;
  tariff: number;
  competition: number;
  logistics: number;
  marketSize: number;
  countryRisk: number;
  currency: number;
}

export interface MarketScoreComponentDetail {
  key: keyof MarketScoreComponents;
  label: string;
  weight: number;
  score: number;
}

export interface PersonalFit {
  /** 0–100 relevance to this organization's profile — separate from the market score. */
  score: number;
  reasons: string[];
  cautions?: string[];
}

export interface MarketContext {
  isTargetMarket: boolean;
  isCurrentExportMarket: boolean;
}

export interface ScoreChange {
  previousScore: number | null;
  delta: number | null;
  reasons: string[];
}

export interface CountryRiskInfo {
  /** Higher = lower risk. */
  countryRiskScore: number;
  countryRiskLevel: IntelligenceLevel;
  currency: string;
  /** Higher = more stable. */
  currencyStabilityScore: number;
  currencyRiskLevel: IntelligenceLevel;
  notes: string[];
}

/** One row of Product → Best Countries. */
export interface ProductMarketRanking {
  rank: number;
  country: CountryMeta;
  opportunityScore: number;
  confidence: number;
  components: MarketScoreComponents;
  tariffAvailable: boolean;
  countryRiskLevel: IntelligenceLevel;
  currencyRiskLevel: IntelligenceLevel;
  marketEntry: MarketEntryDifficulty;
  /** 0–100, higher = easier entry (composite behind `marketEntry`). */
  marketEntryEase: number;
  /** Indicative route complexity from India — not a freight rate. */
  routeComplexity: IntelligenceLevel;
  /** True when real import statistics (Sprint 9) are layered into this market. */
  realTradeData: boolean;
  reasons: string[];
  risks: string[];
  personalFit: PersonalFit | null;
  context: MarketContext;
}

export type MarketIntelligenceUnavailableStatus = "CLASSIFICATION_REQUIRED" | "NO_DATA" | "COUNTRY_NOT_SUPPORTED";

export interface ProductMarketsResponse {
  product: ProductSummary;
  status: "AVAILABLE" | MarketIntelligenceUnavailableStatus;
  message: string | null;
  match: { level: IntelligenceMatchLevel; matchedCode: string; datasetLabel: string } | null;
  source: SourceMetadata | null;
  items: ProductMarketRanking[];
  meta: PaginationMeta;
  regions: string[];
}

export interface ProductMarketsQuery {
  region?: string;
  minScore?: number;
  sort?: "OPPORTUNITY" | "DEMAND" | "GROWTH" | "TARIFF" | "COMPETITION" | "LOGISTICS" | "RISK";
  page?: number;
  pageSize?: number;
}

/** One row of Country → Best Products. Global — no saved product needed. */
export interface CountryProductRanking {
  rank: number;
  productCode: string;
  productLabel: string;
  categoryCode: string;
  opportunityScore: number;
  confidence: number;
  components: MarketScoreComponents;
  indiaSharePercent: number;
  realTradeData: boolean;
  /** The org's saved product mapping to this code, if any (navigation only). */
  savedProductId: string | null;
  personalFit: PersonalFit | null;
}

export interface MarketCountrySummary {
  country: CountryMeta;
  supported: boolean;
  topScore: number | null;
  productCount: number;
  topProducts: string[];
  countryRiskLevel: IntelligenceLevel | null;
  context: MarketContext;
}

export interface CountryListResponse {
  items: MarketCountrySummary[];
  meta: PaginationMeta;
  regions: string[];
  source: SourceMetadata;
}

export interface CountryDetailResponse {
  country: CountryMeta;
  supported: boolean;
  context: MarketContext;
  source: SourceMetadata | null;
  confidence: number | null;
  attractiveness: number | null;
  risk: CountryRiskInfo | null;
  logistics: { score: number; level: IntelligenceLevel; majorPorts: string[]; seaTransit: string; airSuitability: string; notes: string[] } | null;
  products: CountryProductRanking[];
  meta: PaginationMeta;
}

export interface CompetingSupplier {
  rank: number;
  countryCode: string;
  sharePercent: number;
  indicativeValue: number | null;
  growthPercent: number | null;
}

export interface TariffInfo {
  available: boolean;
  appliedRatePercent: number | null;
  preferentialRatePercent: number | null;
  preferentialScheme: string | null;
  tariffType: string | null;
  effectiveDate: string | null;
  verification: MarketVerificationStatus;
  note: string;
}

export interface TradeBarrierSignal {
  type:
    | "TARIFF"
    | "QUOTA"
    | "LICENSING"
    | "IMPORT_REGISTRATION"
    | "CERTIFICATION"
    | "SPS"
    | "TECHNICAL_STANDARDS"
    | "CUSTOMS_COMPLEXITY";
  label: string;
  level: IntelligenceLevel;
  note: string;
  verification: MarketVerificationStatus;
}

export interface GuidanceItem {
  text: string;
  /** Separates common commercial practice from possible regulatory requirements. */
  kind: "COMMON_PRACTICE" | "POSSIBLE_REQUIREMENT";
  verification: MarketVerificationStatus;
}

export interface CertificationItem {
  name: string;
  status: "COMMONLY_REQUESTED" | "POTENTIALLY_REQUIRED" | "VERIFY_APPLICABILITY";
  note: string;
  verification: MarketVerificationStatus;
}

export interface MarketDeepAnalysis {
  product: ProductSummary;
  status: "AVAILABLE";
  country: CountryMeta;
  context: MarketContext;
  match: { level: IntelligenceMatchLevel; matchedCode: string; datasetLabel: string };
  source: SourceMetadata;
  opportunityScore: number;
  confidence: number;
  components: MarketScoreComponentDetail[];
  reasons: string[];
  risks: string[];
  personalFit: PersonalFit | null;
  scoreChange: ScoreChange;
  marketSize: { available: boolean; importValue: number | null; importQuantity: number | null; quantityUnit: string | null; period: string | null; currency: string };
  importTrend: { yearly: TradeTrendPoint[]; monthly: TradeTrendPoint[]; cagr: CAGRMetric; latestYoyPercent: number | null };
  indiaPosition: { sharePercent: number; previousSharePercent: number | null; shareChangePoints: number | null; rank: number | null; presenceLevel: IntelligenceLevel };
  competition: {
    score: number;
    level: IntelligenceLevel;
    suppliers: CompetingSupplier[];
    majorSupplierCount: number;
    supplierHhi: number;
    explanation: string;
  };
  tariff: TariffInfo;
  barriers: TradeBarrierSignal[];
  pricing: { available: boolean; unitValue: number | null; unit: string | null; previousUnitValue: number | null; changePercent: number | null; note: string };
  packaging: GuidanceItem[];
  labeling: GuidanceItem[];
  certifications: CertificationItem[];
  logistics: { score: number; level: IntelligenceLevel; destinationPorts: string[]; seaTransit: string; airSuitability: string; routeComplexity: IntelligenceLevel; notes: string[] };
  risk: CountryRiskInfo;
  marketEntry: { difficulty: MarketEntryDifficulty; easeScore: number; reasons: string[] };
  /** Sprint 6 product-level context (reused, not recomputed). */
  productIntelligence: { opportunityScore: number; confidence: number; indiaExportSharePercent: number | null } | null;
  /** Sprint 4 discovery score for the same product/country, if present — a lighter, different-scope score. */
  discovery: { opportunityId: string; overallScore: number } | null;
  regulatoryNotice: string;
  /** Per-section provenance (marketSize, importTrend, indiaPosition, competition, pricing, tariff, barriers, guidance, logistics, risk, score). */
  provenance: SectionProvenance;
}

export interface MarketAnalysisUnavailable {
  product: ProductSummary;
  status: MarketIntelligenceUnavailableStatus;
  country: CountryMeta | null;
  message: string;
}

export type MarketDeepAnalysisResponse = MarketDeepAnalysis | MarketAnalysisUnavailable;
