import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, TradeDataSource } from '@prisma/client';
import type {
  BuyerRisk,
  BuyerType,
  BuyerVerificationStatus,
  BuyerWarning,
  CompanySize,
  ContactVerificationStatus,
  DataProvenance,
  FieldConflict,
  FreshnessStatus,
  ImportFrequency,
  SourceQualityTier,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeCountry } from '../trade-data/normalization/normalizers';
import { QUALITY_SCORE } from '../trade-data/reliability';
import {
  analyzeEmail,
  FREQUENCY_RANK,
  nameSimilarity,
  normalizeBuyerType,
  normalizeCompanyName,
  normalizeCompanySize,
  normalizeWebsite,
} from './buyer-normalization';
import {
  BUYER_SCORE_VERSION,
  buyerRisk,
  contactConfidence,
  contactStatus,
  type IdentitySource,
  SOURCE_STALE_MONTHS,
  VERIFIED_CONTACT_MIN_CONFIDENCE,
  VERIFIED_CONTACT_STATUSES,
  verificationStatus,
} from './buyer-scoring';
import {
  BUYER_IDENTITY_PROVIDER,
  type BuyerIdentityProvider,
  type ProviderBuyerRecord,
} from './providers/buyer-provider';

export const ENRICHMENT_VERSION = `buyer-enrichment-v3+${BUYER_SCORE_VERSION}`;
const ENRICHMENT_TTL_DAYS = 7;
const IDENTITY_RECHECK_DAYS = 30;
const DAY = 86_400_000;
const TIER_ORDER: SourceQualityTier[] = ['A', 'B', 'C', 'D', 'DEMO'];

export interface StoredProfile {
  warnings: BuyerWarning[];
  conflicts: FieldConflict[];
  verificationExplanation: string;
  risk: BuyerRisk;
  rawBuyerTypes: string[];
  knownProducts: { hsCode: string | null; productName: string }[];
  contactEvidence: Record<string, string[]>;
  identityCheck: {
    status: 'MATCH' | 'NO_MATCH' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
    checkedAt: string | null;
    message: string | null;
  };
  providerVersions: string[];
}

type SourceWithRegistry = Prisma.BuyerSourceRecordGetPayload<{
  include: { source: true };
}>;

export const recordOf = (s: { rawData: Prisma.JsonValue }) =>
  ((s.rawData as { record?: ProviderBuyerRecord } | null)?.record ??
    null) as ProviderBuyerRecord | null;
export const tierOf = (s: {
  sourceType: string;
  source: TradeDataSource | null;
}): SourceQualityTier =>
  s.sourceType === 'USER_PROVIDED'
    ? 'D'
    : ((s.source?.qualityTier as SourceQualityTier) ?? 'DEMO');

/** Buyer-record freshness by age of the source's own update date: ≤6 months FRESH, ≤12 RECENT, ≤24 STALE, else VERY_STALE. */
export function recordFreshness(
  d: Date | null,
  now = new Date(),
): FreshnessStatus {
  if (!d) return 'UNKNOWN';
  const m = (now.getTime() - d.getTime()) / (30.44 * DAY);
  return m <= 6
    ? 'FRESH'
    : m <= 12
      ? 'RECENT'
      : m <= 24
        ? 'STALE'
        : 'VERY_STALE';
}

/** Sprint 9 provenance contract for one buyer source record. */
export function buyerSourceProvenance(s: SourceWithRegistry): DataProvenance {
  const user = s.sourceType === 'USER_PROVIDED';
  const demo = s.source?.qualityTier === 'DEMO' || s.sourceType === 'DEMO';
  const version =
    (s.rawData as { providerVersion?: string } | null)?.providerVersion ?? null;
  return {
    sourceId: s.sourceId,
    sourceCode: user ? 'USER_PROVIDED' : (s.source?.code ?? 'UNKNOWN'),
    sourceName: user
      ? 'Entered by your organization'
      : (s.source?.name ?? 'Unknown source'),
    sourceType: user ? 'INTERNAL' : (s.source?.sourceType ?? 'DEMO'),
    authority: user
      ? 'Your organization (user-provided)'
      : (s.source?.authority ?? 'Unknown'),
    official: !user && !demo && Boolean(s.source?.official),
    sourceQuality: tierOf(s),
    sourceDate: s.sourceUpdatedAt?.toISOString().slice(0, 10) ?? null,
    lastIngestedAt: s.retrievedAt.toISOString(),
    freshness: recordFreshness(s.sourceUpdatedAt),
    confidence: s.confidence,
    provenanceType: user
      ? 'USER_PROVIDED'
      : demo
        ? 'DEMO'
        : 'SOURCE_NORMALIZED',
    datasetVersion: version,
    derived: false,
    methodology: null,
  };
}

