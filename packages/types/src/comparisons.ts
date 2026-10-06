import type { PaginationMeta } from "./api";
import type { CountryMeta } from "./countries";
import type { PersonalFit } from "./country-intelligence";
import type { FreshnessStatus } from "./enums";
import type { SourceMetadata } from "./product-intelligence";
import type { ProductSummary } from "./products";

/**
 * Sprint 8: comparison + personalized recommendations. A thin layer over
 * Sprint 6 (product) and Sprint 7 (market) intelligence — base scores are
 * consumed as-is; personal fit and recommendation rank are separate values.
 */

// --- Personal fit -----------------------------------------------------------

export type PersonalFitComponentKey =
  | "budget"
  | "experience"
  | "category"
  | "targetCountry"
  | "risk"
  | "logistics"
  | "margin"
  | "readiness";

export interface PersonalFitComponent {
  key: PersonalFitComponentKey;
  label: string;
  /** Points earned out of `max`. */
  points: number;
  max: number;
  /** False when the profile lacks the input; a neutral midpoint is used instead. */
  inputAvailable: boolean;
}

export interface RecommendationReason {
  text: string;
  component: PersonalFitComponentKey | "market" | "product";
}

export interface RecommendationWarning {
  text: string;
  component: PersonalFitComponentKey | "market" | "product" | "data";
}

export interface PersonalFitResult {
  /** 0–100. Never feeds back into base opportunity scores. */
  score: number;
  components: PersonalFitComponent[];
  reasons: RecommendationReason[];
  cautions: RecommendationWarning[];
}

export interface RecommendationProfile {
  completenessPercent: number;
  missingInputs: string[];
  /** Export timeline is not collected in the current profile, so it does not contribute. */
  timelineAvailable: false;
}

// --- Comparison -------------------------------------------------------------

export type ComparisonMetricKey =
  | "opportunity"
  | "personalFit"
  | "demand"
  | "growth"
  | "indiaPresence"
  | "competition"
  | "compliance"
  | "investment"
  | "margin"
  | "logistics"
  | "seasonality"
  | "tariff"
  | "marketEntry"
  | "countryRisk"
  | "currencyRisk"
  | "confidence";

/** One cell. `score` is 0–100 favorable (higher = better); null = unavailable (never coerced to 0). */
export interface ComparisonMetric {
  key: ComparisonMetricKey;
  score: number | null;
  label: string;
}

export interface ComparisonRow {
  key: ComparisonMetricKey;
  label: string;
  description: string;
  /** Item ids holding the highest / lowest available value (ties included). Empty when not comparable. */
  bestIds: string[];
  worstIds: string[];
}

export interface ComparisonSummary {
  headline: string | null;
  bestItemId: string | null;
  reasons: string[];
  tradeOffs: string[];
  note: string;
}

export interface ComparisonSourceInfo {
  sourceName: string;
  isSample: boolean;
  /** True when real trade statistics back the trade sections (other sections may still be sample). */
  realTradeData: boolean;
  freshness: FreshnessStatus;
  sourceDate: string;
}

export interface ProductComparisonRequest {
  productIds: string[];
}

export interface ProductComparisonItem {
  id: string;
  product: ProductSummary;
  status: "AVAILABLE" | "CLASSIFICATION_REQUIRED" | "NO_DATA";
  message: string | null;
  metrics: ComparisonMetric[];
  personalFit: PersonalFitResult | null;
  strengths: string[];
  risks: string[];
  source: ComparisonSourceInfo | null;
  confidence: number | null;
}

export interface ProductComparisonResponse {
  items: ProductComparisonItem[];
  rows: ComparisonRow[];
  summary: ComparisonSummary;
  profile: RecommendationProfile;
}

export interface MarketComparisonRequest {
  productId: string;
  countryCodes: string[];
}

export interface MarketComparisonItem {
  id: string;
  country: CountryMeta;
  status: "AVAILABLE" | "NOT_SUPPORTED";
  metrics: ComparisonMetric[];
  /** Same shared personal-fit calculation as Best Markets. */
  personalFit: PersonalFit | null;
  routeComplexity: string | null;
  tariffAvailable: boolean;
  reasons: string[];
  risks: string[];
  source: ComparisonSourceInfo | null;
  confidence: number | null;
}

export interface MarketComparisonResponse {
  product: ProductSummary;
  status: "AVAILABLE" | "CLASSIFICATION_REQUIRED" | "NO_DATA";
  message: string | null;
  items: MarketComparisonItem[];
  rows: ComparisonRow[];
  summary: ComparisonSummary;
  availableCountries: CountryMeta[];
  profile: RecommendationProfile;
}

// --- Recommendations --------------------------------------------------------

export type RecommendationGroupKey =
  | "bestOverall"
  | "beginners"
  | "withinBudget"
  | "targetMarkets"
  | "lowerRisk"
  | "highGrowth";

export interface RecommendationNextAction {
  label: string;
  href: string;
  kind: "MARKET_ANALYSIS" | "ANALYZE_PRODUCT" | "EXPORT_SETUP" | "PRODUCT_INTELLIGENCE";
}

export interface PersonalizedRecommendation {
  id: string;
  productCode: string;
  productLabel: string;
  categoryCode: string;
  country: CountryMeta;
  /** Sprint 7 market opportunity score — unchanged by personalization. */
  baseOpportunityScore: number;
  /** Sprint 6 product-level score for context — unchanged by personalization. */
  productOpportunityScore: number | null;
  personalFit: PersonalFitResult;
  /** Ranking value only: 70% base opportunity + 30% personal fit. */
  recommendationScore: number;
  rank: number;
  confidence: number;
  countryRiskLevel: string;
  marketEntry: string;
  isTargetMarket: boolean;
  withinBudget: boolean;
  /** Readiness gaps to fix first (from Sprint 3 readiness). */
  fixFirst: string[];
  nextAction: RecommendationNextAction;
  savedProductId: string | null;
  /** True when real import statistics back this market (tariffs/risk may still be sample). */
  realTradeData: boolean;
  /** Matching Sprint 4 opportunity for watchlist save, if one exists. */
  opportunity: { id: string; isSaved: boolean } | null;
  groups: RecommendationGroupKey[];
}

export interface RecommendationFilters {
  category?: string;
  country?: string;
  risk?: "LOW" | "MODERATE" | "HIGH";
  budgetFit?: boolean;
  group?: RecommendationGroupKey;
  page?: number;
  pageSize?: number;
}

export interface RecommendationsResponse {
  items: PersonalizedRecommendation[];
  meta: PaginationMeta;
  groups: { key: RecommendationGroupKey; label: string; count: number; topIds: string[] }[];
  profile: RecommendationProfile;
  rankingFormula: string;
  weights: { key: PersonalFitComponentKey; label: string; max: number }[];
  source: SourceMetadata;
  disclaimer: string;
}
