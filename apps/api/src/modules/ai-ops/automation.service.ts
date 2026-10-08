import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTION_TRIGGERS,
  AUTOMATION_ACTIONS,
  type ActionPriority,
  type ActionTrigger,
  type AutomationActionType,
  type AutomationConditions,
  type AutomationEvaluation,
  type AutomationRuleView,
  type AutomationRunView,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
} from '../commercial/commercial-core.service';
import { CrmService } from '../crm/crm.service';
import { ReceivablesService } from '../finance/receivables.service';
import {
  ALLOWED_ACTIONS,
  APPROVAL_DEFAULT,
  conditionFails,
  DEFAULT_ENABLED,
  describeConditions,
  scorePriority,
  TEMPLATES,
} from './ops-rules';
import { SignalsService, type Signal } from './signals.service';

type RuleRow = Prisma.AutomationRuleGetPayload<object>;
const MAX_ACTIONS_PER_RUN = 500;
const LIVE = ['OPEN', 'IN_PROGRESS', 'SNOOZED'];

export interface RuleInput {
  name?: string;
  triggerType?: string;
  conditions?: AutomationConditions;
  actionType?: string;
  actionConfig?: {
    priority?: ActionPriority;
    assigneeUserId?: string | null;
    taskDueDays?: number;
  };
  requiresApproval?: boolean;
  enabled?: boolean;
  template?: string;
  expectedRowVersion?: number;
}

