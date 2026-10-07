import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MILESTONE_STAGES,
  roleHasPermission,
  type BuyerShipmentUpdateView,
  type LogisticsList,
  type LogisticsOverview,
  type LogisticsSettingsView,
  type ShipmentDetail,
  type ShipmentExceptionSeverity,
  type ShipmentExceptionType,
  type ShipmentExceptionView,
  type ShipmentMilestoneStage,
  type ShipmentPrefill,
  type ShipmentStatus,
  type ShipmentSummary,
  type ShipmentTransportMode,
  type TrackingEventType,
  type TrackingSource,
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
  ClaimDto,
  ContainerDto,
  CostsDto,
  CreateShipmentDto,
  ExceptionDto,
  GenerateUpdateDto,
  LegDto,
  ListQueryDto,
  MilestoneDto,
  ReasonDto,
  RecordSentDto,
  ResolveExceptionDto,
  SettingsDto,
  ShipmentDto,
  StatusDto,
  TrackingEventDto,
} from './logistics.dto';
import { FreightService } from './freight.service';
import { LogisticsContextService } from './logistics-context.service';
import {
  allowedTransitions,
  buyerUpdateTemplate,
  computeHealth,
  containerCheck,
  dayDiff,
  EVENT_EXCEPTIONS,
  EVENT_MILESTONES,
  EVENT_STATUS,
  eventKey,
  eventStatusDecision,
  isPreDeparture,
  STATUS_RANK,
} from './logistics-rules';
import {
  SHIPMENT_TRACKING_PROVIDER,
  type ProviderTrackingEvent,
  type ShipmentTrackingProvider,
} from './tracking-provider';

type Ship = Prisma.ShipmentGetPayload<object>;
const TRANSIT_EVENTS = [
  'DEPARTED',
  'TRANSSHIPMENT_ARRIVED',
  'TRANSSHIPMENT_DEPARTED',
];
const UPDATE_TRIGGER: Partial<Record<TrackingEventType, string>> = {
  BOOKED: 'BOOKING_CONFIRMED',
  DEPARTED: 'DEPARTED',
  ETA_CHANGED: 'ETA_UPDATED',
  MISSED_SAILING: 'DELAY',
  PORT_DELAY: 'DELAY',
  TRANSSHIPMENT_DELAY: 'DELAY',
  DELIVERY_DELAY: 'DELAY',
  ARRIVED: 'ARRIVED',
  DELIVERED: 'DELIVERED',
};
const STATUS_EVENT: Partial<Record<ShipmentStatus, TrackingEventType>> = {
  PICKED_UP: 'PICKED_UP',
  CUSTOMS_CLEARED: 'CUSTOMS_CLEARED',
  AT_ORIGIN_PORT: 'GATE_IN',
  DEPARTED: 'DEPARTED',
  IN_TRANSIT: 'DEPARTED',
  ARRIVED_DESTINATION: 'ARRIVED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
};
const dec = (v: Prisma.Decimal | null | undefined) =>
  v === null || v === undefined ? null : v.toString();
const fmtDay = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;

