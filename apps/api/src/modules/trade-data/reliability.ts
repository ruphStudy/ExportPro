import type {
  FreshnessStatus,
  SourceQualityTier,
  UpdateFrequency,
} from '@exportpro/types';

/** Expected publication cycle per update frequency, in days. */
const CYCLE_DAYS: Record<UpdateFrequency, number | null> = {
  DAILY: 1,
  MONTHLY: 31,
  QUARTERLY: 92,
  ANNUAL: 366,
  AD_HOC: null,
  STATIC: null,
};

/**
 * Source-aware freshness: age is measured from when the next period was
 * expected (period end + publication lag), relative to the source's own
 * cycle — annual statistics are not judged like daily feeds.
 * ≤1 cycle FRESH, ≤2 RECENT, ≤3 STALE, beyond VERY_STALE. Static
 * references are FRESH once loaded; unknown dates are UNKNOWN.
 */
export function computeFreshness(
  frequency: UpdateFrequency,
  latestPeriodEnd: Date | null,
  expectedLagDays: number,
  now = new Date(),
): FreshnessStatus {
  if (!latestPeriodEnd) return 'UNKNOWN';
  const cycle = CYCLE_DAYS[frequency];
  if (cycle === null) return frequency === 'STATIC' ? 'FRESH' : 'UNKNOWN';
  const availableFrom =
    latestPeriodEnd.getTime() + expectedLagDays * 86_400_000;
  const ageDays = (now.getTime() - availableFrom) / 86_400_000;
  if (ageDays <= cycle) return 'FRESH';
  if (ageDays <= 2 * cycle) return 'RECENT';
  if (ageDays <= 3 * cycle) return 'STALE';
  return 'VERY_STALE';
}

/** When the next period is expected to be published (scheduling metadata only — no scheduler). */
export function nextExpectedRefresh(
  frequency: UpdateFrequency,
  latestPeriodEnd: Date | null,
  expectedLagDays: number,
): Date | null {
  const cycle = CYCLE_DAYS[frequency];
  if (!latestPeriodEnd || cycle === null) return null;
  return new Date(
    latestPeriodEnd.getTime() + (cycle + expectedLagDays) * 86_400_000,
  );
}

export const QUALITY_SCORE: Record<SourceQualityTier, number> = {
  A: 100,
  B: 85,
  C: 70,
  D: 55,
  DEMO: 30,
};
export const FRESHNESS_SCORE: Record<FreshnessStatus, number> = {
  FRESH: 100,
  RECENT: 80,
  STALE: 50,
  VERY_STALE: 25,
  UNKNOWN: 30,
};

/**
 * Source confidence (0–100), deterministic:
 * 35% authority/quality tier + 25% freshness + 20% acceptance rate of the
 * latest run + 20% mapping success (1 − unresolved / accepted). With no run
 * yet, acceptance and mapping default to 50.
 */
export function sourceConfidence(input: {
  tier: SourceQualityTier;
  freshness: FreshnessStatus;
  fetched?: number;
  accepted?: number;
  unresolved?: number;
}): number {
  const acceptance = input.fetched
    ? (100 * (input.accepted ?? 0)) / input.fetched
    : 50;
  const mapping = input.accepted
    ? 100 * (1 - Math.min(1, (input.unresolved ?? 0) / input.accepted))
    : 50;
  return Math.round(
    0.35 * QUALITY_SCORE[input.tier] +
      0.25 * FRESHNESS_SCORE[input.freshness] +
      0.2 * acceptance +
      0.2 * mapping,
  );
}

/** Record/application confidence: source confidence scaled by how precisely the record matches the request (e.g. HS6 exact vs 4-digit heading). */
export function applicationConfidence(
  sourceConf: number,
  matchFactor: number,
): number {
  return Math.round(sourceConf * Math.max(0, Math.min(1, matchFactor)));
}

/** Run data-quality score (separate from authority): 60% acceptance + 30% mapping success + 10% schema consistency. */
export function runQualityScore(
  fetched: number,
  accepted: number,
  unresolved: number,
  schemaOk: boolean,
): number | null {
  if (fetched === 0) return null;
  const acceptance = accepted / fetched;
  const mapping = accepted ? 1 - Math.min(1, unresolved / accepted) : 0;
  return Math.round(60 * acceptance + 30 * mapping + (schemaOk ? 10 : 0));
}
