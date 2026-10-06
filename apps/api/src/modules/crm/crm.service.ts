import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CLOSED_CRM_STAGES,
  CRM_STAGE_LABELS,
  CRM_STAGES,
  CRM_STALE_THRESHOLD_DAYS,
  type CrmAttentionItem,
  type CrmAttentionKind,
  type CrmAttentionResponse,
  type CrmLead,
  type CrmLeadDetailResponse,
  type CrmLeadListResponse,
  type CrmLeadSummary,
  type CrmMember,
  type CrmPipelineColumn,
  type CrmPipelineResponse,
  type CrmStage,
  type CrmUserRef,
  isValidCountryCode,
  type LeadActivity,
  type LeadAttachment,
  type LeadComment,
  type LeadQualification,
  type LeadReminder,
  type LeadSource,
  type LeadTag,
  type LeadTask,
  LOST_REASON_LABELS,
  type MembershipRole,
  OPEN_CRM_STAGES,
  QUALIFICATION_FIELDS,
  roleHasPermission,
  type StageSuggestion,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { AuditService } from '../audit/audit.service';
import {
  LEAD_ATTACHMENT_EXTENSIONS,
  MAX_LEAD_ATTACHMENT_BYTES,
  StorageService,
} from '../storage/storage.service';
import { sanitizeText } from '../buyers/buyer-normalization';
import { buyerMatch, riskLevel } from '../buyers/buyer-scoring';
import type { StoredProfile } from '../buyers/buyer-enrichment.service';
import {
  COMMUNICATION_TYPES,
  DAY_MS,
  ENGAGEMENT_ACTIVITY_TYPES,
  isClosed,
  leadSignals,
  parseMentions,
  stageSuggestion,
} from './crm-rules';
import type {
  AssignDto,
  AttentionQueryDto,
  CreateLeadDto,
  CreateReminderDto,
  CreateTaskDto,
  LeadListQueryDto,
  LogActivityDto,
  LostDto,
  PipelineQueryDto,
  ReopenDto,
  StageChangeDto,
  TasksQueryDto,
  UpdateLeadDto,
  UpdateReminderDto,
  UpdateTaskDto,
  WonDto,
} from './crm.dto';

export type CrmActor = {
  organizationId: string;
  userId: string;
  role: MembershipRole;
};

type Tx = Prisma.TransactionClient;

const ACTIVE_TASK = ['OPEN', 'IN_PROGRESS'] as const;
const FUTURE_SKEW_MS = 5 * 60_000;
const KANBAN_PER_STAGE = 20;
const ATTENTION_LIMIT = 50;

