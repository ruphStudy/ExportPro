import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipRole, Prisma } from '@prisma/client';
import {
  COST_CATEGORY_LABELS,
  COSTING_FORMULA_VERSION,
  type ComparisonObjective,
  type CostCategory,
  type CostingLineItem,
  type CostingListResponse,
  type CostingResult,
  type CostingScenario,
  type ExportCostingDetail,
  type ExportCostingSummary,
  type FxRateSnapshot,
  INCOTERM_ORDER,
  isCostingCurrency,
  isValidCountryCode,
  LOGISTICS_COST_CATEGORIES,
  roleHasPermission,
  type ScenarioComparison,
  type ScenarioComparisonRow,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { AuditService } from '../audit/audit.service';
import {
  calculate,
  type CalcInput,
  compareIncoterms,
  D,
  fxSensitivity,
  money,
  pct,
  perUnit,
} from './costing-calculator';
import { INCOTERM_POLICIES } from './incoterm-policy';
import type {
  CompareDto,
  CostingListQueryDto,
  CreateCostingDto,
  CreateLineDto,
  CreateScenarioDto,
  LineDto,
  ManualFxDto,
  ScenarioDto,
  UpdateCostingDto,
} from './costing.dto';

export interface Actor {
  organizationId: string;
  userId: string;
  role: MembershipRole;
}

const scenarioInclude = {
  lines: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  fx: { include: { snapshot: true } },
} satisfies Prisma.CostingScenarioInclude;
const detailInclude = {
  scenarios: {
    orderBy: [{ isBase: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: scenarioInclude,
  },
  snapshots: { orderBy: { createdAt: 'desc' } },
  product: true,
  buyerCompany: true,
  crmLead: true,
} satisfies Prisma.ExportCostingInclude;
type CostingRow = Prisma.ExportCostingGetPayload<{
  include: typeof detailInclude;
}>;
type ScenarioRow = Prisma.CostingScenarioGetPayload<{
  include: typeof scenarioInclude;
}>;

const s = (d: Prisma.Decimal | null | undefined) =>
  d === null || d === undefined ? null : d.toString();
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const MAX_SCENARIOS = 10;

/** Copyable scenario inputs (no ids, results or timestamps). */
function scenarioFields(sc: ScenarioRow) {
  return {
    name: sc.name,
    isBase: sc.isBase,
    sortOrder: sc.sortOrder,
    quantity: sc.quantity,
    quantityUnit: sc.quantityUnit,
    netWeightKg: sc.netWeightKg,
    cartonCount: sc.cartonCount,
    containerCount: sc.containerCount,
    incoterm: sc.incoterm,
    incotermPlace: sc.incotermPlace,
    originPort: sc.originPort,
    destinationPort: sc.destinationPort,
    transportMode: sc.transportMode,
    supplierLabel: sc.supplierLabel,
    pricingMode: sc.pricingMode,
    pricingValue: sc.pricingValue,
    buyerTargetPrice: sc.buyerTargetPrice,
    notes: sc.notes,
  };
}

/** Copyable cost-line inputs. */
function lineFields(l: ScenarioRow['lines'][number]) {
  return {
    category: l.category,
    label: l.label,
    amount: l.amount,
    currency: l.currency,
    basis: l.basis,
    percentageBase: l.percentageBase,
    wastagePercent: l.wastagePercent,
    sourceType: l.sourceType,
    confidence: l.confidence,
    freightQuoteType: l.freightQuoteType,
    quoteReference: l.quoteReference,
    carrier: l.carrier,
    transitDays: l.transitDays,
    quoteDate: l.quoteDate,
    validUntil: l.validUntil,
    routeNotes: l.routeNotes,
    notes: l.notes,
    includeOverride: l.includeOverride,
    sortOrder: l.sortOrder,
  };
}

@Injectable()
export class CostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- helpers

  private async load(organizationId: string, id: string): Promise<CostingRow> {
    const c = await this.prisma.exportCosting.findFirst({
      where: { id, organizationId },
      include: detailInclude,
    });
    if (!c) throw new NotFoundException('Costing not found.');
    return c;
  }

  private assertEditable(c: { status: string }) {
    if (c.status === 'LOCKED')
      throw new ConflictException(
        'This costing is locked. Create a revision to change it.',
      );
    if (c.status === 'ARCHIVED')
      throw new ConflictException(
        'This costing is archived. Restore it first.',
      );
  }

  private assertCurrency(code: string | undefined, field: string) {
    if (code !== undefined && !isCostingCurrency(code))
      throw new BadRequestException(`${field}: unsupported currency ${code}.`);
  }

  /** Optimistic concurrency + "edits move a READY costing back to DRAFT" (its READY snapshot is kept). */
  private async touch(
    tx: Prisma.TransactionClient,
    c: { id: string; organizationId: string; status: string },
    actor: Actor,
    expected?: number,
  ) {
    const res = await tx.exportCosting.updateMany({
      where: {
        id: c.id,
        organizationId: c.organizationId,
        ...(expected !== undefined ? { rowVersion: expected } : {}),
      },
      data: {
        rowVersion: { increment: 1 },
        updatedByUserId: actor.userId,
        ...(c.status === 'READY' ? { status: 'DRAFT', readyAt: null } : {}),
      },
    });
    if (!res.count)
      throw new ConflictException(
        'This costing was changed by someone else. Reload and try again.',
      );
  }

  calcInput(
    c: Pick<
      CostingRow,
      'calculationCurrency' | 'quoteCurrency' | 'thinMarginPercent'
    >,
    sc: ScenarioRow,
  ): CalcInput {
    return {
      calculationCurrency: c.calculationCurrency,
      quoteCurrency: c.quoteCurrency,
      thinMarginPercent: c.thinMarginPercent.toString(),
      quantity: sc.quantity.toString(),
      quantityUnit: sc.quantityUnit,
      netWeightKg: s(sc.netWeightKg),
      cartonCount: s(sc.cartonCount),
      containerCount: s(sc.containerCount),
      incoterm: sc.incoterm,
      pricingMode: sc.pricingMode,
      pricingValue: s(sc.pricingValue),
      buyerTargetPrice: s(sc.buyerTargetPrice),
      lines: sc.lines.map((l) => ({
        id: l.id,
        category: l.category,
        label: l.label,
        amount: s(l.amount),
        currency: l.currency,
        basis: l.basis,
        percentageBase: l.percentageBase,
        wastagePercent: s(l.wastagePercent),
        sourceType: l.sourceType,
        confidence: l.confidence,
        validUntil: l.validUntil,
        includeOverride: l.includeOverride,
      })),
      fx: sc.fx.map((f) => ({
        currency: f.currency,
        snapshotId: f.snapshotId,
        baseCurrency: f.snapshot.baseCurrency,
        quoteCurrency: f.snapshot.quoteCurrency,
        rate: f.snapshot.rate.toString(),
        sourceType: f.snapshot.sourceType,
        sourceDate: f.snapshot.sourceDate,
      })),
    };
  }

  /** Recomputes and caches results for the given scenarios (all when omitted). Backend is the only calculator. */
  private async recalc(
    organizationId: string,
    costingId: string,
    scenarioIds?: string[],
  ) {
    const c = await this.load(organizationId, costingId);
    for (const sc of c.scenarios.filter(
      (x) => !scenarioIds || scenarioIds.includes(x.id),
    )) {
      const r = calculate(this.calcInput(c, sc));
      await this.prisma.costingScenario.update({
        where: { id: sc.id },
        data: {
          result: r as unknown as Prisma.InputJsonValue,
          calculatedAt: new Date(r.calculatedAt),
        },
      });
    }
  }

  private async resolveRefs(
    organizationId: string,
    d: {
      productId?: string | null;
      buyerCompanyId?: string | null;
      crmLeadId?: string | null;
    },
  ) {
    const product = d.productId
      ? await this.prisma.organizationProduct.findFirst({
          where: { id: d.productId, organizationId },
        })
      : null;
    if (d.productId && !product)
      throw new NotFoundException('Product not found.');
    const buyer = d.buyerCompanyId
      ? await this.prisma.buyerCompany.findFirst({
          where: {
            id: d.buyerCompanyId,
            OR: [
              { ownerOrganizationId: null },
              { ownerOrganizationId: organizationId },
            ],
          },
        })
      : null;
    if (d.buyerCompanyId && !buyer)
      throw new NotFoundException('Buyer not found.');
    const lead = d.crmLeadId
      ? await this.prisma.buyerLead.findFirst({
          where: { id: d.crmLeadId, organizationId },
        })
      : null;
    if (d.crmLeadId && !lead)
      throw new NotFoundException('CRM lead not found.');
    return { product, buyer, lead };
  }

  // ------------------------------------------------------------- mapping

  private line(l: ScenarioRow['lines'][number]): CostingLineItem {
    return {
      id: l.id,
      scenarioId: l.scenarioId,
      category: l.category,
      label: l.label,
      amount: s(l.amount),
      currency: l.currency,
      basis: l.basis,
      percentageBase: l.percentageBase,
      wastagePercent: s(l.wastagePercent),
      sourceType: l.sourceType,
      confidence: l.confidence,
      freightQuoteType: l.freightQuoteType,
      quoteReference: l.quoteReference,
      carrier: l.carrier,
      transitDays: l.transitDays,
      quoteDate: iso(l.quoteDate),
      validUntil: iso(l.validUntil),
      routeNotes: l.routeNotes,
      notes: l.notes,
      includeOverride: l.includeOverride,
      sortOrder: l.sortOrder,
    };
  }

  fxView(
    f: Prisma.FxRateSnapshotGetPayload<object>,
    names?: Map<string, string>,
  ): FxRateSnapshot {
    return {
      id: f.id,
      baseCurrency: f.baseCurrency,
      quoteCurrency: f.quoteCurrency,
      rate: f.rate.toString(),
      sourceType: f.sourceType,
      sourceLabel: f.sourceLabel,
      sourceDate: f.sourceDate.toISOString().slice(0, 10),
      capturedAt: f.capturedAt.toISOString(),
      isManual: f.isManual,
      createdBy: f.createdByUserId
        ? (names?.get(f.createdByUserId) ?? null)
        : null,
    };
  }

  private scenario(sc: ScenarioRow): CostingScenario {
    return {
      id: sc.id,
      costingId: sc.costingId,
      name: sc.name,
      isBase: sc.isBase,
      sortOrder: sc.sortOrder,
      quantity: sc.quantity.toString(),
      quantityUnit: sc.quantityUnit,
      netWeightKg: s(sc.netWeightKg),
      cartonCount: s(sc.cartonCount),
      containerCount: s(sc.containerCount),
      incoterm: sc.incoterm,
      incotermPlace: sc.incotermPlace,
      originPort: sc.originPort,
      destinationPort: sc.destinationPort,
      transportMode: sc.transportMode,
      supplierLabel: sc.supplierLabel,
      pricingMode: sc.pricingMode,
      pricingValue: s(sc.pricingValue),
      buyerTargetPrice: s(sc.buyerTargetPrice),
      notes: sc.notes,
      fx: sc.fx.map((f) => ({
        currency: f.currency,
        snapshot: this.fxView(f.snapshot),
      })),
      lines: sc.lines.map((l) => this.line(l)),
      result: (sc.result as unknown as CostingResult | null) ?? null,
      calculatedAt: iso(sc.calculatedAt),
      updatedAt: sc.updatedAt.toISOString(),
    };
  }

  private async userNames(ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    const users = uniq.length
      ? await this.prisma.user.findMany({
          where: { id: { in: uniq } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    return new Map(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
    );
  }

  private summary(
    c: Prisma.ExportCostingGetPayload<{
      include: { scenarios: true; product: true; buyerCompany: true };
    }>,
    names: Map<string, string>,
  ): ExportCostingSummary {
    const b = c.scenarios.find((x) => x.isBase);
    const r = (b?.result as unknown as CostingResult | null) ?? null;
    return {
      id: c.id,
      reference: c.reference,
      name: c.name,
      status: c.status,
      version: c.version,
      productId: c.productId,
      productName: c.product?.displayName ?? null,
      buyerCompanyId: c.buyerCompanyId,
      buyerName: c.buyerCompany?.canonicalName ?? null,
      crmLeadId: c.crmLeadId,
      destinationCountryCode: c.destinationCountryCode,
      calculationCurrency: c.calculationCurrency,
      quoteCurrency: c.quoteCurrency,
      base: b
        ? {
            quantity: b.quantity.toString(),
            quantityUnit: b.quantityUnit,
            incoterm: b.incoterm,
            incotermPlace: b.incotermPlace,
            totalCost: r?.totalCost ?? null,
            sellingPricePerUnit: r?.pricing?.sellingPricePerUnit ?? null,
            marginPercent: r?.pricing?.marginPercent ?? null,
            feasibility: r?.pricing?.feasibility ?? null,
            complete: r?.complete ?? false,
          }
        : null,
      createdBy: names.get(c.createdByUserId) ?? null,
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private readiness(c: CostingRow) {
    const problems: string[] = [];
    if (!c.productId) problems.push('Link a saved product.');
    const base = c.scenarios.find((x) => x.isBase);
    if (!base) problems.push('Base scenario missing.');
    else {
      const r = calculate(this.calcInput(c, base));
      for (const i of r.issues.filter((x) => x.blocking))
        problems.push(i.message);
    }
    return { ready: problems.length === 0, problems };
  }

  // --------------------------------------------------------------- reads

  async list(
    organizationId: string,
    q: CostingListQueryDto,
  ): Promise<CostingListResponse> {
    const where: Prisma.ExportCostingWhereInput = { organizationId };
    const and: Prisma.ExportCostingWhereInput[] = [];
    if (q.status) where.status = q.status;
    else where.status = { not: 'ARCHIVED' };
    if (q.productId) where.productId = q.productId;
    if (q.buyerCompanyId) where.buyerCompanyId = q.buyerCompanyId;
    if (q.crmLeadId) where.crmLeadId = q.crmLeadId;
    if (q.country) where.destinationCountryCode = q.country;
    if (q.createdBy) where.createdByUserId = q.createdBy;
    if (q.incoterm)
      and.push({ scenarios: { some: { isBase: true, incoterm: q.incoterm } } });
    if (q.from || q.to)
      where.updatedAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    if (q.search?.trim()) {
      const t = q.search.trim();
      and.push({
        OR: [
          { reference: { contains: t, mode: 'insensitive' } },
          { name: { contains: t, mode: 'insensitive' } },
          { product: { displayName: { contains: t, mode: 'insensitive' } } },
          {
            buyerCompany: {
              canonicalName: { contains: t, mode: 'insensitive' },
            },
          },
        ],
      });
    }
    if (and.length) where.AND = and;
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const [total, rows] = await Promise.all([
      this.prisma.exportCosting.count({ where }),
      this.prisma.exportCosting.findMany({
        where,
        include: {
          scenarios: { where: { isBase: true } },
          product: true,
          buyerCompany: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const names = await this.userNames(rows.map((r) => r.createdByUserId));
    return {
      items: rows.map((r) => this.summary(r, names)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async detail(
    organizationId: string,
    id: string,
  ): Promise<ExportCostingDetail> {
    const c = await this.load(organizationId, id);
    const [names, revisions] = await Promise.all([
      this.userNames([
        c.createdByUserId,
        ...c.snapshots.map((x) => x.createdByUserId),
      ]),
      this.prisma.exportCosting.findMany({
        where: { organizationId, rootId: c.rootId ?? c.id },
        select: { id: true, version: true, status: true, reference: true },
        orderBy: { version: 'asc' },
      }),
    ]);
    const base = this.summary({ ...c, scenarios: c.scenarios }, names);
    const risk =
      (c.buyerCompany?.profile as { risk?: { level?: string } } | null)?.risk
        ?.level ?? null;
    return {
      ...base,
      notes: c.notes,
      thinMarginPercent: c.thinMarginPercent.toString(),
      rowVersion: c.rowVersion,
      revisionOfId: c.revisionOfId,
      rootId: c.rootId ?? c.id,
      readyAt: iso(c.readyAt),
      lockedAt: iso(c.lockedAt),
      archivedAt: iso(c.archivedAt),
      scenarios: c.scenarios.map((x) => this.scenario(x)),
      snapshots: c.snapshots.map((x) => ({
        id: x.id,
        kind: x.kind,
        formulaVersion: x.formulaVersion,
        createdAt: x.createdAt.toISOString(),
        createdBy: x.createdByUserId
          ? (names.get(x.createdByUserId) ?? null)
          : null,
      })),
      revisions,
      policies: INCOTERM_ORDER.map((t) => INCOTERM_POLICIES[t]),
      readiness: this.readiness(c),
      context: {
        productHsCode: c.product?.itcHsCode ?? c.product?.hsCode ?? null,
        // Sprint 10 buyer risk, reused as-is (never recalculated here).
        buyerRiskLevel: risk,
        leadStage: c.crmLead?.stage ?? null,
      },
    };
  }

  async snapshot(organizationId: string, id: string, snapshotId: string) {
    await this.load(organizationId, id);
    const snap = await this.prisma.costingSnapshot.findFirst({
      where: { id: snapshotId, costingId: id },
    });
    if (!snap) throw new NotFoundException('Snapshot not found.');
    return {
      id: snap.id,
      kind: snap.kind,
      formulaVersion: snap.formulaVersion,
      createdAt: snap.createdAt.toISOString(),
      inputs: snap.inputs,
      results: snap.results,
    };
  }

  async analysis(
    organizationId: string,
    id: string,
    scenarioId: string,
    shifts?: string,
  ) {
    const c = await this.load(organizationId, id);
    const sc = c.scenarios.find((x) => x.id === scenarioId);
    if (!sc) throw new NotFoundException('Scenario not found.');
    const input = this.calcInput(c, sc);
    const sh = shifts ? shifts.split(',').map(Number) : undefined;
    return {
      incoterms: compareIncoterms(input),
      fxSensitivity: fxSensitivity(input, sh),
      disclaimerVersion: COSTING_FORMULA_VERSION,
    };
  }

  // ------------------------------------------------------------ costing

  async create(a: Actor, dto: CreateCostingDto) {
    this.assertCurrency(dto.calculationCurrency, 'Calculation currency');
    this.assertCurrency(dto.quoteCurrency, 'Quote currency');
    if (
      dto.destinationCountryCode &&
      !isValidCountryCode(dto.destinationCountryCode)
    )
      throw new BadRequestException('Unsupported country.');
    if (!new D(dto.quantity).gt(0))
      throw new BadRequestException('Quantity must be greater than zero.');
    const { lead } = await this.resolveRefs(a.organizationId, dto);
    // Prefill from the CRM lead without overriding explicit input.
    const productId = dto.productId ?? lead?.productId ?? null;
    const buyerCompanyId = dto.buyerCompanyId ?? lead?.buyerCompanyId ?? null;
    const { product, buyer } = await this.resolveRefs(a.organizationId, {
      productId,
      buyerCompanyId,
    });
    const country = dto.destinationCountryCode ?? lead?.countryCode ?? null;
    const calcCur = dto.calculationCurrency ?? 'INR';
    const quoteCur =
      dto.quoteCurrency ??
      (lead?.currency && isCostingCurrency(lead.currency)
        ? lead.currency
        : 'USD');
    const name =
      dto.name?.trim() ||
      `${product?.displayName ?? buyer?.canonicalName ?? 'Export costing'}${country ? ` → ${country}` : ''}`;
    let created: { id: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const n =
        (await this.prisma.exportCosting.count({
          where: { organizationId: a.organizationId, revisionOfId: null },
        })) +
        1 +
        attempt;
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const c = await tx.exportCosting.create({
            data: {
              organizationId: a.organizationId,
              reference: `CST-${String(n).padStart(4, '0')}`,
              name,
              productId,
              buyerCompanyId,
              crmLeadId: dto.crmLeadId ?? null,
              destinationCountryCode: country,
              calculationCurrency: calcCur,
              quoteCurrency: quoteCur,
              createdByUserId: a.userId,
              updatedByUserId: a.userId,
            },
          });
          await tx.exportCosting.update({
            where: { id: c.id },
            data: { rootId: c.id },
          });
          await tx.costingScenario.create({
            data: {
              costingId: c.id,
              name: 'Base',
              isBase: true,
              quantity: dto.quantity,
              quantityUnit: dto.quantityUnit,
              incoterm: dto.incoterm ?? 'FOB',
              incotermPlace: dto.incotermPlace ?? null,
              // Placeholder only: amount stays NOT PROVIDED until the user enters a supplier rate.
              lines: {
                create: {
                  category: 'PROCUREMENT',
                  label: 'Product cost',
                  amount: null,
                  currency: calcCur,
                  basis:
                    dto.quantityUnit === 'KG' || dto.quantityUnit === 'MT'
                      ? 'PER_KG'
                      : 'PER_UNIT',
                  confidence: 'UNKNOWN',
                },
              },
            },
          });
          return c;
        });
      } catch (e) {
        if (!(
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ))
          throw e;
      }
    }
    if (!created)
      throw new ConflictException(
        'Could not allocate a costing reference. Try again.',
      );
    await this.recalc(a.organizationId, created.id);
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.created',
      entityType: 'ExportCosting',
      entityId: created.id,
      metadata: { productId, buyerCompanyId, crmLeadId: dto.crmLeadId ?? null },
    });
    return this.detail(a.organizationId, created.id);
  }

  async update(a: Actor, id: string, dto: UpdateCostingDto) {
    const c = await this.load(a.organizationId, id);
    this.assertEditable(c);
    this.assertCurrency(dto.calculationCurrency, 'Calculation currency');
    this.assertCurrency(dto.quoteCurrency, 'Quote currency');
    if (
      dto.destinationCountryCode &&
      !isValidCountryCode(dto.destinationCountryCode)
    )
      throw new BadRequestException('Unsupported country.');
    await this.resolveRefs(a.organizationId, {
      productId: dto.productId ?? undefined,
      buyerCompanyId: dto.buyerCompanyId ?? undefined,
      crmLeadId: dto.crmLeadId ?? undefined,
    });
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, c, a, dto.expectedRowVersion);
      await tx.exportCosting.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.notes !== undefined
            ? { notes: dto.notes.trim() || null }
            : {}),
          ...(dto.destinationCountryCode !== undefined
            ? { destinationCountryCode: dto.destinationCountryCode }
            : {}),
          ...(dto.calculationCurrency !== undefined
            ? { calculationCurrency: dto.calculationCurrency }
            : {}),
          ...(dto.quoteCurrency !== undefined
            ? { quoteCurrency: dto.quoteCurrency }
            : {}),
          ...(dto.thinMarginPercent !== undefined
            ? { thinMarginPercent: dto.thinMarginPercent }
            : {}),
          ...(dto.productId !== undefined ? { productId: dto.productId } : {}),
          ...(dto.buyerCompanyId !== undefined
            ? { buyerCompanyId: dto.buyerCompanyId }
            : {}),
          ...(dto.crmLeadId !== undefined ? { crmLeadId: dto.crmLeadId } : {}),
        },
      });
    });
    await this.recalc(a.organizationId, id);
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.updated',
      entityType: 'ExportCosting',
      entityId: id,
      metadata: {
        fields: Object.keys(dto).filter(
          (k) => k !== 'expectedRowVersion' && k !== 'notes',
        ),
      },
    });
    return this.detail(a.organizationId, id);
  }

  // ---------------------------------------------------------------- lines

  private canEditCategory(role: MembershipRole, category: CostCategory) {
    return (
      roleHasPermission(role, 'costing.edit') ||
      (roleHasPermission(role, 'costing.edit_logistics') &&
        LOGISTICS_COST_CATEGORIES.includes(category))
    );
  }

  private lineData(dto: LineDto, category: CostCategory) {
    const data: Prisma.CostingLineItemUncheckedUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.currency !== undefined) {
      this.assertCurrency(dto.currency, 'Line currency');
      data.currency = dto.currency;
    }
    if (dto.basis !== undefined) data.basis = dto.basis;
    if (dto.percentageBase !== undefined)
      data.percentageBase = dto.percentageBase;
    if (dto.wastagePercent !== undefined) {
      if (dto.wastagePercent !== null && category !== 'PROCUREMENT')
        throw new BadRequestException(
          'Wastage applies to procurement lines only.',
        );
      data.wastagePercent = dto.wastagePercent;
    }
    if (dto.sourceType !== undefined) data.sourceType = dto.sourceType;
    if (dto.confidence !== undefined) data.confidence = dto.confidence;
    if (dto.freightQuoteType !== undefined) {
      if (dto.freightQuoteType !== null && category !== 'FREIGHT')
        throw new BadRequestException(
          'Freight quote type applies to freight lines only.',
        );
      data.freightQuoteType = dto.freightQuoteType;
    }
    for (const k of [
      'quoteReference',
      'carrier',
      'routeNotes',
      'notes',
    ] as const)
      if (dto[k] !== undefined) data[k] = dto[k]?.trim() || null;
    if (dto.transitDays !== undefined) data.transitDays = dto.transitDays;
    if (dto.quoteDate !== undefined)
      data.quoteDate = dto.quoteDate ? new Date(dto.quoteDate) : null;
    if (dto.validUntil !== undefined)
      data.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    if (
      dto.quoteDate &&
      dto.validUntil &&
      new Date(dto.validUntil) < new Date(dto.quoteDate)
    )
      throw new BadRequestException(
        'Quote validity cannot end before the quote date.',
      );
    if (dto.includeOverride !== undefined)
      data.includeOverride = dto.includeOverride;
    return data;
  }

  private checkLineConsistency(l: {
    basis: string;
    amount: Prisma.Decimal | string | null;
    percentageBase: string | null;
    sourceType: string;
    category: string;
  }) {
    if (l.basis === 'PERCENTAGE') {
      if (l.amount !== null && new D(l.amount.toString()).gt(100))
        throw new BadRequestException('A percentage cost cannot exceed 100%.');
      if (l.category === 'PROCUREMENT')
        throw new BadRequestException(
          'Procurement cannot be a percentage of itself.',
        );
    }
    if (l.sourceType === 'FREIGHT_QUOTE' && l.category !== 'FREIGHT')
      throw new BadRequestException(
        'Only freight lines can be marked as a freight quote.',
      );
  }

  async addLine(a: Actor, id: string, dto: CreateLineDto) {
    if (!dto.category) throw new BadRequestException('Select a cost category.');
    if (!this.canEditCategory(a.role, dto.category))
      throw new ForbiddenException('You cannot edit this cost category.');
    const c = await this.load(a.organizationId, id);
    this.assertEditable(c);
    const sc = c.scenarios.find((x) => x.id === dto.scenarioId);
    if (!sc) throw new NotFoundException('Scenario not found.');
    const data = this.lineData(dto, dto.category);
    const row = {
      category: dto.category,
      label:
        (data.label as string | undefined) ??
        COST_CATEGORY_LABELS[dto.category],
      amount: (data.amount as string | null | undefined) ?? null,
      currency: (data.currency as string | undefined) ?? c.calculationCurrency,
      basis: (data.basis as CostingLineItem['basis'] | undefined) ?? 'FIXED',
      percentageBase:
        (data.percentageBase as
          CostingLineItem['percentageBase'] | undefined) ?? null,
      sourceType:
        (data.sourceType as CostingLineItem['sourceType'] | undefined) ??
        'USER_ENTERED',
    };
    this.checkLineConsistency(row);
    const lineId = await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, c, a, dto.expectedRowVersion);
      const l = await tx.costingLineItem.create({
        data: {
          ...(data as Prisma.CostingLineItemUncheckedCreateInput),
          ...row,
          scenarioId: sc.id,
          freightQuoteType:
            dto.category === 'FREIGHT'
              ? ((data.freightQuoteType as CostingLineItem['freightQuoteType']) ??
                'MANUAL_ESTIMATE')
              : null,
          sortOrder: sc.lines.length,
        },
      });
      return l.id;
    });
    await this.recalc(a.organizationId, id, [sc.id]);
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.updated',
      entityType: 'ExportCosting',
      entityId: id,
      metadata: {
        change: 'line_added',
        lineId,
        scenarioId: sc.id,
        category: dto.category,
      },
    });
    return this.detail(a.organizationId, id);
  }

  async updateLine(a: Actor, id: string, lineId: string, dto: LineDto) {
    const c = await this.load(a.organizationId, id);
    this.assertEditable(c);
    const sc = c.scenarios.find((x) => x.lines.some((l) => l.id === lineId));
    const l = sc?.lines.find((x) => x.id === lineId);
    if (!sc || !l) throw new NotFoundException('Cost line not found.');
    const category = dto.category ?? l.category;
    if (
      !this.canEditCategory(a.role, l.category) ||
      !this.canEditCategory(a.role, category)
    )
      throw new ForbiddenException('You cannot edit this cost category.');
    const data = this.lineData(dto, category);
    if (dto.category !== undefined) data.category = dto.category;
    this.checkLineConsistency({
      basis: (data.basis as string | undefined) ?? l.basis,
      amount:
        data.amount !== undefined ? (data.amount as string | null) : l.amount,
      percentageBase:
        (data.percentageBase as string | undefined) ?? l.percentageBase,
      sourceType: (data.sourceType as string | undefined) ?? l.sourceType,
      category,
    });
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, c, a, dto.expectedRowVersion);
      await tx.costingLineItem.update({ where: { id: lineId }, data });
    });
    await this.recalc(a.organizationId, id, [sc.id]);
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.updated',
      entityType: 'ExportCosting',
      entityId: id,
      metadata: { change: 'line_updated', lineId, fields: Object.keys(data) },
    });
    return this.detail(a.organizationId, id);
  }

  async deleteLine(a: Actor, id: string, lineId: string, expected?: number) {
    const c = await this.load(a.organizationId, id);
    this.assertEditable(c);
    const sc = c.scenarios.find((x) => x.lines.some((l) => l.id === lineId));
    const l = sc?.lines.find((x) => x.id === lineId);
    if (!sc || !l) throw new NotFoundException('Cost line not found.');
    if (!this.canEditCategory(a.role, l.category))
      throw new ForbiddenException('You cannot edit this cost category.');
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, c, a, expected);
      await tx.costingLineItem.delete({ where: { id: lineId } });
    });
    await this.recalc(a.organizationId, id, [sc.id]);
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.updated',
      entityType: 'ExportCosting',
      entityId: id,
      metadata: { change: 'line_deleted', lineId, category: l.category },
    });
    return this.detail(a.organizationId, id);
  }

  // ------------------------------------------------------------ scenarios

  private async scenarioData(a: Actor, c: CostingRow, dto: ScenarioDto) {
    const data: Prisma.CostingScenarioUncheckedUpdateInput = {};
    const keys = [
      'name',
      'quantity',
      'quantityUnit',
      'netWeightKg',
      'cartonCount',
      'containerCount',
      'incoterm',
      'incotermPlace',
      'originPort',
      'destinationPort',
      'transportMode',
      'supplierLabel',
      'pricingMode',
      'pricingValue',
      'buyerTargetPrice',
      'notes',
    ] as const;
    const logisticsOnly = !roleHasPermission(a.role, 'costing.edit');
    const allowedForLogistics = new Set([
      'transportMode',
      'originPort',
      'destinationPort',
    ]);
    for (const k of keys) {
      if (dto[k] === undefined) continue;
      if (logisticsOnly && !allowedForLogistics.has(k))
        throw new ForbiddenException(
          'You can only change logistics fields of a scenario.',
        );
      const v = dto[k];
      (data as Record<string, unknown>)[k] =
        typeof v === 'string'
          ? v.trim() || (k === 'name' ? 'Scenario' : null)
          : v;
    }
    if (dto.quantity !== undefined && !new D(dto.quantity).gt(0))
      throw new BadRequestException('Quantity must be greater than zero.');
    let fx: { currency: string; snapshotId: string }[] | undefined;
    if (dto.fx !== undefined) {
      if (logisticsOnly)
        throw new ForbiddenException('You cannot change FX selections.');
      const snaps = await this.prisma.fxRateSnapshot.findMany({
        where: {
          organizationId: a.organizationId,
          id: { in: dto.fx.map((f) => f.snapshotId) },
        },
      });
      fx = [];
      for (const f of dto.fx) {
        const sn = snaps.find((x) => x.id === f.snapshotId);
        if (!sn) throw new NotFoundException('FX rate not found.');
        if (f.currency === c.calculationCurrency)
          throw new BadRequestException(
            'The calculation currency does not need an FX rate.',
          );
        const pair = [sn.baseCurrency, sn.quoteCurrency];
        if (!pair.includes(f.currency) || !pair.includes(c.calculationCurrency))
          throw new BadRequestException(
            `FX rate ${sn.baseCurrency}/${sn.quoteCurrency} does not convert ${f.currency} to ${c.calculationCurrency}.`,
          );
        if (fx.some((x) => x.currency === f.currency))
          throw new BadRequestException(
            `Only one FX rate per currency (${f.currency}).`,
          );
        fx.push({ currency: f.currency, snapshotId: f.snapshotId });
      }
    }
    return { data, fx };
  }

  async createScenario(a: Actor, id: string, dto: CreateScenarioDto) {
    const c = await this.load(a.organizationId, id);
    this.assertEditable(c);
    if (c.scenarios.length >= MAX_SCENARIOS)
      throw new BadRequestException(
        `A costing can have at most ${MAX_SCENARIOS} scenarios.`,
      );
    const src = dto.cloneFromScenarioId
      ? c.scenarios.find((x) => x.id === dto.cloneFromScenarioId)
      : c.scenarios.find((x) => x.isBase);
    if (!src) throw new NotFoundException('Scenario to clone not found.');
    const { data, fx } = await this.scenarioData(a, c, dto);
    const scId = await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, c, a, dto.expectedRowVersion);
      const fields = scenarioFields(src);
      const lines = src.lines;
      const srcFx = src.fx;
      const sc = await tx.costingScenario.create({
        data: {
          ...fields,
          ...(data as object),
          name: (data.name as string | undefined) ?? `${src.name} (copy)`,
          costingId: c.id,
          isBase: false,
          sortOrder: c.scenarios.length,
          lines: {
            create: lines.map(lineFields),
          },
          fx: {
            create: (
              fx ??
              srcFx.map((f) => ({
                currency: f.currency,
                snapshotId: f.snapshotId,
              }))
            ).map((f) => ({ currency: f.currency, snapshotId: f.snapshotId })),
          },
        } as Prisma.CostingScenarioUncheckedCreateInput,
      });
      return sc.id;
    });
    await this.recalc(a.organizationId, id, [scId]);
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.scenario_created',
      entityType: 'ExportCosting',
      entityId: id,
      metadata: { scenarioId: scId, clonedFrom: src.id },
    });
    return this.detail(a.organizationId, id);
  }

  async updateScenario(
    a: Actor,
    id: string,
    scenarioId: string,
    dto: ScenarioDto,
  ) {
    const c = await this.load(a.organizationId, id);
    this.assertEditable(c);
    const sc = c.scenarios.find((x) => x.id === scenarioId);
    if (!sc) throw new NotFoundException('Scenario not found.');
    const { data, fx } = await this.scenarioData(a, c, dto);
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, c, a, dto.expectedRowVersion);
      await tx.costingScenario.update({ where: { id: scenarioId }, data });
      if (fx) {
        await tx.costingScenarioFx.deleteMany({ where: { scenarioId } });
        if (fx.length)
          await tx.costingScenarioFx.createMany({
            data: fx.map((f) => ({ ...f, scenarioId })),
          });
      }
    });
    await this.recalc(a.organizationId, id, [scenarioId]);
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.scenario_updated',
      entityType: 'ExportCosting',
      entityId: id,
      metadata: {
        scenarioId,
        fields: [...Object.keys(data), ...(fx ? ['fx'] : [])],
      },
    });
    return this.detail(a.organizationId, id);
  }

  async deleteScenario(
    a: Actor,
    id: string,
    scenarioId: string,
    expected?: number,
  ) {
    const c = await this.load(a.organizationId, id);
    this.assertEditable(c);
    const sc = c.scenarios.find((x) => x.id === scenarioId);
    if (!sc) throw new NotFoundException('Scenario not found.');
    if (sc.isBase)
      throw new BadRequestException('The Base scenario cannot be deleted.');
    await this.prisma.$transaction(async (tx) => {
      await this.touch(tx, c, a, expected);
      await tx.costingScenario.delete({ where: { id: scenarioId } });
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.scenario_updated',
      entityType: 'ExportCosting',
      entityId: id,
      metadata: { scenarioId, change: 'deleted' },
    });
    return this.detail(a.organizationId, id);
  }

  /** Explicit recalculation (e.g. after time passes and quotes expire). Not audited. */
  async calculateScenario(
    organizationId: string,
    id: string,
    scenarioId: string,
  ) {
    const c = await this.load(organizationId, id);
    const sc = c.scenarios.find((x) => x.id === scenarioId);
    if (!sc) throw new NotFoundException('Scenario not found.');
    // Locked/archived costings keep their stored results; return a fresh read-only calculation instead.
    if (c.status === 'LOCKED' || c.status === 'ARCHIVED')
      return calculate(this.calcInput(c, sc));
    await this.recalc(organizationId, id, [scenarioId]);
    return (await this.load(organizationId, id)).scenarios.find(
      (x) => x.id === scenarioId,
    )!.result as unknown as CostingResult;
  }

  async calculateAll(organizationId: string, id: string) {
    const c = await this.load(organizationId, id);
    if (c.status !== 'LOCKED' && c.status !== 'ARCHIVED')
      await this.recalc(organizationId, id);
    return this.detail(organizationId, id);
  }

  // -------------------------------------------------------------- compare

  async compare(
    organizationId: string,
    id: string,
    dto: CompareDto,
  ): Promise<ScenarioComparison> {
    const c = await this.load(organizationId, id);
    const picked = dto.scenarioIds.map((sid) =>
      c.scenarios.find((x) => x.id === sid),
    );
    if (picked.some((x) => !x))
      throw new NotFoundException('Scenario not found.');
    if (new Set(dto.scenarioIds).size !== dto.scenarioIds.length)
      throw new BadRequestException('Scenarios must be distinct.');
    const base = c.scenarios.find((x) => x.isBase)!;
    const baseR = calculate(this.calcInput(c, base));
    const results = (picked as ScenarioRow[]).map((sc) => ({
      sc,
      r: calculate(this.calcInput(c, sc)),
    }));
    const sameUnit = new Set(results.map((x) => x.sc.quantityUnit)).size === 1;
    const costMetric = (r: CostingResult) =>
      r.totalCost === null
        ? null
        : new D(sameUnit ? r.costPerUnit! : r.totalCost);
    const diff = (
      x: string | null | undefined,
      y: string | null | undefined,
      f: (d: InstanceType<typeof D>) => string,
    ) => (x != null && y != null ? f(new D(x).minus(y)) : null);
    const rows: ScenarioComparisonRow[] = results.map(({ sc, r }) => ({
      scenarioId: sc.id,
      name: sc.name,
      isBase: sc.isBase,
      quantity: sc.quantity.toString(),
      quantityUnit: sc.quantityUnit,
      supplierLabel: sc.supplierLabel,
      transportMode: sc.transportMode,
      originPort: sc.originPort,
      destinationPort: sc.destinationPort,
      incoterm: sc.incoterm,
      incotermPlace: sc.incotermPlace,
      fx: r.fxUsed.map((f) => ({ pair: f.pair, rate: f.rate })),
      categoryTotals: Object.fromEntries(
        r.categories.map((cat) => [
          cat.category,
          cat.included ? cat.amount : null,
        ]),
      ),
      totalCost: r.totalCost,
      costPerUnit: r.costPerUnit,
      sellingPricePerUnit: r.pricing?.sellingPricePerUnit ?? null,
      sellingPricePerUnitQuote: r.pricing?.sellingPricePerUnitQuote ?? null,
      marginPercent: r.pricing?.marginPercent ?? null,
      totalProfit: r.pricing?.totalProfit ?? null,
      buyerTargetGapPercent: r.pricing?.buyerTarget?.gapPercent ?? null,
      complete: r.complete,
      deltaVsBase: sc.isBase
        ? null
        : {
            totalCost: diff(r.totalCost, baseR.totalCost, money),
            costPerUnit:
              sc.quantityUnit === base.quantityUnit
                ? diff(r.costPerUnit, baseR.costPerUnit, perUnit)
                : null,
            marginPoints: diff(
              r.pricing?.marginPercent,
              baseR.pricing?.marginPercent,
              pct,
            ),
            totalProfit: diff(
              r.pricing?.totalProfit,
              baseR.pricing?.totalProfit,
              money,
            ),
          },
      labels: [],
      rank: null,
    }));
    const best = (
      metric: (
        row: ScenarioComparisonRow,
        r: CostingResult,
      ) => InstanceType<typeof D> | null,
      dir: 'min' | 'max',
    ) => {
      let top: { i: number; v: InstanceType<typeof D> }[] = [];
      results.forEach(({ r }, i) => {
        const v = metric(rows[i], r);
        if (v === null) return;
        if (!top.length || (dir === 'min' ? v.lt(top[0].v) : v.gt(top[0].v)))
          top = [{ i, v }];
        else if (v.eq(top[0].v)) top.push({ i, v });
      });
      return top.map((t) => t.i);
    };
    const m = {
      LOWEST_COST: (_: ScenarioComparisonRow, r: CostingResult) =>
        costMetric(r),
      HIGHEST_MARGIN: (row: ScenarioComparisonRow) =>
        row.marginPercent === null ? null : new D(row.marginPercent),
      HIGHEST_PROFIT: (row: ScenarioComparisonRow) =>
        row.totalProfit === null ? null : new D(row.totalProfit),
      CLOSEST_TO_TARGET: (row: ScenarioComparisonRow) =>
        row.buyerTargetGapPercent === null
          ? null
          : new D(row.buyerTargetGapPercent).abs(),
    };
    for (const i of best(m.LOWEST_COST, 'min'))
      rows[i].labels.push('LOWEST_COST');
    for (const i of best(m.HIGHEST_MARGIN, 'max'))
      rows[i].labels.push('HIGHEST_MARGIN');
    for (const i of best(m.HIGHEST_PROFIT, 'max'))
      rows[i].labels.push('HIGHEST_PROFIT');
    for (const i of best(m.CLOSEST_TO_TARGET, 'min'))
      rows[i].labels.push('CLOSEST_TO_TARGET');
    if (dto.objective) {
      const obj = dto.objective as ComparisonObjective;
      const dir = obj === 'LOWEST_COST' || obj === 'CLOSEST_TO_TARGET' ? 1 : -1;
      const ranked = results
        .map(({ r }, i) => ({ i, v: m[obj](rows[i], r) }))
        .filter(
          (x): x is { i: number; v: InstanceType<typeof D> } => x.v !== null,
        )
        .sort(
          (x, y) =>
            dir * x.v.comparedTo(y.v) ||
            rows[x.i].name.localeCompare(rows[y.i].name),
        );
      ranked.forEach((x, n) => (rows[x.i].rank = n + 1));
    }
    return {
      calculationCurrency: c.calculationCurrency,
      quoteCurrency: c.quoteCurrency,
      objective: dto.objective ?? null,
      rows,
      note: sameUnit
        ? 'Lowest cost compares cost per unit.'
        : 'Scenarios use different quantity units, so lowest cost compares total cost.',
    };
  }

  // ---------------------------------------------------- ready / lock / revise

  private snapshotPayload(c: CostingRow) {
    return {
      inputs: {
        costing: {
          reference: c.reference,
          version: c.version,
          name: c.name,
          productId: c.productId,
          buyerCompanyId: c.buyerCompanyId,
          crmLeadId: c.crmLeadId,
          destinationCountryCode: c.destinationCountryCode,
          calculationCurrency: c.calculationCurrency,
          quoteCurrency: c.quoteCurrency,
          thinMarginPercent: c.thinMarginPercent.toString(),
        },
        scenarios: c.scenarios
          .map((sc) => this.scenario(sc))
          .map((x) => ({ ...x, result: undefined })),
      },
      results: Object.fromEntries(
        c.scenarios.map((sc) => [sc.id, calculate(this.calcInput(c, sc))]),
      ),
    };
  }

  async markReady(a: Actor, id: string, expected?: number) {
    const c = await this.load(a.organizationId, id);
    if (c.status !== 'DRAFT')
      throw new ConflictException(
        `Only a draft costing can be marked ready (current: ${c.status.toLowerCase()}).`,
      );
    const rd = this.readiness(c);
    if (!rd.ready)
      throw new BadRequestException({
        message: 'This costing is not ready yet.',
        details: { problems: rd.problems },
      });
    const snap = this.snapshotPayload(c);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.exportCosting.updateMany({
        where: {
          id,
          organizationId: a.organizationId,
          status: 'DRAFT',
          ...(expected !== undefined ? { rowVersion: expected } : {}),
        },
        data: {
          status: 'READY',
          readyAt: new Date(),
          rowVersion: { increment: 1 },
          updatedByUserId: a.userId,
        },
      });
      if (!res.count)
        throw new ConflictException(
          'This costing was changed by someone else. Reload and try again.',
        );
      await tx.costingSnapshot.create({
        data: {
          costingId: id,
          kind: 'READY',
          formulaVersion: COSTING_FORMULA_VERSION,
          inputs: snap.inputs as unknown as Prisma.InputJsonValue,
          results: snap.results as unknown as Prisma.InputJsonValue,
          createdByUserId: a.userId,
        },
      });
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.ready',
      entityType: 'ExportCosting',
      entityId: id,
      metadata: { formulaVersion: COSTING_FORMULA_VERSION },
    });
    return this.detail(a.organizationId, id);
  }

  async lock(a: Actor, id: string, expected?: number) {
    const c = await this.load(a.organizationId, id);
    if (c.status !== 'READY')
      throw new ConflictException('Mark the costing ready before locking it.');
    const rd = this.readiness(c);
    if (!rd.ready)
      throw new BadRequestException({
        message: 'This costing is not ready yet.',
        details: { problems: rd.problems },
      });
    const snap = this.snapshotPayload(c);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.exportCosting.updateMany({
        where: {
          id,
          organizationId: a.organizationId,
          status: 'READY',
          ...(expected !== undefined ? { rowVersion: expected } : {}),
        },
        data: {
          status: 'LOCKED',
          lockedAt: new Date(),
          lockedByUserId: a.userId,
          rowVersion: { increment: 1 },
          updatedByUserId: a.userId,
        },
      });
      if (!res.count)
        throw new ConflictException(
          'This costing was changed by someone else. Reload and try again.',
        );
      await tx.costingSnapshot.create({
        data: {
          costingId: id,
          kind: 'LOCKED',
          formulaVersion: COSTING_FORMULA_VERSION,
          inputs: snap.inputs as unknown as Prisma.InputJsonValue,
          results: snap.results as unknown as Prisma.InputJsonValue,
          createdByUserId: a.userId,
        },
      });
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.locked',
      entityType: 'ExportCosting',
      entityId: id,
      metadata: { formulaVersion: COSTING_FORMULA_VERSION },
    });
    return this.detail(a.organizationId, id);
  }

  /** New DRAFT copy (context, scenarios, lines, FX selections) with the next version; the source is untouched. */
  async revise(a: Actor, id: string) {
    const c = await this.load(a.organizationId, id);
    if (c.status === 'DRAFT')
      throw new ConflictException('Draft costings can be edited directly.');
    const rootId = c.rootId ?? c.id;
    const root =
      rootId === c.id
        ? c
        : await this.prisma.exportCosting.findFirst({
            where: { id: rootId, organizationId: a.organizationId },
          });
    const max = await this.prisma.exportCosting.aggregate({
      where: { organizationId: a.organizationId, rootId },
      _max: { version: true },
    });
    const version = (max._max.version ?? c.version) + 1;
    const newId = await this.prisma.$transaction(async (tx) => {
      const n = await tx.exportCosting.create({
        data: {
          organizationId: a.organizationId,
          reference: `${root?.reference ?? c.reference}-R${version}`,
          name: c.name,
          version,
          rootId,
          revisionOfId: c.id,
          productId: c.productId,
          buyerCompanyId: c.buyerCompanyId,
          crmLeadId: c.crmLeadId,
          destinationCountryCode: c.destinationCountryCode,
          calculationCurrency: c.calculationCurrency,
          quoteCurrency: c.quoteCurrency,
          thinMarginPercent: c.thinMarginPercent,
          notes: c.notes,
          createdByUserId: a.userId,
          updatedByUserId: a.userId,
        },
      });
      for (const sc of c.scenarios) {
        const fields = scenarioFields(sc);
        const { lines, fx } = sc;
        await tx.costingScenario.create({
          data: {
            ...fields,
            costingId: n.id,
            lines: {
              create: lines.map(lineFields),
            },
            fx: {
              create: fx.map((f) => ({
                currency: f.currency,
                snapshotId: f.snapshotId,
              })),
            },
          } as Prisma.CostingScenarioUncheckedCreateInput,
        });
      }
      return n.id;
    });
    await this.recalc(a.organizationId, newId);
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.revision_created',
      entityType: 'ExportCosting',
      entityId: newId,
      metadata: { revisionOf: c.id, version },
    });
    return this.detail(a.organizationId, newId);
  }

  async archive(a: Actor, id: string) {
    const c = await this.load(a.organizationId, id);
    if (c.status === 'ARCHIVED') return this.detail(a.organizationId, id);
    await this.prisma.exportCosting.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
        rowVersion: { increment: 1 },
        updatedByUserId: a.userId,
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.archived',
      entityType: 'ExportCosting',
      entityId: id,
      metadata: { previousStatus: c.status },
    });
    return this.detail(a.organizationId, id);
  }

  async restore(a: Actor, id: string) {
    const c = await this.load(a.organizationId, id);
    if (c.status !== 'ARCHIVED')
      throw new ConflictException('Only archived costings can be restored.');
    // A previously locked costing stays locked; anything else returns to draft.
    await this.prisma.exportCosting.update({
      where: { id },
      data: {
        status: c.lockedAt ? 'LOCKED' : 'DRAFT',
        archivedAt: null,
        readyAt: null,
        rowVersion: { increment: 1 },
        updatedByUserId: a.userId,
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'costing.restored',
      entityType: 'ExportCosting',
      entityId: id,
    });
    return this.detail(a.organizationId, id);
  }

  // ------------------------------------------------------------------- FX

  async listFx(organizationId: string, base?: string, quote?: string) {
    const where: Prisma.FxRateSnapshotWhereInput = { organizationId };
    if (base && quote)
      where.OR = [
        { baseCurrency: base, quoteCurrency: quote },
        { baseCurrency: quote, quoteCurrency: base },
      ];
    else if (base) where.OR = [{ baseCurrency: base }, { quoteCurrency: base }];
    const rows = await this.prisma.fxRateSnapshot.findMany({
      where,
      orderBy: { capturedAt: 'desc' },
      take: 100,
    });
    const names = await this.userNames(rows.map((r) => r.createdByUserId));
    return rows.map((r) => this.fxView(r, names));
  }

  /** Manual FX only — no live rate is fetched or invented. Snapshots are immutable. */
  async createManualFx(a: Actor, dto: ManualFxDto) {
    this.assertCurrency(dto.baseCurrency, 'Base currency');
    this.assertCurrency(dto.quoteCurrency, 'Quote currency');
    if (dto.baseCurrency === dto.quoteCurrency)
      throw new BadRequestException('Choose two different currencies.');
    if (!new D(dto.rate).gt(0))
      throw new BadRequestException('FX rate must be greater than zero.');
    const date = new Date(dto.sourceDate);
    if (date.getTime() > Date.now() + 86_400_000)
      throw new BadRequestException('Rate date cannot be in the future.');
    const r = await this.prisma.fxRateSnapshot.create({
      data: {
        organizationId: a.organizationId,
        baseCurrency: dto.baseCurrency,
        quoteCurrency: dto.quoteCurrency,
        rate: dto.rate,
        sourceDate: date,
        sourceType: dto.sourceType ?? 'MANUAL',
        sourceLabel: dto.sourceLabel?.trim() || null,
        isManual: true,
        createdByUserId: a.userId,
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'fx.manual_rate_created',
      entityType: 'FxRateSnapshot',
      entityId: r.id,
      metadata: {
        pair: `${r.baseCurrency}/${r.quoteCurrency}`,
        rate: r.rate.toString(),
      },
    });
    return this.fxView(r);
  }
}