/**
 * Controlled automation: typed triggers → typed conditions → a few safe actions.
 * Every rule × source condition runs at most once (AutomationRun.dedupeKey), actions
 * never feed back into triggers, and nothing is sent or approved automatically.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly signals: SignalsService,
    private readonly receivables: ReceivablesService,
    private readonly crm: CrmService,
    private readonly audit: AuditService,
  ) {}

  async settings(org: string) {
    return this.prisma.opsSettings.upsert({
      where: { organizationId: org },
      create: { organizationId: org },
      update: {},
    });
  }

  /** Templates are installed once per organization (enabled/disabled per DEFAULT_ENABLED). */
  async ensureTemplates(org: string) {
    const s = await this.settings(org);
    if (s.templatesSeeded) {
      // Templates added in later sprints are backfilled once (rules are never deleted, only disabled).
      const have = await this.prisma.automationRule.findMany({
        where: { organizationId: org, template: { not: null } },
        select: { template: true },
      });
      const missing = TEMPLATES.filter(
        (t) => !have.some((h) => h.template === t.key),
      );
      if (!missing.length) return;
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ops-templates:' + org}))`;
        const again = await tx.automationRule.findMany({
          where: {
            organizationId: org,
            template: { in: missing.map((t) => t.key) },
          },
          select: { template: true },
        });
        const add = missing.filter(
          (t) => !again.some((h) => h.template === t.key),
        );
        if (add.length)
          await tx.automationRule.createMany({
            data: add.map((t) => ({
              organizationId: org,
              name: t.name,
              triggerType: t.triggerType,
              actionType: t.actionType,
              conditions: t.conditions as Prisma.InputJsonValue,
              requiresApproval: t.requiresApproval,
              enabled: DEFAULT_ENABLED.has(t.key),
              template: t.key,
            })),
          });
      });
      return;
    }
    const n = await this.prisma.opsSettings.updateMany({
      where: { organizationId: org, templatesSeeded: false },
      data: { templatesSeeded: true },
    });
    if (n.count !== 1) return;
    await this.prisma.automationRule.createMany({
      data: TEMPLATES.map((t) => ({
        organizationId: org,
        name: t.name,
        triggerType: t.triggerType,
        actionType: t.actionType,
        conditions: t.conditions as Prisma.InputJsonValue,
        requiresApproval: t.requiresApproval,
        enabled: DEFAULT_ENABLED.has(t.key),
        template: t.key,
      })),
    });
  }

  // ---------------------------------------------------------------- rules

  private view(r: RuleRow): AutomationRuleView {
    return {
      id: r.id,
      name: r.name,
      triggerType: r.triggerType as ActionTrigger,
      enabled: r.enabled,
      conditions: r.conditions as AutomationConditions,
      actionType: r.actionType as AutomationActionType,
      actionConfig: r.actionConfig as AutomationRuleView['actionConfig'],
      requiresApproval: r.requiresApproval,
      template: r.template,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      lastResult: r.lastResult,
      rowVersion: r.rowVersion,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async rules(a: Actor) {
    await this.ensureTemplates(a.organizationId);
    const rows = await this.prisma.automationRule.findMany({
      where: { organizationId: a.organizationId },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
    });
    return {
      rules: rows.map((r) => this.view(r)),
      templates: TEMPLATES,
      allowedActions: ALLOWED_ACTIONS,
    };
  }

  private async load(org: string, id: string) {
    const r = await this.prisma.automationRule.findFirst({
      where: { id, organizationId: org },
    });
    if (!r) throw new NotFoundException('Automation rule not found.');
    return r;
  }

  async rule(a: Actor, id: string) {
    const r = await this.load(a.organizationId, id);
    const runs = await this.runs(a, { ruleId: id });
    return { rule: this.view(r), runs: runs.items };
  }

  private validate(
    trigger: string,
    action: string,
    c: AutomationConditions = {},
  ) {
    if (!ACTION_TRIGGERS.includes(trigger as ActionTrigger))
      throw new BadRequestException('Unknown trigger.');
    if (!AUTOMATION_ACTIONS.includes(action as AutomationActionType))
      throw new BadRequestException('Unknown action.');
    if (
      !ALLOWED_ACTIONS[trigger as ActionTrigger].includes(
        action as AutomationActionType,
      )
    )
      throw new BadRequestException({
        message: `“${action}” is not allowed for ${trigger} (prevents loops and unsafe actions).`,
        details: { code: 'ACTION_NOT_ALLOWED' },
      });
    const nums = [
      'minDaysOverdue',
      'minAmount',
      'noReplyDays',
      'daysBeforeExpiry',
      'minEtaDelayDays',
      'minScore',
    ] as const;
    for (const k of nums)
      if (
        c[k] !== undefined &&
        !(Number.isFinite(c[k]) && c[k]! >= 0 && c[k]! <= 10_000_000)
      )
        throw new BadRequestException(`Invalid ${k}.`);
    const allowedKeys = new Set([...nums, 'minSeverity', 'windowStates']);
    for (const k of Object.keys(c))
      if (!allowedKeys.has(k))
        throw new BadRequestException(`Unsupported condition “${k}”.`);
  }

  async create(a: Actor, dto: RuleInput) {
    const t = dto.template
      ? TEMPLATES.find((x) => x.key === dto.template)
      : null;
    if (dto.template && !t) throw new BadRequestException('Unknown template.');
    const trigger = dto.triggerType ?? t?.triggerType;
    const action = dto.actionType ?? t?.actionType;
    if (!trigger || !action)
      throw new BadRequestException('Choose a trigger and an action.');
    const conditions = dto.conditions ?? t?.conditions ?? {};
    this.validate(trigger, action, conditions);
    const requiresApproval = APPROVAL_DEFAULT[action as AutomationActionType]
      ? true
      : (dto.requiresApproval ?? t?.requiresApproval ?? false);
    const r = await this.prisma.automationRule.create({
      data: {
        organizationId: a.organizationId,
        name: dto.name?.trim() || t?.name || `${trigger} → ${action}`,
        triggerType: trigger,
        actionType: action,
        conditions: conditions as Prisma.InputJsonValue,
        actionConfig: (dto.actionConfig ?? {}) as Prisma.InputJsonValue,
        requiresApproval,
        enabled: dto.enabled ?? true,
        template: t?.key ?? null,
        createdByUserId: a.userId,
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'automation.rule_created',
      entityType: 'AutomationRule',
      entityId: r.id,
      metadata: { trigger, action, requiresApproval },
    });
    return this.view(r);
  }

  async update(a: Actor, id: string, dto: RuleInput) {
    const r = await this.load(a.organizationId, id);
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== r.rowVersion
    )
      throw CommercialCoreService.conflict();
    const trigger = dto.triggerType ?? r.triggerType;
    const action = dto.actionType ?? r.actionType;
    const conditions = dto.conditions ?? (r.conditions as AutomationConditions);
    this.validate(trigger, action, conditions);
    // Approval cannot be switched off for actions that write into another module.
    const requiresApproval = APPROVAL_DEFAULT[action as AutomationActionType]
      ? true
      : (dto.requiresApproval ?? r.requiresApproval);
    const n = await this.prisma.automationRule.updateMany({
      where: { id, rowVersion: r.rowVersion },
      data: {
        name: dto.name?.trim() || undefined,
        triggerType: trigger,
        actionType: action,
        conditions: conditions as Prisma.InputJsonValue,
        actionConfig: dto.actionConfig
          ? (dto.actionConfig as Prisma.InputJsonValue)
          : undefined,
        requiresApproval,
        enabled: dto.enabled,
        rowVersion: { increment: 1 },
      },
    });
    if (n.count !== 1) throw CommercialCoreService.conflict();
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'automation.rule_updated',
      entityType: 'AutomationRule',
      entityId: id,
      metadata: {
        enabled: dto.enabled ?? r.enabled,
        conditions: describeConditions(conditions),
      },
    });
    return this.view(await this.load(a.organizationId, id));
  }

  setEnabled(a: Actor, id: string, enabled: boolean) {
    return this.update(a, id, { enabled });
  }

  async runs(
    a: Actor,
    q: { ruleId?: string; status?: string; page?: number; pageSize?: number },
  ) {
    const where: Prisma.AutomationRunWhereInput = {
      organizationId: a.organizationId,
      ...(q.ruleId ? { ruleId: q.ruleId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 30;
    const [rows, total] = await Promise.all([
      this.prisma.automationRun.findMany({
        where,
        include: { rule: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.automationRun.count({ where }),
    ]);
    const items: AutomationRunView[] = rows.map((r) => ({
      id: r.id,
      ruleId: r.ruleId,
      ruleName: r.rule.name,
      triggerType: r.triggerType as ActionTrigger,
      sourceKey: r.sourceKey,
      status: r.status as AutomationRunView['status'],
      condition: r.condition,
      result: r.result,
      skippedReason: r.skippedReason,
      error: r.error,
      actionItemId: r.actionItemId,
      createdAt: r.createdAt.toISOString(),
    }));
    return {
      items,
      meta: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  // ---------------------------------------------------------------- evaluation

  /**
   * Evaluates all enabled rules against current signals. Read-time / on-demand
   * (no scheduler exists); a per-organization lease prevents concurrent runs.
   */
  async evaluate(
    a: Actor,
    force = false,
  ): Promise<AutomationEvaluation & { skippedRun?: boolean }> {
    const org = a.organizationId;
    await this.ensureTemplates(org);
    const s = await this.settings(org);
    const now = new Date();
    if (
      !force &&
      s.lastEvaluatedAt &&
      now.getTime() - s.lastEvaluatedAt.getTime() < 60_000
    )
      return {
        evaluatedAt: s.lastEvaluatedAt.toISOString(),
        signals: 0,
        created: 0,
        updated: 0,
        resolved: 0,
        skipped: 0,
        failed: 0,
        pendingApproval: 0,
        skippedRun: true,
      };
    const lease = await this.prisma.opsSettings.updateMany({
      where: {
        organizationId: org,
        OR: [{ evaluatingUntil: null }, { evaluatingUntil: { lt: now } }],
      },
      data: { evaluatingUntil: new Date(now.getTime() + 120_000) },
    });
    if (lease.count !== 1)
      return {
        evaluatedAt: now.toISOString(),
        signals: 0,
        created: 0,
        updated: 0,
        resolved: 0,
        skipped: 0,
        failed: 0,
        pendingApproval: 0,
        skippedRun: true,
      };
    try {
      return await this.run(a, s.noReplyDays);
    } finally {
      await this.prisma.opsSettings.update({
        where: { organizationId: org },
        data: { evaluatingUntil: null, lastEvaluatedAt: new Date() },
      });
    }
  }

  private async run(
    a: Actor,
    defaultNoReply: number,
  ): Promise<AutomationEvaluation> {
    const org = a.organizationId;
    const rules = await this.prisma.automationRule.findMany({
      where: { organizationId: org, enabled: true },
    });
    const noReply = Math.min(
      defaultNoReply,
      ...rules
        .filter((r) => r.triggerType === 'NO_BUYER_RESPONSE')
        .map(
          (r) =>
            (r.conditions as AutomationConditions).noReplyDays ??
            defaultNoReply,
        ),
    );
    const { signals, ok } = await this.signals.collect(a, noReply);
    const res: AutomationEvaluation = {
      evaluatedAt: new Date().toISOString(),
      signals: signals.length,
      created: 0,
      updated: 0,
      resolved: 0,
      skipped: 0,
      failed: 0,
      pendingApproval: 0,
    };
    const keep = new Set<string>();
    let actions = 0;
    for (const rule of rules) {
      let ruleCount = 0;
      const cond = rule.conditions as AutomationConditions;
      for (const sig of signals.filter((x) => x.trigger === rule.triggerType)) {
        const fail = conditionFails(cond, sig.metrics);
        if (fail) continue;
        keep.add(sig.dedupeKey);
        const runKey = `${rule.id}|${sig.dedupeKey}`.slice(0, 480);
        const exists = await this.prisma.automationRun.findUnique({
          where: {
            organizationId_dedupeKey: {
              organizationId: org,
              dedupeKey: runKey,
            },
          },
        });
        if (exists) {
          // Already handled this exact source condition: refresh the item, never duplicate.
          if (await this.touchItem(org, sig)) res.updated++;
          res.skipped++;
          continue;
        }
        if (actions >= MAX_ACTIONS_PER_RUN) break;
        actions++;
        ruleCount++;
        try {
          const out = await this.execute(a, rule, sig);
          await this.prisma.automationRun.create({
            data: {
              organizationId: org,
              ruleId: rule.id,
              triggerType: rule.triggerType,
              sourceKey: sig.sourceEventId,
              dedupeKey: runKey,
              status: out.status,
              condition: describeConditions(cond),
              result: out.result,
              skippedReason: out.skipped ?? null,
              actionItemId: out.itemId,
            },
          });
          if (out.status === 'PENDING_APPROVAL') res.pendingApproval++;
          if (out.created) res.created++;
          if (out.status === 'SKIPPED') res.skipped++;
          if (
            out.status === 'EXECUTED' &&
            rule.actionType !== 'CREATE_ACTION_ITEM' &&
            rule.actionType !== 'SUGGEST_FOLLOW_UP' &&
            rule.actionType !== 'NOTIFY_IN_APP'
          )
            await this.audit.record({
              organizationId: org,
              actorId: a.userId,
              action: 'automation.action_executed',
              entityType: 'AutomationRule',
              entityId: rule.id,
              metadata: { action: rule.actionType, source: sig.sourceEventId },
            });
        } catch (e) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002'
          ) {
            res.skipped++;
            continue;
          }
          res.failed++;
          this.logger.warn(
            `Automation ${rule.id} failed: ${(e as Error).message}`,
          );
          await this.prisma.automationRun
            .create({
              data: {
                organizationId: org,
                ruleId: rule.id,
                triggerType: rule.triggerType,
                sourceKey: sig.sourceEventId,
                dedupeKey: runKey,
                status: 'FAILED',
                condition: describeConditions(cond),
                error: (e as Error).message.slice(0, 500),
              },
            })
            .catch(() => undefined);
        }
      }
      await this.prisma.automationRule.update({
        where: { id: rule.id },
        data: {
          lastRunAt: new Date(),
          lastResult: `${ruleCount} new action(s)`,
        },
      });
    }
    res.resolved = await this.resolveDisappeared(org, keep, ok, signals);
    return res;
  }

  private async touchItem(org: string, sig: Signal) {
    const n = await this.prisma.actionItem.updateMany({
      where: {
        organizationId: org,
        dedupeKey: sig.dedupeKey,
        state: { in: LIVE },
      },
      data: {
        lastSeenAt: new Date(),
        title: sig.title,
        description: sig.description,
        context: sig.context as unknown as Prisma.InputJsonValue,
      },
    });
    return n.count > 0;
  }

  private async upsertItem(
    org: string,
    rule: RuleRow,
    sig: Signal,
    extra: {
      suggestedAction?: string;
      links?: { label: string; href: string }[];
    } = {},
  ) {
    const cfg = rule.actionConfig as AutomationRuleView['actionConfig'];
    const p = scorePriority(sig.factors, cfg.priority ?? null);
    const existing = await this.prisma.actionItem.findUnique({
      where: {
        organizationId_dedupeKey: {
          organizationId: org,
          dedupeKey: sig.dedupeKey,
        },
      },
    });
    if (existing) return { id: existing.id, created: false };
    const row = await this.prisma.actionItem.create({
      data: {
        organizationId: org,
        type: sig.trigger,
        severity: sig.severity,
        priority: p.priority,
        priorityScore: p.score,
        priorityReasons: p.reasons,
        title: sig.title,
        description: sig.description,
        sourceModule: sig.module,
        sourceEntityType: sig.entityType,
        sourceEntityId: sig.entityId,
        context: sig.context as unknown as Prisma.InputJsonValue,
        links: [
          ...(extra.links ?? []),
          ...sig.links,
        ] as unknown as Prisma.InputJsonValue,
        suggestedAction: extra.suggestedAction ?? sig.suggestedAction,
        requiredPermission: sig.requiredPermission,
        dueAt: sig.dueAt,
        assignedToUserId: cfg.assigneeUserId ?? null,
        generatedBy: 'AUTOMATION',
        ruleId: rule.id,
        dedupeKey: sig.dedupeKey,
        sourceEventId: sig.sourceEventId,
      },
    });
    return { id: row.id, created: true };
  }

  /** Only safe platform actions. Writes into other modules wait for approval when the rule requires it. */
  private async execute(
    a: Actor,
    rule: RuleRow,
    sig: Signal,
  ): Promise<{
    status: AutomationRunView['status'];
    result: string | null;
    itemId: string | null;
    created: boolean;
    skipped?: string;
  }> {
    const org = a.organizationId;
    switch (rule.actionType as AutomationActionType) {
      case 'CREATE_ACTION_ITEM':
      case 'NOTIFY_IN_APP':
      case 'SUGGEST_FOLLOW_UP': {
        const it = await this.upsertItem(org, rule, sig);
        return {
          status: 'EXECUTED',
          result: it.created
            ? 'Action item created'
            : 'Linked to existing action item',
          itemId: it.id,
          created: it.created,
        };
      }
      case 'DRAFT_PAYMENT_REMINDER': {
        if (!sig.refs.receivableId)
          return {
            status: 'SKIPPED',
            result: null,
            itemId: null,
            created: false,
            skipped: 'No receivable on this signal.',
          };
        const it = await this.upsertItem(org, rule, sig, {
          suggestedAction:
            'Review the drafted reminder, then send it yourself and record it.',
        });
        if (rule.requiresApproval)
          return {
            status: 'PENDING_APPROVAL',
            result: 'Awaiting approval to draft the reminder',
            itemId: it.id,
            created: it.created,
          };
        // A draft only — ExportPro never sends it (Sprint 19 reminder workflow).
        await this.receivables.createReminder(a, sig.refs.receivableId, {
          installmentId: sig.refs.installmentId ?? undefined,
          kind: 'OVERDUE',
        });
        return {
          status: 'EXECUTED',
          result: 'Payment reminder drafted (not sent)',
          itemId: it.id,
          created: it.created,
        };
      }
      case 'CREATE_CRM_TASK': {
        if (!sig.refs.crmLeadId)
          return {
            status: 'SKIPPED',
            result: null,
            itemId: null,
            created: false,
            skipped: 'Signal has no CRM lead.',
          };
        const it = await this.upsertItem(org, rule, sig, {
          suggestedAction: 'Approve to create a CRM follow-up task.',
        });
        return {
          status: 'PENDING_APPROVAL',
          result: 'Awaiting approval to create the CRM task',
          itemId: it.id,
          created: it.created,
        };
      }
    }
  }

  /** Human approval of a pending automation action (e.g. create a CRM task). */
  async approve(a: Actor, runId: string) {
    const r = await this.prisma.automationRun.findFirst({
      where: { id: runId, organizationId: a.organizationId },
      include: { rule: true },
    });
    if (!r) throw new NotFoundException('Automation run not found.');
    const n = await this.prisma.automationRun.updateMany({
      where: { id: runId, status: 'PENDING_APPROVAL' },
      data: { status: 'EXECUTED', result: 'Approved and executed' },
    });
    if (n.count !== 1)
      throw new ConflictException(
        'This automation action is not awaiting approval.',
      );
    const item = r.actionItemId
      ? await this.prisma.actionItem.findUnique({
          where: { id: r.actionItemId },
        })
      : null;
    try {
      if (r.rule.actionType === 'CREATE_CRM_TASK') {
        const leadId =
          item?.sourceEntityType === 'BuyerLead'
            ? item.sourceEntityId
            : ((item?.links as { href: string }[] | null) ?? [])
                .map((l) => /\/crm\/leads\/([^/?]+)/.exec(l.href)?.[1])
                .find(Boolean);
        if (!leadId) throw new BadRequestException('No CRM lead linked.');
        const days =
          (r.rule.actionConfig as { taskDueDays?: number }).taskDueDays ?? 1;
        await this.crm.createTask(a, leadId, {
          title: `Follow up: ${item?.title ?? 'automation'}`.slice(0, 200),
          dueAt: new Date(Date.now() + days * 86400000).toISOString(),
        });
      } else if (r.rule.actionType === 'DRAFT_PAYMENT_REMINDER' && item) {
        await this.receivables.createReminder(a, item.sourceEntityId, {
          kind: 'OVERDUE',
        });
      }
    } catch (e) {
      await this.prisma.automationRun.update({
        where: { id: runId },
        data: { status: 'FAILED', error: (e as Error).message.slice(0, 500) },
      });
      throw e;
    }
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'automation.action_executed',
      entityType: 'AutomationRun',
      entityId: runId,
      metadata: { action: r.rule.actionType, approved: true },
    });
    return (await this.runs(a, { ruleId: r.ruleId })).items.find(
      (x) => x.id === runId,
    );
  }

  /** Source condition gone → item closes (COMPLETED, or EXPIRED for time-window triggers). Only for triggers read successfully. */
  private async resolveDisappeared(
    org: string,
    keep: Set<string>,
    ok: Set<ActionTrigger>,
    signals: Signal[],
  ) {
    const live = await this.prisma.actionItem.findMany({
      where: {
        organizationId: org,
        generatedBy: 'AUTOMATION',
        state: { in: LIVE },
      },
    });
    const present = new Set(signals.map((s) => s.dedupeKey));
    let n = 0;
    for (const it of live) {
      if (
        !ok.has(it.type as ActionTrigger) ||
        present.has(it.dedupeKey) ||
        keep.has(it.dedupeKey)
      )
        continue;
      const expired = [
        'REORDER_WINDOW',
        'QUOTATION_EXPIRY',
        'NEW_OPPORTUNITY',
      ].includes(it.type);
      const r = await this.prisma.actionItem.updateMany({
        where: { id: it.id, rowVersion: it.rowVersion },
        data: {
          state: expired ? 'EXPIRED' : 'COMPLETED',
          resolvedAt: new Date(),
          autoResolved: true,
          resolutionReason: expired
            ? 'The window/validity this item referred to no longer applies.'
            : 'Source resolved (e.g. payment received, exception resolved, document renewed).',
          snoozedUntil: null,
          rowVersion: { increment: 1 },
        },
      });
      n += r.count;
    }
    return n;
  }
}
