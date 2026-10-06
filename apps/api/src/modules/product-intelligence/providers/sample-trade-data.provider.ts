import {
  ProductTradeDataProvider,
  ProductTradeDataset,
  TradeDatasetMatch,
  TradeDatasetQuery,
  TradePeriodValue,
} from './product-trade-data.provider';

/**
 * Deterministic SAMPLE trade intelligence for a handful of Sprint 5
 * reference products. Hand-authored illustrative figures — NOT official
 * Indian export statistics — and stored with sourceType DEMO so every
 * screen labels them as sample data. Replaced by a Sprint 9 provider.
 */
const SAMPLE_SOURCE = {
  sourceType: 'DEMO' as const,
  sourceName:
    'ExportPro sample trade intelligence (illustrative, not official statistics)',
  sourceUrl: null,
  sourceDate: '2026-03-31',
  lastUpdatedAt: '2026-04-15',
  quality: 45,
};
const VERSION = 'sample-2026.1';

/** Spreads a yearly total over months using fixed weights (sum 100) — deterministic, no randomness. */
function monthsFrom(
  year: string,
  total: TradePeriodValue,
  weights: number[],
): TradePeriodValue[] {
  return weights.map((w, i) => ({
    period: `${year}-${String(i + 1).padStart(2, '0')}`,
    value: Math.round((total.value * w) / 100),
    quantity:
      total.quantity === null ? null : Math.round((total.quantity * w) / 100),
  }));
}

const y = (
  period: string,
  value: number,
  quantity: number | null,
): TradePeriodValue => ({ period, value, quantity });

const CUMIN_YEARS = [
  y('2021', 695e6, 216000),
  y('2022', 508e6, 186000),
  y('2023', 550e6, 148000),
  y('2024', 820e6, 230000),
  y('2025', 910e6, 255000),
];
// Post-harvest export peak (March–June).
const CUMIN_WEIGHTS = [4, 5, 12, 15, 13, 10, 7, 6, 6, 7, 7, 8];
const TSHIRT_YEARS = [
  y('2021', 1520e6, 690e6),
  y('2022', 1710e6, 760e6),
  y('2023', 1580e6, 705e6),
  y('2024', 1690e6, 742e6),
  y('2025', 1840e6, 800e6),
];
const TSHIRT_WEIGHTS = [8, 8, 9, 8, 8, 8, 8, 9, 9, 9, 8, 8];

