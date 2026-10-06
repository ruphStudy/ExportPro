import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type AddToCrmResult,
  BUYER_VERIFICATION_LABELS,
  type BuyerActivityView,
  type BuyerContactView,
  type BuyerDetail,
  type BuyerLeadView,
  type BuyerOrgState,
  type BuyerSearchContext,
  type BuyerSearchResponse,
  type BuyerSearchResult,
  type BuyerSourceType,
  CONTACT_VERIFICATION_LABELS,
  type DataProvenance,
  type SavedBuyersResponse,
  type SourceQualityTier,
  isValidCountryCode,
  type MembershipRole,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { AuditService } from '../audit/audit.service';
import { CrmService } from '../crm/crm.service';
import { FRESHNESS_SCORE } from '../trade-data/reliability';
import {
  analyzeEmail,
  FREQUENCY_RANK,
  isValidPhone,
  normalizeCompanyName,
  normalizeWebsite,
  sanitizeText,
} from './buyer-normalization';
import {
  BUYER_SCORE_VERSION,
  buyerMatch,
  confidenceLabel,
  type MatchContext,
} from './buyer-scoring';
import {
  BuyerEnrichmentService,
  buyerSourceProvenance,
  ENRICHMENT_VERSION,
  recordFreshness,
  type StoredProfile,
  tierOf,
} from './buyer-enrichment.service';
import {
  BuyerSyncService,
  resolveIdentity,
  writeChildren,
} from './buyer-sync.service';
import type { ProviderBuyerRecord } from './providers/buyer-provider';
import type {
  AddToCrmDto,
  BuyerContextDto,
  BuyerSearchDto,
  CreateManualBuyerDto,
  SaveBuyerDto,
} from './buyers.dto';

