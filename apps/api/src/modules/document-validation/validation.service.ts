import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  countryLabel,
  DOCUMENT_VALIDATION_RULE_VERSION,
  GENERATABLE_DOCUMENT_TYPES,
  roleHasPermission,
  type CommercialInvoiceContent,
  type ConfirmedDocumentData,
  type DocumentTotals,
  type DocumentValidationComment,
  type DocumentValidationFindingView,
  type DocumentValidationRunView,
  type DocumentValidationStatus,
  type MissingDocumentRow,
  type NormalizedDocumentView,
  type PackageDocumentRow,
  type PackingListContent,
  type PartySnapshot,
  type ShippingInstructionContent,
  type TradeDocumentType,
  type ValidationDashboard,
  type ValidationPackageView,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
  iso,
} from '../commercial/commercial-core.service';
import {
  CommentDto,
  ResolveFindingDto,
  SignOffDto,
  ValidationReasonDto,
} from './document-validation.dto';
import { parseCountry } from './normalize';
import {
  checkDocument,
  compareDocuments,
  type EngineContext,
  type EngineFinding,
  REFERENCES,
  signature,
} from './validation-engine';

type Doc = Prisma.TradeDocumentGetPayload<object>;
type Run = Prisma.DocumentValidationRunGetPayload<{
  include: { findings: { include: { comments: true } }; comments: true };
}>;
type V = NormalizedDocumentView;

const LABEL: Record<string, string> = {
  COMMERCIAL_INVOICE: 'Commercial invoice',
  PACKING_LIST: 'Packing list',
  SHIPPING_INSTRUCTION: 'Shipping instruction',
  CERTIFICATE_OF_ORIGIN: 'Certificate of origin',
  PHYTOSANITARY_CERTIFICATE: 'Phytosanitary certificate',
  INSPECTION_CERTIFICATE: 'Inspection certificate',
  TEST_CERTIFICATE: 'Test certificate',
  FUMIGATION_CERTIFICATE: 'Fumigation certificate',
  INSURANCE_CERTIFICATE: 'Insurance certificate',
  SHIPPING_BILL: 'Shipping bill',
  BILL_OF_LADING: 'Bill of lading',
  AIRWAY_BILL: 'Airway bill',
  REGISTRATION_CERTIFICATE: 'Registration certificate',
  PURCHASE_ORDER: 'Purchase order (uploaded)',
  PROFORMA_INVOICE: 'Proforma invoice (uploaded)',
  CERTIFICATE: 'Certificate',
  OTHER_SHIPPING_DOCUMENT: 'Shipping document',
  OTHER: 'Document',
};
const KIND: Record<string, string> = {
  COMMERCIAL_INVOICE: 'CI',
  PACKING_LIST: 'PL',
  SHIPPING_INSTRUCTION: 'SI',
  PURCHASE_ORDER: 'PO_DOC',
  PROFORMA_INVOICE: 'PI_DOC',
  BILL_OF_LADING: 'BL',
  AIRWAY_BILL: 'AWB',
  SHIPPING_BILL: 'SB',
  OTHER_SHIPPING_DOCUMENT: 'OTHER',
  OTHER: 'OTHER',
};
export const kindOf = (type: string) => KIND[type] ?? 'CERT';
/** Carrier/customs documents only exist once a shipment happens (Sprint 18) — never "overdue" before that. */
const AFTER_SHIPMENT = ['BILL_OF_LADING', 'AIRWAY_BILL', 'SHIPPING_BILL'];
const country = (v: string | null | undefined) =>
  v ? parseCountry(v).value : null;
const isGenerated = (t: string) =>
  (GENERATABLE_DOCUMENT_TYPES as readonly string[]).includes(t);

/** Latest validation status of each document (stale when the document has a newer version). */
export async function documentValidationStatuses(
  prisma: PrismaService,
  organizationId: string,
  docs: { id: string; version: number }[],
) {
  const out = new Map<
    string,
    { status: DocumentValidationStatus; openIssues: number }
  >();
  if (!docs.length) return out;
  const runs = await prisma.documentValidationRun.findMany({
    where: { organizationId, documentIds: { hasSome: docs.map((d) => d.id) } },
    orderBy: { createdAt: 'desc' },
    include: {
      findings: {
        where: { status: 'OPEN', severity: { in: ['CRITICAL', 'WARNING'] } },
        select: { sourceDocumentId: true, referenceDocumentId: true },
      },
    },
  });
  for (const d of docs) {
    const r = runs.find((x) => x.documentIds.includes(d.id));
    if (!r) {
      out.set(d.id, { status: 'NOT_RUN', openIssues: 0 });
      continue;
    }
    const used = (
      (
        r.documents as {
          docs?: { id: string | null; version: number | null }[];
        }
      ).docs ?? []
    ).find((x) => x.id === d.id);
    if (used && used.version !== null && used.version !== d.version)
      out.set(d.id, { status: 'NOT_RUN', openIssues: 0 });
    else
      out.set(d.id, {
        status: r.status as DocumentValidationStatus,
        openIssues: r.findings.filter(
          (f) => f.sourceDocumentId === d.id || f.referenceDocumentId === d.id,
        ).length,
      });
  }
  return out;
}

