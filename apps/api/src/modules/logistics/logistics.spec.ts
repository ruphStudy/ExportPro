import {
  allowedTransitions,
  buyerUpdateTemplate,
  computeHealth,
  containerCheck,
  dayDiff,
  eventKey,
  eventStatusDecision,
  EVENT_STATUS,
  scoreQuotes,
  type ScoreInput,
  type UpdateData,
} from './logistics-rules';
import {
  type ShipmentTrackingProvider,
  UnconfiguredTrackingProvider,
} from './tracking-provider';

describe('shipment lifecycle transitions', () => {
  it('allows forward moves (skipping), hold and pre-departure cancel', () => {
    const t = allowedTransitions('PLANNED', null);
    expect(t).toEqual(
      expect.arrayContaining(['BOOKED', 'IN_TRANSIT', 'ON_HOLD', 'CANCELLED']),
    );
    expect(t).not.toContain('PLANNED');
  });
  it('never allows backward moves or cancel after departure', () => {
    const t = allowedTransitions('IN_TRANSIT', null);
    expect(t).not.toContain('PICKED_UP');
    expect(t).not.toContain('CANCELLED');
    expect(t).toContain('TRANSSHIPMENT');
  });
  it('resumes from hold only to the held status', () => {
    expect(allowedTransitions('ON_HOLD', 'BOOKED')).toEqual([
      'BOOKED',
      'CANCELLED',
    ]);
    expect(allowedTransitions('ON_HOLD', 'IN_TRANSIT')).toEqual(['IN_TRANSIT']);
  });
  it('has no transitions from terminal states', () => {
    expect(allowedTransitions('DELIVERED', null)).toEqual([]);
    expect(allowedTransitions('CANCELLED', null)).toEqual([]);
  });
});

describe('tracking event status decisions', () => {
  it('advances on a later stage', () => {
    expect(
      eventStatusDecision('BOOKED', EVENT_STATUS.DEPARTED, true).apply,
    ).toBe(true);
  });
  it('does not regress on out-of-order events and explains why', () => {
    const d = eventStatusDecision(
      'ARRIVED_DESTINATION',
      EVENT_STATUS.TRANSSHIPMENT_DEPARTED,
      false,
    );
    expect(d.apply).toBe(false);
    expect(d.note).toMatch(/kept in history/);
  });
  it('toggles transshipment ↔ in transit only for the newest event', () => {
    expect(eventStatusDecision('TRANSSHIPMENT', 'IN_TRANSIT', true).apply).toBe(
      true,
    );
    expect(
      eventStatusDecision('TRANSSHIPMENT', 'IN_TRANSIT', false).apply,
    ).toBe(false);
  });
  it('records events on held or cancelled shipments in history only', () => {
    expect(eventStatusDecision('ON_HOLD', 'IN_TRANSIT', true).apply).toBe(
      false,
    );
    expect(eventStatusDecision('CANCELLED', 'DELIVERED', true).apply).toBe(
      false,
    );
  });
  it('ignores events without a lifecycle effect', () => {
    expect(eventStatusDecision('BOOKED', EVENT_STATUS.NOTE, true)).toEqual({
      apply: false,
      note: null,
    });
  });
});

describe('ISO 6346 container numbers', () => {
  it('accepts a valid number and normalizes spacing', () => {
    expect(containerCheck('csqu 305438-3')).toEqual({
      normalized: 'CSQU3054383',
      formatValid: true,
      checkDigitValid: true,
    });
  });
  it('reports a wrong check digit', () => {
    const r = containerCheck('CSQU3054384');
    expect(r.formatValid).toBe(true);
    expect(r.checkDigitValid).toBe(false);
  });
  it('rejects bad format', () => {
    expect(containerCheck('ABC123').formatValid).toBe(false);
    expect(containerCheck('CSQX3054383').formatValid).toBe(false);
  });
});

