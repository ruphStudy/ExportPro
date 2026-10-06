import { FreshnessStatus, InvestmentRange } from '@exportpro/types';
import { RawOpportunityMetrics } from '../scoring.service';

export interface OpportunityCandidate {
  productName: string;
  productCategoryCode: string;
  destinationCountryCode: string;
  raw: RawOpportunityMetrics;
  investmentRange: InvestmentRange;
  sourceType: 'DEMO'; // only value any provider may emit until Sprint 9 — see ARCHITECTURE.md
  sourceName: string;
  sourceUrl: string | null;
  sourceDate: Date;
  freshnessStatus: FreshnessStatus;
}

/**
 * A data provider turns "product × country" candidates into raw
 * metrics for the scoring engine. Sprint 9's real trade-data ingestion
 * implements this same interface — nothing in ScoringService or
 * OpportunitiesService needs to change when that lands, per
 * ARCHITECTURE.md "Data Refresh Architecture".
 */
export interface OpportunityDataProvider {
  generate(): OpportunityCandidate[];
}
