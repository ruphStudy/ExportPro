import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  COUNTRY_META,
  CodeSystem,
  ComparisonMetricKey,
  MarketComparisonItem,
  MarketComparisonResponse,
  ProductComparisonItem,
  ProductComparisonResponse,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import {
  isEligible,
  ProductIntelligenceService,
} from '../product-intelligence/product-intelligence.service';
import {
  PRODUCT_TRADE_DATA_PROVIDER,
  ProductTradeDataProvider,
} from '../product-intelligence/providers/product-trade-data.provider';
import { CountryIntelligenceService } from '../country-intelligence/country-intelligence.service';
import { PersonalizationService } from '../personalization/personalization.service';
import {
  computePersonalFit,
  profileCompleteness,
} from '../personalization/personal-fit';
import { fitAttributes } from '../personalization/fit-attributes';
import { buildRows, buildSummary, metric } from './comparison-helpers';

const PRODUCT_ROWS: {
  key: ComparisonMetricKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'opportunity',
    label: 'Opportunity Score',
    description:
      'Sprint 6 product opportunity score (same for every organization).',
  },
  {
    key: 'personalFit',
    label: 'Personal Fit',
    description:
      'Relevance to your profile — separate from the opportunity score.',
  },
  {
    key: 'demand',
    label: 'Demand',
    description: 'Higher = stronger export demand.',
  },
  {
    key: 'growth',
    label: 'Growth',
    description: 'Export growth signal (from CAGR).',
  },
  {
    key: 'competition',
    label: 'Competition',
    description: 'Higher = less competition.',
  },
  {
    key: 'compliance',
    label: 'Compliance',
    description: 'Higher = easier compliance.',
  },
  {
    key: 'investment',
    label: 'Investment',
    description: 'Higher = lower capital intensity.',
  },
  {
    key: 'margin',
    label: 'Margin Potential',
    description: 'Indicative dataset signal — not actual margin.',
  },
  {
    key: 'logistics',
    label: 'Logistics',
    description: 'Higher = easier logistics.',
  },
  {
    key: 'seasonality',
    label: 'Seasonality',
    description: 'Higher = more stable through the year.',
  },
  {
    key: 'confidence',
    label: 'Confidence',
    description: 'Data confidence — not attractiveness.',
  },
];

const MARKET_ROWS: {
  key: ComparisonMetricKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'opportunity',
    label: 'Market Opportunity Score',
    description:
      'Sprint 7 market score for this product (same for every organization).',
  },
  {
    key: 'personalFit',
    label: 'Personal Fit',
    description: 'Relevance to your profile — separate from the market score.',
  },
  {
    key: 'demand',
    label: 'Demand',
    description: 'Import demand for this product.',
  },
  {
    key: 'growth',
    label: 'Growth',
    description: 'Import growth for this product.',
  },
  {
    key: 'indiaPresence',
    label: 'India Presence',
    description: 'India’s current share of imports.',
  },
  {
    key: 'tariff',
    label: 'Tariff',
    description: 'Higher = more attractive (illustrative sample tariffs).',
  },
  {
    key: 'competition',
    label: 'Competition',
    description: 'Higher = less competition.',
  },
  {
    key: 'logistics',
    label: 'Logistics',
    description:
      'Logistics suitability and indicative route complexity — not a freight rate.',
  },
  {
    key: 'marketEntry',
    label: 'Market Entry',
    description: 'Higher = easier entry.',
  },
  {
    key: 'countryRisk',
    label: 'Country Risk',
    description: 'Higher = lower risk.',
  },
  {
    key: 'currencyRisk',
    label: 'Currency Risk',
    description: 'Higher = more stable currency.',
  },
  {
    key: 'margin',
    label: 'Margin Potential',
    description:
      'Product-level indicative signal — the same for every market in this dataset.',
  },
  {
    key: 'confidence',
    label: 'Confidence',
    description: 'Data confidence — not attractiveness.',
  },
];

const t = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

