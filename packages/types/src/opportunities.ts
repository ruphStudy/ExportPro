import {
  CompetitionLevel,
  ComplianceDifficulty,
  FreshnessStatus,
  InvestmentRange,
  OpportunitySort,
  OpportunitySourceType,
  SeasonalityLevel,
  TradeDirection,
} from "./enums";
import type { PaginationMeta } from "./api";

export interface OpportunityScoreBreakdown {
  demand: number;
  indiaExports: number;
  growth: number;
  competition: number;
  compliance: number;
  logistics: number;
  margin: number;
  seasonality: number;
  marketDiversity: number;
}

export interface OpportunitySourceMetadata {
  sourceType: OpportunitySourceType;
  sourceName: string;
  sourceUrl: string | null;
  sourceDate: string;
  lastUpdatedAt: string;
  freshness: FreshnessStatus;
}

export interface ScoreExplanation {
  positives: string[];
  negatives: string[];
}

export interface OpportunityBadge {
  label: "Beginner Friendly" | "Fast Growing" | "Low Competition" | "High Margin Potential" | "Recommended";
}

export interface OpportunitySummary {
  id: string;
  productName: string;
  productCategoryCode: string;
  destinationCountryCode: string;
  tradeDirection: TradeDirection;
  overallScore: number;
  confidenceScore: number;
  competitionLevel: CompetitionLevel;
  complianceDifficulty: ComplianceDifficulty;
  seasonalityLevel: SeasonalityLevel;
  investmentRange: InvestmentRange;
  badges: OpportunityBadge["label"][];
  source: OpportunitySourceMetadata;
  /** Present only when returned within an authenticated org context with an exporter profile. */
  personalizedRelevance: number | null;
  scoreDelta: number | null;
  isSaved: boolean;
}

export interface OpportunityDetail extends OpportunitySummary {
  components: OpportunityScoreBreakdown;
  explanation: ScoreExplanation;
  personalizationReasons: string[];
  /** One line per component that moved by >=3 points since the previous snapshot — empty if there's no history yet. */
  scoreDeltaReasons: string[];
}

export interface OpportunityScoreSnapshotEntry {
  overallScore: number;
  components: OpportunityScoreBreakdown;
  confidence: number;
  capturedAt: string;
}

export interface OpportunitySearchFilters {
  search?: string;
  category?: string;
  country?: string;
  budget?: InvestmentRange;
  minMarginScore?: number;
  minGrowthScore?: number;
  competitionLevel?: CompetitionLevel;
  complianceDifficulty?: ComplianceDifficulty;
  sort?: OpportunitySort;
}

export interface OpportunitySearchRequest extends OpportunitySearchFilters {
  page?: number;
  pageSize?: number;
}

export interface OpportunitySearchResponse {
  items: OpportunitySummary[];
  meta: PaginationMeta;
}

export const DEMO_DATA_NOTICE =
  "Demo opportunity dataset — synthetic sample data, not official trade statistics.";

export interface OpportunityDiscoverySections {
  topOpportunities: OpportunitySummary[];
  trendingProducts: OpportunitySummary[];
  fastestGrowing: OpportunitySummary[];
  beginnerFriendly: OpportunitySummary[];
  lowCompetition: OpportunitySummary[];
  highPotentialMargin: OpportunitySummary[];
  recommendedForYou: OpportunitySummary[];
}

export interface OpportunityDiscoveryResponse {
  sections: OpportunityDiscoverySections;
  demoDataNotice: string;
}

export interface SavedOpportunity {
  id: string;
  opportunity: OpportunitySummary;
  savedByUserId: string;
  notes: string | null;
  createdAt: string;
}

export interface SaveOpportunityRequest {
  notes?: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: OpportunitySearchFilters;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedSearchRequest {
  name: string;
  query: OpportunitySearchFilters;
}

export type UpdateSavedSearchRequest = Partial<CreateSavedSearchRequest>;
