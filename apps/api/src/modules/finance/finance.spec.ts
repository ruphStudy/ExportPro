import { D } from '../costing/costing-calculator';
import {
  addDays,
  agingBucket,
  allocate,
  installmentStatus,
  marginPct,
  mask,
  parsePaymentTerms,
  receivableStatus,
  referenceKey,
  repeatSignal,
  resolveDue,
  splitAmounts,
  variance,
  type DueContext,
} from './finance-rules';

const today = new Date('2026-10-08T10:00:00Z');

describe('payment terms parsing (explicit only)', () => {
  it('reads 30% advance / 70% before shipment as two installments', () => {
    const t = parsePaymentTerms(
      '30% advance, 70% before shipment',
      new D('10000'),
    );
    expect(t.type).toBe('ADVANCE');
    expect(t.recognized).toBe(true);
    expect(t.installments.map((i) => [i.triggerType, i.amount])).toEqual([
      ['ORDER_CONFIRMATION', '3000.00'],
      ['BEFORE_SHIPMENT', '7000.00'],
    ]);
  });
  it('reads Net 30, LC at sight, D/A 60 days and D/P', () => {
    expect(parsePaymentTerms('Net 30', new D(1))).toMatchObject({
      type: 'OPEN_ACCOUNT',
      termDays: 30,
      recognized: true,
    });
    expect(
      parsePaymentTerms('Irrevocable LC at sight', new D(1)),
    ).toMatchObject({ type: 'LETTER_OF_CREDIT', recognized: true });
    expect(parsePaymentTerms('D/A 60 days', new D(1))).toMatchObject({
      type: 'DOCUMENTS_AGAINST_ACCEPTANCE',
      tenorDays: 60,
      recognized: true,
    });
    expect(parsePaymentTerms('D/P at sight', new D(1))).toMatchObject({
      type: 'DOCUMENTS_AGAINST_PAYMENT',
      recognized: true,
    });
  });
  it('never infers a split from vague wording', () => {
    const t = parsePaymentTerms('Payment as discussed', new D(1000));
    expect(t.recognized).toBe(false);
    expect(t.installments).toEqual([]);
    expect(parsePaymentTerms(null, null).type).toBeNull();
  });
  it('flags percentages that do not add up to 100', () => {
    const t = parsePaymentTerms(
      '30% advance, 60% before shipment',
      new D(1000),
    );
    expect(t.recognized).toBe(false);
    expect(t.notes.join(' ')).toMatch(/90%/);
  });
  it('splits exactly (last installment absorbs rounding)', () => {
    const parts = splitAmounts(new D('100.01'), [
      new D(33.3333),
      new D(33.3333),
      new D(33.3334),
    ]);
    expect(parts.reduce((s, x) => s.plus(x), new D(0)).toFixed(2)).toBe(
      '100.01',
    );
  });
});

describe('due dates and statuses', () => {
  const ctx: DueContext = {
    type: 'ADVANCE',
    poAcceptedAt: new Date('2026-10-01T09:00:00Z'),
    piIssuedAt: null,
    shipmentEtd: null,
    shipmentDeparted: null,
    deliveredAt: null,
    documentsPresentedAt: null,
    acceptedAt: null,
  };
  it('resolves triggers deterministically or waits', () => {
    expect(
      resolveDue(
        { triggerType: 'ORDER_CONFIRMATION', dueDays: 0, fixedDate: null },
        ctx,
      )
        .dueDate?.toISOString()
        .slice(0, 10),
    ).toBe('2026-10-01');
    expect(
      resolveDue(
        { triggerType: 'BEFORE_SHIPMENT', dueDays: null, fixedDate: null },
        ctx,
      ).dueDate,
    ).toBeNull();
    const da = resolveDue(
      { triggerType: 'ON_DOCUMENT_PRESENTATION', dueDays: 60, fixedDate: null },
      {
        ...ctx,
        type: 'DOCUMENTS_AGAINST_ACCEPTANCE',
        acceptedAt: new Date('2026-10-08T00:00:00Z'),
      },
    );
    expect(da.dueDate?.toISOString().slice(0, 10)).toBe('2026-12-07');
  });
  const st = (o: Partial<Parameters<typeof installmentStatus>[0]>) =>
    installmentStatus({
      outstanding: new D(100),
      paid: new D(0),
      dueDate: null,
      disputed: false,
      today,
      dueSoonDays: 7,
      ...o,
    }).status;
  it('partial payment is never PAID; overdue wins when past due', () => {
    expect(
      st({
        paid: new D(60),
        outstanding: new D(40),
        dueDate: addDays(today, 3),
      }),
    ).toBe('PARTIALLY_PAID');
    expect(
      st({
        paid: new D(60),
        outstanding: new D(40),
        dueDate: addDays(today, -1),
      }),
    ).toBe('OVERDUE');
    expect(st({ outstanding: new D(0), paid: new D(100) })).toBe('PAID');
  });
  it('due soon / due today / not due / disputed', () => {
    expect(st({ dueDate: addDays(today, 5) })).toBe('DUE_SOON');
    expect(st({ dueDate: addDays(today, 0) })).toBe('DUE');
    expect(st({ dueDate: addDays(today, 30) })).toBe('NOT_DUE');
    expect(st({ dueDate: addDays(today, -10), disputed: true })).toBe(
      'DISPUTED',
    );
  });
  it('rolls installment statuses into a receivable status', () => {
    expect(
      receivableStatus({
        state: 'OPEN',
        outstanding: new D(10),
        paid: new D(5),
        disputed: false,
        installments: ['PAID', 'NOT_DUE'],
      }),
    ).toBe('PARTIALLY_PAID');
    expect(
      receivableStatus({
        state: 'OPEN',
        outstanding: new D(10),
        paid: new D(5),
        disputed: false,
        installments: ['OVERDUE'],
      }),
    ).toBe('OVERDUE');
    expect(
      receivableStatus({
        state: 'CANCELLED',
        outstanding: new D(10),
        paid: new D(0),
        disputed: false,
        installments: [],
      }),
    ).toBe('CANCELLED');
  });
  it('aging buckets', () => {
    expect([null, 1, 30, 31, 61, 91].map(agingBucket)).toEqual([
      'current',
      'd1_30',
      'd1_30',
      'd31_60',
      'd61_90',
      'd90plus',
    ]);
  });
});

