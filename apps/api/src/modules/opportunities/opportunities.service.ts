import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InvestmentRange as PrismaInvestmentRange,
  Opportunity,
  Prisma,
} from '@prisma/client';
import {
  DEMO_DATA_NOTICE,
  OpportunityDetail,
  OpportunitySearchResponse,
  OpportunitySummary,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildPaginationMeta,
  toSkipTake,
} from '../../common/utils/pagination.util';
import { SearchOpportunitiesDto } from './dto/search-query.dto';
import {
  OpportunityMapperService,
  PersonalizationContext,
} from './opportunity-mapper.service';
import { ScoringService } from './scoring.service';

const SECTION_LIMIT = 8;

const INVESTMENT_ORDER: PrismaInvestmentRange[] = [
  'UNDER_1L',
  'L1_5',
  'L5_10',
  'L10_25',
  'L25_50',
  'L50_1CR',
  'ABOVE_1CR',
];

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: OpportunityMapperService,
    private readonly scoring: ScoringService,
  ) {}

  private async personalizationContext(
    organizationId: string,
  ): Promise<PersonalizationContext> {
    const [profile, countries, interests] = await Promise.all([
      this.prisma.exporterProfile.findUnique({ where: { organizationId } }),
      this.prisma.targetCountry.findMany({
        where: { organizationId },
        select: { countryCode: true },
      }),
      this.prisma.productInterest.findMany({
        where: { organizationId },
        select: { category: true },
      }),
    ]);
    return {
      profile,
      targetCountryCodes: countries.map((c) => c.countryCode),
      productInterestCategories: interests
        .map((i) => i.category)
        .filter((c): c is string => Boolean(c)),
    };
  }

  private async savedSet(
    organizationId: string,
    opportunityIds: string[],
  ): Promise<Set<string>> {
    if (opportunityIds.length === 0) return new Set();
    const rows = await this.prisma.savedOpportunity.findMany({
      where: { organizationId, opportunityId: { in: opportunityIds } },
      select: { opportunityId: true },
    });
    return new Set(rows.map((r) => r.opportunityId));
  }

  private async scoreDeltaMap(
    opportunityIds: string[],
  ): Promise<Map<string, number | null>> {
    const map = new Map<string, number | null>();
    if (opportunityIds.length === 0) return map;
    const snapshots = await this.prisma.opportunityScoreSnapshot.findMany({
      where: { opportunityId: { in: opportunityIds } },
      orderBy: { capturedAt: 'desc' },
    });
    const byOpportunity = new Map<string, typeof snapshots>();
    for (const s of snapshots) {
      const list = byOpportunity.get(s.opportunityId) ?? [];
      list.push(s);
      byOpportunity.set(s.opportunityId, list);
    }
    for (const id of opportunityIds) {
      map.set(id, this.mapper.scoreDelta(byOpportunity.get(id) ?? []));
    }
    return map;
  }

  private async toSummaries(
    organizationId: string,
    rows: Opportunity[],
  ): Promise<OpportunitySummary[]> {
    const ctx = await this.personalizationContext(organizationId);
    const ids = rows.map((r) => r.id);
    const [saved, deltas] = await Promise.all([
      this.savedSet(organizationId, ids),
      this.scoreDeltaMap(ids),
    ]);
    return rows.map((row) =>
      this.mapper.toSummary(row, {
        isSaved: saved.has(row.id),
        scoreDelta: deltas.get(row.id) ?? null,
        personalization: this.mapper.personalize(row, ctx),
      }),
    );
  }

  private whereFromFilters(
    dto: SearchOpportunitiesDto,
  ): Prisma.OpportunityWhereInput {
    const where: Prisma.OpportunityWhereInput = {};
    if (dto.search) {
      where.OR = [
        { productName: { contains: dto.search, mode: 'insensitive' } },
        { productCategoryCode: { contains: dto.search, mode: 'insensitive' } },
        {
          destinationCountryCode: { contains: dto.search, mode: 'insensitive' },
        },
      ];
    }
    if (dto.category) where.productCategoryCode = dto.category;
    if (dto.country) where.destinationCountryCode = dto.country;
    if (dto.competitionLevel) where.competitionLevel = dto.competitionLevel;
    if (dto.complianceDifficulty)
      where.complianceDifficulty = dto.complianceDifficulty;
    if (dto.minMarginScore !== undefined)
      where.marginScore = { gte: dto.minMarginScore };
    if (dto.minGrowthScore !== undefined)
      where.growthScore = { gte: dto.minGrowthScore };
    if (dto.budget) {
      const maxIdx = INVESTMENT_ORDER.indexOf(
        dto.budget as PrismaInvestmentRange,
      );
      where.investmentRange = { in: INVESTMENT_ORDER.slice(0, maxIdx + 1) };
    }
    return where;
  }

  private orderByFromSort(
    sort?: string,
  ): Prisma.OpportunityOrderByWithRelationInput {
    switch (sort) {
      case 'GROWTH':
        return { growthScore: 'desc' };
      case 'LOW_COMPETITION':
        return { competitionScore: 'desc' };
      case 'HIGH_MARGIN':
        return { marginScore: 'desc' };
      case 'CONFIDENCE':
        return { confidenceScore: 'desc' };
      case 'RECENT':
        return { updatedAt: 'desc' };
      case 'BEST':
      default:
        return { overallScore: 'desc' };
    }
  }

  async search(
    organizationId: string,
    dto: SearchOpportunitiesDto,
  ): Promise<OpportunitySearchResponse> {
    const where = this.whereFromFilters(dto);
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const [rows, totalItems] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        orderBy: this.orderByFromSort(dto.sort),
        ...toSkipTake(page, pageSize),
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    const items = await this.toSummaries(organizationId, rows);
    return { items, meta: buildPaginationMeta(page, pageSize, totalItems) };
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<OpportunityDetail> {
    const row = await this.prisma.opportunity.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Opportunity not found.');

    const ctx = await this.personalizationContext(organizationId);
    const [saved, deltaMap, snapshots] = await Promise.all([
      this.savedSet(organizationId, [id]),
      this.scoreDeltaMap([id]),
      this.prisma.opportunityScoreSnapshot.findMany({
        where: { opportunityId: id },
        orderBy: { capturedAt: 'desc' },
        take: 2,
      }),
    ]);

    const scoreDeltaReasons =
      snapshots.length === 2
        ? this.scoring.buildDeltaExplanation(
            snapshots[1].components as unknown as Parameters<
              typeof this.scoring.buildDeltaExplanation
            >[0],
            snapshots[0].components as unknown as Parameters<
              typeof this.scoring.buildDeltaExplanation
            >[0],
          )
        : [];

    return this.mapper.toDetail(row, {
      isSaved: saved.has(id),
      scoreDelta: deltaMap.get(id) ?? null,
      personalization: this.mapper.personalize(row, ctx),
      scoreDeltaReasons,
    });
  }

  async history(id: string) {
    const exists = await this.prisma.opportunity.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Opportunity not found.');

    const snapshots = await this.prisma.opportunityScoreSnapshot.findMany({
      where: { opportunityId: id },
      orderBy: { capturedAt: 'desc' },
      take: 20,
    });
    return snapshots.map((s) => ({
      overallScore: s.overallScore,
      components: s.components,
      confidence: s.confidence,
      capturedAt: s.capturedAt.toISOString(),
    }));
  }

  async discovery(organizationId: string) {
    const [all, ctx] = await Promise.all([
      this.prisma.opportunity.findMany({ orderBy: { overallScore: 'desc' } }),
      this.personalizationContext(organizationId),
    ]);
    const ids = all.map((r) => r.id);
    const [saved, deltas] = await Promise.all([
      this.savedSet(organizationId, ids),
      this.scoreDeltaMap(ids),
    ]);

    const toSummary = (row: Opportunity) =>
      this.mapper.toSummary(row, {
        isSaved: saved.has(row.id),
        scoreDelta: deltas.get(row.id) ?? null,
        personalization: this.mapper.personalize(row, ctx),
      });

    const topOpportunities = [...all]
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, SECTION_LIMIT);
    const trendingProducts = [...all]
      .sort((a, b) => this.mapper.trendScore(b) - this.mapper.trendScore(a))
      .slice(0, SECTION_LIMIT);
    const fastestGrowing = [...all]
      .sort((a, b) => b.growthScore - a.growthScore)
      .slice(0, SECTION_LIMIT);
    const beginnerFriendly = [...all]
      .sort(
        (a, b) =>
          this.mapper.beginnerFriendlyScore(b) -
          this.mapper.beginnerFriendlyScore(a),
      )
      .slice(0, SECTION_LIMIT);
    const lowCompetition = [...all]
      .sort((a, b) => b.competitionScore - a.competitionScore)
      .slice(0, SECTION_LIMIT);
    const highPotentialMargin = [...all]
      .sort((a, b) => b.marginScore - a.marginScore)
      .slice(0, SECTION_LIMIT);

    const recommendedForYou = ctx.profile
      ? [...all]
          .map((row) => ({
            row,
            relevance: this.mapper.personalize(row, ctx).relevance ?? 0,
          }))
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, SECTION_LIMIT)
          .map((x) => x.row)
      : topOpportunities;

    return {
      sections: {
        topOpportunities: topOpportunities.map(toSummary),
        trendingProducts: trendingProducts.map(toSummary),
        fastestGrowing: fastestGrowing.map(toSummary),
        beginnerFriendly: beginnerFriendly.map(toSummary),
        lowCompetition: lowCompetition.map(toSummary),
        highPotentialMargin: highPotentialMargin.map(toSummary),
        recommendedForYou: recommendedForYou.map(toSummary),
      },
      demoDataNotice: DEMO_DATA_NOTICE,
    };
  }
}
