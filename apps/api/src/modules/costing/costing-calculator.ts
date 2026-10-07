import { Prisma } from '@prisma/client';
import {
  COST_CATEGORY_ORDER,
  COSTING_FORMULA_VERSION,
  type CategoryBreakdown,
  type CostBasis,
  type CostCategory,
  type CostConfidence,
  type CostingIssue,
  type CostingQuantityUnit,
  type CostingResult,
  type CostSourceType,
  type FxSensitivityRow,
  type FxSourceType,
  type Incoterm,
  INCOTERM_ORDER,
  type IncotermComparisonRow,
  type LineCalculation,
  type PercentageBase,
  type PricingFeasibility,
  type PricingMode,
  type PricingResult,
} from '@exportpro/types';
import { INCOTERM_POLICIES, lineIncluded } from './incoterm-policy';

/**
 * Deterministic export-costing engine (formula `export-costing-v1`).
 * Pure functions over decimal strings — no I/O, no floats, no AI.
 *
 * Arithmetic uses decimal.js (bundled with Prisma) at 40 significant
 * digits, ROUND_HALF_UP. Intermediate values are never rounded; outputs
 * are rounded once: money 2 dp, per-unit prices 4 dp, percentages 2 dp,
 * FX rates 6 dp.
 */
export const D = Prisma.Decimal.clone({
  precision: 40,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
export type Dec = InstanceType<typeof D>;
const HUNDRED = new D(100);

export const money = (d: Dec) => d.toFixed(2);
export const perUnit = (d: Dec) => d.toFixed(4);
export const pct = (d: Dec) => d.toFixed(2);

export interface CalcLine {
  id: string;
  category: CostCategory;
  label: string;
  amount: string | null;
  currency: string;
  basis: CostBasis;
  percentageBase: PercentageBase | null;
  wastagePercent: string | null;
  sourceType: CostSourceType;
  confidence: CostConfidence;
  validUntil: Date | null;
  includeOverride: boolean | null;
}

export interface CalcFx {
  currency: string;
  snapshotId: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  sourceType: FxSourceType;
  sourceDate: Date;
}

export interface CalcInput {
  calculationCurrency: string;
  quoteCurrency: string;
  thinMarginPercent: string;
  quantity: string;
  quantityUnit: CostingQuantityUnit;
  netWeightKg: string | null;
  cartonCount: string | null;
  containerCount: string | null;
  incoterm: Incoterm;
  pricingMode: PricingMode;
  pricingValue: string | null;
  buyerTargetPrice: string | null;
  lines: CalcLine[];
  fx: CalcFx[];
}

/** Deterministic unit conversion (only mass is convertible: 1 MT = 1000 KG). Containers/cartons are never converted to weight. */
export function toKg(quantity: Dec, unit: CostingQuantityUnit): Dec | null {
  if (unit === 'KG') return quantity;
  if (unit === 'MT') return quantity.mul(1000);
  return null;
}

/** Converts `amount` from `from` to `to` using the scenario's selected snapshots. null = FX required. */
export function convert(
  amount: Dec,
  from: string,
  to: string,
  fx: CalcFx[],
): { value: Dec; rate: Dec | null; fx: CalcFx | null } | null {
  if (from === to) return { value: amount, rate: null, fx: null };
  for (const f of fx) {
    const r = new D(f.rate);
    if (f.baseCurrency === from && f.quoteCurrency === to)
      return { value: amount.mul(r), rate: r, fx: f };
    if (f.baseCurrency === to && f.quoteCurrency === from)
      return { value: amount.div(r), rate: new D(1).div(r), fx: f };
  }
  return null;
}

/** Selling price from cost per unit. Margin = profit/price; markup = profit/cost (distinct!). */
export function priceFromMargin(cost: Dec, marginPercent: Dec): Dec {
  return cost.div(new D(1).minus(marginPercent.div(HUNDRED)));
}
export function priceFromMarkup(cost: Dec, markupPercent: Dec): Dec {
  return cost.mul(new D(1).plus(markupPercent.div(HUNDRED)));
}
export function marginPercent(cost: Dec, price: Dec): Dec | null {
  return price.isZero() ? null : price.minus(cost).div(price).mul(HUNDRED);
}
export function markupPercent(cost: Dec, price: Dec): Dec | null {
  return cost.isZero() ? null : price.minus(cost).div(cost).mul(HUNDRED);
}

/** LOSS if profit < 0 (beyond the break-even band); BREAK_EVEN if |margin| < 0.5 %; THIN_MARGIN below the configured threshold; else PROFITABLE. */
export const BREAK_EVEN_BAND_PERCENT = '0.5';
export function feasibility(
  margin: Dec | null,
  profit: Dec,
  thin: Dec,
): PricingFeasibility {
  if (margin !== null && margin.abs().lt(BREAK_EVEN_BAND_PERCENT))
    return 'BREAK_EVEN';
  if (profit.isNegative()) return 'LOSS';
  if (margin === null || margin.lt(thin)) return 'THIN_MARGIN';
  return 'PROFITABLE';
}

const fmt = (d: Dec, cur: string) =>
  `${d.toFixed(d.decimalPlaces() > 4 ? 4 : d.decimalPlaces())} ${cur}`;

export function calculate(input: CalcInput, now = new Date()): CostingResult {
  const policy = INCOTERM_POLICIES[input.incoterm];
  const calc = input.calculationCurrency;
  const issues: CostingIssue[] = [];
  const qty = new D(input.quantity || 0);
  if (!qty.gt(0))
    issues.push({
      code: 'QUANTITY_INVALID',
      blocking: true,
      message: 'Quantity must be greater than zero.',
    });

  const kg =
    toKg(qty, input.quantityUnit) ??
    (input.netWeightKg !== null ? new D(input.netWeightKg) : null);
  const cartons =
    input.quantityUnit === 'CARTON'
      ? qty
      : input.cartonCount !== null
        ? new D(input.cartonCount)
        : null;
  const containers =
    input.quantityUnit === 'CONTAINER'
      ? qty
      : input.containerCount !== null
        ? new D(input.containerCount)
        : null;
  const basisQty = (b: CostBasis): { q: Dec; label: string } | null => {
    switch (b) {
      case 'PER_UNIT':
        return { q: qty, label: `${qty.toString()} ${input.quantityUnit}` };
      case 'PER_KG':
        return kg ? { q: kg, label: `${kg.toString()} kg` } : null;
      case 'PER_MT':
        return kg
          ? { q: kg.div(1000), label: `${kg.div(1000).toString()} MT` }
          : null;
      case 'PER_CARTON':
        return cartons
          ? { q: cartons, label: `${cartons.toString()} cartons` }
          : null;
      case 'PER_CONTAINER':
        return containers
          ? { q: containers, label: `${containers.toString()} containers` }
          : null;
      default:
        return null;
    }
  };
  const basisHint: Partial<Record<CostBasis, string>> = {
    PER_KG:
      'Enter the net weight (kg) — quantity is not in KG/MT and units are never converted to weight automatically.',
    PER_MT:
      'Enter the net weight (kg) — quantity is not in KG/MT and units are never converted to weight automatically.',
    PER_CARTON: 'Enter the number of cartons.',
    PER_CONTAINER:
      'Enter the number of containers (capacity is never assumed).',
  };

  const rows: (LineCalculation & {
    _conv: Dec | null;
    _pctBase: PercentageBase | null;
    _pct: Dec | null;
  })[] = [];
  const usedFx = new Map<string, CalcFx>();
  for (const l of input.lines) {
    const inc =
      l.category === 'PROCUREMENT'
        ? { included: true, reason: 'Product cost — always included' }
        : lineIncluded(input.incoterm, l.category, l.includeOverride);
    const base: (typeof rows)[number] = {
      lineId: l.id,
      category: l.category,
      label: l.label,
      included: inc.included,
      inclusionReason: inc.reason,
      extendedOriginal: null,
      originalCurrency: l.basis === 'PERCENTAGE' ? calc : l.currency,
      converted: null,
      formula: '',
      fxRateUsed: null,
      confidence: l.confidence,
      sourceType: l.sourceType,
      _conv: null,
      _pctBase: null,
      _pct: null,
    };
    if (l.validUntil && l.validUntil < now)
      issues.push({
        code: 'QUOTE_EXPIRED',
        blocking: false,
        message: `Quote for “${l.label}” expired on ${l.validUntil.toISOString().slice(0, 10)}.`,
        lineId: l.id,
        category: l.category,
      });
    if (l.amount === null) {
      base.formula = 'Not provided';
      if (inc.included)
        issues.push({
          code: 'AMOUNT_MISSING',
          blocking: true,
          message: `“${l.label}” has no amount (not provided).`,
          lineId: l.id,
          category: l.category,
        });
      rows.push(base);
      continue;
    }
    const amt = new D(l.amount);
    if (l.basis === 'PERCENTAGE') {
      base._pctBase = l.percentageBase;
      base._pct = amt;
      rows.push(base);
      continue;
    }
    let ext: Dec;
    if (l.basis === 'FIXED') {
      ext = amt;
      base.formula = `Fixed ${fmt(amt, l.currency)}`;
    } else {
      const b = basisQty(l.basis);
      if (!b) {
        base.formula = `${l.basis.replace('_', ' ').toLowerCase()} — basis quantity missing`;
        issues.push({
          code: 'BASIS_QUANTITY_MISSING',
          blocking: inc.included,
          message: `“${l.label}”: ${basisHint[l.basis] ?? 'Basis quantity missing.'}`,
          lineId: l.id,
          category: l.category,
        });
        rows.push(base);
        continue;
      }
      ext = amt.mul(b.q);
      base.formula = `${fmt(amt, l.currency)} × ${b.label}`;
    }
    if (l.wastagePercent !== null && !new D(l.wastagePercent).isZero()) {
      ext = ext.mul(new D(1).plus(new D(l.wastagePercent).div(HUNDRED)));
      base.formula += ` × (1 + ${l.wastagePercent}% wastage)`;
    }
    base.extendedOriginal = money(ext);
    const c = convert(ext, l.currency, calc, input.fx);
    if (!c) {
      issues.push({
        code: 'FX_REQUIRED',
        blocking: inc.included,
        message: `FX rate required: ${l.currency} → ${calc} for “${l.label}”.`,
        lineId: l.id,
        category: l.category,
        currency: l.currency,
      });
    } else {
      base._conv = c.value;
      base.converted = money(c.value);
      if (c.rate) {
        base.fxRateUsed = c.rate.toFixed(6);
        base.formula += ` × FX ${c.rate.toFixed(6)}`;
        if (c.fx) usedFx.set(c.fx.snapshotId, c.fx);
      }
    }
    rows.push(base);
  }

  // Percentage lines use an explicit base, computed after all non-percentage lines.
  const sum = (pred: (r: (typeof rows)[number]) => boolean) => {
    const sel = rows.filter(pred);
    if (sel.some((r) => r._conv === null)) return null;
    return sel.reduce((s, r) => s.plus(r._conv!), new D(0));
  };
  const procurementBase = sum(
    (r) => r.category === 'PROCUREMENT' && r._pct === null,
  );
  const preInsurance = sum(
    (r) => r.included && r._pct === null && r.category !== 'INSURANCE',
  );
  for (const r of rows.filter((x) => x._pct !== null)) {
    const baseVal =
      r._pctBase === 'PROCUREMENT_VALUE'
        ? procurementBase
        : r._pctBase === 'PRE_INSURANCE_COST'
          ? preInsurance
          : null;
    const baseName =
      r._pctBase === 'PROCUREMENT_VALUE'
        ? 'procurement value'
        : 'cost before insurance';
    if (!r._pctBase || baseVal === null) {
      r.formula = `${r._pct!.toString()}% — base ${r._pctBase ? 'not computable' : 'not selected'}`;
      issues.push({
        code: 'PERCENTAGE_BASE_MISSING',
        blocking: r.included,
        message: `“${r.label}”: percentage base ${r._pctBase ? 'cannot be computed until its inputs are complete' : 'must be selected'}.`,
        lineId: r.lineId,
        category: r.category,
      });
      continue;
    }
    r._conv = baseVal.mul(r._pct!).div(HUNDRED);
    r.converted = money(r._conv);
    r.extendedOriginal = r.converted;
    r.formula = `${r._pct!.toString()}% × ${baseName} ${money(baseVal)} ${calc}`;
  }

  if (!input.lines.some((l) => l.category === 'PROCUREMENT'))
    issues.push({
      code: 'PROCUREMENT_MISSING',
      blocking: true,
      message: 'Add a procurement / product cost.',
      category: 'PROCUREMENT',
    });
  for (const cat of policy.required) {
    if (cat === 'PROCUREMENT') continue;
    if (!rows.some((r) => r.category === cat && r.included && r._conv !== null))
      issues.push({
        code: 'REQUIRED_CATEGORY_MISSING',
        blocking: true,
        message: `${input.incoterm} requires a ${cat.toLowerCase()} cost.`,
        category: cat,
      });
  }
  if (rows.some((r) => r.included && r.confidence !== 'CONFIRMED'))
    issues.push({
      code: 'ESTIMATE_USED',
      blocking: false,
      message: 'Some included costs are estimates or unconfirmed.',
    });

  const blocking = issues.some((i) => i.blocking);
  const categories: CategoryBreakdown[] = COST_CATEGORY_ORDER.filter((c) =>
    rows.some((r) => r.category === c),
  ).map((c) => {
    const rs = rows.filter((r) => r.category === c);
    const inc = rs.filter((r) => r.included);
    const complete = inc.every((r) => r._conv !== null);
    return {
      category: c,
      included: inc.length > 0,
      amount:
        inc.length && complete
          ? money(inc.reduce((s, r) => s.plus(r._conv!), new D(0)))
          : null,
      lineCount: rs.length,
    };
  });
  const total = blocking
    ? null
    : rows
        .filter((r) => r.included)
        .reduce((s, r) => s.plus(r._conv ?? 0), new D(0));
  const cpu = total && qty.gt(0) ? total.div(qty) : null;

  let pricing: PricingResult | null = null;
  if (total && cpu) {
    let price: Dec | null = null;
    const pv = input.pricingValue !== null ? new D(input.pricingValue) : null;
    if (pv === null)
      issues.push({
        code: 'PRICING_INPUT_MISSING',
        blocking: false,
        message:
          input.pricingMode === 'TARGET_PRICE'
            ? 'Enter a target selling price.'
            : `Enter a ${input.pricingMode === 'MARGIN' ? 'margin' : 'markup'} %.`,
      });
    else if (input.pricingMode === 'MARGIN') {
      if (pv.gte(100) || pv.lte(-100))
        issues.push({
          code: 'MARGIN_INVALID',
          blocking: false,
          message:
            'Margin must be below 100% (margin is profit ÷ selling price).',
        });
      else price = priceFromMargin(cpu, pv);
    } else if (input.pricingMode === 'MARKUP') {
      if (pv.lte(-100))
        issues.push({
          code: 'MARGIN_INVALID',
          blocking: false,
          message: 'Markup must be above −100%.',
        });
      else price = priceFromMarkup(cpu, pv);
    } else {
      const c = convert(pv, input.quoteCurrency, calc, input.fx);
      if (!c)
        issues.push({
          code: 'PRICING_FX_REQUIRED',
          blocking: false,
          message: `FX rate required: ${input.quoteCurrency} → ${calc} to evaluate the target price.`,
          currency: input.quoteCurrency,
        });
      else price = c.value;
    }
    if (price) {
      const profit = price.minus(cpu);
      const m = marginPercent(cpu, price);
      const k = markupPercent(cpu, price);
      const toQuote = convert(price, calc, input.quoteCurrency, input.fx);
      const cpuQuote = convert(cpu, calc, input.quoteCurrency, input.fx);
      let target: PricingResult['buyerTarget'] = null;
      if (input.buyerTargetPrice !== null) {
        const t = new D(input.buyerTargetPrice);
        const gap =
          toQuote && !t.isZero()
            ? toQuote.value.minus(t).div(t).mul(HUNDRED)
            : null;
        target = {
          pricePerUnit: perUnit(t),
          currency: input.quoteCurrency,
          gapPercent: gap ? pct(gap) : null,
          position:
            gap === null
              ? null
              : gap.gt(0)
                ? 'ABOVE'
                : gap.lt(0)
                  ? 'BELOW'
                  : 'EQUAL',
        };
      }
      pricing = {
        mode: input.pricingMode,
        costPerUnit: perUnit(cpu),
        sellingPricePerUnit: perUnit(price),
        profitPerUnit: perUnit(profit),
        totalRevenue: money(price.mul(qty)),
        totalProfit: money(profit.mul(qty)),
        marginPercent: m ? pct(m) : null,
        markupPercent: k ? pct(k) : null,
        feasibility: feasibility(m, profit, new D(input.thinMarginPercent)),
        quoteCurrency: input.quoteCurrency,
        sellingPricePerUnitQuote: toQuote ? perUnit(toQuote.value) : null,
        costPerUnitQuote: cpuQuote ? perUnit(cpuQuote.value) : null,
        buyerTarget: target,
      };
      if (input.quoteCurrency !== calc && !toQuote)
        issues.push({
          code: 'PRICING_FX_REQUIRED',
          blocking: false,
          message: `FX rate required: ${calc} → ${input.quoteCurrency} to show the price in ${input.quoteCurrency}.`,
          currency: input.quoteCurrency,
        });
    }
  }

  return {
    formulaVersion: COSTING_FORMULA_VERSION,
    calculatedAt: now.toISOString(),
    calculationCurrency: calc,
    incoterm: input.incoterm,
    incotermLabel: policy.label,
    complete: !blocking,
    issues,
    lines: rows.map((r) => ({
      lineId: r.lineId,
      category: r.category,
      label: r.label,
      included: r.included,
      inclusionReason: r.inclusionReason,
      extendedOriginal: r.extendedOriginal,
      originalCurrency: r.originalCurrency,
      converted: r.converted,
      formula: r.formula,
      fxRateUsed: r.fxRateUsed,
      confidence: r.confidence,
      sourceType: r.sourceType,
    })),
    categories,
    totalCost: total ? money(total) : null,
    costPerUnit: cpu ? perUnit(cpu) : null,
    quantity: qty.toString(),
    quantityUnit: input.quantityUnit,
    pricing,
    fxUsed: [...usedFx.values()].map((f) => ({
      pair: `${f.baseCurrency}/${f.quoteCurrency}`,
      rate: new D(f.rate).toFixed(6),
      snapshotId: f.snapshotId,
      sourceType: f.sourceType,
      sourceDate: f.sourceDate.toISOString().slice(0, 10),
    })),
  };
}

/** Same inputs priced under every supported Incoterm. */
export function compareIncoterms(
  input: CalcInput,
  now = new Date(),
): IncotermComparisonRow[] {
  return INCOTERM_ORDER.map((t) => {
    const r = calculate({ ...input, incoterm: t }, now);
    return {
      incoterm: t,
      totalCost: r.totalCost,
      costPerUnit: r.costPerUnit,
      sellingPricePerUnit: r.pricing?.sellingPricePerUnit ?? null,
      profitPerUnit: r.pricing?.profitPerUnit ?? null,
      totalProfit: r.pricing?.totalProfit ?? null,
      marginPercent: r.pricing?.marginPercent ?? null,
      includedCategories: r.categories
        .filter((c) => c.included)
        .map((c) => c.category),
      complete: r.complete,
    };
  });
}

/**
 * FX sensitivity: +X% means one unit of every foreign currency is worth X%
 * more in the calculation currency. Saved snapshots are never modified.
 */
export function fxSensitivity(
  input: CalcInput,
  shifts = [-5, -2, 0, 2, 5],
  now = new Date(),
): FxSensitivityRow[] {
  return shifts.map((s) => {
    const f = new D(1).plus(new D(s).div(HUNDRED));
    const fx = input.fx.map((x) => ({
      ...x,
      rate: (x.baseCurrency === input.calculationCurrency
        ? new D(x.rate).div(f)
        : new D(x.rate).mul(f)
      ).toString(),
    }));
    const r = calculate({ ...input, fx }, now);
    return {
      shiftPercent: s,
      rates: fx.map((x) => ({
        pair: `${x.baseCurrency}/${x.quoteCurrency}`,
        rate: new D(x.rate).toFixed(6),
      })),
      totalCost: r.totalCost,
      sellingPricePerUnitQuote: r.pricing?.sellingPricePerUnitQuote ?? null,
      totalProfit: r.pricing?.totalProfit ?? null,
      marginPercent: r.pricing?.marginPercent ?? null,
    };
  });
}
