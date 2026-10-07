import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  roleHasPermission,
  type ChecklistDocumentRow,
  type ChecklistSummary,
  type ComplianceChecklistView,
  type ComplianceOverview,
  type ComplianceReadiness,
  type ComplianceRuleView,
  type CoverageView,
  type DocumentAvailability,
  type ExpiryState,
  type RequirementEvidence,
  type RequirementStatus,
  type RequirementView,
  type RuleProvenance,
  type TradeDocumentType,
  GENERATABLE_DOCUMENT_TYPES,
} from '@exportpro/types';
import { AuditService } from '../audit/audit.service';
import {
  CommercialCoreService,
  type Actor,
  iso,
  day,
} from '../commercial/commercial-core.service';
import { PrismaService } from '../../prisma/prisma.service';
import { documentValidationStatuses } from '../document-validation/validation.service';
import {
  applicability,
  buyerRequestMapping,
  coverage,
  type EvalContext,
  isStale,
  PLATFORM_RULES,
  type SatisfiedBy,
} from './compliance-rules';
import {
  computeReadiness,
  isOpen,
  READINESS_RANK,
  type ReadinessItem,
} from './compliance-readiness';
import {
  AddRequirementDto,
  MarkReadyDto,
  OverrideDto,
  UpdateRequirementDto,
} from './compliance.dto';

/** Rule as evaluated — stored on each instance so later rule edits never rewrite history. */
interface RuleSnapshot {
  name: string;
  description: string;
  requirementType: string;
  level: string;
  severity: string;
  basis: string;
  jurisdiction: string;
  responsibleParty: string;
  satisfiedBy: SatisfiedBy;
  documentTypes: TradeDocumentType[];
  provenance: Omit<RuleProvenance, 'stale'>;
}

type Instance = Prisma.ComplianceRequirementInstanceGetPayload<object>;
type Checklist = Prisma.ComplianceChecklistGetPayload<{
  include: { requirements: true };
}>;

const today = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
const DOC_LABEL: Record<string, string> = {
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
  OTHER: 'Other document',
};
const VERIFICATION_NOTE: Record<string, string> = {
  VERIFIED: 'Verified',
  DOCUMENT_UPLOADED: 'Document uploaded — not government verified',
  PENDING_REVIEW: 'Pending review — not government verified',
  FORMAT_VALID: 'Number format valid — not government verified',
  USER_DECLARED: 'User declared — not government verified',
  NOT_PROVIDED: 'Not provided',
  REJECTED: 'Rejected',
};
const EVIDENCE_OK = ['APPROVED', 'ISSUED_EXTERNAL'];

export const expiryState = (d: Date | null, warnDays: number): ExpiryState => {
  if (!d) return null;
  const t = today().getTime();
  if (d.getTime() < t) return 'EXPIRED';
  if (d.getTime() - t <= warnDays * 86400000) return 'EXPIRING_SOON';
  return 'VALID';
};