export interface TrackingInput {
  eventType: TrackingEventType;
  eventTime: Date;
  estimated: boolean;
  location: string | null;
  containerNumber: string | null;
  vesselName: string | null;
  voyageNumber: string | null;
  flightNumber: string | null;
  newEta: Date | null;
  newEtd: Date | null;
  description: string | null;
  source: TrackingSource;
  sourceReference: string | null;
}

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly core: CommercialCoreService,
    private readonly ctx: LogisticsContextService,
    private readonly freight: FreightService,
    @Inject(SHIPMENT_TRACKING_PROVIDER)
    private readonly provider: ShipmentTrackingProvider,
  ) {}

  private can(a: Actor, p: Parameters<typeof roleHasPermission>[1]) {
    return roleHasPermission(a.role, p);
  }
  private need(a: Actor, p: Parameters<typeof roleHasPermission>[1]) {
    if (!this.can(a, p))
      throw new ForbiddenException(
        'You do not have permission for this logistics action.',
      );
  }

  // -------------------------------------------------------------- settings

  async rawSettings(org: string) {
    const s = await this.prisma.logisticsSettings.findUnique({
      where: { organizationId: org },
    });
    if (s) return s;
    await this.prisma.logisticsSettings.createMany({
      data: [{ organizationId: org }],
      skipDuplicates: true,
    });
    return this.prisma.logisticsSettings.findUniqueOrThrow({
      where: { organizationId: org },
    });
  }

  async settings(a: Actor): Promise<LogisticsSettingsView> {
    const s = await this.rawSettings(a.organizationId);
    return {
      etaDelayWarningDays: s.etaDelayWarningDays,
      etaDelayCriticalDays: s.etaDelayCriticalDays,
      autoDraftBuyerUpdates: s.autoDraftBuyerUpdates,
      buyerUpdateMode:
        s.buyerUpdateMode as LogisticsSettingsView['buyerUpdateMode'],
      autoSendSupported: false,
    };
  }

  async updateSettings(a: Actor, dto: SettingsDto) {
    if (dto.buyerUpdateMode === 'AUTO_SEND')
      throw new BadRequestException({
        message:
          'Automatic sending is not available: ExportPro has no one-off transactional sender. Use draft + approval and send from your own email.',
        details: { code: 'AUTO_SEND_UNSUPPORTED' },
      });
    const cur = await this.rawSettings(a.organizationId);
    const warn = dto.etaDelayWarningDays ?? cur.etaDelayWarningDays;
    const crit = dto.etaDelayCriticalDays ?? cur.etaDelayCriticalDays;
    if (crit < warn)
      throw new BadRequestException(
        'The critical threshold must be at least the warning threshold.',
      );
    await this.prisma.logisticsSettings.update({
      where: { organizationId: a.organizationId },
      data: {
        etaDelayWarningDays: warn,
        etaDelayCriticalDays: crit,
        autoDraftBuyerUpdates:
          dto.autoDraftBuyerUpdates ?? cur.autoDraftBuyerUpdates,
        buyerUpdateMode: dto.buyerUpdateMode ?? cur.buyerUpdateMode,
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'logistics.settings_updated',
      entityType: 'LogisticsSettings',
      entityId: a.organizationId,
      metadata: { fields: Object.keys(dto) },
    });
    return this.settings(a);
  }

  // ------------------------------------------------------------- creation

  private gate(r: ShipmentPrefill['readiness']): ShipmentPrefill['gate'] {
    const c = r.compliance.readiness;
    if (!c) return 'NOT_EVALUATED';
    if (c === 'BLOCKED' || c === 'NOT_READY') return 'BLOCKED';
    if (c === 'READY_WITH_WARNINGS') return 'WARNINGS_ACK_REQUIRED';
    return 'OK';
  }

  async prefill(
    a: Actor,
    poId: string,
    quoteId?: string,
  ): Promise<ShipmentPrefill> {
    const c = await this.ctx.po(a.organizationId, poId);
    const quote = quoteId ? await this.freight.detail(a, quoteId) : null;
    if (quote && quote.purchaseOrder && quote.purchaseOrder.id !== poId)
      throw new BadRequestException(
        'The freight quote belongs to another purchase order.',
      );
    const v: ShipmentPrefill['values'] = { ...c.values };
    if (quote) {
      const fq = (x: string | number | null) => ({
        value: x,
        source: x === null ? ('NONE' as const) : ('FREIGHT_QUOTE' as const),
      });
      v.mode = fq(quote.transportMode);
      v.shipmentType = fq(quote.shipmentType);
      v.carrier = fq(quote.carrier);
      v.shippingLine = fq(quote.shippingLine);
      if (quote.portOfLoading) v.portOfLoading = fq(quote.portOfLoading);
      if (quote.portOfDischarge) v.portOfDischarge = fq(quote.portOfDischarge);
      v.etd = fq(quote.departureDate);
      v.eta = fq(quote.arrivalDate);
    } else
      v.mode = {
        value: (c.values.shipmentMode.value as string | null) ?? null,
        source: c.values.shipmentMode.source,
      };
    const readiness = await this.ctx.readiness(a, poId);
    return {
      purchaseOrder: {
        id: c.po.id,
        poNumber: c.po.poNumber,
        status: c.po.status,
        buyerName: c.buyer?.canonicalName ?? 'Buyer',
      },
      freightQuote: quote,
      values: v,
      readiness,
      gate: this.gate(readiness),
    };
  }

  /** Accepted PO (+ optional selected freight quote) → shipment, behind the Sprint 16/17 compliance gate. */
  async create(a: Actor, dto: CreateShipmentDto) {
    const org = a.organizationId;
    const c = await this.ctx.po(org, dto.purchaseOrderId);
    if (c.po.status !== 'ACCEPTED')
      throw new ConflictException({
        message:
          'A shipment is created from an accepted buyer PO. Accept the PO first.',
        details: { code: 'PO_NOT_ACCEPTED' },
      });
    const quote = dto.freightQuoteId
      ? await this.prisma.freightQuote.findFirst({
          where: { id: dto.freightQuoteId, organizationId: org },
        })
      : null;
    if (dto.freightQuoteId && !quote)
      throw new NotFoundException('Freight quote not found.');
    if (quote && quote.status !== 'SELECTED')
      throw new ConflictException(
        'Only the selected freight quote can be used for a shipment.',
      );
    if (quote?.purchaseOrderId && quote.purchaseOrderId !== c.po.id)
      throw new BadRequestException(
        'The freight quote belongs to another purchase order.',
      );
    const readiness = await this.ctx.readiness(a, c.po.id);
    const gate = this.gate(readiness);
    let override: string | null = null;
    if (gate === 'BLOCKED' || gate === 'NOT_EVALUATED') {
      if (!dto.complianceOverrideReason)
        throw new ConflictException({
          message:
            gate === 'BLOCKED'
              ? `Compliance is blocked (${readiness.compliance.blockers} blocker${readiness.compliance.blockers === 1 ? '' : 's'}). Resolve them on the compliance checklist, or a manager may override with a reason.`
              : 'Evaluate the compliance checklist for this order first, or a manager may override with a reason.',
          details: {
            code:
              gate === 'BLOCKED'
                ? 'COMPLIANCE_BLOCKED'
                : 'COMPLIANCE_NOT_EVALUATED',
          },
        });
      if (!this.can(a, 'logistics.override'))
        throw new ForbiddenException(
          'Only a manager can override the compliance gate.',
        );
      override = dto.complianceOverrideReason.trim();
    }
    if (
      gate === 'WARNINGS_ACK_REQUIRED' &&
      !dto.acknowledgeComplianceWarnings &&
      !override
    )
      throw new ConflictException({
        message: `Compliance is ready with ${readiness.compliance.warnings} warning${readiness.compliance.warnings === 1 ? '' : 's'}. Acknowledge them to continue.`,
        details: { code: 'COMPLIANCE_WARNINGS_ACK_REQUIRED' },
      });
    if (dto.bookingConfirmed && !dto.bookingReference?.trim())
      throw new BadRequestException(
        'A confirmed booking needs the booking reference from your forwarder/carrier.',
      );
    const etd = dto.etd ? new Date(dto.etd) : (quote?.departureDate ?? null);
    const eta = dto.eta ? new Date(dto.eta) : (quote?.arrivalDate ?? null);
    if (etd && eta && eta < etd)
      throw new BadRequestException('ETA cannot be before ETD.');
    const pick = <T>(
      given: T | null | undefined,
      field: string,
      fallback: T | null,
      source: string,
    ) =>
      given !== undefined && given !== null && given !== ''
        ? { value: given, source: given === fallback ? source : 'MANUAL' }
        : {
            value: fallback,
            source:
              fallback === null || fallback === undefined ? 'NONE' : source,
          };
    const V = c.values;
    const cargo = {
      description: pick(
        dto.cargoDescription,
        'cargoDescription',
        V.cargoDescription.value as string | null,
        V.cargoDescription.source,
      ),
      packageCount: pick(
        dto.packageCount,
        'packageCount',
        V.packageCount.value as number | null,
        V.packageCount.source,
      ),
      grossWeightKg: pick(
        dto.grossWeightKg,
        'grossWeightKg',
        V.grossWeightKg.value as string | null,
        V.grossWeightKg.source,
      ),
      netWeightKg: pick(
        dto.netWeightKg,
        'netWeightKg',
        V.netWeightKg.value as string | null,
        V.netWeightKg.source,
      ),
      volumeCbm: pick(
        dto.volumeCbm,
        'volumeCbm',
        V.volumeCbm.value as string | null,
        V.volumeCbm.source,
      ),
    };
    const mode =
      dto.mode ??
      quote?.transportMode ??
      (V.shipmentMode.value as string | null) ??
      'SEA';
    const pl = c.docs.find((d) => d.documentType === 'PACKING_LIST');
    const sh = await this.prisma.$transaction(async (tx) => {
      const shipmentNumber = await this.core.nextNumber(
        tx,
        org,
        'SHP',
        'SHP',
        true,
      );
      const row = await tx.shipment.create({
        data: {
          organizationId: org,
          shipmentNumber,
          purchaseOrderId: c.po.id,
          freightQuoteId: quote?.id ?? null,
          proformaInvoiceId: c.po.proformaInvoiceId,
          quotationId: c.po.quotationId,
          crmLeadId: c.po.crmLeadId,
          buyerCompanyId: c.po.buyerCompanyId,
          mode,
          shipmentType: dto.shipmentType ?? quote?.shipmentType ?? null,
          incoterm: dto.incoterm ?? c.po.incoterm,
          incotermPlace: dto.incotermPlace ?? c.po.incotermPlace,
          originCountry:
            dto.originCountry ?? (V.originCountry.value as string | null),
          destinationCountry:
            dto.destinationCountry ??
            (V.destinationCountry.value as string | null),
          portOfLoading:
            dto.portOfLoading ??
            quote?.portOfLoading ??
            (V.portOfLoading.value as string | null),
          portOfDischarge:
            dto.portOfDischarge ??
            quote?.portOfDischarge ??
            (V.portOfDischarge.value as string | null),
          placeOfReceipt: dto.placeOfReceipt ?? null,
          placeOfDelivery: dto.placeOfDelivery ?? null,
          carrier: dto.carrier ?? quote?.carrier ?? null,
          shippingLine: dto.shippingLine ?? quote?.shippingLine ?? null,
          vesselName: dto.vesselName ?? null,
          voyageNumber: dto.voyageNumber ?? null,
          flightNumber: dto.flightNumber ?? null,
          vehicleReference: dto.vehicleReference ?? null,
          bookingReference: dto.bookingReference?.trim() || null,
          blNumber: dto.blNumber ?? null,
          awbNumber: dto.awbNumber ?? null,
          originalEtd: etd,
          etd,
          originalEta: eta,
          eta,
          status: dto.bookingConfirmed ? 'BOOKED' : 'PLANNED',
          cargo: cargo as Prisma.InputJsonValue,
          complianceAcknowledged:
            gate === 'WARNINGS_ACK_REQUIRED' &&
            Boolean(dto.acknowledgeComplianceWarnings),
          complianceOverrideReason: override,
          quotedCost: quote?.totalCost ?? null,
          quotedCurrency: quote?.currency ?? null,
          trackingProvider: this.provider.configured
            ? this.provider.name
            : null,
          ownerUserId: dto.ownerUserId ?? a.userId,
          notes: dto.notes ?? null,
          createdByUserId: a.userId,
        },
      });
      const acc = c.po.reviewedAt ?? c.po.updatedAt;
      for (const [i, stage] of MILESTONE_STAGES.entries()) {
        const m: Prisma.ShipmentMilestoneUncheckedCreateInput = {
          shipmentId: row.id,
          stage,
          sortOrder: i,
          status: 'NOT_STARTED',
          source: 'SYSTEM_DERIVED',
        };
        if (stage === 'ORDER')
          Object.assign(m, {
            status: 'COMPLETED',
            actualAt: acc,
            notes: `Buyer PO ${c.po.poNumber} accepted.`,
          });
        if (stage === 'PACKING')
          Object.assign(
            m,
            pl
              ? pl.status === 'APPROVED'
                ? {
                    status: 'COMPLETED',
                    actualAt: pl.approvedAt ?? new Date(),
                    notes: 'Packing list approved.',
                  }
                : {
                    status: 'IN_PROGRESS',
                    notes: 'Packing list in preparation.',
                  }
              : {},
          );
        if (stage === 'VESSEL' && etd)
          Object.assign(m, { status: 'PLANNED', plannedAt: etd });
        if (stage === 'DESTINATION' && eta)
          Object.assign(m, { status: 'PLANNED', plannedAt: eta });
        await tx.shipmentMilestone.create({ data: m });
      }
      if (dto.bookingConfirmed)
        await tx.shipmentTrackingEvent.create({
          data: {
            organizationId: org,
            shipmentId: row.id,
            eventKey: eventKey(['BOOKED', row.bookingReference]),
            eventType: 'BOOKED',
            eventTime: new Date(),
            source: 'MANUAL',
            sourceReference: row.bookingReference,
            description: `Booking confirmed by user with reference ${row.bookingReference} (booked outside ExportPro).`,
            createdByUserId: a.userId,
          },
        });
      await this.core.event(tx, a, {
        entityType: 'SHIPMENT',
        entityId: row.id,
        lineageId: row.id,
        type: 'CREATED',
        title: `Shipment ${shipmentNumber} created from PO ${c.po.poNumber}${quote ? ` with ${quote.forwarderName}'s quote` : ''}${override ? ' (compliance override)' : gate === 'WARNINGS_ACK_REQUIRED' ? ' (compliance warnings acknowledged)' : ''}`,
      });
      await this.core.event(tx, a, {
        entityType: 'SHIPMENT',
        entityId: row.id,
        lineageId: c.po.id,
        type: 'SHIPMENT_CREATED',
        title: `Shipment ${shipmentNumber} created`,
      });
      await this.core.crmActivity(
        tx,
        org,
        c.po.crmLeadId,
        `Shipment ${shipmentNumber} created for PO ${c.po.poNumber}`,
        a.userId,
        { shipmentId: row.id },
      );
      return row;
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'shipment.created',
      entityType: 'Shipment',
      entityId: sh.id,
      metadata: {
        shipmentNumber: sh.shipmentNumber,
        purchaseOrderId: c.po.id,
        freightQuoteId: quote?.id ?? null,
        complianceGate: gate,
        override: Boolean(override),
      },
    });
    if (override)
      await this.audit.record({
        organizationId: org,
        actorId: a.userId,
        action: 'shipment.compliance_override',
        entityType: 'Shipment',
        entityId: sh.id,
        metadata: { reason: override.slice(0, 300), gate },
      });
    if (dto.bookingConfirmed)
      await this.maybeDraft(a, sh.id, 'BOOKED', null, false);
    return this.detail(a, sh.id);
  }

  // ------------------------------------------------------------ reads

  private async load(org: string, id: string): Promise<Ship> {
    const s = await this.prisma.shipment.findFirst({
      where: { id, organizationId: org },
    });
    if (!s) throw new NotFoundException('Shipment not found.');
    return s;
  }

  private route(s: Ship) {
    return [
      s.portOfLoading ?? s.originCountry ?? '—',
      s.portOfDischarge ?? s.destinationCountry ?? '—',
    ].join(' → ');
  }

  private async summaries(
    org: string,
    rows: Ship[],
  ): Promise<ShipmentSummary[]> {
    const [buyers, pos, ex] = await Promise.all([
      this.prisma.buyerCompany.findMany({
        where: { id: { in: rows.map((r) => r.buyerCompanyId) } },
        select: { id: true, canonicalName: true },
      }),
      this.prisma.buyerPurchaseOrder.findMany({
        where: {
          organizationId: org,
          id: { in: rows.map((r) => r.purchaseOrderId) },
        },
        select: { id: true, poNumber: true },
      }),
      this.prisma.shipmentException.findMany({
        where: {
          organizationId: org,
          shipmentId: { in: rows.map((r) => r.id) },
          status: 'OPEN',
        },
        select: { shipmentId: true, severity: true },
      }),
    ]);
    return rows.map((s) => ({
      id: s.id,
      shipmentNumber: s.shipmentNumber,
      buyer: {
        id: s.buyerCompanyId,
        name:
          buyers.find((b) => b.id === s.buyerCompanyId)?.canonicalName ??
          'Buyer',
      },
      purchaseOrder: {
        id: s.purchaseOrderId,
        poNumber: pos.find((p) => p.id === s.purchaseOrderId)?.poNumber ?? '',
      },
      mode: s.mode as ShipmentTransportMode,
      shipmentType: s.shipmentType as ShipmentSummary['shipmentType'],
      route: this.route(s),
      carrier: s.shippingLine ?? s.carrier,
      etd: iso(s.etd),
      eta: iso(s.eta),
      status: s.status as ShipmentStatus,
      health: s.health as ShipmentSummary['health'],
      openExceptions: ex.filter((e) => e.shipmentId === s.id).length,
      criticalExceptions: ex.filter(
        (e) => e.shipmentId === s.id && e.severity === 'CRITICAL',
      ).length,
      updatedAt: s.updatedAt.toISOString(),
    }));
  }

  async list(
    a: Actor,
    q: ListQueryDto,
  ): Promise<LogisticsList<ShipmentSummary>> {
    const org = a.organizationId;
    const and: Prisma.ShipmentWhereInput[] = [{ organizationId: org }];
    if (q.status) and.push({ status: q.status });
    if (q.health) and.push({ health: q.health });
    if (q.mode) and.push({ mode: q.mode });
    if (q.buyerCompanyId) and.push({ buyerCompanyId: q.buyerCompanyId });
    if (q.purchaseOrderId) and.push({ purchaseOrderId: q.purchaseOrderId });
    if (q.crmLeadId) and.push({ crmLeadId: q.crmLeadId });
    if (q.country)
      and.push({
        OR: [{ destinationCountry: q.country }, { originCountry: q.country }],
      });
    if (q.ownerUserId)
      and.push({
        ownerUserId: q.ownerUserId === 'me' ? a.userId : q.ownerUserId,
      });
    if (q.etaFrom || q.etaTo)
      and.push({
        eta: {
          ...(q.etaFrom ? { gte: new Date(q.etaFrom) } : {}),
          ...(q.etaTo
            ? { lte: new Date(`${q.etaTo.slice(0, 10)}T23:59:59.999Z`) }
            : {}),
        },
      });
    if (q.hasOpenExceptions)
      and.push(
        q.hasOpenExceptions === 'true'
          ? { exceptions: { some: { status: 'OPEN' } } }
          : { exceptions: { none: { status: 'OPEN' } } },
      );
    const t = q.search?.trim();
    if (t) {
      const [pos, buyers] = await Promise.all([
        this.prisma.buyerPurchaseOrder.findMany({
          where: {
            organizationId: org,
            poNumber: { contains: t, mode: 'insensitive' },
          },
          select: { id: true },
          take: 50,
        }),
        this.prisma.buyerCompany.findMany({
          where: {
            canonicalName: { contains: t, mode: 'insensitive' },
            OR: [{ ownerOrganizationId: null }, { ownerOrganizationId: org }],
          },
          select: { id: true },
          take: 50,
        }),
      ]);
      and.push({
        OR: [
          ...[
            'shipmentNumber',
            'blNumber',
            'awbNumber',
            'vesselName',
            'bookingReference',
            'voyageNumber',
            'flightNumber',
          ].map((f) => ({
            [f]: { contains: t, mode: 'insensitive' as const },
          })),
          {
            containers: {
              some: {
                containerNumber: {
                  contains: t.toUpperCase().replace(/\s/g, ''),
                },
              },
            },
          },
          { purchaseOrderId: { in: pos.map((p) => p.id) } },
          { buyerCompanyId: { in: buyers.map((b) => b.id) } },
        ],
      });
    }
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        orderBy: [{ eta: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.shipment.count({ where }),
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

  async overview(a: Actor): Promise<LogisticsOverview> {
    const org = a.organizationId;
    const active = await this.prisma.shipment.findMany({
      where: {
        organizationId: org,
        status: { notIn: ['DELIVERED', 'CANCELLED'] },
      },
    });
    for (const s of active) await this.refreshDerived(a, s.id, false);
    const fresh = await this.prisma.shipment.findMany({
      where: {
        organizationId: org,
        status: { notIn: ['DELIVERED', 'CANCELLED'] },
      },
    });
    const now = Date.now();
    const week = now + 7 * 86400000;
    const open = await this.prisma.shipmentException.findMany({
      where: { organizationId: org, status: 'OPEN' },
      include: { shipment: { select: { shipmentNumber: true } } },
      orderBy: { detectedAt: 'desc' },
    });
    const pendingUpdates = await this.prisma.shipmentBuyerUpdate.findMany({
      where: { organizationId: org, status: 'DRAFT' },
      include: { shipment: { select: { shipmentNumber: true } } },
      take: 20,
    });
    const actions: LogisticsOverview['actions'] = [];
    for (const e of open.filter((x) => x.severity !== 'INFO').slice(0, 10))
      actions.push({
        kind: e.type,
        title: e.title,
        shipmentId: e.shipmentId,
        shipmentNumber: e.shipment.shipmentNumber,
        severity: e.severity as ShipmentExceptionSeverity,
      });
    for (const s of fresh.filter(
      (x) => x.mode === 'SEA' && x.actualDeparture && !x.blNumber,
    ))
      if (
        !(await this.prisma.tradeDocument.findFirst({
          where: {
            organizationId: org,
            purchaseOrderId: s.purchaseOrderId,
            documentType: 'BILL_OF_LADING',
            status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
          },
          select: { id: true },
        }))
      )
        actions.push({
          kind: 'MISSING_BL',
          title: 'Departed — bill of lading not recorded yet',
          shipmentId: s.id,
          shipmentNumber: s.shipmentNumber,
          severity: 'WARNING',
        });
    for (const u of pendingUpdates)
      actions.push({
        kind: 'BUYER_UPDATE',
        title: 'Buyer update draft waiting for approval',
        shipmentId: u.shipmentId,
        shipmentNumber: u.shipment.shipmentNumber,
        severity: 'INFO',
      });
    return {
      active: fresh.length,
      departingSoon: fresh.filter(
        (s) =>
          !s.actualDeparture &&
          s.etd &&
          s.etd.getTime() >= now - 86400000 &&
          s.etd.getTime() <= week,
      ).length,
      arrivingSoon: fresh.filter(
        (s) =>
          !s.actualArrival &&
          s.actualDeparture &&
          s.eta &&
          s.eta.getTime() <= week,
      ).length,
      delayed: fresh.filter((s) => s.health === 'DELAYED').length,
      customsHolds: open.filter((e) => e.type === 'CUSTOMS_HOLD').length,
      openExceptions: open.length,
      actions,
    };
  }

  private exceptionView(
    e: Prisma.ShipmentExceptionGetPayload<object>,
    names: Map<string, string>,
    shipmentNumber?: string,
  ): ShipmentExceptionView {
    return {
      id: e.id,
      shipment: shipmentNumber ? { id: e.shipmentId, shipmentNumber } : null,
      type: e.type as ShipmentExceptionType,
      severity: e.severity as ShipmentExceptionSeverity,
      status: e.status as ShipmentExceptionView['status'],
      title: e.title,
      description: e.description,
      impact: e.impact,
      location: e.location,
      source: e.source as TrackingSource,
      detectedAt: e.detectedAt.toISOString(),
      occurredAt: iso(e.occurredAt),
      owner: e.ownerUserId ? (names.get(e.ownerUserId) ?? null) : null,
      dueAt: iso(e.dueAt),
      resolution: e.resolvedAt
        ? {
            text: e.resolution ?? '',
            by: e.resolvedByUserId
              ? (names.get(e.resolvedByUserId) ?? null)
              : 'System',
            at: e.resolvedAt.toISOString(),
          }
        : null,
    };
  }

  async detail(a: Actor, id: string): Promise<ShipmentDetail> {
    const org = a.organizationId;
    await this.refreshDerived(a, id);
    const s = await this.prisma.shipment.findFirst({
      where: { id, organizationId: org },
      include: {
        milestones: { orderBy: { sortOrder: 'asc' } },
        legs: { orderBy: { sequence: 'asc' } },
        containers: { orderBy: { createdAt: 'asc' } },
        trackingEvents: {
          orderBy: [{ eventTime: 'desc' }, { createdAt: 'desc' }],
        },
        exceptions: { orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }] },
        claims: { orderBy: { createdAt: 'desc' } },
        buyerUpdates: { orderBy: { createdAt: 'desc' } },
        freightQuote: true,
      },
    });
    if (!s) throw new NotFoundException('Shipment not found.');
    const [sum] = await this.summaries(org, [s]);
    const userIds = [
      s.ownerUserId,
      ...s.milestones.map((m) => m.completedByUserId),
      ...s.trackingEvents.map((t) => t.createdByUserId),
      ...s.exceptions.flatMap((e) => [e.ownerUserId, e.resolvedByUserId]),
      ...s.claims.map((c) => c.createdByUserId),
      ...s.buyerUpdates.flatMap((u) => [
        u.approvedByUserId,
        u.recordedSentByUserId,
      ]),
    ];
    const [names, readiness, documents, attachments, events, crm] =
      await Promise.all([
        this.core.userNames(userIds),
        this.ctx.readiness(a, s.purchaseOrderId),
        this.ctx.documentList(org, s.purchaseOrderId),
        this.prisma.logisticsAttachment.findMany({
          where: { organizationId: org, shipmentId: s.id },
          orderBy: { createdAt: 'desc' },
        }),
        this.core.events(org, [s.id]),
        this.core.crmContext(
          org,
          s.crmLeadId,
          'SHIPMENT',
          'A shipment exists for this buyer’s order.',
        ),
      ]);
    const nm = (x: string | null) => (x ? (names.get(x) ?? null) : null);
    const cargo = s.cargo as unknown as ShipmentDetail['cargo'];
    const actual = [
      s.actualFreight,
      s.actualSurcharges,
      s.actualLocalCharges,
    ].filter(Boolean) as Prisma.Decimal[];
    const sb = documents.find((d) => d.documentType === 'SHIPPING_BILL');
    const latestEvent =
      s.trackingEvents.find((t) => t.applied) ?? s.trackingEvents[0];
    const c = (p: Parameters<typeof roleHasPermission>[1]) => this.can(a, p);
    const live = !['DELIVERED', 'CANCELLED'].includes(s.status);
    const actions: string[] = [];
    if (live && c('logistics.shipments.edit'))
      actions.push(
        'edit',
        'status',
        'milestones',
        'containers',
        'legs',
        'attach',
      );
    if (live && c('logistics.tracking.update')) actions.push('tracking');
    if (live && c('logistics.tracking.update') && this.provider.configured)
      actions.push('refresh_tracking');
    if (c('logistics.exceptions.manage')) actions.push('exceptions', 'claims');
    if (c('logistics.buyer_updates.manage')) actions.push('buyer_updates');
    if (c('logistics.costs.edit')) actions.push('costs');
    if (
      isPreDeparture(s.status as ShipmentStatus) &&
      c('logistics.shipments.edit')
    )
      actions.push('cancel');
    return {
      ...sum,
      rowVersion: s.rowVersion,
      freightQuote: s.freightQuote
        ? {
            id: s.freightQuote.id,
            forwarderName: s.freightQuote.forwarderName,
            totalCost: s.freightQuote.totalCost?.toFixed(2) ?? null,
            currency: s.freightQuote.currency,
            quoteReference: s.freightQuote.quoteReference,
          }
        : null,
      proformaInvoiceId: s.proformaInvoiceId,
      quotationId: s.quotationId,
      crmLeadId: s.crmLeadId,
      incoterm: s.incoterm,
      incotermPlace: s.incotermPlace,
      originCountry: s.originCountry,
      destinationCountry: s.destinationCountry,
      portOfLoading: s.portOfLoading,
      portOfDischarge: s.portOfDischarge,
      placeOfReceipt: s.placeOfReceipt,
      placeOfDelivery: s.placeOfDelivery,
      shippingLine: s.shippingLine,
      vesselName: s.vesselName,
      voyageNumber: s.voyageNumber,
      flightNumber: s.flightNumber,
      vehicleReference: s.vehicleReference,
      bookingReference: s.bookingReference,
      blNumber: s.blNumber,
      awbNumber: s.awbNumber,
      originalEtd: iso(s.originalEtd),
      originalEta: iso(s.originalEta),
      actualDeparture: iso(s.actualDeparture),
      actualArrival: iso(s.actualArrival),
      deliveredAt: iso(s.deliveredAt),
      etaDelayDays: dayDiff(s.originalEta, s.eta),
      etdDelayDays: dayDiff(s.originalEtd, s.actualDeparture ?? s.etd),
      cargo,
      customs: {
        shippingBillNumber: s.shippingBillNumber,
        shippingBillDate: day(s.shippingBillDate),
        customsBroker: s.customsBroker,
        clearedAt: iso(s.customsClearedAt),
        shippingBillDocumentId: sb?.id ?? null,
      },
      compliance: {
        acknowledgedWarnings: s.complianceAcknowledged,
        overrideReason: s.complianceOverrideReason,
      },
      owner: nm(s.ownerUserId),
      notes: s.notes,
      tracking: {
        provider: s.trackingProvider,
        lastFetchedAt: iso(s.trackingLastFetchedAt),
        lastError: s.trackingLastError,
        lastUpdateAt: latestEvent ? latestEvent.createdAt.toISOString() : null,
        lastUpdateSource: (latestEvent?.source as TrackingSource) ?? null,
      },
      costs: {
        quoted: {
          total: s.quotedCost?.toFixed(2) ?? null,
          currency: s.quotedCurrency,
        },
        actual: {
          freight: dec(s.actualFreight),
          surcharges: dec(s.actualSurcharges),
          localCharges: dec(s.actualLocalCharges),
          total: actual.length
            ? money(actual.reduce((t, x) => t.plus(x.toString()), new D(0)))
            : null,
          currency: s.actualCostCurrency,
          notes: s.actualCostNotes,
        },
      },
      readiness,
      milestones: s.milestones.map((m) => ({
        id: m.id,
        stage: m.stage as ShipmentMilestoneStage,
        status: m.status as ShipmentDetail['milestones'][number]['status'],
        plannedAt: iso(m.plannedAt),
        estimatedAt: iso(m.estimatedAt),
        actualAt: iso(m.actualAt),
        location: m.location,
        source: m.source as TrackingSource,
        notes: m.notes,
        reason: m.reason,
        delayDays: (() => {
          const d = dayDiff(m.plannedAt, m.actualAt ?? m.estimatedAt);
          return d !== null && d > 0 ? d : null;
        })(),
        completedBy: nm(m.completedByUserId),
        updatedAt: m.updatedAt.toISOString(),
      })),
      legs: s.legs.map((l) => ({
        id: l.id,
        sequence: l.sequence,
        mode: l.mode as ShipmentTransportMode,
        origin: l.origin,
        destination: l.destination,
        carrier: l.carrier,
        vesselName: l.vesselName,
        voyageNumber: l.voyageNumber,
        flightNumber: l.flightNumber,
        plannedDeparture: iso(l.plannedDeparture),
        plannedArrival: iso(l.plannedArrival),
        actualDeparture: iso(l.actualDeparture),
        actualArrival: iso(l.actualArrival),
        status: l.status as ShipmentDetail['legs'][number]['status'],
      })),
      containers: s.containers.map((x) => {
        const ev = s.trackingEvents.find(
          (t) => t.containerNumber === x.containerNumber,
        );
        return {
          id: x.id,
          containerNumber: x.containerNumber,
          containerType: x.containerType,
          sealNumber: x.sealNumber,
          packageCount: x.packageCount,
          grossWeightKg: dec(x.grossWeightKg),
          netWeightKg: dec(x.netWeightKg),
          checkDigitValid: x.checkDigitValid,
          lastEvent: ev
            ? {
                type: ev.eventType,
                location: ev.location,
                at: ev.eventTime.toISOString(),
                source: ev.source as TrackingSource,
              }
            : null,
        };
      }),
      trackingEvents: s.trackingEvents.map((t) => ({
        id: t.id,
        eventType: t.eventType as TrackingEventType,
        eventTime: t.eventTime.toISOString(),
        estimated: t.estimated,
        location: t.location,
        containerNumber: t.containerNumber,
        vesselName: t.vesselName,
        voyageNumber: t.voyageNumber,
        flightNumber: t.flightNumber,
        source: t.source as TrackingSource,
        sourceReference: t.sourceReference,
        description: t.description,
        previousValue: t.previousValue,
        newValue: t.newValue,
        applied: t.applied,
        appliedNote: t.appliedNote,
        createdBy: nm(t.createdByUserId),
        createdAt: t.createdAt.toISOString(),
      })),
      exceptions: s.exceptions.map((e) => this.exceptionView(e, names)),
      claims: s.claims.map((x) => ({
        id: x.id,
        exceptionId: x.exceptionId,
        description: x.description,
        quantityAffected: x.quantityAffected,
        estimatedLoss: x.estimatedLoss?.toFixed(2) ?? null,
        currency: x.currency,
        claimReference: x.claimReference,
        insurerReference: x.insurerReference,
        carrierReference: x.carrierReference,
        status: x.status as ShipmentDetail['claims'][number]['status'],
        notes: x.notes,
        createdBy: nm(x.createdByUserId),
        createdAt: x.createdAt.toISOString(),
        updatedAt: x.updatedAt.toISOString(),
      })),
      buyerUpdates: s.buyerUpdates.map((u) =>
        this.updateView(u, names, s.trackingEvents),
      ),
      documents,
      attachments: attachments.map((x) => ({
        id: x.id,
        filename: x.originalFilename,
        mimeType: x.mimeType,
        sizeBytes: x.sizeBytes,
        exceptionId: x.exceptionId,
        claimId: x.claimId,
        createdAt: x.createdAt.toISOString(),
      })),
      crm,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        actor: e.actor,
        createdAt: e.createdAt,
      })),
      availableActions: actions,
      allowedStatuses: allowedTransitions(
        s.status as ShipmentStatus,
        s.holdFromStatus as ShipmentStatus | null,
      ),
    };
  }

  private updateView(
    u: Prisma.ShipmentBuyerUpdateGetPayload<object>,
    names: Map<string, string>,
    events: { id: string; source: string }[],
  ): BuyerShipmentUpdateView {
    const ev = u.trackingEventId
      ? events.find((e) => e.id === u.trackingEventId)
      : null;
    return {
      id: u.id,
      trigger: u.trigger as BuyerShipmentUpdateView['trigger'],
      subject: u.subject,
      message: u.message,
      status: u.status as BuyerShipmentUpdateView['status'],
      channel: u.channel,
      basedOnEvent: ev
        ? { id: ev.id, source: ev.source as TrackingSource }
        : null,
      approvedBy: u.approvedByUserId
        ? (names.get(u.approvedByUserId) ?? null)
        : null,
      approvedAt: iso(u.approvedAt),
      recordedSentBy: u.recordedSentByUserId
        ? (names.get(u.recordedSentByUserId) ?? null)
        : null,
      recordedSentAt: iso(u.recordedSentAt),
      createdAt: u.createdAt.toISOString(),
    };
  }

  // -------------------------------------------------------- derived state

  /**
   * Deterministic derived state after any change: documentation milestone from
   * Sprint 16/17 readiness, system-detected delay exceptions, and health.
   */
  async refreshDerived(a: Actor, id: string, withDocs = true) {
    const s = await this.load(a.organizationId, id);
    const settings = await this.rawSettings(a.organizationId);
    const live = !['DELIVERED', 'CANCELLED'].includes(s.status);
    if (live) {
      const delay = dayDiff(s.originalEta, s.eta);
      const auto = await this.prisma.shipmentException.findFirst({
        where: { shipmentId: s.id, autoKey: 'ETA_DELAY', status: 'OPEN' },
      });
      if (delay !== null && delay >= settings.etaDelayWarningDays) {
        const severity: ShipmentExceptionSeverity =
          delay >= settings.etaDelayCriticalDays ? 'CRITICAL' : 'WARNING';
        const text = {
          title: `ETA delayed by ${delay} day${delay === 1 ? '' : 's'}`,
          description: `Original ETA ${fmtDay(s.originalEta)}, current ETA ${fmtDay(s.eta)} (threshold ${settings.etaDelayWarningDays} days).`,
          severity,
        };
        if (!auto)
          await this.prisma.shipmentException.create({
            data: {
              organizationId: a.organizationId,
              shipmentId: s.id,
              type: 'ETA_DELAY',
              autoKey: 'ETA_DELAY',
              source: 'SYSTEM_DERIVED',
              impact: 'Later arrival at destination.',
              ...text,
            },
          });
        else if (auto.severity !== severity || auto.title !== text.title)
          await this.prisma.shipmentException.update({
            where: { id: auto.id },
            data: text,
          });
      }
      const etdPassed = Boolean(
        s.etd &&
        !s.actualDeparture &&
        isPreDeparture(s.status as ShipmentStatus) &&
        s.etd.getTime() < Date.now() - 86400000,
      );
      const etdAuto = await this.prisma.shipmentException.findFirst({
        where: { shipmentId: s.id, autoKey: 'ETD_PASSED', status: 'OPEN' },
      });
      if (etdPassed && !etdAuto)
        await this.prisma.shipmentException.create({
          data: {
            organizationId: a.organizationId,
            shipmentId: s.id,
            type: 'ETD_DELAY',
            autoKey: 'ETD_PASSED',
            severity: 'WARNING',
            source: 'SYSTEM_DERIVED',
            title: 'Planned departure passed without a departure event',
            description: `ETD ${fmtDay(s.etd)} has passed and no departure is recorded. Possible delay — confirm with the forwarder.`,
          },
        });
      if (etdAuto && s.actualDeparture)
        await this.prisma.shipmentException.update({
          where: { id: etdAuto.id },
          data: {
            status: 'RESOLVED',
            resolution: `Departure recorded on ${fmtDay(s.actualDeparture)} (system).`,
            resolvedAt: new Date(),
          },
        });
      if (withDocs) await this.refreshDocumentation(a, s);
    }
    const [open, blocked] = await Promise.all([
      this.prisma.shipmentException.findMany({
        where: { shipmentId: s.id, status: 'OPEN' },
        select: { type: true, severity: true },
      }),
      this.prisma.shipmentMilestone.count({
        where: { shipmentId: s.id, status: 'BLOCKED' },
      }),
    ]);
    const health = computeHealth({
      status: s.status as ShipmentStatus,
      openExceptions: open as {
        type: ShipmentExceptionType;
        severity: ShipmentExceptionSeverity;
      }[],
      blockedMilestone: blocked > 0,
      etdPassedWithoutDeparture: Boolean(
        s.etd &&
        !s.actualDeparture &&
        isPreDeparture(s.status as ShipmentStatus) &&
        s.etd.getTime() < Date.now() - 86400000,
      ),
    });
    if (health !== s.health)
      await this.prisma.shipment.update({
        where: { id: s.id },
        data: { health },
      });
  }

  /** Documentation stage follows Sprint 16/17: complete only when required-now documents are available, approved and validated where required. */
  private async refreshDocumentation(a: Actor, s: Ship) {
    const m = await this.prisma.shipmentMilestone.findUnique({
      where: { shipmentId_stage: { shipmentId: s.id, stage: 'DOCUMENTATION' } },
    });
    if (
      !m ||
      (m.source === 'MANUAL' &&
        (m.status === 'COMPLETED' || m.status === 'SKIPPED'))
    )
      return;
    const r = await this.ctx.readiness(a, s.purchaseOrderId);
    const status = r.documents.complete
      ? 'COMPLETED'
      : r.documents.available > 0
        ? 'IN_PROGRESS'
        : 'NOT_STARTED';
    const notes = r.documents.complete
      ? `Required documents available and approved (${r.documents.approved}/${r.documents.requiredNow}); ${r.documents.validated} validated.`
      : r.documents.reasons.join(' ');
    if (m.status !== status || m.notes !== notes)
      await this.prisma.shipmentMilestone.update({
        where: { id: m.id },
        data: {
          status,
          notes,
          source: 'SYSTEM_DERIVED',
          actualAt: status === 'COMPLETED' ? (m.actualAt ?? new Date()) : null,
        },
      });
    const pm = await this.prisma.shipmentMilestone.findUnique({
      where: { shipmentId_stage: { shipmentId: s.id, stage: 'PACKING' } },
    });
    if (pm && pm.source !== 'MANUAL' && pm.status !== 'COMPLETED') {
      const pl = (
        await this.ctx.currentDocs(a.organizationId, s.purchaseOrderId)
      ).find((d) => d.documentType === 'PACKING_LIST');
      if (pl?.status === 'APPROVED')
        await this.prisma.shipmentMilestone.update({
          where: { id: pm.id },
          data: {
            status: 'COMPLETED',
            actualAt: pl.approvedAt ?? new Date(),
            notes: 'Packing list approved.',
          },
        });
    }
  }

  // ---------------------------------------------------------------- edits

  private guard(s: Ship, v?: number) {
    if (v !== undefined && v !== s.rowVersion)
      throw CommercialCoreService.conflict();
  }

  async update(a: Actor, id: string, dto: ShipmentDto) {
    const s = await this.load(a.organizationId, id);
    this.guard(s, dto.expectedRowVersion);
    if (['DELIVERED', 'CANCELLED'].includes(s.status))
      throw new ConflictException(
        `A ${s.status.toLowerCase()} shipment cannot be edited.`,
      );
    const data: Prisma.ShipmentUpdateInput = { rowVersion: { increment: 1 } };
    const fields = [
      'shipmentType',
      'incoterm',
      'incotermPlace',
      'originCountry',
      'destinationCountry',
      'portOfLoading',
      'portOfDischarge',
      'placeOfReceipt',
      'placeOfDelivery',
      'carrier',
      'shippingLine',
      'vesselName',
      'voyageNumber',
      'flightNumber',
      'vehicleReference',
      'blNumber',
      'awbNumber',
      'customsBroker',
      'ownerUserId',
      'notes',
      'shippingBillNumber',
    ] as const;
    for (const f of fields)
      if (dto[f] !== undefined)
        (data as Record<string, unknown>)[f] =
          typeof dto[f] === 'string'
            ? (dto[f] as string).trim() || null
            : dto[f];
    if (dto.mode) data.mode = dto.mode;
    if (dto.bookingReference !== undefined)
      data.bookingReference = dto.bookingReference?.trim() || null;
    if (dto.shippingBillDate !== undefined)
      data.shippingBillDate = dto.shippingBillDate
        ? new Date(dto.shippingBillDate)
        : null;
    const cargoKeys = {
      cargoDescription: 'description',
      packageCount: 'packageCount',
      grossWeightKg: 'grossWeightKg',
      netWeightKg: 'netWeightKg',
      volumeCbm: 'volumeCbm',
    } as const;
    const cargo = {
      ...(s.cargo as Record<string, { value: unknown; source: string }>),
    };
    let cargoChanged = false;
    for (const [k, ck] of Object.entries(cargoKeys)) {
      const v = dto[k as keyof typeof cargoKeys];
      if (v !== undefined) {
        cargo[ck] = { value: v, source: v === null ? 'NONE' : 'MANUAL' };
        cargoChanged = true;
      }
    }
    if (cargoChanged) data.cargo = cargo as Prisma.InputJsonValue;
    await this.prisma.shipment.update({ where: { id: s.id }, data });
    // ETD/ETA edits go through the tracking history (never overwritten silently).
    if (
      dto.etd !== undefined &&
      dto.etd &&
      (!s.etd || new Date(dto.etd).getTime() !== s.etd.getTime())
    )
      await this.addTracking(
        a,
        s.id,
        {
          eventType: 'ETD_CHANGED',
          eventTime: new Date(),
          estimated: false,
          location: null,
          containerNumber: null,
          vesselName: null,
          voyageNumber: null,
          flightNumber: null,
          newEta: null,
          newEtd: new Date(dto.etd),
          description: dto.changeReason ?? null,
          source: 'MANUAL',
          sourceReference: null,
        },
        true,
      );
    if (
      dto.eta !== undefined &&
      dto.eta &&
      (!s.eta || new Date(dto.eta).getTime() !== s.eta.getTime())
    )
      await this.addTracking(
        a,
        s.id,
        {
          eventType: 'ETA_CHANGED',
          eventTime: new Date(),
          estimated: false,
          location: null,
          containerNumber: null,
          vesselName: null,
          voyageNumber: null,
          flightNumber: null,
          newEta: new Date(dto.eta),
          newEtd: null,
          description: dto.changeReason ?? null,
          source: 'MANUAL',
          sourceReference: null,
        },
        true,
      );
    await this.refreshDerived(a, s.id);
    return this.detail(a, s.id);
  }

  async changeStatus(a: Actor, id: string, dto: StatusDto) {
    const s = await this.load(a.organizationId, id);
    this.guard(s, dto.expectedRowVersion);
    const target = dto.status as ShipmentStatus;
    const allowed = allowedTransitions(
      s.status as ShipmentStatus,
      s.holdFromStatus as ShipmentStatus | null,
    );
    if (!allowed.includes(target))
      throw new ConflictException({
        message: `Cannot change status from ${s.status.replace(/_/g, ' ').toLowerCase()} to ${target.replace(/_/g, ' ').toLowerCase()}.`,
        details: { code: 'INVALID_TRANSITION', allowed },
      });
    if (target === 'BOOKED' && !s.bookingReference)
      throw new BadRequestException({
        message:
          'Record the booking reference from your forwarder/carrier first — ExportPro does not book freight.',
        details: { code: 'BOOKING_REFERENCE_REQUIRED' },
      });
    if ((target === 'ON_HOLD' || target === 'CANCELLED') && !dto.note?.trim())
      throw new BadRequestException('A reason is required.');
    const now = new Date();
    const data: Prisma.ShipmentUpdateInput = {
      status: target,
      rowVersion: { increment: 1 },
    };
    if (target === 'ON_HOLD') data.holdFromStatus = s.status;
    if (s.status === 'ON_HOLD') data.holdFromStatus = null;
    if (
      (target === 'DEPARTED' || target === 'IN_TRANSIT') &&
      !s.actualDeparture
    )
      data.actualDeparture = now;
    if (target === 'ARRIVED_DESTINATION' && !s.actualArrival)
      data.actualArrival = now;
    if (target === 'DELIVERED') {
      if (!s.deliveredAt) data.deliveredAt = now;
      if (!s.actualArrival) data.actualArrival = now;
    }
    if (target === 'CUSTOMS_CLEARED' && !s.customsClearedAt)
      data.customsClearedAt = now;
    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({ where: { id: s.id }, data });
      const ev = STATUS_EVENT[target];
      for (const m of (ev && EVENT_MILESTONES[ev]) ?? [])
        await this.applyMilestone(
          tx,
          s.id,
          m.stage,
          m.status,
          now,
          'MANUAL',
          a.userId,
        );
      await this.core.event(tx, a, {
        entityType: 'SHIPMENT',
        entityId: s.id,
        lineageId: s.id,
        type: 'STATUS_CHANGED',
        title: `Status: ${s.status.replace(/_/g, ' ').toLowerCase()} → ${target.replace(/_/g, ' ').toLowerCase()}${dto.note ? ` — ${dto.note.trim()}` : ''}`,
      });
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'shipment.status_changed',
      entityType: 'Shipment',
      entityId: s.id,
      metadata: { from: s.status, to: target },
    });
    if (target === 'DEPARTED' || target === 'IN_TRANSIT')
      await this.prisma.$transaction((tx) =>
        this.core.crmActivity(
          tx,
          a.organizationId,
          s.crmLeadId,
          `Shipment ${s.shipmentNumber} departed`,
          a.userId,
          { shipmentId: s.id },
        ),
      );
    await this.refreshDerived(a, s.id);
    return this.detail(a, s.id);
  }

  async cancel(a: Actor, id: string, dto: ReasonDto) {
    return this.changeStatus(a, id, {
      status: 'CANCELLED',
      note: dto.reason,
      expectedRowVersion: dto.expectedRowVersion,
    });
  }

  // ----------------------------------------------------------- milestones

  private async applyMilestone(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    stage: ShipmentMilestoneStage,
    status: 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED',
    at: Date,
    source: string,
    userId: string | null,
    release = false,
  ) {
    const m = await tx.shipmentMilestone.findUnique({
      where: { shipmentId_stage: { shipmentId, stage } },
    });
    if (!m || m.status === 'COMPLETED' || m.status === 'SKIPPED') return;
    if (
      status === 'IN_PROGRESS' &&
      !(
        ['NOT_STARTED', 'PLANNED', 'DELAYED'].includes(m.status) ||
        (release && m.status === 'BLOCKED')
      )
    )
      return;
    await tx.shipmentMilestone.update({
      where: { id: m.id },
      data: {
        status,
        source,
        ...(status === 'COMPLETED'
          ? { actualAt: at, completedByUserId: userId }
          : {}),
      },
    });
  }

  async updateMilestone(
    a: Actor,
    id: string,
    milestoneId: string,
    dto: MilestoneDto,
  ) {
    const s = await this.load(a.organizationId, id);
    const m = await this.prisma.shipmentMilestone.findFirst({
      where: { id: milestoneId, shipmentId: s.id },
    });
    if (!m) throw new NotFoundException('Milestone not found.');
    const status = dto.status ?? m.status;
    if (
      ['SKIPPED', 'BLOCKED'].includes(status) &&
      status !== m.status &&
      !dto.reason?.trim()
    )
      throw new BadRequestException(
        `A reason is required to mark a stage ${status.toLowerCase()}.`,
      );
    let override = false;
    if (
      m.stage === 'DOCUMENTATION' &&
      status === 'COMPLETED' &&
      m.status !== 'COMPLETED'
    ) {
      const r = await this.ctx.readiness(a, s.purchaseOrderId);
      if (!r.documents.complete) {
        if (!dto.overrideReason?.trim())
          throw new ConflictException({
            message: `Documentation is not complete: ${r.documents.reasons.join(' ')}`,
            details: {
              code: 'DOCUMENTS_INCOMPLETE',
              reasons: r.documents.reasons,
            },
          });
        if (!this.can(a, 'logistics.override'))
          throw new ForbiddenException(
            'Only a manager can override the documentation gate.',
          );
        override = true;
      }
    }
    if (m.stage === 'DOCUMENTATION' && status === 'SKIPPED')
      throw new BadRequestException('Documentation cannot be skipped.');
    const dt = (v: string | null | undefined) =>
      v === undefined ? undefined : v ? new Date(v) : null;
    await this.prisma.shipmentMilestone.update({
      where: { id: m.id },
      data: {
        status,
        plannedAt: dt(dto.plannedAt),
        estimatedAt: dt(dto.estimatedAt),
        actualAt:
          status === 'COMPLETED'
            ? (dt(dto.actualAt) ?? m.actualAt ?? new Date())
            : dt(dto.actualAt),
        location:
          dto.location === undefined ? undefined : dto.location?.trim() || null,
        notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
        reason: override
          ? `Manager override: ${dto.overrideReason!.trim()}`
          : dto.reason?.trim() ||
            (['SKIPPED', 'BLOCKED', 'DELAYED'].includes(status)
              ? m.reason
              : null),
        source: 'MANUAL',
        completedByUserId:
          status === 'COMPLETED' ? a.userId : m.completedByUserId,
      },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'SHIPMENT',
      entityId: s.id,
      lineageId: s.id,
      type: 'MILESTONE',
      title: `${m.stage.toLowerCase()} stage: ${status.replace('_', ' ').toLowerCase()}${dto.reason ? ` — ${dto.reason.trim()}` : ''}${override ? ' (manager override)' : ''}`,
    });
    if (override)
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'shipment.documentation_override',
        entityType: 'Shipment',
        entityId: s.id,
        metadata: { reason: dto.overrideReason!.trim().slice(0, 300) },
      });
    await this.refreshDerived(a, s.id);
    return this.detail(a, s.id);
  }

  // ---------------------------------------------------- containers & legs

  async addContainer(a: Actor, id: string, dto: ContainerDto) {
    const s = await this.load(a.organizationId, id);
    if (!dto.containerNumber)
      throw new BadRequestException('Container number is required.');
    const c = containerCheck(dto.containerNumber);
    if (!c.formatValid)
      throw new BadRequestException({
        message:
          'Container number must be 4 letters (ending U, J or Z) and 7 digits, e.g. MSCU1234565.',
        details: { code: 'CONTAINER_FORMAT' },
      });
    if (!c.checkDigitValid && !dto.acceptCheckDigitMismatch)
      throw new BadRequestException({
        message: `${c.normalized}: the ISO 6346 check digit does not match. Check the number, or confirm it as written on the carrier document.`,
        details: { code: 'CONTAINER_CHECK_DIGIT' },
      });
    if (
      await this.prisma.shipmentContainer.findFirst({
        where: { shipmentId: s.id, containerNumber: c.normalized },
      })
    )
      throw new ConflictException({
        message: `${c.normalized} is already on this shipment.`,
        details: { code: 'DUPLICATE_CONTAINER' },
      });
    await this.prisma.shipmentContainer.create({
      data: {
        shipmentId: s.id,
        containerNumber: c.normalized,
        containerType: dto.containerType ?? null,
        sealNumber: dto.sealNumber ?? null,
        packageCount: dto.packageCount ?? null,
        grossWeightKg: dto.grossWeightKg ?? null,
        netWeightKg: dto.netWeightKg ?? null,
        checkDigitValid: c.checkDigitValid,
      },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'SHIPMENT',
      entityId: s.id,
      lineageId: s.id,
      type: 'CONTAINER',
      title: `Container ${c.normalized} added${c.checkDigitValid ? '' : ' (check digit not matching — kept as written)'}`,
    });
    return this.detail(a, s.id);
  }

  async updateContainer(a: Actor, id: string, cid: string, dto: ContainerDto) {
    const s = await this.load(a.organizationId, id);
    const x = await this.prisma.shipmentContainer.findFirst({
      where: { id: cid, shipmentId: s.id },
    });
    if (!x) throw new NotFoundException('Container not found.');
    await this.prisma.shipmentContainer.update({
      where: { id: x.id },
      data: {
        containerType: dto.containerType,
        sealNumber: dto.sealNumber,
        packageCount: dto.packageCount,
        grossWeightKg: dto.grossWeightKg,
        netWeightKg: dto.netWeightKg,
      },
    });
    return this.detail(a, s.id);
  }

  async deleteContainer(a: Actor, id: string, cid: string) {
    const s = await this.load(a.organizationId, id);
    if (!isPreDeparture(s.status as ShipmentStatus))
      throw new ConflictException(
        'Containers can only be removed before departure.',
      );
    const x = await this.prisma.shipmentContainer.findFirst({
      where: { id: cid, shipmentId: s.id },
    });
    if (!x) throw new NotFoundException('Container not found.');
    await this.prisma.shipmentContainer.delete({ where: { id: x.id } });
    await this.core.event(this.prisma, a, {
      entityType: 'SHIPMENT',
      entityId: s.id,
      lineageId: s.id,
      type: 'CONTAINER',
      title: `Container ${x.containerNumber} removed before departure`,
    });
    return this.detail(a, s.id);
  }

  async addLeg(a: Actor, id: string, dto: LegDto) {
    const s = await this.load(a.organizationId, id);
    const max = await this.prisma.shipmentLeg.aggregate({
      where: { shipmentId: s.id },
      _max: { sequence: true },
    });
    const dt = (v: string | null | undefined) => (v ? new Date(v) : null);
    await this.prisma.shipmentLeg.create({
      data: {
        shipmentId: s.id,
        sequence: (max._max.sequence ?? 0) + 1,
        mode: dto.mode ?? s.mode,
        origin: dto.origin ?? null,
        destination: dto.destination ?? null,
        carrier: dto.carrier ?? null,
        vesselName: dto.vesselName ?? null,
        voyageNumber: dto.voyageNumber ?? null,
        flightNumber: dto.flightNumber ?? null,
        plannedDeparture: dt(dto.plannedDeparture),
        plannedArrival: dt(dto.plannedArrival),
      },
    });
    return this.detail(a, s.id);
  }

  async updateLeg(a: Actor, id: string, legId: string, dto: LegDto) {
    const s = await this.load(a.organizationId, id);
    const l = await this.prisma.shipmentLeg.findFirst({
      where: { id: legId, shipmentId: s.id },
    });
    if (!l) throw new NotFoundException('Leg not found.');
    const dt = (v: string | null | undefined) =>
      v === undefined ? undefined : v ? new Date(v) : null;
    await this.prisma.shipmentLeg.update({
      where: { id: l.id },
      data: {
        mode: dto.mode,
        origin: dto.origin,
        destination: dto.destination,
        carrier: dto.carrier,
        vesselName: dto.vesselName,
        voyageNumber: dto.voyageNumber,
        flightNumber: dto.flightNumber,
        plannedDeparture: dt(dto.plannedDeparture),
        plannedArrival: dt(dto.plannedArrival),
      },
    });
    return this.detail(a, s.id);
  }

  // ------------------------------------------------------------- tracking

  async manualTracking(a: Actor, id: string, dto: TrackingEventDto) {
    const r = await this.addTracking(a, id, {
      eventType: dto.eventType as TrackingEventType,
      eventTime: new Date(dto.eventTime),
      estimated: Boolean(dto.estimated),
      location: dto.location?.trim() || null,
      containerNumber: dto.containerNumber
        ? containerCheck(dto.containerNumber).normalized
        : null,
      vesselName: dto.vesselName?.trim() || null,
      voyageNumber: dto.voyageNumber?.trim() || null,
      flightNumber: dto.flightNumber?.trim() || null,
      newEta: dto.newEta ? new Date(dto.newEta) : null,
      newEtd: dto.newEtd ? new Date(dto.newEtd) : null,
      description: dto.description?.trim() || null,
      source: (dto.source ?? 'MANUAL') as TrackingSource,
      sourceReference: dto.sourceReference?.trim() || null,
    });
    return { duplicate: r.duplicate, shipment: await this.detail(a, id) };
  }

  /**
   * Appends one tracking event (idempotent by event key) and applies its effects
   * deterministically: status never regresses on out-of-order events, ETA/ETD
   * history is preserved, exceptions come only from explicit events.
   */
  async addTracking(
    a: Actor,
    id: string,
    ev: TrackingInput,
    internal = false,
  ): Promise<{ duplicate: boolean; eventId: string | null }> {
    const org = a.organizationId;
    const s = await this.load(org, id);
    if (['ETA_CHANGED'].includes(ev.eventType) && !ev.newEta)
      throw new BadRequestException('Enter the new ETA.');
    if (['ETD_CHANGED'].includes(ev.eventType) && !ev.newEtd)
      throw new BadRequestException('Enter the new ETD.');
    if (ev.newEta && (ev.newEtd ?? s.etd) && ev.newEta < (ev.newEtd ?? s.etd)!)
      throw new BadRequestException({
        message: 'ETA cannot be before ETD.',
        details: { code: 'INVALID_ETA' },
      });
    if (
      ev.eventType === 'BOOKED' &&
      !(ev.sourceReference ?? s.bookingReference)
    )
      throw new BadRequestException({
        message:
          'A booking event needs the booking reference from your forwarder/carrier.',
        details: { code: 'BOOKING_REFERENCE_REQUIRED' },
      });
    if (
      ev.eventTime.getTime() > Date.now() + 5 * 60000 &&
      !ev.estimated &&
      !['ETA_CHANGED', 'ETD_CHANGED'].includes(ev.eventType)
    )
      throw new BadRequestException(
        'An actual event cannot be in the future — mark it as estimated.',
      );
    const key = eventKey([
      ev.eventType,
      ev.eventTime.toISOString(),
      ev.location,
      ev.containerNumber,
      ev.vesselName,
      ev.voyageNumber,
      ev.flightNumber,
      ev.newEta?.toISOString(),
      ev.newEtd?.toISOString(),
      ev.sourceReference,
      internal ? ev.description : null,
    ]);
    const dup = await this.prisma.shipmentTrackingEvent.findUnique({
      where: { shipmentId_eventKey: { shipmentId: s.id, eventKey: key } },
    });
    if (dup) return { duplicate: true, eventId: dup.id };
    const notes: string[] = [];
    const data: Prisma.ShipmentUpdateInput = {};
    let applied = true;
    let prevValue: string | null = null;
    let newValue: string | null = null;
    // ETA / ETD — newest information wins; older reports stay in history only.
    if (ev.newEta) {
      if (s.etaUpdatedAt && ev.eventTime < s.etaUpdatedAt)
        notes.push('Older than the latest ETA update — ETA not changed.');
      else {
        prevValue = fmtDay(s.eta);
        newValue = fmtDay(ev.newEta);
        data.eta = ev.newEta;
        data.etaUpdatedAt = ev.eventTime;
        if (!s.originalEta) data.originalEta = ev.newEta;
      }
    }
    if (ev.newEtd) {
      if (s.etdUpdatedAt && ev.eventTime < s.etdUpdatedAt)
        notes.push('Older than the latest ETD update — ETD not changed.');
      else {
        if (!ev.newEta) {
          prevValue = fmtDay(s.etd);
          newValue = fmtDay(ev.newEtd);
        }
        data.etd = ev.newEtd;
        data.etdUpdatedAt = ev.eventTime;
        if (!s.originalEtd) data.originalEtd = ev.newEtd;
      }
    }
    // Lifecycle — rank-based, never regressing.
    const target = EVENT_STATUS[ev.eventType];
    let statusChanged: ShipmentStatus | null = null;
    if (target && !ev.estimated) {
      const later = TRANSIT_EVENTS.includes(ev.eventType)
        ? await this.prisma.shipmentTrackingEvent.findFirst({
            where: {
              shipmentId: s.id,
              eventType: { in: TRANSIT_EVENTS },
              eventTime: { gt: ev.eventTime },
              estimated: false,
            },
          })
        : null;
      const d = eventStatusDecision(s.status as ShipmentStatus, target, !later);
      if (d.apply) {
        data.status = target;
        statusChanged = target;
      } else if (d.note) {
        notes.push(d.note);
        applied = false;
      }
    }
    if (!ev.estimated) {
      if (ev.eventType === 'DEPARTED' && !s.actualDeparture)
        data.actualDeparture = ev.eventTime;
      if (
        (ev.eventType === 'ARRIVED' || ev.eventType === 'DISCHARGED') &&
        !s.actualArrival
      )
        data.actualArrival = ev.eventTime;
      if (ev.eventType === 'DELIVERED' && !s.deliveredAt)
        data.deliveredAt = ev.eventTime;
      if (ev.eventType === 'CUSTOMS_CLEARED' && !s.customsClearedAt)
        data.customsClearedAt = ev.eventTime;
    }
    if (ev.eventType === 'BOOKED' && ev.sourceReference && !s.bookingReference)
      data.bookingReference = ev.sourceReference;
    if (
      ev.vesselName &&
      ['DEPARTED', 'LOADED'].includes(ev.eventType) &&
      !s.vesselName
    )
      data.vesselName = ev.vesselName;
    if (
      ev.voyageNumber &&
      ['DEPARTED', 'LOADED'].includes(ev.eventType) &&
      !s.voyageNumber
    )
      data.voyageNumber = ev.voyageNumber;
    const delayVsOriginal = data.eta
      ? dayDiff(
          s.originalEta ?? (data.originalEta as Date | undefined) ?? null,
          data.eta as Date,
        )
      : null;
    const label = ev.eventType.replace(/_/g, ' ').toLowerCase();
    const description =
      ev.description ??
      (ev.newEta && newValue
        ? `ETA ${prevValue ?? 'not set'} → ${newValue}${delayVsOriginal ? ` (${delayVsOriginal > 0 ? '+' : ''}${delayVsOriginal} day${Math.abs(delayVsOriginal) === 1 ? '' : 's'} vs original)` : ''}`
        : ev.newEtd && newValue
          ? `ETD ${prevValue ?? 'not set'} → ${newValue}`
          : `${label[0].toUpperCase()}${label.slice(1)}${ev.location ? ` at ${ev.location}` : ''}`);
    const evRow = await this.prisma.$transaction(async (tx) => {
      const row = await tx.shipmentTrackingEvent.create({
        data: {
          organizationId: org,
          shipmentId: s.id,
          eventKey: key,
          eventType: ev.eventType,
          eventTime: ev.eventTime,
          estimated: ev.estimated,
          location: ev.location,
          containerNumber: ev.containerNumber,
          vesselName: ev.vesselName,
          voyageNumber: ev.voyageNumber,
          flightNumber: ev.flightNumber,
          source: ev.source,
          sourceReference: ev.sourceReference,
          description: description.slice(0, 1000),
          // Reported values are kept even when an older report is not applied.
          previousValue:
            prevValue ??
            (ev.newEta ? fmtDay(s.eta) : ev.newEtd ? fmtDay(s.etd) : null),
          newValue:
            newValue ??
            (ev.newEta
              ? fmtDay(ev.newEta)
              : ev.newEtd
                ? fmtDay(ev.newEtd)
                : null),
          applied: applied && !notes.some((n) => n.startsWith('Older')),
          appliedNote: notes.join(' ') || null,
          createdByUserId: ev.source === 'CARRIER_API' ? null : a.userId,
        },
      });
      if (Object.keys(data).length)
        await tx.shipment.update({
          where: { id: s.id },
          data: { ...data, rowVersion: { increment: 1 } },
        });
      if (applied && !ev.estimated)
        for (const m of EVENT_MILESTONES[ev.eventType] ?? [])
          await this.applyMilestone(
            tx,
            s.id,
            m.stage,
            m.status,
            ev.eventTime,
            ev.source,
            ev.source === 'CARRIER_API' ? null : a.userId,
            ev.eventType === 'CUSTOMS_RELEASED',
          );
      if (data.eta)
        await tx.shipmentMilestone.updateMany({
          where: {
            shipmentId: s.id,
            stage: 'DESTINATION',
            status: { notIn: ['COMPLETED', 'SKIPPED'] },
          },
          data: { estimatedAt: data.eta as Date },
        });
      if (data.etd)
        await tx.shipmentMilestone.updateMany({
          where: {
            shipmentId: s.id,
            stage: 'VESSEL',
            status: { notIn: ['COMPLETED', 'SKIPPED'] },
          },
          data: { estimatedAt: data.etd as Date },
        });
      // Legs: transshipment arrivals/departures extend the route; history is preserved.
      if (!ev.estimated) await this.applyLegs(tx, s, ev);
      const ex = EVENT_EXCEPTIONS[ev.eventType];
      if (ex)
        await tx.shipmentException.create({
          data: {
            organizationId: org,
            shipmentId: s.id,
            type: ex.type,
            severity: ex.severity,
            autoKey: `EVT:${row.id}`,
            source: ev.source,
            trackingEventId: row.id,
            title: `${ex.title}${ev.location ? ` at ${ev.location}` : ''}`,
            description: ev.description,
            location: ev.location,
            occurredAt: ev.eventTime,
          },
        });
      await this.core.event(tx, a, {
        entityType: 'SHIPMENT',
        entityId: s.id,
        lineageId: s.id,
        type: 'TRACKING',
        title: `${description}${ev.source !== 'MANUAL' ? ` [${ev.source.replace('_', ' ').toLowerCase()}]` : ' [manual]'}${statusChanged ? ` — status ${statusChanged.replace(/_/g, ' ').toLowerCase()}` : ''}`,
      });
      return row;
    });
    await this.audit.record({
      organizationId: org,
      actorId: ev.source === 'CARRIER_API' ? null : a.userId,
      action: 'shipment.tracking_added',
      entityType: 'Shipment',
      entityId: s.id,
      metadata: {
        eventType: ev.eventType,
        source: ev.source,
        applied: evRow.applied,
      },
    });
    if (data.eta || data.etd)
      await this.audit.record({
        organizationId: org,
        actorId: a.userId,
        action: 'shipment.eta_changed',
        entityType: 'Shipment',
        entityId: s.id,
        metadata: {
          field: data.eta ? 'eta' : 'etd',
          from: prevValue,
          to: newValue,
        },
      });
    if (statusChanged)
      await this.audit.record({
        organizationId: org,
        actorId: a.userId,
        action: 'shipment.status_changed',
        entityType: 'Shipment',
        entityId: s.id,
        metadata: { from: s.status, to: statusChanged, via: ev.eventType },
      });
    if (EVENT_EXCEPTIONS[ev.eventType])
      await this.audit.record({
        organizationId: org,
        actorId: a.userId,
        action: 'shipment.exception_created',
        entityType: 'Shipment',
        entityId: s.id,
        metadata: {
          type: EVENT_EXCEPTIONS[ev.eventType]!.type,
          source: ev.source,
        },
      });
    if (statusChanged === 'IN_TRANSIT' && ev.eventType === 'DEPARTED')
      await this.prisma.$transaction((tx) =>
        this.core.crmActivity(
          tx,
          org,
          s.crmLeadId,
          `Shipment ${s.shipmentNumber} departed`,
          a.userId,
          { shipmentId: s.id },
        ),
      );
    const etaDelayed =
      ev.eventType === 'ETA_CHANGED' &&
      data.eta &&
      prevValue &&
      newValue &&
      newValue > prevValue;
    if (
      !ev.estimated &&
      (evRow.applied || ev.eventType === 'ETA_CHANGED') &&
      (ev.eventType !== 'ETA_CHANGED' || etaDelayed)
    )
      await this.maybeDraft(
        a,
        s.id,
        ev.eventType,
        evRow.id,
        ev.source === 'MANUAL' && ev.eventType.endsWith('_DELAY'),
      );
    await this.refreshDerived(a, s.id);
    return { duplicate: false, eventId: evRow.id };
  }

  private async applyLegs(
    tx: Prisma.TransactionClient,
    s: Ship,
    ev: TrackingInput,
  ) {
    const legs = await tx.shipmentLeg.findMany({
      where: { shipmentId: s.id },
      orderBy: { sequence: 'asc' },
    });
    const last = legs[legs.length - 1];
    if (ev.eventType === 'DEPARTED') {
      if (!legs.length)
        await tx.shipmentLeg.create({
          data: {
            shipmentId: s.id,
            sequence: 1,
            mode: s.mode,
            origin: ev.location ?? s.portOfLoading,
            destination: s.portOfDischarge,
            carrier: s.shippingLine ?? s.carrier,
            vesselName: ev.vesselName ?? s.vesselName,
            voyageNumber: ev.voyageNumber ?? s.voyageNumber,
            flightNumber: ev.flightNumber ?? s.flightNumber,
            plannedDeparture: s.etd,
            actualDeparture: ev.eventTime,
            status: 'DEPARTED',
          },
        });
      else if (!legs[0].actualDeparture)
        await tx.shipmentLeg.update({
          where: { id: legs[0].id },
          data: {
            actualDeparture: ev.eventTime,
            status: 'DEPARTED',
            vesselName: legs[0].vesselName ?? ev.vesselName,
            voyageNumber: legs[0].voyageNumber ?? ev.voyageNumber,
          },
        });
    }
    if (ev.eventType === 'TRANSSHIPMENT_ARRIVED' && last && !last.actualArrival)
      await tx.shipmentLeg.update({
        where: { id: last.id },
        data: {
          actualArrival: ev.eventTime,
          destination: ev.location ?? last.destination,
          status: 'ARRIVED',
        },
      });
    if (ev.eventType === 'TRANSSHIPMENT_DEPARTED')
      await tx.shipmentLeg.create({
        data: {
          shipmentId: s.id,
          sequence: (last?.sequence ?? 0) + 1,
          mode: s.mode,
          origin: ev.location ?? last?.destination ?? null,
          destination: s.portOfDischarge,
          carrier: s.shippingLine ?? s.carrier,
          vesselName: ev.vesselName,
          voyageNumber: ev.voyageNumber,
          flightNumber: ev.flightNumber,
          actualDeparture: ev.eventTime,
          status: 'DEPARTED',
        },
      });
    if (
      (ev.eventType === 'ARRIVED' || ev.eventType === 'DISCHARGED') &&
      last &&
      !last.actualArrival
    )
      await tx.shipmentLeg.update({
        where: { id: last.id },
        data: {
          actualArrival: ev.eventTime,
          destination: last.destination ?? ev.location,
          status: 'ARRIVED',
        },
      });
  }

  /** Provider-fed tracking. Without a configured provider nothing is fetched (no scraping, no fabricated live data). */
  async refreshTracking(a: Actor, id: string) {
    const s = await this.load(a.organizationId, id);
    if (!this.provider.configured)
      throw new ConflictException({
        message:
          'No carrier tracking provider is configured. Record tracking updates manually.',
        details: { code: 'TRACKING_PROVIDER_UNAVAILABLE' },
      });
    const containers = await this.prisma.shipmentContainer.findMany({
      where: { shipmentId: s.id },
      select: { containerNumber: true },
    });
    let events: ProviderTrackingEvent[] = [];
    try {
      events = await this.provider.fetch({
        mode: s.mode,
        carrier: s.shippingLine ?? s.carrier,
        bookingReference: s.bookingReference,
        blNumber: s.blNumber,
        awbNumber: s.awbNumber,
        containerNumbers: containers.map((c) => c.containerNumber),
      });
    } catch (e) {
      // Failure keeps history and the last good update; the shipment is not marked failed.
      await this.prisma.shipment.update({
        where: { id: s.id },
        data: {
          trackingLastError:
            e instanceof Error
              ? e.message.slice(0, 300)
              : 'Provider unavailable.',
        },
      });
      return this.detail(a, s.id);
    }
    await this.ingest(a, s.id, events);
    await this.prisma.shipment.update({
      where: { id: s.id },
      data: {
        trackingLastFetchedAt: new Date(),
        trackingLastError: null,
        trackingProvider: this.provider.name,
      },
    });
    return this.detail(a, s.id);
  }

  /** Provider events in any order; duplicates are ignored by event key. */
  async ingest(a: Actor, id: string, events: ProviderTrackingEvent[]) {
    let added = 0;
    for (const e of [...events].sort(
      (x, y) => x.eventTime.getTime() - y.eventTime.getTime(),
    )) {
      const r = await this.addTracking(a, id, { ...e, source: 'CARRIER_API' });
      if (!r.duplicate) added++;
    }
    return added;
  }

  async trackingList(a: Actor, id: string) {
    return (await this.detail(a, id)).trackingEvents;
  }

  // ----------------------------------------------------------- exceptions

  async createException(a: Actor, id: string, dto: ExceptionDto) {
    const s = await this.load(a.organizationId, id);
    const e = await this.prisma.shipmentException.create({
      data: {
        organizationId: a.organizationId,
        shipmentId: s.id,
        type: dto.type,
        severity: dto.severity,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        impact: dto.impact?.trim() || null,
        location: dto.location?.trim() || null,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : null,
        ownerUserId: dto.ownerUserId ?? a.userId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        source: 'MANUAL',
        createdByUserId: a.userId,
      },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'SHIPMENT',
      entityId: s.id,
      lineageId: s.id,
      type: 'EXCEPTION',
      title: `${dto.severity.toLowerCase()} exception: ${e.title}`,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'shipment.exception_created',
      entityType: 'ShipmentException',
      entityId: e.id,
      metadata: { type: e.type, severity: e.severity },
    });
    await this.refreshDerived(a, s.id);
    return this.detail(a, s.id);
  }

  async resolveException(
    a: Actor,
    exceptionId: string,
    dto: ResolveExceptionDto,
  ) {
    const e = await this.prisma.shipmentException.findFirst({
      where: { id: exceptionId, organizationId: a.organizationId },
    });
    if (!e) throw new NotFoundException('Exception not found.');
    if (e.status === 'RESOLVED')
      throw new ConflictException('Already resolved.');
    await this.prisma.shipmentException.update({
      where: { id: e.id },
      data: {
        status: 'RESOLVED',
        resolution: dto.resolution.trim(),
        resolvedAt: new Date(),
        resolvedByUserId: a.userId,
      },
    });
    if (e.type === 'CUSTOMS_HOLD')
      await this.prisma.shipmentMilestone.updateMany({
        where: {
          shipmentId: e.shipmentId,
          stage: 'CUSTOMS',
          status: 'BLOCKED',
        },
        data: { status: 'IN_PROGRESS' },
      });
    await this.core.event(this.prisma, a, {
      entityType: 'SHIPMENT',
      entityId: e.shipmentId,
      lineageId: e.shipmentId,
      type: 'EXCEPTION_RESOLVED',
      title: `Exception resolved: ${e.title} — ${dto.resolution.trim().slice(0, 120)}`,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'shipment.exception_resolved',
      entityType: 'ShipmentException',
      entityId: e.id,
      metadata: { type: e.type },
    });
    await this.refreshDerived(a, e.shipmentId);
    return this.detail(a, e.shipmentId);
  }

  async exceptions(
    a: Actor,
    q: ListQueryDto,
  ): Promise<LogisticsList<ShipmentExceptionView>> {
    const where: Prisma.ShipmentExceptionWhereInput = {
      organizationId: a.organizationId,
      ...(q.status && q.status !== 'ALL' ? { status: q.status } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.type ? { type: q.type } : {}),
    };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.shipmentException.findMany({
        where,
        include: { shipment: { select: { shipmentNumber: true } } },
        orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.shipmentException.count({ where }),
    ]);
    const names = await this.core.userNames(
      rows.flatMap((r) => [r.ownerUserId, r.resolvedByUserId]),
    );
    return {
      items: rows.map((r) =>
        this.exceptionView(r, names, r.shipment.shipmentNumber),
      ),
      meta: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  // --------------------------------------------------------------- claims

  async createClaim(a: Actor, id: string, dto: ClaimDto) {
    const s = await this.load(a.organizationId, id);
    if (!dto.description?.trim())
      throw new BadRequestException('Describe the damage or loss.');
    if (
      dto.exceptionId &&
      !(await this.prisma.shipmentException.findFirst({
        where: { id: dto.exceptionId, shipmentId: s.id },
      }))
    )
      throw new NotFoundException('Exception not found.');
    const c = await this.prisma.shipmentClaim.create({
      data: {
        organizationId: a.organizationId,
        shipmentId: s.id,
        exceptionId: dto.exceptionId ?? null,
        description: dto.description.trim(),
        quantityAffected: dto.quantityAffected ?? null,
        estimatedLoss: dto.estimatedLoss ?? null,
        currency: dto.currency ?? null,
        claimReference: dto.claimReference ?? null,
        insurerReference: dto.insurerReference ?? null,
        carrierReference: dto.carrierReference ?? null,
        notes: dto.notes ?? null,
        createdByUserId: a.userId,
      },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'SHIPMENT',
      entityId: s.id,
      lineageId: s.id,
      type: 'CLAIM',
      title: `Damage/claim record created: ${c.description.slice(0, 100)}`,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'shipment.claim_created',
      entityType: 'ShipmentClaim',
      entityId: c.id,
      metadata: { exceptionId: c.exceptionId },
    });
    return this.detail(a, s.id);
  }

  async updateClaim(a: Actor, claimId: string, dto: ClaimDto) {
    const c = await this.prisma.shipmentClaim.findFirst({
      where: { id: claimId, organizationId: a.organizationId },
    });
    if (!c) throw new NotFoundException('Claim not found.');
    if (c.status === 'CLOSED')
      throw new ConflictException('A closed claim record cannot be changed.');
    await this.prisma.shipmentClaim.update({
      where: { id: c.id },
      data: {
        status: dto.status,
        quantityAffected: dto.quantityAffected,
        estimatedLoss: dto.estimatedLoss,
        currency: dto.currency,
        claimReference: dto.claimReference,
        insurerReference: dto.insurerReference,
        carrierReference: dto.carrierReference,
        notes: dto.notes,
      },
    });
    if (dto.status && dto.status !== c.status)
      await this.core.event(this.prisma, a, {
        entityType: 'SHIPMENT',
        entityId: c.shipmentId,
        lineageId: c.shipmentId,
        type: 'CLAIM',
        title: `Claim status: ${c.status.toLowerCase()} → ${dto.status.toLowerCase()}`,
      });
    return this.detail(a, c.shipmentId);
  }

  // -------------------------------------------------------- attachments

  async attach(
    a: Actor,
    id: string,
    file: Express.Multer.File,
    target: { exceptionId?: string; claimId?: string },
  ) {
    const s = await this.load(a.organizationId, id);
    if (
      target.exceptionId &&
      !(await this.prisma.shipmentException.findFirst({
        where: { id: target.exceptionId, shipmentId: s.id },
      }))
    )
      throw new NotFoundException('Exception not found.');
    if (
      target.claimId &&
      !(await this.prisma.shipmentClaim.findFirst({
        where: { id: target.claimId, shipmentId: s.id },
      }))
    )
      throw new NotFoundException('Claim not found.');
    await this.freight.attach(
      a,
      {
        type: 'SHIPMENT',
        id: s.id,
        shipmentId: s.id,
        exceptionId: target.exceptionId,
        claimId: target.claimId,
      },
      file,
    );
    return this.detail(a, s.id);
  }

  // ------------------------------------------------------- buyer updates

  private async updateData(a: Actor, s: Ship, reason: string | null) {
    const c = await this.ctx.po(a.organizationId, s.purchaseOrderId);
    const containers = await this.prisma.shipmentContainer.findMany({
      where: { shipmentId: s.id },
      select: { containerNumber: true },
    });
    const prevEta = await this.prisma.shipmentTrackingEvent.findFirst({
      where: { shipmentId: s.id, eventType: 'ETA_CHANGED', applied: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      shipmentNumber: s.shipmentNumber,
      poNumber: c.po.poNumber,
      buyerName: c.buyer?.canonicalName ?? 'Buyer',
      exporterName: c.exporterName,
      mode: s.mode,
      route: this.route(s),
      carrier: s.shippingLine ?? s.carrier,
      vessel: s.vesselName,
      voyage: s.voyageNumber,
      flight: s.flightNumber,
      bookingReference: s.bookingReference,
      blNumber: s.blNumber,
      awbNumber: s.awbNumber,
      containers: containers.map((x) => x.containerNumber),
      etd: fmtDay(s.etd),
      eta: fmtDay(s.eta),
      previousEta: prevEta?.previousValue ?? fmtDay(s.originalEta),
      actualDeparture: fmtDay(s.actualDeparture),
      actualArrival: fmtDay(s.actualArrival),
      deliveredAt: fmtDay(s.deliveredAt),
      delayReason: reason,
    };
  }

  /** Drafts only (never sent). Not created from estimated/unapplied events. */
  private async maybeDraft(
    a: Actor,
    shipmentId: string,
    eventType: TrackingEventType,
    eventId: string | null,
    skip: boolean,
  ) {
    const trigger = UPDATE_TRIGGER[eventType];
    if (!trigger || skip) return;
    const st = await this.rawSettings(a.organizationId);
    if (!st.autoDraftBuyerUpdates) return;
    const s = await this.load(a.organizationId, shipmentId);
    const ev = eventId
      ? await this.prisma.shipmentTrackingEvent.findUnique({
          where: { id: eventId },
        })
      : null;
    const t = buyerUpdateTemplate(
      trigger,
      await this.updateData(a, s, ev?.description ?? null),
    );
    await this.prisma.shipmentBuyerUpdate.create({
      data: {
        organizationId: a.organizationId,
        shipmentId,
        trigger,
        trackingEventId: eventId,
        subject: t.subject,
        message: t.message,
        status: 'DRAFT',
        createdByUserId: null,
      },
    });
  }

  async generateUpdate(a: Actor, id: string, dto: GenerateUpdateDto) {
    const s = await this.load(a.organizationId, id);
    const need: Record<string, () => boolean> = {
      DEPARTED: () => Boolean(s.actualDeparture),
      ARRIVED: () => Boolean(s.actualArrival),
      DELIVERED: () => Boolean(s.deliveredAt),
      BOOKING_CONFIRMED: () => Boolean(s.bookingReference),
      ETA_UPDATED: () => Boolean(s.eta),
    };
    if (need[dto.trigger] && !need[dto.trigger]())
      throw new ConflictException({
        message: `There is no recorded ${dto.trigger.replace('_', ' ').toLowerCase()} event to report — updates only describe known events.`,
        details: { code: 'EVENT_NOT_RECORDED' },
      });
    const t = buyerUpdateTemplate(
      dto.trigger,
      await this.updateData(a, s, null),
    );
    await this.prisma.shipmentBuyerUpdate.create({
      data: {
        organizationId: a.organizationId,
        shipmentId: s.id,
        trigger: dto.trigger,
        subject: t.subject,
        message: t.message,
        status: 'DRAFT',
        createdByUserId: a.userId,
      },
    });
    return this.detail(a, s.id);
  }

  async approveUpdate(a: Actor, id: string, updateId: string) {
    const u = await this.prisma.shipmentBuyerUpdate.findFirst({
      where: { id: updateId, shipmentId: id, organizationId: a.organizationId },
    });
    if (!u) throw new NotFoundException('Buyer update not found.');
    if (u.status !== 'DRAFT')
      throw new ConflictException('Only a draft can be approved.');
    await this.prisma.shipmentBuyerUpdate.update({
      where: { id: u.id },
      data: {
        status: 'APPROVED',
        approvedByUserId: a.userId,
        approvedAt: new Date(),
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'buyer_update.approved',
      entityType: 'ShipmentBuyerUpdate',
      entityId: u.id,
      metadata: { trigger: u.trigger },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'SHIPMENT',
      entityId: id,
      lineageId: id,
      type: 'BUYER_UPDATE',
      title: `Buyer update approved: ${u.subject} (copy it into your email — not sent by ExportPro)`,
    });
    return this.detail(a, id);
  }

  /** The user records that they sent the approved text themselves; ExportPro never claims to have sent it. */
  async recordSent(a: Actor, id: string, updateId: string, dto: RecordSentDto) {
    const u = await this.prisma.shipmentBuyerUpdate.findFirst({
      where: { id: updateId, shipmentId: id, organizationId: a.organizationId },
    });
    if (!u) throw new NotFoundException('Buyer update not found.');
    if (u.status !== 'APPROVED')
      throw new ConflictException(
        'Approve the update before recording that it was sent.',
      );
    await this.prisma.shipmentBuyerUpdate.update({
      where: { id: u.id },
      data: {
        status: 'RECORDED_SENT',
        channel: dto.channel,
        recordedSentByUserId: a.userId,
        recordedSentAt: new Date(),
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'buyer_update.recorded_sent',
      entityType: 'ShipmentBuyerUpdate',
      entityId: u.id,
      metadata: { channel: dto.channel },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'SHIPMENT',
      entityId: id,
      lineageId: id,
      type: 'BUYER_UPDATE',
      title: `User recorded sending “${u.subject}” via ${dto.channel.toLowerCase()} (outside ExportPro)`,
    });
    return this.detail(a, id);
  }

  async discardUpdate(a: Actor, id: string, updateId: string) {
    const u = await this.prisma.shipmentBuyerUpdate.findFirst({
      where: { id: updateId, shipmentId: id, organizationId: a.organizationId },
    });
    if (!u) throw new NotFoundException('Buyer update not found.');
    if (u.status === 'RECORDED_SENT')
      throw new ConflictException('A sent update is kept as history.');
    await this.prisma.shipmentBuyerUpdate.update({
      where: { id: u.id },
      data: { status: 'DISCARDED' },
    });
    return this.detail(a, id);
  }

  async updates(a: Actor, id: string) {
    return (await this.detail(a, id)).buyerUpdates;
  }

  // ----------------------------------------------------------------- costs

  /** Logistics actuals only (for Sprint 19); no profitability is calculated here. */
  async updateCosts(a: Actor, id: string, dto: CostsDto) {
    const s = await this.load(a.organizationId, id);
    this.guard(s, dto.expectedRowVersion);
    const any = [
      dto.actualFreight,
      dto.actualSurcharges,
      dto.actualLocalCharges,
    ].some((x) => x);
    if (any && !(dto.currency ?? s.actualCostCurrency))
      throw new BadRequestException('Choose the currency of the actual costs.');
    await this.prisma.shipment.update({
      where: { id: s.id },
      data: {
        actualFreight: dto.actualFreight,
        actualSurcharges: dto.actualSurcharges,
        actualLocalCharges: dto.actualLocalCharges,
        actualCostCurrency: dto.currency,
        actualCostNotes: dto.notes,
        rowVersion: { increment: 1 },
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'shipment.costs_updated',
      entityType: 'Shipment',
      entityId: s.id,
      metadata: {
        fields: Object.keys(dto).filter((k) => k !== 'expectedRowVersion'),
      },
    });
    return this.detail(a, s.id);
  }

  readonly statusRank = STATUS_RANK;
}
