import { z } from 'zod';
import {
  AI_ACTION_NAMES,
  COUNTRIES,
  type ActionPriority,
  type ActionTrigger,
  type AiIntent,
  type AutomationActionType,
  type AutomationConditions,
  type AutomationTemplate,
} from '@exportpro/types';

/**
 * Sprint 20 — pure orchestration rules: priority scoring, date ranges, snooze,
 * the deterministic command parser, AI-output validation and automation guards.
 * No business figures are calculated here.
 */

const DAY = 86400000;
export const utcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ------------------------------------------------------------ priority

export interface PriorityFactors {
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  /** Financial exposure in the reporting currency (null = unknown / not financial). */
  exposure?: number | null;
  overdueDays?: number | null;
  delayDays?: number | null;
  blocker?: boolean;
  /** Days until the deadline (negative = passed). */
  deadlineDays?: number | null;
}

/** Deterministic, explainable priority. AI never changes it. */
export function scorePriority(
  f: PriorityFactors,
  override?: ActionPriority | null,
): {
  score: number;
  priority: ActionPriority;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score =
    f.severity === 'CRITICAL' ? 65 : f.severity === 'WARNING' ? 35 : 15;
  reasons.push(`${f.severity.toLowerCase()} severity`);
  if (f.exposure && f.exposure > 0) {
    const add = f.exposure >= 1_000_000 ? 25 : f.exposure >= 100_000 ? 15 : 5;
    score += add;
    reasons.push(
      `exposure ${Math.round(f.exposure).toLocaleString('en-IN')} (+${add})`,
    );
  }
  if (f.overdueDays && f.overdueDays > 0) {
    const add = f.overdueDays > 30 ? 20 : f.overdueDays > 7 ? 10 : 5;
    score += add;
    reasons.push(`${f.overdueDays} day(s) overdue (+${add})`);
  }
  if (f.delayDays && f.delayDays >= 7) {
    score += 10;
    reasons.push(`${f.delayDays}-day delay (+10)`);
  }
  if (f.blocker) {
    score += 15;
    reasons.push('blocks the next step (+15)');
  }
  if (
    f.deadlineDays !== null &&
    f.deadlineDays !== undefined &&
    f.deadlineDays <= 2
  ) {
    score += 10;
    reasons.push(
      f.deadlineDays < 0
        ? 'deadline passed (+10)'
        : `deadline in ${f.deadlineDays} day(s) (+10)`,
    );
  }
  score = Math.min(100, score);
  let priority: ActionPriority =
    score >= 80
      ? 'CRITICAL'
      : score >= 55
        ? 'HIGH'
        : score >= 30
          ? 'MEDIUM'
          : 'LOW';
  if (override) {
    priority = override;
    reasons.push(`priority set by automation rule (${override.toLowerCase()})`);
  }
  return { score, priority, reasons };
}

// ------------------------------------------------------------ ranges / snooze

export const RANGE_KEYS = [
  'today',
  '7d',
  '30d',
  'month',
  'quarter',
  'year',
  'custom',
] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export function rangeFor(
  key: string | undefined,
  from?: string,
  to?: string,
  now = new Date(),
) {
  const today = utcDay(now);
  let start: Date;
  let end = today;
  switch ((key ?? 'month') as RangeKey) {
    case 'today':
      start = today;
      break;
    case '7d':
      start = new Date(today.getTime() - 6 * DAY);
      break;
    case '30d':
      start = new Date(today.getTime() - 29 * DAY);
      break;
    case 'quarter':
      start = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          Math.floor(today.getUTCMonth() / 3) * 3,
          1,
        ),
      );
      break;
    case 'year':
      start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      break;
    case 'custom':
      start = from ? new Date(from) : new Date(Date.UTC(2000, 0, 1));
      end = to ? new Date(to) : today;
      break;
    default:
      start = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
      );
  }
  if (start > end) throw new Error('RANGE_INVALID');
  const len = end.getTime() - start.getTime() + DAY;
  return {
    key: key ?? 'month',
    from: isoDay(start),
    to: isoDay(end),
    previous: {
      from: isoDay(new Date(start.getTime() - len)),
      to: isoDay(new Date(start.getTime() - DAY)),
    },
  };
}

