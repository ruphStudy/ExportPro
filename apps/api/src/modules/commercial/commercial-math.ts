import type { DiscrepancySeverity, PODiscrepancyType } from '@exportpro/types';
import { D, type Dec, money } from '../costing/costing-calculator';

/**
 * Commercial document arithmetic and PO comparison. Reuses the Sprint 14
 * decimal policy (decimal.js, 40 digits, ROUND_HALF_UP, money 2 dp) — no
 * competing money engine. Everything here is deterministic; nothing is
 * decided by AI.
 */

/** Unit prices are rounded once to the organization's unit-price precision (2–4 dp). */
export const roundPrice = (v: string | Dec, precision: number) =>
  new D(v.toString()).toDecimalPlaces(precision, D.ROUND_HALF_UP);

/** Item total = quantity × unit price, rounded to 2 dp. */
export const lineTotal = (qty: string | Dec, unitPrice: string | Dec) =>
  new D(qty.toString())
    .mul(unitPrice.toString())
    .toDecimalPlaces(2, D.ROUND_HALF_UP);

/** Subtotal = Σ item totals; total = subtotal + charges − discount (never negative-checked silently: caller validates). */
export function documentTotals(
  items: { quantity: string; unitPrice: string | null }[],
  charges: string,
  discount: string,
) {
  if (items.some((i) => i.unitPrice === null))
    return { subtotal: null, total: null };
  const subtotal = items.reduce(
    (s, i) => s.plus(lineTotal(i.quantity, i.unitPrice!)),
    new D(0),
  );
  const total = subtotal.plus(charges || '0').minus(discount || '0');
  return { subtotal: money(subtotal), total: money(total) };
}

/** Whitespace/case/punctuation-insensitive comparison key (originals are always kept for display). */
export const normText = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9%/]+/g, ' ')
    .trim();

export interface CompareItem {
  id: string;
  /** Quotation item id this line corresponds to (quotation: own id; PI/PO: linked quotation item). */
  matchKey: string | null;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string | null;
  totalPrice?: string | null;
  specification: string | null;
}

export interface CompareDoc {
  kind: 'QUOTATION' | 'PI';
  label: string;
  buyerCompanyId: string | null;
  currency: string;
  incoterm: string | null;
  incotermPlace: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  total: string | null;
  items: CompareItem[];
}

export interface ComparePo extends Omit<
  CompareDoc,
  'kind' | 'label' | 'total'
> {
  totalAmount: string | null;
}

export interface Finding {
  signature: string;
  against: 'QUOTATION' | 'PI' | 'PO';
  type: PODiscrepancyType;
  severity: DiscrepancySeverity;
  field: string;
  itemLabel: string | null;
  expectedValue: string | null;
  actualValue: string | null;
  message: string;
}

/** Quantity differences above the tolerance but within this % are WARNING; beyond it CRITICAL. */
export const QUANTITY_CRITICAL_PERCENT = 10;
const pctDiff = (actual: Dec, expected: Dec) =>
  expected.isZero()
    ? actual.isZero()
      ? new D(0)
      : new D(100)
    : actual.minus(expected).abs().div(expected).mul(100);

/**
 * Rules (deterministic):
 *  buyer / currency / Incoterm term / unit / unit price beyond tolerance / document total → CRITICAL;
 *  quantity: ≤ tolerance none, ≤ max(tolerance, 10 %) WARNING, otherwise CRITICAL;
 *  named place, payment terms, delivery terms, specification (normalized text differs) → WARNING;
 *  PO item not on the reference → CRITICAL (PRODUCT); reference item missing from PO → WARNING;
 *  PO internal arithmetic (line totals, stated total vs lines) → WARNING.
 * Tolerances are explicit organization settings (default 0 %).
 */
