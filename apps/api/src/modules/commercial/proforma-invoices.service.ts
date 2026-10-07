import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type BankDetails,
  type CommercialList,
  countryLabel,
  isCostingCurrency,
  type PartySnapshot,
  type PiDetail,
  type PiSummary,
  roleHasPermission,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { AuditService } from '../audit/audit.service';
import { D } from '../costing/costing-calculator';
import {
  documentTotals,
  lineTotal,
  normText,
  roundPrice,
} from './commercial-math';
import {
  type Actor,
  CommercialCoreService,
  day,
  iso,
  type Tx,
} from './commercial-core.service';
import { QuotationsService } from './quotations.service';
import { renderCommercialPdf } from './pdf/commercial-pdf';
import type {
  CreatePiDto,
  ListQueryDto,
  ReasonDto,
  UpdatePiDto,
} from './commercial.dto';

const include = {
  items: { orderBy: { sortOrder: 'asc' } },
  quotation: { include: { items: true } },
} satisfies Prisma.ProformaInvoiceInclude;
type Row = Prisma.ProformaInvoiceGetPayload<{ include: typeof include }>;
const startOfToday = () => new Date(new Date().toISOString().slice(0, 10));
const display = (n: string, r: number) => `${n}${r > 1 ? ` Rev ${r}` : ''}`;

/**
 * Proforma invoices: normally copied from the ACCEPTED quotation snapshot
 * (never recomputed from current costing). Not a tax or commercial invoice.
 */
