import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationProduct, Prisma } from '@prisma/client';
import {
  CodeSystem,
  ComplianceDifficulty,
  CompetitionLevel,
  FreshnessStatus,
  IntelligenceLevel,
  ProductIntelligence,
  ProductIntelligenceResponse,
  ProductIntelligenceSummaryItem,
  RiskSignal,
  SourceMetadata,
  TradeTrendPoint,
  TrendPeriodOption,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { nameSimilarity, ProductsService } from '../products/products.service';
import {
  cagr,
  clamp,
  exportStrengthScore,
  favorability,
  hhi,
  hhiLevel,
  OPPORTUNITY_WEIGHTS,
  OpportunityComponents,
  seasonality as seasonalityOf,
  sumTop,
  weightedOpportunityScore,
  yoyGrowth,
} from './intelligence-calculations';
import {
  PRODUCT_TRADE_DATA_PROVIDER,
  ProductTradeDataProvider,
  ProductTradeDataset,
  TradeDatasetMatch,
} from './providers/product-trade-data.provider';
import { INDIAN_STATES } from './indian-states';

/** Global, product-code-level intelligence persisted in the snapshot (no tenant data). */
type GlobalIntelligence = Omit<
  ProductIntelligence,
  'product' | 'personalFit' | 'status'
>;

const NO_DATA_MESSAGE =
  'Trade intelligence is not available for this product yet.';
const CLASSIFICATION_MESSAGE =
  'Confirm product classification before viewing detailed intelligence. A confirmed HS heading (4 digits) or more specific code is required.';

const COMPONENT_LABELS: Record<keyof OpportunityComponents, string> = {
  demand: 'Demand',
  exportGrowth: 'Export growth',
  indiaStrength: 'India export strength',
  competition: 'Competition attractiveness',
  compliance: 'Compliance ease',
  logistics: 'Logistics ease',
  supply: 'Supply resilience',
  margin: 'Indicative margin potential',
  seasonality: 'Seasonality stability',
};

const INVESTMENT_ORDER = [
  'UNDER_1L',
  'L1_5',
  'L5_10',
  'L10_25',
  'L25_50',
  'L50_1CR',
  'ABOVE_1CR',
];

const fmtUsd = (v: number) =>
  v >= 1e9
    ? `$${(v / 1e9).toFixed(2)}B`
    : v >= 1e6
      ? `$${(v / 1e6).toFixed(1)}M`
      : `$${Math.round(v).toLocaleString('en-US')}`;

export function freshnessOf(
  sourceDate: string,
  now = new Date(),
): FreshnessStatus {
  const days = (now.getTime() - new Date(sourceDate).getTime()) / 86_400_000;
  if (!Number.isFinite(days)) return 'UNKNOWN';
  if (days <= 120) return 'FRESH';
  if (days <= 365) return 'RECENT';
  return 'STALE';
}

@Injectable()
export class ProductIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
    @Inject(PRODUCT_TRADE_DATA_PROVIDER)
    private readonly provider: ProductTradeDataProvider,
  ) {}

  /** Tenant ownership is checked first; only then is the shared, global intelligence loaded. */
  async getForProduct(
    organizationId: string,
    userId: string,
    productId: string,
  ): Promise<ProductIntelligenceResponse> {
    const product = await this.prisma.organizationProduct.findFirst({
      where: { id: productId, organizationId },
    });
    if (!product) throw new NotFoundException('Product not found.');
    const summary = this.products.toSummary(product);

    if (!isEligible(product)) {
      return {
        product: summary,
        status: 'CLASSIFICATION_REQUIRED',
        message: CLASSIFICATION_MESSAGE,
      };
    }
    const match = this.match(product);
    if (!match)
      return { product: summary, status: 'NO_DATA', message: NO_DATA_MESSAGE };

    const intelligence = await this.loadOrGenerate(
      match,
      organizationId,
      userId,
      product.id,
    );
    return {
      ...intelligence,
      product: summary,
      status: 'AVAILABLE',
      personalFit: await this.personalFit(organizationId, intelligence),
    };
  }

  /** Cheap list-level status: reads existing snapshots only, never generates. */
  async summary(
    organizationId: string,
    productIds: string[],
  ): Promise<ProductIntelligenceSummaryItem[]> {
    const products = await this.prisma.organizationProduct.findMany({
      where: { organizationId, id: { in: productIds.slice(0, 100) } },
    });
    const matches = new Map(
      products.map((p) => [p.id, isEligible(p) ? this.match(p) : null]),
    );
    const keys = [...matches.values()].filter((m): m is TradeDatasetMatch =>
      Boolean(m),
    );
    const snapshots = keys.length
      ? await this.prisma.productIntelligenceSnapshot.findMany({
          where: {
            OR: keys.map((m) => ({
              datasetKey: m.dataset.datasetKey,
              datasetVersion: m.dataset.datasetVersion,
            })),
          },
          select: {
            datasetKey: true,
            datasetVersion: true,
            opportunityScore: true,
            confidence: true,
          },
        })
      : [];
    return products.map((p) => {
      if (!isEligible(p))
        return {
          productId: p.id,
          status: 'CLASSIFICATION_REQUIRED',
          opportunityScore: null,
          confidence: null,
        };
      const m = matches.get(p.id);
      if (!m)
        return {
          productId: p.id,
          status: 'NO_DATA',
          opportunityScore: null,
          confidence: null,
        };
      const snap = snapshots.find(
        (s) =>
          s.datasetKey === m.dataset.datasetKey &&
          s.datasetVersion === m.dataset.datasetVersion,
      );
      return snap
        ? {
            productId: p.id,
            status: 'AVAILABLE',
            opportunityScore: snap.opportunityScore,
            confidence: snap.confidence,
          }
        : {
            productId: p.id,
            status: 'NOT_GENERATED',
            opportunityScore: null,
            confidence: null,
          };
    });
  }

  private match(product: OrganizationProduct): TradeDatasetMatch | null {
    return this.provider.find({
      codeSystem: product.codeSystem as CodeSystem,
      classificationCode: product.classificationCode,
      hsCode: product.hsCode,
    });
  }

  private async loadOrGenerate(
    match: TradeDatasetMatch,
    organizationId: string,
    userId: string,
    productId: string,
  ) {
    const { dataset } = match;
    const key = {
      datasetKey: dataset.datasetKey,
      datasetVersion: dataset.datasetVersion,
    };
    const existing = await this.prisma.productIntelligenceSnapshot.findUnique({
      where: { datasetKey_datasetVersion: key },
    });
    if (existing)
      return this.withMatch(
        existing.payload as unknown as GlobalIntelligence,
        match,
        existing.generatedAt,
      );

    const computed = await this.compute(dataset);
    try {
      const created = await this.prisma.productIntelligenceSnapshot.create({
        data: {
          ...key,
          codeSystem: dataset.codeSystem,
          code: dataset.code,
          sourceType: dataset.source.sourceType,
          sourceName: dataset.source.sourceName,
          opportunityScore: computed.opportunity.score,
          confidence: computed.confidence,
          components: Object.fromEntries(
            computed.opportunity.components.map((c) => [c.key, c.score]),
          ),
          payload: computed as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.record({
        organizationId,
        actorId: userId,
        action: 'product_intelligence.generated',
        entityType: 'ProductIntelligenceSnapshot',
        entityId: created.id,
        metadata: {
          ...key,
          productId,
          opportunityScore: computed.opportunity.score,
          confidence: computed.confidence,
        },
      });
      return this.withMatch(computed, match, created.generatedAt);
    } catch (error) {
      // Concurrent first view generated the same snapshot — use that one.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const row =
          await this.prisma.productIntelligenceSnapshot.findUniqueOrThrow({
            where: { datasetKey_datasetVersion: key },
          });
        return this.withMatch(
          row.payload as unknown as GlobalIntelligence,
          match,
          row.generatedAt,
        );
      }
      throw error;
    }
  }

  /** The match level depends on the requesting product's code, so it is applied per request. */
  private withMatch(
    intel: GlobalIntelligence,
    match: TradeDatasetMatch,
    generatedAt: Date,
  ): GlobalIntelligence {
    const headingPenalty = match.level === 'HS_HEADING' ? 15 : 0;
    return {
      ...intel,
      match: {
        level: match.level,
        matchedCode: match.matchedCode,
        datasetLabel: match.dataset.label,
      },
      confidence: Math.max(0, intel.confidence - headingPenalty),
      generatedAt: generatedAt.toISOString(),
    };
  }

  // --- Computation (deterministic; no AI) --------------------------------

  async compute(d: ProductTradeDataset): Promise<GlobalIntelligence> {
    const yearly = [...d.yearly].sort((a, b) =>
      a.period.localeCompare(b.period),
    );
    const monthly = [...d.monthly].sort((a, b) =>
      a.period.localeCompare(b.period),
    );
    const latest = yearly[yearly.length - 1];
    const previous = yearly.length > 1 ? yearly[yearly.length - 2] : null;
    const quantityAvailable =
      d.quantityUnit !== null && yearly.some((p) => p.quantity !== null);

    const yearlyPoints: TradeTrendPoint[] = yearly.map((p, i) => ({
      period: p.period,
      exportValue: p.value,
      exportQuantity: quantityAvailable ? p.quantity : null,
      growthPercent: i === 0 ? null : yoyGrowth(p.value, yearly[i - 1].value),
    }));
    const monthlyPoints: TradeTrendPoint[] = monthly.map((p) => {
      const [yr, mo] = p.period.split('-');
      const sameMonthLastYear = monthly.find(
        (m) => m.period === `${Number(yr) - 1}-${mo}`,
      );
      return {
        period: p.period,
        exportValue: p.value,
        exportQuantity: quantityAvailable ? p.quantity : null,
        growthPercent: sameMonthLastYear
          ? yoyGrowth(p.value, sameMonthLastYear.value)
          : null,
      };
    });

    const overallCagr = cagr(yearly);
    const periodOptions: TrendPeriodOption[] = [];
    for (const [key, years] of [
      ['3Y', 3],
      ['5Y', 5],
    ] as const) {
      const from = String(Number(latest.period) - years);
      const window = yearly.filter((p) => p.period >= from);
      if (window.length === years + 1) {
        periodOptions.push({
          key,
          label: `${years} years`,
          fromPeriod: from,
          toPeriod: latest.period,
          cagr: cagr(window),
        });
      }
    }
    if (!periodOptions.some((o) => o.fromPeriod === yearly[0].period)) {
      periodOptions.push({
        key: 'ALL',
        label: 'All available',
        fromPeriod: yearly[0].period,
        toPeriod: latest.period,
        cagr: overallCagr,
      });
    }

    // --- Source & confidence
    const freshness = freshnessOf(d.source.sourceDate);
    const freshnessScore = { FRESH: 100, RECENT: 75, STALE: 40, UNKNOWN: 20 }[
      freshness
    ];
    const completenessChecks = [
      quantityAvailable,
      monthly.length >= 12,
      d.districts.length > 0,
      d.ports.length > 0,
      d.destinations.length >= 5,
      yearly.length >= 5,
    ];
    const completeness =
      (completenessChecks.filter(Boolean).length / completenessChecks.length) *
      100;
    const granularity =
      (monthly.length >= 12 ? 50 : 0) + (d.districts.length > 0 ? 50 : 0);
    const quality = d.source.quality;
    // A sample/low-quality source can never be "highly confident", however complete it is.
    const confidence = Math.round(
      Math.min(
        quality + 20,
        0.45 * quality +
          0.2 * freshnessScore +
          0.2 * completeness +
          0.15 * granularity,
      ),
    );

    const source: SourceMetadata = {
      sourceType: d.source.sourceType,
      sourceName: d.source.sourceName,
      sourceUrl: d.source.sourceUrl,
      sourceDate: d.source.sourceDate,
      lastUpdatedAt: d.source.lastUpdatedAt,
      freshness,
      datasetVersion: d.datasetVersion,
      coverageFrom: yearly[0].period,
      coverageTo: latest.period,
      isSample: d.source.sourceType === 'DEMO',
    };

    // --- Seasonality
    const season = seasonalityOf(monthly);
    const seasonalityConfidence = season.available
      ? Math.max(0, confidence - (season.monthsOfData < 24 ? 15 : 0))
      : 0;
    const seasonalityExplanation = !season.available
      ? 'Monthly data is not available for this dataset, so seasonality cannot be assessed.'
      : season.level === 'LOW'
        ? `Exports are spread fairly evenly through the year (peak quarter ${season.peakQuarterSharePercent}% of annual value).`
        : `Exports concentrate in ${season.strongestQuarter} (${season.peakQuarterSharePercent}% of annual value); weakest in ${season.weakestQuarter}.` +
          (season.monthsOfData < 24
            ? ' Based on a single year of monthly data.'
            : '');

    // --- India ecosystem
    const stateRef = (code: string) =>
      INDIAN_STATES[code] ?? { name: code, region: 'Other' };
    const states = [...d.states]
      .sort((a, b) => b.sharePercent - a.sharePercent)
      .map((s, i) => ({
        rank: i + 1,
        stateCode: s.stateCode,
        stateName: stateRef(s.stateCode).name,
        region: stateRef(s.stateCode).region,
        contributionPercent: s.sharePercent,
        indicativeExportValue: Math.round(
          (latest.value * s.sharePercent) / 100,
        ),
      }));
    const regionTotals = new Map<string, { share: number; count: number }>();
    for (const s of states) {
      const r = regionTotals.get(s.region) ?? { share: 0, count: 0 };
      regionTotals.set(s.region, {
        share: r.share + s.contributionPercent,
        count: r.count + 1,
      });
    }
    const regions = [...regionTotals.entries()]
      .map(([region, r]) => ({
        region,
        contributionPercent: Math.round(r.share * 10) / 10,
        stateCount: r.count,
      }))
      .sort((a, b) => b.contributionPercent - a.contributionPercent);
    const stateShares = states.map((s) => s.contributionPercent);
    const stateHhi = hhi(stateShares);
    const stateConcentration = {
      topTwoSharePercent: sumTop(stateShares, 2),
      hhi: stateHhi,
      level: hhiLevel(stateHhi),
    };
    const districts = [...d.districts]
      .sort((a, b) => b.sharePercent - a.sharePercent)
      .map((x, i) => ({
        rank: i + 1,
        district: x.district,
        stateName: stateRef(x.stateCode).name,
        contributionPercent: x.sharePercent,
      }));
    const ports = [...d.ports]
      .sort((a, b) => b.sharePercent - a.sharePercent)
      .map((p, i) => ({
        rank: i + 1,
        portName: p.portName,
        stateName: stateRef(p.stateCode).name,
        contributionPercent: p.sharePercent,
        indicativeExportValue: Math.round(
          (latest.value * p.sharePercent) / 100,
        ),
      }));

    // --- Destinations (descriptive)
    const destinations = [...d.destinations]
      .sort((a, b) => b.sharePercent - a.sharePercent)
      .map((x, i) => ({
        rank: i + 1,
        countryCode: x.countryCode,
        sharePercent: x.sharePercent,
        indicativeExportValue: Math.round(
          (latest.value * x.sharePercent) / 100,
        ),
        growthPercent: x.growthPercent,
      }));
    const destShares = destinations.map((x) => x.sharePercent);
    const destHhi = hhi(destShares);
    const top3 = sumTop(destShares, 3);
    const concentrationLevel = hhiLevel(destHhi);
    const concentration = {
      topThreeSharePercent: top3,
      topFiveSharePercent: sumTop(destShares, 5),
      hhi: destHhi,
      level: concentrationLevel,
      explanation: `Top 3 markets account for ${top3}% of exports — ${
        concentrationLevel === 'LOW'
          ? 'a broad, diversified destination base'
          : concentrationLevel === 'MODERATE'
            ? 'moderate market concentration'
            : 'high market concentration'
      }.`,
    };

    // --- Scores (0–100, higher = more favorable)
    const g = overallCagr.valuePercent ?? 0;
    const latestYoy = previous ? yoyGrowth(latest.value, previous.value) : null;
    const diversity = destinations.filter((x) => x.sharePercent >= 3).length;
    const oppDemand = await this.opportunityDemandSignal(d);
    const dataDemand = clamp(
      50 +
        clamp(g * 2, -30, 30) +
        clamp((diversity - 5) * 2, -10, 10) +
        clamp((latestYoy ?? 0) * 0.5, -10, 10),
    );
    const demand = Math.round(
      oppDemand === null ? dataDemand : 0.7 * dataDemand + 0.3 * oppDemand,
    );
    const exportGrowth = Math.round(clamp(50 + g * 3));
    const indiaStrength = exportStrengthScore(latest.value);
    const topPortShare = ports[0]?.contributionPercent ?? 0;
    const logistics = Math.round(
      clamp(
        d.signals.logisticsEase -
          (topPortShare > 60 ? 5 : 0) -
          (d.signals.perishable ? 10 : 0),
      ),
    );
    const qtyGrowths = quantityAvailable
      ? yearly
          .slice(1)
          .map((p, i) => yoyGrowth(p.quantity, yearly[i].quantity))
          .filter((v): v is number => v !== null)
      : [];
    const qtyVolatility = qtyGrowths.length >= 2 ? stdev(qtyGrowths) : 0;
    const seasonalityStability = !season.available
      ? 55
      : season.level === 'LOW'
        ? 85
        : season.level === 'MODERATE'
          ? 60
          : 35;
    const supply = Math.round(
      clamp(
        100 -
          stateHhi / 70 -
          (season.level === 'HIGH' ? 10 : 0) -
          (qtyVolatility > 20 ? 10 : qtyVolatility > 10 ? 5 : 0),
      ),
    );
    const components: OpportunityComponents = {
      demand,
      exportGrowth,
      indiaStrength,
      competition: d.signals.competition,
      compliance: d.signals.complianceEase,
      logistics,
      supply,
      margin: d.signals.marginPotential,
      seasonality: seasonalityStability,
    };
    const opportunityScore = weightedOpportunityScore(components);

    // --- Explanations (rule-based)
    const topStates = states.slice(0, 2);
    const strengths: string[] = [];
    const risks: string[] = [];
    if (overallCagr.available && g >= 8)
      strengths.push(
        `Strong historical export growth (${g}% CAGR ${overallCagr.fromPeriod}–${overallCagr.toPeriod})`,
      );
    else if (overallCagr.available && g > 0)
      strengths.push(
        `Positive export growth (${g}% CAGR ${overallCagr.fromPeriod}–${overallCagr.toPeriod})`,
      );
    if (indiaStrength >= 70)
      strengths.push(
        `Strong Indian export presence (${fmtUsd(latest.value)} in ${latest.period})`,
      );
    if (concentrationLevel === 'LOW')
      strengths.push(`Broad destination base — top 3 markets take ${top3}%`);
    if (logistics >= 70) strengths.push('Favorable logistics profile');
    if (d.signals.competition >= 67)
      strengths.push('Relatively low competitive pressure');
    if (d.signals.complianceEase >= 70)
      strengths.push('Comparatively simple compliance profile');
    if (supply >= 65)
      strengths.push(`Diversified supply base across ${states.length} states`);
    if (season.available && season.level === 'LOW')
      strengths.push('Stable exports through the year');

    if (overallCagr.available && g < 0)
      risks.push(
        `Exports declining (${g}% CAGR ${overallCagr.fromPeriod}–${overallCagr.toPeriod})`,
      );
    if (latestYoy !== null && latestYoy < 0 && g >= 0)
      risks.push(`Exports fell ${Math.abs(latestYoy)}% in ${latest.period}`);
    if (concentrationLevel !== 'LOW')
      risks.push(
        `Export demand concentrated in few markets — top 3 take ${top3}%`,
      );
    if (supply < 40)
      risks.push(
        `High supply concentration — ${topStates.map((s) => s.stateName).join(' and ')} supply ${stateConcentration.topTwoSharePercent}%`,
      );
    if (season.available && season.level === 'HIGH')
      risks.push(
        `Significant seasonality — exports peak in ${season.strongestQuarter}`,
      );
    if (d.signals.complianceEase < 60)
      risks.push('Higher compliance complexity');
    if (d.signals.competition < 40)
      risks.push('Strong international competition');
    if (d.signals.capitalIntensity === 'HIGH')
      risks.push('Higher capital intensity');
    if (qtyVolatility > 20) risks.push('Volatile export volumes year to year');

    // --- Risk matrix
    const dataSignalConfidence = Math.min(confidence, quality);
    const competitionLevel: CompetitionLevel =
      d.signals.competition >= 67
        ? 'LOW'
        : d.signals.competition >= 40
          ? 'MODERATE'
          : 'HIGH';
    const complianceLevel: ComplianceDifficulty =
      d.signals.complianceEase >= 67
        ? 'EASY'
        : d.signals.complianceEase >= 40
          ? 'MODERATE'
          : 'COMPLEX';
    const logisticsLevel: ComplianceDifficulty =
      logistics >= 67 ? 'EASY' : logistics >= 40 ? 'MODERATE' : 'COMPLEX';
    const supplyRisk: IntelligenceLevel =
      supply >= 65 ? 'LOW' : supply >= 40 ? 'MODERATE' : 'HIGH';
    const capitalScore = { LOW: 80, MODERATE: 55, HIGH: 30 }[
      d.signals.capitalIntensity
    ];
    const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

    const signals: RiskSignal[] = [
      {
        key: 'demand',
        label: 'Demand',
        score: demand,
        level: favorability(demand),
        status: `${titleCase(favorability(demand))} demand`,
        explanation: `Based on ${overallCagr.available ? `${g}% CAGR` : 'available trend'}, ${diversity} destinations with ≥3% share${oppDemand === null ? '' : ' and the opportunity dataset demand signal'}.`,
        confidence,
      },
      {
        key: 'competition',
        label: 'Competition',
        score: d.signals.competition,
        level: competitionLevel,
        status: `${titleCase(competitionLevel)} competition`,
        explanation:
          'Dataset signal for international competitive pressure; a higher score means less competition.',
        confidence: dataSignalConfidence,
      },
      {
        key: 'compliance',
        label: 'Compliance',
        score: d.signals.complianceEase,
        level: complianceLevel,
        status: titleCase(complianceLevel),
        explanation:
          'General product-level compliance signal from the dataset — not country-specific rules.',
        confidence: dataSignalConfidence,
      },
      {
        key: 'logistics',
        label: 'Logistics',
        score: logistics,
        level: logisticsLevel,
        status: titleCase(logisticsLevel),
        explanation: `Dataset shipping profile${d.signals.perishable ? ', perishable cargo' : ', non-perishable'}; top port handles ${topPortShare}% of exports.`,
        confidence: dataSignalConfidence,
      },
      {
        key: 'supply',
        label: 'Supply risk',
        score: supply,
        level: supplyRisk,
        status: `${titleCase(supplyRisk)} risk`,
        explanation:
          supplyRisk === 'LOW'
            ? `Supply spread across ${states.length} states (top 2: ${stateConcentration.topTwoSharePercent}%).`
            : `High reliance on ${topStates.map((s) => s.stateName).join(' and ')} (${stateConcentration.topTwoSharePercent}% of supply) increases regional concentration${season.level === 'HIGH' ? ', compounded by seasonality' : ''}.`,
        confidence,
      },
      {
        key: 'seasonality',
        label: 'Seasonality',
        score: seasonalityStability,
        level: season.level ?? 'MODERATE',
        status: season.available
          ? `${titleCase(season.level!)} seasonality`
          : 'Not assessed',
        explanation: seasonalityExplanation,
        confidence: seasonalityConfidence,
      },
      {
        key: 'capital',
        label: 'Capital intensity',
        score: capitalScore,
        level: d.signals.capitalIntensity,
        status: `${titleCase(d.signals.capitalIntensity)} capital intensity`,
        explanation:
          'Broad category-level estimate of capital needed — not a working-capital calculation.',
        confidence: dataSignalConfidence,
      },
      {
        key: 'margin',
        label: 'Indicative margin',
        score: d.signals.marginPotential,
        level: favorability(d.signals.marginPotential),
        status: `${titleCase(favorability(d.signals.marginPotential))} margin potential`,
        explanation:
          'Indicative dataset estimate only — not actual or guaranteed profitability.',
        confidence: dataSignalConfidence,
      },
    ];

    return {
      match: {
        level: 'HS_SUBHEADING',
        matchedCode: d.code,
        datasetLabel: d.label,
      },
      source,
      opportunity: {
        score: opportunityScore,
        components: (
          Object.keys(OPPORTUNITY_WEIGHTS) as (keyof OpportunityComponents)[]
        ).map((k) => ({
          key: k,
          label: COMPONENT_LABELS[k],
          weight: OPPORTUNITY_WEIGHTS[k],
          score: components[k],
        })),
        strengths,
        risks,
      },
      confidence,
      trend: {
        currency: d.currency,
        value: {
          latestPeriod: latest.period,
          latestValue: latest.value,
          previousValue: previous?.value ?? null,
          yoyGrowthPercent: latestYoy,
          currency: d.currency,
        },
        quantity: {
          available: quantityAvailable,
          unit: quantityAvailable ? d.quantityUnit : null,
          latestValue: quantityAvailable ? latest.quantity : null,
          yoyGrowthPercent:
            quantityAvailable && previous
              ? yoyGrowth(latest.quantity, previous.quantity)
              : null,
        },
        cagr: overallCagr,
        yearly: yearlyPoints,
        monthly: monthlyPoints,
        periodOptions,
        confidence: Math.max(0, confidence - (quantityAvailable ? 0 : 10)),
      },
      seasonality: {
        available: season.available,
        level: season.level,
        strongestMonths: season.strongestMonths,
        weakestMonths: season.weakestMonths,
        strongestQuarter: season.strongestQuarter,
        weakestQuarter: season.weakestQuarter,
        peakQuarterSharePercent: season.peakQuarterSharePercent,
        monthsOfData: season.monthsOfData,
        explanation: seasonalityExplanation,
        confidence: seasonalityConfidence,
      },
      ecosystem: {
        states,
        districtsAvailable: districts.length > 0,
        districts,
        ports,
        regions,
        stateConcentration,
        confidence: Math.max(0, confidence - (districts.length ? 0 : 10)),
      },
      markets: { destinations, concentration, confidence },
      risk: {
        signals,
        capitalIntensity: d.signals.capitalIntensity,
        indicativeMarginNote:
          'Indicative dataset estimate — not actual profitability. Detailed costing and margin calculation come in a later module.',
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /** Aggregates Sprint 4 opportunity demand across destinations for the same product — never one row. */
  private async opportunityDemandSignal(
    d: ProductTradeDataset,
  ): Promise<number | null> {
    const rows = await this.prisma.opportunity.findMany({
      where: { productCategoryCode: d.categoryCode },
      select: { productName: true, demandScore: true },
    });
    const matching = rows.filter(
      (r) => nameSimilarity(r.productName, d.label) > 0.5,
    );
    if (matching.length === 0) return null;
    return matching.reduce((s, r) => s + r.demandScore, 0) / matching.length;
  }

  /** Contextual notes from the exporter profile. Never alters the global product score. */
  private async personalFit(
    organizationId: string,
    intel: GlobalIntelligence,
  ): Promise<string[]> {
    const [profile, targets] = await Promise.all([
      this.prisma.exporterProfile.findUnique({ where: { organizationId } }),
      this.prisma.targetCountry.findMany({
        where: { organizationId },
        select: { countryCode: true },
      }),
    ]);
    const notes: string[] = [];
    const capital = intel.risk.capitalIntensity;
    const range = profile?.investmentRange
      ? INVESTMENT_ORDER.indexOf(profile.investmentRange)
      : -1;
    if (
      range >= 0 &&
      ((capital === 'HIGH' && range <= 2) ||
        (capital === 'MODERATE' && range === 0))
    ) {
      notes.push(
        'May require more capital than your current preferred investment range.',
      );
    }
    const supply = intel.risk.signals.find((s) => s.key === 'supply');
    if (profile?.riskTolerance === 'CONSERVATIVE' && supply?.level === 'HIGH') {
      notes.push(
        'Supply concentration risk may not suit your conservative risk preference.',
      );
    }
    const topCodes = intel.markets.destinations
      .slice(0, 5)
      .map((x) => x.countryCode);
    const overlap = targets
      .map((t) => t.countryCode)
      .filter((c) => topCodes.includes(c));
    if (overlap.length > 0)
      notes.push(
        `${overlap.length} of your target markets ${overlap.length === 1 ? 'is' : 'are'} already among India's top 5 destinations for this product.`,
      );
    return notes;
  }
}

export function isEligible(p: OrganizationProduct): boolean {
  const confirmed =
    p.classificationStatus === 'USER_CONFIRMED' ||
    p.classificationStatus === 'OFFICIALLY_VERIFIED';
  return confirmed && p.hsCode.length >= 4;
}

function stdev(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length,
  );
}
