import { createHash } from 'crypto';
import type {
  ShipmentExceptionSeverity,
  ShipmentExceptionType,
  ShipmentHealth,
  ShipmentMilestoneStage,
  ShipmentStatus,
  TrackingEventType,
} from '@exportpro/types';
import { D } from '../costing/costing-calculator';

/**
 * Deterministic shipment rules: lifecycle ordering, allowed transitions,
 * tracking-event effects, health, delays, container check digits, quote
 * scoring and buyer-update templates. No AI and no external calls here.
 */

/** Lifecycle rank. Events never move a shipment to a lower rank (out-of-order safe). */
export const STATUS_RANK: Record<ShipmentStatus, number> = {
  DRAFT: 0,
  PLANNED: 1,
  BOOKED: 2,
  READY_FOR_PICKUP: 3,
  PICKED_UP: 4,
  CUSTOMS_PROCESSING: 5,
  CUSTOMS_CLEARED: 6,
  AT_ORIGIN_PORT: 7,
  DEPARTED: 8,
  IN_TRANSIT: 9,
  TRANSSHIPMENT: 9,
  ARRIVED_DESTINATION: 10,
  OUT_FOR_DELIVERY: 11,
  DELIVERED: 12,
  ON_HOLD: -1,
  CANCELLED: -1,
};
const PRE_DEPARTURE: ShipmentStatus[] = [
  'DRAFT',
  'PLANNED',
  'BOOKED',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'CUSTOMS_PROCESSING',
  'CUSTOMS_CLEARED',
  'AT_ORIGIN_PORT',
];

/** Manual transitions: forward (stages may be skipped), transshipment ↔ in transit, hold/resume, cancel before departure. */
export function allowedTransitions(
  current: ShipmentStatus,
  holdFrom: ShipmentStatus | null,
): ShipmentStatus[] {
  if (current === 'DELIVERED' || current === 'CANCELLED') return [];
  if (current === 'ON_HOLD')
    return holdFrom
      ? [
          holdFrom,
          ...(PRE_DEPARTURE.includes(holdFrom)
            ? (['CANCELLED'] as ShipmentStatus[])
            : []),
        ]
      : [];
  const r = STATUS_RANK[current];
  const forward = (Object.keys(STATUS_RANK) as ShipmentStatus[]).filter(
    (s) => STATUS_RANK[s] > r,
  );
  const extra: ShipmentStatus[] = [];
  if (current === 'IN_TRANSIT') extra.push('TRANSSHIPMENT');
  if (current === 'TRANSSHIPMENT') extra.push('IN_TRANSIT');
  extra.push('ON_HOLD');
  if (PRE_DEPARTURE.includes(current)) extra.push('CANCELLED');
  return [...new Set([...forward, ...extra])];
}

export const isPreDeparture = (s: ShipmentStatus) => PRE_DEPARTURE.includes(s);

/** Status implied by a tracking event (null = no lifecycle effect). */
export const EVENT_STATUS: Partial<Record<TrackingEventType, ShipmentStatus>> =
  {
    BOOKED: 'BOOKED',
    PICKED_UP: 'PICKED_UP',
    CUSTOMS_SUBMITTED: 'CUSTOMS_PROCESSING',
    CUSTOMS_QUERY: 'CUSTOMS_PROCESSING',
    CUSTOMS_HOLD: 'CUSTOMS_PROCESSING',
    CUSTOMS_RELEASED: 'CUSTOMS_PROCESSING',
    CUSTOMS_CLEARED: 'CUSTOMS_CLEARED',
    GATE_IN: 'AT_ORIGIN_PORT',
    LOADED: 'AT_ORIGIN_PORT',
    DEPARTED: 'IN_TRANSIT',
    TRANSSHIPMENT_ARRIVED: 'TRANSSHIPMENT',
    TRANSSHIPMENT_DEPARTED: 'IN_TRANSIT',
    ARRIVED: 'ARRIVED_DESTINATION',
    DISCHARGED: 'ARRIVED_DESTINATION',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
  };

/**
 * Whether an event may change the current status. Higher rank always wins; the
 * transshipment ↔ in-transit toggle at equal rank only follows the newest event.
 */
