import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  roleHasPermission,
  type CertificationVerification,
  type DuplicateCheck,
  type SupplierAttachmentView,
  type SupplierDetail,
  type SupplierPerformance,
  type SupplierSearchResult,
  type SupplierSummary,
  type SupplierType,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
} from '../commercial/commercial-core.service';
import { D, type Dec } from '../costing/costing-calculator';
import { FinanceCoreService } from '../finance/finance-core.service';
import { isoDay } from '../finance/finance-rules';
import {
  INQUIRY_ATTACHMENT_EXTENSIONS,
  MAX_INQUIRY_ATTACHMENT_BYTES,
  StorageService,
} from '../storage/storage.service';
import {
  GSTIN_RE,
  monthlyCapacity,
  normalizeName,
  phoneKey,
  qty,
  sameMeasure,
  scoreFit,
} from './procurement-rules';
import type {
  AttachmentMetaDto,
  CertificationDto,
  ShortlistDto,
  SupplierDto,
  SupplierProductDto,
  SupplierSearchDto,
} from './procurement.dto';

const INCLUDE = {
  products: { orderBy: { productName: 'asc' } },
  certifications: { orderBy: { type: 'asc' } },
} satisfies Prisma.SupplierInclude;
type Row = Prisma.SupplierGetPayload<{ include: typeof INCLUDE }>;

const SOURCE_LABEL: Record<string, string> = {
  USER_ADDED: 'User added',
  IMPORTED: 'Imported by your team',
  PUBLIC_DATA: 'Public data source',
  DIRECTORY: 'Directory',
  EXTERNAL_PROVIDER: 'External provider',
  AI_DERIVED_SUGGESTION: 'AI suggestion (unverified)',
  DEMO: 'DEMO data (not a real company)',
};

/**
 * Supplier discovery sources. Only your organization's own supplier records are
 * searchable today; no external directory is connected, so none is queried and
 * no supplier is ever invented.
 */
