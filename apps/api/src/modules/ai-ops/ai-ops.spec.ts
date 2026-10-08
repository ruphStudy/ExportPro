import {
  ALLOWED_ACTIONS,
  APPROVAL_DEFAULT,
  conditionFails,
  parseCommand,
  rangeFor,
  resolveCountry,
  scorePriority,
  snoozeUntil,
  TEMPLATES,
  validateIntent,
} from './ops-rules';
import {
  RulesAiManagerProvider,
  UnconfiguredAiManagerProvider,
} from './ai-manager.provider';

describe('deterministic priority', () => {
  it('is explainable and capped', () => {
    const p = scorePriority({
      severity: 'CRITICAL',
      exposure: 2_000_000,
      overdueDays: 40,
      blocker: true,
    });
    expect(p.priority).toBe('CRITICAL');
    expect(p.score).toBeLessThanOrEqual(100);
    expect(p.reasons.length).toBeGreaterThanOrEqual(3);
    expect(scorePriority({ severity: 'INFO' }).priority).toBe('LOW');
    expect(
      scorePriority({ severity: 'WARNING', overdueDays: 10 }).priority,
    ).toBe('MEDIUM');
  });
  it('an explicit rule override is labelled', () => {
    const p = scorePriority({ severity: 'INFO' }, 'HIGH');
    expect(p.priority).toBe('HIGH');
    expect(p.reasons.join(' ')).toMatch(/automation rule/);
  });
});

describe('ranges and snooze', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  it('builds date ranges with a previous period', () => {
    expect(rangeFor('quarter', undefined, undefined, now)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-08',
    });
    expect(rangeFor('7d', undefined, undefined, now).from).toBe('2026-10-02');
    expect(
      rangeFor('custom', '2026-01-01', '2026-01-31', now).previous,
    ).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(() => rangeFor('custom', '2026-02-01', '2026-01-01', now)).toThrow();
  });
  it('snooze presets and future-only custom', () => {
    expect(
      snoozeUntil('tomorrow', undefined, now).toISOString().slice(0, 10),
    ).toBe('2026-10-09');
    expect(snoozeUntil('1w', undefined, now).toISOString().slice(0, 10)).toBe(
      '2026-10-15',
    );
    expect(() => snoozeUntil('custom', '2026-10-01T00:00:00Z', now)).toThrow();
  });
});

describe('automation guards', () => {
  it('typed conditions only', () => {
    expect(
      conditionFails(
        { minDaysOverdue: 5 },
        { severity: 'WARNING', daysOverdue: 3 },
      ),
    ).toMatch(/overdue/);
    expect(
      conditionFails(
        { minDaysOverdue: 5 },
        { severity: 'WARNING', daysOverdue: 9 },
      ),
    ).toBeNull();
    expect(
      conditionFails({ minSeverity: 'CRITICAL' }, { severity: 'WARNING' }),
    ).toMatch(/severity/);
    expect(
      conditionFails(
        { windowStates: ['IN_WINDOW'] },
        { severity: 'INFO', windowState: 'APPROACHING' },
      ),
    ).not.toBeNull();
  });
  it('no trigger can feed its own action (loop guard) and risky writes need approval', () => {
    expect(ALLOWED_ACTIONS.CRM_TASK_OVERDUE).not.toContain('CREATE_CRM_TASK');
    expect(ALLOWED_ACTIONS.PAYMENT_OVERDUE).not.toContain('CREATE_CRM_TASK');
    expect(APPROVAL_DEFAULT.CREATE_CRM_TASK).toBe(true);
    for (const t of TEMPLATES)
      expect(ALLOWED_ACTIONS[t.triggerType]).toContain(t.actionType);
  });
});

describe('AI output validation', () => {
  const ok = {
    intent: 'x',
    action: 'find_buyers',
    entities: { product: 'cumin', country: null },
    parameters: {},
    missingInputs: [],
    clarificationRequired: false,
    confidence: 80,
  };
  it('accepts valid structured output', () =>
    expect(validateIntent(ok)?.action).toBe('find_buyers'));
  it('rejects unknown actions and extra fields', () => {
    expect(validateIntent({ ...ok, action: 'delete_everything' })).toBeNull();
    expect(
      validateIntent({ ...ok, entities: { ...ok.entities, sql: 'drop' } }),
    ).toBeNull();
    expect(validateIntent({ ...ok, confidence: 500 })).toBeNull();
  });
});

describe('deterministic command parser', () => {
  it('maps common requests', () => {
    expect(parseCommand('Analyze cumin for UAE')).toMatchObject({
      action: 'analyze_product_market',
      entities: { product: 'cumin', country: 'UAE' },
    });
    expect(
      parseCommand('Find buyers for turmeric in Germany').entities,
    ).toMatchObject({ product: 'turmeric', country: 'Germany' });
    expect(parseCommand('Who should I follow up today?').action).toBe(
      'follow_ups_today',
    );
    expect(parseCommand('Which shipment documents are missing?').action).toBe(
      'missing_documents',
    );
    expect(
      parseCommand('Find export opportunities under ₹5 lakh'),
    ).toMatchObject({
      action: 'discover_opportunities',
      entities: { maxInvestment: '5 lakh' },
    });
  });
  it('uses session context for follow-ups', () => {
    expect(
      parseCommand('Now find buyers', { product: 'Cumin Seeds', country: 'AE' })
        .entities,
    ).toMatchObject({ product: 'Cumin Seeds', country: 'AE' });
  });
  it('never invents payment values', () => {
    expect(parseCommand('Record payment received').entities).toMatchObject({
      amount: null,
      currency: null,
    });
    expect(
      parseCommand('Record payment of USD 5,000 for RCV-2026-000001 ref UTR123')
        .entities,
    ).toMatchObject({
      amount: '5000',
      currency: 'USD',
      receivable: 'RCV-2026-000001',
      reference: 'UTR123',
    });
  });
  it('resolves countries strictly', () => {
    expect(resolveCountry('UAE')).toBe('AE');
    expect(resolveCountry('germany')).toBe('DE');
    expect(resolveCountry('Atlantis')).toBeNull();
  });
});

describe('providers', () => {
  it('rules provider is deterministic; unconfigured provider fails cleanly', async () => {
    expect(
      await new RulesAiManagerProvider().parse({
        message: 'Show overdue payments',
        context: {},
        actions: [],
      }),
    ).toMatchObject({ action: 'overdue_receivables' });
    await expect(
      new UnconfiguredAiManagerProvider().parse(),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});