@Injectable()
export class ProformaInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly core: CommercialCoreService,
    private readonly quotations: QuotationsService,
  ) {}

  private async load(organizationId: string, id: string): Promise<Row> {
    const p = await this.prisma.proformaInvoice.findFirst({
      where: { id, organizationId },
      include,
    });
    if (!p) throw new NotFoundException('Proforma invoice not found.');
    return p;
  }

  private async touch(
    tx: Tx,
    p: { id: string; organizationId: string },
    expected: number | undefined,
    data: Prisma.ProformaInvoiceUncheckedUpdateManyInput,
    extra: Prisma.ProformaInvoiceWhereInput = {},
  ) {
    const r = await tx.proformaInvoice.updateMany({
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

  async create(a: Actor, dto: CreatePiDto) {
    const org = a.organizationId;
    const settings = await this.core.rawSettings(org);
    type Base = Omit<
      Prisma.ProformaInvoiceUncheckedCreateInput,
      'organizationId' | 'piNumber' | 'createdByUserId'
    >;
    let base: Base;
    let items: Omit<Prisma.ProformaInvoiceItemUncheckedCreateInput, 'piId'>[] =
      [];
    if (dto.quotationId) {
      await this.quotations.expireDue(org);
      const q = await this.prisma.quotation.findFirst({
        where: { id: dto.quotationId, organizationId: org },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!q) throw new NotFoundException('Quotation not found.');
      if (q.status !== 'ACCEPTED') {
        if (!['ISSUED', 'SENT'].includes(q.status))
          throw new ConflictException(
            `A PI cannot be created from a ${q.status.toLowerCase()} quotation.`,
          );
        if (!dto.overrideReason)
          throw new ConflictException({
            message:
              'The quotation has not been accepted. A manager may override with a reason.',
            details: { code: 'QUOTATION_NOT_ACCEPTED' },
          });
        this.quotations.assertCanOverridePi(a);
      }
      const existing = await this.prisma.proformaInvoice.findFirst({
        where: {
          organizationId: org,
          quotation: { rootId: q.rootId },
          status: { not: 'CANCELLED' },
        },
      });
      if (existing)
        throw new ConflictException({
          message: `A proforma invoice (${existing.piNumber}) already exists for this quotation.`,
          details: { existingPiId: existing.id },
        });
      base = {
        source: 'QUOTATION',
        quotationId: q.id,
        overrideReason:
          q.status === 'ACCEPTED' ? null : dto.overrideReason!.trim(),
        buyerCompanyId: q.buyerCompanyId,
        buyerName: q.buyerName,
        crmLeadId: q.crmLeadId,
        inquiryId: q.inquiryId,
        currency: q.currency,
        incoterm: q.incoterm,
        incotermPlace: q.incotermPlace,
        destinationCountry: q.destinationCountry,
        destinationPort: q.destinationPort,
        paymentTerms: q.paymentTerms,
        deliveryTerms: q.deliveryTerms,
        buyerNotes: q.buyerNotes,
        terms: settings.piTerms ?? q.termsAndConditions,
        additionalCharges: q.additionalCharges,
        chargesLabel: q.chargesLabel,
        discount: q.discount,
        subtotal: q.subtotal ?? 0,
        totalAmount: q.totalAmount ?? 0,
        buyerSnapshot: (q.buyerSnapshot ?? undefined) as
          Prisma.InputJsonValue | undefined,
      };
      // Items come from the accepted quotation snapshot — never from current costing.
      items = q.items.map((i) => ({
        organizationId: org,
        sortOrder: i.sortOrder,
        quotationItemId: i.id,
        productId: i.productId,
        description: i.description,
        hsCode: i.hsCode,
        specification: i.specification,
        packaging: i.packaging,
        quantity: i.quantity,
        unit: i.unit,
        unitPrice: i.unitPrice ?? 0,
        totalPrice: i.totalPrice ?? 0,
      }));
    } else {
      // Manual PI (no quotation) — allowed, but labelled MANUAL.
      if (!dto.buyerCompanyId && !dto.buyerName)
        throw new BadRequestException(
          'Select a buyer for a manual proforma invoice.',
        );
      const b = dto.buyerCompanyId
        ? await this.prisma.buyerCompany.findFirst({
            where: {
              id: dto.buyerCompanyId,
              OR: [{ ownerOrganizationId: null }, { ownerOrganizationId: org }],
            },
          })
        : null;
      if (dto.buyerCompanyId && !b)
        throw new NotFoundException('Buyer not found.');
      const currency = dto.currency ?? 'USD';
      if (!isCostingCurrency(currency))
        throw new BadRequestException(`Unsupported currency ${currency}.`);
      base = {
        source: 'MANUAL',
        buyerCompanyId: b?.id ?? null,
        buyerName: b?.canonicalName ?? dto.buyerName!.trim(),
        currency,
        terms: settings.piTerms,
        destinationCountry: b?.countryCode ?? null,
      };
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.core.nextNumber(
        tx,
        org,
        'PI',
        settings.piPrefix,
        settings.yearlyReset,
      );
      const p = await tx.proformaInvoice.create({
        data: {
          ...base,
          organizationId: org,
          piNumber: number,
          createdByUserId: a.userId,
          items: { create: items },
        },
      });
      await tx.proformaInvoice.update({
        where: { id: p.id },
        data: { rootId: p.id },
      });
      await this.core.event(
        tx,
        { organizationId: org, userId: a.userId },
        {
          entityType: 'PI',
          entityId: p.id,
          lineageId: p.id,
          type: 'CREATED',
          title: `Proforma invoice ${number} created (draft)${base.overrideReason ? ' — manager override' : ''}`,
        },
      );
      return p;
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'pi.created',
      entityType: 'ProformaInvoice',
      entityId: created.id,
      metadata: {
        number: created.piNumber,
        source: created.source,
        quotationId: created.quotationId,
        override: Boolean(created.overrideReason),
      },
    });
    return this.detail(a, created.id);
  }

  async update(a: Actor, id: string, dto: UpdatePiDto) {
    const p = await this.load(a.organizationId, id);
    if (p.status !== 'DRAFT')
      throw new ConflictException(
        'Issued proforma invoices cannot be edited. Create a revision.',
      );
    const settings = await this.core.rawSettings(a.organizationId);
    const data: Prisma.ProformaInvoiceUncheckedUpdateManyInput = {};
    for (const k of [
      'incoterm',
      'incotermPlace',
      'destinationCountry',
      'destinationPort',
      'paymentTerms',
      'deliveryTerms',
      'buyerNotes',
      'internalNotes',
      'terms',
      'additionalCharges',
      'chargesLabel',
      'discount',
    ] as const)
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
    if (dto.issueDate !== undefined)
      data.issueDate = dto.issueDate ? new Date(dto.issueDate) : null;
    if (dto.validUntil !== undefined)
      data.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    if (dto.currency && dto.currency !== p.currency) {
      if (p.quotationId)
        throw new BadRequestException(
          'A PI from a quotation keeps the quotation currency.',
        );
      if (!isCostingCurrency(dto.currency))
        throw new BadRequestException(`Unsupported currency ${dto.currency}.`);
      data.currency = dto.currency;
    }
    let items = p.items.map((i) => ({
      quantity: i.quantity.toString(),
      unitPrice: i.unitPrice.toString(),
    }));
    let rows: Prisma.ProformaInvoiceItemCreateManyInput[] | null = null;
    if (dto.items) {
      rows = dto.items.map((it, n) => {
        if (!new D(it.quantity).gt(0))
          throw new BadRequestException(
            `Item ${n + 1}: quantity must be greater than zero.`,
          );
        if (
          it.quotationItemId &&
          !p.quotation?.items.some((x) => x.id === it.quotationItemId)
        )
          throw new BadRequestException(
            `Item ${n + 1}: unknown quotation item.`,
          );
        const price = roundPrice(it.unitPrice, settings.unitPricePrecision);
        return {
          organizationId: a.organizationId,
          piId: id,
          sortOrder: n,
          quotationItemId: it.quotationItemId ?? null,
          productId: it.productId ?? null,
          description: it.description.trim(),
          hsCode: it.hsCode ?? null,
          specification: it.specification ?? null,
          packaging: it.packaging ?? null,
          quantity: it.quantity,
          unit: it.unit.trim().toUpperCase(),
          unitPrice: price.toString(),
          totalPrice: lineTotal(it.quantity, price).toString(),
        };
      });
      items = rows.map((r) => ({
        quantity: String(r.quantity),
        unitPrice: String(r.unitPrice),
      }));
    }
    const t = documentTotals(
      items,
      String(data.additionalCharges ?? p.additionalCharges),
      String(data.discount ?? p.discount),
    );
    data.subtotal = t.subtotal ?? '0';
    data.totalAmount = t.total ?? '0';
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, p, dto.expectedRowVersion, data, {
        status: 'DRAFT',
      });
      if (rows) {
        await tx.proformaInvoiceItem.deleteMany({ where: { piId: id } });
        if (rows.length)
          await tx.proformaInvoiceItem.createMany({ data: rows });
      }
    });
    return this.detail(a, id);
  }

  private async problems(p: Row) {
    const out: string[] = [];
    if (!p.buyerCompanyId && !p.buyerName) out.push('Select a buyer.');
    if (!p.items.length) out.push('Add at least one item.');
    p.items.forEach((i, n) => {
      if (!i.quantity.gt(0))
        out.push(`Item ${n + 1}: quantity must be greater than zero.`);
      if (!i.unitPrice.gt(0))
        out.push(`Item ${n + 1}: unit price must be greater than zero.`);
    });
    if (!p.incoterm) out.push('Select an Incoterm.');
    if (p.totalAmount.lt(0)) out.push('Total cannot be negative.');
    const o = await this.prisma.organization.findUnique({
      where: { id: p.organizationId },
      select: { name: true, email: true, addressLine1: true },
    });
    if (!o?.name || !(o.email || o.addressLine1))
      out.push(
        'Complete your organization profile (address or email) in Organization Settings.',
      );
    return out;
  }

  async issue(a: Actor, id: string, expected?: number) {
    const p = await this.load(a.organizationId, id);
    if (p.status !== 'DRAFT')
      throw new ConflictException(
        `Only a draft can be issued (current: ${p.status.toLowerCase()}).`,
      );
    const problems = await this.problems(p);
    if (problems.length)
      throw new BadRequestException({
        message: 'This proforma invoice cannot be issued yet.',
        details: { problems },
      });
    const settings = await this.core.rawSettings(a.organizationId);
    const exporter = await this.core.exporterSnapshot(a.organizationId);
    const buyer =
      (p.buyerSnapshot as unknown as PartySnapshot | null) ??
      (await this.core.buyerSnapshot(
        a.organizationId,
        p.buyerCompanyId,
        p.buyerName,
        null,
      ));
    await this.prisma.$transaction(async (tx) => {
      await this.touch(
        tx,
        p,
        expected,
        {
          status: 'ISSUED',
          issuedAt: new Date(),
          issuedByUserId: a.userId,
          issueDate: p.issueDate ?? startOfToday(),
          exporterSnapshot: exporter as unknown as Prisma.InputJsonValue,
          buyerSnapshot: buyer as unknown as Prisma.InputJsonValue,
          bankDetailsSnapshot: (settings.bankDetails ??
            Prisma.DbNull) as Prisma.InputJsonValue,
        },
        { status: 'DRAFT' },
      );
      await tx.proformaInvoice.updateMany({
        where: {
          organizationId: a.organizationId,
          rootId: p.rootId,
          id: { not: p.id },
          status: { in: ['ISSUED', 'SENT'] },
        },
        data: { status: 'SUPERSEDED', rowVersion: { increment: 1 } },
      });
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'PI',
          entityId: p.id,
          lineageId: p.rootId ?? p.id,
          type: 'ISSUED',
          title: `Proforma invoice ${display(p.piNumber, p.revision)} issued`,
        },
      );
      await this.core.crmActivity(
        tx,
        a.organizationId,
        p.crmLeadId,
        `Proforma invoice ${display(p.piNumber, p.revision)} issued`,
        a.userId,
        { proformaInvoiceId: p.id },
      );
    });
    // No bank details or document body in audit metadata.
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'pi.issued',
      entityType: 'ProformaInvoice',
      entityId: id,
      metadata: { number: p.piNumber, revision: p.revision },
    });
    return this.detail(a, id);
  }

  async revise(a: Actor, id: string, reason: string) {
    const p = await this.load(a.organizationId, id);
    if (p.status !== 'ISSUED' && p.status !== 'SENT')
      throw new ConflictException(
        `A ${p.status.toLowerCase()} proforma invoice cannot be revised.`,
      );
    const lineage = await this.prisma.proformaInvoice.findMany({
      where: { organizationId: a.organizationId, rootId: p.rootId },
      select: { revision: true, status: true },
    });
    if (lineage.some((r) => r.status === 'DRAFT'))
      throw new ConflictException('A draft revision already exists.');
    if (lineage.some((r) => r.revision > p.revision))
      throw new ConflictException('Only the latest revision can be revised.');
    const revision = Math.max(...lineage.map((r) => r.revision)) + 1;
    const n = await this.prisma.$transaction(async (tx) => {
      const row = await tx.proformaInvoice.create({
        data: {
          organizationId: p.organizationId,
          piNumber: p.piNumber,
          revision,
          rootId: p.rootId,
          revisionOfId: p.id,
          revisionReason: reason.trim(),
          source: p.source,
          quotationId: p.quotationId,
          overrideReason: p.overrideReason,
          buyerCompanyId: p.buyerCompanyId,
          buyerName: p.buyerName,
          crmLeadId: p.crmLeadId,
          inquiryId: p.inquiryId,
          validUntil: p.validUntil,
          currency: p.currency,
          incoterm: p.incoterm,
          incotermPlace: p.incotermPlace,
          destinationCountry: p.destinationCountry,
          destinationPort: p.destinationPort,
          paymentTerms: p.paymentTerms,
          deliveryTerms: p.deliveryTerms,
          buyerNotes: p.buyerNotes,
          internalNotes: p.internalNotes,
          terms: p.terms,
          additionalCharges: p.additionalCharges,
          chargesLabel: p.chargesLabel,
          discount: p.discount,
          subtotal: p.subtotal,
          totalAmount: p.totalAmount,
          buyerSnapshot: (p.buyerSnapshot ?? undefined) as
            Prisma.InputJsonValue | undefined,
          createdByUserId: a.userId,
          items: {
            create: p.items.map((i) => ({
              organizationId: i.organizationId,
              sortOrder: i.sortOrder,
              quotationItemId: i.quotationItemId,
              productId: i.productId,
              description: i.description,
              hsCode: i.hsCode,
              specification: i.specification,
              packaging: i.packaging,
              quantity: i.quantity,
              unit: i.unit,
              unitPrice: i.unitPrice,
              totalPrice: i.totalPrice,
            })),
          },
        },
      });
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'PI',
          entityId: row.id,
          lineageId: p.rootId ?? p.id,
          type: 'REVISION_CREATED',
          title: `PI revision ${revision} drafted — ${reason.trim()}`,
        },
      );
      return row;
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'pi.revised',
      entityType: 'ProformaInvoice',
      entityId: n.id,
      metadata: { number: p.piNumber, revision },
    });
    return this.detail(a, n.id);
  }

  async cancel(a: Actor, id: string, dto: ReasonDto) {
    const p = await this.load(a.organizationId, id);
    if (!['DRAFT', 'ISSUED', 'SENT'].includes(p.status))
      throw new ConflictException(
        `A ${p.status.toLowerCase()} proforma invoice cannot be cancelled.`,
      );
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, p, dto.expectedRowVersion, {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: dto.reason.trim(),
      });
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'PI',
          entityId: p.id,
          lineageId: p.rootId ?? p.id,
          type: 'CANCELLED',
          title: `Proforma invoice cancelled — ${dto.reason.trim()}`,
        },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'pi.cancelled',
      entityType: 'ProformaInvoice',
      entityId: id,
    });
    return this.detail(a, id);
  }

  private summary(p: Row, names: Map<string, string>): PiSummary {
    return {
      id: p.id,
      piNumber: p.piNumber,
      revision: p.revision,
      displayNumber: display(p.piNumber, p.revision),
      status: p.status,
      source: p.source as 'QUOTATION' | 'MANUAL',
      buyer: {
        id: p.buyerCompanyId,
        name:
          (p.buyerSnapshot as { name?: string } | null)?.name ??
          p.buyerName ??
          'Buyer',
        countryCode: p.destinationCountry,
      },
      quotation: p.quotation
        ? {
            id: p.quotation.id,
            displayNumber: display(
              p.quotation.quotationNumber,
              p.quotation.revision,
            ),
          }
        : null,
      totalAmount: p.totalAmount.toFixed(2),
      currency: p.currency,
      incoterm: p.incoterm,
      incotermPlace: p.incotermPlace,
      issueDate: day(p.issueDate),
      createdBy: names.get(p.createdByUserId) ?? null,
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async list(a: Actor, q: ListQueryDto): Promise<CommercialList<PiSummary>> {
    const and: Prisma.ProformaInvoiceWhereInput[] = [
      { organizationId: a.organizationId },
    ];
    and.push(
      q.status
        ? { status: q.status as never }
        : { status: { not: 'SUPERSEDED' } },
    );
    if (q.buyerCompanyId) and.push({ buyerCompanyId: q.buyerCompanyId });
    if (q.crmLeadId) and.push({ crmLeadId: q.crmLeadId });
    if (q.quotationId) and.push({ quotationId: q.quotationId });
    if (q.from || q.to)
      and.push({
        createdAt: {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to ? { lte: new Date(q.to) } : {}),
        },
      });
    const t = q.search?.trim();
    if (t)
      and.push({
        OR: [
          { piNumber: { contains: t, mode: 'insensitive' } },
          { buyerName: { contains: t, mode: 'insensitive' } },
        ],
      });
    const where = { AND: and };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const [total, rows] = await Promise.all([
      this.prisma.proformaInvoice.count({ where }),
      this.prisma.proformaInvoice.findMany({
        where,
        include,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const names = await this.core.userNames(rows.map((r) => r.createdByUserId));
    return {
      items: rows.map((r) => this.summary(r, names)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  /** Material differences between this PI and its quotation (warning only). */
  private differences(p: Row): string[] {
    const q = p.quotation;
    if (!q) return [];
    const out: string[] = [];
    if (q.currency !== p.currency)
      out.push(`Currency ${p.currency} vs quotation ${q.currency}`);
    if (
      (q.incoterm ?? '') !== (p.incoterm ?? '') ||
      normText(q.incotermPlace) !== normText(p.incotermPlace)
    )
      out.push('Incoterm / named place differs from the quotation');
    if (normText(q.paymentTerms) !== normText(p.paymentTerms))
      out.push('Payment terms differ from the quotation');
    if (normText(q.deliveryTerms) !== normText(p.deliveryTerms))
      out.push('Delivery terms differ from the quotation');
    for (const i of p.items) {
      const qi = q.items.find((x) => x.id === i.quotationItemId);
      if (!qi) {
        out.push(`“${i.description}” is not on the quotation`);
        continue;
      }
      if (!qi.quantity.eq(i.quantity))
        out.push(
          `“${i.description}”: quantity ${i.quantity.toString()} vs quotation ${qi.quantity.toString()}`,
        );
      if (qi.unitPrice && !qi.unitPrice.eq(i.unitPrice))
        out.push(
          `“${i.description}”: unit price ${i.unitPrice.toString()} vs quotation ${qi.unitPrice.toString()}`,
        );
    }
    if (q.totalAmount && !q.totalAmount.eq(p.totalAmount))
      out.push(
        `Total ${p.totalAmount.toFixed(2)} vs quotation ${q.totalAmount.toString()}`,
      );
    return out;
  }

  async detail(a: Actor, id: string): Promise<PiDetail> {
    const p = await this.load(a.organizationId, id);
    const [names, lineage, pos] = await Promise.all([
      this.core.userNames([p.createdByUserId]),
      this.prisma.proformaInvoice.findMany({
        where: { organizationId: a.organizationId, rootId: p.rootId },
        select: { id: true, revision: true, status: true },
        orderBy: { revision: 'asc' },
      }),
      this.prisma.buyerPurchaseOrder.findMany({
        where: {
          organizationId: a.organizationId,
          proformaInvoice: { rootId: p.rootId },
        },
        select: { id: true, poNumber: true, status: true },
      }),
    ]);
    const reveal = this.core.canSeeBank(a.role);
    const can = (x: Parameters<typeof roleHasPermission>[1]) =>
      roleHasPermission(a.role, x);
    const latest = Math.max(...lineage.map((r) => r.revision));
    const actions: string[] = [];
    if (p.status === 'DRAFT' && can('proforma_invoice.edit'))
      actions.push('edit');
    if (p.status === 'DRAFT' && can('proforma_invoice.issue'))
      actions.push('issue');
    if (
      ['ISSUED', 'SENT'].includes(p.status) &&
      p.revision === latest &&
      !lineage.some((r) => r.status === 'DRAFT') &&
      can('proforma_invoice.edit')
    )
      actions.push('revise');
    if (
      ['DRAFT', 'ISSUED', 'SENT'].includes(p.status) &&
      can('proforma_invoice.edit')
    )
      actions.push('cancel');
    if (reveal) actions.push('download');
    if (['ISSUED', 'SENT'].includes(p.status) && can('purchase_orders.create'))
      actions.push('record_po');
    const bank = (p.status === 'DRAFT'
      ? ((await this.core.rawSettings(a.organizationId)).bankDetails ?? null)
      : (p.bankDetailsSnapshot ?? null)) as unknown as BankDetails | null;
    return {
      ...this.summary(p, names),
      rootId: p.rootId ?? p.id,
      rowVersion: p.rowVersion,
      revisionReason: p.revisionReason,
      crmLeadId: p.crmLeadId,
      inquiryId: p.inquiryId,
      validUntil: day(p.validUntil),
      destinationCountry: p.destinationCountry,
      destinationPort: p.destinationPort,
      paymentTerms: p.paymentTerms,
      deliveryTerms: p.deliveryTerms,
      buyerNotes: p.buyerNotes,
      internalNotes: roleHasPermission(a.role, 'proforma_invoice.edit')
        ? p.internalNotes
        : null,
      terms: p.terms,
      subtotal: p.subtotal.toFixed(2),
      additionalCharges: p.additionalCharges.toFixed(2),
      chargesLabel: p.chargesLabel,
      discount: p.discount.toFixed(2),
      items: p.items.map((i) => ({
        id: i.id,
        sortOrder: i.sortOrder,
        quotationItemId: i.quotationItemId,
        productId: i.productId,
        description: i.description,
        hsCode: i.hsCode,
        specification: i.specification,
        packaging: i.packaging,
        quantity: i.quantity.toString(),
        unit: i.unit,
        unitPrice: i.unitPrice.toString(),
        totalPrice: i.totalPrice.toFixed(2),
      })),
      buyerSnapshot: p.buyerSnapshot as unknown as PartySnapshot | null,
      exporterSnapshot: p.exporterSnapshot as unknown as PartySnapshot | null,
      bankDetails: this.core.maskBank(bank, reveal),
      bankDetailsMasked: Boolean(bank) && !reveal,
      overrideReason: p.overrideReason,
      differencesFromQuotation: this.differences(p),
      issuedAt: iso(p.issuedAt),
      cancellation: p.cancelledAt
        ? { at: p.cancelledAt.toISOString(), reason: p.cancelReason ?? '' }
        : null,
      revisions: lineage,
      purchaseOrders: pos,
      issueProblems: p.status === 'DRAFT' ? await this.problems(p) : [],
      events: await this.core.events(a.organizationId, [
        p.rootId ?? p.id,
        ...pos.map((x) => x.id),
      ]),
      availableActions: actions,
    };
  }

  /** PI PDF contains bank details, so it is limited to roles that may see them. Issued PIs render stored snapshots only. */
  async pdf(a: Actor, id: string) {
    if (!this.core.canSeeBank(a.role))
      throw new ForbiddenException(
        'You do not have access to download proforma invoices (they contain bank details).',
      );
    const p = await this.load(a.organizationId, id);
    const draft = p.status === 'DRAFT';
    const exporter =
      (p.exporterSnapshot as unknown as PartySnapshot | null) ??
      (await this.core.exporterSnapshot(a.organizationId));
    const buyer =
      (p.buyerSnapshot as unknown as PartySnapshot | null) ??
      (await this.core.buyerSnapshot(
        a.organizationId,
        p.buyerCompanyId,
        p.buyerName,
        null,
      ));
    const bank = (draft
      ? (await this.core.rawSettings(a.organizationId)).bankDetails
      : p.bankDetailsSnapshot) as unknown as BankDetails | null;
    const num = display(p.piNumber, p.revision);
    const buf = renderCommercialPdf(
      {
        title: 'PROFORMA INVOICE',
        number: num,
        draft,
        issueDate: day(p.issueDate),
        validUntil: day(p.validUntil),
        exporter,
        buyer,
        currency: p.currency,
        items: p.items.map((i) => ({
          description: i.description,
          hsCode: i.hsCode,
          specification: i.specification,
          packaging: i.packaging,
          quantity: i.quantity.toString(),
          unit: i.unit,
          unitPrice: i.unitPrice.toString(),
          total: i.totalPrice.toFixed(2),
        })),
        subtotal: p.subtotal.toFixed(2),
        charges: p.additionalCharges.gt(0)
          ? {
              label: p.chargesLabel || 'Additional charges',
              amount: p.additionalCharges.toFixed(2),
            }
          : null,
        discount: p.discount.toFixed(2),
        total: p.totalAmount.toFixed(2),
        incoterm: p.incoterm
          ? `${p.incoterm}${p.incotermPlace ? ` ${p.incotermPlace}` : ''}`
          : null,
        destination:
          [
            p.destinationPort,
            p.destinationCountry ? countryLabel(p.destinationCountry) : null,
          ]
            .filter(Boolean)
            .join(', ') || null,
        paymentTerms: p.paymentTerms,
        deliveryTerms: p.deliveryTerms,
        buyerNotes: p.buyerNotes,
        terms: p.terms,
        bank,
        reference: p.quotation
          ? `Ref. quotation ${display(p.quotation.quotationNumber, p.quotation.revision)}`
          : null,
        footer: 'Proforma invoice - not a tax or commercial invoice.',
      },
      exporter.hasLogo ? await this.core.logo(a.organizationId) : null,
    );
    return {
      buffer: buf,
      filename: `${num.replace(/\s+/g, '-')}${draft ? '-DRAFT' : ''}.pdf`,
    };
  }
}
