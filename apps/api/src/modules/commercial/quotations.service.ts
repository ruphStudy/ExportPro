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
  type CostingResult,
  countryLabel,
  isCostingCurrency,
  isValidCountryCode,
  type PartySnapshot,
  type QuotationDetail,
  type QuotationItem as QuotationItemView,
  type QuotationSummary,
  roleHasPermission,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { AuditService } from '../audit/audit.service';
import { D } from '../costing/costing-calculator';
import { documentTotals, lineTotal, roundPrice } from './commercial-math';
import {
  type Actor,
  CommercialCoreService,
  day,
  iso,
  type Tx,
} from './commercial-core.service';
import { renderCommercialPdf } from './pdf/commercial-pdf';
import type {
  AcceptQuotationDto,
  CreateQuotationDto,
  ListQueryDto,
  QuotationItemDto,
  ReasonDto,
  UpdateQuotationDto,
} from './commercial.dto';

const include = {
  items: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.QuotationInclude;
type Row = Prisma.QuotationGetPayload<{ include: typeof include }>;
/** Money values always carry 2 decimals. */
const m = (d: Prisma.Decimal | null | undefined) =>
  d === null || d === undefined ? null : d.toFixed(2);
const s = (d: Prisma.Decimal | null | undefined) =>
  d === null || d === undefined ? null : d.toString();
const DAY = 86_400_000;
const startOfToday = () => new Date(new Date().toISOString().slice(0, 10));
const OPEN_ISSUED = ['ISSUED', 'SENT'] as const;

interface CostingPrice {
  unitPrice: string;
  costingUnitPrice: string;
  snapshot: Record<string, unknown>;
  unit: string;
  quantity: string;
  productId: string | null;
  incoterm: string;
  incotermPlace: string | null;
  destination: string | null;
  buyerCompanyId: string | null;
  crmLeadId: string | null;
  description: string;
  hsCode: string | null;
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly core: CommercialCoreService,
  ) {}

  private async load(organizationId: string, id: string): Promise<Row> {
    const q = await this.prisma.quotation.findFirst({
      where: { id, organizationId },
      include,
    });
    if (!q) throw new NotFoundException('Quotation not found.');
    return q;
  }

  /** Lazily marks issued quotations past validUntil as EXPIRED (deterministic; no scheduler needed). */
  async expireDue(organizationId: string) {
    await this.prisma.quotation.updateMany({
      where: {
        organizationId,
        status: { in: [...OPEN_ISSUED] },
        validUntil: { lt: startOfToday() },
      },
      data: { status: 'EXPIRED', expiredAt: new Date() },
    });
  }

  private async touch(
    tx: Tx,
    q: { id: string; organizationId: string },
    expected: number | undefined,
    data: Prisma.QuotationUncheckedUpdateManyInput,
    extraWhere: Prisma.QuotationWhereInput = {},
  ) {
    const r = await tx.quotation.updateMany({
      where: {
        id: q.id,
        organizationId: q.organizationId,
        ...extraWhere,
        ...(expected !== undefined ? { rowVersion: expected } : {}),
      },
      data: { ...data, rowVersion: { increment: 1 } },
    });
    if (!r.count) throw CommercialCoreService.conflict();
  }

  // ------------------------------------------------------------- pricing

  /**
   * Unit price from a Sprint 14 costing: the immutable READY/LOCKED snapshot
   * when present (else the live result, flagged LIVE). Never recalculated
   * here; the quotation currency must equal the costing's quote currency.
   */
  async costingPrice(
    organizationId: string,
    costingId: string,
    scenarioId: string | null,
    currency: string,
    precision: number,
  ): Promise<CostingPrice> {
    const c = await this.prisma.exportCosting.findFirst({
      where: { id: costingId, organizationId },
      include: {
        scenarios: true,
        product: true,
        snapshots: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('Costing not found.');
    const sc = scenarioId
      ? c.scenarios.find((x) => x.id === scenarioId)
      : c.scenarios.find((x) => x.isBase);
    if (!sc) throw new NotFoundException('Costing scenario not found.');
    if (c.quoteCurrency !== currency)
      throw new BadRequestException(
        `Costing ${c.reference} prices in ${c.quoteCurrency}; this quotation is in ${currency}. Prices are not converted automatically.`,
      );
    const snap =
      c.status === 'READY' || c.status === 'LOCKED'
        ? (c.snapshots.find((x) => x.kind === 'LOCKED') ??
          c.snapshots.find((x) => x.kind === 'READY'))
        : undefined;
    const result = ((snap
      ? (snap.results as Record<string, unknown>)[sc.id]
      : sc.result) ?? null) as CostingResult | null;
    const price = result?.pricing?.sellingPricePerUnitQuote;
    if (!result?.complete || !price)
      throw new BadRequestException(
        `Costing ${c.reference} (${sc.name}) has no complete selling price in ${c.quoteCurrency}. Complete its pricing and FX first.`,
      );
    return {
      unitPrice: roundPrice(price, precision).toString(),
      costingUnitPrice: price,
      unit: result.quantityUnit,
      quantity: result.quantity,
      productId: c.productId,
      incoterm: sc.incoterm,
      incotermPlace: sc.incotermPlace,
      destination: c.destinationCountryCode,
      buyerCompanyId: c.buyerCompanyId,
      crmLeadId: c.crmLeadId,
      description: c.product?.displayName ?? c.name,
      hsCode: c.product?.itcHsCode ?? c.product?.hsCode ?? null,
      // Internal only — never rendered on buyer documents.
      snapshot: {
        costingId: c.id,
        reference: c.reference,
        version: c.version,
        status: c.status,
        scenarioId: sc.id,
        scenarioName: sc.name,
        snapshotKind: snap ? snap.kind : 'LIVE',
        snapshotId: snap?.id ?? null,
        formulaVersion: result.formulaVersion,
        calculatedAt: result.calculatedAt,
        incoterm: result.incoterm,
        quantity: result.quantity,
        quantityUnit: result.quantityUnit,
        quoteCurrency: c.quoteCurrency,
        sellingPricePerUnitQuote: price,
        calculationCurrency: result.calculationCurrency,
        costPerUnit: result.costPerUnit,
        marginPercent: result.pricing?.marginPercent ?? null,
        markupPercent: result.pricing?.markupPercent ?? null,
        fxUsed: result.fxUsed,
      },
    };
  }

  // -------------------------------------------------------------- create

  async create(a: Actor, dto: CreateQuotationDto) {
    const org = a.organizationId;
    const settings = await this.core.rawSettings(org);
    let inquiryId = dto.inquiryId ?? null;
    if (dto.quotationRequestId) {
      const qr = await this.prisma.quotationRequest.findFirst({
        where: { id: dto.quotationRequestId, organizationId: org },
      });
      if (!qr) throw new NotFoundException('Quotation request not found.');
      inquiryId = qr.inquiryId;
    }
    const inquiry = inquiryId
      ? await this.prisma.buyerInquiry.findFirst({
          where: { id: inquiryId, organizationId: org },
          include: {
            items: { orderBy: { sortOrder: 'asc' } },
            quotationRequest: true,
          },
        })
      : null;
    if (inquiryId && !inquiry)
      throw new NotFoundException('Inquiry not found.');
    const costing = dto.costingId
      ? await this.prisma.exportCosting.findFirst({
          where: { id: dto.costingId, organizationId: org },
        })
      : null;
    if (dto.costingId && !costing)
      throw new NotFoundException('Costing not found.');
    if (
      costing &&
      costing.status !== 'READY' &&
      costing.status !== 'LOCKED' &&
      !dto.acknowledgeDraftCosting
    )
      throw new ConflictException({
        message: `Costing ${costing.reference} is ${costing.status.toLowerCase()} — its pricing may still change. Mark it ready/locked first, or confirm quoting from a draft.`,
        details: { code: 'DRAFT_COSTING' },
      });
    const lead = dto.crmLeadId
      ? await this.prisma.buyerLead.findFirst({
          where: { id: dto.crmLeadId, organizationId: org },
        })
      : null;
    if (dto.crmLeadId && !lead)
      throw new NotFoundException('CRM lead not found.');
    const buyerCompanyId =
      dto.buyerCompanyId ??
      inquiry?.buyerCompanyId ??
      costing?.buyerCompanyId ??
      lead?.buyerCompanyId ??
      null;
    const buyer = buyerCompanyId
      ? await this.prisma.buyerCompany.findFirst({
          where: {
            id: buyerCompanyId,
            OR: [{ ownerOrganizationId: null }, { ownerOrganizationId: org }],
          },
        })
      : null;
    if (buyerCompanyId && !buyer)
      throw new NotFoundException('Buyer not found.');
    const currency =
      dto.currency ??
      costing?.quoteCurrency ??
      inquiry?.items.find((i) => i.priceCurrency)?.priceCurrency ??
      'USD';
    if (!isCostingCurrency(currency))
      throw new BadRequestException(`Unsupported currency ${currency}.`);
    const conf = (inquiry?.confirmedRfq ?? null) as {
      destination?: { countryCode?: string | null; port?: string | null };
      incoterm?: { term?: string | null; place?: string | null };
      paymentTerms?: {
        raw?: string | null;
        type?: string | null;
        advancePercent?: number | null;
        creditDays?: number | null;
      };
      delivery?: {
        targetDate?: string | null;
        shipmentWindow?: string | null;
        leadTime?: string | null;
      };
    } | null;
    const costingPrice = costing
      ? await this.costingPrice(
          org,
          costing.id,
          dto.costingScenarioId ?? null,
          currency,
          settings.unitPricePrecision,
        )
      : null;

    // Items: confirmed RFQ items (prices entered or applied from a costing); or the costing's product.
    type NewItem = Omit<
      Prisma.QuotationItemUncheckedCreateInput,
      'quotationId' | 'organizationId'
    >;
    const items: NewItem[] = [];
    if (inquiry?.items.length) {
      inquiry.items.forEach((it, n) => {
        const fromCosting =
          costingPrice &&
          costingPrice.productId &&
          it.productId === costingPrice.productId &&
          (it.quantityUnit ?? '').toUpperCase() === costingPrice.unit;
        items.push({
          sortOrder: n,
          productId: it.productId,
          inquiryItemId: it.id,
          description: it.productName,
          hsCode: it.hsCode,
          specification: it.specification,
          packaging: it.packaging,
          quantity: it.quantity ?? '1',
          unit: it.quantityUnit ?? 'UNIT',
          ...(fromCosting
            ? {
                unitPrice: costingPrice.unitPrice,
                costingUnitPrice: costingPrice.costingUnitPrice,
                priceSource: 'COSTING',
                costingId: costing!.id,
                costingScenarioId: costingPrice.snapshot.scenarioId as string,
                pricingSnapshot: costingPrice.snapshot as Prisma.InputJsonValue,
              }
            : {}),
        });
      });
    } else if (costingPrice) {
      items.push({
        sortOrder: 0,
        productId: costingPrice.productId,
        description: costingPrice.description,
        hsCode: costingPrice.hsCode,
        quantity: costingPrice.quantity,
        unit: costingPrice.unit,
        unitPrice: costingPrice.unitPrice,
        costingUnitPrice: costingPrice.costingUnitPrice,
        priceSource: 'COSTING',
        costingId: costing!.id,
        costingScenarioId: costingPrice.snapshot.scenarioId as string,
        pricingSnapshot: costingPrice.snapshot as Prisma.InputJsonValue,
      });
    }
    const payment = conf?.paymentTerms?.raw ?? null;
    const delivery =
      [
        conf?.delivery?.targetDate && `Delivery by ${conf.delivery.targetDate}`,
        conf?.delivery?.shipmentWindow &&
          `Shipment window: ${conf.delivery.shipmentWindow}`,
        conf?.delivery?.leadTime && `Lead time: ${conf.delivery.leadTime}`,
      ]
        .filter(Boolean)
        .join('; ') || null;
    const today = startOfToday();
    const totals = documentTotals(
      items.map((i) => ({
        quantity: String(i.quantity),
        unitPrice:
          i.unitPrice === undefined || i.unitPrice === null
            ? null
            : String(i.unitPrice),
      })),
      '0',
      '0',
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.core.nextNumber(
        tx,
        org,
        'QUOTATION',
        settings.quotationPrefix,
        settings.yearlyReset,
      );
      const q = await tx.quotation.create({
        data: {
          organizationId: org,
          quotationNumber: number,
          source: dto.quotationRequestId
            ? 'QUOTATION_REQUEST'
            : inquiry
              ? 'INQUIRY'
              : costing
                ? 'COSTING'
                : lead
                  ? 'CRM_LEAD'
                  : buyer
                    ? 'BUYER'
                    : 'MANUAL',
          buyerCompanyId: buyer?.id ?? null,
          buyerName:
            buyer?.canonicalName ??
            dto.buyerName?.trim() ??
            inquiry?.buyerName ??
            null,
          crmLeadId:
            lead?.id ?? inquiry?.crmLeadId ?? costing?.crmLeadId ?? null,
          inquiryId: inquiry?.id ?? null,
          quotationRequestId:
            dto.quotationRequestId ?? inquiry?.quotationRequest?.id ?? null,
          costingId: costing?.id ?? null,
          currency,
          incoterm: conf?.incoterm?.term ?? costingPrice?.incoterm ?? null,
          incotermPlace:
            conf?.incoterm?.place ?? costingPrice?.incotermPlace ?? null,
          originCountry: 'IN',
          destinationCountry:
            conf?.destination?.countryCode ??
            costingPrice?.destination ??
            buyer?.countryCode ??
            null,
          destinationPort: conf?.destination?.port ?? null,
          paymentTerms: payment,
          deliveryTerms: delivery,
          validUntil: new Date(
            today.getTime() + settings.defaultValidityDays * DAY,
          ),
          termsAndConditions: settings.quotationTerms,
          subtotal: totals.subtotal,
          totalAmount: totals.total,
          createdByUserId: a.userId,
          items: {
            create: items.map((i) => ({
              ...i,
              organizationId: org,
              totalPrice: i.unitPrice
                ? lineTotal(String(i.quantity), String(i.unitPrice)).toString()
                : null,
            })),
          },
        },
      });
      await tx.quotation.update({
        where: { id: q.id },
        data: { rootId: q.id },
      });
      if (q.quotationRequestId)
        await tx.quotationRequest.updateMany({
          where: { id: q.quotationRequestId, organizationId: org },
          data: { status: 'QUOTATION_CREATED' },
        });
      await this.core.event(
        tx,
        { organizationId: org, userId: a.userId },
        {
          entityType: 'QUOTATION',
          entityId: q.id,
          lineageId: q.id,
          type: 'CREATED',
          title: `Quotation ${number} created (draft)`,
          metadata: { source: q.source },
        },
      );
      return q;
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'quotation.created',
      entityType: 'Quotation',
      entityId: created.id,
      metadata: { number: created.quotationNumber, source: created.source },
    });
    return this.detail(a, created.id);
  }

  // -------------------------------------------------------------- update

  async update(a: Actor, id: string, dto: UpdateQuotationDto) {
    const q = await this.load(a.organizationId, id);
    if (q.status !== 'DRAFT')
      throw new ConflictException(
        'Issued quotations cannot be edited. Create a revision.',
      );
    const settings = await this.core.rawSettings(a.organizationId);
    const data: Prisma.QuotationUncheckedUpdateManyInput = {};
    const set = <K extends keyof UpdateQuotationDto>(
      k: K,
      f: (v: NonNullable<UpdateQuotationDto[K]> | null) => unknown = (v) => v,
    ) => {
      if (dto[k] !== undefined)
        (data as Record<string, unknown>)[k] = f(
          dto[k] as NonNullable<UpdateQuotationDto[K]> | null,
        );
    };
    if (dto.buyerCompanyId !== undefined) {
      if (dto.buyerCompanyId) {
        const b = await this.prisma.buyerCompany.findFirst({
          where: {
            id: dto.buyerCompanyId,
            OR: [
              { ownerOrganizationId: null },
              { ownerOrganizationId: a.organizationId },
            ],
          },
        });
        if (!b) throw new NotFoundException('Buyer not found.');
        data.buyerName = b.canonicalName;
      }
      data.buyerCompanyId = dto.buyerCompanyId;
    }
    if (dto.buyerName !== undefined && !dto.buyerCompanyId && !q.buyerCompanyId)
      data.buyerName = dto.buyerName?.trim() || null;
    if (
      dto.crmLeadId !== undefined &&
      dto.crmLeadId &&
      !(await this.prisma.buyerLead.findFirst({
        where: { id: dto.crmLeadId, organizationId: a.organizationId },
      }))
    )
      throw new NotFoundException('CRM lead not found.');
    set('crmLeadId');
    set('buyerContactId');
    for (const k of ['originCountry', 'destinationCountry'] as const)
      if (dto[k] && !isValidCountryCode(dto[k]!))
        throw new BadRequestException('Unsupported country.');
    for (const k of [
      'incoterm',
      'incotermPlace',
      'originCountry',
      'destinationCountry',
      'destinationPort',
      'paymentTerms',
      'deliveryTerms',
      'leadTime',
      'shipmentWindow',
      'partialShipment',
      'transshipment',
      'buyerNotes',
      'internalNotes',
      'termsAndConditions',
      'chargesLabel',
      'additionalCharges',
      'discount',
    ] as const)
      set(k);
    set('issueDate', (v) => (v ? new Date(v as string) : null));
    set('validUntil', (v) => (v ? new Date(v as string) : null));
    let currency = q.currency;
    let clearPrices = false;
    if (dto.currency && dto.currency !== q.currency) {
      if (!isCostingCurrency(dto.currency))
        throw new BadRequestException(`Unsupported currency ${dto.currency}.`);
      if (
        q.items.some((i) => i.unitPrice !== null) &&
        !dto.clearPricesOnCurrencyChange
      )
        throw new BadRequestException({
          message:
            'Changing currency requires re-entering prices (no automatic FX conversion).',
          details: { code: 'CURRENCY_CHANGE_REQUIRES_REPRICE' },
        });
      currency = dto.currency;
      data.currency = currency;
      clearPrices = true;
    }

    // Items (full replacement list; existing ids keep their costing link/snapshot).
    let itemRows:
      Omit<Prisma.QuotationItemUncheckedCreateInput, 'quotationId'>[] | null =
      null;
    if (dto.items || clearPrices) {
      const src: QuotationItemDto[] =
        dto.items ??
        q.items.map((i) => ({
          id: i.id,
          description: i.description,
          quantity: i.quantity.toString(),
          unit: i.unit,
        }));
      itemRows = [];
      for (const [n, it] of src.entries()) {
        const prev = it.id ? q.items.find((x) => x.id === it.id) : undefined;
        if (it.id && !prev)
          throw new NotFoundException('Quotation item not found.');
        if (!new D(it.quantity).gt(0))
          throw new BadRequestException(
            `Item ${n + 1}: quantity must be greater than zero.`,
          );
        if (
          it.productId &&
          !(await this.prisma.organizationProduct.findFirst({
            where: { id: it.productId, organizationId: a.organizationId },
          }))
        )
          throw new NotFoundException('Product not found.');
        const row: Omit<
          Prisma.QuotationItemUncheckedCreateInput,
          'quotationId'
        > = {
          organizationId: a.organizationId,
          sortOrder: n,
          productId:
            it.productId !== undefined
              ? it.productId
              : (prev?.productId ?? null),
          inquiryItemId:
            it.inquiryItemId !== undefined
              ? it.inquiryItemId
              : (prev?.inquiryItemId ?? null),
          description: it.description.trim(),
          hsCode: it.hsCode !== undefined ? it.hsCode : (prev?.hsCode ?? null),
          specification:
            it.specification !== undefined
              ? it.specification
              : (prev?.specification ?? null),
          packaging:
            it.packaging !== undefined
              ? it.packaging
              : (prev?.packaging ?? null),
          quantity: it.quantity,
          unit: it.unit.trim().toUpperCase(),
          deliveryNotes:
            it.deliveryNotes !== undefined
              ? it.deliveryNotes
              : (prev?.deliveryNotes ?? null),
          countryOfOrigin:
            it.countryOfOrigin !== undefined
              ? it.countryOfOrigin
              : (prev?.countryOfOrigin ?? null),
          costingId: prev?.costingId ?? null,
          costingScenarioId: prev?.costingScenarioId ?? null,
          pricingSnapshot: (prev?.pricingSnapshot ?? undefined) as
            Prisma.InputJsonValue | undefined,
          costingUnitPrice: prev?.costingUnitPrice ?? null,
          priceSource: prev?.priceSource ?? 'MANUAL',
          overrideReason: prev?.overrideReason ?? null,
          overriddenByUserId: prev?.overriddenByUserId ?? null,
          unitPrice: clearPrices ? null : (prev?.unitPrice ?? null),
        };
        const relink =
          it.costingId !== undefined &&
          it.costingId !== (prev?.costingId ?? null);
        if (it.costingId === null && relink)
          Object.assign(row, {
            costingId: null,
            costingScenarioId: null,
            pricingSnapshot: Prisma.DbNull,
            costingUnitPrice: null,
            priceSource: 'MANUAL',
            overrideReason: null,
            overriddenByUserId: null,
          });
        if ((it.costingId && relink) || it.applyCostingPrice) {
          const cid = it.costingId ?? (row.costingId as string | null);
          if (!cid)
            throw new BadRequestException(
              `Item ${n + 1}: link a costing first.`,
            );
          const cp = await this.costingPrice(
            a.organizationId,
            cid,
            it.costingScenarioId ??
              (row.costingScenarioId as string | null) ??
              null,
            currency,
            settings.unitPricePrecision,
          );
          if (cp.unit !== row.unit)
            throw new BadRequestException(
              `Item ${n + 1}: costing is priced per ${cp.unit} but the item unit is ${row.unit}.`,
            );
          Object.assign(row, {
            costingId: cid,
            costingScenarioId: cp.snapshot.scenarioId,
            pricingSnapshot: cp.snapshot as Prisma.InputJsonValue,
            costingUnitPrice: cp.costingUnitPrice,
            unitPrice: cp.unitPrice,
            priceSource: 'COSTING',
            overrideReason: null,
            overriddenByUserId: null,
          });
        }
        if (
          it.unitPrice !== undefined &&
          !it.applyCostingPrice &&
          !(it.costingId && relink)
        ) {
          const price =
            it.unitPrice === null
              ? null
              : roundPrice(
                  it.unitPrice,
                  settings.unitPricePrecision,
                ).toString();
          row.unitPrice = price;
          const costingPrice = row.costingUnitPrice
            ? roundPrice(
                String(row.costingUnitPrice),
                settings.unitPricePrecision,
              ).toString()
            : null;
          if (
            costingPrice &&
            price !== null &&
            !new D(price).eq(costingPrice)
          ) {
            const reasonChanged =
              it.overrideReason && it.overrideReason !== prev?.overrideReason;
            const priceChanged =
              !prev?.unitPrice || !new D(price).eq(prev.unitPrice);
            if (priceChanged && !it.overrideReason)
              throw new BadRequestException({
                message: `Item ${n + 1}: price differs from the selected costing (${costingPrice}). Give an override reason.`,
                details: {
                  code: 'PRICE_OVERRIDE_REASON_REQUIRED',
                  itemIndex: n,
                },
              });
            if (priceChanged || reasonChanged)
              Object.assign(row, {
                priceSource: 'OVERRIDE',
                overrideReason: it.overrideReason,
                overriddenByUserId: a.userId,
              });
          } else if (costingPrice && price !== null)
            Object.assign(row, {
              priceSource: 'COSTING',
              overrideReason: null,
              overriddenByUserId: null,
            });
          else if (!costingPrice) row.priceSource = 'MANUAL';
        }
        row.totalPrice = row.unitPrice
          ? lineTotal(String(row.quantity), String(row.unitPrice)).toString()
          : null;
        itemRows.push(row);
      }
    }
    const effItems =
      itemRows ??
      q.items.map((i) => ({
        quantity: i.quantity.toString(),
        unitPrice: s(i.unitPrice),
      }));
    const totals = documentTotals(
      effItems.map((i) => ({
        quantity: String(i.quantity),
        unitPrice:
          i.unitPrice === null || i.unitPrice === undefined
            ? null
            : String(i.unitPrice),
      })),
      String(data.additionalCharges ?? q.additionalCharges),
      String(data.discount ?? q.discount),
    );
    data.subtotal = totals.subtotal;
    data.totalAmount = totals.total;
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, q, dto.expectedRowVersion, data, {
        status: 'DRAFT',
      });
      if (itemRows) {
        await tx.quotationItem.deleteMany({ where: { quotationId: id } });
        if (itemRows.length)
          await tx.quotationItem.createMany({
            data: itemRows.map((r) => ({
              ...r,
              quotationId: id,
            })) as Prisma.QuotationItemCreateManyInput[],
          });
      }
    });
    return this.detail(a, id);
  }

  // --------------------------------------------------------------- issue

  private async issueProblems(q: Row) {
    const p: string[] = [];
    if (!q.buyerCompanyId && !q.buyerName) p.push('Select a buyer.');
    if (!q.items.length) p.push('Add at least one item.');
    q.items.forEach((i, n) => {
      if (!i.quantity.gt(0))
        p.push(`Item ${n + 1}: quantity must be greater than zero.`);
      if (i.unitPrice === null || !i.unitPrice.gt(0))
        p.push(`Item ${n + 1}: enter a unit price greater than zero.`);
    });
    if (!isCostingCurrency(q.currency)) p.push('Select a valid currency.');
    if (!q.incoterm) p.push('Select an Incoterm.');
    if (!q.validUntil) p.push('Set the validity date.');
    else if (q.validUntil < startOfToday())
      p.push('Validity date is in the past.');
    if (q.totalAmount === null) p.push('Totals are incomplete.');
    else if (q.totalAmount.lt(0))
      p.push('Total cannot be negative (discount exceeds subtotal + charges).');
    const o = await this.prisma.organization.findUnique({
      where: { id: q.organizationId },
      select: {
        name: true,
        email: true,
        addressLine1: true,
        city: true,
        country: true,
      },
    });
    if (!o?.name || !(o.email || o.addressLine1))
      p.push(
        'Complete your organization profile (address or email) in Organization Settings — it appears on the quotation.',
      );
    return p;
  }

  async issue(a: Actor, id: string, expected?: number) {
    const q = await this.load(a.organizationId, id);
    if (q.status !== 'DRAFT')
      throw new ConflictException(
        `Only a draft can be issued (current: ${q.status.toLowerCase()}).`,
      );
    const problems = await this.issueProblems(q);
    if (problems.length)
      throw new BadRequestException({
        message: 'This quotation cannot be issued yet.',
        details: { problems },
      });
    const [exporter, buyer] = await Promise.all([
      this.core.exporterSnapshot(a.organizationId),
      this.core.buyerSnapshot(
        a.organizationId,
        q.buyerCompanyId,
        q.buyerName,
        q.buyerContactId,
      ),
    ]);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.touch(
        tx,
        q,
        expected,
        {
          status: 'ISSUED',
          issuedAt: now,
          issuedByUserId: a.userId,
          issueDate: q.issueDate ?? startOfToday(),
          exporterSnapshot: exporter as unknown as Prisma.InputJsonValue,
          buyerSnapshot: buyer as unknown as Prisma.InputJsonValue,
        },
        { status: 'DRAFT' },
      );
      // A new revision supersedes earlier open revisions in the lineage (never deleted).
      await tx.quotation.updateMany({
        where: {
          organizationId: a.organizationId,
          rootId: q.rootId,
          id: { not: q.id },
          status: { in: ['ISSUED', 'SENT', 'EXPIRED', 'REJECTED', 'READY'] },
        },
        data: { status: 'SUPERSEDED', rowVersion: { increment: 1 } },
      });
      if (q.quotationRequestId)
        await tx.quotationRequest.updateMany({
          where: { id: q.quotationRequestId, organizationId: a.organizationId },
          data: { status: 'QUOTATION_ISSUED' },
        });
      const label = `${q.quotationNumber}${q.revision > 1 ? ` Rev ${q.revision}` : ''}`;
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'QUOTATION',
          entityId: q.id,
          lineageId: q.rootId ?? q.id,
          type: 'ISSUED',
          title: `Quotation ${label} issued`,
        },
      );
      await this.core.crmActivity(
        tx,
        a.organizationId,
        q.crmLeadId,
        `Quotation ${label} issued`,
        a.userId,
        { quotationId: q.id },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'quotation.issued',
      entityType: 'Quotation',
      entityId: id,
      metadata: { number: q.quotationNumber, revision: q.revision },
    });
    return this.detail(a, id);
  }

  async revise(a: Actor, id: string, reason: string) {
    const q = await this.load(a.organizationId, id);
    if (!['ISSUED', 'SENT', 'EXPIRED', 'REJECTED'].includes(q.status))
      throw new ConflictException(
        `A ${q.status.toLowerCase()} quotation cannot be revised.`,
      );
    const lineage = await this.prisma.quotation.findMany({
      where: { organizationId: a.organizationId, rootId: q.rootId },
      select: { revision: true, status: true },
    });
    if (lineage.some((r) => r.status === 'DRAFT'))
      throw new ConflictException(
        'A draft revision already exists for this quotation.',
      );
    if (lineage.some((r) => r.revision > q.revision))
      throw new ConflictException('Only the latest revision can be revised.');
    const revision = Math.max(...lineage.map((r) => r.revision)) + 1;
    const created = await this.prisma.$transaction(async (tx) => {
      const n = await tx.quotation.create({
        data: {
          organizationId: q.organizationId,
          quotationNumber: q.quotationNumber,
          revision,
          rootId: q.rootId,
          revisionOfId: q.id,
          revisionReason: reason.trim(),
          source: q.source,
          buyerCompanyId: q.buyerCompanyId,
          buyerName: q.buyerName,
          buyerContactId: q.buyerContactId,
          crmLeadId: q.crmLeadId,
          inquiryId: q.inquiryId,
          quotationRequestId: q.quotationRequestId,
          costingId: q.costingId,
          currency: q.currency,
          incoterm: q.incoterm,
          incotermPlace: q.incotermPlace,
          originCountry: q.originCountry,
          destinationCountry: q.destinationCountry,
          destinationPort: q.destinationPort,
          paymentTerms: q.paymentTerms,
          deliveryTerms: q.deliveryTerms,
          leadTime: q.leadTime,
          shipmentWindow: q.shipmentWindow,
          partialShipment: q.partialShipment,
          transshipment: q.transshipment,
          buyerNotes: q.buyerNotes,
          internalNotes: q.internalNotes,
          termsAndConditions: q.termsAndConditions,
          additionalCharges: q.additionalCharges,
          chargesLabel: q.chargesLabel,
          discount: q.discount,
          subtotal: q.subtotal,
          totalAmount: q.totalAmount,
          validUntil:
            q.validUntil && q.validUntil >= startOfToday()
              ? q.validUntil
              : null,
          createdByUserId: a.userId,
          items: {
            create: q.items.map((i) => ({
              organizationId: q.organizationId,
              sortOrder: i.sortOrder,
              productId: i.productId,
              inquiryItemId: i.inquiryItemId,
              description: i.description,
              hsCode: i.hsCode,
              specification: i.specification,
              packaging: i.packaging,
              quantity: i.quantity,
              unit: i.unit,
              unitPrice: i.unitPrice,
              totalPrice: i.totalPrice,
              deliveryNotes: i.deliveryNotes,
              countryOfOrigin: i.countryOfOrigin,
              priceSource: i.priceSource,
              costingId: i.costingId,
              costingScenarioId: i.costingScenarioId,
              pricingSnapshot: (i.pricingSnapshot ?? undefined) as
                Prisma.InputJsonValue | undefined,
              costingUnitPrice: i.costingUnitPrice,
              overrideReason: i.overrideReason,
              overriddenByUserId: i.overriddenByUserId,
            })),
          },
        },
      });
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'QUOTATION',
          entityId: n.id,
          lineageId: q.rootId ?? q.id,
          type: 'REVISION_CREATED',
          title: `Revision ${revision} drafted — ${reason.trim()}`,
        },
      );
      return n;
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'quotation.revised',
      entityType: 'Quotation',
      entityId: created.id,
      metadata: { number: q.quotationNumber, revision, revisionOf: q.id },
    });
    return this.detail(a, created.id);
  }

  async accept(a: Actor, id: string, dto: AcceptQuotationDto) {
    await this.expireDue(a.organizationId);
    const q = await this.load(a.organizationId, id);
    if (q.status === 'EXPIRED')
      throw new ConflictException(
        'This quotation has expired. Create a revision with a new validity date.',
      );
    if (!(OPEN_ISSUED as readonly string[]).includes(q.status))
      throw new ConflictException(
        `A ${q.status.toLowerCase()} quotation cannot be accepted.`,
      );
    const label = `${q.quotationNumber}${q.revision > 1 ? ` Rev ${q.revision}` : ''}`;
    await this.prisma.$transaction(async (tx) => {
      await this.touch(
        tx,
        q,
        dto.expectedRowVersion,
        {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          acceptedByUserId: a.userId,
          acceptanceSource: dto.source,
          buyerReference: dto.buyerReference?.trim() || null,
          acceptanceNote: dto.note?.trim() || null,
        },
        { status: { in: [...OPEN_ISSUED] } },
      );
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'QUOTATION',
          entityId: q.id,
          lineageId: q.rootId ?? q.id,
          type: 'ACCEPTED',
          title: `Quotation ${label} accepted by buyer (${dto.source.toLowerCase().replace('_', ' ')})`,
        },
      );
      await this.core.crmActivity(
        tx,
        a.organizationId,
        q.crmLeadId,
        `Quotation ${label} accepted`,
        a.userId,
        { quotationId: q.id },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'quotation.accepted',
      entityType: 'Quotation',
      entityId: id,
      metadata: { source: dto.source },
    });
    return this.detail(a, id);
  }

  async reject(a: Actor, id: string, dto: ReasonDto) {
    await this.expireDue(a.organizationId);
    const q = await this.load(a.organizationId, id);
    if (![...OPEN_ISSUED, 'EXPIRED'].includes(q.status as never))
      throw new ConflictException(
        `A ${q.status.toLowerCase()} quotation cannot be rejected.`,
      );
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, q, dto.expectedRowVersion, {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectionReason: dto.reason.trim(),
      });
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'QUOTATION',
          entityId: q.id,
          lineageId: q.rootId ?? q.id,
          type: 'REJECTED',
          title: `Quotation rejected by buyer — ${dto.reason.trim()}`,
        },
      );
      await this.core.crmActivity(
        tx,
        a.organizationId,
        q.crmLeadId,
        `Quotation ${q.quotationNumber} rejected`,
        a.userId,
        { quotationId: q.id },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'quotation.rejected',
      entityType: 'Quotation',
      entityId: id,
    });
    return this.detail(a, id);
  }

  async cancel(a: Actor, id: string, dto: ReasonDto) {
    const q = await this.load(a.organizationId, id);
    if (!['DRAFT', 'ISSUED', 'SENT', 'EXPIRED'].includes(q.status))
      throw new ConflictException(
        `A ${q.status.toLowerCase()} quotation cannot be cancelled.`,
      );
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, q, dto.expectedRowVersion, {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: dto.reason.trim(),
      });
      await this.core.event(
        tx,
        { organizationId: a.organizationId, userId: a.userId },
        {
          entityType: 'QUOTATION',
          entityId: q.id,
          lineageId: q.rootId ?? q.id,
          type: 'CANCELLED',
          title: `Quotation cancelled — ${dto.reason.trim()}`,
        },
      );
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'quotation.cancelled',
      entityType: 'Quotation',
      entityId: id,
    });
    return this.detail(a, id);
  }

  // --------------------------------------------------------------- reads

  private expiry(
    status: string,
    validUntil: Date | null,
  ): QuotationSummary['expiry'] {
    if (!validUntil || !['ISSUED', 'SENT', 'EXPIRED', 'DRAFT'].includes(status))
      return { state: null, days: null };
    const days = Math.round(
      (validUntil.getTime() - startOfToday().getTime()) / DAY,
    );
    if (status === 'EXPIRED' || days < 0) return { state: 'EXPIRED', days };
    if (days === 0) return { state: 'EXPIRES_TODAY', days };
    if (days <= 7) return { state: 'EXPIRES_SOON', days };
    return { state: 'VALID', days };
  }

  private summary(
    q: Row,
    names: Map<string, string>,
    inquiryRefs: Map<string, string>,
    buyerCountry: Map<string, string>,
  ): QuotationSummary {
    const products = q.items.map((i) => i.description);
    return {
      id: q.id,
      quotationNumber: q.quotationNumber,
      revision: q.revision,
      displayNumber: `${q.quotationNumber}${q.revision > 1 ? ` Rev ${q.revision}` : ''}`,
      status: q.status,
      buyer: {
        id: q.buyerCompanyId,
        name:
          (q.buyerSnapshot as unknown as PartySnapshot | null)?.name ??
          q.buyerName ??
          'Buyer not set',
        countryCode: q.buyerCompanyId
          ? (buyerCountry.get(q.buyerCompanyId) ?? null)
          : null,
      },
      inquiry: q.inquiryId
        ? {
            id: q.inquiryId,
            reference: inquiryRefs.get(q.inquiryId) ?? 'Inquiry',
          }
        : null,
      productSummary:
        products.length > 2
          ? `${products.slice(0, 2).join(', ')} +${products.length - 2}`
          : products.join(', ') || '—',
      totalAmount: m(q.totalAmount),
      currency: q.currency,
      incoterm: q.incoterm,
      incotermPlace: q.incotermPlace,
      issueDate: day(q.issueDate),
      validUntil: day(q.validUntil),
      expiry: this.expiry(q.status, q.validUntil),
      createdBy: names.get(q.createdByUserId) ?? null,
      updatedAt: q.updatedAt.toISOString(),
    };
  }

  private async lookups(organizationId: string, rows: Row[]) {
    const [names, inquiries, buyers] = await Promise.all([
      this.core.userNames(rows.map((r) => r.createdByUserId)),
      this.prisma.buyerInquiry.findMany({
        where: {
          organizationId,
          id: {
            in: rows
              .map((r) => r.inquiryId)
              .filter((x): x is string => Boolean(x)),
          },
        },
        select: { id: true, reference: true },
      }),
      this.prisma.buyerCompany.findMany({
        where: {
          id: {
            in: rows
              .map((r) => r.buyerCompanyId)
              .filter((x): x is string => Boolean(x)),
          },
        },
        select: { id: true, countryCode: true },
      }),
    ]);
    return {
      names,
      inquiryRefs: new Map(inquiries.map((i) => [i.id, i.reference])),
      buyerCountry: new Map(buyers.map((b) => [b.id, b.countryCode])),
    };
  }

  async list(
    a: Actor,
    q: ListQueryDto,
  ): Promise<CommercialList<QuotationSummary>> {
    await this.expireDue(a.organizationId);
    const and: Prisma.QuotationWhereInput[] = [
      { organizationId: a.organizationId },
    ];
    if (q.status) and.push({ status: q.status as never });
    else and.push({ status: { not: 'SUPERSEDED' } });
    if (q.buyerCompanyId) and.push({ buyerCompanyId: q.buyerCompanyId });
    if (q.crmLeadId) and.push({ crmLeadId: q.crmLeadId });
    if (q.inquiryId) and.push({ inquiryId: q.inquiryId });
    if (q.costingId)
      and.push({
        OR: [
          { costingId: q.costingId },
          { items: { some: { costingId: q.costingId } } },
        ],
      });
    if (q.productId) and.push({ items: { some: { productId: q.productId } } });
    if (q.country) and.push({ destinationCountry: q.country });
    if (q.createdBy) and.push({ createdByUserId: q.createdBy });
    if (q.from || q.to)
      and.push({
        createdAt: {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to ? { lte: new Date(q.to) } : {}),
        },
      });
    const t = q.search?.trim();
    if (t) {
      const c = { contains: t, mode: 'insensitive' as const };
      const inq = await this.prisma.buyerInquiry.findMany({
        where: { organizationId: a.organizationId, reference: c },
        select: { id: true },
        take: 50,
      });
      and.push({
        OR: [
          { quotationNumber: c },
          { buyerName: c },
          { items: { some: { description: c } } },
          ...(inq.length ? [{ inquiryId: { in: inq.map((i) => i.id) } }] : []),
        ],
      });
    }
    const where = { AND: and };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const [total, rows] = await Promise.all([
      this.prisma.quotation.count({ where }),
      this.prisma.quotation.findMany({
        where,
        include,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const l = await this.lookups(a.organizationId, rows);
    return {
      items: rows.map((r) =>
        this.summary(r, l.names, l.inquiryRefs, l.buyerCountry),
      ),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private itemView(
    i: Row['items'][number],
    names: Map<string, string>,
    precision: number,
    internal: boolean,
  ): QuotationItemView {
    const snap = i.pricingSnapshot as {
      costingId?: string;
      scenarioId?: string;
      reference?: string;
      snapshotKind?: 'READY' | 'LOCKED' | 'LIVE';
      formulaVersion?: string;
    } | null;
    const costingPrice = i.costingUnitPrice
      ? roundPrice(i.costingUnitPrice.toString(), precision)
      : null;
    return {
      id: i.id,
      sortOrder: i.sortOrder,
      productId: i.productId,
      inquiryItemId: i.inquiryItemId,
      description: i.description,
      hsCode: i.hsCode,
      specification: i.specification,
      packaging: i.packaging,
      quantity: i.quantity.toString(),
      unit: i.unit,
      unitPrice: s(i.unitPrice),
      totalPrice: m(i.totalPrice),
      deliveryNotes: i.deliveryNotes,
      countryOfOrigin: i.countryOfOrigin,
      priceSource: i.priceSource as QuotationItemView['priceSource'],
      costing:
        internal && snap?.costingId && costingPrice
          ? {
              costingId: snap.costingId,
              scenarioId: snap.scenarioId ?? '',
              reference: snap.reference ?? '',
              costingUnitPrice: costingPrice.toString(),
              snapshotKind: snap.snapshotKind ?? 'LIVE',
              formulaVersion: snap.formulaVersion ?? '',
            }
          : null,
      priceDiffersFromCosting: Boolean(
        costingPrice && i.unitPrice && !i.unitPrice.eq(costingPrice),
      ),
      overrideReason: i.overrideReason,
      overriddenBy: i.overriddenByUserId
        ? (names.get(i.overriddenByUserId) ?? null)
        : null,
    };
  }

  async detail(a: Actor, id: string): Promise<QuotationDetail> {
    await this.expireDue(a.organizationId);
    const q = await this.load(a.organizationId, id);
    const settings = await this.core.rawSettings(a.organizationId);
    const [l, lineage, pis, pos] = await Promise.all([
      this.lookups(a.organizationId, [q]),
      this.prisma.quotation.findMany({
        where: { organizationId: a.organizationId, rootId: q.rootId },
        select: { id: true, revision: true, status: true, issuedAt: true },
        orderBy: { revision: 'asc' },
      }),
      this.prisma.proformaInvoice.findMany({
        where: {
          organizationId: a.organizationId,
          quotation: { rootId: q.rootId },
        },
        select: {
          id: true,
          piNumber: true,
          revision: true,
          status: true,
          rootId: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.buyerPurchaseOrder.findMany({
        where: {
          organizationId: a.organizationId,
          quotation: { rootId: q.rootId },
        },
        select: { id: true, poNumber: true, status: true },
      }),
    ]);
    const names = await this.core.userNames([
      q.createdByUserId,
      q.acceptedByUserId,
      ...q.items.map((i) => i.overriddenByUserId),
    ]);
    const internal =
      roleHasPermission(a.role, 'quotations.edit') ||
      roleHasPermission(a.role, 'commercial.settings');
    const problems = q.status === 'DRAFT' ? await this.issueProblems(q) : [];
    const events = await this.core.events(a.organizationId, [
      q.rootId ?? q.id,
      ...new Set(pis.map((p) => p.rootId ?? p.id)),
      ...pos.map((p) => p.id),
    ]);
    const crm = await this.core.crmContext(
      a.organizationId,
      q.crmLeadId,
      'QUOTATION',
      'A quotation was issued to this buyer.',
    );
    const can = (p: Parameters<typeof roleHasPermission>[1]) =>
      roleHasPermission(a.role, p);
    const actions: string[] = [];
    const latest = Math.max(...lineage.map((r) => r.revision));
    if (q.status === 'DRAFT' && can('quotations.edit')) actions.push('edit');
    if (q.status === 'DRAFT' && can('quotations.issue')) actions.push('issue');
    if (
      (OPEN_ISSUED as readonly string[]).includes(q.status) &&
      can('quotations.accept')
    )
      actions.push('accept', 'reject');
    if (q.status === 'EXPIRED' && can('quotations.accept'))
      actions.push('reject');
    if (
      ['ISSUED', 'SENT', 'EXPIRED', 'REJECTED'].includes(q.status) &&
      q.revision === latest &&
      !lineage.some((r) => r.status === 'DRAFT') &&
      can('quotations.revise')
    )
      actions.push('revise');
    if (
      ['DRAFT', 'ISSUED', 'SENT', 'EXPIRED'].includes(q.status) &&
      can('quotations.edit')
    )
      actions.push('cancel');
    if (
      q.status === 'ACCEPTED' &&
      can('proforma_invoice.create') &&
      !pis.some((p) => p.status !== 'CANCELLED')
    )
      actions.push('create_pi');
    if (
      (OPEN_ISSUED as readonly string[]).includes(q.status) &&
      can('proforma_invoice.issue') &&
      can('quotations.accept') &&
      !pis.some((p) => p.status !== 'CANCELLED')
    )
      actions.push('create_pi_override');
    if (
      ['ACCEPTED', 'ISSUED', 'SENT'].includes(q.status) &&
      can('purchase_orders.create')
    )
      actions.push('record_po');
    const buyerSnap = q.buyerSnapshot as unknown as PartySnapshot | null;
    const display = `${q.quotationNumber}${q.revision > 1 ? ` Rev ${q.revision}` : ''}`;
    return {
      ...this.summary(q, l.names, l.inquiryRefs, l.buyerCountry),
      rootId: q.rootId ?? q.id,
      rowVersion: q.rowVersion,
      revisionReason: q.revisionReason,
      crmLeadId: q.crmLeadId,
      quotationRequestId: q.quotationRequestId,
      costingId: q.costingId,
      originCountry: q.originCountry,
      destinationCountry: q.destinationCountry,
      destinationPort: q.destinationPort,
      paymentTerms: q.paymentTerms,
      deliveryTerms: q.deliveryTerms,
      leadTime: q.leadTime,
      shipmentWindow: q.shipmentWindow,
      partialShipment: q.partialShipment,
      transshipment: q.transshipment,
      buyerNotes: q.buyerNotes,
      internalNotes: internal ? q.internalNotes : null,
      termsAndConditions: q.termsAndConditions,
      additionalCharges: q.additionalCharges.toFixed(2),
      chargesLabel: q.chargesLabel,
      discount: q.discount.toFixed(2),
      subtotal: m(q.subtotal),
      items: q.items.map((i) =>
        this.itemView(i, names, settings.unitPricePrecision, internal),
      ),
      buyerSnapshot: buyerSnap,
      exporterSnapshot: q.exporterSnapshot as unknown as PartySnapshot | null,
      issuedAt: iso(q.issuedAt),
      acceptance: q.acceptedAt
        ? {
            at: q.acceptedAt.toISOString(),
            by: q.acceptedByUserId
              ? (names.get(q.acceptedByUserId) ?? null)
              : null,
            source: (q.acceptanceSource ?? 'MANUAL') as 'MANUAL',
            buyerReference: q.buyerReference,
            note: q.acceptanceNote,
          }
        : null,
      rejection: q.rejectedAt
        ? { at: q.rejectedAt.toISOString(), reason: q.rejectionReason ?? '' }
        : null,
      cancellation: q.cancelledAt
        ? { at: q.cancelledAt.toISOString(), reason: q.cancelReason ?? '' }
        : null,
      revisions: lineage.map((r) => ({
        id: r.id,
        revision: r.revision,
        status: r.status,
        issuedAt: iso(r.issuedAt),
      })),
      proformaInvoices: pis.map((p) => ({
        id: p.id,
        displayNumber: `${p.piNumber}${p.revision > 1 ? ` Rev ${p.revision}` : ''}`,
        status: p.status,
      })),
      purchaseOrders: pos,
      issueProblems: problems,
      crm,
      emailDraft:
        q.status === 'DRAFT' || q.status === 'CANCELLED'
          ? null
          : [
              `Subject: Quotation ${display}`,
              '',
              `Dear ${buyerSnap?.contactName ?? buyerSnap?.name ?? 'Sir/Madam'},`,
              '',
              `Please find attached our quotation ${display}${q.validUntil ? `, valid until ${day(q.validUntil)}` : ''}.`,
              `Total: ${q.currency} ${m(q.totalAmount)}${q.incoterm ? ` (${q.incoterm}${q.incotermPlace ? ` ${q.incotermPlace}` : ''})` : ''}.`,
              '',
              'We look forward to your confirmation.',
              '',
              'Best regards,',
            ].join('\n'),
      events,
      availableActions: actions,
    };
  }

  /** PDF of a quotation. Issued revisions render only stored snapshot data, so output is stable. */
  async pdf(a: Actor, id: string) {
    await this.expireDue(a.organizationId);
    const q = await this.load(a.organizationId, id);
    const draft = q.status === 'DRAFT';
    const exporter =
      (q.exporterSnapshot as unknown as PartySnapshot | null) ??
      (await this.core.exporterSnapshot(a.organizationId));
    const buyer =
      (q.buyerSnapshot as unknown as PartySnapshot | null) ??
      (await this.core.buyerSnapshot(
        a.organizationId,
        q.buyerCompanyId,
        q.buyerName,
        q.buyerContactId,
      ));
    const display = `${q.quotationNumber}${q.revision > 1 ? ` Rev ${q.revision}` : ''}`;
    const delivery =
      [
        q.deliveryTerms,
        q.leadTime && `Lead time: ${q.leadTime}`,
        q.shipmentWindow && `Shipment window: ${q.shipmentWindow}`,
        q.partialShipment !== null &&
          `Partial shipment: ${q.partialShipment ? 'allowed' : 'not allowed'}`,
        q.transshipment !== null &&
          `Transshipment: ${q.transshipment ? 'allowed' : 'not allowed'}`,
      ]
        .filter(Boolean)
        .join('\n') || null;
    const buf = renderCommercialPdf(
      {
        title: 'QUOTATION',
        number: display,
        draft,
        issueDate: day(q.issueDate),
        validUntil: day(q.validUntil),
        exporter,
        buyer,
        currency: q.currency,
        items: q.items.map((i) => ({
          description: i.description,
          hsCode: i.hsCode,
          specification: i.specification,
          packaging: i.packaging,
          quantity: i.quantity.toString(),
          unit: i.unit,
          unitPrice: s(i.unitPrice),
          total: m(i.totalPrice),
        })),
        subtotal: m(q.subtotal),
        charges: q.additionalCharges.gt(0)
          ? {
              label: q.chargesLabel || 'Additional charges',
              amount: q.additionalCharges.toFixed(2),
            }
          : null,
        discount: q.discount.toFixed(2),
        total: m(q.totalAmount),
        incoterm: q.incoterm
          ? `${q.incoterm}${q.incotermPlace ? ` ${q.incotermPlace}` : ''}`
          : null,
        destination:
          [
            q.destinationPort,
            q.destinationCountry ? countryLabel(q.destinationCountry) : null,
          ]
            .filter(Boolean)
            .join(', ') || null,
        paymentTerms: q.paymentTerms,
        deliveryTerms: delivery,
        buyerNotes: q.buyerNotes,
        terms: q.termsAndConditions,
        bank: null,
        reference:
          q.status === 'SUPERSEDED'
            ? 'Superseded by a later revision'
            : q.status === 'CANCELLED'
              ? 'Cancelled'
              : null,
        footer: 'Prices exclude taxes/duties unless explicitly stated.',
      },
      exporter.hasLogo ? await this.core.logo(a.organizationId) : null,
    );
    return {
      buffer: buf,
      filename: `${display.replace(/\s+/g, '-')}${draft ? '-DRAFT' : ''}.pdf`,
    };
  }

  async actionSummary(organizationId: string) {
    await this.expireDue(organizationId);
    const soon = new Date(startOfToday().getTime() + 7 * DAY);
    const [quotationsExpiringSoon, draftPis, posNeedingReview] =
      await Promise.all([
        this.prisma.quotation.count({
          where: {
            organizationId,
            status: { in: [...OPEN_ISSUED] },
            validUntil: { lte: soon },
          },
        }),
        this.prisma.proformaInvoice.count({
          where: { organizationId, status: 'DRAFT' },
        }),
        this.prisma.buyerPurchaseOrder.count({
          where: {
            organizationId,
            status: {
              in: ['RECEIVED', 'UNDER_REVIEW', 'DISCREPANCY', 'MATCHED'],
            },
          },
        }),
      ]);
    return { quotationsExpiringSoon, draftPis, posNeedingReview };
  }

  assertCanOverridePi(a: Actor) {
    if (!(
      roleHasPermission(a.role, 'proforma_invoice.issue') &&
      roleHasPermission(a.role, 'quotations.accept')
    ))
      throw new ForbiddenException(
        'Only a manager can create a PI from a quotation that is not accepted.',
      );
  }
}
