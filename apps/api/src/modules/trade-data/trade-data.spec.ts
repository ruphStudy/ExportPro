import {
  normalizeCountry,
  normalizeDistrict,
  normalizeHsCode,
  normalizePeriod,
  normalizePort,
  normalizeQuantity,
  normalizeState,
  parseNonNegative,
} from './normalization/normalizers';
import {
  dedupeFacts,
  normalizeRecord,
  SourceRecord,
} from './normalization/pipeline';
import { computeFreshness, sourceConfidence } from './reliability';
import { ComtradeAdapter } from './adapters/comtrade.adapter';
import { SchemaMismatchError } from './adapters/adapter';
import {
  parseCsv,
  TradeStatManualAdapter,
} from './adapters/tradestat-manual.adapter';

describe('HS normalization', () => {
  it('handles punctuation, lost leading zeros, levels and ITC-HS', () => {
    expect(normalizeHsCode('0909.31')).toMatchObject({
      ok: true,
      code: '090931',
      level: 6,
      codeSystem: 'HS',
      parent: '0909',
      status: 'EXACT',
    });
    expect(normalizeHsCode(90931)).toMatchObject({
      ok: true,
      code: '090931',
      status: 'HIGH_CONFIDENCE',
    });
    expect(normalizeHsCode('6109 10 00')).toMatchObject({
      ok: true,
      code: '61091000',
      codeSystem: 'ITC_HS_INDIA',
      parent: '610910',
    });
    expect(normalizeHsCode('61091000', false).ok).toBe(false);
    expect(normalizeHsCode('09x931').ok).toBe(false);
    expect(normalizeHsCode('0909311234').ok).toBe(false);
  });
});

describe('country normalization', () => {
  it('maps aliases and ISO codes, never maps aggregates to countries', () => {
    expect(normalizeCountry({ name: 'UAE' })).toMatchObject({
      code: 'AE',
      status: 'HIGH_CONFIDENCE',
    });
    expect(normalizeCountry({ name: 'U ARAB EMTS' }).code).toBe('AE');
    expect(normalizeCountry({ name: 'United Arab Emirates' })).toMatchObject({
      code: 'AE',
      status: 'EXACT',
    });
    expect(normalizeCountry({ iso2: 'ae' }).code).toBe('AE');
    expect(normalizeCountry({ name: 'World' })).toMatchObject({
      code: null,
      entityType: 'WORLD',
    });
    expect(normalizeCountry({ name: 'Areas, nes' })).toMatchObject({
      code: null,
      entityType: 'OTHER',
    });
    expect(normalizeCountry({ name: 'Atlantis' })).toMatchObject({
      code: null,
      status: 'UNRESOLVED',
    });
  });
});

describe('units, periods, values, ports, states, districts', () => {
  it('converts only within a unit family; unknown stays raw', () => {
    expect(normalizeQuantity(2, 'MT')).toMatchObject({
      normalizedUnit: 'KG',
      normalizedQuantity: 2000,
      status: 'EXACT',
    });
    expect(normalizeQuantity(3, 'doz')).toMatchObject({
      normalizedUnit: 'NUMBER',
      normalizedQuantity: 36,
    });
    expect(normalizeQuantity(5, 'kg').normalizedUnit).toBe('KG');
    expect(normalizeQuantity(5, 'bales')).toMatchObject({
      normalizedUnit: null,
      normalizedQuantity: null,
      status: 'UNRESOLVED',
    });
  });
  it('keeps annual data annual', () => {
    const y = normalizePeriod(2024);
    expect(y).toMatchObject({ ok: true, periodType: 'YEAR', month: null });
    expect(normalizePeriod(2024, 3)).toMatchObject({
      periodType: 'MONTH',
      month: 3,
    });
    expect(normalizePeriod(2024, 13).ok).toBe(false);
    expect(normalizePeriod('20x4').ok).toBe(false);
  });
  it('missing values stay null; negatives rejected', () => {
    expect(parseNonNegative('')).toEqual({ ok: true, value: null });
    expect(parseNonNegative('1,234.5')).toEqual({ ok: true, value: 1234.5 });
    expect(parseNonNegative(-3).ok).toBe(false);
  });
  it('one identity per port; districts never merged across states', () => {
    expect(normalizePort('JNPT')!.code).toBe('INNSA1');
    expect(normalizePort('Nhava Sheva')!.code).toBe('INNSA1');
    expect(normalizePort('Jawaharlal Nehru Port')!.code).toBe('INNSA1');
    expect(normalizeState('Orissa')).toMatchObject({
      code: 'OD',
      status: 'HIGH_CONFIDENCE',
    });
    expect(normalizeDistrict('Aurangabad', 'MH')!.key).not.toBe(
      normalizeDistrict('Aurangabad', 'BR')!.key,
    );
    expect(normalizeDistrict('Aurangabad', null)!.status).toBe('UNRESOLVED');
  });
});

