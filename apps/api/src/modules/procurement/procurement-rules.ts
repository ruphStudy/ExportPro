import type { SupplierPaymentTrigger } from '@exportpro/types';
import { D, type Dec } from '../costing/costing-calculator';
import { addDays, isoDay } from '../finance/finance-rules';

/** Sprint 21 — pure procurement rules (no guessing: unknown stays unknown). */

export const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(
      /\b(private|pvt|limited|ltd|llp|co|company|industries|inc|the)\b\.?/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export const phoneKey = (p: string | null | undefined) => {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-10) : null;
};
/** GSTIN format: 2-digit state + PAN (10) + entity + Z + checksum. Format only — not verification. */
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Quantities in kg for MOQ/capacity comparisons (only for mass units; otherwise same-unit only). */
export function toKg(
  qty: Dec | null,
  unit: string | null | undefined,
): Dec | null {
  if (!qty || !unit) return null;
  const u = unit.toUpperCase();
  if (u === 'KG' || u === 'KGS') return qty;
  if (u === 'MT' || u === 'TON' || u === 'TONNE' || u === 'T')
    return qty.mul(1000);
  if (u === 'QUINTAL' || u === 'QTL') return qty.mul(100);
  return null;
}
export function sameMeasure(
  a: Dec | null,
  aUnit: string | null,
  b: Dec | null,
  bUnit: string | null,
): [Dec, Dec] | null {
  if (!a || !b) return null;
  const ka = toKg(a, aUnit);
  const kb = toKg(b, bUnit);
  if (ka && kb) return [ka, kb];
  if ((aUnit ?? '').toUpperCase() === (bUnit ?? '').toUpperCase())
    return [a, b];
  return null;
}
/** Per-period capacity normalized to per-month where possible. */
export function monthlyCapacity(
  cap: Dec | null,
  period: string | null | undefined,
): Dec | null {
  if (!cap) return null;
  const p = (period ?? 'MONTH').toUpperCase();
  if (p.startsWith('DAY')) return cap.mul(30);
  if (p.startsWith('WEEK')) return cap.mul(4.33);
  if (p.startsWith('MONTH')) return cap;
  if (p.startsWith('YEAR')) return cap.div(12);
  return null;
}

export interface FitFactor {
  factor: string;
  points: number;
  max: number;
  explanation: string;
}

/**
 * Deterministic fit score. Factors with no data score 0 and are excluded from
 * confidence — missing data never looks "excellent".
 */
export function scoreFit(f: {
  price?: { value: Dec | null; best: Dec | null };
  leadTimeDays?: {
    value: number | null;
    requiredDays: number | null;
    best: number | null;
  };
  moq?: { fit: boolean | null };
  capacity?: { fit: boolean | null };
  certifications?: { required: string[]; have: string[] };
  quality?: { passRate: number | null; inspections: number };
  delivery?: { onTimeRate: number | null; receipts: number };
}): { score: number; confidencePercent: number; factors: FitFactor[] } {
  const out: FitFactor[] = [];
  let known = 0;
  let total = 0;
  const add = (
    factor: string,
    max: number,
    points: number | null,
    explanation: string,
  ) => {
    total += max;
    if (points !== null) known += max;
    out.push({ factor, max, points: points ?? 0, explanation });
  };
  if (f.price) {
    const { value, best } = f.price;
    add(
      'Price',
      30,
      value && best
        ? value.lte(best)
          ? 30
          : Math.max(
              0,
              Math.round(30 - value.minus(best).div(best).mul(100).toNumber()),
            )
        : null,
      value && best
        ? value.lte(best)
          ? 'Lowest comparable price.'
          : `${value.minus(best).div(best).mul(100).toFixed(1)}% above the lowest.`
        : 'Price not available or not comparable.',
    );
  }
  if (f.leadTimeDays) {
    const { value, requiredDays, best } = f.leadTimeDays;
    const pts =
      value === null
        ? null
        : requiredDays !== null && value > requiredDays
          ? 0
          : best !== null && value > best
            ? Math.max(5, 20 - (value - best))
            : 20;
    add(
      'Lead time',
      20,
      pts,
      value === null
        ? 'Lead time not stated.'
        : requiredDays !== null && value > requiredDays
          ? `${value} days exceeds the ${requiredDays} days available.`
          : `${value} days${best !== null && value > best ? ` (${value - best} slower than the fastest)` : ''}.`,
    );
  }
  if (f.moq)
    add(
      'MOQ fit',
      10,
      f.moq.fit === null ? null : f.moq.fit ? 10 : 0,
      f.moq.fit === null
        ? 'MOQ not stated or not comparable.'
        : f.moq.fit
          ? 'MOQ within the required quantity.'
          : 'MOQ above the required quantity.',
    );
  if (f.capacity)
    add(
      'Capacity fit',
      10,
      f.capacity.fit === null ? null : f.capacity.fit ? 10 : 0,
      f.capacity.fit === null
        ? 'Capacity not stated or not comparable.'
        : f.capacity.fit
          ? 'Stated capacity covers the quantity.'
          : 'Stated capacity below the quantity.',
    );
  if (f.certifications && f.certifications.required.length) {
    const have = f.certifications.have.map((x) => x.toUpperCase());
    const missing = f.certifications.required.filter(
      (r) => !have.some((h) => h.includes(r.toUpperCase())),
    );
    add(
      'Certifications',
      15,
      Math.round(
        (15 * (f.certifications.required.length - missing.length)) /
          f.certifications.required.length,
      ),
      missing.length
        ? `Missing: ${missing.join(', ')} (unverified claims count only as stated).`
        : 'All required certifications stated/on file (not authenticated).',
    );
  }
  if (f.quality)
    add(
      'Quality history',
      10,
      f.quality.inspections ? Math.round((f.quality.passRate ?? 0) / 10) : null,
      f.quality.inspections
        ? `${f.quality.passRate?.toFixed(0)}% of ${f.quality.inspections} inspection(s) passed.`
        : 'No inspection history yet.',
    );
  if (f.delivery)
    add(
      'Delivery history',
      5,
      f.delivery.receipts
        ? Math.round((f.delivery.onTimeRate ?? 0) / 20)
        : null,
      f.delivery.receipts
        ? `${f.delivery.onTimeRate?.toFixed(0)}% on time over ${f.delivery.receipts} order(s).`
        : 'No delivery history yet.',
    );
  const earned = out.reduce((s, x) => s + x.points, 0);
  return {
    score: total ? Math.round((earned / total) * 100) : 0,
    confidencePercent: total ? Math.round((known / total) * 100) : 0,
    factors: out,
  };
}