export function snoozeUntil(
  preset: string,
  custom?: string,
  now = new Date(),
): Date {
  const t = utcDay(now).getTime();
  if (preset === 'tomorrow') return new Date(t + DAY + 3 * 3600000);
  if (preset === '3d') return new Date(t + 3 * DAY + 3 * 3600000);
  if (preset === '1w') return new Date(t + 7 * DAY + 3 * 3600000);
  if (preset === 'custom' && custom) {
    const d = new Date(custom);
    if (!(d.getTime() > now.getTime())) throw new Error('SNOOZE_PAST');
    return d;
  }
  throw new Error('SNOOZE_INVALID');
}

// ------------------------------------------------------------ automation guards

/** Which safe actions each trigger may run (prevents self-feeding loops, e.g. tasks creating tasks). */
export const ALLOWED_ACTIONS: Record<ActionTrigger, AutomationActionType[]> = {
  NO_BUYER_RESPONSE: [
    'CREATE_ACTION_ITEM',
    'SUGGEST_FOLLOW_UP',
    'CREATE_CRM_TASK',
    'NOTIFY_IN_APP',
  ],
  PAYMENT_OVERDUE: [
    'CREATE_ACTION_ITEM',
    'DRAFT_PAYMENT_REMINDER',
    'NOTIFY_IN_APP',
  ],
  DOCUMENT_EXPIRY: ['CREATE_ACTION_ITEM', 'NOTIFY_IN_APP'],
  ETA_CHANGE: ['CREATE_ACTION_ITEM', 'NOTIFY_IN_APP'],
  SHIPMENT_EXCEPTION: ['CREATE_ACTION_ITEM', 'NOTIFY_IN_APP'],
  COMPLIANCE_BLOCKER: ['CREATE_ACTION_ITEM', 'NOTIFY_IN_APP'],
  VALIDATION_CRITICAL: ['CREATE_ACTION_ITEM', 'NOTIFY_IN_APP'],
  REORDER_WINDOW: [
    'CREATE_ACTION_ITEM',
    'SUGGEST_FOLLOW_UP',
    'CREATE_CRM_TASK',
    'NOTIFY_IN_APP',
  ],
  QUOTATION_EXPIRY: ['CREATE_ACTION_ITEM', 'NOTIFY_IN_APP'],
  NEW_OPPORTUNITY: ['CREATE_ACTION_ITEM', 'NOTIFY_IN_APP'],
  CRM_TASK_OVERDUE: ['CREATE_ACTION_ITEM', 'NOTIFY_IN_APP'],
  SAMPLE_DELIVERED: [
    'CREATE_ACTION_ITEM',
    'SUGGEST_FOLLOW_UP',
    'CREATE_CRM_TASK',
  ],
};

/** Actions that write to another module run only after a human approves (default). */
export const APPROVAL_DEFAULT: Record<AutomationActionType, boolean> = {
  CREATE_ACTION_ITEM: false,
  SUGGEST_FOLLOW_UP: false,
  NOTIFY_IN_APP: false,
  DRAFT_PAYMENT_REMINDER: false,
  CREATE_CRM_TASK: true,
};

export interface SignalMetrics {
  daysOverdue?: number | null;
  amount?: number | null;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  noReplyDays?: number | null;
  daysToExpiry?: number | null;
  etaDelayDays?: number | null;
  score?: number | null;
  windowState?: string | null;
}

const SEV = { INFO: 0, WARNING: 1, CRITICAL: 2 } as const;

