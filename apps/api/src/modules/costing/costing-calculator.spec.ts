import {
  calculate,
  type CalcFx,
  type CalcInput,
  type CalcLine,
  compareIncoterms,
  D,
  fxSensitivity,
  markupPercent,
  marginPercent,
  priceFromMargin,
  priceFromMarkup,
} from './costing-calculator';
import { INCOTERM_POLICIES, lineIncluded } from './incoterm-policy';

const NOW = new Date('2026-10-07T00:00:00Z');
let n = 0;
const line = (
  p: Partial<CalcLine> & Pick<CalcLine, 'category' | 'amount'>,
): CalcLine => ({
  id: `l${++n}`,
  label: p.category.toLowerCase(),
  currency: 'INR',
  basis: 'FIXED',
  percentageBase: null,
  wastagePercent: null,
  sourceType: 'USER_ENTERED',
  confidence: 'CONFIRMED',
  validUntil: null,
  includeOverride: null,
  ...p,
});
const usdInr = (rate: string): CalcFx => ({
  currency: 'USD',
  snapshotId: `fx-${rate}`,
  baseCurrency: 'USD',
  quoteCurrency: 'INR',
  rate,
  sourceType: 'MANUAL',
  sourceDate: NOW,
});

const base = (p: Partial<CalcInput> = {}): CalcInput => ({
  calculationCurrency: 'INR',
  quoteCurrency: 'USD',
  thinMarginPercent: '8',
  quantity: '10',
  quantityUnit: 'MT',
  netWeightKg: null,
  cartonCount: null,
  containerCount: null,
  incoterm: 'FOB',
  pricingMode: 'MARGIN',
  pricingValue: '20',
  buyerTargetPrice: null,
  lines: [
    line({ category: 'PROCUREMENT', amount: '200', basis: 'PER_KG' }), // 200 INR/kg × 10,000 kg = 2,000,000
    line({ category: 'PACKAGING', amount: '50000' }),
    line({ category: 'INLAND_TRANSPORT', amount: '1.5', basis: 'PER_KG' }), // 15,000
    line({ category: 'CHA', amount: '12000' }),
    line({ category: 'PORT', amount: '23000' }),
    line({ category: 'FREIGHT', amount: '1800', currency: 'USD' }), // × 83 = 149,400
    line({
      category: 'INSURANCE',
      amount: '0.2',
      basis: 'PERCENTAGE',
      percentageBase: 'PRE_INSURANCE_COST',
    }),
  ],
  fx: [usdInr('83')],
  ...p,
});

describe('margin vs markup (distinct formulas)', () => {
  it('cost 100 with 20% margin sells at 125; with 20% markup at 120', () => {
    expect(priceFromMargin(new D(100), new D(20)).toFixed(4)).toBe('125.0000');
    expect(priceFromMarkup(new D(100), new D(20)).toFixed(4)).toBe('120.0000');
    expect(marginPercent(new D(100), new D(125))!.toFixed(2)).toBe('20.00');
    expect(markupPercent(new D(100), new D(125))!.toFixed(2)).toBe('25.00');
    expect(marginPercent(new D(100), new D(120))!.toFixed(2)).toBe('16.67');
  });

  it('flows through the calculator: cost 100/unit, margin 20% → price 125, profit 25', () => {
    const r = calculate(
      base({
        quantity: '1',
        quantityUnit: 'UNIT',
        incoterm: 'EXW',
        lines: [line({ category: 'PROCUREMENT', amount: '100' })],
        fx: [],
      }),
      NOW,
    );
    expect(r.pricing).toMatchObject({
      costPerUnit: '100.0000',
      sellingPricePerUnit: '125.0000',
      profitPerUnit: '25.0000',
      marginPercent: '20.00',
      markupPercent: '25.00',
    });
    const k = calculate(
      base({
        quantity: '1',
        quantityUnit: 'UNIT',
        incoterm: 'EXW',
        pricingMode: 'MARKUP',
        lines: [line({ category: 'PROCUREMENT', amount: '100' })],
        fx: [],
      }),
      NOW,
    );
    expect(k.pricing).toMatchObject({
      sellingPricePerUnit: '120.0000',
      marginPercent: '16.67',
      markupPercent: '20.00',
    });
  });

  it('rejects a margin of 100% or more instead of dividing by zero', () => {
    const r = calculate(base({ pricingValue: '100' }), NOW);
    expect(r.pricing).toBeNull();
    expect(r.issues.map((i) => i.code)).toContain('MARGIN_INVALID');
  });
});

