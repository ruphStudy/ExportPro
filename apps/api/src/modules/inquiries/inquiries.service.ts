import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MembershipRole, Prisma } from '@prisma/client';
import {
  type BuyerInquiryDetail,
  type InquiryClarificationQuestion,
  type ConfirmedItem,
  type ConfirmedRfq,
  type ExtractedRfq,
  type InquiryExtraction,
  type InquiryListResponse,
  type InquirySummary,
  isValidCountryCode,
  type QualificationChecklist,
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
import { buyerMatch } from '../buyers/buyer-scoring';
import { ground, sanitizeExtraction } from './extraction/extraction-schema';
import {
  ExtractionProviderError,
  INQUIRY_EXTRACTION_PROVIDER,
  type InquiryExtractionProvider,
} from './extraction/extraction-provider';
import {
  clarificationDraft,
  cleanText,
  crmStageSuggestion,
  htmlToText,
  looksLikeHtml,
  missingFields,
  qualificationFacts,
  subjectSimilarity,
  suggestPriority,
  suggestQuestions,
} from './inquiry-rules';
import type {
  ApprovalDto,
  ClarifyDto,
  ConfirmRfqDto,
  CreateInquiryDto,
  InquiryListQueryDto,
  QualifyDto,
  RejectDto,
  UpdateInquiryDto,
  UploadInquiryDto,
} from './inquiries.dto';

export interface Actor {
  organizationId: string;
  userId: string;
  role: MembershipRole;
}

type Tx = Prisma.TransactionClient;
const TEXT_MIME = new Set(['text/plain', 'text/csv', 'message/rfc822']);
const detailInclude = {
  attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  extractions: { orderBy: { version: 'desc' } },
  items: { orderBy: { sortOrder: 'asc' } },
  activities: { orderBy: { createdAt: 'desc' }, take: 100 },
  approvals: { orderBy: { createdAt: 'asc' } },
  quotationRequest: true,
  sampleRequest: true,
  buyerCompany: { include: { activities: true } },
  crmLead: true,
} satisfies Prisma.BuyerInquiryInclude;
type InquiryRow = Prisma.BuyerInquiryGetPayload<{
  include: typeof detailInclude;
}>;

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toString());

interface CreateInternal {
  source: 'EMAIL_REPLY' | 'MANUAL' | 'RFQ_UPLOAD' | 'CRM' | 'OTHER';
  sourceKey?: string | null;
  sourceMessageId?: string | null;
  buyerCompanyId?: string | null;
  buyerName?: string | null;
  contactEmail?: string | null;
  contactName?: string | null;
  crmLeadId?: string | null;
  productId?: string | null;
  countryCode?: string | null;
  subject: string;
  body: string;
  receivedAt?: Date;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  requireBuyer: boolean;
}

@Injectable()
export class InquiriesService {
  private readonly logger = new Logger(InquiriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(INQUIRY_EXTRACTION_PROVIDER)
    private readonly extractor: InquiryExtractionProvider,
  ) {}

  // =============================================================== helpers

  private async load(organizationId: string, id: string): Promise<InquiryRow> {
    const i = await this.prisma.buyerInquiry.findFirst({
      where: { id, organizationId },
      include: detailInclude,
    });
    if (!i) throw new NotFoundException('Inquiry not found.');
    return i;
  }

  /** Optimistic concurrency on workflow changes. */
  private async touch(
    tx: Tx,
    i: { id: string; organizationId: string },
    expected: number | undefined,
    data: Prisma.BuyerInquiryUncheckedUpdateManyInput = {},
  ) {
    const r = await tx.buyerInquiry.updateMany({
      where: {
        id: i.id,
        organizationId: i.organizationId,
        ...(expected !== undefined ? { rowVersion: expected } : {}),
      },
      data: { ...data, rowVersion: { increment: 1 } },
    });
    if (!r.count)
      throw new ConflictException(
        'This inquiry was changed by someone else. Reload and try again.',
      );
  }