/** Typed condition check — no expressions or scripts. Returns the failing reason or null. */
export function conditionFails(
  c: AutomationConditions,
  m: SignalMetrics,
): string | null {
  if (c.minSeverity && SEV[m.severity] < SEV[c.minSeverity])
    return `severity ${m.severity} below ${c.minSeverity}`;
  if (c.minDaysOverdue !== undefined && (m.daysOverdue ?? 0) < c.minDaysOverdue)
    return `${m.daysOverdue ?? 0} day(s) overdue < ${c.minDaysOverdue}`;
  if (
    c.minAmount !== undefined &&
    m.amount !== undefined &&
    m.amount !== null &&
    m.amount < c.minAmount
  )
    return `amount ${m.amount} < ${c.minAmount}`;
  if (c.noReplyDays !== undefined && (m.noReplyDays ?? 0) < c.noReplyDays)
    return `no reply for ${m.noReplyDays ?? 0} day(s) < ${c.noReplyDays}`;
  if (
    c.daysBeforeExpiry !== undefined &&
    m.daysToExpiry !== undefined &&
    m.daysToExpiry !== null &&
    m.daysToExpiry > c.daysBeforeExpiry
  )
    return `expires in ${m.daysToExpiry} day(s) > ${c.daysBeforeExpiry}`;
  if (
    c.minEtaDelayDays !== undefined &&
    m.etaDelayDays !== undefined &&
    (m.etaDelayDays ?? 0) < c.minEtaDelayDays
  )
    return `ETA delay ${m.etaDelayDays ?? 0} day(s) < ${c.minEtaDelayDays}`;
  if (c.minScore !== undefined && (m.score ?? 0) < c.minScore)
    return `score ${m.score ?? 0} < ${c.minScore}`;
  if (
    c.windowStates?.length &&
    (!m.windowState || !c.windowStates.includes(m.windowState as never))
  )
    return `window ${m.windowState ?? 'none'} not selected`;
  return null;
}

export function describeConditions(c: AutomationConditions): string {
  const p: string[] = [];
  if (c.minSeverity) p.push(`severity ≥ ${c.minSeverity}`);
  if (c.minDaysOverdue !== undefined)
    p.push(`≥ ${c.minDaysOverdue} day(s) overdue`);
  if (c.minAmount !== undefined) p.push(`amount ≥ ${c.minAmount}`);
  if (c.noReplyDays !== undefined) p.push(`no reply ≥ ${c.noReplyDays} day(s)`);
  if (c.daysBeforeExpiry !== undefined)
    p.push(`expires within ${c.daysBeforeExpiry} day(s)`);
  if (c.minEtaDelayDays !== undefined)
    p.push(`ETA delay ≥ ${c.minEtaDelayDays} day(s)`);
  if (c.minScore !== undefined) p.push(`score ≥ ${c.minScore}`);
  if (c.windowStates?.length) p.push(`window ${c.windowStates.join('/')}`);
  return p.join(', ') || 'always';
}

