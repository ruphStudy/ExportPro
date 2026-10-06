import { MARKET_WEIGHTS, scoreMarket } from './market-scoring';
import { SampleCountryDataProvider } from './providers/sample-country-data.provider';

const data = new SampleCountryDataProvider();
const score = (
  product: string,
  cc: string,
  override: Partial<ReturnType<typeof data.market>> = {},
) =>
  scoreMarket(
    { ...data.market(product, cc)!, ...override } as never,
    data.countryProfile(cc)!,
    70,
    40,
    75,
  );

describe('market scoring', () => {
  it('weights sum to 100', () => {
    expect(Object.values(MARKET_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('higher tariff → lower tariff score; missing tariff → neutral and flagged', () => {
    const low = score('090931', 'AE');
    const high = score('090931', 'BD');
    expect(low.components.tariff).toBeGreaterThan(high.components.tariff);
    const missing = score('090931', 'GB');
    expect(missing.tariffAvailable).toBe(false);
    expect(missing.components.tariff).toBe(50);
    expect(missing.risks).toContain('Tariff data unavailable');
    expect(missing.confidence).toBeLessThan(low.confidence);
  });

  it('strong vs weak market, high competition, risky country', () => {
    expect(score('090931', 'AE').score).toBeGreaterThan(
      score('090931', 'NG').score,
    );
    expect(score('610910', 'US').competitionLevel).toBe('HIGH');
    const ng = score('610910', 'NG');
    expect(ng.entry).toBe('DIFFICULT');
    expect(ng.risks).toEqual(
      expect.arrayContaining(['Higher country risk', 'Currency volatility']),
    );
  });

  it('is deterministic and independent of any organization', () => {
    expect(score('140490', 'US')).toEqual(score('140490', 'US'));
  });
});