/**
 * Consolidates a canonical buyer from all its source records: conflict-aware
 * field selection, warnings, contact verification/confidence, company
 * verification and risk. Results are cached on BuyerCompany with a version
 * and expiry; unchanged records are not re-enriched. Identity checks against
 * the GLEIF registry run on demand only (user-entered buyers) and are cached.
 */
@Injectable()
export class BuyerEnrichmentService {
  private readonly logger = new Logger(BuyerEnrichmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(BUYER_IDENTITY_PROVIDER)
    private readonly identity?: BuyerIdentityProvider,
  ) {}

  isFresh(b: {
    enrichmentVersion: string | null;
    enrichmentExpiresAt: Date | null;
  }) {
    return (
      b.enrichmentVersion === ENRICHMENT_VERSION &&
      Boolean(b.enrichmentExpiresAt && b.enrichmentExpiresAt > new Date())
    );
  }

  async ensureFresh(id: string, identityCheck: boolean) {
    const b = await this.prisma.buyerCompany.findUnique({
      where: { id },
      select: {
        enrichmentVersion: true,
        enrichmentExpiresAt: true,
        ownerOrganizationId: true,
        profile: true,
      },
    });
    if (!b) return;
    const idDue =
      identityCheck &&
      b.ownerOrganizationId &&
      this.identityDue(
        (b.profile as unknown as StoredProfile | null)?.identityCheck,
      );
    if (!this.isFresh(b) || idDue)
      await this.enrich(id, { force: true, identityCheck });
  }

  private identityDue(c: StoredProfile['identityCheck'] | undefined) {
    if (!c || c.status === 'UNAVAILABLE' || !c.checkedAt) return true;
    return (
      Date.now() - new Date(c.checkedAt).getTime() > IDENTITY_RECHECK_DAYS * DAY
    );
  }

