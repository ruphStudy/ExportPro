import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TradeDataSource, TradeFact } from '@prisma/client';
import { createHash } from 'crypto';
import type { DataProvenance, SourceQualityTier } from '@exportpro/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { computeFreshness, sourceConfidence } from '../reliability';

export const OVERLAY_CALCULATION_VERSION = 'trade-overlay-v1';
const TIER_ORDER: SourceQualityTier[] = ['A', 'B', 'C', 'D', 'DEMO'];

export interface YearPoint {
  year: number;
  valueUsd: number;
  quantity: number | null;
}

export interface RealProductTrade {
  hsCode: string;
  years: YearPoint[];
  quantityUnit: string | null;
  destinations: {
    countryCode: string;
    sharePercent: number;
    growthPercent: number | null;
  }[];
  latestYear: number;
  provenance: DataProvenance;
  version: string;
  qualityScore: number;
}

export interface RealMarketTrade {
  hsCode: string;
  countryCode: string;
  years: YearPoint[];
  quantityUnit: string | null;
  indiaSharePercent: number | null;
  indiaSharePreviousPercent: number | null;
  indiaRank: number | null;
  competitors: {
    countryCode: string;
    sharePercent: number;
    growthPercent: number | null;
  }[];
  unitValue: { current: number; previous: number | null; unit: string } | null;
  latestYear: number;
  provenance: DataProvenance;
  version: string;
  qualityScore: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const shortHash = (s: string) =>
  createHash('sha256').update(s).digest('hex').slice(0, 10);

/**
 * Read model over canonical TradeFacts for the intelligence modules.
 * Only enabled, non-demo sources; annual facts only (annual data is never
 * presented as monthly). When several sources cover the same series, the
 * deterministic priority is: higher quality tier, then fresher data, then
 * more years. Reloaded after every successful ingestion; on failure the
 * previous cache (last-known-good) stays in place.
 */
@Injectable()
export class TradeDataOverlayService implements OnModuleInit {
  private readonly logger = new Logger(TradeDataOverlayService.name);
  private products = new Map<string, RealProductTrade>();
  private markets = new Map<string, RealMarketTrade>();
  private globalVersion = 'none';

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
  }

  productTrade(hs6: string): RealProductTrade | null {
    return this.products.get(hs6) ?? null;
  }

  marketTrade(hs6: string, countryCode: string): RealMarketTrade | null {
    return this.markets.get(`${hs6}:${countryCode}`) ?? null;
  }

  /** Changes whenever any real market series changes — used for snapshot/dataset versions. */
  version(): string {
    return this.globalVersion;
  }

