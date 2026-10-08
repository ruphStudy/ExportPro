import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  roleHasPermission,
  type ActionCenterList,
  type ActionCenterSummary,
  type ActionItemView,
  type ActionModule,
  type AiLink,
  type Permission,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
} from '../commercial/commercial-core.service';
import { snoozeUntil, utcDay } from './ops-rules';

type Row = Prisma.ActionItemGetPayload<object>;
const LIVE = ['OPEN', 'IN_PROGRESS', 'SNOOZED'];
const DAY = 86400000;

export interface ActionItemQuery {
  state?: string;
  priority?: string;
  module?: string;
  assignee?: string;
  due?: 'today' | 'overdue' | 'upcoming' | 'critical';
  type?: string;
  page?: number;
  pageSize?: number;
}

/** Action Center item lifecycle. Items are never deleted; history is kept. */
@Injectable()
export class ActionCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CommercialCoreService,
    private readonly audit: AuditService,
  ) {}

  /** Items the actor may see (items carry the permission of their source module). */
  private visible(a: Actor, rows: Row[]) {
    return rows.filter((r) =>
      roleHasPermission(a.role, r.requiredPermission as Permission),
    );
  }

  /** Snoozed items whose time has come re-open (read-time; no scheduler needed). */
  async wake(org: string) {
    await this.prisma.actionItem.updateMany({
      where: {
        organizationId: org,
        state: 'SNOOZED',
        snoozedUntil: { lte: new Date() },
      },
      data: { state: 'OPEN', snoozedUntil: null, rowVersion: { increment: 1 } },
    });
  }

  async view(rows: Row[]): Promise<ActionItemView[]> {
    const names = await this.core.userNames([
      ...rows.map((r) => r.assignedToUserId),
      ...rows.map((r) => r.resolvedByUserId),
    ]);
    return rows.map((r) => ({
      id: r.id,
      type: r.type as ActionItemView['type'],
      severity: r.severity as ActionItemView['severity'],
      priority: r.priority as ActionItemView['priority'],
      priorityScore: r.priorityScore,
      priorityReasons: r.priorityReasons,
      title: r.title,
      description: r.description,
      sourceModule: r.sourceModule as ActionModule,
      sourceEntityType: r.sourceEntityType,
      sourceEntityId: r.sourceEntityId,
      context: r.context as ActionItemView['context'],
      links: r.links as unknown as AiLink[],
      suggestedAction: r.suggestedAction,
      dueAt: r.dueAt?.toISOString() ?? null,
      state: r.state as ActionItemView['state'],
      snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
      assignedTo: r.assignedToUserId
        ? {
            id: r.assignedToUserId,
            name: names.get(r.assignedToUserId) ?? 'Member',
          }
        : null,
      generatedBy: r.generatedBy as ActionItemView['generatedBy'],
      ruleId: r.ruleId,
      resolution: r.resolvedAt
        ? {
            by: r.resolvedByUserId
              ? (names.get(r.resolvedByUserId) ?? null)
              : null,
            at: r.resolvedAt.toISOString(),
            reason: r.resolutionReason,
            auto: r.autoResolved,
          }
        : null,
      rowVersion: r.rowVersion,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  summarize(rows: Row[], lastEvaluatedAt: Date | null): ActionCenterSummary {
    const live = rows.filter((r) => LIVE.includes(r.state));
    const open = live.filter((r) => r.state !== 'SNOOZED');
    const today = utcDay(new Date()).getTime();
    const mods = new Map<string, number>();
    for (const r of open)
      mods.set(r.sourceModule, (mods.get(r.sourceModule) ?? 0) + 1);
    return {
      open: open.length,
      critical: open.filter((r) => r.priority === 'CRITICAL').length,
      high: open.filter((r) => r.priority === 'HIGH').length,
      today: open.filter(
        (r) =>
          r.dueAt &&
          r.dueAt.getTime() >= today &&
          r.dueAt.getTime() < today + DAY,
      ).length,
      overdue: open.filter((r) => r.dueAt && r.dueAt.getTime() < today).length,
      upcoming: open.filter((r) => r.dueAt && r.dueAt.getTime() >= today + DAY)
        .length,
      snoozed: live.filter((r) => r.state === 'SNOOZED').length,
      byModule: [...mods.entries()].map(([module, count]) => ({
        module: module as ActionModule,
        count,
      })),
      lastEvaluatedAt: lastEvaluatedAt?.toISOString() ?? null,
    };
  }

  async list(
    a: Actor,
    q: ActionItemQuery,
    lastEvaluatedAt: Date | null,
  ): Promise<ActionCenterList> {
    const org = a.organizationId;
    await this.wake(org);
    const all = this.visible(
      a,
      await this.prisma.actionItem.findMany({
        where: { organizationId: org },
        orderBy: [
          { priorityScore: 'desc' },
          { dueAt: 'asc' },
          { createdAt: 'desc' },
        ],
      }),
    );
    const today = utcDay(new Date()).getTime();
    const states =
      q.state === 'ALL'
        ? null
        : q.state
          ? q.state.split(',')
          : ['OPEN', 'IN_PROGRESS'];
    let rows = all.filter((r) => !states || states.includes(r.state));
    if (q.priority)
      rows = rows.filter((r) => q.priority!.split(',').includes(r.priority));
    if (q.module) rows = rows.filter((r) => r.sourceModule === q.module);
    if (q.type) rows = rows.filter((r) => r.type === q.type);
    if (q.assignee)
      rows = rows.filter((r) =>
        q.assignee === 'me'
          ? r.assignedToUserId === a.userId
          : q.assignee === 'unassigned'
            ? !r.assignedToUserId
            : r.assignedToUserId === q.assignee,
      );
    if (q.due === 'today')
      rows = rows.filter(
        (r) =>
          r.dueAt &&
          r.dueAt.getTime() >= today &&
          r.dueAt.getTime() < today + DAY,
      );
    if (q.due === 'overdue')
      rows = rows.filter((r) => r.dueAt && r.dueAt.getTime() < today);
    if (q.due === 'upcoming')
      rows = rows.filter((r) => r.dueAt && r.dueAt.getTime() >= today + DAY);
    if (q.due === 'critical')
      rows = rows.filter((r) => r.priority === 'CRITICAL');
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    return {
      items: await this.view(
        rows.slice((page - 1) * pageSize, page * pageSize),
      ),
      meta: {
        page,
        pageSize,
        totalItems: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      },
      summary: this.summarize(all, lastEvaluatedAt),
    };
  }

  async summary(a: Actor, lastEvaluatedAt: Date | null) {
    await this.wake(a.organizationId);
    return this.summarize(
      this.visible(
        a,
        await this.prisma.actionItem.findMany({
          where: { organizationId: a.organizationId, state: { in: LIVE } },
        }),
      ),
      lastEvaluatedAt,
    );
  }

  private async load(a: Actor, id: string) {
    const r = await this.prisma.actionItem.findFirst({
      where: { id, organizationId: a.organizationId },
    });
    if (!r || !roleHasPermission(a.role, r.requiredPermission as Permission))
      throw new NotFoundException('Action item not found.');
    return r;
  }

  /** Optimistic update; stale rowVersion → 409. */
  private async transition(
    a: Actor,
    r: Row,
    data: Prisma.ActionItemUpdateManyMutationInput,
    expected?: number,
  ) {
    if (expected !== undefined && expected !== r.rowVersion)
      throw CommercialCoreService.conflict();
    const n = await this.prisma.actionItem.updateMany({
      where: { id: r.id, rowVersion: r.rowVersion },
      data: { ...data, rowVersion: { increment: 1 } },
    });
    if (n.count !== 1) throw CommercialCoreService.conflict();
    return (
      await this.view([
        await this.prisma.actionItem.findUniqueOrThrow({ where: { id: r.id } }),
      ])
    )[0];
  }

  async update(
    a: Actor,
    id: string,
    dto: {
      state?: 'OPEN' | 'IN_PROGRESS';
      assignedToUserId?: string | null;
      expectedRowVersion?: number;
    },
  ) {
    const r = await this.load(a, id);
    if (!LIVE.includes(r.state))
      throw new ConflictException('This action item is closed.');
    if (dto.assignedToUserId) {
      const m = await this.prisma.membership.findFirst({
        where: {
          organizationId: a.organizationId,
          userId: dto.assignedToUserId,
          status: 'ACTIVE',
        },
      });
      if (!m)
        throw new BadRequestException('Assignee is not an active member.');
    }
    return this.transition(
      a,
      r,
      {
        ...(dto.state ? { state: dto.state, snoozedUntil: null } : {}),
        ...(dto.assignedToUserId !== undefined
          ? { assignedToUserId: dto.assignedToUserId }
          : {}),
      },
      dto.expectedRowVersion,
    );
  }

  async complete(a: Actor, id: string, reason?: string, expected?: number) {
    const r = await this.load(a, id);
    if (!LIVE.includes(r.state))
      throw new ConflictException('This action item is already closed.');
    const v = await this.transition(
      a,
      r,
      {
        state: 'COMPLETED',
        resolvedAt: new Date(),
        resolvedByUserId: a.userId,
        resolutionReason: reason ?? null,
        autoResolved: false,
        snoozedUntil: null,
      },
      expected,
    );
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'action_item.completed',
      entityType: 'ActionItem',
      entityId: id,
      metadata: { type: r.type },
    });
    return v;
  }

  async snooze(
    a: Actor,
    id: string,
    preset: string,
    until?: string,
    expected?: number,
  ) {
    const r = await this.load(a, id);
    if (!LIVE.includes(r.state))
      throw new ConflictException('This action item is closed.');
    let at: Date;
    try {
      at = snoozeUntil(preset, until);
    } catch {
      throw new BadRequestException(
        'Choose tomorrow, 3 days, 1 week or a future custom date.',
      );
    }
    return this.transition(
      a,
      r,
      { state: 'SNOOZED', snoozedUntil: at },
      expected,
    );
  }

  async dismiss(a: Actor, id: string, reason?: string, expected?: number) {
    const r = await this.load(a, id);
    if (!LIVE.includes(r.state))
      throw new ConflictException('This action item is already closed.');
    if (
      (r.priority === 'CRITICAL' || r.priority === 'HIGH') &&
      !(reason && reason.trim().length >= 3)
    )
      throw new BadRequestException({
        message: 'Give a reason to dismiss a high or critical item.',
        details: { code: 'DISMISS_REASON_REQUIRED' },
      });
    const v = await this.transition(
      a,
      r,
      {
        state: 'DISMISSED',
        resolvedAt: new Date(),
        resolvedByUserId: a.userId,
        resolutionReason: reason?.trim() || null,
        autoResolved: false,
        snoozedUntil: null,
      },
      expected,
    );
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'action_item.dismissed',
      entityType: 'ActionItem',
      entityId: id,
      metadata: { type: r.type, reason: reason ?? null },
    });
    return v;
  }
}