const DATASETS: ProductTradeDataset[] = [
  {
    datasetKey: 'HS:090931',
    datasetVersion: VERSION,
    codeSystem: 'HS',
    code: '090931',
    label: 'Cumin seeds, neither crushed nor ground',
    categoryCode: 'SPICES',
    currency: 'USD',
    quantityUnit: 'MT',
    yearly: CUMIN_YEARS,
    monthly: [
      ...monthsFrom('2024', CUMIN_YEARS[3], CUMIN_WEIGHTS),
      ...monthsFrom('2025', CUMIN_YEARS[4], CUMIN_WEIGHTS),
    ],
    states: [
      { stateCode: 'GJ', sharePercent: 62 },
      { stateCode: 'RJ', sharePercent: 33 },
      { stateCode: 'MP', sharePercent: 3 },
      { stateCode: 'UP', sharePercent: 2 },
    ],
    districts: [
      { district: 'Mehsana (Unjha)', stateCode: 'GJ', sharePercent: 28 },
      { district: 'Banaskantha', stateCode: 'GJ', sharePercent: 14 },
      { district: 'Jodhpur', stateCode: 'RJ', sharePercent: 12 },
      { district: 'Barmer', stateCode: 'RJ', sharePercent: 10 },
      { district: 'Patan', stateCode: 'GJ', sharePercent: 9 },
      { district: 'Jalore', stateCode: 'RJ', sharePercent: 7 },
    ],
    ports: [
      { portName: 'Mundra', stateCode: 'GJ', sharePercent: 58 },
      { portName: 'Deendayal (Kandla)', stateCode: 'GJ', sharePercent: 22 },
      { portName: 'Nhava Sheva (JNPT)', stateCode: 'MH', sharePercent: 14 },
      { portName: 'Chennai', stateCode: 'TN', sharePercent: 6 },
    ],
    destinations: [
      { countryCode: 'CN', sharePercent: 18, growthPercent: 22.4 },
      { countryCode: 'BD', sharePercent: 14, growthPercent: 6.1 },
      { countryCode: 'US', sharePercent: 11, growthPercent: 9.8 },
      { countryCode: 'AE', sharePercent: 9, growthPercent: 4.2 },
      { countryCode: 'BR', sharePercent: 6, growthPercent: 12.5 },
      { countryCode: 'MY', sharePercent: 5, growthPercent: 3.1 },
      { countryCode: 'NP', sharePercent: 5, growthPercent: -2.4 },
      { countryCode: 'GB', sharePercent: 4, growthPercent: 5.0 },
      { countryCode: 'SA', sharePercent: 4, growthPercent: 7.7 },
      { countryCode: 'EG', sharePercent: 3, growthPercent: 1.9 },
    ],
    signals: {
      competition: 62,
      complianceEase: 58,
      logisticsEase: 76,
      marginPotential: 58,
      capitalIntensity: 'MODERATE',
      perishable: false,
    },
    source: SAMPLE_SOURCE,
  },
  {
    datasetKey: 'HS:610910',
    datasetVersion: VERSION,
    codeSystem: 'HS',
    code: '610910',
    label: 'T-shirts, singlets and other vests, knitted, of cotton',
    categoryCode: 'TEXTILES',
    currency: 'USD',
    quantityUnit: 'NOS',
    yearly: TSHIRT_YEARS,
    monthly: monthsFrom('2025', TSHIRT_YEARS[4], TSHIRT_WEIGHTS),
    states: [
      { stateCode: 'TN', sharePercent: 42 },
      { stateCode: 'KA', sharePercent: 12 },
      { stateCode: 'MH', sharePercent: 11 },
      { stateCode: 'GJ', sharePercent: 7 },
      { stateCode: 'PB', sharePercent: 7 },
      { stateCode: 'DL', sharePercent: 6 },
      { stateCode: 'UP', sharePercent: 6 },
      { stateCode: 'WB', sharePercent: 4 },
      { stateCode: 'RJ', sharePercent: 3 },
      { stateCode: 'HR', sharePercent: 2 },
    ],
    districts: [
      { district: 'Tiruppur', stateCode: 'TN', sharePercent: 34 },
      { district: 'Bengaluru Urban', stateCode: 'KA', sharePercent: 9 },
      { district: 'Ludhiana', stateCode: 'PB', sharePercent: 6 },
      { district: 'Mumbai', stateCode: 'MH', sharePercent: 5 },
    ],
    ports: [
      { portName: 'Chennai', stateCode: 'TN', sharePercent: 24 },
      { portName: 'Nhava Sheva (JNPT)', stateCode: 'MH', sharePercent: 21 },
      {
        portName: 'V.O. Chidambaranar (Tuticorin)',
        stateCode: 'TN',
        sharePercent: 18,
      },
      { portName: 'Mundra', stateCode: 'GJ', sharePercent: 14 },
      { portName: 'ICD Tughlakabad', stateCode: 'DL', sharePercent: 9 },
      { portName: 'Cochin', stateCode: 'KL', sharePercent: 8 },
      { portName: 'Kolkata', stateCode: 'WB', sharePercent: 6 },
    ],
    destinations: [
      { countryCode: 'US', sharePercent: 34, growthPercent: 7.2 },
      { countryCode: 'GB', sharePercent: 13, growthPercent: 3.4 },
      { countryCode: 'DE', sharePercent: 9, growthPercent: -1.8 },
      { countryCode: 'AE', sharePercent: 6, growthPercent: 8.9 },
      { countryCode: 'ES', sharePercent: 5, growthPercent: 2.1 },
      { countryCode: 'FR', sharePercent: 5, growthPercent: 1.5 },
      { countryCode: 'NL', sharePercent: 4, growthPercent: 4.6 },
      { countryCode: 'IT', sharePercent: 3, growthPercent: -0.7 },
    ],
    signals: {
      competition: 34,
      complianceEase: 70,
      logisticsEase: 80,
      marginPotential: 45,
      capitalIntensity: 'MODERATE',
      perishable: false,
    },
    source: SAMPLE_SOURCE,
  },
  {
    datasetKey: 'HS:140490',
    datasetVersion: VERSION,
    codeSystem: 'HS',
    code: '140490',
    label: 'Vegetable products n.e.s. (incl. areca palm leaf tableware)',
    categoryCode: 'HANDICRAFTS',
    currency: 'USD',
    quantityUnit: 'MT',
    yearly: [
      y('2021', 9.5e6, 5800),
      y('2022', 12.8e6, 7600),
      y('2023', 16.4e6, 9500),
      y('2024', 21.2e6, 11900),
      y('2025', 27.0e6, 14800),
    ],
    monthly: [],
    states: [
      { stateCode: 'KA', sharePercent: 71 },
      { stateCode: 'TN', sharePercent: 14 },
      { stateCode: 'KL', sharePercent: 9 },
      { stateCode: 'AS', sharePercent: 4 },
      { stateCode: 'MH', sharePercent: 2 },
    ],
    districts: [
      { district: 'Shivamogga', stateCode: 'KA', sharePercent: 31 },
      { district: 'Chikkamagaluru', stateCode: 'KA', sharePercent: 15 },
      { district: 'Dakshina Kannada', stateCode: 'KA', sharePercent: 14 },
      { district: 'Coimbatore', stateCode: 'TN', sharePercent: 8 },
    ],
    ports: [
      { portName: 'Chennai', stateCode: 'TN', sharePercent: 34 },
      { portName: 'New Mangalore', stateCode: 'KA', sharePercent: 31 },
      { portName: 'Cochin', stateCode: 'KL', sharePercent: 18 },
      { portName: 'Nhava Sheva (JNPT)', stateCode: 'MH', sharePercent: 17 },
    ],
    destinations: [
      { countryCode: 'US', sharePercent: 38, growthPercent: 31.0 },
      { countryCode: 'DE', sharePercent: 12, growthPercent: 24.5 },
      { countryCode: 'GB', sharePercent: 9, growthPercent: 18.2 },
      { countryCode: 'NL', sharePercent: 8, growthPercent: 27.9 },
      { countryCode: 'AU', sharePercent: 7, growthPercent: 35.4 },
      { countryCode: 'CA', sharePercent: 6, growthPercent: 22.0 },
      { countryCode: 'FR', sharePercent: 4, growthPercent: 15.3 },
      { countryCode: 'JP', sharePercent: 3, growthPercent: 12.1 },
    ],
    signals: {
      competition: 72,
      complianceEase: 74,
      logisticsEase: 62,
      marginPotential: 66,
      capitalIntensity: 'LOW',
      perishable: false,
    },
    source: SAMPLE_SOURCE,
  },
  {
    datasetKey: 'HS:392410',
    datasetVersion: VERSION,
    codeSystem: 'HS',
    code: '392410',
    label: 'Tableware and kitchenware, of plastics',
    categoryCode: 'PLASTICS',
    currency: 'USD',
    quantityUnit: 'MT',
    yearly: [
      y('2021', 410e6, 128000),
      y('2022', 445e6, 134000),
      y('2023', 398e6, 121000),
      y('2024', 372e6, 113000),
      y('2025', 351e6, 106000),
    ],
    monthly: [],
    states: [
      { stateCode: 'GJ', sharePercent: 28 },
      { stateCode: 'MH', sharePercent: 24 },
      { stateCode: 'DL', sharePercent: 10 },
      { stateCode: 'HR', sharePercent: 9 },
      { stateCode: 'TN', sharePercent: 8 },
      { stateCode: 'UP', sharePercent: 7 },
      { stateCode: 'KA', sharePercent: 6 },
      { stateCode: 'WB', sharePercent: 5 },
      { stateCode: 'TS', sharePercent: 3 },
    ],
    // No district resolution in this dataset (partial-data case).
    districts: [],
    ports: [
      { portName: 'Nhava Sheva (JNPT)', stateCode: 'MH', sharePercent: 33 },
      { portName: 'Mundra', stateCode: 'GJ', sharePercent: 31 },
      { portName: 'ICD Tughlakabad', stateCode: 'DL', sharePercent: 12 },
      { portName: 'Chennai', stateCode: 'TN', sharePercent: 10 },
      { portName: 'Kolkata', stateCode: 'WB', sharePercent: 8 },
      { portName: 'Deendayal (Kandla)', stateCode: 'GJ', sharePercent: 6 },
    ],
    destinations: [
      { countryCode: 'US', sharePercent: 19, growthPercent: -6.2 },
      { countryCode: 'AE', sharePercent: 11, growthPercent: 1.4 },
      { countryCode: 'GB', sharePercent: 7, growthPercent: -4.1 },
      { countryCode: 'SA', sharePercent: 6, growthPercent: 2.8 },
      { countryCode: 'DE', sharePercent: 5, growthPercent: -8.0 },
      { countryCode: 'NG', sharePercent: 5, growthPercent: 3.5 },
      { countryCode: 'KE', sharePercent: 4, growthPercent: 5.2 },
      { countryCode: 'ZA', sharePercent: 4, growthPercent: -1.0 },
      { countryCode: 'AU', sharePercent: 4, growthPercent: -3.3 },
      { countryCode: 'FR', sharePercent: 3, growthPercent: -5.6 },
    ],
    signals: {
      competition: 40,
      complianceEase: 68,
      logisticsEase: 70,
      marginPotential: 42,
      capitalIntensity: 'MODERATE',
      perishable: false,
    },
    source: SAMPLE_SOURCE,
  },
  {
    datasetKey: 'HS:850440',
    datasetVersion: VERSION,
    codeSystem: 'HS',
    code: '850440',
    label: 'Static converters (incl. LED drivers / power supplies)',
    categoryCode: 'ELECTRONICS',
    currency: 'USD',
    // Units differ across sub-products (pieces vs kg) — quantity not comparable, so not reported.
    quantityUnit: null,
    yearly: [
      y('2021', 610e6, null),
      y('2022', 720e6, null),
      y('2023', 905e6, null),
      y('2024', 1080e6, null),
      y('2025', 1310e6, null),
    ],
    monthly: [],
    states: [
      { stateCode: 'KA', sharePercent: 21 },
      { stateCode: 'TN', sharePercent: 18 },
      { stateCode: 'MH', sharePercent: 17 },
      { stateCode: 'UP', sharePercent: 16 },
      { stateCode: 'HR', sharePercent: 9 },
      { stateCode: 'DL', sharePercent: 8 },
      { stateCode: 'GJ', sharePercent: 6 },
      { stateCode: 'TS', sharePercent: 5 },
    ],
    districts: [],
    ports: [
      { portName: 'Chennai', stateCode: 'TN', sharePercent: 22 },
      { portName: 'Nhava Sheva (JNPT)', stateCode: 'MH', sharePercent: 20 },
      { portName: 'Bengaluru Air Cargo', stateCode: 'KA', sharePercent: 18 },
      { portName: 'Delhi Air Cargo', stateCode: 'DL', sharePercent: 16 },
      { portName: 'Mundra', stateCode: 'GJ', sharePercent: 10 },
      { portName: 'ICD Tughlakabad', stateCode: 'DL', sharePercent: 8 },
      { portName: 'Hyderabad Air Cargo', stateCode: 'TS', sharePercent: 6 },
    ],
    destinations: [
      { countryCode: 'US', sharePercent: 41, growthPercent: 26.3 },
      { countryCode: 'AE', sharePercent: 8, growthPercent: 14.0 },
      { countryCode: 'DE', sharePercent: 7, growthPercent: 11.2 },
      { countryCode: 'GB', sharePercent: 6, growthPercent: 9.4 },
      { countryCode: 'NL', sharePercent: 4, growthPercent: 18.8 },
      { countryCode: 'SG', sharePercent: 4, growthPercent: 6.5 },
      { countryCode: 'IT', sharePercent: 3, growthPercent: 4.2 },
      { countryCode: 'MX', sharePercent: 3, growthPercent: 21.7 },
    ],
    signals: {
      competition: 38,
      complianceEase: 52,
      logisticsEase: 86,
      marginPotential: 50,
      capitalIntensity: 'HIGH',
      perishable: false,
    },
    source: SAMPLE_SOURCE,
  },
];

export class SampleTradeDataProvider implements ProductTradeDataProvider {
  readonly name = 'sample';

  find(query: TradeDatasetQuery): TradeDatasetMatch | null {
    if (query.codeSystem === 'ITC_HS_INDIA') {
      const itc = DATASETS.find(
        (d) =>
          d.codeSystem === 'ITC_HS_INDIA' &&
          d.code === query.classificationCode,
      );
      if (itc) return { dataset: itc, level: 'ITC_HS', matchedCode: itc.code };
    }
    const hs = query.hsCode;
    if (hs.length >= 6) {
      const sub = DATASETS.find((d) => d.code === hs.slice(0, 6));
      if (sub)
        return { dataset: sub, level: 'HS_SUBHEADING', matchedCode: sub.code };
    }
    if (hs.length >= 4) {
      // Heading fallback only when exactly one dataset sits under it — never guess between subheadings.
      const under = DATASETS.filter((d) => d.code.startsWith(hs.slice(0, 4)));
      if (under.length === 1)
        return {
          dataset: under[0],
          level: 'HS_HEADING',
          matchedCode: under[0].code,
        };
    }
    return null;
  }
}
