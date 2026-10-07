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
  roleHasPermission,
  type FreightComparison,
  type FreightQuoteDetail,
  type FreightQuoteSummary,
  type FreightRequestView,
  type LogisticsList,
  type LogisticsProviderView,
  type ShipmentTransportMode,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
  day,
  iso,
} from '../commercial/commercial-core.service';
import { D, money } from '../costing/costing-calculator';
import {
  INQUIRY_ATTACHMENT_EXTENSIONS,
  MAX_INQUIRY_ATTACHMENT_BYTES,
  StorageService,
} from '../storage/storage.service';
import {
  CompareQuotesDto,
  FreightQuoteDto,
  FreightRequestDto,
  ListQueryDto,
  ProviderDto,
  ReasonDto,
  SelectQuoteDto,
} from './logistics.dto';
import { LogisticsContextService } from './logistics-context.service';
import { scoreQuotes } from './logistics-rules';

type Quote = Prisma.FreightQuoteGetPayload<{
  include: { charges: true; provider: true };
}>;
const DAY = 86400000;
const today = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
export const quoteValidity = (
  until: Date | null,
): FreightQuoteSummary['validity'] => {
  if (!until) return 'UNKNOWN';
  const t = today().getTime();
  if (until.getTime() < t) return 'EXPIRED';
  if (until.getTime() - t <= 3 * DAY) return 'EXPIRING_SOON';
  return 'VALID';
};
const dec = (v: Prisma.Decimal | null | undefined) =>
  v === null || v === undefined ? null : v.toString();
const TBC = 'To be confirmed';

