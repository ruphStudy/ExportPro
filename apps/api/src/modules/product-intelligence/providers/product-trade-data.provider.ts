import {
  CodeSystem,
  DataProvenance,
  IntelligenceLevel,
  OpportunitySourceType,
} from '@exportpro/types';

export const PRODUCT_TRADE_DATA_PROVIDER = Symbol(
  'PRODUCT_TRADE_DATA_PROVIDER',
);

export interface TradePeriodValue {
  period: string; // "2025" or "2025-03"
  value: number;
  quantity: number | null;
}

/**
 * Normalized trade dataset for one product code. Shares are % of India's
 * total for the product. A real Sprint 9 pipeline (DGCI&S / Department
 * of Commerce / UN Comtrade / customs) produces this same shape, so
 * ProductIntelligenceService never changes when the provider does.
 */
export interface ProductTradeDataset {
  datasetKey: string;
  datasetVersion: string;
  codeSystem: CodeSystem;
  code: string;
  label: string;
  categoryCode: string;
  currency: string;
  quantityUnit: string | null;
  yearly: TradePeriodValue[];
  /** Absent when the source has no monthly resolution. */
  monthly: TradePeriodValue[];
  /**
   * Sprint 9: set when real normalized trade facts replaced the export
   * trend + destinations. Other sections stay on the sample dataset.
   */
  realTrade?: { provenance: DataProvenance };
  /** Sample monthly profile kept only for seasonality when the real trend is annual-only. */
  seasonalityMonthly?: TradePeriodValue[];
  states: { stateCode: string; sharePercent: number }[];
  /** Absent when the source has no district resolution. */
  districts: { district: string; stateCode: string; sharePercent: number }[];
  ports: { portName: string; stateCode: string; sharePercent: number }[];
  destinations: {
    countryCode: string;
    sharePercent: number;
    growthPercent: number | null;
  }[];
  /** Dataset-level qualitative signals, 0–100 "higher = more favorable". */
  signals: {
    competition: number;
    complianceEase: number;
    logisticsEase: number;
    marginPotential: number;
    capitalIntensity: IntelligenceLevel;
    perishable: boolean;
  };
  source: {
    sourceType: OpportunitySourceType;
    sourceName: string;
    sourceUrl: string | null;
    sourceDate: string;
    lastUpdatedAt: string;
    /** 0–100 quality of the source itself (official > partner > sample). */
    quality: number;
  };
}

export interface TradeDatasetQuery {
  codeSystem: CodeSystem;
  classificationCode: string;
  hsCode: string;
}

export interface TradeDatasetMatch {
  dataset: ProductTradeDataset;
  level: 'ITC_HS' | 'HS_SUBHEADING' | 'HS_HEADING';
  matchedCode: string;
}

/**
 * Code-based lookup only: ITC-HS line → HS subheading → HS heading. No
 * loose product-name matching — a saved product always has a confirmed code.
 */
export interface ProductTradeDataProvider {
  readonly name: string;
  find(query: TradeDatasetQuery): TradeDatasetMatch | null;
}