@Injectable()
export class ComplianceService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly core: CommercialCoreService,
  ) {}

  /** Platform rules are code-versioned: a new (code, version) row is added, existing rows are never rewritten. */
  async onModuleInit() {
    await this.prisma.complianceRule.createMany({
      skipDuplicates: true,
      data: PLATFORM_RULES.map((r) => ({
        organizationId: null,
        code: r.code,
        version: r.version,
        name: r.name,
        description: r.description,
        requirementType: r.requirementType,
        level: r.level,
        severity: r.severity,
        basis: r.basis,
        jurisdiction: r.jurisdiction,
        countryCode: r.countryCode,
        hsPrefixes: r.hsPrefixes,
        productCategory: r.productCategory,
        conditionJson: (r.condition ?? undefined) as
          Prisma.InputJsonValue | undefined,
        satisfiedBy: r.satisfiedBy as unknown as Prisma.InputJsonValue,
        documentTypes: r.documentTypes,
        responsibleParty: r.responsibleParty,
        sourceType: r.sourceType,
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        sourceDate: r.sourceDate ? new Date(r.sourceDate) : null,
        lastCheckedAt: new Date(r.lastCheckedAt),
        confidence: r.confidence,
      })),
    });
  }

  async warnDays(organizationId: string) {
    const t = await this.prisma.documentTemplate.findUnique({
      where: {
        organizationId_documentType: {
          organizationId,
          documentType: 'GENERAL',
        },
      },
    });
    return t?.expiryWarningDays ?? 30;
  }

  // ------------------------------------------------------------ context

  /** Transaction context from commercial lineage: PO → PI → quotation → inquiry (no AI, no guessing). */
  private async context(
    organizationId: string,
    anchor: { purchaseOrderId?: string; quotationId?: string },
  ) {
    const po = anchor.purchaseOrderId
      ? await this.prisma.buyerPurchaseOrder.findFirst({
          where: { id: anchor.purchaseOrderId, organizationId },
          include: {
            items: { orderBy: { sortOrder: 'asc' } },
            discrepancies: true,
          },
        })
      : null;
    if (anchor.purchaseOrderId && !po)
      throw new NotFoundException('Purchase order not found.');
    const qid = anchor.quotationId ?? po?.quotationId ?? null;
    const q = qid
      ? await this.prisma.quotation.findFirst({
          where: { id: qid, organizationId },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        })
      : null;
    if (anchor.quotationId && !q)
      throw new NotFoundException('Quotation not found.');
    const pi = po?.proformaInvoiceId
      ? await this.prisma.proformaInvoice.findFirst({
          where: { id: po.proformaInvoiceId, organizationId },
        })
      : null;
    const inquiryId = po?.inquiryId ?? q?.inquiryId ?? null;
    const inquiry = inquiryId
      ? await this.prisma.buyerInquiry.findFirst({
          where: { id: inquiryId, organizationId },
        })
      : null;
    const rfq = (inquiry?.confirmedRfq ?? null) as {
      destination?: { countryCode?: string | null };
      certifications?: string[];
    } | null;
    const productIds = [
      ...new Set(
        [...(po?.items ?? []), ...(q?.items ?? [])]
          .map((i) => i.productId)
          .filter(Boolean) as string[],
      ),
    ];
    const products = productIds.length
      ? await this.prisma.organizationProduct.findMany({
          where: { id: { in: productIds }, organizationId },
          select: { id: true, hsCode: true, displayName: true },
        })
      : [];
    const pMap = new Map(products.map((p) => [p.id, p]));
    const qItem = new Map((q?.items ?? []).map((i) => [i.id, i]));
    const lines = po
      ? po.items.map((i) => {
          const qi = i.quotationItemId
            ? qItem.get(i.quotationItemId)
            : undefined;
          const pid = i.productId ?? qi?.productId ?? null;
          return {
            productId: pid,
            description: i.description,
            hsCode: (pid ? pMap.get(pid)?.hsCode : null) ?? qi?.hsCode ?? null,
          };
        })
      : (q?.items ?? []).map((i) => ({
          productId: i.productId,
          description: i.description,
          hsCode:
            (i.productId ? pMap.get(i.productId)?.hsCode : null) ?? i.hsCode,
        }));
    let shipmentMode: string | null = null;
    if (q?.costingId) {
      const sc = await this.prisma.costingScenario.findFirst({
        where: {
          costingId: q.costingId,
          isBase: true,
          costing: { organizationId },
        },
        select: { transportMode: true },
      });
      shipmentMode = sc?.transportMode ?? null;
    }
    const ctx: EvalContext = {
      // Shipment destination from the commercial lineage — never the buyer company's country.
      destinationCountry:
        pi?.destinationCountry ??
        q?.destinationCountry ??
        rfq?.destination?.countryCode ??
        null,
      incoterm: po?.incoterm ?? pi?.incoterm ?? q?.incoterm ?? null,
      shipmentMode,
      products: lines,
    };
    const buyerId = po?.buyerCompanyId ?? q?.buyerCompanyId ?? null;
    const buyer = buyerId
      ? await this.prisma.buyerCompany.findFirst({
          where: { id: buyerId },
          select: { canonicalName: true },
        })
      : null;
    return {
      po,
      q,
      pi,
      inquiryId,
      ctx,
      buyerRequested: (rfq?.certifications ?? []).filter(
        (c) => typeof c === 'string' && c.trim(),
      ),
      buyer: {
        id: buyerId,
        name: buyer?.canonicalName ?? q?.buyerName ?? 'Buyer',
      },
      incotermPlace:
        po?.incotermPlace ?? pi?.incotermPlace ?? q?.incotermPlace ?? null,
    };
  }

  private async load(
    organizationId: string,
    where: Prisma.ComplianceChecklistWhereInput,
  ): Promise<Checklist | null> {
    return this.prisma.complianceChecklist.findFirst({
      where: { organizationId, ...where },
      include: {
        requirements: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  }

  // --------------------------------------------------------- evaluation

  /** Deterministic evaluation of all active rules for a transaction. Overrides, notes and manual items are preserved. */
  async evaluate(
    a: Actor,
    anchor: { purchaseOrderId?: string; quotationId?: string },
    explicit = true,
  ) {
    const org = a.organizationId;
    const c = await this.context(org, anchor);
    if (c.po && ['CANCELLED', 'REJECTED'].includes(c.po.status))
      throw new ConflictException(
        `A ${c.po.status.toLowerCase()} PO has no compliance checklist.`,
      );
    const provisional = !c.po || c.po.status !== 'ACCEPTED';
    const cov = coverage(c.ctx);
    const rules = await this.prisma.complianceRule.findMany({
      where: {
        active: true,
        OR: [{ organizationId: null }, { organizationId: org }],
      },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    });
    const latest = [...new Map(rules.map((r) => [r.code, r])).values()].filter(
      (r) => {
        const now = Date.now();
        return (
          (!r.effectiveFrom || r.effectiveFrom.getTime() <= now) &&
          (!r.effectiveTo || r.effectiveTo.getTime() >= now)
        );
      },
    );
    const key = c.po ? { purchaseOrderId: c.po.id } : { quotationId: c.q!.id };
    const checklist = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.complianceChecklist.findFirst({
        where: { organizationId: org, ...key },
        include: { requirements: true },
      });
      const cl =
        existing ??
        (await tx.complianceChecklist.create({
          data: {
            organizationId: org,
            ...key,
            provisional,
            context: {} as Prisma.InputJsonValue,
            coverage: {} as Prisma.InputJsonValue,
          },
          include: { requirements: true },
        }));
      const seen = new Set<string>();
      let order = 0;
      const upsert = async (
        code: string,
        version: number,
        ruleId: string | null,
        snap: RuleSnapshot,
        app: ReturnType<typeof applicability>,
        countryCode: string | null,
      ) => {
        seen.add(code);
        const prev = cl.requirements.find(
          (r) => r.ruleCode === code && r.productKey === '',
        );
        const data = {
          ruleId,
          ruleVersion: version,
          ruleSnapshot: snap as unknown as Prisma.InputJsonValue,
          applicability: app.applicability,
          explanation: app.explanation,
          productLabel: app.productLabel,
          countryCode,
          sortOrder: order++,
        };
        if (prev)
          await tx.complianceRequirementInstance.update({
            where: { id: prev.id },
            data,
          });
        else
          await tx.complianceRequirementInstance.create({
            data: {
              ...data,
              organizationId: org,
              checklistId: cl.id,
              ruleCode: code,
              productKey: '',
              status:
                app.applicability === 'NOT_APPLICABLE'
                  ? 'NOT_APPLICABLE'
                  : 'NOT_STARTED',
            },
          });
      };
      for (const r of latest) {
        const app = applicability(r, c.ctx);
        await upsert(
          r.code,
          r.version,
          r.id,
          {
            name: r.name,
            description: r.description,
            requirementType: r.requirementType,
            level: r.level,
            severity: r.severity,
            basis: r.basis,
            jurisdiction: r.jurisdiction,
            responsibleParty: r.responsibleParty,
            satisfiedBy: r.satisfiedBy as unknown as SatisfiedBy,
            documentTypes: r.documentTypes as TradeDocumentType[],
            provenance: {
              sourceType: r.sourceType as RuleProvenance['sourceType'],
              sourceName: r.sourceName,
              sourceUrl: r.sourceUrl,
              sourceDate: day(r.sourceDate),
              lastCheckedAt: day(r.lastCheckedAt),
              effectiveFrom: day(r.effectiveFrom),
              effectiveTo: day(r.effectiveTo),
              confidence: r.confidence as RuleProvenance['confidence'],
            },
          },
          app,
          r.countryCode ?? c.ctx.destinationCountry,
        );
      }
      // Buyer-requested certificates/documents (Sprint 13 RFQ) — contractual, never statutory.
      for (const name of c.buyerRequested) {
        const m = buyerRequestMapping(name);
        const code = `BUYER.${name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_')
          .slice(0, 40)}`;
        await upsert(
          code,
          1,
          null,
          {
            name: `Buyer requested: ${name}`,
            description:
              'Requested by the buyer in the RFQ. This is a commercial/contractual request, not a regulatory requirement.',
            requirementType: 'DOCUMENT',
            level: 'CONDITIONAL',
            severity: 'WARNING',
            basis: 'BUYER_REQUESTED',
            jurisdiction: 'TRANSACTION',
            responsibleParty:
              m.documentTypes.includes('PHYTOSANITARY_CERTIFICATE') ||
              m.documentTypes.includes('CERTIFICATE_OF_ORIGIN')
                ? 'GOVERNMENT'
                : 'EXPORTER',
            satisfiedBy: m.satisfiedBy,
            documentTypes: m.documentTypes,
            provenance: {
              sourceType: 'USER_DEFINED',
              sourceName: 'Buyer RFQ (confirmed by your team)',
              sourceUrl: null,
              sourceDate: null,
              lastCheckedAt: null,
              effectiveFrom: null,
              effectiveTo: null,
              confidence: 'HIGH',
            },
          },
          {
            applicability: 'APPLICABLE',
            explanation: `The buyer asked for “${name}” in the confirmed RFQ.`,
            productLabel: null,
          },
          null,
        );
      }
      // Items no longer produced by the rule set stay in history as not applicable (manual items untouched).
      for (const r of cl.requirements)
        if (
          !seen.has(r.ruleCode) &&
          !r.ruleCode.startsWith('USER.') &&
          r.applicability !== 'NOT_APPLICABLE'
        )
          await tx.complianceRequirementInstance.update({
            where: { id: r.id },
            data: {
              applicability: 'NOT_APPLICABLE',
              explanation:
                'No longer applicable after re-evaluation (order or rule set changed).',
            },
          });
      await tx.complianceChecklist.update({
        where: { id: cl.id },
        data: {
          provisional,
          context: {
            ...c.ctx,
            incotermPlace: c.incotermPlace,
            buyer: c.buyer,
            inquiryId: c.inquiryId,
            proformaInvoiceId: c.pi?.id ?? null,
            quotationId: c.q?.id ?? null,
          } as unknown as Prisma.InputJsonValue,
          coverage: cov as unknown as Prisma.InputJsonValue,
          evaluatedAt: new Date(),
          evaluatedByUserId: a.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (explicit)
        await this.core.event(tx, a, {
          entityType: 'COMPLIANCE',
          entityId: cl.id,
          lineageId: cl.id,
          type: 'EVALUATED',
          title: `Compliance evaluated (${latest.length} rules, coverage ${cov.overall.toLowerCase()})`,
        });
      return cl;
    });
    if (explicit)
      await this.audit.record({
        organizationId: org,
        actorId: a.userId,
        action: 'compliance.rule_evaluated',
        entityType: 'ComplianceChecklist',
        entityId: checklist.id,
        metadata: {
          rules: latest.map((r) => `${r.code}@${r.version}`),
          coverage: cov.overall,
          provisional,
        },
      });
    return this.view(a, (await this.load(org, { id: checklist.id }))!);
  }

  // ---------------------------------------------------- evidence/status

  /** Recomputes every instance status from current evidence (registrations, certifications, documents). */
  private async refresh(organizationId: string, cl: Checklist) {
    const warnDays = await this.warnDays(organizationId);
    const [regs, certs] = await Promise.all([
      this.prisma.registration.findMany({
        where: { organizationId },
        include: { documents: { select: { id: true } } },
      }),
      this.prisma.certification.findMany({
        where: { organizationId },
        include: { documents: { select: { id: true } } },
      }),
    ]);
    const anchorOr: Prisma.TradeDocumentWhereInput[] = [];
    if (cl.purchaseOrderId)
      anchorOr.push({ purchaseOrderId: cl.purchaseOrderId });
    if (cl.quotationId) anchorOr.push({ quotationId: cl.quotationId });
    const linkedIds = cl.requirements
      .map((r) => r.evidenceDocumentId)
      .filter(Boolean) as string[];
    const linkedRoots = linkedIds.length
      ? (
          await this.prisma.tradeDocument.findMany({
            where: { id: { in: linkedIds }, organizationId },
            select: { rootId: true },
          })
        ).map((d) => d.rootId)
      : [];
    if (linkedRoots.length) anchorOr.push({ rootId: { in: linkedRoots } });
    const docs = anchorOr.length
      ? await this.prisma.tradeDocument.findMany({
          where: {
            organizationId,
            OR: anchorOr,
            status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
          },
          orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
        })
      : [];
    const rootOf = new Map<string, string>();
    for (const d of await this.prisma.tradeDocument.findMany({
      where: { id: { in: linkedIds }, organizationId },
      select: { id: true, rootId: true },
    }))
      rootOf.set(d.id, d.rootId);
    const validation = await documentValidationStatuses(
      this.prisma,
      organizationId,
      docs.map((x) => ({ id: x.id, version: x.version })),
    );
    const items: {
      inst: Instance;
      status: RequirementStatus;
      evidence: RequirementEvidence[];
      expiringSoon: boolean;
    }[] = [];
    for (const inst of cl.requirements) {
      const snap = inst.ruleSnapshot as unknown as RuleSnapshot;
      const r = this.derive(inst, snap, {
        regs,
        certs,
        docs,
        rootOf,
        warnDays,
        validation,
      });
      items.push({ inst, ...r });
      if (r.status !== inst.status)
        await this.prisma.complianceRequirementInstance.update({
          where: { id: inst.id },
          data: { status: r.status },
        });
    }
    const cov = cl.coverage as unknown as CoverageView;
    const rd = computeReadiness(
      items.map(({ inst, status, expiringSoon }) => {
        const s = inst.ruleSnapshot as unknown as RuleSnapshot;
        return {
          id: inst.id,
          name: s.name,
          level: s.level,
          severity: s.severity,
          basis: s.basis,
          applicability: inst.applicability,
          status,
          expiringSoon,
        } as ReadinessItem;
      }),
      { provisional: cl.provisional, coverage: cov?.overall ?? 'UNKNOWN' },
    );
    if (rd.readiness !== cl.readiness)
      await this.prisma.complianceChecklist.update({
        where: { id: cl.id },
        data: { readiness: rd.readiness },
      });
    return { items, rd, docs, warnDays, validation };
  }

  private derive(
    inst: Instance,
    snap: RuleSnapshot,
    d: {
      regs: Prisma.RegistrationGetPayload<{
        include: { documents: { select: { id: true } } };
      }>[];
      certs: Prisma.CertificationGetPayload<{
        include: { documents: { select: { id: true } } };
      }>[];
      docs: Prisma.TradeDocumentGetPayload<object>[];
      rootOf: Map<string, string>;
      warnDays: number;
      validation: Map<string, { status: string; openIssues: number }>;
    },
  ): {
    status: RequirementStatus;
    evidence: RequirementEvidence[];
    expiringSoon: boolean;
  } {
    if (inst.overrideKind)
      return {
        status: inst.overrideKind as RequirementStatus,
        evidence: [],
        expiringSoon: false,
      };
    if (inst.applicability === 'NOT_APPLICABLE')
      return { status: 'NOT_APPLICABLE', evidence: [], expiringSoon: false };
    const evidence: RequirementEvidence[] = [];
    let expiringSoon = false;
    const fromDocs = (): RequirementStatus | null => {
      const types = snap.documentTypes;
      const linkedRoot = inst.evidenceDocumentId
        ? d.rootOf.get(inst.evidenceDocumentId)
        : undefined;
      // Only documents of an accepted type count; a linked document of another type never satisfies.
      const cands = d.docs.filter(
        (x) =>
          types.includes(x.documentType as TradeDocumentType) &&
          (x.rootId === linkedRoot ||
            (snap.satisfiedBy.kind === 'documents' &&
              (x.purchaseOrderId || x.quotationId))),
      );
      if (!cands.length) return null;
      const rank = (x: (typeof cands)[number]) => {
        const exp = expiryState(x.expiryDate, d.warnDays);
        if (EVIDENCE_OK.includes(x.status) && exp !== 'EXPIRED') return 6;
        if (x.status === 'UNDER_REVIEW') return 5;
        if (x.status === 'UPLOADED') return 4;
        if (['DRAFT', 'GENERATED'].includes(x.status)) return 3;
        if (exp === 'EXPIRED' || x.status === 'EXPIRED') return 2;
        return 1;
      };
      const best = [...cands].sort((x, y) => rank(y) - rank(x))[0];
      const exp = expiryState(best.expiryDate, d.warnDays);
      evidence.push({
        kind: 'DOCUMENT',
        id: best.id,
        label: `${DOC_LABEL[best.documentType] ?? best.documentType}${best.documentNumber ? ` ${best.documentNumber}` : ''} v${best.version}`,
        status: exp === 'EXPIRED' ? 'EXPIRED' : best.status,
        expiryDate: day(best.expiryDate),
        verificationNote: best.generated
          ? 'Prepared by exporter in ExportPro'
          : 'Reviewed as evidence only — authenticity not verified by ExportPro',
        validationStatus: d.validation.get(best.id)?.status ?? 'NOT_RUN',
      });
      if (exp === 'EXPIRING_SOON') expiringSoon = true;
      const rk = rank(best);
      // Requirements that need validated evidence: an approved document counts only once its consistency validation is signed off (never from an unreviewed extraction).
      if (
        rk === 6 &&
        snap.satisfiedBy.kind === 'documents' &&
        snap.satisfiedBy.requiresValidation &&
        d.validation.get(best.id)?.status !== 'SIGNED_OFF'
      )
        return 'UNDER_REVIEW';
      return rk === 6
        ? 'SATISFIED'
        : rk === 5
          ? 'UNDER_REVIEW'
          : rk === 4
            ? 'DOCUMENT_UPLOADED'
            : rk === 3
              ? 'IN_PROGRESS'
              : rk === 2
                ? 'EXPIRED'
                : 'REJECTED';
    };
    const sb = snap.satisfiedBy;
    let status: RequirementStatus = 'MISSING';
    if (sb.kind === 'registration') {
      const r = d.regs.find((x) => x.type === sb.type);
      if (r) {
        const exp = expiryState(r.expiryDate, d.warnDays);
        evidence.push({
          kind: 'REGISTRATION',
          id: r.id,
          label: `${r.type}${r.number ? ` ${r.number}` : ''}`,
          status: r.status,
          expiryDate: day(r.expiryDate),
          verificationNote:
            VERIFICATION_NOTE[r.verificationStatus] ?? r.verificationStatus,
        });
        if (r.status === 'AVAILABLE') {
          if (r.verificationStatus === 'REJECTED') status = 'REJECTED';
          else if (exp === 'EXPIRED') status = 'EXPIRED';
          else if (!r.number) status = 'IN_PROGRESS';
          else status = 'SATISFIED';
          if (exp === 'EXPIRING_SOON') expiringSoon = true;
        } else if (r.status === 'APPLIED_PENDING') status = 'IN_PROGRESS';
        else if (r.status === 'NOT_APPLICABLE' && sb.acceptNotApplicable)
          status = 'NOT_APPLICABLE';
      }
      if (status !== 'SATISFIED') status = this.better(status, fromDocs());
    } else if (sb.kind === 'certification') {
      const names = sb.names.map((n) => n.toLowerCase());
      const matches = d.certs.filter(
        (c) =>
          sb.types.includes(c.type.toUpperCase()) ||
          names.some(
            (n) =>
              c.name.toLowerCase().includes(n) ||
              c.type.toLowerCase().includes(n),
          ),
      );
      for (const c of matches) {
        const exp = expiryState(c.expiryDate, d.warnDays);
        evidence.push({
          kind: 'CERTIFICATION',
          id: c.id,
          label: `${c.name}${c.number ? ` ${c.number}` : ''}`,
          status: exp === 'EXPIRED' ? 'EXPIRED' : c.status,
          expiryDate: day(c.expiryDate),
          verificationNote:
            VERIFICATION_NOTE[c.verificationStatus] ?? c.verificationStatus,
        });
        const s: RequirementStatus =
          c.status === 'EXPIRED' || exp === 'EXPIRED'
            ? 'EXPIRED'
            : c.status === 'PENDING'
              ? 'IN_PROGRESS'
              : c.verificationStatus === 'REJECTED'
                ? 'REJECTED'
                : 'SATISFIED';
        if (s === 'SATISFIED' && exp === 'EXPIRING_SOON') expiringSoon = true;
        status = this.better(status, s);
      }
      if (status !== 'SATISFIED') status = this.better(status, fromDocs());
    } else if (sb.kind === 'documents') {
      status = fromDocs() ?? 'MISSING';
    } else {
      const doc = fromDocs();
      if (inst.manualNote) {
        evidence.push({
          kind: 'MANUAL',
          id: null,
          label: inst.manualNote,
          status: 'CONFIRMED',
          expiryDate: null,
          verificationNote: 'Manually confirmed by your team',
        });
        status = 'SATISFIED';
      } else
        status =
          doc ??
          (['NOT_STARTED', 'IN_PROGRESS'].includes(inst.status)
            ? (inst.status as RequirementStatus)
            : 'NOT_STARTED');
    }
    if (status === 'MISSING' && inst.status === 'IN_PROGRESS')
      status = 'IN_PROGRESS';
    return {
      status,
      evidence,
      expiringSoon: status === 'SATISFIED' && expiringSoon,
    };
  }

  private better(
    a: RequirementStatus,
    b: RequirementStatus | null,
  ): RequirementStatus {
    if (!b) return a;
    const rank: Partial<Record<RequirementStatus, number>> = {
      SATISFIED: 9,
      NOT_APPLICABLE: 8,
      UNDER_REVIEW: 6,
      DOCUMENT_UPLOADED: 5,
      IN_PROGRESS: 4,
      EXPIRED: 3,
      REJECTED: 2,
      MISSING: 1,
      NOT_STARTED: 1,
    };
    return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a;
  }

  // ------------------------------------------------------------- views

  private async view(
    a: Actor,
    cl: Checklist,
  ): Promise<ComplianceChecklistView> {
    const org = a.organizationId;
    const { items, rd, docs, validation } = await this.refresh(org, cl);
    const ctx = cl.context as unknown as EvalContext & {
      incotermPlace: string | null;
      buyer: { id: string | null; name: string };
      inquiryId: string | null;
      proformaInvoiceId: string | null;
      quotationId: string | null;
    };
    const [po, q, pi] = await Promise.all([
      cl.purchaseOrderId
        ? this.prisma.buyerPurchaseOrder.findFirst({
            where: { id: cl.purchaseOrderId, organizationId: org },
            include: {
              discrepancies: {
                where: { status: 'OPEN', severity: 'CRITICAL' },
                select: { id: true },
              },
            },
          })
        : null,
      ctx.quotationId
        ? this.prisma.quotation.findFirst({
            where: { id: ctx.quotationId, organizationId: org },
            select: { id: true, quotationNumber: true, revision: true },
          })
        : null,
      ctx.proformaInvoiceId
        ? this.prisma.proformaInvoice.findFirst({
            where: { id: ctx.proformaInvoiceId, organizationId: org },
            select: { id: true, piNumber: true, revision: true },
          })
        : null,
    ]);
    const userIds = cl.requirements
      .flatMap((r) => [r.overriddenByUserId, r.manualByUserId])
      .concat(cl.readyByUserId);
    const names = await this.core.userNames(userIds);
    const nm = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    const requirements: RequirementView[] = items.map(
      ({ inst, status, evidence, expiringSoon }) => {
        const s = inst.ruleSnapshot as unknown as RuleSnapshot;
        const ri: ReadinessItem = {
          id: inst.id,
          name: s.name,
          level: s.level as ReadinessItem['level'],
          severity: s.severity as ReadinessItem['severity'],
          basis: s.basis as ReadinessItem['basis'],
          applicability: inst.applicability as ReadinessItem['applicability'],
          status,
          expiringSoon,
        };
        return {
          id: inst.id,
          ruleCode: inst.ruleCode,
          ruleVersion: inst.ruleVersion,
          name: s.name,
          description: s.description,
          requirementType:
            s.requirementType as RequirementView['requirementType'],
          level: s.level as RequirementView['level'],
          severity: s.severity as RequirementView['severity'],
          basis: s.basis as RequirementView['basis'],
          jurisdiction: s.jurisdiction as RequirementView['jurisdiction'],
          responsibleParty:
            s.responsibleParty as RequirementView['responsibleParty'],
          applicability: inst.applicability as RequirementView['applicability'],
          status,
          explanation: inst.explanation,
          satisfiedBy: this.satisfiedByText(s),
          documentTypes: s.documentTypes,
          productLabel: inst.productLabel,
          provenance: {
            ...s.provenance,
            stale:
              s.provenance.sourceType === 'USER_DEFINED'
                ? false
                : isStale(s.provenance.lastCheckedAt),
          },
          evidence,
          expiringSoon,
          notes: inst.notes,
          dueDate: day(inst.dueDate),
          override: inst.overrideKind
            ? {
                kind: inst.overrideKind as 'WAIVED',
                reason: inst.overrideReason ?? '',
                by: nm(inst.overriddenByUserId),
                at: iso(inst.overriddenAt)!,
              }
            : null,
          manualConfirmation: inst.manualNote
            ? {
                note: inst.manualNote,
                by: nm(inst.manualByUserId),
                at: iso(inst.manualAt)!,
              }
            : null,
          open: isOpen(ri),
        };
      },
    );
    const documents = this.documentMatrix(requirements, docs, validation);
    const can = (p: Parameters<typeof roleHasPermission>[1]) =>
      roleHasPermission(a.role, p);
    const actions: string[] = [];
    if (can('compliance.manage'))
      actions.push(
        'evaluate',
        'add_requirement',
        'update_requirement',
        'link_evidence',
      );
    if (can('compliance.review')) actions.push('manual_confirm');
    if (can('compliance.override')) actions.push('override');
    if (
      can('compliance.ready') &&
      !cl.provisional &&
      (rd.readiness === 'READY' || rd.readiness === 'READY_WITH_WARNINGS')
    )
      actions.push('mark_ready');
    if (can('documents.generate')) actions.push('generate_documents');
    if (can('documents.upload')) actions.push('upload_documents');
    const events = await this.core.events(org, [cl.id]);
    const cov = cl.coverage as unknown as CoverageView;
    return {
      id: cl.id,
      provisional: cl.provisional,
      purchaseOrder: po
        ? {
            id: po.id,
            poNumber: po.poNumber,
            status: po.status,
            openCriticalDiscrepancies: po.discrepancies.length,
          }
        : null,
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
      inquiryId: ctx.inquiryId ?? null,
      buyer: ctx.buyer ?? { id: null, name: 'Buyer' },
      destinationCountry: ctx.destinationCountry ?? null,
      incoterm: ctx.incoterm ?? null,
      incotermPlace: ctx.incotermPlace ?? null,
      shipmentMode: ctx.shipmentMode ?? null,
      products: ctx.products ?? [],
      evaluatedAt: cl.evaluatedAt.toISOString(),
      rowVersion: cl.rowVersion,
      readiness: rd.readiness,
      readinessReasons: rd.reasons,
      requiredReadiness: rd.requiredReadiness,
      recommendedCompletion: rd.recommendedCompletion,
      coverage: cov,
      blockers: rd.blockers,
      warnings: rd.warnings,
      requirements,
      documents,
      ready: cl.readyAt
        ? {
            readiness: cl.readyReadiness as ComplianceReadiness,
            at: cl.readyAt.toISOString(),
            by: nm(cl.readyByUserId),
            note: cl.readyNote,
            stillValid:
              READINESS_RANK[rd.readiness] >=
                READINESS_RANK[cl.readyReadiness as ComplianceReadiness] &&
              !cl.provisional,
          }
        : null,
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

  private satisfiedByText(s: RuleSnapshot) {
    const docs = s.documentTypes.map((t) => DOC_LABEL[t] ?? t).join(' / ');
    switch (s.satisfiedBy.kind) {
      case 'registration':
        return `${s.satisfiedBy.type} recorded as available in Organization registrations (with number), or an approved ${docs}.`;
      case 'certification':
        return `A matching active certification in your profile, or an approved ${docs}.`;
      case 'documents':
        return s.satisfiedBy.requiresValidation
          ? `An approved ${docs} for this order (not expired) whose document validation is signed off.`
          : `An approved ${docs} for this order (not expired).`;
      default:
        return docs
          ? `An approved ${docs}, or manual confirmation by a reviewer.`
          : 'Manual confirmation by a reviewer with a note.';
    }
  }

  /** Country/transaction document matrix: what is needed, who provides it, current availability. */
  private documentMatrix(
    reqs: RequirementView[],
    docs: Prisma.TradeDocumentGetPayload<object>[],
    validation: Map<string, { status: string; openIssues: number }>,
  ): ChecklistDocumentRow[] {
    const rows = new Map<string, ChecklistDocumentRow>();
    for (const r of reqs) {
      if (r.applicability === 'NOT_APPLICABLE' || r.status === 'NOT_APPLICABLE')
        continue;
      for (const t of r.documentTypes) {
        if (t === 'REGISTRATION_CERTIFICATE' || t === 'OTHER' || rows.has(t))
          continue;
        const ds = docs.filter((d) => d.documentType === t);
        const best = ds.find((d) => EVIDENCE_OK.includes(d.status)) ?? ds[0];
        const exp = best ? expiryState(best.expiryDate, 0) : null;
        const availability: DocumentAvailability = !best
          ? 'NOT_AVAILABLE'
          : exp === 'EXPIRED'
            ? 'EXPIRED'
            : EVIDENCE_OK.includes(best.status)
              ? 'APPROVED'
              : ['DRAFT', 'GENERATED', 'REJECTED'].includes(best.status)
                ? 'DRAFT'
                : 'AVAILABLE';
        rows.set(t, {
          documentType: t,
          label: DOC_LABEL[t] ?? t,
          level: r.level,
          basis: r.basis,
          responsibleParty: r.responsibleParty,
          generatable: (
            GENERATABLE_DOCUMENT_TYPES as readonly string[]
          ).includes(t),
          availability,
          document: best
            ? {
                id: best.id,
                title: best.title,
                status: best.status as never,
                source: best.source as never,
                version: best.version,
                validationStatus: validation.get(best.id)?.status ?? 'NOT_RUN',
              }
            : null,
        });
      }
    }
    return [...rows.values()];
  }

  // --------------------------------------------------------- endpoints

  async forPo(a: Actor, purchaseOrderId: string) {
    if (
      !(await this.prisma.buyerPurchaseOrder.findFirst({
        where: { id: purchaseOrderId, organizationId: a.organizationId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Purchase order not found.');
    const cl = await this.load(a.organizationId, { purchaseOrderId });
    if (!cl)
      throw new NotFoundException({
        message: 'Compliance has not been evaluated for this order yet.',
        details: { code: 'NOT_EVALUATED' },
      });
    return this.view(a, cl);
  }

  async forQuotation(a: Actor, quotationId: string) {
    const cl = await this.load(a.organizationId, { quotationId });
    if (!cl) {
      if (
        !(await this.prisma.quotation.findFirst({
          where: { id: quotationId, organizationId: a.organizationId },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Quotation not found.');
      throw new NotFoundException({
        message: 'No provisional checklist for this quotation yet.',
        details: { code: 'NOT_EVALUATED' },
      });
    }
    return this.view(a, cl);
  }

  async byId(a: Actor, id: string) {
    const cl = await this.load(a.organizationId, { id });
    if (!cl) throw new NotFoundException('Checklist not found.');
    return this.view(a, cl);
  }

  private async instance(a: Actor, id: string) {
    const inst = await this.prisma.complianceRequirementInstance.findFirst({
      where: { id, organizationId: a.organizationId },
    });
    if (!inst) throw new NotFoundException('Requirement not found.');
    return inst;
  }

  private async afterChange(a: Actor, checklistId: string) {
    return this.view(
      a,
      (await this.load(a.organizationId, { id: checklistId }))!,
    );
  }

  async updateRequirement(a: Actor, id: string, dto: UpdateRequirementDto) {
    const inst = await this.instance(a, id);
    const snap = inst.ruleSnapshot as unknown as RuleSnapshot;
    const data: Prisma.ComplianceRequirementInstanceUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.dueDate !== undefined)
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.evidenceDocumentId !== undefined) {
      if (dto.evidenceDocumentId) {
        const doc = await this.prisma.tradeDocument.findFirst({
          where: {
            id: dto.evidenceDocumentId,
            organizationId: a.organizationId,
          },
        });
        if (!doc) throw new NotFoundException('Document not found.');
        if (!snap.documentTypes.includes(doc.documentType as TradeDocumentType))
          throw new BadRequestException({
            message: `A ${DOC_LABEL[doc.documentType] ?? doc.documentType} cannot satisfy “${snap.name}”. Expected: ${snap.documentTypes.map((t) => DOC_LABEL[t] ?? t).join(' / ')}.`,
            details: { code: 'WRONG_DOCUMENT_TYPE' },
          });
      }
      data.evidenceDocumentId = dto.evidenceDocumentId;
    }
    if (dto.manualConfirmation !== undefined) {
      if (!roleHasPermission(a.role, 'compliance.review'))
        throw new ForbiddenException(
          'Only reviewers can confirm requirements manually.',
        );
      if (snap.satisfiedBy.kind !== 'manual')
        throw new BadRequestException(
          'This requirement is checked automatically from registrations/documents; attach evidence instead of confirming manually.',
        );
      data.manualNote = dto.manualConfirmation?.trim() || null;
      data.manualByUserId = dto.manualConfirmation ? a.userId : null;
      data.manualAt = dto.manualConfirmation ? new Date() : null;
    }
    await this.prisma.complianceRequirementInstance.update({
      where: { id },
      data,
    });
    await this.core.event(this.prisma, a, {
      entityType: 'COMPLIANCE',
      entityId: id,
      lineageId: inst.checklistId,
      type: 'REQUIREMENT_UPDATED',
      title: dto.evidenceDocumentId
        ? `Evidence linked to “${snap.name}”`
        : dto.manualConfirmation
          ? `“${snap.name}” confirmed manually`
          : `“${snap.name}” updated`,
    });
    if (dto.manualConfirmation || dto.evidenceDocumentId)
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'compliance.evidence_updated',
        entityType: 'ComplianceRequirementInstance',
        entityId: id,
        metadata: {
          requirement: inst.ruleCode,
          evidenceDocumentId: dto.evidenceDocumentId ?? null,
          manual: Boolean(dto.manualConfirmation),
        },
      });
    return this.afterChange(a, inst.checklistId);
  }

  async override(a: Actor, id: string, dto: OverrideDto) {
    const inst = await this.instance(a, id);
    const snap = inst.ruleSnapshot as unknown as RuleSnapshot;
    await this.prisma.complianceRequirementInstance.update({
      where: { id },
      data: {
        overrideKind: dto.kind,
        overrideReason: dto.reason.trim(),
        overriddenByUserId: a.userId,
        overriddenAt: new Date(),
      },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'COMPLIANCE',
      entityId: id,
      lineageId: inst.checklistId,
      type: 'OVERRIDE',
      title: `“${snap.name}” marked ${dto.kind.replace('_', ' ').toLowerCase()}`,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'compliance.override',
      entityType: 'ComplianceRequirementInstance',
      entityId: id,
      metadata: {
        requirement: inst.ruleCode,
        kind: dto.kind,
        reason: dto.reason.trim().slice(0, 300),
      },
    });
    return this.afterChange(a, inst.checklistId);
  }

  async clearOverride(a: Actor, id: string) {
    const inst = await this.instance(a, id);
    await this.prisma.complianceRequirementInstance.update({
      where: { id },
      data: {
        overrideKind: null,
        overrideReason: null,
        overriddenByUserId: null,
        overriddenAt: null,
        status: 'NOT_STARTED',
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'compliance.override_cleared',
      entityType: 'ComplianceRequirementInstance',
      entityId: id,
      metadata: { requirement: inst.ruleCode },
    });
    return this.afterChange(a, inst.checklistId);
  }

  /** USER_DEFINED requirement: organization/transaction specific, never presented as official. */
  async addRequirement(a: Actor, checklistId: string, dto: AddRequirementDto) {
    const cl = await this.load(a.organizationId, { id: checklistId });
    if (!cl) throw new NotFoundException('Checklist not found.');
    const code = `USER.${randomUUID().slice(0, 8).toUpperCase()}`;
    const snap: RuleSnapshot = {
      name: dto.name.trim(),
      description: dto.description?.trim() || 'Added by your team.',
      requirementType: dto.requirementType,
      level: dto.level,
      severity: dto.severity,
      basis: dto.basis ?? 'USER_DEFINED',
      jurisdiction: 'TRANSACTION',
      responsibleParty: dto.responsibleParty ?? 'EXPORTER',
      satisfiedBy: dto.documentTypes?.length
        ? {
            kind: 'documents',
            requiresValidation: Boolean(dto.requiresValidation),
          }
        : { kind: 'manual' },
      documentTypes: (dto.documentTypes ?? []) as TradeDocumentType[],
      provenance: {
        sourceType: 'USER_DEFINED',
        sourceName: 'Added by your organization (not an official source)',
        sourceUrl: null,
        sourceDate: day(new Date()),
        lastCheckedAt: null,
        effectiveFrom: null,
        effectiveTo: null,
        confidence: 'MEDIUM',
      },
    };
    const inst = await this.prisma.complianceRequirementInstance.create({
      data: {
        organizationId: a.organizationId,
        checklistId,
        ruleCode: code,
        ruleVersion: 1,
        ruleSnapshot: snap as unknown as Prisma.InputJsonValue,
        applicability: 'APPLICABLE',
        status: 'NOT_STARTED',
        explanation:
          dto.basis === 'BUYER_REQUESTED'
            ? 'Added by your team as a buyer request for this order.'
            : 'Added manually by your team for this order (user-defined, not an official rule).',
        notes: dto.notes?.trim() || null,
        sortOrder: 1000,
      },
    });
    await this.core.event(this.prisma, a, {
      entityType: 'COMPLIANCE',
      entityId: inst.id,
      lineageId: checklistId,
      type: 'MANUAL_REQUIREMENT',
      title: `Requirement added: ${snap.name}`,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'compliance.requirement_added',
      entityType: 'ComplianceRequirementInstance',
      entityId: inst.id,
      metadata: { name: snap.name, level: snap.level, severity: snap.severity },
    });
    return this.afterChange(a, checklistId);
  }

  /** Human confirmation. Stores rule versions, statuses and document refs; never creates a shipment. */
  async markReady(a: Actor, purchaseOrderId: string, dto: MarkReadyDto) {
    const cl = await this.load(a.organizationId, { purchaseOrderId });
    if (!cl)
      throw new NotFoundException({
        message: 'Evaluate compliance first.',
        details: { code: 'NOT_EVALUATED' },
      });
    if (
      dto.expectedRowVersion !== undefined &&
      dto.expectedRowVersion !== cl.rowVersion
    )
      throw CommercialCoreService.conflict();
    const v = await this.view(a, cl);
    if (cl.provisional)
      throw new ConflictException(
        'The buyer PO must be accepted before compliance can be marked ready.',
      );
    if (v.readiness === 'BLOCKED' || v.readiness === 'NOT_READY')
      throw new ConflictException({
        message: `Compliance is ${v.readiness.toLowerCase().replace('_', ' ')}: ${v.blockers.map((b) => b.name).join(', ') || v.readinessReasons.join(', ')}.`,
        details: { code: 'NOT_READY', blockers: v.blockers },
      });
    if (v.readiness === 'READY_WITH_WARNINGS' && !dto.note?.trim())
      throw new BadRequestException({
        message: 'Open warnings remain — add a note acknowledging them.',
        details: { code: 'NOTE_REQUIRED' },
      });
    const snapshot = {
      readiness: v.readiness,
      coverage: v.coverage,
      at: new Date().toISOString(),
      requirements: v.requirements.map((r) => ({
        code: r.ruleCode,
        version: r.ruleVersion,
        status: r.status,
        applicability: r.applicability,
        override: r.override?.kind ?? null,
        documents: r.evidence
          .filter((e) => e.kind === 'DOCUMENT')
          .map((e) => e.id),
      })),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.complianceChecklist.update({
        where: { id: cl.id },
        data: {
          readyReadiness: v.readiness,
          readyAt: new Date(),
          readyByUserId: a.userId,
          readyNote: dto.note?.trim() || null,
          readySnapshot: snapshot as unknown as Prisma.InputJsonValue,
          rowVersion: { increment: 1 },
        },
      });
      await this.core.event(tx, a, {
        entityType: 'COMPLIANCE',
        entityId: cl.id,
        lineageId: cl.id,
        type: 'READY',
        title: `Compliance marked ${v.readiness === 'READY' ? 'ready' : 'ready with warnings'} for logistics`,
      });
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'compliance.ready',
      entityType: 'ComplianceChecklist',
      entityId: cl.id,
      metadata: {
        purchaseOrderId,
        readiness: v.readiness,
        requirements: snapshot.requirements.length,
      },
    });
    return this.afterChange(a, cl.id);
  }

  async list(
    a: Actor,
    q: { purchaseOrderId?: string; quotationId?: string; readiness?: string },
  ): Promise<ChecklistSummary[]> {
    const rows = await this.prisma.complianceChecklist.findMany({
      where: {
        organizationId: a.organizationId,
        ...(q.purchaseOrderId ? { purchaseOrderId: q.purchaseOrderId } : {}),
        ...(q.quotationId ? { quotationId: q.quotationId } : {}),
      },
      include: { requirements: { orderBy: [{ sortOrder: 'asc' }] } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const out: ChecklistSummary[] = [];
    for (const cl of rows) {
      const { rd } = await this.refresh(a.organizationId, cl);
      if (q.readiness && rd.readiness !== q.readiness) continue;
      out.push(await this.summary(a, cl, rd));
    }
    return out;
  }

  private async summary(
    a: Actor,
    cl: Checklist,
    rd: ReturnType<typeof computeReadiness>,
  ): Promise<ChecklistSummary> {
    const ctx = cl.context as unknown as {
      buyer?: { name: string };
      destinationCountry?: string | null;
      quotationId?: string | null;
    };
    const po = cl.purchaseOrderId
      ? await this.prisma.buyerPurchaseOrder.findFirst({
          where: { id: cl.purchaseOrderId, organizationId: a.organizationId },
          select: { id: true, poNumber: true },
        })
      : null;
    const q =
      (cl.quotationId ?? ctx.quotationId)
        ? await this.prisma.quotation.findFirst({
            where: {
              id: (cl.quotationId ?? ctx.quotationId)!,
              organizationId: a.organizationId,
            },
            select: { id: true, quotationNumber: true, revision: true },
          })
        : null;
    return {
      id: cl.id,
      provisional: cl.provisional,
      purchaseOrder: po,
      quotation: q
        ? {
            id: q.id,
            displayNumber: `${q.quotationNumber}${q.revision > 1 ? ` Rev ${q.revision}` : ''}`,
          }
        : null,
      buyerName: ctx.buyer?.name ?? 'Buyer',
      destinationCountry: ctx.destinationCountry ?? null,
      readiness: rd.readiness,
      coverage: (cl.coverage as unknown as CoverageView)?.overall ?? 'UNKNOWN',
      blockers: rd.blockers.length,
      warnings: rd.warnings.length,
      readyConfirmed: Boolean(cl.readyAt),
      evaluatedAt: cl.evaluatedAt.toISOString(),
    };
  }

  async overview(a: Actor): Promise<ComplianceOverview> {
    const org = a.organizationId;
    const rows = await this.prisma.complianceChecklist.findMany({
      where: { organizationId: org },
      include: { requirements: { orderBy: [{ sortOrder: 'asc' }] } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    const counts: Record<ComplianceReadiness, number> = {
      NOT_READY: 0,
      BLOCKED: 0,
      READY_WITH_WARNINGS: 0,
      READY: 0,
    };
    const topBlockers: ComplianceOverview['topBlockers'] = [];
    const checklists: ChecklistSummary[] = [];
    for (const cl of rows) {
      const { rd } = await this.refresh(org, cl);
      counts[rd.readiness]++;
      const s = await this.summary(a, cl, rd);
      checklists.push(s);
      for (const b of rd.blockers)
        if (topBlockers.length < 10)
          topBlockers.push({
            checklistId: cl.id,
            label: s.purchaseOrder
              ? `PO ${s.purchaseOrder.poNumber}`
              : (s.quotation?.displayNumber ?? 'Checklist'),
            name: b.name,
            reason: b.reason,
          });
    }
    const evaluatedPos = rows
      .map((r) => r.purchaseOrderId)
      .filter(Boolean) as string[];
    const pending = await this.prisma.buyerPurchaseOrder.findMany({
      where: {
        organizationId: org,
        status: 'ACCEPTED',
        id: { notIn: evaluatedPos },
      },
      select: { id: true, poNumber: true, buyerCompanyId: true },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    });
    const buyers = await this.prisma.buyerCompany.findMany({
      where: { id: { in: pending.map((p) => p.buyerCompanyId) } },
      select: { id: true, canonicalName: true },
    });
    const bn = new Map(buyers.map((b) => [b.id, b.canonicalName]));
    const warnDays = await this.warnDays(org);
    const [regs, certs] = await Promise.all([
      this.prisma.registration.findMany({
        where: { organizationId: org },
        include: { _count: { select: { documents: true } } },
      }),
      this.prisma.certification.findMany({
        where: { organizationId: org },
        include: { _count: { select: { documents: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const types = ['IEC', 'GST', 'FSSAI', 'APEDA'] as const;
    const soon = new Date(today().getTime() + warnDays * 86400000);
    const [expiring, expired] = await Promise.all([
      this.prisma.tradeDocument.count({
        where: {
          organizationId: org,
          status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
          expiryDate: { gte: today(), lte: soon },
        },
      }),
      this.prisma.tradeDocument.count({
        where: {
          organizationId: org,
          status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
          expiryDate: { lt: today() },
        },
      }),
    ]);
    return {
      counts,
      acceptedPosWithoutChecklist: pending.map((p) => ({
        id: p.id,
        poNumber: p.poNumber,
        buyerName: bn.get(p.buyerCompanyId) ?? 'Buyer',
      })),
      topBlockers,
      registrations: types.map((t) => {
        const r = regs.find((x) => x.type === t);
        return {
          type: t,
          status: r?.status ?? 'NOT_SURE',
          number: r?.number ?? null,
          verificationStatus: r?.verificationStatus ?? 'NOT_PROVIDED',
          verificationNote:
            VERIFICATION_NOTE[r?.verificationStatus ?? 'NOT_PROVIDED'],
          expiryDate: day(r?.expiryDate),
          expiry: expiryState(r?.expiryDate ?? null, warnDays),
          hasEvidence: (r?._count.documents ?? 0) > 0,
        };
      }),
      certifications: certs.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        number: c.number,
        issuer: c.issuer,
        status: c.status,
        verificationStatus: c.verificationStatus,
        expiryDate: day(c.expiryDate),
        expiry: expiryState(c.expiryDate, warnDays),
        hasEvidence: c._count.documents > 0,
      })),
      expiringDocuments: expiring,
      expiredDocuments: expired,
      checklists,
    };
  }

  async rules(a: Actor): Promise<ComplianceRuleView[]> {
    const rows = await this.prisma.complianceRule.findMany({
      where: {
        OR: [{ organizationId: null }, { organizationId: a.organizationId }],
      },
      orderBy: [{ jurisdiction: 'asc' }, { code: 'asc' }, { version: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      version: r.version,
      name: r.name,
      description: r.description,
      requirementType:
        r.requirementType as ComplianceRuleView['requirementType'],
      level: r.level as ComplianceRuleView['level'],
      severity: r.severity as ComplianceRuleView['severity'],
      basis: r.basis as ComplianceRuleView['basis'],
      jurisdiction: r.jurisdiction as ComplianceRuleView['jurisdiction'],
      countryCode: r.countryCode,
      hsPrefixes: r.hsPrefixes,
      productCategory: r.productCategory,
      responsibleParty:
        r.responsibleParty as ComplianceRuleView['responsibleParty'],
      satisfiedBy: this.satisfiedByText({
        satisfiedBy: r.satisfiedBy,
        documentTypes: r.documentTypes,
      } as unknown as RuleSnapshot),
      documentTypes: r.documentTypes as TradeDocumentType[],
      provenance: {
        sourceType: r.sourceType as RuleProvenance['sourceType'],
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        sourceDate: day(r.sourceDate),
        lastCheckedAt: day(r.lastCheckedAt),
        effectiveFrom: day(r.effectiveFrom),
        effectiveTo: day(r.effectiveTo),
        confidence: r.confidence as RuleProvenance['confidence'],
        stale: isStale(r.lastCheckedAt),
      },
      organizationSpecific: Boolean(r.organizationId),
      active: r.active,
    }));
  }

  /** Compact status for the PO page. */
  async poStatus(organizationId: string, purchaseOrderId: string) {
    return this.prisma.complianceChecklist.findFirst({
      where: { organizationId, purchaseOrderId },
      select: { id: true, readiness: true, readyAt: true },
    });
  }
}
