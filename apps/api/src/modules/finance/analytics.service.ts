import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AnalyticsMeta,
  BuyerProfitability,
  CountryProfitability,
  FinanceBuyerSummary,
  ProductProfitability,
  ProfitabilityAnalytics,
  Ranking,
  ReorderReminderStatus,
  ReorderReminderView,
  RepeatBusinessSignal,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../commercial/commercial-core.service';
import { D, type Dec } from '../costing/costing-calculator';
import { FinanceCoreService } from './finance-core.service';
import {
  addDays,
  dayDiff,
  isoDay,
  m2,
  marginPct,
  reorderMessage,
  repeatSignal,
} from './finance-rules';
import type { ListQueryDto } from './finance.dto';
import {
  ProfitabilityService,
  type Computation,
} from './profitability.service';
import { ReceivablesService } from './receivables.service';

interface Row {
  c: Computation;
  finalized: boolean;
  revenue: Dec;
  profit: Dec;
  cost: Dec;
  poId: string;
}

const month = (iso: string) => iso.slice(0, 7);

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fin: FinanceCoreService,
    private readonly profit: ProfitabilityService,
    private readonly receivables: ReceivablesService,
    private readonly audit: AuditService,
  ) {}

  /** Finalized profitability (immutable snapshots); in-progress only when asked, and labelled. */
  private async rows(a: Actor, q: ListQueryDto) {
    const org = a.organizationId;
    const range = this.fin.range({
      range: q.range ?? 'year',
      from: q.from,
      to: q.to,
    });
    const include = q.includeInProgress === 'true';
    const ships = await this.prisma.shipment.findMany({
      where: { organizationId: org, status: { not: 'CANCELLED' } },
      select: { id: true },
    });
    const rows: Row[] = [];
    let finalizedCount = 0;
    let inProgressCount = 0;
    for (const s of ships) {
      const { c, finalized } = await this.profit.current(org, s.id);
      const d = new Date(c.periodDate);
      if (d < range.from || d >= range.to) continue;
      if (!c.revenue || !c.totals.finalProfit) continue;
      if (!finalized && !include) continue;
      if (finalized) finalizedCount++;
      else inProgressCount++;
      const revenue = new D(c.revenue);
      const profit = new D(c.totals.finalProfit);
      rows.push({
        c,
        finalized,
        revenue,
        profit,
        cost: revenue.minus(profit),
        poId: c.purchaseOrder.id,
      });
    }
    const settings = await this.fin.settings(org);
    const meta: AnalyticsMeta = {
      range: range.label,
      reportingCurrency: settings.reportingCurrency,
      includeInProgress: include,
      finalizedCount,
      inProgressCount,
      calculatedAt: new Date().toISOString(),
      basis: include
        ? 'Finalized shipment profitability plus in-progress shipments with complete revenue (in-progress figures may change).'
        : 'Finalized shipment profitability only (immutable snapshots).',
    };
    return { rows, meta, range };
  }

  private trend(rows: Row[]) {
    const m = new Map<string, { revenue: Dec; profit: Dec; n: number }>();
    for (const r of rows) {
      const k = month(r.c.periodDate);
      const v = m.get(k) ?? { revenue: new D(0), profit: new D(0), n: 0 };
      v.revenue = v.revenue.plus(r.revenue);
      v.profit = v.profit.plus(r.profit);
      v.n++;
      m.set(k, v);
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, v]) => ({
        period,
        revenue: m2(v.revenue),
        profit: m2(v.profit),
        marginPercent: marginPct(v.profit, v.revenue),
        shipments: v.n,
      }));
  }

  private rank<T>(
    key: string,
    label: string,
    explanation: string,
    rows: T[],
    pick: (r: T) => {
      id: string | null;
      name: string;
      value: Dec | number | null;
    },
  ): Ranking {
    return {
      key,
      label,
      explanation,
      rows: rows
        .map(pick)
        .filter((x) => x.value !== null)
        .sort((a, b) => new D(b.value!).cmp(new D(a.value!)))
        .slice(0, 5)
        .map((x) => ({
          id: x.id,
          name: x.name,
          value:
            typeof x.value === 'number' ? String(x.value) : m2(x.value as Dec),
        })),
    };
  }

  /** Accepted orders per buyer (all time) — repeat behaviour is order-based. */
  private async orders(org: string) {
    return this.prisma.buyerPurchaseOrder.findMany({
      where: { organizationId: org, status: 'ACCEPTED' },
      include: { items: true },
      orderBy: { poDate: 'asc' },
    });
  }

  /** Receivable exposure per buyer/country normalized to the reporting currency (saved FX snapshots). */
  private async exposure(a: Actor) {
    const org = a.organizationId;
    const rep = (await this.fin.settings(org)).reportingCurrency;
    const { list } = await this.receivables.computedAll(org, {
      state: { not: 'CANCELLED' },
    });
    const rates = new Map<string, Dec | null>();
    const rate = async (c: string) => {
      if (!rates.has(c))
        rates.set(c, (await this.fin.latestRate(org, c, rep))?.rate ?? null);
      return rates.get(c)!;
    };
    const out: {
      buyerId: string;
      country: string | null;
      paid: Dec | null;
      outstanding: Dec | null;
      overdue: Dec | null;
      delays: number[];
    }[] = [];
    for (const c of list) {
      const fx = await rate(c.r.currency);
      const overdue = c.installments
        .filter((i) => i.status === 'OVERDUE')
        .reduce((s, i) => s.plus(i.row.outstandingAmount.toString()), new D(0));
      const delays: number[] = [];
      for (const p of c.r.payments) {
        if (p.status !== 'RECORDED') continue;
        for (const al of p.allocations as { installmentId: string }[]) {
          const i = c.installments.find((x) => x.row.id === al.installmentId);
          if (i?.dueDate)
            delays.push(Math.max(0, dayDiff(i.dueDate, p.receivedAt)));
        }
      }
      out.push({
        buyerId: c.r.buyerCompanyId,
        country: c.r.destinationCountry,
        paid: fx ? new D(c.r.paidAmount.toString()).mul(fx) : null,
        outstanding: fx
          ? c.r.state === 'OPEN'
            ? new D(c.r.outstandingAmount.toString()).mul(fx)
            : new D(0)
          : null,
        overdue: fx
          ? c.r.state === 'OPEN'
            ? overdue.mul(fx)
            : new D(0)
          : null,
        delays,
      });
    }
    return out;
  }

  private sumNullable(xs: (Dec | null)[]) {
    if (xs.some((x) => x === null)) return null;
    return xs.reduce((s: Dec, x) => s.plus(x!), new D(0));
  }

  // ---------------------------------------------------------------- buyers

  async buyers(
    a: Actor,
    q: ListQueryDto,
  ): Promise<ProfitabilityAnalytics<BuyerProfitability>> {
    const org = a.organizationId;
    const { rows, meta } = await this.rows(a, q);
    const orders = await this.orders(org);
    const exp = await this.exposure(a);
    const buyerIds = [...new Set(rows.map((r) => r.c.buyer.id))];
    const buyers = await this.prisma.buyerCompany.findMany({
      where: { id: { in: buyerIds } },
      select: { id: true, canonicalName: true, countryCode: true },
    });
    const out: BuyerProfitability[] = buyerIds.map((id) => {
      const rs = rows.filter((r) => r.c.buyer.id === id);
      const revenue = rs.reduce((s, r) => s.plus(r.revenue), new D(0));
      const profit = rs.reduce((s, r) => s.plus(r.profit), new D(0));
      const e = exp.filter((x) => x.buyerId === id);
      const pos = new Set(rs.map((r) => r.poId));
      const nOrders = orders.filter((o) => o.buyerCompanyId === id).length;
      const b = buyers.find((x) => x.id === id);
      return {
        buyer: {
          id,
          name: b?.canonicalName ?? rs[0].c.buyer.name,
          country: b?.countryCode ?? null,
        },
        revenue: m2(revenue),
        totalCost: m2(revenue.minus(profit)),
        grossProfit: m2(profit),
        marginPercent: marginPct(profit, revenue),
        shipments: rs.length,
        orders: nOrders,
        paid: this.sumNullable(e.map((x) => x.paid))?.toFixed(2) ?? null,
        outstanding:
          this.sumNullable(e.map((x) => x.outstanding))?.toFixed(2) ?? null,
        overdue: this.sumNullable(e.map((x) => x.overdue))?.toFixed(2) ?? null,
        averageOrderValue: pos.size ? m2(revenue.div(pos.size)) : null,
        repeatOrders: Math.max(0, nOrders - 1),
        historicalCustomerValue: m2(profit),
      };
    });
    const rankings: Ranking[] = [
      this.rank(
        'revenue',
        'Best by revenue',
        'Total revenue in range.',
        out,
        (r) => ({
          id: r.buyer.id,
          name: r.buyer.name,
          value: new D(r.revenue),
        }),
      ),
      this.rank(
        'profit',
        'Best by profit',
        'Total final profit in range.',
        out,
        (r) => ({
          id: r.buyer.id,
          name: r.buyer.name,
          value: new D(r.grossProfit),
        }),
      ),
      this.rank(
        'margin',
        'Best by margin',
        'Profit ÷ revenue; buyers with at least one shipment.',
        out,
        (r) => ({
          id: r.buyer.id,
          name: r.buyer.name,
          value: r.marginPercent ? new D(r.marginPercent) : null,
        }),
      ),
      this.rank(
        'repeat',
        'Best repeat behaviour',
        'Number of repeat accepted orders (all time).',
        out,
        (r) => ({ id: r.buyer.id, name: r.buyer.name, value: r.repeatOrders }),
      ),
      this.rank(
        'risk',
        'Highest outstanding risk',
        'Overdue receivables (reporting currency).',
        out,
        (r) => ({
          id: r.buyer.id,
          name: r.buyer.name,
          value: r.overdue && new D(r.overdue).gt(0) ? new D(r.overdue) : null,
        }),
      ),
    ];
    return {
      meta,
      rows: out.sort((x, y) => new D(y.revenue).cmp(x.revenue)),
      rankings,
      trend: this.trend(rows),
      insights: this.insights(rows),
    };
  }

  // ---------------------------------------------------------------- products

  async products(
    a: Actor,
    q: ListQueryDto,
  ): Promise<ProfitabilityAnalytics<ProductProfitability>> {
    const { rows, meta } = await this.rows(a, q);
    const orders = await this.orders(a.organizationId);
    const m = new Map<
      string,
      {
        id: string | null;
        name: string;
        revenue: Dec;
        profit: Dec;
        vol: Map<string, Dec>;
        ships: Set<string>;
        pos: Set<string>;
        trend: Map<string, { r: Dec; p: Dec }>;
      }
    >();
    for (const r of rows)
      for (const p of r.c.products) {
        const key = p.productId ?? `name:${p.name.toLowerCase()}`;
        const v = m.get(key) ?? {
          id: p.productId,
          name: p.name,
          revenue: new D(0),
          profit: new D(0),
          vol: new Map(),
          ships: new Set(),
          pos: new Set(),
          trend: new Map(),
        };
        const share = new D(p.share);
        const rv = r.revenue.mul(share);
        const pf = r.profit.mul(share);
        v.revenue = v.revenue.plus(rv);
        v.profit = v.profit.plus(pf);
        v.vol.set(p.unit, (v.vol.get(p.unit) ?? new D(0)).plus(p.quantity));
        v.ships.add(r.c.shipmentId);
        v.pos.add(r.poId);
        const t = v.trend.get(month(r.c.periodDate)) ?? {
          r: new D(0),
          p: new D(0),
        };
        v.trend.set(month(r.c.periodDate), {
          r: t.r.plus(rv),
          p: t.p.plus(pf),
        });
        m.set(key, v);
      }
    const out: ProductProfitability[] = [...m.values()].map((v) => {
      const buyersWith = new Map<string, number>();
      for (const o of orders)
        if (
          o.items.some((i) =>
            v.id
              ? i.productId === v.id
              : i.description.toLowerCase() === v.name.toLowerCase(),
          )
        )
          buyersWith.set(
            o.buyerCompanyId,
            (buyersWith.get(o.buyerCompanyId) ?? 0) + 1,
          );
      return {
        product: { id: v.id, name: v.name },
        revenue: m2(v.revenue),
        volume: [...v.vol.entries()].map(([unit, quantity]) => ({
          unit,
          quantity: quantity.toDecimalPlaces(3).toString(),
        })),
        totalCost: m2(v.revenue.minus(v.profit)),
        profit: m2(v.profit),
        marginPercent: marginPct(v.profit, v.revenue),
        shipments: v.ships.size,
        orders: v.pos.size,
        repeatBuyers: [...buyersWith.values()].filter((n) => n >= 2).length,
        trend: [...v.trend.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([period, t]) => ({
            period,
            marginPercent: marginPct(t.p, t.r),
          })),
      };
    });
    const rankings = [
      this.rank(
        'revenue',
        'Highest revenue',
        'Revenue allocated by order-line value.',
        out,
        (r) => ({
          id: r.product.id,
          name: r.product.name,
          value: new D(r.revenue),
        }),
      ),
      this.rank(
        'profit',
        'Highest profit',
        'Profit allocated by order-line value share.',
        out,
        (r) => ({
          id: r.product.id,
          name: r.product.name,
          value: new D(r.profit),
        }),
      ),
      this.rank('margin', 'Highest margin', 'Profit ÷ revenue.', out, (r) => ({
        id: r.product.id,
        name: r.product.name,
        value: r.marginPercent ? new D(r.marginPercent) : null,
      })),
      this.rank(
        'repeat',
        'Strongest repeat orders',
        'Buyers who ordered the product in 2+ accepted orders.',
        out,
        (r) => ({
          id: r.product.id,
          name: r.product.name,
          value: r.repeatBuyers,
        }),
      ),
    ];
    return {
      meta: {
        ...meta,
        basis: `${meta.basis} Multi-product shipments are split by order-line value.`,
      },
      rows: out.sort((x, y) => new D(y.revenue).cmp(x.revenue)),
      rankings,
      trend: this.trend(rows),
      insights: this.insights(rows),
    };
  }

  // ---------------------------------------------------------------- countries

  async countries(
    a: Actor,
    q: ListQueryDto,
  ): Promise<ProfitabilityAnalytics<CountryProfitability>> {
    const { rows, meta } = await this.rows(a, q);
    const orders = await this.orders(a.organizationId);
    const exp = await this.exposure(a);
    const by = new Map<string, Row[]>();
    // Destination market = shipment destination (never the buyer's HQ country).
    for (const r of rows) {
      const k = r.c.destinationCountry ?? 'UNKNOWN';
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    const out: CountryProfitability[] = [...by.entries()].map(
      ([country, rs]) => {
        const revenue = rs.reduce((s, r) => s.plus(r.revenue), new D(0));
        const profit = rs.reduce((s, r) => s.plus(r.profit), new D(0));
        const fr = rs
          .map((r) => r.c.freightReporting)
          .filter((x): x is string => !!x);
        const e = exp.filter((x) => x.country === country);
        const delays = e.flatMap((x) => x.delays);
        const buyers = [...new Set(rs.map((r) => r.c.buyer.id))];
        const repeaters = buyers.filter(
          (b) => orders.filter((o) => o.buyerCompanyId === b).length >= 2,
        );
        const intervals = buyers
          .map((b) => {
            const ds = orders
              .filter((o) => o.buyerCompanyId === b)
              .map((o) => o.poDate);
            return ds.length >= 2
              ? ds.slice(1).reduce((s, d, i) => s + dayDiff(ds[i], d), 0) /
                  (ds.length - 1)
              : null;
          })
          .filter((x): x is number => x !== null);
        return {
          country,
          revenue: m2(revenue),
          cost: m2(revenue.minus(profit)),
          profit: m2(profit),
          marginPercent: marginPct(profit, revenue),
          shipments: rs.length,
          averageFreightCost: fr.length
            ? m2(fr.reduce((s, x) => s.plus(x), new D(0)).div(fr.length))
            : null,
          averagePaymentDelayDays: delays.length
            ? (delays.reduce((s, x) => s + x, 0) / delays.length).toFixed(1)
            : null,
          repeatRatePercent: buyers.length
            ? ((repeaters.length / buyers.length) * 100).toFixed(1)
            : null,
          overdueExposure:
            this.sumNullable(e.map((x) => x.overdue))?.toFixed(2) ?? null,
          averageReorderDays: intervals.length
            ? (intervals.reduce((s, x) => s + x, 0) / intervals.length).toFixed(
                1,
              )
            : null,
        };
      },
    );
    const rankings = [
      this.rank(
        'revenue',
        'Highest revenue',
        'Revenue by shipment destination.',
        out,
        (r) => ({ id: r.country, name: r.country, value: new D(r.revenue) }),
      ),
      this.rank(
        'profit',
        'Highest profit',
        'Final profit by shipment destination.',
        out,
        (r) => ({ id: r.country, name: r.country, value: new D(r.profit) }),
      ),
      this.rank('margin', 'Highest margin', 'Profit ÷ revenue.', out, (r) => ({
        id: r.country,
        name: r.country,
        value: r.marginPercent ? new D(r.marginPercent) : null,
      })),
      {
        ...this.rank(
          'repeat',
          'Fastest repeat cycle',
          'Shortest average days between a buyer’s accepted orders.',
          out,
          (r) => ({
            id: r.country,
            name: r.country,
            value: r.averageReorderDays
              ? new D(r.averageReorderDays).neg()
              : null,
          }),
        ),
        rows: [] as Ranking['rows'],
      },
      this.rank(
        'overdue',
        'Highest overdue exposure',
        'Overdue receivables (reporting currency).',
        out,
        (r) => ({
          id: r.country,
          name: r.country,
          value:
            r.overdueExposure && new D(r.overdueExposure).gt(0)
              ? new D(r.overdueExposure)
              : null,
        }),
      ),
    ];
    rankings[3].rows = out
      .filter((r) => r.averageReorderDays)
      .sort(
        (x, y) => Number(x.averageReorderDays) - Number(y.averageReorderDays),
      )
      .slice(0, 5)
      .map((r) => ({
        id: r.country,
        name: r.country,
        value: `${r.averageReorderDays} days`,
      }));
    return {
      meta: {
        ...meta,
        basis: `${meta.basis} Countries are shipment destinations, not buyer head-office countries.`,
      },
      rows: out.sort((x, y) => new D(y.revenue).cmp(x.revenue)),
      rankings,
      trend: this.trend(rows),
      insights: this.insights(rows),
    };
  }

  /** Statements derived only from computed figures (no generated claims). */
  private insights(rows: Row[]) {
    const out: string[] = [];
    const over = rows
      .map((r) => ({ r, v: r.c.variance.find((x) => x.group === 'FREIGHT') }))
      .filter((x) => x.v?.variance && new D(x.v.variance).gt(0))
      .sort((a, b) => new D(b.v!.variance!).cmp(a.v!.variance!))[0];
    if (over)
      out.push(
        `Freight cost overrun of ${over.r.c.reportingCurrency} ${over.v!.variance} (${over.v!.variancePercent ?? '—'}%) reduced margin on ${over.r.c.shipmentNumber}.`,
      );
    const fxLoss = rows.filter(
      (r) => r.c.totals.fxGainLoss && new D(r.c.totals.fxGainLoss).lt(0),
    );
    if (fxLoss.length)
      out.push(`${fxLoss.length} shipment(s) had a forex loss on settlement.`);
    const byC = new Map<string, Dec[]>();
    for (const r of rows)
      if (r.c.freightReporting && r.c.destinationCountry)
        byC.set(r.c.destinationCountry, [
          ...(byC.get(r.c.destinationCountry) ?? []),
          new D(r.c.freightReporting),
        ]);
    const avg = [...byC.entries()]
      .map(([c, xs]) => ({
        c,
        v: xs.reduce((s, x) => s.plus(x), new D(0)).div(xs.length),
      }))
      .sort((a, b) => b.v.cmp(a.v));
    if (avg.length > 1)
      out.push(
        `${avg[0].c} shipments have the highest average freight cost (${m2(avg[0].v)}).`,
      );
    return out;
  }

  // ---------------------------------------------------------------- repeat business

  async signals(a: Actor, buyerId?: string): Promise<RepeatBusinessSignal[]> {
    const org = a.organizationId;
    const settings = await this.fin.settings(org);
    const orders = (await this.orders(org)).filter(
      (o) => !buyerId || o.buyerCompanyId === buyerId,
    );
    const byBuyer = new Map<string, typeof orders>();
    for (const o of orders)
      byBuyer.set(o.buyerCompanyId, [
        ...(byBuyer.get(o.buyerCompanyId) ?? []),
        o,
      ]);
    const ids = [...byBuyer.keys()];
    const [buyers, exp, disputes, critical, reminders, prods, leads] =
      await Promise.all([
        this.prisma.buyerCompany.findMany({
          where: { id: { in: ids } },
          select: { id: true, canonicalName: true, countryCode: true },
        }),
        this.exposure(a),
        this.prisma.receivable.groupBy({
          by: ['buyerCompanyId'],
          where: {
            organizationId: org,
            state: 'OPEN',
            disputedAt: { not: null },
          },
          _count: true,
        }),
        this.prisma.shipmentException.findMany({
          where: { organizationId: org, status: 'OPEN', severity: 'CRITICAL' },
          select: { shipmentId: true },
        }),
        this.prisma.reorderReminder.findMany({
          where: { organizationId: org, buyerCompanyId: { in: ids } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.organizationProduct.findMany({
          where: { organizationId: org },
          select: { id: true, displayName: true },
        }),
        this.prisma.buyerLead.findMany({
          where: { organizationId: org, buyerCompanyId: { in: ids } },
          select: { id: true, buyerCompanyId: true },
        }),
      ]);
    const critShips = critical.length
      ? await this.prisma.shipment.findMany({
          where: { id: { in: critical.map((c) => c.shipmentId) } },
          select: { buyerCompanyId: true },
        })
      : [];
    const today = new Date();
    return ids.map((id) => {
      const os = byBuyer.get(id)!;
      const counts = new Map<
        string,
        { productId: string | null; name: string; orders: number }
      >();
      for (const o of os) {
        const seen = new Set<string>();
        for (const it of o.items) {
          const name =
            prods.find((p) => p.id === it.productId)?.displayName ??
            it.description;
          const k = it.productId ?? `n:${name.toLowerCase()}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const v = counts.get(k) ?? {
            productId: it.productId,
            name,
            orders: 0,
          };
          v.orders++;
          counts.set(k, v);
        }
      }
      const top = [...counts.values()].sort((x, y) => y.orders - x.orders);
      const e = exp.filter((x) => x.buyerId === id);
      const overdue = this.sumNullable(e.map((x) => x.overdue));
      const delays = e.flatMap((x) => x.delays);
      const avgDelay = delays.length
        ? delays.reduce((s, x) => s + x, 0) / delays.length
        : null;
      const issues =
        (disputes.find((d) => d.buyerCompanyId === id)?._count ?? 0) +
        critShips.filter((s) => s.buyerCompanyId === id).length;
      const sig = repeatSignal({
        orderDates: os.map((o) => o.poDate),
        productOrders: top,
        overdue: Boolean(overdue && overdue.gt(0)),
        averagePaymentDelayDays: avgDelay,
        unresolvedIssues: issues,
        today,
      });
      const last = os[os.length - 1].poDate;
      let state: RepeatBusinessSignal['windowState'] = null;
      if (sig.window) {
        const lead = addDays(sig.window.start, -settings.reorderLeadDays);
        state =
          today < lead
            ? 'NOT_YET'
            : today < sig.window.start
              ? 'APPROACHING'
              : today <= sig.window.end
                ? 'IN_WINDOW'
                : 'PAST_WINDOW';
      }
      const rem = sig.window
        ? reminders.find(
            (r) =>
              r.buyerCompanyId === id &&
              isoDay(r.windowStart) === isoDay(sig.window!.start),
          )
        : undefined;
      const b = buyers.find((x) => x.id === id);
      return {
        buyer: {
          id,
          name: b?.canonicalName ?? 'Buyer',
          country: b?.countryCode ?? null,
        },
        orderCount: os.length,
        firstOrderDate: isoDay(os[0].poDate),
        lastOrderDate: isoDay(last),
        intervalsDays: sig.intervals,
        averageIntervalDays: sig.average,
        daysSinceLastOrder: dayDiff(last, today),
        topProducts: top.slice(0, 3),
        level: sig.level,
        score: sig.score,
        factors: sig.factors,
        window: sig.window
          ? { start: isoDay(sig.window.start)!, end: isoDay(sig.window.end)! }
          : null,
        windowState: state,
        paymentBehavior: {
          overdue: overdue ? m2(overdue) : null,
          averageDelayDays: avgDelay !== null ? avgDelay.toFixed(1) : null,
          label:
            overdue && overdue.gt(0)
              ? 'Has overdue payments'
              : avgDelay === null
                ? 'No payment history'
                : avgDelay <= 3
                  ? 'Pays on time'
                  : `Pays ~${avgDelay.toFixed(0)} days late`,
        },
        reminder: rem
          ? {
              id: rem.id,
              status: rem.status as ReorderReminderStatus,
              snoozedUntil: rem.snoozedUntil?.toISOString() ?? null,
            }
          : null,
        crmLeadId: leads.find((l) => l.buyerCompanyId === id)?.id ?? null,
      };
    });
  }

  async repeatBusiness(a: Actor) {
    const signals = await this.signals(a);
    const order = {
      IN_WINDOW: 0,
      PAST_WINDOW: 1,
      APPROACHING: 2,
      NOT_YET: 3,
    } as const;
    signals.sort(
      (x, y) =>
        (x.windowState ? order[x.windowState] : 9) -
          (y.windowState ? order[y.windowState] : 9) ||
        (y.score ?? -1) - (x.score ?? -1),
    );
    const reminders = await this.reorderReminders(a);
    return {
      dueForReorder: signals.filter(
        (s) => s.windowState === 'APPROACHING' || s.windowState === 'IN_WINDOW',
      ),
      overdueFollowUp: signals.filter((s) => s.windowState === 'PAST_WINDOW'),
      highSignal: signals.filter((s) => s.level === 'HIGH'),
      all: signals,
      reminders,
      method:
        'Deterministic points (orders, recency vs usual interval, cadence regularity, payment behaviour, product recurrence, unresolved issues). Needs ≥3 accepted orders; not a probability.',
    };
  }

  async buyerSignal(a: Actor, buyerId: string) {
    const b = await this.prisma.buyerCompany.findFirst({
      where: {
        id: buyerId,
        OR: [
          { ownerOrganizationId: null },
          { ownerOrganizationId: a.organizationId },
        ],
      },
      select: { id: true },
    });
    if (!b) throw new NotFoundException('Buyer not found.');
    const [s] = await this.signals(a, buyerId);
    const orders = await this.prisma.buyerPurchaseOrder.findMany({
      where: {
        organizationId: a.organizationId,
        buyerCompanyId: buyerId,
        status: 'ACCEPTED',
      },
      orderBy: { poDate: 'desc' },
      select: {
        id: true,
        poNumber: true,
        poDate: true,
        currency: true,
        totalAmount: true,
      },
    });
    return {
      signal: s ?? null,
      orders: orders.map((o) => ({
        id: o.id,
        poNumber: o.poNumber,
        poDate: isoDay(o.poDate),
        currency: o.currency,
        totalAmount: o.totalAmount?.toFixed(2) ?? null,
      })),
    };
  }

  // ---------------------------------------------------------------- reorder reminders

  private async reminderView(
    org: string,
    rows: Prisma.ReorderReminderGetPayload<object>[],
  ): Promise<ReorderReminderView[]> {
    const buyers = await this.prisma.buyerCompany.findMany({
      where: { id: { in: rows.map((r) => r.buyerCompanyId) } },
      select: { id: true, canonicalName: true },
    });
    void org;
    return rows.map((r) => ({
      id: r.id,
      buyer: {
        id: r.buyerCompanyId,
        name:
          buyers.find((b) => b.id === r.buyerCompanyId)?.canonicalName ??
          'Buyer',
      },
      product: r.productName ? { id: r.productId, name: r.productName } : null,
      windowStart: isoDay(r.windowStart)!,
      windowEnd: isoDay(r.windowEnd)!,
      status: (r.status === 'SNOOZED' &&
      r.snoozedUntil &&
      r.snoozedUntil <= new Date()
        ? 'SUGGESTED'
        : r.status) as ReorderReminderStatus,
      snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
      message: r.message,
      basis: r.basis as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async reorderReminders(a: Actor) {
    const rows = await this.prisma.reorderReminder.findMany({
      where: { organizationId: a.organizationId, status: { not: 'DISMISSED' } },
      orderBy: { windowStart: 'asc' },
    });
    return this.reminderView(a.organizationId, rows);
  }

  /** Suggest reminders for buyers approaching/in their reorder window. Nothing is sent. */
  async createReorderReminders(
    a: Actor,
    dto: { buyerCompanyId?: string; all?: boolean },
  ) {
    const org = a.organizationId;
    const signals = await this.signals(
      a,
      dto.all ? undefined : dto.buyerCompanyId,
    );
    if (!dto.all && !signals.length)
      throw new NotFoundException('Buyer has no accepted orders.');
    const o = await this.prisma.organization.findUniqueOrThrow({
      where: { id: org },
      select: { name: true, legalName: true },
    });
    const created: string[] = [];
    for (const s of signals) {
      if (
        !s.window ||
        !['APPROACHING', 'IN_WINDOW', 'PAST_WINDOW'].includes(
          s.windowState ?? '',
        )
      ) {
        if (!dto.all)
          throw new ConflictException(
            s.level === 'INSUFFICIENT_DATA'
              ? 'Not enough order history to estimate a reorder window.'
              : 'This buyer is not near its reorder window yet.',
          );
        continue;
      }
      if (s.reminder) {
        if (!dto.all)
          throw new ConflictException(
            'A reminder already exists for this reorder window.',
          );
        continue;
      }
      const lastPo = await this.prisma.buyerPurchaseOrder.findFirst({
        where: {
          organizationId: org,
          buyerCompanyId: s.buyer.id,
          status: 'ACCEPTED',
        },
        orderBy: { poDate: 'desc' },
        select: { poNumber: true },
      });
      const top = s.topProducts[0];
      const rem = await this.prisma.reorderReminder.create({
        data: {
          organizationId: org,
          buyerCompanyId: s.buyer.id,
          productId: top?.productId ?? null,
          productName: top?.name ?? null,
          windowStart: new Date(s.window.start),
          windowEnd: new Date(s.window.end),
          message: reorderMessage({
            buyerName: s.buyer.name,
            exporterName: o.legalName || o.name,
            productName: top?.name ?? 'your previous order',
            lastOrderDate: s.lastOrderDate!,
            lastPoNumber: lastPo?.poNumber ?? '',
          }),
          basis: {
            averageIntervalDays: s.averageIntervalDays,
            lastOrderDate: s.lastOrderDate,
            orderCount: s.orderCount,
            level: s.level,
            score: s.score,
          } as Prisma.InputJsonValue,
          createdByUserId: a.userId,
        },
      });
      created.push(rem.id);
      await this.audit.record({
        organizationId: org,
        actorId: a.userId,
        action: 'repeat_reminder.created',
        entityType: 'ReorderReminder',
        entityId: rem.id,
        metadata: { buyerId: s.buyer.id, windowStart: s.window.start },
      });
    }
    return {
      created: created.length,
      reminders: await this.reorderReminders(a),
    };
  }

  private async loadReminder(org: string, id: string) {
    const r = await this.prisma.reorderReminder.findFirst({
      where: { id, organizationId: org },
    });
    if (!r) throw new NotFoundException('Reminder not found.');
    return r;
  }

  async updateReminder(
    a: Actor,
    id: string,
    action: 'dismiss' | 'snooze' | 'draft',
    extra: { until?: string; reason?: string; expectedRowVersion?: number },
  ) {
    const r = await this.loadReminder(a.organizationId, id);
    if (
      extra.expectedRowVersion !== undefined &&
      extra.expectedRowVersion !== r.rowVersion
    )
      throw new ConflictException(
        'This reminder was changed by someone else. Reload and try again.',
      );
    if (r.status === 'DISMISSED')
      throw new ConflictException('This reminder was dismissed.');
    const data: Prisma.ReorderReminderUpdateInput = {
      rowVersion: { increment: 1 },
    };
    if (action === 'dismiss')
      Object.assign(data, {
        status: 'DISMISSED',
        dismissReason: extra.reason ?? null,
      });
    if (action === 'snooze') {
      const until = new Date(extra.until!);
      if (until <= new Date())
        throw new ConflictException('Snooze until a future date.');
      Object.assign(data, { status: 'SNOOZED', snoozedUntil: until });
    }
    if (action === 'draft') Object.assign(data, { status: 'DRAFTED' });
    const n = await this.prisma.reorderReminder.updateMany({
      where: { id, rowVersion: r.rowVersion },
      data: data as Prisma.ReorderReminderUpdateManyMutationInput,
    });
    if (n.count !== 1)
      throw new ConflictException(
        'This reminder was changed by someone else. Reload and try again.',
      );
    if (action === 'dismiss')
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'repeat_reminder.dismissed',
        entityType: 'ReorderReminder',
        entityId: id,
        metadata: { reason: extra.reason ?? null },
      });
    const [v] = await this.reminderView(a.organizationId, [
      await this.loadReminder(a.organizationId, id),
    ]);
    return v;
  }

  // ---------------------------------------------------------------- summaries

  async buyerSummary(a: Actor, buyerId: string): Promise<FinanceBuyerSummary> {
    const base = await this.receivables.buyerSummary(a, buyerId);
    const { rows, meta } = await this.rows(a, { range: 'all' });
    const rs = rows.filter((r) => r.c.buyer.id === buyerId);
    const revenue = rs.reduce((s, r) => s.plus(r.revenue), new D(0));
    const profit = rs.reduce((s, r) => s.plus(r.profit), new D(0));
    const [sig] = await this.signals(a, buyerId);
    return {
      ...base,
      profitability: rs.length
        ? {
            revenue: m2(revenue),
            profit: m2(profit),
            marginPercent: marginPct(profit, revenue),
            shipments: rs.length,
            reportingCurrency: meta.reportingCurrency,
          }
        : null,
      repeat: sig
        ? {
            level: sig.level,
            orderCount: sig.orderCount,
            window: sig.window,
            averageIntervalDays: sig.averageIntervalDays,
          }
        : null,
    };
  }

  async overviewExtras(a: Actor) {
    const org = a.organizationId;
    const ships = await this.prisma.shipment.findMany({
      where: { organizationId: org, status: { not: 'CANCELLED' } },
      select: { id: true },
    });
    let finalized = 0;
    let inProgress = 0;
    let profit = new D(0);
    let revenue = new D(0);
    for (const s of ships) {
      const { c, finalized: f } = await this.profit.current(org, s.id);
      if (f) {
        finalized++;
        if (c.totals.finalProfit && c.revenue) {
          profit = profit.plus(c.totals.finalProfit);
          revenue = revenue.plus(c.revenue);
        }
      } else if (c.status !== 'ESTIMATED') inProgress++;
    }
    const signals = await this.signals(a);
    return {
      profitability: {
        finalized,
        inProgress,
        totalProfit: finalized ? m2(profit) : null,
        averageMargin: finalized ? marginPct(profit, revenue) : null,
      },
      reorderDue: signals.filter(
        (s) =>
          s.windowState === 'APPROACHING' ||
          s.windowState === 'IN_WINDOW' ||
          s.windowState === 'PAST_WINDOW',
      ).length,
    };
  }
}