@Injectable()
export class FreightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly core: CommercialCoreService,
    private readonly storage: StorageService,
    private readonly ctx: LogisticsContextService,
  ) {}

  private can(a: Actor, p: Parameters<typeof roleHasPermission>[1]) {
    return roleHasPermission(a.role, p);
  }

  // ------------------------------------------------------------ providers

  private providerView(
    p: Prisma.LogisticsProviderGetPayload<object>,
  ): LogisticsProviderView {
    return {
      id: p.id,
      name: p.name,
      company: p.company,
      contactPerson: p.contactPerson,
      email: p.email,
      phone: p.phone,
      notes: p.notes,
    };
  }

  async providers(a: Actor) {
    return (
      await this.prisma.logisticsProvider.findMany({
        where: { organizationId: a.organizationId },
        orderBy: { name: 'asc' },
      })
    ).map((p) => this.providerView(p));
  }

  async createProvider(a: Actor, dto: ProviderDto) {
    const nameKey = dto.name.trim().toLowerCase().replace(/\s+/g, ' ');
    const dup = await this.prisma.logisticsProvider.findFirst({
      where: { organizationId: a.organizationId, nameKey },
    });
    if (dup)
      throw new ConflictException({
        message: `${dup.name} already exists.`,
        details: { existingProviderId: dup.id },
      });
    const p = await this.prisma.logisticsProvider.create({
      data: {
        organizationId: a.organizationId,
        name: dto.name.trim(),
        nameKey,
        company: dto.company?.trim() || null,
        contactPerson: dto.contactPerson?.trim() || null,
        email: dto.email?.trim() || null,
        phone: dto.phone?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });
    return this.providerView(p);
  }

  // ------------------------------------------------------------- requests

  async requestPrefill(a: Actor, poId: string) {
    const c = await this.ctx.po(a.organizationId, poId);
    return {
      purchaseOrder: {
        id: c.po.id,
        poNumber: c.po.poNumber,
        status: c.po.status,
        buyerName: c.buyer?.canonicalName ?? 'Buyer',
      },
      values: c.values,
    };
  }

  private rfqText(
    r: Prisma.FreightRequestGetPayload<object>,
    exporter: string,
    poNumber: string | null,
  ) {
    const v = (x: string | number | null | undefined, unit = '') =>
      x === null || x === undefined || x === '' ? TBC : `${x}${unit}`;
    return [
      `Subject: Freight quote request ${r.reference}${poNumber ? ` (PO ${poNumber})` : ''}`,
      '',
      'Dear partner,',
      '',
      `Please quote for the following shipment from ${exporter}:`,
      '',
      `Mode: ${r.transportMode}${r.shipmentType ? ` (${r.shipmentType})` : ''}`,
      `Origin: ${v(r.origin)}${r.portOfLoading ? ` — port of loading ${r.portOfLoading}` : ''}`,
      `Destination: ${v(r.destination)}${r.portOfDischarge ? ` — port of discharge ${r.portOfDischarge}` : ''}`,
      `Incoterm: ${v(r.incoterm)}`,
      `Cargo: ${v(r.cargoDescription)}`,
      `Packages: ${v(r.packageCount)}`,
      `Gross weight: ${v(dec(r.grossWeightKg), ' kg')}`,
      `Net weight: ${v(dec(r.netWeightKg), ' kg')}`,
      `Volume: ${v(dec(r.volumeCbm), ' CBM')}`,
      `Cargo ready: ${v(day(r.readyDate))}`,
      `Preferred departure: ${v(day(r.preferredDeparture))}`,
      `Special handling: ${r.specialHandling ?? 'None stated'}`,
      '',
      'Please include: freight and surcharges, origin and destination charges, transit time, routing (direct or transshipment ports), free days, quote validity, inclusions and exclusions.',
      '',
      `Regards,\n${exporter}`,
    ].join('\n');
  }

  async createRequest(a: Actor, dto: FreightRequestDto) {
    const org = a.organizationId;
    let sources: Record<string, string> = {};
    let po: {
      id: string;
      poNumber: string;
      quotationId: string | null;
    } | null = null;
    const data: Record<string, unknown> = {};
    if (dto.purchaseOrderId) {
      const c = await this.ctx.po(org, dto.purchaseOrderId);
      po = c.po;
      const take = (
        field: string,
        given: unknown,
        pre: { value: unknown; source: string },
        fmt?: (x: unknown) => unknown,
      ) => {
        if (given !== undefined && given !== null && given !== '') {
          data[field] = given;
          sources[field] =
            given === (fmt ? fmt(pre.value) : pre.value)
              ? pre.source
              : 'MANUAL';
        } else if (pre.value !== null && pre.value !== undefined) {
          data[field] = fmt ? fmt(pre.value) : pre.value;
          sources[field] = pre.source;
        } else sources[field] = 'NONE';
      };
      take('origin', dto.origin, {
        value: c.label(c.values.originCountry.value as string | null),
        source: c.values.originCountry.source,
      });
      take('destination', dto.destination, {
        value: c.label(c.values.destinationCountry.value as string | null),
        source: c.values.destinationCountry.source,
      });
      take('portOfLoading', dto.portOfLoading, c.values.portOfLoading);
      take('portOfDischarge', dto.portOfDischarge, c.values.portOfDischarge);
      take('incoterm', dto.incoterm, c.values.incoterm);
      take('cargoDescription', dto.cargoDescription, c.values.cargoDescription);
      take('packageCount', dto.packageCount, c.values.packageCount);
      take('grossWeightKg', dto.grossWeightKg, c.values.grossWeightKg);
      take('netWeightKg', dto.netWeightKg, c.values.netWeightKg);
      take('volumeCbm', dto.volumeCbm, c.values.volumeCbm);
    } else {
      Object.assign(data, {
        origin: dto.origin,
        destination: dto.destination,
        portOfLoading: dto.portOfLoading,
        portOfDischarge: dto.portOfDischarge,
        incoterm: dto.incoterm,
        cargoDescription: dto.cargoDescription,
        packageCount: dto.packageCount,
        grossWeightKg: dto.grossWeightKg,
        netWeightKg: dto.netWeightKg,
        volumeCbm: dto.volumeCbm,
      });
      sources = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [
          k,
          v === undefined || v === null ? 'NONE' : 'MANUAL',
        ]),
      );
    }
    const providers = dto.providerIds?.length
      ? await this.prisma.logisticsProvider.findMany({
          where: { organizationId: org, id: { in: dto.providerIds } },
        })
      : [];
    if (dto.providerIds && providers.length !== dto.providerIds.length)
      throw new NotFoundException('Forwarder not found.');
    const r = await this.prisma.$transaction(async (tx) => {
      const reference = await this.core.nextNumber(tx, org, 'FR', 'FR', true);
      const row = await tx.freightRequest.create({
        data: {
          organizationId: org,
          reference,
          purchaseOrderId: po?.id ?? null,
          transportMode: dto.transportMode,
          shipmentType: dto.shipmentType ?? null,
          origin: (data.origin as string) ?? null,
          destination: (data.destination as string) ?? null,
          portOfLoading: (data.portOfLoading as string) ?? null,
          portOfDischarge: (data.portOfDischarge as string) ?? null,
          incoterm: (data.incoterm as string) ?? null,
          cargoDescription: (data.cargoDescription as string) ?? null,
          packageCount: (data.packageCount as number) ?? null,
          grossWeightKg: (data.grossWeightKg as string) ?? null,
          netWeightKg: (data.netWeightKg as string) ?? null,
          volumeCbm: (data.volumeCbm as string) ?? null,
          readyDate: dto.readyDate ? new Date(dto.readyDate) : null,
          preferredDeparture: dto.preferredDeparture
            ? new Date(dto.preferredDeparture)
            : null,
          specialHandling: dto.specialHandling?.trim() || null,
          sources: sources as Prisma.InputJsonValue,
          createdByUserId: a.userId,
        },
      });
      // REQUESTED placeholders record who was asked; they have no price until a real quote is entered.
      for (const p of providers)
        await tx.freightQuote.create({
          data: {
            organizationId: org,
            requestId: row.id,
            purchaseOrderId: po?.id ?? null,
            quotationId: po?.quotationId ?? null,
            providerId: p.id,
            forwarderName: p.name,
            transportMode: dto.transportMode,
            shipmentType: dto.shipmentType ?? null,
            origin: row.origin,
            destination: row.destination,
            portOfLoading: row.portOfLoading,
            portOfDischarge: row.portOfDischarge,
            currency: 'USD',
            status: 'REQUESTED',
            createdByUserId: a.userId,
          },
        });
      await this.core.event(tx, a, {
        entityType: 'FREIGHT',
        entityId: row.id,
        lineageId: po?.id ?? row.id,
        type: 'REQUEST_CREATED',
        title: `Freight request ${reference} prepared${providers.length ? ` for ${providers.map((p) => p.name).join(', ')}` : ''} (send it yourself — nothing is emailed automatically)`,
      });
      return row;
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'freight_request.created',
      entityType: 'FreightRequest',
      entityId: r.id,
      metadata: {
        reference: r.reference,
        purchaseOrderId: po?.id ?? null,
        providers: providers.length,
      },
    });
    return this.request(a, r.id);
  }

  async request(a: Actor, id: string): Promise<FreightRequestView> {
    const r = await this.prisma.freightRequest.findFirst({
      where: { id, organizationId: a.organizationId },
      include: { quotes: { orderBy: { createdAt: 'asc' } } },
    });
    if (!r) throw new NotFoundException('Freight request not found.');
    const po = r.purchaseOrderId
      ? await this.prisma.buyerPurchaseOrder.findFirst({
          where: { id: r.purchaseOrderId, organizationId: a.organizationId },
          select: { id: true, poNumber: true },
        })
      : null;
    const o = await this.prisma.organization.findUniqueOrThrow({
      where: { id: a.organizationId },
      select: { name: true, legalName: true },
    });
    return {
      id: r.id,
      reference: r.reference,
      purchaseOrder: po,
      transportMode: r.transportMode as ShipmentTransportMode,
      shipmentType: r.shipmentType as FreightRequestView['shipmentType'],
      origin: r.origin,
      destination: r.destination,
      portOfLoading: r.portOfLoading,
      portOfDischarge: r.portOfDischarge,
      incoterm: r.incoterm,
      cargoDescription: r.cargoDescription,
      packageCount: r.packageCount,
      grossWeightKg: dec(r.grossWeightKg),
      netWeightKg: dec(r.netWeightKg),
      volumeCbm: dec(r.volumeCbm),
      readyDate: day(r.readyDate),
      preferredDeparture: day(r.preferredDeparture),
      specialHandling: r.specialHandling,
      sources: r.sources as FreightRequestView['sources'],
      rfqText: this.rfqText(r, o.legalName || o.name, po?.poNumber ?? null),
      quotes: r.quotes.map((q) => ({
        id: q.id,
        forwarderName: q.forwarderName,
        status: q.status as FreightQuoteSummary['status'],
        totalCost: q.totalCost?.toFixed(2) ?? null,
        currency: q.currency,
      })),
      createdAt: r.createdAt.toISOString(),
    };
  }

  async requests(a: Actor, purchaseOrderId?: string) {
    const rows = await this.prisma.freightRequest.findMany({
      where: {
        organizationId: a.organizationId,
        ...(purchaseOrderId ? { purchaseOrderId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.request(a, r.id)));
  }

  // --------------------------------------------------------------- quotes

  /** Read-time expiry: a valid/received quote past its validity date becomes EXPIRED (selected quotes keep their history). */
  private async expireDue(org: string) {
    await this.prisma.freightQuote.updateMany({
      where: {
        organizationId: org,
        status: { in: ['VALID', 'RECEIVED'] },
        validityUntil: { lt: today() },
      },
      data: { status: 'EXPIRED' },
    });
  }

  private priced(
    status: string,
    total: Prisma.Decimal | null,
    until: Date | null,
  ) {
    if (total === null) return status === 'REQUESTED' ? 'REQUESTED' : 'DRAFT';
    if (!until) return 'RECEIVED';
    return quoteValidity(until) === 'EXPIRED' ? 'EXPIRED' : 'VALID';
  }

  private async load(org: string, id: string): Promise<Quote> {
    const q = await this.prisma.freightQuote.findFirst({
      where: { id, organizationId: org },
      include: { charges: { orderBy: { sortOrder: 'asc' } }, provider: true },
    });
    if (!q) throw new NotFoundException('Freight quote not found.');
    return q;
  }

  private async summaries(
    org: string,
    rows: Quote[],
  ): Promise<FreightQuoteSummary[]> {
    const pos = await this.prisma.buyerPurchaseOrder.findMany({
      where: {
        organizationId: org,
        id: {
          in: rows.map((r) => r.purchaseOrderId).filter(Boolean) as string[],
        },
      },
      select: { id: true, poNumber: true },
    });
    const ships = await this.prisma.shipment.findMany({
      where: {
        organizationId: org,
        freightQuoteId: { in: rows.map((r) => r.id) },
        status: { not: 'CANCELLED' },
      },
      select: { id: true, freightQuoteId: true },
    });
    return rows.map((q) => ({
      id: q.id,
      requestId: q.requestId,
      purchaseOrder: q.purchaseOrderId
        ? (pos.find((p) => p.id === q.purchaseOrderId) ?? null)
        : null,
      forwarderName: q.forwarderName,
      provider: q.provider ? this.providerView(q.provider) : null,
      quoteReference: q.quoteReference,
      transportMode: q.transportMode as ShipmentTransportMode,
      shipmentType: q.shipmentType as FreightQuoteSummary['shipmentType'],
      shippingLine: q.shippingLine,
      carrier: q.carrier,
      origin: q.origin,
      destination: q.destination,
      portOfLoading: q.portOfLoading,
      portOfDischarge: q.portOfDischarge,
      routeSummary: q.routeSummary,
      transshipmentPorts: q.transshipmentPorts,
      // Direct only when a route is stated without transshipment ports; unknown otherwise.
      direct: q.transshipmentPorts.length
        ? false
        : q.routeSummary
          ? true
          : null,
      currency: q.currency,
      totalCost: q.totalCost?.toFixed(2) ?? null,
      transitDays: q.transitDays,
      freeDays: q.freeDays,
      validityFrom: day(q.validityFrom),
      validityUntil: day(q.validityUntil),
      validity: quoteValidity(q.validityUntil),
      departureDate: day(q.departureDate),
      arrivalDate: day(q.arrivalDate),
      status: q.status as FreightQuoteSummary['status'],
      selected: q.status === 'SELECTED',
      shipmentId: ships.find((s) => s.freightQuoteId === q.id)?.id ?? null,
      updatedAt: q.updatedAt.toISOString(),
    }));
  }

  async list(
    a: Actor,
    q: ListQueryDto,
  ): Promise<LogisticsList<FreightQuoteSummary>> {
    const org = a.organizationId;
    await this.expireDue(org);
    const and: Prisma.FreightQuoteWhereInput[] = [{ organizationId: org }];
    if (q.status) and.push({ status: q.status });
    if (q.mode) and.push({ transportMode: q.mode });
    if (q.purchaseOrderId) and.push({ purchaseOrderId: q.purchaseOrderId });
    const t = q.search?.trim();
    if (t)
      and.push({
        OR: [
          'forwarderName',
          'quoteReference',
          'origin',
          'destination',
          'portOfLoading',
          'portOfDischarge',
          'shippingLine',
          'carrier',
        ].map((f) => ({ [f]: { contains: t, mode: 'insensitive' } })),
      });
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.freightQuote.findMany({
        where,
        include: { charges: true, provider: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.freightQuote.count({ where }),
    ]);
    return {
      items: await this.summaries(org, rows),
      meta: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async detail(a: Actor, id: string): Promise<FreightQuoteDetail> {
    await this.expireDue(a.organizationId);
    const q = await this.load(a.organizationId, id);
    const [sum] = await this.summaries(a.organizationId, [q]);
    const [atts, events, names] = await Promise.all([
      this.prisma.logisticsAttachment.findMany({
        where: {
          organizationId: a.organizationId,
          entityType: 'FREIGHT_QUOTE',
          entityId: q.id,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.core.events(a.organizationId, [q.id]),
      this.core.userNames([q.selectedByUserId]),
    ]);
    const actions: string[] = [];
    const open = !['SELECTED', 'REJECTED', 'CANCELLED'].includes(q.status);
    if (open && this.can(a, 'logistics.freight_quotes.create'))
      actions.push('edit', 'reject', 'cancel', 'attach');
    if (
      q.status === 'SELECTED' &&
      !sum.shipmentId &&
      this.can(a, 'logistics.freight_quotes.create')
    )
      actions.push('attach');
    if (
      q.totalCost !== null &&
      ['RECEIVED', 'VALID', 'EXPIRED'].includes(q.status) &&
      this.can(a, 'logistics.freight_quotes.select')
    )
      actions.push('select');
    if (
      q.status === 'SELECTED' &&
      !sum.shipmentId &&
      q.purchaseOrderId &&
      this.can(a, 'logistics.shipments.create')
    )
      actions.push('create_shipment');
    return {
      ...sum,
      rowVersion: q.rowVersion,
      quotationId: q.quotationId,
      serviceName: q.serviceName,
      containerSummary: q.containerSummary,
      charges: q.charges.map((c) => ({
        id: c.id,
        category:
          c.category as FreightQuoteDetail['charges'][number]['category'],
        label: c.label,
        amount: c.amount.toFixed(2),
      })),
      inclusions: q.inclusions,
      exclusions: q.exclusions,
      terms: q.terms,
      riskNotes: q.riskNotes,
      source: q.source as FreightQuoteDetail['source'],
      selection: q.selectedAt
        ? {
            by: q.selectedByUserId
              ? (names.get(q.selectedByUserId) ?? null)
              : null,
            at: q.selectedAt.toISOString(),
            note: q.selectionNote,
            overrideReason: q.overrideReason,
          }
        : null,
      rejectionReason: q.rejectionReason,
      attachments: atts.map((x) => ({
        id: x.id,
        filename: x.originalFilename,
        mimeType: x.mimeType,
        sizeBytes: x.sizeBytes,
        createdAt: x.createdAt.toISOString(),
      })),
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        actor: e.actor,
        createdAt: e.createdAt,
      })),
      availableActions: [...new Set(actions)],
    };
  }

  private quoteData(dto: FreightQuoteDto) {
    const s = (v: string | null | undefined) =>
      v === undefined ? undefined : v?.trim() || null;
    const dt = (v: string | null | undefined) =>
      v === undefined ? undefined : v ? new Date(v) : null;
    return {
      shippingLine: s(dto.shippingLine),
      carrier: s(dto.carrier),
      serviceName: s(dto.serviceName),
      quoteReference: s(dto.quoteReference),
      transportMode: dto.transportMode,
      shipmentType:
        dto.shipmentType === undefined ? undefined : dto.shipmentType,
      containerSummary: s(dto.containerSummary),
      origin: s(dto.origin),
      destination: s(dto.destination),
      portOfLoading: s(dto.portOfLoading),
      portOfDischarge: s(dto.portOfDischarge),
      routeSummary: s(dto.routeSummary),
      transshipmentPorts: dto.transshipmentPorts
        ?.map((p) => p.trim())
        .filter(Boolean),
      currency: dto.currency,
      transitDays: dto.transitDays,
      freeDays: dto.freeDays,
      validityFrom: dt(dto.validityFrom),
      validityUntil: dt(dto.validityUntil),
      departureDate: dt(dto.departureDate),
      arrivalDate: dt(dto.arrivalDate),
      inclusions: s(dto.inclusions),
      exclusions: s(dto.exclusions),
      terms: s(dto.terms),
      riskNotes: s(dto.riskNotes),
      source: dto.source,
    };
  }

  private validateDates(
    from: Date | null | undefined,
    until: Date | null | undefined,
    dep: Date | null | undefined,
    arr: Date | null | undefined,
  ) {
    if (from && until && until < from)
      throw new BadRequestException(
        'Validity end cannot be before validity start.',
      );
    if (dep && arr && arr < dep)
      throw new BadRequestException('Arrival cannot be before departure.');
  }

  /** Manual entry of a quote received from a forwarder. Totals are the sum of the entered charges (decimal-safe). */
  async create(a: Actor, dto: FreightQuoteDto) {
    const org = a.organizationId;
    const provider = dto.providerId
      ? await this.prisma.logisticsProvider.findFirst({
          where: { id: dto.providerId, organizationId: org },
        })
      : null;
    if (dto.providerId && !provider)
      throw new NotFoundException('Forwarder not found.');
    const name = provider?.name ?? dto.forwarderName?.trim();
    if (!name) throw new BadRequestException('Enter the freight forwarder.');
    const req = dto.requestId
      ? await this.prisma.freightRequest.findFirst({
          where: { id: dto.requestId, organizationId: org },
        })
      : null;
    if (dto.requestId && !req)
      throw new NotFoundException('Freight request not found.');
    const poId = dto.purchaseOrderId ?? req?.purchaseOrderId ?? null;
    const po = poId
      ? await this.prisma.buyerPurchaseOrder.findFirst({
          where: { id: poId, organizationId: org },
        })
      : null;
    if (poId && !po) throw new NotFoundException('Purchase order not found.');
    const d = this.quoteData(dto);
    this.validateDates(
      d.validityFrom,
      d.validityUntil,
      d.departureDate,
      d.arrivalDate,
    );
    const total = dto.charges?.length
      ? dto.charges.reduce((s, c) => s.plus(c.amount), new D(0))
      : null;
    const q = await this.prisma.$transaction(async (tx) => {
      const row = await tx.freightQuote.create({
        data: {
          organizationId: org,
          requestId: req?.id ?? null,
          purchaseOrderId: po?.id ?? null,
          quotationId: po?.quotationId ?? null,
          providerId: provider?.id ?? null,
          forwarderName: name,
          ...Object.fromEntries(
            Object.entries(d).filter(([, v]) => v !== undefined),
          ),
          transportMode: d.transportMode ?? req?.transportMode ?? 'SEA',
          origin: d.origin ?? req?.origin ?? null,
          destination: d.destination ?? req?.destination ?? null,
          portOfLoading: d.portOfLoading ?? req?.portOfLoading ?? null,
          portOfDischarge: d.portOfDischarge ?? req?.portOfDischarge ?? null,
          currency: d.currency ?? 'USD',
          totalCost: total ? money(total) : null,
          status: this.priced(
            'DRAFT',
            total ? new Prisma.Decimal(money(total)) : null,
            d.validityUntil ?? null,
          ),
          createdByUserId: a.userId,
          charges: dto.charges?.length
            ? {
                create: dto.charges.map((c, i) => ({
                  category: c.category,
                  label: c.label?.trim() || null,
                  amount: c.amount,
                  sortOrder: i,
                })),
              }
            : undefined,
        } as Prisma.FreightQuoteUncheckedCreateInput,
      });
      await this.core.event(tx, a, {
        entityType: 'FREIGHT',
        entityId: row.id,
        lineageId: po?.id ?? row.id,
        type: 'QUOTE_ENTERED',
        title: `Freight quote from ${name} entered${row.totalCost ? ` (${row.currency} ${row.totalCost.toFixed(2)})` : ''}`,
      });
      await this.core.event(tx, a, {
        entityType: 'FREIGHT',
        entityId: row.id,
        lineageId: row.id,
        type: 'QUOTE_ENTERED',
        title: `Quote entered manually from ${name}`,
      });
      return row;
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'freight_quote.created',
      entityType: 'FreightQuote',
      entityId: q.id,
      metadata: {
        forwarder: name,
        currency: q.currency,
        total: q.totalCost?.toFixed(2) ?? null,
        purchaseOrderId: q.purchaseOrderId,
      },
    });
    return this.detail(a, q.id);
  }

  async update(a: Actor, id: string, dto: FreightQuoteDto) {
    const q = await this.load(a.organizationId, id);
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== q.rowVersion
    )
      throw CommercialCoreService.conflict();
    if (['SELECTED', 'REJECTED', 'CANCELLED'].includes(q.status))
      throw new ConflictException(
        `A ${q.status.toLowerCase()} quote is kept as history and cannot be edited.`,
      );
    const d = this.quoteData(dto);
    this.validateDates(
      d.validityFrom === undefined ? q.validityFrom : d.validityFrom,
      d.validityUntil === undefined ? q.validityUntil : d.validityUntil,
      d.departureDate === undefined ? q.departureDate : d.departureDate,
      d.arrivalDate === undefined ? q.arrivalDate : d.arrivalDate,
    );
    const total = dto.charges
      ? dto.charges.length
        ? new Prisma.Decimal(
            money(dto.charges.reduce((s, c) => s.plus(c.amount), new D(0))),
          )
        : null
      : q.totalCost;
    const until =
      d.validityUntil === undefined ? q.validityUntil : d.validityUntil;
    await this.prisma.$transaction(async (tx) => {
      if (dto.charges) {
        await tx.freightQuoteCharge.deleteMany({ where: { quoteId: q.id } });
        if (dto.charges.length)
          await tx.freightQuoteCharge.createMany({
            data: dto.charges.map((c, i) => ({
              quoteId: q.id,
              category: c.category,
              label: c.label?.trim() || null,
              amount: c.amount,
              sortOrder: i,
            })),
          });
      }
      await tx.freightQuote.update({
        where: { id: q.id },
        data: {
          ...Object.fromEntries(
            Object.entries(d).filter(([, v]) => v !== undefined),
          ),
          ...(dto.forwarderName
            ? { forwarderName: dto.forwarderName.trim() }
            : {}),
          totalCost: total,
          status: this.priced(q.status, total, until),
          rowVersion: { increment: 1 },
        },
      });
      if (q.status === 'REQUESTED' && total)
        await this.core.event(tx, a, {
          entityType: 'FREIGHT',
          entityId: q.id,
          lineageId: q.id,
          type: 'QUOTE_RECEIVED',
          title: `Quote received from ${q.forwarderName} and entered manually`,
        });
    });
    return this.detail(a, id);
  }

  async select(a: Actor, id: string, dto: SelectQuoteDto) {
    const org = a.organizationId;
    await this.expireDue(org);
    const q = await this.load(org, id);
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== q.rowVersion
    )
      throw CommercialCoreService.conflict();
    if (q.status === 'SELECTED')
      throw new ConflictException('This quote is already selected.');
    if (!q.totalCost || !['RECEIVED', 'VALID', 'EXPIRED'].includes(q.status))
      throw new ConflictException(
        'Only a received quote with a price can be selected.',
      );
    const expired = quoteValidity(q.validityUntil) === 'EXPIRED';
    let override: string | null = null;
    if (expired) {
      if (!dto.overrideReason?.trim())
        throw new ConflictException({
          message: `This quote expired on ${day(q.validityUntil)}. Ask the forwarder to revalidate it, or a manager may override with a reason.`,
          details: { code: 'QUOTE_EXPIRED' },
        });
      if (!this.can(a, 'logistics.override'))
        throw new ForbiddenException(
          'Only a manager can select an expired quote.',
        );
      override = dto.overrideReason.trim();
    }
    const scope: Prisma.FreightQuoteWhereInput = q.purchaseOrderId
      ? { purchaseOrderId: q.purchaseOrderId }
      : q.requestId
        ? { requestId: q.requestId }
        : { id: '__none__' };
    const others = await this.prisma.freightQuote.findMany({
      where: {
        organizationId: org,
        status: 'SELECTED',
        id: { not: q.id },
        ...scope,
      },
    });
    const used = others.length
      ? await this.prisma.shipment.findFirst({
          where: {
            organizationId: org,
            freightQuoteId: { in: others.map((o) => o.id) },
            status: { not: 'CANCELLED' },
          },
        })
      : null;
    if (used)
      throw new ConflictException(
        `Another selected quote is already used by shipment ${used.shipmentNumber}.`,
      );
    await this.prisma.$transaction(async (tx) => {
      for (const o of others) {
        await tx.freightQuote.update({
          where: { id: o.id },
          data: {
            status: this.priced('RECEIVED', o.totalCost, o.validityUntil),
            selectedAt: null,
            selectedByUserId: null,
            selectionNote: null,
            rowVersion: { increment: 1 },
          },
        });
        await this.core.event(tx, a, {
          entityType: 'FREIGHT',
          entityId: o.id,
          lineageId: o.id,
          type: 'DESELECTED',
          title: `Selection moved from ${o.forwarderName} to ${q.forwarderName}`,
        });
      }
      await tx.freightQuote.update({
        where: { id: q.id },
        data: {
          status: 'SELECTED',
          selectedByUserId: a.userId,
          selectedAt: new Date(),
          selectionNote: dto.note?.trim() || null,
          overrideReason: override,
          rowVersion: { increment: 1 },
        },
      });
      await this.core.event(tx, a, {
        entityType: 'FREIGHT',
        entityId: q.id,
        lineageId: q.purchaseOrderId ?? q.id,
        type: 'SELECTED',
        title: `Freight quote from ${q.forwarderName} selected${override ? ' (expired — manager override)' : ''}`,
      });
      await this.core.event(tx, a, {
        entityType: 'FREIGHT',
        entityId: q.id,
        lineageId: q.id,
        type: 'SELECTED',
        title: `Selected by a user${override ? ` with override: ${override}` : ''}`,
      });
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'freight_quote.selected',
      entityType: 'FreightQuote',
      entityId: q.id,
      metadata: {
        forwarder: q.forwarderName,
        total: q.totalCost.toFixed(2),
        currency: q.currency,
        expiredOverride: Boolean(override),
      },
    });
    if (override)
      await this.audit.record({
        organizationId: org,
        actorId: a.userId,
        action: 'freight_quote.override',
        entityType: 'FreightQuote',
        entityId: q.id,
        metadata: { reason: override.slice(0, 300) },
      });
    return this.detail(a, id);
  }

  async close(
    a: Actor,
    id: string,
    dto: ReasonDto,
    status: 'REJECTED' | 'CANCELLED',
  ) {
    const q = await this.load(a.organizationId, id);
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== q.rowVersion
    )
      throw CommercialCoreService.conflict();
    if (['REJECTED', 'CANCELLED'].includes(q.status))
      throw new ConflictException('Already closed.');
    const used = await this.prisma.shipment.findFirst({
      where: {
        organizationId: a.organizationId,
        freightQuoteId: q.id,
        status: { not: 'CANCELLED' },
      },
    });
    if (used)
      throw new ConflictException(`Used by shipment ${used.shipmentNumber}.`);
    await this.prisma.freightQuote.update({
      where: { id: q.id },
      data: {
        status,
        rejectionReason: dto.reason.trim(),
        rowVersion: { increment: 1 },
      },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'FREIGHT',
      entityId: q.id,
      lineageId: q.id,
      type: status,
      title: `Quote ${status.toLowerCase()}: ${dto.reason.trim().slice(0, 120)}`,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action:
        status === 'REJECTED'
          ? 'freight_quote.rejected'
          : 'freight_quote.cancelled',
      entityType: 'FreightQuote',
      entityId: q.id,
      metadata: {},
    });
    return this.detail(a, id);
  }

  /**
   * Side-by-side comparison. Quotes in different currencies are normalized only
   * with an explicit FX snapshot (latest captured for the pair, shown with
   * source/date); without one the total stays un-normalized. Scoring is
   * deterministic and explained; the user selects.
   */
  async compare(a: Actor, dto: CompareQuotesDto): Promise<FreightComparison> {
    const org = a.organizationId;
    await this.expireDue(org);
    const rows = await this.prisma.freightQuote.findMany({
      where: { organizationId: org, id: { in: dto.quoteIds } },
      include: { charges: true, provider: true },
    });
    if (rows.length !== new Set(dto.quoteIds).size)
      throw new NotFoundException('Freight quote not found.');
    const currencies = [...new Set(rows.map((r) => r.currency))];
    const target =
      dto.targetCurrency ?? (currencies.length === 1 ? currencies[0] : null);
    if (!target)
      throw new BadRequestException({
        message: `Quotes are in ${currencies.join(' and ')}. Choose a comparison currency — amounts are only converted with an FX snapshot.`,
        details: { code: 'CURRENCY_REQUIRED', currencies },
      });
    const sums = await this.summaries(org, rows);
    const ordered = dto.quoteIds.map((id) => sums.find((s) => s.id === id)!);
    const notes: string[] = [];
    const out: FreightComparison['rows'] = [];
    for (const s of ordered) {
      let normalized: string | null = null;
      let fx: FreightComparison['rows'][number]['fx'] = null;
      let missing = false;
      if (s.totalCost !== null) {
        if (s.currency === target) normalized = s.totalCost;
        else {
          const direct = await this.prisma.fxRateSnapshot.findFirst({
            where: {
              organizationId: org,
              baseCurrency: s.currency,
              quoteCurrency: target,
            },
            orderBy: { capturedAt: 'desc' },
          });
          const inverse = direct
            ? null
            : await this.prisma.fxRateSnapshot.findFirst({
                where: {
                  organizationId: org,
                  baseCurrency: target,
                  quoteCurrency: s.currency,
                },
                orderBy: { capturedAt: 'desc' },
              });
          const snap = direct ?? inverse;
          if (snap) {
            const rate = direct
              ? new D(snap.rate.toString())
              : new D(1).div(snap.rate.toString());
            normalized = money(new D(s.totalCost).mul(rate));
            fx = {
              rate: rate.toDecimalPlaces(8).toString(),
              sourceLabel: snap.sourceLabel,
              sourceDate: snap.sourceDate.toISOString().slice(0, 10),
              snapshotId: snap.id,
            };
          } else {
            missing = true;
            notes.push(
              `No FX snapshot for ${s.currency}→${target}; ${s.forwarderName} is not normalized. Add a rate under Export costing → FX.`,
            );
          }
        }
      }
      const q = rows.find((r) => r.id === s.id)!;
      const exclusionsCount = (q.exclusions ?? '')
        .split(/[\n;,]/)
        .map((x) => x.trim())
        .filter(Boolean).length;
      out.push({
        quote: s,
        normalizedTotal: normalized,
        fx,
        fxMissing: missing,
        score: null,
        scoreBreakdown: [],
        exclusionsCount,
        rank: null,
      });
    }
    const scores = scoreQuotes(
      out.map((r) => ({
        id: r.quote.id,
        normalizedTotal: r.normalizedTotal,
        transitDays: r.quote.transitDays,
        direct: r.quote.direct,
        validity: r.quote.validity,
        exclusionsCount: r.exclusionsCount,
        departureDate: r.quote.departureDate
          ? new Date(r.quote.departureDate)
          : null,
      })),
    );
    for (const r of out) {
      const sc = scores.find((x) => x.id === r.quote.id)!;
      r.score = sc.score;
      r.scoreBreakdown = sc.breakdown;
    }
    [...out]
      .sort((x, y) => (y.score ?? 0) - (x.score ?? 0))
      .forEach((r, i) => (r.rank = i + 1));
    // Rule-based trade-off notes (no AI, no invented reliability claims).
    const priced = out.filter((r) => r.normalizedTotal);
    if (priced.length >= 2) {
      const cheapest = priced.reduce((m, r) =>
        new D(r.normalizedTotal!).lt(m.normalizedTotal!) ? r : m,
      );
      const timed = out.filter((r) => r.quote.transitDays !== null);
      const fastest = timed.length
        ? timed.reduce((m, r) =>
            r.quote.transitDays! < m.quote.transitDays! ? r : m,
          )
        : null;
      if (fastest && fastest !== cheapest) {
        const diff = money(
          new D(fastest.normalizedTotal ?? '0').minus(
            cheapest.normalizedTotal!,
          ),
        );
        notes.unshift(
          `${cheapest.quote.forwarderName} is cheapest${cheapest.quote.direct === false ? ` but requires transshipment${cheapest.quote.transshipmentPorts.length ? ` via ${cheapest.quote.transshipmentPorts.join(', ')}` : ''}` : ''}${cheapest.quote.transitDays !== null ? ` (${cheapest.quote.transitDays} days)` : ''}; ${fastest.quote.forwarderName} is ${fastest.quote.transitDays} days${fastest.quote.direct ? ' direct' : ''}${fastest.normalizedTotal ? ` and costs ${target} ${diff} more` : ''}.`,
        );
      } else
        notes.unshift(
          `${cheapest.quote.forwarderName} is both the cheapest and the fastest of the compared quotes.`,
        );
    }
    for (const r of out)
      if (r.quote.validity === 'EXPIRED')
        notes.push(
          `${r.quote.forwarderName}'s quote has expired — it cannot be selected without a manager override.`,
        );
    return {
      targetCurrency: target,
      rows: out,
      notes,
      scoringMethod:
        'Deterministic: cost 40, transit 25, routing 15, validity 10, exclusions 10. Missing data scores 0. The user selects the quote.',
    };
  }

  // ---------------------------------------------------------- attachments

  async attach(
    a: Actor,
    entity: {
      type: 'FREIGHT_QUOTE' | 'SHIPMENT';
      id: string;
      shipmentId?: string;
      exceptionId?: string;
      claimId?: string;
    },
    file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    const { storageKey } = await this.storage.savePrivateFile(
      'logistics-attachments',
      file,
      INQUIRY_ATTACHMENT_EXTENSIONS,
      MAX_INQUIRY_ATTACHMENT_BYTES,
    );
    const row = await this.prisma.logisticsAttachment.create({
      data: {
        organizationId: a.organizationId,
        entityType: entity.type,
        entityId: entity.id,
        shipmentId: entity.shipmentId ?? null,
        exceptionId: entity.exceptionId ?? null,
        claimId: entity.claimId ?? null,
        originalFilename: (file.originalname || 'file').slice(0, 200),
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksum: createHash('sha256').update(file.buffer).digest('hex'),
        uploadedByUserId: a.userId,
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'logistics.attachment_added',
      entityType: entity.type,
      entityId: entity.id,
      metadata: { attachmentId: row.id, sizeBytes: file.size },
    });
    return row;
  }

  async attachToQuote(a: Actor, id: string, file: Express.Multer.File) {
    const q = await this.load(a.organizationId, id);
    await this.attach(a, { type: 'FREIGHT_QUOTE', id: q.id }, file);
    return this.detail(a, id);
  }

  async download(a: Actor, attachmentId: string) {
    const x = await this.prisma.logisticsAttachment.findFirst({
      where: { id: attachmentId, organizationId: a.organizationId },
    });
    if (!x) throw new NotFoundException('File not found.');
    const buffer = await this.storage
      .readPrivateFile(x.storageKey)
      .catch(() => {
        throw new NotFoundException('File not available.');
      });
    return { buffer, filename: x.originalFilename, mimeType: x.mimeType };
  }

  countryText(code: string | null) {
    return code ? countryLabel(code) : null;
  }

  iso = iso;
}