describe('Incoterm policy', () => {
  it('EXW excludes freight, FOB excludes freight/insurance, CFR adds freight, CIF adds insurance', () => {
    const rows = compareIncoterms(base(), NOW);
    const inc = Object.fromEntries(
      rows.map((r) => [r.incoterm, r.includedCategories]),
    );
    expect(inc.EXW).toEqual(['PROCUREMENT', 'PACKAGING']);
    expect(inc.FOB).not.toContain('FREIGHT');
    expect(inc.FOB).not.toContain('INSURANCE');
    expect(inc.CFR).toContain('FREIGHT');
    expect(inc.CFR).not.toContain('INSURANCE');
    expect(inc.CIF).toEqual(expect.arrayContaining(['FREIGHT', 'INSURANCE']));
    const tot = Object.fromEntries(
      rows.map((r) => [r.incoterm, Number(r.totalCost)]),
    );
    expect(tot.EXW).toBeLessThan(tot.FCA);
    expect(tot.FCA).toBeLessThan(tot.FOB);
    expect(tot.FOB).toBeLessThan(tot.CFR);
    expect(tot.CFR).toBeLessThan(tot.CIF);
  });

  it('computes exact FOB/CFR/CIF totals', () => {
    const fob = calculate(base({ incoterm: 'FOB' }), NOW);
    expect(fob.totalCost).toBe('2100000.00');
    expect(fob.costPerUnit).toBe('210000.0000');
    const cfr = calculate(base({ incoterm: 'CFR' }), NOW);
    expect(cfr.totalCost).toBe('2249400.00');
    const cif = calculate(base({ incoterm: 'CIF' }), NOW);
    // insurance = 0.2% × 2,249,400 = 4,498.80
    expect(cif.totalCost).toBe('2253898.80');
    expect(
      cif.lines.find((l) => l.category === 'INSURANCE')!.formula,
    ).toContain('cost before insurance');
  });

  it('only conditional categories can be overridden', () => {
    expect(lineIncluded('FOB', 'FREIGHT', true).included).toBe(false);
    expect(lineIncluded('FOB', 'INSPECTION', false).included).toBe(false);
    expect(lineIncluded('FCA', 'PORT', null).included).toBe(false);
    expect(lineIncluded('FCA', 'PORT', true).included).toBe(true);
  });

  it('CFR requires freight and CIF requires insurance; FOB requires neither', () => {
    const noFreight = base({
      lines: base().lines.filter(
        (l) => l.category !== 'FREIGHT' && l.category !== 'INSURANCE',
      ),
    });
    expect(calculate({ ...noFreight, incoterm: 'FOB' }, NOW).complete).toBe(
      true,
    );
    const cfr = calculate({ ...noFreight, incoterm: 'CFR' }, NOW);
    expect(cfr.complete).toBe(false);
    expect(cfr.totalCost).toBeNull();
    expect(INCOTERM_POLICIES.CIF.required).toEqual([
      'PROCUREMENT',
      'FREIGHT',
      'INSURANCE',
    ]);
  });
});

