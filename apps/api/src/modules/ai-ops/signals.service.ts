import { Injectable, Logger } from '@nestjs/common';
import type { ActionModule, ActionTrigger, AiLink } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from '../commercial/commercial-core.service';
import { ComplianceService } from '../compliance/compliance.service';
import { CrmService } from '../crm/crm.service';
import { DocumentValidationService } from '../document-validation/validation.service';
import { AnalyticsService as FinanceAnalyticsService } from '../finance/analytics.service';
import { FinanceCoreService } from '../finance/finance-core.service';
import { ReceivablesService } from '../finance/receivables.service';
import { ShipmentsService } from '../logistics/shipments.service';
import { isoDay, type PriorityFactors, type SignalMetrics } from './ops-rules';

const DAY = 86400000;

/** One deterministic source condition (an unpaid overdue installment, an open exception, …). */
export interface Signal {
  trigger: ActionTrigger;
  dedupeKey: string;
  sourceEventId: string;
  module: ActionModule;
  entityType: string;
  entityId: string;
  title: string;
  description: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  dueAt: Date | null;
  context: { label: string; value: string }[];
  links: AiLink[];
  suggestedAction: string;
  requiredPermission: string;
  factors: PriorityFactors;
  metrics: SignalMetrics;
  /** How the item closes when the condition disappears. */
  onDisappear: 'COMPLETED' | 'EXPIRED';
  /** Extra data for automation actions (never shown as facts). */
  refs: Record<string, string | null>;
}

/**
 * Reads trigger conditions from the existing module services (finance, logistics,
 * CRM, document validation, compliance) — the Action Center never recalculates
 * overdue status, shipment health, readiness or reorder windows itself.
 */