const rec = (over: Partial<SourceRecord> = {}): SourceRecord => ({
  rowRef: 'r1',
  sourceRecordKey: 'k1',
  direction: 'EXPORT',
  hsCode: '090931',
  allowItc: false,
  reporter: { iso2: 'IN' },
  partner: { name: 'UAE' },
  year: 2023,
  value: '100',
  currency: 'USD',
  quantity: '10',
  unit: 'kg',
  ...over,
});

describe('pipeline', () => {
  it('normalizes, preserves originals, and gives a deterministic key', () => {
    const a = normalizeRecord(rec(), 's1').fact!;
    const b = normalizeRecord(
      rec({ hsCode: '0909.31', partner: { name: 'United Arab Emirates' } }),
      's1',
    ).fact!;
    expect(a.factKey).toBe(b.factKey);
    expect(a).toMatchObject({
      hsCode: '090931',
      sourceHsCode: '090931',
      partnerCountryCode: 'AE',
      normalizedValueUsd: 100,
      normalizedUnit: 'KG',
    });
  });
  it('rejects malformed rows, keeps unresolved mappings explicit', () => {
    expect(normalizeRecord(rec({ hsCode: 'abc' }), 's1').fact).toBeNull();
    expect(normalizeRecord(rec({ value: '-5' }), 's1').issues[0].kind).toBe(
      'INVALID_VALUE',
    );
    const unresolved = normalizeRecord(
      rec({ partner: { name: 'Atlantis' }, unit: 'bales' }),
      's1',
    );
    expect(unresolved.fact).not.toBeNull();
    expect(unresolved.issues.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['UNKNOWN_COUNTRY', 'UNKNOWN_UNIT']),
    );
    expect(unresolved.fact!.normalizedQuantity).toBeNull();
    expect(unresolved.fact!.quantity).toBe(10);
  });
  it('non-USD values are never converted without an FX source', () => {
    const r = normalizeRecord(rec({ currency: 'INR' }), 's1');
    expect(r.fact!.normalizedValueUsd).toBeNull();
    expect(r.issues.some((i) => i.severity === 'WARNING')).toBe(true);
  });
  it('distinguishes exact and conflicting duplicates', () => {
    const f1 = normalizeRecord(rec(), 's1').fact!;
    const f2 = normalizeRecord(rec(), 's1').fact!;
    const f3 = normalizeRecord(rec({ value: '200' }), 's1').fact!;
    const d = dedupeFacts([f1, f2, f3]);
    expect(d.facts).toHaveLength(1);
    expect(d.exactDuplicates).toBe(1);
    expect(d.issues[0].kind).toBe('CONFLICTING_DUPLICATE');
  });
});