  async reload(): Promise<void> {
    try {
      const sources = await this.prisma.tradeDataSource.findMany({
        where: { enabled: true, sourceType: { not: 'DEMO' } },
      });
      if (sources.length === 0) {
        this.products = new Map();
        this.markets = new Map();
        this.globalVersion = 'none';
        return;
      }
      const facts = await this.prisma.tradeFact.findMany({
        where: {
          sourceId: { in: sources.map((s) => s.id) },
          periodType: 'YEAR',
          hsLevel: 6,
          normalizedValueUsd: { not: null },
        },
        orderBy: [{ year: 'asc' }],
      });
      const latestRuns = await this.prisma.tradeDataIngestionRun.findMany({
        where: {
          sourceId: { in: sources.map((s) => s.id) },
          status: { in: ['SUCCEEDED', 'PARTIAL'] },
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['sourceId'],
      });
      const runBySource = new Map(latestRuns.map((r) => [r.sourceId, r]));
      const sourceById = new Map(sources.map((s) => [s.id, s]));

      const groups = new Map<string, TradeFact[]>();
      for (const f of facts) {
        const key =
          f.tradeDirection === 'EXPORT' && f.reporterCountryCode === 'IN'
            ? `P|${f.hsCode}|${f.sourceId}`
            : f.tradeDirection === 'IMPORT'
              ? `M|${f.hsCode}|${f.reporterCountryCode}|${f.sourceId}`
              : null;
        if (!key) continue;
        groups.set(key, [...(groups.get(key) ?? []), f]);
      }

      const products = new Map<string, RealProductTrade>();
      const markets = new Map<string, RealMarketTrade>();
      for (const [key, rows] of groups) {
        const parts = key.split('|');
        const source = sourceById.get(parts[parts.length - 1])!;
        const prov = this.provenance(source, runBySource.get(source.id), rows);
        if (parts[0] === 'P') {
          const built = buildProduct(parts[1], rows, prov);
          if (built && better(built, products.get(parts[1])))
            products.set(parts[1], built);
        } else {
          const built = buildMarket(parts[1], parts[2], rows, prov);
          const k = `${parts[1]}:${parts[2]}`;
          if (built && better(built, markets.get(k))) markets.set(k, built);
        }
      }
      this.products = products;
      this.markets = markets;
      this.globalVersion = shortHash(
        [...products.values(), ...markets.values()]
          .map((x) => x.version)
          .sort()
          .join('|') || 'none',
      );
      this.logger.log(
        `Trade-data overlay loaded: ${products.size} product series, ${markets.size} market series.`,
      );
    } catch (error) {
      // Keep the last-known-good cache; never blank intelligence because a reload failed.
      this.logger.error(
        `Overlay reload failed; keeping previous data: ${(error as Error).message}`,
      );
    }
  }

  private provenance(
    source: TradeDataSource,
    run:
      | {
          recordsFetched: number;
          recordsAccepted: number;
          unresolvedMappings: number;
          finishedAt: Date | null;
        }
      | undefined,
    rows: TradeFact[],
  ): DataProvenance {
    const freshness = computeFreshness(
      source.updateFrequency,
      source.latestPeriodEnd,
      source.expectedLagDays,
    );
    const latestYear = Math.max(...rows.map((r) => r.year));
    return {
      sourceId: source.id,
      sourceCode: source.code,
      sourceName: source.name,
      sourceType: source.sourceType,
      authority: source.authority,
      official: source.official,
      sourceQuality: source.qualityTier,
      sourceDate: String(latestYear),
      lastIngestedAt:
        (run?.finishedAt ?? source.lastSuccessfulRunAt)?.toISOString() ?? null,
      freshness,
      confidence: sourceConfidence({
        tier: source.qualityTier,
        freshness,
        fetched: run?.recordsFetched,
        accepted: run?.recordsAccepted,
        unresolved: run?.unresolvedMappings,
      }),
      provenanceType: 'SOURCE_NORMALIZED',
      datasetVersion: `${source.code}:${shortHash(
        rows
          .map((r) => `${r.factKey}:${r.contentHash}`)
          .sort()
          .join('|'),
      )}`,
      derived: false,
      methodology: null,
    };
  }
}

const num = (d: unknown) => (d === null || d === undefined ? null : Number(d));

function yearTotals(rows: TradeFact[]): {
  points: YearPoint[];
  unit: string | null;
  method: string;
} {
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  let method = 'World totals as reported';
  const points: YearPoint[] = [];
  const units = new Set<string>();
  for (const y of years) {
    const yr = rows.filter((r) => r.year === y);
    const world = yr.find((r) => r.partnerEntityType === 'WORLD');
    if (world) {
      points.push({
        year: y,
        valueUsd: num(world.normalizedValueUsd)!,
        quantity: num(world.normalizedQuantity),
      });
      if (world.normalizedUnit) units.add(world.normalizedUnit);
    } else {
      // No reported total: sum partner countries (methodology disclosed).
      const countries = yr.filter((r) => r.partnerEntityType === 'COUNTRY');
      if (!countries.length) continue;
      method = 'Sum of reported partner countries (no World total in source)';
      const qtys = countries.map((r) => num(r.normalizedQuantity));
      const unitSet = new Set(
        countries.map((r) => r.normalizedUnit).filter(Boolean),
      );
      points.push({
        year: y,
        valueUsd: countries.reduce((s, r) => s + num(r.normalizedValueUsd)!, 0),
        quantity:
          qtys.every((q) => q !== null) && unitSet.size === 1
            ? qtys.reduce((s, q) => s! + q!, 0)
            : null,
      });
      unitSet.forEach((u) => units.add(u!));
    }
  }
  // Quantities across years must share one unit; otherwise they are not comparable and are dropped.
  const unit = units.size === 1 ? [...units][0] : null;
  return {
    points: unit ? points : points.map((p) => ({ ...p, quantity: null })),
    unit,
    method,
  };
}

function partnerShares(rows: TradeFact[], year: number, total: number) {
  return rows
    .filter(
      (r) =>
        r.year === year &&
        r.partnerEntityType === 'COUNTRY' &&
        r.partnerCountryCode,
    )
    .map((r) => ({
      code: r.partnerCountryCode!,
      value: num(r.normalizedValueUsd)!,
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((r) => ({
      ...r,
      share: total > 0 ? round1((100 * r.value) / total) : 0,
    }));
}

function growth(
  rows: TradeFact[],
  code: string,
  year: number,
  current: number,
): number | null {
  const prev = rows.find(
    (r) => r.year === year - 1 && r.partnerCountryCode === code,
  );
  const p = prev ? num(prev.normalizedValueUsd) : null;
  return p && p > 0 ? round1(((current - p) / p) * 100) : null;
}

function buildProduct(
  hs: string,
  rows: TradeFact[],
  prov: DataProvenance,
): RealProductTrade | null {
  const { points, unit, method } = yearTotals(rows);
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  const shares = partnerShares(rows, latest.year, latest.valueUsd);
  return {
    hsCode: hs,
    years: points,
    quantityUnit: unit,
    destinations: shares.slice(0, 12).map((s) => ({
      countryCode: s.code,
      sharePercent: s.share,
      growthPercent: growth(rows, s.code, latest.year, s.value),
    })),
    latestYear: latest.year,
    provenance: {
      ...prov,
      methodology: `India's annual HS6 exports (${method.toLowerCase()}); destination shares from partner rows of ${latest.year}. Calc ${OVERLAY_CALCULATION_VERSION}.`,
    },
    version: prov.datasetVersion!,
    qualityScore: prov.confidence,
  };
}

function buildMarket(
  hs: string,
  cc: string,
  rows: TradeFact[],
  prov: DataProvenance,
): RealMarketTrade | null {
  const { points, unit, method } = yearTotals(rows);
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const shares = partnerShares(rows, latest.year, latest.valueUsd);
  const prevShares = prev ? partnerShares(rows, prev.year, prev.valueUsd) : [];
  const indiaIdx = shares.findIndex((s) => s.code === 'IN');
  const unitValue = (p: YearPoint | null) =>
    p && p.quantity && unit === 'KG'
      ? Math.round((p.valueUsd / p.quantity) * 100) / 100
      : null;
  const uvNow = unitValue(latest);
  return {
    hsCode: hs,
    countryCode: cc,
    years: points,
    quantityUnit: unit,
    indiaSharePercent: indiaIdx >= 0 ? shares[indiaIdx].share : 0,
    indiaSharePreviousPercent: prev
      ? (prevShares.find((s) => s.code === 'IN')?.share ?? 0)
      : null,
    indiaRank: indiaIdx >= 0 ? indiaIdx + 1 : null,
    competitors: shares
      .filter((s) => s.code !== 'IN')
      .slice(0, 6)
      .map((s) => ({
        countryCode: s.code,
        sharePercent: s.share,
        growthPercent: growth(rows, s.code, latest.year, s.value),
      })),
    unitValue: uvNow
      ? { current: uvNow, previous: unitValue(prev), unit: 'USD/kg' }
      : null,
    latestYear: latest.year,
    provenance: {
      ...prov,
      methodology: `Destination-reported annual HS6 imports (${method.toLowerCase()}); India share and competitors from partner rows of ${latest.year}. Calc ${OVERLAY_CALCULATION_VERSION}.`,
    },
    version: prov.datasetVersion!,
    qualityScore: prov.confidence,
  };
}

function better(
  candidate: { provenance: DataProvenance; years: YearPoint[] },
  current: { provenance: DataProvenance; years: YearPoint[] } | undefined,
) {
  if (!current) return true;
  const t = (p: DataProvenance) => TIER_ORDER.indexOf(p.sourceQuality);
  if (t(candidate.provenance) !== t(current.provenance))
    return t(candidate.provenance) < t(current.provenance);
  const latest = (x: { years: YearPoint[] }) =>
    Math.max(...x.years.map((y) => y.year));
  if (latest(candidate) !== latest(current))
    return latest(candidate) > latest(current);
  return candidate.years.length > current.years.length;
}
