import type {
  InstallmentTrigger,
  ParsedPaymentTerms,
  PaymentTermsSnapshot,
  PaymentTermsType,
  ReceivableStatus,
  RepeatSignalLevel,
} from '@exportpro/types';
import { D, type Dec } from '../costing/costing-calculator';

/**
 * Sprint 19 — pure, deterministic finance rules. Nothing here guesses a date,
 * an amount, an FX rate or a probability.
 */

const DAY = 86400000;
export const utcDay = (d: Date) =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
/** Whole UTC calendar days from a to b (b − a). */
export const dayDiff = (a: Date, b: Date) =>
  Math.round((utcDay(b) - utcDay(a)) / DAY);
export const addDays = (d: Date, n: number) => new Date(utcDay(d) + n * DAY);
export const isoDay = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;
export const m2 = (d: Dec) => d.toDecimalPlaces(2).toFixed(2);

// ------------------------------------------------------------ terms parsing

type Inst = PaymentTermsSnapshot['installments'][number];

const PHRASES: [RegExp, InstallmentTrigger][] = [
  [/before\s+(production|manufactur)/, 'BEFORE_PRODUCTION'],
  [/(before|prior to)\s+(shipment|dispatch|loading)/, 'BEFORE_SHIPMENT'],
  [
    /(after|of|from)\s+(delivery|arrival)|(delivery|arrival)\s*\+/,
    'AFTER_DELIVERY_DAYS',
  ],
  [/(on|upon|at)\s+(delivery|arrival)/, 'ON_DELIVERY'],
  [
    /(against|on|upon)\s+(presentation|documents?|docs)|cad|cash against/,
    'ON_DOCUMENT_PRESENTATION',
  ],
  [
    /(against|on|upon|after)\s+(copy of\s+)?(b\/?l|bill of lading|shipment|awb)|(b\/?l|shipment)\s+date/,
    'ON_SHIPMENT',
  ],
  [/(against|on|upon)\s+(pi|proforma)/, 'PI_ISSUE'],
  [
    /advance|with (the )?order|on order|order confirmation|upfront|tt in advance/,
    'ORDER_CONFIRMATION',
  ],
];

function phraseTrigger(phrase: string): {
  trigger: InstallmentTrigger | null;
  days: number | null;
} {
  const p = phrase.toLowerCase();
  const days = /(\d{1,3})\s*days?/.exec(p);
  for (const [re, t] of PHRASES)
    if (re.test(p)) {
      if (t === 'AFTER_DELIVERY_DAYS' && !days)
        return { trigger: 'ON_DELIVERY', days: null };
      return { trigger: t, days: days ? Number(days[1]) : null };
    }
  return { trigger: null, days: null };
}

const LABEL: Record<InstallmentTrigger, string> = {
  ORDER_CONFIRMATION: 'Advance on order confirmation',
  PI_ISSUE: 'On proforma invoice',
  BEFORE_PRODUCTION: 'Before production',
  BEFORE_SHIPMENT: 'Before shipment',
  ON_SHIPMENT: 'On shipment',
  ON_DOCUMENT_PRESENTATION: 'On document presentation',
  ON_DELIVERY: 'On delivery',
  AFTER_DELIVERY_DAYS: 'After delivery',
  FIXED_DATE: 'Fixed date',
  MANUAL: 'Manual',
};
export const triggerLabel = (t: InstallmentTrigger) => LABEL[t];

/** Split a total by explicit percentages; the last line absorbs rounding so the sum is exact. */
export function splitAmounts(total: Dec, percentages: Dec[]): Dec[] {
  const out: Dec[] = [];
  let used = new D(0);
  percentages.forEach((p, i) => {
    const a =
      i === percentages.length - 1
        ? total.minus(used)
        : total.mul(p).div(100).toDecimalPlaces(2);
    used = used.plus(a);
    out.push(a);
  });
  return out;
}