describe('fixed vs variable costs', () => {
  it('certificates ₹10,000 fixed: 5 MT → ₹2/kg, 10 MT → ₹1/kg; variable costs scale', () => {
    const mk = (q: string) =>
      calculate(
        base({
          quantity: q,
          incoterm: 'EXW',
          pricingValue: null,
          lines: [
            line({ category: 'PROCUREMENT', amount: '100', basis: 'PER_KG' }),
            line({ category: 'CERTIFICATES', amount: '10000' }),
          ],
        }),
        NOW,
      );
    const five = mk('5');
    const ten = mk('10');
    expect(five.totalCost).toBe('510000.00');
    expect(ten.totalCost).toBe('1010000.00');
    expect(
      five.categories.find((c) => c.category === 'CERTIFICATES')!.amount,
    ).toBe('10000.00');
    expect(
      ten.categories.find((c) => c.category === 'CERTIFICATES')!.amount,
    ).toBe('10000.00');
    // per kg: certificates 2 vs 1
    expect(new D(10000).div(5000).toString()).toBe('2');
    expect(Number(five.costPerUnit)).toBeGreaterThan(Number(ten.costPerUnit));
    expect(
      new D(five.costPerUnit!).minus(new D(ten.costPerUnit!)).toFixed(4),
    ).toBe('1000.0000'); // ₹1/kg × 1000 kg per MT
  });

  it('converts KG↔MT deterministically but never assumes weight for units/containers', () => {
    const kg = calculate(base({ quantity: '10000', quantityUnit: 'KG' }), NOW);
    expect(kg.totalCost).toBe(calculate(base(), NOW).totalCost);
    const units = calculate(
      base({ quantityUnit: 'CONTAINER', quantity: '1' }),
      NOW,
    );
    expect(units.complete).toBe(false);
    expect(units.issues.some((i) => i.code === 'BASIS_QUANTITY_MISSING')).toBe(
      true,
    );
    const withWeight = calculate(
      base({ quantityUnit: 'CONTAINER', quantity: '1', netWeightKg: '10000' }),
      NOW,
    );
    expect(withWeight.totalCost).toBe('2100000.00');
  });

  it('applies procurement wastage explicitly', () => {
    const r = calculate(
      base({
        incoterm: 'EXW',
        lines: [
          line({
            category: 'PROCUREMENT',
            amount: '100',
            basis: 'PER_KG',
            wastagePercent: '2',
          }),
        ],
      }),
      NOW,
    );
    expect(r.totalCost).toBe('1020000.00');
    expect(r.lines[0].formula).toContain('2% wastage');
  });
});

describe('FX', () => {
  it('blocks totals when a required FX rate is missing', () => {
    const r = calculate(base({ incoterm: 'CFR', fx: [] }), NOW);
    expect(r.complete).toBe(false);
    expect(r.totalCost).toBeNull();
    expect(r.issues.find((i) => i.code === 'FX_REQUIRED')).toMatchObject({
      blocking: true,
      currency: 'USD',
    });
  });

  it('does not require FX for an excluded foreign-currency line', () => {
    expect(calculate(base({ incoterm: 'FOB', fx: [] }), NOW).totalCost).toBe(
      '2100000.00',
    );
  });

  it('FX 82 vs 86 changes converted totals exactly', () => {
    const a = calculate(base({ incoterm: 'CFR', fx: [usdInr('82')] }), NOW);
    const b = calculate(base({ incoterm: 'CFR', fx: [usdInr('86')] }), NOW);
    expect(new D(b.totalCost!).minus(a.totalCost!).toFixed(2)).toBe('7200.00'); // 1800 × 4
    expect(a.fxUsed[0]).toMatchObject({ pair: 'USD/INR', rate: '82.000000' });
  });

  it('supports inverse pairs and quote-currency pricing', () => {
    const inv: CalcFx = {
      currency: 'USD',
      snapshotId: 'inv',
      baseCurrency: 'INR',
      quoteCurrency: 'USD',
      rate: '0.0125',
      sourceType: 'MANUAL',
      sourceDate: NOW,
    };
    const r = calculate(base({ incoterm: 'CFR', fx: [inv] }), NOW);
    expect(r.lines.find((l) => l.category === 'FREIGHT')!.converted).toBe(
      '144000.00',
    ); // 1800 / 0.0125
    expect(r.pricing!.sellingPricePerUnitQuote).not.toBeNull();
  });

  it('sensitivity never mutates the saved snapshot rates', () => {
    const input = base({ incoterm: 'CFR' });
    const rows = fxSensitivity(input, [-5, 0, 5], NOW);
    expect(input.fx[0].rate).toBe('83');
    expect(rows.find((r) => r.shiftPercent === 0)!.totalCost).toBe(
      calculate(input, NOW).totalCost,
    );
    expect(Number(rows[0].totalCost)).toBeLessThan(Number(rows[2].totalCost));
  });
});

