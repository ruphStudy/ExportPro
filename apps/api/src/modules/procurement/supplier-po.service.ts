import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  roleHasPermission,
  type GoodsReceiptDetail,
  type GoodsReceiptSummary,
  type PayableStatus,
  type ProcurementList,
  type ProcurementOverview,
  type ProcurementRequirement,
  type QualityStatus,
  type ShipmentProcurement,
  type SupplierPayableView,
  type SupplierPoDetail,
  type SupplierPoSummary,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
} from '../commercial/commercial-core.service';
import { renderCommercialPdf } from '../commercial/pdf/commercial-pdf';
import { D, type Dec } from '../costing/costing-calculator';
import { FinanceCoreService } from '../finance/finance-core.service';
import {
  allocate,
  dayDiff,
  installmentStatus,
  isoDay,
  mask,
  receivableStatus,
  referenceKey,
  splitAmounts,
} from '../finance/finance-rules';
import { linkedSupplierPos, procurementCost } from './procurement-cost';
import {
  m2,
  PO_TRANSITIONS,
  toKg,
  PROC_FOR_STATUS,
  qty,
  resolvePayableDue,
} from './procurement-rules';
import type {
  GrnDto,
  InspectionDto,
  ListDto,
  ReviseDto,
  SpoDto,
  SpoStatusDto,
  SupplierPaymentDto,
} from './procurement.dto';
import { SuppliersService } from './suppliers.service';