/**
 * Deterministic reading of agreed payment-terms wording. Only explicit
 * percentages/days are used; anything not understood is flagged so the user
 * confirms a custom schedule — splits are never inferred.
 */
export function parsePaymentTerms(
  wording: string | null,
  total: Dec | null,
): Omit<ParsedPaymentTerms, 'source'> {
  const notes: string[] = [];
  const empty = (
    type: PaymentTermsType | null,
    extra: Partial<ParsedPaymentTerms> = {},
  ) => ({
    type,
    wording,
    installments: [] as Inst[],
    termDays: null,
    tenorDays: null,
    recognized: false,
    notes,
    ...extra,
  });
  if (!wording?.trim()) {
    notes.push('No payment terms recorded on the commercial documents.');
    return empty(null);
  }
  const t = wording.toLowerCase();
  const amt = (p: Dec) => (total ? m2(total.mul(p).div(100)) : '0.00');
  const one = (
    trigger: InstallmentTrigger,
    label: string,
    dueDays: number | null = null,
  ): Inst[] => [
    {
      label,
      percentage: '100.0000',
      amount: total ? m2(total) : '0.00',
      triggerType: trigger,
      dueDays,
      fixedDate: null,
    },
  ];
  const days = /(\d{1,3})\s*days?/.exec(t);
  if (/\b(l\/c|lc|letter of credit)\b/.test(t)) {
    const usance = days ? Number(days[1]) : null;
    return {
      ...empty('LETTER_OF_CREDIT'),
      installments: one(
        'ON_DOCUMENT_PRESENTATION',
        usance ? `LC usance ${usance} days` : 'LC at sight',
        usance,
      ),
      tenorDays: usance,
      recognized: /sight/.test(t) || usance !== null,
    };
  }
  if (/\b(d\/a|da|documents against acceptance)\b/.test(t)) {
    if (!days) notes.push('D/A tenor (days) not stated — enter it.');
    return {
      ...empty('DOCUMENTS_AGAINST_ACCEPTANCE'),
      installments: one(
        'ON_DOCUMENT_PRESENTATION',
        days ? `D/A ${days[1]} days` : 'D/A',
        days ? Number(days[1]) : null,
      ),
      tenorDays: days ? Number(days[1]) : null,
      recognized: Boolean(days),
    };
  }
  if (
    /\b(d\/p|dp|documents against payment)\b|cash against documents|\bcad\b/.test(
      t,
    ) &&
    !/%/.test(t)
  )
    return {
      ...empty('DOCUMENTS_AGAINST_PAYMENT'),
      installments: one(
        'ON_DOCUMENT_PRESENTATION',
        'D/P — payment against documents',
      ),
      recognized: true,
    };
  const net =
    /\bnet\s*(\d{1,3})\b/.exec(t) ??
    /(\d{1,3})\s*days?\s+(from|of|after)\s+(the\s+)?invoice/.exec(t);
  if (net || /open account/.test(t)) {
    const n = net ? Number(net[1]) : null;
    if (!n) notes.push('Open-account credit days not stated — enter them.');
    return {
      ...empty('OPEN_ACCOUNT'),
      installments: one('FIXED_DATE', n ? `Net ${n}` : 'Open account', n),
      termDays: n,
      recognized: n !== null,
    };
  }
  const parts = [...t.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%\s*([^,;%]*)/g)];
  if (parts.length) {
    const insts: Inst[] = [];
    let ok = true;
    let sum = new D(0);
    for (const [, pct, phrase] of parts) {
      const p = new D(pct);
      sum = sum.plus(p);
      const { trigger, days: d } = phraseTrigger(phrase);
      if (!trigger) {
        ok = false;
        notes.push(
          `Could not map “${pct}% ${phrase.trim()}” to a trigger — choose one.`,
        );
      }
      const tr = trigger ?? 'MANUAL';
      insts.push({
        label: `${pct}% ${tr === 'MANUAL' ? phrase.trim() || 'manual' : LABEL[tr].toLowerCase()}`,
        percentage: p.toFixed(4),
        amount: '0.00',
        triggerType: tr,
        dueDays: d,
        fixedDate: null,
      });
    }
    if (!sum.eq(100)) {
      ok = false;
      notes.push(`Percentages add up to ${sum.toString()}%, not 100%.`);
    }
    if (total) {
      const amounts = splitAmounts(
        total,
        insts.map((i) => new D(i.percentage!)),
      );
      insts.forEach((i, k) => (i.amount = m2(amounts[k])));
    }
    const allAdvance = insts.every((i) =>
      [
        'ORDER_CONFIRMATION',
        'PI_ISSUE',
        'BEFORE_PRODUCTION',
        'BEFORE_SHIPMENT',
      ].includes(i.triggerType),
    );
    return {
      ...empty(allAdvance ? 'ADVANCE' : 'CUSTOM'),
      installments: insts,
      recognized: ok,
    };
  }
  if (/advance|\btt\b|t\/t/.test(t))
    return {
      ...empty('ADVANCE'),
      installments: one('ORDER_CONFIRMATION', '100% advance'),
      recognized: /advance/.test(t),
    };
  void amt;
  notes.push(
    'Payment terms wording not recognized — define a custom schedule and confirm it.',
  );
  return empty('CUSTOM');
}