@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly receivables: ReceivablesService,
    private readonly fin: FinanceCoreService,
    private readonly financeAnalytics: FinanceAnalyticsService,
    private readonly shipments: ShipmentsService,
    private readonly crm: CrmService,
    private readonly validation: DocumentValidationService,
    private readonly compliance: ComplianceService,
  ) {}

  /** Returns signals plus the triggers that were read successfully (only those may auto-resolve items). */
  async collect(a: Actor, noReplyDays: number) {
    const sys: Actor = { ...a, role: 'OWNER' };
    const out: Signal[] = [];
    const ok = new Set<ActionTrigger>();
    const run = async (
      triggers: ActionTrigger[],
      fn: () => Promise<Signal[]>,
    ) => {
      try {
        out.push(...(await fn()));
        triggers.forEach((t) => ok.add(t));
      } catch (e) {
        this.logger.warn(
          `Signal source ${triggers.join('/')} failed: ${(e as Error).message}`,
        );
      }
    };
    const rate = await this.rates(a.organizationId);
    await run(['PAYMENT_OVERDUE'], () => this.overdue(a.organizationId, rate));
    await run(['NO_BUYER_RESPONSE'], () =>
      this.noReply(a.organizationId, noReplyDays),
    );
    await run(['DOCUMENT_EXPIRY'], () => this.expiry(a.organizationId));
    await run(['ETA_CHANGE', 'SHIPMENT_EXCEPTION'], () => this.exceptions(sys));
    await run(['COMPLIANCE_BLOCKER'], () => this.blockers(a.organizationId));
    await run(['VALIDATION_CRITICAL'], () => this.validationIssues(sys));
    await run(['REORDER_WINDOW'], () => this.reorder(sys));
    await run(['QUOTATION_EXPIRY'], () =>
      this.quotationExpiry(a.organizationId),
    );
    await run(['NEW_OPPORTUNITY'], () => this.opportunities(a.organizationId));
    await run(['CRM_TASK_OVERDUE'], () => this.crmFollowUps(sys));
    await run(['SAMPLE_DELIVERED'], () => this.samples(a.organizationId));
    return { signals: out, ok };
  }

  private async rates(org: string) {
    const rep = (await this.fin.settings(org)).reportingCurrency;
    const cache = new Map<string, number | null>();
    return async (amount: number, currency: string) => {
      if (!cache.has(currency))
        cache.set(
          currency,
          (await this.fin.latestRate(org, currency, rep))?.rate.toNumber() ??
            null,
        );
      const r = cache.get(currency);
      return r === null || r === undefined ? null : amount * r;
    };
  }

  // Sprint 19 receivables (read-time overdue status from ReceivablesService).
  private async overdue(
    org: string,
    rate: (a: number, c: string) => Promise<number | null>,
  ): Promise<Signal[]> {
    const { list, ctx } = await this.receivables.computedAll(org, {
      state: 'OPEN',
    });
    const out: Signal[] = [];
    for (const c of list)
      for (const i of c.installments) {
        if (i.status !== 'OVERDUE') continue;
        const amount = Number(i.row.outstandingAmount.toString());
        const buyer =
          ctx.buyers.find((b) => b.id === c.r.buyerCompanyId)?.canonicalName ??
          'Buyer';
        const exposure = await rate(amount, c.r.currency);
        out.push({
          trigger: 'PAYMENT_OVERDUE',
          dedupeKey: `payment_overdue:${i.row.id}:${isoDay(i.dueDate!)}`,
          sourceEventId: `installment:${i.row.id}`,
          module: 'FINANCE',
          entityType: 'Receivable',
          entityId: c.r.id,
          title: `${c.r.currency} ${amount.toFixed(2)} overdue — ${buyer}`,
          description: `${c.r.receivableNumber} · ${i.row.label} was due ${isoDay(i.dueDate!)} (${i.daysOverdue} day(s) overdue).`,
          severity: (i.daysOverdue ?? 0) > 30 ? 'CRITICAL' : 'WARNING',
          dueAt: i.dueDate,
          context: [
            { label: 'Buyer', value: buyer },
            { label: 'Receivable', value: c.r.receivableNumber },
            {
              label: 'Outstanding',
              value: `${c.r.currency} ${amount.toFixed(2)}`,
            },
          ],
          links: [
            {
              label: 'View receivable',
              href: `/finance/receivables/${c.r.id}`,
            },
            { label: 'Record payment', href: `/finance/receivables/${c.r.id}` },
          ],
          suggestedAction:
            'Draft a payment reminder or record the payment if it has arrived.',
          requiredPermission: 'finance.view',
          factors: {
            severity: (i.daysOverdue ?? 0) > 30 ? 'CRITICAL' : 'WARNING',
            exposure,
            overdueDays: i.daysOverdue,
          },
          metrics: {
            severity: 'WARNING',
            daysOverdue: i.daysOverdue,
            amount: exposure ?? amount,
          },
          onDisappear: 'COMPLETED',
          refs: {
            receivableId: c.r.id,
            installmentId: i.row.id,
            crmLeadId: c.r.crmLeadId,
          },
        });
      }
    return out;
  }

  // Sprint 12 outreach: last outbound message with no reply recorded.
  private async noReply(org: string, days: number): Promise<Signal[]> {
    const cutoff = new Date(Date.now() - days * DAY);
    const msgs = await this.prisma.outreachMessage.findMany({
      where: {
        organizationId: org,
        status: { in: ['SENT', 'DELIVERED', 'OPENED'] },
        sentAt: { lte: cutoff },
        repliedAt: null,
        recipient: { status: { in: ['ACTIVE', 'COMPLETED'] } },
      },
      include: {
        recipient: {
          include: {
            buyerCompany: { select: { canonicalName: true } },
            campaign: { select: { name: true } },
          },
        },
      },
      orderBy: { sentAt: 'desc' },
    });
    const seen = new Set<string>();
    const out: Signal[] = [];
    for (const m of msgs) {
      const r = m.recipient;
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      const since = Math.floor((Date.now() - m.sentAt!.getTime()) / DAY);
      out.push({
        trigger: 'NO_BUYER_RESPONSE',
        dedupeKey: `no_reply:${r.id}:${m.id}`,
        sourceEventId: `outreach_message:${m.id}`,
        module: 'OUTREACH',
        entityType: 'CampaignRecipient',
        entityId: r.id,
        title: `No reply from ${r.buyerCompany.canonicalName} in ${since} days`,
        description: `Campaign “${r.campaign.name}” message sent ${isoDay(m.sentAt!)} — no reply recorded.`,
        severity: 'INFO',
        dueAt: new Date(m.sentAt!.getTime() + days * DAY),
        context: [
          { label: 'Buyer', value: r.buyerCompany.canonicalName },
          { label: 'Campaign', value: r.campaign.name },
          { label: 'Sent', value: isoDay(m.sentAt!) },
        ],
        links: r.crmLeadId
          ? [
              { label: 'Open CRM lead', href: `/crm/leads/${r.crmLeadId}` },
              {
                label: 'Campaign',
                href: `/outreach/campaigns/${r.campaignId}`,
              },
            ]
          : [
              {
                label: 'Campaign',
                href: `/outreach/campaigns/${r.campaignId}`,
              },
            ],
        suggestedAction:
          'Follow up personally or mark the reply if the buyer answered elsewhere.',
        requiredPermission: 'outreach.view',
        factors: { severity: 'INFO', overdueDays: since - days },
        metrics: { severity: 'INFO', noReplyDays: since },
        onDisappear: 'COMPLETED',
        refs: { crmLeadId: r.crmLeadId, buyerId: r.buyerCompanyId },
      });
    }
    return out;
  }

  // Sprint 16 document expiry window (ComplianceService.warnDays) + onboarding certifications.
  private async expiry(org: string): Promise<Signal[]> {
    const warn = await this.compliance.warnDays(org);
    const limit = new Date(Date.now() + warn * DAY);
    const docs = await this.prisma.tradeDocument.findMany({
      where: {
        organizationId: org,
        expiryDate: { lte: limit },
        status: { notIn: ['ARCHIVED', 'SUPERSEDED', 'REJECTED'] },
      },
      orderBy: { version: 'desc' },
    });
    const latest = new Map<string, (typeof docs)[number]>();
    for (const d of docs) if (!latest.has(d.rootId)) latest.set(d.rootId, d);
    const certs = await this.prisma.certification.findMany({
      where: { organizationId: org, expiryDate: { lte: limit } },
    });
    const sig = (
      id: string,
      type: string,
      name: string,
      exp: Date,
      href: string,
      perm: string,
      module: ActionModule,
    ): Signal => {
      const days = Math.ceil((exp.getTime() - Date.now()) / DAY);
      const sev = days < 0 ? 'CRITICAL' : 'WARNING';
      return {
        trigger: 'DOCUMENT_EXPIRY',
        dedupeKey: `${type}_expiry:${id}:${isoDay(exp)}`,
        sourceEventId: `${type}:${id}`,
        module,
        entityType: type === 'cert' ? 'Certification' : 'TradeDocument',
        entityId: id,
        title:
          days < 0
            ? `${name} expired ${-days} day(s) ago`
            : `${name} expires in ${days} day(s)`,
        description: `Expiry date ${isoDay(exp)} (warning window ${warn} days).`,
        severity: sev,
        dueAt: exp,
        context: [
          { label: 'Document', value: name },
          { label: 'Expiry', value: isoDay(exp) },
        ],
        links: [
          {
            label: type === 'cert' ? 'Open certifications' : 'View document',
            href,
          },
        ],
        suggestedAction: 'Renew it and upload the new version.',
        requiredPermission: perm,
        factors: { severity: sev, deadlineDays: days, blocker: days < 0 },
        metrics: { severity: sev, daysToExpiry: days },
        onDisappear: 'COMPLETED',
        refs: {},
      };
    };
    return [
      ...[...latest.values()].map((d) =>
        sig(
          d.id,
          'doc',
          d.title,
          d.expiryDate!,
          `/documents/${d.id}`,
          'documents.view',
          'DOCUMENTS',
        ),
      ),
      ...certs.map((c) =>
        sig(
          c.id,
          'cert',
          c.name,
          c.expiryDate!,
          '/export-setup',
          'onboarding.view',
          'COMPLIANCE',
        ),
      ),
    ];
  }

  // Sprint 18 shipment exceptions (ETA delays are auto-detected there).
  private async exceptions(sys: Actor): Promise<Signal[]> {
    const out: Signal[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await this.shipments.exceptions(sys, {
        status: 'OPEN',
        page,
        pageSize: 50,
      });
      for (const e of r.items) {
        if (e.severity === 'INFO' && e.type !== 'ETA_DELAY') continue;
        const eta = e.type === 'ETA_DELAY';
        const delay = eta
          ? Number(/(\d+)\s*day/.exec(e.title)?.[1] ?? 0)
          : null;
        const sev =
          e.severity === 'CRITICAL'
            ? 'CRITICAL'
            : e.severity === 'WARNING'
              ? 'WARNING'
              : 'INFO';
        out.push({
          trigger: eta ? 'ETA_CHANGE' : 'SHIPMENT_EXCEPTION',
          dedupeKey: `exception:${e.id}`,
          sourceEventId: `shipment_exception:${e.id}`,
          module: 'LOGISTICS',
          entityType: 'ShipmentException',
          entityId: e.id,
          title: `${e.shipment?.shipmentNumber ?? 'Shipment'}: ${e.title}`,
          description:
            e.description ??
            `${e.type.replace(/_/g, ' ').toLowerCase()} recorded ${isoDay(new Date(e.detectedAt))} (${e.source.toLowerCase().replace(/_/g, ' ')}).`,
          severity: sev,
          dueAt: e.dueAt ? new Date(e.dueAt) : null,
          context: [
            { label: 'Shipment', value: e.shipment?.shipmentNumber ?? '—' },
            { label: 'Type', value: e.type.replace(/_/g, ' ').toLowerCase() },
          ],
          links: e.shipment
            ? [
                {
                  label: 'View shipment',
                  href: `/shipments/${e.shipment.id}?tab=exceptions`,
                },
                {
                  label: 'Resolve exception',
                  href: `/shipments/${e.shipment.id}?tab=exceptions`,
                },
              ]
            : [{ label: 'Exceptions', href: '/shipments/exceptions' }],
          suggestedAction: eta
            ? 'Check the new ETA with the forwarder and update the buyer (draft update on the shipment).'
            : 'Resolve the exception on the shipment with a written resolution.',
          requiredPermission: 'logistics.view',
          factors: {
            severity: sev,
            delayDays: delay,
            blocker: e.type === 'CUSTOMS_HOLD',
          },
          metrics: { severity: sev, etaDelayDays: delay },
          onDisappear: 'COMPLETED',
          refs: { shipmentId: e.shipment?.id ?? null },
        });
      }
      if (page >= r.meta.totalPages) break;
    }
    return out;
  }

  // Sprint 16 checklist readiness (stored by the compliance engine — not re-evaluated here).
  private async blockers(org: string): Promise<Signal[]> {
    const rows = await this.prisma.complianceChecklist.findMany({
      where: {
        organizationId: org,
        readiness: 'BLOCKED',
        purchaseOrderId: { not: null },
      },
    });
    const pos = await this.prisma.buyerPurchaseOrder.findMany({
      where: {
        organizationId: org,
        id: { in: rows.map((r) => r.purchaseOrderId!) },
        status: 'ACCEPTED',
      },
      select: { id: true, poNumber: true },
    });
    return rows
      .filter((r) => pos.some((p) => p.id === r.purchaseOrderId))
      .map((r) => {
        const po = pos.find((p) => p.id === r.purchaseOrderId)!;
        return {
          trigger: 'COMPLIANCE_BLOCKER' as const,
          dedupeKey: `compliance:${r.id}`,
          sourceEventId: `checklist:${r.id}`,
          module: 'COMPLIANCE' as const,
          entityType: 'ComplianceChecklist',
          entityId: r.id,
          title: `Compliance blocked for PO ${po.poNumber}`,
          description: 'The order’s compliance checklist has open blockers.',
          severity: 'CRITICAL' as const,
          dueAt: null,
          context: [{ label: 'PO', value: po.poNumber }],
          links: [
            { label: 'Open checklist', href: `/compliance/orders/${po.id}` },
          ],
          suggestedAction: 'Resolve the blocking requirements before shipment.',
          requiredPermission: 'compliance.view',
          factors: { severity: 'CRITICAL' as const, blocker: true },
          metrics: { severity: 'CRITICAL' as const },
          onDisappear: 'COMPLETED' as const,
          refs: { purchaseOrderId: po.id },
        };
      });
  }

  // Sprint 17 validation dashboard (latest runs with open critical findings).
  private async validationIssues(sys: Actor): Promise<Signal[]> {
    const d = await this.validation.dashboard(sys);
    return d.issues
      .filter((i) => i.critical > 0)
      .map((i) => ({
        trigger: 'VALIDATION_CRITICAL' as const,
        dedupeKey: `validation:${i.runId}`,
        sourceEventId: `validation_run:${i.runId}`,
        module: 'DOCUMENTS' as const,
        entityType: 'DocumentValidationRun',
        entityId: i.runId,
        title: `${i.critical} critical validation issue(s): ${i.label}`,
        description:
          'Document validation found critical mismatches that are still open.',
        severity: 'CRITICAL' as const,
        dueAt: null,
        context: [{ label: 'Package', value: i.label }],
        links: [
          {
            label: 'View document',
            href: i.primaryDocumentId
              ? `/documents/${i.primaryDocumentId}`
              : i.purchaseOrderId
                ? `/documents/validation/orders/${i.purchaseOrderId}`
                : '/documents/validation',
          },
        ],
        suggestedAction:
          'Review and resolve the findings, then re-run validation.',
        requiredPermission: 'document_validation.view',
        factors: { severity: 'CRITICAL' as const, blocker: true },
        metrics: { severity: 'CRITICAL' as const },
        onDisappear: 'COMPLETED' as const,
        refs: { purchaseOrderId: i.purchaseOrderId },
      }));
  }

  // Sprint 19 repeat-business signals (window computed by the finance analytics service).
  private async reorder(sys: Actor): Promise<Signal[]> {
    const signals = await this.financeAnalytics.signals(sys);
    return signals
      .filter(
        (s) =>
          s.window &&
          ['APPROACHING', 'IN_WINDOW', 'PAST_WINDOW'].includes(
            s.windowState ?? '',
          ),
      )
      .map((s) => ({
        trigger: 'REORDER_WINDOW' as const,
        dedupeKey: `reorder:${s.buyer.id}:${s.window!.start}`,
        sourceEventId: `reorder_window:${s.buyer.id}:${s.window!.start}`,
        module: 'CRM' as const,
        entityType: 'BuyerCompany',
        entityId: s.buyer.id,
        title: `${s.buyer.name} ${s.windowState === 'PAST_WINDOW' ? 'is past' : s.windowState === 'IN_WINDOW' ? 'is in' : 'is approaching'} its reorder window`,
        description: `Usually orders every ~${Math.round(s.averageIntervalDays ?? 0)} days; expected ${s.window!.start} – ${s.window!.end}. Last order ${s.lastOrderDate}.`,
        severity:
          s.windowState === 'PAST_WINDOW'
            ? ('WARNING' as const)
            : ('INFO' as const),
        dueAt: new Date(s.window!.end),
        context: [
          { label: 'Buyer', value: s.buyer.name },
          {
            label: 'Signal',
            value: `${s.level.toLowerCase()} (${s.score ?? '—'} pts)`,
          },
          { label: 'Usually orders', value: s.topProducts[0]?.name ?? '—' },
        ],
        links: [
          { label: 'Repeat business', href: '/repeat-business' },
          ...(s.crmLeadId
            ? [{ label: 'Open CRM lead', href: `/crm/leads/${s.crmLeadId}` }]
            : []),
        ],
        suggestedAction:
          'Draft a reorder follow-up (copy and send it yourself).',
        requiredPermission: 'repeat_business.view',
        factors: {
          severity:
            s.windowState === 'PAST_WINDOW'
              ? ('WARNING' as const)
              : ('INFO' as const),
          deadlineDays: Math.ceil(
            (new Date(s.window!.end).getTime() - Date.now()) / DAY,
          ),
        },
        metrics: {
          severity: 'INFO' as const,
          windowState: s.windowState,
          score: s.score,
        },
        onDisappear: 'EXPIRED' as const,
        refs: { buyerId: s.buyer.id, crmLeadId: s.crmLeadId },
      }));
  }

  private async quotationExpiry(org: string): Promise<Signal[]> {
    const rows = await this.prisma.quotation.findMany({
      where: {
        organizationId: org,
        status: { in: ['ISSUED', 'SENT'] },
        validUntil: { lte: new Date(Date.now() + 14 * DAY) },
      },
    });
    return rows.map((q) => {
      const days = Math.ceil((q.validUntil!.getTime() - Date.now()) / DAY);
      const sev = days < 0 ? ('WARNING' as const) : ('INFO' as const);
      return {
        trigger: 'QUOTATION_EXPIRY' as const,
        dedupeKey: `quote_expiry:${q.id}:${isoDay(q.validUntil!)}`,
        sourceEventId: `quotation:${q.id}`,
        module: 'COMMERCIAL' as const,
        entityType: 'Quotation',
        entityId: q.id,
        title: `Quotation ${q.quotationNumber}${q.revision > 1 ? ` R${q.revision}` : ''} ${days < 0 ? 'validity passed' : `valid ${days} more day(s)`}`,
        description: `${q.buyerName ?? 'Buyer'} · valid until ${isoDay(q.validUntil!)}.`,
        severity: sev,
        dueAt: q.validUntil,
        context: [
          { label: 'Buyer', value: q.buyerName ?? '—' },
          {
            label: 'Total',
            value: q.totalAmount
              ? `${q.currency} ${q.totalAmount.toFixed(2)}`
              : '—',
          },
        ],
        links: [{ label: 'Open quotation', href: `/quotations/${q.id}` }],
        suggestedAction: 'Follow up with the buyer or revise the quotation.',
        requiredPermission: 'quotations.view',
        factors: { severity: sev, deadlineDays: days },
        metrics: { severity: sev, daysToExpiry: days },
        onDisappear: 'EXPIRED' as const,
        refs: { crmLeadId: q.crmLeadId },
      };
    });
  }

  // Watchlist only — never every opportunity.
  private async opportunities(org: string): Promise<Signal[]> {
    const saved = await this.prisma.savedOpportunity.findMany({
      where: { organizationId: org },
      include: { opportunity: true },
    });
    return saved.map((s) => ({
      trigger: 'NEW_OPPORTUNITY' as const,
      dedupeKey: `opportunity:${s.opportunityId}`,
      sourceEventId: `opportunity:${s.opportunityId}`,
      module: 'OPPORTUNITIES' as const,
      entityType: 'Opportunity',
      entityId: s.opportunityId,
      title: `${s.opportunity.productName} → ${s.opportunity.destinationCountryCode} scores ${s.opportunity.overallScore}`,
      description: 'A watchlist opportunity meets your score threshold.',
      severity: 'INFO' as const,
      dueAt: null,
      context: [
        { label: 'Score', value: String(s.opportunity.overallScore) },
        { label: 'Confidence', value: String(s.opportunity.confidenceScore) },
      ],
      links: [
        {
          label: 'Open opportunity',
          href: `/opportunities/${s.opportunityId}`,
        },
      ],
      suggestedAction: 'Review the market and run a costing.',
      requiredPermission: 'opportunities.view',
      factors: { severity: 'INFO' as const },
      metrics: { severity: 'INFO' as const, score: s.opportunity.overallScore },
      onDisappear: 'EXPIRED' as const,
      refs: {},
    }));
  }

  // Sprint 11 CRM attention (overdue tasks / next actions / due reminders).
  private async crmFollowUps(sys: Actor): Promise<Signal[]> {
    const r = await this.crm.attention(sys, { scope: 'all' });
    return r.items
      .filter((i) =>
        ['OVERDUE_TASK', 'OVERDUE_NEXT_ACTION', 'REMINDER_DUE'].includes(
          i.kind,
        ),
      )
      .map((i) => ({
        trigger: 'CRM_TASK_OVERDUE' as const,
        dedupeKey:
          `crm:${i.kind}:${i.leadId}:${i.title}:${i.dueAt ?? ''}`.slice(0, 300),
        sourceEventId: `lead:${i.leadId}`,
        module: 'CRM' as const,
        entityType: 'BuyerLead',
        entityId: i.leadId,
        title: `${i.buyerName}: ${i.title}`,
        description: i.detail,
        severity: 'WARNING' as const,
        dueAt: i.dueAt ? new Date(i.dueAt) : null,
        context: [
          { label: 'Buyer', value: i.buyerName },
          { label: 'Stage', value: i.stage.toLowerCase() },
          ...(i.owner ? [{ label: 'Owner', value: i.owner.name }] : []),
        ],
        links: [{ label: 'Open CRM lead', href: `/crm/leads/${i.leadId}` }],
        suggestedAction: 'Complete the follow-up or reschedule it in CRM.',
        requiredPermission: 'crm.view',
        factors: {
          severity: 'WARNING' as const,
          overdueDays: i.dueAt
            ? Math.floor((Date.now() - new Date(i.dueAt).getTime()) / DAY)
            : null,
        },
        metrics: { severity: 'WARNING' as const },
        onDisappear: 'COMPLETED' as const,
        refs: { crmLeadId: i.leadId },
      }));
  }

  /** Sample follow-up: Sprint 22 owns the sample workflow; only real DELIVERED records trigger (none exist yet). */
  private async samples(org: string): Promise<Signal[]> {
    const rows = await this.prisma.sampleRequest.findMany({
      where: { organizationId: org, status: 'DELIVERED' },
    });
    return rows.map((s) => ({
      trigger: 'SAMPLE_DELIVERED' as const,
      dedupeKey: `sample:${s.id}`,
      sourceEventId: `sample:${s.id}`,
      module: 'INQUIRIES' as const,
      entityType: 'SampleRequest',
      entityId: s.id,
      title: `Sample delivered — ${s.productName ?? 'product'}`,
      description: 'Ask the buyer for feedback.',
      severity: 'INFO' as const,
      dueAt: null,
      context: [],
      links: [{ label: 'Open inquiry', href: `/inquiries/${s.inquiryId}` }],
      suggestedAction: 'Follow up for sample feedback.',
      requiredPermission: 'inquiries.view',
      factors: { severity: 'INFO' as const },
      metrics: { severity: 'INFO' as const },
      onDisappear: 'COMPLETED' as const,
      refs: { buyerId: s.buyerCompanyId },
    }));
  }
}