const INCLUDE = {
  items: { orderBy: { sortOrder: 'asc' } },
  events: { orderBy: { createdAt: 'desc' } },
  receipts: {
    include: { items: true, inspections: true },
    orderBy: { receivedAt: 'asc' },
  },
  payable: {
    include: {
      installments: { orderBy: { sequence: 'asc' } },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  },
} satisfies Prisma.SupplierPurchaseOrderInclude;
type Row = Prisma.SupplierPurchaseOrderGetPayload<{ include: typeof INCLUDE }>;
const RECEIVABLE = [
  'ISSUED',
  'ACKNOWLEDGED',
  'IN_PRODUCTION',
  'READY',
  'PARTIALLY_RECEIVED',
];

/** Quality accepted: something received, nothing pending/on hold, and accepted quantity covers the order (rejections replaced). */
function qualityDone(p: {
  receipts: { qualityStatus: string }[];
  items: { quantity: Prisma.Decimal; acceptedQuantity: Prisma.Decimal }[];
}) {
  return (
    p.receipts.length > 0 &&
    !p.receipts.some((r) => ['PENDING', 'HOLD'].includes(r.qualityStatus)) &&
    p.items.every((i) =>
      new D(i.acceptedQuantity.toString()).gte(i.quantity.toString()),
    )
  );
}

/** Supplier POs, goods receipts, quality inspections and supplier payables (operational, not accounting). */
@Injectable()
export class SupplierPoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CommercialCoreService,
    private readonly fin: FinanceCoreService,
    private readonly suppliers: SuppliersService,
    private readonly audit: AuditService,
  ) {}

  private can(a: Actor, p: Parameters<typeof roleHasPermission>[1]) {
    return roleHasPermission(a.role, p);
  }
  private async load(org: string, id: string) {
    const r = await this.prisma.supplierPurchaseOrder.findFirst({
      where: { id, organizationId: org },
      include: INCLUDE,
    });
    if (!r) throw new NotFoundException('Supplier PO not found.');
    return r;
  }
  private guard(r: { rowVersion: number }, v?: number) {
    if (v !== undefined && v !== r.rowVersion)
      throw CommercialCoreService.conflict();
  }
  private ev(
    tx: Prisma.TransactionClient | PrismaService,
    a: Actor,
    spoId: string,
    type: string,
    from: string | null,
    to: string | null,
    reason?: string | null,
  ) {
    return tx.procurementEvent.create({
      data: {
        organizationId: a.organizationId,
        supplierPoId: spoId,
        type,
        fromValue: from,
        toValue: to,
        reason: reason ?? null,
        createdByUserId: a.userId,
      },
    });
  }

  // ---------------------------------------------------------------- create / edit

  private totals(
    items: { quantity: Dec; unitPrice: Dec; taxPercent: Dec | null }[],
    ch: (Dec | null)[],
  ) {
    const subtotal = items
      .reduce((s, i) => s.plus(i.quantity.mul(i.unitPrice)), new D(0))
      .toDecimalPlaces(2);
    const tax = items
      .reduce(
        (s, i) =>
          i.taxPercent
            ? s.plus(i.quantity.mul(i.unitPrice).mul(i.taxPercent).div(100))
            : s,
        new D(0),
      )
      .toDecimalPlaces(2);
    const charges = ch.reduce((s: Dec, x) => (x ? s.plus(x) : s), new D(0));
    return {
      subtotal,
      tax,
      total: subtotal.plus(tax).plus(charges).toDecimalPlaces(2),
    };
  }

  private validateSchedule(s?: SpoDto['paymentSchedule']) {
    if (!s?.length) return;
    const pcts = s.map((x) => x.percentage);
    if (pcts.some((p) => !p))
      throw new BadRequestException(
        'Give a percentage for every payment installment (splits are never guessed).',
      );
    const sum = pcts.reduce((t, p) => t.plus(p!), new D(0));
    if (!sum.eq(100))
      throw new BadRequestException({
        message: `Payment percentages add up to ${sum.toString()}%, not 100%.`,
        details: { code: 'SCHEDULE_NOT_100' },
      });
    for (const x of s)
      if (x.trigger === 'FIXED_DATE' && !x.fixedDate)
        throw new BadRequestException('A fixed-date installment needs a date.');
  }

  async create(a: Actor, dto: SpoDto) {
    const org = a.organizationId;
    let supplierId = dto.supplierId;
    let items = dto.items ?? [];
    let currency = dto.currency;
    let rfqId: string | null = null;
    let quote: Prisma.SupplierQuoteGetPayload<object> | null = null;
    let buyerPoId = dto.buyerPurchaseOrderId ?? null;
    let shipmentId = dto.shipmentId ?? null;
    let quality = dto.qualityRequirements ?? null;
    let certs = dto.certificationRequirements ?? [];
    if (dto.quoteId) {
      quote = await this.prisma.supplierQuote.findFirst({
        where: { id: dto.quoteId, organizationId: org },
      });
      if (!quote) throw new NotFoundException('Supplier quote not found.');
      const rfq = await this.prisma.supplierRfq.findUniqueOrThrow({
        where: { id: quote.rfqId },
      });
      if (rfq.selectedQuoteId !== quote.id)
        throw new ConflictException({
          message: 'Only the selected quote can become a supplier PO.',
          details: { code: 'QUOTE_NOT_SELECTED' },
        });
      supplierId = quote.supplierId;
      currency = quote.currency;
      rfqId = rfq.id;
      buyerPoId = buyerPoId ?? rfq.buyerPurchaseOrderId;
      shipmentId = shipmentId ?? rfq.shipmentId;
      quality = quality ?? rfq.qualityRequirements;
      certs = certs.length ? certs : rfq.certificationsRequired;
      // Quantity is expressed in the quote's price unit (e.g. 10.2 MT → 10200 KG).
      const kg = toKg(new D(rfq.quantity.toString()), rfq.unit);
      const qu = quote.unit.toUpperCase();
      const poQty =
        rfq.unit.toUpperCase() === qu
          ? new D(rfq.quantity.toString())
          : kg && toKg(new D(1), qu)
            ? kg.div(toKg(new D(1), qu)!)
            : null;
      if (!items.length && !poQty)
        throw new BadRequestException({
          message: `The RFQ quantity (${rfq.unit}) cannot be converted to the quote unit (${quote.unit}). Enter the PO items manually.`,
          details: { code: 'UNIT_MISMATCH' },
        });
      if (!items.length)
        items = [
          {
            productId: rfq.productId,
            productName: rfq.productName,
            specification: quote.specificationOffered ?? rfq.specification,
            quantity: poQty!.toDecimalPlaces(4).toString(),
            unit: quote.unit,
            unitPrice: quote.unitPrice.toString(),
            taxPercent: quote.taxIncluded
              ? null
              : (quote.taxPercent?.toString() ?? null),
          },
        ];
    }
    if (
      !supplierId ||
      !(await this.prisma.supplier.findFirst({
        where: { id: supplierId, organizationId: org },
      }))
    )
      throw new NotFoundException('Supplier not found.');
    if (!items.length) throw new BadRequestException('Add at least one item.');
    if (!currency) throw new BadRequestException('Choose the PO currency.');
    if (
      buyerPoId &&
      !(await this.prisma.buyerPurchaseOrder.findFirst({
        where: { id: buyerPoId, organizationId: org },
      }))
    )
      throw new NotFoundException('Buyer PO not found.');
    if (
      shipmentId &&
      !(await this.prisma.shipment.findFirst({
        where: { id: shipmentId, organizationId: org },
      }))
    )
      throw new NotFoundException('Shipment not found.');
    this.validateSchedule(dto.paymentSchedule);
    const dec = (v?: string | null) => (v ? new D(v) : null);
    const ch = [
      dec(dto.packagingCost),
      dec(dto.inlandTransportCost),
      dec(dto.inspectionCost),
      dec(dto.otherCharges),
    ];
    const t = this.totals(
      items.map((i) => ({
        quantity: new D(i.quantity),
        unitPrice: new D(i.unitPrice),
        taxPercent: dec(i.taxPercent),
      })),
      ch,
    );
    const spo = await this.prisma.$transaction(async (tx) => {
      const number = await this.core.nextNumber(tx, org, 'SPO', 'SPO', true);
      return tx.supplierPurchaseOrder.create({
        data: {
          organizationId: org,
          spoNumber: number,
          supplierId: supplierId!,
          rfqId,
          quoteId: quote?.id ?? null,
          buyerPurchaseOrderId: buyerPoId,
          shipmentId,
          currency: currency!,
          packagingCost: ch[0],
          inlandTransportCost: ch[1],
          inspectionCost: ch[2],
          otherCharges: ch[3],
          taxAmount: t.tax,
          subtotal: t.subtotal,
          totalAmount: t.total,
          deliveryLocation: dto.deliveryLocation ?? null,
          originalExpectedDate: dto.expectedDate
            ? new Date(dto.expectedDate)
            : null,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          paymentTerms: dto.paymentTerms ?? quote?.paymentTerms ?? null,
          paymentSchedule: (dto.paymentSchedule ??
            []) as unknown as Prisma.InputJsonValue,
          qualityRequirements: quality,
          certificationRequirements: certs,
          notes: dto.notes ?? null,
          createdByUserId: a.userId,
          items: {
            create: items.map((i, k) => ({
              organizationId: org,
              sortOrder: k,
              productId: i.productId ?? null,
              productName: i.productName,
              specification: i.specification ?? null,
              quantity: new D(i.quantity),
              unit: i.unit,
              unitPrice: new D(i.unitPrice),
              taxPercent: dec(i.taxPercent),
            })),
          },
        },
      });
    });
    await this.ev(
      this.prisma,
      a,
      spo.id,
      'CREATED',
      null,
      'DRAFT',
      quote ? 'From selected supplier quote' : null,
    );
    return this.detail(a, spo.id);
  }

  /** Drafts are editable; after issue only the expected date (operational) changes here — terms need a revision. */
  async update(a: Actor, id: string, dto: SpoDto) {
    const s = await this.load(a.organizationId, id);
    this.guard(s, dto.expectedRowVersion);
    if (s.status !== 'DRAFT') {
      const commercial = (
        [
          'items',
          'currency',
          'packagingCost',
          'inlandTransportCost',
          'inspectionCost',
          'otherCharges',
          'paymentTerms',
          'paymentSchedule',
          'qualityRequirements',
          'certificationRequirements',
          'deliveryLocation',
        ] as const
      ).filter((k) => dto[k] !== undefined);
      if (commercial.length)
        throw new ConflictException({
          message:
            'Issued supplier PO terms are fixed. Create a revision to change them.',
          details: { code: 'SPO_ISSUED_IMMUTABLE', fields: commercial },
        });
      if (dto.expectedDate === undefined) return this.detail(a, id);
      if (['RECEIVED', 'COMPLETED', 'CANCELLED'].includes(s.status))
        throw new ConflictException('Delivery is already closed.');
      if (!dto.dateChangeReason)
        throw new BadRequestException(
          'Give a reason for the delivery-date change (e.g. supplier informed by phone).',
        );
      const to = dto.expectedDate ? new Date(dto.expectedDate) : null;
      await this.prisma.$transaction(async (tx) => {
        const n = await tx.supplierPurchaseOrder.updateMany({
          where: { id, rowVersion: s.rowVersion },
          data: { expectedDate: to, rowVersion: { increment: 1 } },
        });
        if (n.count !== 1) throw CommercialCoreService.conflict();
        await this.ev(
          tx,
          a,
          id,
          'EXPECTED_DATE',
          isoDay(s.expectedDate),
          isoDay(to),
          dto.dateChangeReason,
        );
      });
      return this.detail(a, id);
    }
    this.validateSchedule(dto.paymentSchedule);
    const dec = (v?: string | null) =>
      v === undefined ? undefined : v ? new D(v) : null;
    const items =
      dto.items ??
      s.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        specification: i.specification,
        quantity: i.quantity.toString(),
        unit: i.unit,
        unitPrice: i.unitPrice.toString(),
        taxPercent: i.taxPercent?.toString() ?? null,
      }));
    const ch = [
      dto.packagingCost,
      dto.inlandTransportCost,
      dto.inspectionCost,
      dto.otherCharges,
    ]
      .map((v, k) =>
        v === undefined
          ? [
              s.packagingCost,
              s.inlandTransportCost,
              s.inspectionCost,
              s.otherCharges,
            ][k]
          : v
            ? new D(v)
            : null,
      )
      .map((x) => (x ? new D(x.toString()) : null));
    const t = this.totals(
      items.map((i) => ({
        quantity: new D(i.quantity),
        unitPrice: new D(i.unitPrice),
        taxPercent: i.taxPercent ? new D(i.taxPercent) : null,
      })),
      ch,
    );
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.supplierPurchaseOrder.updateMany({
        where: { id, rowVersion: s.rowVersion, status: 'DRAFT' },
        data: {
          currency: dto.currency,
          packagingCost: dec(dto.packagingCost),
          inlandTransportCost: dec(dto.inlandTransportCost),
          inspectionCost: dec(dto.inspectionCost),
          otherCharges: dec(dto.otherCharges),
          taxAmount: t.tax,
          subtotal: t.subtotal,
          totalAmount: t.total,
          deliveryLocation: dto.deliveryLocation,
          expectedDate:
            dto.expectedDate === undefined
              ? undefined
              : dto.expectedDate
                ? new Date(dto.expectedDate)
                : null,
          originalExpectedDate:
            dto.expectedDate === undefined
              ? undefined
              : dto.expectedDate
                ? new Date(dto.expectedDate)
                : null,
          paymentTerms: dto.paymentTerms,
          paymentSchedule: dto.paymentSchedule
            ? (dto.paymentSchedule as unknown as Prisma.InputJsonValue)
            : undefined,
          qualityRequirements: dto.qualityRequirements,
          certificationRequirements: dto.certificationRequirements,
          notes: dto.notes,
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) throw CommercialCoreService.conflict();
      if (dto.items) {
        await tx.supplierPurchaseOrderItem.deleteMany({
          where: { supplierPoId: id },
        });
        await tx.supplierPurchaseOrderItem.createMany({
          data: dto.items.map((i, k) => ({
            organizationId: a.organizationId,
            supplierPoId: id,
            sortOrder: k,
            productId: i.productId ?? null,
            productName: i.productName,
            specification: i.specification ?? null,
            quantity: new D(i.quantity),
            unit: i.unit,
            unitPrice: new D(i.unitPrice),
            taxPercent: i.taxPercent ? new D(i.taxPercent) : null,
          })),
        });
      }
    });
    return this.detail(a, id);
  }

  private snapshotOf(s: Row) {
    return {
      spoNumber: s.spoNumber,
      revision: s.revision,
      currency: s.currency,
      items: s.items.map((i) => ({
        productName: i.productName,
        specification: i.specification,
        quantity: i.quantity.toString(),
        unit: i.unit,
        unitPrice: i.unitPrice.toString(),
        taxPercent: i.taxPercent?.toString() ?? null,
      })),
      charges: {
        packaging: s.packagingCost?.toFixed(2) ?? null,
        inlandTransport: s.inlandTransportCost?.toFixed(2) ?? null,
        inspection: s.inspectionCost?.toFixed(2) ?? null,
        other: s.otherCharges?.toFixed(2) ?? null,
        tax: s.taxAmount?.toFixed(2) ?? null,
      },
      subtotal: s.subtotal?.toFixed(2) ?? null,
      total: s.totalAmount?.toFixed(2) ?? null,
      deliveryLocation: s.deliveryLocation,
      expectedDate: isoDay(s.expectedDate),
      paymentTerms: s.paymentTerms,
      paymentSchedule: s.paymentSchedule,
      qualityRequirements: s.qualityRequirements,
      certificationRequirements: s.certificationRequirements,
      capturedAt: new Date().toISOString(),
    };
  }

  private payableRows(org: string, s: Row) {
    const sched = s.paymentSchedule as {
      label: string;
      percentage: string | null;
      trigger: string;
      dueDays: number | null;
      fixedDate: string | null;
    }[];
    const total = new D(s.totalAmount!.toString());
    const list = sched.length
      ? sched
      : [
          {
            label: 'Payment',
            percentage: '100',
            trigger: 'CUSTOM',
            dueDays: null,
            fixedDate: null,
          },
        ];
    const amounts = splitAmounts(
      total,
      list.map((x) => new D(x.percentage ?? '100')),
    );
    return list.map((x, k) => ({
      organizationId: org,
      sequence: k + 1,
      label: x.label,
      percentage: x.percentage ? new D(x.percentage) : null,
      amount: amounts[k],
      trigger: x.trigger,
      dueDays: x.dueDays ?? null,
      fixedDate: x.fixedDate ? new Date(x.fixedDate) : null,
      outstandingAmount: amounts[k],
    }));
  }

  /** Issue: freezes commercial terms in a snapshot and creates the supplier payable from the agreed schedule. */
  async issue(a: Actor, id: string, expected?: number) {
    const s = await this.load(a.organizationId, id);
    this.guard(s, expected);
    if (s.status !== 'DRAFT')
      throw new ConflictException('Only a draft supplier PO can be issued.');
    const problems: string[] = [];
    if (!s.items.length) problems.push('No items.');
    if (!s.expectedDate) problems.push('Expected delivery date missing.');
    if (!s.deliveryLocation) problems.push('Delivery location missing.');
    if (!(s.paymentSchedule as unknown[]).length)
      problems.push(
        'Payment schedule missing (e.g. 30% advance, 70% on delivery).',
      );
    if (problems.length)
      throw new BadRequestException({
        message: `Cannot issue: ${problems.join(' ')}`,
        details: { code: 'SPO_INCOMPLETE', problems },
      });
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.supplierPurchaseOrder.updateMany({
        where: { id, rowVersion: s.rowVersion, status: 'DRAFT' },
        data: {
          status: 'ISSUED',
          procurementStatus: 'ORDERED',
          poDate: new Date(),
          issuedAt: new Date(),
          issuedByUserId: a.userId,
          snapshot: this.snapshotOf(s) as unknown as Prisma.InputJsonValue,
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) throw CommercialCoreService.conflict();
      await tx.supplierPayable.create({
        data: {
          organizationId: a.organizationId,
          supplierPoId: id,
          supplierId: s.supplierId,
          currency: s.currency,
          totalAmount: s.totalAmount!,
          outstandingAmount: s.totalAmount!,
          installments: { create: this.payableRows(a.organizationId, s) },
        },
      });
      await this.ev(tx, a, id, 'STATUS', 'DRAFT', 'ISSUED');
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'supplier_po.issued',
      entityType: 'SupplierPurchaseOrder',
      entityId: id,
      metadata: { total: s.totalAmount?.toFixed(2), currency: s.currency },
    });
    await this.syncMilestones(a, s);
    return this.detail(a, id);
  }

  /** Revision: allowed before goods arrive; the previous issued snapshot is kept in history. */
  async revise(a: Actor, id: string, dto: ReviseDto) {
    const s = await this.load(a.organizationId, id);
    this.guard(s, dto.expectedRowVersion);
    if (
      !['ISSUED', 'ACKNOWLEDGED', 'IN_PRODUCTION', 'READY'].includes(s.status)
    )
      throw new ConflictException({
        message:
          'Only issued supplier POs without goods receipts can be revised.',
        details: { code: 'SPO_NOT_REVISABLE' },
      });
    this.validateSchedule(dto.paymentSchedule);
    const items =
      dto.items ??
      s.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        specification: i.specification,
        quantity: i.quantity.toString(),
        unit: i.unit,
        unitPrice: i.unitPrice.toString(),
        taxPercent: i.taxPercent?.toString() ?? null,
      }));
    const pick = (v: string | null | undefined, cur: Prisma.Decimal | null) =>
      v === undefined
        ? cur
          ? new D(cur.toString())
          : null
        : v
          ? new D(v)
          : null;
    const ch = [
      pick(dto.packagingCost, s.packagingCost),
      pick(dto.inlandTransportCost, s.inlandTransportCost),
      pick(dto.inspectionCost, s.inspectionCost),
      pick(dto.otherCharges, s.otherCharges),
    ];
    const t = this.totals(
      items.map((i) => ({
        quantity: new D(i.quantity),
        unitPrice: new D(i.unitPrice),
        taxPercent: i.taxPercent ? new D(i.taxPercent) : null,
      })),
      ch,
    );
    const paid = s.payable ? new D(s.payable.paidAmount.toString()) : new D(0);
    if (t.total.lt(paid))
      throw new ConflictException(
        'The revised total is below the amount already paid to the supplier.',
      );
    await this.prisma.$transaction(async (tx) => {
      const history = [
        ...(s.revisions as unknown[]),
        {
          revision: s.revision,
          at: new Date().toISOString(),
          by: a.userId,
          reason: dto.reason,
          snapshot: s.snapshot,
        },
      ];
      const n = await tx.supplierPurchaseOrder.updateMany({
        where: { id, rowVersion: s.rowVersion },
        data: {
          revision: { increment: 1 },
          revisions: history as unknown as Prisma.InputJsonValue,
          currency: dto.currency,
          packagingCost: ch[0],
          inlandTransportCost: ch[1],
          inspectionCost: ch[2],
          otherCharges: ch[3],
          taxAmount: t.tax,
          subtotal: t.subtotal,
          totalAmount: t.total,
          deliveryLocation: dto.deliveryLocation,
          paymentTerms: dto.paymentTerms,
          paymentSchedule: dto.paymentSchedule
            ? (dto.paymentSchedule as unknown as Prisma.InputJsonValue)
            : undefined,
          qualityRequirements: dto.qualityRequirements,
          certificationRequirements: dto.certificationRequirements,
          notes: dto.notes,
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) throw CommercialCoreService.conflict();
      if (dto.items) {
        await tx.supplierPurchaseOrderItem.deleteMany({
          where: { supplierPoId: id },
        });
        await tx.supplierPurchaseOrderItem.createMany({
          data: dto.items.map((i, k) => ({
            organizationId: a.organizationId,
            supplierPoId: id,
            sortOrder: k,
            productId: i.productId ?? null,
            productName: i.productName,
            specification: i.specification ?? null,
            quantity: new D(i.quantity),
            unit: i.unit,
            unitPrice: new D(i.unitPrice),
            taxPercent: i.taxPercent ? new D(i.taxPercent) : null,
          })),
        });
      }
      const fresh = await tx.supplierPurchaseOrder.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
      await tx.supplierPurchaseOrder.update({
        where: { id },
        data: {
          snapshot: this.snapshotOf(fresh) as unknown as Prisma.InputJsonValue,
        },
      });
      // Payable follows the revised total; recorded payments are kept and re-applied in order.
      if (s.payable) {
        await tx.supplierPayableInstallment.deleteMany({
          where: { payableId: s.payable.id },
        });
        const rows = this.payableRows(a.organizationId, fresh);
        let left = paid;
        for (const r of rows) {
          const p = D.min(left, r.amount);
          left = left.minus(p);
          await tx.supplierPayableInstallment.create({
            data: {
              ...r,
              payableId: s.payable.id,
              paidAmount: p,
              outstandingAmount: r.amount.minus(p),
            },
          });
        }
        await tx.supplierPayable.update({
          where: { id: s.payable.id },
          data: {
            totalAmount: t.total,
            outstandingAmount: t.total.minus(paid),
            rowVersion: { increment: 1 },
          },
        });
      }
      await this.ev(
        tx,
        a,
        id,
        'REVISION',
        String(s.revision),
        String(s.revision + 1),
        dto.reason,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'supplier_po.revised',
      entityType: 'SupplierPurchaseOrder',
      entityId: id,
      metadata: { revision: s.revision + 1, reason: dto.reason },
    });
    return this.detail(a, id);
  }

  async recordSent(a: Actor, id: string, via: string) {
    const s = await this.load(a.organizationId, id);
    if (s.status === 'DRAFT')
      throw new ConflictException(
        'Issue the PO before recording that it was sent.',
      );
    await this.prisma.supplierPurchaseOrder.update({
      where: { id },
      data: {
        externallySentAt: new Date(),
        externallySentVia: via,
        externallySentByUserId: a.userId,
      },
    });
    await this.ev(
      this.prisma,
      a,
      id,
      'SENT_EXTERNALLY',
      null,
      via,
      'User recorded sending the PO outside ExportPro',
    );
    return this.detail(a, id);
  }

  completion(s: Row) {
    const blockers: string[] = [];
    if (!['RECEIVED'].includes(s.status))
      blockers.push('All ordered quantities must be received first.');
    if (s.receipts.some((r) => r.qualityStatus === 'PENDING'))
      blockers.push('Quality inspection pending on a goods receipt.');
    if (s.receipts.some((r) => r.qualityStatus === 'HOLD'))
      blockers.push('Goods are on quality hold.');
    for (const i of s.items)
      if (new D(i.acceptedQuantity.toString()).lt(i.quantity.toString()))
        blockers.push(
          `${i.productName}: accepted ${i.acceptedQuantity.toString()} of ${i.quantity.toString()} ${i.unit} — receive replacements or record a waiver.`,
        );
    return { allowed: blockers.length === 0, blockers };
  }

  async changeStatus(a: Actor, id: string, dto: SpoStatusDto) {
    const s = await this.load(a.organizationId, id);
    this.guard(s, dto.expectedRowVersion);
    if (dto.status === 'DISPATCHED') {
      if (
        !['ISSUED', 'ACKNOWLEDGED', 'IN_PRODUCTION', 'READY'].includes(s.status)
      )
        throw new ConflictException({
          message: 'Dispatch can only be recorded before receipt.',
          details: { code: 'INVALID_TRANSITION' },
        });
      await this.prisma.$transaction(async (tx) => {
        await tx.supplierPurchaseOrder.update({
          where: { id },
          data: {
            procurementStatus: 'DISPATCHED',
            dispatchedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        await this.ev(
          tx,
          a,
          id,
          'PROCUREMENT_STATUS',
          s.procurementStatus,
          'DISPATCHED',
          dto.note,
        );
      });
      return this.detail(a, id);
    }
    if (!(PO_TRANSITIONS[s.status] ?? []).includes(dto.status))
      throw new ConflictException({
        message: `Cannot move a ${s.status.toLowerCase().replace(/_/g, ' ')} supplier PO to ${dto.status.toLowerCase().replace(/_/g, ' ')}.`,
        details: {
          code: 'INVALID_TRANSITION',
          allowed: PO_TRANSITIONS[s.status],
        },
      });
    if (dto.status === 'CANCELLED') {
      if (s.receipts.length)
        throw new ConflictException(
          'Goods were received — this PO cannot be cancelled.',
        );
      if (!dto.note)
        throw new BadRequestException('A reason is required to cancel.');
    }
    if (dto.status === 'COMPLETED') {
      const c = this.completion(s);
      if (!c.allowed)
        throw new ConflictException({
          message: `Procurement cannot be completed: ${c.blockers.join(' ')}`,
          details: { code: 'PROCUREMENT_NOT_COMPLETE', blockers: c.blockers },
        });
    }
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.supplierPurchaseOrder.updateMany({
        where: { id, rowVersion: s.rowVersion },
        data: {
          status: dto.status,
          procurementStatus: PROC_FOR_STATUS[dto.status],
          ...(dto.status === 'CANCELLED' ? { cancelReason: dto.note } : {}),
          ...(dto.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) throw CommercialCoreService.conflict();
      if (dto.status === 'CANCELLED' && s.payable)
        await tx.supplierPayable.update({
          where: { id: s.payable.id },
          data: { state: 'CANCELLED' },
        });
      await this.ev(tx, a, id, 'STATUS', s.status, dto.status, dto.note);
    });
    await this.syncMilestones(a, s);
    return this.detail(a, id);
  }

  // ---------------------------------------------------------------- goods receipt / quality

  async receive(a: Actor, id: string, dto: GrnDto) {
    const org = a.organizationId;
    if (dto.idempotencyKey) {
      const ex = await this.prisma.goodsReceipt.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: org,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });
      if (ex)
        return {
          duplicate: true,
          goodsReceiptId: ex.id,
          supplierPo: await this.detail(a, ex.supplierPoId),
        };
    }
    const s0 = await this.load(org, id);
    if (!RECEIVABLE.includes(s0.status))
      throw new ConflictException({
        message: `Goods cannot be received on a ${s0.status.toLowerCase().replace(/_/g, ' ')} supplier PO.`,
        details: { code: 'INVALID_TRANSITION' },
      });
    if (new Date(dto.receivedAt).getTime() > Date.now() + 864e5)
      throw new BadRequestException(
        'The receipt date cannot be in the future.',
      );
    let grnId = '';
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_purchase_orders WHERE id = ${id} FOR UPDATE`;
      const s = await tx.supplierPurchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });
      const lines: { item: (typeof s.items)[number]; rec: Dec; dmg: Dec }[] =
        [];
      for (const l of dto.items) {
        const item = s.items.find((i) => i.id === l.supplierPoItemId);
        if (!item) throw new NotFoundException('PO item not found.');
        const rec = new D(l.receivedQuantity);
        const dmg = new D(l.damagedQuantity ?? '0');
        if (rec.lte(0))
          throw new BadRequestException('Received quantity must be positive.');
        if (dmg.gt(rec))
          throw new BadRequestException(
            'Damaged quantity cannot exceed received quantity.',
          );
        lines.push({ item, rec, dmg });
      }
      // Usable quantity so far = received − damaged − rejected; over-receipt needs a manager reason.
      const over = lines.filter(({ item, rec, dmg }) =>
        new D(item.receivedQuantity.toString())
          .minus(item.damagedQuantity.toString())
          .minus(item.rejectedQuantity.toString())
          .plus(rec)
          .minus(dmg)
          .gt(item.quantity.toString()),
      );
      if (over.length) {
        if (!dto.overReceiptReason)
          throw new ConflictException({
            message: `Receiving more than ordered (${over.map((o) => o.item.productName).join(', ')}). A manager must confirm with a reason.`,
            details: { code: 'OVER_RECEIPT' },
          });
        if (!this.can(a, 'supplier_po.issue'))
          throw new ForbiddenException(
            'Only a procurement manager can accept an over-receipt.',
          );
      }
      const number = await this.core.nextNumber(tx, org, 'GRN', 'GRN', true);
      const g = await tx.goodsReceipt.create({
        data: {
          organizationId: org,
          grnNumber: number,
          supplierPoId: id,
          receivedAt: new Date(dto.receivedAt),
          location: dto.location ?? null,
          receivedByUserId: a.userId,
          notes: dto.notes ?? null,
          overReceiptReason: over.length ? dto.overReceiptReason : null,
          idempotencyKey: dto.idempotencyKey ?? null,
          items: {
            create: lines.map((l) => ({
              organizationId: org,
              supplierPoItemId: l.item.id,
              receivedQuantity: l.rec,
              damagedQuantity: l.dmg,
            })),
          },
        },
      });
      grnId = g.id;
      for (const l of lines)
        await tx.supplierPurchaseOrderItem.update({
          where: { id: l.item.id },
          data: {
            receivedQuantity: { increment: l.rec },
            damagedQuantity: { increment: l.dmg },
          },
        });
      const items = await tx.supplierPurchaseOrderItem.findMany({
        where: { supplierPoId: id },
      });
      const full = items.every((i) =>
        new D(i.receivedQuantity.toString())
          .minus(i.damagedQuantity.toString())
          .minus(i.rejectedQuantity.toString())
          .gte(i.quantity.toString()),
      );
      const status = full ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await tx.supplierPurchaseOrder.update({
        where: { id },
        data: {
          status,
          procurementStatus: status,
          actualReceivedAt: full ? new Date(dto.receivedAt) : undefined,
          rowVersion: { increment: 1 },
        },
      });
      if (status !== s.status)
        await this.ev(
          tx,
          a,
          id,
          'STATUS',
          s.status,
          status,
          `Goods receipt ${number}`,
        );
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'goods_receipt.recorded',
      entityType: 'GoodsReceipt',
      entityId: grnId,
      metadata: {
        supplierPoId: id,
        overReceipt: Boolean(dto.overReceiptReason),
      },
    });
    await this.syncMilestones(a, s0);
    return {
      duplicate: false,
      goodsReceiptId: grnId,
      supplierPo: await this.detail(a, id),
    };
  }

  private async loadGrn(org: string, id: string) {
    const g = await this.prisma.goodsReceipt.findFirst({
      where: { id, organizationId: org },
      include: {
        items: true,
        inspections: { orderBy: { createdAt: 'asc' } },
        supplierPo: { include: { items: true } },
      },
    });
    if (!g) throw new NotFoundException('Goods receipt not found.');
    return g;
  }

  /** Inspection sets accepted/rejected quantities; failures need a reason and block completion. */
  async inspect(
    a: Actor,
    grnId: string,
    dto: InspectionDto,
    inspectionId?: string,
  ) {
    const org = a.organizationId;
    const g = await this.loadGrn(org, grnId);
    const existing = inspectionId
      ? g.inspections.find((i) => i.id === inspectionId)
      : null;
    if (inspectionId && !existing)
      throw new NotFoundException('Inspection not found.');
    if (
      existing &&
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== existing.rowVersion
    )
      throw CommercialCoreService.conflict();
    if (
      ['FAILED', 'HOLD', 'PARTIAL'].includes(dto.status) &&
      !(dto.reason && dto.reason.trim().length >= 3)
    )
      throw new BadRequestException({
        message: 'A reason is required for failed, partial or held quality.',
        details: { code: 'QUALITY_REASON_REQUIRED' },
      });
    if (
      dto.status === 'WAIVED' &&
      !(dto.reason && dto.reason.trim().length >= 3)
    )
      throw new BadRequestException(
        'A reason is required to waive inspection.',
      );
    const item = dto.itemId
      ? g.items.find((i) => i.id === dto.itemId)
      : g.items.length === 1
        ? g.items[0]
        : null;
    if (!item)
      throw new BadRequestException('Choose the receipt line inspected.');
    const usable = new D(item.receivedQuantity.toString()).minus(
      item.damagedQuantity.toString(),
    );
    const acc =
      dto.status === 'HOLD'
        ? new D(0)
        : new D(
            dto.acceptedQuantity ??
              (dto.status === 'PASSED' || dto.status === 'WAIVED'
                ? usable.toString()
                : '0'),
          );
    const rej =
      dto.status === 'HOLD'
        ? new D(0)
        : new D(
            dto.rejectedQuantity ??
              (dto.status === 'FAILED' ? usable.minus(acc).toString() : '0'),
          );
    if (acc.plus(rej).gt(usable))
      throw new BadRequestException(
        `Accepted + rejected cannot exceed ${usable.toString()} (received minus damaged).`,
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_purchase_orders WHERE id = ${g.supplierPoId} FOR UPDATE`;
      const data = {
        status: dto.status,
        inspectedAt: dto.inspectedAt ? new Date(dto.inspectedAt) : new Date(),
        inspectorUserId: a.userId,
        checks: (dto.checks ?? []) as unknown as Prisma.InputJsonValue,
        acceptedQuantity: acc,
        rejectedQuantity: rej,
        reason: dto.reason ?? null,
        notes: dto.notes ?? null,
      };
      if (existing) {
        const n = await tx.qualityInspection.updateMany({
          where: { id: existing.id, rowVersion: existing.rowVersion },
          data: { ...data, rowVersion: { increment: 1 } },
        });
        if (n.count !== 1) throw CommercialCoreService.conflict();
      } else
        await tx.qualityInspection.create({
          data: {
            ...data,
            organizationId: org,
            goodsReceiptId: grnId,
            goodsReceiptItemId: item.id,
          },
        });
      // Receipt line quantities follow the latest inspection of that line; PO item totals are recomputed.
      await tx.goodsReceiptItem.update({
        where: { id: item.id },
        data: { acceptedQuantity: acc, rejectedQuantity: rej },
      });
      const lines = await tx.goodsReceiptItem.findMany({
        where: { goodsReceipt: { supplierPoId: g.supplierPoId } },
      });
      for (const pi of g.supplierPo.items) {
        const mine = lines.filter((l) => l.supplierPoItemId === pi.id);
        await tx.supplierPurchaseOrderItem.update({
          where: { id: pi.id },
          data: {
            acceptedQuantity: mine.reduce(
              (s, l) => s.plus(l.acceptedQuantity.toString()),
              new D(0),
            ),
            rejectedQuantity: mine.reduce(
              (s, l) => s.plus(l.rejectedQuantity.toString()),
              new D(0),
            ),
          },
        });
      }
      const insp = await tx.qualityInspection.findMany({
        where: { goodsReceiptId: grnId },
      });
      const latest = new Map<string, string>();
      for (const i of insp.sort(
        (x, y) => x.updatedAt.getTime() - y.updatedAt.getTime(),
      ))
        latest.set(i.goodsReceiptItemId ?? '', i.status);
      const st = [...latest.values()];
      const grnStatus = g.items.some((l) => !latest.has(l.id))
        ? 'PENDING'
        : st.includes('HOLD')
          ? 'HOLD'
          : st.includes('FAILED')
            ? 'FAILED'
            : st.includes('PARTIAL')
              ? 'PARTIAL'
              : st.every((x) => x === 'WAIVED')
                ? 'WAIVED'
                : 'PASSED';
      await tx.goodsReceipt.update({
        where: { id: grnId },
        data: { qualityStatus: grnStatus },
      });
      // Rejected goods reopen the receiving balance; a hold is visible as procurement QUALITY_HOLD.
      const items = await tx.supplierPurchaseOrderItem.findMany({
        where: { supplierPoId: g.supplierPoId },
      });
      const po = await tx.supplierPurchaseOrder.findUniqueOrThrow({
        where: { id: g.supplierPoId },
      });
      if (['RECEIVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
        const full = items.every((i) =>
          new D(i.receivedQuantity.toString())
            .minus(i.damagedQuantity.toString())
            .minus(i.rejectedQuantity.toString())
            .gte(i.quantity.toString()),
        );
        const all = await tx.goodsReceipt.findMany({
          where: { supplierPoId: g.supplierPoId },
        });
        const hold = all.some(
          (r) => r.qualityStatus === 'HOLD' || r.qualityStatus === 'FAILED',
        );
        await tx.supplierPurchaseOrder.update({
          where: { id: po.id },
          data: {
            status: full ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
            procurementStatus: hold
              ? 'QUALITY_HOLD'
              : full
                ? 'RECEIVED'
                : 'PARTIALLY_RECEIVED',
            rowVersion: { increment: 1 },
          },
        });
      }
      await this.ev(
        tx,
        a,
        g.supplierPoId,
        'QUALITY',
        null,
        dto.status,
        `${g.grnNumber}: accepted ${acc.toString()}, rejected ${rej.toString()}${dto.reason ? ` — ${dto.reason}` : ''}`,
      );
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'quality.inspected',
      entityType: 'GoodsReceipt',
      entityId: grnId,
      metadata: {
        status: dto.status,
        accepted: acc.toString(),
        rejected: rej.toString(),
      },
    });
    await this.syncMilestones(a, g.supplierPo);
    return this.grnDetail(a, grnId);
  }

  async attachInspection(
    a: Actor,
    inspectionId: string,
    file: Express.Multer.File,
    category: string,
  ) {
    const i = await this.prisma.qualityInspection.findFirst({
      where: { id: inspectionId, organizationId: a.organizationId },
      include: { goodsReceipt: { include: { supplierPo: true } } },
    });
    if (!i) throw new NotFoundException('Inspection not found.');
    await this.suppliers.saveAttachment(
      a,
      {
        supplierId: i.goodsReceipt.supplierPo.supplierId,
        entityType: 'INSPECTION',
        entityId: i.id,
      },
      file,
      category,
    );
    return this.grnDetail(a, i.goodsReceiptId);
  }

  async grnDetail(a: Actor, id: string): Promise<GoodsReceiptDetail> {
    const g = await this.loadGrn(a.organizationId, id);
    const sup = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: g.supplierPo.supplierId },
      select: { id: true, legalName: true },
    });
    const atts = await this.prisma.supplierAttachment.findMany({
      where: {
        organizationId: a.organizationId,
        entityType: 'INSPECTION',
        entityId: { in: g.inspections.map((i) => i.id) },
      },
    });
    const names = await this.core.userNames([
      g.receivedByUserId,
      ...g.inspections.map((i) => i.inspectorUserId),
    ]);
    return {
      ...this.grnSummary(g, sup),
      receivedBy: names.get(g.receivedByUserId) ?? null,
      notes: g.notes,
      overReceiptReason: g.overReceiptReason,
      items: g.items.map((l) => {
        const pi = g.supplierPo.items.find((x) => x.id === l.supplierPoItemId)!;
        return {
          id: l.id,
          spoItemId: pi.id,
          productName: pi.productName,
          received: l.receivedQuantity.toString(),
          damaged: l.damagedQuantity.toString(),
          accepted: l.acceptedQuantity.toString(),
          rejected: l.rejectedQuantity.toString(),
          unit: pi.unit,
        };
      }),
      inspections: g.inspections.map((i) => ({
        id: i.id,
        itemId: i.goodsReceiptItemId,
        inspectedAt: i.inspectedAt.toISOString(),
        inspector: names.get(i.inspectorUserId) ?? null,
        status: i.status as QualityStatus,
        checks: i.checks as never,
        acceptedQuantity: i.acceptedQuantity.toString(),
        rejectedQuantity: i.rejectedQuantity.toString(),
        reason: i.reason,
        notes: i.notes,
        attachments: atts
          .filter((x) => x.entityId === i.id)
          .map((x) => this.suppliers.attachmentView(x)),
        rowVersion: i.rowVersion,
      })),
      qualityRequirements: g.supplierPo.qualityRequirements,
      availableActions: this.can(a, 'quality.manage') ? ['inspect'] : [],
    };
  }

  private grnSummary(
    g: {
      id: string;
      grnNumber: string;
      receivedAt: Date;
      location: string | null;
      qualityStatus: string;
      items: { receivedQuantity: Prisma.Decimal }[];
      supplierPo: { id: string; spoNumber: string; items: { unit: string }[] };
    },
    sup: { id: string; legalName: string },
  ): GoodsReceiptSummary {
    return {
      id: g.id,
      grnNumber: g.grnNumber,
      supplier: sup,
      supplierPo: { id: g.supplierPo.id, spoNumber: g.supplierPo.spoNumber },
      receivedAt: g.receivedAt.toISOString(),
      location: g.location,
      quantity: g.items
        .reduce((s, i) => s.plus(i.receivedQuantity.toString()), new D(0))
        .toString(),
      unit: g.supplierPo.items[0]?.unit ?? '',
      qualityStatus: g.qualityStatus as QualityStatus,
    };
  }

  async grnList(
    a: Actor,
    q: ListDto,
  ): Promise<ProcurementList<GoodsReceiptSummary>> {
    const where: Prisma.GoodsReceiptWhereInput = {
      organizationId: a.organizationId,
      ...(q.quality ? { qualityStatus: q.quality } : {}),
      ...(q.supplierId ? { supplierPo: { supplierId: q.supplierId } } : {}),
      ...(q.search
        ? {
            OR: [
              { grnNumber: { contains: q.search, mode: 'insensitive' } },
              {
                supplierPo: {
                  spoNumber: { contains: q.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({
        where,
        include: { items: true, supplierPo: { include: { items: true } } },
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.goodsReceipt.count({ where }),
    ]);
    const sups = await this.prisma.supplier.findMany({
      where: { id: { in: rows.map((r) => r.supplierPo.supplierId) } },
      select: { id: true, legalName: true },
    });
    return {
      items: rows.map((g) =>
        this.grnSummary(
          g,
          sups.find((s) => s.id === g.supplierPo.supplierId)!,
        ),
      ),
      meta: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  // ---------------------------------------------------------------- payables

  private payableView(
    a: Actor,
    s: Row,
    sup: { id: string; legalName: string },
    names: Map<string, string>,
  ): SupplierPayableView | null {
    const p = s.payable;
    if (!p) return null;
    const ctx = {
      issuedAt: s.issuedAt,
      dispatchedAt: s.dispatchedAt,
      receivedAt: s.actualReceivedAt ?? s.receipts[0]?.receivedAt ?? null,
    };
    const { dueSoonDays } = { dueSoonDays: 7 };
    const inst = p.installments.map((i) => {
      const due = resolvePayableDue(
        { trigger: i.trigger, dueDays: i.dueDays, fixedDate: i.fixedDate },
        {
          ...ctx,
          receivedAt:
            i.trigger === 'ON_DELIVERY' || i.trigger === 'CREDIT_DAYS'
              ? (s.actualReceivedAt ?? null)
              : ctx.receivedAt,
        },
      );
      const st = installmentStatus({
        outstanding: new D(i.outstandingAmount.toString()),
        paid: new D(i.paidAmount.toString()),
        dueDate: due.dueDate,
        disputed: Boolean(p.disputedAt),
        today: new Date(),
        dueSoonDays,
      });
      return { row: i, due, st };
    });
    const status = receivableStatus({
      state: p.state === 'CANCELLED' ? 'CANCELLED' : 'OPEN',
      outstanding: new D(p.outstandingAmount.toString()),
      paid: new D(p.paidAmount.toString()),
      disputed: Boolean(p.disputedAt),
      installments: inst.map((x) => x.st.status),
    }) as PayableStatus;
    const next = inst
      .filter((x) => x.st.status !== 'PAID' && x.due.dueDate)
      .map((x) => x.due.dueDate!)
      .sort((x, y) => x.getTime() - y.getTime())[0];
    return {
      id: p.id,
      supplier: sup,
      supplierPo: { id: s.id, spoNumber: s.spoNumber },
      currency: p.currency,
      total: m2(new D(p.totalAmount.toString())),
      paid: m2(new D(p.paidAmount.toString())),
      outstanding: m2(new D(p.outstandingAmount.toString())),
      nextDueDate: next ? isoDay(next) : null,
      status,
      installments: inst.map(({ row: i, due, st }) => ({
        id: i.id,
        sequence: i.sequence,
        label: i.label,
        percentage: i.percentage?.toString() ?? null,
        amount: m2(new D(i.amount.toString())),
        trigger: i.trigger as never,
        dueDays: i.dueDays,
        dueDate: isoDay(due.dueDate),
        dueBasis: due.basis,
        paid: m2(new D(i.paidAmount.toString())),
        outstanding: m2(new D(i.outstandingAmount.toString())),
        status: st.status as PayableStatus,
        daysOverdue: st.daysOverdue,
      })),
      payments: p.payments.map((x) => ({
        id: x.id,
        amount: m2(new D(x.amount.toString())),
        currency: x.currency,
        appliedAmount: m2(new D(x.appliedAmount.toString())),
        paidAt: x.paidAt.toISOString(),
        method: x.method,
        reference: mask(x.reference),
        bankName: x.bankName,
        notes: x.notes,
        status: x.status as never,
        reversal: x.reversedAt
          ? {
              reason: x.reversalReason ?? '',
              by: x.reversedByUserId
                ? (names.get(x.reversedByUserId) ?? null)
                : null,
              at: x.reversedAt.toISOString(),
            }
          : null,
        recordedBy: names.get(x.recordedByUserId) ?? null,
        createdAt: x.createdAt.toISOString(),
      })),
      rowVersion: p.rowVersion,
    };
  }

  async payables(a: Actor, q: ListDto) {
    const rows = await this.prisma.supplierPurchaseOrder.findMany({
      where: {
        organizationId: a.organizationId,
        payable: { isNot: null },
        ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const sups = await this.prisma.supplier.findMany({
      where: { id: { in: rows.map((r) => r.supplierId) } },
      select: { id: true, legalName: true },
    });
    let items = rows.map((r) =>
      this.payableView(
        a,
        r,
        sups.find((s) => s.id === r.supplierId)!,
        new Map(),
      )!,
    );
    if (q.status) items = items.filter((x) => x.status === q.status);
    if (q.overdue === 'true')
      items = items.filter((x) => x.status === 'OVERDUE');
    if (q.search)
      items = items.filter((x) =>
        [x.supplier.legalName, x.supplierPo.spoNumber].some((y) =>
          y.toLowerCase().includes(q.search!.toLowerCase()),
        ),
      );
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    return {
      items: items
        .slice((page - 1) * pageSize, page * pageSize)
        .map((x) => ({ ...x, payments: [] })),
      meta: {
        page,
        pageSize,
        totalItems: items.length,
        totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
      },
    };
  }

  /** Open installments with a resolved due date within 7 days (or past) — one rule for overview, Action Center and AI. */
  async dueInstallments(a: Actor) {
    const list = await this.payables(a, { pageSize: 1000 });
    const today = new Date();
    return list.items
      .filter((p) => p.status !== 'CANCELLED')
      .flatMap((p) =>
        p.installments
          .filter(
            (i) =>
              new D(i.outstanding).gt(0) &&
              i.dueDate &&
              dayDiff(today, new Date(i.dueDate)) <= 7,
          )
          .map((i) => ({ payable: p, installment: i })),
      );
  }

  private async payableRow(org: string, payableId: string) {
    const p = await this.prisma.supplierPayable.findFirst({
      where: { id: payableId, organizationId: org },
    });
    if (!p) throw new NotFoundException('Supplier payable not found.');
    return p;
  }

  async payable(a: Actor, payableId: string) {
    const p = await this.payableRow(a.organizationId, payableId);
    const s = await this.load(a.organizationId, p.supplierPoId);
    const sup = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: s.supplierId },
      select: { id: true, legalName: true },
    });
    const names = await this.core.userNames(
      s.payable!.payments.flatMap((x) => [
        x.recordedByUserId,
        x.reversedByUserId,
      ]),
    );
    return this.payableView(a, s, sup, names)!;
  }

  /** Partial payments, duplicate-reference protection, never below zero; payments never add to cost. */
  async pay(a: Actor, payableId: string, dto: SupplierPaymentDto) {
    const org = a.organizationId;
    const p0 = await this.payableRow(org, payableId);
    if (p0.state !== 'OPEN')
      throw new ConflictException('This payable is not open.');
    let applied = new D(dto.amount);
    let fxRate: Dec | null = null;
    if (dto.currency !== p0.currency) {
      if (!dto.fxRate)
        throw new BadRequestException({
          message: `Payment in ${dto.currency} for a ${p0.currency} payable needs the exchange rate used.`,
          details: { code: 'FX_REQUIRED' },
        });
      fxRate = new D(dto.fxRate);
      applied = applied.mul(fxRate).toDecimalPlaces(2);
    }
    const key = referenceKey(dto.reference);
    if (
      key &&
      (await this.prisma.supplierPayment.findFirst({
        where: { payableId, referenceKey: key },
      }))
    )
      throw new ConflictException({
        message: 'A supplier payment with this reference is already recorded.',
        details: { code: 'DUPLICATE_PAYMENT' },
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_payables WHERE id = ${payableId} FOR UPDATE`;
      const p = await tx.supplierPayable.findUniqueOrThrow({
        where: { id: payableId },
        include: { installments: true },
      });
      if (
        dto.expectedRowVersion !== undefined &&
        dto.expectedRowVersion !== p.rowVersion
      )
        throw CommercialCoreService.conflict();
      const { allocations, excess } = allocate(
        applied,
        p.installments.map((i) => ({
          id: i.id,
          sequence: i.sequence,
          outstanding: new D(i.outstandingAmount.toString()),
        })),
        dto.installmentId ?? null,
      );
      if (excess.gt(0))
        throw new ConflictException({
          message: `This payment exceeds the outstanding ${p.currency} ${m2(new D(p.outstandingAmount.toString()))}.`,
          details: { code: 'OVERPAYMENT' },
        });
      for (const al of allocations)
        await tx.supplierPayableInstallment.update({
          where: { id: al.installmentId },
          data: {
            paidAmount: { increment: new D(al.amount) },
            outstandingAmount: { decrement: new D(al.amount) },
          },
        });
      await tx.supplierPayable.update({
        where: { id: payableId },
        data: {
          paidAmount: { increment: applied },
          outstandingAmount: { decrement: applied },
          rowVersion: { increment: 1 },
        },
      });
      try {
        await tx.supplierPayment.create({
          data: {
            organizationId: org,
            payableId,
            amount: new D(dto.amount),
            currency: dto.currency,
            appliedAmount: applied,
            fxRate,
            paidAt: new Date(dto.paidAt),
            method: dto.method,
            reference: dto.reference ?? null,
            referenceKey: key,
            bankName: dto.bankName ?? null,
            notes: dto.notes ?? null,
            allocations: allocations as unknown as Prisma.InputJsonValue,
            recordedByUserId: a.userId,
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        )
          throw new ConflictException({
            message:
              'A supplier payment with this reference is already recorded.',
            details: { code: 'DUPLICATE_PAYMENT' },
          });
        throw e;
      }
      await this.ev(
        tx,
        a,
        p.supplierPoId,
        'PAYMENT',
        null,
        `${dto.currency} ${dto.amount}`,
        null,
      );
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'supplier_payment.recorded',
      entityType: 'SupplierPayable',
      entityId: payableId,
      metadata: {
        amount: dto.amount,
        currency: dto.currency,
        method: dto.method,
      },
    });
    return this.payable(a, payableId);
  }

  async reversePayment(a: Actor, paymentId: string, reason: string) {
    const org = a.organizationId;
    const x = await this.prisma.supplierPayment.findFirst({
      where: { id: paymentId, organizationId: org },
    });
    if (!x) throw new NotFoundException('Supplier payment not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_payables WHERE id = ${x.payableId} FOR UPDATE`;
      const p = await tx.supplierPayment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      if (p.status !== 'RECORDED')
        throw new ConflictException('This payment has already been reversed.');
      for (const al of p.allocations as {
        installmentId: string;
        amount: string;
      }[])
        await tx.supplierPayableInstallment.update({
          where: { id: al.installmentId },
          data: {
            paidAmount: { decrement: new D(al.amount) },
            outstandingAmount: { increment: new D(al.amount) },
          },
        });
      await tx.supplierPayable.update({
        where: { id: p.payableId },
        data: {
          paidAmount: { decrement: p.appliedAmount },
          outstandingAmount: { increment: p.appliedAmount },
          rowVersion: { increment: 1 },
        },
      });
      await tx.supplierPayment.update({
        where: { id: paymentId },
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
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'supplier_payment.reversed',
      entityType: 'SupplierPayable',
      entityId: x.payableId,
      metadata: { paymentId, reason },
    });
    return this.payable(a, x.payableId);
  }

  // ---------------------------------------------------------------- views

  private summary(
    a: Actor,
    s: Row,
    sup: { id: string; legalName: string },
    refs: {
      pos: { id: string; poNumber: string }[];
      ships: { id: string; shipmentNumber: string }[];
    },
  ): SupplierPoSummary {
    const ordered = s.items.reduce(
      (t, i) => t.plus(i.quantity.toString()),
      new D(0),
    );
    const usable = s.items.reduce(
      (t, i) =>
        t.plus(
          new D(i.receivedQuantity.toString())
            .minus(i.damagedQuantity.toString())
            .minus(i.rejectedQuantity.toString()),
        ),
      new D(0),
    );
    const open = !['RECEIVED', 'COMPLETED', 'CANCELLED', 'DRAFT'].includes(
      s.status,
    );
    const q = s.receipts.map((r) => r.qualityStatus);
    const pv = s.payable ? this.payableView(a, s, sup, new Map()) : null;
    const prices = this.suppliers.canSeePrices(a);
    return {
      id: s.id,
      spoNumber: s.spoNumber,
      revision: s.revision,
      supplier: sup,
      buyerPurchaseOrder:
        refs.pos.find((p) => p.id === s.buyerPurchaseOrderId) ?? null,
      shipment: refs.ships.find((p) => p.id === s.shipmentId) ?? null,
      productNames: s.items.map((i) => i.productName),
      currency: s.currency,
      total: prices ? (s.totalAmount?.toFixed(2) ?? null) : null,
      originalExpectedDate: isoDay(s.originalExpectedDate),
      expectedDate: isoDay(s.expectedDate),
      delayDays:
        s.originalExpectedDate && s.expectedDate
          ? dayDiff(s.originalExpectedDate, s.expectedDate) || null
          : null,
      overdue: Boolean(
        open && s.expectedDate && dayDiff(new Date(), s.expectedDate) < 0,
      ),
      status: s.status as SupplierPoSummary['status'],
      procurementStatus:
        s.procurementStatus as SupplierPoSummary['procurementStatus'],
      receivedPercent: ordered.isZero()
        ? 0
        : Math.min(100, Math.round(usable.div(ordered).mul(100).toNumber())),
      qualityState: (q.length
        ? q.includes('HOLD')
          ? 'HOLD'
          : q.includes('FAILED')
            ? 'FAILED'
            : q.includes('PENDING')
              ? 'PENDING'
              : q.includes('PARTIAL')
                ? 'PARTIAL'
                : 'PASSED'
        : 'NONE') as SupplierPoSummary['qualityState'],
      payable:
        pv && this.can(a, 'supplier_payments.view')
          ? { status: pv.status, outstanding: pv.outstanding }
          : null,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private async refs(org: string, rows: Row[]) {
    const [pos, ships, sups] = await Promise.all([
      this.prisma.buyerPurchaseOrder.findMany({
        where: {
          organizationId: org,
          id: {
            in: rows
              .map((r) => r.buyerPurchaseOrderId)
              .filter((x): x is string => !!x),
          },
        },
        select: { id: true, poNumber: true },
      }),
      this.prisma.shipment.findMany({
        where: {
          organizationId: org,
          id: {
            in: rows.map((r) => r.shipmentId).filter((x): x is string => !!x),
          },
        },
        select: { id: true, shipmentNumber: true },
      }),
      this.prisma.supplier.findMany({
        where: { id: { in: rows.map((r) => r.supplierId) } },
        select: { id: true, legalName: true },
      }),
    ]);
    return { pos, ships, sups };
  }

  async list(
    a: Actor,
    q: ListDto,
  ): Promise<ProcurementList<SupplierPoSummary>> {
    const where: Prisma.SupplierPurchaseOrderWhereInput = {
      organizationId: a.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.buyerPurchaseOrderId
        ? { buyerPurchaseOrderId: q.buyerPurchaseOrderId }
        : {}),
      ...(q.shipmentId ? { shipmentId: q.shipmentId } : {}),
      ...(q.product
        ? {
            items: {
              some: {
                productName: { contains: q.product, mode: 'insensitive' },
              },
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { spoNumber: { contains: q.search, mode: 'insensitive' } },
              {
                items: {
                  some: {
                    productName: { contains: q.search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
      ...(q.overdue === 'true'
        ? {
            status: {
              in: [
                'ISSUED',
                'ACKNOWLEDGED',
                'IN_PRODUCTION',
                'READY',
                'PARTIALLY_RECEIVED',
              ],
            },
            expectedDate: {
              lt: new Date(new Date().toISOString().slice(0, 10)),
            },
          }
        : {}),
    };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.supplierPurchaseOrder.findMany({
        where,
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplierPurchaseOrder.count({ where }),
    ]);
    const r = await this.refs(a.organizationId, rows);
    return {
      items: rows.map((s) =>
        this.summary(
          a,
          s,
          r.sups.find((x) => x.id === s.supplierId)!,
          r,
        ),
      ),
      meta: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async detail(a: Actor, id: string): Promise<SupplierPoDetail> {
    const org = a.organizationId;
    const s = await this.load(org, id);
    const r = await this.refs(org, [s]);
    const sup = r.sups[0];
    const names = await this.core.userNames([
      s.issuedByUserId,
      s.externallySentByUserId,
      ...s.events.map((e) => e.createdByUserId),
      ...(s.payable?.payments ?? []).flatMap((x) => [
        x.recordedByUserId,
        x.reversedByUserId,
      ]),
      ...(s.revisions as { by: string }[]).map((x) => x.by),
    ]);
    const prices = this.suppliers.canSeePrices(a);
    const rfq = s.rfqId
      ? await this.prisma.supplierRfq.findFirst({
          where: { id: s.rfqId },
          select: { id: true, rfqNumber: true },
        })
      : null;
    const quote = s.quoteId
      ? await this.prisma.supplierQuote.findFirst({ where: { id: s.quoteId } })
      : null;
    const estimate =
      quote && rfq
        ? m2(
            new D(quote.unitPrice.toString()).mul(
              s.items.reduce((t, i) => t.plus(i.quantity.toString()), new D(0)),
            ),
          )
        : null;
    const cost = procurementCost(s, estimate);
    const comp = this.completion(s);
    const can = (p: Parameters<typeof roleHasPermission>[1]) => this.can(a, p);
    const actions: string[] = [];
    if (s.status === 'DRAFT' && can('procurement.manage')) actions.push('edit');
    if (s.status === 'DRAFT' && can('supplier_po.issue')) actions.push('issue');
    if (
      ['ISSUED', 'ACKNOWLEDGED', 'IN_PRODUCTION', 'READY'].includes(s.status) &&
      can('supplier_po.issue')
    )
      actions.push('revise');
    if (
      !['DRAFT', 'COMPLETED', 'CANCELLED'].includes(s.status) &&
      can('procurement.manage')
    )
      actions.push('status', 'expected_date', 'record_sent');
    if (RECEIVABLE.includes(s.status) && can('goods_receipt.manage'))
      actions.push('receive');
    if (
      s.payable &&
      s.payable.state === 'OPEN' &&
      can('supplier_payments.manage')
    )
      actions.push('pay');
    if (s.payable && can('supplier_payments.manage'))
      actions.push('reverse_payment');
    if (s.status !== 'DRAFT') actions.push('pdf');
    const o = await this.prisma.organization.findUniqueOrThrow({
      where: { id: org },
      select: { name: true, legalName: true },
    });
    return {
      ...this.summary(a, s, sup, r),
      rowVersion: s.rowVersion,
      rfq,
      quote: quote ? { id: quote.id, reference: quote.quoteReference } : null,
      poDate: isoDay(s.poDate),
      items: s.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.productName,
        specification: i.specification,
        quantity: i.quantity.toString(),
        unit: i.unit,
        unitPrice: prices ? i.unitPrice.toString() : null,
        taxPercent: qty(i.taxPercent),
        lineTotal: prices
          ? m2(new D(i.quantity.toString()).mul(i.unitPrice.toString()))
          : null,
        receivedQuantity: i.receivedQuantity.toString(),
        acceptedQuantity: i.acceptedQuantity.toString(),
        rejectedQuantity: i.rejectedQuantity.toString(),
        damagedQuantity: i.damagedQuantity.toString(),
        pendingInspection: new D(i.receivedQuantity.toString())
          .minus(i.damagedQuantity.toString())
          .minus(i.acceptedQuantity.toString())
          .minus(i.rejectedQuantity.toString())
          .toString(),
      })),
      charges: prices
        ? {
            packaging: s.packagingCost?.toFixed(2) ?? null,
            inlandTransport: s.inlandTransportCost?.toFixed(2) ?? null,
            inspection: s.inspectionCost?.toFixed(2) ?? null,
            other: s.otherCharges?.toFixed(2) ?? null,
            tax: s.taxAmount?.toFixed(2) ?? null,
          }
        : {
            packaging: null,
            inlandTransport: null,
            inspection: null,
            other: null,
            tax: null,
          },
      subtotal: prices ? (s.subtotal?.toFixed(2) ?? null) : null,
      deliveryLocation: s.deliveryLocation,
      paymentTerms: s.paymentTerms,
      paymentSchedule: s.paymentSchedule as SupplierPoDetail['paymentSchedule'],
      qualityRequirements: s.qualityRequirements,
      certificationRequirements: s.certificationRequirements,
      notes: s.notes,
      issuedAt: s.issuedAt?.toISOString() ?? null,
      issuedBy: s.issuedByUserId ? (names.get(s.issuedByUserId) ?? null) : null,
      externallySent: s.externallySentAt
        ? {
            at: s.externallySentAt.toISOString(),
            via: s.externallySentVia ?? 'OTHER',
            by: s.externallySentByUserId
              ? (names.get(s.externallySentByUserId) ?? null)
              : null,
          }
        : null,
      snapshot: prices
        ? ((s.snapshot as Record<string, unknown>) ?? null)
        : null,
      revisions: prices
        ? (
            s.revisions as {
              revision: number;
              at: string;
              by: string;
              reason: string;
              snapshot: Record<string, unknown>;
            }[]
          ).map((x) => ({ ...x, by: names.get(x.by) ?? null }))
        : [],
      history: s.events.map((e) => ({
        id: e.id,
        type: e.type,
        from: e.fromValue,
        to: e.toValue,
        reason: e.reason,
        at: e.createdAt.toISOString(),
        by: e.createdByUserId ? (names.get(e.createdByUserId) ?? null) : null,
      })),
      receipts: s.receipts.map((g) =>
        this.grnSummary(
          {
            ...g,
            supplierPo: { id: s.id, spoNumber: s.spoNumber, items: s.items },
          },
          sup,
        ),
      ),
      payableDetail: can('supplier_payments.view')
        ? this.payableView(a, s, sup, names)
        : null,
      cost: prices
        ? cost
        : {
            ...cost,
            quoteEstimate: null,
            committed: null,
            receivedValue: null,
            actual: null,
            components: [],
          },
      completion: comp,
      allowedStatuses: [
        ...(PO_TRANSITIONS[s.status] ?? []),
        ...(['ISSUED', 'ACKNOWLEDGED', 'IN_PRODUCTION', 'READY'].includes(
          s.status,
        )
          ? ['DISPATCHED']
          : []),
      ],
      availableActions: actions,
      messageText: `Dear ${sup.legalName} team,\n\nPlease find attached our purchase order ${s.spoNumber}${s.revision > 1 ? ` (revision ${s.revision})` : ''} for ${s.items.map((i) => `${i.quantity.toString()} ${i.unit} ${i.productName}`).join(', ')}, delivery to ${s.deliveryLocation ?? 'the agreed location'} by ${isoDay(s.expectedDate) ?? 'the agreed date'}.\n\nKindly acknowledge receipt and confirm the delivery date.\n\nRegards,\n${o.legalName || o.name}`,
    };
  }

  /** Supplier PO PDF from the issued snapshot — supplier-side figures only (no buyer price or margin). */
  async pdf(a: Actor, id: string) {
    const s = await this.load(a.organizationId, id);
    if (s.status === 'DRAFT')
      throw new ConflictException(
        'Issue the supplier PO before generating its PDF.',
      );
    if (!this.suppliers.canSeePrices(a))
      throw new ForbiddenException(
        'Supplier pricing is not available for your role.',
      );
    const snap = s.snapshot as {
      items: {
        productName: string;
        specification: string | null;
        quantity: string;
        unit: string;
        unitPrice: string;
      }[];
      subtotal: string | null;
      total: string | null;
      charges: Record<string, string | null>;
    } | null;
    const sup = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: s.supplierId },
    });
    const exporter = await this.core.exporterSnapshot(a.organizationId);
    const items = snap?.items ?? [];
    const charges = snap
      ? Object.entries(snap.charges)
          .filter(([k, v]) => v && k !== 'tax')
          .reduce((t, [, v]) => t.plus(v!), new D(0))
      : new D(0);
    const buf = renderCommercialPdf(
      {
        title: 'PURCHASE ORDER',
        partyLabel: 'Supplier',
        number: `${s.spoNumber}${s.revision > 1 ? ` (Rev ${s.revision})` : ''}`,
        draft: false,
        issueDate: isoDay(s.poDate),
        validUntil: null,
        exporter,
        buyer: {
          name: sup.legalName,
          address:
            [sup.address, sup.city, sup.state].filter(Boolean).join(', ') ||
            null,
          country: 'India',
          contactName: sup.contactPerson,
          email: sup.email,
          phone: sup.phone,
        },
        currency: s.currency,
        items: items.map((i) => ({
          description: i.productName,
          hsCode: null,
          specification: i.specification,
          packaging: null,
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
          total: m2(new D(i.quantity).mul(i.unitPrice)),
        })),
        subtotal: snap?.subtotal ?? null,
        charges: charges.gt(0)
          ? {
              label: 'Packaging / transport / inspection / other',
              amount: m2(charges),
            }
          : null,
        discount: null,
        total: snap?.total ?? null,
        incoterm: null,
        destination: s.deliveryLocation,
        paymentTerms: s.paymentTerms,
        deliveryTerms: `Expected delivery: ${isoDay(s.expectedDate) ?? 'to be confirmed'}${s.qualityRequirements ? `\nQuality: ${s.qualityRequirements}` : ''}${s.certificationRequirements.length ? `\nCertificates required: ${s.certificationRequirements.join(', ')}` : ''}`,
        buyerNotes: s.notes,
        terms: snap?.charges.tax
          ? `Taxes (GST): ${s.currency} ${snap.charges.tax}`
          : null,
        bank: null,
        reference: s.status === 'CANCELLED' ? 'Cancelled' : null,
        footer:
          'Supplier purchase order. Quantities are subject to quality inspection on receipt.',
      },
      exporter.hasLogo ? await this.core.logo(a.organizationId) : null,
    );
    return {
      buffer: buf,
      filename: `${s.spoNumber}${s.revision > 1 ? `-R${s.revision}` : ''}.pdf`,
    };
  }

  // ---------------------------------------------------------------- integrations

  /**
   * Sprint 18 milestones from procurement truth: PROCUREMENT in progress once a supplier
   * PO is issued, completed only when goods are received and quality accepted;
   * PRODUCTION only from an explicitly recorded production/ready state. Manual
   * completions/skips are never overwritten.
   */
  async syncMilestones(
    a: Actor,
    s: { buyerPurchaseOrderId: string | null; shipmentId: string | null },
  ) {
    const org = a.organizationId;
    const ships = await this.prisma.shipment.findMany({
      where: {
        organizationId: org,
        status: { not: 'CANCELLED' },
        OR: [
          ...(s.shipmentId ? [{ id: s.shipmentId }] : []),
          ...(s.buyerPurchaseOrderId
            ? [{ purchaseOrderId: s.buyerPurchaseOrderId }]
            : []),
        ],
      },
    });
    for (const sh of ships) {
      const spos = await linkedSupplierPos(this.prisma, org, sh);
      if (!spos.length) continue;
      const done = spos.every(
        (p) => ['RECEIVED', 'COMPLETED'].includes(p.status) && qualityDone(p),
      );
      const procStatus = done
        ? 'COMPLETED'
        : spos.some((p) =>
              p.receipts.some((r) =>
                ['HOLD', 'FAILED'].includes(r.qualityStatus),
              ),
            )
          ? 'BLOCKED'
          : 'IN_PROGRESS';
      const prodStarted = spos.some((p) =>
        [
          'IN_PRODUCTION',
          'READY',
          'DISPATCHED',
          'PARTIALLY_RECEIVED',
          'RECEIVED',
          'CLOSED',
        ].includes(p.procurementStatus),
      );
      const prodDone = spos.every((p) =>
        [
          'READY',
          'DISPATCHED',
          'PARTIALLY_RECEIVED',
          'RECEIVED',
          'QUALITY_HOLD',
          'CLOSED',
        ].includes(p.procurementStatus),
      );
      const ms = await this.prisma.shipmentMilestone.findMany({
        where: {
          shipmentId: sh.id,
          stage: { in: ['PROCUREMENT', 'PRODUCTION'] },
        },
      });
      for (const m of ms) {
        if (
          m.source === 'MANUAL' &&
          ['COMPLETED', 'SKIPPED'].includes(m.status)
        )
          continue;
        const explicitProduction = spos.some(
          (p) =>
            ['IN_PRODUCTION', 'READY'].includes(p.status) ||
            p.procurementStatus === 'DISPATCHED',
        );
        const next =
          m.stage === 'PROCUREMENT'
            ? procStatus
            : explicitProduction || prodStarted
              ? prodDone
                ? 'COMPLETED'
                : 'IN_PROGRESS'
              : null;
        if (!next || next === m.status) continue;
        await this.prisma.shipmentMilestone.update({
          where: { id: m.id },
          data: {
            status: next,
            source: 'SYSTEM_DERIVED',
            notes: `From supplier PO ${spos.map((p) => p.spoNumber).join(', ')}`,
            reason:
              next === 'BLOCKED'
                ? 'Supplier goods on quality hold / failed inspection'
                : null,
            actualAt: next === 'COMPLETED' ? new Date() : null,
          },
        });
      }
    }
  }

  async overview(a: Actor): Promise<ProcurementOverview> {
    const org = a.organizationId;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const [suppliers, openRfqs, pending, open, delayed, awaiting, holds] =
      await Promise.all([
        this.prisma.supplier.count({ where: { organizationId: org } }),
        this.prisma.supplierRfq.count({
          where: {
            organizationId: org,
            status: {
              in: ['DRAFT', 'READY', 'REQUESTED', 'PARTIALLY_QUOTED', 'QUOTED'],
            },
          },
        }),
        this.prisma.supplierQuote.count({
          where: { organizationId: org, review: 'PENDING_REVIEW' },
        }),
        this.prisma.supplierPurchaseOrder.count({
          where: {
            organizationId: org,
            status: {
              in: [
                'DRAFT',
                'ISSUED',
                'ACKNOWLEDGED',
                'IN_PRODUCTION',
                'READY',
                'PARTIALLY_RECEIVED',
                'RECEIVED',
              ],
            },
          },
        }),
        this.prisma.supplierPurchaseOrder.count({
          where: {
            organizationId: org,
            status: {
              in: [
                'ISSUED',
                'ACKNOWLEDGED',
                'IN_PRODUCTION',
                'READY',
                'PARTIALLY_RECEIVED',
              ],
            },
            expectedDate: { lt: today },
          },
        }),
        this.prisma.goodsReceipt.count({
          where: { organizationId: org, qualityStatus: 'PENDING' },
        }),
        this.prisma.goodsReceipt.count({
          where: {
            organizationId: org,
            qualityStatus: { in: ['HOLD', 'FAILED'] },
          },
        }),
      ]);
    const dueList = this.can(a, 'supplier_payments.view')
      ? await this.dueInstallments(a)
      : [];
    const due = [...new Set(dueList.map((x) => x.payable.id))];
    const over = new Map<string, Dec>();
    for (const x of dueList.filter((d) => d.installment.status === 'OVERDUE'))
      over.set(
        x.payable.currency,
        (over.get(x.payable.currency) ?? new D(0)).plus(
          x.installment.outstanding,
        ),
      );
    return {
      suppliers,
      openRfqs,
      quotesAwaitingReview: pending,
      openSupplierPos: open,
      delayed,
      awaitingInspection: awaiting,
      qualityHolds: holds,
      paymentsDue: due.length,
      overduePayables: [...over.entries()].map(([currency, v]) => ({
        currency,
        amount: m2(v),
      })),
      actions: [
        ...(delayed
          ? [
              {
                kind: 'DELAYED',
                title: `${delayed} supplier PO(s) past expected delivery`,
                href: '/procurement/orders?overdue=true',
              },
            ]
          : []),
        ...(awaiting
          ? [
              {
                kind: 'INSPECTION',
                title: `${awaiting} goods receipt(s) awaiting inspection`,
                href: '/procurement/receipts?quality=PENDING',
              },
            ]
          : []),
        ...(holds
          ? [
              {
                kind: 'QUALITY',
                title: `${holds} goods receipt(s) on hold or failed`,
                href: '/procurement/receipts?quality=HOLD',
              },
            ]
          : []),
        ...(pending
          ? [
              {
                kind: 'REVIEW',
                title: `${pending} supplier quote(s) awaiting review`,
                href: '/procurement/rfqs',
              },
            ]
          : []),
        ...(due.length
          ? [
              {
                kind: 'PAYMENT',
                title: `${due.length} supplier payment(s) due`,
                href: '/procurement/payables',
              },
            ]
          : []),
      ],
    };
  }

  async requirement(
    a: Actor,
    buyerPoId: string,
  ): Promise<ProcurementRequirement> {
    const po = await this.prisma.buyerPurchaseOrder.findFirst({
      where: { id: buyerPoId, organizationId: a.organizationId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!po) throw new NotFoundException('Buyer PO not found.');
    const [rfqs, spos] = await Promise.all([
      this.prisma.supplierRfq.findMany({
        where: {
          organizationId: a.organizationId,
          buyerPurchaseOrderId: buyerPoId,
        },
        select: { id: true, rfqNumber: true, status: true },
      }),
      this.prisma.supplierPurchaseOrder.findMany({
        where: {
          organizationId: a.organizationId,
          buyerPurchaseOrderId: buyerPoId,
        },
        select: { id: true, spoNumber: true, status: true },
      }),
    ]);
    // Buyer prices are intentionally not included.
    return {
      buyerPurchaseOrder: {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
      },
      items: po.items.map((i) => ({
        productId: i.productId,
        productName: i.description,
        quantity: i.quantity.toString(),
        unit: i.unit,
        specification: i.specification,
        packaging: i.packaging,
      })),
      existingRfqs: rfqs as never,
      existingSupplierPos: spos as never,
    };
  }

  /** Explicit resolution when manual procurement actuals and linked supplier POs both exist (manual lines are never deleted). */
  async setCostSource(
    a: Actor,
    shipmentId: string,
    source: 'LINKED' | 'MANUAL',
  ) {
    const sh = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, organizationId: a.organizationId },
    });
    if (!sh) throw new NotFoundException('Shipment not found.');
    const prof = await this.prisma.shipmentProfitability.findUnique({
      where: { shipmentId },
    });
    if (prof?.finalized)
      throw new ConflictException(
        'Profitability is finalized — reopen it before changing the procurement source.',
      );
    await this.prisma.shipmentProfitability.upsert({
      where: { shipmentId },
      create: {
        organizationId: a.organizationId,
        shipmentId,
        procurementSource: source,
      },
      update: { procurementSource: source },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'procurement_cost.linked',
      entityType: 'Shipment',
      entityId: shipmentId,
      metadata: { source },
    });
    return this.shipmentProcurement(a, shipmentId);
  }

  async shipmentProcurement(
    a: Actor,
    shipmentId: string,
  ): Promise<ShipmentProcurement> {
    const sh = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, organizationId: a.organizationId },
    });
    if (!sh) throw new NotFoundException('Shipment not found.');
    const spos = await linkedSupplierPos(this.prisma, a.organizationId, sh);
    const sups = await this.prisma.supplier.findMany({
      where: { id: { in: spos.map((s) => s.supplierId) } },
      select: { id: true, legalName: true },
    });
    const prof = await this.prisma.shipmentProfitability.findUnique({
      where: { shipmentId },
    });
    const manual = await this.prisma.shipmentActualCost.count({
      where: {
        organizationId: a.organizationId,
        shipmentId,
        category: 'PROCUREMENT',
        voidedAt: null,
      },
    });
    const costs = spos.map((s) => procurementCost(s, null));
    const missing = costs.flatMap((c) => c.missing);
    const src = !spos.length
      ? manual
        ? 'MANUAL'
        : 'NONE'
      : manual && !prof?.procurementSource
        ? 'CONFLICT'
        : ((prof?.procurementSource as 'LINKED' | 'MANUAL' | null) ?? 'LINKED');
    return {
      shipmentId,
      supplierPos: spos.map((s) => {
        const ordered = s.items.reduce(
          (t, i) => t.plus(i.quantity.toString()),
          new D(0),
        );
        const usable = s.items.reduce(
          (t, i) =>
            t.plus(
              new D(i.receivedQuantity.toString())
                .minus(i.damagedQuantity.toString())
                .minus(i.rejectedQuantity.toString()),
            ),
          new D(0),
        );
        const q = s.receipts.map((r) => r.qualityStatus);
        return {
          id: s.id,
          spoNumber: s.spoNumber,
          supplier: sups.find((x) => x.id === s.supplierId)?.legalName ?? '',
          status: s.status as never,
          procurementStatus: s.procurementStatus as never,
          expectedDate: isoDay(s.expectedDate),
          receivedPercent: ordered.isZero()
            ? 0
            : Math.min(
                100,
                Math.round(usable.div(ordered).mul(100).toNumber()),
              ),
          qualityState: (q.length
            ? q.includes('HOLD')
              ? 'HOLD'
              : q.includes('FAILED')
                ? 'FAILED'
                : q.includes('PENDING')
                  ? 'PENDING'
                  : 'PASSED'
            : 'NONE') as never,
        };
      }),
      goodsReceived:
        spos.length > 0 &&
        spos.every((s) => ['RECEIVED', 'COMPLETED'].includes(s.status)),
      qualityApproved: spos.length > 0 && spos.every((s) => qualityDone(s)),
      costComplete: spos.length > 0 && costs.every((c) => c.complete),
      costSource: src,
      missing,
    };
  }
}