/** Landed per-unit cost from stated components only; unknown components are listed, never assumed zero. */
export function landedUnit(
  q: {
    unitPrice: Dec;
    taxPercent: Dec | null;
    taxIncluded: boolean | null;
    packagingPerUnit: Dec | null;
    inlandTransportPerUnit: Dec | null;
    inspectionTotal: Dec | null;
    otherTotal: Dec | null;
    priceBasis: string;
  },
  quantity: Dec | null,
) {
  const unknown: string[] = [];
  let unit = q.unitPrice;
  if (q.packagingPerUnit !== null) unit = unit.plus(q.packagingPerUnit);
  else unknown.push('packaging');
  if (q.inlandTransportPerUnit !== null)
    unit = unit.plus(q.inlandTransportPerUnit);
  else if (q.priceBasis === 'EX_FACTORY') unknown.push('inland transport');
  if (q.inspectionTotal !== null && quantity && quantity.gt(0))
    unit = unit.plus(q.inspectionTotal.div(quantity));
  else if (q.inspectionTotal === null) unknown.push('inspection');
  if (q.otherTotal !== null && quantity && quantity.gt(0))
    unit = unit.plus(q.otherTotal.div(quantity));
  if (q.taxPercent === null && q.taxIncluded === null) unknown.push('taxes');
  return {
    unit: unit.toDecimalPlaces(4),
    unknown,
    taxNote: q.taxIncluded
      ? 'tax included in price'
      : q.taxPercent !== null
        ? `tax ${q.taxPercent.toString()}% extra (shown separately; assumed recoverable)`
        : 'tax not stated',
  };
}

// ------------------------------------------------------------ PO lifecycle

export const PO_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['ISSUED', 'CANCELLED'],
  ISSUED: ['ACKNOWLEDGED', 'IN_PRODUCTION', 'READY', 'CANCELLED'],
  ACKNOWLEDGED: ['IN_PRODUCTION', 'READY', 'CANCELLED'],
  IN_PRODUCTION: ['READY', 'CANCELLED'],
  READY: [],
  PARTIALLY_RECEIVED: [],
  RECEIVED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};
/** Operational procurement status implied by a commercial status change. */
export const PROC_FOR_STATUS: Record<string, string> = {
  ISSUED: 'ORDERED',
  ACKNOWLEDGED: 'SUPPLIER_ACKNOWLEDGED',
  IN_PRODUCTION: 'IN_PRODUCTION',
  READY: 'READY',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  COMPLETED: 'CLOSED',
  CANCELLED: 'CANCELLED',
};

// ------------------------------------------------------------ payables

export interface PayableContext {
  issuedAt: Date | null;
  dispatchedAt: Date | null;
  receivedAt: Date | null;
}

export function resolvePayableDue(
  i: { trigger: string; dueDays: number | null; fixedDate: Date | null },
  c: PayableContext,
): { dueDate: Date | null; basis: string } {
  const plus = (base: Date | null, label: string) =>
    base
      ? {
          dueDate: addDays(base, i.dueDays ?? 0),
          basis: `${label} ${isoDay(base)}${i.dueDays ? ` + ${i.dueDays} days` : ''}`,
        }
      : { dueDate: null, basis: `Waiting for ${label.toLowerCase()}` };
  switch (i.trigger as SupplierPaymentTrigger) {
    case 'ADVANCE':
      return plus(c.issuedAt, 'PO issued');
    case 'ON_DISPATCH':
      return plus(c.dispatchedAt, 'Dispatched');
    case 'ON_DELIVERY':
      return plus(c.receivedAt, 'Received');
    case 'CREDIT_DAYS':
      return plus(c.receivedAt, 'Received');
    default:
      return i.fixedDate
        ? { dueDate: i.fixedDate, basis: 'Agreed date' }
        : { dueDate: null, basis: 'No due date set' };
  }
}

export const m2 = (d: Dec) => d.toDecimalPlaces(2).toFixed(2);
export const qty = (d: Dec | null | undefined) =>
  d === null || d === undefined
    ? null
    : new D(d.toString()).toDecimalPlaces(4).toString();
