import type {
  Applicability,
  ComplianceReadiness,
  ComplianceSeverity,
  CoverageLevel,
  RequirementBasis,
  RequirementLevel,
  RequirementStatus,
} from '@exportpro/types';

export interface ReadinessItem {
  id: string;
  name: string;
  level: RequirementLevel;
  severity: ComplianceSeverity;
  basis: RequirementBasis;
  applicability: Applicability;
  status: RequirementStatus;
  expiringSoon: boolean;
}

const CLOSED: RequirementStatus[] = [
  'SATISFIED',
  'NOT_APPLICABLE',
  'WAIVED',
  'ACCEPTED_RISK',
];

/** An item counts against readiness when it applies (or might) and is not satisfied/overridden. */
export const isOpen = (i: ReadinessItem) =>
  i.applicability !== 'NOT_APPLICABLE' &&
  !CLOSED.includes(i.status) &&
  i.level !== 'INFORMATIONAL';

const reasonFor = (i: ReadinessItem) =>
  i.applicability === 'UNKNOWN'
    ? 'Applicability unknown — needs confirmation'
    : i.status === 'EXPIRED'
      ? 'Evidence expired'
      : i.status === 'REJECTED'
        ? 'Evidence rejected'
        : i.status === 'UNDER_REVIEW' || i.status === 'DOCUMENT_UPLOADED'
          ? 'Evidence awaiting review/approval'
          : i.status === 'IN_PROGRESS'
            ? 'In progress'
            : 'Missing';

/**
 * Deterministic readiness:
 *  BLOCKED — any open BLOCKER item (including BLOCKER items whose applicability is unknown);
 *  READY_WITH_WARNINGS — no blockers, but open warnings, expiring evidence, or unknown coverage;
 *  READY — nothing open that matters;
 *  NOT_READY — provisional checklist (no accepted PO yet) or nothing evaluated.
 * Required readiness counts only regulatory REQUIRED/CONDITIONAL items; recommended,
 * buyer-requested and user-defined items are reported separately.
 */
export function computeReadiness(
  items: ReadinessItem[],
  opts: { provisional: boolean; coverage: CoverageLevel },
) {
  const blockers = items
    .filter((i) => isOpen(i) && i.severity === 'BLOCKER')
    .map((i) => ({ requirementId: i.id, name: i.name, reason: reasonFor(i) }));
  const warnings = [
    ...items
      .filter((i) => isOpen(i) && i.severity === 'WARNING')
      .map((i) => ({
        requirementId: i.id,
        name: i.name,
        reason: reasonFor(i),
      })),
    ...items
      .filter((i) => i.status === 'SATISFIED' && i.expiringSoon)
      .map((i) => ({
        requirementId: i.id,
        name: i.name,
        reason: 'Evidence expires soon',
      })),
  ];
  const reasons: string[] = [];
  let readiness: ComplianceReadiness;
  if (blockers.length) {
    readiness = 'BLOCKED';
    reasons.push(
      `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} open`,
    );
  } else if (warnings.length || opts.coverage === 'UNKNOWN') {
    readiness = 'READY_WITH_WARNINGS';
    if (warnings.length)
      reasons.push(
        `${warnings.length} warning${warnings.length === 1 ? '' : 's'} open`,
      );
    if (opts.coverage === 'UNKNOWN')
      reasons.push('Compliance coverage incomplete');
  } else readiness = 'READY';
  if (opts.provisional) {
    reasons.unshift('Provisional checklist — no accepted buyer PO yet');
    readiness = 'NOT_READY';
  }
  const regulatory = items.filter(
    (i) =>
      i.basis === 'REGULATORY_REQUIRED' &&
      (i.level === 'REQUIRED' || i.level === 'CONDITIONAL') &&
      i.applicability !== 'NOT_APPLICABLE' &&
      i.status !== 'NOT_APPLICABLE',
  );
  const other = items.filter(
    (i) =>
      !regulatory.includes(i) &&
      i.level !== 'INFORMATIONAL' &&
      i.applicability !== 'NOT_APPLICABLE' &&
      i.status !== 'NOT_APPLICABLE',
  );
  const pct = (s: number, n: number) => (n ? Math.round((s / n) * 100) : null);
  const sat = (l: ReadinessItem[]) =>
    l.filter((i) => i.status === 'SATISFIED').length;
  return {
    readiness,
    reasons,
    blockers,
    warnings,
    requiredReadiness: {
      satisfied: sat(regulatory),
      applicable: regulatory.length,
      percent: pct(sat(regulatory), regulatory.length),
    },
    recommendedCompletion: {
      satisfied: sat(other),
      applicable: other.length,
      percent: pct(sat(other), other.length),
    },
  };
}

export const READINESS_RANK: Record<ComplianceReadiness, number> = {
  NOT_READY: 0,
  BLOCKED: 1,
  READY_WITH_WARNINGS: 2,
  READY: 3,
};