  private activity(
    tx: Tx | PrismaService,
    i: { id: string; organizationId: string },
    type: string,
    title: string,
    actorUserId: string | null,
    metadata?: Record<string, unknown>,
  ) {
    return tx.inquiryActivity.create({
      data: {
        organizationId: i.organizationId,
        inquiryId: i.id,
        type,
        title,
        actorUserId,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /** Reference-only CRM timeline entry (RFQ data is not copied). Never changes the stage. */
  private async crmActivity(
    tx: Tx,
    i: {
      organizationId: string;
      crmLeadId: string | null;
      id: string;
      reference: string;
    },
    title: string,
    actorUserId: string | null,
    inbound = false,
  ) {
    if (!i.crmLeadId) return;
    const lead = await tx.buyerLead.findFirst({
      where: { id: i.crmLeadId, organizationId: i.organizationId },
      select: { id: true, lastActivityAt: true },
    });
    if (!lead) return;
    const now = new Date();
    await tx.leadActivity.create({
      data: {
        organizationId: i.organizationId,
        leadId: lead.id,
        type: inbound ? 'OTHER' : 'SYSTEM',
        direction: inbound ? 'INBOUND' : null,
        title,
        occurredAt: now,
        actorUserId,
        metadata: { inquiryId: i.id, reference: i.reference },
      },
    });
    if (inbound && now > lead.lastActivityAt)
      await tx.buyerLead.update({
        where: { id: lead.id },
        data: { lastActivityAt: now },
      });
  }

  private async buyerVisible(organizationId: string, buyerCompanyId: string) {
    const b = await this.prisma.buyerCompany.findFirst({
      where: {
        id: buyerCompanyId,
        OR: [
          { ownerOrganizationId: null },
          { ownerOrganizationId: organizationId },
        ],
      },
    });
    if (!b) throw new NotFoundException('Buyer not found.');
    return b;
  }

  private async leadOf(organizationId: string, leadId: string) {
    const l = await this.prisma.buyerLead.findFirst({
      where: { id: leadId, organizationId },
    });
    if (!l) throw new NotFoundException('CRM lead not found.');
    return l;
  }

  private async productOf(organizationId: string, productId: string) {
    const p = await this.prisma.organizationProduct.findFirst({
      where: { id: productId, organizationId },
      select: {
        id: true,
        displayName: true,
        hsCode: true,
        itcHsCode: true,
        categoryCode: true,
      },
    });
    if (!p) throw new NotFoundException('Product not found.');
    return p;
  }

  private async userNames(ids: (string | null | undefined)[]) {
    const u = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    const rows = u.length
      ? await this.prisma.user.findMany({
          where: { id: { in: u } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    return new Map(
      rows.map((r) => [r.id, `${r.firstName} ${r.lastName}`.trim()]),
    );
  }

  private can(
    role: MembershipRole,
    p: Parameters<typeof roleHasPermission>[1],
  ) {
    return roleHasPermission(role, p);
  }

  // ================================================================ create

  /** Shared by manual entry, RFQ upload and outreach-reply intake. */
  async createInternal(
    organizationId: string,
    actorUserId: string | null,
    d: CreateInternal,
  ) {
    if (d.countryCode && !isValidCountryCode(d.countryCode))
      throw new BadRequestException('Unsupported country.');
    let buyerCompanyId = d.buyerCompanyId ?? null;
    let leadStage: string | null = null;
    if (d.crmLeadId) {
      const l = await this.leadOf(organizationId, d.crmLeadId);
      if (buyerCompanyId && l.buyerCompanyId !== buyerCompanyId)
        throw new BadRequestException(
          'The CRM lead belongs to a different buyer.',
        );
      buyerCompanyId = l.buyerCompanyId;
      leadStage = l.stage;
    }
    const buyer = buyerCompanyId
      ? await this.buyerVisible(organizationId, buyerCompanyId)
      : null;
    const buyerName = buyer?.canonicalName ?? cleanText(d.buyerName, 160);
    if (d.requireBuyer && !buyerName)
      throw new BadRequestException(
        'Select a buyer or enter the buyer company name.',
      );
    if (d.productId) await this.productOf(organizationId, d.productId);
    const html = looksLikeHtml(d.body);
    const body = (html ? htmlToText(d.body) : cleanText(d.body, 100_000)) ?? '';
    if (!body) throw new BadRequestException('The inquiry message is empty.');
    const subject = cleanText(d.subject, 300) ?? '(no subject)';
    const pr = suggestPriority({
      text: `${subject}\n${body}`,
      source: d.source,
      leadStage,
      items: [],
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const n =
        (await this.prisma.buyerInquiry.count({ where: { organizationId } })) +
        1 +
        attempt;
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const i = await tx.buyerInquiry.create({
            data: {
              organizationId,
              reference: `INQ-${String(n).padStart(4, '0')}`,
              source: d.source,
              sourceKey: d.sourceKey ?? null,
              sourceMessageId: d.sourceMessageId ?? null,
              buyerCompanyId,
              buyerName: buyer ? null : buyerName,
              contactEmail: cleanText(d.contactEmail, 254),
              contactName: cleanText(d.contactName, 120),
              crmLeadId: d.crmLeadId ?? null,
              productId: d.productId ?? null,
              countryCode: d.countryCode ?? buyer?.countryCode ?? null,
              subject,
              body,
              rawBody: html ? d.body.slice(0, 200_000) : null,
              bodyWasHtml: html,
              receivedAt: d.receivedAt ?? new Date(),
              priority: d.priority ?? 'MEDIUM',
              suggestedPriority: pr.priority,
              priorityReasons: pr.reasons,
              createdByUserId: actorUserId,
            },
          });
          const label = {
            EMAIL_REPLY: 'from a buyer reply to outreach',
            MANUAL: 'entered manually',
            RFQ_UPLOAD: 'from an uploaded RFQ document',
            CRM: 'from a CRM lead',
            OTHER: 'recorded',
          }[d.source];
          await this.activity(
            tx,
            i,
            'RECEIVED',
            `Inquiry received — ${label}`,
            actorUserId,
            { source: d.source, sourceMessageId: d.sourceMessageId ?? null },
          );
          // Outreach already logs the reply as an inbound email; avoid double-counting it.
          await this.crmActivity(
            tx,
            i,
            `Buyer inquiry ${i.reference}: ${subject}`,
            actorUserId,
            d.source !== 'EMAIL_REPLY',
          );
          return i;
        });
        await this.audit.record({
          organizationId,
          actorId: actorUserId,
          action: 'inquiry.created',
          entityType: 'BuyerInquiry',
          entityId: created.id,
          metadata: { source: d.source, reference: created.reference },
        });
        return created;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          const target = String((e.meta as { target?: unknown })?.target ?? '');
          if (d.sourceKey && target.includes('sourceKey')) {
            const existing = await this.prisma.buyerInquiry.findFirst({
              where: { organizationId, sourceKey: d.sourceKey },
            });
            if (existing) return existing;
          }
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException(
      'Could not allocate an inquiry reference. Try again.',
    );
  }

  async create(a: Actor, dto: CreateInquiryDto) {
    const i = await this.createInternal(a.organizationId, a.userId, {
      ...dto,
      source: dto.source ?? (dto.crmLeadId ? 'CRM' : 'MANUAL'),
      receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : undefined,
      requireBuyer: true,
    });
    return this.detail(a, i.id, false);
  }

  private async checksumOwner(organizationId: string, checksum: string) {
    return this.prisma.inquiryAttachment.findFirst({
      where: { organizationId, checksum, deletedAt: null },
      select: { inquiryId: true, inquiry: { select: { reference: true } } },
    });
  }

  private async storeAttachment(
    tx: Tx,
    a: Actor,
    inquiry: { id: string; organizationId: string },
    file: Express.Multer.File,
    checksum: string,
  ) {
    const { storageKey } = await this.storage.savePrivateFile(
      'inquiry-attachments',
      file,
      INQUIRY_ATTACHMENT_EXTENSIONS,
      MAX_INQUIRY_ATTACHMENT_BYTES,
    );
    const text = TEXT_MIME.has(file.mimetype)
      ? cleanText(file.buffer.toString('utf8'), 100_000)
      : null;
    const filename = cleanText(file.originalname, 200) ?? 'attachment';
    const att = await tx.inquiryAttachment.create({
      data: {
        organizationId: a.organizationId,
        inquiryId: inquiry.id,
        originalFilename: filename,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksum,
        extractedText: text,
        uploadedByUserId: a.userId,
      },
    });
    await this.activity(
      tx,
      inquiry,
      'ATTACHMENT_ADDED',
      `Attachment added: ${filename}`,
      a.userId,
      { attachmentId: att.id },
    );
    return att;
  }

  /** Upload RFQ → new inquiry. The same file (by SHA-256) cannot be imported twice in an organization. */
  async upload(a: Actor, dto: UploadInquiryDto, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose an RFQ file to upload.');
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const dup = await this.checksumOwner(a.organizationId, checksum);
    if (dup)
      throw new ConflictException({
        message: `This file was already uploaded to ${dup.inquiry.reference}.`,
        details: { existingInquiryId: dup.inquiryId },
      });
    const name = cleanText(file.originalname, 200) ?? 'RFQ';
    const i = await this.createInternal(a.organizationId, a.userId, {
      source: 'RFQ_UPLOAD',
      buyerCompanyId: dto.buyerCompanyId,
      buyerName: dto.buyerName,
      crmLeadId: dto.crmLeadId,
      subject: dto.subject?.trim() || `RFQ: ${name}`,
      body: dto.message?.trim() || `RFQ document uploaded: ${name}`,
      requireBuyer: false,
    });
    await this.prisma.$transaction((tx) =>
      this.storeAttachment(tx, a, i, file, checksum),
    );
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.attachment_added',
      entityType: 'BuyerInquiry',
      entityId: i.id,
      metadata: { mimeType: file.mimetype, sizeBytes: file.size },
    });
    return this.detail(a, i.id, false);
  }

  async addAttachment(a: Actor, id: string, file: Express.Multer.File) {
    const i = await this.load(a.organizationId, id);
    if (!file) throw new BadRequestException('Choose a file to upload.');
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const dup = await this.checksumOwner(a.organizationId, checksum);
    if (dup)
      throw new ConflictException({
        message:
          dup.inquiryId === id
            ? 'This file is already attached.'
            : `This file was already uploaded to ${dup.inquiry.reference}.`,
        details: { existingInquiryId: dup.inquiryId },
      });
    await this.prisma.$transaction(async (tx) => {
      await this.storeAttachment(tx, a, i, file, checksum);
      await this.touch(tx, i, undefined);
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.attachment_added',
      entityType: 'BuyerInquiry',
      entityId: id,
      metadata: { mimeType: file.mimetype, sizeBytes: file.size },
    });
    return this.detail(a, id, false);
  }

  async readAttachment(
    organizationId: string,
    id: string,
    attachmentId: string,
  ) {
    const att = await this.prisma.inquiryAttachment.findFirst({
      where: {
        id: attachmentId,
        inquiryId: id,
        organizationId,
        deletedAt: null,
      },
    });
    if (!att) throw new NotFoundException('Attachment not found.');
    const buffer = await this.storage
      .readPrivateFile(att.storageKey)
      .catch(() => {
        throw new NotFoundException('The file is no longer available.');
      });
    return { buffer, filename: att.originalFilename, mimeType: att.mimeType };
  }

  async deleteAttachment(a: Actor, id: string, attachmentId: string) {
    const att = await this.prisma.inquiryAttachment.findFirst({
      where: {
        id: attachmentId,
        inquiryId: id,
        organizationId: a.organizationId,
        deletedAt: null,
      },
    });
    if (!att) throw new NotFoundException('Attachment not found.');
    if (
      att.uploadedByUserId !== a.userId &&
      !this.can(a.role, 'inquiries.approve')
    )
      throw new ForbiddenException(
        'Only the uploader or a manager can remove this attachment.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.inquiryAttachment.update({
        where: { id: att.id },
        data: { deletedAt: new Date() },
      });
      await this.activity(
        tx,
        { id, organizationId: a.organizationId },
        'ATTACHMENT_REMOVED',
        `Attachment removed: ${att.originalFilename}`,
        a.userId,
        { attachmentId: att.id },
      );
    });
    return this.detail(a, id, false);
  }

  // ================================================================== list

  async list(a: Actor, q: InquiryListQueryDto): Promise<InquiryListResponse> {
    const base: Prisma.BuyerInquiryWhereInput = {
      organizationId: a.organizationId,
    };
    const and: Prisma.BuyerInquiryWhereInput[] = [];
    const tab = q.type === 'rfq' ? 'rfq' : (q.tab ?? 'all');
    if (tab === 'archived') and.push({ status: 'ARCHIVED' });
    else {
      if (!q.status) and.push({ status: { not: 'ARCHIVED' } });
      if (tab === 'unread') and.push({ unread: true });
      if (tab === 'needs_review')
        and.push({
          OR: [
            { status: { in: ['NEW', 'REVIEWING'] } },
            { extractionStatus: 'NEEDS_REVIEW' },
          ],
        });
      if (tab === 'qualified') and.push({ status: 'QUALIFIED' });
      if (tab === 'needs_clarification')
        and.push({ status: 'NEEDS_CLARIFICATION' });
      if (tab === 'rfq')
        and.push({ OR: [{ source: 'RFQ_UPLOAD' }, { isRfq: true }] });
    }
    if (q.status) and.push({ status: q.status });
    if (q.priority) and.push({ priority: q.priority });
    if (q.assignedTo)
      and.push({
        assignedToUserId:
          q.assignedTo === 'me'
            ? a.userId
            : q.assignedTo === 'unassigned'
              ? null
              : q.assignedTo,
      });
    if (q.buyerCompanyId) and.push({ buyerCompanyId: q.buyerCompanyId });
    if (q.crmLeadId) and.push({ crmLeadId: q.crmLeadId });
    if (q.productId)
      and.push({
        OR: [
          { productId: q.productId },
          { items: { some: { productId: q.productId } } },
        ],
      });
    if (q.country) and.push({ countryCode: q.country });
    if (q.unread !== undefined) and.push({ unread: q.unread });
    if (q.source) and.push({ source: q.source });
    if (q.from || q.to)
      and.push({
        receivedAt: {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to ? { lte: new Date(q.to) } : {}),
        },
      });
    const s = q.search?.trim();
    if (s) {
      const c = { contains: s, mode: 'insensitive' as const };
      and.push({
        OR: [
          { reference: c },
          { subject: c },
          { body: c },
          { buyerName: c },
          { buyerCompany: { canonicalName: c } },
          { items: { some: { productName: c } } },
        ],
      });
    }
    const where = { ...base, AND: and };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const active = {
      organizationId: a.organizationId,
      status: { not: 'ARCHIVED' as const },
    };
    const [total, rows, unread, needsReview, qualified, needsClarification] =
      await Promise.all([
        this.prisma.buyerInquiry.count({ where }),
        this.prisma.buyerInquiry.findMany({
          where,
          include: {
            buyerCompany: {
              select: { canonicalName: true, countryCode: true, isDemo: true },
            },
            items: {
              select: { productName: true },
              orderBy: { sortOrder: 'asc' },
            },
            _count: { select: { attachments: { where: { deletedAt: null } } } },
          },
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.buyerInquiry.count({ where: { ...active, unread: true } }),
        this.prisma.buyerInquiry.count({
          where: {
            ...active,
            OR: [
              { status: { in: ['NEW', 'REVIEWING'] } },
              { extractionStatus: 'NEEDS_REVIEW' },
            ],
          },
        }),
        this.prisma.buyerInquiry.count({
          where: { ...active, status: 'QUALIFIED' },
        }),
        this.prisma.buyerInquiry.count({
          where: { ...active, status: 'NEEDS_CLARIFICATION' },
        }),
      ]);
    const names = await this.userNames(rows.map((r) => r.assignedToUserId));
    return {
      items: rows.map((r) =>
        this.summary(
          r,
          r.buyerCompany,
          r.items.map((x) => x.productName),
          r._count.attachments,
          names,
        ),
      ),
      meta: buildPaginationMeta(page, pageSize, total),
      counts: { unread, needsReview, qualified, needsClarification },
    };
  }

  private summary(
    r: Prisma.BuyerInquiryGetPayload<object>,
    buyer: {
      canonicalName: string;
      countryCode: string;
      isDemo: boolean;
    } | null,
    products: string[],
    attachmentCount: number,
    names: Map<string, string>,
  ): InquirySummary {
    return {
      id: r.id,
      reference: r.reference,
      subject: r.subject,
      snippet: r.body.slice(0, 160),
      source: r.source,
      status: r.status,
      priority: r.priority,
      suggestedPriority: r.suggestedPriority,
      unread: r.unread,
      receivedAt: r.receivedAt.toISOString(),
      buyer: {
        id: r.buyerCompanyId,
        name: buyer?.canonicalName ?? r.buyerName ?? 'Buyer not identified',
        countryCode: buyer?.countryCode ?? null,
        demo: Boolean(buyer?.isDemo),
      },
      products,
      countryCode: r.countryCode,
      owner: r.assignedToUserId
        ? {
            id: r.assignedToUserId,
            name: names.get(r.assignedToUserId) ?? 'Member',
          }
        : null,
      attachmentCount,
      extractionStatus: r.extractionStatus,
      approvalStatus: r.approvalStatus,
      isRfq: r.isRfq || r.source === 'RFQ_UPLOAD',
      crmLeadId: r.crmLeadId,
    };
  }

  // ================================================================ detail

  private confirmedOf(i: InquiryRow): ConfirmedRfq | null {
    if (!i.confirmedRfq) return null;
    const c = i.confirmedRfq as unknown as Omit<ConfirmedRfq, 'items'>;
    return { ...c, items: i.items.map((x) => this.itemView(x)) };
  }

  private itemView(x: InquiryRow['items'][number]): ConfirmedItem {
    return {
      id: x.id,
      productName: x.productName,
      productId: x.productId,
      hsCode: x.hsCode,
      quantity: dec(x.quantity),
      quantityUnit: x.quantityUnit,
      quantityText: x.quantityText,
      specification: x.specification,
      packaging: x.packaging,
      targetPrice: dec(x.targetPrice),
      priceCurrency: x.priceCurrency,
      priceUnitBasis: x.priceUnitBasis,
      priceIndicative: x.priceIndicative,
      deliveryDate: x.deliveryDate,
    };
  }

  private extractionView(
    e: InquiryRow['extractions'][number],
    names: Map<string, string>,
  ): InquiryExtraction {
    return {
      id: e.id,
      version: e.version,
      status: e.status as 'COMPLETED' | 'FAILED',
      provider: e.provider,
      model: e.model,
      promptVersion: e.promptVersion,
      provenance: e.provenance as 'AI_DERIVED' | 'DEVELOPMENT_DEMO',
      generatedAt: e.createdAt.toISOString(),
      overallConfidence: e.overallConfidence,
      data: (e.data as unknown as ExtractedRfq | null) ?? null,
      invalidFields: e.invalidFields,
      error: e.error,
      attachmentsUsed: e.attachmentsUsed,
      attachmentsSkipped:
        (e.attachmentsSkipped as
          { filename: string; reason: string }[] | null) ?? [],
      createdBy: e.createdByUserId
        ? (names.get(e.createdByUserId) ?? null)
        : null,
    };
  }

  async detail(
    a: Actor,
    id: string,
    markRead = true,
  ): Promise<BuyerInquiryDetail> {
    let i = await this.load(a.organizationId, id);
    if (markRead && i.unread) {
      await this.prisma.buyerInquiry.update({
        where: { id },
        data: { unread: false },
      });
      await this.activity(this.prisma, i, 'OPENED', 'Opened', a.userId);
      i = await this.load(a.organizationId, id);
    }
    const names = await this.userNames([
      i.assignedToUserId,
      i.createdByUserId,
      i.confirmedByUserId,
      i.rejectedByUserId,
      ...i.activities.map((x) => x.actorUserId),
      ...i.approvals.map((x) => x.actorUserId),
      ...i.extractions.map((x) => x.createdByUserId),
      i.quotationRequest?.requestedByUserId,
      i.sampleRequest?.requestedByUserId,
      i.crmLead?.ownerUserId,
      i.reviewDraftByUserId,
      (i.qualification as unknown as { decidedBy?: string } | null)?.decidedBy,
      (i.clarification as unknown as { requestedBy?: string } | null)
        ?.requestedBy,
    ]);
    const extractions = i.extractions.map((e) => this.extractionView(e, names));
    const latest = extractions.find((e) => e.status === 'COMPLETED') ?? null;
    const confirmed = this.confirmedOf(i);
    const missing = missingFields(confirmed, latest?.data ?? null);
    const b = i.buyerCompany;
    const risk = b
      ? {
          score: b.riskScore,
          level:
            (b.profile as { risk?: { level?: string } } | null)?.risk?.level ??
            'UNKNOWN',
          verificationStatus: b.verificationStatus,
        }
      : null;
    // Sprint 10 buyer–product match, reused (no separate RFQ scoring).
    let match: BuyerInquiryDetail['buyerMatch'] = null;
    const linkedProductId =
      confirmed?.items.find((x) => x.productId)?.productId ?? i.productId;
    if (b && linkedProductId) {
      const p = await this.prisma.organizationProduct.findFirst({
        where: { id: linkedProductId, organizationId: a.organizationId },
      });
      if (p) {
        const m = buyerMatch(
          {
            hsCode: p.hsCode,
            itcHsCode: p.itcHsCode,
            categoryCode: p.categoryCode,
            productName: null,
            countryCode: null,
            targetCountries: [],
          },
          {
            countryCode: b.countryCode,
            buyerType: b.buyerType,
            businessCategory: b.businessCategory,
            companySize: b.companySize,
            activities: b.activities,
            bestContactConfidence: b.maxContactConfidence,
          },
        );
        match = { score: m.score, level: m.level, productName: p.displayName };
      }
    }
    const msg = i.sourceMessageId
      ? await this.prisma.outreachMessage.findFirst({
          where: { id: i.sourceMessageId, organizationId: a.organizationId },
          select: { id: true, subject: true, campaignId: true, sentAt: true },
        })
      : null;
    const lead = i.crmLead;
    const candidates =
      !lead && i.buyerCompanyId
        ? await this.prisma.buyerLead.findMany({
            where: {
              organizationId: a.organizationId,
              buyerCompanyId: i.buyerCompanyId,
            },
            include: { product: { select: { displayName: true } } },
            take: 5,
          })
        : [];
    const dupes = await this.duplicates(i);
    const qual = i.qualification as unknown as {
      checklist: QualificationChecklist;
      decidedAt: string;
      decidedBy: string;
      overrideReason: string | null;
    } | null;
    const clar = i.clarification as unknown as {
      questions: InquiryClarificationQuestion[];
      requestedAt: string;
      requestedBy: string;
    } | null;
    const buyerName = b?.canonicalName ?? i.buyerName ?? '';
    const summary = this.summary(
      i,
      b,
      i.items.map((x) => x.productName),
      i.attachments.length,
      names,
    );
    return {
      ...summary,
      body: i.body,
      bodyWasHtml: i.bodyWasHtml,
      bodyProvenance: 'BUYER_PROVIDED',
      buyerContact:
        i.contactEmail || i.contactName
          ? { email: i.contactEmail, name: i.contactName }
          : null,
      buyerRisk: risk,
      buyerMatch: match,
      sourceMessage: i.sourceMessageId
        ? msg
          ? {
              id: msg.id,
              subject: msg.subject,
              campaignId: msg.campaignId,
              sentAt: iso(msg.sentAt),
              available: true,
            }
          : {
              id: i.sourceMessageId,
              subject: '',
              campaignId: null,
              sentAt: null,
              available: false,
            }
        : null,
      priorityReasons: i.priorityReasons,
      rowVersion: i.rowVersion,
      createdBy: i.createdByUserId
        ? (names.get(i.createdByUserId) ?? null)
        : null,
      attachments: i.attachments.map((x) => ({
        id: x.id,
        filename: x.originalFilename,
        mimeType: x.mimeType,
        sizeBytes: x.sizeBytes,
        checksum: x.checksum.slice(0, 12),
        textExtraction:
          x.extractedText !== null ? 'AVAILABLE' : 'NOT_AVAILABLE',
        uploadedBy: x.uploadedByUserId
          ? (names.get(x.uploadedByUserId) ?? null)
          : null,
        createdAt: x.createdAt.toISOString(),
      })),
      extractions,
      latestExtraction: latest,
      confirmed: confirmed
        ? {
            ...confirmed,
            confirmedAt: i.confirmedAt!.toISOString(),
            confirmedBy: i.confirmedByUserId
              ? (names.get(i.confirmedByUserId) ?? null)
              : null,
            basedOnExtractionVersion: i.confirmedFromVersion,
          }
        : null,
      reviewDraft: i.reviewDraft
        ? {
            ...(i.reviewDraft as unknown as ConfirmedRfq),
            savedAt: iso(i.reviewDraftAt)!,
            savedBy: i.reviewDraftByUserId
              ? (names.get(i.reviewDraftByUserId) ?? null)
              : null,
          }
        : null,
      missingFields: missing,
      suggestedQuestions: suggestQuestions(
        missing,
        latest?.data?.suggestedQuestions ?? [],
      ),
      clarification: clar
        ? {
            questions: clar.questions,
            requestedAt: clar.requestedAt,
            requestedBy: names.get(clar.requestedBy) ?? null,
            draftMessage: clarificationDraft(
              i.subject,
              buyerName,
              clar.questions,
            ),
          }
        : null,
      qualification: qual
        ? {
            checklist: qual.checklist,
            decidedAt: qual.decidedAt,
            decidedBy: names.get(qual.decidedBy) ?? null,
            overrideReason: qual.overrideReason,
          }
        : null,
      qualificationChecks: qualificationFacts({
        buyerKnown: Boolean(buyerName),
        confirmed,
        contactKnown: Boolean(
          i.contactEmail || i.buyerContactId || (b && b.hasContact),
        ),
      }),
      approval: {
        status: i.approvalStatus,
        history: i.approvals.map((x) => ({
          action: x.action,
          reason: x.reason,
          actor: names.get(x.actorUserId) ?? null,
          at: x.createdAt.toISOString(),
        })),
      },
      rejection: i.rejectCategory
        ? {
            category: i.rejectCategory,
            reason: i.rejectReason ?? '',
            at: iso(i.rejectedAt)!,
            by: i.rejectedByUserId
              ? (names.get(i.rejectedByUserId) ?? null)
              : null,
          }
        : null,
      quotationRequest: i.quotationRequest
        ? {
            id: i.quotationRequest.id,
            inquiryId: i.id,
            status: i.quotationRequest.status as 'PENDING',
            crmLeadId: i.quotationRequest.crmLeadId,
            buyerCompanyId: i.quotationRequest.buyerCompanyId,
            items: i.quotationRequest.items as unknown as ConfirmedItem[],
            requestedBy:
              names.get(i.quotationRequest.requestedByUserId) ?? null,
            createdAt: i.quotationRequest.createdAt.toISOString(),
          }
        : null,
      sampleRequest: i.sampleRequest
        ? {
            id: i.sampleRequest.id,
            inquiryId: i.id,
            status: 'PENDING',
            buyerCompanyId: i.sampleRequest.buyerCompanyId,
            productName: i.sampleRequest.productName,
            productId: i.sampleRequest.productId,
            quantity: i.sampleRequest.quantity,
            specification: i.sampleRequest.specification,
            deadline: i.sampleRequest.deadline,
            requestedBy: names.get(i.sampleRequest.requestedByUserId) ?? null,
            createdAt: i.sampleRequest.createdAt.toISOString(),
          }
        : null,
      crm: lead
        ? {
            leadId: lead.id,
            stage: lead.stage,
            owner: lead.ownerUserId
              ? (names.get(lead.ownerUserId) ?? null)
              : null,
            stageSuggestion: crmStageSuggestion(lead.stage, i.items.length > 0),
          }
        : null,
      crmCandidates: candidates.map((l) => ({
        leadId: l.id,
        stage: l.stage,
        productName: l.product?.displayName ?? null,
      })),
      possibleDuplicates: dupes,
      activities: i.activities.map((x) => ({
        id: x.id,
        type: x.type,
        title: x.title,
        actor: x.actorUserId ? (names.get(x.actorUserId) ?? null) : null,
        metadata: x.metadata as Record<string, unknown> | null,
        createdAt: x.createdAt.toISOString(),
      })),
      availableActions: this.actions(a.role, i, Boolean(confirmed)),
    };
  }

  /** Fuzzy duplicate warnings only (same buyer + similar subject within 30 days, or same attachment). Exact source ids are blocked at creation. */
  private async duplicates(i: InquiryRow) {
    const since = new Date(i.receivedAt.getTime() - 30 * 86_400_000);
    const until = new Date(i.receivedAt.getTime() + 30 * 86_400_000);
    const sameBuyer = i.buyerCompanyId
      ? { buyerCompanyId: i.buyerCompanyId }
      : i.buyerName
        ? { buyerName: { equals: i.buyerName, mode: 'insensitive' as const } }
        : null;
    const out: {
      id: string;
      reference: string;
      subject: string;
      receivedAt: string;
      reason: string;
    }[] = [];
    if (sameBuyer) {
      const rows = await this.prisma.buyerInquiry.findMany({
        where: {
          organizationId: i.organizationId,
          id: { not: i.id },
          receivedAt: { gte: since, lte: until },
          ...sameBuyer,
        },
        select: { id: true, reference: true, subject: true, receivedAt: true },
        take: 20,
      });
      for (const r of rows)
        if (subjectSimilarity(r.subject, i.subject) >= 0.6)
          out.push({
            id: r.id,
            reference: r.reference,
            subject: r.subject,
            receivedAt: r.receivedAt.toISOString(),
            reason: 'Same buyer, similar subject',
          });
    }
    return out.slice(0, 5);
  }

  private actions(
    role: MembershipRole,
    i: InquiryRow,
    confirmed: boolean,
  ): string[] {
    const out: string[] = [];
    const s = i.status;
    const open = [
      'NEW',
      'REVIEWING',
      'NEEDS_CLARIFICATION',
      'QUALIFIED',
    ].includes(s);
    if (this.can(role, 'inquiries.edit') && s !== 'ARCHIVED')
      out.push('edit', 'add_attachment', 'add_note', 'extract', 'confirm');
    if (this.can(role, 'inquiries.assign') && s !== 'ARCHIVED')
      out.push('assign');
    if (
      this.can(role, 'inquiries.qualify') &&
      ['NEW', 'REVIEWING', 'NEEDS_CLARIFICATION'].includes(s)
    )
      out.push('qualify', 'request_clarification');
    if (this.can(role, 'inquiries.qualify') && open) out.push('reject');
    if (
      this.can(role, 'inquiries.qualify') &&
      open &&
      i.approvalStatus !== 'PENDING' &&
      i.approvalStatus !== 'APPROVED'
    )
      out.push('submit_approval');
    if (this.can(role, 'inquiries.approve') && i.approvalStatus === 'PENDING')
      out.push('approve', 'reject_approval');
    const approvalOk =
      i.approvalStatus !== 'PENDING' && i.approvalStatus !== 'REJECTED';
    if (
      this.can(role, 'inquiries.create_handoff') &&
      (s === 'QUALIFIED' || s === 'CONVERTED') &&
      approvalOk &&
      !i.quotationRequest
    )
      out.push('create_quotation_request');
    if (
      this.can(role, 'inquiries.create_handoff') &&
      confirmed &&
      ['REVIEWING', 'NEEDS_CLARIFICATION', 'QUALIFIED', 'CONVERTED'].includes(
        s,
      ) &&
      approvalOk &&
      !i.sampleRequest
    )
      out.push('create_sample_request');
    if (this.can(role, 'inquiries.archive'))
      out.push(s === 'ARCHIVED' ? 'restore' : 'archive');
    return out;
  }

  // ============================================================ mutations

  async update(a: Actor, id: string, dto: UpdateInquiryDto) {
    const i = await this.load(a.organizationId, id);
    if (i.status === 'ARCHIVED')
      throw new ConflictException('Restore the inquiry before editing it.');
    const data: Prisma.BuyerInquiryUncheckedUpdateManyInput = {};
    if (dto.subject !== undefined)
      data.subject = cleanText(dto.subject, 300) ?? i.subject;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.buyerCompanyId !== undefined) {
      if (dto.buyerCompanyId)
        await this.buyerVisible(a.organizationId, dto.buyerCompanyId);
      data.buyerCompanyId = dto.buyerCompanyId;
    }
    if (dto.buyerName !== undefined)
      data.buyerName = cleanText(dto.buyerName, 160);
    if (dto.contactEmail !== undefined)
      data.contactEmail = cleanText(dto.contactEmail, 254);
    if (dto.contactName !== undefined)
      data.contactName = cleanText(dto.contactName, 120);
    if (dto.productId !== undefined) {
      if (dto.productId) await this.productOf(a.organizationId, dto.productId);
      data.productId = dto.productId;
    }
    if (dto.countryCode !== undefined) {
      if (dto.countryCode && !isValidCountryCode(dto.countryCode))
        throw new BadRequestException('Unsupported country.');
      data.countryCode = dto.countryCode;
    }
    if (dto.crmLeadId !== undefined) {
      if (dto.crmLeadId) {
        const l = await this.leadOf(a.organizationId, dto.crmLeadId);
        const buyer =
          (data.buyerCompanyId as string | null | undefined) ??
          i.buyerCompanyId;
        if (buyer && l.buyerCompanyId !== buyer)
          throw new BadRequestException(
            'The CRM lead belongs to a different buyer.',
          );
        if (!buyer) data.buyerCompanyId = l.buyerCompanyId;
      }
      data.crmLeadId = dto.crmLeadId;
    }
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, dto.expectedRowVersion, data);
      if (dto.priority !== undefined && dto.priority !== i.priority)
        await this.activity(
          tx,
          i,
          'PRIORITY_CHANGED',
          `Priority set to ${dto.priority.toLowerCase()}`,
          a.userId,
        );
      if (dto.crmLeadId && dto.crmLeadId !== i.crmLeadId) {
        await this.activity(
          tx,
          i,
          'CRM_LINKED',
          'Linked to CRM lead',
          a.userId,
          { leadId: dto.crmLeadId },
        );
        await this.crmActivity(
          tx,
          { ...i, crmLeadId: dto.crmLeadId },
          `Inquiry ${i.reference} linked to this lead`,
          a.userId,
        );
      }
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.updated',
      entityType: 'BuyerInquiry',
      entityId: id,
      metadata: { fields: Object.keys(data) },
    });
    return this.detail(a, id, false);
  }

  async setRead(a: Actor, id: string, read: boolean) {
    const i = await this.load(a.organizationId, id);
    await this.prisma.buyerInquiry.update({
      where: { id: i.id },
      data: { unread: !read },
    });
    return this.detail(a, id, false);
  }

  async assign(a: Actor, id: string, userId: string | null, expected?: number) {
    const i = await this.load(a.organizationId, id);
    if (userId) {
      const m = await this.prisma.membership.findFirst({
        where: {
          organizationId: a.organizationId,
          userId,
          status: 'ACTIVE',
          user: { isActive: true },
        },
      });
      if (!m)
        throw new BadRequestException(
          'The assignee must be an active member of this organization.',
        );
    }
    const names = await this.userNames([userId]);
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, expected, { assignedToUserId: userId });
      await this.activity(
        tx,
        i,
        'ASSIGNED',
        userId ? `Assigned to ${names.get(userId) ?? 'member'}` : 'Unassigned',
        a.userId,
        { assignedTo: userId },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.assigned',
      entityType: 'BuyerInquiry',
      entityId: id,
      metadata: { assignedTo: userId },
    });
    return this.detail(a, id, false);
  }

  async addNote(a: Actor, id: string, text: string) {
    const i = await this.load(a.organizationId, id);
    const t = cleanText(text, 5000);
    if (!t) throw new BadRequestException('Enter a note.');
    await this.activity(this.prisma, i, 'NOTE', 'Internal note', a.userId, {
      text: t,
    });
    return this.detail(a, id, false);
  }

  // ============================================================ extraction

  /** Runs extraction on demand. Every run is a new immutable version; failures leave the inquiry fully usable. */
  async extract(a: Actor, id: string) {
    const i = await this.load(a.organizationId, id);
    if (i.status === 'ARCHIVED')
      throw new ConflictException('Restore the inquiry before extracting.');
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, undefined, { extractionStatus: 'PROCESSING' });
      await this.activity(
        tx,
        i,
        'EXTRACTION_STARTED',
        'Extraction started',
        a.userId,
        { provider: this.extractor.identity.name },
      );
    });
    const used = i.attachments.filter((x) => x.extractedText);
    const skipped = i.attachments
      .filter((x) => !x.extractedText)
      .map((x) => ({
        filename: x.originalFilename,
        reason: 'Text extraction not available for this file type',
      }));
    const version = (i.extractions[0]?.version ?? 0) + 1;
    const req = {
      subject: i.subject,
      body: i.body,
      attachments: used.map((x) => ({
        filename: x.originalFilename,
        text: x.extractedText!,
      })),
      metadata: {
        buyerCountry: i.buyerCompany?.countryCode ?? null,
        receivedAt: i.receivedAt.toISOString(),
      },
    };
    const id0 = this.extractor.identity;
    const common = {
      organizationId: a.organizationId,
      inquiryId: id,
      version,
      provider: id0.name,
      model: id0.model,
      promptVersion: id0.promptVersion,
      provenance: id0.provenance,
      attachmentsUsed: used.map((x) => x.originalFilename),
      attachmentsSkipped: skipped as unknown as Prisma.InputJsonValue,
      createdByUserId: a.userId,
    };
    try {
      const raw = await this.extractor.extract(req);
      const { data, invalidFields } = sanitizeExtraction(raw);
      const grounded = ground(
        data,
        [i.subject, i.body, ...req.attachments.map((x) => x.text)].join('\n'),
      );
      const pr = suggestPriority({
        text: `${i.subject}\n${i.body}`,
        source: i.source,
        leadStage: i.crmLead?.stage ?? null,
        items: grounded.items.map((x) => ({
          quantity: x.quantity.value,
          unit: x.quantityUnit.value,
        })),
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.inquiryExtraction.create({
          data: {
            ...common,
            status: 'COMPLETED',
            overallConfidence: grounded.overallConfidence,
            data: grounded as unknown as Prisma.InputJsonValue,
            invalidFields,
          },
        });
        await tx.buyerInquiry.update({
          where: { id },
          data: {
            extractionStatus: 'NEEDS_REVIEW',
            isRfq:
              i.isRfq || grounded.items.some((x) => x.quantity.value !== null),
            suggestedPriority: pr.priority,
            priorityReasons: pr.reasons,
            rowVersion: { increment: 1 },
          },
        });
        await this.activity(
          tx,
          i,
          'EXTRACTION_COMPLETED',
          `Extraction v${version} completed — ${grounded.items.length} item(s), needs review`,
          a.userId,
          {
            version,
            provenance: id0.provenance,
            invalidFields: invalidFields.length,
          },
        );
      });
    } catch (e) {
      const kind =
        e instanceof ExtractionProviderError ? e.kind : 'UNAVAILABLE';
      if (!(e instanceof ExtractionProviderError))
        this.logger.warn(`Inquiry extraction failed: ${(e as Error).message}`);
      const message = {
        NOT_CONFIGURED:
          'AI extraction is not configured. Enter the RFQ manually.',
        TIMEOUT: 'The AI provider timed out. Retry or enter the RFQ manually.',
        RATE_LIMITED:
          'The AI provider is busy. Retry shortly or enter the RFQ manually.',
        UNAVAILABLE:
          'The AI provider is unavailable. Retry or enter the RFQ manually.',
        INVALID_RESPONSE:
          'The AI provider returned an unusable response. Retry or enter the RFQ manually.',
      }[kind];
      await this.prisma.$transaction(async (tx) => {
        await tx.inquiryExtraction.create({
          data: {
            ...common,
            status: 'FAILED',
            invalidFields: [],
            error: message,
          },
        });
        await tx.buyerInquiry.update({
          where: { id },
          data: { extractionStatus: 'FAILED', rowVersion: { increment: 1 } },
        });
        await this.activity(
          tx,
          i,
          'EXTRACTION_FAILED',
          `Extraction v${version} failed`,
          a.userId,
          { kind },
        );
      });
    }
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.extraction_run',
      entityType: 'BuyerInquiry',
      entityId: id,
      metadata: { version, provider: id0.name },
    });
    return this.detail(a, id, false);
  }

  async extractions(organizationId: string, id: string) {
    const i = await this.load(organizationId, id);
    const names = await this.userNames(
      i.extractions.map((e) => e.createdByUserId),
    );
    return i.extractions.map((e) => this.extractionView(e, names));
  }

  private async normalizeConfirmed(organizationId: string, dto: ConfirmRfqDto) {
    if (
      dto.destination.countryCode &&
      !isValidCountryCode(dto.destination.countryCode)
    )
      throw new BadRequestException('Unsupported destination country.');
    for (const it of dto.items)
      if (it.productId) await this.productOf(organizationId, it.productId);
    const t = (s: string | null | undefined, n: number) =>
      cleanText(s ?? null, n);
    const items = dto.items.map((it, n) => ({
      sortOrder: n,
      productName: t(it.productName, 200) ?? 'Product',
      productId: it.productId ?? null,
      hsCode: it.hsCode ?? null,
      quantity: it.quantity ?? null,
      quantityUnit: t(it.quantityUnit, 30),
      quantityText: t(it.quantityText, 120),
      specification: t(it.specification, 1000),
      packaging: t(it.packaging, 500),
      targetPrice: it.targetPrice ?? null,
      priceCurrency: it.priceCurrency ?? null,
      priceUnitBasis: t(it.priceUnitBasis, 30),
      priceIndicative: Boolean(it.priceIndicative),
      deliveryDate: t(it.deliveryDate, 60),
    }));
    const rest: Omit<ConfirmedRfq, 'items'> = {
      destination: {
        countryCode: dto.destination.countryCode ?? null,
        city: t(dto.destination.city, 80),
        port: t(dto.destination.port, 80),
        location: t(dto.destination.location, 200),
      },
      incoterm: {
        term: (dto.incoterm.term ?? null) as ConfirmedRfq['incoterm']['term'],
        place: t(dto.incoterm.place, 80),
      },
      certifications: [
        ...new Set(dto.certifications.map((c) => c.trim()).filter(Boolean)),
      ],
      paymentTerms: {
        type: (dto.paymentTerms.type ??
          null) as ConfirmedRfq['paymentTerms']['type'],
        advancePercent: dto.paymentTerms.advancePercent ?? null,
        creditDays: dto.paymentTerms.creditDays ?? null,
        raw: t(dto.paymentTerms.raw, 500),
      },
      delivery: {
        targetDate: t(dto.delivery.targetDate, 60),
        shipmentWindow: t(dto.delivery.shipmentWindow, 80),
        leadTime: t(dto.delivery.leadTime, 80),
        urgent: Boolean(dto.delivery.urgent),
      },
      sample: {
        required: Boolean(dto.sample.required),
        quantity: t(dto.sample.quantity, 80),
        specification: t(dto.sample.specification, 500),
        deadline: t(dto.sample.deadline, 60),
      },
      notes: t(dto.notes, 2000),
    };
    return { items, rest };
  }

  /** Saves a review draft (not confirmed; AI extraction stays untouched). */
  async saveDraft(a: Actor, id: string, dto: ConfirmRfqDto) {
    const i = await this.load(a.organizationId, id);
    if (i.status === 'ARCHIVED')
      throw new ConflictException('Restore the inquiry before editing.');
    const { items, rest } = await this.normalizeConfirmed(
      a.organizationId,
      dto,
    );
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, dto.expectedRowVersion, {
        reviewDraft: { ...rest, items } as unknown as Prisma.InputJsonValue,
        reviewDraftAt: new Date(),
        reviewDraftByUserId: a.userId,
      });
    });
    return this.detail(a, id, false);
  }

  /** Human confirmation: stored as USER_CONFIRMED, separately from every AI extraction (which is never modified). */
  async confirm(a: Actor, id: string, dto: ConfirmRfqDto) {
    const i = await this.load(a.organizationId, id);
    if (['ARCHIVED', 'REJECTED', 'CONVERTED'].includes(i.status))
      throw new ConflictException(
        `A ${i.status.toLowerCase()} inquiry cannot be re-confirmed.`,
      );
    if (
      dto.basedOnExtractionVersion &&
      !i.extractions.some((e) => e.version === dto.basedOnExtractionVersion)
    )
      throw new BadRequestException('Unknown extraction version.');
    const { items, rest } = await this.normalizeConfirmed(
      a.organizationId,
      dto,
    );
    const pr = suggestPriority({
      text: `${i.subject}\n${i.body}`,
      source: i.source,
      leadStage: i.crmLead?.stage ?? null,
      items: items.map((x) => ({
        quantity: x.quantity ? Number(x.quantity) : null,
        unit: x.quantityUnit,
      })),
    });
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, dto.expectedRowVersion, {
        confirmedRfq: rest as unknown as Prisma.InputJsonValue,
        confirmedAt: new Date(),
        confirmedByUserId: a.userId,
        confirmedFromVersion: dto.basedOnExtractionVersion ?? null,
        extractionStatus: 'COMPLETED',
        reviewDraft: Prisma.DbNull,
        reviewDraftAt: null,
        reviewDraftByUserId: null,
        isRfq: i.isRfq || items.length > 0,
        suggestedPriority: pr.priority,
        priorityReasons: pr.reasons,
        ...(i.status === 'NEW' ? { status: 'REVIEWING' } : {}),
      });
      await tx.inquiryItem.deleteMany({ where: { inquiryId: id } });
      if (items.length)
        await tx.inquiryItem.createMany({
          data: items.map((x) => ({
            ...x,
            organizationId: a.organizationId,
            inquiryId: id,
          })),
        });
      await this.activity(
        tx,
        i,
        'REVIEWED',
        `RFQ reviewed and confirmed — ${items.length} item(s)${dto.basedOnExtractionVersion ? ` (from extraction v${dto.basedOnExtractionVersion})` : ' (entered manually)'}`,
        a.userId,
        { items: items.length, basedOn: dto.basedOnExtractionVersion ?? null },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.reviewed',
      entityType: 'BuyerInquiry',
      entityId: id,
      metadata: {
        items: items.length,
        basedOnExtractionVersion: dto.basedOnExtractionVersion ?? null,
      },
    });
    return this.detail(a, id, false);
  }

  // ============================================================== workflow

  async qualify(a: Actor, id: string, dto: QualifyDto) {
    const i = await this.load(a.organizationId, id);
    if (!['NEW', 'REVIEWING', 'NEEDS_CLARIFICATION'].includes(i.status))
      throw new ConflictException(
        `A ${i.status.toLowerCase().replace('_', ' ')} inquiry cannot be qualified.`,
      );
    const problems: string[] = [];
    if (!i.confirmedRfq)
      problems.push(
        i.extractionStatus === 'NEEDS_REVIEW'
          ? 'The extracted RFQ has not been reviewed and confirmed.'
          : 'No confirmed RFQ yet.',
      );
    if (!i.buyerCompanyId && !i.buyerName) problems.push('Buyer is unknown.');
    if (!i.items.length) problems.push('No product identified.');
    if (problems.length) {
      if (!dto.overrideReason)
        throw new BadRequestException({
          message: 'This inquiry cannot be qualified yet.',
          details: { problems },
        });
      if (!this.can(a.role, 'inquiries.approve'))
        throw new ForbiddenException(
          'Only a manager can override qualification checks.',
        );
    }
    const qualification = {
      checklist: dto.checklist,
      decidedAt: new Date().toISOString(),
      decidedBy: a.userId,
      overrideReason: problems.length
        ? cleanText(dto.overrideReason, 500)
        : null,
      overriddenProblems: problems,
    };
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, dto.expectedRowVersion, {
        status: 'QUALIFIED',
        qualification: qualification as unknown as Prisma.InputJsonValue,
      });
      await this.activity(
        tx,
        i,
        'QUALIFIED',
        problems.length ? 'Qualified with override' : 'Qualified',
        a.userId,
        { checklist: dto.checklist, override: Boolean(problems.length) },
      );
      await this.crmActivity(
        tx,
        i,
        `Inquiry ${i.reference} qualified`,
        a.userId,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.qualified',
      entityType: 'BuyerInquiry',
      entityId: id,
      metadata: { override: Boolean(problems.length) },
    });
    return this.detail(a, id, false);
  }

  async requestClarification(a: Actor, id: string, dto: ClarifyDto) {
    const i = await this.load(a.organizationId, id);
    if (['REJECTED', 'ARCHIVED', 'CONVERTED'].includes(i.status))
      throw new ConflictException(
        `Cannot request clarification on a ${i.status.toLowerCase()} inquiry.`,
      );
    const questions = dto.questions
      .map((q) => ({ text: cleanText(q.text, 300) ?? '', source: q.source }))
      .filter((q) => q.text);
    if (!questions.length)
      throw new BadRequestException('Add at least one question.');
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, dto.expectedRowVersion, {
        status: 'NEEDS_CLARIFICATION',
        clarification: {
          questions,
          requestedAt: new Date().toISOString(),
          requestedBy: a.userId,
        } as unknown as Prisma.InputJsonValue,
      });
      await this.activity(
        tx,
        i,
        'CLARIFICATION_REQUESTED',
        `Clarification requested (${questions.length} question${questions.length > 1 ? 's' : ''})`,
        a.userId,
        { questions: questions.map((q) => q.text) },
      );
      await this.crmActivity(
        tx,
        i,
        `Clarification requested on inquiry ${i.reference}`,
        a.userId,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.clarification_requested',
      entityType: 'BuyerInquiry',
      entityId: id,
      metadata: { questions: questions.length },
    });
    return this.detail(a, id, false);
  }

  async reject(a: Actor, id: string, dto: RejectDto) {
    const i = await this.load(a.organizationId, id);
    if (['REJECTED', 'ARCHIVED', 'CONVERTED'].includes(i.status))
      throw new ConflictException(
        `A ${i.status.toLowerCase()} inquiry cannot be rejected.`,
      );
    const reason = cleanText(dto.reason, 1000);
    if (!reason) throw new BadRequestException('A reason is required.');
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, dto.expectedRowVersion, {
        status: 'REJECTED',
        rejectCategory: dto.category,
        rejectReason: reason,
        rejectedAt: new Date(),
        rejectedByUserId: a.userId,
      });
      await this.activity(
        tx,
        i,
        'REJECTED',
        `Rejected — ${dto.category.toLowerCase().replace(/_/g, ' ')}`,
        a.userId,
        { category: dto.category, reason },
      );
      await this.crmActivity(
        tx,
        i,
        `Inquiry ${i.reference} rejected (${dto.category.toLowerCase().replace(/_/g, ' ')})`,
        a.userId,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.rejected',
      entityType: 'BuyerInquiry',
      entityId: id,
      metadata: { category: dto.category },
    });
    return this.detail(a, id, false);
  }

  async archive(a: Actor, id: string, expected?: number) {
    const i = await this.load(a.organizationId, id);
    if (i.status === 'ARCHIVED') return this.detail(a, id, false);
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, expected, {
        status: 'ARCHIVED',
        previousStatus: i.status,
        archivedAt: new Date(),
      });
      await this.activity(tx, i, 'ARCHIVED', 'Archived', a.userId);
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.archived',
      entityType: 'BuyerInquiry',
      entityId: id,
      metadata: { previousStatus: i.status },
    });
    return this.detail(a, id, false);
  }

  async restore(a: Actor, id: string, expected?: number) {
    const i = await this.load(a.organizationId, id);
    if (i.status !== 'ARCHIVED')
      throw new ConflictException('Only archived inquiries can be restored.');
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, expected, {
        status: i.previousStatus ?? 'NEW',
        previousStatus: null,
        archivedAt: null,
      });
      await this.activity(tx, i, 'RESTORED', 'Restored from archive', a.userId);
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.restored',
      entityType: 'BuyerInquiry',
      entityId: id,
    });
    return this.detail(a, id, false);
  }

  // ============================================================== approval

  async submitApproval(a: Actor, id: string, dto: ApprovalDto) {
    const i = await this.load(a.organizationId, id);
    if (['REJECTED', 'ARCHIVED', 'CONVERTED'].includes(i.status))
      throw new ConflictException(
        `A ${i.status.toLowerCase()} inquiry cannot be submitted for approval.`,
      );
    if (i.approvalStatus === 'PENDING')
      throw new ConflictException('Approval is already pending.');
    if (i.approvalStatus === 'APPROVED')
      throw new ConflictException('This inquiry is already approved.');
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, i, dto.expectedRowVersion, {
        approvalStatus: 'PENDING',
      });
      await tx.inquiryApproval.create({
        data: {
          organizationId: a.organizationId,
          inquiryId: id,
          action: 'SUBMITTED',
          reason: cleanText(dto.reason, 1000),
          actorUserId: a.userId,
        },
      });
      await this.activity(
        tx,
        i,
        'APPROVAL_SUBMITTED',
        'Submitted for internal approval',
        a.userId,
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'inquiry.approval_submitted',
      entityType: 'BuyerInquiry',
      entityId: id,
    });
    return this.detail(a, id, false);
  }

  async decideApproval(
    a: Actor,
    id: string,
    approve: boolean,
    dto: ApprovalDto,
  ) {
    const i = await this.load(a.organizationId, id);
    if (i.approvalStatus !== 'PENDING')
      throw new ConflictException(
        'There is no pending approval for this inquiry.',
      );
    const reason = cleanText(dto.reason, 1000);
    if (!approve && !reason)
      throw new BadRequestException(
        'A reason is required to reject an approval.',
      );
    await this.prisma.$transaction(async (tx) => {
      // Guard on PENDING too, so two approvers cannot both decide.
      const r = await tx.buyerInquiry.updateMany({
        where: {
          id,
          organizationId: a.organizationId,
          approvalStatus: 'PENDING',
          ...(dto.expectedRowVersion !== undefined
            ? { rowVersion: dto.expectedRowVersion }
            : {}),
        },
        data: {
          approvalStatus: approve ? 'APPROVED' : 'REJECTED',
          rowVersion: { increment: 1 },
        },
      });
      if (!r.count)
        throw new ConflictException(
          'The approval was already decided or the inquiry changed. Reload and try again.',
        );
      await tx.inquiryApproval.create({
        data: {
          organizationId: a.organizationId,
          inquiryId: id,
          action: approve ? 'APPROVED' : 'REJECTED',
          reason,
          actorUserId: a.userId,
        },
      });
      await this.activity(
        tx,
        i,
        approve ? 'APPROVED' : 'APPROVAL_REJECTED',
        approve ? 'Approved internally' : 'Internal approval rejected',
        a.userId,
        { reason },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: approve ? 'inquiry.approved' : 'inquiry.approval_rejected',
      entityType: 'BuyerInquiry',
      entityId: id,
    });
    return this.detail(a, id, false);
  }

  // ============================================================== handoffs

  /** Sprint 15 handoff record only (idempotent per inquiry). No quotation document is created. */
  async createQuotationRequest(a: Actor, id: string) {
    const i = await this.load(a.organizationId, id);
    if (i.quotationRequest)
      return { alreadyExists: true, inquiry: await this.detail(a, id, false) };
    if (!['QUALIFIED', 'CONVERTED'].includes(i.status))
      throw new ConflictException(
        'Qualify the inquiry before requesting a quotation.',
      );
    if (i.approvalStatus === 'PENDING')
      throw new ConflictException('Internal approval is still pending.');
    if (i.approvalStatus === 'REJECTED')
      throw new ConflictException('Internal approval was rejected.');
    const items = i.items.map((x) => this.itemView(x));
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.quotationRequest.create({
          data: {
            organizationId: a.organizationId,
            inquiryId: id,
            crmLeadId: i.crmLeadId,
            buyerCompanyId: i.buyerCompanyId,
            items: items as unknown as Prisma.InputJsonValue,
            status:
              items.length && items.every((x) => x.quantity)
                ? 'READY_FOR_FUTURE_MODULE'
                : 'PENDING',
            requestedByUserId: a.userId,
          },
        });
        await this.touch(tx, i, undefined, { status: 'CONVERTED' });
        await this.activity(
          tx,
          i,
          'QUOTATION_REQUESTED',
          'Quotation request created (handoff to the quotation module)',
          a.userId,
        );
        await this.crmActivity(
          tx,
          i,
          `Quotation requested for inquiry ${i.reference}`,
          a.userId,
        );
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        return {
          alreadyExists: true,
          inquiry: await this.detail(a, id, false),
        };
      throw e;
    }
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'quotation_request.created',
      entityType: 'BuyerInquiry',
      entityId: id,
    });
    return { alreadyExists: false, inquiry: await this.detail(a, id, false) };
  }

  /** Sprint 22 handoff record only (idempotent per inquiry). No sample logistics. */
  async createSampleRequest(a: Actor, id: string, itemIndex = 0) {
    const i = await this.load(a.organizationId, id);
    if (i.sampleRequest)
      return { alreadyExists: true, inquiry: await this.detail(a, id, false) };
    if (
      !['REVIEWING', 'NEEDS_CLARIFICATION', 'QUALIFIED', 'CONVERTED'].includes(
        i.status,
      )
    )
      throw new ConflictException(
        `Cannot request a sample on a ${i.status.toLowerCase()} inquiry.`,
      );
    if (!i.confirmedRfq)
      throw new ConflictException(
        'Confirm the RFQ before creating a sample request.',
      );
    if (i.approvalStatus === 'PENDING')
      throw new ConflictException('Internal approval is still pending.');
    if (i.approvalStatus === 'REJECTED')
      throw new ConflictException('Internal approval was rejected.');
    const conf = this.confirmedOf(i)!;
    const item = conf.items[itemIndex] ?? conf.items[0] ?? null;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.sampleRequest.create({
          data: {
            organizationId: a.organizationId,
            inquiryId: id,
            buyerCompanyId: i.buyerCompanyId,
            productName: item?.productName ?? null,
            productId: item?.productId ?? null,
            quantity: conf.sample.quantity,
            specification:
              conf.sample.specification ?? item?.specification ?? null,
            deadline: conf.sample.deadline,
            requestedByUserId: a.userId,
          },
        });
        await this.touch(tx, i, undefined, { status: 'CONVERTED' });
        await this.activity(
          tx,
          i,
          'SAMPLE_REQUESTED',
          'Sample request created (handoff only — no logistics)',
          a.userId,
        );
        await this.crmActivity(
          tx,
          i,
          `Sample requested for inquiry ${i.reference}`,
          a.userId,
        );
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        return {
          alreadyExists: true,
          inquiry: await this.detail(a, id, false),
        };
      throw e;
    }
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'sample_request.created',
      entityType: 'BuyerInquiry',
      entityId: id,
    });
    return { alreadyExists: false, inquiry: await this.detail(a, id, false) };
  }

  async assignees(organizationId: string) {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId, status: 'ACTIVE', user: { isActive: true } },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ user: { firstName: 'asc' } }],
    });
    return rows.map((m) => ({
      id: m.user.id,
      name: `${m.user.firstName} ${m.user.lastName}`.trim(),
      role: m.role,
    }));
  }
}