const summaryInclude = {
  buyerCompany: {
    select: {
      id: true,
      canonicalName: true,
      countryCode: true,
      city: true,
      isDemo: true,
      ownerOrganizationId: true,
      verificationStatus: true,
      riskScore: true,
    },
  },
  product: {
    select: { id: true, displayName: true, hsCode: true, itcHsCode: true },
  },
  owner: { select: { id: true, firstName: true, lastName: true } },
  tags: { include: { tag: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BuyerLeadInclude;
type SummaryRow = Prisma.BuyerLeadGetPayload<{
  include: typeof summaryInclude;
}>;

const name = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName}`.trim();
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ============================================================ helpers

  private async findLead(organizationId: string, id: string) {
    const lead = await this.prisma.buyerLead.findFirst({
      where: { id, organizationId },
    });
    // 404 (not 403) so another tenant's lead ids reveal nothing.
    if (!lead) throw new NotFoundException('Lead not found.');
    return lead;
  }

  /** Owner / assignee / reminder recipient must be an ACTIVE member of this organization. */
  private async assertMember(organizationId: string, userId: string) {
    const m = await this.prisma.membership.findFirst({
      where: { organizationId, userId, status: 'ACTIVE' },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, isActive: true },
        },
      },
    });
    if (!m || !m.user.isActive)
      throw new BadRequestException(
        'Select an active member of your organization.',
      );
    return { id: m.user.id, name: name(m.user) };
  }

  private async userRefs(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    const map = new Map<string, CrmUserRef>();
    if (!unique.length) return map;
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const u of users) map.set(u.id, { id: u.id, name: name(u) });
    return map;
  }

  private async assertProduct(
    organizationId: string,
    productId?: string | null,
  ) {
    if (!productId) return null;
    const p = await this.prisma.organizationProduct.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Product not found.');
    return p.id;
  }

  private assertCountry(code?: string | null) {
    if (code && !isValidCountryCode(code))
      throw new BadRequestException('This country is not supported yet.');
  }

  private assertNotFuture(d: Date, label: string) {
    if (d.getTime() > Date.now() + FUTURE_SKEW_MS)
      throw new BadRequestException(
        `${label} cannot be in the future. Use a task or reminder for upcoming work.`,
      );
  }

  /** Optimistic concurrency: the write only lands if the lead is still at the expected version. */
  private async guardedUpdate(
    tx: Tx,
    lead: { id: string; organizationId: string; version: number },
    expectedVersion: number | undefined,
    data: Prisma.BuyerLeadUncheckedUpdateManyInput,
  ) {
    const r = await tx.buyerLead.updateMany({
      where: {
        id: lead.id,
        organizationId: lead.organizationId,
        version: expectedVersion ?? lead.version,
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (r.count === 0)
      throw new ConflictException(
        'This lead was changed by someone else. Refresh to see the latest version and try again.',
      );
  }

  private activity(
    tx: Tx,
    a: CrmActor,
    leadId: string,
    data: Omit<
      Prisma.LeadActivityUncheckedCreateInput,
      'organizationId' | 'leadId' | 'actorUserId'
    >,
  ) {
    return tx.leadActivity.create({
      data: {
        ...data,
        organizationId: a.organizationId,
        leadId,
        actorUserId: a.userId,
      },
    });
  }

  private async taskCounts(leadIds: string[], now: Date) {
    const open = new Map<string, number>();
    const overdue = new Map<string, number>();
    if (!leadIds.length) return { open, overdue };
    const [o, d] = await Promise.all([
      this.prisma.leadTask.groupBy({
        by: ['leadId'],
        where: { leadId: { in: leadIds }, status: { in: [...ACTIVE_TASK] } },
        _count: { _all: true },
      }),
      this.prisma.leadTask.groupBy({
        by: ['leadId'],
        where: {
          leadId: { in: leadIds },
          status: { in: [...ACTIVE_TASK] },
          dueAt: { lt: now },
        },
        _count: { _all: true },
      }),
    ]);
    for (const r of o) open.set(r.leadId, r._count._all);
    for (const r of d) overdue.set(r.leadId, r._count._all);
    return { open, overdue };
  }

  private toTag(t: {
    id: string;
    name: string;
    color: string | null;
  }): LeadTag {
    return { id: t.id, name: t.name, color: t.color };
  }

  private toSummary(
    l: SummaryRow,
    counts: { open: Map<string, number>; overdue: Map<string, number> },
    now: Date,
  ): CrmLeadSummary {
    const b = l.buyerCompany;
    return {
      id: l.id,
      buyer: {
        id: b.id,
        name: b.canonicalName,
        countryCode: b.countryCode,
        city: b.city,
        demo: b.isDemo,
        userProvided: Boolean(b.ownerOrganizationId),
        verificationStatus: b.verificationStatus,
        // Sprint 10 Buyer Risk, read as-is (same level bands as Buyer Discovery).
        risk: { score: b.riskScore, level: riskLevel(b.riskScore) },
      },
      product: l.product
        ? {
            id: l.product.id,
            name: l.product.displayName,
            hsCode: l.product.itcHsCode ?? l.product.hsCode,
          }
        : null,
      countryCode: l.countryCode,
      stage: l.stage,
      priority: l.priority,
      source: l.source as LeadSource,
      owner: l.owner ? { id: l.owner.id, name: name(l.owner) } : null,
      expectedValue: num(l.expectedValue),
      currency: l.currency,
      nextAction: l.nextAction,
      nextActionDueAt: iso(l.nextActionDueAt),
      lastActivityAt: l.lastActivityAt.toISOString(),
      stageChangedAt: l.stageChangedAt.toISOString(),
      wonAt: iso(l.wonAt),
      lostAt: iso(l.lostAt),
      lostReason: l.lostReason,
      tags: l.tags.map((t) => this.toTag(t.tag)),
      signals: leadSignals(
        {
          stage: l.stage,
          lastActivityAt: l.lastActivityAt,
          nextAction: l.nextAction,
          nextActionDueAt: l.nextActionDueAt,
          openTaskCount: counts.open.get(l.id) ?? 0,
          overdueTaskCount: counts.overdue.get(l.id) ?? 0,
        },
        now,
      ),
      version: l.version,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    };
  }

  private async summaries(rows: SummaryRow[], now = new Date()) {
    const counts = await this.taskCounts(
      rows.map((r) => r.id),
      now,
    );
    return rows.map((r) => this.toSummary(r, counts, now));
  }

  async summaryById(organizationId: string, id: string) {
    const row = await this.prisma.buyerLead.findFirst({
      where: { id, organizationId },
      include: summaryInclude,
    });
    if (!row) throw new NotFoundException('Lead not found.');
    return (await this.summaries([row]))[0];
  }

  // ===================================================== query building

  /** Open leads whose last engagement is older than their stage's threshold. */
  private staleWhere(now: Date): Prisma.BuyerLeadWhereInput {
    return {
      OR: OPEN_CRM_STAGES.map((stage) => ({
        stage,
        lastActivityAt: {
          lt: new Date(
            now.getTime() - CRM_STALE_THRESHOLD_DAYS[stage]! * DAY_MS,
          ),
        },
      })),
    };
  }

  private overdueWhere(now: Date): Prisma.BuyerLeadWhereInput {
    return {
      stage: { in: [...OPEN_CRM_STAGES] },
      OR: [
        { nextActionDueAt: { lt: now } },
        {
          tasks: {
            some: { status: { in: [...ACTIVE_TASK] }, dueAt: { lt: now } },
          },
        },
      ],
    };
  }

  private ownerWhere(owner: string | undefined, userId: string) {
    if (!owner) return {};
    if (owner === 'me') return { ownerUserId: userId };
    if (owner === 'unassigned') return { ownerUserId: null };
    return { ownerUserId: owner };
  }

  private searchWhere(q?: string): Prisma.BuyerLeadWhereInput {
    const term = q?.trim();
    if (!term) return {};
    const contains = { contains: term, mode: 'insensitive' as const };
    return {
      OR: [
        { buyerCompany: { canonicalName: contains } },
        { product: { displayName: contains } },
        { product: { hsCode: { startsWith: term } } },
        ...(/^[a-z]{2}$/i.test(term)
          ? [{ countryCode: term.toUpperCase() }]
          : []),
        {
          buyerCompany: {
            contacts: {
              some: { OR: [{ name: contains }, { value: contains }] },
            },
          },
        },
        { tags: { some: { tag: { name: contains } } } },
        { nextAction: contains },
      ],
    };
  }

  private listWhere(
    organizationId: string,
    userId: string,
    q: LeadListQueryDto,
    now: Date,
  ): Prisma.BuyerLeadWhereInput {
    const and: Prisma.BuyerLeadWhereInput[] = [this.searchWhere(q.q)];
    const status = q.status ?? 'OPEN';
    if (status === 'OPEN') and.push({ stage: { in: [...OPEN_CRM_STAGES] } });
    if (status === 'WON' || status === 'LOST') and.push({ stage: status });
    if (q.stage) and.push({ stage: q.stage });
    if (q.tagId) and.push({ tags: { some: { tagId: q.tagId } } });
    if (q.risk) {
      const [min, max] = {
        LOW: [0, 24],
        MODERATE: [25, 49],
        HIGH: [50, 74],
        VERY_HIGH: [75, 100],
      }[q.risk];
      and.push({ buyerCompany: { riskScore: { gte: min, lte: max } } });
    }
    if (q.overdue) and.push(this.overdueWhere(now));
    if (q.stale) and.push(this.staleWhere(now));
    if (q.createdFrom || q.createdTo)
      and.push({
        createdAt: {
          ...(q.createdFrom ? { gte: new Date(q.createdFrom) } : {}),
          ...(q.createdTo ? { lte: new Date(q.createdTo) } : {}),
        },
      });
    if (q.updatedFrom || q.updatedTo)
      and.push({
        updatedAt: {
          ...(q.updatedFrom ? { gte: new Date(q.updatedFrom) } : {}),
          ...(q.updatedTo ? { lte: new Date(q.updatedTo) } : {}),
        },
      });
    return {
      organizationId,
      ...this.ownerWhere(q.owner, userId),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.country ? { countryCode: q.country } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.source ? { source: q.source } : {}),
      AND: and,
    };
  }

  private orderBy(
    sortBy: LeadListQueryDto['sortBy'] = 'updatedAt',
    dir: 'asc' | 'desc' = 'desc',
  ): Prisma.BuyerLeadOrderByWithRelationInput[] {
    const nullsLast = { sort: dir, nulls: 'last' as const };
    const primary: Prisma.BuyerLeadOrderByWithRelationInput =
      sortBy === 'buyer'
        ? { buyerCompany: { canonicalName: dir } }
        : sortBy === 'nextActionDueAt'
          ? { nextActionDueAt: nullsLast }
          : sortBy === 'expectedValue'
            ? { expectedValue: nullsLast }
            : { [sortBy]: dir };
    return [primary, { id: 'asc' }];
  }

  // ============================================================ members

  async members(organizationId: string): Promise<CrmMember[]> {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId, status: 'ACTIVE', user: { isActive: true } },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: [{ user: { firstName: 'asc' } }],
    });
    return rows.map((m) => ({
      id: m.user.id,
      name: name(m.user),
      email: m.user.email,
      role: m.role,
    }));
  }

  // ======================================================== list/board

  async list(a: CrmActor, q: LeadListQueryDto): Promise<CrmLeadListResponse> {
    const now = new Date();
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where = this.listWhere(a.organizationId, a.userId, q, now);
    const [total, rows] = await Promise.all([
      this.prisma.buyerLead.count({ where }),
      this.prisma.buyerLead.findMany({
        where,
        include: summaryInclude,
        orderBy: this.orderBy(q.sortBy, q.sortDir),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: await this.summaries(rows, now),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async pipeline(
    a: CrmActor,
    q: PipelineQueryDto,
  ): Promise<CrmPipelineResponse> {
    const now = new Date();
    const perStage = q.perStage ?? KANBAN_PER_STAGE;
    const base: Prisma.BuyerLeadWhereInput = {
      organizationId: a.organizationId,
      ...this.ownerWhere(q.owner, a.userId),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.tagId ? { tags: { some: { tagId: q.tagId } } } : {}),
      AND: [this.searchWhere(q.q)],
    };
    const stages = q.includeClosed ? [...CRM_STAGES] : [...OPEN_CRM_STAGES];
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: a.organizationId },
      select: { defaultCurrency: true },
    });
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const [groups, perStageRows, overdue, stale, won, lost] = await Promise.all(
      [
        this.prisma.buyerLead.groupBy({
          by: ['stage', 'currency'],
          where: base,
          _count: { _all: true },
          _sum: { expectedValue: true },
        }),
        Promise.all(
          stages.map((stage) =>
            this.prisma.buyerLead.findMany({
              where: { ...base, stage },
              include: summaryInclude,
              orderBy: [
                { priority: 'desc' },
                { updatedAt: 'desc' },
                { id: 'asc' },
              ],
              take: perStage,
            }),
          ),
        ),
        this.prisma.buyerLead.count({
          where: {
            ...base,
            AND: [this.searchWhere(q.q), this.overdueWhere(now)],
          },
        }),
        this.prisma.buyerLead.count({
          where: {
            ...base,
            AND: [this.searchWhere(q.q), this.staleWhere(now)],
          },
        }),
        this.prisma.buyerLead.count({
          where: { ...base, stage: 'WON', wonAt: { gte: monthStart } },
        }),
        this.prisma.buyerLead.count({
          where: { ...base, stage: 'LOST', lostAt: { gte: monthStart } },
        }),
      ],
    );

    const summaries = await this.summaries(perStageRows.flat(), now);
    const byId = new Map(summaries.map((s) => [s.id, s]));
    const cur = org.defaultCurrency;
    const columns: CrmPipelineColumn[] = stages.map((stage, i) => {
      const g = groups.filter((x) => x.stage === stage);
      const count = g.reduce((s, x) => s + x._count._all, 0);
      const currencies = new Set(
        g
          .filter((x) => x._sum.expectedValue !== null)
          .map((x) => x.currency ?? cur),
      );
      const total = g
        .filter((x) => (x.currency ?? cur) === cur)
        .reduce((s, x) => s + Number(x._sum.expectedValue ?? 0), 0);
      return {
        stage,
        count,
        totalExpectedValue: total,
        currency: cur,
        mixedCurrency:
          currencies.size > 1 ||
          (currencies.size === 1 && !currencies.has(cur)),
        leads: perStageRows[i].map((r) => byId.get(r.id)!),
        hasMore: count > perStage,
      };
    });
    const openGroups = groups.filter(
      (x) => !CLOSED_CRM_STAGES.includes(x.stage),
    );
    const qualifiedFrom = CRM_STAGES.indexOf('QUALIFIED');
    return {
      columns,
      metrics: {
        openLeads: openGroups.reduce((s, x) => s + x._count._all, 0),
        qualifiedPlus: openGroups
          .filter((x) => CRM_STAGES.indexOf(x.stage) >= qualifiedFrom)
          .reduce((s, x) => s + x._count._all, 0),
        overdueFollowUps: overdue,
        staleLeads: stale,
        wonThisMonth: won,
        lostThisMonth: lost,
        pipelineValue: openGroups
          .filter((x) => (x.currency ?? cur) === cur)
          .reduce((s, x) => s + Number(x._sum.expectedValue ?? 0), 0),
        pipelineCurrency: cur,
      },
    };
  }

  // ============================================================ create

  /**
   * Single lead-creation path for Buyer Discovery handoff and direct CRM
   * creation. Idempotent per organization + buyer + product context.
   */
  async createLead(
    a: CrmActor,
    dto: CreateLeadDto,
    opts: { source: LeadSource; contextNote?: string | null },
  ) {
    const buyer = await this.prisma.buyerCompany.findFirst({
      where: {
        id: dto.buyerCompanyId,
        OR: [
          { ownerOrganizationId: null },
          { ownerOrganizationId: a.organizationId },
        ],
      },
      select: { id: true, countryCode: true, canonicalName: true },
    });
    if (!buyer) throw new NotFoundException('Buyer not found.');
    const productId = await this.assertProduct(a.organizationId, dto.productId);
    this.assertCountry(dto.countryCode);
    const contextKey = productId ?? 'none';
    const key = {
      organizationId_buyerCompanyId_contextKey: {
        organizationId: a.organizationId,
        buyerCompanyId: buyer.id,
        contextKey,
      },
    };
    const existing = await this.prisma.buyerLead.findUnique({ where: key });
    if (existing) return { lead: existing, alreadyExists: true };

    const owner = await this.assertMember(
      a.organizationId,
      dto.ownerUserId ?? a.userId,
    );
    const now = new Date();
    try {
      const lead = await this.prisma.$transaction(async (tx) => {
        const l = await tx.buyerLead.create({
          data: {
            organizationId: a.organizationId,
            buyerCompanyId: buyer.id,
            productId,
            contextKey,
            countryCode: dto.countryCode ?? buyer.countryCode,
            source: opts.source,
            context: opts.contextNote
              ? { note: sanitizeText(opts.contextNote, 200) }
              : undefined,
            createdByUserId: a.userId,
            ownerUserId: owner.id,
            priority: dto.priority ?? 'MEDIUM',
            nextAction: sanitizeText(dto.nextAction, 200),
            nextActionDueAt: dto.nextActionDueAt
              ? new Date(dto.nextActionDueAt)
              : null,
            lastActivityAt: now,
            stageChangedAt: now,
          },
        });
        await tx.leadStageHistory.create({
          data: {
            organizationId: a.organizationId,
            leadId: l.id,
            fromStage: null,
            toStage: 'NEW',
            changedByUserId: a.userId,
            reason: 'Added to CRM',
          },
        });
        await this.activity(tx, a, l.id, {
          type: 'SYSTEM',
          title: 'Added to CRM',
          body: `Owner: ${owner.name}`,
          metadata: { source: opts.source, ownerUserId: owner.id },
        });
        return l;
      });
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'lead.created',
        entityType: 'BuyerLead',
        entityId: lead.id,
        metadata: {
          buyerCompanyId: buyer.id,
          productId,
          source: opts.source,
          ownerUserId: owner.id,
        },
      });
      return { lead, alreadyExists: false };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        return {
          lead: await this.prisma.buyerLead.findUniqueOrThrow({ where: key }),
          alreadyExists: true,
        };
      throw e;
    }
  }

  // ============================================================ detail

  private async triggerDueReminders(organizationId: string, leadId?: string) {
    const now = new Date();
    await this.prisma.leadReminder.updateMany({
      where: {
        organizationId,
        ...(leadId ? { leadId } : {}),
        status: 'PENDING',
        remindAt: { lte: now },
      },
      data: { status: 'TRIGGERED', triggeredAt: now },
    });
  }

  private suggestionFor(
    l: {
      stage: CrmStage;
      stageChangedAt: Date;
      qualification: Prisma.JsonValue;
    },
    comms: {
      type: LeadActivity['type'];
      direction: 'INBOUND' | 'OUTBOUND' | null;
      occurredAt: Date;
    }[],
  ): StageSuggestion | null {
    return stageSuggestion({
      stage: l.stage,
      stageChangedAt: l.stageChangedAt,
      qualification: (l.qualification as LeadQualification | null) ?? null,
      communications: comms,
    });
  }

  private async communicationsSince(leadId: string, since: Date) {
    return this.prisma.leadActivity.findMany({
      where: {
        leadId,
        type: { in: [...COMMUNICATION_TYPES] },
        occurredAt: { gte: since },
      },
      select: { type: true, direction: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });
  }

  async detail(a: CrmActor, id: string): Promise<CrmLeadDetailResponse> {
    await this.findLead(a.organizationId, id);
    await this.triggerDueReminders(a.organizationId, id);
    const now = new Date();
    const l = await this.prisma.buyerLead.findUniqueOrThrow({
      where: { id },
      include: {
        ...summaryInclude,
        buyerCompany: {
          include: {
            activities: true,
            contacts: {
              orderBy: [{ isPrimary: 'desc' }, { confidence: 'desc' }],
            },
          },
        },
        product: true,
        stageHistory: { orderBy: { changedAt: 'desc' } },
        tasks: {
          orderBy: [
            { status: 'asc' },
            { dueAt: { sort: 'asc', nulls: 'last' } },
          ],
        },
        reminders: {
          where: { status: { in: ['PENDING', 'TRIGGERED'] } },
          orderBy: { remindAt: 'asc' },
        },
        comments: { orderBy: { createdAt: 'desc' }, take: 100 },
        attachments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    const [comms, targets] = await Promise.all([
      this.communicationsSince(id, l.stageChangedAt),
      this.prisma.targetCountry.findMany({
        where: { organizationId: a.organizationId },
        select: { countryCode: true },
      }),
    ]);
    const users = await this.userRefs([
      l.createdByUserId,
      ...l.stageHistory.map((h) => h.changedByUserId),
      ...l.tasks.flatMap((t) => [t.assignedToUserId, t.createdByUserId]),
      ...l.reminders.map((r) => r.userId),
      ...l.comments.flatMap((c) => [c.authorUserId, ...c.mentionedUserIds]),
      ...l.attachments.map((x) => x.uploadedByUserId),
    ]);
    const b = l.buyerCompany;
    const profile = b.profile as unknown as StoredProfile | null;
    // Sprint 10 buyer match, same function and inputs as Buyer Discovery.
    const m = buyerMatch(
      {
        hsCode: l.product?.hsCode ?? null,
        itcHsCode: l.product?.itcHsCode ?? null,
        categoryCode: l.product?.categoryCode ?? null,
        productName: null,
        countryCode: l.countryCode,
        targetCountries: targets.map((t) => t.countryCode),
      },
      {
        countryCode: b.countryCode,
        buyerType: b.buyerType,
        businessCategory: b.businessCategory,
        companySize: b.companySize,
        activities: b.activities.map((x) => ({
          activityType: x.activityType,
          hsCode: x.hsCode,
          productName: x.productName,
          importFrequency: x.importFrequency,
          lastActivityDate: x.lastActivityDate,
        })),
        bestContactConfidence: b.maxContactConfidence,
      },
    );
    const summaryRow = {
      ...l,
      buyerCompany: b,
      product: l.product,
    } as unknown as SummaryRow;
    const summary = (await this.summaries([summaryRow], now))[0];
    const qualification = (l.qualification as LeadQualification | null) ?? {};
    const canManage = roleHasPermission(a.role, 'crm.manage');

    const lead: CrmLead = {
      ...summary,
      createdBy: users.get(l.createdByUserId) ?? null,
      countryDiffersFromBuyer: l.countryCode !== b.countryCode,
      wonReason: l.wonReason,
      lostDetails: l.lostDetails,
      qualification: Object.fromEntries(
        QUALIFICATION_FIELDS.map((f) => [f, qualification[f] ?? null]),
      ),
      primaryContactId: l.primaryContactId,
      contacts: b.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        contactType: c.contactType,
        value: c.value,
        verificationStatus: c.verificationStatus,
        confidence: c.confidence,
        isPrimary: c.isPrimary,
        demo: b.isDemo,
      })),
      match: {
        score: m.score,
        level: m.level,
        productContextMissing: m.productContextMissing,
        reasons: m.reasons.slice(0, 4),
      },
      risk: profile?.risk
        ? {
            score: b.riskScore,
            level: profile.risk.level,
            reasons: profile.risk.reasons
              .filter((r) => !r.positive)
              .slice(0, 4),
          }
        : { score: b.riskScore, level: riskLevel(b.riskScore), reasons: [] },
      history: l.stageHistory.map((h) => ({
        id: h.id,
        fromStage: h.fromStage,
        toStage: h.toStage,
        changedBy: h.changedByUserId
          ? (users.get(h.changedByUserId) ?? null)
          : null,
        changedAt: h.changedAt.toISOString(),
        reason: h.reason,
      })),
      suggestion: isClosed(l.stage) ? null : this.suggestionFor(l, comms),
      context: { note: (l.context as { note?: string } | null)?.note ?? null },
    };
    return {
      lead,
      tasks: l.tasks.map((t) => this.toTask(t, users, now)),
      reminders: l.reminders.map((r) => this.toReminder(r, users, now)),
      comments: l.comments.map((c) => this.toComment(c, users, a)),
      attachments: l.attachments.map((x) => ({
        id: x.id,
        filename: x.originalFilename,
        mimeType: x.mimeType,
        sizeBytes: x.sizeBytes,
        uploadedBy: x.uploadedByUserId
          ? (users.get(x.uploadedByUserId) ?? null)
          : null,
        createdAt: x.createdAt.toISOString(),
        canDelete:
          canManage ||
          (x.uploadedByUserId === a.userId &&
            roleHasPermission(a.role, 'crm.attachments')),
      })) satisfies LeadAttachment[],
    };
  }

  private toTask(
    t: Prisma.LeadTaskGetPayload<object>,
    users: Map<string, CrmUserRef>,
    now: Date,
    lead?: LeadTask['lead'],
  ): LeadTask {
    const active = t.status === 'OPEN' || t.status === 'IN_PROGRESS';
    return {
      id: t.id,
      leadId: t.leadId,
      ...(lead ? { lead } : {}),
      title: t.title,
      description: t.description,
      assignee: t.assignedToUserId
        ? (users.get(t.assignedToUserId) ?? null)
        : null,
      dueAt: iso(t.dueAt),
      priority: t.priority,
      status: t.status,
      overdue: Boolean(active && t.dueAt && t.dueAt < now),
      completedAt: iso(t.completedAt),
      createdBy: users.get(t.createdByUserId) ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private toReminder(
    r: Prisma.LeadReminderGetPayload<object>,
    users: Map<string, CrmUserRef>,
    now: Date,
  ): LeadReminder {
    return {
      id: r.id,
      leadId: r.leadId,
      taskId: r.taskId,
      user: users.get(r.userId) ?? null,
      remindAt: r.remindAt.toISOString(),
      type: r.type,
      status: r.status,
      message: r.message,
      due:
        r.status === 'TRIGGERED' ||
        (r.status === 'PENDING' && r.remindAt <= now),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toComment(
    c: Prisma.LeadCommentGetPayload<object>,
    users: Map<string, CrmUserRef>,
    a: CrmActor,
  ): LeadComment {
    return {
      id: c.id,
      body: c.body,
      author: c.authorUserId ? (users.get(c.authorUserId) ?? null) : null,
      mentions: c.mentionedUserIds
        .map((u) => users.get(u))
        .filter((u): u is CrmUserRef => Boolean(u)),
      createdAt: c.createdAt.toISOString(),
      editedAt: iso(c.editedAt),
      canEdit: c.authorUserId === a.userId,
    };
  }

  // ============================================================ update

  async update(a: CrmActor, id: string, dto: UpdateLeadDto) {
    const lead = await this.findLead(a.organizationId, id);
    const data: Prisma.BuyerLeadUncheckedUpdateManyInput = {};
    const changed: string[] = [];
    const timeline: { title: string; body?: string }[] = [];

    if (dto.priority && dto.priority !== lead.priority) {
      data.priority = dto.priority;
      changed.push('priority');
      timeline.push({
        title: `Priority changed: ${lead.priority.toLowerCase()} → ${dto.priority.toLowerCase()}`,
      });
    }
    if (dto.productId !== undefined && dto.productId !== lead.productId) {
      const productId = await this.assertProduct(
        a.organizationId,
        dto.productId,
      );
      data.productId = productId;
      data.contextKey = productId ?? 'none';
      changed.push('productId');
    }
    if (dto.countryCode && dto.countryCode !== lead.countryCode) {
      this.assertCountry(dto.countryCode);
      data.countryCode = dto.countryCode;
      changed.push('countryCode');
    }
    if (dto.expectedValue !== undefined) {
      data.expectedValue = dto.expectedValue;
      changed.push('expectedValue');
    }
    if (dto.currency !== undefined) {
      data.currency = dto.currency;
      changed.push('currency');
    }
    if (
      dto.expectedValue != null &&
      dto.currency === undefined &&
      !lead.currency
    ) {
      const org = await this.prisma.organization.findUniqueOrThrow({
        where: { id: a.organizationId },
        select: { defaultCurrency: true },
      });
      data.currency = org.defaultCurrency;
    }
    if (dto.nextAction !== undefined || dto.nextActionDueAt !== undefined) {
      const next =
        dto.nextAction === undefined
          ? lead.nextAction
          : sanitizeText(dto.nextAction ?? undefined, 200);
      data.nextAction = next;
      data.nextActionDueAt =
        dto.nextActionDueAt === undefined
          ? lead.nextActionDueAt
          : dto.nextActionDueAt
            ? new Date(dto.nextActionDueAt)
            : null;
      if (!next) data.nextActionDueAt = null;
      changed.push('nextAction');
      timeline.push(
        next
          ? { title: 'Next action set', body: next }
          : { title: 'Next action cleared' },
      );
    }
    if (dto.primaryContactId !== undefined) {
      if (dto.primaryContactId) {
        const c = await this.prisma.buyerContact.findFirst({
          where: {
            id: dto.primaryContactId,
            buyerCompanyId: lead.buyerCompanyId,
          },
        });
        if (!c)
          throw new BadRequestException('Select one of this buyer’s contacts.');
      }
      data.primaryContactId = dto.primaryContactId;
      changed.push('primaryContactId');
    }
    if (dto.qualification) {
      const merged: LeadQualification = {
        ...((lead.qualification as LeadQualification | null) ?? {}),
      };
      for (const f of QUALIFICATION_FIELDS)
        if (dto.qualification[f] !== undefined)
          merged[f] = sanitizeText(dto.qualification[f] ?? undefined, 300);
      data.qualification = merged as Prisma.InputJsonValue;
      changed.push('qualification');
      timeline.push({ title: 'Qualification details updated' });
    }
    let tagIds: string[] | undefined;
    if (dto.tagIds) {
      tagIds = [...new Set(dto.tagIds)];
      const n = await this.prisma.leadTag.count({
        where: { id: { in: tagIds }, organizationId: a.organizationId },
      });
      if (n !== tagIds.length) throw new BadRequestException('Unknown tag.');
      changed.push('tags');
    }
    if (!changed.length) return this.summaryById(a.organizationId, id);

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.guardedUpdate(tx, lead, dto.expectedVersion, data);
        if (tagIds) {
          await tx.leadTagAssignment.deleteMany({
            where: { leadId: id, tagId: { notIn: tagIds } },
          });
          await tx.leadTagAssignment.createMany({
            data: tagIds.map((tagId) => ({
              leadId: id,
              tagId,
              organizationId: a.organizationId,
            })),
            skipDuplicates: true,
          });
        }
        for (const t of timeline)
          await this.activity(tx, a, id, {
            type: 'SYSTEM',
            title: t.title,
            body: t.body ?? null,
          });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException(
          'A lead for this buyer and product already exists.',
        );
      throw e;
    }
    // Field names only — commercial values stay out of the security log.
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'lead.updated',
      entityType: 'BuyerLead',
      entityId: id,
      metadata: {
        fields: changed,
        ...(data.priority ? { priority: data.priority } : {}),
      },
    });
    return this.summaryById(a.organizationId, id);
  }

  // ============================================================= stage

  private async recordStage(
    tx: Tx,
    a: CrmActor,
    lead: { id: string; stage: CrmStage },
    to: CrmStage,
    reason: string | null,
    metadata?: Record<string, unknown>,
    title?: string,
  ) {
    await tx.leadStageHistory.create({
      data: {
        organizationId: a.organizationId,
        leadId: lead.id,
        fromStage: lead.stage,
        toStage: to,
        changedByUserId: a.userId,
        reason,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await this.activity(tx, a, lead.id, {
      type: 'STAGE_CHANGE',
      title:
        title ??
        `Stage changed: ${CRM_STAGE_LABELS[lead.stage]} → ${CRM_STAGE_LABELS[to]}`,
      body: reason,
      metadata: {
        fromStage: lead.stage,
        toStage: to,
        ...(metadata ?? {}),
      } as Prisma.InputJsonValue,
    });
  }

  async changeStage(a: CrmActor, id: string, dto: StageChangeDto) {
    const lead = await this.findLead(a.organizationId, id);
    if (dto.stage === 'WON' || dto.stage === 'LOST')
      throw new BadRequestException(
        dto.stage === 'WON'
          ? 'Use “Mark as won” to close a lead as won.'
          : 'Use “Mark as lost” — a lost reason is required.',
      );
    if (isClosed(lead.stage))
      throw new BadRequestException(
        'This lead is closed. Reopen it before changing its stage.',
      );
    if (dto.stage === lead.stage) return this.summaryById(a.organizationId, id);
    const now = new Date();
    const reason = sanitizeText(dto.reason, 300);
    await this.prisma.$transaction(async (tx) => {
      await this.guardedUpdate(tx, lead, dto.expectedVersion, {
        stage: dto.stage,
        stageChangedAt: now,
        lastActivityAt: now,
      });
      await this.recordStage(tx, a, lead, dto.stage, reason);
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'lead.stage_changed',
      entityType: 'BuyerLead',
      entityId: id,
      metadata: { from: lead.stage, to: dto.stage },
    });
    return this.summaryById(a.organizationId, id);
  }

  private async openWork(leadId: string) {
    const [openTasks, pendingReminders] = await Promise.all([
      this.prisma.leadTask.count({
        where: { leadId, status: { in: [...ACTIVE_TASK] } },
      }),
      this.prisma.leadReminder.count({
        where: { leadId, status: { in: ['PENDING', 'TRIGGERED'] } },
      }),
    ]);
    return { openTasks, pendingReminders };
  }

  async markWon(a: CrmActor, id: string, dto: WonDto) {
    const lead = await this.findLead(a.organizationId, id);
    if (isClosed(lead.stage))
      throw new BadRequestException(
        lead.stage === 'WON'
          ? 'This lead is already won.'
          : 'Reopen this lost lead before marking it won.',
      );
    const now = new Date();
    const wonAt = dto.wonAt ? new Date(dto.wonAt) : now;
    this.assertNotFuture(wonAt, 'Won date');
    const reason = sanitizeText(dto.reason, 300);
    const value = dto.value ?? num(lead.expectedValue);
    const currency = dto.currency ?? lead.currency;
    await this.prisma.$transaction(async (tx) => {
      await this.guardedUpdate(tx, lead, dto.expectedVersion, {
        stage: 'WON',
        wonAt,
        wonReason: reason,
        lostAt: null,
        lostReason: null,
        lostDetails: null,
        stageChangedAt: now,
        lastActivityAt: now,
        ...(dto.value !== undefined ? { expectedValue: dto.value } : {}),
        ...(dto.currency ? { currency: dto.currency } : {}),
      });
      await this.recordStage(
        tx,
        a,
        lead,
        'WON',
        reason,
        { wonAt: wonAt.toISOString(), value, currency },
        'Lead marked as won',
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'lead.won',
      entityType: 'BuyerLead',
      entityId: id,
      metadata: { from: lead.stage, wonAt: wonAt.toISOString() },
    });
    return {
      lead: await this.summaryById(a.organizationId, id),
      ...(await this.openWork(id)),
    };
  }

  async markLost(a: CrmActor, id: string, dto: LostDto) {
    const lead = await this.findLead(a.organizationId, id);
    if (isClosed(lead.stage))
      throw new BadRequestException(
        lead.stage === 'LOST'
          ? 'This lead is already lost.'
          : 'Reopen this won lead before marking it lost.',
      );
    const now = new Date();
    const details = sanitizeText(dto.details, 1000);
    await this.prisma.$transaction(async (tx) => {
      await this.guardedUpdate(tx, lead, dto.expectedVersion, {
        stage: 'LOST',
        lostAt: now,
        lostReason: dto.reason,
        lostDetails: details,
        wonAt: null,
        wonReason: null,
        stageChangedAt: now,
        lastActivityAt: now,
      });
      await this.recordStage(
        tx,
        a,
        lead,
        'LOST',
        `${LOST_REASON_LABELS[dto.reason]}${details ? ` — ${details}` : ''}`,
        { lostReason: dto.reason, lostDetails: details },
        'Lead marked as lost',
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'lead.lost',
      entityType: 'BuyerLead',
      entityId: id,
      metadata: { from: lead.stage, lostReason: dto.reason },
    });
    return {
      lead: await this.summaryById(a.organizationId, id),
      ...(await this.openWork(id)),
    };
  }

  /** Reopens a WON/LOST lead. Prior won/lost rows stay in stage history. */
  async reopen(a: CrmActor, id: string, dto: ReopenDto) {
    const lead = await this.findLead(a.organizationId, id);
    if (!isClosed(lead.stage))
      throw new BadRequestException('Only won or lost leads can be reopened.');
    if (isClosed(dto.stage))
      throw new BadRequestException('Choose an active stage to reopen into.');
    const now = new Date();
    const reason = sanitizeText(dto.reason, 300);
    await this.prisma.$transaction(async (tx) => {
      await this.guardedUpdate(tx, lead, undefined, {
        stage: dto.stage,
        wonAt: null,
        wonReason: null,
        lostAt: null,
        lostReason: null,
        lostDetails: null,
        stageChangedAt: now,
        lastActivityAt: now,
      });
      await this.recordStage(
        tx,
        a,
        lead,
        dto.stage,
        reason,
        {
          reopenedFrom: lead.stage,
          previousLostReason: lead.lostReason,
          previousWonAt: iso(lead.wonAt),
        },
        `Lead reopened from ${CRM_STAGE_LABELS[lead.stage]} into ${CRM_STAGE_LABELS[dto.stage]}`,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'lead.reopened',
      entityType: 'BuyerLead',
      entityId: id,
      metadata: { from: lead.stage, to: dto.stage },
    });
    return this.summaryById(a.organizationId, id);
  }

  // ======================================================== assignment

  async assign(a: CrmActor, id: string, dto: AssignDto) {
    const lead = await this.findLead(a.organizationId, id);
    const next = dto.ownerUserId
      ? await this.assertMember(a.organizationId, dto.ownerUserId)
      : null;
    if ((next?.id ?? null) === lead.ownerUserId)
      return this.summaryById(a.organizationId, id);
    const prev = lead.ownerUserId
      ? (await this.userRefs([lead.ownerUserId])).get(lead.ownerUserId)
      : null;
    await this.prisma.$transaction(async (tx) => {
      await this.guardedUpdate(tx, lead, dto.expectedVersion, {
        ownerUserId: next?.id ?? null,
      });
      await this.activity(tx, a, id, {
        type: 'SYSTEM',
        title: !next
          ? 'Owner removed'
          : prev
            ? `Owner changed from ${prev.name} to ${next.name}`
            : `Owner assigned: ${next.name}`,
        metadata: { fromUserId: lead.ownerUserId, toUserId: next?.id ?? null },
      });
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: lead.ownerUserId ? 'lead.reassigned' : 'lead.assigned',
      entityType: 'BuyerLead',
      entityId: id,
      metadata: { fromUserId: lead.ownerUserId, toUserId: next?.id ?? null },
    });
    return this.summaryById(a.organizationId, id);
  }

  // ======================================================== activities

  async activities(a: CrmActor, id: string, page = 1, pageSize = 30) {
    await this.findLead(a.organizationId, id);
    const where = { leadId: id, organizationId: a.organizationId };
    const [total, rows] = await Promise.all([
      this.prisma.leadActivity.count({ where }),
      this.prisma.leadActivity.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const [users, contacts] = await Promise.all([
      this.userRefs(rows.map((r) => r.actorUserId)),
      this.prisma.buyerContact.findMany({
        where: {
          id: {
            in: rows
              .map((r) => r.contactId)
              .filter((x): x is string => Boolean(x)),
          },
        },
        select: { id: true, name: true, role: true, value: true },
      }),
    ]);
    const items: LeadActivity[] = rows.map((r) => {
      const c = contacts.find((x) => x.id === r.contactId);
      return {
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        direction: r.direction,
        occurredAt: r.occurredAt.toISOString(),
        contact: c ? { id: c.id, name: c.name ?? c.role ?? c.value } : null,
        outcome: r.outcome,
        durationMinutes: r.durationMinutes,
        location: r.location,
        actor: r.actorUserId ? (users.get(r.actorUserId) ?? null) : null,
        metadata: (r.metadata as Record<string, unknown> | null) ?? {},
        createdAt: r.createdAt.toISOString(),
      };
    });
    return { items, meta: buildPaginationMeta(page, pageSize, total) };
  }

  /** Manual logging only — nothing is sent (outreach is Sprint 12). */
  async logActivity(a: CrmActor, id: string, dto: LogActivityDto) {
    const lead = await this.findLead(a.organizationId, id);
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    this.assertNotFuture(occurredAt, 'Activity date');
    if (dto.contactId) {
      const c = await this.prisma.buyerContact.findFirst({
        where: { id: dto.contactId, buyerCompanyId: lead.buyerCompanyId },
      });
      if (!c)
        throw new BadRequestException('Select one of this buyer’s contacts.');
    }
    const body = sanitizeText(dto.body, 5000);
    if (dto.type === 'NOTE' && !body)
      throw new BadRequestException('Write the note.');
    const defaults = {
      NOTE: 'Note added',
      EMAIL: 'Email logged',
      CALL: 'Call logged',
      MEETING: 'Meeting logged',
      OTHER: 'Activity logged',
    };
    const isComm = COMMUNICATION_TYPES.includes(dto.type);
    await this.prisma.$transaction(async (tx) => {
      await this.activity(tx, a, id, {
        type: dto.type,
        title: sanitizeText(dto.title, 200) ?? defaults[dto.type],
        body,
        direction: isComm ? (dto.direction ?? 'OUTBOUND') : null,
        occurredAt,
        contactId: dto.contactId ?? null,
        outcome: sanitizeText(dto.outcome, 200),
        durationMinutes:
          dto.type === 'CALL' || dto.type === 'MEETING'
            ? (dto.durationMinutes ?? null)
            : null,
        location:
          dto.type === 'MEETING' ? sanitizeText(dto.location, 300) : null,
      });
      if (
        ENGAGEMENT_ACTIVITY_TYPES.includes(dto.type) &&
        occurredAt > lead.lastActivityAt
      )
        await tx.buyerLead.update({
          where: { id },
          data: { lastActivityAt: occurredAt },
        });
    });
    const fresh = await this.findLead(a.organizationId, id);
    return {
      lead: await this.summaryById(a.organizationId, id),
      suggestion: isClosed(fresh.stage)
        ? null
        : this.suggestionFor(
            fresh,
            await this.communicationsSince(id, fresh.stageChangedAt),
          ),
    };
  }

  // ========================================================== comments

  private async mentionMembers(organizationId: string) {
    const ms = await this.prisma.membership.findMany({
      where: { organizationId, status: 'ACTIVE', user: { isActive: true } },
      select: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return ms.map((m) => ({
      userId: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
    }));
  }

  async addComment(a: CrmActor, id: string, rawBody: string) {
    await this.findLead(a.organizationId, id);
    const body = sanitizeText(rawBody, 5000);
    if (!body) throw new BadRequestException('Write a comment.');
    const mentioned = parseMentions(
      body,
      await this.mentionMembers(a.organizationId),
    );
    const c = await this.prisma.$transaction(async (tx) => {
      const c = await tx.leadComment.create({
        data: {
          organizationId: a.organizationId,
          leadId: id,
          authorUserId: a.userId,
          body,
          mentionedUserIds: mentioned,
        },
      });
      await this.activity(tx, a, id, {
        type: 'COMMENT',
        title: 'Comment added',
        body: body.length > 200 ? `${body.slice(0, 197)}…` : body,
        metadata: { commentId: c.id, mentionedUserIds: mentioned },
      });
      return c;
    });
    return this.toComment(c, await this.userRefs([a.userId, ...mentioned]), a);
  }

  async editComment(
    a: CrmActor,
    id: string,
    commentId: string,
    rawBody: string,
  ) {
    await this.findLead(a.organizationId, id);
    const c = await this.prisma.leadComment.findFirst({
      where: { id: commentId, leadId: id, organizationId: a.organizationId },
    });
    if (!c) throw new NotFoundException('Comment not found.');
    if (c.authorUserId !== a.userId)
      throw new ForbiddenException('You can only edit your own comments.');
    const body = sanitizeText(rawBody, 5000);
    if (!body) throw new BadRequestException('Write a comment.');
    const mentioned = parseMentions(
      body,
      await this.mentionMembers(a.organizationId),
    );
    const u = await this.prisma.leadComment.update({
      where: { id: commentId },
      data: { body, mentionedUserIds: mentioned, editedAt: new Date() },
    });
    return this.toComment(u, await this.userRefs([a.userId, ...mentioned]), a);
  }

  // ============================================================== tags

  async tags(organizationId: string): Promise<LeadTag[]> {
    const rows = await this.prisma.leadTag.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
    return rows.map((t) => this.toTag(t));
  }

  async createTag(a: CrmActor, rawName: string, color?: string) {
    const tagName = sanitizeText(rawName, 40);
    if (!tagName) throw new BadRequestException('Enter a tag name.');
    const normalizedName = tagName.toLowerCase().replace(/\s+/g, ' ');
    const t = await this.prisma.leadTag.upsert({
      where: {
        organizationId_normalizedName: {
          organizationId: a.organizationId,
          normalizedName,
        },
      },
      create: {
        organizationId: a.organizationId,
        name: tagName,
        normalizedName,
        color: color ?? null,
      },
      update: {},
    });
    return this.toTag(t);
  }

  // ============================================================= tasks

  async listTasks(a: CrmActor, q: TasksQueryDto) {
    const now = new Date();
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const status = q.status ?? 'ACTIVE';
    const where: Prisma.LeadTaskWhereInput = {
      organizationId: a.organizationId,
      ...(q.scope === 'all' ? {} : { assignedToUserId: a.userId }),
      status: status === 'ACTIVE' ? { in: [...ACTIVE_TASK] } : status,
      ...(q.overdue
        ? { dueAt: { lt: now }, status: { in: [...ACTIVE_TASK] } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.leadTask.count({ where }),
      this.prisma.leadTask.findMany({
        where,
        include: {
          lead: {
            select: {
              id: true,
              stage: true,
              buyerCompany: { select: { canonicalName: true } },
            },
          },
        },
        orderBy: [
          { dueAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const users = await this.userRefs(
      rows.flatMap((t) => [t.assignedToUserId, t.createdByUserId]),
    );
    return {
      items: rows.map((t) =>
        this.toTask(t, users, now, {
          id: t.lead.id,
          buyerName: t.lead.buyerCompany.canonicalName,
          stage: t.lead.stage,
        }),
      ),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private async findTask(organizationId: string, taskId: string) {
    const t = await this.prisma.leadTask.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!t) throw new NotFoundException('Task not found.');
    return t;
  }

  async createTask(a: CrmActor, id: string, dto: CreateTaskDto) {
    const lead = await this.findLead(a.organizationId, id);
    const assignee = await this.assertMember(
      a.organizationId,
      dto.assignedToUserId ?? lead.ownerUserId ?? a.userId,
    );
    const title = sanitizeText(dto.title, 200);
    if (!title) throw new BadRequestException('Enter a task title.');
    const t = await this.prisma.$transaction(async (tx) => {
      const t = await tx.leadTask.create({
        data: {
          organizationId: a.organizationId,
          leadId: id,
          title,
          description: sanitizeText(dto.description, 2000),
          assignedToUserId: assignee.id,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          priority: dto.priority ?? 'MEDIUM',
          createdByUserId: a.userId,
        },
      });
      await this.activity(tx, a, id, {
        type: 'TASK',
        title: `Task created: ${title}`,
        body: `Assigned to ${assignee.name}${t.dueAt ? `, due ${t.dueAt.toISOString().slice(0, 10)}` : ''}`,
        metadata: { taskId: t.id },
      });
      return t;
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'task.created',
      entityType: 'LeadTask',
      entityId: t.id,
      metadata: { leadId: id, assignedToUserId: assignee.id },
    });
    return this.toTask(
      t,
      await this.userRefs([t.assignedToUserId, t.createdByUserId]),
      new Date(),
    );
  }

  async updateTask(a: CrmActor, taskId: string, dto: UpdateTaskDto) {
    const t = await this.findTask(a.organizationId, taskId);
    const data: Prisma.LeadTaskUncheckedUpdateInput = {};
    if (dto.title !== undefined) {
      const title = sanitizeText(dto.title, 200);
      if (!title) throw new BadRequestException('Enter a task title.');
      data.title = title;
    }
    if (dto.description !== undefined)
      data.description = sanitizeText(dto.description ?? undefined, 2000);
    if (dto.assignedToUserId !== undefined)
      data.assignedToUserId = dto.assignedToUserId
        ? (await this.assertMember(a.organizationId, dto.assignedToUserId)).id
        : null;
    if (dto.dueAt !== undefined)
      data.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.priority) data.priority = dto.priority;
    const statusChange =
      dto.status && dto.status !== t.status ? dto.status : null;
    if (statusChange) {
      data.status = statusChange;
      data.completedAt = statusChange === 'DONE' ? new Date() : null;
    }
    const now = new Date();
    const u = await this.prisma.$transaction(async (tx) => {
      const u = await tx.leadTask.update({ where: { id: taskId }, data });
      if (statusChange === 'DONE' || statusChange === 'CANCELLED') {
        await tx.leadReminder.updateMany({
          where: { taskId, status: { in: ['PENDING', 'TRIGGERED'] } },
          data: { status: 'CANCELLED' },
        });
        await this.activity(tx, a, t.leadId, {
          type: 'TASK',
          title: `Task ${statusChange === 'DONE' ? 'completed' : 'cancelled'}: ${u.title}`,
          metadata: { taskId },
        });
        if (statusChange === 'DONE')
          await tx.buyerLead.update({
            where: { id: t.leadId },
            data: { lastActivityAt: now },
          });
      } else if (statusChange) {
        await this.activity(tx, a, t.leadId, {
          type: 'TASK',
          title: `Task reopened: ${u.title}`,
          metadata: { taskId },
        });
      }
      return u;
    });
    if (statusChange === 'DONE' || dto.assignedToUserId !== undefined)
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: statusChange === 'DONE' ? 'task.completed' : 'task.updated',
        entityType: 'LeadTask',
        entityId: taskId,
        metadata: {
          leadId: t.leadId,
          status: u.status,
          assignedToUserId: u.assignedToUserId,
        },
      });
    return this.toTask(
      u,
      await this.userRefs([u.assignedToUserId, u.createdByUserId]),
      now,
    );
  }

  // ========================================================= reminders

  async createReminder(a: CrmActor, id: string, dto: CreateReminderDto) {
    await this.findLead(a.organizationId, id);
    const user = await this.assertMember(
      a.organizationId,
      dto.userId ?? a.userId,
    );
    if (dto.taskId) {
      const t = await this.prisma.leadTask.findFirst({
        where: { id: dto.taskId, leadId: id, organizationId: a.organizationId },
      });
      if (!t) throw new BadRequestException('Task not found on this lead.');
    }
    const message = sanitizeText(dto.message, 300);
    if (!message) throw new BadRequestException('Enter a reminder message.');
    const r = await this.prisma.leadReminder.create({
      data: {
        organizationId: a.organizationId,
        leadId: id,
        taskId: dto.taskId ?? null,
        userId: user.id,
        remindAt: new Date(dto.remindAt),
        type: dto.type ?? (dto.taskId ? 'TASK' : 'FOLLOW_UP'),
        message,
        createdByUserId: a.userId,
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'reminder.created',
      entityType: 'LeadReminder',
      entityId: r.id,
      metadata: {
        leadId: id,
        userId: user.id,
        remindAt: r.remindAt.toISOString(),
      },
    });
    return this.toReminder(r, await this.userRefs([r.userId]), new Date());
  }

  async updateReminder(
    a: CrmActor,
    reminderId: string,
    dto: UpdateReminderDto,
  ) {
    const r = await this.prisma.leadReminder.findFirst({
      where: { id: reminderId, organizationId: a.organizationId },
    });
    if (!r) throw new NotFoundException('Reminder not found.');
    if (r.status === 'DISMISSED' || r.status === 'CANCELLED')
      throw new BadRequestException('This reminder is already closed.');
    const data: Prisma.LeadReminderUpdateInput = {};
    if (dto.remindAt) {
      data.remindAt = new Date(dto.remindAt);
      data.status = 'PENDING';
      data.triggeredAt = null;
    }
    if (dto.status === 'DISMISSED')
      Object.assign(data, { status: 'DISMISSED', dismissedAt: new Date() });
    if (dto.status === 'CANCELLED') data.status = 'CANCELLED';
    const u = await this.prisma.leadReminder.update({
      where: { id: reminderId },
      data,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action:
        u.status === 'DISMISSED'
          ? 'reminder.dismissed'
          : u.status === 'CANCELLED'
            ? 'reminder.cancelled'
            : 'reminder.snoozed',
      entityType: 'LeadReminder',
      entityId: reminderId,
      metadata: { leadId: r.leadId },
    });
    return this.toReminder(u, await this.userRefs([u.userId]), new Date());
  }

  // ========================================================= attention

  /** CRM-local "needs follow-up" feed (groundwork for the future Action Center). */
  async attention(
    a: CrmActor,
    q: AttentionQueryDto,
  ): Promise<CrmAttentionResponse> {
    await this.triggerDueReminders(a.organizationId);
    const now = new Date();
    const mine = q.scope !== 'all';
    const leadScope: Prisma.BuyerLeadWhereInput = {
      organizationId: a.organizationId,
      stage: { in: [...OPEN_CRM_STAGES] },
      ...(mine ? { ownerUserId: a.userId } : {}),
    };
    const leadSel = {
      id: true,
      stage: true,
      ownerUserId: true,
      nextAction: true,
      nextActionDueAt: true,
      lastActivityAt: true,
      buyerCompany: { select: { canonicalName: true } },
    } satisfies Prisma.BuyerLeadSelect;
    const taskWhere: Prisma.LeadTaskWhereInput = {
      organizationId: a.organizationId,
      status: { in: [...ACTIVE_TASK] },
      dueAt: { lt: now },
      lead: { stage: { in: [...OPEN_CRM_STAGES] } },
      ...(mine ? { assignedToUserId: a.userId } : {}),
    };
    const reminderWhere: Prisma.LeadReminderWhereInput = {
      organizationId: a.organizationId,
      status: 'TRIGGERED',
      ...(mine ? { userId: a.userId } : {}),
    };
    const nextWhere = { ...leadScope, nextActionDueAt: { lt: now } };
    const staleWhere = { ...leadScope, AND: [this.staleWhere(now)] };
    const noNextWhere = { ...leadScope, nextAction: null };
    const mentionWhere: Prisma.LeadCommentWhereInput = {
      organizationId: a.organizationId,
      mentionedUserIds: { has: a.userId },
      createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
    };
    const [tasks, reminders, nextOverdue, stale, noNext, mentions, counts] =
      await Promise.all([
        this.prisma.leadTask.findMany({
          where: taskWhere,
          include: { lead: { select: leadSel } },
          orderBy: { dueAt: 'asc' },
          take: ATTENTION_LIMIT,
        }),
        this.prisma.leadReminder.findMany({
          where: reminderWhere,
          include: { lead: { select: leadSel } },
          orderBy: { remindAt: 'asc' },
          take: ATTENTION_LIMIT,
        }),
        this.prisma.buyerLead.findMany({
          where: nextWhere,
          select: leadSel,
          orderBy: { nextActionDueAt: 'asc' },
          take: ATTENTION_LIMIT,
        }),
        this.prisma.buyerLead.findMany({
          where: staleWhere,
          select: leadSel,
          orderBy: { lastActivityAt: 'asc' },
          take: ATTENTION_LIMIT,
        }),
        this.prisma.buyerLead.findMany({
          where: noNextWhere,
          select: leadSel,
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
        this.prisma.leadComment.findMany({
          where: mentionWhere,
          include: { lead: { select: leadSel } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        Promise.all([
          this.prisma.leadTask.count({ where: taskWhere }),
          this.prisma.buyerLead.count({ where: nextWhere }),
          this.prisma.buyerLead.count({ where: staleWhere }),
          this.prisma.leadReminder.count({ where: reminderWhere }),
          this.prisma.buyerLead.count({ where: noNextWhere }),
          this.prisma.leadComment.count({ where: mentionWhere }),
        ]),
      ]);
    const users = await this.userRefs([
      ...[...tasks, ...reminders, ...mentions].map((x) => x.lead.ownerUserId),
      ...[...nextOverdue, ...stale, ...noNext].map((l) => l.ownerUserId),
      ...mentions.map((m) => m.authorUserId),
    ]);
    type L = Prisma.BuyerLeadGetPayload<{ select: typeof leadSel }>;
    const base = (l: L) => ({
      leadId: l.id,
      buyerName: l.buyerCompany.canonicalName,
      stage: l.stage,
      owner: l.ownerUserId ? (users.get(l.ownerUserId) ?? null) : null,
    });
    const days = (d: Date) =>
      Math.floor((now.getTime() - d.getTime()) / DAY_MS);
    const items: CrmAttentionItem[] = [
      ...reminders.map((r) => ({
        ...base(r.lead),
        kind: 'REMINDER_DUE' as const,
        title: r.message,
        detail: `Reminder due ${r.remindAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        dueAt: r.remindAt.toISOString(),
        refId: r.id,
      })),
      ...tasks.map((t) => ({
        ...base(t.lead),
        kind: 'OVERDUE_TASK' as const,
        title: t.title,
        detail: `Task overdue by ${Math.max(1, days(t.dueAt!))} day(s)`,
        dueAt: iso(t.dueAt),
        refId: t.id,
      })),
      ...nextOverdue.map((l) => ({
        ...base(l),
        kind: 'OVERDUE_NEXT_ACTION' as const,
        title: l.nextAction ?? 'Next action',
        detail: `Next action overdue by ${Math.max(1, days(l.nextActionDueAt!))} day(s)`,
        dueAt: iso(l.nextActionDueAt),
        refId: null,
      })),
      ...stale.map((l) => ({
        ...base(l),
        kind: 'STALE_LEAD' as const,
        title: 'Stale lead',
        detail: `No activity for ${days(l.lastActivityAt)} days in ${CRM_STAGE_LABELS[l.stage]}. Suggested: ${leadSignals({ stage: l.stage, lastActivityAt: l.lastActivityAt, nextAction: null, nextActionDueAt: null, openTaskCount: 0, overdueTaskCount: 0 }, now).suggestedFollowUp}.`,
        dueAt: null,
        refId: null,
      })),
      ...noNext.map((l) => ({
        ...base(l),
        kind: 'NO_NEXT_ACTION' as const,
        title: 'No next action',
        detail: `Set a next action for this ${CRM_STAGE_LABELS[l.stage]} lead.`,
        dueAt: null,
        refId: null,
      })),
      ...mentions.map((m) => ({
        ...base(m.lead),
        kind: 'MENTION' as const,
        title: `${m.authorUserId ? (users.get(m.authorUserId)?.name ?? 'A teammate') : 'A teammate'} mentioned you`,
        detail: m.body.length > 140 ? `${m.body.slice(0, 137)}…` : m.body,
        dueAt: null,
        refId: m.id,
      })),
    ];
    const kinds: CrmAttentionKind[] = [
      'OVERDUE_TASK',
      'OVERDUE_NEXT_ACTION',
      'STALE_LEAD',
      'REMINDER_DUE',
      'NO_NEXT_ACTION',
      'MENTION',
    ];
    return {
      items,
      counts: Object.fromEntries(kinds.map((k, i) => [k, counts[i]])) as Record<
        CrmAttentionKind,
        number
      >,
    };
  }

  // ======================================================= attachments

  async uploadAttachment(a: CrmActor, id: string, file: Express.Multer.File) {
    await this.findLead(a.organizationId, id);
    if (!file) throw new BadRequestException('Choose a file to upload.');
    const { storageKey } = await this.storage.savePrivateFile(
      'lead-attachments',
      file,
      LEAD_ATTACHMENT_EXTENSIONS,
      MAX_LEAD_ATTACHMENT_BYTES,
    );
    const filename = sanitizeText(file.originalname, 200) ?? 'attachment';
    try {
      const x = await this.prisma.$transaction(async (tx) => {
        const x = await tx.leadAttachment.create({
          data: {
            organizationId: a.organizationId,
            leadId: id,
            originalFilename: filename,
            storageKey,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            uploadedByUserId: a.userId,
          },
        });
        await this.activity(tx, a, id, {
          type: 'ATTACHMENT',
          title: `Attachment uploaded: ${filename}`,
          metadata: { attachmentId: x.id },
        });
        return x;
      });
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'attachment.added',
        entityType: 'LeadAttachment',
        entityId: x.id,
        metadata: { leadId: id, mimeType: x.mimeType, sizeBytes: x.sizeBytes },
      });
      return {
        id: x.id,
        filename: x.originalFilename,
        mimeType: x.mimeType,
        sizeBytes: x.sizeBytes,
        uploadedBy: (await this.userRefs([a.userId])).get(a.userId) ?? null,
        createdAt: x.createdAt.toISOString(),
        canDelete: true,
      } satisfies LeadAttachment;
    } catch (e) {
      await this.storage.deletePrivateFile(storageKey);
      throw e;
    }
  }

  private async findAttachment(
    organizationId: string,
    leadId: string,
    attachmentId: string,
  ) {
    await this.findLead(organizationId, leadId);
    const x = await this.prisma.leadAttachment.findFirst({
      where: { id: attachmentId, leadId, organizationId, deletedAt: null },
    });
    if (!x) throw new NotFoundException('Attachment not found.');
    return x;
  }

  async readAttachment(a: CrmActor, leadId: string, attachmentId: string) {
    const x = await this.findAttachment(a.organizationId, leadId, attachmentId);
    const buffer = await this.storage
      .readPrivateFile(x.storageKey)
      .catch(() => {
        throw new NotFoundException('The file is no longer available.');
      });
    return { buffer, filename: x.originalFilename, mimeType: x.mimeType };
  }

  async deleteAttachment(a: CrmActor, leadId: string, attachmentId: string) {
    const x = await this.findAttachment(a.organizationId, leadId, attachmentId);
    const canManage = roleHasPermission(a.role, 'crm.manage');
    if (!canManage && x.uploadedByUserId !== a.userId)
      throw new ForbiddenException(
        'Only the uploader or a CRM manager can remove this attachment.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.leadAttachment.update({
        where: { id: x.id },
        data: { deletedAt: new Date() },
      });
      await this.activity(tx, a, leadId, {
        type: 'ATTACHMENT',
        title: `Attachment removed: ${x.originalFilename}`,
        metadata: { attachmentId: x.id },
      });
    });
    await this.storage.deletePrivateFile(x.storageKey);
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'attachment.removed',
      entityType: 'LeadAttachment',
      entityId: x.id,
      metadata: { leadId },
    });
    return { id: x.id, removed: true };
  }
}
