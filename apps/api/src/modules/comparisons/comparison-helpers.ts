import type {
  ComparisonMetric,
  ComparisonMetricKey,
  ComparisonRow,
  ComparisonSummary,
} from '@exportpro/types';

const lower = (s: string) => (s.startsWith('India') ? s : s.toLowerCase());

export const ADVISORY_NOTE =
  'Recommended based on current data and your profile — advisory decision support, not a guarantee.';

/** Best/worst per row across items with an available value. No highlight when values tie or fewer than two exist. */
export function buildRows(
  defs: { key: ComparisonMetricKey; label: string; description: string }[],
  items: { id: string; metrics: ComparisonMetric[] }[],
): ComparisonRow[] {
  return defs.map((d) => {
    const values = items
      .map((it) => ({
        id: it.id,
        score: it.metrics.find((m) => m.key === d.key)?.score ?? null,
      }))
      .filter((v): v is { id: string; score: number } => v.score !== null);
    if (values.length < 2) return { ...d, bestIds: [], worstIds: [] };
    const max = Math.max(...values.map((v) => v.score));
    const min = Math.min(...values.map((v) => v.score));
    if (max === min) return { ...d, bestIds: [], worstIds: [] };
    return {
      ...d,
      bestIds: values.filter((v) => v.score === max).map((v) => v.id),
      worstIds: values.filter((v) => v.score === min).map((v) => v.id),
    };
  });
}

/** Deterministic summary from the comparison rows (no AI). */
export function buildSummary(
  rows: ComparisonRow[],
  items: {
    id: string;
    name: string;
    metrics: ComparisonMetric[];
    extraStrengths: string[];
    extraRisks: string[];
  }[],
  noun: 'opportunity' | 'market',
  skip: ComparisonMetricKey[] = ['opportunity', 'confidence', 'personalFit'],
): ComparisonSummary {
  const scored = items
    .map((it) => ({
      ...it,
      score: it.metrics.find((m) => m.key === 'opportunity')?.score ?? null,
    }))
    .filter((it): it is typeof it & { score: number } => it.score !== null)
    .sort((a, b) => b.score - a.score);
  if (scored.length < 2) {
    return {
      headline: null,
      bestItemId: null,
      reasons: [],
      tradeOffs: [],
      note: 'At least two items with data are needed for a summary.',
    };
  }
  const best = scored[0];
  const lead = best.score - scored[1].score;
  const reasons = rows
    .filter((r) => !skip.includes(r.key) && r.bestIds.includes(best.id))
    .map(
      (r) =>
        `Best ${lower(r.label)} score among compared ${noun === 'market' ? 'markets' : 'products'}`,
    );
  const tradeOffs = rows
    .filter((r) => !skip.includes(r.key) && r.worstIds.includes(best.id))
    .map((r) => {
      const leader = items.find((it) => r.bestIds.includes(it.id));
      return `Least favorable ${lower(r.label)} score (best: ${leader?.name ?? 'others'})`;
    });
  return {
    headline: `Highest ${noun} score: ${best.name} (${best.score}/100${lead > 0 ? `, ${lead} points ahead` : ', tied'})`,
    bestItemId: best.id,
    reasons: [...reasons, ...best.extraStrengths.slice(0, 2)],
    tradeOffs: [...tradeOffs, ...best.extraRisks.slice(0, 2)],
    note: ADVISORY_NOTE,
  };
}

export const metric = (
  key: ComparisonMetricKey,
  score: number | null,
  label: string,
): ComparisonMetric => ({ key, score, label });
