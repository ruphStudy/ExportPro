import { Injectable } from '@nestjs/common';
import {
  ExporterProfile,
  Opportunity,
  OpportunityScoreSnapshot,
} from '@prisma/client';
import {
  FOOD_RELATED_CATEGORY_CODES,
  InvestmentRange,
  OpportunityBadge,
  OpportunityDetail,
  OpportunityScoreBreakdown,
  OpportunitySummary,
} from '@exportpro/types';
import { ScoringService } from './scoring.service';

const INVESTMENT_ORDER: InvestmentRange[] = [
  'UNDER_1L',
  'L1_5',
  'L5_10',
  'L10_25',
  'L25_50',
  'L50_1CR',
  'ABOVE_1CR',
];

export interface PersonalizationContext {
  profile: ExporterProfile | null;
  targetCountryCodes: string[];
  productInterestCategories: string[];
}

export interface PersonalizationResult {
  relevance: number | null;
  reasons: string[];
}

/**
 * All Prisma-row → shared-DTO mapping, badge derivation, and
 * personalization math lives here — one place, reused by search,
 * discovery, and detail so the three can never compute a card
 * differently. FOOD_RELATED_CATEGORY_CODES is reused from Sprint 3
 * purely as a stand-in "is this a niche/complex category" signal for
 * beginner-friendliness — not a compliance claim.
 */
@Injectable()
export class OpportunityMapperService {
  constructor(private readonly scoring: ScoringService) {}

  components(row: Opportunity): OpportunityScoreBreakdown {
    return {
      demand: row.demandScore,
      indiaExports: row.indiaExportScore,
      growth: row.growthScore,
      competition: row.competitionScore,
      compliance: row.complianceScore,
      logistics: row.logisticsScore,
      margin: row.marginScore,
      seasonality: row.seasonalityScore,
      marketDiversity: row.marketDiversityScore,
    };
  }

  beginnerFriendlyScore(row: Opportunity): number {
    return Math.round(
      0.35 * row.complianceScore +
        0.35 * row.logisticsScore +
        0.2 * row.competitionScore +
        0.1 * row.confidenceScore,
    );
  }

  /** Trend/"currently popular" signal — distinct from pure growth so the Trending section isn't identical to Fastest Growing. */
  trendScore(row: Opportunity): number {
    return Math.round(0.6 * row.growthScore + 0.4 * row.marketDiversityScore);
  }

  badges(
    row: Opportunity,
    personalizedRelevance: number | null,
  ): OpportunityBadge['label'][] {
    const badges: OpportunityBadge['label'][] = [];
    if (this.beginnerFriendlyScore(row) >= 70) badges.push('Beginner Friendly');
    if (row.growthScore >= 75) badges.push('Fast Growing');
    if (row.competitionScore >= 70) badges.push('Low Competition');
    if (row.marginScore >= 70) badges.push('High Margin Potential');
    if (personalizedRelevance !== null && personalizedRelevance >= 75)
      badges.push('Recommended');
    return badges;
  }

  scoreDelta(snapshots: OpportunityScoreSnapshot[]): number | null {
    if (snapshots.length < 2) return null;
    const [latest, previous] = snapshots;
    return latest.overallScore - previous.overallScore;
  }

  /**
   * Lightweight, deterministic relevance adjustment on top of (never
   * instead of) the base opportunity score — see ARCHITECTURE.md
   * "Personalization". Returns null when the org has no exporter profile yet.
   */
  personalize(
    row: Opportunity,
    ctx: PersonalizationContext,
  ): PersonalizationResult {
    if (!ctx.profile) return { relevance: null, reasons: [] };

    let relevance = 50;
    const reasons: string[] = [];

    if (ctx.profile.productCategories.includes(row.productCategoryCode)) {
      relevance += 15;
      reasons.push("Matches a product category you're interested in");
    }
    if (ctx.targetCountryCodes.includes(row.destinationCountryCode)) {
      relevance += 15;
      reasons.push("Matches a target country you're interested in");
    }
    if (ctx.productInterestCategories.includes(row.productCategoryCode)) {
      relevance += 5;
      reasons.push("Matches products you've already added");
    }

    if (ctx.profile.investmentRange) {
      const userIdx = INVESTMENT_ORDER.indexOf(
        ctx.profile.investmentRange as InvestmentRange,
      );
      const oppIdx = INVESTMENT_ORDER.indexOf(
        row.investmentRange as InvestmentRange,
      );
      if (oppIdx > userIdx) {
        relevance -= 10;
      } else {
        relevance += 5;
        reasons.push('Within your investment range');
      }
    }

    if (
      ctx.profile.desiredMarginMin !== null &&
      row.marginScore >= ctx.profile.desiredMarginMin
    ) {
      relevance += 8;
      reasons.push('Matches your desired margin expectations');
    }

    const isBeginnerExperience =
      ctx.profile.exportExperience === 'NONE' ||
      ctx.profile.exportExperience === 'LESS_THAN_1_YEAR';
    if (isBeginnerExperience && this.beginnerFriendlyScore(row) >= 70) {
      relevance += 10;
      reasons.push('Beginner-friendly, matching your export experience');
    }

    // Niche/complex categories are mildly deprioritized for first-time
    // exporters — a UX nudge, never a hard exclusion or a compliance claim.
    if (
      isBeginnerExperience &&
      FOOD_RELATED_CATEGORY_CODES.includes(row.productCategoryCode) &&
      row.complianceScore < 50
    ) {
      relevance -= 5;
    }

    return { relevance: Math.max(0, Math.min(100, relevance)), reasons };
  }

  toSummary(
    row: Opportunity,
    opts: {
      isSaved: boolean;
      scoreDelta: number | null;
      personalization: PersonalizationResult;
    },
  ): OpportunitySummary {
    return {
      id: row.id,
      productName: row.productName,
      productCategoryCode: row.productCategoryCode,
      destinationCountryCode: row.destinationCountryCode,
      tradeDirection:
        row.tradeDirection as OpportunitySummary['tradeDirection'],
      overallScore: row.overallScore,
      confidenceScore: row.confidenceScore,
      competitionLevel:
        row.competitionLevel as OpportunitySummary['competitionLevel'],
      complianceDifficulty:
        row.complianceDifficulty as OpportunitySummary['complianceDifficulty'],
      seasonalityLevel:
        row.seasonalityLevel as OpportunitySummary['seasonalityLevel'],
      investmentRange:
        row.investmentRange as OpportunitySummary['investmentRange'],
      badges: this.badges(row, opts.personalization.relevance),
      source: {
        sourceType:
          row.sourceType as OpportunitySummary['source']['sourceType'],
        sourceName: row.sourceName,
        sourceUrl: row.sourceUrl,
        sourceDate: row.sourceDate.toISOString(),
        lastUpdatedAt: row.updatedAt.toISOString(),
        freshness:
          row.freshnessStatus as OpportunitySummary['source']['freshness'],
      },
      personalizedRelevance: opts.personalization.relevance,
      scoreDelta: opts.scoreDelta,
      isSaved: opts.isSaved,
    };
  }

  toDetail(
    row: Opportunity,
    opts: {
      isSaved: boolean;
      scoreDelta: number | null;
      personalization: PersonalizationResult;
      scoreDeltaReasons: string[];
    },
  ): OpportunityDetail {
    const components = this.components(row);
    return {
      ...this.toSummary(row, opts),
      components,
      explanation: this.scoring.buildExplanation(components),
      personalizationReasons: opts.personalization.reasons,
      scoreDeltaReasons: opts.scoreDeltaReasons,
    };
  }
}