export function comparePo(
  po: ComparePo,
  refs: CompareDoc[],
  tol: { quantityPercent: string; pricePercent: string },
): Finding[] {
  const out: Finding[] = [];
  const add = (f: Omit<Finding, 'signature'>) =>
    out.push({
      ...f,
      signature: [
        f.against,
        f.type,
        f.field,
        f.itemLabel ?? '',
        f.expectedValue ?? '',
        f.actualValue ?? '',
      ]
        .join('|')
        .slice(0, 480),
    });
  const qTol = new D(tol.quantityPercent || 0);
  const pTol = new D(tol.pricePercent || 0);

  // PO internal consistency
  let linesSum = new D(0);
  for (const it of po.items) {
    const lt = lineTotal(it.quantity, it.unitPrice ?? '0');
    linesSum = linesSum.plus(lt);
    if (it.totalPrice && !new D(it.totalPrice).eq(lt))
      add({
        against: 'PO',
        type: 'TOTAL',
        severity: 'WARNING',
        field: 'lineTotal',
        itemLabel: it.description,
        expectedValue: money(lt),
        actualValue: it.totalPrice,
        message: `PO line total ${it.totalPrice} does not equal quantity × price (${money(lt)}).`,
      });
  }
  const poTotal = po.totalAmount ? new D(po.totalAmount) : linesSum;
  if (po.totalAmount && !new D(po.totalAmount).eq(linesSum))
    add({
      against: 'PO',
      type: 'TOTAL',
      severity: 'WARNING',
      field: 'total',
      itemLabel: null,
      expectedValue: money(linesSum),
      actualValue: po.totalAmount,
      message: `PO stated total ${po.totalAmount} differs from the sum of its lines (${money(linesSum)}).`,
    });
  if (!refs.length)
    add({
      against: 'PO',
      type: 'OTHER',
      severity: 'INFO',
      field: 'reference',
      itemLabel: null,
      expectedValue: null,
      actualValue: null,
      message:
        'No quotation or proforma invoice linked — nothing to compare against.',
    });

  for (const ref of refs) {
    const a = ref.kind;
    const lbl = ref.label;
    if (
      ref.buyerCompanyId &&
      po.buyerCompanyId &&
      ref.buyerCompanyId !== po.buyerCompanyId
    )
      add({
        against: a,
        type: 'OTHER',
        severity: 'CRITICAL',
        field: 'buyer',
        itemLabel: null,
        expectedValue: ref.buyerCompanyId,
        actualValue: po.buyerCompanyId,
        message: `PO buyer differs from ${lbl}.`,
      });
    if (ref.currency !== po.currency)
      add({
        against: a,
        type: 'CURRENCY',
        severity: 'CRITICAL',
        field: 'currency',
        itemLabel: null,
        expectedValue: ref.currency,
        actualValue: po.currency,
        message: `Currency ${po.currency} differs from ${lbl} (${ref.currency}).`,
      });
    if ((ref.incoterm ?? '') !== (po.incoterm ?? ''))
      add({
        against: a,
        type: 'INCOTERM',
        severity: 'CRITICAL',
        field: 'incoterm',
        itemLabel: null,
        expectedValue: ref.incoterm,
        actualValue: po.incoterm,
        message: `Incoterm ${po.incoterm ?? '(none)'} differs from ${lbl} (${ref.incoterm ?? 'none'}).`,
      });
    else if (normText(ref.incotermPlace) !== normText(po.incotermPlace))
      add({
        against: a,
        type: 'INCOTERM',
        severity: 'WARNING',
        field: 'incotermPlace',
        itemLabel: null,
        expectedValue: ref.incotermPlace,
        actualValue: po.incotermPlace,
        message: `Named place “${po.incotermPlace ?? ''}” differs from ${lbl} (“${ref.incotermPlace ?? ''}”).`,
      });
    if (normText(ref.paymentTerms) !== normText(po.paymentTerms))
      add({
        against: a,
        type: 'PAYMENT_TERM',
        severity: 'WARNING',
        field: 'paymentTerms',
        itemLabel: null,
        expectedValue: ref.paymentTerms,
        actualValue: po.paymentTerms,
        message: `Payment terms differ from ${lbl}.`,
      });
    if (normText(ref.deliveryTerms) !== normText(po.deliveryTerms))
      add({
        against: a,
        type: 'DELIVERY',
        severity: 'WARNING',
        field: 'deliveryTerms',
        itemLabel: null,
        expectedValue: ref.deliveryTerms,
        actualValue: po.deliveryTerms,
        message: `Delivery terms differ from ${lbl}.`,
      });

    const used = new Set<string>();
    for (const it of po.items) {
      const match =
        ref.items.find(
          (r) => !used.has(r.id) && it.matchKey && r.matchKey === it.matchKey,
        ) ??
        ref.items.find(
          (r) =>
            !used.has(r.id) &&
            normText(r.description) === normText(it.description),
        );
      if (!match) {
        add({
          against: a,
          type: 'PRODUCT',
          severity: 'CRITICAL',
          field: 'item',
          itemLabel: it.description,
          expectedValue: null,
          actualValue: it.description,
          message: `“${it.description}” is not on ${lbl}.`,
        });
        continue;
      }
      used.add(match.id);
      if (match.unit.trim().toUpperCase() !== it.unit.trim().toUpperCase()) {
        add({
          against: a,
          type: 'QUANTITY',
          severity: 'CRITICAL',
          field: 'unit',
          itemLabel: it.description,
          expectedValue: match.unit,
          actualValue: it.unit,
          message: `Unit ${it.unit} differs from ${lbl} (${match.unit}); quantities are not converted.`,
        });
      } else {
        const qd = pctDiff(new D(it.quantity), new D(match.quantity));
        if (qd.gt(qTol))
          add({
            against: a,
            type: 'QUANTITY',
            severity: qd.gt(D.max(qTol, QUANTITY_CRITICAL_PERCENT))
              ? 'CRITICAL'
              : 'WARNING',
            field: 'quantity',
            itemLabel: it.description,
            expectedValue: `${new D(match.quantity).toString()} ${match.unit}`,
            actualValue: `${new D(it.quantity).toString()} ${it.unit}`,
            message: `Quantity differs from ${lbl} by ${qd.toFixed(2)}%.`,
          });
      }
      if (match.unitPrice !== null && it.unitPrice !== null) {
        const pd = pctDiff(new D(it.unitPrice), new D(match.unitPrice));
        if (pd.gt(pTol))
          add({
            against: a,
            type: 'PRICE',
            severity: 'CRITICAL',
            field: 'unitPrice',
            itemLabel: it.description,
            expectedValue: new D(match.unitPrice).toString(),
            actualValue: new D(it.unitPrice).toString(),
            message: `Unit price differs from ${lbl} (${new D(it.unitPrice).toString()} vs ${new D(match.unitPrice).toString()} ${ref.currency}).`,
          });
      }
      if (
        match.specification &&
        it.specification &&
        normText(match.specification) !== normText(it.specification)
      )
        add({
          against: a,
          type: 'SPECIFICATION',
          severity: 'WARNING',
          field: 'specification',
          itemLabel: it.description,
          expectedValue: match.specification,
          actualValue: it.specification,
          message: `Specification differs from ${lbl}.`,
        });
    }
    for (const r of ref.items.filter((x) => !used.has(x.id)))
      add({
        against: a,
        type: 'PRODUCT',
        severity: 'WARNING',
        field: 'item',
        itemLabel: r.description,
        expectedValue: r.description,
        actualValue: null,
        message: `“${r.description}” from ${lbl} is missing on the PO.`,
      });
    if (ref.total !== null && !new D(ref.total).eq(poTotal))
      add({
        against: a,
        type: 'TOTAL',
        severity: 'CRITICAL',
        field: 'total',
        itemLabel: null,
        expectedValue: ref.total,
        actualValue: money(poTotal),
        message: `PO total ${money(poTotal)} differs from ${lbl} total ${ref.total}.`,
      });
  }
  return out;
}