  async enrich(
    id: string,
    opts: { force?: boolean; identityCheck?: boolean } = {},
  ) {
    let b = await this.load(id);
    if (!b) return;
    if (!opts.force && this.isFresh(b)) return;
    const prev = b.profile as unknown as StoredProfile | null;
    let identityCheck: StoredProfile['identityCheck'] = prev?.identityCheck ?? {
      status: 'NOT_APPLICABLE',
      checkedAt: null,
      message: null,
    };
    if (
      b.ownerOrganizationId &&
      opts.identityCheck &&
      this.identity &&
      this.identityDue(prev?.identityCheck)
    ) {
      identityCheck = await this.checkIdentity(b);
      b = (await this.load(id))!;
    }
    const now = new Date();
    const sources = b.sourceRecords;
    const active = sources.filter((s) => s.active);
    const identitySources = active.filter(
      (s) =>
        s.sourceType === 'USER_PROVIDED' ||
        s.source?.dataDomains.includes('COMPANY_IDENTITY'),
    );
    const ranked = [
      ...(identitySources.length ? identitySources : active),
    ].sort(
      (x, y) =>
        TIER_ORDER.indexOf(tierOf(x)) - TIER_ORDER.indexOf(tierOf(y)) ||
        (y.sourceUpdatedAt?.getTime() ?? 0) -
          (x.sourceUpdatedAt?.getTime() ?? 0) ||
        y.confidence - x.confidence,
    );

    const conflicts: FieldConflict[] = [];
    const pick = (
      field: string,
      get: (r: ProviderBuyerRecord) => string | null | undefined,
      same: (a: string, b: string) => boolean = (a, c) => a === c,
    ) => {
      const values = active
        .map((s) => ({
          s,
          v: (() => {
            const r = recordOf(s);
            return r ? get(r) : null;
          })(),
        }))
        .filter((x): x is { s: SourceWithRegistry; v: string } =>
          Boolean(x.v && x.v !== 'UNKNOWN'),
        );
      const chosenEntry =
        ranked.map((s) => values.find((x) => x.s.id === s.id)).find(Boolean) ??
        values[0];
      const distinct = values.filter(
        (x, i) => values.findIndex((y) => same(y.v, x.v)) === i,
      );
      if (distinct.length > 1) {
        // Uncertain when an equally ranked source (same tier and same identity role) disagrees with the chosen value.
        const isId = (s: SourceWithRegistry) => identitySources.includes(s);
        const peers = values.filter(
          (x) =>
            tierOf(x.s) === tierOf(chosenEntry!.s) &&
            isId(x.s) === isId(chosenEntry!.s),
        );
        conflicts.push({
          field,
          chosen: chosenEntry?.v ?? null,
          uncertain: peers.some((x) => !same(x.v, chosenEntry!.v)),
          values: values.map((x) => ({
            value: x.v,
            sourceName: buyerSourceProvenance(x.s).sourceName,
            sourceUpdatedAt: x.s.sourceUpdatedAt?.toISOString() ?? null,
          })),
        });
      }
      return chosenEntry?.v ?? null;
    };
    const iso = (c: string) =>
      normalizeCountry(/^[A-Za-z]{2}$/.test(c) ? { iso2: c } : { name: c })
        .code;
    const name =
      pick(
        'Company name',
        (r) => r.name.trim(),
        (a, c) => normalizeCompanyName(a) === normalizeCompanyName(c),
      ) ?? b.canonicalName;
    const country = pick('Country', (r) => iso(r.country)) ?? b.countryCode;
    const city = pick(
      'City',
      (r) => r.city?.trim() ?? null,
      (a, c) =>
        a.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '') ===
        c.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''),
    );
    const buyerType = (pick(
      'Buyer type',
      (r) => (r.rawBuyerType ? normalizeBuyerType(r.rawBuyerType) : null),
      undefined,
    ) ?? 'UNKNOWN') as BuyerType;
    const size = (pick('Company size', (r) =>
      normalizeCompanySize(r.companySize),
    ) ?? 'UNKNOWN') as CompanySize;
    const category = pick(
      'Business category',
      (r) => r.businessCategory ?? null,
    );
    const websiteRaw = pick(
      'Website',
      (r) => r.website ?? null,
      (a, c) =>
        (normalizeWebsite(a)?.domain ?? a) ===
        (normalizeWebsite(c)?.domain ?? c),
    );
    const site = normalizeWebsite(websiteRaw);
    const domain = site?.valid ? site.domain : null;
    const employeeRange =
      ranked
        .map((s) => recordOf(s)?.companySize)
        .find((v) => v && /employee/i.test(v)) ?? null;

    // ---- warnings (deterministic; never an accusation of fraud)
    const warnings: BuyerWarning[] = [];
    const sitesInvalid = active
      .map((s) => normalizeWebsite(recordOf(s)?.website))
      .filter((w) => w && !w.valid);
    if (sitesInvalid.length)
      warnings.push({
        code: 'WEBSITE_MALFORMED',
        severity: 'CAUTION',
        message: `Website address is not valid (${sitesInvalid[0]!.problem})`,
      });
    const emails = b.contacts
      .filter((c) => c.contactType === 'EMAIL')
      .map((c) => ({ c, e: analyzeEmail(c.value) }));
    if (
      domain &&
      emails.some(
        ({ e }) =>
          e.valid &&
          !e.freeMail &&
          e.domain !== domain &&
          !e.domain!.endsWith(`.${domain}`),
      )
    )
      warnings.push({
        code: 'WEBSITE_DOMAIN_MISMATCH',
        severity: 'CONCERN',
        message:
          'Contact email domain does not match the company website — requires verification',
      });
    const primaryFree = emails.find(
      ({ c, e }) => c.isPrimary && e.valid && e.freeMail,
    );
    if (primaryFree)
      warnings.push({
        code: 'FREE_MAIL_PRIMARY',
        severity: domain ? 'CONCERN' : 'CAUTION',
        message: domain
          ? 'Primary business contact uses a free-mail address although the company has its own domain'
          : 'Primary contact uses a free-mail address',
      });
    if (conflicts.some((c) => c.field === 'Country'))
      warnings.push({
        code: 'CONFLICTING_COUNTRY',
        severity: 'CONCERN',
        message: 'Sources list this company in different countries',
      });
    const nameConflict = conflicts.find((c) => c.field === 'Company name');
    if (
      nameConflict &&
      nameConflict.values.some((v) => nameSimilarity(v.value, name) < 0.8)
    )
      warnings.push({
        code: 'CONFLICTING_NAME',
        severity: 'CONCERN',
        message:
          'Sources list materially different company names for the same identifiers',
      });
    // Only duplicates visible to the same audience: a global buyer never references another organization's private buyer.
    const dupes = [
      ...b.duplicatesA.map((d) => d.buyerB),
      ...b.duplicatesB.map((d) => d.buyerA),
    ].filter(
      (d) =>
        d.ownerOrganizationId === null ||
        d.ownerOrganizationId === b.ownerOrganizationId,
    );
    if (dupes.length)
      warnings.push({
        code: 'POSSIBLE_DUPLICATE',
        severity: 'CAUTION',
        message: `Possible duplicate of ${dupes.map((d) => d.canonicalName).join(', ')} — not merged automatically`,
      });
    const providerSources = active.filter(
      (s) => s.sourceType !== 'USER_PROVIDED',
    );
    if (!providerSources.length && !domain)
      warnings.push({
        code: 'NO_TRACEABLE_SOURCE',
        severity: 'CAUTION',
        message: 'No external source or company website supports this record',
      });
    const newest =
      active
        .map((s) => s.sourceUpdatedAt)
        .filter((d): d is Date => Boolean(d))
        .sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    if (
      newest &&
      now.getTime() - newest.getTime() > SOURCE_STALE_MONTHS * 30.44 * DAY
    )
      warnings.push({
        code: 'STALE_SOURCE',
        severity: 'CAUTION',
        message:
          'Stale — re-verification recommended (no source update in 24 months)',
      });
    if (identityCheck.status === 'UNAVAILABLE')
      warnings.push({
        code: 'IDENTITY_SOURCE_UNAVAILABLE',
        severity: 'INFO',
        message:
          'Public legal-entity registry was unavailable; identity check will be retried',
      });

    // ---- contacts
    const identityConflict = warnings.some(
      (w) => w.code === 'CONFLICTING_COUNTRY' || w.code === 'CONFLICTING_NAME',
    );
    const evidence: Record<string, string[]> = {};
    const contactRows: {
      id: string;
      status: ContactVerificationStatus;
      confidence: number;
      verifiedAt: Date | null;
    }[] = [];
    for (const c of b.contacts) {
      const src = sources.find((s) => s.id === c.sourceRecordId)!;
      const input = {
        contactType: c.contactType,
        value: c.value,
        role: c.role,
        name: c.name,
        verificationMethod: c.verificationMethod,
        verifiedAt: c.verifiedAt,
        lastCheckedAt: c.lastCheckedAt,
        sourceTier: tierOf(src),
        sourceUpdatedAt: src.sourceUpdatedAt,
        userProvided: src.sourceType === 'USER_PROVIDED',
      };
      const st = contactStatus(input, domain, now);
      const conf = contactConfidence(
        input,
        st.status,
        domain,
        identityConflict,
        now,
      );
      evidence[c.id] = st.evidence;
      contactRows.push({
        id: c.id,
        status: st.status,
        confidence: conf,
        verifiedAt: st.status === 'VERIFIED' ? c.verifiedAt : null,
      });
    }
    if (contactRows.some((c) => c.status === 'INVALID'))
      warnings.push({
        code: 'INVALID_CONTACT',
        severity: 'CAUTION',
        message: 'A listed contact is invalid',
      });
    if (contactRows.some((c) => c.status === 'STALE'))
      warnings.push({
        code: 'STALE_CONTACT',
        severity: 'INFO',
        message: 'Some contacts are stale — re-verification recommended',
      });
    const usable = contactRows.filter((c) => c.status !== 'INVALID');

    // ---- verification & risk
    const ids: IdentitySource[] = active.map((s) => ({
      tier: tierOf(s),
      sourceType: s.sourceType,
      active: s.active,
      demo: tierOf(s) === 'DEMO',
      userProvided: s.sourceType === 'USER_PROVIDED',
      registry: s.sourceType === 'PUBLIC_REGISTRY',
      registryActive:
        s.sourceType === 'PUBLIC_REGISTRY' &&
        (s.rawData as { registry?: { entityStatus?: string } }).registry
          ?.entityStatus === 'ACTIVE',
      sourceUpdatedAt: s.sourceUpdatedAt,
    }));
    // A website only counts as identity evidence when an external source lists it, not when typed in by a user.
    const ver = verificationStatus(
      ids,
      warnings,
      Boolean(domain) && providerSources.length > 0,
      now,
    );
    const trade = b.activities.filter(
      (a) => a.activityType === 'TRADE_ACTIVITY',
    );
    const risk = buyerRisk(
      {
        verification: ver.status,
        warnings,
        newestSourceUpdate: newest,
        hasTradeActivity: trade.length > 0,
        traceableSource: providerSources.length > 0 || Boolean(domain),
      },
      now,
    );
    const freq = trade.reduce<ImportFrequency>(
      (f, a) =>
        FREQUENCY_RANK[a.importFrequency] > FREQUENCY_RANK[f]
          ? a.importFrequency
          : f,
      'UNKNOWN',
    );
    const lastActivity =
      trade
        .map((a) => a.lastActivityDate)
        .filter((d): d is Date => Boolean(d))
        .sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    const registryCheck =
      identityCheck.status === 'MATCH' && identityCheck.checkedAt
        ? new Date(identityCheck.checkedAt)
        : null;
    const lastVerifiedAt =
      [...contactRows.map((c) => c.verifiedAt), registryCheck]
        .filter((d): d is Date => Boolean(d))
        .sort((x, y) => y.getTime() - x.getTime())[0] ?? null;

    const knownProducts = b.activities
      .filter(
        (a, i, all) =>
          all.findIndex(
            (x) => (x.hsCode ?? x.productName) === (a.hsCode ?? a.productName),
          ) === i,
      )
      .map((a) => ({ hsCode: a.hsCode, productName: a.productName }));
    const profile: StoredProfile = {
      warnings,
      conflicts,
      verificationExplanation: ver.explanation,
      risk,
      rawBuyerTypes: [
        ...new Set(
          active
            .map((s) => s.rawBuyerType)
            .filter((v): v is string => Boolean(v)),
        ),
      ],
      knownProducts,
      contactEvidence: evidence,
      identityCheck,
      providerVersions: [
        ...new Set(
          active
            .map(
              (s) =>
                (s.rawData as { providerVersion?: string }).providerVersion,
            )
            .filter((v): v is string => Boolean(v)),
        ),
      ],
    };
    await this.prisma.$transaction([
      ...contactRows.map((c) =>
        this.prisma.buyerContact.update({
          where: { id: c.id },
          data: { verificationStatus: c.status, confidence: c.confidence },
        }),
      ),
      this.prisma.buyerCompany.update({
        where: { id },
        data: {
          canonicalName: name,
          normalizedName: normalizeCompanyName(name),
          countryCode: country,
          city,
          buyerType,
          companySize: size,
          employeeRange,
          businessCategory: category,
          website: site?.valid ? site.url : (websiteRaw ?? null),
          websiteDomain: domain,
          active: active.length > 0,
          verificationStatus: ver.status as BuyerVerificationStatus,
          riskScore: risk.score,
          importFrequency: freq,
          lastActivityDate: lastActivity,
          hasContact: usable.length > 0,
          hasVerifiedContact: usable.some(
            (c) =>
              VERIFIED_CONTACT_STATUSES.includes(c.status) &&
              c.confidence >= VERIFIED_CONTACT_MIN_CONFIDENCE,
          ),
          maxContactConfidence: usable.length
            ? Math.max(...usable.map((c) => c.confidence))
            : null,
          lastVerifiedAt,
          profile: profile as unknown as Prisma.InputJsonValue,
          enrichedAt: now,
          enrichmentVersion: ENRICHMENT_VERSION,
          enrichmentExpiresAt: new Date(
            now.getTime() + ENRICHMENT_TTL_DAYS * DAY,
          ),
        },
      }),
    ]);
  }

  private load(id: string) {
    return this.prisma.buyerCompany.findUnique({
      where: { id },
      include: {
        sourceRecords: { include: { source: true } },
        activities: true,
        contacts: true,
        duplicatesA: {
          include: {
            buyerB: {
              select: {
                id: true,
                canonicalName: true,
                ownerOrganizationId: true,
              },
            },
          },
        },
        duplicatesB: {
          include: {
            buyerA: {
              select: {
                id: true,
                canonicalName: true,
                ownerOrganizationId: true,
              },
            },
          },
        },
      },
    });
  }

  /** Exact normalized legal name + country lookup in GLEIF. Failures keep last-good data and are retried later. */
  private async checkIdentity(
    b: NonNullable<Awaited<ReturnType<BuyerEnrichmentService['load']>>>,
  ): Promise<StoredProfile['identityCheck']> {
    const source = await this.prisma.tradeDataSource.findUnique({
      where: { code: this.identity!.sourceCode },
    });
    if (!source?.enabled)
      return {
        status: 'NOT_APPLICABLE',
        checkedAt: null,
        message: 'Registry check disabled in Data Sources.',
      };
    try {
      const m = await this.identity!.lookup(b.canonicalName, b.countryCode);
      const checkedAt = new Date().toISOString();
      if (!m)
        return {
          status: 'NO_MATCH',
          checkedAt,
          message:
            'No legal-entity registry record with this exact name and country (common for smaller companies).',
        };
      const record: ProviderBuyerRecord = {
        externalId: m.externalId,
        name: m.legalName,
        country: m.countryCode,
        city: m.city,
        registryId: m.externalId,
        sourceUrl: m.sourceUrl,
        sourceUpdatedAt: m.lastUpdated ?? checkedAt,
        activities: [],
        contacts: [],
      };
      const data = {
        buyerCompanyId: b.id,
        sourceType: 'PUBLIC_REGISTRY' as const,
        rawName: m.legalName,
        rawCountry: m.countryCode,
        sourceUrl: m.sourceUrl,
        sourceUpdatedAt: m.lastUpdated ? new Date(m.lastUpdated) : null,
        lastSeenAt: new Date(),
        rawData: {
          record,
          registry: {
            entityStatus: m.entityStatus,
            registrationStatus: m.registrationStatus,
          },
          raw: m.raw,
          providerVersion: this.identity!.version,
        } as unknown as Prisma.InputJsonValue,
        contentHash: m.externalId,
        confidence: QUALITY_SCORE[source.qualityTier as SourceQualityTier],
        active: true,
        duplicateMatch: 'EXACT: normalized legal name + country',
      };
      const externalId = `${m.externalId}:${b.id}`;
      await this.prisma.buyerSourceRecord.upsert({
        where: { sourceId_externalId: { sourceId: source.id, externalId } },
        create: { ...data, sourceId: source.id, externalId },
        update: data,
      });
      return {
        status: 'MATCH',
        checkedAt,
        message: `LEI ${m.externalId} — entity ${m.entityStatus.toLowerCase()}, registration ${m.registrationStatus.toLowerCase()}.`,
      };
    } catch (error) {
      this.logger.warn(`GLEIF lookup failed: ${(error as Error).message}`);
      return {
        status: 'UNAVAILABLE',
        checkedAt: null,
        message: 'Registry unavailable.',
      };
    }
  }
}
