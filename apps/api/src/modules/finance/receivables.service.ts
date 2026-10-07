import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AgingBucketRow,
  FinanceBuyerSummary,
  FinanceList,
  FinanceOverview,
  FxBasis,
  InstallmentTrigger,
  LetterOfCreditView,
  ParsedPaymentTerms,
  PaymentReceiptView,
  PaymentTermsSnapshot,
  PaymentTermsType,
  ReceivableDetail,
  ReceivablePrefill,
  ReceivableReminderView,
  ReceivableStatus,
  ReceivableSummary,
  CommercialInvoiceContent,
  DocumentTotals,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
  type Tx,
} from '../commercial/commercial-core.service';
import { D, type Dec } from '../costing/costing-calculator';
import { FinanceCoreService } from './finance-core.service';
import {
  addDays,
  agingBucket,
  allocate,
  dayDiff,
  installmentStatus,
  isoDay,
  m2,
  mask,
  parsePaymentTerms,
  paymentReminderMessage,
  receivableStatus,
  referenceKey,
  resolveDue,
  splitAmounts,
  type DueContext,
} from './finance-rules';
import type {
  CreateReceivableDto,
  DisputeDto,
  InstallmentDateDto,
  LcDto,
  ListQueryDto,
  PaymentDto,
  ReminderDto,
  UpdateReceivableDto,
} from './finance.dto';

