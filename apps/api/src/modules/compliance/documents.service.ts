import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import {
  countryLabel,
  GENERATABLE_DOCUMENT_TYPES,
  roleHasPermission,
  type CommercialInvoiceContent,
  type DocumentTemplateView,
  type DocumentTotals,
  type GeneratedDocumentType,
  type PackingListContent,
  type PartySnapshot,
  type Permission,
  type ShippingInstructionContent,
  type TradeDocumentDetail,
  type TradeDocumentList,
  type TradeDocumentSummary,
} from '@exportpro/types';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
  day,
  iso,
} from '../commercial/commercial-core.service';
import { D } from '../costing/costing-calculator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  INQUIRY_ATTACHMENT_EXTENSIONS,
  MAX_INQUIRY_ATTACHMENT_BYTES,
  StorageService,
} from '../storage/storage.service';
import {
  ApproveDocumentDto,
  DocReasonDto,
  DocumentListQueryDto,
  DocumentMetadataDto,
  GenerateDocumentDto,
  TemplateDto,
  UpdateDocumentDto,
} from './compliance.dto';
import { documentValidationStatuses } from '../document-validation/validation.service';
import { expiryState } from './compliance.service';
import {
  computeTotals,
  DEFAULT_TEMPLATE,
  diffContent,
  lineAmount,
  sanitizeContent,
  validateContent,
} from './document-content';
import { renderTradeDocPdf, type TradeDocPdfInput } from './document-pdf';

type Doc = Prisma.TradeDocumentGetPayload<object>;

/** Uploads: documents, images, spreadsheets, text. No executables or archives. */
const TRADE_DOC_EXTENSIONS: Record<string, string[]> = Object.fromEntries(
  Object.entries(INQUIRY_ATTACHMENT_EXTENSIONS).filter(
    ([m]) => m !== 'message/rfc822',
  ),
);
const NUMBER_PREFIX: Record<GeneratedDocumentType, 'CI' | 'PL' | 'SI'> = {
  COMMERCIAL_INVOICE: 'CI',
  PACKING_LIST: 'PL',
  SHIPPING_INSTRUCTION: 'SI',
};
const TITLE: Record<string, string> = {
  COMMERCIAL_INVOICE: 'Commercial invoice',
  PACKING_LIST: 'Packing list',
  SHIPPING_INSTRUCTION: 'Shipping instruction',
  CERTIFICATE_OF_ORIGIN: 'Certificate of origin',
  PHYTOSANITARY_CERTIFICATE: 'Phytosanitary certificate',
  INSPECTION_CERTIFICATE: 'Inspection certificate',
  TEST_CERTIFICATE: 'Test / analysis certificate',
  FUMIGATION_CERTIFICATE: 'Fumigation certificate',
  INSURANCE_CERTIFICATE: 'Insurance certificate',
  SHIPPING_BILL: 'Shipping bill',
  BILL_OF_LADING: 'Bill of lading',
  AIRWAY_BILL: 'Airway bill',
  REGISTRATION_CERTIFICATE: 'Registration certificate',
  OTHER: 'Document',
};
const TAB_TYPES: Record<string, string[]> = {
  commercial: ['COMMERCIAL_INVOICE'],
  shipment: [
    'PACKING_LIST',
    'SHIPPING_INSTRUCTION',
    'SHIPPING_BILL',
    'BILL_OF_LADING',
    'AIRWAY_BILL',
  ],
  compliance: [
    'CERTIFICATE_OF_ORIGIN',
    'PHYTOSANITARY_CERTIFICATE',
    'INSPECTION_CERTIFICATE',
    'TEST_CERTIFICATE',
    'FUMIGATION_CERTIFICATE',
    'INSURANCE_CERTIFICATE',
    'REGISTRATION_CERTIFICATE',
  ],
};
const FINAL = [
  'APPROVED',
  'ISSUED_EXTERNAL',
  'SUPERSEDED',
  'EXPIRED',
  'ARCHIVED',
];
const LIVE_EXPIRABLE = [
  'UPLOADED',
  'UNDER_REVIEW',
  'APPROVED',
  'ISSUED_EXTERNAL',
];
const isGen = (t: string): t is GeneratedDocumentType =>
  (GENERATABLE_DOCUMENT_TYPES as readonly string[]).includes(t);
const today = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

