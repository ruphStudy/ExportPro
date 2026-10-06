import {
  CRM_STAGE_PROBABILITY,
  CRM_STAGES,
  CRM_STALE_THRESHOLD_DAYS,
  OPEN_CRM_STAGES,
} from '@exportpro/types';
import {
  DAY_MS,
  inactiveDays,
  isStale,
  leadSignals,
  parseMentions,
  stageSuggestion,
} from './crm-rules';

const NOW = new Date('2026-10-07T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe('CRM stage constants', () => {
  it('keeps the canonical stage order', () => {
    expect(CRM_STAGES).toEqual([
      'NEW',
      'CONTACTED',
      'REPLIED',
      'INTERESTED',
      'QUALIFIED',
      'QUOTATION',
      'NEGOTIATION',
      'SAMPLE',
      'PO',
      'SHIPMENT',
      'WON',
      'LOST',
    ]);
    expect(OPEN_CRM_STAGES).not.toContain('WON');
    expect(OPEN_CRM_STAGES).not.toContain('LOST');
  });

  it('pipeline probability is monotonic across open stages', () => {
    const p = OPEN_CRM_STAGES.map((s) => CRM_STAGE_PROBABILITY[s]);
    expect([...p].sort((a, b) => a - b)).toEqual(p);
    expect(CRM_STAGE_PROBABILITY.WON).toBe(100);
    expect(CRM_STAGE_PROBABILITY.LOST).toBe(0);
  });
});

describe('stale detection', () => {
  it('uses per-stage thresholds and never marks closed leads stale', () => {
    expect(CRM_STALE_THRESHOLD_DAYS.NEW).toBe(7);
    expect(isStale('NEW', ago(6), NOW)).toBe(false);
    expect(isStale('NEW', ago(8), NOW)).toBe(true);
    expect(isStale('CONTACTED', ago(6), NOW)).toBe(true);
    expect(isStale('SAMPLE', ago(9), NOW)).toBe(false);
    expect(isStale('PO', ago(13), NOW)).toBe(false);
    expect(isStale('WON', ago(400), NOW)).toBe(false);
    expect(isStale('LOST', ago(400), NOW)).toBe(false);
    expect(inactiveDays(ago(8.5), NOW)).toBe(8);
  });
});

describe('lead signals / health', () => {
  const base = {
    stage: 'CONTACTED' as const,
    lastActivityAt: ago(1),
    nextAction: 'Follow up',
    nextActionDueAt: new Date(NOW.getTime() + DAY_MS),
    openTaskCount: 1,
    overdueTaskCount: 0,
  };

  it('is healthy with recent activity and a future next action', () => {
    const s = leadSignals(base, NOW);
    expect(s).toMatchObject({
      health: 'HEALTHY',
      stale: false,
      nextActionOverdue: false,
      status: 'OPEN',
      probability: 10,
    });
    expect(s.suggestedFollowUp).toBeNull();
  });

  it('flags overdue next action and stale leads with a follow-up suggestion', () => {
    const s = leadSignals({ ...base, nextActionDueAt: ago(1) }, NOW);
    expect(s.health).toBe('NEEDS_ATTENTION');
    expect(s.nextActionOverdue).toBe(true);
    const stale = leadSignals(
      { ...base, lastActivityAt: ago(9), nextActionDueAt: ago(2) },
      NOW,
    );
    expect(stale).toMatchObject({
      stale: true,
      inactiveDays: 9,
      health: 'AT_RISK',
    });
    expect(stale.suggestedFollowUp).toBe('Follow up on your first message');
  });

  it('treats closed leads as CLOSED, regardless of activity age', () => {
    const s = leadSignals(
      { ...base, stage: 'LOST', lastActivityAt: ago(100) },
      NOW,
    );
    expect(s).toMatchObject({ status: 'LOST', health: 'CLOSED', stale: false });
  });
});

describe('stage suggestions (never auto-applied)', () => {
  it('suggests REPLIED after a logged inbound buyer response', () => {
    const s = stageSuggestion({
      stage: 'CONTACTED',
      stageChangedAt: ago(3),
      qualification: null,
      communications: [
        { type: 'EMAIL', direction: 'INBOUND', occurredAt: ago(1) },
      ],
    });
    expect(s).toMatchObject({
      suggestedStage: 'REPLIED',
      confidence: 'HIGH',
      requiresConfirmation: true,
    });
  });

  it('ignores responses logged before the current stage began', () => {
    expect(
      stageSuggestion({
        stage: 'CONTACTED',
        stageChangedAt: ago(1),
        qualification: null,
        communications: [
          { type: 'CALL', direction: 'INBOUND', occurredAt: ago(3) },
        ],
      }),
    ).toBeNull();
  });

  it('suggests CONTACTED for a NEW lead after outbound communication', () => {
    expect(
      stageSuggestion({
        stage: 'NEW',
        stageChangedAt: ago(3),
        qualification: null,
        communications: [
          { type: 'CALL', direction: 'OUTBOUND', occurredAt: ago(1) },
        ],
      })?.suggestedStage,
    ).toBe('CONTACTED');
  });

  it('suggests QUALIFIED once enough qualification details exist', () => {
    const q = {
      requirement: '20ft container',
      volume: '18 MT/month',
      timeline: 'Q1',
    };
    expect(
      stageSuggestion({
        stage: 'INTERESTED',
        stageChangedAt: ago(1),
        qualification: q,
        communications: [],
      })?.suggestedStage,
    ).toBe('QUALIFIED');
    expect(
      stageSuggestion({
        stage: 'INTERESTED',
        stageChangedAt: ago(1),
        qualification: { volume: '18 MT', timeline: ' ' },
        communications: [],
      }),
    ).toBeNull();
    expect(
      stageSuggestion({
        stage: 'QUOTATION',
        stageChangedAt: ago(1),
        qualification: q,
        communications: [],
      }),
    ).toBeNull();
  });
});

describe('mentions', () => {
  const members = [
    { userId: 'u1', firstName: 'Priya', lastName: 'Shah' },
    { userId: 'u2', firstName: 'Rahul', lastName: 'Mehta' },
    { userId: 'u3', firstName: 'Rahul', lastName: 'Verma' },
  ];
  it('resolves full names and unique first names only', () => {
    expect(parseMentions('Can @Priya check pricing?', members)).toEqual(['u1']);
    expect(parseMentions('@Rahul Verma please call', members)).toEqual(['u3']);
    // Ambiguous first name alone does not resolve.
    expect(parseMentions('@Rahul ping', members)).toEqual([]);
    expect(
      parseMentions('@Unknown person and email a@priya.com', members),
    ).toEqual([]);
    expect(parseMentions('@Priyanka', members)).toEqual([]);
  });
});
