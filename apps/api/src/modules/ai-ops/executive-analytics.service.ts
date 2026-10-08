import { BadRequestException, Injectable } from '@nestjs/common';
import {
  roleHasPermission,
  type AnalyticsSection,
  type ExecutiveOverview,
  type KpiCard,
  type MetricSource,
  type Permission,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from '../commercial/commercial-core.service';
import { CrmService } from '../crm/crm.service';
import { AnalyticsService as FinanceAnalyticsService } from '../finance/analytics.service';
import { FinanceCoreService } from '../finance/finance-core.service';
import { ProfitabilityService } from '../finance/profitability.service';
import { ReceivablesService } from '../finance/receivables.service';
import { ShipmentsService } from '../logistics/shipments.service';
import { OutreachService } from '../outreach/outreach.service';
import { ActionCenterService } from './action-center.service';
import { rangeFor } from './ops-rules';

export interface RangeQuery {
  range?: string;
  from?: string;
  to?: string;
}

const n = (v: string | null | undefined) =>
  v === null || v === undefined ? 0 : Number(v);
const fmt = (v: number) =>
  v.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Executive analytics = query-time composition of existing module services
 * (finance analytics, receivables, shipments, CRM, outreach). Nothing is
 * re-derived here; results are not cached yet (architected for a future
 * summary table — each section is an independent function of org + range).
 */
@Injectable()
export class ExecutiveAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fin: FinanceCoreService,
    private readonly financeAnalytics: FinanceAnalyticsService,
    private readonly receivables: ReceivablesService,
    private readonly profitability: ProfitabilityService,
    private readonly shipments: ShipmentsService,
    private readonly crm: CrmService,
    private readonly outreach: OutreachService,
    private readonly actions: ActionCenterService,
  ) {}

  range(q: RangeQuery) {
    try {
      return rangeFor(q.range, q.from, q.to);
    } catch {
      throw new BadRequestException(
        'The start date must be before the end date.',
      );
    }
  }
  private fq(q: RangeQuery, includeInProgress = false) {
    const r = this.range(q);
    return {
      range: 'custom',
      from: r.from,
      to: r.to,
      includeInProgress: includeInProgress ? 'true' : 'false',
    };
  }
  private src(
    source: string,
    q: RangeQuery,
    freshness: string | null = null,
    note: string | null = null,
  ): MetricSource {
    const r = this.range(q);
    return {
      source,
      range: { from: r.from, to: r.to },
      calculatedAt: new Date().toISOString(),
      freshness,
      note,
    };
  }
  private can(a: Actor, p: Permission) {
    return roleHasPermission(a.role, p);
  }
  private section<T>(
    a: Actor,
    key: string,
    title: string,
    perm: Permission,
    source: MetricSource,
    fn: () => Promise<T | null>,
  ): Promise<AnalyticsSection<T>> {
    if (!this.can(a, perm))
      return Promise.resolve({
        key,
        title,
        available: false,
        unavailableReason: `Requires ${perm} permission for your role.`,
        source,
        metrics: null,
      });
    return fn().then(
      (data) => ({
        key,
        title,
        available: data !== null,
        unavailableReason:
          data === null ? 'Not enough data for this metric.' : null,
        source,
        metrics: data,
      }),
      (e: Error) => ({
        key,
        title,
        available: false,
        unavailableReason: `Source unavailable: ${e.message}`,
        source,
        metrics: null,
      }),
    );
  }

  // ---------------------------------------------------------------- sections

  revenue(a: Actor, q: RangeQuery) {
    return this.section(
      a,
      'revenue',
      'Revenue',
      'profitability.view',
      this.src(
        'Sprint 19 shipment profitability (finalized snapshots; in-progress shown separately)',
        q,
      ),
      async () => {
        const [fin, all, products, countries] = await Promise.all([
          this.financeAnalytics.buyers(a, this.fq(q)),
          this.financeAnalytics.buyers(a, this.fq(q, true)),
          this.financeAnalytics.products(a, this.fq(q)),
          this.financeAnalytics.countries(a, this.fq(q)),
        ]);
        const sum = (rows: { revenue: string }[]) =>
          rows.reduce((s, r) => s + n(r.revenue), 0);
        const profit = (rows: { grossProfit: string }[]) =>
          rows.reduce((s, r) => s + n(r.grossProfit), 0);
        const finRev = sum(fin.rows);
        const allRev = sum(all.rows);
        return {
          reportingCurrency: fin.meta.reportingCurrency,
          finalized: {
            revenue: finRev.toFixed(2),
            profit: profit(fin.rows).toFixed(2),
            shipments: fin.meta.finalizedCount,
          },
          inProgress: {
            revenue: (allRev - finRev).toFixed(2),
            profit: (profit(all.rows) - profit(fin.rows)).toFixed(2),
            shipments: all.meta.inProgressCount,
            label: 'In progress — not finalized; may change',
          },
          trend: fin.trend.map((t) => ({
            label: t.period,
            value: n(t.revenue),
            display: fmt(n(t.revenue)),
          })),
          byBuyer: fin.rows.slice(0, 8).map((r) => ({
            label: r.buyer.name,
            value: n(r.revenue),
            display: fmt(n(r.revenue)),
            href: `/profitability?view=buyers`,
          })),
          byCountry: countries.rows.slice(0, 8).map((r) => ({
            label: r.country,
            value: n(r.revenue),
            display: fmt(n(r.revenue)),
          })),
          byProduct: products.rows.slice(0, 8).map((r) => ({
            label: r.product.name,
            value: n(r.revenue),
            display: fmt(n(r.revenue)),
          })),
          fxBasis:
            'Each shipment’s revenue is converted to the reporting currency with its receivable booking FX (else the latest saved FX snapshot); see shipment profitability for the rate used.',
          basis: fin.meta.basis,
        };
      },
    );
  }

  pipeline(a: Actor, q: RangeQuery) {
    return this.section(
      a,
      'pipeline',
      'CRM pipeline',
      'crm.view',
      this.src(
        'Sprint 11 CRM pipeline',
        q,
        null,
        'Values only where leads have an expected value; mixed currencies are not converted.',
      ),
      async () => {
        const p = await this.crm.pipeline(a, { perStage: 1 } as never);
        const r = this.range(q);
        const now = Date.now();
        const leads = await this.prisma.buyerLead.findMany({
          where: {
            organizationId: a.organizationId,
            stage: { notIn: ['WON', 'LOST'] },
          },
          select: { lastActivityAt: true },
        });
        const aging = [
          {
            label: '0–7 days',
            value: leads.filter(
              (l) => now - l.lastActivityAt.getTime() <= 7 * 864e5,
            ).length,
          },
          {
            label: '8–30 days',
            value: leads.filter(
              (l) =>
                now - l.lastActivityAt.getTime() > 7 * 864e5 &&
                now - l.lastActivityAt.getTime() <= 30 * 864e5,
            ).length,
          },
          {
            label: '31+ days',
            value: leads.filter(
              (l) => now - l.lastActivityAt.getTime() > 30 * 864e5,
            ).length,
          },
        ];
        const created = await this.prisma.buyerLead.count({
          where: {
            organizationId: a.organizationId,
            createdAt: {
              gte: new Date(r.from),
              lte: new Date(`${r.to}T23:59:59Z`),
            },
          },
        });
        const won = await this.prisma.buyerLead.count({
          where: {
            organizationId: a.organizationId,
            stage: 'WON',
            stageChangedAt: {
              gte: new Date(r.from),
              lte: new Date(`${r.to}T23:59:59Z`),
            },
          },
        });
        return {
          stages: p.columns.map((c) => ({
            label: c.stage,
            value: c.count,
            display: `${c.count}${c.totalExpectedValue ? ` · ${c.currency ?? ''} ${fmt(c.totalExpectedValue)}${c.mixedCurrency ? ' (mixed currencies excluded)' : ''}` : ''}`,
          })),
          metrics: p.metrics,
          aging: aging.map((x) => ({ ...x, display: String(x.value) })),
          createdInRange: created,
          wonInRange: won,
          conversion:
            p.metrics.openLeads + won > 0
              ? `${((won / Math.max(1, created)) * 100).toFixed(1)}% of leads created in range were won`
              : null,
        };
      },
    );
  }

  markets(a: Actor, q: RangeQuery) {
    return this.section(
      a,
      'markets',
      'Markets',
      'profitability.view',
      this.src('Sprint 19 country profitability (shipment destination)', q),
      async () => {
        const r = this.range(q);
        const [cur, prev] = await Promise.all([
          this.financeAnalytics.countries(a, this.fq(q)),
          this.financeAnalytics.countries(a, {
            range: 'custom',
            from: r.previous.from,
            to: r.previous.to,
            includeInProgress: 'false',
          }),
        ]);
        const orders = await this.prisma.shipment.groupBy({
          by: ['destinationCountry'],
          where: {
            organizationId: a.organizationId,
            status: { not: 'CANCELLED' },
            createdAt: {
              gte: new Date(r.from),
              lte: new Date(`${r.to}T23:59:59Z`),
            },
          },
          _count: true,
        });
        return {
          rows: cur.rows.map((c) => {
            const p = prev.rows.find((x) => x.country === c.country);
            return {
              ...c,
              shipmentsCreated:
                orders.find((o) => o.destinationCountry === c.country)
                  ?._count ?? 0,
              growthPercent:
                p && n(p.revenue) > 0
                  ? (
                      ((n(c.revenue) - n(p.revenue)) / n(p.revenue)) *
                      100
                    ).toFixed(1)
                  : null,
            };
          }),
          previousRange: r.previous,
          reportingCurrency: cur.meta.reportingCurrency,
        };
      },
    );
  }

  products(a: Actor, q: RangeQuery) {
    return this.section(
      a,
      'products',
      'Products',
      'profitability.view',
      this.src(
        'Sprint 19 product profitability (split by order-line value)',
        q,
      ),
      async () => {
        const p = await this.financeAnalytics.products(a, this.fq(q));
        return { rows: p.rows, reportingCurrency: p.meta.reportingCurrency };
      },
    );
  }

  buyers(a: Actor, q: RangeQuery) {
    return this.section(
      a,
      'buyers',
      'Buyer conversion',
      'crm.view',
      this.src(
        'Buyer discovery, CRM, quotations, buyer POs and shipments (record counts)',
        q,
        null,
        'Counts of buyers reaching each step (records created in range).',
      ),
      async () => {
        const org = a.organizationId;
        const r = this.range(q);
        const inRange = {
          gte: new Date(r.from),
          lte: new Date(`${r.to}T23:59:59Z`),
        };
        const leads = await this.prisma.buyerLead.findMany({
          where: { organizationId: org, createdAt: inRange },
          select: { buyerCompanyId: true, stage: true },
        });
        const order = [
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
        ];
        const atLeast = (s: string) =>
          new Set(
            leads
              .filter((l) => order.indexOf(l.stage) >= order.indexOf(s))
              .map((l) => l.buyerCompanyId),
          ).size;
        const [discovered, saved, quoted, po, shipped] = await Promise.all([
          this.prisma.organizationBuyer.count({
            where: { organizationId: org, createdAt: inRange },
          }),
          this.prisma.organizationBuyer.count({
            where: {
              organizationId: org,
              shortlisted: true,
              createdAt: inRange,
            },
          }),
          this.prisma.quotation.findMany({
            where: {
              organizationId: org,
              status: { notIn: ['DRAFT', 'CANCELLED'] },
              createdAt: inRange,
              buyerCompanyId: { not: null },
            },
            distinct: ['buyerCompanyId'],
            select: { buyerCompanyId: true },
          }),
          this.prisma.buyerPurchaseOrder.findMany({
            where: {
              organizationId: org,
              status: 'ACCEPTED',
              createdAt: inRange,
            },
            distinct: ['buyerCompanyId'],
            select: { buyerCompanyId: true },
          }),
          this.prisma.shipment.findMany({
            where: {
              organizationId: org,
              status: { not: 'CANCELLED' },
              createdAt: inRange,
            },
            distinct: ['buyerCompanyId'],
            select: { buyerCompanyId: true },
          }),
        ]);
        const steps = [
          ['Buyer discovered (viewed/saved)', discovered],
          ['Shortlisted', saved],
          ['In CRM', new Set(leads.map((l) => l.buyerCompanyId)).size],
          ['Contacted', atLeast('CONTACTED')],
          ['Replied', atLeast('REPLIED')],
          ['Qualified', atLeast('QUALIFIED')],
          ['Quotation sent', quoted.length],
          ['Buyer PO accepted', po.length],
          ['Shipment', shipped.length],
        ] as const;
        return {
          funnel: steps.map(([label, value]) => ({
            label,
            value,
            display: String(value),
          })),
        };
      },
    );
  }

  campaigns(a: Actor, q: RangeQuery) {
    return this.section(
      a,
      'campaigns',
      'Campaign performance',
      'outreach.view',
      this.src(
        'Sprint 12 outreach campaigns',
        q,
        null,
        'Delivered/opened appear only when the email provider reports them.',
      ),
      async () => {
        const r = this.range(q);
        const list = await this.outreach.list(a.organizationId, {
          page: 1,
          pageSize: 50,
        } as never);
        const rows = list.items.filter(
          (c) =>
            !c.launchedAt ||
            (c.launchedAt.slice(0, 10) >= r.from &&
              c.launchedAt.slice(0, 10) <= r.to) ||
            c.status === 'RUNNING',
        );
        const tot = (
          k: 'sent' | 'replied' | 'bounced' | 'interested' | 'converted',
        ) => rows.reduce((s, c) => s + (c.counts[k] ?? 0), 0);
        const measured = (k: 'delivered' | 'opened') =>
          rows.every((c) => c.counts[k] === null)
            ? null
            : rows.reduce((s, c) => s + (c.counts[k] ?? 0), 0);
        return {
          totals: {
            sent: tot('sent'),
            delivered: measured('delivered'),
            opened: measured('opened'),
            replied: tot('replied'),
            bounced: tot('bounced'),
            interested: tot('interested'),
            converted: tot('converted'),
          },
          campaigns: rows.slice(0, 20).map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            counts: c.counts,
            href: `/outreach/campaigns/${c.id}`,
          })),
        };
      },
    );
  }

  shipmentsSection(a: Actor, q: RangeQuery) {
    return this.section(
      a,
      'shipments',
      'Shipments',
      'logistics.view',
      this.src(
        'Sprint 18 shipments (lifecycle and health from the logistics service)',
        q,
        'Tracking is manual/forwarder-reported unless a provider is configured.',
      ),
      async () => {
        const o = await this.shipments.overview(a);
        const byStatus = new Map<string, number>();
        for (let page = 1; page <= 20; page++) {
          const l = await this.shipments.list(a, {
            page,
            pageSize: 50,
          } as never);
          for (const s of l.items)
            byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
          if (page >= l.meta.totalPages) break;
        }
        const ex = await this.shipments.exceptions(a, {
          status: 'OPEN',
          pageSize: 50,
        } as never);
        return {
          overview: o,
          byStatus: [...byStatus.entries()].map(([label, value]) => ({
            label,
            value,
            display: String(value),
          })),
          delivered: byStatus.get('DELIVERED') ?? 0,
          inTransit:
            (byStatus.get('IN_TRANSIT') ?? 0) +
            (byStatus.get('TRANSSHIPMENT') ?? 0),
          openExceptions: {
            total: ex.meta.totalItems,
            critical: ex.items.filter((e) => e.severity === 'CRITICAL').length,
          },
        };
      },
    );
  }

  receivablesSection(a: Actor, q: RangeQuery) {
    return this.section(
      a,
      'receivables',
      'Payment aging',
      'finance.view',
      this.src('Sprint 19 receivables (read-time due/overdue status)', q),
      async () => {
        const r = this.range(q);
        const [aging, ov] = await Promise.all([
          this.receivables.aging(a, 'currency'),
          this.receivables.overview(
            a,
            { range: 'custom', from: r.from, to: r.to } as never,
            {
              profitability: {
                finalized: 0,
                inProgress: 0,
                totalProfit: null,
                averageMargin: null,
              },
              reorderDue: 0,
            },
          ),
        ]);
        return {
          aging,
          byCurrency: ov.byCurrency,
          normalized: ov.normalized,
          reportingCurrency: ov.reportingCurrency,
          counts: ov.counts,
        };
      },
    );
  }

  profitabilitySection(a: Actor, q: RangeQuery) {
    return this.section(
      a,
      'profitability',
      'Margins & profitability',
      'profitability.view',
      this.src(
        'Sprint 19 shipment profitability',
        q,
        null,
        'Finalized and in-progress figures are reported separately.',
      ),
      async () => {
        const r = this.range(q);
        const list = await this.profitability.list(a, {
          range: 'custom',
          from: r.from,
          to: r.to,
          pageSize: 100,
        } as never);
        const group = (
          pred: (s: (typeof list.items)[number]) => boolean,
          label: string,
        ) => {
          const rows = list.items.filter(pred);
          const rev = rows.reduce((s, x) => s + n(x.revenue), 0);
          const prof = rows.reduce((s, x) => s + n(x.actualProfit), 0);
          const est = rows.reduce((s, x) => s + n(x.estimatedProfit), 0);
          return {
            label,
            shipments: rows.length,
            revenue: rev.toFixed(2),
            cost: (rev - prof).toFixed(2),
            profit: prof.toFixed(2),
            marginPercent: rev ? ((prof / rev) * 100).toFixed(2) : null,
            profitVariance: (prof - est).toFixed(2),
          };
        };
        return {
          finalized: group(
            (s) => s.status === 'FINALIZED',
            'Finalized (immutable)',
          ),
          inProgress: group(
            (s) => s.status === 'ACTUAL_IN_PROGRESS',
            'Actuals complete — not finalized',
          ),
          incomplete: list.items.filter(
            (s) => s.status === 'INCOMPLETE' || s.status === 'ESTIMATED',
          ).length,
          reportingCurrency:
            list.items[0]?.reportingCurrency ??
            (await this.fin.settings(a.organizationId)).reportingCurrency,
        };
      },
    );
  }

  opportunities(a: Actor, q: RangeQuery) {
    return this.section(
      a,
      'opportunities',
      'Opportunity trends',
      'opportunities.view',
      this.src(
        'Sprint 4/6/9 opportunities, score snapshots and trade-data sources',
        q,
        null,
        'Score history is observed data, not a forecast.',
      ),
      async () => {
        const org = a.organizationId;
        const r = this.range(q);
        const saved = await this.prisma.savedOpportunity.findMany({
          where: { organizationId: org },
          include: {
            opportunity: {
              select: {
                id: true,
                productName: true,
                destinationCountryCode: true,
                overallScore: true,
                updatedAt: true,
              },
            },
          },
        });
        const snaps = saved.length
          ? await this.prisma.opportunityScoreSnapshot.findMany({
              where: {
                opportunityId: { in: saved.map((s) => s.opportunityId) },
                capturedAt: {
                  gte: new Date(r.from),
                  lte: new Date(`${r.to}T23:59:59Z`),
                },
              },
              select: { overallScore: true, capturedAt: true },
            })
          : [];
        const months = new Map<string, number[]>();
        for (const s of snaps) {
          const k = s.capturedAt.toISOString().slice(0, 7);
          months.set(k, [...(months.get(k) ?? []), s.overallScore]);
        }
        const sources = await this.prisma.tradeDataSource.findMany({
          where: { lastSuccessfulRunAt: { not: null } },
          select: {
            name: true,
            lastSuccessfulRunAt: true,
            latestPeriodEnd: true,
          },
          orderBy: { lastSuccessfulRunAt: 'desc' },
          take: 5,
        });
        const count = (k: 'productName' | 'destinationCountryCode') => {
          const m = new Map<string, number>();
          for (const s of saved)
            m.set(s.opportunity[k], (m.get(s.opportunity[k]) ?? 0) + 1);
          return [...m.entries()]
            .sort((x, y) => y[1] - x[1])
            .slice(0, 5)
            .map(([label, value]) => ({
              label,
              value,
              display: String(value),
            }));
        };
        return {
          saved: saved.length,
          savedInRange: saved.filter(
            (s) =>
              s.createdAt.toISOString().slice(0, 10) >= r.from &&
              s.createdAt.toISOString().slice(0, 10) <= r.to,
          ).length,
          averageScoreTrend: [...months.entries()]
            .sort()
            .map(([label, xs]) => ({
              label,
              value: Math.round(xs.reduce((s, x) => s + x, 0) / xs.length),
              display: String(
                Math.round(xs.reduce((s, x) => s + x, 0) / xs.length),
              ),
            })),
          topProducts: count('productName'),
          topCountries: count('destinationCountryCode'),
          top: saved
            .sort(
              (x, y) => y.opportunity.overallScore - x.opportunity.overallScore,
            )
            .slice(0, 5)
            .map((s) => ({
              label: `${s.opportunity.productName} → ${s.opportunity.destinationCountryCode}`,
              value: s.opportunity.overallScore,
              display: String(s.opportunity.overallScore),
              href: `/opportunities/${s.opportunity.id}`,
            })),
          freshness: sources.map((s) => ({
            source: s.name,
            lastRunAt: s.lastSuccessfulRunAt!.toISOString(),
            latestPeriodEnd:
              s.latestPeriodEnd?.toISOString().slice(0, 10) ?? null,
          })),
        };
      },
    );
  }

  // ---------------------------------------------------------------- overview

  async overview(a: Actor, q: RangeQuery): Promise<ExecutiveOverview> {
    const r = this.range(q);
    const rep = (await this.fin.settings(a.organizationId)).reportingCurrency;
    const [rev, rec, pipe, ship] = await Promise.all([
      this.revenue(a, q),
      this.receivablesSection(a, q),
      this.pipeline(a, q),
      this.shipmentsSection(a, q),
    ]);
    const cards: KpiCard[] = [];
    const card = (
      key: string,
      label: string,
      value: string | null,
      currency: string | null,
      href: string | null,
      source: MetricSource,
      note: string | null = null,
    ) => cards.push({ key, label, value, currency, href, source, note });
    if (rev.metrics) {
      card(
        'revenue',
        'Revenue (finalized)',
        rev.metrics.finalized.revenue,
        rep,
        '/profitability?view=buyers',
        rev.source,
        n(rev.metrics.inProgress.revenue)
          ? `+ ${rep} ${fmt(n(rev.metrics.inProgress.revenue))} in progress (not finalized)`
          : null,
      );
      card(
        'gross_profit',
        'Gross profit (finalized)',
        rev.metrics.finalized.profit,
        rep,
        '/profitability',
        rev.source,
      );
    }
    if (rec.metrics) {
      card(
        'outstanding',
        'Outstanding receivables',
        rec.metrics.normalized.outstanding,
        rep,
        '/finance/receivables?status=OPEN',
        rec.source,
        rec.metrics.normalized.missingFx.length
          ? `No FX for ${rec.metrics.normalized.missingFx.join(', ')} — see per-currency totals`
          : rec.metrics.normalized.basis,
      );
      card(
        'overdue',
        'Overdue',
        rec.metrics.normalized.overdue,
        rep,
        '/finance/receivables?status=OVERDUE',
        rec.source,
      );
    }
    if (pipe.metrics)
      card(
        'pipeline',
        'Active pipeline',
        String(pipe.metrics.metrics.openLeads),
        null,
        '/crm',
        pipe.source,
        pipe.metrics.metrics.pipelineValue
          ? `${pipe.metrics.metrics.pipelineCurrency ?? ''} ${fmt(pipe.metrics.metrics.pipelineValue)} expected value`
          : 'No expected values recorded',
      );
    if (ship.metrics) {
      card(
        'active_shipments',
        'Active shipments',
        String(ship.metrics.overview.active),
        null,
        '/shipments',
        ship.source,
      );
      card(
        'delayed_shipments',
        'Delayed shipments',
        String(ship.metrics.overview.delayed),
        null,
        '/shipments?health=DELAYED',
        ship.source,
      );
    }
    if (this.can(a, 'action_center.view')) {
      const s = await this.actions.summary(a, null);
      card(
        'critical_actions',
        'Open critical actions',
        String(s.critical),
        null,
        '/action-center?priority=CRITICAL',
        this.src('Action Center', q),
      );
    }
    return {
      reportingCurrency: rep,
      range: { key: r.key, from: r.from, to: r.to },
      cards,
      insights: await this.insights(
        a,
        q,
        rev.metrics,
        rec.metrics,
        ship.metrics,
      ),
      fxBasis: [rev.metrics?.fxBasis, rec.metrics?.normalized.basis].filter(
        (x): x is string => !!x,
      ),
      calculatedAt: new Date().toISOString(),
      sections: [
        'revenue',
        'pipeline',
        'markets',
        'products',
        'buyers',
        'campaigns',
        'shipments',
        'receivables',
        'profitability',
        'opportunities',
      ].filter((k) =>
        this.can(
          a,
          (
            {
              revenue: 'profitability.view',
              markets: 'profitability.view',
              products: 'profitability.view',
              profitability: 'profitability.view',
              pipeline: 'crm.view',
              buyers: 'crm.view',
              campaigns: 'outreach.view',
              shipments: 'logistics.view',
              receivables: 'finance.view',
              opportunities: 'opportunities.view',
            } as Record<string, Permission>
          )[k],
        ),
      ),
    };
  }

  /** Deterministic insight candidates built only from the computed figures above. */
  private async insights(
    a: Actor,
    q: RangeQuery,
    rev: Awaited<ReturnType<ExecutiveAnalyticsService['revenue']>>['metrics'],
    rec: Awaited<
      ReturnType<ExecutiveAnalyticsService['receivablesSection']>
    >['metrics'],
    ship: Awaited<
      ReturnType<ExecutiveAnalyticsService['shipmentsSection']>
    >['metrics'],
  ) {
    const out: { text: string; source: string; href: string | null }[] = [];
    if (rev?.byCountry[0])
      out.push({
        text: `${rev.byCountry[0].label} generated the highest finalized revenue in this period (${rev.reportingCurrency} ${rev.byCountry[0].display}).`,
        source: 'Profitability',
        href: '/profitability?view=countries',
      });
    if (rev && this.can(a, 'profitability.view')) {
      const r = this.range(q);
      const prev = await this.financeAnalytics.buyers(a, {
        range: 'custom',
        from: r.previous.from,
        to: r.previous.to,
        includeInProgress: 'false',
      } as never);
      const m = (rows: { revenue: string; grossProfit: string }[]) => {
        const rv = rows.reduce((s, x) => s + n(x.revenue), 0);
        return rv
          ? (rows.reduce((s, x) => s + n(x.grossProfit), 0) / rv) * 100
          : null;
      };
      const cur = n(rev.finalized.revenue)
        ? (n(rev.finalized.profit) / n(rev.finalized.revenue)) * 100
        : null;
      const pm = m(prev.rows);
      if (cur !== null && pm !== null && Math.abs(cur - pm) >= 1)
        out.push({
          text: `Finalized margin ${cur > pm ? 'improved' : 'declined'} from ${pm.toFixed(1)}% to ${cur.toFixed(1)}% versus the previous period.`,
          source: 'Profitability',
          href: '/profitability',
        });
    }
    if (rec?.byCurrency.some((c) => n(c.overdue) > 0)) {
      const aging = rec.aging.filter((x) => n(x.total) > 0);
      const over = rec.byCurrency
        .filter((c) => n(c.overdue) > 0)
        .map((c) => `${c.currency} ${fmt(n(c.overdue))}`)
        .join(', ');
      out.push({
        text: `Overdue receivables: ${over}${aging.some((x) => n(x.d90plus) > 0) ? ' — part is more than 90 days overdue' : ''}.`,
        source: 'Receivables',
        href: '/finance/receivables?status=OVERDUE',
      });
    }
    if (ship && ship.overview.delayed > 0)
      out.push({
        text: `${ship.overview.delayed} shipment(s) are delayed.`,
        source: 'Shipments',
        href: '/shipments?health=DELAYED',
      });
    if (this.can(a, 'profitability.view')) {
      const c = await this.financeAnalytics.countries(a, this.fq(q));
      out.push(
        ...c.insights.map((text) => ({
          text,
          source: 'Profitability',
          href: '/profitability?view=countries',
        })),
      );
    }
    return out;
  }
}