// ------------------------------------------------------------ due dates

export interface DueContext {
  type: PaymentTermsType;
  poAcceptedAt: Date | null;
  piIssuedAt: Date | null;
  shipmentEtd: Date | null;
  shipmentDeparted: Date | null;
  deliveredAt: Date | null;
  documentsPresentedAt: Date | null;
  acceptedAt: Date | null;
}

/** Resolve an installment's due date from its trigger (null = trigger not yet reached). */
export function resolveDue(
  i: { triggerType: string; dueDays: number | null; fixedDate: Date | null },
  c: DueContext,
): { dueDate: Date | null; basis: string } {
  const plus = (base: Date | null, label: string) =>
    base
      ? {
          dueDate: addDays(base, i.dueDays ?? 0),
          basis: `${label} ${isoDay(base)}${i.dueDays ? ` + ${i.dueDays} days` : ''}`,
        }
      : { dueDate: null, basis: `Waiting for ${label.toLowerCase()}` };
  switch (i.triggerType as InstallmentTrigger) {
    case 'ORDER_CONFIRMATION':
      return plus(c.poAcceptedAt, 'PO accepted');
    case 'PI_ISSUE':
      return plus(c.piIssuedAt, 'PI issued');
    case 'BEFORE_SHIPMENT':
      return c.shipmentEtd
        ? {
            dueDate: addDays(c.shipmentEtd, -(i.dueDays ?? 0)),
            basis: `Before ETD ${isoDay(c.shipmentEtd)}`,
          }
        : i.fixedDate
          ? { dueDate: i.fixedDate, basis: 'Agreed date' }
          : { dueDate: null, basis: 'Waiting for shipment ETD' };
    case 'ON_SHIPMENT':
      return plus(c.shipmentDeparted, 'Shipped');
    case 'ON_DOCUMENT_PRESENTATION':
      return c.type === 'DOCUMENTS_AGAINST_ACCEPTANCE'
        ? plus(c.acceptedAt, 'Accepted (maturity)')
        : plus(c.documentsPresentedAt, 'Documents presented');
    case 'ON_DELIVERY':
    case 'AFTER_DELIVERY_DAYS':
      return plus(c.deliveredAt, 'Delivered');
    case 'FIXED_DATE':
    case 'BEFORE_PRODUCTION':
    case 'MANUAL':
    default:
      return i.fixedDate
        ? { dueDate: i.fixedDate, basis: 'Agreed date' }
        : { dueDate: null, basis: 'No due date set' };
  }
}