export const TEMPLATES: AutomationTemplate[] = [
  {
    key: 'no_reply_follow_up',
    name: 'No buyer reply → follow-up action',
    triggerType: 'NO_BUYER_RESPONSE',
    actionType: 'SUGGEST_FOLLOW_UP',
    conditions: { noReplyDays: 5 },
    requiresApproval: false,
    description: 'Outbound outreach with no reply after the configured days.',
  },
  {
    key: 'overdue_finance_action',
    name: 'Overdue payment → finance action',
    triggerType: 'PAYMENT_OVERDUE',
    actionType: 'CREATE_ACTION_ITEM',
    conditions: { minDaysOverdue: 1 },
    requiresApproval: false,
    description:
      'Receivable installment past its due date with money outstanding.',
  },
  {
    key: 'overdue_draft_reminder',
    name: 'Overdue payment → draft payment reminder (not sent)',
    triggerType: 'PAYMENT_OVERDUE',
    actionType: 'DRAFT_PAYMENT_REMINDER',
    conditions: { minDaysOverdue: 1 },
    requiresApproval: false,
    description:
      'Creates a reminder draft for a human to review and send. Never sends.',
  },
  {
    key: 'document_expiry',
    name: 'Certificate/document expiry → document action',
    triggerType: 'DOCUMENT_EXPIRY',
    actionType: 'CREATE_ACTION_ITEM',
    conditions: { daysBeforeExpiry: 30 },
    requiresApproval: false,
    description:
      'Documents or certifications expiring within the window or expired.',
  },
  {
    key: 'eta_delay',
    name: 'ETA delay → logistics action',
    triggerType: 'ETA_CHANGE',
    actionType: 'CREATE_ACTION_ITEM',
    conditions: { minEtaDelayDays: 1 },
    requiresApproval: false,
    description: 'Open ETA-delay exceptions from shipment tracking.',
  },
  {
    key: 'shipment_exception',
    name: 'Shipment exception → logistics action',
    triggerType: 'SHIPMENT_EXCEPTION',
    actionType: 'CREATE_ACTION_ITEM',
    conditions: { minSeverity: 'WARNING' },
    requiresApproval: false,
    description: 'Open warning/critical shipment exceptions.',
  },
  {
    key: 'compliance_blocker',
    name: 'Compliance blocker → compliance action',
    triggerType: 'COMPLIANCE_BLOCKER',
    actionType: 'CREATE_ACTION_ITEM',
    conditions: {},
    requiresApproval: false,
    description: 'Accepted orders whose compliance checklist is blocked.',
  },
  {
    key: 'validation_critical',
    name: 'Critical validation issue → document action',
    triggerType: 'VALIDATION_CRITICAL',
    actionType: 'CREATE_ACTION_ITEM',
    conditions: {},
    requiresApproval: false,
    description: 'Latest document validation run with open critical findings.',
  },
  {
    key: 'reorder_window',
    name: 'Reorder window → sales action',
    triggerType: 'REORDER_WINDOW',
    actionType: 'SUGGEST_FOLLOW_UP',
    conditions: { windowStates: ['APPROACHING', 'IN_WINDOW'] },
    requiresApproval: false,
    description: 'Buyers approaching or inside their usual reorder window.',
  },
  {
    key: 'quotation_expiry',
    name: 'Quotation expiring → sales action',
    triggerType: 'QUOTATION_EXPIRY',
    actionType: 'CREATE_ACTION_ITEM',
    conditions: { daysBeforeExpiry: 3 },
    requiresApproval: false,
    description: 'Issued quotations close to (or past) validity.',
  },
  {
    key: 'crm_overdue',
    name: 'Overdue CRM follow-up → sales action',
    triggerType: 'CRM_TASK_OVERDUE',
    actionType: 'CREATE_ACTION_ITEM',
    conditions: {},
    requiresApproval: false,
    description: 'Overdue CRM tasks, next actions and due reminders.',
  },
  {
    key: 'watchlist_opportunity',
    name: 'Watchlist opportunity ≥ threshold → action',
    triggerType: 'NEW_OPPORTUNITY',
    actionType: 'CREATE_ACTION_ITEM',
    conditions: { minScore: 80 },
    requiresApproval: false,
    description:
      'Only saved (watchlist) opportunities above the score threshold.',
  },
];
/** Templates switched on when an organization first opens the Action Center. */
export const DEFAULT_ENABLED = new Set(
  TEMPLATES.map((t) => t.key).filter((k) => k !== 'overdue_draft_reminder'),
);

// ------------------------------------------------------------ countries

const ALIASES: Record<string, string> = {
  uae: 'AE',
  'u.a.e': 'AE',
  emirates: 'AE',
  dubai: 'AE',
  usa: 'US',
  us: 'US',
  america: 'US',
  uk: 'GB',
  britain: 'GB',
  england: 'GB',
  ksa: 'SA',
  saudi: 'SA',
  'south korea': 'KR',
  korea: 'KR',
  russia: 'RU',
  vietnam: 'VN',
};