describe('payment allocation & references', () => {
  const inst = [
    { id: 'a', sequence: 1, outstanding: new D(3000) },
    { id: 'b', sequence: 2, outstanding: new D(7000) },
  ];
  it('applies to the chosen installment first, then by sequence; never below zero', () => {
    expect(allocate(new D(6000), inst, 'b')).toEqual({
      allocations: [{ installmentId: 'b', amount: '6000.00' }],
      excess: new D(0),
    });
    const r = allocate(new D(12000), inst, null);
    expect(r.allocations.map((x) => x.amount)).toEqual(['3000.00', '7000.00']);
    expect(r.excess.toFixed(2)).toBe('2000.00');
  });
  it('normalizes references for duplicate protection and masks them', () => {
    expect(referenceKey('utr 0001', null)).toBe(referenceKey('UTR-0001'));
    expect(referenceKey(null, '')).toBeNull();
    expect(mask('UTR-0001')).toBe('••••0001');
  });
});

describe('repeat business (deterministic, no probabilities)', () => {
  it('needs at least three orders', () => {
    const r = repeatSignal({
      orderDates: [new Date('2026-09-01')],
      productOrders: [],
      overdue: false,
      averagePaymentDelayDays: null,
      unresolvedIssues: 0,
      today,
    });
    expect(r).toMatchObject({
      level: 'INSUFFICIENT_DATA',
      score: null,
      window: null,
    });
  });
  it('estimates the reorder window from the cadence', () => {
    const r = repeatSignal({
      orderDates: [
        new Date('2026-06-18'),
        new Date('2026-08-02'),
        new Date('2026-09-16'),
      ],
      productOrders: [{ name: 'Cumin', productId: 'p', orders: 3 }],
      overdue: false,
      averagePaymentDelayDays: 0,
      unresolvedIssues: 0,
      today,
    });
    expect(r.average).toBe(45);
    expect(r.window!.start.toISOString().slice(0, 10)).toBe('2026-10-26');
    expect(r.window!.end.toISOString().slice(0, 10)).toBe('2026-11-05');
    expect(r.level).toBe('HIGH');
    expect(r.factors.every((f) => f.explanation.length > 0)).toBe(true);
  });
  it('lowers the signal for overdue payments and open issues', () => {
    const base = {
      orderDates: [
        new Date('2026-01-01'),
        new Date('2026-02-15'),
        new Date('2026-04-01'),
      ],
      productOrders: [],
      averagePaymentDelayDays: null,
      today,
    };
    const good = repeatSignal({ ...base, overdue: false, unresolvedIssues: 0 });
    const bad = repeatSignal({ ...base, overdue: true, unresolvedIssues: 1 });
    expect(bad.score!).toBeLessThan(good.score!);
  });
});

describe('profit maths', () => {
  it('variance = actual − estimated; positive cost variance is an overrun', () => {
    expect(variance(new D(100000), new D(125000))).toEqual({
      variance: '25000.00',
      percent: '25.00',
      direction: 'OVERRUN',
    });
    expect(variance(new D(100), new D(90)).direction).toBe('SAVING');
    expect(variance(null, new D(1)).direction).toBe('N/A');
  });
  it('margin handles zero revenue safely', () => {
    expect(marginPct(new D(10), new D(0))).toBeNull();
    expect(marginPct(new D(25), new D(100))).toBe('25.00');
  });
});
