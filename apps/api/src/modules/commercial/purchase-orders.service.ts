import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type CommercialList,
  type ComparisonColumn,
  isCostingCurrency,
  type PoDetail,
  type PoSummary,
  roleHasPermission,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { AuditService } from '../audit/audit.service';
import {
  StorageService,
  INQUIRY_ATTACHMENT_EXTENSIONS,
  MAX_INQUIRY_ATTACHMENT_BYTES,
} from '../storage/storage.service';
import { D, money } from '../costing/costing-calculator';
import {
  type CompareDoc,
  comparePo,
  lineTotal,
  normText,
} from './commercial-math';
import {
  type Actor,
  CommercialCoreService,
  day,
  type Tx,
} from './commercial-core.service';
import { QuotationsService } from './quotations.service';
import type {
  AcceptPoDto,
  CreatePoDto,
  ListQueryDto,
  PoHeaderDto,
  ReasonDto,
  ResolveDiscrepancyDto,
  UploadPoDto,
} from './commercial.dto';

const include = {
  items: { orderBy: { sortOrder: 'asc' } },
  discrepancies: { orderBy: { createdAt: 'asc' } },
  attachments: { orderBy: { createdAt: 'asc' } },
  quotation: true,
  proformaInvoice: true,
} satisfies Prisma.BuyerPurchaseOrderInclude;
type Row = Prisma.BuyerPurchaseOrderGetPayload<{ include: typeof include }>;
/** Money values always carry 2 decimals. */
const m = (d: Prisma.Decimal | null | undefined) =>
  d === null || d === undefined ? null : d.toFixed(2);
const s = (d: Prisma.Decimal | null | undefined) =>
  d === null || d === undefined ? null : d.toString();
