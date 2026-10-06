import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ExporterProfile, OrganizationProduct, Prisma } from '@prisma/client';
import {
  COUNTRY_META,
  COUNTRY_REGIONS,
  CodeSystem,
  CountryDetailResponse,
  CountryListResponse,
  CountryProductRanking,
  CountryRiskInfo,
  MarketContext,
  MarketCountrySummary,
  MarketDeepAnalysisResponse,
  MarketScoreComponents,
  PersonalFit,
  ProductMarketRanking,
  ProductMarketsQuery,
  ProductMarketsResponse,
  ScoreChange,
  SourceMetadata,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { nameSimilarity, ProductsService } from '../products/products.service';
import {
  freshnessOf,
  isEligible,
  ProductIntelligenceService,
} from '../product-intelligence/product-intelligence.service';
import {
  PRODUCT_TRADE_DATA_PROVIDER,
  ProductTradeDataProvider,
  TradeDatasetMatch,
} from '../product-intelligence/providers/product-trade-data.provider';
import { yoyGrowth } from '../product-intelligence/intelligence-calculations';
import {
  levelFromFavorable,
  MARKET_COMPONENT_LABELS,
  MARKET_WEIGHTS,
  scoreMarket,
  ScoredMarket,
} from './market-scoring';
import {
  COUNTRY_TRADE_DATA_PROVIDER,
  CountryProfile,
  CountryTradeDataProvider,
  ProductCountryMarket,
} from './providers/country-trade-data.provider';

export const REGULATORY_NOTICE =
  'Verify current requirements with authoritative sources before shipment or contract commitment.';
const CLASSIFICATION_MESSAGE =
  'Confirm product classification (at least a 4-digit HS heading) before viewing market intelligence.';
const NO_DATA_MESSAGE =
  'Market intelligence is not available for this product’s classification yet.';
const FRESHNESS_SCORE = {
  FRESH: 100,
  RECENT: 75,
  STALE: 40,
  UNKNOWN: 20,
} as const;
const INVESTMENT_ORDER = [
  'UNDER_1L',
  'L1_5',
  'L5_10',
  'L10_25',
  'L25_50',
  'L50_1CR',
  'ABOVE_1CR',
];
const SORT_KEYS: Record<
  NonNullable<ProductMarketsQuery['sort']>,
  (r: ProductMarketRanking) => number
> = {
  OPPORTUNITY: (r) => r.opportunityScore,
  DEMAND: (r) => r.components.demand,
  GROWTH: (r) => r.components.growth,
  TARIFF: (r) => r.components.tariff,
  COMPETITION: (r) => r.components.competition,
  LOGISTICS: (r) => r.components.logistics,
  RISK: (r) => r.components.countryRisk,
};

interface OrgContext {
  profile: ExporterProfile | null;
  targets: Map<string, 'CURRENT' | 'INTERESTED'>;
}

@Injectable()
export class CountryIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly productIntelligence: ProductIntelligenceService,
    @Inject(PRODUCT_TRADE_DATA_PROVIDER)
    private readonly productData: ProductTradeDataProvider,
    @Inject(COUNTRY_TRADE_DATA_PROVIDER)
    private readonly data: CountryTradeDataProvider,
  ) {}

  // --- Product → Best Countries ------------------------------------------

  async productMarkets(
    organizationId: string,
    productId: string,
    q: ProductMarketsQuery,
  ): Promise<ProductMarketsResponse> {
    const product = await this.ownedProduct(organizationId, productId);
    const summary = this.products.toSummary(product);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const empty = {
      items: [],
      meta: buildPaginationMeta(page, pageSize, 0),
      regions: [],
      source: null,
      match: null,
    };

    if (!isEligible(product))
      return {
        product: summary,
        status: 'CLASSIFICATION_REQUIRED',
        message: CLASSIFICATION_MESSAGE,
        ...empty,
      };
    const match = this.match(product);
    const markets = match
      ? this.data.marketsForProduct(match.dataset.code)
      : [];
    if (!match || markets.length === 0)
      return {
        product: summary,
        status: 'NO_DATA',
        message: NO_DATA_MESSAGE,
        ...empty,
      };

    const ctx = await this.orgContext(organizationId);
    let rows: ProductMarketRanking[] = markets.flatMap((m) => {
      const country = this.data.countryProfile(m.countryCode);
      if (!country || !COUNTRY_META[m.countryCode]) return [];
      const s = this.score(m, country, match);
      return [
        {
          rank: 0,
          country: COUNTRY_META[m.countryCode],
          opportunityScore: s.score,
          confidence: this.matchConfidence(s.confidence, match),
          components: s.components,
          tariffAvailable: s.tariffAvailable,
          countryRiskLevel: levelFromFavorable(country.riskScore),
          currencyRiskLevel: levelFromFavorable(country.currencyStability),
          marketEntry: s.entry,
          reasons: s.reasons,
          risks: s.risks,
          personalFit: this.personalFit(ctx, m.countryCode, s, country),
          context: this.context(ctx, m.countryCode),
        },
      ];
    });
    await this.recordSnapshots(match.dataset.code, markets, match);

    rows.sort(
      (a, b) =>
        b.opportunityScore - a.opportunityScore ||
        a.country.name.localeCompare(b.country.name),
    );
    rows.forEach((r, i) => (r.rank = i + 1));
    const regions = [...new Set(rows.map((r) => r.country.region))].sort();
    if (q.region) rows = rows.filter((r) => r.country.region === q.region);
    if (q.minScore !== undefined)
      rows = rows.filter((r) => r.opportunityScore >= q.minScore!);
    if (q.sort && q.sort !== 'OPPORTUNITY') {
      const key = SORT_KEYS[q.sort];
      rows = [...rows].sort((a, b) => key(b) - key(a) || a.rank - b.rank);
    }
    const total = rows.length;
    return {
      product: summary,
      status: 'AVAILABLE',
      message: null,
      match: {
        level: match.level,
        matchedCode: match.matchedCode,
        datasetLabel: match.dataset.label,
      },
      source: this.sourceMeta(),
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      meta: buildPaginationMeta(page, pageSize, total),
      regions,
    };
  }

  // --- Product + Country deep analysis -----------------------------------

  async deepAnalysis(
    organizationId: string,
    userId: string,
    productId: string,
    countryCodeRaw: string,
  ): Promise<MarketDeepAnalysisResponse> {
    const product = await this.ownedProduct(organizationId, productId);
    const summary = this.products.toSummary(product);
    const cc = countryCodeRaw.toUpperCase();
    const meta = COUNTRY_META[cc] ?? null;
    if (!isEligible(product))
      return {
        product: summary,
        status: 'CLASSIFICATION_REQUIRED',
        country: meta,
        message: CLASSIFICATION_MESSAGE,
      };
    if (!meta) throw new NotFoundException('Unknown country code.');
    const match = this.match(product);
    if (
      !match ||
      this.data.marketsForProduct(match.dataset.code).length === 0
    ) {
      return {
        product: summary,
        status: 'NO_DATA',
        country: meta,
        message: NO_DATA_MESSAGE,
      };
    }
    const country = this.data.countryProfile(cc);
    const m = this.data.market(match.dataset.code, cc);
    if (!country || !m) {
      return {
        product: summary,
        status: 'COUNTRY_NOT_SUPPORTED',
        country: meta,
        message: `Market intelligence for ${meta.name} is not available for this product yet.`,
      };
    }

    const ctx = await this.orgContext(organizationId);
    const s = this.score(m, country, match);
    const confidence = this.matchConfidence(s.confidence, match);
    const scoreChange = await this.scoreChange(match.dataset.code, cc, s);
    await this.recordSnapshots(match.dataset.code, [m], match);

    const yearly = [...m.yearly].sort((a, b) =>
      a.period.localeCompare(b.period),
    );
    const latest = yearly[yearly.length - 1];
    const productIntel = await this.productIntelligence
      .getForProduct(organizationId, userId, product.id)
      .catch(() => null);
    const discovery = await this.discoveryScore(match, cc);
    const suppliers = [...m.competitors]
      .sort((a, b) => b.sharePercent - a.sharePercent)
      .map((x, i) => ({
        rank: i + 1,
        countryCode: x.countryCode,
        sharePercent: x.sharePercent,
        indicativeValue: Math.round((latest.value * x.sharePercent) / 100),
        growthPercent: x.growthPercent,
      }));
    const majorSuppliers = suppliers.filter((x) => x.sharePercent >= 10).length;
    const shareChange =
      m.indiaSharePreviousPercent === null
        ? null
        : Math.round((m.indiaSharePercent - m.indiaSharePreviousPercent) * 10) /
          10;

    return {
      product: summary,
      status: 'AVAILABLE',
      country: meta,
      context: this.context(ctx, cc),
      match: {
        level: match.level,
        matchedCode: match.matchedCode,
        datasetLabel: match.dataset.label,
      },
      source: this.sourceMeta(yearly[0].period, latest.period),
      opportunityScore: s.score,
      confidence,
      components: (
        Object.keys(MARKET_WEIGHTS) as (keyof MarketScoreComponents)[]
      ).map((k) => ({
        key: k,
        label: MARKET_COMPONENT_LABELS[k],
        weight: MARKET_WEIGHTS[k],
        score: s.components[k],
      })),
      reasons: s.reasons,
      risks: s.risks,
      personalFit: this.personalFit(ctx, cc, s, country),
      scoreChange,
      marketSize: {
        available: true,
        importValue: latest.value,
        importQuantity: m.quantityUnit ? latest.quantity : null,
        quantityUnit: m.quantityUnit,
        period: latest.period,
        currency: m.currency,
      },
      importTrend: {
        yearly: yearly.map((p, i) => ({
          period: p.period,
          exportValue: p.value,
          exportQuantity: m.quantityUnit ? p.quantity : null,
          growthPercent:
            i === 0 ? null : yoyGrowth(p.value, yearly[i - 1].value),
        })),
        monthly: [],
        cagr: s.cagr,
        latestYoyPercent: s.latestYoy,
      },
      indiaPosition: {
        sharePercent: m.indiaSharePercent,
        previousSharePercent: m.indiaSharePreviousPercent,
        shareChangePoints: shareChange,
        rank: m.indiaRank,
        presenceLevel:
          m.indiaSharePercent >= 25
            ? 'HIGH'
            : m.indiaSharePercent >= 8
              ? 'MODERATE'
              : 'LOW',
      },
      competition: {
        score: s.components.competition,
        level: s.competitionLevel,
        suppliers,
        majorSupplierCount: majorSuppliers,
        supplierHhi: s.supplierHhi,
        explanation:
          s.aboveIndiaShare === 0
            ? `India is the leading supplier; ${majorSuppliers === 0 ? 'no other supplier holds' : `${majorSuppliers} other supplier${majorSuppliers === 1 ? ' holds' : 's hold'}`} 10% or more.`
            : `Suppliers ahead of India hold ${s.aboveIndiaShare}% of imports; India ranks #${m.indiaRank ?? '—'} with ${m.indiaSharePercent}%.`,
      },
      tariff: m.tariff
        ? {
            available: true,
            appliedRatePercent: m.tariff.appliedRatePercent,
            preferentialRatePercent: m.tariff.preferentialRatePercent,
            preferentialScheme: m.tariff.preferentialScheme,
            tariffType: m.tariff.tariffType,
            effectiveDate: m.tariff.effectiveDate,
            verification: 'DATASET_ONLY',
            note: 'Illustrative only — verify current tariff before commercial decision.',
          }
        : {
            available: false,
            appliedRatePercent: null,
            preferentialRatePercent: null,
            preferentialScheme: null,
            tariffType: null,
            effectiveDate: null,
            verification: 'DATASET_ONLY',
            note: 'Tariff data is not available for this market in the current dataset.',
          },
      barriers: m.barriers,
      pricing: m.unitValue
        ? {
            available: true,
            unitValue: m.unitValue.current,
            unit: m.unitValue.unit,
            previousUnitValue: m.unitValue.previous,
            changePercent: yoyGrowth(m.unitValue.current, m.unitValue.previous),
            note: 'Indicative import unit value / benchmark — not an actual market selling price.',
          }
        : {
            available: false,
            unitValue: null,
            unit: null,
            previousUnitValue: null,
            changePercent: null,
            note: 'No comparable unit-value data for this product.',
          },
      packaging: m.packaging,
      labeling: m.labeling,
      certifications: m.certifications,
      logistics: {
        score: s.components.logistics,
        level: levelFromFavorable(s.components.logistics),
        destinationPorts: country.majorPorts,
        seaTransit: country.seaTransit,
        airSuitability: country.airSuitability,
        routeComplexity: country.routeComplexity,
        notes: country.notes,
      },
      risk: this.riskInfo(country, cc),
      marketEntry: {
        difficulty: s.entry,
        easeScore: s.entryEase,
        reasons: entryReasons(s),
      },
      productIntelligence:
        productIntel && productIntel.status === 'AVAILABLE'
          ? {
              opportunityScore: productIntel.opportunity.score,
              confidence: productIntel.confidence,
              indiaExportSharePercent:
                productIntel.markets.destinations.find(
                  (d) => d.countryCode === cc,
                )?.sharePercent ?? null,
            }
          : null,
      discovery,
      regulatoryNotice: REGULATORY_NOTICE,
    };
  }

  // --- Countries -----------------------------------------------------------

  async countries(
    organizationId: string,
    q: { q?: string; region?: string; page?: number; pageSize?: number },
  ): Promise<CountryListResponse> {
    const ctx = await this.orgContext(organizationId);
    const term = q.q?.trim().toLowerCase();
    const all = Object.values(COUNTRY_META).filter((c) => c.code !== 'IN');
    const filtered = all.filter(
      (c) =>
        (!q.region || c.region === q.region) &&
        (!term ||
          c.name.toLowerCase().includes(term) ||
          c.code.toLowerCase() === term ||
          c.region.toLowerCase().includes(term)),
    );
    const summaries: MarketCountrySummary[] = filtered.map((c) => {
      const profile = this.data.countryProfile(c.code);
      const ranked = profile ? this.rankCountryProducts(c.code, profile) : [];
      return {
        country: c,
        supported: Boolean(profile) && ranked.length > 0,
        topScore: ranked[0]?.score ?? null,
        productCount: ranked.length,
        topProducts: ranked.slice(0, 3).map((r) => r.label),
        countryRiskLevel: profile
          ? levelFromFavorable(profile.riskScore)
          : null,
        context: this.context(ctx, c.code),
      };
    });
    const exact = (c: MarketCountrySummary) =>
      term && c.country.code.toLowerCase() === term ? 1 : 0;
    summaries.sort(
      (a, b) =>
        exact(b) - exact(a) ||
        Number(b.supported) - Number(a.supported) ||
        Number(b.context.isTargetMarket) - Number(a.context.isTargetMarket) ||
        (b.topScore ?? 0) - (a.topScore ?? 0) ||
        a.country.name.localeCompare(b.country.name),
    );
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 24;
    return {
      items: summaries.slice((page - 1) * pageSize, page * pageSize),
      meta: buildPaginationMeta(page, pageSize, summaries.length),
      regions: COUNTRY_REGIONS.filter((r) => all.some((c) => c.region === r)),
      source: this.sourceMeta(),
    };
  }

  async countryDetail(
    organizationId: string,
    countryCodeRaw: string,
    page = 1,
    pageSize = 20,
  ): Promise<CountryDetailResponse> {
    const cc = countryCodeRaw.toUpperCase();
    const meta = COUNTRY_META[cc];
    if (!meta || cc === 'IN')
      throw new NotFoundException('Unknown country code.');
    const ctx = await this.orgContext(organizationId);
    const profile = this.data.countryProfile(cc);
    const ranked = profile ? this.rankCountryProducts(cc, profile) : [];
    if (!profile || ranked.length === 0) {
      return {
        country: meta,
        supported: false,
        context: this.context(ctx, cc),
        source: null,
        confidence: null,
        attractiveness: null,
        risk: null,
        logistics: null,
        products: [],
        meta: buildPaginationMeta(page, pageSize, 0),
      };
    }

    // Map global product codes to this org's saved products (navigation only; never creates products).
    const orgProducts = await this.prisma.organizationProduct.findMany({
      where: { organizationId },
    });
    const savedByCode = new Map<string, string>();
    for (const p of orgProducts) {
      const m = isEligible(p) ? this.match(p) : null;
      if (m && !savedByCode.has(m.dataset.code))
        savedByCode.set(m.dataset.code, p.id);
    }

    const items: CountryProductRanking[] = ranked.map((r, i) => ({
      rank: i + 1,
      productCode: r.code,
      productLabel: r.label,
      categoryCode: r.categoryCode,
      opportunityScore: r.score,
      confidence: r.scored.confidence,
      components: r.scored.components,
      indiaSharePercent: r.market.indiaSharePercent,
      savedProductId: savedByCode.get(r.code) ?? null,
      personalFit: this.personalFit(ctx, cc, r.scored, profile),
    }));
    const top = items.slice(0, 3);
    return {
      country: meta,
      supported: true,
      context: this.context(ctx, cc),
      source: this.sourceMeta(),
      confidence: Math.round(
        items.reduce((s, x) => s + x.confidence, 0) / items.length,
      ),
      attractiveness: Math.round(
        top.reduce((s, x) => s + x.opportunityScore, 0) / top.length,
      ),
      risk: this.riskInfo(profile, cc),
      logistics: {
        score: profile.logisticsBase,
        level: levelFromFavorable(profile.logisticsBase),
        majorPorts: profile.majorPorts,
        seaTransit: profile.seaTransit,
        airSuitability: profile.airSuitability,
        notes: profile.notes,
      },
      products: items.slice((page - 1) * pageSize, page * pageSize),
      meta: buildPaginationMeta(page, pageSize, items.length),
    };
  }

  // --- Internals -------------------------------------------------------------

  private async ownedProduct(
    organizationId: string,
    productId: string,
  ): Promise<OrganizationProduct> {
    const product = await this.prisma.organizationProduct.findFirst({
      where: { id: productId, organizationId },
    });
    // Ownership first; global market data is only loaded afterwards.
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  /** Code-based match shared with Sprint 6 (ITC-HS → HS subheading → unambiguous HS heading). */
  private match(product: OrganizationProduct): TradeDatasetMatch | null {
    return this.productData.find({
      codeSystem: product.codeSystem as CodeSystem,
      classificationCode: product.classificationCode,
      hsCode: product.hsCode,
    });
  }

  private matchConfidence(
    confidence: number,
    match: TradeDatasetMatch,
  ): number {
    return Math.max(0, confidence - (match.level === 'HS_HEADING' ? 15 : 0));
  }

  private score(
    m: ProductCountryMarket,
    country: CountryProfile,
    match: TradeDatasetMatch | null,
  ): ScoredMarket {
    const productLogistics = match?.dataset.signals.logisticsEase ?? null;
    const freshness = FRESHNESS_SCORE[freshnessOf(this.data.source.sourceDate)];
    return scoreMarket(
      m,
      country,
      productLogistics,
      this.data.source.quality,
      freshness,
    );
  }

  private rankCountryProducts(cc: string, profile: CountryProfile) {
    return this.data
      .marketsForCountry(cc)
      .flatMap((m) => {
        const dataset = this.productData.find({
          codeSystem: 'HS',
          classificationCode: m.productCode,
          hsCode: m.productCode,
        });
        if (!dataset) return [];
        const scored = this.score(m, profile, dataset);
        return [
          {
            code: m.productCode,
            label: dataset.dataset.label,
            categoryCode: dataset.dataset.categoryCode,
            market: m,
            scored,
            score: scored.score,
          },
        ];
      })
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  }

  private sourceMeta(from = '2021', to = '2025'): SourceMetadata {
    const s = this.data.source;
    return {
      sourceType: s.sourceType,
      sourceName: s.sourceName,
      sourceUrl: s.sourceUrl,
      sourceDate: s.sourceDate,
      lastUpdatedAt: s.lastUpdatedAt,
      freshness: freshnessOf(s.sourceDate),
      datasetVersion: s.datasetVersion,
      coverageFrom: from,
      coverageTo: to,
      isSample: s.sourceType === 'DEMO',
    };
  }

  private riskInfo(p: CountryProfile, cc: string): CountryRiskInfo {
    return {
      countryRiskScore: p.riskScore,
      countryRiskLevel: levelFromFavorable(p.riskScore),
      currency: COUNTRY_META[cc]?.currency ?? '—',
      currencyStabilityScore: p.currencyStability,
      currencyRiskLevel: levelFromFavorable(p.currencyStability),
      notes: [
        'Broad sample signal covering political/economic, payment and regulatory-stability risk — not a credit rating.',
        'Currency signal is a broad stability indicator, not an FX forecast.',
      ],
    };
  }

  private async orgContext(organizationId: string): Promise<OrgContext> {
    const [profile, targets] = await Promise.all([
      this.prisma.exporterProfile.findUnique({ where: { organizationId } }),
      this.prisma.targetCountry.findMany({
        where: { organizationId },
        select: { countryCode: true, relation: true },
      }),
    ]);
    return {
      profile,
      targets: new Map(targets.map((t) => [t.countryCode, t.relation])),
    };
  }

  private context(ctx: OrgContext, cc: string): MarketContext {
    const rel = ctx.targets.get(cc);
    return {
      isTargetMarket: rel !== undefined,
      isCurrentExportMarket: rel === 'CURRENT',
    };
  }

  /** Relevance to this organization only — never feeds back into the market score. */
  private personalFit(
    ctx: OrgContext,
    cc: string,
    s: ScoredMarket,
    country: CountryProfile,
  ): PersonalFit | null {
    const p = ctx.profile;
    if (!p && ctx.targets.size === 0) return null;
    let score = 50;
    const reasons: string[] = [];
    const rel = ctx.targets.get(cc);
    if (rel === 'CURRENT') {
      score += 25;
      reasons.push('You already export to this market');
    } else if (rel === 'INTERESTED') {
      score += 20;
      reasons.push('One of your target markets');
    }
    if (p?.riskTolerance === 'CONSERVATIVE' && country.riskScore < 50) {
      score -= 15;
      reasons.push('Higher country risk than your conservative preference');
    }
    if (p?.riskTolerance === 'AGGRESSIVE' && s.components.growth >= 65) {
      score += 5;
      reasons.push('Fast-growing market suits your risk appetite');
    }
    const novice =
      p?.exportExperience === 'NONE' ||
      p?.exportExperience === 'LESS_THAN_1_YEAR';
    if (novice && s.entry === 'DIFFICULT') {
      score -= 15;
      reasons.push('Difficult market entry for a newer exporter');
    }
    if (novice && s.entry === 'EASY') {
      score += 10;
      reasons.push('Easier market entry suits a newer exporter');
    }
    const range = p?.investmentRange
      ? INVESTMENT_ORDER.indexOf(p.investmentRange)
      : -1;
    if (range >= 0 && range <= 1 && country.logisticsBase < 50) {
      score -= 10;
      reasons.push(
        'Long, complex route may strain a smaller investment budget',
      );
    }
    if (
      p?.preferredLogistics?.includes('AIR') &&
      country.airSuitability.startsWith('Good')
    ) {
      score += 5;
      reasons.push('Air freight is practical to this market');
    }
    if (
      p?.desiredMarginMin !== null &&
      p?.desiredMarginMin !== undefined &&
      p.desiredMarginMin >= 25 &&
      s.components.competition < 40
    ) {
      score -= 5;
      reasons.push('High competition may pressure your target margin');
    }
    return { score: Math.max(0, Math.min(100, score)), reasons };
  }

  private async recordSnapshots(
    productCode: string,
    markets: ProductCountryMarket[],
    match: TradeDatasetMatch,
  ) {
    const data: Prisma.ProductCountryScoreSnapshotCreateManyInput[] =
      markets.flatMap((m) => {
        const country = this.data.countryProfile(m.countryCode);
        if (!country) return [];
        const s = this.score(m, country, match);
        return [
          {
            productCode,
            countryCode: m.countryCode,
            datasetVersion: this.data.source.datasetVersion,
            opportunityScore: s.score,
            confidence: s.confidence,
            components: s.components as unknown as Prisma.InputJsonValue,
          },
        ];
      });
    if (data.length)
      await this.prisma.productCountryScoreSnapshot.createMany({
        data,
        skipDuplicates: true,
      });
  }

  private async scoreChange(
    productCode: string,
    cc: string,
    s: ScoredMarket,
  ): Promise<ScoreChange> {
    const previous = await this.prisma.productCountryScoreSnapshot.findFirst({
      where: {
        productCode,
        countryCode: cc,
        datasetVersion: { not: this.data.source.datasetVersion },
      },
      orderBy: { capturedAt: 'desc' },
    });
    if (!previous)
      return {
        previousScore: null,
        delta: null,
        reasons: ['No earlier dataset version to compare with yet.'],
      };
    const before = previous.components as unknown as MarketScoreComponents;
    const reasons = (
      Object.keys(MARKET_WEIGHTS) as (keyof MarketScoreComponents)[]
    )
      .filter((k) => Math.abs((s.components[k] ?? 0) - (before[k] ?? 0)) >= 3)
      .map(
        (k) =>
          `${MARKET_COMPONENT_LABELS[k]} ${s.components[k] > before[k] ? 'improved' : 'weakened'} (${before[k]} → ${s.components[k]})`,
      );
    return {
      previousScore: previous.opportunityScore,
      delta: s.score - previous.opportunityScore,
      reasons,
    };
  }

  /** Sprint 4 discovery score for the same product/country (aggregated by name within category, shown separately). */
  private async discoveryScore(match: TradeDatasetMatch, cc: string) {
    const rows = await this.prisma.opportunity.findMany({
      where: {
        destinationCountryCode: cc,
        productCategoryCode: match.dataset.categoryCode,
      },
      select: { id: true, productName: true, overallScore: true },
    });
    const best = rows.find(
      (r) => nameSimilarity(r.productName, match.dataset.label) > 0.5,
    );
    return best
      ? { opportunityId: best.id, overallScore: best.overallScore }
      : null;
  }
}

function entryReasons(s: ScoredMarket): string[] {
  const out: string[] = [];
  if (s.effectiveTariff !== null && s.effectiveTariff >= 15)
    out.push('High tariff');
  if (s.complianceEase < 60)
    out.push('Several regulatory/technical barrier signals');
  if (s.components.competition < 40) out.push('Strong competing suppliers');
  if (s.components.logistics < 50) out.push('Complex logistics route');
  if (s.components.countryRisk < 50) out.push('Elevated country risk');
  if (s.components.indiaPresence >= 60)
    out.push('Established India presence eases entry');
  if (s.effectiveTariff !== null && s.effectiveTariff <= 5)
    out.push('Low illustrative tariff');
  if (out.length === 0) out.push('No dominant entry barrier in the data');
  return out;
}