export interface SupplierDiscoveryProvider {
  readonly name: string;
  readonly configured: boolean;
  readonly note: string;
}
export const DISCOVERY_PROVIDERS: SupplierDiscoveryProvider[] = [
  {
    name: 'Your suppliers',
    configured: true,
    note: 'Suppliers added or imported by your organization.',
  },
  {
    name: 'External supplier directories',
    configured: false,
    note: 'No external/public supplier source is connected — results are never fabricated.',
  },
];

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CommercialCoreService,
    private readonly fin: FinanceCoreService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Supplier prices are commercially sensitive: only procurement/finance roles see them. */
  canSeePrices(a: Actor) {
    return (
      roleHasPermission(a.role, 'supplier_quotes.manage') ||
      roleHasPermission(a.role, 'supplier_payments.view')
    );
  }

  private async load(org: string, id: string) {
    const s = await this.prisma.supplier.findFirst({
      where: { id, organizationId: org },
      include: INCLUDE,
    });
    if (!s) throw new NotFoundException('Supplier not found.');
    return s;
  }

  // ---------------------------------------------------------------- duplicates

  async duplicates(
    org: string,
    d: {
      legalName?: string | null;
      gstin?: string | null;
      email?: string | null;
      phone?: string | null;
      city?: string | null;
      state?: string | null;
    },
    excludeId?: string,
  ): Promise<DuplicateCheck> {
    const out: DuplicateCheck = { exact: [], possible: [] };
    const not = excludeId ? { id: { not: excludeId } } : {};
    if (d.gstin)
      for (const s of await this.prisma.supplier.findMany({
        where: { organizationId: org, gstin: d.gstin.toUpperCase(), ...not },
        select: { id: true, legalName: true },
      }))
        out.exact.push({ ...s, reason: 'Same GSTIN' });
    if (d.email)
      for (const s of await this.prisma.supplier.findMany({
        where: {
          organizationId: org,
          email: { equals: d.email, mode: 'insensitive' },
          ...not,
        },
        select: { id: true, legalName: true },
      }))
        if (!out.exact.some((x) => x.id === s.id))
          out.exact.push({ ...s, reason: 'Same email' });
    const pk = phoneKey(d.phone);
    if (pk)
      for (const s of await this.prisma.supplier.findMany({
        where: { organizationId: org, phoneKey: pk, ...not },
        select: { id: true, legalName: true },
      }))
        if (!out.exact.some((x) => x.id === s.id))
          out.exact.push({ ...s, reason: 'Same phone' });
    if (d.legalName) {
      const n = normalizeName(d.legalName);
      for (const s of await this.prisma.supplier.findMany({
        where: { organizationId: org, normalizedName: n, ...not },
        select: { id: true, legalName: true, city: true, state: true },
      }))
        if (!out.exact.some((x) => x.id === s.id)) {
          const sameLoc =
            (!d.city ||
              !s.city ||
              s.city.toLowerCase() === d.city.toLowerCase()) &&
            (!d.state ||
              !s.state ||
              s.state.toLowerCase() === d.state.toLowerCase());
          if (sameLoc)
            out.possible.push({
              id: s.id,
              legalName: s.legalName,
              reason: 'Same normalized name and location',
            });
        }
    }
    return out;
  }

  // ---------------------------------------------------------------- create / update

  private productData(org: string, p: SupplierProductDto) {
    return {
      organizationId: org,
      productId: p.productId ?? null,
      productName: p.productName.trim(),
      hsCode: p.hsCode ?? null,
      specification: p.specification ?? null,
      moq: p.moq ? new D(p.moq) : null,
      moqUnit: p.moqUnit ?? null,
      capacity: p.capacity ? new D(p.capacity) : null,
      capacityUnit: p.capacityUnit ?? null,
      capacityPeriod: p.capacityPeriod ?? null,
      indicativePrice: p.indicativePrice ? new D(p.indicativePrice) : null,
      currency: p.currency ?? (p.indicativePrice ? 'INR' : null),
      priceUnit: p.priceUnit ?? null,
      leadTimeDays: p.leadTimeDays ?? null,
      packaging: p.packaging ?? null,
      originState: p.originState ?? null,
      notes: p.notes ?? null,
    };
  }

  private async assertProducts(org: string, products?: SupplierProductDto[]) {
    for (const p of products ?? [])
      if (
        p.productId &&
        !(await this.prisma.organizationProduct.findFirst({
          where: { id: p.productId, organizationId: org },
        }))
      )
        throw new NotFoundException('Product not found.');
  }

  async create(a: Actor, dto: SupplierDto) {
    const org = a.organizationId;
    if (!dto.legalName)
      throw new BadRequestException('Enter the supplier’s legal name.');
    const gstin = dto.gstin?.toUpperCase().trim() || null;
    if (gstin && !GSTIN_RE.test(gstin))
      throw new BadRequestException({
        message:
          'GSTIN format is invalid (format check only — not a verification).',
        details: { code: 'GSTIN_FORMAT' },
      });
    const dup = await this.duplicates(org, { ...dto, gstin });
    if (dup.exact.length)
      throw new ConflictException({
        message: `This supplier already exists (${dup.exact[0].reason.toLowerCase()}: ${dup.exact[0].legalName}).`,
        details: { code: 'DUPLICATE_SUPPLIER', duplicates: dup.exact },
      });
    if (dup.possible.length && !dto.acknowledgePossibleDuplicate)
      throw new ConflictException({
        message: `A similar supplier exists (${dup.possible[0].legalName}). Confirm to add anyway.`,
        details: {
          code: 'POSSIBLE_DUPLICATE_SUPPLIER',
          duplicates: dup.possible,
        },
      });
    await this.assertProducts(org, dto.products);
    let s;
    try {
      s = await this.prisma.supplier.create({
        data: {
          organizationId: org,
          legalName: dto.legalName.trim(),
          tradeName: dto.tradeName ?? null,
          normalizedName: normalizeName(dto.legalName),
          supplierType: dto.supplierType ?? null,
          state: dto.state ?? null,
          city: dto.city ?? null,
          address: dto.address ?? null,
          contactPerson: dto.contactPerson ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          phoneKey: phoneKey(dto.phone),
          website: dto.website ?? null,
          gstin,
          pan: dto.pan ?? null,
          notes: dto.notes ?? null,
          source: dto.source ?? 'USER_ADDED',
          verificationStatus: dto.verificationStatus ?? 'UNVERIFIED',
          createdByUserId: a.userId,
          products: {
            create: (dto.products ?? []).map((p) => this.productData(org, p)),
          },
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException({
          message: 'A supplier with this GSTIN already exists.',
          details: { code: 'DUPLICATE_SUPPLIER' },
        });
      throw e;
    }
    await this.event(
      a,
      s.id,
      'supplier.created',
      `Supplier ${s.legalName} added (${SOURCE_LABEL[s.source]})`,
    );
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'supplier.created',
      entityType: 'Supplier',
      entityId: s.id,
      metadata: { source: s.source },
    });
    return this.detail(a, s.id);
  }

  private event(a: Actor, id: string, type: string, title: string) {
    return this.prisma.commercialEvent.create({
      data: {
        organizationId: a.organizationId,
        entityType: 'SUPPLIER',
        entityId: id,
        lineageId: id,
        type,
        title,
        actorUserId: a.userId,
      },
    });
  }

  async update(a: Actor, id: string, dto: SupplierDto) {
    const s = await this.load(a.organizationId, id);
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== s.rowVersion
    )
      throw CommercialCoreService.conflict();
    const gstin =
      dto.gstin === undefined
        ? undefined
        : dto.gstin?.toUpperCase().trim() || null;
    if (gstin && !GSTIN_RE.test(gstin))
      throw new BadRequestException({
        message: 'GSTIN format is invalid.',
        details: { code: 'GSTIN_FORMAT' },
      });
    const dup = await this.duplicates(
      a.organizationId,
      {
        legalName: dto.legalName,
        gstin: gstin ?? undefined,
        email: dto.email,
        phone: dto.phone,
        city: dto.city ?? s.city,
        state: dto.state ?? s.state,
      },
      id,
    );
    if (dup.exact.length)
      throw new ConflictException({
        message: `Another supplier already has this ${dup.exact[0].reason.replace('Same ', '').toLowerCase()} (${dup.exact[0].legalName}).`,
        details: { code: 'DUPLICATE_SUPPLIER', duplicates: dup.exact },
      });
    await this.assertProducts(a.organizationId, dto.products);
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.supplier.updateMany({
        where: { id, rowVersion: s.rowVersion },
        data: {
          legalName: dto.legalName?.trim(),
          normalizedName: dto.legalName
            ? normalizeName(dto.legalName)
            : undefined,
          tradeName: dto.tradeName,
          supplierType: dto.supplierType,
          state: dto.state,
          city: dto.city,
          address: dto.address,
          contactPerson: dto.contactPerson,
          email: dto.email,
          phone: dto.phone,
          phoneKey: dto.phone === undefined ? undefined : phoneKey(dto.phone),
          website: dto.website,
          gstin,
          pan: dto.pan,
          notes: dto.notes,
          verificationStatus: dto.verificationStatus,
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) throw CommercialCoreService.conflict();
      if (dto.products) {
        const keep = dto.products
          .map((p) => p.id)
          .filter((x): x is string => !!x);
        await tx.supplierProduct.deleteMany({
          where: { supplierId: id, id: { notIn: keep } },
        });
        for (const p of dto.products) {
          if (p.id && s.products.some((x) => x.id === p.id))
            await tx.supplierProduct.update({
              where: { id: p.id },
              data: this.productData(a.organizationId, p),
            });
          else
            await tx.supplierProduct.create({
              data: {
                ...this.productData(a.organizationId, p),
                supplierId: id,
              },
            });
        }
      }
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'supplier.updated',
      entityType: 'Supplier',
      entityId: id,
      metadata: {
        fields: Object.keys(dto).filter((k) => k !== 'expectedRowVersion'),
      },
    });
    return this.detail(a, id);
  }

  // ---------------------------------------------------------------- certifications / attachments

  async addCertification(a: Actor, id: string, dto: CertificationDto) {
    await this.load(a.organizationId, id);
    if (dto.issueDate && dto.expiryDate && dto.expiryDate < dto.issueDate)
      throw new BadRequestException('Expiry must be after the issue date.');
    await this.prisma.supplierCertification.create({
      data: {
        organizationId: a.organizationId,
        supplierId: id,
        type: dto.type.trim(),
        number: dto.number ?? null,
        issuingBody: dto.issuingBody ?? null,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        verification: dto.verification ?? 'NOT_PROVIDED',
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'supplier.updated',
      entityType: 'Supplier',
      entityId: id,
      metadata: { certification: dto.type },
    });
    return this.detail(a, id);
  }

  async updateCertification(
    a: Actor,
    certId: string,
    dto: Partial<CertificationDto>,
  ) {
    const c = await this.prisma.supplierCertification.findFirst({
      where: { id: certId, organizationId: a.organizationId },
    });
    if (!c) throw new NotFoundException('Certification not found.');
    await this.prisma.supplierCertification.update({
      where: { id: certId },
      data: {
        type: dto.type,
        number: dto.number,
        issuingBody: dto.issuingBody,
        issueDate:
          dto.issueDate === undefined
            ? undefined
            : dto.issueDate
              ? new Date(dto.issueDate)
              : null,
        expiryDate:
          dto.expiryDate === undefined
            ? undefined
            : dto.expiryDate
              ? new Date(dto.expiryDate)
              : null,
        verification: dto.verification,
      },
    });
    return this.detail(a, c.supplierId);
  }

  /** Private file; uploading never changes any verification status. */
  async saveAttachment(
    a: Actor,
    entity: { supplierId: string | null; entityType: string; entityId: string },
    file: Express.Multer.File,
    category: string,
  ) {
    const { storageKey } = await this.storage.savePrivateFile(
      'supplier-attachments',
      file,
      INQUIRY_ATTACHMENT_EXTENSIONS,
      MAX_INQUIRY_ATTACHMENT_BYTES,
    );
    return this.prisma.supplierAttachment.create({
      data: {
        organizationId: a.organizationId,
        supplierId: entity.supplierId,
        entityType: entity.entityType,
        entityId: entity.entityId,
        category,
        storageKey,
        filename: file.originalname.slice(0, 200),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        createdByUserId: a.userId,
      },
    });
  }

  async attach(
    a: Actor,
    id: string,
    file: Express.Multer.File,
    meta: AttachmentMetaDto,
  ) {
    await this.load(a.organizationId, id);
    let entityType = 'SUPPLIER';
    let entityId = id;
    if (meta.certificationId) {
      const c = await this.prisma.supplierCertification.findFirst({
        where: {
          id: meta.certificationId,
          supplierId: id,
          organizationId: a.organizationId,
        },
      });
      if (!c) throw new NotFoundException('Certification not found.');
      entityType = 'CERTIFICATION';
      entityId = c.id;
    }
    const att = await this.saveAttachment(
      a,
      { supplierId: id, entityType, entityId },
      file,
      meta.category ?? 'OTHER',
    );
    if (meta.certificationId)
      await this.prisma.supplierCertification.updateMany({
        where: { id: meta.certificationId, verification: 'NOT_PROVIDED' },
        data: { attachmentId: att.id, verification: 'UPLOADED' },
      });
    return this.detail(a, id);
  }

  async download(a: Actor, attId: string) {
    const f = await this.prisma.supplierAttachment.findFirst({
      where: { id: attId, organizationId: a.organizationId },
    });
    if (!f) throw new NotFoundException('Attachment not found.');
    return {
      buffer: await this.storage.readPrivateFile(f.storageKey),
      filename: f.filename,
      mimeType: f.mimeType,
    };
  }

  attachmentView(
    x: Prisma.SupplierAttachmentGetPayload<object>,
  ): SupplierAttachmentView {
    return {
      id: x.id,
      category: x.category as SupplierAttachmentView['category'],
      filename: x.filename,
      sizeBytes: x.sizeBytes,
      entityType: x.entityType,
      entityId: x.entityId,
      createdAt: x.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------- shortlist

  async shortlist(a: Actor, id: string, dto: ShortlistDto) {
    await this.load(a.organizationId, id);
    const productKey = (dto.product ?? '').trim().toLowerCase();
    if (dto.remove)
      await this.prisma.supplierShortlist.deleteMany({
        where: { organizationId: a.organizationId, supplierId: id, productKey },
      });
    else
      await this.prisma.supplierShortlist.upsert({
        where: {
          organizationId_supplierId_productKey: {
            organizationId: a.organizationId,
            supplierId: id,
            productKey,
          },
        },
        create: {
          organizationId: a.organizationId,
          supplierId: id,
          productKey,
          createdByUserId: a.userId,
        },
        update: {},
      });
    return {
      supplierId: id,
      shortlisted: !dto.remove,
      product: productKey || null,
    };
  }

  // ---------------------------------------------------------------- performance (real history only)

  async performance(
    a: Actor,
    supplierId: string,
  ): Promise<SupplierPerformance> {
    const pos = await this.prisma.supplierPurchaseOrder.findMany({
      where: {
        organizationId: a.organizationId,
        supplierId,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
      },
      include: {
        items: true,
        receipts: {
          include: { inspections: true },
          orderBy: { receivedAt: 'asc' },
        },
      },
    });
    const received = pos.filter((p) => p.receipts.length);
    const onTime = received.filter(
      (p) =>
        p.originalExpectedDate &&
        p.receipts[p.receipts.length - 1].receivedAt <=
          new Date(p.originalExpectedDate.getTime() + 86399999),
    ).length;
    const leads = received
      .filter((p) => p.issuedAt)
      .map(
        (p) =>
          (p.receipts[0].receivedAt.getTime() - p.issuedAt!.getTime()) / 864e5,
      );
    const insp = pos.flatMap((p) => p.receipts.flatMap((r) => r.inspections));
    const sum = (k: 'acceptedQuantity' | 'rejectedQuantity') =>
      pos
        .flatMap((p) => p.items)
        .reduce((s, i) => s.plus(i[k].toString()), new D(0));
    const quotes = this.canSeePrices(a)
      ? await this.prisma.supplierQuote.findMany({
          where: {
            organizationId: a.organizationId,
            supplierId,
            review: 'CONFIRMED',
          },
          include: { rfq: { select: { rfqNumber: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    return {
      orders: pos.length,
      receipts: pos.reduce((s, p) => s + p.receipts.length, 0),
      onTimeRatePercent: received.length
        ? ((onTime / received.length) * 100).toFixed(1)
        : null,
      averageLeadTimeDays: leads.length
        ? (leads.reduce((s, x) => s + x, 0) / leads.length).toFixed(1)
        : null,
      acceptedQuantity: sum('acceptedQuantity').toString(),
      rejectedQuantity: sum('rejectedQuantity').toString(),
      qualityPassRatePercent: insp.length
        ? (
            (insp.filter((i) => i.status === 'PASSED' || i.status === 'WAIVED')
              .length /
              insp.length) *
            100
          ).toFixed(1)
        : null,
      inspections: insp.length,
      priceHistory: quotes.map((q) => ({
        date: isoDay(q.quoteDate ?? q.createdAt)!,
        unitPrice: q.unitPrice.toString(),
        currency: q.currency,
        unit: q.unit,
        reference: q.rfq.rfqNumber,
      })),
      basis:
        'Computed only from your recorded supplier POs, goods receipts, inspections and confirmed quotes — not a reputation rating.',
    };
  }

  // ---------------------------------------------------------------- views

  private certVerification(
    c: Row['certifications'][number],
  ): CertificationVerification {
    return c.verification as CertificationVerification;
  }

  private summary(
    a: Actor,
    s: Row,
    shortlisted: boolean,
    fit: SupplierSummary['fit'] = null,
  ): SupplierSummary {
    const prices = this.canSeePrices(a);
    return {
      id: s.id,
      legalName: s.legalName,
      tradeName: s.tradeName,
      supplierType: s.supplierType as SupplierType | null,
      state: s.state,
      city: s.city,
      products: s.products.map((p) => ({
        productName: p.productName,
        moq: qty(p.moq),
        moqUnit: p.moqUnit,
        capacity: qty(p.capacity),
        capacityUnit: p.capacityUnit,
        capacityPeriod: p.capacityPeriod,
        indicativePrice: prices ? qty(p.indicativePrice) : null,
        currency: p.currency,
        priceUnit: p.priceUnit,
        leadTimeDays: p.leadTimeDays,
      })),
      certifications: s.certifications.map((c) => ({
        type: c.type,
        verification: this.certVerification(c),
        expired: Boolean(c.expiryDate && c.expiryDate < new Date()),
      })),
      provenance: {
        source: s.source as SupplierSummary['provenance']['source'],
        sourceLabel: s.sourceLabel ?? SOURCE_LABEL[s.source] ?? s.source,
        verification:
          s.verificationStatus as SupplierSummary['provenance']['verification'],
        lastUpdatedAt: s.updatedAt.toISOString(),
        lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
        demo: s.isDemo,
      },
      shortlisted,
      fit,
    };
  }

  /** Discovery over organization records with combinable filters; deterministic fit when a requirement is given. */
  async search(a: Actor, q: SupplierSearchDto): Promise<SupplierSearchResult> {
    const org = a.organizationId;
    let productFilter = q.product?.trim();
    if (!productFilter && q.opportunityId) {
      const o = await this.prisma.opportunity.findFirst({
        where: { id: q.opportunityId },
        select: { productName: true },
      });
      productFilter = o?.productName.split(/[ ,(]/)[0];
    }
    if (!productFilter && q.productId)
      productFilter = (
        await this.prisma.organizationProduct.findFirst({
          where: { id: q.productId, organizationId: org },
          select: { displayName: true },
        })
      )?.displayName;
    const and: Prisma.SupplierWhereInput[] = [{ organizationId: org }];
    if (q.state) and.push({ state: { equals: q.state, mode: 'insensitive' } });
    if (q.supplierType) and.push({ supplierType: q.supplierType });
    if (productFilter)
      and.push({
        products: {
          some: {
            OR: [
              { productName: { contains: productFilter, mode: 'insensitive' } },
              ...(q.productId ? [{ productId: q.productId }] : []),
            ],
          },
        },
      });
    const certs = (q.certifications ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    for (const c of certs)
      and.push({
        certifications: {
          some: { type: { contains: c, mode: 'insensitive' } },
        },
      });
    const t = q.search?.trim();
    if (t)
      and.push({
        OR: [
          { legalName: { contains: t, mode: 'insensitive' } },
          { tradeName: { contains: t, mode: 'insensitive' } },
          { gstin: { equals: t.toUpperCase() } },
          { city: { contains: t, mode: 'insensitive' } },
          { state: { contains: t, mode: 'insensitive' } },
          {
            products: {
              some: { productName: { contains: t, mode: 'insensitive' } },
            },
          },
          {
            certifications: {
              some: { type: { contains: t, mode: 'insensitive' } },
            },
          },
        ],
      });
    const shortlist = await this.prisma.supplierShortlist.findMany({
      where: { organizationId: org },
      select: { supplierId: true, productKey: true },
    });
    if (q.shortlisted === 'true')
      and.push({ id: { in: shortlist.map((s) => s.supplierId) } });
    let rows = await this.prisma.supplier.findMany({
      where: { AND: and },
      include: INCLUDE,
      orderBy: { legalName: 'asc' },
    });
    // Numeric filters on the matching product line (unknown values never pass a numeric filter).
    const line = (s: Row) =>
      s.products.find(
        (p) =>
          !productFilter ||
          p.productName.toLowerCase().includes(productFilter.toLowerCase()) ||
          p.productId === q.productId,
      ) ?? null;
    if (q.maxMoq)
      rows = rows.filter((s) => {
        const p = line(s);
        const m =
          p &&
          sameMeasure(
            p.moq ? new D(p.moq.toString()) : null,
            p.moqUnit,
            new D(q.maxMoq!),
            q.moqUnit ?? p.moqUnit,
          );
        return Boolean(m && m[0].lte(m[1]));
      });
    if (q.minCapacity)
      rows = rows.filter((s) => {
        const p = line(s);
        const c = p
          ? monthlyCapacity(
              p.capacity ? new D(p.capacity.toString()) : null,
              p.capacityPeriod,
            )
          : null;
        const m =
          p &&
          sameMeasure(
            c,
            p.capacityUnit,
            new D(q.minCapacity!),
            q.unit ?? p.capacityUnit,
          );
        return Boolean(m && m[0].gte(m[1]));
      });
    if (q.maxLeadTimeDays !== undefined)
      rows = rows.filter((s) => {
        const p = line(s);
        return (
          p?.leadTimeDays !== null &&
          p?.leadTimeDays !== undefined &&
          p.leadTimeDays <= q.maxLeadTimeDays!
        );
      });
    if (q.maxPrice) {
      const cur = q.priceCurrency ?? 'INR';
      const kept: Row[] = [];
      for (const s of rows) {
        const p = line(s);
        if (!p?.indicativePrice || !p.currency) continue;
        const fx = await this.fin.latestRate(org, p.currency, cur);
        if (
          fx &&
          new D(p.indicativePrice.toString()).mul(fx.rate).lte(q.maxPrice)
        )
          kept.push(s);
      }
      rows = kept;
    }
    // Deterministic fit (requirement-aware) — price relative to the cheapest comparable line.
    const reqQty = q.quantity ? new D(q.quantity) : null;
    const prices: { id: string; inr: Dec | null }[] = [];
    for (const s of rows) {
      const p = line(s);
      const fx =
        p?.indicativePrice && p.currency
          ? await this.fin.latestRate(org, p.currency, 'INR')
          : null;
      prices.push({
        id: s.id,
        inr:
          p?.indicativePrice && fx
            ? new D(p.indicativePrice.toString()).mul(fx.rate)
            : null,
      });
    }
    const best =
      prices
        .map((x) => x.inr)
        .filter((x): x is Dec => !!x)
        .sort((x, y) => x.cmp(y))[0] ?? null;
    const bestLead =
      rows
        .map((s) => line(s)?.leadTimeDays)
        .filter((x): x is number => typeof x === 'number')
        .sort((x, y) => x - y)[0] ?? null;
    const fits = new Map<string, SupplierSummary['fit']>();
    if (productFilter || reqQty || certs.length) {
      for (const s of rows) {
        const p = line(s);
        const moqM =
          p && reqQty
            ? sameMeasure(
                p.moq ? new D(p.moq.toString()) : null,
                p.moqUnit,
                reqQty,
                q.unit ?? p.moqUnit,
              )
            : null;
        const capM =
          p && reqQty
            ? sameMeasure(
                monthlyCapacity(
                  p.capacity ? new D(p.capacity.toString()) : null,
                  p.capacityPeriod,
                ),
                p.capacityUnit,
                reqQty,
                q.unit ?? p.capacityUnit,
              )
            : null;
        const perf = await this.performance(a, s.id);
        fits.set(
          s.id,
          scoreFit({
            ...(this.canSeePrices(a)
              ? {
                  price: {
                    value: prices.find((x) => x.id === s.id)?.inr ?? null,
                    best,
                  },
                }
              : {}),
            leadTimeDays: {
              value: p?.leadTimeDays ?? null,
              requiredDays: q.maxLeadTimeDays ?? null,
              best: bestLead,
            },
            moq: { fit: moqM ? moqM[0].lte(moqM[1]) : null },
            capacity: { fit: capM ? capM[0].gte(capM[1]) : null },
            certifications: {
              required: certs,
              have: s.certifications.map((c) => c.type),
            },
            quality: {
              passRate: perf.qualityPassRatePercent
                ? Number(perf.qualityPassRatePercent)
                : null,
              inspections: perf.inspections,
            },
            delivery: {
              onTimeRate: perf.onTimeRatePercent
                ? Number(perf.onTimeRatePercent)
                : null,
              receipts: perf.receipts,
            },
          }),
        );
      }
      rows.sort(
        (x, y) => (fits.get(y.id)?.score ?? 0) - (fits.get(x.id)?.score ?? 0),
      );
    }
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const pk = (productFilter ?? '').toLowerCase();
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((s) =>
        this.summary(
          a,
          s,
          shortlist.some(
            (x) =>
              x.supplierId === s.id &&
              (x.productKey === '' || x.productKey === pk),
          ),
          fits.get(s.id) ?? null,
        ),
      ),
      meta: {
        page,
        pageSize,
        totalItems: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      },
      sources: DISCOVERY_PROVIDERS.map((p) => ({
        name: p.name,
        status: p.configured ? 'OK' : 'NOT_CONFIGURED',
        note: p.note,
      })),
    };
  }

  async detail(a: Actor, id: string): Promise<SupplierDetail> {
    const org = a.organizationId;
    const s = await this.load(org, id);
    const prices = this.canSeePrices(a);
    const [atts, recips, quotes, pos, shortlist, events, perf, dup] =
      await Promise.all([
        this.prisma.supplierAttachment.findMany({
          where: { organizationId: org, supplierId: id },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.supplierRfqRecipient.findMany({
          where: { organizationId: org, supplierId: id },
          include: { rfq: true },
        }),
        this.prisma.supplierQuote.findMany({
          where: { organizationId: org, supplierId: id },
          include: { rfq: { select: { rfqNumber: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.supplierPurchaseOrder.findMany({
          where: { organizationId: org, supplierId: id },
          include: {
            receipts: { include: { inspections: true } },
            payable: { include: { payments: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.supplierShortlist.findFirst({
          where: { organizationId: org, supplierId: id },
        }),
        this.prisma.commercialEvent.findMany({
          where: { organizationId: org, lineageId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.performance(a, id),
        this.duplicates(
          org,
          {
            legalName: s.legalName,
            gstin: s.gstin,
            email: s.email,
            phone: s.phone,
            city: s.city,
            state: s.state,
          },
          id,
        ),
      ]);
    const names = await this.core.userNames(events.map((e) => e.actorUserId));
    const can = (p: Parameters<typeof roleHasPermission>[1]) =>
      roleHasPermission(a.role, p);
    return {
      ...this.summary(a, s, Boolean(shortlist)),
      rowVersion: s.rowVersion,
      address: s.address,
      contactPerson: s.contactPerson,
      email: s.email,
      phone: s.phone,
      website: s.website,
      gstin: s.gstin,
      pan: s.pan,
      notes: s.notes,
      productRows: s.products.map((p) => ({
        id: p.id,
        productId: p.productId,
        productName: p.productName,
        hsCode: p.hsCode,
        specification: p.specification,
        moq: qty(p.moq),
        moqUnit: p.moqUnit,
        capacity: qty(p.capacity),
        capacityUnit: p.capacityUnit,
        capacityPeriod: p.capacityPeriod,
        indicativePrice: prices ? qty(p.indicativePrice) : null,
        currency: p.currency,
        priceUnit: p.priceUnit,
        leadTimeDays: p.leadTimeDays,
        packaging: p.packaging,
        originState: p.originState,
        notes: p.notes,
        updatedAt: p.updatedAt.toISOString(),
      })),
      certificationRows: s.certifications.map((c) => {
        const att = atts.find((x) => x.id === c.attachmentId);
        return {
          id: c.id,
          type: c.type,
          number: c.number,
          issuingBody: c.issuingBody,
          issueDate: isoDay(c.issueDate),
          expiryDate: isoDay(c.expiryDate),
          expired: Boolean(c.expiryDate && c.expiryDate < new Date()),
          verification: this.certVerification(c),
          attachment: att ? { id: att.id, filename: att.filename } : null,
        };
      }),
      attachments: atts.map((x) => this.attachmentView(x)),
      rfqs: recips.map((r) => ({
        id: r.rfq.id,
        rfqNumber: r.rfq.rfqNumber,
        productName: r.rfq.productName,
        status: r.rfq.status as never,
        recipientStatus: r.status,
      })),
      quotes: quotes.map((q) => ({
        id: q.id,
        rfqId: q.rfqId,
        rfqNumber: q.rfq.rfqNumber,
        unitPrice: prices ? q.unitPrice.toString() : null,
        currency: q.currency,
        unit: q.unit,
        leadTimeDays: q.leadTimeDays,
        review: q.review as never,
        status: q.status as never,
        quoteDate: isoDay(q.quoteDate),
      })),
      purchaseOrders: pos.map((p) => ({
        id: p.id,
        spoNumber: p.spoNumber,
        status: p.status as never,
        procurementStatus: p.procurementStatus as never,
        total: prices ? (p.totalAmount?.toFixed(2) ?? null) : null,
        currency: p.currency,
        expectedDate: isoDay(p.expectedDate),
      })),
      qualityHistory: pos.flatMap((p) =>
        p.receipts.flatMap((r) =>
          r.inspections.map((i) => ({
            inspectionId: i.id,
            grnNumber: r.grnNumber,
            status: i.status as never,
            accepted: i.acceptedQuantity.toString(),
            rejected: i.rejectedQuantity.toString(),
            at: i.inspectedAt.toISOString(),
          })),
        ),
      ),
      payments: can('supplier_payments.view')
        ? pos.flatMap((p) =>
            (p.payable?.payments ?? []).map((x) => ({
              id: x.id,
              spoNumber: p.spoNumber,
              amount: x.amount.toFixed(2),
              currency: x.currency,
              paidAt: x.paidAt.toISOString(),
              status: x.status,
            })),
          )
        : [],
      performance: perf,
      activity: events.map((e) => ({
        id: e.id,
        title: e.title,
        actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
        createdAt: e.createdAt.toISOString(),
      })),
      duplicates: [
        ...dup.exact.map((d) => ({ ...d, exact: true })),
        ...dup.possible.map((d) => ({ ...d, exact: false })),
      ],
      availableActions: [
        ...(can('suppliers.manage')
          ? ['edit', 'certifications', 'attach', 'shortlist']
          : []),
        ...(can('supplier_rfq.manage') ? ['create_rfq'] : []),
      ],
    };
  }

  async list(a: Actor, q: SupplierSearchDto) {
    return this.search(a, q);
  }
}