export function installmentStatus(i: {
  outstanding: Dec;
  paid: Dec;
  dueDate: Date | null;
  disputed: boolean;
  today: Date;
  dueSoonDays: number;
}): { status: ReceivableStatus; daysOverdue: number | null } {
  if (i.outstanding.lte(0)) return { status: 'PAID', daysOverdue: null };
  if (i.disputed) return { status: 'DISPUTED', daysOverdue: null };
  if (!i.dueDate)
    return {
      status: i.paid.gt(0) ? 'PARTIALLY_PAID' : 'NOT_DUE',
      daysOverdue: null,
    };
  const d = dayDiff(i.today, i.dueDate);
  if (d < 0) return { status: 'OVERDUE', daysOverdue: -d };
  if (i.paid.gt(0)) return { status: 'PARTIALLY_PAID', daysOverdue: null };
  if (d === 0) return { status: 'DUE', daysOverdue: 0 };
  if (d <= i.dueSoonDays) return { status: 'DUE_SOON', daysOverdue: null };
  return { status: 'NOT_DUE', daysOverdue: null };
}

export function receivableStatus(r: {
  state: string;
  outstanding: Dec;
  paid: Dec;
  disputed: boolean;
  installments: ReceivableStatus[];
}): ReceivableStatus {
  if (r.state === 'CANCELLED') return 'CANCELLED';
  if (r.state === 'UNCOLLECTIBLE') return 'UNCOLLECTIBLE';
  if (r.outstanding.lte(0)) return 'PAID';
  if (r.disputed || r.installments.includes('DISPUTED')) return 'DISPUTED';
  if (r.installments.includes('OVERDUE')) return 'OVERDUE';
  if (r.paid.gt(0)) return 'PARTIALLY_PAID';
  if (r.installments.includes('DUE')) return 'DUE';
  if (r.installments.includes('DUE_SOON')) return 'DUE_SOON';
  return 'NOT_DUE';
}

export function agingBucket(daysOverdue: number | null) {
  if (!daysOverdue || daysOverdue <= 0) return 'current' as const;
  if (daysOverdue <= 30) return 'd1_30' as const;
  if (daysOverdue <= 60) return 'd31_60' as const;
  if (daysOverdue <= 90) return 'd61_90' as const;
  return 'd90plus' as const;
}

// ------------------------------------------------------------ allocation

/**
 * Applies an amount (receivable currency) to the chosen installment first, then
 * remaining installments by sequence. Never takes outstanding below zero —
 * anything beyond the total outstanding is returned as excess.
 */
export function allocate(
  amount: Dec,
  installments: { id: string; sequence: number; outstanding: Dec }[],
  targetId: string | null,
): { allocations: { installmentId: string; amount: string }[]; excess: Dec } {
  let left = amount;
  const ordered = [...installments].sort((a, b) =>
    a.id === targetId ? -1 : b.id === targetId ? 1 : a.sequence - b.sequence,
  );
  const allocations: { installmentId: string; amount: string }[] = [];
  for (const i of ordered) {
    if (left.lte(0)) break;
    if (i.outstanding.lte(0)) continue;
    const a = D.min(left, i.outstanding);
    allocations.push({ installmentId: i.id, amount: m2(a) });
    left = left.minus(a);
  }
  return { allocations, excess: left };
}

