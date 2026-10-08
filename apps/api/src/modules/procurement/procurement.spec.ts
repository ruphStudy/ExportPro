import { Prisma } from '@prisma/client';
import { D } from '../costing/costing-calculator';
import { parseCommand } from '../ai-ops/ops-rules';
import { procurementCost, type SpoWithReceipts } from './procurement-cost';
import {
  GSTIN_RE,
  landedUnit,
  monthlyCapacity,
  normalizeName,
  phoneKey,
  PO_TRANSITIONS,
  resolvePayableDue,
  sameMeasure,
  scoreFit,
  toKg,
} from './procurement-rules';

const dec = (v: string) => new Prisma.Decimal(v);

describe('supplier identity', () => {
  it('normalizes names for possible-duplicate detection', () => {
    expect(normalizeName('Unjha Spice Mills Pvt. Ltd.')).toBe(
      normalizeName('UNJHA SPICE MILLS LIMITED'),
    );
    expect(normalizeName('A & B Traders')).toBe('a and b traders');
  });
  it('keys phones by last 10 digits', () => {
    expect(phoneKey('+91 98250 11111')).toBe('9825011111');
    expect(phoneKey('12')).toBeNull();
  });
  it('checks GSTIN format only', () => {
    expect(GSTIN_RE.test('24ABCDE1234F1Z5')).toBe(true);
    expect(GSTIN_RE.test('12345')).toBe(false);
  });
});

describe('units', () => {
  it('converts mass units and refuses unknown ones', () => {
    expect(toKg(new D(2), 'MT')!.toString()).toBe('2000');
    expect(toKg(new D(3), 'QTL')!.toString()).toBe('300');
    expect(toKg(new D(3), 'BAG')).toBeNull();
    expect(sameMeasure(new D(5), 'MT', new D(4000), 'KG')!.map(String)).toEqual(
      ['5000', '4000'],
    );
    expect(sameMeasure(new D(5), 'BAG', new D(4), 'KG')).toBeNull();
    expect(monthlyCapacity(new D(10), 'DAY')!.toString()).toBe('300');
  });
});

describe('fit score', () => {
  it('missing data scores zero and lowers confidence', () => {
    const full = scoreFit({
      price: { value: new D(100), best: new D(100) },
      leadTimeDays: { value: 7, requiredDays: 20, best: 7 },
      moq: { fit: true },
    });
    const partial = scoreFit({
      price: { value: null, best: new D(100) },
      leadTimeDays: { value: null, requiredDays: 20, best: 7 },
      moq: { fit: true },
    });
    expect(full.score).toBe(100);
    expect(full.confidencePercent).toBe(100);
    expect(partial.score).toBeLessThan(full.score);
    expect(partial.confidencePercent).toBeLessThan(100);
  });
  it('unverified certifications count only as stated', () => {
    const r = scoreFit({
      certifications: { required: ['FSSAI', 'ISO'], have: ['FSSAI'] },
    });
    expect(r.factors[0].explanation).toContain('Missing: ISO');
  });
});

describe('landed cost', () => {
  it('adds stated charges only and lists unknowns (never zero)', () => {
    const r = landedUnit(
      {
        unitPrice: new D(195),
        taxPercent: null,
        taxIncluded: null,
        packagingPerUnit: new D(3),
        inlandTransportPerUnit: null,
        inspectionTotal: null,
        otherTotal: null,
        priceBasis: 'EX_FACTORY',
      },
      new D(1000),
    );
    expect(r.unit.toString()).toBe('198');
    expect(r.unknown).toEqual(['inland transport', 'inspection', 'taxes']);
  });
});

describe('supplier PO lifecycle', () => {
  it('cannot complete before receipt and cannot reopen terminal states', () => {
    expect(PO_TRANSITIONS.ISSUED).not.toContain('COMPLETED');
    expect(PO_TRANSITIONS.RECEIVED).toEqual(['COMPLETED']);
    expect(PO_TRANSITIONS.COMPLETED).toEqual([]);
    expect(PO_TRANSITIONS.CANCELLED).toEqual([]);
  });
  it('resolves supplier payment due dates from real events only', () => {
    const issuedAt = new Date('2026-10-01T00:00:00Z');
    expect(
      resolvePayableDue(
        { trigger: 'ADVANCE', dueDays: null, fixedDate: null },
        { issuedAt, dispatchedAt: null, receivedAt: null },
      )
        .dueDate!.toISOString()
        .slice(0, 10),
    ).toBe('2026-10-01');
    expect(
      resolvePayableDue(
        { trigger: 'ON_DELIVERY', dueDays: null, fixedDate: null },
        { issuedAt, dispatchedAt: null, receivedAt: null },
      ).dueDate,
    ).toBeNull();
    expect(
      resolvePayableDue(
        { trigger: 'CREDIT_DAYS', dueDays: 30, fixedDate: null },
        {
          issuedAt,
          dispatchedAt: null,
          receivedAt: new Date('2026-10-05T00:00:00Z'),
        },
      )
        .dueDate!.toISOString()
        .slice(0, 10),
    ).toBe('2026-11-04');
  });
});

describe('actual procurement cost (single source)', () => {
  const spo = (over: Partial<SpoWithReceipts> = {}) =>
    ({
      spoNumber: 'SPO-2026-000001',
      status: 'RECEIVED',
      currency: 'INR',
      packagingCost: dec('1000'),
      inlandTransportCost: null,
      inspectionCost: null,
      otherCharges: null,
      taxAmount: dec('500'),
      items: [
        {
          quantity: dec('100'),
          unitPrice: dec('10'),
          acceptedQuantity: dec('90'),
          receivedQuantity: dec('100'),
          damagedQuantity: dec('0'),
        },
      ],
      receipts: [{ qualityStatus: 'PARTIAL' }],
      ...over,
    }) as unknown as SpoWithReceipts;
  it('uses accepted goods + PO charges, excludes tax', () => {
    const c = procurementCost(spo(), null);
    expect(c.actual).toBe('1900.00');
    expect(c.committed).toBe('2000.00');
    expect(
      c.components.find((x) => x.label === 'Inland transport')!.amount,
    ).toBeNull();
  });
  it('is incomplete while goods are pending inspection or on hold', () => {
    expect(
      procurementCost(
        spo({ receipts: [{ qualityStatus: 'HOLD' }] } as never),
        null,
      ).complete,
    ).toBe(false);
    expect(
      procurementCost(spo({ status: 'PARTIALLY_RECEIVED' } as never), null)
        .missing[0],
    ).toContain('not fully received');
  });
});

describe('AI procurement intents', () => {
  it('maps read-only procurement commands', () => {
    expect(parseCommand('Find suppliers for cumin seeds').action).toBe(
      'find_suppliers',
    );
    expect(
      parseCommand('Find suppliers for cumin seeds').entities.product,
    ).toBe('cumin seeds');
    expect(
      parseCommand('Compare supplier quotes SRFQ-2026-000001').entities
        .reference,
    ).toBe('SRFQ-2026-000001');
    expect(parseCommand('Which supplier payments are due?').action).toBe(
      'supplier_payments_due',
    );
    expect(parseCommand('Status of SPO-2026-000002').action).toBe(
      'procurement_status',
    );
    // buyer flows unchanged
    expect(parseCommand('Find buyers for cumin in UAE').action).toBe(
      'find_buyers',
    );
    expect(parseCommand('Show overdue payments').action).toBe(
      'overdue_receivables',
    );
  });
});