/** Search ranks at most this many DB-filtered candidates in memory (match depends on product context). */
const CANDIDATE_CAP = 2000;
const TIER_ORDER: SourceQualityTier[] = ['A', 'B', 'C', 'D', 'DEMO'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const buyerInclude = {
  activities: true,
  sourceRecords: { include: { source: true } },
} satisfies Prisma.BuyerCompanyInclude;
type BuyerRow = Prisma.BuyerCompanyGetPayload<{ include: typeof buyerInclude }>;
type Actor = { organizationId: string; userId: string };
const leadOwner = {
  owner: { select: { firstName: true, lastName: true } },
} satisfies Prisma.BuyerLeadInclude;

@Injectable()
export class BuyersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: BuyerEnrichmentService,
    private readonly sync: BuyerSyncService,
    private readonly audit: AuditService,
    private readonly crm: CrmService,
  ) {}

  // ----------------------------------------------------------- context

  private async context(
    organizationId: string,
    q: BuyerContextDto,
  ): Promise<{ ctx: MatchContext; context: BuyerSearchContext }> {
    if (q.country && !isValidCountryCode(q.country))
      throw new BadRequestException('This country is not supported yet.');
    const targets = await this.prisma.targetCountry.findMany({
      where: { organizationId },
      select: { countryCode: true },
    });
    let product: {
      id: string;
      displayName: string;
      hsCode: string;
      itcHsCode: string | null;
      categoryCode: string | null;
    } | null = null;
    if (q.productId) {
      product = await this.prisma.organizationProduct.findFirst({
        where: { id: q.productId, organizationId },
        select: {
          id: true,
          displayName: true,
          hsCode: true,
          itcHsCode: true,
          categoryCode: true,
        },
      });
      if (!product) throw new NotFoundException('Product not found.');
    }
    const hs = product?.hsCode ?? q.hsCode ?? null;
    const productName = sanitizeText(q.productName, 80);
    return {
      ctx: {
        hsCode: hs,
        itcHsCode:
          product?.itcHsCode ?? (q.hsCode?.length === 8 ? q.hsCode : null),
        categoryCode: product?.categoryCode ?? null,
        productName: product ? null : productName,
        countryCode: q.country ?? null,
        targetCountries: targets.map((t) => t.countryCode),
      },
      context: {
        productId: product?.id ?? null,
        productName: product?.displayName ?? productName,
        hsCode: product?.itcHsCode ?? hs,
        countryCode: q.country ?? null,
      },
    };
  }

  private visible(organizationId: string): Prisma.BuyerCompanyWhereInput {
    return {
      OR: [
        { ownerOrganizationId: null },
        { ownerOrganizationId: organizationId },
      ],
    };
  }

  private async findVisible(organizationId: string, id: string) {
    const b = await this.prisma.buyerCompany.findFirst({
      where: { id, ...this.visible(organizationId) },
      select: { id: true, countryCode: true, ownerOrganizationId: true },
    });
    if (!b) throw new NotFoundException('Buyer not found.');
    return b;
  }

  // ------------------------------------------------------------ search

  async search(
    organizationId: string,
    q: BuyerSearchDto,
  ): Promise<BuyerSearchResponse> {
    const { ctx, context } = await this.context(organizationId, q);
    await this.refreshStale(organizationId);
    const and: Prisma.BuyerCompanyWhereInput[] = [
      this.visible(organizationId),
      { active: true },
    ];
    if (q.country) and.push({ countryCode: q.country });
    if (q.buyerType) and.push({ buyerType: q.buyerType });
    if (q.companySize) and.push({ companySize: q.companySize });
    if (q.importFrequency) and.push({ importFrequency: q.importFrequency });
    if (q.maxRisk !== undefined) and.push({ riskScore: { lte: q.maxRisk } });
    if (q.verifiedContact === 'VERIFIED')
      and.push({ hasVerifiedContact: true });
    else if (q.verifiedContact === 'HAS_CONTACT')
      and.push({ hasContact: true });
    else if (q.verifiedContact === 'NO_CONTACT')
      and.push({ hasContact: false });
    if (q.source === 'DEMO') and.push({ isDemo: true });
    else if (q.source === 'USER_PROVIDED')
      and.push({ ownerOrganizationId: organizationId });
    else if (q.source === 'REAL')
      and.push({ isDemo: false, ownerOrganizationId: null });
    const productOr: Prisma.BuyerCompanyWhereInput[] = [];
    const code = (ctx.itcHsCode ?? ctx.hsCode)?.replace(/\D/g, '');
    if (code)
      productOr.push({
        activities: { some: { hsCode: { startsWith: code.slice(0, 2) } } },
      });
    if (ctx.categoryCode)
      productOr.push({ businessCategory: ctx.categoryCode });
    for (const w of (ctx.productName ?? '')
      .split(/\W+/)
      .filter((x) => x.length > 3)
      .slice(0, 5))
      productOr.push({
        activities: {
          some: { productName: { contains: w, mode: 'insensitive' } },
        },
      });
    if (productOr.length) and.push({ OR: productOr });

    const rows = await this.prisma.buyerCompany.findMany({
      where: { AND: and },
      include: buyerInclude,
      take: CANDIDATE_CAP + 1,
      orderBy: { id: 'asc' },
    });
    const warnings: string[] = [];
    if (rows.length > CANDIDATE_CAP)
      warnings.push(
        `More than ${CANDIDATE_CAP} candidates matched; narrow the filters for complete ranking.`,
      );
    const hasProduct = Boolean(
      ctx.hsCode || ctx.itcHsCode || ctx.productName || ctx.categoryCode,
    );
    let scored = rows
      .slice(0, CANDIDATE_CAP)
      .map((b) => ({ b, m: this.match(ctx, b) }))
      .filter((x) => !hasProduct || x.m.level !== 'NONE');
    if (q.minMatchScore !== undefined)
      scored = scored.filter((x) => x.m.score >= q.minMatchScore!);
    const t = (d: Date | null) => d?.getTime() ?? 0;
    const sorters: Record<
      string,
      (a: (typeof scored)[number], c: (typeof scored)[number]) => number
    > = {
      BEST_MATCH: (a, c) =>
        c.m.score - a.m.score || a.b.riskScore - c.b.riskScore,
      LOWEST_RISK: (a, c) =>
        a.b.riskScore - c.b.riskScore || c.m.score - a.m.score,
      MOST_ACTIVE: (a, c) =>
        FREQUENCY_RANK[c.b.importFrequency] -
          FREQUENCY_RANK[a.b.importFrequency] ||
        t(c.b.lastActivityDate) - t(a.b.lastActivityDate),
      CONTACT_CONFIDENCE: (a, c) =>
        (c.b.maxContactConfidence ?? -1) - (a.b.maxContactConfidence ?? -1) ||
        c.m.score - a.m.score,
      RECENTLY_VERIFIED: (a, c) =>
        t(c.b.lastVerifiedAt) - t(a.b.lastVerifiedAt) || c.m.score - a.m.score,
    };
    const sorter = sorters[q.sort ?? 'BEST_MATCH'];
    scored.sort(
      (a, c) =>
        sorter(a, c) || a.b.canonicalName.localeCompare(c.b.canonicalName),
    );
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 12;
    const slice = scored.slice((page - 1) * pageSize, page * pageSize);
    const states = await this.states(
      organizationId,
      slice.map((x) => x.b.id),
    );
    const providers = this.sync.providerStatuses();
    for (const p of providers)
      if (p.status === 'UNAVAILABLE')
        warnings.push(`${p.name} is unavailable — showing last synced data.`);
    return {
      items: slice.map((x) => this.result(x.b, x.m, states.get(x.b.id))),
      meta: buildPaginationMeta(page, pageSize, scored.length),
      context,
      sampleData:
        scored.some((x) => x.b.isDemo) ||
        (scored.length === 0 && providers.some((p) => p.demo && p.enabled)),
      providers,
      warnings,
      scoreVersion: BUYER_SCORE_VERSION,
      calculatedAt: new Date().toISOString(),
    };
  }

  /** Re-enriches buyers whose cached enrichment is outdated (bounded per request). */
  private async refreshStale(organizationId: string) {
    const stale = await this.prisma.buyerCompany.findMany({
      where: {
        ...this.visible(organizationId),
        OR: [
          { enrichmentVersion: { not: ENRICHMENT_VERSION } },
          { enrichmentVersion: null },
          { enrichmentExpiresAt: { lt: new Date() } },
        ],
      },
      select: { id: true },
      take: 50,
    });
    for (const s of stale)
      await this.enrichment.enrich(s.id, { force: true, identityCheck: false });
  }

  private match(ctx: MatchContext, b: BuyerRow) {
    return buyerMatch(ctx, {
      countryCode: b.countryCode,
      buyerType: b.buyerType,
      businessCategory: b.businessCategory,
      companySize: b.companySize,
      activities: b.activities.map((a) => ({
        activityType: a.activityType,
        hsCode: a.hsCode,
        productName: a.productName,
        importFrequency: a.importFrequency,
        lastActivityDate: a.lastActivityDate,
      })),
      bestContactConfidence: b.maxContactConfidence,
    });
  }

  private rankSources(b: BuyerRow) {
    const active = b.sourceRecords.filter((s) => s.active);
    const pool = active.length ? active : b.sourceRecords;
    const isId = (s: (typeof pool)[number]) =>
      s.sourceType === 'USER_PROVIDED' ||
      Boolean(s.source?.dataDomains.includes('COMPANY_IDENTITY'));
    return [...pool].sort(
      (x, y) =>
        Number(isId(y)) - Number(isId(x)) ||
        TIER_ORDER.indexOf(tierOf(x)) - TIER_ORDER.indexOf(tierOf(y)) ||
        (y.sourceUpdatedAt?.getTime() ?? 0) -
          (x.sourceUpdatedAt?.getTime() ?? 0),
    );
  }

  /**
   * Data confidence (0–100), separate from match and risk:
   * 50% identity-source quality + 30% freshness of the newest source + 20% corroboration (≥2 active sources 100, else 50).
   */
  private dataConfidence(b: BuyerRow, identity: DataProvenance) {
    const active = b.sourceRecords.filter((s) => s.active);
    const newest =
      active
        .map((s) => s.sourceUpdatedAt)
        .filter((d): d is Date => Boolean(d))
        .sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    const freshness = recordFreshness(newest);
    return {
      freshness,
      confidence: Math.round(
        0.5 * identity.confidence +
          0.3 * FRESHNESS_SCORE[freshness] +
          0.2 * (active.length >= 2 ? 100 : 50),
      ),
    };
  }

  private activitySummary(b: BuyerRow) {
    const trade = b.activities.filter(
      (a) => a.activityType === 'TRADE_ACTIVITY',
    );
    if (!trade.length)
      return b.activities.length
        ? 'Business listing only — no import records'
        : 'No activity on record';
    const tx = trade.reduce((s, a) => s + (a.transactionCount ?? 0), 0);
    const last = b.lastActivityDate;
    const freq =
      b.importFrequency === 'UNKNOWN'
        ? 'Importer'
        : `${b.importFrequency === 'HIGH_FREQUENCY' ? 'High-frequency' : b.importFrequency.charAt(0) + b.importFrequency.slice(1).toLowerCase()} importer`;
    return `${freq}${tx ? ` · ${tx} shipments in 12 months` : ''}${last ? ` · last ${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}` : ''}`;
  }

  private result(
    b: BuyerRow,
    m: ReturnType<BuyersService['match']>,
    state?: { shortlisted: boolean; inCrm: boolean },
  ): BuyerSearchResult {
    const profile = b.profile as unknown as StoredProfile | null;
    const identity = buyerSourceProvenance(this.rankSources(b)[0]);
    const dc = this.dataConfidence(b, identity);
    return {
      id: b.id,
      name: b.canonicalName,
      countryCode: b.countryCode,
      city: b.city,
      buyerType: b.buyerType,
      companySize: b.companySize,
      importFrequency: b.importFrequency,
      match: {
        score: m.score,
        level: m.level,
        matchedHsCode: m.matchedHsCode,
        matchedProductName: m.matchedProductName,
        productContextMissing: m.productContextMissing,
        reasons: m.reasons.slice(0, 4),
      },
      risk: profile?.risk
        ? {
            score: b.riskScore,
            level: profile.risk.level,
            reasons: profile.risk.reasons
              .filter((r) => !r.positive)
              .slice(0, 3),
          }
        : { score: b.riskScore, level: 'MODERATE', reasons: [] },
      verificationStatus: b.verificationStatus,
      contactAvailability: b.hasVerifiedContact
        ? 'VERIFIED'
        : b.hasContact
          ? 'HAS_CONTACT'
          : 'NONE',
      contactConfidence: b.maxContactConfidence,
      activitySummary: this.activitySummary(b),
      lastActivityDate: b.lastActivityDate?.toISOString() ?? null,
      lastVerifiedAt: b.lastVerifiedAt?.toISOString() ?? null,
      sourceCount: b.sourceRecords.filter((s) => s.active).length,
      provenance: identity,
      freshness: dc.freshness,
      confidence: dc.confidence,
      demo: b.isDemo,
      userProvided: Boolean(b.ownerOrganizationId),
      shortlisted: state?.shortlisted ?? false,
      inCrm: state?.inCrm ?? false,
    };
  }

  private async states(organizationId: string, ids: string[]) {
    const [rows, leads] = await Promise.all([
      this.prisma.organizationBuyer.findMany({
        where: { organizationId, buyerCompanyId: { in: ids } },
        select: { buyerCompanyId: true, shortlisted: true },
      }),
      this.prisma.buyerLead.findMany({
        where: { organizationId, buyerCompanyId: { in: ids } },
        select: { buyerCompanyId: true },
      }),
    ]);
    const map = new Map<string, { shortlisted: boolean; inCrm: boolean }>();
    for (const id of ids)
      map.set(id, {
        shortlisted: rows.some((r) => r.buyerCompanyId === id && r.shortlisted),
        inCrm: leads.some((l) => l.buyerCompanyId === id),
      });
    return map;
  }

  // ------------------------------------------------------------ detail

  async detail(
    organizationId: string,
    id: string,
    q: BuyerContextDto,
  ): Promise<BuyerDetail> {
    await this.findVisible(organizationId, id);
    const { ctx, context } = await this.context(organizationId, q);
    await this.enrichment.ensureFresh(id, true);
    const b = await this.prisma.buyerCompany.findUniqueOrThrow({
      where: { id },
      include: {
        ...buyerInclude,
        contacts: { orderBy: [{ isPrimary: 'desc' }, { confidence: 'desc' }] },
        duplicatesA: { include: { buyerB: true } },
        duplicatesB: { include: { buyerA: true } },
      },
    });
    const profile = (b.profile ?? {}) as unknown as StoredProfile;
    const m = this.match(ctx, b);
    const ranked = this.rankSources(b);
    const identity = buyerSourceProvenance(ranked[0]);
    const srcById = new Map(b.sourceRecords.map((s) => [s.id, s]));
    const nameOf = (sourceRecordId: string) =>
      buyerSourceProvenance(srcById.get(sourceRecordId)!).sourceName;
    const act = (a: BuyerRow['activities'][number]): BuyerActivityView => ({
      id: a.id,
      activityType: a.activityType,
      hsCode: a.hsCode,
      productName: a.productName,
      importFrequency: a.importFrequency,
      transactionCount: a.transactionCount,
      importValueUsd:
        a.importValueUsd === null ? null : Number(a.importValueUsd),
      importQuantity:
        a.importQuantity === null ? null : Number(a.importQuantity),
      quantityUnit: a.quantityUnit,
      originCountries: a.originCountries,
      firstActivityDate: a.firstActivityDate?.toISOString() ?? null,
      lastActivityDate: a.lastActivityDate?.toISOString() ?? null,
      periodLabel: a.periodLabel,
      sourceName: nameOf(a.sourceRecordId),
      confidence: a.confidence,
    });
    const contacts: BuyerContactView[] = b.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      contactType: c.contactType,
      value: c.value,
      verificationStatus: c.verificationStatus,
      verificationLabel: CONTACT_VERIFICATION_LABELS[c.verificationStatus],
      confidence: c.confidence,
      confidenceLabel: confidenceLabel(c.confidence),
      evidence: profile.contactEvidence?.[c.id] ?? [],
      verifiedAt:
        c.verificationStatus === 'VERIFIED'
          ? (c.verifiedAt?.toISOString() ?? null)
          : null,
      lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
      isPrimary: c.isPrimary,
      sourceName: nameOf(c.sourceRecordId),
      demo: tierOf(srcById.get(c.sourceRecordId)!) === 'DEMO',
    }));
    const trade = b.activities.filter(
      (a) => a.activityType === 'TRADE_ACTIVITY',
    );
    const listings = b.activities.filter(
      (a) => a.activityType === 'BUSINESS_LISTING',
    );
    const firstSrc = (sid: string | undefined) =>
      sid ? buyerSourceProvenance(srcById.get(sid)!) : null;
    const [state] = [
      await this.orgState(organizationId, id, context.productId),
    ];
    const dupes = [
      ...b.duplicatesA.map((d) => ({ other: d.buyerB, reason: d.reason })),
      ...b.duplicatesB.map((d) => ({ other: d.buyerA, reason: d.reason })),
    ].filter(
      (d) =>
        d.other.ownerOrganizationId === null ||
        d.other.ownerOrganizationId === organizationId,
    );
    return {
      id: b.id,
      name: b.canonicalName,
      countryCode: b.countryCode,
      stateRegion: b.stateRegion,
      city: b.city,
      address: b.address,
      website: b.websiteDomain ? b.website : null,
      websiteDomain: b.websiteDomain,
      buyerType: b.buyerType,
      rawBuyerTypes: profile.rawBuyerTypes ?? [],
      businessCategory: b.businessCategory,
      companySize: b.companySize,
      employeeRange: b.employeeRange,
      importFrequency: b.importFrequency,
      knownProducts: profile.knownProducts ?? [],
      demo: b.isDemo,
      userProvided: Boolean(b.ownerOrganizationId),
      active: b.active,
      context,
      match: m,
      risk: profile.risk
        ? { ...profile.risk, score: b.riskScore }
        : { score: b.riskScore, level: 'MODERATE', reasons: [] },
      verification: {
        status: b.verificationStatus,
        label: BUYER_VERIFICATION_LABELS[b.verificationStatus],
        explanation: profile.verificationExplanation ?? '',
        checkedAt: b.enrichedAt?.toISOString() ?? null,
      },
      contactConfidence: b.maxContactConfidence,
      warnings: profile.warnings ?? [],
      conflicts: profile.conflicts ?? [],
      possibleDuplicates: dupes.map((d) => ({
        id: d.other.id,
        name: d.other.canonicalName,
        city: d.other.city,
        reason: d.reason,
      })),
      tradeActivity: trade.map(act),
      businessListings: listings.map(act),
      contacts,
      sources: b.sourceRecords.map((s) => ({
        id: s.id,
        sourceName: buyerSourceProvenance(s).sourceName,
        sourceType: s.sourceType as BuyerSourceType,
        provenance: buyerSourceProvenance(s),
        externalId:
          s.sourceType === 'USER_PROVIDED'
            ? null
            : (s.externalId?.split(':')[0] ?? null),
        rawName: s.rawName,
        rawBuyerType: s.rawBuyerType,
        sourceUrl:
          s.sourceUrl && normalizeWebsite(s.sourceUrl)?.valid
            ? s.sourceUrl
            : null,
        retrievedAt: s.retrievedAt.toISOString(),
        sourceUpdatedAt: s.sourceUpdatedAt?.toISOString() ?? null,
        lastSeenAt: s.lastSeenAt.toISOString(),
        active: s.active,
        confidence: s.confidence,
      })),
      provenance: {
        identity,
        activity: firstSrc((trade[0] ?? listings[0])?.sourceRecordId),
        contacts: firstSrc(b.contacts[0]?.sourceRecordId),
      },
      orgState: state,
      enrichment: {
        enrichedAt: b.enrichedAt?.toISOString() ?? null,
        expiresAt: b.enrichmentExpiresAt?.toISOString() ?? null,
        version: b.enrichmentVersion ?? ENRICHMENT_VERSION,
        warnings: [
          profile.identityCheck?.status === 'UNAVAILABLE'
            ? 'Legal-entity registry check unavailable; showing cached data.'
            : null,
          profile.identityCheck?.status === 'MATCH' ||
          profile.identityCheck?.status === 'NO_MATCH'
            ? `Registry check: ${profile.identityCheck.message}`
            : null,
        ].filter((x): x is string => Boolean(x)),
      },
      scoreVersion: BUYER_SCORE_VERSION,
      calculatedAt: new Date().toISOString(),
      datasetVersion:
        (profile.providerVersions ?? []).join('+') || 'user-provided',
    };
  }

  private async orgState(
    organizationId: string,
    buyerCompanyId: string,
    productId?: string | null,
  ): Promise<BuyerOrgState> {
    const [s, leads] = await Promise.all([
      this.prisma.organizationBuyer.findUnique({
        where: {
          organizationId_buyerCompanyId: { organizationId, buyerCompanyId },
        },
      }),
      // Current organization's CRM leads only — never another tenant's.
      this.prisma.buyerLead.findMany({
        where: { organizationId, buyerCompanyId },
        include: leadOwner,
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const lead =
      leads.find((l) => l.productId === (productId ?? null)) ??
      leads[0] ??
      null;
    return {
      shortlisted: Boolean(s?.shortlisted),
      savedAt: s?.shortlisted ? (s.savedAt?.toISOString() ?? null) : null,
      notes: s?.notes ?? null,
      notesUpdatedAt: s?.notesUpdatedAt?.toISOString() ?? null,
      lead: lead ? this.leadView(lead) : null,
    };
  }

  private leadView(
    l: Prisma.BuyerLeadGetPayload<{ include: typeof leadOwner }>,
  ): BuyerLeadView {
    return {
      id: l.id,
      productId: l.productId,
      countryCode: l.countryCode,
      createdAt: l.createdAt.toISOString(),
      stage: l.stage,
      ownerName: l.owner
        ? `${l.owner.firstName} ${l.owner.lastName}`.trim()
        : null,
    };
  }

  // ----------------------------------------------------- saved / state

  async saved(
    organizationId: string,
    page = 1,
    pageSize = 20,
  ): Promise<SavedBuyersResponse> {
    const where = { organizationId, shortlisted: true };
    const [total, rows] = await Promise.all([
      this.prisma.organizationBuyer.count({ where }),
      this.prisma.organizationBuyer.findMany({
        where,
        include: {
          buyerCompany: {
            include: {
              ...buyerInclude,
              _count: { select: { contacts: true } },
            },
          },
          product: true,
        },
        orderBy: { savedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const targets = (
      await this.prisma.targetCountry.findMany({
        where: { organizationId },
        select: { countryCode: true },
      })
    ).map((t) => t.countryCode);
    const ids = rows.map((r) => r.buyerCompanyId);
    const [states, leads, users] = await Promise.all([
      this.states(organizationId, ids),
      this.prisma.buyerLead.findMany({
        where: { organizationId, buyerCompanyId: { in: ids } },
        include: leadOwner,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.user.findMany({
        where: {
          id: {
            in: rows
              .map((r) => r.savedByUserId)
              .filter((x): x is string => Boolean(x)),
          },
        },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    const items = rows.map((r) => {
      const ctx: MatchContext = {
        hsCode: r.product?.hsCode ?? null,
        itcHsCode: r.product?.itcHsCode ?? null,
        categoryCode: r.product?.categoryCode ?? null,
        productName: null,
        countryCode: r.contextCountryCode,
        targetCountries: targets,
      };
      const lead = leads.find((l) => l.buyerCompanyId === r.buyerCompanyId);
      const u = users.find((x) => x.id === r.savedByUserId);
      return {
        buyer: this.result(
          r.buyerCompany,
          this.match(ctx, r.buyerCompany),
          states.get(r.buyerCompanyId),
        ),
        savedAt: (r.savedAt ?? r.updatedAt).toISOString(),
        savedBy: u ? `${u.firstName} ${u.lastName}`.trim() : null,
        productId: r.productId,
        productName: r.product?.displayName ?? null,
        contextCountryCode: r.contextCountryCode,
        contactCount: r.buyerCompany._count.contacts,
        lead: lead ? this.leadView(lead) : null,
      };
    });
    return {
      items,
      meta: buildPaginationMeta(page, pageSize, total),
      sampleData: items.some((i) => i.buyer.demo),
    };
  }

  private async assertProduct(organizationId: string, productId?: string) {
    if (!productId) return null;
    const p = await this.prisma.organizationProduct.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Product not found.');
    return p.id;
  }

  async save(a: Actor, id: string, dto: SaveBuyerDto) {
    await this.findVisible(a.organizationId, id);
    const productId = await this.assertProduct(a.organizationId, dto.productId);
    if (dto.countryCode && !isValidCountryCode(dto.countryCode))
      throw new BadRequestException('This country is not supported yet.');
    const key = {
      organizationId_buyerCompanyId: {
        organizationId: a.organizationId,
        buyerCompanyId: id,
      },
    };
    const before = await this.prisma.organizationBuyer.findUnique({
      where: key,
    });
    if (!before?.shortlisted) {
      const data = {
        shortlisted: true,
        savedAt: new Date(),
        savedByUserId: a.userId,
        productId,
        contextCountryCode: dto.countryCode ?? null,
      };
      await this.prisma.organizationBuyer.upsert({
        where: key,
        create: {
          organizationId: a.organizationId,
          buyerCompanyId: id,
          ...data,
        },
        update: data,
      });
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'buyer.saved',
        entityType: 'BuyerCompany',
        entityId: id,
        metadata: { productId, countryCode: dto.countryCode ?? null },
      });
    }
    return this.orgState(a.organizationId, id);
  }

  async unsave(a: Actor, id: string) {
    await this.findVisible(a.organizationId, id);
    const key = {
      organizationId_buyerCompanyId: {
        organizationId: a.organizationId,
        buyerCompanyId: id,
      },
    };
    const before = await this.prisma.organizationBuyer.findUnique({
      where: key,
    });
    if (before?.shortlisted) {
      // Notes and CRM handoff stay; only the shortlist flag is cleared.
      await this.prisma.organizationBuyer.update({
        where: key,
        data: { shortlisted: false, savedAt: null },
      });
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'buyer.unsaved',
        entityType: 'BuyerCompany',
        entityId: id,
      });
    }
    return this.orgState(a.organizationId, id);
  }

  async updateNotes(a: Actor, id: string, notes: string) {
    await this.findVisible(a.organizationId, id);
    const clean = sanitizeText(notes, 5000);
    const data = {
      notes: clean,
      notesUpdatedAt: new Date(),
      notesUpdatedById: a.userId,
    };
    await this.prisma.organizationBuyer.upsert({
      where: {
        organizationId_buyerCompanyId: {
          organizationId: a.organizationId,
          buyerCompanyId: id,
        },
      },
      create: { organizationId: a.organizationId, buyerCompanyId: id, ...data },
      update: data,
    });
    // Note content is organization-private and never written to the audit log.
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'buyer.notes_updated',
      entityType: 'BuyerCompany',
      entityId: id,
      metadata: { length: clean?.length ?? 0 },
    });
    return this.orgState(a.organizationId, id);
  }

  /**
   * Buyer Discovery → CRM handoff. Same contract as Sprint 10 (idempotent per
   * organization + buyer + product context); the lead now enters the
   * Sprint 11 pipeline as NEW via the single CRM creation path.
   */
  async addToCrm(
    a: Actor & { role: MembershipRole },
    id: string,
    dto: AddToCrmDto,
  ): Promise<AddToCrmResult> {
    const { lead, alreadyExists } = await this.crm.createLead(
      a,
      {
        buyerCompanyId: id,
        productId: dto.productId,
        countryCode: dto.countryCode,
      },
      { source: 'BUYER_DISCOVERY', contextNote: dto.context },
    );
    return {
      leadId: lead.id,
      alreadyAdded: alreadyExists,
      createdAt: lead.createdAt.toISOString(),
    };
  }

  // ------------------------------------------------------ manual entry

  /** Organization-private USER_PROVIDED buyer; never treated as globally verified. */
  async createManual(a: Actor, dto: CreateManualBuyerDto) {
    if (!isValidCountryCode(dto.countryCode))
      throw new BadRequestException('This country is not supported yet.');
    const name = sanitizeText(dto.name, 160);
    if (!name || !normalizeCompanyName(name))
      throw new BadRequestException('Enter the company name.');
    const site = normalizeWebsite(dto.website);
    if (site && !site.valid)
      throw new BadRequestException(
        site.problem ?? 'Website address is not valid.',
      );
    if (dto.contactEmail && !analyzeEmail(dto.contactEmail).valid)
      throw new BadRequestException(
        'Contact email is not a valid email address.',
      );
    if (dto.contactPhone && !isValidPhone(dto.contactPhone))
      throw new BadRequestException(
        'Contact phone must be in international format, e.g. +971 4 123 4567.',
      );
    const now = new Date().toISOString();
    const record: ProviderBuyerRecord = {
      externalId: '',
      name,
      country: dto.countryCode,
      city: sanitizeText(dto.city, 80),
      website: site?.url ?? null,
      rawBuyerType: dto.buyerType ?? null,
      businessCategory: sanitizeText(dto.businessCategory, 60),
      sourceUpdatedAt: now,
      activities:
        dto.hsCode || dto.productName
          ? [
              {
                activityType: 'BUSINESS_LISTING',
                hsCode: dto.hsCode ?? null,
                productName:
                  sanitizeText(dto.productName, 120) ?? `HS ${dto.hsCode}`,
              },
            ]
          : [],
      contacts: [
        ...(dto.contactEmail
          ? [
              {
                contactType: 'EMAIL' as const,
                value: dto.contactEmail.trim(),
                name: dto.contactName,
                role: dto.contactRole,
                isPrimary: true,
                lastCheckedAt: now,
              },
            ]
          : []),
        ...(dto.contactPhone
          ? [
              {
                contactType: 'PHONE' as const,
                value: dto.contactPhone.trim(),
                name: dto.contactName,
                role: dto.contactRole,
                isPrimary: !dto.contactEmail,
                lastCheckedAt: now,
              },
            ]
          : []),
      ],
    };
    const dup = await resolveIdentity(
      this.prisma,
      record,
      dto.countryCode,
      a.organizationId,
    );
    if (
      dup.buyerId &&
      (dup.confidence === 'EXACT' || dup.confidence === 'HIGH')
    )
      throw new ConflictException({
        message: 'This buyer already exists.',
        details: { existingBuyerId: dup.buyerId, reason: dup.reason },
      });
    const id = await this.prisma.$transaction(async (tx) => {
      const b = await tx.buyerCompany.create({
        data: {
          canonicalName: name,
          normalizedName: normalizeCompanyName(name),
          countryCode: dto.countryCode,
          city: record.city,
          website: site?.url ?? null,
          websiteDomain: site?.domain ?? null,
          buyerType: dto.buyerType ?? 'UNKNOWN',
          businessCategory: record.businessCategory,
          ownerOrganizationId: a.organizationId,
          createdByUserId: a.userId,
        },
      });
      const rec = await tx.buyerSourceRecord.create({
        data: {
          buyerCompanyId: b.id,
          sourceType: 'USER_PROVIDED',
          externalId: null,
          rawName: name,
          rawCountry: dto.countryCode,
          rawBuyerType: dto.buyerType ?? null,
          sourceUpdatedAt: new Date(now),
          rawData: {
            record,
            providerVersion: 'user-provided-v1',
          } as unknown as Prisma.InputJsonValue,
          contentHash: 'user',
          confidence: 55,
        },
      });
      await writeChildren(tx, b.id, rec.id, record, 55);
      if (dup.confidence === 'POSSIBLE' && dup.buyerId) {
        const [x, y] = [dup.buyerId, b.id].sort();
        await tx.buyerDuplicateCandidate.create({
          data: {
            buyerAId: x,
            buyerBId: y,
            confidence: 'POSSIBLE',
            reason: dup.reason,
          },
        });
      }
      const notes = sanitizeText(dto.notes, 5000);
      if (notes)
        await tx.organizationBuyer.create({
          data: {
            organizationId: a.organizationId,
            buyerCompanyId: b.id,
            notes,
            notesUpdatedAt: new Date(),
            notesUpdatedById: a.userId,
          },
        });
      return b.id;
    });
    await this.enrichment.enrich(id, { force: true, identityCheck: true });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'buyer.created_manual',
      entityType: 'BuyerCompany',
      entityId: id,
      metadata: { countryCode: dto.countryCode },
    });
    return { id };
  }
}
