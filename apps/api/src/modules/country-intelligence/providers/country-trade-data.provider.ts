import type {
  CertificationItem,
  DataProvenance,
  GuidanceItem,
  IntelligenceLevel,
  OpportunitySourceType,
  TradeBarrierSignal,
} from '@exportpro/types';
import type { TradePeriodValue } from '../../product-intelligence/providers/product-trade-data.provider';

export const COUNTRY_TRADE_DATA_PROVIDER = Symbol(
  'COUNTRY_TRADE_DATA_PROVIDER',
);

export interface CountryProfile {
  countryCode: string;
  /** 0–100, higher = lower political/economic/payment risk. */
  riskScore: number;
  /** 0–100, higher = more stable currency. */
  currencyStability: number;
  /** 0–100, higher = easier to reach from India. */
  logisticsBase: number;
  majorPorts: string[];
  seaTransit: string;
  airSuitability: string;
  routeComplexity: IntelligenceLevel;
  notes: string[];
}

export interface ProductCountryMarket {
  productCode: string;
  countryCode: string;
  currency: string;
  quantityUnit: string | null;
  /** Destination's total imports of the product. Yearly only unless the source has monthly. */
  yearly: TradePeriodValue[];
  monthly: TradePeriodValue[];
  indiaSharePercent: number;
  indiaSharePreviousPercent: number | null;
  indiaRank: number | null;
  competitors: {
    countryCode: string;
    sharePercent: number;
    growthPercent: number | null;
  }[];
  tariff: {
    appliedRatePercent: number;
    preferentialRatePercent: number | null;
    preferentialScheme: string | null;
    tariffType: string;
    effectiveDate: string;
  } | null;
  barriers: TradeBarrierSignal[];
  unitValue: { current: number; previous: number | null; unit: string } | null;
  packaging: GuidanceItem[];
  labeling: GuidanceItem[];
  certifications: CertificationItem[];
  /**
   * Sprint 9: set when destination-reported import facts replaced market
   * size, import trend, India share, competitors and (when quantities are
   * in kg) unit value. Tariffs, barriers, guidance and risk stay sample.
   */
  realTrade?: { provenance: DataProvenance; pricingReal: boolean };
  /** Source-quality input for confidence when it differs from the dataset default (mixed sources). */
  sourceQuality?: number;
}

export interface CountryDatasetSource {
  sourceType: OpportunitySourceType;
  sourceName: string;
  sourceUrl: string | null;
  sourceDate: string;
  lastUpdatedAt: string;
  quality: number;
  datasetVersion: string;
}

/**
 * Country / product-country market data. Sprint 9 implementations
 * (UN Comtrade, tariff databases, World Bank/IMF risk, logistics data)
 * return this same shape; CountryIntelligenceService never changes.
 */
export interface CountryTradeDataProvider {
  readonly source: CountryDatasetSource;
  countryProfile(countryCode: string): CountryProfile | null;
  supportedCountries(): string[];
  marketsForProduct(productCode: string): ProductCountryMarket[];
  marketsForCountry(countryCode: string): ProductCountryMarket[];
  market(productCode: string, countryCode: string): ProductCountryMarket | null;
}
