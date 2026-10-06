import { Inject, Injectable } from '@nestjs/common';
import {
  COUNTRY_META,
  CodeSystem,
  PersonalizedRecommendation,
  RecommendationFilters,
  RecommendationGroupKey,
  RecommendationNextAction,
  RecommendationsResponse,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { nameSimilarity } from '../products/products.service';
import { isEligible } from '../product-intelligence/product-intelligence.service';
import { CountryIntelligenceService } from '../country-intelligence/country-intelligence.service';
import { levelFromFavorable } from '../country-intelligence/market-scoring';
import { PersonalizationService } from '../personalization/personalization.service';
import {
  computePersonalFit,
  PERSONAL_FIT_LABELS,
  PERSONAL_FIT_WEIGHTS,
  profileCompleteness,
  RECOMMENDATION_BASE_WEIGHT,
  RECOMMENDATION_FIT_WEIGHT,
  recommendationScore,
} from '../personalization/personal-fit';
import { fitAttributes } from '../personalization/fit-attributes';
import {
  PRODUCT_TRADE_DATA_PROVIDER,
  ProductTradeDataProvider,
} from '../product-intelligence/providers/product-trade-data.provider';

export const RECOMMENDATION_DISCLAIMER =
  'Recommendations are based on sample intelligence data in the current development environment. They are advisory decision support, not production-grade market advice.';

const GROUP_LABELS: Record<RecommendationGroupKey, string> = {
  bestOverall: 'Best Overall',
  beginners: 'Best for Beginners',
  withinBudget: 'Best Within Your Budget',
  targetMarkets: 'Matches Your Target Markets',
  lowerRisk: 'Lower Risk',
  highGrowth: 'High Growth',
};

/**
 * Personalized product × market recommendations. Only combinations that
 * exist in Sprint 6/7 intelligence are considered; base scores are read,
 * never changed. Ranking = 70% base market score + 30% personal fit.
 */
@Injectable()
export class RecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countryIntelligence: CountryIntelligenceService,
    private readonly personalization: PersonalizationService,
    @Inject(PRODUCT_TRADE_DATA_PROVIDER)
    private readonly productData: ProductTradeDataProvider,
  ) {}

  async recommendations(
    organizationId: string,
    f: RecommendationFilters,
  ): Promise<RecommendationsResponse> {
    const [profile, candidates, orgProducts, opportunities, saved] =
      await Promise.all([
        this.personalization.loadProfile(organizationId),
        this.countryIntelligence.marketCandidates(),
        this.prisma.organizationProduct.findMany({ where: { organizationId } }),
        this.prisma.opportunity.findMany({
          select: {
            id: true,
            productName: true,
            productCategoryCode: true,
            destinationCountryCode: true,
          },
        }),
        this.prisma.savedOpportunity.findMany({
          where: { organizationId },
          select: { opportunityId: true },
        }),
      ]);
    const completeness = profileCompleteness(profile);
    const savedIds = new Set(saved.map((s) => s.opportunityId));

    // The org's own saved products, by matched dataset code (navigation only).
    const savedByCode = new Map<string, string>();
    for (const p of orgProducts) {
      if (!isEligible(p)) continue;
      const m = this.productData.find({
        codeSystem: p.codeSystem as CodeSystem,
        classificationCode: p.classificationCode,
        hsCode: p.hsCode,
      });
      if (m && !savedByCode.has(m.dataset.code))
        savedByCode.set(m.dataset.code, p.id);
    }
    const fixFirstBase = profile.readinessActions
      .filter((a) => a.priority === 'CRITICAL' || a.priority === 'IMPORTANT')
      .slice(0, 3)
      .map((a) => a.message);

    let all: PersonalizedRecommendation[] = candidates.map(
      ({ match, market, country, scored, intel }) => {
        const cc = market.countryCode;
        const fit = computePersonalFit(
          profile,
          fitAttributes(match, intel, {
            countryCode: cc,
            scored,
            profile: country,
          }),
        );
        const base = scored.score;
        const budget = fit.components.find((c) => c.key === 'budget')!;
        const withinBudget = budget.inputAvailable && budget.points >= 15;
        const fixFirst = [
          ...fixFirstBase,
          ...fit.cautions
            .filter((c) => c.component === 'readiness')
            .map((c) => c.text),
        ]
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 4);
        const savedProductId = savedByCode.get(match.dataset.code) ?? null;
        const opp = opportunities.find(
          (o) =>
            o.destinationCountryCode === cc &&
            o.productCategoryCode === match.dataset.categoryCode &&
            nameSimilarity(o.productName, match.dataset.label) > 0.5,
        );
        // Product-focused next step; readiness gaps are surfaced separately in `fixFirst` (linked to Export Setup in the UI).
        const nextAction: RecommendationNextAction = savedProductId
          ? {
              label: 'View market analysis',
              href: `/products/${savedProductId}/markets/${cc}`,
              kind: 'MARKET_ANALYSIS',
            }
          : {
              label: 'Analyze & save this product',
              href: `/products/analyze?${new URLSearchParams({ input: match.dataset.code })}`,
              kind: 'ANALYZE_PRODUCT',
            };
        const supply = intel.risk.signals.find(
          (s) => s.key === 'supply',
        )!.score;
        const groups: RecommendationGroupKey[] = [];
        if (
          scored.entryEase >= 65 &&
          match.dataset.signals.capitalIntensity !== 'HIGH' &&
          scored.complianceEase >= 55
        )
          groups.push('beginners');
        if (withinBudget) groups.push('withinBudget');
        if (profile.targets.has(cc)) groups.push('targetMarkets');
        if (country.riskScore >= 67 && supply >= 40) groups.push('lowerRisk');
        if (scored.components.growth >= 65) groups.push('highGrowth');
        const marketConfidence = Math.max(
          0,
          scored.confidence - (match.level === 'HS_HEADING' ? 15 : 0),
        );
        return {
          id: `${match.dataset.code}:${cc}`,
          productCode: match.dataset.code,
          productLabel: match.dataset.label,
          categoryCode: match.dataset.categoryCode,
          country: COUNTRY_META[cc],
          baseOpportunityScore: base,
          productOpportunityScore: intel.opportunity.score,
          personalFit: {
            ...fit,
            reasons: [
              ...fit.reasons,
              ...scored.reasons
                .slice(0, 2)
                .map((text) => ({ text, component: 'market' as const })),
            ],
            cautions: [
              ...fit.cautions,
              ...scored.risks
                .slice(0, 2)
                .map((text) => ({ text, component: 'market' as const })),
            ],
          },
          recommendationScore: recommendationScore(base, fit.score),
          rank: 0,
          // Lower when the profile is incomplete: 70% data confidence + 30% profile completeness.
          confidence: Math.round(
            0.7 * marketConfidence + 0.3 * completeness.completenessPercent,
          ),
          countryRiskLevel: levelFromFavorable(country.riskScore),
          marketEntry: scored.entry,
          isTargetMarket: profile.targets.has(cc),
          withinBudget,
          fixFirst,
          nextAction,
          savedProductId,
          opportunity: opp
            ? { id: opp.id, isSaved: savedIds.has(opp.id) }
            : null,
          groups,
        };
      },
    );

    all.sort(
      (a, b) =>
        b.recommendationScore - a.recommendationScore ||
        b.baseOpportunityScore - a.baseOpportunityScore ||
        a.id.localeCompare(b.id),
    );
    all.forEach((r, i) => {
      r.rank = i + 1;
      if (i < 6) r.groups.unshift('bestOverall');
    });

    if (f.category) all = all.filter((r) => r.categoryCode === f.category);
    if (f.country) all = all.filter((r) => r.country.code === f.country);
    if (f.risk) all = all.filter((r) => r.countryRiskLevel === f.risk);
    if (f.budgetFit) all = all.filter((r) => r.withinBudget);
    const groups = (Object.keys(GROUP_LABELS) as RecommendationGroupKey[]).map(
      (key) => {
        const members = all.filter((r) => r.groups.includes(key));
        return {
          key,
          label: GROUP_LABELS[key],
          count: members.length,
          topIds: members.slice(0, 3).map((r) => r.id),
        };
      },
    );
    if (f.group) all = all.filter((r) => r.groups.includes(f.group!));

    const page = f.page ?? 1;
    const pageSize = f.pageSize ?? 12;
    return {
      items: all.slice((page - 1) * pageSize, page * pageSize),
      meta: buildPaginationMeta(page, pageSize, all.length),
      groups,
      profile: completeness,
      rankingFormula: `Recommendation rank = ${RECOMMENDATION_BASE_WEIGHT * 100}% base market opportunity score + ${RECOMMENDATION_FIT_WEIGHT * 100}% personal fit. Base scores are never changed.`,
      weights: (
        Object.keys(
          PERSONAL_FIT_WEIGHTS,
        ) as (keyof typeof PERSONAL_FIT_WEIGHTS)[]
      ).map((k) => ({
        key: k,
        label: PERSONAL_FIT_LABELS[k],
        max: PERSONAL_FIT_WEIGHTS[k],
      })),
      source: this.countryIntelligence.sourceMetadata(),
      disclaimer: RECOMMENDATION_DISCLAIMER,
    };
  }
}