describe('dates and health', () => {
  it('computes UTC calendar-day differences', () => {
    expect(
      dayDiff(
        new Date('2026-11-10T23:30:00Z'),
        new Date('2026-11-13T00:10:00Z'),
      ),
    ).toBe(3);
    expect(dayDiff(null, new Date())).toBeNull();
  });
  const base = {
    status: 'IN_TRANSIT' as const,
    openExceptions: [],
    blockedMilestone: false,
    etdPassedWithoutDeparture: false,
  };
  it('keeps health separate from lifecycle status', () => {
    expect(computeHealth(base)).toBe('ON_TRACK');
    expect(
      computeHealth({
        ...base,
        openExceptions: [{ type: 'ETA_DELAY', severity: 'WARNING' }],
      }),
    ).toBe('DELAYED');
    expect(
      computeHealth({
        ...base,
        openExceptions: [{ type: 'CUSTOMS_HOLD', severity: 'CRITICAL' }],
      }),
    ).toBe('BLOCKED');
    expect(computeHealth({ ...base, etdPassedWithoutDeparture: true })).toBe(
      'AT_RISK',
    );
    expect(computeHealth({ ...base, status: 'ON_HOLD' })).toBe('BLOCKED');
    expect(
      computeHealth({
        ...base,
        status: 'DELIVERED',
        openExceptions: [{ type: 'DAMAGE', severity: 'WARNING' }],
      }),
    ).toBe('ON_TRACK');
  });
});

describe('idempotency keys', () => {
  it('is stable for the same event and differs for different ones', () => {
    const a = eventKey(['DEPARTED', '2026-10-07T12:00:00Z', 'Mundra ']);
    expect(a).toBe(eventKey(['departed', '2026-10-07T12:00:00Z', 'MUNDRA']));
    expect(a).not.toBe(eventKey(['ARRIVED', '2026-10-07T12:00:00Z', 'Mundra']));
  });
});

describe('freight quote scoring', () => {
  const q = (o: Partial<ScoreInput>): ScoreInput => ({
    id: 'x',
    normalizedTotal: '1000',
    transitDays: 20,
    direct: true,
    validity: 'VALID',
    exclusionsCount: 0,
    departureDate: null,
    ...o,
  });
  it('is deterministic and explains every factor', () => {
    const rows = [
      q({
        id: 'a',
        normalizedTotal: '1550.50',
        transitDays: 18,
        direct: false,
        exclusionsCount: 2,
      }),
      q({ id: 'b', normalizedTotal: '1807.23', transitDays: 12 }),
    ];
    const r1 = scoreQuotes(rows);
    expect(scoreQuotes(rows)).toEqual(r1);
    for (const r of r1) {
      expect(r.breakdown.map((b) => b.factor)).toHaveLength(5);
      expect(r.breakdown.every((b) => b.explanation.length > 0)).toBe(true);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
  it('gives missing data zero points instead of guessing', () => {
    const [r] = scoreQuotes([
      q({ normalizedTotal: null, transitDays: null, direct: null }),
    ]);
    const cost = r.breakdown.find((b) => /cost/i.test(b.factor))!;
    expect(cost.points).toBe(0);
  });
  it('penalises expired quotes', () => {
    const [v, e] = scoreQuotes([
      q({ id: 'v' }),
      q({ id: 'e', validity: 'EXPIRED' }),
    ]);
    expect(v.score).toBeGreaterThan(e.score);
  });
});

describe('buyer update templates', () => {
  const d: UpdateData = {
    shipmentNumber: 'SHP-2026-000001',
    poNumber: 'PO-1',
    buyerName: 'Acme',
    exporterName: 'G18 Exports',
    mode: 'SEA',
    route: 'Mundra → Jebel Ali',
    carrier: null,
    vessel: 'MSC ALPHA',
    voyage: null,
    flight: null,
    bookingReference: 'BK-1',
    blNumber: null,
    awbNumber: null,
    containers: [],
    etd: '2026-10-29',
    eta: '2026-11-13',
    previousEta: '2026-11-10',
    actualDeparture: null,
    actualArrival: null,
    deliveredAt: null,
    delayReason: 'Port congestion',
  };
  it('uses known data only and omits missing values', () => {
    const t = buyerUpdateTemplate('ETA_UPDATED', d);
    expect(t.message).toContain('Previous ETA: 2026-11-10');
    expect(t.message).toContain('Updated ETA: 2026-11-13');
    expect(t.message).not.toContain('Carrier:');
    expect(t.message).not.toContain('B/L');
  });
});

describe('tracking provider abstraction', () => {
  it('reports no live provider and never fabricates events', async () => {
    const p: ShipmentTrackingProvider = new UnconfiguredTrackingProvider();
    expect(p.configured).toBe(false);
    await expect(
      p.fetch({
        mode: 'SEA',
        carrier: null,
        bookingReference: null,
        blNumber: null,
        awbNumber: null,
        containerNumbers: [],
      }),
    ).rejects.toBeDefined();
  });
});