export function eventStatusDecision(
  current: ShipmentStatus,
  target: ShipmentStatus | undefined,
  eventIsLatestTransit: boolean,
): { apply: boolean; note: string | null } {
  if (!target) return { apply: false, note: null };
  if (current === 'CANCELLED' || current === 'ON_HOLD')
    return {
      apply: false,
      note: `Shipment is ${current.toLowerCase().replace('_', ' ')} — recorded in history only.`,
    };
  const a = STATUS_RANK[target];
  const b = STATUS_RANK[current];
  if (a > b) return { apply: true, note: null };
  if (a === b && target !== current && eventIsLatestTransit)
    return { apply: true, note: null };
  if (target === current) return { apply: false, note: null };
  return {
    apply: false,
    note: `Earlier stage than the current status (${current.replace(/_/g, ' ').toLowerCase()}) — kept in history, status not changed.`,
  };
}

/** Milestone effects of tracking events. */
export const EVENT_MILESTONES: Partial<
  Record<
    TrackingEventType,
    {
      stage: ShipmentMilestoneStage;
      status: 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
    }[]
  >
> = {
  PICKED_UP: [{ stage: 'PICKUP', status: 'COMPLETED' }],
  CUSTOMS_SUBMITTED: [{ stage: 'CUSTOMS', status: 'IN_PROGRESS' }],
  CUSTOMS_QUERY: [{ stage: 'CUSTOMS', status: 'IN_PROGRESS' }],
  CUSTOMS_HOLD: [{ stage: 'CUSTOMS', status: 'BLOCKED' }],
  CUSTOMS_RELEASED: [{ stage: 'CUSTOMS', status: 'IN_PROGRESS' }],
  CUSTOMS_CLEARED: [{ stage: 'CUSTOMS', status: 'COMPLETED' }],
  GATE_IN: [{ stage: 'PORT', status: 'IN_PROGRESS' }],
  LOADED: [{ stage: 'PORT', status: 'IN_PROGRESS' }],
  DEPARTED: [
    { stage: 'PORT', status: 'COMPLETED' },
    { stage: 'VESSEL', status: 'IN_PROGRESS' },
  ],
  ARRIVED: [
    { stage: 'VESSEL', status: 'COMPLETED' },
    { stage: 'DESTINATION', status: 'IN_PROGRESS' },
  ],
  DISCHARGED: [
    { stage: 'VESSEL', status: 'COMPLETED' },
    { stage: 'DESTINATION', status: 'COMPLETED' },
  ],
  OUT_FOR_DELIVERY: [
    { stage: 'DESTINATION', status: 'COMPLETED' },
    { stage: 'DELIVERY', status: 'IN_PROGRESS' },
  ],
  DELIVERED: [
    { stage: 'DESTINATION', status: 'COMPLETED' },
    { stage: 'DELIVERY', status: 'COMPLETED' },
  ],
};

/** Exceptions created from explicit events (never inferred, e.g. customs hold only from a customs-hold event). */
export const EVENT_EXCEPTIONS: Partial<
  Record<
    TrackingEventType,
    {
      type: ShipmentExceptionType;
      severity: ShipmentExceptionSeverity;
      title: string;
    }
  >
> = {
  MISSED_SAILING: {
    type: 'MISSED_SAILING',
    severity: 'CRITICAL',
    title: 'Missed sailing',
  },
  CUSTOMS_HOLD: {
    type: 'CUSTOMS_HOLD',
    severity: 'CRITICAL',
    title: 'Customs hold',
  },
  PORT_DELAY: { type: 'PORT_DELAY', severity: 'WARNING', title: 'Port delay' },
  TRANSSHIPMENT_DELAY: {
    type: 'TRANSSHIPMENT_DELAY',
    severity: 'WARNING',
    title: 'Transshipment delay',
  },
  DELIVERY_DELAY: {
    type: 'DELIVERY_DELAY',
    severity: 'WARNING',
    title: 'Delivery delay',
  },
  ROUTE_CHANGE: {
    type: 'ROUTE_CHANGE',
    severity: 'WARNING',
    title: 'Route changed',
  },
  CARRIER_CHANGE: {
    type: 'CARRIER_CHANGE',
    severity: 'INFO',
    title: 'Carrier changed',
  },
};

const DAY = 86400000;
/** Whole-day difference b − a in UTC calendar days (deterministic, timezone-safe). */
export function dayDiff(
  a: Date | null | undefined,
  b: Date | null | undefined,
): number | null {
  if (!a || !b) return null;
  const ua = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const ub = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((ub - ua) / DAY);
}

const DELAY_TYPES: ShipmentExceptionType[] = [
  'ETA_DELAY',
  'ETD_DELAY',
  'MISSED_SAILING',
  'PORT_DELAY',
  'TRANSSHIPMENT_DELAY',
  'DELIVERY_DELAY',
];
const BLOCKING_TYPES: ShipmentExceptionType[] = ['CUSTOMS_HOLD', 'LOST_CARGO'];