const R_INCLUDE = {
  installments: { orderBy: { sequence: 'asc' } },
  payments: { orderBy: { receivedAt: 'asc' } },
  letterOfCredit: true,
  reminders: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.ReceivableInclude;
type R = Prisma.ReceivableGetPayload<{ include: typeof R_INCLUDE }>;
type Inst = R['installments'][number];

export interface ComputedInstallment {
  row: Inst;
  dueDate: Date | null;
  basis: string;
  status: ReceivableStatus;
  daysOverdue: number | null;
}
export interface Computed {
  r: R;
  status: ReceivableStatus;
  installments: ComputedInstallment[];
  nextDue: Date | null;
  daysOverdue: number | null;
  shipment: { id: string; shipmentNumber: string } | null;
}

const LC_DOCS_DEFAULT = [
  'Commercial invoice',
  'Packing list',
  'Bill of lading',
  'Certificate of origin',
];

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CommercialCoreService,
    private readonly fin: FinanceCoreService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- context

  private async contexts(org: string, rows: R[]) {
    const poIds = [...new Set(rows.map((r) => r.purchaseOrderId))];
    const [pos, pis, ships, buyers, cis] = await Promise.all([
      this.prisma.buyerPurchaseOrder.findMany({
        where: { organizationId: org, id: { in: poIds } },
        select: {
          id: true,
          poNumber: true,
          reviewedAt: true,
          status: true,
          proformaInvoiceId: true,
        },
      }),
      this.prisma.proformaInvoice.findMany({
        where: {
          organizationId: org,
          id: {
            in: rows
              .map((r) => r.proformaInvoiceId)
              .filter((x): x is string => !!x),
          },
        },
        select: { id: true, piNumber: true, issuedAt: true },
      }),
      this.prisma.shipment.findMany({
        where: {
          organizationId: org,
          purchaseOrderId: { in: poIds },
          status: { not: 'CANCELLED' },
        },
        select: {
          id: true,
          shipmentNumber: true,
          purchaseOrderId: true,
          etd: true,
          actualDeparture: true,
          deliveredAt: true,
        },
      }),
      this.prisma.buyerCompany.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.buyerCompanyId))] } },
        select: { id: true, canonicalName: true, countryCode: true },
      }),
      this.prisma.tradeDocument.findMany({
        where: {
          organizationId: org,
          id: {
            in: rows
              .map((r) => r.commercialInvoiceId)
              .filter((x): x is string => !!x),
          },
        },
        select: { id: true, documentNumber: true },
      }),
    ]);
    return { pos, pis, ships, buyers, cis };
  }

  private shipmentFor(
    r: R,
    ships: {
      id: string;
      shipmentNumber: string;
      purchaseOrderId: string;
      etd: Date | null;
      actualDeparture: Date | null;
      deliveredAt: Date | null;
    }[],
  ) {
    if (r.shipmentId) return ships.find((s) => s.id === r.shipmentId) ?? null;
    const onPo = ships.filter((s) => s.purchaseOrderId === r.purchaseOrderId);
    return onPo.length === 1 ? onPo[0] : null;
  }

  compute(
    r: R,
    ctx: Awaited<ReturnType<ReceivablesService['contexts']>>,
    dueSoonDays: number,
    today = new Date(),
  ): Computed {
    const po = ctx.pos.find((p) => p.id === r.purchaseOrderId);
    const pi = ctx.pis.find((p) => p.id === r.proformaInvoiceId);
    const sh = this.shipmentFor(r, ctx.ships);
    const due: DueContext = {
      type: r.paymentTermsType as PaymentTermsType,
      poAcceptedAt: po?.status === 'ACCEPTED' ? (po.reviewedAt ?? null) : null,
      piIssuedAt: pi?.issuedAt ?? null,
      shipmentEtd: sh?.etd ?? null,
      shipmentDeparted: sh?.actualDeparture ?? null,
      deliveredAt: sh?.deliveredAt ?? null,
      documentsPresentedAt: r.documentsPresentedAt,
      acceptedAt: r.acceptedAt,
    };
    const installments = r.installments.map((i) => {
      const { dueDate, basis } = resolveDue(i, due);
      const s = installmentStatus({
        outstanding: new D(i.outstandingAmount.toString()),
        paid: new D(i.paidAmount.toString()),
        dueDate,
        disputed: Boolean(i.disputedAt),
        today,
        dueSoonDays,
      });
      return { row: i, dueDate, basis, ...s };
    });
    const open = installments.filter((i) => i.status !== 'PAID');
    const nextDue =
      open
        .map((i) => i.dueDate)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return {
      r,
      installments,
      nextDue,
      daysOverdue:
        Math.max(0, ...installments.map((i) => i.daysOverdue ?? 0)) || null,
      shipment: sh ? { id: sh.id, shipmentNumber: sh.shipmentNumber } : null,
      status: receivableStatus({
        state: r.state,
        outstanding: new D(r.outstandingAmount.toString()),
        paid: new D(r.paidAmount.toString()),
        disputed: Boolean(r.disputedAt),
        installments: installments.map((i) => i.status),
      }),
    };
  }

  /** All receivables of an organization with read-time status (deterministic, no scheduler). */
  async computedAll(org: string, where: Prisma.ReceivableWhereInput = {}) {
    const rows = await this.prisma.receivable.findMany({
      where: { organizationId: org, ...where },
      include: R_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const ctx = await this.contexts(org, rows);
    const { dueSoonDays } = await this.fin.settings(org);
    return { list: rows.map((r) => this.compute(r, ctx, dueSoonDays)), ctx };
  }

  private async load(org: string, id: string) {
    const r = await this.prisma.receivable.findFirst({
      where: { id, organizationId: org },
      include: R_INCLUDE,
    });
    if (!r) throw new NotFoundException('Receivable not found.');
    return r;
  }

  // ---------------------------------------------------------------- prefill

  async prefill(
    a: Actor,
    poId: string,
    shipmentId?: string,
  ): Promise<ReceivablePrefill> {
    const org = a.organizationId;
    const po = await this.prisma.buyerPurchaseOrder.findFirst({
      where: { id: poId, organizationId: org },
      include: { proformaInvoice: true, quotation: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found.');
    const buyer = await this.prisma.buyerCompany.findFirst({
      where: { id: po.buyerCompanyId },
      select: { canonicalName: true },
    });
    const ci = await this.commercialInvoice(org, poId);
    const terms = this.termsSource(po, ci);
    const total = ci?.total
      ? new D(ci.total)
      : po.totalAmount
        ? new D(po.totalAmount.toString())
        : po.proformaInvoice
          ? new D(po.proformaInvoice.totalAmount.toString())
          : null;
    const parsed = parsePaymentTerms(terms.wording, total);
    const shipments = await this.prisma.shipment.findMany({
      where: {
        organizationId: org,
        purchaseOrderId: poId,
        status: { not: 'CANCELLED' },
      },
      select: { id: true, shipmentNumber: true },
    });
    const sh = shipmentId
      ? shipments.find((s) => s.id === shipmentId)
      : shipments.length === 1
        ? shipments[0]
        : null;
    if (shipmentId && !sh) throw new NotFoundException('Shipment not found.');
    const existing = await this.prisma.receivable.findFirst({
      where: {
        organizationId: org,
        purchaseOrderId: poId,
        state: { not: 'CANCELLED' },
        ...(sh && shipments.length > 1 ? { shipmentId: sh.id } : {}),
      },
      select: { id: true },
    });
    return {
      purchaseOrder: {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        buyerName: buyer?.canonicalName ?? 'Buyer',
      },
      currency: ci?.currency ?? po.currency,
      totalAmount: total ? m2(total) : null,
      totalSource: ci?.total
        ? `Commercial invoice ${ci.number ?? ''}`.trim()
        : po.totalAmount
          ? `Buyer PO ${po.poNumber}`
          : po.proformaInvoice
            ? `PI ${po.proformaInvoice.piNumber}`
            : 'Not available',
      terms: { ...parsed, source: terms.source },
      commercialInvoice: ci
        ? {
            id: ci.id,
            number: ci.number,
            invoiceDate: ci.invoiceDate,
            total: ci.total,
          }
        : null,
      shipment: sh ?? null,
      existingReceivableId: existing?.id ?? null,
    };
  }

  /** Agreed wording, in order of authority: accepted PO, then PI, then quotation. */
  private termsSource(
    po: {
      id: string;
      poNumber: string;
      paymentTerms: string | null;
      proformaInvoice: {
        id: string;
        piNumber: string;
        paymentTerms: string | null;
      } | null;
      quotation: {
        id: string;
        quotationNumber: string;
        paymentTerms: string | null;
      } | null;
    },
    ci: {
      paymentTerms: string | null;
      id: string;
      number: string | null;
    } | null,
  ): {
    wording: string | null;
    source: PaymentTermsSnapshot['source'];
    sourceId: string | null;
    ref: string | null;
  } {
    if (po.paymentTerms?.trim())
      return {
        wording: po.paymentTerms.trim(),
        source: 'PURCHASE_ORDER',
        sourceId: po.id,
        ref: po.poNumber,
      };
    if (po.proformaInvoice?.paymentTerms?.trim())
      return {
        wording: po.proformaInvoice.paymentTerms.trim(),
        source: 'PROFORMA_INVOICE',
        sourceId: po.proformaInvoice.id,
        ref: po.proformaInvoice.piNumber,
      };
    if (po.quotation?.paymentTerms?.trim())
      return {
        wording: po.quotation.paymentTerms.trim(),
        source: 'QUOTATION',
        sourceId: po.quotation.id,
        ref: po.quotation.quotationNumber,
      };
    if (ci?.paymentTerms?.trim())
      return {
        wording: ci.paymentTerms.trim(),
        source: 'COMMERCIAL_INVOICE',
        sourceId: ci.id,
        ref: ci.number,
      };
    return { wording: null, source: 'MANUAL', sourceId: null, ref: null };
  }

  /** Latest approved (else latest) commercial invoice for the PO (Sprint 16). */
  async commercialInvoice(org: string, poId: string) {
    const docs = await this.prisma.tradeDocument.findMany({
      where: {
        organizationId: org,
        purchaseOrderId: poId,
        documentType: 'COMMERCIAL_INVOICE',
        status: { notIn: ['ARCHIVED', 'SUPERSEDED', 'REJECTED'] },
      },
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    });
    const d = docs.find((x) => x.status === 'APPROVED') ?? docs[0];
    if (!d) return null;
    const content = ((d.snapshot as { content?: unknown } | null)?.content ??
      d.content) as CommercialInvoiceContent | null;
    const totals = ((d.snapshot as { totals?: unknown } | null)?.totals ??
      d.totals) as DocumentTotals | null;
    return {
      id: d.id,
      number: d.documentNumber,
      status: d.status,
      currency: content?.currency ?? null,
      invoiceDate:
        content?.invoiceDate ?? (d.issueDate ? isoDay(d.issueDate) : null),
      total: d.status === 'APPROVED' ? (totals?.total ?? null) : null,
      paymentTerms: content?.paymentTerms ?? null,
    };
  }

  // ---------------------------------------------------------------- create

  async create(a: Actor, dto: CreateReceivableDto) {
    const org = a.organizationId;
    const po = await this.prisma.buyerPurchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, organizationId: org },
      include: { proformaInvoice: true, quotation: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found.');
    if (po.status !== 'ACCEPTED')
      throw new ConflictException({
        message: 'Receivables are created from accepted buyer POs only.',
        details: { code: 'PO_NOT_ACCEPTED' },
      });
    const pre = await this.prefill(a, po.id, dto.shipmentId);
    if (pre.existingReceivableId)
      throw new ConflictException({
        message: 'This order already has an open receivable.',
        details: {
          code: 'RECEIVABLE_EXISTS',
          receivableId: pre.existingReceivableId,
        },
      });
    if (!pre.totalAmount)
      throw new BadRequestException({
        message:
          'The order has no agreed total amount — record it on the PO or commercial invoice first.',
        details: { code: 'TOTAL_MISSING' },
      });
    const total = new D(pre.totalAmount);
    const ci = pre.commercialInvoice;
    const type = dto.paymentTermsType as PaymentTermsType;
    const parsed = pre.terms;
    const fromDocs =
      parsed.recognized && parsed.type === type && !dto.installments?.length;
    let schedule = dto.installments?.length
      ? dto.installments.map((i) => ({
          label: i.label.trim(),
          percentage: i.percentage ?? null,
          amount: new D(i.amount).toFixed(2),
          triggerType: i.triggerType as InstallmentTrigger,
          dueDays: i.dueDays ?? null,
          fixedDate: i.fixedDate ? i.fixedDate.slice(0, 10) : null,
        }))
      : parsed.type === type
        ? parsed.installments
        : [];
    if (!schedule.length)
      throw new BadRequestException({
        message:
          'Define the installment schedule — it could not be read from the agreed terms.',
        details: { code: 'SCHEDULE_REQUIRED' },
      });
    if (!fromDocs && !dto.confirmCustomSchedule)
      throw new ConflictException({
        message:
          'This schedule was not read from the agreed commercial terms. Confirm the custom schedule to continue.',
        details: { code: 'CUSTOM_SCHEDULE_CONFIRMATION_REQUIRED', parsed },
      });
    const sum = schedule.reduce((s, i) => s.plus(i.amount), new D(0));
    if (!sum.eq(total))
      throw new BadRequestException({
        message: `Installments add up to ${m2(sum)}, not the agreed total ${m2(total)}.`,
        details: { code: 'SCHEDULE_TOTAL_MISMATCH' },
      });
    // Open account: due = invoice date + credit days.
    const invoiceDate = dto.invoiceDate
      ? new Date(dto.invoiceDate)
      : ci?.invoiceDate
        ? new Date(ci.invoiceDate)
        : null;
    const termDays = dto.termDays ?? parsed.termDays ?? null;
    if (type === 'OPEN_ACCOUNT') {
      if (termDays === null)
        throw new BadRequestException({
          message: 'Enter the open-account credit days (e.g. Net 30).',
          details: { code: 'TERM_DAYS_REQUIRED' },
        });
      schedule = schedule.map((i) => ({
        ...i,
        triggerType: 'FIXED_DATE' as const,
        dueDays: termDays,
        fixedDate: invoiceDate ? isoDay(addDays(invoiceDate, termDays)) : null,
      }));
    }
    const tenorDays = dto.tenorDays ?? parsed.tenorDays ?? null;
    if (type === 'DOCUMENTS_AGAINST_ACCEPTANCE') {
      if (tenorDays === null)
        throw new BadRequestException({
          message: 'Enter the D/A tenor in days.',
          details: { code: 'TENOR_REQUIRED' },
        });
      schedule = schedule.map((i) => ({
        ...i,
        triggerType: 'ON_DOCUMENT_PRESENTATION' as const,
        dueDays: tenorDays,
      }));
    }
    const settings = await this.fin.settings(org);
    let bookingFx: FxBasis | null = null;
    if (pre.currency !== settings.reportingCurrency) {
      const fx = dto.bookingFx
        ? this.fin.explicit(
            pre.currency,
            settings.reportingCurrency,
            dto.bookingFx,
          )
        : await this.fin.latestRate(
            org,
            pre.currency,
            settings.reportingCurrency,
          );
      bookingFx = fx?.basis ?? null;
    }
    const snapshot: PaymentTermsSnapshot = {
      type,
      wording: parsed.wording,
      source: fromDocs ? (parsed.source ?? 'MANUAL') : 'MANUAL',
      sourceId: fromDocs
        ? parsed.source === 'PURCHASE_ORDER'
          ? po.id
          : parsed.source === 'PROFORMA_INVOICE'
            ? (po.proformaInvoiceId ?? null)
            : parsed.source === 'QUOTATION'
              ? (po.quotationId ?? null)
              : (ci?.id ?? null)
        : null,
      sourceReference: fromDocs
        ? parsed.source === 'PURCHASE_ORDER'
          ? po.poNumber
          : parsed.source === 'PROFORMA_INVOICE'
            ? (po.proformaInvoice?.piNumber ?? null)
            : parsed.source === 'QUOTATION'
              ? (po.quotation?.quotationNumber ?? null)
              : (ci?.number ?? null)
        : null,
      currency: pre.currency,
      totalAmount: m2(total),
      installments: schedule,
      references: {
        purchaseOrder: po.poNumber,
        proformaInvoice: po.proformaInvoice?.piNumber ?? null,
        quotation: po.quotation?.quotationNumber ?? null,
      },
      capturedAt: new Date().toISOString(),
    };
    const buyer = await this.prisma.buyerCompany.findFirst({
      where: { id: po.buyerCompanyId },
      select: { canonicalName: true },
    });
    const destination =
      (
        await this.prisma.shipment.findFirst({
          where: { id: pre.shipment?.id ?? '' },
          select: { destinationCountry: true },
        })
      )?.destinationCountry ??
      po.proformaInvoice?.destinationCountry ??
      po.quotation?.destinationCountry ??
      null;
    const r = await this.prisma.$transaction(async (tx) => {
      const number = await this.core.nextNumber(tx, org, 'RCV', 'RCV', true);
      const row = await tx.receivable.create({
        data: {
          organizationId: org,
          receivableNumber: number,
          buyerCompanyId: po.buyerCompanyId,
          purchaseOrderId: po.id,
          shipmentId: pre.shipment?.id ?? null,
          proformaInvoiceId: po.proformaInvoiceId,
          quotationId: po.quotationId,
          commercialInvoiceId: ci?.id ?? null,
          crmLeadId: po.crmLeadId,
          destinationCountry: destination,
          currency: pre.currency,
          totalAmount: total,
          outstandingAmount: total,
          paymentTermsType: type,
          paymentTermsText: parsed.wording,
          paymentTermsSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          customConfirmed: !fromDocs,
          invoiceDate,
          termDays,
          tenorDays,
          collectingBank: dto.collectingBank ?? null,
          bookingFx: (bookingFx ?? undefined) as unknown as
            Prisma.InputJsonValue | undefined,
          notes: dto.notes ?? null,
          createdByUserId: a.userId,
          installments: {
            create: schedule.map((i, k) => ({
              organizationId: org,
              sequence: k + 1,
              label: i.label,
              percentage: i.percentage,
              amount: new D(i.amount),
              outstandingAmount: new D(i.amount),
              triggerType: i.triggerType,
              dueDays: i.dueDays,
              fixedDate: i.fixedDate ? new Date(i.fixedDate) : null,
            })),
          },
        },
      });
      await this.event(
        tx,
        a,
        row.id,
        'receivable.created',
        `Receivable ${number} created — ${pre.currency} ${m2(total)} (${type.replace(/_/g, ' ').toLowerCase()}${fromDocs ? `, terms from ${snapshot.source.replace(/_/g, ' ').toLowerCase()}` : ', custom schedule confirmed'})`,
      );
      await this.core.crmActivity(
        tx,
        org,
        po.crmLeadId,
        `Receivable ${number} created (${pre.currency} ${m2(total)})`,
        a.userId,
        { receivableId: row.id },
      );
      return row;
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'receivable.created',
      entityType: 'Receivable',
      entityId: r.id,
      metadata: {
        purchaseOrderId: po.id,
        type,
        total: m2(total),
        currency: pre.currency,
        custom: !fromDocs,
      },
    });
    void buyer;
    return this.detail(a, r.id);
  }

  private event(
    tx: Tx | PrismaService,
    a: Actor,
    id: string,
    type: string,
    title: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.core.event(tx as Tx, a, {
      entityType: 'RECEIVABLE',
      entityId: id,
      lineageId: id,
      type,
      title,
      metadata,
    });
  }

  // ---------------------------------------------------------------- reads

  private summary(
    c: Computed,
    ctx: Awaited<ReturnType<ReceivablesService['contexts']>>,
  ): ReceivableSummary {
    const r = c.r;
    const po = ctx.pos.find((p) => p.id === r.purchaseOrderId);
    const b = ctx.buyers.find((x) => x.id === r.buyerCompanyId);
    const ci = ctx.cis.find((x) => x.id === r.commercialInvoiceId);
    return {
      id: r.id,
      receivableNumber: r.receivableNumber,
      buyer: { id: r.buyerCompanyId, name: b?.canonicalName ?? 'Buyer' },
      purchaseOrder: { id: r.purchaseOrderId, poNumber: po?.poNumber ?? '' },
      shipment: c.shipment,
      commercialInvoice: r.commercialInvoiceId
        ? { id: r.commercialInvoiceId, number: ci?.documentNumber ?? null }
        : null,
      destinationCountry: r.destinationCountry,
      currency: r.currency,
      totalAmount: m2(new D(r.totalAmount.toString())),
      receivedAmount: m2(new D(r.paidAmount.toString())),
      outstandingAmount: m2(new D(r.outstandingAmount.toString())),
      nextDueDate: isoDay(c.nextDue),
      status: c.status,
      paymentTermsType: r.paymentTermsType as PaymentTermsType,
      daysOverdue: c.daysOverdue,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async list(
    a: Actor,
    q: ListQueryDto,
  ): Promise<FinanceList<ReceivableSummary>> {
    const where: Prisma.ReceivableWhereInput = {
      ...(q.buyerCompanyId ? { buyerCompanyId: q.buyerCompanyId } : {}),
      ...(q.purchaseOrderId ? { purchaseOrderId: q.purchaseOrderId } : {}),
      ...(q.commercialInvoiceId
        ? { commercialInvoiceId: q.commercialInvoiceId }
        : {}),
      ...(q.crmLeadId ? { crmLeadId: q.crmLeadId } : {}),
      ...(q.country ? { destinationCountry: q.country } : {}),
      ...(q.currency ? { currency: q.currency } : {}),
      ...(q.ownerUserId
        ? { ownerUserId: q.ownerUserId === 'me' ? a.userId : q.ownerUserId }
        : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: addDays(new Date(q.to), 1) } : {}),
            },
          }
        : {}),
    };
    const { list, ctx } = await this.computedAll(a.organizationId, where);
    let rows = list.map((c) => this.summary(c, ctx));
    if (q.shipmentId)
      rows = rows.filter((r) => r.shipment?.id === q.shipmentId);
    if (q.status)
      rows = rows.filter((r) =>
        q.status === 'OPEN'
          ? !['PAID', 'CANCELLED', 'UNCOLLECTIBLE'].includes(r.status)
          : r.status === q.status,
      );
    const t = q.search?.trim().toLowerCase();
    if (t)
      rows = rows.filter((r) =>
        [
          r.receivableNumber,
          r.buyer.name,
          r.purchaseOrder.poNumber,
          r.shipment?.shipmentNumber,
          r.commercialInvoice?.number,
        ].some((x) => x?.toLowerCase().includes(t)),
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

  async detail(a: Actor, id: string): Promise<ReceivableDetail> {
    const org = a.organizationId;
    const r = await this.load(org, id);
    const ctx = await this.contexts(org, [r]);
    const { dueSoonDays } = await this.fin.settings(org);
    const c = this.compute(r, ctx, dueSoonDays);
    await this.recordDueEvents(a, c);
    const names = await this.core.userNames([
      ...r.payments.map((p) => p.recordedByUserId),
      ...r.payments.map((p) => p.reversedByUserId),
      ...r.reminders.map((x) => x.recordedByUserId),
    ]);
    const pi = ctx.pis.find((p) => p.id === r.proformaInvoiceId);
    const q = r.quotationId
      ? await this.prisma.quotation.findFirst({
          where: { id: r.quotationId, organizationId: org },
          select: { quotationNumber: true },
        })
      : null;
    const events = await this.core.events(org, [r.id]);
    const can = (p: Parameters<FinanceCoreService['can']>[1]) =>
      this.fin.can(a, p);
    const open = r.state === 'OPEN';
    const actions: string[] = [];
    if (
      open &&
      can('payments.record') &&
      new D(r.outstandingAmount.toString()).gt(0)
    )
      actions.push('record_payment');
    if (can('payments.reverse')) actions.push('reverse_payment');
    if (open && can('receivables.manage'))
      actions.push(
        'edit',
        'reminders',
        'letter_of_credit',
        // Disputes only while money is outstanding; cancel only before any payment.
        ...(new D(r.outstandingAmount.toString()).gt(0) ? ['dispute'] : []),
        ...(new D(r.paidAmount.toString()).isZero() ? ['cancel'] : []),
      );
    const bookingFx = (r.bookingFx ?? null) as unknown as FxBasis | null;
    return {
      ...this.summary(c, ctx),
      rowVersion: r.rowVersion,
      paymentTermsText: r.paymentTermsText,
      termsSnapshot: r.paymentTermsSnapshot as unknown as PaymentTermsSnapshot,
      customConfirmed: r.customConfirmed,
      invoiceDate: isoDay(r.invoiceDate),
      termDays: r.termDays,
      documentsPresentedAt: isoDay(r.documentsPresentedAt),
      collectingBank: r.collectingBank,
      acceptedAt: isoDay(r.acceptedAt),
      tenorDays: r.tenorDays,
      maturityDate:
        r.paymentTermsType === 'DOCUMENTS_AGAINST_ACCEPTANCE' &&
        r.acceptedAt &&
        r.tenorDays !== null
          ? isoDay(addDays(r.acceptedAt, r.tenorDays))
          : null,
      paymentReceivedAt: isoDay(r.paymentReceivedAt),
      bookingFx,
      proformaInvoice: pi ? { id: pi.id, number: pi.piNumber } : null,
      quotation:
        r.quotationId && q
          ? { id: r.quotationId, number: q.quotationNumber }
          : null,
      crmLeadId: r.crmLeadId,
      installments: c.installments.map((i) => ({
        id: i.row.id,
        sequence: i.row.sequence,
        label: i.row.label,
        percentage: i.row.percentage?.toString() ?? null,
        amount: m2(new D(i.row.amount.toString())),
        triggerType: i.row.triggerType as InstallmentTrigger,
        dueDays: i.row.dueDays,
        fixedDate: isoDay(i.row.fixedDate),
        dueDate: isoDay(i.dueDate),
        dueBasis: i.basis,
        paidAmount: m2(new D(i.row.paidAmount.toString())),
        outstandingAmount: m2(new D(i.row.outstandingAmount.toString())),
        status: i.status,
        daysOverdue: i.daysOverdue,
        dispute: i.row.disputedAt
          ? {
              amount: i.row.disputeAmount?.toString() ?? null,
              reason: i.row.disputeReason ?? '',
              at: i.row.disputedAt.toISOString(),
              notes: i.row.disputeNotes,
            }
          : null,
      })),
      payments: r.payments.map((p) =>
        this.paymentView(p, bookingFx, names, r.currency),
      ),
      letterOfCredit: r.letterOfCredit
        ? await this.lcView(org, r.letterOfCredit)
        : null,
      reminders: r.reminders
        .filter((x) => x.status !== 'DISMISSED')
        .map((x) => this.reminderView(x, names)),
      dispute: r.disputedAt
        ? {
            amount: r.disputeAmount?.toString() ?? null,
            reason: r.disputeReason ?? '',
            at: r.disputedAt.toISOString(),
            notes: r.disputeNotes,
          }
        : null,
      uncollectible: r.uncollectibleAt
        ? {
            reason: r.uncollectibleReason ?? '',
            at: r.uncollectibleAt.toISOString(),
          }
        : null,
      notes: r.notes,
      events,
      availableActions: actions,
    };
  }

  /** Domain events for an installment first seen due/overdue (once each; separate from AuditLog). */
  private async recordDueEvents(a: Actor, c: Computed) {
    const due = c.installments.filter(
      (i) => i.status === 'OVERDUE' || i.status === 'DUE',
    );
    if (!due.length) return;
    const existing = await this.prisma.commercialEvent.findMany({
      where: {
        organizationId: a.organizationId,
        lineageId: c.r.id,
        type: { in: ['installment.due', 'installment.overdue'] },
      },
      select: { type: true, metadata: true },
    });
    for (const i of due) {
      const type =
        i.status === 'OVERDUE' ? 'installment.overdue' : 'installment.due';
      if (
        existing.some(
          (e) =>
            e.type === type &&
            (e.metadata as { installmentId?: string } | null)?.installmentId ===
              i.row.id,
        )
      )
        continue;
      await this.prisma.commercialEvent.create({
        data: {
          organizationId: a.organizationId,
          entityType: 'RECEIVABLE',
          entityId: c.r.id,
          lineageId: c.r.id,
          type,
          title: `${i.row.label}: ${c.r.currency} ${m2(new D(i.row.outstandingAmount.toString()))} ${i.status === 'OVERDUE' ? `overdue since ${isoDay(i.dueDate)}` : 'due today'}`,
          metadata: { installmentId: i.row.id },
        },
      });
    }
  }

  private paymentView(
    p: R['payments'][number],
    booking: FxBasis | null,
    names: Map<string, string>,
    receivableCurrency: string,
  ): PaymentReceiptView {
    const applied = new D(p.appliedAmount.toString());
    const settle = p.settlementFxRate
      ? new D(p.settlementFxRate.toString())
      : null;
    const fxGainLoss =
      p.status === 'RECORDED' && settle && booking
        ? m2(applied.mul(settle.minus(booking.rate)))
        : null;
    return {
      id: p.id,
      installmentId: p.installmentId,
      amount: m2(new D(p.amount.toString())),
      currency: p.currency,
      receivedAt: p.receivedAt.toISOString(),
      paymentMethod: p.paymentMethod as PaymentReceiptView['paymentMethod'],
      bankReference: mask(p.bankReference),
      remittanceReference: mask(p.remittanceReference),
      bankName: p.bankName,
      notes: p.notes,
      source: p.source,
      fx: p.fxRate
        ? {
            rate: p.fxRate.toString(),
            from: p.currency,
            to: receivableCurrency,
            sourceLabel: p.fxSourceLabel,
            sourceDate: isoDay(p.fxSourceDate),
            snapshotId: p.fxSnapshotId,
            convertedAmount: m2(
              new D(p.amount.toString()).mul(p.fxRate.toString()),
            ),
          }
        : null,
      appliedAmount: m2(applied),
      excessAmount: m2(new D(p.excessAmount.toString())),
      overpaymentReason: p.overpaymentReason,
      settlementFx: settle
        ? {
            rate: settle.toString(),
            from: receivableCurrency,
            to: booking?.to ?? receivableCurrency,
            sourceLabel: p.settlementFxSource,
            sourceDate: isoDay(p.settlementFxDate),
            snapshotId: null,
          }
        : null,
      charges: (p.charges ?? []) as PaymentReceiptView['charges'],
      fxGainLoss,
      status: p.status as PaymentReceiptView['status'],
      reversal: p.reversedAt
        ? {
            reason: p.reversalReason ?? '',
            by: p.reversedByUserId
              ? (names.get(p.reversedByUserId) ?? null)
              : null,
            at: p.reversedAt.toISOString(),
          }
        : null,
      recordedBy: names.get(p.recordedByUserId) ?? null,
      createdAt: p.createdAt.toISOString(),
    };
  }

  private reminderView(
    x: R['reminders'][number],
    names: Map<string, string>,
  ): ReceivableReminderView {
    return {
      id: x.id,
      installmentId: x.installmentId,
      kind: x.kind as ReceivableReminderView['kind'],
      status: x.status as ReceivableReminderView['status'],
      subject: x.subject,
      message: x.message,
      dueAmount: m2(new D(x.dueAmount.toString())),
      currency: x.currency,
      dueDate: isoDay(x.dueDate),
      channel: x.channel,
      recordedSentAt: x.recordedSentAt?.toISOString() ?? null,
      recordedSentBy: x.recordedByUserId
        ? (names.get(x.recordedByUserId) ?? null)
        : null,
      createdAt: x.createdAt.toISOString(),
    };
  }

  async terms(a: Actor, poId: string): Promise<ParsedPaymentTerms> {
    return (await this.prefill(a, poId)).terms;
  }

  // ---------------------------------------------------------------- edits

  private guard(r: { rowVersion: number }, v?: number) {
    if (v !== undefined && v !== r.rowVersion)
      throw CommercialCoreService.conflict();
  }

  async update(a: Actor, id: string, dto: UpdateReceivableDto) {
    const org = a.organizationId;
    const r = await this.load(org, id);
    this.guard(r, dto.expectedRowVersion);
    if (r.state !== 'OPEN')
      throw new ConflictException(
        `A ${r.state.toLowerCase()} receivable cannot be edited.`,
      );
    const data: Prisma.ReceivableUpdateInput = { rowVersion: { increment: 1 } };
    const changed: string[] = [];
    const dt = (v: string | null | undefined) =>
      v === undefined ? undefined : v ? new Date(v) : null;
    for (const k of [
      'invoiceDate',
      'documentsPresentedAt',
      'acceptedAt',
    ] as const)
      if (dto[k] !== undefined) {
        data[k] = dt(dto[k]);
        changed.push(k);
      }
    for (const k of [
      'termDays',
      'tenorDays',
      'collectingBank',
      'ownerUserId',
      'notes',
    ] as const)
      if (dto[k] !== undefined) {
        (data as Record<string, unknown>)[k] = dto[k];
        changed.push(k);
      }
    if (dto.shipmentId !== undefined) {
      if (dto.shipmentId) {
        const sh = await this.prisma.shipment.findFirst({
          where: {
            id: dto.shipmentId,
            organizationId: org,
            purchaseOrderId: r.purchaseOrderId,
          },
        });
        if (!sh)
          throw new NotFoundException('Shipment not found for this order.');
        data.destinationCountry = sh.destinationCountry ?? r.destinationCountry;
      }
      data.shipmentId = dto.shipmentId;
      changed.push('shipmentId');
    }
    if (dto.bookingFx) {
      const s = await this.fin.settings(org);
      data.bookingFx = this.fin.explicit(
        r.currency,
        s.reportingCurrency,
        dto.bookingFx,
      ).basis as unknown as Prisma.InputJsonValue;
      changed.push('bookingFx');
    }
    if (dto.state) {
      if (!dto.reason) throw new BadRequestException('A reason is required.');
      if (dto.state === 'CANCELLED' && new D(r.paidAmount.toString()).gt(0))
        throw new ConflictException(
          'Reverse the recorded payments before cancelling this receivable.',
        );
      data.state = dto.state;
      if (dto.state === 'CANCELLED') data.cancelReason = dto.reason;
      else {
        data.uncollectibleReason = dto.reason;
        data.uncollectibleAt = new Date();
      }
      changed.push('state');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.receivable.update({ where: { id }, data });
      // Open account: keep the due date tied to invoice date + credit days.
      if (
        r.paymentTermsType === 'OPEN_ACCOUNT' &&
        (dto.invoiceDate !== undefined || dto.termDays !== undefined)
      ) {
        const inv =
          dto.invoiceDate !== undefined ? dt(dto.invoiceDate) : r.invoiceDate;
        const days = dto.termDays !== undefined ? dto.termDays : r.termDays;
        await tx.receivableInstallment.updateMany({
          where: { receivableId: id },
          data: {
            dueDays: days,
            fixedDate: inv && days !== null ? addDays(inv, days) : null,
          },
        });
      }
      if (
        r.paymentTermsType === 'DOCUMENTS_AGAINST_ACCEPTANCE' &&
        dto.tenorDays !== undefined
      )
        await tx.receivableInstallment.updateMany({
          where: { receivableId: id },
          data: { dueDays: dto.tenorDays },
        });
      if (dto.state)
        await this.event(
          tx,
          a,
          id,
          `receivable.${dto.state.toLowerCase()}`,
          `Receivable ${dto.state === 'CANCELLED' ? 'cancelled' : 'marked uncollectible (operational status — not an accounting write-off)'}: ${dto.reason}`,
        );
      else if (changed.length)
        await this.event(
          tx,
          a,
          id,
          'receivable.updated',
          `Receivable updated (${changed.join(', ')})`,
        );
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'receivable.updated',
      entityType: 'Receivable',
      entityId: id,
      metadata: { fields: changed, state: dto.state ?? null },
    });
    return this.detail(a, id);
  }

  async setInstallmentDate(
    a: Actor,
    id: string,
    iid: string,
    dto: InstallmentDateDto,
  ) {
    const r = await this.load(a.organizationId, id);
    this.guard(r, dto.expectedRowVersion);
    const i = r.installments.find((x) => x.id === iid);
    if (!i) throw new NotFoundException('Installment not found.');
    if (
      ![
        'MANUAL',
        'FIXED_DATE',
        'BEFORE_PRODUCTION',
        'BEFORE_SHIPMENT',
      ].includes(i.triggerType) ||
      r.paymentTermsType === 'OPEN_ACCOUNT'
    )
      throw new ConflictException(
        'This installment’s due date follows its trigger and cannot be set manually.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.receivableInstallment.update({
        where: { id: iid },
        data: { fixedDate: dto.fixedDate ? new Date(dto.fixedDate) : null },
      });
      await tx.receivable.update({
        where: { id },
        data: { rowVersion: { increment: 1 } },
      });
      await this.event(
        tx,
        a,
        id,
        'receivable.updated',
        `${i.label}: due date set to ${dto.fixedDate?.slice(0, 10) ?? 'none'}`,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'receivable.updated',
      entityType: 'Receivable',
      entityId: id,
      metadata: { installmentId: iid, fixedDate: dto.fixedDate ?? null },
    });
    return this.detail(a, id);
  }

  async dispute(a: Actor, id: string, dto: DisputeDto) {
    const r = await this.load(a.organizationId, id);
    this.guard(r, dto.expectedRowVersion);
    if (r.state !== 'OPEN')
      throw new ConflictException('Only open receivables can be disputed.');
    const inst = dto.installmentId
      ? r.installments.find((x) => x.id === dto.installmentId)
      : null;
    if (dto.installmentId && !inst)
      throw new NotFoundException('Installment not found.');
    const data = dto.resolve
      ? {
          disputeAmount: null,
          disputeReason: null,
          disputeNotes: null,
          disputedAt: null,
        }
      : {
          disputeAmount: dto.amount ? new D(dto.amount) : null,
          disputeReason: dto.reason,
          disputeNotes: dto.notes ?? null,
          disputedAt: new Date(),
        };
    await this.prisma.$transaction(async (tx) => {
      if (inst)
        await tx.receivableInstallment.update({ where: { id: inst.id }, data });
      else await tx.receivable.update({ where: { id }, data });
      await tx.receivable.update({
        where: { id },
        data: { rowVersion: { increment: 1 } },
      });
      await this.event(
        tx,
        a,
        id,
        dto.resolve ? 'receivable.dispute_resolved' : 'receivable.disputed',
        dto.resolve
          ? `Dispute resolved${inst ? ` (${inst.label})` : ''}: ${dto.reason}`
          : `Disputed${inst ? ` (${inst.label})` : ''}${dto.amount ? ` — ${r.currency} ${dto.amount}` : ''}: ${dto.reason}`,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: dto.resolve
        ? 'receivable.dispute_resolved'
        : 'receivable.disputed',
      entityType: 'Receivable',
      entityId: id,
      metadata: { installmentId: inst?.id ?? null, amount: dto.amount ?? null },
    });
    return this.detail(a, id);
  }

  // ---------------------------------------------------------------- payments

  async recordPayment(a: Actor, id: string, dto: PaymentDto) {
    const org = a.organizationId;
    const r0 = await this.load(org, id);
    if (r0.state !== 'OPEN')
      throw new ConflictException(
        `Payments cannot be recorded on a ${r0.state.toLowerCase()} receivable.`,
      );
    if (
      dto.installmentId &&
      !r0.installments.some((i) => i.id === dto.installmentId)
    )
      throw new NotFoundException('Installment not found.');
    const amount = new D(dto.amount);
    if (amount.lte(0))
      throw new BadRequestException('Payment amount must be positive.');
    const receivedAt = new Date(dto.receivedAt);
    if (receivedAt.getTime() > Date.now() + 86400000)
      throw new BadRequestException(
        'The payment date cannot be in the future.',
      );
    // Settlement currency ≠ receivable currency → explicit FX only, never a silent conversion.
    let applied = amount;
    let fx: { rate: Dec; basis: FxBasis } | null = null;
    if (dto.currency !== r0.currency) {
      if (!dto.fx)
        throw new BadRequestException({
          message: `This payment is in ${dto.currency} but the receivable is in ${r0.currency}. Enter the exchange rate used (1 ${dto.currency} = ? ${r0.currency}).`,
          details: { code: 'FX_REQUIRED' },
        });
      fx = this.fin.explicit(dto.currency, r0.currency, dto.fx);
      applied = amount.mul(fx.rate).toDecimalPlaces(2);
    }
    const settings = await this.fin.settings(org);
    const settlement =
      r0.currency === settings.reportingCurrency
        ? {
            rate: new D(1),
            basis: {
              sourceLabel: 'Same currency',
              sourceDate: isoDay(receivedAt),
            },
          }
        : dto.settlementFx
          ? this.fin.explicit(
              r0.currency,
              settings.reportingCurrency,
              dto.settlementFx,
            )
          : null;
    const key = referenceKey(dto.bankReference, dto.remittanceReference);
    if (key) {
      const dup = await this.prisma.paymentReceipt.findFirst({
        where: { receivableId: id, referenceKey: key },
      });
      if (dup)
        throw new ConflictException({
          message:
            'A payment with this bank/remittance reference is already recorded on this receivable.',
          details: { code: 'DUPLICATE_PAYMENT', paymentId: dup.id },
        });
    }
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize balance updates for this receivable.
      await tx.$queryRaw`SELECT id FROM receivables WHERE id = ${id} FOR UPDATE`;
      const r = await tx.receivable.findUniqueOrThrow({
        where: { id },
        include: { installments: true },
      });
      this.guard(r, dto.expectedRowVersion);
      const outstanding = new D(r.outstandingAmount.toString());
      const { allocations, excess } = allocate(
        applied,
        r.installments.map((i) => ({
          id: i.id,
          sequence: i.sequence,
          outstanding: new D(i.outstandingAmount.toString()),
        })),
        dto.installmentId ?? null,
      );
      if (excess.gt(0)) {
        if (!dto.allowOverpayment)
          throw new ConflictException({
            message: `This payment exceeds the outstanding ${r.currency} ${m2(outstanding)} by ${m2(excess)}. Confirm the overpayment with a reason to record it.`,
            details: {
              code: 'OVERPAYMENT',
              outstanding: m2(outstanding),
              excess: m2(excess),
            },
          });
        if (!dto.overpaymentReason)
          throw new BadRequestException(
            'A reason is required to record an overpayment.',
          );
      }
      const used = applied.minus(excess);
      for (const al of allocations) {
        const i = r.installments.find((x) => x.id === al.installmentId)!;
        await tx.receivableInstallment.update({
          where: { id: i.id },
          data: {
            paidAmount: new D(i.paidAmount.toString()).plus(al.amount),
            outstandingAmount: new D(i.outstandingAmount.toString()).minus(
              al.amount,
            ),
          },
        });
      }
      const newOutstanding = outstanding.minus(used);
      await tx.receivable.update({
        where: { id },
        data: {
          paidAmount: new D(r.paidAmount.toString()).plus(used),
          outstandingAmount: newOutstanding,
          rowVersion: { increment: 1 },
          ...(newOutstanding.lte(0) ? { paymentReceivedAt: receivedAt } : {}),
        },
      });
      let p;
      try {
        p = await tx.paymentReceipt.create({
          data: {
            organizationId: org,
            receivableId: id,
            installmentId: dto.installmentId ?? null,
            amount,
            currency: dto.currency,
            receivedAt,
            paymentMethod: dto.paymentMethod,
            bankReference: dto.bankReference ?? null,
            remittanceReference: dto.remittanceReference ?? null,
            referenceKey: key,
            bankName: dto.bankName ?? null,
            notes: dto.notes ?? null,
            fxRate: fx?.rate ?? null,
            fxSourceLabel: fx?.basis.sourceLabel ?? null,
            fxSourceDate: fx?.basis.sourceDate
              ? new Date(fx.basis.sourceDate)
              : null,
            appliedAmount: used,
            excessAmount: excess,
            overpaymentReason: excess.gt(0) ? dto.overpaymentReason : null,
            allocations: allocations as unknown as Prisma.InputJsonValue,
            settlementFxRate: settlement?.rate ?? null,
            settlementFxSource: settlement?.basis.sourceLabel ?? null,
            settlementFxDate: settlement?.basis.sourceDate
              ? new Date(settlement.basis.sourceDate)
              : null,
            charges: (dto.charges?.length
              ? dto.charges.map((c) => ({
                  type: c.type,
                  amount: new D(c.amount).toFixed(2),
                  currency: c.currency,
                }))
              : undefined) as Prisma.InputJsonValue | undefined,
            recordedByUserId: a.userId,
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        )
          throw new ConflictException({
            message: 'A payment with this reference is already recorded.',
            details: { code: 'DUPLICATE_PAYMENT' },
          });
        throw e;
      }
      const paid = newOutstanding.lte(0);
      await this.event(
        tx,
        a,
        id,
        paid ? 'receivable.paid' : 'payment.partial',
        paid
          ? `Payment of ${dto.currency} ${m2(amount)} recorded — receivable fully paid`
          : `Partial payment of ${dto.currency} ${m2(amount)} recorded — ${r.currency} ${m2(newOutstanding)} outstanding`,
        { paymentId: p.id },
      );
      return { p, paid };
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'payment.recorded',
      entityType: 'Receivable',
      entityId: id,
      metadata: {
        paymentId: result.p.id,
        amount: m2(amount),
        currency: dto.currency,
        method: dto.paymentMethod,
        fullyPaid: result.paid,
      },
    });
    return this.detail(a, id);
  }

  async payments(a: Actor, id: string) {
    return (await this.detail(a, id)).payments;
  }

  async reversePayment(a: Actor, paymentId: string, reason: string) {
    const org = a.organizationId;
    const p0 = await this.prisma.paymentReceipt.findFirst({
      where: { id: paymentId, organizationId: org },
    });
    if (!p0) throw new NotFoundException('Payment not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM receivables WHERE id = ${p0.receivableId} FOR UPDATE`;
      const p = await tx.paymentReceipt.findUniqueOrThrow({
        where: { id: paymentId },
      });
      if (p.status !== 'RECORDED')
        throw new ConflictException('This payment has already been reversed.');
      const r = await tx.receivable.findUniqueOrThrow({
        where: { id: p.receivableId },
        include: { installments: true },
      });
      for (const al of p.allocations as {
        installmentId: string;
        amount: string;
      }[]) {
        const i = r.installments.find((x) => x.id === al.installmentId);
        if (!i) continue;
        await tx.receivableInstallment.update({
          where: { id: i.id },
          data: {
            paidAmount: new D(i.paidAmount.toString()).minus(al.amount),
            outstandingAmount: new D(i.outstandingAmount.toString()).plus(
              al.amount,
            ),
          },
        });
      }
      const applied = new D(p.appliedAmount.toString());
      await tx.receivable.update({
        where: { id: r.id },
        data: {
          paidAmount: new D(r.paidAmount.toString()).minus(applied),
          outstandingAmount: new D(r.outstandingAmount.toString()).plus(
            applied,
          ),
          paymentReceivedAt: null,
          rowVersion: { increment: 1 },
        },
      });
      // Original kept; the reference is freed so the corrected payment can be recorded.
      await tx.paymentReceipt.update({
        where: { id: p.id },
        data: {
          status: 'REVERSED',
          reversalReason: reason,
          reversedByUserId: a.userId,
          reversedAt: new Date(),
          referenceKey: p.referenceKey
            ? `${p.referenceKey}#REVERSED#${p.id}`
            : null,
        },
      });
      await this.event(
        tx,
        a,
        r.id,
        'payment.reversed',
        `Payment of ${p.currency} ${m2(new D(p.amount.toString()))} reversed: ${reason}`,
        { paymentId: p.id },
      );
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'payment.reversed',
      entityType: 'Receivable',
      entityId: p0.receivableId,
      metadata: { paymentId, reason },
    });
    return this.detail(a, p0.receivableId);
  }

  // ---------------------------------------------------------------- LC

  private async lcView(
    org: string,
    lc: NonNullable<R['letterOfCredit']>,
  ): Promise<LetterOfCreditView> {
    const docs = (lc.documents ?? []) as {
      requirement: string;
      documentId: string | null;
    }[];
    const ids = docs.map((d) => d.documentId).filter((x): x is string => !!x);
    const rows = ids.length
      ? await this.prisma.tradeDocument.findMany({
          where: { organizationId: org, id: { in: ids } },
          select: { id: true, title: true, status: true },
        })
      : [];
    return {
      id: lc.id,
      lcNumber: lc.lcNumber,
      issuingBank: lc.issuingBank,
      advisingBank: lc.advisingBank,
      amount: m2(new D(lc.amount.toString())),
      currency: lc.currency,
      issueDate: isoDay(lc.issueDate),
      expiryDate: isoDay(lc.expiryDate),
      latestShipmentDate: isoDay(lc.latestShipmentDate),
      presentationDeadline: isoDay(lc.presentationDeadline),
      status: (lc.expiryDate &&
      dayDiff(new Date(), lc.expiryDate) < 0 &&
      !['PAID', 'CANCELLED'].includes(lc.status)
        ? 'EXPIRED'
        : lc.status) as LetterOfCreditView['status'],
      daysToExpiry: lc.expiryDate ? dayDiff(new Date(), lc.expiryDate) : null,
      documents: docs.map((d) => {
        const row = rows.find((x) => x.id === d.documentId);
        return {
          requirement: d.requirement,
          documentId: row?.id ?? null,
          documentTitle: row?.title ?? null,
          documentStatus: row?.status ?? null,
        };
      }),
      notes: lc.notes,
      rowVersion: lc.rowVersion,
    };
  }

  private async lcDocs(
    org: string,
    r: { purchaseOrderId: string },
    docs?: { requirement: string; documentId?: string | null }[],
  ) {
    if (!docs) return undefined;
    for (const d of docs)
      if (d.documentId) {
        const ok = await this.prisma.tradeDocument.findFirst({
          where: {
            id: d.documentId,
            organizationId: org,
            purchaseOrderId: r.purchaseOrderId,
          },
        });
        if (!ok)
          throw new NotFoundException(
            'Linked document not found for this order.',
          );
      }
    return docs.map((d) => ({
      requirement: d.requirement.trim(),
      documentId: d.documentId ?? null,
    })) as unknown as Prisma.InputJsonValue;
  }

  async createLc(a: Actor, id: string, dto: LcDto) {
    const r = await this.load(a.organizationId, id);
    if (r.paymentTermsType !== 'LETTER_OF_CREDIT')
      throw new ConflictException(
        'This receivable is not on letter-of-credit terms.',
      );
    if (r.letterOfCredit)
      throw new ConflictException(
        'A letter of credit is already recorded — update it instead.',
      );
    if (!dto.lcNumber || !dto.issuingBank)
      throw new BadRequestException('LC number and issuing bank are required.');
    if (dto.issueDate && dto.expiryDate && dto.expiryDate < dto.issueDate)
      throw new BadRequestException('Expiry must be after the issue date.');
    const lc = await this.prisma.letterOfCredit.create({
      data: {
        organizationId: a.organizationId,
        receivableId: id,
        lcNumber: dto.lcNumber.trim(),
        issuingBank: dto.issuingBank.trim(),
        advisingBank: dto.advisingBank ?? null,
        amount: new D(dto.amount ?? r.totalAmount.toString()),
        currency: dto.currency ?? r.currency,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        latestShipmentDate: dto.latestShipmentDate
          ? new Date(dto.latestShipmentDate)
          : null,
        presentationDeadline: dto.presentationDeadline
          ? new Date(dto.presentationDeadline)
          : null,
        status: dto.status ?? 'RECEIVED',
        documents:
          (await this.lcDocs(a.organizationId, r, dto.documents)) ??
          (LC_DOCS_DEFAULT.map((requirement) => ({
            requirement,
            documentId: null,
          })) as unknown as Prisma.InputJsonValue),
        notes: dto.notes ?? null,
        createdByUserId: a.userId,
      },
    });
    await this.event(
      this.prisma,
      a,
      id,
      'lc.recorded',
      `Letter of credit ${lc.lcNumber} recorded (${lc.issuingBank}) — tracked operationally; nothing is sent to any bank`,
    );
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'receivable.updated',
      entityType: 'LetterOfCredit',
      entityId: lc.id,
      metadata: { receivableId: id, status: lc.status },
    });
    return this.detail(a, id);
  }

  async updateLc(a: Actor, lcId: string, dto: LcDto) {
    const lc = await this.prisma.letterOfCredit.findFirst({
      where: { id: lcId, organizationId: a.organizationId },
      include: { receivable: true },
    });
    if (!lc) throw new NotFoundException('Letter of credit not found.');
    this.guard(lc, dto.expectedRowVersion);
    const d = (v: string | null | undefined) =>
      v === undefined ? undefined : v ? new Date(v) : null;
    await this.prisma.letterOfCredit.update({
      where: { id: lcId },
      data: {
        lcNumber: dto.lcNumber,
        issuingBank: dto.issuingBank,
        advisingBank: dto.advisingBank,
        amount: dto.amount ? new D(dto.amount) : undefined,
        currency: dto.currency,
        issueDate: d(dto.issueDate),
        expiryDate: d(dto.expiryDate),
        latestShipmentDate: d(dto.latestShipmentDate),
        presentationDeadline: d(dto.presentationDeadline),
        status: dto.status,
        documents: await this.lcDocs(
          a.organizationId,
          lc.receivable,
          dto.documents,
        ),
        notes: dto.notes,
        rowVersion: { increment: 1 },
      },
    });
    // Documents presented under the LC start the presentation trigger.
    if (
      dto.status === 'DOCUMENTS_PRESENTED' &&
      !lc.receivable.documentsPresentedAt
    )
      await this.prisma.receivable.update({
        where: { id: lc.receivableId },
        data: {
          documentsPresentedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
    if (dto.status && dto.status !== lc.status)
      await this.event(
        this.prisma,
        a,
        lc.receivableId,
        'lc.status_changed',
        `LC ${lc.lcNumber}: ${lc.status.replace(/_/g, ' ').toLowerCase()} → ${dto.status.replace(/_/g, ' ').toLowerCase()}`,
      );
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'receivable.updated',
      entityType: 'LetterOfCredit',
      entityId: lcId,
      metadata: { status: dto.status ?? lc.status },
    });
    return this.getLc(a, lcId);
  }

  async getLc(a: Actor, lcId: string) {
    const lc = await this.prisma.letterOfCredit.findFirst({
      where: { id: lcId, organizationId: a.organizationId },
    });
    if (!lc) throw new NotFoundException('Letter of credit not found.');
    return this.lcView(a.organizationId, lc);
  }

  // ---------------------------------------------------------------- reminders

  private async exporterName(org: string) {
    const o = await this.prisma.organization.findUniqueOrThrow({
      where: { id: org },
      select: { name: true, legalName: true },
    });
    return o.legalName || o.name;
  }

  /** Suggested reminders (computed) plus existing drafts. Nothing is sent. */
  async reminders(a: Actor) {
    const { list, ctx } = await this.computedAll(a.organizationId, {
      state: 'OPEN',
    });
    const suggestions: {
      receivableId: string;
      receivableNumber: string;
      buyer: string;
      installmentId: string;
      label: string;
      kind: string;
      amount: string;
      currency: string;
      dueDate: string | null;
      daysOverdue: number | null;
    }[] = [];
    const drafts: (ReceivableReminderView & {
      receivableId: string;
      receivableNumber: string;
      buyer: string;
    })[] = [];
    for (const c of list) {
      const buyer =
        ctx.buyers.find((b) => b.id === c.r.buyerCompanyId)?.canonicalName ??
        'Buyer';
      for (const x of c.r.reminders.filter((m) => m.status === 'DRAFT'))
        drafts.push({
          ...this.reminderView(x, new Map()),
          receivableId: c.r.id,
          receivableNumber: c.r.receivableNumber,
          buyer,
        });
      for (const i of c.installments) {
        const kind =
          i.status === 'OVERDUE'
            ? 'OVERDUE'
            : i.status === 'DUE'
              ? 'DUE_TODAY'
              : i.status === 'DUE_SOON'
                ? 'UPCOMING_DUE'
                : null;
        if (!kind) continue;
        const has = c.r.reminders.some(
          (m) =>
            m.installmentId === i.row.id &&
            m.kind === kind &&
            m.status !== 'DISMISSED' &&
            (m.dueDate?.getTime() ?? 0) === (i.dueDate?.getTime() ?? 0),
        );
        if (has) continue;
        suggestions.push({
          receivableId: c.r.id,
          receivableNumber: c.r.receivableNumber,
          buyer,
          installmentId: i.row.id,
          label: i.row.label,
          kind,
          amount: m2(new D(i.row.outstandingAmount.toString())),
          currency: c.r.currency,
          dueDate: isoDay(i.dueDate),
          daysOverdue: i.daysOverdue,
        });
      }
    }
    return { suggestions, drafts };
  }

  async createReminder(a: Actor, id: string, dto: ReminderDto) {
    const org = a.organizationId;
    const r = await this.load(org, id);
    if (r.state !== 'OPEN')
      throw new ConflictException('Reminders are only for open receivables.');
    const ctx = await this.contexts(org, [r]);
    const { dueSoonDays } = await this.fin.settings(org);
    const c = this.compute(r, ctx, dueSoonDays);
    const open = c.installments.filter((i) => i.status !== 'PAID');
    const inst = dto.installmentId
      ? c.installments.find((i) => i.row.id === dto.installmentId)
      : (open.find((i) => i.status === 'OVERDUE') ??
        open.find((i) => i.dueDate) ??
        open[0]);
    if (!inst || inst.status === 'PAID')
      throw new ConflictException(
        'Nothing is outstanding on this installment.',
      );
    const kind =
      dto.kind ??
      (inst.status === 'OVERDUE'
        ? 'OVERDUE'
        : inst.status === 'DUE'
          ? 'DUE_TODAY'
          : inst.status === 'DUE_SOON'
            ? 'UPCOMING_DUE'
            : 'FOLLOW_UP');
    if (kind === 'OVERDUE' && inst.status !== 'OVERDUE')
      throw new ConflictException('This installment is not overdue.');
    const buyer =
      ctx.buyers.find((b) => b.id === r.buyerCompanyId)?.canonicalName ??
      'Buyer';
    const ci = ctx.cis.find((x) => x.id === r.commercialInvoiceId);
    const po = ctx.pos.find((p) => p.id === r.purchaseOrderId);
    const ref = ci?.documentNumber
      ? `invoice ${ci.documentNumber} (PO ${po?.poNumber})`
      : `PO ${po?.poNumber ?? ''}`;
    const amount = m2(new D(inst.row.outstandingAmount.toString()));
    const msg = paymentReminderMessage({
      kind,
      buyerName: buyer,
      exporterName: await this.exporterName(org),
      reference: ref,
      amount,
      currency: r.currency,
      dueDate: isoDay(inst.dueDate),
      label: inst.row.label,
    });
    const rem = await this.prisma.receivableReminder.create({
      data: {
        organizationId: org,
        receivableId: id,
        installmentId: inst.row.id,
        kind,
        subject: msg.subject,
        message: msg.message,
        dueAmount: new D(amount),
        currency: r.currency,
        dueDate: inst.dueDate,
        createdByUserId: a.userId,
      },
    });
    await this.event(
      this.prisma,
      a,
      id,
      'reminder.drafted',
      `${kind.replace(/_/g, ' ').toLowerCase()} reminder drafted for ${inst.row.label} (not sent)`,
    );
    return { reminderId: rem.id, receivable: await this.detail(a, id) };
  }

  private async loadReminder(org: string, rid: string) {
    const x = await this.prisma.receivableReminder.findFirst({
      where: { id: rid, organizationId: org },
    });
    if (!x) throw new NotFoundException('Reminder not found.');
    return x;
  }

  async dismissReminder(a: Actor, rid: string) {
    const x = await this.loadReminder(a.organizationId, rid);
    if (x.status !== 'DRAFT')
      throw new ConflictException('Only draft reminders can be dismissed.');
    await this.prisma.receivableReminder.update({
      where: { id: rid },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    });
    return this.detail(a, x.receivableId);
  }

  async recordReminderSent(a: Actor, rid: string, channel: string) {
    const x = await this.loadReminder(a.organizationId, rid);
    if (x.status !== 'DRAFT')
      throw new ConflictException(
        'Only a draft reminder can be recorded as sent.',
      );
    await this.prisma.receivableReminder.update({
      where: { id: rid },
      data: {
        status: 'RECORDED_SENT',
        channel,
        recordedSentAt: new Date(),
        recordedByUserId: a.userId,
      },
    });
    await this.event(
      this.prisma,
      a,
      x.receivableId,
      'reminder.recorded_sent',
      `User recorded sending the payment reminder via ${channel.toLowerCase()} (outside ExportPro)`,
    );
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'receivable.reminder_recorded_sent',
      entityType: 'Receivable',
      entityId: x.receivableId,
      metadata: { reminderId: rid, channel },
    });
    return this.detail(a, x.receivableId);
  }

  // ---------------------------------------------------------------- dashboards

  async overview(
    a: Actor,
    q: ListQueryDto,
    extra: {
      profitability: FinanceOverview['profitability'];
      reorderDue: number;
    },
  ): Promise<FinanceOverview> {
    const org = a.organizationId;
    const settings = await this.fin.settings(org);
    const range = this.fin.range(q);
    const { list } = await this.computedAll(org);
    const cur = new Map<
      string,
      {
        outstanding: Dec;
        overdue: Dec;
        dueSoon: Dec;
        dueToday: Dec;
        collected: Dec;
        total: Dec;
      }
    >();
    const z = () => ({
      outstanding: new D(0),
      overdue: new D(0),
      dueSoon: new D(0),
      dueToday: new D(0),
      collected: new D(0),
      total: new D(0),
    });
    const counts = {
      open: 0,
      overdue: 0,
      dueSoon: 0,
      dueToday: 0,
      disputed: 0,
    };
    let dueNext7: Map<string, Dec> = new Map();
    const today = new Date();
    for (const c of list) {
      const r = c.r;
      if (r.state === 'CANCELLED') continue;
      const b = cur.get(r.currency) ?? z();
      for (const p of r.payments)
        if (
          p.status === 'RECORDED' &&
          p.receivedAt >= range.from &&
          p.receivedAt < range.to
        )
          b.collected = b.collected.plus(p.appliedAmount.toString());
      if (r.state === 'OPEN') {
        b.total = b.total.plus(r.totalAmount.toString());
        b.outstanding = b.outstanding.plus(r.outstandingAmount.toString());
        if (!['PAID'].includes(c.status)) counts.open++;
        if (c.status === 'OVERDUE') counts.overdue++;
        if (c.status === 'DUE_SOON') counts.dueSoon++;
        if (c.status === 'DUE') counts.dueToday++;
        if (c.status === 'DISPUTED') counts.disputed++;
        for (const i of c.installments) {
          const o = new D(i.row.outstandingAmount.toString());
          if (i.status === 'OVERDUE') b.overdue = b.overdue.plus(o);
          if (i.status === 'DUE_SOON') b.dueSoon = b.dueSoon.plus(o);
          if (i.status === 'DUE') b.dueToday = b.dueToday.plus(o);
          if (
            i.dueDate &&
            o.gt(0) &&
            dayDiff(today, i.dueDate) >= 0 &&
            dayDiff(today, i.dueDate) <= 7
          )
            dueNext7.set(
              r.currency,
              (dueNext7.get(r.currency) ?? new D(0)).plus(o),
            );
        }
      }
      cur.set(r.currency, b);
    }
    // Normalized totals only when every currency has a saved FX snapshot (basis shown).
    const missingFx: string[] = [];
    const basis: string[] = [];
    const norm = {
      outstanding: new D(0),
      overdue: new D(0),
      dueNext7: new D(0),
      collected: new D(0),
    };
    for (const [c, v] of cur) {
      const fx = await this.fin.latestRate(org, c, settings.reportingCurrency);
      if (!fx) {
        missingFx.push(c);
        continue;
      }
      if (c !== settings.reportingCurrency)
        basis.push(
          `1 ${c} = ${fx.basis.rate} ${settings.reportingCurrency} (${fx.basis.sourceLabel}, ${fx.basis.sourceDate})`,
        );
      norm.outstanding = norm.outstanding.plus(v.outstanding.mul(fx.rate));
      norm.overdue = norm.overdue.plus(v.overdue.mul(fx.rate));
      norm.collected = norm.collected.plus(v.collected.mul(fx.rate));
      norm.dueNext7 = norm.dueNext7.plus(
        (dueNext7.get(c) ?? new D(0)).mul(fx.rate),
      );
    }
    const ok = missingFx.length === 0;
    void dueNext7;
    dueNext7 = new Map();
    const reminders = await this.reminders(a);
    return {
      reportingCurrency: settings.reportingCurrency,
      range: range.label,
      byCurrency: [...cur.entries()].map(([currency, v]) => ({
        currency,
        outstanding: m2(v.outstanding),
        overdue: m2(v.overdue),
        dueSoon: m2(v.dueSoon),
        dueToday: m2(v.dueToday),
        collected: m2(v.collected),
        total: m2(v.total),
      })),
      normalized: {
        outstanding: ok ? m2(norm.outstanding) : null,
        overdue: ok ? m2(norm.overdue) : null,
        dueNext7: ok ? m2(norm.dueNext7) : null,
        collected: ok ? m2(norm.collected) : null,
        basis: basis.length
          ? `Converted with saved FX snapshots: ${basis.join('; ')}`
          : `All amounts in ${settings.reportingCurrency}.`,
        missingFx,
      },
      counts,
      profitability: extra.profitability,
      reorderDue: extra.reorderDue,
      reminders: {
        suggested: reminders.suggestions.length,
        drafts: reminders.drafts.length,
      },
    };
  }

  async aging(
    a: Actor,
    groupBy: 'buyer' | 'currency' | 'country',
  ): Promise<AgingBucketRow[]> {
    const { list, ctx } = await this.computedAll(a.organizationId, {
      state: 'OPEN',
    });
    const rows = new Map<string, AgingBucketRow & { _: Record<string, Dec> }>();
    for (const c of list)
      for (const i of c.installments) {
        const o = new D(i.row.outstandingAmount.toString());
        if (o.lte(0)) continue;
        const buyer = ctx.buyers.find((b) => b.id === c.r.buyerCompanyId);
        const key =
          groupBy === 'buyer'
            ? c.r.buyerCompanyId
            : groupBy === 'country'
              ? (c.r.destinationCountry ?? '—')
              : c.r.currency;
        const label =
          groupBy === 'buyer' ? (buyer?.canonicalName ?? 'Buyer') : key;
        const k = `${key}|${c.r.currency}`;
        const row = rows.get(k) ?? {
          key,
          label,
          currency: c.r.currency,
          current: '0',
          d1_30: '0',
          d31_60: '0',
          d61_90: '0',
          d90plus: '0',
          total: '0',
          _: {
            current: new D(0),
            d1_30: new D(0),
            d31_60: new D(0),
            d61_90: new D(0),
            d90plus: new D(0),
            total: new D(0),
          },
        };
        const bucket = agingBucket(
          i.status === 'OVERDUE' ? i.daysOverdue : null,
        );
        row._[bucket] = row._[bucket].plus(o);
        row._.total = row._.total.plus(o);
        rows.set(k, row);
      }
    return [...rows.values()].map(({ _, ...r }) => ({
      ...r,
      current: m2(_.current),
      d1_30: m2(_.d1_30),
      d31_60: m2(_.d31_60),
      d61_90: m2(_.d61_90),
      d90plus: m2(_.d90plus),
      total: m2(_.total),
    }));
  }

  /** Every recorded payment of the organization in the range (payments tab). */
  async paymentsList(a: Actor, q: ListQueryDto) {
    const range = this.fin.range(q);
    const rows = await this.prisma.paymentReceipt.findMany({
      where: {
        organizationId: a.organizationId,
        receivedAt: { gte: range.from, lt: range.to },
        ...(q.currency ? { currency: q.currency } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      include: {
        receivable: {
          select: {
            id: true,
            receivableNumber: true,
            buyerCompanyId: true,
            currency: true,
            bookingFx: true,
          },
        },
      },
    });
    const buyers = await this.prisma.buyerCompany.findMany({
      where: {
        id: { in: [...new Set(rows.map((r) => r.receivable.buyerCompanyId))] },
      },
      select: { id: true, canonicalName: true },
    });
    const names = await this.core.userNames(
      rows.map((r) => r.recordedByUserId),
    );
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    return {
      range: range.label,
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((p) => ({
        ...this.paymentView(
          p as unknown as R['payments'][number],
          (p.receivable.bookingFx ?? null) as unknown as FxBasis | null,
          names,
          p.receivable.currency,
        ),
        receivable: {
          id: p.receivable.id,
          receivableNumber: p.receivable.receivableNumber,
          currency: p.receivable.currency,
        },
        buyer:
          buyers.find((b) => b.id === p.receivable.buyerCompanyId)
            ?.canonicalName ?? 'Buyer',
      })),
      meta: {
        page,
        pageSize,
        totalItems: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      },
    };
  }

  async buyerSummary(
    a: Actor,
    buyerId: string,
  ): Promise<Omit<FinanceBuyerSummary, 'profitability' | 'repeat'>> {
    const { list } = await this.computedAll(a.organizationId, {
      buyerCompanyId: buyerId,
      state: { not: 'CANCELLED' },
    });
    const tot = new Map<string, { o: Dec; od: Dec }>();
    let next: { amount: string; currency: string; dueDate: string } | null =
      null;
    let last: { amount: string; currency: string; receivedAt: string } | null =
      null;
    for (const c of list) {
      const t = tot.get(c.r.currency) ?? { o: new D(0), od: new D(0) };
      if (c.r.state === 'OPEN')
        t.o = t.o.plus(c.r.outstandingAmount.toString());
      for (const i of c.installments) {
        if (c.r.state === 'OPEN' && i.status === 'OVERDUE')
          t.od = t.od.plus(i.row.outstandingAmount.toString());
        if (
          c.r.state === 'OPEN' &&
          i.status !== 'PAID' &&
          i.dueDate &&
          (!next || isoDay(i.dueDate)! < next.dueDate)
        )
          next = {
            amount: m2(new D(i.row.outstandingAmount.toString())),
            currency: c.r.currency,
            dueDate: isoDay(i.dueDate)!,
          };
      }
      for (const p of c.r.payments)
        if (
          p.status === 'RECORDED' &&
          (!last || p.receivedAt.toISOString() > last.receivedAt)
        )
          last = {
            amount: m2(new D(p.amount.toString())),
            currency: p.currency,
            receivedAt: p.receivedAt.toISOString(),
          };
      tot.set(c.r.currency, t);
    }
    return {
      buyerId,
      currencyTotals: [...tot.entries()].map(([currency, v]) => ({
        currency,
        outstanding: m2(v.o),
        overdue: m2(v.od),
      })),
      lastPayment: last,
      nextDue: next,
    };
  }

  /** Re-exported for profitability: split helper and schedule-safe arithmetic. */
  static split = splitAmounts;
}
