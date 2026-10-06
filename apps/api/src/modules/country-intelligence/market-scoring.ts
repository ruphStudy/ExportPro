import type {
  CAGRMetric,
  IntelligenceLevel,
  MarketEntryDifficulty,
  MarketScoreComponents,
} from '@exportpro/types';
import {
  cagr,
  clamp,
  hhi,
  yoyGrowth,
} from '../product-intelligence/intelligence-calculations';
import type {
  CountryProfile,
  ProductCountryMarket,
} from './providers/country-trade-data.provider';

/**
 * Market Opportunity Score weights (sum 100). Scope: the deeper Sprint 7
 * product × country market score. Sprint 4's discovery score is a lighter
 * screening score and is shown alongside, never merged.
 */
export const MARKET_WEIGHTS: Record<keyof MarketScoreComponents, number> = {
  demand: 20,
  growth: 15,
  indiaPresence: 15,
  tariff: 10,
  competition: 10,
  logistics: 10,
  marketSize: 10,
  countryRisk: 5,
  currency: 5,
};

export const MARKET_COMPONENT_LABELS: Record<
  keyof MarketScoreComponents,
  string
> = {
  demand: 'Import demand',
  growth: 'Import growth',
  indiaPresence: 'India presence',
  tariff: 'Tariff attractiveness',
  competition: 'Competition attractiveness',
  logistics: 'Logistics suitability',
  marketSize: 'Addressable market size',
  countryRisk: 'Country risk (lower is better)',
  currency: 'Currency stability',
};

/** Log scale for USD values: $1M→25, $10M→47, $100M→69, $1B→91. */
export const valueScale = (usd: number) =>
  usd <= 0 ? 0 : Math.round(clamp((Math.log10(usd) - 6) * 22 + 25));

export const levelFromFavorable = (score: number): IntelligenceLevel =>
  score >= 67 ? 'LOW' : score >= 40 ? 'MODERATE' : 'HIGH';

export interface ScoredMarket {
  components: MarketScoreComponents;
  score: number;
  confidence: number;
  tariffAvailable: boolean;
  effectiveTariff: number | null;
  cagr: CAGRMetric;
  latestYoy: number | null;
  latestValue: number;
  competitionLevel: IntelligenceLevel;
  aboveIndiaShare: number;
  supplierHhi: number;
  complianceEase: number;
  entryEase: number;
  entry: MarketEntryDifficulty;
  reasons: string[];
  risks: string[];
}

const BARRIER_WEIGHT: Record<IntelligenceLevel, number> = {
  HIGH: 25,
  MODERATE: 12,
  LOW: 4,
};

/**
 * Deterministic market score for one product × country pair. All inputs
 * normalized 0–100 with higher = better (tariff, competition and risk are
 * inverted). `productLogisticsEase` is the Sprint 6 product-level signal.
 */