/** Health is separate from lifecycle status. */
export function computeHealth(input: {
  status: ShipmentStatus;
  openExceptions: {
    type: ShipmentExceptionType;
    severity: ShipmentExceptionSeverity;
  }[];
  blockedMilestone: boolean;
  etdPassedWithoutDeparture: boolean;
}): ShipmentHealth {
  if (input.status === 'DELIVERED' || input.status === 'CANCELLED')
    return 'ON_TRACK';
  const ex = input.openExceptions;
  if (
    input.blockedMilestone ||
    ex.some(
      (e) => BLOCKING_TYPES.includes(e.type) && e.severity === 'CRITICAL',
    ) ||
    input.status === 'ON_HOLD'
  )
    return 'BLOCKED';
  if (ex.some((e) => DELAY_TYPES.includes(e.type) && e.severity !== 'INFO'))
    return 'DELAYED';
  if (input.etdPassedWithoutDeparture || ex.some((e) => e.severity !== 'INFO'))
    return 'AT_RISK';
  return 'ON_TRACK';
}

/** ISO 6346 container number: 4 letters + 6 digits + check digit. Format is required; the check digit is reported. */
export function containerCheck(raw: string): {
  normalized: string;
  formatValid: boolean;
  checkDigitValid: boolean;
} {
  const n = raw.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(n))
    return { normalized: n, formatValid: false, checkDigitValid: false };
  const values: number[] = [];
  let v = 10;
  const map: Record<string, number> = {};
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (v % 11 === 0) v++;
    map[c] = v++;
  }
  for (let i = 0; i < 10; i++) values.push(i < 4 ? map[n[i]] : Number(n[i]));
  const sum = values.reduce((s, x, i) => s + x * 2 ** i, 0);
  const check = (sum % 11) % 10;
  return {
    normalized: n,
    formatValid: true,
    checkDigitValid: check === Number(n[10]),
  };
}

export const eventKey = (parts: (string | number | null | undefined)[]) =>
  createHash('sha256')
    .update(
      parts
        .map((p) =>
          p === null || p === undefined ? '' : String(p).trim().toUpperCase(),
        )
        .join('|'),
    )
    .digest('hex');

// ------------------------------------------------------------------ quotes

export interface ScoreInput {
  id: string;
  normalizedTotal: string | null;
  transitDays: number | null;
  direct: boolean | null;
  validity: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN';
  exclusionsCount: number;
  departureDate: Date | null;
}

/**
 * Deterministic comparison score (0–100): cost 40, transit 25, routing 15,
 * validity 10, exclusions 10. Missing data scores 0 for that factor — never guessed.
 */
export function scoreQuotes(rows: ScoreInput[]) {
  const costs = rows
    .map((r) => r.normalizedTotal)
    .filter(Boolean)
    .map((c) => new D(c!));
  const minCost = costs.length ? D.min(...costs) : null;
  const transits = rows
    .map((r) => r.transitDays)
    .filter((t): t is number => t !== null);
  const minTransit = transits.length ? Math.min(...transits) : null;
  return rows.map((r) => {
    const b: {
      factor: string;
      points: number;
      max: number;
      explanation: string;
    }[] = [];
    if (r.normalizedTotal && minCost) {
      const p = new D(40)
        .mul(minCost)
        .div(r.normalizedTotal)
        .toDecimalPlaces(1)
        .toNumber();
      b.push({
        factor: 'Cost',
        points: p,
        max: 40,
        explanation:
          p === 40
            ? 'Lowest comparable total.'
            : `Total is ${new D(r.normalizedTotal).minus(minCost).div(minCost).mul(100).toDecimalPlaces(1).toString()}% above the lowest.`,
      });
    } else
      b.push({
        factor: 'Cost',
        points: 0,
        max: 40,
        explanation: 'No comparable total (missing price or FX rate).',
      });
    if (r.transitDays !== null && minTransit !== null) {
      const p =
        Math.round((25 * minTransit * 10) / Math.max(r.transitDays, 1)) / 10;
      b.push({
        factor: 'Transit time',
        points: p,
        max: 25,
        explanation:
          r.transitDays === minTransit
            ? 'Fastest transit.'
            : `${r.transitDays - minTransit} day(s) slower than the fastest.`,
      });
    } else
      b.push({
        factor: 'Transit time',
        points: 0,
        max: 25,
        explanation: 'Transit time not stated.',
      });
    b.push(
      r.direct === true
        ? {
            factor: 'Routing',
            points: 15,
            max: 15,
            explanation: 'Direct service.',
          }
        : r.direct === false
          ? {
              factor: 'Routing',
              points: 5,
              max: 15,
              explanation: 'Requires transshipment.',
            }
          : {
              factor: 'Routing',
              points: 0,
              max: 15,
              explanation: 'Routing not stated.',
            },
    );
    b.push(
      r.validity === 'VALID'
        ? {
            factor: 'Validity',
            points: 10,
            max: 10,
            explanation: 'Quote valid.',
          }
        : r.validity === 'EXPIRING_SOON'
          ? {
              factor: 'Validity',
              points: 5,
              max: 10,
              explanation: 'Quote expires within 3 days.',
            }
          : r.validity === 'EXPIRED'
            ? {
                factor: 'Validity',
                points: 0,
                max: 10,
                explanation: 'Quote expired.',
              }
            : {
                factor: 'Validity',
                points: 0,
                max: 10,
                explanation: 'Validity not stated.',
              },
    );
    const ex = Math.max(0, 10 - 2 * r.exclusionsCount);
    b.push({
      factor: 'Exclusions',
      points: ex,
      max: 10,
      explanation: r.exclusionsCount
        ? `${r.exclusionsCount} exclusion(s) listed.`
        : 'No exclusions listed.',
    });
    return {
      id: r.id,
      score: Math.round(b.reduce((s, x) => s + x.points, 0) * 10) / 10,
      breakdown: b,
    };
  });
}

