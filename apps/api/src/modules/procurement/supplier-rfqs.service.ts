import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  roleHasPermission,
  type SupplierComparison,
  type SupplierComparisonRow,
  type SupplierQuoteView,
  type SupplierRfqDetail,
  type SupplierRfqSummary,
  type ProcurementList,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
} from '../commercial/commercial-core.service';
import { CostingService } from '../costing/costing.service';
import { D, type Dec } from '../costing/costing-calculator';
import { FinanceCoreService } from '../finance/finance-core.service';
import { isoDay, referenceKey } from '../finance/finance-rules';
import {
  landedUnit,
  monthlyCapacity,
  qty,
  sameMeasure,
  scoreFit,
} from './procurement-rules';
import type {
  CompareDto,
  ListDto,
  QuoteDto,
  RecordRequestedDto,
  ReviewQuoteDto,
  RfqDto,
  SelectQuoteDto,
  UseInCostingDto,
} from './procurement.dto';
import { SuppliersService } from './suppliers.service';

const INCLUDE = {
  recipients: true,
  quotes: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SupplierRfqInclude;
type Row = Prisma.SupplierRfqGetPayload<{ include: typeof INCLUDE }>;
type Quote = Row['quotes'][number];
const OPEN = ['DRAFT', 'READY', 'REQUESTED', 'PARTIALLY_QUOTED', 'QUOTED'];

/** Supplier-side RFQs and quotes — never mixed with buyer inquiries/quotations. */
@Injectable()
export class SupplierRfqsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CommercialCoreService,
    private readonly fin: FinanceCoreService,
    private readonly suppliers: SuppliersService,
    private readonly costing: CostingService,
    private readonly audit: AuditService,
  ) {}

  private async load(org: string, id: string) {
    const r = await this.prisma.supplierRfq.findFirst({
      where: { id, organizationId: org },
      include: INCLUDE,
    });
    if (!r) throw new NotFoundException('Supplier RFQ not found.');
    return r;
  }
  private event(a: Actor, id: string, type: string, title: string) {
    return this.prisma.commercialEvent.create({
      data: {
        organizationId: a.organizationId,
        entityType: 'SUPPLIER_RFQ',
        entityId: id,
        lineageId: id,
        type,
        title,
        actorUserId: a.userId,
      },
    });
  }
  private guard(r: { rowVersion: number }, v?: number) {
    if (v !== undefined && v !== r.rowVersion)
      throw CommercialCoreService.conflict();
  }

  /** Quote-derived status; REQUESTED only after the user records that it was sent. */
  private status(r: Row) {
    if (['CLOSED', 'CANCELLED'].includes(r.status)) return r.status;
    const requested = r.recipients.filter((x) =>
      ['REQUESTED', 'QUOTED'].includes(x.status),
    ).length;
    const quoted = new Set(r.quotes.map((q) => q.supplierId)).size;
    if (quoted && quoted >= r.recipients.length) return 'QUOTED';
    if (quoted) return 'PARTIALLY_QUOTED';
    if (requested) return 'REQUESTED';
    return r.recipients.length && r.quantity ? 'READY' : 'DRAFT';
  }

  // ---------------------------------------------------------------- create / edit

  async create(a: Actor, dto: RfqDto) {
    const org = a.organizationId;
    if (!dto.productName || !dto.quantity || !dto.unit)
      throw new BadRequestException('Product, quantity and unit are required.');
    if (
      dto.buyerPurchaseOrderId &&
      !(await this.prisma.buyerPurchaseOrder.findFirst({
        where: { id: dto.buyerPurchaseOrderId, organizationId: org },
      }))
    )
      throw new NotFoundException('Buyer PO not found.');
    if (
      dto.shipmentId &&
      !(await this.prisma.shipment.findFirst({
        where: { id: dto.shipmentId, organizationId: org },
      }))
    )
      throw new NotFoundException('Shipment not found.');
    const sups = dto.supplierIds?.length
      ? await this.prisma.supplier.findMany({
          where: { organizationId: org, id: { in: dto.supplierIds } },
        })
      : [];
    if (dto.supplierIds && sups.length !== new Set(dto.supplierIds).size)
      throw new NotFoundException('Supplier not found.');
    // Wastage/buffer only when the user enters it — never assumed.
    const base = new D(dto.quantity);
    const qtyTotal = dto.wastagePercent
      ? base
          .mul(new D(100).plus(dto.wastagePercent))
          .div(100)
          .toDecimalPlaces(4)
      : base;
    const r = await this.prisma.$transaction(async (tx) => {
      const number = await this.core.nextNumber(tx, org, 'SRFQ', 'SRFQ', true);
      return tx.supplierRfq.create({
        data: {
          organizationId: org,
          rfqNumber: number,
          productId: dto.productId ?? null,
          productName: dto.productName!.trim(),
          specification: dto.specification ?? null,
          baseQuantity: dto.wastagePercent ? base : null,
          wastagePercent: dto.wastagePercent ? new D(dto.wastagePercent) : null,
          quantity: qtyTotal,
          unit: dto.unit!,
          requiredBy: dto.requiredBy ? new Date(dto.requiredBy) : null,
          quoteDueDate: dto.quoteDueDate ? new Date(dto.quoteDueDate) : null,
          deliveryLocation: dto.deliveryLocation ?? null,
          packaging: dto.packaging ?? null,
          qualityRequirements: dto.qualityRequirements ?? null,
          certificationsRequired: dto.certificationsRequired ?? [],
          paymentTermsRequested: dto.paymentTermsRequested ?? null,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          notes: dto.notes ?? null,
          buyerPurchaseOrderId: dto.buyerPurchaseOrderId ?? null,
          shipmentId: dto.shipmentId ?? null,
          opportunityId: dto.opportunityId ?? null,
          status: sups.length ? 'READY' : 'DRAFT',
          createdByUserId: a.userId,
          recipients: {
            create: sups.map((s) => ({
              organizationId: org,
              supplierId: s.id,
            })),
          },
        },
      });
    });
    await this.event(
      a,
      r.id,
      'supplier_rfq.created',
      `Supplier RFQ ${r.rfqNumber} created for ${r.quantity.toString()} ${r.unit} ${r.productName}`,
    );
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'supplier_rfq.created',
      entityType: 'SupplierRfq',
      entityId: r.id,
      metadata: { suppliers: sups.length },
    });
    return this.detail(a, r.id);
  }

  async update(a: Actor, id: string, dto: RfqDto) {
    const r = await this.load(a.organizationId, id);
    this.guard(r, dto.expectedRowVersion);
    if (!OPEN.includes(r.status))
      throw new ConflictException(
        'A closed or cancelled RFQ cannot be edited.',
      );
    if (r.selectedQuoteId)
      throw new ConflictException(
        'A supplier was selected — requirements can no longer change.',
      );
    const add = dto.supplierIds
      ? await this.prisma.supplier.findMany({
          where: {
            organizationId: a.organizationId,
            id: { in: dto.supplierIds },
          },
        })
      : [];
    if (dto.supplierIds && add.length !== new Set(dto.supplierIds).size)
      throw new NotFoundException('Supplier not found.');
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.supplierRfq.updateMany({
        where: { id, rowVersion: r.rowVersion },
        data: {
          productName: dto.productName,
          productId: dto.productId,
          specification: dto.specification,
          quantity: dto.quantity ? new D(dto.quantity) : undefined,
          unit: dto.unit,
          requiredBy:
            dto.requiredBy === undefined
              ? undefined
              : dto.requiredBy
                ? new Date(dto.requiredBy)
                : null,
          quoteDueDate:
            dto.quoteDueDate === undefined
              ? undefined
              : dto.quoteDueDate
                ? new Date(dto.quoteDueDate)
                : null,
          deliveryLocation: dto.deliveryLocation,
          packaging: dto.packaging,
          qualityRequirements: dto.qualityRequirements,
          certificationsRequired: dto.certificationsRequired,
          paymentTermsRequested: dto.paymentTermsRequested,
          validUntil:
            dto.validUntil === undefined
              ? undefined
              : dto.validUntil
                ? new Date(dto.validUntil)
                : null,
          notes: dto.notes,
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) throw CommercialCoreService.conflict();
      for (const s of add)
        await tx.supplierRfqRecipient.upsert({
          where: { rfqId_supplierId: { rfqId: id, supplierId: s.id } },
          create: {
            organizationId: a.organizationId,
            rfqId: id,
            supplierId: s.id,
          },
          update: {},
        });
    });
    await this.sync(id);
    return this.detail(a, id);
  }

  private async sync(id: string) {
    const r = await this.prisma.supplierRfq.findUniqueOrThrow({
      where: { id },
      include: INCLUDE,
    });
    const st = this.status(r);
    if (st !== r.status)
      await this.prisma.supplierRfq.update({
        where: { id },
        data: { status: st },
      });
  }

  /** Honest send boundary: the user records that they requested quotes outside ExportPro. */
  async recordRequested(a: Actor, id: string, dto: RecordRequestedDto) {
    const r = await this.load(a.organizationId, id);
    if (!OPEN.includes(r.status))
      throw new ConflictException('This RFQ is closed.');
    const ids = new Set(dto.supplierIds);
    const targets = r.recipients.filter((x) => ids.has(x.supplierId));
    if (targets.length !== ids.size)
      throw new BadRequestException('Add these suppliers to the RFQ first.');
    await this.prisma.supplierRfqRecipient.updateMany({
      where: { id: { in: targets.map((t) => t.id) }, status: 'INVITED' },
      data: {
        status: 'REQUESTED',
        requestedAt: new Date(),
        requestedVia: dto.via,
        recordedByUserId: a.userId,
      },
    });
    await this.sync(id);
    await this.event(
      a,
      id,
      'supplier_rfq.requested',
      `User recorded requesting quotes from ${targets.length} supplier(s) via ${dto.via.toLowerCase()} (outside ExportPro)`,
    );
    return this.detail(a, id);
  }

  async close(a: Actor, id: string, reason: string, cancel = false) {
    const r = await this.load(a.organizationId, id);
    if (!OPEN.includes(r.status))
      throw new ConflictException('This RFQ is already closed.');
    await this.prisma.supplierRfq.update({
      where: { id },
      data: {
        status: cancel ? 'CANCELLED' : 'CLOSED',
        closedReason: reason,
        rowVersion: { increment: 1 },
      },
    });
    await this.event(
      a,
      id,
      cancel ? 'supplier_rfq.cancelled' : 'supplier_rfq.closed',
      `RFQ ${cancel ? 'cancelled' : 'closed'}: ${reason}`,
    );
    return this.detail(a, id);
  }

  // ---------------------------------------------------------------- quotes

  /** Manual entry; stays PENDING_REVIEW until a person confirms the values. Idempotent per supplier + reference. */
  async addQuote(a: Actor, id: string, dto: QuoteDto) {
    const org = a.organizationId;
    const r = await this.load(org, id);
    if (!OPEN.includes(r.status))
      throw new ConflictException('This RFQ is closed.');
    const rec = r.recipients.find((x) => x.supplierId === dto.supplierId);
    if (!rec)
      throw new BadRequestException({
        message: 'This supplier was not invited to the RFQ.',
        details: { code: 'SUPPLIER_NOT_INVITED' },
      });
    const key = referenceKey(dto.quoteReference) ?? 'DEFAULT';
    const existing = r.quotes.find(
      (q) => q.supplierId === dto.supplierId && q.referenceKey === key,
    );
    if (existing) return { duplicate: true, rfq: await this.detail(a, id) };
    const data = {
      quoteDate: dto.quoteDate ? new Date(dto.quoteDate) : null,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      quantity: dto.quantity ? new D(dto.quantity) : null,
      unit: dto.unit,
      unitPrice: new D(dto.unitPrice),
      currency: dto.currency,
      priceBasis: dto.priceBasis ?? 'EX_FACTORY',
      moq: dto.moq ? new D(dto.moq) : null,
      moqUnit: dto.moqUnit ?? null,
      leadTimeDays: dto.leadTimeDays ?? null,
      capacity: dto.capacity ? new D(dto.capacity) : null,
      capacityUnit: dto.capacityUnit ?? null,
      capacityPeriod: dto.capacityPeriod ?? null,
      deliveryTerms: dto.deliveryTerms ?? null,
      paymentTerms: dto.paymentTerms ?? null,
      packaging: dto.packaging ?? null,
      taxPercent: dto.taxPercent ? new D(dto.taxPercent) : null,
      taxIncluded: dto.taxIncluded ?? null,
      packagingPerUnit: dto.packagingPerUnit
        ? new D(dto.packagingPerUnit)
        : null,
      inlandTransportPerUnit: dto.inlandTransportPerUnit
        ? new D(dto.inlandTransportPerUnit)
        : null,
      inspectionTotal: dto.inspectionTotal ? new D(dto.inspectionTotal) : null,
      otherTotal: dto.otherTotal ? new D(dto.otherTotal) : null,
      certificationsOffered: dto.certificationsOffered ?? [],
      specificationOffered: dto.specificationOffered ?? null,
      notes: dto.notes ?? null,
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.supplierQuote.create({
          data: {
            organizationId: org,
            rfqId: id,
            supplierId: dto.supplierId,
            quoteReference: dto.quoteReference ?? null,
            referenceKey: key,
            createdByUserId: a.userId,
            ...data,
          },
        });
        await tx.supplierRfqRecipient.update({
          where: { id: rec.id },
          data: { status: 'QUOTED' },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        return { duplicate: true, rfq: await this.detail(a, id) };
      throw e;
    }
    await this.sync(id);
    const sup = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: dto.supplierId },
      select: { legalName: true },
    });
    await this.event(
      a,
      id,
      'supplier_quote.recorded',
      `Quote recorded from ${sup.legalName} (awaiting review)`,
    );
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'supplier_quote.recorded',
      entityType: 'SupplierRfq',
      entityId: id,
      metadata: { supplierId: dto.supplierId },
    });
    return { duplicate: false, rfq: await this.detail(a, id) };
  }

  private async loadQuote(org: string, qid: string) {
    const q = await this.prisma.supplierQuote.findFirst({
      where: { id: qid, organizationId: org },
    });
    if (!q) throw new NotFoundException('Supplier quote not found.');
    return q;
  }

  async reviewQuote(a: Actor, qid: string, dto: ReviewQuoteDto) {
    const q = await this.loadQuote(a.organizationId, qid);
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== q.rowVersion
    )
      throw CommercialCoreService.conflict();
    if (q.status === 'SELECTED')
      throw new ConflictException('A selected quote cannot be re-reviewed.');
    await this.prisma.supplierQuote.update({
      where: { id: qid },
      data: {
        review: dto.decision,
        reviewedByUserId: a.userId,
        reviewedAt: new Date(),
        rowVersion: { increment: 1 },
      },
    });
    await this.event(
      a,
      q.rfqId,
      'supplier_quote.reviewed',
      `Quote ${dto.decision === 'CONFIRMED' ? 'confirmed' : 'rejected'} by reviewer${dto.note ? `: ${dto.note}` : ''}`,
    );
    return this.detail(a, q.rfqId);
  }

  async attachQuote(a: Actor, qid: string, file: Express.Multer.File) {
    const q = await this.loadQuote(a.organizationId, qid);
    await this.suppliers.saveAttachment(
      a,
      { supplierId: q.supplierId, entityType: 'QUOTE', entityId: qid },
      file,
      'SUPPLIER_QUOTE',
    );
    return this.detail(a, q.rfqId);
  }

  private quoteView(
    a: Actor,
    q: Quote,
    sups: {
      id: string;
      legalName: string;
      state: string | null;
      city: string | null;
    }[],
    atts: Prisma.SupplierAttachmentGetPayload<object>[],
    names: Map<string, string>,
  ): SupplierQuoteView {
    const prices = this.suppliers.canSeePrices(a);
    const s = sups.find((x) => x.id === q.supplierId)!;
    const n = (d: Prisma.Decimal | null) => (prices ? qty(d) : null);
    return {
      id: q.id,
      supplier: {
        id: s.id,
        legalName: s.legalName,
        state: s.state,
        city: s.city,
      },
      quoteReference: q.quoteReference,
      quoteDate: isoDay(q.quoteDate),
      validUntil: isoDay(q.validUntil),
      expired: Boolean(
        q.validUntil && q.validUntil.getTime() + 86399999 < Date.now(),
      ),
      quantity: qty(q.quantity),
      unit: q.unit,
      unitPrice: prices ? q.unitPrice.toString() : null,
      currency: q.currency,
      priceBasis: q.priceBasis as SupplierQuoteView['priceBasis'],
      moq: qty(q.moq),
      moqUnit: q.moqUnit,
      leadTimeDays: q.leadTimeDays,
      capacity: qty(q.capacity),
      capacityUnit: q.capacityUnit,
      capacityPeriod: q.capacityPeriod,
      deliveryTerms: q.deliveryTerms,
      paymentTerms: q.paymentTerms,
      packaging: q.packaging,
      charges: {
        taxPercent: qty(q.taxPercent),
        packagingPerUnit: n(q.packagingPerUnit),
        inlandTransportPerUnit: n(q.inlandTransportPerUnit),
        inspectionTotal: n(q.inspectionTotal),
        otherTotal: n(q.otherTotal),
        taxIncluded: q.taxIncluded,
      },
      certificationsOffered: q.certificationsOffered,
      specificationOffered: q.specificationOffered,
      notes: q.notes,
      review: q.review as SupplierQuoteView['review'],
      reviewedBy: q.reviewedByUserId
        ? (names.get(q.reviewedByUserId) ?? null)
        : null,
      reviewedAt: q.reviewedAt?.toISOString() ?? null,
      status: q.status as SupplierQuoteView['status'],
      attachments: atts
        .filter((x) => x.entityType === 'QUOTE' && x.entityId === q.id)
        .map((x) => this.suppliers.attachmentView(x)),
      rowVersion: q.rowVersion,
    };
  }

  rfqText(r: Row, exporter: string) {
    const v = (x: string | null | undefined) => x || 'To be confirmed';
    return [
      `Subject: Request for quotation ${r.rfqNumber} — ${r.productName}`,
      '',
      'Dear supplier,',
      '',
      `${exporter} requests your quotation for:`,
      '',
      `Product: ${r.productName}`,
      `Specification: ${v(r.specification)}`,
      `Quantity: ${r.quantity.toString()} ${r.unit}`,
      `Packaging: ${v(r.packaging)}`,
      `Delivery location: ${v(r.deliveryLocation)}`,
      `Required by: ${isoDay(r.requiredBy) ?? 'To be confirmed'}`,
      `Quality requirements: ${v(r.qualityRequirements)}`,
      `Certifications required: ${r.certificationsRequired.join(', ') || 'None stated'}`,
      `Payment terms requested: ${v(r.paymentTermsRequested)}`,
      `Please quote by: ${isoDay(r.quoteDueDate) ?? 'at your earliest'}`,
      '',
      'Please include: unit price and currency, price basis (ex-factory or delivered), taxes, packaging, inland transport, MOQ, lead time, monthly capacity, payment terms, validity and certificates held.',
      '',
      `Regards,\n${exporter}`,
    ].join('\n');
  }

  async list(
    a: Actor,
    q: ListDto,
  ): Promise<ProcurementList<SupplierRfqSummary>> {
    const where: Prisma.SupplierRfqWhereInput = {
      organizationId: a.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.buyerPurchaseOrderId
        ? { buyerPurchaseOrderId: q.buyerPurchaseOrderId }
        : {}),
      ...(q.supplierId
        ? { recipients: { some: { supplierId: q.supplierId } } }
        : {}),
      ...(q.product || q.search
        ? {
            OR: [
              {
                productName: {
                  contains: q.product ?? q.search,
                  mode: 'insensitive',
                },
              },
              {
                rfqNumber: {
                  contains: q.search ?? q.product,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.supplierRfq.findMany({
        where,
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplierRfq.count({ where }),
    ]);
    const sups = await this.prisma.supplier.findMany({
      where: {
        id: {
          in: rows
            .map((r) => r.selectedSupplierId)
            .filter((x): x is string => !!x),
        },
      },
      select: { id: true, legalName: true },
    });
    const pos = await this.prisma.buyerPurchaseOrder.findMany({
      where: {
        id: {
          in: rows
            .map((r) => r.buyerPurchaseOrderId)
            .filter((x): x is string => !!x),
        },
      },
      select: { id: true, poNumber: true },
    });
    return {
      items: rows.map((r) => this.summary(r, sups, pos)),
      meta: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  private summary(
    r: Row,
    sups: { id: string; legalName: string }[],
    pos: { id: string; poNumber: string }[],
  ): SupplierRfqSummary {
    const sel = sups.find((s) => s.id === r.selectedSupplierId);
    const po = pos.find((p) => p.id === r.buyerPurchaseOrderId);
    return {
      id: r.id,
      rfqNumber: r.rfqNumber,
      productName: r.productName,
      quantity: r.quantity.toString(),
      unit: r.unit,
      requiredBy: isoDay(r.requiredBy),
      quoteDueDate: isoDay(r.quoteDueDate),
      status: r.status as SupplierRfqSummary['status'],
      suppliersRequested: r.recipients.filter((x) => x.status !== 'INVITED')
        .length,
      quotesReceived: r.quotes.length,
      selectedSupplier: sel ? { id: sel.id, legalName: sel.legalName } : null,
      buyerPurchaseOrder: po ? { id: po.id, poNumber: po.poNumber } : null,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async detail(a: Actor, id: string): Promise<SupplierRfqDetail> {
    const org = a.organizationId;
    const r = await this.load(org, id);
    const sups = await this.prisma.supplier.findMany({
      where: {
        organizationId: org,
        id: {
          in: [
            ...r.recipients.map((x) => x.supplierId),
            ...r.quotes.map((x) => x.supplierId),
          ],
        },
      },
      select: { id: true, legalName: true, state: true, city: true },
    });
    const atts = await this.prisma.supplierAttachment.findMany({
      where: {
        organizationId: org,
        entityType: 'QUOTE',
        entityId: { in: r.quotes.map((q) => q.id) },
      },
    });
    const events = await this.prisma.commercialEvent.findMany({
      where: { organizationId: org, lineageId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const names = await this.core.userNames([
      ...r.quotes.map((q) => q.reviewedByUserId),
      ...events.map((e) => e.actorUserId),
      r.selectedByUserId,
    ]);
    const pos = r.buyerPurchaseOrderId
      ? await this.prisma.buyerPurchaseOrder.findMany({
          where: { id: r.buyerPurchaseOrderId },
          select: { id: true, poNumber: true },
        })
      : [];
    const o = await this.prisma.organization.findUniqueOrThrow({
      where: { id: org },
      select: { name: true, legalName: true },
    });
    const can = (p: Parameters<typeof roleHasPermission>[1]) =>
      roleHasPermission(a.role, p);
    const open = OPEN.includes(r.status);
    return {
      ...this.summary(r, sups, pos),
      rowVersion: r.rowVersion,
      productId: r.productId,
      specification: r.specification,
      deliveryLocation: r.deliveryLocation,
      packaging: r.packaging,
      qualityRequirements: r.qualityRequirements,
      certificationsRequired: r.certificationsRequired,
      paymentTermsRequested: r.paymentTermsRequested,
      validUntil: isoDay(r.validUntil),
      notes: r.notes,
      wastagePercent: r.wastagePercent?.toString() ?? null,
      baseQuantity: r.baseQuantity?.toString() ?? null,
      recipients: r.recipients.map((x) => {
        const s = sups.find((y) => y.id === x.supplierId)!;
        return {
          id: x.id,
          supplier: { id: s.id, legalName: s.legalName, state: s.state },
          status: x.status as never,
          requestedAt: x.requestedAt?.toISOString() ?? null,
          requestedVia: x.requestedVia,
        };
      }),
      quotes: r.quotes.map((q) => this.quoteView(a, q, sups, atts, names)),
      selection: r.selectedQuoteId
        ? {
            quoteId: r.selectedQuoteId,
            supplierId: r.selectedSupplierId!,
            by: r.selectedByUserId
              ? (names.get(r.selectedByUserId) ?? null)
              : null,
            at: r.selectedAt!.toISOString(),
            reason: r.selectionReason,
          }
        : null,
      rfqText: this.rfqText(r, o.legalName || o.name),
      activity: events.map((e) => ({
        id: e.id,
        title: e.title,
        actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
        createdAt: e.createdAt.toISOString(),
      })),
      availableActions: [
        ...(open && can('supplier_rfq.manage')
          ? ['edit', 'record_requested', 'close', 'cancel']
          : []),
        ...(open && can('supplier_quotes.manage')
          ? ['add_quote', 'review_quote', 'select']
          : []),
        ...(r.selectedQuoteId && can('supplier_po.issue') ? ['create_po'] : []),
        ...(r.selectedQuoteId && can('costing.edit') ? ['use_in_costing'] : []),
      ],
    };
  }

  // ---------------------------------------------------------------- comparison

  /** Confirmed quotes only; FX-normalized; unknown charges listed, never assumed zero. */
  async compare(
    a: Actor,
    id: string,
    dto: CompareDto,
  ): Promise<SupplierComparison> {
    const org = a.organizationId;
    if (!this.suppliers.canSeePrices(a))
      throw new NotFoundException(
        'Supplier pricing is not available for your role.',
      );
    const r = await this.load(org, id);
    const target =
      dto.targetCurrency ?? (await this.fin.settings(org)).reportingCurrency;
    const d = await this.detail(a, id);
    const excluded: SupplierComparison['excluded'] = [];
    const rows: SupplierComparisonRow[] = [];
    const reqQty = new D(r.quantity.toString());
    const reqDays = r.requiredBy
      ? Math.floor((r.requiredBy.getTime() - Date.now()) / 864e5)
      : null;
    const supCerts = await this.prisma.supplierCertification.findMany({
      where: {
        organizationId: org,
        supplierId: { in: r.quotes.map((q) => q.supplierId) },
      },
    });
    for (const q of r.quotes) {
      const v = d.quotes.find((x) => x.id === q.id)!;
      if (q.review !== 'CONFIRMED') {
        excluded.push({
          quoteId: q.id,
          supplier: v.supplier.legalName,
          reason:
            q.review === 'REJECTED'
              ? 'Rejected in review'
              : 'Awaiting human review',
        });
        continue;
      }
      const fx = await this.fin.latestRate(org, q.currency, target);
      const landed = landedUnit(
        {
          unitPrice: new D(q.unitPrice.toString()),
          taxPercent: q.taxPercent ? new D(q.taxPercent.toString()) : null,
          taxIncluded: q.taxIncluded,
          packagingPerUnit: q.packagingPerUnit
            ? new D(q.packagingPerUnit.toString())
            : null,
          inlandTransportPerUnit: q.inlandTransportPerUnit
            ? new D(q.inlandTransportPerUnit.toString())
            : null,
          inspectionTotal: q.inspectionTotal
            ? new D(q.inspectionTotal.toString())
            : null,
          otherTotal: q.otherTotal ? new D(q.otherTotal.toString()) : null,
          priceBasis: q.priceBasis,
        },
        reqQty,
      );
      const moqM = sameMeasure(
        q.moq ? new D(q.moq.toString()) : null,
        q.moqUnit ?? q.unit,
        reqQty,
        r.unit,
      );
      const capM = sameMeasure(
        monthlyCapacity(
          q.capacity ? new D(q.capacity.toString()) : null,
          q.capacityPeriod,
        ),
        q.capacityUnit ?? q.unit,
        reqQty,
        r.unit,
      );
      const onFile = supCerts
        .filter(
          (c) =>
            c.supplierId === q.supplierId &&
            (!c.expiryDate || c.expiryDate >= new Date()),
        )
        .map(
          (c) =>
            `${c.type}${c.verification === 'UPLOADED' || c.verification === 'NOT_PROVIDED' ? ' (unverified)' : ''}`,
        );
      const offered = q.certificationsOffered;
      const have = [...offered, ...onFile];
      const missing = r.certificationsRequired.filter(
        (c) => !have.some((h) => h.toUpperCase().includes(c.toUpperCase())),
      );
      const perf = await this.suppliers.performance(a, q.supplierId);
      // Price comparison requires the same quantity unit as the RFQ.
      const unitOk =
        q.unit.toUpperCase() === r.unit.toUpperCase() ||
        sameMeasure(new D(1), q.unit, new D(1), r.unit) !== null;
      const perKgFactor = (() => {
        const a1 = sameMeasure(new D(1), q.unit, new D(1), 'KG');
        const b1 = sameMeasure(new D(1), r.unit, new D(1), 'KG');
        return a1 && b1 ? b1[0].div(a1[0]) : new D(1);
      })();
      const normUnit =
        fx && unitOk
          ? landed.unit.mul(fx.rate).mul(perKgFactor).toDecimalPlaces(4)
          : null;
      rows.push({
        quote: v,
        normalizedUnitPrice:
          fx && unitOk
            ? new D(q.unitPrice.toString())
                .mul(fx.rate)
                .mul(perKgFactor)
                .toDecimalPlaces(4)
                .toString()
            : null,
        landedUnitCost: normUnit?.toString() ?? null,
        landedTotal: normUnit
          ? normUnit.mul(reqQty).toDecimalPlaces(2).toFixed(2)
          : null,
        unknownCharges: landed.unknown,
        fx: fx
          ? {
              rate: fx.basis.rate,
              from: q.currency,
              to: target,
              sourceLabel: fx.basis.sourceLabel,
              sourceDate: fx.basis.sourceDate,
            }
          : null,
        fxMissing: !fx,
        moqFit: moqM ? moqM[0].lte(moqM[1]) : null,
        leadTimeFit:
          q.leadTimeDays === null || reqDays === null
            ? null
            : q.leadTimeDays <= reqDays,
        certification: {
          required: r.certificationsRequired,
          offered,
          onFile,
          missing,
        },
        capacityFit: capM ? capM[0].gte(capM[1]) : null,
        qualityHistory: {
          passRatePercent: perf.qualityPassRatePercent,
          inspections: perf.inspections,
        },
        score: null,
        confidencePercent: 0,
        breakdown: [],
        rank: null,
      });
    }
    const best =
      rows
        .map((x) => (x.landedUnitCost ? new D(x.landedUnitCost) : null))
        .filter((x): x is Dec => !!x)
        .sort((x, y) => x.cmp(y))[0] ?? null;
    const bestLead =
      rows
        .map((x) => x.quote.leadTimeDays)
        .filter((x): x is number => x !== null)
        .sort((x, y) => x - y)[0] ?? null;
    for (const row of rows) {
      const f = scoreFit({
        price: {
          value: row.landedUnitCost ? new D(row.landedUnitCost) : null,
          best,
        },
        leadTimeDays: {
          value: row.quote.leadTimeDays,
          requiredDays: reqDays,
          best: bestLead,
        },
        moq: { fit: row.moqFit },
        capacity: { fit: row.capacityFit },
        certifications: {
          required: row.certification.required,
          have: [...row.certification.offered, ...row.certification.onFile],
        },
        quality: {
          passRate: row.qualityHistory.passRatePercent
            ? Number(row.qualityHistory.passRatePercent)
            : null,
          inspections: row.qualityHistory.inspections,
        },
      });
      if (row.quote.expired)
        f.factors.push({
          factor: 'Validity',
          points: 0,
          max: 0,
          explanation:
            'Quote validity has passed — reconfirm before selecting.',
        });
      row.score = f.score;
      row.confidencePercent = f.confidencePercent;
      row.breakdown = f.factors;
    }
    [...rows]
      .sort((x, y) => (y.score ?? 0) - (x.score ?? 0))
      .forEach((x, i) => (x.rank = i + 1));
    return {
      targetCurrency: target,
      rows,
      recommendation: this.recommend(rows, target, r.unit),
      excluded,
    };
  }

  /** Advisory statements built only from the comparison rows (no external claims). */
  private recommend(
    rows: SupplierComparisonRow[],
    cur: string,
    unit: string,
  ): SupplierComparison['recommendation'] {
    const name = (x?: SupplierComparisonRow) =>
      x?.quote.supplier.legalName ?? null;
    const priced = rows
      .filter((x) => x.landedUnitCost)
      .sort((x, y) => new D(x.landedUnitCost!).cmp(y.landedUnitCost!));
    const fast = rows
      .filter((x) => x.quote.leadTimeDays !== null)
      .sort((x, y) => x.quote.leadTimeDays! - y.quote.leadTimeDays!);
    const moq = rows
      .filter((x) => x.quote.moq)
      .sort((x, y) => new D(x.quote.moq!).cmp(y.quote.moq!));
    const certOk = rows.filter(
      (x) => x.certification.required.length && !x.certification.missing.length,
    );
    const balanced = [...rows].sort(
      (x, y) => (y.score ?? 0) - (x.score ?? 0),
    )[0];
    const st: string[] = [];
    if (priced.length >= 2) {
      const [c, n2] = priced;
      const diff = new D(n2.landedUnitCost!).minus(c.landedUnitCost!);
      const other: string[] = [];
      if (
        n2.certification.required.length &&
        !n2.certification.missing.length &&
        c.certification.missing.length
      )
        other.push(
          `has the required ${c.certification.missing.join(', ')} certification`,
        );
      if (
        n2.quote.leadTimeDays !== null &&
        c.quote.leadTimeDays !== null &&
        n2.quote.leadTimeDays < c.quote.leadTimeDays
      )
        other.push(
          `a ${c.quote.leadTimeDays - n2.quote.leadTimeDays}-day shorter lead time`,
        );
      if (n2.moqFit && c.moqFit === false)
        other.push('a MOQ within your quantity');
      st.push(
        `${name(c)} is ${cur} ${diff.toFixed(2)}/${unit} cheaper (landed, stated charges only)${other.length ? `, but ${name(n2)} ${other.join(' and ')}` : ''}.`,
      );
    }
    for (const r of rows)
      if (r.unknownCharges.length)
        st.push(
          `${name(r)}: ${r.unknownCharges.join(', ')} not stated — landed cost may be understated.`,
        );
    for (const r of rows)
      if (r.fxMissing)
        st.push(
          `${name(r)}: no FX rate ${r.quote.currency}→${cur} saved; not price-ranked.`,
        );
    for (const r of rows)
      if (r.quote.expired) st.push(`${name(r)}: quote validity has passed.`);
    if (!rows.some((r) => r.qualityHistory.inspections))
      st.push('No quality history exists yet for these suppliers.');
    return {
      advisory: true,
      bestPrice: name(priced[0]),
      fastest: name(fast[0]),
      lowestMoq: name(moq[0]),
      certificationFit: certOk.length
        ? certOk.map((x) => x.quote.supplier.legalName).join(', ')
        : null,
      balanced: name(balanced),
      statements: st,
      basis:
        'Advisory only — generated from confirmed quotes, your saved FX rates and recorded supplier history. You choose the supplier.',
    };
  }

  // ---------------------------------------------------------------- selection

  async select(a: Actor, qid: string, dto: SelectQuoteDto) {
    const org = a.organizationId;
    const q = await this.loadQuote(org, qid);
    const r = await this.load(org, q.rfqId);
    this.guard(r, dto.expectedRowVersion);
    if (!OPEN.includes(r.status))
      throw new ConflictException('This RFQ is closed.');
    if (q.review !== 'CONFIRMED')
      throw new ConflictException({
        message: 'Confirm the quote values in review before selecting it.',
        details: { code: 'QUOTE_NOT_REVIEWED' },
      });
    if (
      q.validUntil &&
      q.validUntil.getTime() + 86399999 < Date.now() &&
      !dto.expiredOverrideReason
    )
      throw new ConflictException({
        message:
          'This quote has expired. Reconfirm with the supplier and give a reason to select it.',
        details: { code: 'QUOTE_EXPIRED' },
      });
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.supplierRfq.updateMany({
        where: {
          id: r.id,
          rowVersion: r.rowVersion,
          selectedQuoteId: r.selectedQuoteId,
        },
        data: {
          selectedQuoteId: q.id,
          selectedSupplierId: q.supplierId,
          selectedByUserId: a.userId,
          selectedAt: new Date(),
          selectionReason:
            [
              dto.reason,
              dto.expiredOverrideReason &&
                `Expired-quote override: ${dto.expiredOverrideReason}`,
            ]
              .filter(Boolean)
              .join(' — ') || null,
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) throw CommercialCoreService.conflict();
      await tx.supplierQuote.updateMany({
        where: { rfqId: r.id, id: { not: q.id }, status: 'SELECTED' },
        data: { status: 'NOT_SELECTED' },
      });
      await tx.supplierQuote.update({
        where: { id: q.id },
        data: { status: 'SELECTED' },
      });
    });
    const sup = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: q.supplierId },
      select: { legalName: true },
    });
    await this.event(
      a,
      r.id,
      'supplier.selected',
      `${sup.legalName} selected by user${dto.reason ? `: ${dto.reason}` : ''}`,
    );
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'supplier_quote.selected',
      entityType: 'SupplierQuote',
      entityId: q.id,
      metadata: { rfqId: r.id, supplierId: q.supplierId },
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'supplier.selected',
      entityType: 'Supplier',
      entityId: q.supplierId,
      metadata: { rfqId: r.id },
    });
    return this.detail(a, r.id);
  }

  // ---------------------------------------------------------------- costing handoff

  /**
   * Selected quote → costing basis. Draft costings get a new scenario; READY/LOCKED
   * costings get a revision (the locked snapshot is untouched); none → new costing.
   * Requires explicit confirmation; the quotation price is never changed.
   */
  async useInCosting(a: Actor, qid: string, dto: UseInCostingDto) {
    const org = a.organizationId;
    const q = await this.loadQuote(org, qid);
    const r = await this.load(org, q.rfqId);
    if (r.selectedQuoteId !== q.id)
      throw new ConflictException(
        'Select this quote before using it in costing.',
      );
    const unit = q.unit.toUpperCase();
    const basis = unit === 'KG' ? 'PER_KG' : unit === 'MT' ? 'PER_MT' : null;
    if (!basis)
      throw new BadRequestException({
        message: `Quotes priced per ${q.unit} cannot be mapped to a costing line automatically (use KG or MT).`,
        details: { code: 'UNIT_NOT_SUPPORTED' },
      });
    const target = dto.costingId
      ? await this.prisma.exportCosting.findFirst({
          where: { id: dto.costingId, organizationId: org },
        })
      : null;
    if (dto.costingId && !target)
      throw new NotFoundException('Costing not found.');
    const sup = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: q.supplierId },
      select: { legalName: true },
    });
    const plan = target
      ? target.status === 'DRAFT'
        ? `Add a scenario “${sup.legalName} quote” to draft costing ${target.reference}`
        : `Create a new revision of ${target.reference} (the ${target.status.toLowerCase()} version and its snapshot stay unchanged) with the procurement line from this quote`
      : `Create a new draft costing for ${r.productName} (${r.quantity.toString()} ${r.unit}) with procurement from this quote`;
    const preview = {
      plan,
      procurementLine: {
        amount: q.unitPrice.toString(),
        currency: q.currency,
        basis,
        source: 'SUPPLIER_QUOTE',
        reference: `${r.rfqNumber} / ${sup.legalName}`,
      },
      note: 'Quotation prices are not changed. Packaging/transport stay as they are in the costing unless you edit them.',
    };
    if (!dto.confirm) return { confirmed: false, preview };
    let costingId: string;
    let scenarioId: string;
    if (!target) {
      const qtyUnit = ['KG', 'MT'].includes(r.unit.toUpperCase())
        ? r.unit.toUpperCase()
        : null;
      if (!qtyUnit)
        throw new BadRequestException(
          'RFQ quantity must be in KG or MT to start a costing.',
        );
      const c = await this.costing.create(a, {
        name: `${r.productName} — ${sup.legalName} quote`,
        productId: r.productId ?? undefined,
        quantity: r.quantity.toString(),
        quantityUnit: qtyUnit,
      } as never);
      costingId = c.id;
      scenarioId = c.scenarios[0].id;
    } else if (target.status === 'DRAFT') {
      const c = await this.costing.createScenario(a, target.id, {
        name: `${sup.legalName} quote`.slice(0, 120),
      } as never);
      costingId = c.id;
      scenarioId = c.scenarios[c.scenarios.length - 1].id;
    } else {
      const c = await this.costing.revise(a, target.id);
      costingId = c.id;
      scenarioId = (c.scenarios.find((s) => s.isBase) ?? c.scenarios[0]).id;
    }
    const detail = await this.costing.detail(org, costingId);
    const sc = detail.scenarios.find((s) => s.id === scenarioId)!;
    const proc = sc.lines.find((l) => l.category === 'PROCUREMENT');
    const line = {
      amount: q.unitPrice.toString(),
      currency: q.currency,
      basis,
      sourceType: 'SUPPLIER_QUOTE',
      confidence: 'CONFIRMED',
      quoteReference: `${r.rfqNumber} / ${sup.legalName}`.slice(0, 80),
      notes: `From supplier quote ${q.quoteReference ?? ''}`.trim(),
    };
    if (proc)
      await this.costing.updateLine(a, costingId, proc.id, line as never);
    else
      await this.costing.addLine(a, costingId, {
        ...line,
        scenarioId,
        category: 'PROCUREMENT',
        label: 'Product cost (supplier quote)',
      } as never);
    await this.event(
      a,
      r.id,
      'supplier_quote.used_in_costing',
      `Quote from ${sup.legalName} used in costing ${detail.reference}`,
    );
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'procurement_cost.linked',
      entityType: 'ExportCosting',
      entityId: costingId,
      metadata: { quoteId: q.id, mode: target ? target.status : 'NEW' },
    });
    return {
      confirmed: true,
      preview,
      costingId,
      scenarioId,
      href: `/costing/${costingId}`,
    };
  }
}
