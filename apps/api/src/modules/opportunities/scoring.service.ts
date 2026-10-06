import { Injectable } from '@nestjs/common';
import {
  CompetitionLevel,
  ComplianceDifficulty,
  FreshnessStatus,
  OpportunityScoreBreakdown,
  SeasonalityLevel,
} from '@exportpro/types';

/**
 * Raw, pre-normalization signals a data provider produces. Deliberately
 * separate from the persisted `Opportunity` row and from
 * `OpportunityScoreBreakdown` — see ARCHITECTURE.md "Data Refresh
 * Architecture": a future Sprint 9 government-data provider only has to
 * produce this shape, and the engine below is unchanged regardless of
 * where the numbers came from (seed script or real ingestion).
 */
export interface RawOpportunityMetrics {
  demandRaw: number; // 0-100, higher = more demand
  indiaExportRaw: number; // 0-100, higher = stronger existing Indian export presence
  growthPct: number; // signed % YoY, roughly -20..60
  competitionRaw: number; // 0-100, higher = MORE competitors (worse)
  complianceDifficultyRaw: number; // 0-100, higher = harder compliance (worse)
  logisticsComplexityRaw: number; // 0-100, higher = more complex logistics (worse)
  marginPct: number; // 0-60, indicative margin %
  seasonalityRaw: number; // 0-100, higher = more seasonal/volatile (worse)
  marketDiversityRaw: number; // 0-100, higher = demand spread across more markets
}

/** Sums to 1.0 — see ARCHITECTURE.md "Opportunity Scoring Engine". */
export const SCORE_WEIGHTS: Record<keyof OpportunityScoreBreakdown, number> = {
  demand: 0.2,
  indiaExports: 0.15,
  growth: 0.15,
  competition: 0.1,
  compliance: 0.1,
  logistics: 0.1,
  margin: 0.1,
  seasonality: 0.05,
  marketDiversity: 0.05,
};

const FRESHNESS_BASE_CONFIDENCE: Record<FreshnessStatus, number> = {
  FRESH: 85,
  RECENT: 70,
  STALE: 50,
  VERY_STALE: 35,
  UNKNOWN: 40,
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function invert(raw: number): number {
  return clamp(100 - raw);
}

/** Deterministic small integer in [-5, 5] from a string — avoids every demo row having an identical confidence. */
function deterministicJitter(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1)
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 11) - 5;
}

@Injectable()
export class ScoringService {
  computeComponents(raw: RawOpportunityMetrics): OpportunityScoreBreakdown {
    return {
      demand: clamp(raw.demandRaw),
      indiaExports: clamp(raw.indiaExportRaw),
      // -20%..60% YoY mapped linearly onto 0..100.
      growth: clamp(((raw.growthPct + 20) / 80) * 100),
      competition: invert(raw.competitionRaw),
      compliance: invert(raw.complianceDifficultyRaw),
      logistics: invert(raw.logisticsComplexityRaw),
      // 0%..60% indicative margin mapped linearly onto 0..100.
      margin: clamp((raw.marginPct / 60) * 100),
      seasonality: invert(raw.seasonalityRaw),
      marketDiversity: clamp(raw.marketDiversityRaw),
    };
  }

  computeOverallScore(components: OpportunityScoreBreakdown): number {
    const weighted = (
      Object.keys(SCORE_WEIGHTS) as (keyof OpportunityScoreBreakdown)[]
    ).reduce((sum, key) => sum + components[key] * SCORE_WEIGHTS[key], 0);
    return clamp(weighted);
  }

  /** Confidence reflects source freshness, never the business attractiveness of the opportunity itself. */
  computeConfidence(freshness: FreshnessStatus, seedKey: string): number {
    return clamp(
      FRESHNESS_BASE_CONFIDENCE[freshness] + deterministicJitter(seedKey),
    );
  }

  competitionLevel(competitionScore: number): CompetitionLevel {
    if (competitionScore >= 70) return 'LOW';
    if (competitionScore >= 40) return 'MODERATE';
    return 'HIGH';
  }

  complianceDifficulty(complianceScore: number): ComplianceDifficulty {
    if (complianceScore >= 70) return 'EASY';
    if (complianceScore >= 40) return 'MODERATE';
    return 'COMPLEX';
  }

  seasonalityLevel(seasonalityScore: number): SeasonalityLevel {
    if (seasonalityScore >= 70) return 'LOW';
    if (seasonalityScore >= 40) return 'MODERATE';
    return 'HIGH';
  }

  /** Deterministic, rule-based — never generative. See ARCHITECTURE.md "Score Explainability". */
  buildExplanation(c: OpportunityScoreBreakdown): {
    positives: string[];
    negatives: string[];
  } {
    const positives: string[] = [];
    const negatives: string[] = [];

    if (c.demand >= 75) positives.push('Strong recent demand signal');
    if (c.indiaExports >= 70)
      positives.push('India has meaningful export presence');
    if (c.growth >= 75) positives.push('High growth trend');
    if (c.marketDiversity >= 70) positives.push('Good market diversity');
    if (c.logistics >= 70) positives.push('Lower logistics complexity');
    if (c.competition >= 70) positives.push('Lower competition');
    if (c.margin >= 70) positives.push('Attractive indicative margin');

    if (c.competition < 40) negatives.push('High competition');
    if (c.compliance < 40)
      negatives.push('Compliance complexity is above average');
    if (c.seasonality < 40) negatives.push('Strong seasonality');
    if (c.margin < 40) negatives.push('Margin confidence is limited');
    if (c.marketDiversity < 40)
      negatives.push('Demand concentrated in few markets');
    if (c.growth < 30) negatives.push('Growth trend is weak');

    return { positives, negatives };
  }

  /** One line per component that moved by >=3 points — used for the "Why did this change?" delta view. */
  buildDeltaExplanation(
    previous: OpportunityScoreBreakdown,
    current: OpportunityScoreBreakdown,
  ): string[] {
    const labels: Record<keyof OpportunityScoreBreakdown, string> = {
      demand: 'Demand',
      indiaExports: 'India export strength',
      growth: 'Growth',
      competition: 'Competition',
      compliance: 'Compliance ease',
      logistics: 'Logistics ease',
      margin: 'Margin potential',
      seasonality: 'Seasonality stability',
      marketDiversity: 'Market diversity',
    };
    const lines: string[] = [];
    for (const key of Object.keys(
      labels,
    ) as (keyof OpportunityScoreBreakdown)[]) {
      const delta = current[key] - previous[key];
      if (Math.abs(delta) >= 3) {
        lines.push(
          `${labels[key]} ${delta > 0 ? 'improved' : 'worsened'} ${delta > 0 ? '+' : ''}${delta}`,
        );
      }
    }
    return lines;
  }
}