export const referenceKey = (...refs: (string | null | undefined)[]) => {
  const k = refs
    .map((r) => (r ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean)
    .join('|');
  return k || null;
};
export const mask = (v: string | null | undefined) =>
  !v ? null : v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;

// ------------------------------------------------------------ messages

export function paymentReminderMessage(d: {
  kind: string;
  buyerName: string;
  exporterName: string;
  reference: string;
  amount: string;
  currency: string;
  dueDate: string | null;
  label: string;
}) {
  const due = d.dueDate ? ` due on ${d.dueDate}` : '';
  const lead =
    d.kind === 'OVERDUE'
      ? `our records show the payment of ${d.currency} ${d.amount}${due} for ${d.reference} (${d.label}) is still outstanding.`
      : d.kind === 'DUE_TODAY'
        ? `a friendly reminder that ${d.currency} ${d.amount} for ${d.reference} (${d.label}) is due today.`
        : d.kind === 'UPCOMING_DUE'
          ? `a friendly reminder that ${d.currency} ${d.amount} for ${d.reference} (${d.label}) is${due}.`
          : `we are following up on ${d.currency} ${d.amount} for ${d.reference} (${d.label})${due}.`;
  return {
    subject: `Payment ${d.kind === 'OVERDUE' ? 'overdue' : 'reminder'} — ${d.reference}`,
    message: `Dear ${d.buyerName} team,\n\nThis is ${lead}\n\nIf the payment has already been made, please share the remittance details so we can reconcile it.\n\nBest regards,\n${d.exporterName}`,
  };
}

export function reorderMessage(d: {
  buyerName: string;
  exporterName: string;
  productName: string;
  lastOrderDate: string;
  lastPoNumber: string;
}) {
  return `Dear ${d.buyerName} team,\n\nYour last order for ${d.productName} was placed on ${d.lastOrderDate} (PO ${d.lastPoNumber}). Would you like to reorder ${d.productName}? We would be happy to share an updated quotation.\n\nBest regards,\n${d.exporterName}`;
}

// ------------------------------------------------------------ repeat business

export interface RepeatInput {
  orderDates: Date[];
  productOrders: { name: string; productId: string | null; orders: number }[];
  overdue: boolean;
  averagePaymentDelayDays: number | null;
  unresolvedIssues: number;
  today: Date;
}

/**
 * Transparent repeat-order signal. Needs ≥3 orders (2 intervals); otherwise
 * INSUFFICIENT_DATA. Points, not a probability.
 */
export function repeatSignal(x: RepeatInput): {
  level: RepeatSignalLevel;
  score: number | null;
  factors: {
    factor: string;
    points: number;
    max: number;
    explanation: string;
  }[];
  intervals: number[];
  average: number | null;
  window: { start: Date; end: Date } | null;
} {
  const dates = [...x.orderDates].sort((a, b) => a.getTime() - b.getTime());
  const intervals = dates.slice(1).map((d, i) => dayDiff(dates[i], d));
  if (dates.length < 3)
    return {
      level: 'INSUFFICIENT_DATA',
      score: null,
      factors: [],
      intervals,
      average: null,
      window: null,
    };
  const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const sd = Math.sqrt(
    intervals.reduce((s, v) => s + (v - avg) ** 2, 0) / intervals.length,
  );
  const cv = avg > 0 ? sd / avg : 1;
  const last = dates[dates.length - 1];
  const since = dayDiff(last, x.today);
  const f: {
    factor: string;
    points: number;
    max: number;
    explanation: string;
  }[] = [];
  const n = dates.length;
  f.push({
    factor: 'Completed orders',
    max: 25,
    points: n >= 5 ? 25 : 15,
    explanation: `${n} accepted orders.`,
  });
  const ratio = avg > 0 ? since / avg : 99;
  f.push({
    factor: 'Recency vs usual interval',
    max: 25,
    points: ratio <= 1.25 ? 25 : ratio <= 1.75 ? 15 : ratio <= 2.5 ? 5 : 0,
    explanation: `${since} days since last order vs ${Math.round(avg)}-day average.`,
  });
  f.push({
    factor: 'Regular cadence',
    max: 20,
    points: cv <= 0.25 ? 20 : cv <= 0.5 ? 10 : 0,
    explanation: `Intervals vary by ±${Math.round(sd)} days.`,
  });
  f.push({
    factor: 'Payment behaviour',
    max: 15,
    points: x.overdue
      ? 0
      : x.averagePaymentDelayDays !== null && x.averagePaymentDelayDays > 15
        ? 5
        : 15,
    explanation: x.overdue
      ? 'Has overdue receivables.'
      : x.averagePaymentDelayDays !== null
        ? `Average payment delay ${x.averagePaymentDelayDays.toFixed(0)} days.`
        : 'No overdue receivables.',
  });
  const top = x.productOrders[0];
  f.push({
    factor: 'Same product recurrence',
    max: 15,
    points: top && top.orders / n >= 0.5 ? 15 : top && top.orders >= 2 ? 8 : 0,
    explanation: top
      ? `${top.name} in ${top.orders} of ${n} orders.`
      : 'No product linked to orders.',
  });
  if (x.unresolvedIssues > 0)
    f.push({
      factor: 'Unresolved issues',
      max: 0,
      points: -10,
      explanation: `${x.unresolvedIssues} open dispute(s) or critical shipment exception(s).`,
    });
  const score = Math.max(
    0,
    f.reduce((s, v) => s + v.points, 0),
  );
  const spread = Math.max(5, Math.round(sd));
  const centre = addDays(last, Math.round(avg));
  return {
    level: score >= 65 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW',
    score,
    factors: f,
    intervals,
    average: Math.round(avg * 10) / 10,
    window: { start: addDays(centre, -spread), end: addDays(centre, spread) },
  };
}

// ------------------------------------------------------------ profitability

export const ESTIMATE_TO_ACTUAL: Record<string, string> = {
  PROCUREMENT: 'PROCUREMENT',
  PACKAGING: 'PACKAGING',
  INLAND_TRANSPORT: 'INLAND_TRANSPORT',
  INSPECTION: 'INSPECTION',
  CHA: 'CHA_CUSTOMS_BROKER',
  CUSTOMS: 'CUSTOMS_PORT',
  PORT: 'CUSTOMS_PORT',
  FREIGHT: 'FREIGHT',
  INSURANCE: 'INSURANCE',
  BANKING: 'BANK_CHARGES',
  CERTIFICATES: 'CERTIFICATES',
  MISCELLANEOUS: 'MISCELLANEOUS',
};

export const VARIANCE_GROUPS: {
  group: string;
  label: string;
  categories: string[];
}[] = [
  { group: 'PROCUREMENT', label: 'Procurement', categories: ['PROCUREMENT'] },
  { group: 'PACKAGING', label: 'Packaging', categories: ['PACKAGING'] },
  { group: 'FREIGHT', label: 'Freight', categories: ['FREIGHT'] },
  {
    group: 'LOGISTICS',
    label:
      'Logistics (inland, inspection, CHA, customs/port, insurance, warehousing, courier)',
    categories: [
      'INLAND_TRANSPORT',
      'INSPECTION',
      'CHA_CUSTOMS_BROKER',
      'CUSTOMS_PORT',
      'INSURANCE',
      'WAREHOUSING',
      'COURIER',
    ],
  },
  { group: 'BANKING', label: 'Banking', categories: ['BANK_CHARGES'] },
  {
    group: 'CERTIFICATES',
    label: 'Certificates',
    categories: ['CERTIFICATES'],
  },
  {
    group: 'MISCELLANEOUS',
    label: 'Miscellaneous',
    categories: ['MISCELLANEOUS'],
  },
];

/** Variance = actual − estimated. For costs a positive variance is an overrun. */
export function variance(estimated: Dec | null, actual: Dec | null) {
  if (estimated === null || actual === null)
    return { variance: null, percent: null, direction: 'N/A' as const };
  const v = actual.minus(estimated);
  return {
    variance: m2(v),
    percent: estimated.isZero() ? null : v.div(estimated).mul(100).toFixed(2),
    direction: v.gt(0)
      ? ('OVERRUN' as const)
      : v.lt(0)
        ? ('SAVING' as const)
        : ('ON_ESTIMATE' as const),
  };
}

export const marginPct = (profit: Dec, revenue: Dec) =>
  revenue.isZero() ? null : profit.div(revenue).mul(100).toFixed(2);