export function resolveCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[?.!,]+$/, '');
  if (ALIASES[t]) return ALIASES[t];
  if (/^[a-z]{2}$/.test(t) && COUNTRIES.some((c) => c.code === t.toUpperCase()))
    return t.toUpperCase();
  return (
    COUNTRIES.find((c) => c.label.toLowerCase() === t)?.code ??
    COUNTRIES.find((c) => c.label.toLowerCase().startsWith(t) && t.length >= 4)
      ?.code ??
    null
  );
}

// ------------------------------------------------------------ AI output validation

const entity = z.string().max(160).nullable().optional();
export const AiIntentSchema = z.object({
  intent: z.string().max(80),
  action: z.enum(AI_ACTION_NAMES).nullable(),
  entities: z
    .object({
      product: entity,
      country: entity,
      buyer: entity,
      inquiry: entity,
      quotation: entity,
      shipment: entity,
      receivable: entity,
      amount: entity,
      currency: entity,
      reference: entity,
      module: entity,
      maxInvestment: entity,
    })
    .strict(),
  parameters: z
    .record(
      z.string(),
      z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
    )
    .default({}),
  missingInputs: z.array(z.string().max(80)).max(10).default([]),
  clarificationRequired: z.boolean().default(false),
  confidence: z.number().min(0).max(100),
});

/** Validates provider output; unknown actions or extra fields are rejected (never executed). */
export function validateIntent(raw: unknown): AiIntent | null {
  const r = AiIntentSchema.safeParse(raw);
  return r.success ? (r.data as AiIntent) : null;
}

// ------------------------------------------------------------ deterministic command parser

const clean = (s: string | undefined) =>
  (s ?? '')
    .trim()
    .replace(/^(the|my|our)\s+/i, '')
    .replace(/[?.!]+$/, '')
    .trim() || null;

function money(t: string) {
  const m =
    /(usd|eur|inr|gbp|aed|\$|€|₹)\s?([\d,]+(?:\.\d{1,2})?)/i.exec(t) ??
    /([\d,]+(?:\.\d{1,2})?)\s?(usd|eur|inr|gbp|aed)\b/i.exec(t);
  if (!m) return { amount: null, currency: null };
  const sym: Record<string, string> = { $: 'USD', '€': 'EUR', '₹': 'INR' };
  const [a, b] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  return { amount: a.replace(/,/g, ''), currency: (sym[b] ?? b).toUpperCase() };
}

/**
 * Rule-based interpreter used when no AI provider is configured (and as the
 * predefined-command path). Deterministic; it never fills a value the user did not type.
 */