// ---------------------------------------------------------- buyer updates

export interface UpdateData {
  shipmentNumber: string;
  poNumber: string;
  buyerName: string;
  exporterName: string;
  mode: string;
  route: string;
  carrier: string | null;
  vessel: string | null;
  voyage: string | null;
  flight: string | null;
  bookingReference: string | null;
  blNumber: string | null;
  awbNumber: string | null;
  containers: string[];
  etd: string | null;
  eta: string | null;
  previousEta: string | null;
  actualDeparture: string | null;
  actualArrival: string | null;
  deliveredAt: string | null;
  delayReason: string | null;
}

const line = (label: string, v: string | null | undefined) =>
  v ? `${label}: ${v}\n` : '';

/** Templates use only known shipment data; missing values are omitted, never invented. */
export function buyerUpdateTemplate(
  trigger: string,
  d: UpdateData,
): { subject: string; message: string } {
  const ref = `PO ${d.poNumber} / shipment ${d.shipmentNumber}`;
  const ids = `${line('Route', d.route)}${line('Carrier', d.carrier)}${line('Vessel / voyage', [d.vessel, d.voyage].filter(Boolean).join(' / ') || null)}${line('Flight', d.flight)}${line('Booking ref.', d.bookingReference)}${line('B/L', d.blNumber)}${line('AWB', d.awbNumber)}${line('Containers', d.containers.join(', ') || null)}`;
  const sign = `\nBest regards,\n${d.exporterName}`;
  const hi = `Dear ${d.buyerName} team,\n\n`;
  switch (trigger) {
    case 'BOOKING_CONFIRMED':
      return {
        subject: `Booking confirmed — ${ref}`,
        message: `${hi}We have confirmed the booking for ${ref}.\n\n${ids}${line('ETD', d.etd)}${line('ETA', d.eta)}${sign}`,
      };
    case 'DEPARTED':
      return {
        subject: `Shipment departed — ${ref}`,
        message: `${hi}Your shipment ${ref} has departed.\n\n${ids}${line('Departed', d.actualDeparture)}${line('ETA', d.eta)}${sign}`,
      };
    case 'ETA_UPDATED':
      return {
        subject: `Updated ETA — ${ref}`,
        message: `${hi}The estimated arrival for ${ref} has changed.\n\n${line('Previous ETA', d.previousEta)}${line('Updated ETA', d.eta)}${line('Reason', d.delayReason)}\n${ids}${sign}`,
      };
    case 'DELAY':
      return {
        subject: `Delay notice — ${ref}`,
        message: `${hi}We would like to inform you of a delay affecting ${ref}.\n\n${line('Reason', d.delayReason)}${line('Current ETD', d.etd)}${line('Current ETA', d.eta)}\n${ids}We will keep you updated.${sign}`,
      };
    case 'ARRIVED':
      return {
        subject: `Arrival notice — ${ref}`,
        message: `${hi}Your shipment ${ref} has arrived.\n\n${line('Arrived', d.actualArrival)}${ids}${sign}`,
      };
    default:
      return {
        subject: `Delivered — ${ref}`,
        message: `${hi}Your shipment ${ref} has been delivered.\n\n${line('Delivered', d.deliveredAt)}${ids}Thank you for your business.${sign}`,
      };
  }
}
