import {
  CAGRMetric,
  IntelligenceLevel,
  SeasonalityLevel,
} from '@exportpro/types';
import { TradePeriodValue } from './providers/product-trade-data.provider';

const round1 = (n: number) => Math.round(n * 10) / 10;
export const clamp = (n: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, n));

/** (current − previous) / previous × 100. Null when previous is missing, zero or negative. */
export function yoyGrowth(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined
  )
    return null;
  if (previous <= 0 || current < 0) return null;
  return round1(((current - previous) / previous) * 100);
}

/**
 * CAGR between the first and last valid (positive) yearly values:
 * (last / first)^(1 / years) − 1. Requires ≥3 valid points spanning ≥2
 * years, otherwise "unavailable" rather than a misleading figure.
 */
export function cagr(points: TradePeriodValue[]): CAGRMetric {
  const valid = points
    .filter((p) => /^\d{4}$/.test(p.period) && p.value > 0)
    .sort((a, b) => a.period.localeCompare(b.period));
  if (valid.length < 3) {
    return {
      available: false,
      valuePercent: null,
      fromPeriod: null,
      toPeriod: null,
      years: null,
      reason: 'At least 3 years of data are needed for CAGR.',
    };
  }
  const first = valid[0];
  const last = valid[valid.length - 1];
  const years = Number(last.period) - Number(first.period);
  if (years < 2) {
    return {
      available: false,
      valuePercent: null,
      fromPeriod: null,
      toPeriod: null,
      years: null,
      reason: 'The data spans less than 2 years.',
    };
  }
  const value = (Math.pow(last.value / first.value, 1 / years) - 1) * 100;
  return {
    available: true,
    valuePercent: round1(value),
    fromPeriod: first.period,
    toPeriod: last.period,
    years,
    reason: null,
  };
}

/** Herfindahl–Hirschman Index on % shares (0–10,000). */
export function hhi(shares: number[]): number {
  return Math.round(shares.reduce((sum, s) => sum + s * s, 0));
}

/** Standard HHI bands: <1,500 unconcentrated, 1,500–2,500 moderate, >2,500 high. */
export function hhiLevel(value: number): IntelligenceLevel {
  if (value < 1500) return 'LOW';
  if (value <= 2500) return 'MODERATE';
  return 'HIGH';
}

export const sumTop = (shares: number[], n: number) =>
  round1(
    [...shares]
      .sort((a, b) => b - a)
      .slice(0, n)
      .reduce((s, v) => s + v, 0),
  );

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const QUARTERS = [
  'Jan–Mar (Q1)',
  'Apr–Jun (Q2)',
  'Jul–Sep (Q3)',
  'Oct–Dec (Q4)',
];

export interface SeasonalityResult {
  available: boolean;
  level: SeasonalityLevel | null;
  strongestMonths: string[];
  weakestMonths: string[];
  strongestQuarter: string | null;
  weakestQuarter: string | null;
  peakQuarterSharePercent: number | null;
  monthsOfData: number;
  coefficientOfVariation: number | null;
}

/**
 * Seasonality from monthly data only (≥12 months covering every calendar
 * month). Level from the coefficient of variation of average monthly
 * share: <0.15 LOW, <0.30 MODERATE, otherwise HIGH.
 */
export function seasonality(monthly: TradePeriodValue[]): SeasonalityResult {
  const empty: SeasonalityResult = {
    available: false,
    level: null,
    strongestMonths: [],
    weakestMonths: [],
    strongestQuarter: null,
    weakestQuarter: null,
    peakQuarterSharePercent: null,
    monthsOfData: monthly.length,
    coefficientOfVariation: null,
  };
  const byYear = new Map<string, number[]>();
  for (const p of monthly) {
    const m = /^(\d{4})-(\d{2})$/.exec(p.period);
    if (!m) continue;
    const arr = byYear.get(m[1]) ?? new Array(12).fill(NaN);
    arr[Number(m[2]) - 1] = p.value;
    byYear.set(m[1], arr);
  }
  // Only complete calendar years, expressed as shares so growth between years doesn't distort the profile.
  const years = [...byYear.values()].filter((arr) =>
    arr.every((v) => Number.isFinite(v) && v >= 0),
  );
  if (years.length === 0) return empty;
  const shares = years.map((arr) => {
    const total = arr.reduce((s, v) => s + v, 0);
    return arr.map((v) => (total > 0 ? v / total : 0));
  });
  const avg = MONTH_NAMES.map(
    (_, i) => shares.reduce((s, yr) => s + yr[i], 0) / shares.length,
  );
  const mean = 1 / 12;
  const cv =
    Math.sqrt(avg.reduce((s, v) => s + (v - mean) ** 2, 0) / 12) / mean;
  const level: SeasonalityLevel =
    cv < 0.15 ? 'LOW' : cv < 0.3 ? 'MODERATE' : 'HIGH';
  const order = avg
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v || a.i - b.i);
  const quarters = [0, 1, 2, 3].map((q) =>
    avg.slice(q * 3, q * 3 + 3).reduce((s, v) => s + v, 0),
  );
  const qMax = quarters.indexOf(Math.max(...quarters));
  const qMin = quarters.indexOf(Math.min(...quarters));
  return {
    available: true,
    level,
    strongestMonths: order.slice(0, 3).map((o) => MONTH_NAMES[o.i]),
    weakestMonths: order
      .slice(-3)
      .reverse()
      .map((o) => MONTH_NAMES[o.i]),
    strongestQuarter: QUARTERS[qMax],
    weakestQuarter: QUARTERS[qMin],
    peakQuarterSharePercent: round1(quarters[qMax] * 100),
    monthsOfData: years.length * 12,
    coefficientOfVariation: Math.round(cv * 1000) / 1000,
  };
}

/** India export-strength score from latest annual value on a log scale: $1M→20, $10M→45, $100M→70, $1B→95. */
export function exportStrengthScore(latestValueUsd: number): number {
  if (latestValueUsd <= 0) return 0;
  return Math.round(clamp((Math.log10(latestValueUsd) - 6) * 25 + 20));
}

/** Product Opportunity Score weights (sum 100) — see ARCHITECTURE.md "Product Intelligence". */
export const OPPORTUNITY_WEIGHTS = {
  demand: 20,
  exportGrowth: 15,
  indiaStrength: 15,
  competition: 10,
  compliance: 10,
  logistics: 10,
  supply: 10,
  margin: 5,
  seasonality: 5,
} as const;

export type OpportunityComponents = Record<
  keyof typeof OPPORTUNITY_WEIGHTS,
  number
>;

export function weightedOpportunityScore(c: OpportunityComponents): number {
  const total = (
    Object.keys(OPPORTUNITY_WEIGHTS) as (keyof OpportunityComponents)[]
  ).reduce((sum, k) => sum + c[k] * OPPORTUNITY_WEIGHTS[k], 0);
  return Math.round(total / 100);
}

/** Bucket a "higher = better" score into a favorability level (HIGH = favorable). */
export function favorability(score: number): IntelligenceLevel {
  if (score >= 67) return 'HIGH';
  if (score >= 40) return 'MODERATE';
  return 'LOW';
}
