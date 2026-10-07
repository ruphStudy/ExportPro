import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  countryLabel,
  type DocumentTotals,
  type FieldSourced,
  type PackingListContent,
  type ShipmentReadiness,
  type ShippingInstructionContent,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from '../commercial/commercial-core.service';
import { ComplianceService } from '../compliance/compliance.service';
import {
  documentValidationStatuses,
  DocumentValidationService,
} from '../document-validation/validation.service';

type Doc = Prisma.TradeDocumentGetPayload<object>;
type Src = FieldSourced['source'];
const sv = <T>(
  value: T | null | undefined,
  source: Src,
): FieldSourced<T | null> =>
  value === null || value === undefined || value === ''
    ? { value: null, source: 'NONE' }
    : { value, source };

/**
 * Reads the commercial lineage (Sprint 15), compliance readiness (Sprint 16) and
 * document validation state (Sprint 17) for logistics. Nothing is duplicated or
 * re-implemented here; values carry their origin and are never invented.
 */
@Injectable()
export class LogisticsContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    private readonly validation: DocumentValidationService,
  ) {}

  async po(org: string, poId: string) {
    const po = await this.prisma.buyerPurchaseOrder.findFirst({
      where: { id: poId, organizationId: org },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found.');
    const [buyer, pi, q, orgRow] = await Promise.all([
      this.prisma.buyerCompany.findFirst({
        where: { id: po.buyerCompanyId },
        select: { id: true, canonicalName: true, countryCode: true },
      }),
      po.proformaInvoiceId
        ? this.prisma.proformaInvoice.findFirst({
            where: { id: po.proformaInvoiceId, organizationId: org },
          })
        : null,
      po.quotationId
        ? this.prisma.quotation.findFirst({
            where: { id: po.quotationId, organizationId: org },
          })
        : null,
      this.prisma.organization.findUniqueOrThrow({
        where: { id: org },
        select: { country: true, name: true, legalName: true },
      }),
    ]);
    const docs = await this.currentDocs(org, poId);
    const pl =
      docs.find(
        (d) => d.documentType === 'PACKING_LIST' && d.status === 'APPROVED',
      ) ?? docs.find((d) => d.documentType === 'PACKING_LIST');
    const si =
      docs.find(
        (d) =>
          d.documentType === 'SHIPPING_INSTRUCTION' && d.status === 'APPROVED',
      ) ?? docs.find((d) => d.documentType === 'SHIPPING_INSTRUCTION');
    const content = <T>(d: Doc | undefined) =>
      d
        ? (((d.snapshot as { content?: unknown } | null)?.content ??
            d.content) as T)
        : null;
    const plc = content<PackingListContent>(pl);
    const plt = (
      pl
        ? ((pl.snapshot as { totals?: DocumentTotals } | null)?.totals ??
          pl.totals)
        : null
    ) as DocumentTotals | null;
    const sic = content<ShippingInstructionContent>(si);
    const originCountry =
      q?.originCountry ??
      (orgRow.country && /^[A-Z]{2}$/.test(orgRow.country)
        ? orgRow.country
        : null);
    const destinationCountry =
      pi?.destinationCountry ?? q?.destinationCountry ?? null;
    const values = {
      buyer: sv(buyer?.canonicalName, 'PURCHASE_ORDER'),
      incoterm: sv(po.incoterm, 'PURCHASE_ORDER'),
      incotermPlace: sv(po.incotermPlace, 'PURCHASE_ORDER'),
      originCountry: sv(
        originCountry,
        q?.originCountry ? 'QUOTATION' : 'ORGANIZATION',
      ),
      destinationCountry: sv(
        destinationCountry,
        pi?.destinationCountry ? 'PROFORMA_INVOICE' : 'QUOTATION',
      ),
      portOfLoading: sic?.portOfLoading
        ? sv(sic.portOfLoading, 'SHIPPING_INSTRUCTION')
        : sv(plc?.portOfLoading, 'PACKING_LIST'),
      portOfDischarge: sic?.portOfDischarge
        ? sv(sic.portOfDischarge, 'SHIPPING_INSTRUCTION')
        : plc?.portOfDischarge
          ? sv(plc.portOfDischarge, 'PACKING_LIST')
          : sv(
              pi?.destinationPort ?? q?.destinationPort,
              pi?.destinationPort ? 'PROFORMA_INVOICE' : 'QUOTATION',
            ),
      cargoDescription: sv(
        po.items
          .map((i) => `${i.description} — ${i.quantity.toString()} ${i.unit}`)
          .join('\n'),
        'PURCHASE_ORDER',
      ),
      // Cargo measures only from the packing list — never estimated.
      packageCount: sv(plt?.packages ? plt.packages : null, 'PACKING_LIST'),
      grossWeightKg: sv(plt?.grossWeightKg, 'PACKING_LIST'),
      netWeightKg: sv(plt?.netWeightKg, 'PACKING_LIST'),
      volumeCbm: sv(plt?.volumeCbm, 'PACKING_LIST'),
      shipmentMode: sv(sic?.shipmentMode, 'SHIPPING_INSTRUCTION'),
    };
    return {
      po,
      buyer,
      pi,
      q,
      docs,
      values,
      exporterName: orgRow.legalName || orgRow.name,
      label: (c: string | null) => (c ? countryLabel(c) : null),
    };
  }

  async currentDocs(org: string, poId: string) {
    const all = await this.prisma.tradeDocument.findMany({
      where: {
        organizationId: org,
        purchaseOrderId: poId,
        status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
      },
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    });
    const latest = new Map<string, Doc>();
    for (const d of all) if (!latest.has(d.rootId)) latest.set(d.rootId, d);
    return [...latest.values()];
  }

  /**
   * Compliance readiness (Sprint 16, refreshed) and documentation completeness
   * (required-now documents available, approved, and validated where a
   * requirement demands it — Sprint 16/17 logic reused).
   */
  async readiness(a: Actor, poId: string): Promise<ShipmentReadiness> {
    const org = a.organizationId;
    let compliance: ShipmentReadiness['compliance'] = {
      checklistId: null,
      readiness: null,
      blockers: 0,
      warnings: 0,
    };
    try {
      const c = await this.compliance.forPo(a, poId);
      compliance = {
        checklistId: c.id,
        readiness: c.readiness,
        blockers: c.blockers.length,
        warnings: c.warnings.length,
      };
    } catch (e) {
      if (!(e instanceof NotFoundException)) throw e;
    }
    const docs = await this.currentDocs(org, poId);
    const missing = await this.validation.missingForPo(org, poId, docs);
    const statuses = await documentValidationStatuses(
      this.prisma,
      org,
      docs.map((d) => ({ id: d.id, version: d.version })),
    );
    const cl = compliance.checklistId
      ? await this.prisma.complianceChecklist.findFirst({
          where: { id: compliance.checklistId },
          include: { requirements: true },
        })
      : null;
    const needsValidation = new Set(
      (cl?.requirements ?? [])
        .filter(
          (r) =>
            !r.overrideKind &&
            r.applicability !== 'NOT_APPLICABLE' &&
            (
              r.ruleSnapshot as {
                satisfiedBy?: { requiresValidation?: boolean };
              }
            ).satisfiedBy?.requiresValidation,
        )
        .flatMap(
          (r) =>
            (r.ruleSnapshot as { documentTypes?: string[] }).documentTypes ??
            [],
        ),
    );
    const required = missing.rows.filter(
      (r) =>
        ['MISSING_NOW', 'AVAILABLE'].includes(r.state) &&
        ['REQUIRED', 'CONDITIONAL'].includes(r.level),
    );
    const available = required.filter((r) => r.state === 'AVAILABLE');
    const approved = available.filter(
      (r) =>
        r.document &&
        ['APPROVED', 'ISSUED_EXTERNAL'].includes(r.document.status),
    );
    const validated = available.filter(
      (r) =>
        r.document &&
        ['SIGNED_OFF', 'PASSED', 'PASSED_WITH_WARNINGS'].includes(
          statuses.get(r.document.id)?.status ?? '',
        ),
    );
    const reasons: string[] = [];
    if (!compliance.checklistId)
      reasons.push('Compliance checklist not evaluated for this order.');
    const missingNow = required
      .filter((r) => r.state === 'MISSING_NOW')
      .map((r) => r.label);
    if (missingNow.length) reasons.push(`Missing: ${missingNow.join(', ')}.`);
    for (const r of available) {
      if (
        !r.document ||
        !['APPROVED', 'ISSUED_EXTERNAL'].includes(r.document.status)
      )
        reasons.push(`${r.label} is not approved yet.`);
      else if (
        needsValidation.has(r.documentType) &&
        statuses.get(r.document.id)?.status !== 'SIGNED_OFF'
      )
        reasons.push(`${r.label} needs a signed-off validation.`);
    }
    const validationWarnings = [...statuses.values()].filter((s) =>
      ['FAILED', 'NEEDS_REVIEW', 'PASSED_WITH_WARNINGS'].includes(s.status),
    ).length;
    return {
      compliance,
      documents: {
        requiredNow: required.length,
        available: available.length,
        approved: approved.length,
        validated: validated.length,
        missing: missingNow,
        validationWarnings,
        complete: Boolean(compliance.checklistId) && reasons.length === 0,
        reasons,
      },
    };
  }

  async documentList(org: string, poId: string) {
    const docs = await this.currentDocs(org, poId);
    const statuses = await documentValidationStatuses(
      this.prisma,
      org,
      docs.map((d) => ({ id: d.id, version: d.version })),
    );
    return docs.map((d) => ({
      id: d.id,
      title: d.title,
      documentType: d.documentType,
      status: d.status,
      validationStatus: statuses.get(d.id)?.status ?? 'NOT_RUN',
    }));
  }
}
