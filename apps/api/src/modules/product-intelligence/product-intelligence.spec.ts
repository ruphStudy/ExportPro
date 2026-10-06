import {
  cagr,
  hhi,
  hhiLevel,
  seasonality,
  sumTop,
  weightedOpportunityScore,
  yoyGrowth,
  OPPORTUNITY_WEIGHTS,
} from './intelligence-calculations';
import { ProductIntelligenceService } from './product-intelligence.service';
import { SampleTradeDataProvider } from './providers/sample-trade-data.provider';

const provider = new SampleTradeDataProvider();
const prismaStub = {
  opportunity: { findMany: jest.fn().mockResolvedValue([]) },
};
const service = new ProductIntelligenceService(
  prismaStub as never,
  {} as never,
  {} as never,
  provider,
);
const dataset = (code: string) =>
  provider.find({ codeSystem: 'HS', classificationCode: code, hsCode: code })!
    .dataset;

describe('formulas', () => {
  it('YoY = (current − previous) / previous × 100, safe on zero/missing/negative', () => {
    expect(yoyGrowth(110, 100)).toBe(10);
    expect(yoyGrowth(50, 100)).toBe(-50);
    expect(yoyGrowth(100, 0)).toBeNull();
    expect(yoyGrowth(100, null)).toBeNull();
    expect(yoyGrowth(100, -5)).toBeNull();
  });

  it('CAGR over the available range, unavailable with too few periods', () => {
    const c = cagr([
      { period: '2021', value: 100, quantity: null },
      { period: '2022', value: 110, quantity: null },
      { period: '2023', value: 121, quantity: null },
    ]);
    expect(c).toMatchObject({
      available: true,
      valuePercent: 10,
      fromPeriod: '2021',
      toPeriod: '2023',
      years: 2,
    });
    expect(
      cagr([
        { period: '2024', value: 1, quantity: null },
        { period: '2025', value: 2, quantity: null },
      ]).available,
    ).toBe(false);
    // Zero/negative values are excluded rather than producing NaN.
    expect(
      cagr([
        { period: '2021', value: 0, quantity: null },
        { period: '2022', value: 10, quantity: null },
        { period: '2023', value: 20, quantity: null },
      ]).available,
    ).toBe(false);
  });

  it('concentration: HHI, bands and top-N share', () => {
    expect(hhi([50, 50])).toBe(5000);
    expect(hhiLevel(1000)).toBe('LOW');
    expect(hhiLevel(2000)).toBe('MODERATE');
    expect(hhiLevel(3000)).toBe('HIGH');
    expect(sumTop([5, 30, 20, 10], 3)).toBe(60);
  });

  it('opportunity weights sum to 100', () => {
    expect(Object.values(OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(
      100,
    );
    const all70 = Object.fromEntries(
      Object.keys(OPPORTUNITY_WEIGHTS).map((k) => [k, 70]),
    ) as never;
    expect(weightedOpportunityScore(all70)).toBe(70);
  });

  it('no seasonality without monthly data', () => {
    expect(seasonality([]).available).toBe(false);
  });
});

describe('sample products', () => {
  it('cumin: growing, highly seasonal, supply-concentrated', async () => {
    const i = await service.compute(dataset('090931'));
    expect(i.trend.cagr.available).toBe(true);
    expect(i.trend.cagr.valuePercent!).toBeGreaterThan(0);
    expect(i.seasonality).toMatchObject({
      available: true,
      level: 'HIGH',
      strongestQuarter: 'Apr–Jun (Q2)',
    });
    expect(i.risk.signals.find((s) => s.key === 'supply')!.level).toBe('HIGH');
    expect(i.ecosystem.districtsAvailable).toBe(true);
    expect(
      i.ecosystem.regions.reduce((s, r) => s + r.contributionPercent, 0),
    ).toBeCloseTo(100, 5);
    expect(i.source.isSample).toBe(true);
  });

  it('plastic kitchenware: declining, no districts (partial data), diversified markets', async () => {
    const i = await service.compute(dataset('392410'));
    expect(i.trend.cagr.valuePercent!).toBeLessThan(0);
    expect(i.ecosystem.districtsAvailable).toBe(false);
    expect(i.seasonality.available).toBe(false);
    expect(i.markets.concentration.level).toBe('LOW');
    expect(
      i.opportunity.risks.some((r) => r.startsWith('Exports declining')),
    ).toBe(true);
  });

  it('LED drivers: quantity unavailable (incompatible units), concentrated destinations', async () => {
    const i = await service.compute(dataset('850440'));
    expect(i.trend.quantity.available).toBe(false);
    expect(i.trend.yearly.every((p) => p.exportQuantity === null)).toBe(true);
    expect(i.markets.concentration.level).not.toBe('LOW');
  });

  it('cotton T-shirts: low seasonality, low supply risk', async () => {
    const i = await service.compute(dataset('610910'));
    expect(i.seasonality.level).toBe('LOW');
    expect(i.risk.signals.find((s) => s.key === 'supply')!.level).toBe('LOW');
  });

  it('is deterministic and confidence is separate from score', async () => {
    const a = await service.compute(dataset('140490'));
    const b = await service.compute(dataset('140490'));
    expect(a.opportunity).toEqual(b.opportunity);
    expect(a.confidence).toBeLessThanOrEqual(65);
  });

  it('matches by code only, heading fallback only when unambiguous', () => {
    expect(
      provider.find({
        codeSystem: 'HS',
        classificationCode: '090932',
        hsCode: '090932',
      })?.level,
    ).toBe('HS_HEADING');
    expect(
      provider.find({
        codeSystem: 'ITC_HS_INDIA',
        classificationCode: '61091000',
        hsCode: '610910',
      })?.level,
    ).toBe('HS_SUBHEADING');
    expect(
      provider.find({
        codeSystem: 'HS',
        classificationCode: '392330',
        hsCode: '392330',
      }),
    ).toBeNull();
  });
});
