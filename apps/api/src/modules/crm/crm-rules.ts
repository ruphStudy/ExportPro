import {
  CLOSED_CRM_STAGES,
  CRM_STAGE_LABELS,
  CRM_STAGE_PROBABILITY,
  CRM_STAGES,
  CRM_STALE_THRESHOLD_DAYS,
  CRM_SUGGESTED_FOLLOW_UP,
  type CrmStage,
  type LeadActivityType,
  type LeadHealth,
  type LeadQualification,
  type LeadSignals,
  QUALIFICATION_FIELDS,
  QUALIFICATION_MIN_FIELDS,
  type StageSuggestion,
} from '@exportpro/types';

/**
 * Deterministic CRM rules (Sprint 11). No AI, no hidden weighting:
 * every output here can be explained from the inputs alone.
 */

export const DAY_MS = 86_400_000;

/**
 * Activity types that count as engagement and reset the stale clock.
 * Internal collaboration (comments, attachments, assignment/system events)
 * does not — a lead nobody has talked to is still stale.
 */
export const ENGAGEMENT_ACTIVITY_TYPES: readonly LeadActivityType[] = [
  'NOTE',
  'EMAIL',
  'CALL',
  'MEETING',
  'OTHER',
  'STAGE_CHANGE',
  'TASK',
];

export const COMMUNICATION_TYPES: readonly LeadActivityType[] = [
  'EMAIL',
  'CALL',
  'MEETING',
];

export const isClosed = (stage: CrmStage) => CLOSED_CRM_STAGES.includes(stage);
export const stageIndex = (stage: CrmStage) => CRM_STAGES.indexOf(stage);

export function leadStatus(stage: CrmStage): LeadSignals['status'] {
  return stage === 'WON' ? 'WON' : stage === 'LOST' ? 'LOST' : 'OPEN';
}

export interface SignalInput {
  stage: CrmStage;
  lastActivityAt: Date;
  nextAction: string | null;
  nextActionDueAt: Date | null;
  openTaskCount: number;
  overdueTaskCount: number;
}

/** Whole days since last engagement (floor). */
export function inactiveDays(lastActivityAt: Date, now: Date): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - lastActivityAt.getTime()) / DAY_MS),
  );
}

/** Stale = open lead with no engagement for longer than its stage threshold. */
export function isStale(stage: CrmStage, lastActivityAt: Date, now: Date) {
  const t = CRM_STALE_THRESHOLD_DAYS[stage];
  return t !== null && now.getTime() - lastActivityAt.getTime() > t * DAY_MS;
}

/**
 * CRM Lead Health (follow-up discipline), separate from Buyer Risk:
 * AT_RISK when stale AND something is overdue; NEEDS_ATTENTION when any
 * one of stale / overdue next action / overdue task / no next action;
 * otherwise HEALTHY. Closed leads are CLOSED.
 */
export function leadSignals(l: SignalInput, now: Date): LeadSignals {
  const status = leadStatus(l.stage);
  const days = inactiveDays(l.lastActivityAt, now);
  const threshold = CRM_STALE_THRESHOLD_DAYS[l.stage];
  const base = {
    status,
    inactiveDays: days,
    staleThresholdDays: threshold,
    openTaskCount: l.openTaskCount,
    probability: CRM_STAGE_PROBABILITY[l.stage],
  };
  if (status !== 'OPEN')
    return {
      ...base,
      stale: false,
      nextActionOverdue: false,
      overdueTaskCount: 0,
      health: 'CLOSED',
      healthReasons: [],
      suggestedFollowUp: null,
    };
  const stale = isStale(l.stage, l.lastActivityAt, now);
  const nextActionOverdue = Boolean(
    l.nextActionDueAt && l.nextActionDueAt.getTime() < now.getTime(),
  );
  const reasons: string[] = [];
  if (stale)
    reasons.push(
      `No activity for ${days} days (limit for ${CRM_STAGE_LABELS[l.stage]}: ${threshold} days)`,
    );
  if (nextActionOverdue) reasons.push('Next action is overdue');
  if (l.overdueTaskCount)
    reasons.push(
      `${l.overdueTaskCount} overdue task${l.overdueTaskCount > 1 ? 's' : ''}`,
    );
  if (!l.nextAction) reasons.push('No next action set');
  const overdue = nextActionOverdue || l.overdueTaskCount > 0;
  const health: LeadHealth =
    stale && overdue
      ? 'AT_RISK'
      : reasons.length
        ? 'NEEDS_ATTENTION'
        : 'HEALTHY';
  return {
    ...base,
    stale,
    nextActionOverdue,
    overdueTaskCount: l.overdueTaskCount,
    health,
    healthReasons: reasons,
    suggestedFollowUp:
      stale || !l.nextAction ? CRM_SUGGESTED_FOLLOW_UP[l.stage] : null,
  };
}