interface Snapshot {
  exporter: PartySnapshot;
  content: unknown;
  totals: DocumentTotals;
  template: { footer: string; terms: string | null; signatureLabel: string };
  approvedAt: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly core: CommercialCoreService,
  ) {}

  private can(a: Actor, p: Permission) {
    return roleHasPermission(a.role, p);
  }

  /** Logistics may edit packing lists and shipping instructions only. */
  private assertEdit(a: Actor, type: string) {
    const ok =
      this.can(a, 'documents.edit') ||
      ((type === 'PACKING_LIST' || type === 'SHIPPING_INSTRUCTION') &&
        this.can(a, 'documents.edit_logistics'));
    if (!ok)
      throw new ForbiddenException(
        'You do not have permission to edit this document.',
      );
  }

  private async load(organizationId: string, id: string): Promise<Doc> {
    const d = await this.prisma.tradeDocument.findFirst({
      where: { id, organizationId },
    });
    if (!d) throw new NotFoundException('Document not found.');
    return d;
  }

  private event(
    tx: Prisma.TransactionClient | PrismaService,
    a: Actor,
    d: { id: string; rootId: string },
    type: string,
    title: string,
  ) {
    return this.core.event(tx, a, {
      entityType: 'DOCUMENT',
      entityId: d.id,
      lineageId: d.rootId,
      type,
      title,
    });
  }

  /** Read-time expiry (no scheduler): live documents past their expiry date become EXPIRED. */
  private async expireDue(organizationId: string) {
    const due = await this.prisma.tradeDocument.findMany({
      where: {
        organizationId,
        status: { in: LIVE_EXPIRABLE },
        expiryDate: { lt: today() },
      },
      select: { id: true, rootId: true, title: true },
    });
    if (!due.length) return;
    await this.prisma.tradeDocument.updateMany({
      where: { id: { in: due.map((d) => d.id) } },
      data: { status: 'EXPIRED' },
    });
    for (const d of due)
      await this.core.event(
        this.prisma,
        { organizationId, userId: null } as unknown as Actor,
        {
          entityType: 'DOCUMENT',
          entityId: d.id,
          lineageId: d.rootId,
          type: 'EXPIRED',
          title: `${d.title} expired`,
        },
      );
  }

  async template(
    organizationId: string,
    type: string,
  ): Promise<DocumentTemplateView> {
    const t = await this.prisma.documentTemplate.findUnique({
      where: {
        organizationId_documentType: { organizationId, documentType: type },
      },
    });
    const def = isGen(type) ? DEFAULT_TEMPLATE[type] : null;
    return {
      documentType: type as DocumentTemplateView['documentType'],
      footer: t?.footer ?? def?.footer ?? null,
      terms: t?.terms ?? null,
      declaration: t?.declaration ?? def?.declaration ?? null,
      signatureLabel: t?.signatureLabel ?? null,
      expiryWarningDays: t?.expiryWarningDays ?? 30,
    };
  }

  async templates(a: Actor) {
    return Promise.all(
      [
        'COMMERCIAL_INVOICE',
        'PACKING_LIST',
        'SHIPPING_INSTRUCTION',
        'GENERAL',
      ].map((t) => this.template(a.organizationId, t)),
    );
  }

  async updateTemplate(a: Actor, dto: TemplateDto) {
    const data = {
      footer: dto.footer,
      terms: dto.terms,
      declaration: dto.declaration,
      signatureLabel: dto.signatureLabel,
      expiryWarningDays: dto.expiryWarningDays,
      updatedByUserId: a.userId,
    };
    await this.prisma.documentTemplate.upsert({
      where: {
        organizationId_documentType: {
          organizationId: a.organizationId,
          documentType: dto.documentType,
        },
      },
      create: {
        organizationId: a.organizationId,
        documentType: dto.documentType,
        ...data,
      },
      update: data,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'document.template_updated',
      entityType: 'DocumentTemplate',
      entityId: dto.documentType,
      metadata: {
        fields: Object.keys(dto).filter((k) => k !== 'documentType'),
      },
    });
    return this.templates(a);
  }

  // -------------------------------------------------------- generation

  async generate(a: Actor, dto: GenerateDocumentDto) {
    const org = a.organizationId;
    const type = dto.documentType;
    if (
      type === 'COMMERCIAL_INVOICE'
        ? !this.can(a, 'documents.generate')
        : !(
            this.can(a, 'documents.generate') ||
            this.can(a, 'documents.edit_logistics')
          )
    )
      throw new ForbiddenException(
        'You do not have permission to prepare this document.',
      );
    const po = dto.purchaseOrderId
      ? await this.prisma.buyerPurchaseOrder.findFirst({
          where: { id: dto.purchaseOrderId, organizationId: org },
          include: {
            items: { orderBy: { sortOrder: 'asc' } },
            discrepancies: { where: { status: 'OPEN', severity: 'CRITICAL' } },
          },
        })
      : null;
    if (dto.purchaseOrderId && !po)
      throw new NotFoundException('Purchase order not found.');
    let pi = null as Prisma.ProformaInvoiceGetPayload<{
      include: { items: true };
    }> | null;
    let override: string | null = null;
    if (type === 'COMMERCIAL_INVOICE') {
      if (po) {
        if (po.status !== 'ACCEPTED')
          throw new ConflictException({
            message:
              'A commercial invoice is prepared from an accepted buyer PO. Accept the PO first.',
            details: { code: 'PO_NOT_ACCEPTED' },
          });
        if (po.discrepancies.length) {
          if (!dto.overrideReason)
            throw new ConflictException({
              message: `PO ${po.poNumber} has ${po.discrepancies.length} unresolved critical discrepanc${po.discrepancies.length === 1 ? 'y' : 'ies'}. Resolve them, or a manager may override with a reason.`,
              details: {
                code: 'CRITICAL_DISCREPANCIES',
                count: po.discrepancies.length,
              },
            });
          if (!this.can(a, 'documents.approve'))
            throw new ForbiddenException(
              'Only a manager can override open PO discrepancies.',
            );
          override = dto.overrideReason.trim();
        }
      } else if (dto.proformaInvoiceId) {
        pi = await this.prisma.proformaInvoice.findFirst({
          where: { id: dto.proformaInvoiceId, organizationId: org },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!pi) throw new NotFoundException('Proforma invoice not found.');
        if (!['ISSUED', 'SENT', 'ACCEPTED'].includes(pi.status))
          throw new ConflictException('The proforma invoice must be issued.');
        if (!dto.overrideReason || !this.can(a, 'documents.approve'))
          throw new ForbiddenException({
            message:
              'A commercial invoice without an accepted PO needs a manager authorization with a reason.',
            details: { code: 'MANAGER_AUTHORIZATION_REQUIRED' },
          });
        override = dto.overrideReason.trim();
      } else
        throw new BadRequestException(
          'Choose the accepted buyer PO this invoice is for.',
        );
    } else if (!po)
      throw new BadRequestException(
        'Choose the buyer PO this document is for.',
      );
    else if (['CANCELLED', 'REJECTED'].includes(po.status))
      throw new ConflictException(
        `PO ${po.poNumber} is ${po.status.toLowerCase()}.`,
      );

    const piId = po?.proformaInvoiceId ?? pi?.id ?? null;
    if (!pi && piId)
      pi = await this.prisma.proformaInvoice.findFirst({
        where: { id: piId, organizationId: org },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
    const qid = po?.quotationId ?? pi?.quotationId ?? null;
    const q = qid
      ? await this.prisma.quotation.findFirst({
          where: { id: qid, organizationId: org },
          include: { items: true },
        })
      : null;
    const buyerId = po?.buyerCompanyId ?? pi?.buyerCompanyId ?? null;
    const consignee = await this.core.buyerSnapshot(
      org,
      buyerId,
      pi?.buyerName ?? q?.buyerName ?? null,
      null,
    );
    const orgRow = await this.prisma.organization.findUniqueOrThrow({
      where: { id: org },
      select: { country: true },
    });
    const origin =
      orgRow.country && /^[A-Z]{2}$/.test(orgRow.country)
        ? orgRow.country
        : null;
    const tpl = await this.template(org, type);
    const productIds = (po?.items ?? [])
      .map((i) => i.productId)
      .filter(Boolean) as string[];
    const products = productIds.length
      ? await this.prisma.organizationProduct.findMany({
          where: { id: { in: productIds }, organizationId: org },
          select: { id: true, hsCode: true },
        })
      : [];
    const hsOf = (productId: string | null, quotationItemId: string | null) =>
      (productId ? products.find((p) => p.id === productId)?.hsCode : null) ??
      (quotationItemId
        ? q?.items.find((x) => x.id === quotationItemId)?.hsCode
        : null) ??
      null;
    const checklist = po
      ? await this.prisma.complianceChecklist.findFirst({
          where: { organizationId: org, purchaseOrderId: po.id },
          select: { context: true },
        })
      : null;
    const mode =
      (checklist?.context as { shipmentMode?: string | null } | null)
        ?.shipmentMode ?? null;
    const dest = pi?.destinationCountry ?? q?.destinationCountry ?? null;
    const discharge = pi?.destinationPort ?? q?.destinationPort ?? null;

    let content:
      | CommercialInvoiceContent
      | PackingListContent
      | ShippingInstructionContent;
    if (type === 'COMMERCIAL_INVOICE') {
      // Source of truth: accepted PO → PI → quotation. Prices are never recalculated from costing.
      const items = po
        ? po.items.map((i) => ({
            description: i.description,
            hsCode: hsOf(i.productId, i.quotationItemId),
            quantity: i.quantity.toString(),
            unit: i.unit,
            unitPrice: i.unitPrice.toString(),
          }))
        : pi!.items.map((i) => ({
            description: i.description,
            hsCode: i.hsCode,
            quantity: i.quantity.toString(),
            unit: i.unit,
            unitPrice: i.unitPrice.toString(),
          }));
      content = {
        invoiceDate: day(new Date()),
        buyerPoReference: po?.poNumber ?? null,
        consignee,
        currency: po?.currency ?? pi!.currency,
        incoterm: po?.incoterm ?? pi?.incoterm ?? q?.incoterm ?? null,
        incotermPlace:
          po?.incotermPlace ?? pi?.incotermPlace ?? q?.incotermPlace ?? null,
        originCountry: q?.originCountry ?? origin,
        destinationCountry: dest,
        portOfLoading: null,
        portOfDischarge: discharge,
        shipmentMode: mode,
        paymentTerms:
          po?.paymentTerms ?? pi?.paymentTerms ?? q?.paymentTerms ?? null,
        shippingTerms:
          po?.deliveryTerms ?? pi?.deliveryTerms ?? q?.deliveryTerms ?? null,
        items,
        additionalCharges: po
          ? null
          : pi!.additionalCharges.toFixed(2) === '0.00'
            ? null
            : pi!.additionalCharges.toFixed(2),
        chargesLabel: po ? null : pi!.chargesLabel,
        discount: po
          ? null
          : pi!.discount.toFixed(2) === '0.00'
            ? null
            : pi!.discount.toFixed(2),
        marks: null,
        declaration: tpl.declaration,
      };
    } else if (type === 'PACKING_LIST') {
      const ci = await this.prisma.tradeDocument.findFirst({
        where: {
          organizationId: org,
          purchaseOrderId: po!.id,
          documentType: 'COMMERCIAL_INVOICE',
          status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
        },
        orderBy: { version: 'desc' },
      });
      content = {
        invoiceReference: ci?.documentNumber ?? null,
        consignee,
        destinationCountry: dest,
        portOfLoading: null,
        portOfDischarge: discharge,
        // Weights and package counts are never invented — the user enters them.
        packages: po!.items.map((i) => ({
          marks: null,
          packageType:
            i.packaging ??
            (i.quotationItemId
              ? (q?.items.find((x) => x.id === i.quotationItemId)?.packaging ??
                '')
              : ''),
          packageCount: 0,
          description: i.description,
          quantity: i.quantity.toString(),
          unit: i.unit,
          netWeightKg: null,
          grossWeightKg: null,
          dimensions: null,
          volumeCbm: null,
        })),
        notes: null,
      };
    } else {
      const pl = await this.prisma.tradeDocument.findFirst({
        where: {
          organizationId: org,
          purchaseOrderId: po!.id,
          documentType: 'PACKING_LIST',
          status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
        },
        orderBy: [{ status: 'asc' }, { version: 'desc' }],
      });
      const plSnap = pl
        ? (((pl.snapshot as unknown as Snapshot | null)?.content ??
            pl.content) as PackingListContent | null)
        : null;
      const plTotals = (pl?.totals ?? null) as DocumentTotals | null;
      content = {
        consignee,
        notifyParty: null,
        originCountry: q?.originCountry ?? origin,
        destinationCountry: dest,
        placeOfReceipt: null,
        portOfLoading: null,
        portOfDischarge: discharge,
        finalDestination: null,
        incoterm: po!.incoterm ?? q?.incoterm ?? null,
        incotermPlace: po!.incotermPlace ?? q?.incotermPlace ?? null,
        shipmentMode: mode,
        cargoDescription: po!.items
          .map((i) => `${i.description} — ${i.quantity.toString()} ${i.unit}`)
          .join('\n'),
        hsCodes:
          [
            ...new Set(
              po!.items
                .map((i) => hsOf(i.productId, i.quotationItemId))
                .filter(Boolean),
            ),
          ].join(', ') || null,
        packageCount: plTotals?.packages || null,
        netWeightKg: plTotals?.netWeightKg ?? null,
        grossWeightKg: plTotals?.grossWeightKg ?? null,
        volumeCbm: plTotals?.volumeCbm ?? null,
        shippingMarks:
          plSnap?.packages
            .map((p) => p.marks)
            .filter(Boolean)
            .join('\n') || null,
        freightPayableAt: null,
        specialInstructions: null,
      };
    }
    const totals = computeTotals(type, content);
    const doc = await this.prisma.$transaction(async (tx) => {
      const number = await this.core.nextNumber(
        tx,
        org,
        NUMBER_PREFIX[type],
        NUMBER_PREFIX[type],
        true,
      );
      const row = await tx.tradeDocument.create({
        data: {
          organizationId: org,
          rootId: 'pending',
          documentType: type,
          title: `${TITLE[type]} ${number}`,
          documentNumber: number,
          source: 'SYSTEM_GENERATED',
          responsibleParty: 'EXPORTER',
          status: 'DRAFT',
          generated: true,
          buyerCompanyId: buyerId,
          purchaseOrderId: po?.id ?? null,
          quotationId: q?.id ?? null,
          proformaInvoiceId: pi?.id ?? null,
          inquiryId: po?.inquiryId ?? pi?.inquiryId ?? q?.inquiryId ?? null,
          countryCode: dest,
          content: content as unknown as Prisma.InputJsonValue,
          totals: totals as Prisma.InputJsonValue,
          overrideReason: override,
          overrideByUserId: override ? a.userId : null,
          createdByUserId: a.userId,
        },
      });
      const d = await tx.tradeDocument.update({
        where: { id: row.id },
        data: { rootId: row.id },
      });
      await this.event(
        tx,
        a,
        d,
        'GENERATED',
        `${d.title} prepared${po ? ` from PO ${po.poNumber}` : pi ? ` from ${pi.piNumber} (manager-authorized, no PO)` : ''}`,
      );
      return d;
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'document.generated',
      entityType: 'TradeDocument',
      entityId: doc.id,
      metadata: {
        documentType: type,
        number: doc.documentNumber,
        purchaseOrderId: po?.id ?? null,
        override: Boolean(override),
      },
    });
    if (override)
      await this.audit.record({
        organizationId: org,
        actorId: a.userId,
        action: 'document.override',
        entityType: 'TradeDocument',
        entityId: doc.id,
        metadata: { reason: override.slice(0, 300), stage: 'generate' },
      });
    return this.detail(a, doc.id);
  }

  // ------------------------------------------------- external documents

  private async validateLinks(org: string, dto: DocumentMetadataDto) {
    const po = dto.purchaseOrderId
      ? await this.prisma.buyerPurchaseOrder.findFirst({
          where: { id: dto.purchaseOrderId, organizationId: org },
        })
      : null;
    if (dto.purchaseOrderId && !po)
      throw new NotFoundException('Purchase order not found.');
    if (
      dto.quotationId &&
      !(await this.prisma.quotation.findFirst({
        where: { id: dto.quotationId, organizationId: org },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Quotation not found.');
    if (
      dto.proformaInvoiceId &&
      !(await this.prisma.proformaInvoice.findFirst({
        where: { id: dto.proformaInvoiceId, organizationId: org },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Proforma invoice not found.');
    if (
      dto.productId &&
      !(await this.prisma.organizationProduct.findFirst({
        where: { id: dto.productId, organizationId: org },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Product not found.');
    if (
      dto.buyerCompanyId &&
      !(await this.prisma.buyerCompany.findFirst({
        where: {
          id: dto.buyerCompanyId,
          OR: [{ ownerOrganizationId: null }, { ownerOrganizationId: org }],
        },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Buyer not found.');
    let requirement =
      null as Prisma.ComplianceRequirementInstanceGetPayload<object> | null;
    if (dto.requirementId) {
      requirement = await this.prisma.complianceRequirementInstance.findFirst({
        where: { id: dto.requirementId, organizationId: org },
      });
      if (!requirement) throw new NotFoundException('Requirement not found.');
      const types =
        (requirement.ruleSnapshot as { documentTypes?: string[] })
          .documentTypes ?? [];
      if (!types.includes(dto.documentType))
        throw new BadRequestException({
          message: `A ${TITLE[dto.documentType]} cannot satisfy this requirement (expects ${types.map((t) => TITLE[t] ?? t).join(' / ')}).`,
          details: { code: 'WRONG_DOCUMENT_TYPE' },
        });
    }
    let prev: Doc | null = null;
    if (dto.replacesDocumentId) {
      prev = await this.prisma.tradeDocument.findFirst({
        where: { id: dto.replacesDocumentId, organizationId: org },
      });
      if (!prev) throw new NotFoundException('Document to replace not found.');
      if (prev.generated)
        throw new BadRequestException(
          'Generated documents are revised, not replaced by upload.',
        );
      if (prev.documentType !== dto.documentType)
        throw new BadRequestException(
          'A replacement must have the same document type.',
        );
    }
    return { po, requirement, prev };
  }

  /** Records an external/official document (by reference or with a file). ExportPro never issues these. */
  async createExternal(
    a: Actor,
    dto: DocumentMetadataDto,
    file?: Express.Multer.File,
  ) {
    const org = a.organizationId;
    if (dto.source === 'SYSTEM_GENERATED')
      throw new BadRequestException(
        'Uploaded or referenced documents cannot be labelled as generated by ExportPro.',
      );
    if (dto.issueDate && dto.expiryDate && dto.expiryDate < dto.issueDate)
      throw new BadRequestException(
        'Expiry date cannot be before the issue date.',
      );
    const { po, requirement, prev } = await this.validateLinks(org, dto);
    let fileData: {
      storageKey: string;
      checksum: string;
      mimeType: string;
      sizeBytes: number;
      originalFilename: string;
    } | null = null;
    if (file) {
      const checksum = createHash('sha256').update(file.buffer).digest('hex');
      const allow =
        dto.allowDuplicate === true || dto.allowDuplicate === 'true';
      const dup = await this.prisma.tradeDocument.findFirst({
        where: { organizationId: org, checksum, status: { not: 'ARCHIVED' } },
        select: { id: true, title: true },
      });
      if (dup && !allow)
        throw new ConflictException({
          message: `This exact file is already stored as “${dup.title}”.`,
          details: { code: 'DUPLICATE_FILE', existingDocumentId: dup.id },
        });
      const { storageKey } = await this.storage.savePrivateFile(
        'trade-documents',
        file,
        TRADE_DOC_EXTENSIONS,
        MAX_INQUIRY_ATTACHMENT_BYTES,
      );
      fileData = {
        storageKey,
        checksum,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        originalFilename: (file.originalname || 'document').slice(0, 200),
      };
    }
    const doc = await this.prisma.$transaction(async (tx) => {
      const version = prev
        ? ((
            await tx.tradeDocument.aggregate({
              where: { rootId: prev.rootId },
              _max: { version: true },
            })
          )._max.version ?? prev.version) + 1
        : 1;
      const row = await tx.tradeDocument.create({
        data: {
          organizationId: org,
          rootId: prev?.rootId ?? 'pending',
          version,
          previousVersionId: prev?.id ?? null,
          revisionReason: prev ? 'Replacement uploaded' : null,
          documentType: dto.documentType,
          title:
            dto.title?.trim() ||
            `${TITLE[dto.documentType]}${dto.documentNumber ? ` ${dto.documentNumber}` : ''}`,
          documentNumber:
            dto.documentNumber?.trim() || prev?.documentNumber || null,
          source: dto.source,
          responsibleParty: dto.responsibleParty ?? 'OTHER',
          status: 'UPLOADED',
          generated: false,
          buyerCompanyId:
            dto.buyerCompanyId ??
            po?.buyerCompanyId ??
            prev?.buyerCompanyId ??
            null,
          purchaseOrderId: dto.purchaseOrderId ?? prev?.purchaseOrderId ?? null,
          quotationId:
            dto.quotationId ?? po?.quotationId ?? prev?.quotationId ?? null,
          proformaInvoiceId:
            dto.proformaInvoiceId ??
            po?.proformaInvoiceId ??
            prev?.proformaInvoiceId ??
            null,
          inquiryId: po?.inquiryId ?? prev?.inquiryId ?? null,
          productId: dto.productId ?? prev?.productId ?? null,
          countryCode: dto.countryCode ?? prev?.countryCode ?? null,
          issuer: dto.issuer?.trim() || null,
          issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          notes: dto.notes?.trim() || null,
          ...(fileData ?? {}),
          createdByUserId: a.userId,
        },
      });
      const d = prev
        ? row
        : await tx.tradeDocument.update({
            where: { id: row.id },
            data: { rootId: row.id },
          });
      if (requirement)
        await tx.complianceRequirementInstance.update({
          where: { id: requirement.id },
          data: { evidenceDocumentId: d.id },
        });
      await this.event(
        tx,
        a,
        d,
        file ? 'UPLOADED' : 'RECORDED',
        `${d.title} ${prev ? `replaced (v${d.version})` : file ? 'uploaded' : 'recorded by reference'}${requirement ? ' and linked as evidence' : ''}`,
      );
      return d;
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: file ? 'document.uploaded' : 'document.created',
      entityType: 'TradeDocument',
      entityId: doc.id,
      metadata: {
        documentType: doc.documentType,
        source: doc.source,
        version: doc.version,
        checksum: fileData?.checksum.slice(0, 16) ?? null,
        sizeBytes: fileData?.sizeBytes ?? null,
        requirementId: requirement?.id ?? null,
      },
    });
    return this.detail(a, doc.id);
  }

  // ------------------------------------------------------- lifecycle

  async update(a: Actor, id: string, dto: UpdateDocumentDto) {
    const d = await this.load(a.organizationId, id);
    if (d.generated) this.assertEdit(a, d.documentType);
    else if (!this.can(a, 'documents.edit') && !this.can(a, 'documents.upload'))
      throw new ForbiddenException(
        'You do not have permission to edit this document.',
      );
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== d.rowVersion
    )
      throw CommercialCoreService.conflict();
    const editable = d.generated
      ? ['DRAFT', 'GENERATED', 'REJECTED']
      : ['UPLOADED', 'REJECTED'];
    if (!editable.includes(d.status))
      throw new ConflictException(
        `A ${d.status.toLowerCase().replace('_', ' ')} document cannot be edited. Create a new version instead.`,
      );
    const data: Prisma.TradeDocumentUpdateInput = {
      rowVersion: { increment: 1 },
    };
    if (dto.title !== undefined) data.title = dto.title.trim() || d.title;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.internalNotes !== undefined)
      data.internalNotes = dto.internalNotes?.trim() || null;
    if (!d.generated) {
      if (dto.documentNumber !== undefined)
        data.documentNumber = dto.documentNumber?.trim() || null;
      if (dto.issuer !== undefined) data.issuer = dto.issuer?.trim() || null;
      if (dto.issueDate !== undefined)
        data.issueDate = dto.issueDate ? new Date(dto.issueDate) : null;
      if (dto.expiryDate !== undefined)
        data.expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;
      if (d.status === 'REJECTED') data.status = 'UPLOADED';
    } else {
      if (dto.content) {
        const c = sanitizeContent(
          d.documentType as GeneratedDocumentType,
          dto.content,
          (d.content ?? {}) as Record<string, unknown>,
        );
        data.content = c as unknown as Prisma.InputJsonValue;
        data.totals = computeTotals(
          d.documentType as GeneratedDocumentType,
          c,
        ) as Prisma.InputJsonValue;
      }
      if (d.status === 'REJECTED') data.status = 'DRAFT';
    }
    await this.prisma.tradeDocument.update({ where: { id }, data });
    return this.detail(a, id);
  }

  private async problems(a: Actor, d: Doc): Promise<string[]> {
    if (!d.generated) {
      const p: string[] = [];
      if (!d.storageKey && !d.documentNumber)
        p.push('Attach the file or record the document number.');
      if (expiryState(d.expiryDate, 0) === 'EXPIRED')
        p.push('The document has expired.');
      return p;
    }
    const content = ((d.snapshot as unknown as Snapshot | null)?.content ??
      d.content) as unknown;
    const exporter =
      (d.snapshot as unknown as Snapshot | null)?.exporter ??
      (await this.core.exporterSnapshot(a.organizationId));
    const p = validateContent(
      d.documentType as GeneratedDocumentType,
      content,
      exporter,
    );
    if (d.documentType === 'COMMERCIAL_INVOICE' && d.purchaseOrderId) {
      const po = await this.prisma.buyerPurchaseOrder.findFirst({
        where: { id: d.purchaseOrderId, organizationId: a.organizationId },
        include: {
          discrepancies: {
            where: { status: 'OPEN', severity: 'CRITICAL' },
            select: { id: true },
          },
        },
      });
      if (!po || po.status !== 'ACCEPTED')
        p.push('Source PO is no longer accepted.');
      else {
        if (po.discrepancies.length && !d.overrideReason)
          p.push(
            `PO has ${po.discrepancies.length} open critical discrepancies (manager override required).`,
          );
        const t = computeTotals('COMMERCIAL_INVOICE', content).total;
        const poTotal = po.totalAmount?.toFixed(2) ?? null;
        if (t && poTotal && !new D(t).eq(poTotal) && !d.overrideReason)
          p.push(
            `Invoice total ${t} differs from the accepted PO total ${poTotal} (manager override required).`,
          );
      }
    }
    return p;
  }

  async submitReview(a: Actor, id: string, v?: number) {
    const d = await this.load(a.organizationId, id);
    const ok =
      this.can(a, 'documents.review') ||
      (d.generated
        ? this.can(a, 'documents.edit') ||
          ((d.documentType === 'PACKING_LIST' ||
            d.documentType === 'SHIPPING_INSTRUCTION') &&
            this.can(a, 'documents.edit_logistics'))
        : this.can(a, 'documents.upload'));
    if (!ok)
      throw new ForbiddenException(
        'You do not have permission to request review.',
      );
    if (v !== undefined && v !== d.rowVersion)
      throw CommercialCoreService.conflict();
    if (!['DRAFT', 'GENERATED', 'UPLOADED', 'REJECTED'].includes(d.status))
      throw new ConflictException(
        `A ${d.status.toLowerCase()} document cannot be sent for review.`,
      );
    const p = (await this.problems(a, d)).filter(
      (x) => !/override required/.test(x),
    );
    if (p.length)
      throw new BadRequestException({
        message: 'Fix the document before requesting review.',
        details: { code: 'VALIDATION', problems: p },
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.tradeDocument.update({
        where: { id },
        data: {
          status: 'UNDER_REVIEW',
          reviewedByUserId: null,
          reviewedAt: null,
          rejectionReason: null,
          rowVersion: { increment: 1 },
        },
      });
      await this.event(
        tx,
        a,
        d,
        'REVIEW_REQUESTED',
        `${d.title} sent for review`,
      );
    });
    return this.detail(a, id);
  }

  /** Approval freezes a snapshot (exporter, content, totals, template). Approved versions are immutable. */
  async approve(a: Actor, id: string, dto: ApproveDocumentDto) {
    const d = await this.load(a.organizationId, id);
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== d.rowVersion
    )
      throw CommercialCoreService.conflict();
    if (!['UNDER_REVIEW', 'DRAFT', 'GENERATED', 'UPLOADED'].includes(d.status))
      throw new ConflictException(
        `A ${d.status.toLowerCase()} document cannot be approved.`,
      );
    const p = await this.problems(a, d);
    const blocking = p.filter(
      (x) => !(dto.overrideReason && /override required/.test(x)),
    );
    if (blocking.length)
      throw new ConflictException({
        message: 'This document cannot be approved yet.',
        details: { code: 'APPROVAL_BLOCKED', problems: blocking },
      });
    const overrideUsed = Boolean(
      dto.overrideReason && p.some((x) => /override required/.test(x)),
    );
    const now = new Date();
    let snapshot: Snapshot | null = null;
    if (d.generated) {
      const t = await this.template(a.organizationId, d.documentType);
      const exporter = await this.core.exporterSnapshot(a.organizationId);
      snapshot = {
        exporter,
        content: d.content,
        totals: computeTotals(
          d.documentType as GeneratedDocumentType,
          d.content,
        ),
        template: {
          footer: t.footer ?? '',
          terms: t.terms,
          signatureLabel:
            t.signatureLabel ||
            `For ${exporter.legalName || exporter.name} - Authorised signatory`,
        },
        approvedAt: now.toISOString(),
      };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.tradeDocument.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedByUserId: a.userId,
          approvedAt: now,
          reviewedByUserId: d.reviewedByUserId ?? a.userId,
          reviewedAt: d.reviewedAt ?? now,
          issueDate: d.generated ? (d.issueDate ?? now) : d.issueDate,
          ...(snapshot
            ? {
                snapshot: snapshot as unknown as Prisma.InputJsonValue,
                totals: snapshot.totals as Prisma.InputJsonValue,
              }
            : {}),
          ...(overrideUsed
            ? {
                overrideReason: dto.overrideReason!.trim(),
                overrideByUserId: a.userId,
              }
            : {}),
          rowVersion: { increment: 1 },
        },
      });
      const older = await tx.tradeDocument.findMany({
        where: {
          rootId: d.rootId,
          id: { not: id },
          status: {
            in: [
              'APPROVED',
              'ISSUED_EXTERNAL',
              'EXPIRED',
              'UPLOADED',
              'UNDER_REVIEW',
            ],
          },
          version: { lt: d.version },
        },
      });
      if (older.length) {
        await tx.tradeDocument.updateMany({
          where: { id: { in: older.map((o) => o.id) } },
          data: { status: 'SUPERSEDED' },
        });
        for (const o of older)
          await this.event(
            tx,
            a,
            o,
            'SUPERSEDED',
            `${o.title} v${o.version} superseded by v${d.version}`,
          );
      }
      await this.event(
        tx,
        a,
        d,
        'APPROVED',
        `${d.title}${d.version > 1 ? ` v${d.version}` : ''} approved${overrideUsed ? ' with manager override' : ''}`,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'document.approved',
      entityType: 'TradeDocument',
      entityId: id,
      metadata: {
        documentType: d.documentType,
        version: d.version,
        override: overrideUsed,
      },
    });
    if (overrideUsed)
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'document.override',
        entityType: 'TradeDocument',
        entityId: id,
        metadata: {
          reason: dto.overrideReason!.trim().slice(0, 300),
          stage: 'approve',
        },
      });
    return this.detail(a, id);
  }

  async reject(a: Actor, id: string, dto: DocReasonDto) {
    if (!this.can(a, 'documents.review') && !this.can(a, 'documents.approve'))
      throw new ForbiddenException(
        'You do not have permission to reject documents.',
      );
    const d = await this.load(a.organizationId, id);
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== d.rowVersion
    )
      throw CommercialCoreService.conflict();
    if (!['UNDER_REVIEW', 'UPLOADED', 'DRAFT', 'GENERATED'].includes(d.status))
      throw new ConflictException(
        `A ${d.status.toLowerCase()} document cannot be rejected.`,
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.tradeDocument.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectionReason: dto.reason.trim(),
          reviewedByUserId: a.userId,
          reviewedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.event(
        tx,
        a,
        d,
        'REJECTED',
        `${d.title} rejected: ${dto.reason.trim().slice(0, 120)}`,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'document.rejected',
      entityType: 'TradeDocument',
      entityId: id,
      metadata: { documentType: d.documentType, version: d.version },
    });
    return this.detail(a, id);
  }

  /** New editable version of an approved generated document. The approved version (and its PDF) stays immutable. */
  async revise(a: Actor, id: string, dto: DocReasonDto) {
    const d = await this.load(a.organizationId, id);
    if (!d.generated)
      throw new BadRequestException(
        'Upload a replacement file to create a new version of an external document.',
      );
    this.assertEdit(a, d.documentType);
    if (!['APPROVED', 'EXPIRED'].includes(d.status))
      throw new ConflictException(
        'Only an approved document can be revised; edit the draft instead.',
      );
    const lineage = await this.prisma.tradeDocument.findMany({
      where: { rootId: d.rootId, organizationId: a.organizationId },
    });
    if (
      lineage.some((x) =>
        ['DRAFT', 'UNDER_REVIEW', 'REJECTED', 'GENERATED'].includes(x.status),
      )
    )
      throw new ConflictException(
        'An open draft version already exists for this document.',
      );
    if (d.version !== Math.max(...lineage.map((x) => x.version)))
      throw new ConflictException('Revise the latest version.');
    const content =
      (d.snapshot as unknown as Snapshot | null)?.content ?? d.content;
    const n = await this.prisma.$transaction(async (tx) => {
      const row = await tx.tradeDocument.create({
        data: {
          organizationId: d.organizationId,
          rootId: d.rootId,
          version: d.version + 1,
          previousVersionId: d.id,
          revisionReason: dto.reason.trim(),
          documentType: d.documentType,
          title: d.title,
          documentNumber: d.documentNumber,
          source: d.source,
          responsibleParty: d.responsibleParty,
          status: 'DRAFT',
          generated: true,
          buyerCompanyId: d.buyerCompanyId,
          purchaseOrderId: d.purchaseOrderId,
          quotationId: d.quotationId,
          proformaInvoiceId: d.proformaInvoiceId,
          inquiryId: d.inquiryId,
          productId: d.productId,
          countryCode: d.countryCode,
          content: content as Prisma.InputJsonValue,
          totals: (d.totals ?? undefined) as Prisma.InputJsonValue | undefined,
          internalNotes: d.internalNotes,
          createdByUserId: a.userId,
        },
      });
      await this.event(
        tx,
        a,
        row,
        'REVISED',
        `${d.title} revision v${row.version} started: ${dto.reason.trim().slice(0, 120)}`,
      );
      return row;
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'document.revised',
      entityType: 'TradeDocument',
      entityId: n.id,
      metadata: { from: d.id, version: n.version },
    });
    return this.detail(a, n.id);
  }

  async archive(a: Actor, id: string, dto: DocReasonDto) {
    const d = await this.load(a.organizationId, id);
    if (!this.can(a, 'documents.edit'))
      throw new ForbiddenException(
        'You do not have permission to archive documents.',
      );
    if (d.status === 'ARCHIVED')
      throw new ConflictException('Already archived.');
    await this.prisma.$transaction(async (tx) => {
      await tx.tradeDocument.update({
        where: { id },
        data: {
          status: 'ARCHIVED',
          archivedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.event(
        tx,
        a,
        d,
        'ARCHIVED',
        `${d.title} archived: ${dto.reason.trim().slice(0, 120)}`,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'document.archived',
      entityType: 'TradeDocument',
      entityId: id,
      metadata: { documentType: d.documentType, version: d.version },
    });
    return this.detail(a, id);
  }

  // ------------------------------------------------------------- reads

  private async summaries(
    organizationId: string,
    rows: Doc[],
  ): Promise<TradeDocumentSummary[]> {
    const warn = (await this.template(organizationId, 'GENERAL'))
      .expiryWarningDays;
    const [buyers, pos, names] = await Promise.all([
      this.prisma.buyerCompany.findMany({
        where: {
          id: {
            in: rows.map((r) => r.buyerCompanyId).filter(Boolean) as string[],
          },
        },
        select: { id: true, canonicalName: true },
      }),
      this.prisma.buyerPurchaseOrder.findMany({
        where: {
          organizationId,
          id: {
            in: rows.map((r) => r.purchaseOrderId).filter(Boolean) as string[],
          },
        },
        select: { id: true, poNumber: true },
      }),
      this.core.userNames(rows.map((r) => r.createdByUserId)),
    ]);
    const [validation, extractions] = await Promise.all([
      documentValidationStatuses(
        this.prisma,
        organizationId,
        rows.map((r) => ({ id: r.id, version: r.version })),
      ),
      this.prisma.documentExtraction.findMany({
        where: {
          organizationId,
          tradeDocumentId: { in: rows.map((r) => r.id) },
        },
        orderBy: { extractionVersion: 'desc' },
        select: { tradeDocumentId: true, documentVersion: true, status: true },
      }),
    ]);
    return rows.map((r) => ({
      extractionStatus: r.generated
        ? null
        : (extractions.find(
            (x) =>
              x.tradeDocumentId === r.id && x.documentVersion === r.version,
          )?.status ?? null),
      validationStatus: validation.get(r.id)?.status ?? 'NOT_RUN',
      openIssues: validation.get(r.id)?.openIssues ?? 0,
      id: r.id,
      rootId: r.rootId,
      documentType: r.documentType as TradeDocumentSummary['documentType'],
      title: r.title,
      documentNumber: r.documentNumber,
      version: r.version,
      status: r.status as TradeDocumentSummary['status'],
      source: r.source as TradeDocumentSummary['source'],
      responsibleParty:
        r.responsibleParty as TradeDocumentSummary['responsibleParty'],
      generated: r.generated,
      issuer: r.issuer,
      issueDate: day(r.issueDate),
      expiryDate: day(r.expiryDate),
      expiry: expiryState(r.expiryDate, warn),
      buyer: r.buyerCompanyId
        ? {
            id: r.buyerCompanyId,
            name:
              buyers.find((b) => b.id === r.buyerCompanyId)?.canonicalName ??
              'Buyer',
          }
        : null,
      purchaseOrder: r.purchaseOrderId
        ? (pos.find((p) => p.id === r.purchaseOrderId) ?? null)
        : null,
      countryCode: r.countryCode,
      createdBy: names.get(r.createdByUserId) ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async list(a: Actor, q: DocumentListQueryDto): Promise<TradeDocumentList> {
    const org = a.organizationId;
    await this.expireDue(org);
    const warn = (await this.template(org, 'GENERAL')).expiryWarningDays;
    const soon = new Date(today().getTime() + warn * 86400000);
    const and: Prisma.TradeDocumentWhereInput[] = [{ organizationId: org }];
    if (q.status) and.push({ status: q.status });
    else
      and.push({
        status: {
          notIn:
            q.includeSuperseded === 'true'
              ? ['ARCHIVED']
              : ['ARCHIVED', 'SUPERSEDED'],
        },
      });
    const tab = q.tab ?? 'all';
    if (TAB_TYPES[tab]) and.push({ documentType: { in: TAB_TYPES[tab] } });
    if (tab === 'external') and.push({ generated: false });
    if (tab === 'expiring' || q.expiry === 'EXPIRING_SOON')
      and.push({ expiryDate: { gte: today(), lte: soon } });
    if (q.expiry === 'EXPIRED') and.push({ expiryDate: { lt: today() } });
    if (q.expiry === 'VALID')
      and.push({ OR: [{ expiryDate: null }, { expiryDate: { gt: soon } }] });
    if (q.documentType) and.push({ documentType: q.documentType });
    if (q.source) and.push({ source: q.source });
    if (q.buyerCompanyId) and.push({ buyerCompanyId: q.buyerCompanyId });
    if (q.purchaseOrderId) and.push({ purchaseOrderId: q.purchaseOrderId });
    if (q.productId) and.push({ productId: q.productId });
    if (q.countryCode) and.push({ countryCode: q.countryCode });
    if (q.createdBy)
      and.push({
        createdByUserId: q.createdBy === 'me' ? a.userId : q.createdBy,
      });
    const t = q.search?.trim();
    if (t) {
      const [buyers, pos] = await Promise.all([
        this.prisma.buyerCompany.findMany({
          where: {
            canonicalName: { contains: t, mode: 'insensitive' },
            OR: [{ ownerOrganizationId: null }, { ownerOrganizationId: org }],
          },
          select: { id: true },
          take: 50,
        }),
        this.prisma.buyerPurchaseOrder.findMany({
          where: {
            organizationId: org,
            poNumber: { contains: t, mode: 'insensitive' },
          },
          select: { id: true },
          take: 50,
        }),
      ]);
      const typeHit = Object.entries(TITLE)
        .filter(([, l]) => l.toLowerCase().includes(t.toLowerCase()))
        .map(([k]) => k);
      and.push({
        OR: [
          { documentNumber: { contains: t, mode: 'insensitive' } },
          { title: { contains: t, mode: 'insensitive' } },
          { issuer: { contains: t, mode: 'insensitive' } },
          { buyerCompanyId: { in: buyers.map((b) => b.id) } },
          { purchaseOrderId: { in: pos.map((p) => p.id) } },
          { documentType: { in: typeHit } },
          { countryCode: t.toUpperCase().slice(0, 2) },
        ],
      });
    }
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where = { AND: and };
    const [rows, total, expiring, expired, underReview] = await Promise.all([
      this.prisma.tradeDocument.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.tradeDocument.count({ where }),
      this.prisma.tradeDocument.count({
        where: {
          organizationId: org,
          status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
          expiryDate: { gte: today(), lte: soon },
        },
      }),
      this.prisma.tradeDocument.count({
        where: { organizationId: org, status: 'EXPIRED' },
      }),
      this.prisma.tradeDocument.count({
        where: { organizationId: org, status: 'UNDER_REVIEW' },
      }),
    ]);
    return {
      items: await this.summaries(org, rows),
      meta: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      counts: { expiring, expired, underReview },
    };
  }

  async detail(a: Actor, id: string): Promise<TradeDocumentDetail> {
    await this.expireDue(a.organizationId);
    const d = await this.load(a.organizationId, id);
    const [sum] = await this.summaries(a.organizationId, [d]);
    const lineage = await this.prisma.tradeDocument.findMany({
      where: { rootId: d.rootId, organizationId: a.organizationId },
      orderBy: { version: 'desc' },
    });
    const prev = d.previousVersionId
      ? lineage.find((x) => x.id === d.previousVersionId)
      : null;
    const snap = d.snapshot as unknown as Snapshot | null;
    const content = (snap?.content ??
      d.content) as TradeDocumentDetail['content'];
    const prevContent = prev
      ? ((prev.snapshot as unknown as Snapshot | null)?.content ?? prev.content)
      : null;
    const [q, pi, reqs, names, events] = await Promise.all([
      d.quotationId
        ? this.prisma.quotation.findFirst({
            where: { id: d.quotationId, organizationId: a.organizationId },
            select: { id: true, quotationNumber: true, revision: true },
          })
        : null,
      d.proformaInvoiceId
        ? this.prisma.proformaInvoice.findFirst({
            where: {
              id: d.proformaInvoiceId,
              organizationId: a.organizationId,
            },
            select: { id: true, piNumber: true, revision: true },
          })
        : null,
      this.prisma.complianceRequirementInstance.findMany({
        where: {
          organizationId: a.organizationId,
          OR: [
            { evidenceDocumentId: { in: lineage.map((x) => x.id) } },
            ...(d.purchaseOrderId
              ? [{ checklist: { purchaseOrderId: d.purchaseOrderId } }]
              : []),
          ],
        },
        select: {
          id: true,
          checklistId: true,
          ruleSnapshot: true,
          status: true,
          evidenceDocumentId: true,
        },
      }),
      this.core.userNames([d.reviewedByUserId, d.approvedByUserId]),
      this.core.events(a.organizationId, [d.rootId]),
    ]);
    const related = reqs.filter(
      (r) =>
        r.evidenceDocumentId ||
        (
          (r.ruleSnapshot as { documentTypes?: string[] }).documentTypes ?? []
        ).includes(d.documentType),
    );
    const editPerm = d.generated
      ? this.can(a, 'documents.edit') ||
        ((d.documentType === 'PACKING_LIST' ||
          d.documentType === 'SHIPPING_INSTRUCTION') &&
          this.can(a, 'documents.edit_logistics'))
      : this.can(a, 'documents.edit') || this.can(a, 'documents.upload');
    const actions: string[] = [];
    const draftLike = d.generated
      ? ['DRAFT', 'GENERATED', 'REJECTED'].includes(d.status)
      : ['UPLOADED', 'REJECTED'].includes(d.status);
    if (draftLike && editPerm) actions.push('edit');
    if (
      ['DRAFT', 'GENERATED', 'UPLOADED', 'REJECTED'].includes(d.status) &&
      (editPerm || this.can(a, 'documents.review'))
    )
      actions.push('submit_review');
    if (
      ['UNDER_REVIEW', 'DRAFT', 'GENERATED', 'UPLOADED'].includes(d.status) &&
      this.can(a, 'documents.approve')
    )
      actions.push('approve');
    if (
      ['UNDER_REVIEW', 'UPLOADED', 'DRAFT', 'GENERATED'].includes(d.status) &&
      (this.can(a, 'documents.review') || this.can(a, 'documents.approve'))
    )
      actions.push('reject');
    const latest = Math.max(...lineage.map((x) => x.version));
    if (
      d.generated &&
      ['APPROVED', 'EXPIRED'].includes(d.status) &&
      d.version === latest &&
      editPerm
    )
      actions.push('revise');
    if (
      !d.generated &&
      d.version === latest &&
      d.status !== 'ARCHIVED' &&
      this.can(a, 'documents.upload')
    )
      actions.push('replace');
    if (d.status !== 'ARCHIVED' && this.can(a, 'documents.edit'))
      actions.push('archive');
    if (d.generated) actions.push('pdf');
    if (d.storageKey) actions.push('download');
    return {
      ...sum,
      rowVersion: d.rowVersion,
      previousVersionId: d.previousVersionId,
      revisionReason: d.revisionReason,
      quotation: q
        ? {
            id: q.id,
            displayNumber: `${q.quotationNumber}${q.revision > 1 ? ` Rev ${q.revision}` : ''}`,
          }
        : null,
      proformaInvoice: pi
        ? {
            id: pi.id,
            displayNumber: `${pi.piNumber}${pi.revision > 1 ? ` Rev ${pi.revision}` : ''}`,
          }
        : null,
      inquiryId: d.inquiryId,
      productId: d.productId,
      notes: d.notes,
      internalNotes: editPerm ? d.internalNotes : null,
      file: d.storageKey
        ? {
            filename: d.originalFilename ?? 'document',
            mimeType: d.mimeType ?? 'application/octet-stream',
            sizeBytes: d.sizeBytes ?? 0,
            checksum: d.checksum ?? '',
          }
        : null,
      content,
      totals: (snap?.totals ?? d.totals ?? null) as DocumentTotals | null,
      exporterSnapshot: snap?.exporter ?? null,
      validationProblems: FINAL.includes(d.status)
        ? []
        : await this.problems(a, d),
      overrideReason: d.overrideReason,
      review: {
        reviewedBy: d.reviewedByUserId
          ? (names.get(d.reviewedByUserId) ?? null)
          : null,
        reviewedAt: iso(d.reviewedAt),
        approvedBy: d.approvedByUserId
          ? (names.get(d.approvedByUserId) ?? null)
          : null,
        approvedAt: iso(d.approvedAt),
        rejectionReason: d.rejectionReason,
      },
      versions: lineage.map((x) => ({
        id: x.id,
        version: x.version,
        status: x.status as TradeDocumentDetail['status'],
        createdAt: x.createdAt.toISOString(),
      })),
      differences: prev ? diffContent(prevContent, content) : [],
      requirements: related.map((r) => ({
        id: r.id,
        checklistId: r.checklistId,
        name: (r.ruleSnapshot as { name: string }).name,
        status:
          r.status as TradeDocumentDetail['requirements'][number]['status'],
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        actor: e.actor,
        createdAt: e.createdAt,
      })),
      availableActions: actions,
    };
  }

  async download(a: Actor, id: string) {
    const d = await this.load(a.organizationId, id);
    if (!d.storageKey)
      throw new NotFoundException('This document has no stored file.');
    const buffer = await this.storage
      .readPrivateFile(d.storageKey)
      .catch(() => {
        throw new NotFoundException('File not available.');
      });
    return {
      buffer,
      filename: d.originalFilename ?? 'document',
      mimeType: d.mimeType ?? 'application/octet-stream',
    };
  }

  /** PDFs for exporter-prepared documents only. Approved versions render from their frozen snapshot. */
  async pdf(a: Actor, id: string) {
    const d = await this.load(a.organizationId, id);
    if (!d.generated || !isGen(d.documentType))
      throw new BadRequestException(
        'ExportPro only produces PDFs for documents it prepares. Download the uploaded file instead.',
      );
    const type = d.documentType;
    const snap = d.snapshot as unknown as Snapshot | null;
    const tpl =
      snap?.template ??
      (await (async () => {
        const t = await this.template(a.organizationId, type);
        const ex = await this.core.exporterSnapshot(a.organizationId);
        return {
          footer: t.footer ?? '',
          terms: t.terms,
          signatureLabel:
            t.signatureLabel ||
            `For ${ex.legalName || ex.name} - Authorised signatory`,
        };
      })());
    const exporter =
      snap?.exporter ?? (await this.core.exporterSnapshot(a.organizationId));
    const content = (snap?.content ?? d.content) as unknown;
    const totals = (snap?.totals ??
      computeTotals(type, content)) as DocumentTotals;
    const draft = !snap;
    const number = `${d.documentNumber ?? ''}${d.version > 1 ? ` v${d.version}` : ''}`;
    const watermark =
      d.status === 'SUPERSEDED'
        ? 'Superseded by a later version'
        : d.status === 'ARCHIVED'
          ? 'Archived'
          : null;
    const c2 = (code: string | null) => (code ? countryLabel(code) : null);
    const party = (p: PartySnapshot | null) =>
      p
        ? [
            p.name,
            p.address,
            p.country,
            p.contactName ? `Attn: ${p.contactName}` : null,
            p.email,
            p.phone,
          ]
        : [];
    const fmtN = (v: string | null | undefined) => v ?? '-';
    let input: TradeDocPdfInput;
    if (type === 'COMMERCIAL_INVOICE') {
      const c = content as CommercialInvoiceContent;
      input = {
        title: 'COMMERCIAL INVOICE',
        subtitle: DEFAULT_TEMPLATE.COMMERCIAL_INVOICE.subtitle,
        number,
        draft,
        watermark,
        exporter,
        parties: [{ label: 'Buyer / consignee', lines: party(c.consignee) }],
        meta: [
          ['Invoice date', c.invoiceDate],
          ['Buyer PO', c.buyerPoReference],
          ['Currency', c.currency],
          [
            'Incoterms(R) 2020',
            c.incoterm
              ? `${c.incoterm}${c.incotermPlace ? ` ${c.incotermPlace}` : ''}`
              : null,
          ],
          ['Country of origin', c2(c.originCountry)],
          ['Destination', c2(c.destinationCountry)],
          ['Port of loading', c.portOfLoading],
          ['Port of discharge', c.portOfDischarge],
          ['Shipment mode', c.shipmentMode],
        ],
        table: {
          columns: [
            { label: '#', width: 4 },
            { label: 'Description of goods', width: 42 },
            { label: 'HS code', width: 12 },
            { label: 'Quantity', width: 14, align: 'right' },
            { label: `Unit price (${c.currency})`, width: 14, align: 'right' },
            { label: `Amount (${c.currency})`, width: 14, align: 'right' },
          ],
          rows: c.items.map((i, n) => [
            String(n + 1),
            i.description,
            i.hsCode ?? '-',
            `${i.quantity} ${i.unit}`,
            i.unitPrice,
            lineAmount(i.quantity, i.unitPrice) ?? '-',
          ]),
        },
        totals: [
          ['Subtotal', `${c.currency} ${totals.subtotal ?? '-'}`],
          ...(c.additionalCharges
            ? ([
                [
                  c.chargesLabel ?? 'Charges',
                  `${c.currency} ${c.additionalCharges}`,
                ],
              ] as [string, string][])
            : []),
          ...(c.discount
            ? ([['Discount', `-${c.currency} ${c.discount}`]] as [
                string,
                string,
              ][])
            : []),
          ['Total', `${c.currency} ${totals.total ?? '-'}`],
        ],
        blocks: [
          ['Payment terms', c.paymentTerms],
          ['Shipping terms', c.shippingTerms],
          ['Marks & numbers', c.marks],
          ['Terms', tpl.terms],
        ],
        declaration: c.declaration,
        signatureLabel: tpl.signatureLabel,
        footer: tpl.footer,
      };
    } else if (type === 'PACKING_LIST') {
      const c = content as PackingListContent;
      input = {
        title: 'PACKING LIST',
        subtitle: DEFAULT_TEMPLATE.PACKING_LIST.subtitle,
        number,
        draft,
        watermark,
        exporter,
        parties: [{ label: 'Consignee', lines: party(c.consignee) }],
        meta: [
          ['Invoice ref.', c.invoiceReference],
          ['Destination', c2(c.destinationCountry)],
          ['Port of loading', c.portOfLoading],
          ['Port of discharge', c.portOfDischarge],
        ],
        table: {
          columns: [
            { label: 'Marks & nos.', width: 14 },
            { label: 'Packages', width: 16 },
            { label: 'Description', width: 28 },
            { label: 'Quantity', width: 12, align: 'right' },
            { label: 'Net kg', width: 10, align: 'right' },
            { label: 'Gross kg', width: 10, align: 'right' },
            { label: 'Dim. / CBM', width: 12 },
          ],
          rows: c.packages.map((p) => [
            p.marks ?? '-',
            `${p.packageCount} x ${p.packageType || '-'}`,
            p.description,
            p.quantity ? `${p.quantity} ${p.unit ?? ''}` : '-',
            fmtN(p.netWeightKg),
            fmtN(p.grossWeightKg),
            [p.dimensions, p.volumeCbm ? `${p.volumeCbm} CBM` : null]
              .filter(Boolean)
              .join(' / ') || '-',
          ]),
        },
        totals: [
          ['Total packages', String(totals.packages ?? 0)],
          [
            'Total net weight',
            totals.netWeightKg ? `${totals.netWeightKg} kg` : '-',
          ],
          ...(totals.volumeCbm
            ? ([['Total volume', `${totals.volumeCbm} CBM`]] as [
                string,
                string,
              ][])
            : []),
          [
            'Total gross weight',
            totals.grossWeightKg ? `${totals.grossWeightKg} kg` : '-',
          ],
        ],
        blocks: [
          ['Notes', c.notes],
          ['Terms', tpl.terms],
        ],
        declaration: null,
        signatureLabel: tpl.signatureLabel,
        footer: tpl.footer,
      };
    } else {
      const c = content as ShippingInstructionContent;
      input = {
        title: 'SHIPPING INSTRUCTION',
        subtitle: DEFAULT_TEMPLATE.SHIPPING_INSTRUCTION.subtitle,
        number,
        draft,
        watermark,
        exporter,
        parties: [
          {
            label: 'Shipper',
            lines: [
              exporter.legalName || exporter.name,
              exporter.address,
              exporter.country,
            ],
          },
          { label: 'Consignee', lines: party(c.consignee) },
          { label: 'Notify party', lines: [c.notifyParty] },
        ],
        meta: [
          ['Origin', c2(c.originCountry)],
          ['Destination', c2(c.destinationCountry)],
          ['Place of receipt', c.placeOfReceipt],
          ['Port of loading', c.portOfLoading],
          ['Port of discharge', c.portOfDischarge],
          ['Final destination', c.finalDestination],
          [
            'Incoterms(R) 2020',
            c.incoterm
              ? `${c.incoterm}${c.incotermPlace ? ` ${c.incotermPlace}` : ''}`
              : null,
          ],
          ['Shipment mode', c.shipmentMode],
          ['Freight payable at', c.freightPayableAt],
        ],
        table: null,
        totals: [
          ['Packages', c.packageCount !== null ? String(c.packageCount) : '-'],
          ['Net weight', c.netWeightKg ? `${c.netWeightKg} kg` : '-'],
          ...(c.volumeCbm
            ? ([['Volume', `${c.volumeCbm} CBM`]] as [string, string][])
            : []),
          ['Gross weight', c.grossWeightKg ? `${c.grossWeightKg} kg` : '-'],
        ],
        blocks: [
          ['Cargo description', c.cargoDescription],
          ['HS codes', c.hsCodes],
          ['Shipping marks', c.shippingMarks],
          ['Special instructions', c.specialInstructions],
          ['Terms', tpl.terms],
        ],
        declaration: null,
        signatureLabel: tpl.signatureLabel,
        footer: tpl.footer,
      };
    }
    const buffer = renderTradeDocPdf(
      input,
      await this.core.logo(a.organizationId),
    );
    return {
      buffer,
      filename: `${(d.documentNumber ?? d.title).replace(/[^A-Za-z0-9-]+/g, '_')}${d.version > 1 ? `-v${d.version}` : ''}${draft ? '-DRAFT' : ''}.pdf`,
    };
  }
}