export function scoreMarket(
  m: ProductCountryMarket,
  country: CountryProfile,
  productLogisticsEase: number | null,
  sourceQuality: number,
  freshnessScore: number,
): ScoredMarket {
  const yearly = [...m.yearly].sort((a, b) => a.period.localeCompare(b.period));
  const latest = yearly[yearly.length - 1];
  const prev = yearly.length > 1 ? yearly[yearly.length - 2] : null;
  const growthMetric = cagr(yearly);
  const g = growthMetric.valuePercent ?? 0;
  const latestYoy = prev ? yoyGrowth(latest.value, prev.value) : null;

  const shareChange =
    m.indiaSharePreviousPercent === null
      ? 0
      : m.indiaSharePercent - m.indiaSharePreviousPercent;
  const effectiveTariff = m.tariff
    ? (m.tariff.preferentialRatePercent ?? m.tariff.appliedRatePercent)
    : null;
  const aboveIndia = m.competitors
    .filter((x) => x.sharePercent > m.indiaSharePercent)
    .reduce((s, x) => s + x.sharePercent, 0);
  const topCompetitor = Math.max(
    0,
    ...m.competitors.map((x) => x.sharePercent),
  );

  const components: MarketScoreComponents = {
    demand: valueScale(latest.value),
    growth: Math.round(clamp(50 + g * 3)),
    indiaPresence: Math.round(
      clamp(
        m.indiaSharePercent * 1.6 +
          (shareChange > 0.5 ? 5 : shareChange < -0.5 ? -5 : 0),
      ),
    ),
    // Missing tariff → neutral 50 (flagged as unavailable and lowers confidence), never a guessed rate.
    tariff:
      effectiveTariff === null
        ? 50
        : Math.round(clamp(100 - effectiveTariff * 3.5)),
    competition: Math.round(
      clamp(
        100 -
          0.3 * (100 - m.indiaSharePercent) -
          0.6 * aboveIndia -
          0.2 * topCompetitor,
      ),
    ),
    logistics: Math.round(
      productLogisticsEase === null
        ? country.logisticsBase
        : 0.6 * country.logisticsBase + 0.4 * productLogisticsEase,
    ),
    marketSize: valueScale(latest.value * (1 - m.indiaSharePercent / 100)),
    countryRisk: country.riskScore,
    currency: country.currencyStability,
  };
  const score = Math.round(
    (Object.keys(MARKET_WEIGHTS) as (keyof MarketScoreComponents)[]).reduce(
      (s, k) => s + components[k] * MARKET_WEIGHTS[k],
      0,
    ) / 100,
  );

  const complianceEase = Math.round(
    clamp(
      100 -
        m.barriers
          .filter((x) => x.type !== 'TARIFF')
          .reduce((s, x) => s + BARRIER_WEIGHT[x.level], 0),
    ),
  );
  const entryEase = Math.round(
    (components.tariff +
      complianceEase +
      components.competition +
      components.logistics +
      components.countryRisk +
      components.indiaPresence) /
      6,
  );
  const entry: MarketEntryDifficulty =
    entryEase >= 65 ? 'EASY' : entryEase >= 45 ? 'MODERATE' : 'DIFFICULT';

  const completeness =
    ([
      m.tariff !== null,
      m.unitValue !== null,
      m.competitors.length >= 2,
      yearly.length >= 5,
    ].filter(Boolean).length /
      4) *
    100;
  const confidence = Math.round(
    Math.min(
      sourceQuality + 20,
      0.45 * sourceQuality + 0.2 * freshnessScore + 0.35 * completeness,
    ),
  );

  const reasons: string[] = [];
  const risks: string[] = [];
  if (components.demand >= 70) reasons.push('Strong import demand');
  if (g >= 6) reasons.push(`Fast demand growth (${g}% CAGR)`);
  if (m.indiaSharePercent >= 25)
    reasons.push(
      `India already has meaningful market share (${m.indiaSharePercent}%)`,
    );
  if (effectiveTariff !== null && effectiveTariff <= 5)
    reasons.push(
      `Competitive tariff position (${effectiveTariff}% illustrative)`,
    );
  if (components.logistics >= 75)
    reasons.push('Favorable logistics from India');
  if (shareChange > 0.5) reasons.push('India’s share is rising');

  if (components.competition < 40)
    risks.push('High competition from other supplier countries');
  if (effectiveTariff !== null && effectiveTariff >= 15)
    risks.push(`High tariff (${effectiveTariff}% illustrative)`);
  if (effectiveTariff === null) risks.push('Tariff data unavailable');
  if (country.riskScore < 50) risks.push('Higher country risk');
  if (country.currencyStability < 50) risks.push('Currency volatility');
  if (m.indiaSharePercent < 5)
    risks.push(`Low India presence (${m.indiaSharePercent}%)`);
  if (g < 0) risks.push(`Import demand declining (${g}% CAGR)`);
  if (components.logistics < 45) risks.push('Difficult logistics route');

  return {
    components,
    score,
    confidence,
    tariffAvailable: m.tariff !== null,
    effectiveTariff,
    cagr: growthMetric,
    latestYoy,
    latestValue: latest.value,
    competitionLevel: levelFromFavorable(components.competition),
    aboveIndiaShare: aboveIndia,
    supplierHhi: hhi(m.competitors.map((x) => x.sharePercent)),
    complianceEase,
    entryEase,
    entry,
    reasons,
    risks,
  };
}