@Injectable()
export class ComparisonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly productIntelligence: ProductIntelligenceService,
    private readonly countryIntelligence: CountryIntelligenceService,
    private readonly personalization: PersonalizationService,
    @Inject(PRODUCT_TRADE_DATA_PROVIDER)
    private readonly productData: ProductTradeDataProvider,
  ) {}

  async compareProducts(
    organizationId: string,
    productIdsRaw: string[],
  ): Promise<ProductComparisonResponse> {
    const productIds = [...new Set(productIdsRaw)];
    if (productIds.length < 2 || productIds.length > 5)
      throw new BadRequestException(
        'Select between 2 and 5 different products to compare.',
      );
    const rows = await this.prisma.organizationProduct.findMany({
      where: { organizationId, id: { in: productIds } },
    });
    // Every product must belong to the current organization; reveal nothing about others.
    if (rows.length !== productIds.length)
      throw new NotFoundException('One or more products were not found.');
    const profile = await this.personalization.loadProfile(organizationId);

    const items: ProductComparisonItem[] = [];
    for (const id of productIds) {
      const p = rows.find((r) => r.id === id)!;
      const summary = this.products.toSummary(p);
      const base = {
        id,
        product: summary,
        metrics: [],
        personalFit: null,
        strengths: [],
        risks: [],
        source: null,
        confidence: null,
      };
      if (!isEligible(p)) {
        items.push({
          ...base,
          status: 'CLASSIFICATION_REQUIRED',
          message: 'Confirm classification before comparing this product.',
        });
        continue;
      }
      const match = this.productData.find({
        codeSystem: p.codeSystem as CodeSystem,
        classificationCode: p.classificationCode,
        hsCode: p.hsCode,
      });
      if (!match) {
        items.push({
          ...base,
          status: 'NO_DATA',
          message: 'Trade intelligence is not available for this product yet.',
        });
        continue;
      }
      // Read-only reuse of Sprint 6 intelligence (stored snapshot when present).
      const intel = await this.productIntelligence.globalIntelligence(match);
      const sig = (k: string) => intel.risk.signals.find((s) => s.key === k)!;
      const growth = intel.opportunity.components.find(
        (c) => c.key === 'exportGrowth',
      )!.score;
      const fit = computePersonalFit(
        profile,
        fitAttributes(match, intel, null),
      );
      const seasonal = sig('seasonality');
      items.push({
        ...base,
        status: 'AVAILABLE',
        message: null,
        metrics: [
          metric(
            'opportunity',
            intel.opportunity.score,
            `${intel.opportunity.score}/100`,
          ),
          metric('personalFit', fit.score, `${fit.score}/100`),
          metric('demand', sig('demand').score, sig('demand').status),
          metric(
            'growth',
            growth,
            intel.trend.cagr.available
              ? `${intel.trend.cagr.valuePercent}% CAGR (${intel.trend.cagr.fromPeriod}–${intel.trend.cagr.toPeriod})`
              : 'CAGR unavailable',
          ),
          metric(
            'competition',
            sig('competition').score,
            sig('competition').status,
          ),
          metric(
            'compliance',
            sig('compliance').score,
            sig('compliance').status,
          ),
          metric('investment', sig('capital').score, sig('capital').status),
          metric('margin', sig('margin').score, sig('margin').status),
          metric('logistics', sig('logistics').score, sig('logistics').status),
          // Unassessed seasonality stays unavailable rather than a neutral number.
          metric(
            'seasonality',
            intel.seasonality.available ? seasonal.score : null,
            intel.seasonality.available
              ? seasonal.status
              : 'Unavailable (no monthly data)',
          ),
          metric(
            'confidence',
            intel.confidence,
            `${intel.confidence}/100 · ${t(intel.source.freshness)}`,
          ),
        ],
        personalFit: fit,
        strengths: intel.opportunity.strengths,
        risks: intel.opportunity.risks,
        source: {
          sourceName: intel.source.sourceName,
          isSample: intel.source.isSample,
          realTradeData:
            intel.provenance?.exportTrend?.provenanceType !== 'DEMO' &&
            Boolean(intel.provenance),
          freshness: intel.source.freshness,
          sourceDate: intel.source.sourceDate,
        },
        confidence: intel.confidence,
      });
    }

    const available = items.filter((i) => i.status === 'AVAILABLE');
    const comparisonRows = buildRows(PRODUCT_ROWS, available);
    return {
      items,
      rows: comparisonRows,
      summary: buildSummary(
        comparisonRows,
        available.map((i) => ({
          id: i.id,
          name: i.product.displayName,
          metrics: i.metrics,
          extraStrengths: i.strengths,
          extraRisks: i.risks,
        })),
        'opportunity',
      ),
      profile: profileCompleteness(profile),
    };
  }

  async compareMarkets(
    organizationId: string,
    productId: string,
    countryCodesRaw: string[],
  ): Promise<MarketComparisonResponse> {
    const codes = [...new Set(countryCodesRaw.map((c) => c.toUpperCase()))];
    if (codes.length < 2 || codes.length > 5)
      throw new BadRequestException(
        'Select between 2 and 5 different countries to compare.',
      );
    const unknown = codes.filter((c) => !COUNTRY_META[c]);
    if (unknown.length)
      throw new BadRequestException(
        `Unknown country code: ${unknown.join(', ')}.`,
      );

    // Sprint 7 does the ownership check, eligibility and scoring (with shared personal fit) once for all markets.
    const ranking = await this.countryIntelligence.productMarkets(
      organizationId,
      productId,
      { pageSize: 50 },
    );
    const profile = await this.personalization.loadProfile(organizationId);
    const base = {
      product: ranking.product,
      profile: profileCompleteness(profile),
    };
    const empty = {
      headline: null,
      bestItemId: null,
      reasons: [],
      tradeOffs: [],
      note: '',
    };
    if (ranking.status !== 'AVAILABLE') {
      return {
        ...base,
        status:
          ranking.status === 'CLASSIFICATION_REQUIRED'
            ? 'CLASSIFICATION_REQUIRED'
            : 'NO_DATA',
        message: ranking.message,
        items: [],
        rows: [],
        summary: empty,
        availableCountries: [],
      };
    }
    const product = await this.prisma.organizationProduct.findFirstOrThrow({
      where: { id: productId, organizationId },
    });
    const match = this.productData.find({
      codeSystem: product.codeSystem as CodeSystem,
      classificationCode: product.classificationCode,
      hsCode: product.hsCode,
    });
    const margin = match?.dataset.signals.marginPotential ?? null;
    const source = ranking.source!;

    const items: MarketComparisonItem[] = codes.map((cc) => {
      const r = ranking.items.find((x) => x.country.code === cc);
      if (!r) {
        return {
          id: cc,
          country: COUNTRY_META[cc],
          status: 'NOT_SUPPORTED',
          metrics: [],
          personalFit: null,
          routeComplexity: null,
          tariffAvailable: false,
          reasons: [],
          risks: [],
          source: null,
          confidence: null,
        };
      }
      const c = r.components;
      return {
        id: cc,
        country: r.country,
        status: 'AVAILABLE',
        metrics: [
          metric(
            'opportunity',
            r.opportunityScore,
            `${r.opportunityScore}/100`,
          ),
          metric(
            'personalFit',
            r.personalFit?.score ?? null,
            r.personalFit ? `${r.personalFit.score}/100` : 'No profile',
          ),
          metric('demand', c.demand, `${c.demand}/100`),
          metric('growth', c.growth, `${c.growth}/100`),
          metric('indiaPresence', c.indiaPresence, `${c.indiaPresence}/100`),
          // Missing tariff is shown as unavailable — never as 0 (the base score uses a neutral value and lowers confidence).
          metric(
            'tariff',
            r.tariffAvailable ? c.tariff : null,
            r.tariffAvailable
              ? `${c.tariff}/100 (illustrative)`
              : 'Unavailable',
          ),
          metric('competition', c.competition, `${c.competition}/100`),
          metric(
            'logistics',
            c.logistics,
            `${c.logistics}/100 · ${t(r.routeComplexity)} route complexity (indicative)`,
          ),
          metric(
            'marketEntry',
            r.marketEntryEase,
            `${t(r.marketEntry)} (${r.marketEntryEase}/100)`,
          ),
          metric('countryRisk', c.countryRisk, `${t(r.countryRiskLevel)} risk`),
          metric('currencyRisk', c.currency, `${t(r.currencyRiskLevel)} risk`),
          metric(
            'margin',
            margin,
            margin === null ? 'Unavailable' : `${margin}/100 (product-level)`,
          ),
          metric(
            'confidence',
            r.confidence,
            `${r.confidence}/100 · ${t(source.freshness)}`,
          ),
        ],
        personalFit: r.personalFit,
        routeComplexity: r.routeComplexity,
        tariffAvailable: r.tariffAvailable,
        reasons: r.reasons,
        risks: r.risks,
        source: {
          sourceName: source.sourceName,
          isSample: source.isSample,
          realTradeData: r.realTradeData,
          freshness: source.freshness,
          sourceDate: source.sourceDate,
        },
        confidence: r.confidence,
      };
    });

    const available = items.filter((i) => i.status === 'AVAILABLE');
    const rows = buildRows(MARKET_ROWS, available);
    return {
      ...base,
      status: 'AVAILABLE',
      message: null,
      items,
      rows,
      summary: buildSummary(
        rows,
        available.map((i) => ({
          id: i.id,
          name: i.country.name,
          metrics: i.metrics,
          extraStrengths: i.reasons,
          extraRisks: i.risks,
        })),
        'market',
        ['opportunity', 'confidence', 'personalFit', 'margin'],
      ),
      availableCountries: ranking.items
        .map((r) => r.country)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}