describe('reliability', () => {
  it('freshness depends on cadence and lag, not a fixed day count', () => {
    const now = new Date('2026-10-07');
    expect(computeFreshness('ANNUAL', new Date('2024-12-31'), 180, now)).toBe(
      'RECENT',
    );
    expect(computeFreshness('MONTHLY', new Date('2024-12-31'), 60, now)).toBe(
      'VERY_STALE',
    );
    expect(computeFreshness('ANNUAL', null, 180, now)).toBe('UNKNOWN');
    expect(computeFreshness('STATIC', new Date(), 0, now)).toBe('FRESH');
  });
  it('confidence: quality and freshness are separate inputs', () => {
    const fresh = sourceConfidence({
      tier: 'B',
      freshness: 'FRESH',
      fetched: 100,
      accepted: 100,
      unresolved: 0,
    });
    const stale = sourceConfidence({
      tier: 'A',
      freshness: 'VERY_STALE',
      fetched: 100,
      accepted: 100,
      unresolved: 0,
    });
    expect(fresh).toBeGreaterThan(stale);
    expect(sourceConfidence({ tier: 'DEMO', freshness: 'FRESH' })).toBeLessThan(
      fresh,
    );
  });
});

describe('adapters', () => {
  const comtrade = new ComtradeAdapter({
    baseUrl: 'https://x',
    requestGapMs: 1000,
    hsCodes: ['090931'],
    exportYears: [2023],
    importYears: [],
    importReporters: [],
  });
  const meta = {
    partners: [
      { code: 0, iso2: null, desc: 'World', isGroup: true },
      { code: 784, iso2: 'AE', desc: 'United Arab Emirates', isGroup: false },
      { code: 899, iso2: null, desc: 'Areas, nes', isGroup: false },
    ],
    reporters: [{ code: 699, iso2: 'IN', desc: 'India' }],
    units: { 8: 'kg' },
  };
  const row = (partnerCode: number, extra: Record<string, unknown> = {}) => ({
    period: '2023',
    reporterCode: 699,
    flowCode: 'X',
    partnerCode,
    partner2Code: 0,
    cmdCode: '090931',
    primaryValue: 10,
    qtyUnitCode: 8,
    qty: 5,
    motCode: 0,
    customsCode: 'C00',
    classificationCode: 'H6',
    ...extra,
  });
  it('maps World/aggregates explicitly and skips transport breakdowns', () => {
    const parsed = comtrade.parse(
      {
        datasetKey: 'INDIA_EXPORTS',
        sourceRecordKey: 'u',
        sourcePeriod: '2023',
        payload: {
          data: [row(0), row(784), row(899), row(784, { motCode: 2100 })],
          error: '',
        },
      },
      meta,
    );
    expect(parsed.skipped).toBe(1);
    expect(
      parsed.records!.map((r) => r.partner.entityType ?? r.partner.iso2),
    ).toEqual(['WORLD', 'AE', 'OTHER']);
  });
  it('fails safely when the source shape changes', () => {
    expect(() =>
      comtrade.parse(
        {
          datasetKey: 'X',
          sourceRecordKey: 'u',
          sourcePeriod: null,
          payload: { rows: [] },
        },
        meta,
      ),
    ).toThrow(SchemaMismatchError);
    const broken: Record<string, unknown> = { ...row(784) };
    delete broken.primaryValue;
    expect(() =>
      comtrade.parse(
        {
          datasetKey: 'X',
          sourceRecordKey: 'u',
          sourcePeriod: null,
          payload: { data: [broken], error: '' },
        },
        meta,
      ),
    ).toThrow(SchemaMismatchError);
  });
  it('manual template: strict columns, quoted CSV', () => {
    expect(parseCsv('a,"b, c","d ""q"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'd "q"'],
      ['1', '2', '3'],
    ]);
    const manual = new TradeStatManualAdapter();
    expect(() =>
      manual.readFile(
        Buffer.from('hs_code,partner_country,year,value,value_unit,surprise\n'),
        'x.csv',
      ),
    ).toThrow(SchemaMismatchError);
    const ok = manual.readFile(
      Buffer.from(
        'hs_code,partner_country,year,value,value_unit\n090931,UAE,2023,1.5,USD_MILLION\n',
      ),
      'x.csv',
    );
    const parsed = manual.parse(ok.units[0]);
    expect(normalizeRecord(parsed.records![0], 's').fact!.tradeValue).toBe(
      1_500_000,
    );
  });
});