@Injectable()
export class DocumentValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly core: CommercialCoreService,
  ) {}

  private assert(
    a: Actor,
    p:
      | 'document_validation.view'
      | 'document_validation.review'
      | 'document_validation.resolve'
      | 'document_validation.signoff'
      | 'document_validation.extract',
  ) {
    if (
      !roleHasPermission(a.role, p) ||
      !roleHasPermission(a.role, 'documents.view')
    )
      throw new ForbiddenException(
        'You do not have permission for this validation action.',
      );
  }

  // ------------------------------------------------------------ views

  private async exporterName(org: string) {
    const o = await this.prisma.organization.findUnique({
      where: { id: org },
      select: { name: true, legalName: true },
    });
    return o?.legalName || o?.name || null;
  }

  /** Normalized data of a trade document: generated → stored snapshot (authoritative); uploaded → human-confirmed data (else unreviewed extraction). */
  async viewForDocument(org: string, d: Doc): Promise<V | null> {
    const label = `${LABEL[d.documentType] ?? d.documentType}${d.documentNumber ? ` ${d.documentNumber}` : ''}${d.version > 1 ? ` v${d.version}` : ''}`;
    const base = {
      documentId: d.id,
      label,
      kind: kindOf(d.documentType),
      version: d.version,
      buyerCompanyId: d.buyerCompanyId,
    };
    if (d.generated) {
      const snap = d.snapshot as {
        content?: unknown;
        totals?: DocumentTotals;
        exporter?: PartySnapshot;
      } | null;
      const content = (snap?.content ?? d.content) as Record<
        string,
        unknown
      > | null;
      if (!content) return null;
      const totals = (snap?.totals ?? d.totals ?? {}) as DocumentTotals;
      const exporterName = snap?.exporter
        ? snap.exporter.legalName || snap.exporter.name
        : await this.exporterName(org);
      const approved = Boolean(snap);
      if (d.documentType === 'COMMERCIAL_INVOICE') {
        const c = content as unknown as CommercialInvoiceContent;
        return {
          ...base,
          dataSource: 'STRUCTURED',
          fields: {
            documentNumber: d.documentNumber,
            invoiceNumber: d.documentNumber,
            documentDate: c.invoiceDate,
            buyerName: c.consignee?.name ?? null,
            buyerAddress:
              [c.consignee?.address, c.consignee?.country]
                .filter(Boolean)
                .join(', ') || null,
            buyerCountry: country(c.consignee?.country),
            exporterName,
            currency: c.currency,
            incoterm: c.incoterm,
            incotermPlace: c.incotermPlace,
            poNumber: c.buyerPoReference,
            originCountry: c.originCountry,
            destinationCountry: c.destinationCountry,
            totalAmount: totals.total ?? null,
            paymentTerms: c.paymentTerms,
            portOfLoading: c.portOfLoading,
            portOfDischarge: c.portOfDischarge,
          },
          items: c.items.map((i) => ({
            key: null,
            description: i.description,
            hsCode: i.hsCode ? i.hsCode.replace(/\D/g, '') : null,
            hsConfirmed: approved,
            buyerSku: null,
            quantity: i.quantity || null,
            unit: i.unit || null,
            unitPrice: i.unitPrice || null,
            total: null,
            packageCount: null,
            netWeightKg: null,
            grossWeightKg: null,
          })),
        };
      }
      if (d.documentType === 'PACKING_LIST') {
        const c = content as unknown as PackingListContent;
        return {
          ...base,
          dataSource: 'STRUCTURED',
          fields: {
            documentNumber: d.documentNumber,
            invoiceNumber: c.invoiceReference,
            consigneeName: c.consignee?.name ?? null,
            consigneeAddress:
              [c.consignee?.address, c.consignee?.country]
                .filter(Boolean)
                .join(', ') || null,
            exporterName,
            destinationCountry: c.destinationCountry,
            portOfLoading: c.portOfLoading,
            portOfDischarge: c.portOfDischarge,
            packageCount:
              totals.packages !== undefined ? String(totals.packages) : null,
            grossWeightKg: totals.grossWeightKg ?? null,
            netWeightKg: totals.netWeightKg ?? null,
          },
          items: c.packages.map((p) => ({
            key: null,
            description: p.description,
            hsCode: null,
            hsConfirmed: false,
            buyerSku: null,
            quantity: p.quantity,
            unit: p.unit ? p.unit.toUpperCase() : null,
            unitPrice: null,
            total: null,
            packageCount: String(p.packageCount),
            netWeightKg: p.netWeightKg,
            grossWeightKg: p.grossWeightKg,
          })),
        };
      }
      const c = content as unknown as ShippingInstructionContent;
      return {
        ...base,
        dataSource: 'STRUCTURED',
        fields: {
          documentNumber: d.documentNumber,
          consigneeName: c.consignee?.name ?? null,
          consigneeAddress:
            [c.consignee?.address, c.consignee?.country]
              .filter(Boolean)
              .join(', ') || null,
          exporterName,
          notifyParty: c.notifyParty,
          incoterm: c.incoterm,
          incotermPlace: c.incotermPlace,
          originCountry: c.originCountry,
          destinationCountry: c.destinationCountry,
          portOfLoading: c.portOfLoading,
          portOfDischarge: c.portOfDischarge,
          packageCount: c.packageCount !== null ? String(c.packageCount) : null,
          grossWeightKg: c.grossWeightKg,
          netWeightKg: c.netWeightKg,
          cargoDescription: c.cargoDescription,
        },
        items: [],
      };
    }
    const confirmed = await this.prisma.documentConfirmedData.findFirst({
      where: {
        tradeDocumentId: d.id,
        organizationId: org,
        documentVersion: d.version,
      },
      orderBy: { reviewedAt: 'desc' },
    });
    let fields: Record<string, string | null> = {};
    let items: Record<string, string | null>[] = [];
    let source: V['dataSource'] = 'CONFIRMED';
    let type = d.documentType;
    if (confirmed) {
      const data = confirmed.data as unknown as {
        fields: ConfirmedDocumentData['fields'];
        items: ConfirmedDocumentData['items'];
      };
      fields = Object.fromEntries(
        Object.entries(data.fields ?? {}).map(([k, v]) => [
          k,
          v?.value ?? null,
        ]),
      );
      items = (data.items ?? []).map((i) =>
        Object.fromEntries(
          Object.entries(i.fields).map(([k, v]) => [k, v?.value ?? null]),
        ),
      );
      type = confirmed.confirmedDocumentType;
    } else {
      const ex = await this.prisma.documentExtraction.findFirst({
        where: {
          tradeDocumentId: d.id,
          organizationId: org,
          documentVersion: d.version,
          status: { in: ['COMPLETED', 'PARTIAL', 'NEEDS_REVIEW'] },
        },
        orderBy: { extractionVersion: 'desc' },
      });
      if (!ex?.result) return null;
      const r = ex.result as unknown as {
        fields: Record<string, { value: string | null }>;
        items: { fields: Record<string, { value: string | null }> }[];
      };
      fields = Object.fromEntries(
        Object.entries(r.fields).map(([k, v]) => [k, v?.value ?? null]),
      );
      items = r.items.map((i) =>
        Object.fromEntries(
          Object.entries(i.fields).map(([k, v]) => [k, v?.value ?? null]),
        ),
      );
      source = 'UNREVIEWED';
    }
    const kind = kindOf(type);
    const numberField = {
      CI: 'invoiceNumber',
      PO_DOC: 'poNumber',
      PI_DOC: 'piNumber',
      BL: 'blNumber',
      AWB: 'awbNumber',
      CERT: 'certificateNumber',
    }[kind];
    fields.documentNumber =
      (numberField ? fields[numberField] : null) ??
      fields.documentNumber ??
      d.documentNumber ??
      null;
    if (kind === 'CERT') {
      fields.issueDate ??= d.issueDate
        ? d.issueDate.toISOString().slice(0, 10)
        : null;
      fields.expiryDate ??= d.expiryDate
        ? d.expiryDate.toISOString().slice(0, 10)
        : null;
    }
    return {
      ...base,
      label: `${LABEL[type] ?? type}${fields.documentNumber ? ` ${fields.documentNumber}` : ''}${d.version > 1 ? ` v${d.version}` : ''}`,
      kind,
      dataSource: source,
      fields,
      items: items.map((i) => ({
        key: null,
        description: i.description ?? '',
        hsCode: i.hsCode ?? null,
        hsConfirmed: source === 'CONFIRMED',
        buyerSku: i.buyerSku ?? null,
        quantity: i.quantity ?? null,
        unit: i.unit ?? null,
        unitPrice: i.unitPrice ?? null,
        total: i.total ?? null,
        packageCount: i.packageCount ?? null,
        netWeightKg: i.netWeightKg ?? null,
        grossWeightKg: i.grossWeightKg ?? null,
      })),
    };
  }

  /** Sprint 15 buyer PO record as a structured view. */
  private async poView(
    org: string,
    poId: string,
  ): Promise<{
    view: V;
    po: Prisma.BuyerPurchaseOrderGetPayload<{
      include: { items: true; discrepancies: true };
    }>;
  }> {
    const po = await this.prisma.buyerPurchaseOrder.findFirst({
      where: { id: poId, organizationId: org },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        discrepancies: true,
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found.');
    const [buyer, products, qItems, exporterName] = await Promise.all([
      this.prisma.buyerCompany.findFirst({
        where: { id: po.buyerCompanyId },
        select: {
          canonicalName: true,
          address: true,
          city: true,
          stateRegion: true,
          countryCode: true,
        },
      }),
      this.prisma.organizationProduct.findMany({
        where: {
          organizationId: org,
          id: {
            in: po.items.map((i) => i.productId).filter(Boolean) as string[],
          },
        },
        select: { id: true, hsCode: true, classificationStatus: true },
      }),
      this.prisma.quotationItem.findMany({
        where: {
          id: {
            in: po.items
              .map((i) => i.quotationItemId)
              .filter(Boolean) as string[],
          },
        },
        select: { id: true, hsCode: true },
      }),
      this.exporterName(org),
    ]);
    const lines = po.items.reduce(
      (s, i) => s.plus(i.quantity.mul(i.unitPrice).toDecimalPlaces(2)),
      new Prisma.Decimal(0),
    );
    return {
      po,
      view: {
        documentId: null,
        label: `Buyer PO ${po.poNumber}`,
        kind: 'PO',
        version: null,
        dataSource: 'STRUCTURED',
        buyerCompanyId: po.buyerCompanyId,
        fields: {
          documentNumber: po.poNumber,
          poNumber: po.poNumber,
          documentDate: po.poDate.toISOString().slice(0, 10),
          buyerName: buyer?.canonicalName ?? null,
          // Composed like the Sprint 15 buyer snapshot (address, city, region, country) so formatting never differs.
          buyerAddress:
            [
              [buyer?.address, buyer?.city, buyer?.stateRegion]
                .filter(Boolean)
                .join(', '),
              buyer?.countryCode ? countryLabel(buyer.countryCode) : null,
            ]
              .filter(Boolean)
              .join(', ') || null,
          buyerCountry: buyer?.countryCode ?? null,
          exporterName,
          currency: po.currency,
          incoterm: po.incoterm,
          incotermPlace: po.incotermPlace,
          totalAmount: (po.totalAmount ?? lines).toFixed(2),
          paymentTerms: po.paymentTerms,
          deliveryTerms: po.deliveryTerms,
        },
        items: po.items.map((i) => {
          const p = i.productId
            ? products.find((x) => x.id === i.productId)
            : undefined;
          const q = i.quotationItemId
            ? qItems.find((x) => x.id === i.quotationItemId)
            : undefined;
          const hs = p?.hsCode ?? q?.hsCode ?? null;
          return {
            key: i.quotationItemId ?? i.productId,
            description: i.description,
            hsCode: hs ? hs.replace(/\D/g, '') : null,
            hsConfirmed: p
              ? ['USER_CONFIRMED', 'OFFICIALLY_VERIFIED'].includes(
                  p.classificationStatus,
                )
              : Boolean(q?.hsCode),
            buyerSku: i.buyerProductCode,
            quantity: i.quantity.toString(),
            unit: i.unit.toUpperCase(),
            unitPrice: i.unitPrice.toString(),
            total: i.totalPrice?.toFixed(2) ?? null,
            packageCount: null,
            netWeightKg: null,
            grossWeightKg: null,
          };
        }),
      },
    };
  }

  private async piView(org: string, piId: string): Promise<V | null> {
    const pi = await this.prisma.proformaInvoice.findFirst({
      where: { id: piId, organizationId: org },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!pi) return null;
    const b = (pi.buyerSnapshot ?? null) as unknown as PartySnapshot | null;
    return {
      documentId: null,
      label: `Proforma ${pi.piNumber}${pi.revision > 1 ? ` Rev ${pi.revision}` : ''}`,
      kind: 'PI',
      version: pi.revision,
      dataSource: 'STRUCTURED',
      buyerCompanyId: pi.buyerCompanyId,
      fields: {
        documentNumber: pi.piNumber,
        piNumber: pi.piNumber,
        documentDate: pi.issueDate
          ? pi.issueDate.toISOString().slice(0, 10)
          : null,
        buyerName: b?.name ?? pi.buyerName,
        buyerAddress:
          [b?.address, b?.country].filter(Boolean).join(', ') || null,
        currency: pi.currency,
        incoterm: pi.incoterm,
        incotermPlace: pi.incotermPlace,
        destinationCountry: pi.destinationCountry,
        totalAmount: pi.totalAmount.toFixed(2),
        paymentTerms: pi.paymentTerms,
      },
      items: pi.items.map((i) => ({
        key: i.quotationItemId ?? i.productId,
        description: i.description,
        hsCode: i.hsCode ? i.hsCode.replace(/\D/g, '') : null,
        hsConfirmed: Boolean(i.hsCode),
        buyerSku: null,
        quantity: i.quantity.toString(),
        unit: i.unit.toUpperCase(),
        unitPrice: i.unitPrice.toString(),
        total: i.totalPrice.toFixed(2),
        packageCount: null,
        netWeightKg: null,
        grossWeightKg: null,
      })),
    };
  }

  /** Current (latest, non-archived) trade documents of a PO lineage. */
  private async lineageDocs(org: string, poId: string) {
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

  private async engineContext(org: string): Promise<EngineContext> {
    const s = await this.core.rawSettings(org);
    const t = await this.prisma.documentTemplate.findUnique({
      where: {
        organizationId_documentType: {
          organizationId: org,
          documentType: 'GENERAL',
        },
      },
    });
    return {
      tolerance: {
        quantityPercent: s.quantityTolerancePercent.toString(),
        pricePercent: s.priceTolerancePercent.toString(),
      },
      today: new Date().toISOString().slice(0, 10),
      expiryWarningDays: t?.expiryWarningDays ?? 30,
    };
  }

  // ------------------------------------------------------------- runs

  private refsFor(v: V, pool: V[]): V[] {
    const r = REFERENCES[v.kind];
    if (!r) return [];
    const found = r.kinds
      .map((k) => pool.filter((p) => p.kind === k && p !== v)[0])
      .filter(Boolean) as V[];
    return r.all ? found : found.slice(0, 1);
  }

  private unconfirmedFinding(d: Doc, v: V | null): EngineFinding {
    const label = `${LABEL[d.documentType] ?? d.documentType}${d.documentNumber ? ` ${d.documentNumber}` : ''}`;
    return {
      type: 'UNCONFIRMED_DATA',
      severity: 'WARNING',
      field: 'data',
      itemReference: null,
      sourceDocumentId: d.id,
      sourceLabel: label,
      referenceDocumentId: null,
      referenceLabel: null,
      sourceField: null,
      referenceField: null,
      rule: v ? 'data.unconfirmed' : 'data.none',
      expectedValue: 'Human-confirmed data',
      actualValue: v ? 'Unreviewed extraction' : 'No structured data',
      normalizedExpected: null,
      normalizedActual: null,
      message: v
        ? `${label} has an unreviewed extraction — confirm it before it is compared or signed off.`
        : `${label} has no structured data yet — extract it or enter it manually.`,
    };
  }

  private async createRun(
    a: Actor,
    scope: 'DOCUMENT' | 'PACKAGE',
    key: { purchaseOrderId: string | null; primaryDocumentId: string | null },
    views: V[],
    comparisons: [V, V][],
    findings: EngineFinding[],
  ) {
    const org = a.organizationId;
    const scopeWhere =
      scope === 'PACKAGE'
        ? { organizationId: org, scope, purchaseOrderId: key.purchaseOrderId }
        : {
            organizationId: org,
            scope,
            primaryDocumentId: key.primaryDocumentId,
          };
    const prev = await this.prisma.documentValidationRun.findFirst({
      where: scopeWhere,
      orderBy: { runNumber: 'desc' },
      include: { findings: true },
    });
    const unique = new Map<string, EngineFinding>();
    for (const f of findings) unique.set(signature(f), f);
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const f of unique.values())
      counts[
        f.severity === 'CRITICAL'
          ? 'critical'
          : f.severity === 'WARNING'
            ? 'warning'
            : 'info'
      ]++;
    const run = await this.prisma.$transaction(async (tx) => {
      const r = await tx.documentValidationRun.create({
        data: {
          organizationId: org,
          runNumber: (prev?.runNumber ?? 0) + 1,
          scope,
          purchaseOrderId: key.purchaseOrderId,
          primaryDocumentId: key.primaryDocumentId,
          documentIds: views
            .map((v) => v.documentId)
            .filter(Boolean) as string[],
          documents: {
            docs: views.map((v) => ({
              id: v.documentId,
              label: v.label,
              kind: v.kind,
              version: v.version,
              dataSource: v.dataSource,
            })),
            comparisons: comparisons.map(([s, r2]) => ({
              source: s.label,
              reference: r2.label,
            })),
          } as Prisma.InputJsonValue,
          ruleVersion: DOCUMENT_VALIDATION_RULE_VERSION,
          status: 'PROCESSING',
          resultSummary: {} as Prisma.InputJsonValue,
          errorCount: counts.critical,
          warningCount: counts.warning,
          infoCount: counts.info,
          createdByUserId: a.userId,
        },
      });
      for (const [sig, f] of unique) {
        // A human resolution of the very same finding in the previous run is carried forward (and labelled as such).
        const carried = prev?.findings.find(
          (p) => p.signature === sig && p.status !== 'OPEN',
        );
        await tx.documentValidationFinding.create({
          data: {
            organizationId: org,
            runId: r.id,
            signature: sig,
            type: f.type,
            severity: f.severity,
            field: f.field,
            itemReference: f.itemReference,
            sourceDocumentId: f.sourceDocumentId,
            sourceLabel: f.sourceLabel,
            referenceDocumentId: f.referenceDocumentId,
            referenceLabel: f.referenceLabel,
            sourceField: f.sourceField,
            referenceField: f.referenceField,
            rule: f.rule,
            expectedValue: f.expectedValue,
            actualValue: f.actualValue,
            normalizedExpected: f.normalizedExpected,
            normalizedActual: f.normalizedActual,
            message: f.message.slice(0, 1000),
            status: carried ? carried.status : 'OPEN',
            resolutionNote: carried?.resolutionNote ?? null,
            resolvedByUserId: carried?.resolvedByUserId ?? null,
            resolvedAt: carried?.resolvedAt ?? null,
            carriedFromRun: carried ? prev!.runNumber : null,
          },
        });
      }
      return r;
    });
    await this.refreshStatus(run.id);
    const final = await this.prisma.documentValidationRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    const lineage = key.purchaseOrderId ?? key.primaryDocumentId!;
    await this.core.event(this.prisma, a, {
      entityType: 'VALIDATION',
      entityId: run.id,
      lineageId: lineage,
      type: 'VALIDATION_RUN',
      title: `Validation run ${final.runNumber} (${scope === 'PACKAGE' ? 'order package' : 'document'}): ${counts.critical} critical, ${counts.warning} warning${counts.warning === 1 ? '' : 's'}`,
    });
    await this.audit.record({
      organizationId: org,
      actorId: a.userId,
      action: 'document.validation_run',
      entityType: 'DocumentValidationRun',
      entityId: run.id,
      metadata: {
        scope,
        runNumber: final.runNumber,
        ruleVersion: DOCUMENT_VALIDATION_RULE_VERSION,
        documents: views.length,
        critical: counts.critical,
        warning: counts.warning,
        status: final.status,
      },
    });
    return run.id;
  }

  /** Status from open findings: FAILED (open critical) > NEEDS_REVIEW (unconfirmed data) > PASSED_WITH_WARNINGS > PASSED. */
  private async refreshStatus(runId: string) {
    const r = await this.prisma.documentValidationRun.findUniqueOrThrow({
      where: { id: runId },
      include: { findings: true },
    });
    if (r.signedOffAt || r.rejectedAt) return;
    const open = r.findings.filter((f) => f.status === 'OPEN');
    const docs =
      (r.documents as { docs?: { dataSource: string }[] }).docs ?? [];
    const unconfirmed =
      r.findings.some((f) => f.type === 'UNCONFIRMED_DATA') ||
      docs.some((d) => d.dataSource === 'UNREVIEWED');
    const status: DocumentValidationStatus = open.some(
      (f) => f.severity === 'CRITICAL',
    )
      ? 'FAILED'
      : unconfirmed
        ? 'NEEDS_REVIEW'
        : open.some((f) => f.severity === 'WARNING')
          ? 'PASSED_WITH_WARNINGS'
          : 'PASSED';
    const summary =
      status === 'PASSED'
        ? 'No material mismatches detected by the configured validation rules.'
        : status === 'PASSED_WITH_WARNINGS'
          ? 'No critical mismatches; warnings need review.'
          : status === 'NEEDS_REVIEW'
            ? 'Some documents have unconfirmed data — review extractions before sign-off.'
            : 'Critical mismatches need resolution before sign-off.';
    await this.prisma.documentValidationRun.update({
      where: { id: runId },
      data: { status, resultSummary: { text: summary } },
    });
  }

  async runForDocument(a: Actor, documentId: string, auto = false) {
    this.assert(
      a,
      auto ? 'document_validation.view' : 'document_validation.review',
    );
    const org = a.organizationId;
    const d = await this.prisma.tradeDocument.findFirst({
      where: { id: documentId, organizationId: org },
    });
    if (!d) throw new NotFoundException('Document not found.');
    const primary = await this.viewForDocument(org, d);
    if (!primary || primary.dataSource === 'UNREVIEWED')
      throw new ConflictException({
        message: primary
          ? 'Confirm the extracted data before validating.'
          : 'This document has no structured data — extract it or enter it manually.',
        details: { code: 'NEEDS_REVIEW' },
      });
    const pool: V[] = [];
    const findings: EngineFinding[] = [];
    if (d.purchaseOrderId) {
      const { view: poV, po } = await this.poView(org, d.purchaseOrderId);
      pool.push(poV);
      if (po.proformaInvoiceId) {
        const pi = await this.piView(org, po.proformaInvoiceId);
        if (pi) pool.push(pi);
      }
      for (const x of await this.lineageDocs(org, d.purchaseOrderId)) {
        if (x.rootId === d.rootId) continue;
        const v = await this.viewForDocument(org, x);
        if (v && v.dataSource !== 'UNREVIEWED') pool.push(v);
      }
    }
    const ctx = await this.engineContext(org);
    const refs = this.refsFor(primary, pool);
    findings.push(...checkDocument(primary, ctx));
    for (const r of refs) findings.push(...compareDocuments(primary, r, ctx));
    const id = await this.createRun(
      a,
      'DOCUMENT',
      { purchaseOrderId: d.purchaseOrderId, primaryDocumentId: d.id },
      [primary, ...refs],
      refs.map((r) => [primary, r]),
      findings,
    );
    return this.runView(a, id);
  }

  async runForPackage(a: Actor, poId: string) {
    this.assert(a, 'document_validation.review');
    const org = a.organizationId;
    const { view: poV, po } = await this.poView(org, poId);
    const views: V[] = [poV];
    if (po.proformaInvoiceId) {
      const pi = await this.piView(org, po.proformaInvoiceId);
      if (pi) views.push(pi);
    }
    const findings: EngineFinding[] = [];
    const docs = await this.lineageDocs(org, poId);
    const docViews: V[] = [];
    for (const d of docs) {
      const v = await this.viewForDocument(org, d);
      if (!v || v.dataSource === 'UNREVIEWED')
        findings.push(this.unconfirmedFinding(d, v));
      if (v) {
        views.push(v);
        if (v.dataSource !== 'UNREVIEWED') docViews.push(v);
      }
    }
    const ctx = await this.engineContext(org);
    const pool = [...views.filter((v) => !v.documentId), ...docViews];
    const comparisons: [V, V][] = [];
    for (const v of docViews) {
      findings.push(...checkDocument(v, ctx));
      for (const r of this.refsFor(v, pool)) {
        comparisons.push([v, r]);
        findings.push(...compareDocuments(v, r, ctx));
      }
    }
    const id = await this.createRun(
      a,
      'PACKAGE',
      { purchaseOrderId: poId, primaryDocumentId: null },
      views,
      comparisons,
      findings,
    );
    return this.packageView(a, poId, id);
  }

  // ------------------------------------------------------- run views

  private async loadRun(org: string, id: string): Promise<Run> {
    const r = await this.prisma.documentValidationRun.findFirst({
      where: { id, organizationId: org },
      include: {
        findings: {
          include: { comments: { orderBy: { createdAt: 'asc' } } },
          orderBy: [{ severity: 'asc' }],
        },
        comments: { where: { findingId: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!r) throw new NotFoundException('Validation run not found.');
    return r;
  }

  private async isLatest(r: {
    id: string;
    organizationId: string;
    scope: string;
    purchaseOrderId: string | null;
    primaryDocumentId: string | null;
  }) {
    const latest = await this.prisma.documentValidationRun.findFirst({
      where:
        r.scope === 'PACKAGE'
          ? {
              organizationId: r.organizationId,
              scope: 'PACKAGE',
              purchaseOrderId: r.purchaseOrderId,
            }
          : {
              organizationId: r.organizationId,
              scope: 'DOCUMENT',
              primaryDocumentId: r.primaryDocumentId,
            },
      orderBy: { runNumber: 'desc' },
      select: { id: true },
    });
    return latest?.id === r.id;
  }

  async runView(a: Actor, id: string): Promise<DocumentValidationRunView> {
    this.assert(a, 'document_validation.view');
    const r = await this.loadRun(a.organizationId, id);
    const latest = await this.isLatest(r);
    const ids = [
      r.createdByUserId,
      r.signedOffByUserId,
      r.rejectedByUserId,
      ...r.findings.flatMap((f) => [
        f.resolvedByUserId,
        ...f.comments.map((c) => c.authorUserId),
      ]),
      ...r.comments.map((c) => c.authorUserId),
    ];
    const names = await this.core.userNames(ids);
    const nm = (x: string | null) => (x ? (names.get(x) ?? null) : null);
    const comment = (c: {
      id: string;
      findingId: string | null;
      body: string;
      authorUserId: string;
      createdAt: Date;
    }): DocumentValidationComment => ({
      id: c.id,
      findingId: c.findingId,
      body: c.body,
      author: nm(c.authorUserId),
      createdAt: c.createdAt.toISOString(),
    });
    const order = { CRITICAL: 0, WARNING: 1, INFO: 2 } as Record<
      string,
      number
    >;
    const findings: DocumentValidationFindingView[] = [...r.findings]
      .sort((x, y) => order[x.severity] - order[y.severity])
      .map((f) => ({
        id: f.id,
        type: f.type as DocumentValidationFindingView['type'],
        severity: f.severity as DocumentValidationFindingView['severity'],
        field: f.field,
        itemReference: f.itemReference,
        sourceDocument: { id: f.sourceDocumentId, label: f.sourceLabel },
        referenceDocument: f.referenceLabel
          ? { id: f.referenceDocumentId, label: f.referenceLabel }
          : null,
        sourceField: f.sourceField,
        referenceField: f.referenceField,
        rule: `${r.ruleVersion}:${f.rule}`,
        expectedValue: f.expectedValue,
        actualValue: f.actualValue,
        normalizedExpected: f.normalizedExpected,
        normalizedActual: f.normalizedActual,
        message: f.message,
        status: f.status as DocumentValidationFindingView['status'],
        resolution: f.resolvedAt
          ? {
              note: f.resolutionNote ?? '',
              by: nm(f.resolvedByUserId),
              at: f.resolvedAt.toISOString(),
              carriedFromRun: f.carriedFromRun,
            }
          : null,
        comments: f.comments.map(comment),
      }));
    const open = r.findings.filter((f) => f.status === 'OPEN');
    const docs = r.documents as {
      docs: DocumentValidationRunView['documents'];
      comparisons: DocumentValidationRunView['comparisons'];
    };
    const final = Boolean(r.signedOffAt || r.rejectedAt);
    const can = (p: Parameters<typeof roleHasPermission>[1]) =>
      roleHasPermission(a.role, p);
    const actions: string[] = [];
    if (latest && !final && can('document_validation.resolve'))
      actions.push('resolve');
    if (latest && !final && can('document_validation.signoff'))
      actions.push('sign_off');
    if (latest && !final && can('document_validation.override'))
      actions.push('override');
    if (latest && !final && can('document_validation.review'))
      actions.push('reject');
    if (can('document_validation.review')) actions.push('comment', 'rerun');
    return {
      id: r.id,
      runNumber: r.runNumber,
      scope: r.scope as 'DOCUMENT' | 'PACKAGE',
      purchaseOrderId: r.purchaseOrderId,
      primaryDocumentId: r.primaryDocumentId,
      ruleVersion: r.ruleVersion,
      status: r.status as DocumentValidationStatus,
      documents: docs.docs ?? [],
      comparisons: docs.comparisons ?? [],
      counts: {
        critical: r.errorCount,
        warning: r.warningCount,
        info: r.infoCount,
        open: open.length,
        openCritical: open.filter((f) => f.severity === 'CRITICAL').length,
      },
      summary: (r.resultSummary as { text?: string }).text ?? '',
      createdBy: nm(r.createdByUserId),
      createdAt: r.createdAt.toISOString(),
      isLatest: latest,
      signoff: r.signedOffAt
        ? {
            by: nm(r.signedOffByUserId),
            at: r.signedOffAt.toISOString(),
            note: r.signoffNote,
            unresolvedWarnings: r.signoffUnresolvedWarnings ?? 0,
            unresolvedCritical: r.signoffUnresolvedCritical ?? 0,
            overrideReason: r.signoffOverrideReason,
          }
        : null,
      rejection: r.rejectedAt
        ? {
            by: nm(r.rejectedByUserId),
            at: r.rejectedAt.toISOString(),
            reason: r.rejectionReason ?? '',
          }
        : null,
      findings,
      comments: r.comments.map(comment),
      availableActions: actions,
    };
  }

  async runsForDocument(a: Actor, documentId: string) {
    this.assert(a, 'document_validation.view');
    const d = await this.prisma.tradeDocument.findFirst({
      where: { id: documentId, organizationId: a.organizationId },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('Document not found.');
    const runs = await this.prisma.documentValidationRun.findMany({
      where: {
        organizationId: a.organizationId,
        documentIds: { has: documentId },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true },
    });
    return Promise.all(runs.map((r) => this.runView(a, r.id)));
  }

  private async lineageOf(
    org: string,
    findingOrRun: {
      purchaseOrderId: string | null;
      primaryDocumentId: string | null;
    },
  ) {
    return (
      findingOrRun.purchaseOrderId ?? findingOrRun.primaryDocumentId ?? org
    );
  }

  async resolve(a: Actor, findingId: string, dto: ResolveFindingDto) {
    this.assert(a, 'document_validation.resolve');
    const f = await this.prisma.documentValidationFinding.findFirst({
      where: { id: findingId, organizationId: a.organizationId },
      include: { run: true },
    });
    if (!f) throw new NotFoundException('Finding not found.');
    if (f.run.signedOffAt || f.run.rejectedAt || !(await this.isLatest(f.run)))
      throw new ConflictException(
        'Only findings of the latest open validation run can be resolved. Run validation again after corrections.',
      );
    if (f.type === 'UNCONFIRMED_DATA')
      throw new BadRequestException(
        'Confirm the document’s extracted data instead, then run validation again.',
      );
    const note = dto.note?.trim() ?? '';
    if (f.severity === 'CRITICAL' && note.length < 3)
      throw new BadRequestException(
        'A comment is required to resolve a critical finding.',
      );
    await this.prisma.documentValidationFinding.update({
      where: { id: f.id },
      data: {
        status: dto.status,
        resolutionNote: note || null,
        resolvedByUserId: a.userId,
        resolvedAt: new Date(),
        carriedFromRun: null,
      },
    });
    await this.refreshStatus(f.runId);
    await this.core.event(this.prisma, a, {
      entityType: 'VALIDATION',
      entityId: f.runId,
      lineageId: await this.lineageOf(a.organizationId, f.run),
      type: 'FINDING_RESOLVED',
      title: `${f.severity.toLowerCase()} finding marked ${dto.status.replace(/_/g, ' ').toLowerCase()}: ${f.message.slice(0, 100)}`,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'document.validation_finding_resolved',
      entityType: 'DocumentValidationFinding',
      entityId: f.id,
      metadata: {
        runId: f.runId,
        type: f.type,
        severity: f.severity,
        status: dto.status,
      },
    });
    return this.runView(a, f.runId);
  }

  async comment(
    a: Actor,
    target: { runId?: string; findingId?: string },
    dto: CommentDto,
  ) {
    this.assert(a, 'document_validation.review');
    let runId = target.runId ?? null;
    if (target.findingId) {
      const f = await this.prisma.documentValidationFinding.findFirst({
        where: { id: target.findingId, organizationId: a.organizationId },
        select: { runId: true },
      });
      if (!f) throw new NotFoundException('Finding not found.');
      runId = f.runId;
    }
    const r = await this.prisma.documentValidationRun.findFirst({
      where: { id: runId!, organizationId: a.organizationId },
    });
    if (!r) throw new NotFoundException('Validation run not found.');
    await this.prisma.documentValidationComment.create({
      data: {
        organizationId: a.organizationId,
        runId: r.id,
        findingId: target.findingId ?? null,
        body: dto.body.trim(),
        authorUserId: a.userId,
      },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'VALIDATION',
      entityId: r.id,
      lineageId: await this.lineageOf(a.organizationId, r),
      type: 'COMMENT',
      title: `Comment on validation run ${r.runNumber}`,
    });
    return this.runView(a, r.id);
  }

  /** Human sign-off. Blocked by open critical findings (manager override with reason) and always by unconfirmed data. */
  async signOff(a: Actor, runId: string, dto: SignOffDto, documentId?: string) {
    this.assert(a, 'document_validation.signoff');
    const r = await this.loadRun(a.organizationId, runId);
    if (documentId && !r.documentIds.includes(documentId))
      throw new NotFoundException('Validation run not found.');
    if (r.signedOffAt || r.rejectedAt)
      throw new ConflictException('This validation run is already closed.');
    if (!(await this.isLatest(r)))
      throw new ConflictException('Sign off the latest validation run.');
    if (
      r.status === 'NEEDS_REVIEW' ||
      r.findings.some((f) => f.type === 'UNCONFIRMED_DATA')
    )
      throw new ConflictException({
        message:
          'Some documents have unconfirmed or missing data. Review them and run validation again.',
        details: { code: 'UNCONFIRMED_DATA' },
      });
    const open = r.findings.filter((f) => f.status === 'OPEN');
    const openCritical = open.filter((f) => f.severity === 'CRITICAL').length;
    const openWarnings = open.filter((f) => f.severity === 'WARNING').length;
    let override: string | null = null;
    if (openCritical) {
      if (!dto.overrideReason?.trim())
        throw new ConflictException({
          message: `${openCritical} critical finding${openCritical === 1 ? '' : 's'} unresolved. Resolve them before sign-off.`,
          details: { code: 'OPEN_CRITICAL', count: openCritical },
        });
      if (!roleHasPermission(a.role, 'document_validation.override'))
        throw new ForbiddenException(
          'Only a manager can sign off with unresolved critical findings.',
        );
      override = dto.overrideReason.trim();
    }
    await this.prisma.documentValidationRun.update({
      where: { id: r.id },
      data: {
        status: 'SIGNED_OFF',
        signedOffByUserId: a.userId,
        signedOffAt: new Date(),
        signoffNote: dto.note?.trim() || null,
        signoffUnresolvedWarnings: openWarnings,
        signoffUnresolvedCritical: openCritical,
        signoffOverrideReason: override,
      },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'VALIDATION',
      entityId: r.id,
      lineageId: await this.lineageOf(a.organizationId, r),
      type: 'SIGNED_OFF',
      title: `Validation run ${r.runNumber} signed off${override ? ' with manager override' : ''}${openWarnings ? ` (${openWarnings} warning${openWarnings === 1 ? '' : 's'} acknowledged)` : ''}`,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'document.validation_signed_off',
      entityType: 'DocumentValidationRun',
      entityId: r.id,
      metadata: {
        runNumber: r.runNumber,
        unresolvedWarnings: openWarnings,
        unresolvedCritical: openCritical,
      },
    });
    if (override)
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'document.validation_override',
        entityType: 'DocumentValidationRun',
        entityId: r.id,
        metadata: {
          reason: override.slice(0, 300),
          unresolvedCritical: openCritical,
        },
      });
    return this.runView(a, r.id);
  }

  async reject(
    a: Actor,
    runId: string,
    dto: ValidationReasonDto,
    documentId?: string,
  ) {
    this.assert(a, 'document_validation.review');
    const r = await this.loadRun(a.organizationId, runId);
    if (documentId && !r.documentIds.includes(documentId))
      throw new NotFoundException('Validation run not found.');
    if (r.signedOffAt || r.rejectedAt)
      throw new ConflictException('This validation run is already closed.');
    await this.prisma.documentValidationRun.update({
      where: { id: r.id },
      data: {
        status: 'REJECTED',
        rejectedByUserId: a.userId,
        rejectedAt: new Date(),
        rejectionReason: dto.reason.trim(),
      },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'VALIDATION',
      entityId: r.id,
      lineageId: await this.lineageOf(a.organizationId, r),
      type: 'REJECTED',
      title: `Validation run ${r.runNumber} rejected: ${dto.reason.trim().slice(0, 120)}`,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'document.validation_rejected',
      entityType: 'DocumentValidationRun',
      entityId: r.id,
      metadata: { runNumber: r.runNumber },
    });
    return this.runView(a, r.id);
  }

  // ------------------------------------------------- missing documents

  /** Expected documents from the Sprint 16 compliance checklist (no second rules library). */
  async missingForPo(
    org: string,
    poId: string,
    docs: Doc[],
  ): Promise<{ checklistId: string | null; rows: MissingDocumentRow[] }> {
    const cl = await this.prisma.complianceChecklist.findFirst({
      where: { organizationId: org, purchaseOrderId: poId },
      include: { requirements: true },
    });
    if (!cl) return { checklistId: null, rows: [] };
    const statuses = await documentValidationStatuses(
      this.prisma,
      org,
      docs.map((d) => ({ id: d.id, version: d.version })),
    );
    const rows = new Map<string, MissingDocumentRow>();
    const rank: Record<string, number> = {
      REQUIRED: 0,
      CONDITIONAL: 1,
      RECOMMENDED: 2,
      INFORMATIONAL: 3,
    };
    for (const r of cl.requirements) {
      const s = r.ruleSnapshot as {
        name: string;
        level: string;
        basis: string;
        responsibleParty: string;
        documentTypes?: string[];
      };
      for (const t of s.documentTypes ?? []) {
        if (t === 'REGISTRATION_CERTIFICATE' || t === 'OTHER') continue;
        const prev = rows.get(t);
        if (
          prev &&
          rank[prev.level] <= rank[s.level] &&
          prev.state !== 'NOT_APPLICABLE'
        )
          continue;
        const doc = docs.find(
          (d) => d.documentType === t && d.status !== 'REJECTED',
        );
        const na =
          r.applicability === 'NOT_APPLICABLE' || Boolean(r.overrideKind);
        const state: MissingDocumentRow['state'] = na
          ? 'NOT_APPLICABLE'
          : doc
            ? 'AVAILABLE'
            : AFTER_SHIPMENT.includes(t)
              ? 'EXPECTED_LATER'
              : r.applicability === 'UNKNOWN'
                ? 'UNKNOWN'
                : 'MISSING_NOW';
        rows.set(t, {
          documentType: t as TradeDocumentType,
          label: LABEL[t] ?? t,
          state,
          requirementId: r.id,
          requirementName: s.name,
          level: s.level,
          basis: s.basis,
          responsibleParty: s.responsibleParty,
          generatable: isGenerated(t),
          reason:
            state === 'EXPECTED_LATER'
              ? 'Issued at shipment stage by the carrier/customs — not yet due (shipment tracking is not part of ExportPro yet).'
              : state === 'NOT_APPLICABLE'
                ? r.overrideKind
                  ? `Requirement marked ${r.overrideKind.replace('_', ' ').toLowerCase()}.`
                  : 'Not applicable to this order.'
                : state === 'UNKNOWN'
                  ? 'Applicability unknown — confirm on the compliance checklist.'
                  : state === 'AVAILABLE'
                    ? 'On file.'
                    : `${s.level === 'RECOMMENDED' ? 'Recommended' : 'Needed now'} — provided by ${s.responsibleParty.replace(/_/g, ' ').toLowerCase()}.`,
          document: doc
            ? {
                id: doc.id,
                title: doc.title,
                status: doc.status,
                validationStatus: statuses.get(doc.id)?.status ?? 'NOT_RUN',
              }
            : null,
        });
      }
    }
    return { checklistId: cl.id, rows: [...rows.values()] };
  }

  async packageView(
    a: Actor,
    poId: string,
    runId?: string,
  ): Promise<ValidationPackageView> {
    this.assert(a, 'document_validation.view');
    const org = a.organizationId;
    const po = await this.prisma.buyerPurchaseOrder.findFirst({
      where: { id: poId, organizationId: org },
      include: {
        discrepancies: { where: { status: 'OPEN' }, select: { id: true } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found.');
    const buyer = await this.prisma.buyerCompany.findFirst({
      where: { id: po.buyerCompanyId },
      select: { canonicalName: true },
    });
    const docs = await this.lineageDocs(org, poId);
    const [missing, statuses, runs] = await Promise.all([
      this.missingForPo(org, poId, docs),
      documentValidationStatuses(
        this.prisma,
        org,
        docs.map((d) => ({ id: d.id, version: d.version })),
      ),
      this.prisma.documentValidationRun.findMany({
        where: { organizationId: org, scope: 'PACKAGE', purchaseOrderId: poId },
        orderBy: { runNumber: 'desc' },
        take: 30,
        include: {
          findings: { where: { status: 'OPEN' }, select: { severity: true } },
        },
      }),
    ]);
    const confirmedDocs = await this.prisma.documentConfirmedData.findMany({
      where: {
        organizationId: org,
        tradeDocumentId: { in: docs.map((d) => d.id) },
      },
      select: { tradeDocumentId: true, documentVersion: true },
    });
    const extractions = await this.prisma.documentExtraction.findMany({
      where: {
        organizationId: org,
        tradeDocumentId: { in: docs.map((d) => d.id) },
      },
      orderBy: { extractionVersion: 'desc' },
      select: { tradeDocumentId: true, documentVersion: true, status: true },
    });
    const documents: PackageDocumentRow[] = docs.map((d) => {
      const ex = extractions.find(
        (x) => x.tradeDocumentId === d.id && x.documentVersion === d.version,
      );
      const conf = confirmedDocs.some(
        (c) => c.tradeDocumentId === d.id && c.documentVersion === d.version,
      );
      const st = statuses.get(d.id);
      return {
        id: d.id,
        title: d.title,
        documentType: d.documentType as TradeDocumentType,
        version: d.version,
        status: d.status,
        generated: d.generated,
        dataSource: d.generated
          ? 'STRUCTURED'
          : conf
            ? 'CONFIRMED'
            : ex && ex.status !== 'FAILED'
              ? 'UNREVIEWED'
              : 'NONE',
        extractionStatus:
          (ex?.status as PackageDocumentRow['extractionStatus']) ?? null,
        validationStatus: st?.status ?? 'NOT_RUN',
        openIssues: st?.openIssues ?? 0,
        purchaseOrderId: poId,
      };
    });
    const latest = runId
      ? await this.runView(a, runId)
      : runs[0]
        ? await this.runView(a, runs[0].id)
        : null;
    const names = await this.core.userNames(
      runs.flatMap((r) => [r.createdByUserId, r.signedOffByUserId]),
    );
    const requiredNow = missing.rows.filter(
      (r) =>
        ['MISSING_NOW', 'AVAILABLE'].includes(r.state) &&
        ['REQUIRED', 'CONDITIONAL'].includes(r.level),
    );
    const can = (p: Parameters<typeof roleHasPermission>[1]) =>
      roleHasPermission(a.role, p);
    return {
      purchaseOrder: {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        buyerName: buyer?.canonicalName ?? 'Buyer',
      },
      checklistId: missing.checklistId,
      status: (runs[0]?.status as DocumentValidationStatus) ?? 'NOT_RUN',
      completeness: {
        requiredNow: requiredNow.length,
        availableNow: requiredNow.filter((r) => r.state === 'AVAILABLE').length,
        expectedLater: missing.rows.filter((r) => r.state === 'EXPECTED_LATER')
          .length,
        unknown:
          missing.rows.filter((r) => r.state === 'UNKNOWN').length +
          (missing.checklistId ? 0 : 1),
        warnings: latest
          ? latest.findings.filter(
              (f) => f.status === 'OPEN' && f.severity === 'WARNING',
            ).length
          : 0,
        validationIssues: latest ? latest.counts.open : 0,
      },
      sprint15OpenDiscrepancies: po.discrepancies.length,
      documents,
      missing: missing.rows,
      latestRun: latest,
      history: runs.map((r) => ({
        id: r.id,
        runNumber: r.runNumber,
        status: r.status as DocumentValidationStatus,
        counts: {
          critical: r.errorCount,
          warning: r.warningCount,
          info: r.infoCount,
          open: r.findings.length,
          openCritical: r.findings.filter((f) => f.severity === 'CRITICAL')
            .length,
        },
        createdAt: r.createdAt.toISOString(),
        createdBy: names.get(r.createdByUserId) ?? null,
        signedOffBy: r.signedOffByUserId
          ? (names.get(r.signedOffByUserId) ?? null)
          : null,
        documents: r.documentIds.length,
      })),
      availableActions: [
        ...(can('document_validation.review') ? ['run'] : []),
        ...(can('documents.upload') ? ['upload'] : []),
        ...(can('documents.generate') || can('documents.edit_logistics')
          ? ['prepare']
          : []),
      ],
    };
  }

  async history(a: Actor, poId: string) {
    const p = await this.packageView(a, poId);
    return p.history;
  }

  async dashboard(a: Actor): Promise<ValidationDashboard> {
    this.assert(a, 'document_validation.view');
    const org = a.organizationId;
    const docs = await this.prisma.tradeDocument.findMany({
      where: {
        organizationId: org,
        status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
    const statuses = await documentValidationStatuses(
      this.prisma,
      org,
      docs.map((d) => ({ id: d.id, version: d.version })),
    );
    const confirmed = await this.prisma.documentConfirmedData.findMany({
      where: {
        organizationId: org,
        tradeDocumentId: { in: docs.map((d) => d.id) },
      },
      select: { tradeDocumentId: true, documentVersion: true },
    });
    const extractions = await this.prisma.documentExtraction.findMany({
      where: {
        organizationId: org,
        tradeDocumentId: { in: docs.map((d) => d.id) },
      },
      orderBy: { extractionVersion: 'desc' },
      select: { tradeDocumentId: true, documentVersion: true, status: true },
    });
    const needsValidation: PackageDocumentRow[] = [];
    for (const d of docs) {
      const st = statuses.get(d.id)!;
      const conf = confirmed.some(
        (c) => c.tradeDocumentId === d.id && c.documentVersion === d.version,
      );
      const ex = extractions.find(
        (x) => x.tradeDocumentId === d.id && x.documentVersion === d.version,
      );
      if (
        st.status === 'NOT_RUN' ||
        st.status === 'NEEDS_REVIEW' ||
        (!d.generated && !conf)
      )
        needsValidation.push({
          id: d.id,
          title: d.title,
          documentType: d.documentType as TradeDocumentType,
          version: d.version,
          status: d.status,
          generated: d.generated,
          dataSource: d.generated
            ? 'STRUCTURED'
            : conf
              ? 'CONFIRMED'
              : ex && ex.status !== 'FAILED'
                ? 'UNREVIEWED'
                : 'NONE',
          extractionStatus:
            (ex?.status as PackageDocumentRow['extractionStatus']) ?? null,
          validationStatus: st.status,
          openIssues: st.openIssues,
          purchaseOrderId: d.purchaseOrderId,
        });
    }
    const runs = await this.prisma.documentValidationRun.findMany({
      where: { organizationId: org },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        findings: { where: { status: 'OPEN' }, select: { severity: true } },
      },
    });
    const pos = await this.prisma.buyerPurchaseOrder.findMany({
      where: {
        organizationId: org,
        id: {
          in: [
            ...new Set(
              runs.map((r) => r.purchaseOrderId).filter(Boolean) as string[],
            ),
          ],
        },
      },
      select: { id: true, poNumber: true },
    });
    const label = (r: (typeof runs)[number]) =>
      `${r.scope === 'PACKAGE' ? 'Order package' : 'Document'}${r.purchaseOrderId ? ` · PO ${pos.find((p) => p.id === r.purchaseOrderId)?.poNumber ?? ''}` : ''} · run ${r.runNumber}`;
    const latestByScope = new Map<string, (typeof runs)[number]>();
    for (const r of runs) {
      const k = `${r.scope}:${r.scope === 'PACKAGE' ? r.purchaseOrderId : r.primaryDocumentId}`;
      if (!latestByScope.has(k)) latestByScope.set(k, r);
    }
    const latest = [...latestByScope.values()];
    const signerNames = await this.core.userNames(
      runs.map((r) => r.signedOffByUserId),
    );
    const accepted = await this.prisma.buyerPurchaseOrder.findMany({
      where: { organizationId: org, status: 'ACCEPTED' },
      select: { id: true, poNumber: true, buyerCompanyId: true },
      take: 50,
      orderBy: { updatedAt: 'desc' },
    });
    const buyers = await this.prisma.buyerCompany.findMany({
      where: { id: { in: accepted.map((p) => p.buyerCompanyId) } },
      select: { id: true, canonicalName: true },
    });
    const missing: ValidationDashboard['missing'] = [];
    for (const p of accepted) {
      const m = await this.missingForPo(
        org,
        p.id,
        await this.lineageDocs(org, p.id),
      );
      const rows = m.rows.filter(
        (r) =>
          r.state === 'MISSING_NOW' ||
          r.state === 'EXPECTED_LATER' ||
          r.state === 'UNKNOWN',
      );
      if (rows.length)
        missing.push({
          purchaseOrderId: p.id,
          poNumber: p.poNumber,
          buyerName:
            buyers.find((b) => b.id === p.buyerCompanyId)?.canonicalName ??
            'Buyer',
          rows,
        });
    }
    const openOf = (r: (typeof runs)[number], s: string) =>
      r.findings.filter((f) => f.severity === s).length;
    return {
      needsValidation: needsValidation.slice(0, 100),
      issues: latest
        .filter(
          (r) =>
            !r.signedOffAt &&
            !r.rejectedAt &&
            (openOf(r, 'CRITICAL') || openOf(r, 'WARNING')),
        )
        .map((r) => ({
          runId: r.id,
          purchaseOrderId: r.purchaseOrderId,
          primaryDocumentId: r.primaryDocumentId,
          label: label(r),
          critical: openOf(r, 'CRITICAL'),
          warning: openOf(r, 'WARNING'),
          status: r.status as DocumentValidationStatus,
          createdAt: r.createdAt.toISOString(),
        })),
      missing,
      signedOff: runs
        .filter((r) => r.signedOffAt)
        .slice(0, 50)
        .map((r) => ({
          runId: r.id,
          purchaseOrderId: r.purchaseOrderId,
          primaryDocumentId: r.primaryDocumentId,
          label: label(r),
          signedOffAt: r.signedOffAt!.toISOString(),
          signedOffBy: r.signedOffByUserId
            ? (signerNames.get(r.signedOffByUserId) ?? null)
            : null,
        })),
      history: runs.slice(0, 50).map((r) => ({
        runId: r.id,
        purchaseOrderId: r.purchaseOrderId,
        primaryDocumentId: r.primaryDocumentId,
        label: label(r),
        status: r.status as DocumentValidationStatus,
        critical: r.errorCount,
        warning: r.warningCount,
        createdAt: r.createdAt.toISOString(),
      })),
      summary: {
        documentsValidated: [...statuses.values()].filter(
          (s) => s.status !== 'NOT_RUN',
        ).length,
        critical: latest.reduce(
          (s, r) =>
            s + (r.signedOffAt || r.rejectedAt ? 0 : openOf(r, 'CRITICAL')),
          0,
        ),
        warnings: latest.reduce(
          (s, r) =>
            s + (r.signedOffAt || r.rejectedAt ? 0 : openOf(r, 'WARNING')),
          0,
        ),
        missing: missing.reduce(
          (s, m) => s + m.rows.filter((r) => r.state === 'MISSING_NOW').length,
          0,
        ),
        unresolved: latest.reduce(
          (s, r) => s + (r.signedOffAt || r.rejectedAt ? 0 : r.findings.length),
          0,
        ),
        signedOff: runs.filter((r) => r.signedOffAt).length,
        lastValidationAt: iso(runs[0]?.createdAt),
      },
    };
  }

  async missingAll(a: Actor) {
    return (await this.dashboard(a)).missing;
  }
}
