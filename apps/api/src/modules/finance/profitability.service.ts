import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ActualCostCategory,
  ActualCostSource,
  CostingResult,
  FinanceList,
  FxBasis,
  ProfitabilityStatus,
  ProfitabilityVariance,
  ReceivableStatus,
  RevenueAdjustmentType,
  ShipmentActualCostView,
  ShipmentProfitabilityDetail,
  ShipmentProfitabilitySummary,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
} from '../commercial/commercial-core.service';
import { D, type Dec } from '../costing/costing-calculator';
import {
  INQUIRY_ATTACHMENT_EXTENSIONS,
  MAX_INQUIRY_ATTACHMENT_BYTES,
  StorageService,
} from '../storage/storage.service';
import { FinanceCoreService } from './finance-core.service';
import {
  ESTIMATE_TO_ACTUAL,
  isoDay,
  m2,
  marginPct,
  VARIANCE_GROUPS,
  variance,
} from './finance-rules';
import { ReceivablesService } from './receivables.service';
import type {
  AdjustmentDto,
  ConfirmNoneDto,
  CostDto,
  ListQueryDto,
  ReopenDto,
  UpdateCostDto,
} from './finance.dto';

/** Incoterms where the exporter pays main freight (freight actual expected). */
const EXPORTER_FREIGHT = ['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

export interface ProductShare {
  productId: string | null;
  name: string;
  quantity: string;
  unit: string;
  share: string;
}

/** Everything the profitability views, the snapshot and analytics need for one shipment. */
export type Computation = Omit<
  ShipmentProfitabilityDetail,
  'snapshots' | 'availableActions' | 'rowVersion'
> & {
  products: ProductShare[];
  freightReporting: string | null;
  orderDate: string;
  warnings: string[];
};

@Injectable()
export class ProfitabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CommercialCoreService,
    private readonly fin: FinanceCoreService,
    private readonly receivables: ReceivablesService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private async shipment(org: string, id: string) {
    const s = await this.prisma.shipment.findFirst({
      where: { id, organizationId: org },
    });
    if (!s) throw new NotFoundException('Shipment not found.');
    return s;
  }

  private async row(org: string, shipmentId: string) {
    return this.prisma.shipmentProfitability.upsert({
      where: { shipmentId },
      create: { organizationId: org, shipmentId },
      update: {},
      include: { snapshots: { orderBy: { version: 'desc' } } },
    });
  }

  private async convert(
    org: string,
    from: string | null,
    to: string,
    amount: Dec,
  ) {
    if (!from) return { reporting: null, fx: null };
    const fx = await this.fin.latestRate(org, from, to);
    return fx
      ? { reporting: amount.mul(fx.rate).toDecimalPlaces(2), fx: fx.basis }
      : { reporting: null, fx: null };
  }

  // ---------------------------------------------------------------- compute

  async compute(org: string, shipmentId: string): Promise<Computation> {
    const s = await this.shipment(org, shipmentId);
    const settings = await this.fin.settings(org);
    const rep = settings.reportingCurrency;
    const prof = await this.prisma.shipmentProfitability.findUnique({
      where: { shipmentId },
    });
    const confirmedNone = (prof?.confirmedNone ?? []) as ActualCostCategory[];
    const po = await this.prisma.buyerPurchaseOrder.findFirstOrThrow({
      where: { id: s.purchaseOrderId, organizationId: org },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    const buyer = await this.prisma.buyerCompany.findFirst({
      where: { id: s.buyerCompanyId },
      select: { canonicalName: true },
    });
    const siblings = await this.prisma.shipment.count({
      where: {
        organizationId: org,
        purchaseOrderId: po.id,
        status: { not: 'CANCELLED' },
      },
    });
    const missing: string[] = [];
    const warnings: string[] = [];

    // ---- revenue (agreed commercial value; never an opportunity estimate)
    const rec = await this.prisma.receivable.findFirst({
      where: {
        organizationId: org,
        state: { not: 'CANCELLED' },
        OR: [
          { shipmentId },
          ...(siblings === 1
            ? [{ purchaseOrderId: po.id, shipmentId: null }]
            : []),
        ],
      },
      include: { payments: true },
    });
    let revSource = 'NONE';
    let revSourceId: string | null = null;
    let revCurrency: string | null = null;
    let gross: Dec | null = null;
    if (rec) {
      revSource = 'RECEIVABLE';
      revSourceId = rec.id;
      revCurrency = rec.currency;
      gross = new D(rec.totalAmount.toString());
    } else if (siblings === 1) {
      const ci = await this.receivables.commercialInvoice(org, po.id);
      if (ci?.total) {
        revSource = 'COMMERCIAL_INVOICE';
        revSourceId = ci.id;
        revCurrency = ci.currency ?? po.currency;
        gross = new D(ci.total);
      } else if (po.totalAmount) {
        revSource = 'PURCHASE_ORDER';
        revSourceId = po.id;
        revCurrency = po.currency;
        gross = new D(po.totalAmount.toString());
      }
    }
    if (!gross)
      missing.push(
        siblings > 1
          ? 'Revenue: this PO has several shipments — create a receivable linked to this shipment.'
          : 'Revenue: no receivable, approved commercial invoice or PO total.',
      );
    else if (revSource !== 'RECEIVABLE')
      warnings.push(
        'No receivable yet — revenue taken from the agreed order value.',
      );
    const adjRows = await this.prisma.profitabilityAdjustment.findMany({
      where: { organizationId: org, shipmentId },
      orderBy: { createdAt: 'asc' },
    });
    let net = gross;
    for (const x of adjRows) {
      if (!net) break;
      net =
        x.type === 'DEBIT_CLAIM_ADJUSTMENT'
          ? net.plus(x.amount.toString())
          : net.minus(x.amount.toString());
    }
    let revFx: FxBasis | null = null;
    let revenue: Dec | null = null;
    if (net && revCurrency) {
      const booking = (rec?.bookingFx ?? null) as unknown as FxBasis | null;
      if (revCurrency === rep) {
        revenue = net;
        revFx = null;
      } else if (booking) {
        revenue = net.mul(booking.rate).toDecimalPlaces(2);
        revFx = booking;
      } else {
        const c = await this.convert(org, revCurrency, rep, net);
        revenue = c.reporting;
        revFx = c.fx;
        if (!revenue)
          missing.push(`FX rate ${revCurrency}→${rep} missing for revenue.`);
        else
          warnings.push(
            'Revenue converted with the latest saved FX snapshot (no booking rate on a receivable).',
          );
      }
    }

    // ---- estimate (Sprint 14 immutable snapshots via quotation items)
    const qItemIds = po.items
      .map((i) => i.quotationItemId)
      .filter((x): x is string => !!x);
    const qItems = qItemIds.length
      ? await this.prisma.quotationItem.findMany({
          where: { id: { in: qItemIds }, organizationId: org },
        })
      : [];
    const estCat = new Map<string, Dec>();
    let estRevenue = new D(0);
    let estCurrency: string | null = null;
    const costings: Computation['estimate']['costings'] = [];
    const estNotes: string[] = [];
    let estOk = false;
    for (const it of po.items) {
      const qi = qItems.find((q) => q.id === it.quotationItemId);
      const ps = qi?.pricingSnapshot as {
        costingId?: string;
        reference?: string;
        scenarioId?: string;
        scenarioName?: string;
        snapshotId?: string | null;
        snapshotKind?: string;
      } | null;
      if (!ps?.costingId) continue;
      if (!ps.snapshotId) {
        estNotes.push(
          `${it.description}: costing ${ps.reference} was not READY/LOCKED when quoted — no immutable estimate.`,
        );
        continue;
      }
      const snap = await this.prisma.costingSnapshot.findFirst({
        where: { id: ps.snapshotId, costing: { organizationId: org } },
      });
      const result = snap
        ? ((snap.results as Record<string, unknown>)[ps.scenarioId ?? ''] as
            CostingResult | undefined)
        : undefined;
      if (!result?.complete || !result.totalCost) {
        estNotes.push(
          `${it.description}: costing snapshot has no complete total.`,
        );
        continue;
      }
      const scale = new D(it.quantity.toString()).div(result.quantity);
      estCurrency = result.calculationCurrency;
      for (const c of result.categories)
        if (c.included && c.amount) {
          const k = ESTIMATE_TO_ACTUAL[c.category] ?? 'MISCELLANEOUS';
          estCat.set(
            k,
            (estCat.get(k) ?? new D(0)).plus(new D(c.amount).mul(scale)),
          );
        }
      if (result.pricing)
        estRevenue = estRevenue.plus(
          new D(result.pricing.totalRevenue).mul(scale),
        );
      estOk = true;
      if (!costings.some((x) => x.snapshotId === ps.snapshotId))
        costings.push({
          costingId: ps.costingId,
          reference: ps.reference ?? '',
          snapshotId: ps.snapshotId,
          snapshotKind: ps.snapshotKind ?? snap!.kind,
          scenarioName: ps.scenarioName ?? '',
        });
    }
    // A PO split over several shipments: estimate scaled to this shipment's share of the order value.
    let share = new D(1);
    if (
      siblings > 1 &&
      gross &&
      po.totalAmount &&
      !new D(po.totalAmount.toString()).isZero()
    )
      share = gross.div(po.totalAmount.toString());
    let estRate: Dec | null = estCurrency === rep ? new D(1) : null;
    if (estOk && estCurrency && estCurrency !== rep) {
      const fx = await this.fin.latestRate(org, estCurrency, rep);
      estRate = fx?.rate ?? null;
      if (!fx)
        estNotes.push(
          `No FX snapshot ${estCurrency}→${rep}; estimate not converted.`,
        );
    }
    const estConv = (d: Dec) =>
      estRate ? d.mul(share).mul(estRate).toDecimalPlaces(2) : null;
    const estTotal = estOk
      ? [...estCat.values()].reduce((a, b) => a.plus(b), new D(0))
      : null;
    const estTotalRep = estTotal ? estConv(estTotal) : null;
    const estRevRep = estOk && estRevenue.gt(0) ? estConv(estRevenue) : null;
    const estProfit =
      estTotalRep && estRevRep ? estRevRep.minus(estTotalRep) : null;

    // ---- actual costs
    const costs: ShipmentActualCostView[] = [];
    const manual = await this.prisma.shipmentActualCost.findMany({
      where: { organizationId: org, shipmentId, voidedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const names = await this.core.userNames(
      manual.map((m) => m.createdByUserId),
    );
    for (const m of manual)
      costs.push({
        id: m.id,
        category: m.category as ActualCostCategory,
        description: m.description,
        amount: m2(new D(m.amount.toString())),
        currency: m.currency,
        fx:
          m.currency === m.reportingCurrency
            ? null
            : {
                rate: m.fxRate?.toString() ?? '1',
                from: m.currency,
                to: m.reportingCurrency,
                sourceLabel: m.fxSourceLabel,
                sourceDate: isoDay(m.fxSourceDate),
                snapshotId: m.fxSnapshotId,
              },
        reportingAmount:
          m.reportingCurrency === rep
            ? m2(new D(m.convertedAmount.toString()))
            : null,
        source: m.source as ActualCostSource,
        sourceReference: m.sourceReference,
        incurredAt: isoDay(m.incurredAt),
        vendorName: m.vendorName,
        attachment: m.attachmentKey
          ? { id: m.id, filename: m.attachmentName ?? 'attachment' }
          : null,
        derived: false,
        createdBy: names.get(m.createdByUserId) ?? null,
      });
    // Sprint 18 logistics actuals — read from the shipment, never copied.
    const s18: [ActualCostCategory, string, Prisma.Decimal | null][] = [
      ['FREIGHT', 'Freight (shipment logistics actual)', s.actualFreight],
      [
        'FREIGHT',
        'Freight surcharges (shipment logistics actual)',
        s.actualSurcharges,
      ],
      [
        'CUSTOMS_PORT',
        'Local charges (shipment logistics actual)',
        s.actualLocalCharges,
      ],
    ];
    let freightRep: Dec | null = null;
    for (const [cat, label, v] of s18) {
      if (!v) continue;
      const amt = new D(v.toString());
      const c = await this.convert(org, s.actualCostCurrency, rep, amt);
      if (!c.reporting)
        missing.push(
          `FX rate ${s.actualCostCurrency}→${rep} missing for ${label.toLowerCase()}.`,
        );
      if (cat === 'FREIGHT' && c.reporting)
        freightRep = (freightRep ?? new D(0)).plus(c.reporting);
      costs.push({
        id: null,
        category: cat,
        description: label,
        amount: m2(amt),
        currency: s.actualCostCurrency ?? rep,
        fx: s.actualCostCurrency === rep ? null : c.fx,
        reportingAmount: c.reporting ? m2(c.reporting) : null,
        source: 'LOGISTICS_ACTUAL',
        sourceReference: s.shipmentNumber,
        incurredAt: null,
        vendorName: null,
        attachment: null,
        derived: true,
        createdBy: null,
      });
    }
    // Bank charges recorded on payments.
    const booking = (rec?.bookingFx ?? null) as unknown as FxBasis | null;
    const fxPayments: Computation['fxImpact']['payments'] = [];
    const fxNotes: string[] = [];
    let fxTotal = new D(0);
    let fxKnown = true;
    for (const p of rec?.payments ?? []) {
      if (p.status !== 'RECORDED') continue;
      for (const ch of (p.charges ?? []) as {
        type: string;
        amount: string;
        currency: string;
      }[]) {
        const amt = new D(ch.amount);
        let reporting: Dec | null = null;
        let fx: FxBasis | null = null;
        if (ch.currency === rep) reporting = amt;
        else if (ch.currency === rec!.currency && p.settlementFxRate) {
          reporting = amt.mul(p.settlementFxRate.toString()).toDecimalPlaces(2);
          fx = {
            rate: p.settlementFxRate.toString(),
            from: ch.currency,
            to: rep,
            sourceLabel: p.settlementFxSource,
            sourceDate: isoDay(p.settlementFxDate),
            snapshotId: null,
          };
        } else {
          const c = await this.convert(org, ch.currency, rep, amt);
          reporting = c.reporting;
          fx = c.fx;
        }
        if (!reporting)
          missing.push(
            `FX rate ${ch.currency}→${rep} missing for a bank charge.`,
          );
        costs.push({
          id: null,
          category: 'BANK_CHARGES',
          description: `${ch.type.replace(/_/g, ' ').toLowerCase()} on payment ${isoDay(p.receivedAt)}`,
          amount: m2(amt),
          currency: ch.currency,
          fx,
          reportingAmount: reporting ? m2(reporting) : null,
          source: 'BANK_CHARGE',
          sourceReference: p.id,
          incurredAt: isoDay(p.receivedAt),
          vendorName: p.bankName,
          attachment: null,
          derived: true,
          createdBy: null,
        });
      }
      // FX gain/loss: booking rate vs actual settlement rate (no forecasts).
      const applied = new D(p.appliedAmount.toString());
      const settle = p.settlementFxRate
        ? new D(p.settlementFxRate.toString())
        : null;
      const bookingRate =
        rec!.currency === rep ? new D(1) : booking ? new D(booking.rate) : null;
      const gl =
        settle && bookingRate
          ? applied.mul(settle.minus(bookingRate)).toDecimalPlaces(2)
          : null;
      if (gl) fxTotal = fxTotal.plus(gl);
      else {
        fxKnown = false;
        fxNotes.push(
          `Payment ${isoDay(p.receivedAt)}: ${!bookingRate ? 'no booking FX on the receivable' : 'settlement FX not recorded'} — gain/loss not calculated.`,
        );
      }
      fxPayments.push({
        paymentId: p.id,
        applied: m2(applied),
        bookingRate: bookingRate?.toString() ?? null,
        settlementRate: settle?.toString() ?? null,
        gainLoss: gl ? m2(gl) : null,
      });
    }
    if (!fxKnown)
      missing.push(
        'Settlement FX missing on a payment — FX gain/loss incomplete.',
      );
    const manualFx = costs
      .filter((c) => c.category === 'FX_GAIN_LOSS' && c.reportingAmount)
      .reduce((a, c) => a.plus(c.reportingAmount!), new D(0));
    const fxImpact = fxTotal.minus(manualFx);
    for (const c of costs)
      if (!c.reportingAmount && !c.derived)
        missing.push(`FX rate missing for “${c.description}”.`);

    // ---- completeness
    const has = (cat: string) =>
      costs.some((c) => c.category === cat) ||
      confirmedNone.includes(cat as ActualCostCategory);
    if (!has('PROCUREMENT'))
      missing.push(
        'Procurement actual missing (enter the actual purchase/production cost).',
      );
    for (const [k, v] of estCat)
      if (v.gt(0) && k !== 'PROCUREMENT' && !has(k))
        missing.push(
          `${k.replace(/_/g, ' ').toLowerCase()} actual missing (estimated in costing) — add it or confirm none.`,
        );
    if (
      EXPORTER_FREIGHT.includes((s.incoterm ?? '').toUpperCase()) &&
      !has('FREIGHT') &&
      !estCat.has('FREIGHT')
    )
      missing.push(
        'Final freight invoice missing — record actual freight on the shipment logistics costs.',
      );
    if (!has('BANK_CHARGES'))
      missing.push(
        'Bank charges missing — record them on the payment or confirm none.',
      );
    if (rec && new D(rec.outstandingAmount.toString()).gt(0))
      warnings.push(
        `Receivable not fully collected (${rec.currency} ${m2(new D(rec.outstandingAmount.toString()))} outstanding).`,
      );

    // ---- totals
    const costRep = costs
      .filter((c) => c.category !== 'FX_GAIN_LOSS' && c.reportingAmount)
      .reduce((a, c) => a.plus(c.reportingAmount!), new D(0));
    const operational = revenue ? revenue.minus(costRep) : null;
    const finalProfit = operational ? operational.plus(fxImpact) : null;
    const actualCount = costs.length;
    const finalized = Boolean(prof?.finalized);
    const status: ProfitabilityStatus = finalized
      ? 'FINALIZED'
      : missing.length === 0
        ? 'ACTUAL_IN_PROGRESS'
        : actualCount === 0 && estOk
          ? 'ESTIMATED'
          : 'INCOMPLETE';

    // ---- variance (actual − estimated; positive cost variance = overrun)
    const actualBy = (cats: string[]) => {
      const rows = costs.filter((c) => cats.includes(c.category));
      if (!rows.length)
        return confirmedNone.some((c) => cats.includes(c)) ? new D(0) : null;
      return rows.reduce((a, c) => a.plus(c.reportingAmount ?? 0), new D(0));
    };
    const estBy = (cats: string[]) => {
      if (!estOk || !estRate) return null;
      return estConv(
        cats.reduce((a, c) => a.plus(estCat.get(c) ?? 0), new D(0)),
      );
    };
    const varianceRows: ProfitabilityVariance[] = VARIANCE_GROUPS.map((g) => {
      const e = estBy(g.categories);
      const act = actualBy(g.categories);
      const v = variance(e, act);
      return {
        group: g.group,
        label: g.label,
        estimated: e ? m2(e) : null,
        actual: act ? m2(act) : null,
        variance: v.variance,
        variancePercent: v.percent,
        direction: v.direction,
      };
    });
    varianceRows.push({
      group: 'FOREX',
      label: 'Forex gain (+) / loss (−)',
      estimated: null,
      actual: m2(fxImpact),
      variance: null,
      variancePercent: null,
      direction: 'N/A',
    });
    const rv = variance(estRevRep, revenue);
    varianceRows.unshift({
      group: 'REVENUE',
      label: 'Revenue (positive = better than estimate)',
      estimated: estRevRep ? m2(estRevRep) : null,
      actual: revenue ? m2(revenue) : null,
      variance: rv.variance,
      variancePercent: rv.percent,
      direction:
        rv.direction === 'OVERRUN'
          ? 'SAVING'
          : rv.direction === 'SAVING'
            ? 'OVERRUN'
            : rv.direction,
    });
    const pv = variance(estProfit, finalProfit);
    varianceRows.push({
      group: 'PROFIT',
      label: 'Final profit (positive = better than estimate)',
      estimated: estProfit ? m2(estProfit) : null,
      actual: finalProfit ? m2(finalProfit) : null,
      variance: pv.variance,
      variancePercent: pv.percent,
      direction:
        pv.direction === 'OVERRUN'
          ? 'SAVING'
          : pv.direction === 'SAVING'
            ? 'OVERRUN'
            : pv.direction,
    });

    // ---- product split by order value (for product analytics)
    const poValue = po.items.reduce(
      (a, i) =>
        a.plus(
          i.totalPrice?.toString() ??
            new D(i.quantity.toString()).mul(i.unitPrice.toString()),
        ),
      new D(0),
    );
    const prodNames = await this.prisma.organizationProduct.findMany({
      where: {
        organizationId: org,
        id: {
          in: po.items.map((i) => i.productId).filter((x): x is string => !!x),
        },
      },
      select: { id: true, displayName: true },
    });
    const products: ProductShare[] = po.items.map((i) => {
      const v = new D(
        i.totalPrice?.toString() ??
          new D(i.quantity.toString()).mul(i.unitPrice.toString()),
      );
      return {
        productId: i.productId,
        name:
          prodNames.find((p) => p.id === i.productId)?.displayName ??
          i.description,
        quantity: new D(i.quantity.toString()).mul(share).toString(),
        unit: i.unit,
        share: poValue.isZero() ? '0' : v.div(poValue).toString(),
      };
    });
    const rc = rec
      ? (await this.receivables.computedAll(org, { id: rec.id })).list[0]
      : null;
    return {
      shipmentId: s.id,
      shipmentNumber: s.shipmentNumber,
      buyer: { id: s.buyerCompanyId, name: buyer?.canonicalName ?? 'Buyer' },
      destinationCountry: s.destinationCountry,
      reportingCurrency: rep,
      revenue: revenue ? m2(revenue) : null,
      estimatedProfit: estProfit ? m2(estProfit) : null,
      actualProfit: finalProfit ? m2(finalProfit) : null,
      marginPercent:
        finalProfit && revenue ? marginPct(finalProfit, revenue) : null,
      profitVariance: pv.variance,
      completeness: { complete: missing.length === 0, missing },
      status,
      periodDate: (
        s.deliveredAt ??
        s.actualDeparture ??
        s.createdAt
      ).toISOString(),
      finalizedAt: prof?.finalizedAt?.toISOString() ?? null,
      purchaseOrder: { id: po.id, poNumber: po.poNumber },
      revenueDetail: {
        source: revSource,
        sourceId: revSourceId,
        currency: revCurrency,
        gross: gross ? m2(gross) : null,
        adjustments: adjRows.map((x) => ({
          id: x.id,
          type: x.type as RevenueAdjustmentType,
          amount: m2(new D(x.amount.toString())),
          currency: x.currency,
          reason: x.reason,
          createdAt: x.createdAt.toISOString(),
        })),
        net: net ? m2(net) : null,
        fx: revFx,
        reporting: revenue ? m2(revenue) : null,
      },
      estimate: {
        available: estOk,
        source: estOk
          ? 'Sprint 14 costing snapshot (immutable) via quotation items'
          : null,
        costings,
        scale: estOk ? share.toString() : null,
        revenue: estRevRep ? m2(estRevRep) : null,
        totalCost: estTotalRep ? m2(estTotalRep) : null,
        profit: estProfit ? m2(estProfit) : null,
        marginPercent:
          estProfit && estRevRep ? marginPct(estProfit, estRevRep) : null,
        currency: estOk ? rep : null,
        notes:
          estNotes.length || estOk
            ? estNotes
            : [
                'No READY/LOCKED Sprint 14 costing linked through the quotation — estimate unavailable.',
              ],
      },
      costs,
      totals: {
        actualCost: m2(costRep),
        operationalProfit: operational ? m2(operational) : null,
        fxGainLoss: m2(fxImpact),
        finalProfit: finalProfit ? m2(finalProfit) : null,
        marginPercent:
          finalProfit && revenue ? marginPct(finalProfit, revenue) : null,
      },
      variance: varianceRows,
      fxImpact: {
        payments: fxPayments,
        manual: m2(manualFx.neg()),
        total: m2(fxImpact),
        notes: fxNotes,
      },
      confirmedNone,
      receivable: rc
        ? {
            id: rc.r.id,
            receivableNumber: rc.r.receivableNumber,
            status: rc.status as ReceivableStatus,
            outstanding: m2(new D(rc.r.outstandingAmount.toString())),
            currency: rc.r.currency,
          }
        : null,
      calculatedAt: new Date().toISOString(),
      products,
      freightReporting: freightRep ? m2(freightRep) : null,
      orderDate: po.poDate.toISOString(),
      warnings,
    };
  }

  // ---------------------------------------------------------------- views

  private toSummary(c: Computation): ShipmentProfitabilitySummary {
    return {
      shipmentId: c.shipmentId,
      shipmentNumber: c.shipmentNumber,
      buyer: c.buyer,
      destinationCountry: c.destinationCountry,
      reportingCurrency: c.reportingCurrency,
      revenue: c.revenue,
      estimatedProfit: c.estimatedProfit,
      actualProfit: c.actualProfit,
      marginPercent: c.marginPercent,
      profitVariance: c.profitVariance,
      completeness: c.completeness,
      status: c.status,
      periodDate: c.periodDate,
      finalizedAt: c.finalizedAt,
    };
  }

  /** Finalized → the immutable snapshot; otherwise the live calculation. */
  async current(
    org: string,
    shipmentId: string,
  ): Promise<{ c: Computation; finalized: boolean }> {
    const p = await this.prisma.shipmentProfitability.findUnique({
      where: { shipmentId },
      include: { snapshots: true },
    });
    if (p?.finalized && p.currentSnapshotId) {
      const snap = p.snapshots.find((x) => x.id === p.currentSnapshotId);
      if (snap)
        return {
          c: {
            ...(snap.data as unknown as Computation),
            status: 'FINALIZED',
            finalizedAt: p.finalizedAt?.toISOString() ?? null,
          },
          finalized: true,
        };
    }
    return { c: await this.compute(org, shipmentId), finalized: false };
  }

  async list(
    a: Actor,
    q: ListQueryDto,
  ): Promise<FinanceList<ShipmentProfitabilitySummary>> {
    const org = a.organizationId;
    const ships = await this.prisma.shipment.findMany({
      where: {
        organizationId: org,
        status: { not: 'CANCELLED' },
        ...(q.buyerCompanyId ? { buyerCompanyId: q.buyerCompanyId } : {}),
        ...(q.country ? { destinationCountry: q.country } : {}),
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    let rows: ShipmentProfitabilitySummary[] = [];
    for (const s of ships)
      rows.push(this.toSummary((await this.current(org, s.id)).c));
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    if (q.range || q.from || q.to) {
      const r = this.fin.range(q);
      rows = rows.filter(
        (x) =>
          new Date(x.periodDate) >= r.from && new Date(x.periodDate) < r.to,
      );
    }
    const t = q.search?.trim().toLowerCase();
    if (t)
      rows = rows.filter((r) =>
        [r.shipmentNumber, r.buyer.name, r.destinationCountry].some((x) =>
          x?.toLowerCase().includes(t),
        ),
      );
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      meta: {
        page,
        pageSize,
        totalItems: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      },
    };
  }

  async detail(
    a: Actor,
    shipmentId: string,
  ): Promise<ShipmentProfitabilityDetail> {
    const org = a.organizationId;
    await this.shipment(org, shipmentId);
    const p = await this.row(org, shipmentId);
    const { c, finalized } = await this.current(org, shipmentId);
    const names = await this.core.userNames(
      p.snapshots.map((x) => x.finalizedByUserId),
    );
    const actions: string[] = [];
    if (!finalized && this.fin.can(a, 'profitability.edit_costs'))
      actions.push('add_cost', 'adjust_revenue', 'confirm_none');
    if (
      !finalized &&
      this.fin.can(a, 'profitability.finalize') &&
      c.completeness.complete
    )
      actions.push('finalize');
    if (finalized && this.fin.can(a, 'profitability.reopen'))
      actions.push('reopen');
    const { products, freightReporting, orderDate, warnings, ...view } = c;
    void products;
    void freightReporting;
    void orderDate;
    if (finalized) {
      const live = await this.compute(org, shipmentId);
      if (live.totals.finalProfit !== c.totals.finalProfit)
        warnings.push(
          `Live inputs changed since finalization (live final profit ${live.totals.finalProfit ?? '—'}). Reopen to update.`,
        );
    }
    return {
      ...view,
      completeness: {
        ...view.completeness,
        missing: [
          ...view.completeness.missing,
          ...warnings.map((w) => `Note: ${w}`),
        ],
      },
      rowVersion: p.rowVersion,
      snapshots: p.snapshots.map((x) => ({
        id: x.id,
        version: x.version,
        finalizedAt: x.finalizedAt.toISOString(),
        finalizedBy: names.get(x.finalizedByUserId) ?? null,
        reopenedAt: x.supersededAt?.toISOString() ?? null,
        reopenReason: x.reopenReason,
        data: x.data,
      })),
      availableActions: actions,
    };
  }

  // ---------------------------------------------------------------- edits

  private async assertOpen(org: string, shipmentId: string) {
    const p = await this.row(org, shipmentId);
    if (p.finalized)
      throw new ConflictException({
        message:
          'Profitability is finalized. A manager must reopen it before costs or revenue change.',
        details: { code: 'PROFITABILITY_FINALIZED' },
      });
    return p;
  }

  private async fxFor(
    org: string,
    currency: string,
    rep: string,
    fx?: { rate: string; sourceLabel?: string; sourceDate?: string },
  ) {
    if (currency === rep)
      return { rate: new D(1), basis: null as FxBasis | null };
    if (fx) {
      const e = this.fin.explicit(currency, rep, fx);
      return { rate: e.rate, basis: e.basis };
    }
    const l = await this.fin.latestRate(org, currency, rep);
    if (!l)
      throw new BadRequestException({
        message: `No exchange rate ${currency}→${rep}. Enter the rate used or save an FX snapshot.`,
        details: { code: 'FX_REQUIRED' },
      });
    return { rate: l.rate, basis: l.basis };
  }

  async addCost(a: Actor, shipmentId: string, dto: CostDto) {
    const org = a.organizationId;
    const s = await this.shipment(org, shipmentId);
    await this.assertOpen(org, shipmentId);
    if (dto.category === 'FREIGHT')
      throw new ConflictException({
        message:
          'Actual freight is recorded once, on the shipment’s logistics costs (Sprint 18), and flows into profitability automatically.',
        details: { code: 'USE_SHIPMENT_LOGISTICS_COSTS' },
      });
    if (dto.category !== 'FX_GAIN_LOSS' && new D(dto.amount).lt(0))
      throw new BadRequestException(
        'Cost amounts must be positive (use a revenue adjustment for credits).',
      );
    const { reportingCurrency: rep } = await this.fin.settings(org);
    const fx = await this.fxFor(org, dto.currency, rep, dto.fx);
    const amount = new D(dto.amount);
    const row = await this.prisma.shipmentActualCost.create({
      data: {
        organizationId: org,
        shipmentId,
        category: dto.category,
        description: dto.description.trim(),
        amount,
        currency: dto.currency,
        fxRate: fx.basis ? fx.rate : null,
        fxSourceLabel: fx.basis?.sourceLabel ?? null,
        fxSourceDate: fx.basis?.sourceDate
          ? new Date(fx.basis.sourceDate)
          : null,
        fxSnapshotId: fx.basis?.snapshotId ?? null,
        reportingCurrency: rep,
        convertedAmount: amount.mul(fx.rate).toDecimalPlaces(2),
        source: dto.source ?? 'MANUAL',
        sourceReference: dto.sourceReference ?? null,
        incurredAt: dto.incurredAt ? new Date(dto.incurredAt) : null,
        vendorName: dto.vendorName ?? null,
        createdByUserId: a.userId,
      },
    });
    await this.core.event(this.prisma as never, a, {
      entityType: 'PROFITABILITY',
      entityId: shipmentId,
      lineageId: shipmentId,
      type: 'profitability.cost_added',
      title: `${dto.category.replace(/_/g, ' ').toLowerCase()} actual ${dto.currency} ${m2(amount)} added (${s.shipmentNumber})`,
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'profitability.cost_added',
      entityType: 'ShipmentActualCost',
      entityId: row.id,
      metadata: {
        shipmentId,
        category: dto.category,
        amount: m2(amount),
        currency: dto.currency,
      },
    });
    return this.detail(a, shipmentId);
  }

  async updateCost(a: Actor, costId: string, dto: UpdateCostDto) {
    const org = a.organizationId;
    const c = await this.prisma.shipmentActualCost.findFirst({
      where: { id: costId, organizationId: org },
    });
    if (!c) throw new NotFoundException('Cost not found.');
    await this.assertOpen(org, c.shipmentId);
    if (c.voidedAt) throw new ConflictException('This cost line was voided.');
    const amount = dto.amount ? new D(dto.amount) : new D(c.amount.toString());
    const currency = dto.currency ?? c.currency;
    const fx =
      dto.amount || dto.currency || dto.fx
        ? await this.fxFor(org, currency, c.reportingCurrency, dto.fx)
        : null;
    await this.prisma.shipmentActualCost.update({
      where: { id: costId },
      data: {
        description: dto.description,
        sourceReference: dto.sourceReference,
        vendorName: dto.vendorName,
        incurredAt: dto.incurredAt ? new Date(dto.incurredAt) : undefined,
        ...(fx
          ? {
              amount,
              currency,
              fxRate: fx.basis ? fx.rate : null,
              fxSourceLabel: fx.basis?.sourceLabel ?? null,
              fxSourceDate: fx.basis?.sourceDate
                ? new Date(fx.basis.sourceDate)
                : null,
              fxSnapshotId: fx.basis?.snapshotId ?? null,
              convertedAmount: amount.mul(fx.rate).toDecimalPlaces(2),
            }
          : {}),
        ...(dto.voidReason
          ? { voidedAt: new Date(), voidReason: dto.voidReason }
          : {}),
      },
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: dto.voidReason
        ? 'profitability.cost_voided'
        : 'profitability.cost_updated',
      entityType: 'ShipmentActualCost',
      entityId: costId,
      metadata: {
        shipmentId: c.shipmentId,
        previous: { amount: c.amount.toString(), currency: c.currency },
        reason: dto.voidReason ?? null,
      },
    });
    return this.detail(a, c.shipmentId);
  }

  async attachCost(a: Actor, costId: string, file: Express.Multer.File) {
    const c = await this.prisma.shipmentActualCost.findFirst({
      where: { id: costId, organizationId: a.organizationId },
    });
    if (!c) throw new NotFoundException('Cost not found.');
    await this.assertOpen(a.organizationId, c.shipmentId);
    const { storageKey } = await this.storage.savePrivateFile(
      'finance-attachments',
      file,
      INQUIRY_ATTACHMENT_EXTENSIONS,
      MAX_INQUIRY_ATTACHMENT_BYTES,
    );
    await this.prisma.shipmentActualCost.update({
      where: { id: costId },
      data: {
        attachmentKey: storageKey,
        attachmentName: file.originalname.slice(0, 200),
        attachmentMime: file.mimetype,
        attachmentSize: file.size,
      },
    });
    return this.detail(a, c.shipmentId);
  }

  async downloadCost(a: Actor, costId: string) {
    const c = await this.prisma.shipmentActualCost.findFirst({
      where: { id: costId, organizationId: a.organizationId },
    });
    if (!c?.attachmentKey) throw new NotFoundException('Attachment not found.');
    return {
      buffer: await this.storage.readPrivateFile(c.attachmentKey),
      filename: c.attachmentName ?? 'attachment',
      mimeType: c.attachmentMime ?? 'application/octet-stream',
    };
  }

  async addAdjustment(a: Actor, shipmentId: string, dto: AdjustmentDto) {
    const org = a.organizationId;
    await this.shipment(org, shipmentId);
    await this.assertOpen(org, shipmentId);
    const c = await this.compute(org, shipmentId);
    if (!c.revenueDetail.currency)
      throw new ConflictException(
        'Record the revenue (receivable) before adjusting it.',
      );
    if (dto.currency !== c.revenueDetail.currency)
      throw new BadRequestException(
        `Adjustments must be in the revenue currency (${c.revenueDetail.currency}).`,
      );
    const row = await this.prisma.profitabilityAdjustment.create({
      data: {
        organizationId: org,
        shipmentId,
        type: dto.type,
        amount: new D(dto.amount),
        currency: dto.currency,
        reason: dto.reason,
        createdByUserId: a.userId,
      },
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'profitability.revenue_adjusted',
      entityType: 'ProfitabilityAdjustment',
      entityId: row.id,
      metadata: {
        shipmentId,
        type: dto.type,
        amount: dto.amount,
        currency: dto.currency,
      },
    });
    return this.detail(a, shipmentId);
  }

  async confirmNone(a: Actor, shipmentId: string, dto: ConfirmNoneDto) {
    const org = a.organizationId;
    await this.shipment(org, shipmentId);
    const p = await this.assertOpen(org, shipmentId);
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== p.rowVersion
    )
      throw CommercialCoreService.conflict();
    const set = new Set(p.confirmedNone);
    if (dto.none) set.add(dto.category);
    else set.delete(dto.category);
    await this.prisma.shipmentProfitability.update({
      where: { id: p.id },
      data: { confirmedNone: [...set], rowVersion: { increment: 1 } },
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'profitability.cost_confirmed_none',
      entityType: 'ShipmentProfitability',
      entityId: p.id,
      metadata: { category: dto.category, none: dto.none },
    });
    return this.detail(a, shipmentId);
  }

  async finalize(a: Actor, shipmentId: string, expected?: number) {
    const org = a.organizationId;
    await this.shipment(org, shipmentId);
    const p = await this.assertOpen(org, shipmentId);
    if (expected !== undefined && expected !== p.rowVersion)
      throw CommercialCoreService.conflict();
    const c = await this.compute(org, shipmentId);
    if (!c.completeness.complete)
      throw new ConflictException({
        message: 'Profitability cannot be finalized while inputs are missing.',
        details: {
          code: 'PROFITABILITY_INCOMPLETE',
          missing: c.completeness.missing,
        },
      });
    const version = (p.snapshots[0]?.version ?? 0) + 1;
    const data = { ...c, status: 'FINALIZED' as const };
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.shipmentProfitability.updateMany({
        where: { id: p.id, rowVersion: p.rowVersion, finalized: false },
        data: { finalized: true, rowVersion: { increment: 1 } },
      });
      if (n.count !== 1) throw CommercialCoreService.conflict();
      const snap = await tx.profitabilitySnapshot.create({
        data: {
          organizationId: org,
          profitabilityId: p.id,
          shipmentId,
          version,
          data: data as unknown as Prisma.InputJsonValue,
          finalizedByUserId: a.userId,
        },
      });
      const now = new Date();
      await tx.shipmentProfitability.update({
        where: { id: p.id },
        data: {
          finalizedAt: now,
          finalizedByUserId: a.userId,
          currentSnapshotId: snap.id,
        },
      });
      await this.core.event(tx, a, {
        entityType: 'PROFITABILITY',
        entityId: shipmentId,
        lineageId: shipmentId,
        type: 'profitability.finalized',
        title: `Profitability finalized (v${version}): profit ${c.reportingCurrency} ${c.totals.finalProfit}, margin ${c.totals.marginPercent ?? '—'}%`,
      });
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'profitability.finalized',
      entityType: 'ShipmentProfitability',
      entityId: p.id,
      metadata: {
        shipmentId,
        version,
        finalProfit: c.totals.finalProfit,
        reportingCurrency: c.reportingCurrency,
      },
    });
    return this.detail(a, shipmentId);
  }

  async reopen(a: Actor, shipmentId: string, dto: ReopenDto) {
    const org = a.organizationId;
    await this.shipment(org, shipmentId);
    const p = await this.row(org, shipmentId);
    if (!p.finalized)
      throw new ConflictException('Profitability is not finalized.');
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== p.rowVersion
    )
      throw CommercialCoreService.conflict();
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.shipmentProfitability.updateMany({
        where: { id: p.id, rowVersion: p.rowVersion, finalized: true },
        data: {
          finalized: false,
          currentSnapshotId: null,
          reopenedAt: new Date(),
          reopenedByUserId: a.userId,
          reopenReason: dto.reason,
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) throw CommercialCoreService.conflict();
      // The snapshot is kept (history); only marked superseded.
      if (p.currentSnapshotId)
        await tx.profitabilitySnapshot.update({
          where: { id: p.currentSnapshotId },
          data: { supersededAt: new Date(), reopenReason: dto.reason },
        });
      await this.core.event(tx, a, {
        entityType: 'PROFITABILITY',
        entityId: shipmentId,
        lineageId: shipmentId,
        type: 'profitability.reopened',
        title: `Profitability reopened: ${dto.reason}`,
      });
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'profitability.reopened',
      entityType: 'ShipmentProfitability',
      entityId: p.id,
      metadata: { shipmentId, reason: dto.reason },
    });
    return this.detail(a, shipmentId);
  }

  /** Compact status for shipment / PO pages. */
  async shipmentStatus(a: Actor, shipmentId: string) {
    await this.shipment(a.organizationId, shipmentId);
    const { c } = await this.current(a.organizationId, shipmentId);
    return {
      ...this.toSummary(c),
      receivable: c.receivable,
      costLines: c.costs.length,
    };
  }
}