export function filledQualificationCount(q: LeadQualification | null) {
  if (!q) return 0;
  return QUALIFICATION_FIELDS.filter((f) => (q[f] ?? '').trim().length > 0)
    .length;
}

export interface SuggestionInput {
  stage: CrmStage;
  stageChangedAt: Date;
  qualification: LeadQualification | null;
  /** Communications logged since the current stage began. */
  communications: {
    type: LeadActivityType;
    direction: 'INBOUND' | 'OUTBOUND' | null;
    occurredAt: Date;
  }[];
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);
const kind = (t: LeadActivityType) =>
  t === 'EMAIL' ? 'email' : t === 'CALL' ? 'call' : 'meeting';

/**
 * Explainable stage suggestions. Never applied automatically:
 * - NEW/CONTACTED + inbound buyer response logged → REPLIED
 * - NEW + outbound communication logged → CONTACTED
 * - REPLIED/INTERESTED + ≥3 of 5 qualification fields → QUALIFIED
 * (QUOTATION will be suggested once Sprint 14 quotation objects exist.)
 */
export function stageSuggestion(s: SuggestionInput): StageSuggestion | null {
  const since = s.communications.filter(
    (c) => c.occurredAt.getTime() >= s.stageChangedAt.getTime(),
  );
  const inbound = since.find((c) => c.direction === 'INBOUND');
  if ((s.stage === 'NEW' || s.stage === 'CONTACTED') && inbound)
    return {
      suggestedStage: 'REPLIED',
      reason: `A buyer response (${kind(inbound.type)}) was logged on ${fmt(inbound.occurredAt)}.`,
      confidence: 'HIGH',
      requiresConfirmation: true,
    };
  const outbound = since.find((c) => c.direction !== 'INBOUND');
  if (s.stage === 'NEW' && outbound)
    return {
      suggestedStage: 'CONTACTED',
      reason: `An outbound ${kind(outbound.type)} was logged on ${fmt(outbound.occurredAt)}.`,
      confidence: 'HIGH',
      requiresConfirmation: true,
    };
  const filled = filledQualificationCount(s.qualification);
  if (
    (s.stage === 'INTERESTED' || s.stage === 'REPLIED') &&
    filled >= QUALIFICATION_MIN_FIELDS
  )
    return {
      suggestedStage: 'QUALIFIED',
      reason: `${filled} of ${QUALIFICATION_FIELDS.length} qualification details are captured.`,
      confidence: s.stage === 'INTERESTED' ? 'HIGH' : 'MEDIUM',
      requiresConfirmation: true,
    };
  return null;
}

export interface MentionMember {
  userId: string;
  firstName: string;
  lastName: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `@` must start a token, so e-mail addresses are never read as mentions. */
const AT = '(?<![\\p{L}\\p{N}._%+-])@';

/**
 * Resolves `@First Last` (preferred) or `@First` (only when exactly one
 * member has that first name) against the organization's active members.
 * Unknown names are ignored — arbitrary user ids are never accepted.
 */
export function parseMentions(body: string, members: MentionMember[]) {
  const found = new Set<string>();
  for (const m of members) {
    const full = `${m.firstName} ${m.lastName}`.trim();
    if (new RegExp(`${AT}${esc(full)}(?![\\p{L}\\p{N}])`, 'iu').test(body))
      found.add(m.userId);
  }
  const byFirst = new Map<string, MentionMember[]>();
  for (const m of members) {
    const k = m.firstName.toLowerCase();
    byFirst.set(k, [...(byFirst.get(k) ?? []), m]);
  }
  for (const [first, ms] of byFirst) {
    if (ms.length !== 1) continue;
    if (new RegExp(`${AT}${esc(first)}(?![\\p{L}\\p{N}])`, 'iu').test(body))
      found.add(ms[0].userId);
  }
  return [...found];
}