const display = (n: string, r: number) => `${n}${r > 1 ? ` Rev ${r}` : ''}`;
const FINAL = ['ACCEPTED', 'REJECTED', 'CANCELLED'];
/** Uploads accept the same document types as RFQs (PDF, images, Office, text); no executables. No OCR — items are entered manually. */
const PO_EXTENSIONS = INQUIRY_ATTACHMENT_EXTENSIONS;

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly core: CommercialCoreService,
    private readonly quotations: QuotationsService,
  ) {}

  private async load(organizationId: string, id: string): Promise<Row> {
    const p = await this.prisma.buyerPurchaseOrder.findFirst({
      where: { id, organizationId },
      include,
    });
    if (!p) throw new NotFoundException('Purchase order not found.');
    return p;
  }

  private async touch(
    tx: Tx,
    p: { id: string; organizationId: string },
    expected: number | undefined,
    data: Prisma.BuyerPurchaseOrderUncheckedUpdateManyInput,
    extra: Prisma.BuyerPurchaseOrderWhereInput = {},
  ) {
    const r = await tx.buyerPurchaseOrder.updateMany({
      where: {
        id: p.id,
        organizationId: p.organizationId,
        ...extra,
        ...(expected !== undefined ? { rowVersion: expected } : {}),
      },
      data: { ...data, rowVersion: { increment: 1 } },
    });
    if (!r.count) throw CommercialCoreService.conflict();
  }

  /** Validates links (same organization) and fills the quotation from the PI when only a PI is given. */
  private async resolveLinks(
    organizationId: string,
    buyerCompanyId: string | null,
    quotationId: string | null | undefined,
    piId: string | null | undefined,
  ) {
    let q = quotationId
      ? await this.prisma.quotation.findFirst({
          where: { id: quotationId, organizationId },
        })
      : null;
    if (quotationId && !q) throw new NotFoundException('Quotation not found.');
    let pi = piId
      ? await this.prisma.proformaInvoice.findFirst({
          where: { id: piId, organizationId },
        })
      : null;
    if (piId && !pi) throw new NotFoundException('Proforma invoice not found.');
    // Quotation given without a PI: link the current issued PI of that quotation, if any.
    if (q && !piId)
      pi = await this.prisma.proformaInvoice.findFirst({
        where: {
          organizationId,
          quotation: { rootId: q.rootId },
          status: { in: ['ISSUED', 'SENT', 'ACCEPTED'] },
        },
        orderBy: [{ revision: 'desc' }, { createdAt: 'desc' }],
      });
    if (!q && pi?.quotationId)
      q = await this.prisma.quotation.findFirst({
        where: { id: pi.quotationId, organizationId },
      });
    for (const d of [q, pi])
      if (
        d &&
        buyerCompanyId &&
        d.buyerCompanyId &&
        d.buyerCompanyId !== buyerCompanyId
      )
        throw new BadRequestException(
          'The linked document belongs to a different buyer.',
        );
    return {
      quotationId: q?.id ?? null,
      piId: pi?.id ?? null,
      crmLeadId: q?.crmLeadId ?? pi?.crmLeadId ?? null,
      inquiryId: q?.inquiryId ?? pi?.inquiryId ?? null,
    };
  }

  private itemRows(
    organizationId: string,
    poId: string,
    items: NonNullable<PoHeaderDto['items']>,
  ) {
    return items.map((it, n) => {
      if (!new D(it.quantity).gt(0))
        throw new BadRequestException(
          `Item ${n + 1}: quantity must be greater than zero.`,
        );
      return {
        organizationId,
        purchaseOrderId: poId,
        sortOrder: n,
        quotationItemId: it.quotationItemId ?? null,
        productId: it.productId ?? null,
        buyerProductCode: it.buyerProductCode ?? null,
        description: it.description.trim(),
        specification: it.specification ?? null,
        packaging: it.packaging ?? null,
        quantity: it.quantity,
        unit: it.unit.trim().toUpperCase(),
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice ?? null,
        deliveryDate: it.deliveryDate ?? null,
      };
    });
  }

  async create(
    a: Actor,
    dto: CreatePoDto,
    source: 'MANUAL' | 'UPLOAD' = 'MANUAL',
  ) {
    const org = a.organizationId;
    if (!dto.poNumber?.trim() || !dto.poDate || !dto.currency)
      throw new BadRequestException(
        'PO number, PO date and currency are required.',
      );
    if (!isCostingCurrency(dto.currency))
      throw new BadRequestException(`Unsupported currency ${dto.currency}.`);
    const buyer = await this.prisma.buyerCompany.findFirst({
      where: {
        id: dto.buyerCompanyId,
        OR: [{ ownerOrganizationId: null }, { ownerOrganizationId: org }],
      },
    });
    if (!buyer) throw new NotFoundException('Buyer not found.');
    const links = await this.resolveLinks(
      org,
      buyer.id,
      dto.quotationId,
      dto.proformaInvoiceId,
    );
    if (
      dto.crmLeadId &&
      !(await this.prisma.buyerLead.findFirst({
        where: { id: dto.crmLeadId, organizationId: org },
      }))
    )
      throw new NotFoundException('CRM lead not found.');
    const key = normText(dto.poNumber);
    const dup = await this.prisma.buyerPurchaseOrder.findFirst({
      where: {
        organizationId: org,
        buyerCompanyId: buyer.id,
        poNumberKey: key,
      },
    });
    if (dup)
      throw new ConflictException({
        message: `PO ${dup.poNumber} from this buyer is already recorded.`,
        details: { existingPurchaseOrderId: dup.id },
      });
    let po;
    try {
      po = await this.prisma.$transaction(async (tx) => {
        const row = await tx.buyerPurchaseOrder.create({
          data: {
            organizationId: org,
            buyerCompanyId: buyer.id,
            crmLeadId: dto.crmLeadId ?? links.crmLeadId,
            inquiryId: links.inquiryId,
            quotationId: links.quotationId,
            proformaInvoiceId: links.piId,
            poNumber: dto.poNumber!.trim(),
            poNumberKey: key,
            poDate: new Date(dto.poDate!),
            currency: dto.currency!,
            incoterm: dto.incoterm ?? null,
            incotermPlace: dto.incotermPlace ?? null,
            paymentTerms: dto.paymentTerms ?? null,
            deliveryTerms: dto.deliveryTerms ?? null,
            destination: dto.destination ?? null,
            totalAmount: dto.totalAmount ?? null,
            notes: dto.notes ?? null,
            source,
            createdByUserId: a.userId,
          },
        });
        if (dto.items?.length)
          await tx.buyerPurchaseOrderItem.createMany({
            data: this.itemRows(org, row.id, dto.items),
          });
        await this.core.event(
          tx,
          { organizationId: org, userId: a.userId },
          {
            entityType: 'PO',
            entityId: row.id,
            lineageId: row.id,
            type: 'RECEIVED',
            title: `Buyer PO ${row.poNumber} recorded (${source === 'UPLOAD' ? 'uploaded document' : 'manual entry'})`,
          },
        );
        await this.core.crmActivity(
          tx,
          org,
          row.crmLeadId,
          `Buyer purchase order ${row.poNumber} received`,
          a.userId,
          { purchaseOrderId: row.id },
        );
        return row;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException(
          'This PO number is already recorded for this buyer.',
        );
      throw e;
    }
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'po.created',
      entityType: 'BuyerPurchaseOrder',
      entityId: po.id,
      metadata: {
        poNumber: po.poNumber,
        source,
        quotationId: po.quotationId,
        proformaInvoiceId: po.proformaInvoiceId,
      },
    });
    await this.runCompare(a, po.id, false);
    return this.detail(a, po.id);
  }

  async upload(a: Actor, dto: UploadPoDto, file: Express.Multer.File) {
    if (!file)
      throw new BadRequestException('Choose the PO document to upload.');
    const po = await this.create(a, { ...dto, items: [] }, 'UPLOAD');
    await this.addAttachment(a, po.id, file);
    return this.detail(a, po.id);
  }

  async addAttachment(a: Actor, id: string, file: Express.Multer.File) {
    const po = await this.load(a.organizationId, id);
    if (!file) throw new BadRequestException('Choose a file to upload.');
    const { storageKey } = await this.storage.savePrivateFile(
      'po-attachments',
      file,
      PO_EXTENSIONS,
      MAX_INQUIRY_ATTACHMENT_BYTES,
    );
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrderAttachment.create({
        data: {
          organizationId: a.organizationId,
          purchaseOrderId: id,
          originalFilename: (file.originalname || 'po').slice(0, 200),
          storageKey,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          checksum,
          uploadedByUserId: a.userId,
        },
      });
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'PO',
          entityId: id,
          lineageId: id,
          type: 'ATTACHMENT_ADDED',
          title: `PO document attached: ${file.originalname}`,
        },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'po.attachment_added',
      entityType: 'BuyerPurchaseOrder',
      entityId: po.id,
      metadata: { mimeType: file.mimetype, sizeBytes: file.size },
    });
    return this.detail(a, id);
  }

  async readAttachment(
    organizationId: string,
    id: string,
    attachmentId: string,
  ) {
    const x = await this.prisma.purchaseOrderAttachment.findFirst({
      where: { id: attachmentId, purchaseOrderId: id, organizationId },
    });
    if (!x) throw new NotFoundException('Attachment not found.');
    const buffer = await this.storage
      .readPrivateFile(x.storageKey)
      .catch(() => {
        throw new NotFoundException('The file is no longer available.');
      });
    return { buffer, filename: x.originalFilename, mimeType: x.mimeType };
  }

  async update(a: Actor, id: string, dto: PoHeaderDto) {
    const po = await this.load(a.organizationId, id);
    if (FINAL.includes(po.status))
      throw new ConflictException(
        `A ${po.status.toLowerCase()} purchase order cannot be edited.`,
      );
    const data: Prisma.BuyerPurchaseOrderUncheckedUpdateManyInput = {};
    if (dto.quotationId !== undefined || dto.proformaInvoiceId !== undefined) {
      const links = await this.resolveLinks(
        a.organizationId,
        po.buyerCompanyId,
        dto.quotationId !== undefined ? dto.quotationId : po.quotationId,
        dto.proformaInvoiceId !== undefined
          ? dto.proformaInvoiceId
          : po.proformaInvoiceId,
      );
      Object.assign(data, {
        quotationId: links.quotationId,
        proformaInvoiceId: links.piId,
        inquiryId: links.inquiryId ?? po.inquiryId,
        crmLeadId: po.crmLeadId ?? links.crmLeadId,
      });
    }
    if (dto.poNumber !== undefined) {
      const key = normText(dto.poNumber);
      const dup = await this.prisma.buyerPurchaseOrder.findFirst({
        where: {
          organizationId: a.organizationId,
          buyerCompanyId: po.buyerCompanyId,
          poNumberKey: key,
          id: { not: id },
        },
      });
      if (dup)
        throw new ConflictException({
          message: 'This PO number is already recorded for this buyer.',
          details: { existingPurchaseOrderId: dup.id },
        });
      Object.assign(data, { poNumber: dto.poNumber.trim(), poNumberKey: key });
    }
    if (dto.poDate) data.poDate = new Date(dto.poDate);
    if (dto.currency) {
      if (!isCostingCurrency(dto.currency))
        throw new BadRequestException(`Unsupported currency ${dto.currency}.`);
      data.currency = dto.currency;
    }
    for (const k of [
      'incoterm',
      'incotermPlace',
      'paymentTerms',
      'deliveryTerms',
      'destination',
      'totalAmount',
      'notes',
      'crmLeadId',
    ] as const)
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, po, dto.expectedRowVersion, data, {
        status: { notIn: FINAL as never },
      });
      if (dto.items) {
        await tx.buyerPurchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id },
        });
        if (dto.items.length)
          await tx.buyerPurchaseOrderItem.createMany({
            data: this.itemRows(a.organizationId, id, dto.items),
          });
      }
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'po.updated',
      entityType: 'BuyerPurchaseOrder',
      entityId: id,
      metadata: {
        fields: Object.keys(data),
        items: dto.items ? dto.items.length : undefined,
      },
    });
    await this.runCompare(a, id, false);
    return this.detail(a, id);
  }

  // ------------------------------------------------------- comparison

  /** The accepted revision in the quotation lineage, else the latest issued/expired one — never a superseded or draft revision. */
  private async effectiveQuotation(
    organizationId: string,
    quotationId: string | null,
  ) {
    if (!quotationId) return null;
    await this.quotations.expireDue(organizationId);
    const q = await this.prisma.quotation.findFirst({
      where: { id: quotationId, organizationId },
    });
    if (!q) return null;
    const lineage = await this.prisma.quotation.findMany({
      where: { organizationId, rootId: q.rootId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { revision: 'desc' },
    });
    return (
      lineage.find((r) => r.status === 'ACCEPTED') ??
      lineage.find((r) => ['ISSUED', 'SENT', 'EXPIRED'].includes(r.status)) ??
      null
    );
  }

  /** Latest issued (non-superseded, non-cancelled) PI revision in the lineage. */
  private async effectivePi(organizationId: string, piId: string | null) {
    if (!piId) return null;
    const p = await this.prisma.proformaInvoice.findFirst({
      where: { id: piId, organizationId },
    });
    if (!p) return null;
    return this.prisma.proformaInvoice.findFirst({
      where: {
        organizationId,
        rootId: p.rootId,
        status: { in: ['ISSUED', 'SENT', 'ACCEPTED'] },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { revision: 'desc' },
    });
  }

  /**
   * Deterministic comparison (no AI). Findings are keyed by a signature so a
   * human resolution survives re-comparison; OPEN findings that no longer
   * apply are removed, resolved ones are kept as history.
   */
  async runCompare(a: Actor, id: string, record = true) {
    const po = await this.load(a.organizationId, id);
    if (FINAL.includes(po.status)) return this.detail(a, id);
    const settings = await this.core.rawSettings(a.organizationId);
    const [q, pi] = await Promise.all([
      this.effectiveQuotation(a.organizationId, po.quotationId),
      this.effectivePi(a.organizationId, po.proformaInvoiceId),
    ]);
    // PI items reference the quotation items of the accepted revision; map those to the effective quotation's items by position-stable description when revision differs.
    const refs: CompareDoc[] = [];
    if (q)
      refs.push({
        kind: 'QUOTATION',
        label: `quotation ${display(q.quotationNumber, q.revision)}`,
        buyerCompanyId: q.buyerCompanyId,
        currency: q.currency,
        incoterm: q.incoterm,
        incotermPlace: q.incotermPlace,
        paymentTerms: q.paymentTerms,
        deliveryTerms: q.deliveryTerms,
        total: s(q.totalAmount),
        items: q.items.map((i) => ({
          id: i.id,
          matchKey: i.id,
          description: i.description,
          unit: i.unit,
          quantity: i.quantity.toString(),
          unitPrice: s(i.unitPrice),
          specification: i.specification,
        })),
      });
    if (pi)
      refs.push({
        kind: 'PI',
        label: `PI ${display(pi.piNumber, pi.revision)}`,
        buyerCompanyId: pi.buyerCompanyId,
        currency: pi.currency,
        incoterm: pi.incoterm,
        incotermPlace: pi.incotermPlace,
        paymentTerms: pi.paymentTerms,
        deliveryTerms: pi.deliveryTerms,
        total: pi.totalAmount.toFixed(2),
        items: pi.items.map((i) => ({
          id: i.id,
          matchKey: i.quotationItemId,
          description: i.description,
          unit: i.unit,
          quantity: i.quantity.toString(),
          unitPrice: i.unitPrice.toString(),
          specification: i.specification,
        })),
      });
    let findings = po.items.length
      ? comparePo(
          {
            buyerCompanyId: po.buyerCompanyId,
            currency: po.currency,
            incoterm: po.incoterm,
            incotermPlace: po.incotermPlace,
            paymentTerms: po.paymentTerms,
            deliveryTerms: po.deliveryTerms,
            totalAmount: m(po.totalAmount),
            items: po.items.map((i) => ({
              id: i.id,
              matchKey: i.quotationItemId,
              description: i.description,
              unit: i.unit,
              quantity: i.quantity.toString(),
              unitPrice: i.unitPrice.toString(),
              totalPrice: m(i.totalPrice),
              specification: i.specification,
            })),
          },
          refs,
          {
            quantityPercent: settings.quantityTolerancePercent.toString(),
            pricePercent: settings.priceTolerancePercent.toString(),
          },
        )
      : [];
    if (!po.items.length)
      findings = [
        {
          signature: 'PO|OTHER|items',
          against: 'PO',
          type: 'OTHER',
          severity: 'INFO',
          field: 'items',
          itemLabel: null,
          expectedValue: null,
          actualValue: null,
          message:
            'Enter the PO items from the buyer’s document (no automatic text extraction).',
        },
      ];
    if (po.proformaInvoiceId && !pi)
      findings.push({
        signature: 'PI|OTHER|draft',
        against: 'PI',
        type: 'OTHER',
        severity: 'INFO',
        field: 'reference',
        itemLabel: null,
        expectedValue: null,
        actualValue: null,
        message:
          'The linked PI is not issued yet — comparison uses the quotation only.',
      });
    const sigs = new Set(findings.map((f) => f.signature));
    const newCritical = findings.filter(
      (f) =>
        f.severity === 'CRITICAL' &&
        !po.discrepancies.some((d) => d.signature === f.signature),
    ).length;
    await this.prisma.$transaction(async (tx) => {
      await tx.pODiscrepancy.deleteMany({
        where: {
          purchaseOrderId: id,
          status: 'OPEN',
          signature: { notIn: [...sigs] },
        },
      });
      for (const f of findings)
        await tx.pODiscrepancy.upsert({
          where: {
            purchaseOrderId_signature: {
              purchaseOrderId: id,
              signature: f.signature,
            },
          },
          create: {
            organizationId: a.organizationId,
            purchaseOrderId: id,
            ...f,
          },
          update: { message: f.message, severity: f.severity },
        });
      const open = await tx.pODiscrepancy.findMany({
        where: {
          purchaseOrderId: id,
          status: 'OPEN',
          severity: { in: ['CRITICAL', 'WARNING'] },
        },
      });
      const status =
        !po.items.length || !refs.length
          ? 'UNDER_REVIEW'
          : open.length
            ? 'DISCREPANCY'
            : 'MATCHED';
      await tx.buyerPurchaseOrder.update({
        where: { id },
        data: { status, rowVersion: { increment: 1 } },
      });
      if (newCritical)
        await this.core.event(
          tx,
          { organizationId: a.organizationId, userId: a.userId },
          {
            entityType: 'PO',
            entityId: id,
            lineageId: id,
            type: 'DISCREPANCY_FOUND',
            title: `${newCritical} critical discrepanc${newCritical === 1 ? 'y' : 'ies'} found`,
          },
        );
    });
    if (record)
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'po.reviewed',
        entityType: 'BuyerPurchaseOrder',
        entityId: id,
        metadata: { compared: refs.map((r) => r.kind) },
      });
    return this.detail(a, id);
  }

  async resolve(
    a: Actor,
    id: string,
    discrepancyId: string,
    dto: ResolveDiscrepancyDto,
  ) {
    const po = await this.load(a.organizationId, id);
    if (FINAL.includes(po.status))
      throw new ConflictException(
        `A ${po.status.toLowerCase()} purchase order cannot be changed.`,
      );
    const d = po.discrepancies.find((x) => x.id === discrepancyId);
    if (!d) throw new NotFoundException('Discrepancy not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.pODiscrepancy.update({
        where: { id: d.id },
        data: {
          status: dto.status,
          resolutionNote: dto.note.trim(),
          resolvedByUserId: a.userId,
          resolvedAt: new Date(),
        },
      });
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'PO',
          entityId: id,
          lineageId: id,
          type: 'DISCREPANCY_RESOLVED',
          title: `${d.type.toLowerCase().replace('_', ' ')} discrepancy marked ${dto.status.toLowerCase().replace('_', ' ')}`,
        },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'po.discrepancy_resolved',
      entityType: 'BuyerPurchaseOrder',
      entityId: id,
      metadata: {
        discrepancyId,
        type: d.type,
        severity: d.severity,
        status: dto.status,
      },
    });
    return this.runCompare(a, id, false);
  }

  /** Commercial acceptance only (no procurement/shipment). Open CRITICAL discrepancies need a manager override with a reason. */
  async accept(a: Actor, id: string, dto: AcceptPoDto) {
    const po = await this.load(a.organizationId, id);
    if (FINAL.includes(po.status))
      throw new ConflictException(
        `A ${po.status.toLowerCase()} purchase order cannot be accepted.`,
      );
    if (!po.items.length)
      throw new BadRequestException('Enter the PO items before accepting.');
    const critical = po.discrepancies.filter(
      (d) => d.status === 'OPEN' && d.severity === 'CRITICAL',
    );
    if (critical.length && !dto.overrideReason)
      throw new ConflictException({
        message: `${critical.length} critical discrepanc${critical.length === 1 ? 'y is' : 'ies are'} unresolved. Resolve them or override with a reason.`,
        details: { code: 'CRITICAL_DISCREPANCIES', count: critical.length },
      });
    await this.prisma.$transaction(async (tx) => {
      await this.touch(
        tx,
        po,
        dto.expectedRowVersion,
        {
          status: 'ACCEPTED',
          reviewDecision: 'ACCEPTED',
          overrideReason: critical.length ? dto.overrideReason!.trim() : null,
          reviewedByUserId: a.userId,
          reviewedAt: new Date(),
        },
        { status: { notIn: FINAL as never } },
      );
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'PO',
          entityId: id,
          lineageId: id,
          type: 'ACCEPTED',
          title: critical.length
            ? `PO accepted with override (${critical.length} critical discrepancies) — ${dto.overrideReason!.trim()}`
            : 'PO accepted',
        },
      );
      await this.core.crmActivity(
        tx,
        a.organizationId,
        po.crmLeadId,
        `Buyer PO ${po.poNumber} accepted`,
        a.userId,
        { purchaseOrderId: id },
      );
    });
    if (critical.length)
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'po.discrepancy_override',
        entityType: 'BuyerPurchaseOrder',
        entityId: id,
        metadata: { criticalCount: critical.length },
      });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'po.accepted',
      entityType: 'BuyerPurchaseOrder',
      entityId: id,
      metadata: { poNumber: po.poNumber },
    });
    return this.detail(a, id);
  }

  async reject(a: Actor, id: string, dto: ReasonDto) {
    const po = await this.load(a.organizationId, id);
    if (FINAL.includes(po.status))
      throw new ConflictException(
        `A ${po.status.toLowerCase()} purchase order cannot be rejected.`,
      );
    await this.prisma.$transaction(async (tx) => {
      await this.touch(
        tx,
        po,
        dto.expectedRowVersion,
        {
          status: 'REJECTED',
          reviewDecision: 'REJECTED',
          reviewReason: dto.reason.trim(),
          reviewedByUserId: a.userId,
          reviewedAt: new Date(),
        },
        { status: { notIn: FINAL as never } },
      );
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'PO',
          entityId: id,
          lineageId: id,
          type: 'REJECTED',
          title: `PO rejected — ${dto.reason.trim()}`,
        },
      );
      await this.core.crmActivity(
        tx,
        a.organizationId,
        po.crmLeadId,
        `Buyer PO ${po.poNumber} rejected`,
        a.userId,
        { purchaseOrderId: id },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'po.rejected',
      entityType: 'BuyerPurchaseOrder',
      entityId: id,
    });
    return this.detail(a, id);
  }

  async requestClarification(a: Actor, id: string, dto: ReasonDto) {
    const po = await this.load(a.organizationId, id);
    if (FINAL.includes(po.status))
      throw new ConflictException(
        `A ${po.status.toLowerCase()} purchase order cannot be changed.`,
      );
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, po, dto.expectedRowVersion, {
        status: 'UNDER_REVIEW',
        reviewReason: dto.reason.trim(),
      });
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'PO',
          entityId: id,
          lineageId: id,
          type: 'CLARIFICATION_REQUESTED',
          title: `Clarification requested from buyer — ${dto.reason.trim()}`,
        },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'po.reviewed',
      entityType: 'BuyerPurchaseOrder',
      entityId: id,
      metadata: { decision: 'CLARIFICATION_REQUESTED' },
    });
    return this.detail(a, id);
  }

  async cancel(a: Actor, id: string, dto: ReasonDto) {
    const po = await this.load(a.organizationId, id);
    if (po.status === 'CANCELLED') return this.detail(a, id);
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, po, dto.expectedRowVersion, {
        status: 'CANCELLED',
        reviewReason: dto.reason.trim(),
      });
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'PO',
          entityId: id,
          lineageId: id,
          type: 'CANCELLED',
          title: `PO cancelled — ${dto.reason.trim()}`,
        },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'po.cancelled',
      entityType: 'BuyerPurchaseOrder',
      entityId: id,
    });
    return this.detail(a, id);
  }

  // ------------------------------------------------------------- reads

  private summary(p: Row, buyerName: string): PoSummary {
    const open = p.discrepancies.filter((d) => d.status === 'OPEN');
    return {
      id: p.id,
      poNumber: p.poNumber,
      poDate: day(p.poDate)!,
      status: p.status,
      source: p.source as 'MANUAL' | 'UPLOAD',
      buyer: { id: p.buyerCompanyId, name: buyerName },
      quotation: p.quotation
        ? {
            id: p.quotation.id,
            displayNumber: display(
              p.quotation.quotationNumber,
              p.quotation.revision,
            ),
          }
        : null,
      proformaInvoice: p.proformaInvoice
        ? {
            id: p.proformaInvoice.id,
            displayNumber: display(
              p.proformaInvoice.piNumber,
              p.proformaInvoice.revision,
            ),
          }
        : null,
      totalAmount:
        m(p.totalAmount) ??
        (p.items.length
          ? money(
              p.items.reduce(
                (t, i) =>
                  t.plus(
                    lineTotal(i.quantity.toString(), i.unitPrice.toString()),
                  ),
                new D(0),
              ),
            )
          : null),
      currency: p.currency,
      discrepancyCounts: {
        critical: open.filter((d) => d.severity === 'CRITICAL').length,
        warning: open.filter((d) => d.severity === 'WARNING').length,
        info: open.filter((d) => d.severity === 'INFO').length,
      },
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private async buyerNames(ids: string[]) {
    const rows = await this.prisma.buyerCompany.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, canonicalName: true },
    });
    return new Map(rows.map((r) => [r.id, r.canonicalName]));
  }

  async list(a: Actor, q: ListQueryDto): Promise<CommercialList<PoSummary>> {
    const and: Prisma.BuyerPurchaseOrderWhereInput[] = [
      { organizationId: a.organizationId },
    ];
    if (q.status) and.push({ status: q.status as never });
    if (q.buyerCompanyId) and.push({ buyerCompanyId: q.buyerCompanyId });
    if (q.crmLeadId) and.push({ crmLeadId: q.crmLeadId });
    if (q.quotationId) and.push({ quotationId: q.quotationId });
    if (q.from || q.to)
      and.push({
        poDate: {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to ? { lte: new Date(q.to) } : {}),
        },
      });
    const t = q.search?.trim();
    if (t) {
      const buyers = await this.prisma.buyerCompany.findMany({
        where: { canonicalName: { contains: t, mode: 'insensitive' } },
        select: { id: true },
        take: 50,
      });
      and.push({
        OR: [
          { poNumber: { contains: t, mode: 'insensitive' } },
          ...(buyers.length
            ? [{ buyerCompanyId: { in: buyers.map((b) => b.id) } }]
            : []),
        ],
      });
    }
    const where = { AND: and };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const [total, rows] = await Promise.all([
      this.prisma.buyerPurchaseOrder.count({ where }),
      this.prisma.buyerPurchaseOrder.findMany({
        where,
        include,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const names = await this.buyerNames(rows.map((r) => r.buyerCompanyId));
    return {
      items: rows.map((r) =>
        this.summary(r, names.get(r.buyerCompanyId) ?? 'Buyer'),
      ),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async detail(a: Actor, id: string): Promise<PoDetail> {
    const po = await this.load(a.organizationId, id);
    const settings = await this.core.rawSettings(a.organizationId);
    const [names, buyer, q, pi] = await Promise.all([
      this.core.userNames([
        po.reviewedByUserId,
        ...po.discrepancies.map((d) => d.resolvedByUserId),
      ]),
      this.buyerNames([po.buyerCompanyId]),
      this.effectiveQuotation(a.organizationId, po.quotationId),
      this.effectivePi(a.organizationId, po.proformaInvoiceId),
    ]);
    const col = (
      label: string,
      d: {
        currency: string;
        incoterm: string | null;
        incotermPlace: string | null;
        paymentTerms: string | null;
        deliveryTerms: string | null;
        total: string | null;
        items: {
          description: string;
          quantity: Prisma.Decimal;
          unit: string;
          unitPrice: Prisma.Decimal | null;
        }[];
      },
    ): ComparisonColumn => ({
      label,
      currency: d.currency,
      incoterm: d.incoterm,
      incotermPlace: d.incotermPlace,
      paymentTerms: d.paymentTerms,
      deliveryTerms: d.deliveryTerms,
      totalAmount: d.total,
      items: d.items.map((i) => ({
        description: i.description,
        quantity: i.quantity.toString(),
        unit: i.unit,
        unitPrice: s(i.unitPrice),
      })),
    });
    const sum = this.summary(po, buyer.get(po.buyerCompanyId) ?? 'Buyer');
    const can = (x: Parameters<typeof roleHasPermission>[1]) =>
      roleHasPermission(a.role, x);
    const final = FINAL.includes(po.status);
    const actions: string[] = [];
    if (!final && can('purchase_orders.create'))
      actions.push('edit', 'add_attachment');
    if (!final && can('purchase_orders.review'))
      actions.push(
        'compare',
        'resolve',
        'request_clarification',
        'reject',
        'cancel',
      );
    if (!final && can('purchase_orders.accept')) actions.push('accept');
    const linesTotal = po.items.length
      ? money(
          po.items.reduce(
            (t, i) =>
              t.plus(lineTotal(i.quantity.toString(), i.unitPrice.toString())),
            new D(0),
          ),
        )
      : null;
    return {
      ...sum,
      rowVersion: po.rowVersion,
      crmLeadId: po.crmLeadId,
      inquiryId: po.inquiryId,
      incoterm: po.incoterm,
      incotermPlace: po.incotermPlace,
      paymentTerms: po.paymentTerms,
      deliveryTerms: po.deliveryTerms,
      destination: po.destination,
      notes: po.notes,
      items: po.items.map((i) => ({
        id: i.id,
        sortOrder: i.sortOrder,
        quotationItemId: i.quotationItemId,
        productId: i.productId,
        buyerProductCode: i.buyerProductCode,
        description: i.description,
        specification: i.specification,
        packaging: i.packaging,
        quantity: i.quantity.toString(),
        unit: i.unit,
        unitPrice: i.unitPrice.toString(),
        totalPrice: m(i.totalPrice),
        deliveryDate: i.deliveryDate,
      })),
      linesTotal,
      attachments: po.attachments.map((x) => ({
        id: x.id,
        filename: x.originalFilename,
        mimeType: x.mimeType,
        sizeBytes: x.sizeBytes,
        createdAt: x.createdAt.toISOString(),
      })),
      discrepancies: po.discrepancies
        .sort(
          (x, y) =>
            ['CRITICAL', 'WARNING', 'INFO'].indexOf(x.severity) -
            ['CRITICAL', 'WARNING', 'INFO'].indexOf(y.severity),
        )
        .map((d) => ({
          id: d.id,
          against: d.against as 'QUOTATION',
          type: d.type as 'OTHER',
          severity: d.severity as 'INFO',
          field: d.field,
          itemLabel: d.itemLabel,
          expectedValue: d.expectedValue,
          actualValue: d.actualValue,
          message: d.message,
          status: d.status as 'OPEN',
          resolutionNote: d.resolutionNote,
          resolvedBy: d.resolvedByUserId
            ? (names.get(d.resolvedByUserId) ?? null)
            : null,
          resolvedAt: d.resolvedAt?.toISOString() ?? null,
        })),
      comparison: {
        quotation: q
          ? col(`Quotation ${display(q.quotationNumber, q.revision)}`, {
              ...q,
              total: s(q.totalAmount),
            })
          : null,
        pi: pi
          ? col(`PI ${display(pi.piNumber, pi.revision)}`, {
              ...pi,
              total: pi.totalAmount.toFixed(2),
            })
          : null,
        po: col(`PO ${po.poNumber}`, {
          ...po,
          total: m(po.totalAmount) ?? linesTotal,
        }),
        tolerance: {
          quantityPercent: settings.quantityTolerancePercent.toString(),
          pricePercent: settings.priceTolerancePercent.toString(),
        },
      },
      review:
        po.reviewDecision === 'ACCEPTED' || po.reviewDecision === 'REJECTED'
          ? {
              decidedAt: po.reviewedAt!.toISOString(),
              decidedBy: po.reviewedByUserId
                ? (names.get(po.reviewedByUserId) ?? null)
                : null,
              decision: po.reviewDecision,
              reason: po.reviewReason,
              overrideReason: po.overrideReason,
            }
          : null,
      crm:
        po.status === 'ACCEPTED'
          ? await this.core.crmContext(
              a.organizationId,
              po.crmLeadId,
              'PO',
              'The buyer purchase order was accepted.',
            )
          : await this.core.crmContext(
              a.organizationId,
              po.crmLeadId,
              'QUOTATION',
              'A quotation exists for this buyer.',
            ),
      events: await this.core.events(a.organizationId, [id]),
      availableActions: actions,
    };
  }

  assertAccess(a: Actor) {
    if (!roleHasPermission(a.role, 'purchase_orders.view'))
      throw new ForbiddenException();
  }
}
