import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { ConflictException, Injectable } from '@nestjs/common';
import { MembershipRole, Prisma } from '@prisma/client';
import {
  type BankDetails,
  type CommercialEvent,
  type CommercialSettings,
  countryLabel,
  type PartySnapshot,
  roleHasPermission,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { type JpegImage, readJpeg } from './pdf/pdf-writer';
import type { UpdateSettingsDto } from './commercial.dto';

export interface Actor {
  organizationId: string;
  userId: string;
  role: MembershipRole;
}
export type Tx = Prisma.TransactionClient;

const STAGE_ORDER = [
  'NEW',
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'QUALIFIED',
  'QUOTATION',
  'NEGOTIATION',
  'SAMPLE',
  'PO',
  'SHIPMENT',
];

/** Editable starter text only — never inserted automatically and not legal advice. */
export const STARTER_TERMS = `1. Validity: this offer is valid until the date stated above.
2. Prices: as stated, per the Incoterms(R) rule and named place shown.
3. Payment: as per the payment terms above.
4. Delivery: shipment timing is subject to confirmation of order and receipt of payment/LC where applicable.
5. Quality & packing: as per the agreed specification and packing; tolerance, if any, to be agreed in writing.
6. Force majeure: neither party is liable for delays caused by events beyond reasonable control.
7. Disputes: to be resolved amicably; governing law/arbitration to be agreed in the contract.`;

export const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
export const day = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;

@Injectable()
export class CommercialCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ settings

  async rawSettings(organizationId: string) {
    const existing = await this.prisma.commercialSettings.findUnique({
      where: { organizationId },
    });
    if (existing) return existing;
    // First use: concurrent requests may race to create the row.
    await this.prisma.commercialSettings.createMany({
      data: [{ organizationId }],
      skipDuplicates: true,
    });
    return this.prisma.commercialSettings.findUniqueOrThrow({
      where: { organizationId },
    });
  }

  canSeeBank(role: MembershipRole) {
    return (
      roleHasPermission(role, 'commercial.settings') ||
      roleHasPermission(role, 'proforma_invoice.issue')
    );
  }

  maskBank(b: BankDetails | null, reveal: boolean): BankDetails | null {
    if (!b || reveal) return b;
    const m = (v: string | null) =>
      v ? `•••• ${v.replace(/\s/g, '').slice(-4)}` : null;
    return { ...b, accountNumber: m(b.accountNumber), iban: m(b.iban) };
  }

  async settings(a: Actor): Promise<CommercialSettings> {
    const s = await this.rawSettings(a.organizationId);
    const reveal = roleHasPermission(a.role, 'commercial.settings');
    return {
      quotationPrefix: s.quotationPrefix,
      piPrefix: s.piPrefix,
      yearlyReset: s.yearlyReset,
      unitPricePrecision: s.unitPricePrecision,
      defaultValidityDays: s.defaultValidityDays,
      quantityTolerancePercent: s.quantityTolerancePercent.toString(),
      priceTolerancePercent: s.priceTolerancePercent.toString(),
      quotationTerms: s.quotationTerms,
      piTerms: s.piTerms,
      bankDetails: this.maskBank(
        (s.bankDetails as unknown as BankDetails | null) ?? null,
        reveal,
      ),
      bankDetailsMasked: !reveal && Boolean(s.bankDetails),
    };
  }

  async updateSettings(a: Actor, dto: UpdateSettingsDto) {
    await this.rawSettings(a.organizationId);
    const data: Prisma.CommercialSettingsUpdateInput = {
      updatedByUserId: a.userId,
    };
    for (const k of [
      'quotationPrefix',
      'piPrefix',
      'yearlyReset',
      'unitPricePrecision',
      'defaultValidityDays',
      'quantityTolerancePercent',
      'priceTolerancePercent',
      'quotationTerms',
      'piTerms',
    ] as const)
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
    if (dto.bankDetails !== undefined)
      data.bankDetails = dto.bankDetails
        ? (dto.bankDetails as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull;
    await this.prisma.commercialSettings.update({
      where: { organizationId: a.organizationId },
      data,
    });
    // Field names only — bank details and terms are never written to the audit log.
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'commercial.settings_updated',
      entityType: 'CommercialSettings',
      entityId: a.organizationId,
      metadata: { fields: Object.keys(dto) },
    });
    return this.settings(a);
  }

  // ----------------------------------------------------------- numbering

  /**
   * Atomic, organization-scoped counter (INSERT … ON CONFLICT … RETURNING).
   * Safe under concurrency; numbers are never derived from row counts and never reused.
   */
  async nextNumber(
    tx: Tx,
    organizationId: string,
    docType:
      | 'QUOTATION'
      | 'PI'
      | 'CI'
      | 'PL'
      | 'SI'
      | 'SHP'
      | 'FR'
      | 'RCV'
      | 'SRFQ'
      | 'SPO'
      | 'GRN',
    prefix: string,
    yearlyReset: boolean,
    now = new Date(),
  ) {
    const year = yearlyReset ? now.getUTCFullYear() : 0;
    const rows = await tx.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO commercial_number_sequences (id, "organizationId", "docType", year, "lastValue")
      VALUES (${randomUUID()}, ${organizationId}, ${docType}, ${year}, 1)
      ON CONFLICT ("organizationId", "docType", year)
      DO UPDATE SET "lastValue" = commercial_number_sequences."lastValue" + 1
      RETURNING "lastValue"`;
    const n = String(rows[0].lastValue).padStart(6, '0');
    return yearlyReset
      ? `${prefix}-${now.getUTCFullYear()}-${n}`
      : `${prefix}-${n}`;
  }

  // ----------------------------------------------------------- snapshots

  /** Exporter identity from the organization profile (nothing invented; registrations only when recorded). */
  async exporterSnapshot(organizationId: string): Promise<PartySnapshot> {
    const o = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const regs = await this.prisma.registration.findMany({
      where: {
        organizationId,
        number: { not: null },
        type: { in: ['IEC', 'GST'] },
      },
      select: { type: true, number: true },
    });
    const address =
      [o.addressLine1, o.addressLine2, o.city, o.state, o.postalCode]
        .filter(Boolean)
        .join(', ') || null;
    return {
      name: o.name,
      legalName: o.legalName,
      address,
      country: o.country ? countryLabel(o.country) : null,
      contactName: null,
      email: o.email,
      phone: o.phone,
      website: o.website,
      registrations: regs.map((r) => ({ type: r.type, number: r.number! })),
      hasLogo: Boolean(o.logoUrl),
    };
  }

  /** Buyer identity at issue time; later buyer-profile edits never change issued documents. */
  async buyerSnapshot(
    organizationId: string,
    buyerCompanyId: string | null,
    buyerName: string | null,
    contactId: string | null,
  ): Promise<PartySnapshot> {
    if (!buyerCompanyId)
      return {
        name: buyerName ?? 'Buyer',
        address: null,
        country: null,
        contactName: null,
        email: null,
        phone: null,
      };
    const b = await this.prisma.buyerCompany.findFirst({
      where: {
        id: buyerCompanyId,
        OR: [
          { ownerOrganizationId: null },
          { ownerOrganizationId: organizationId },
        ],
      },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { confidence: 'desc' }] },
      },
    });
    if (!b)
      return {
        name: buyerName ?? 'Buyer',
        address: null,
        country: null,
        contactName: null,
        email: null,
        phone: null,
      };
    const pick = contactId
      ? b.contacts.find((c) => c.id === contactId)
      : b.contacts.find(
          (c) =>
            c.contactType === 'EMAIL' && c.verificationStatus !== 'INVALID',
        );
    const phone = b.contacts.find(
      (c) => c.contactType === 'PHONE' && c.verificationStatus !== 'INVALID',
    );
    return {
      name: b.canonicalName,
      address:
        [b.address, b.city, b.stateRegion].filter(Boolean).join(', ') || null,
      country: countryLabel(b.countryCode),
      contactName: pick?.name ?? null,
      email: pick?.contactType === 'EMAIL' ? pick.value : null,
      phone: phone?.value ?? null,
      website: b.website,
    };
  }

  /** Organization logo for PDFs (JPEG only; other formats fall back to the company name). */
  async logo(organizationId: string): Promise<JpegImage | null> {
    const o = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { logoUrl: true },
    });
    if (!o?.logoUrl?.startsWith('/uploads/')) return null;
    const path = normalize(join(process.cwd(), o.logoUrl));
    if (!path.startsWith(join(process.cwd(), 'uploads'))) return null;
    const buf = await readFile(path).catch(() => null);
    return buf ? readJpeg(buf) : null;
  }

  // --------------------------------------------------- timeline / CRM

  event(
    tx: Tx | PrismaService,
    a: { organizationId: string; userId: string | null },
    e: {
      entityType:
        | 'QUOTATION'
        | 'PI'
        | 'PO'
        | 'DOCUMENT'
        | 'COMPLIANCE'
        | 'VALIDATION'
        | 'SHIPMENT'
        | 'FREIGHT'
        | 'RECEIVABLE'
        | 'PROFITABILITY';
      entityId: string;
      lineageId: string;
      type: string;
      title: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return tx.commercialEvent.create({
      data: {
        organizationId: a.organizationId,
        entityType: e.entityType,
        entityId: e.entityId,
        lineageId: e.lineageId,
        type: e.type,
        title: e.title,
        actorUserId: a.userId,
        metadata: (e.metadata ?? undefined) as
          Prisma.InputJsonValue | undefined,
      },
    });
  }

  async events(
    organizationId: string,
    lineageIds: string[],
  ): Promise<CommercialEvent[]> {
    const rows = await this.prisma.commercialEvent.findMany({
      where: { organizationId, lineageId: { in: lineageIds } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const names = await this.userNames(rows.map((r) => r.actorUserId));
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      entityType: r.entityType as CommercialEvent['entityType'],
      entityId: r.entityId,
      actor: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Reference-only CRM activity; the stage is never changed. */
  async crmActivity(
    tx: Tx,
    organizationId: string,
    leadId: string | null,
    title: string,
    actorUserId: string,
    metadata: Record<string, unknown>,
  ) {
    if (!leadId) return;
    const lead = await tx.buyerLead.findFirst({
      where: { id: leadId, organizationId },
      select: { id: true },
    });
    if (!lead) return;
    await tx.leadActivity.create({
      data: {
        organizationId,
        leadId,
        type: 'SYSTEM',
        title,
        occurredAt: new Date(),
        actorUserId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  async crmContext(
    organizationId: string,
    leadId: string | null,
    target: 'QUOTATION' | 'PO' | 'SHIPMENT',
    reason: string,
  ) {
    if (!leadId) return null;
    const lead = await this.prisma.buyerLead.findFirst({
      where: { id: leadId, organizationId },
      select: { id: true, stage: true },
    });
    if (!lead) return null;
    const behind =
      STAGE_ORDER.indexOf(lead.stage) >= 0 &&
      STAGE_ORDER.indexOf(lead.stage) < STAGE_ORDER.indexOf(target);
    return {
      leadId: lead.id,
      stage: lead.stage,
      stageSuggestion: behind ? { stage: target, reason } : null,
    };
  }

  async userNames(ids: (string | null | undefined)[]) {
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

  /** Optimistic concurrency guard shared by all commercial documents. */
  static conflict() {
    return new ConflictException(
      'This document was changed by someone else. Reload and try again.',
    );
  }
}