describe('precision, zero vs missing, feasibility', () => {
  it('is decimal-exact (0.1 + 0.2) and handles large quantities', () => {
    const r = calculate(
      base({
        incoterm: 'EXW',
        quantity: '1',
        quantityUnit: 'UNIT',
        pricingValue: null,
        lines: [
          line({ category: 'PROCUREMENT', amount: '0.1' }),
          line({ category: 'PACKAGING', amount: '0.2' }),
        ],
      }),
      NOW,
    );
    expect(r.totalCost).toBe('0.30');
    const big = calculate(
      base({
        incoterm: 'EXW',
        quantity: '123456789.1234',
        quantityUnit: 'KG',
        pricingValue: null,
        lines: [
          line({
            category: 'PROCUREMENT',
            amount: '0.333333',
            basis: 'PER_KG',
          }),
        ],
      }),
      NOW,
    );
    expect(big.totalCost).toBe('41152221.89'); // exact: 41152221.8888702922;
    expect(calculate(base(), NOW).totalCost).toBe(
      calculate(base(), NOW).totalCost,
    );
  });

  it('keeps 0 distinct from not provided', () => {
    const zero = calculate(
      base({
        lines: [
          ...base().lines.slice(0, 1),
          line({ category: 'PACKAGING', amount: '0' }),
        ],
      }),
      NOW,
    );
    expect(zero.complete).toBe(true);
    const missing = calculate(
      base({
        lines: [
          ...base().lines.slice(0, 1),
          line({ category: 'PACKAGING', amount: null }),
        ],
      }),
      NOW,
    );
    expect(missing.complete).toBe(false);
    expect(
      missing.issues.find((i) => i.code === 'AMOUNT_MISSING'),
    ).toBeDefined();
  });

  it('classifies loss, break-even, thin and profitable deterministically', () => {
    const one = (mode: 'TARGET_PRICE' | 'MARGIN', v: string) =>
      calculate(
        base({
          incoterm: 'EXW',
          quantity: '1',
          quantityUnit: 'UNIT',
          quoteCurrency: 'INR',
          pricingMode: mode,
          pricingValue: v,
          lines: [line({ category: 'PROCUREMENT', amount: '100' })],
          fx: [],
        }),
        NOW,
      ).pricing!.feasibility;
    expect(one('TARGET_PRICE', '90')).toBe('LOSS');
    expect(one('TARGET_PRICE', '100.2')).toBe('BREAK_EVEN');
    expect(one('MARGIN', '5')).toBe('THIN_MARGIN');
    expect(one('MARGIN', '20')).toBe('PROFITABLE');
  });

  it('compares against the buyer target without changing the price', () => {
    const r = calculate(base({ buyerTargetPrice: '3000' }), NOW);
    expect(r.pricing!.buyerTarget).toMatchObject({
      currency: 'USD',
      position: 'ABOVE',
    });
    expect(r.pricing!.sellingPricePerUnit).toBe('262500.0000');
  });

  it('flags expired quotes and estimates without blocking', () => {
    const r = calculate(
      base({
        lines: [
          ...base().lines.slice(0, 1),
          line({
            category: 'PORT',
            amount: '1',
            confidence: 'ESTIMATE',
            validUntil: new Date('2026-01-01'),
          }),
        ],
      }),
      NOW,
    );
    expect(r.complete).toBe(true);
    expect(r.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['QUOTE_EXPIRED', 'ESTIMATE_USED']),
    );
  });
});