export function parseCommand(
  text: string,
  ctx: Record<string, string | null> = {},
): AiIntent {
  const t = text.trim();
  const l = t.toLowerCase();
  const base = (
    action: AiIntent['action'],
    entities: AiIntent['entities'] = {},
    intent = action ?? 'unknown',
  ): AiIntent => ({
    intent,
    action,
    entities,
    parameters: {},
    missingInputs: [],
    clarificationRequired: false,
    confidence: action ? 70 : 0,
  });
  const ref = (re: RegExp) => re.exec(t)?.[0] ?? null;
  const rcv = ref(/RCV-\d{4}-\d{6}/i);
  const shp = ref(/SHP-\d{4}-\d{6}/i);
  const inq =
    ref(/\b(INQ|RFQ)-\d{4}-\d{3,6}\b/i) ??
    /\b(?:rfq|inquiry)\s+#?([A-Z0-9-]{3,})/i.exec(t)?.[1] ??
    null;
  let m: RegExpExecArray | null;
  if (
    /^(open|go to|show me the|navigate to)\s+/i.test(l) &&
    (m = /^(?:open|go to|show me the|navigate to)\s+(.+)$/i.exec(t))
  )
    return base('navigate', { module: clean(m[1]) });
  if (/record (a )?payment|payment received|mark .*paid/.test(l)) {
    const mo = money(t);
    return base('record_payment', {
      receivable: rcv ?? ctx.receivable ?? null,
      amount: mo.amount,
      currency: mo.currency,
      reference:
        /\b(?:ref|utr|reference)\s*[:#]?\s*([A-Z0-9-]{4,})/i.exec(t)?.[1] ??
        null,
    });
  }
  if (/(draft|send|prepare).*(payment )?reminder|remind .*pay/.test(l))
    return base('draft_payment_reminder', {
      receivable: rcv ?? ctx.receivable ?? null,
    });
  if (/(add|put|create).*(crm|lead)/.test(l)) {
    m = /(?:add|put)\s+(.+?)\s+(?:to|in|into)\s+(?:the\s+)?crm/i.exec(t);
    return base('create_crm_lead', {
      buyer: clean(m?.[1]) ?? ctx.buyer ?? null,
      product: ctx.product ?? null,
      country: ctx.country ?? null,
    });
  }
  if (
    /quotation|quote/.test(l) &&
    /(prepare|create|make|draft|generate)/.test(l)
  )
    return base('prepare_quotation', {
      inquiry:
        inq ??
        (/(this|the) (rfq|inquiry)/.test(l) ? ctx.inquiry : null) ??
        null,
    });
  if ((m = /analy[sz]e\s+(.+?)\s+(?:for|in|to)\s+(.+)$/i.exec(t)))
    return base('analyze_product_market', {
      product: clean(m[1]),
      country: clean(m[2]),
    });
  if ((m = /(?:best|top)?\s*markets?\s+for\s+(.+)$/i.exec(t)))
    return base('product_markets', { product: clean(m[1]) });
  if (/buyer/.test(l) && /(find|search|show|look)/.test(l)) {
    m = /buyers?\s+(?:for\s+(.+?))?(?:\s+in\s+(.+))?$/i.exec(t);
    return base('find_buyers', {
      product: clean(m?.[1]) ?? ctx.product ?? null,
      country: clean(m?.[2]) ?? ctx.country ?? null,
    });
  }
  if (/opportunit/.test(l)) {
    const inv =
      /(?:under|below|less than|upto|up to)\s*₹?\s*([\d.]+)\s*(lakh|lac|l|crore|cr)\b/i.exec(
        t,
      );
    return base('discover_opportunities', {
      maxInvestment: inv ? `${inv[1]} ${inv[2]}` : null,
      product: clean(
        /opportunit\w*\s+for\s+(.+?)(?:\s+under|\s+below|$)/i.exec(t)?.[1],
      ),
    });
  }
  if (/(rfq|inquir)/.test(l) && /(summar|inspect|show|status|what)/.test(l))
    return base('inspect_inquiry', { inquiry: inq ?? ctx.inquiry ?? null });
  if (/missing|document/.test(l) && /doc/.test(l))
    return base('missing_documents', { shipment: shp ?? ctx.shipment ?? null });
  if (/exception/.test(l))
    return base('shipment_exceptions', { shipment: shp ?? null });
  if (/shipment|delayed|in transit|eta/.test(l))
    return base(
      'shipment_status',
      { shipment: shp ?? null },
      /delay/.test(l) ? 'delayed_shipments' : 'shipment_status',
    );
  if (/follow ?up|who should i (call|contact)/.test(l))
    return base('follow_ups_today');
  if (/reorder|repeat/.test(l)) return base('reorder_followups');
  if (/profit|margin/.test(l)) return base('profitability_summary');
  if (/overdue|receivable|outstanding|payment/.test(l))
    return base('overdue_receivables', { receivable: rcv });
  if (/attention|urgent|priorit|what should i do|today/.test(l))
    return base('needs_attention');
  if (/analytic|dashboard|kpi|performance|revenue/.test(l))
    return base('analytics_summary');
  return base(null, {}, 'unknown');
}
