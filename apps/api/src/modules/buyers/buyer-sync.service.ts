import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  BuyerProviderStatus,
  DuplicateConfidence,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeCountry } from '../trade-data/normalization/normalizers';
import { QUALITY_SCORE } from '../trade-data/reliability';
import {
  analyzeEmail,
  deriveImportFrequency,
  nameSimilarity,
  normalizeBuyerType,
  normalizeCompanyName,
  normalizeCompanySize,
  normalizePhone,
  normalizeWebsite,
  sanitizeText,
} from './buyer-normalization';
import { BuyerEnrichmentService } from './buyer-enrichment.service';
import {
  BUYER_DATA_PROVIDERS,
  type BuyerDataProvider,
  type ProviderBuyerRecord,
} from './providers/buyer-provider';

type Tx = Prisma.TransactionClient;

export interface ResolutionResult {
  buyerId: string | null;
  confidence: DuplicateConfidence;
  reason: string;
}

/**
 * Syncs bulk buyer providers into the canonical store and resolves
 * identities. Strong identifiers first:
 *  EXACT — same source + external id; same registry id; same website domain + country;
 *  HIGH  — same normalized name + country + (same phone, or same non-free email domain, or same address);
 *  POSSIBLE — same normalized name + country, or similar name (≥0.6) + same city, with no shared identifier
 *             → recorded as a duplicate candidate, never merged.
 * Every source record is kept; records a provider stops returning are marked inactive, never deleted.
 */
@Injectable()
export class BuyerSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BuyerSyncService.name);
  private readonly status = new Map<string, BuyerProviderStatus>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: BuyerEnrichmentService,
    @Inject(BUYER_DATA_PROVIDERS)
    private readonly providers: BuyerDataProvider[],
  ) {}

  async onApplicationBootstrap() {
    // Registry rows are created by the trade-data module on init.
    for (const p of this.providers)
      await this.syncProvider(p).catch(() => undefined);
  }

  providerStatuses(): BuyerProviderStatus[] {
    return [...this.status.values()];
  }

  async syncProvider(provider: BuyerDataProvider) {
    const source = await this.prisma.tradeDataSource.findUnique({
      where: { code: provider.sourceCode },
    });
    const base: BuyerProviderStatus = {
      code: provider.sourceCode,
      name: source?.name ?? provider.sourceCode,
      sourceType: provider.sourceType,
      demo: provider.demo,
      enabled: Boolean(source?.enabled),
      status: 'OK',
      lastSyncedAt: null,
      message: null,
    };
    if (!source || !source.enabled) {
      this.status.set(provider.sourceCode, {
        ...base,
        status: 'DISABLED',
        message: source ? 'Disabled in Data Sources.' : 'Not registered.',
      });
      return;
    }
    try {
      const records = await provider.fetchAll();
      const touched = new Set<string>();
      const seen = new Set<string>();
      for (const r of records) {
        for (const id of await this.upsertRecord(
          provider,
          source.id,
          source.qualityTier,
          r,
        ))
          touched.add(id);
        seen.add(r.externalId);
      }
      // Lineage retention: never delete; mark records no longer returned as inactive.
      const gone = await this.prisma.buyerSourceRecord.findMany({
        where: {
          sourceId: source.id,
          active: true,
          externalId: { notIn: [...seen] },
        },
        select: { id: true, buyerCompanyId: true },
      });
      if (gone.length) {
        await this.prisma.buyerSourceRecord.updateMany({
          where: { id: { in: gone.map((g) => g.id) } },
          data: { active: false },
        });
        gone.forEach((g) => touched.add(g.buyerCompanyId));
      }
      for (const id of touched)
        await this.enrichment.enrich(id, { force: true, identityCheck: false });
      const latest =
        records
          .map((r) => r.sourceUpdatedAt)
          .sort()
          .pop() ?? null;
      const now = new Date();
      await this.prisma.tradeDataSource.update({
        where: { id: source.id },
        data: {
          lastSuccessfulRunAt: now,
          latestSourcePeriod: latest?.slice(0, 10) ?? null,
          latestPeriodEnd: latest ? new Date(latest) : null,
        },
      });
      this.status.set(provider.sourceCode, {
        ...base,
        lastSyncedAt: now.toISOString(),
        message: `${records.length} records; ${touched.size} buyers updated.`,
      });
    } catch (error) {
      // Keep last-good data; report the provider as unavailable.
      this.logger.warn(
        `Buyer provider ${provider.sourceCode} failed: ${(error as Error).message}`,
      );
      this.status.set(provider.sourceCode, {
        ...base,
        status: 'UNAVAILABLE',
        lastSyncedAt: source.lastSuccessfulRunAt?.toISOString() ?? null,
        message: 'Provider unavailable — showing last synced data.',
      });
    }
  }

  private hash(r: ProviderBuyerRecord, version: string) {
    return createHash('sha256')
      .update(JSON.stringify({ r, version }))
      .digest('hex');
  }

  /** Returns the buyer ids needing re-enrichment (empty when the record was unchanged). */
  private async upsertRecord(
    provider: BuyerDataProvider,
    sourceId: string,
    tier: keyof typeof QUALITY_SCORE,
    r: ProviderBuyerRecord,
  ): Promise<string[]> {
    const contentHash = this.hash(r, provider.version);
    const existing = await this.prisma.buyerSourceRecord.findUnique({
      where: { sourceId_externalId: { sourceId, externalId: r.externalId } },
    });
    if (existing && existing.contentHash === contentHash) {
      await this.prisma.buyerSourceRecord.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), active: true },
      });
      return existing.active ? [] : [existing.buyerCompanyId];
    }
    const cc = normalizeCountry({
      iso2: /^[A-Za-z]{2}$/.test(r.country) ? r.country : undefined,
      name: /^[A-Za-z]{2}$/.test(r.country) ? undefined : r.country,
    }).code;
    if (!cc) {
      this.logger.warn(
        `Skipping buyer record ${r.externalId}: unresolved country "${r.country}"`,
      );
      return [];
    }
    return this.prisma.$transaction(async (tx) => {
      const res: ResolutionResult = existing
        ? {
            buyerId: existing.buyerCompanyId,
            confidence: 'EXACT',
            reason: 'Same source record',
          }
        : await resolveIdentity(tx, r, cc, null);
      const site = normalizeWebsite(r.website);
      let buyerId = res.buyerId;
      const affected: string[] = [];
      if (!buyerId || res.confidence === 'POSSIBLE') {
        const created = await tx.buyerCompany.create({
          data: {
            canonicalName: r.name.trim(),
            normalizedName: normalizeCompanyName(r.name),
            countryCode: cc,
            city: r.city ?? null,
            stateRegion: r.stateRegion ?? null,
            address: r.address ?? null,
            website: site?.valid ? site.url : (r.website ?? null),
            websiteDomain: site?.valid ? site.domain : null,
            buyerType: normalizeBuyerType(r.rawBuyerType),
            businessCategory: r.businessCategory ?? null,
            companySize: normalizeCompanySize(r.companySize),
            isDemo: provider.demo,
          },
        });
        if (res.confidence === 'POSSIBLE' && res.buyerId) {
          const [a, b] = [res.buyerId, created.id].sort();
          await tx.buyerDuplicateCandidate.upsert({
            where: { buyerAId_buyerBId: { buyerAId: a, buyerBId: b } },
            create: {
              buyerAId: a,
              buyerBId: b,
              confidence: 'POSSIBLE',
              reason: res.reason,
            },
            update: { reason: res.reason },
          });
          affected.push(res.buyerId);
        }
        buyerId = created.id;
      }
      const data = {
        buyerCompanyId: buyerId,
        sourceType: provider.sourceType,
        rawName: r.name,
        rawCountry: r.country,
        rawBuyerType: r.rawBuyerType ?? null,
        sourceUrl: r.sourceUrl ?? null,
        sourceUpdatedAt: new Date(r.sourceUpdatedAt),
        lastSeenAt: new Date(),
        rawData: {
          record: r,
          providerVersion: provider.version,
        } as unknown as Prisma.InputJsonValue,
        contentHash,
        confidence: QUALITY_SCORE[tier],
        active: true,
        duplicateMatch:
          res.confidence === 'POSSIBLE'
            ? 'NONE'
            : `${res.confidence}: ${res.reason}`,
      };
      const rec = existing
        ? await tx.buyerSourceRecord.update({
            where: { id: existing.id },
            data,
          })
        : await tx.buyerSourceRecord.create({
            data: { ...data, sourceId, externalId: r.externalId },
          });
      // Activity/contacts are re-derived from this source record's raw payload (kept in rawData).
      await tx.buyerProductActivity.deleteMany({
        where: { sourceRecordId: rec.id },
      });
      await tx.buyerContact.deleteMany({ where: { sourceRecordId: rec.id } });
      await writeChildren(tx, buyerId, rec.id, r, QUALITY_SCORE[tier]);
      return [buyerId, ...affected];
    });
  }
}

/** Shared by provider sync and manual entry. Never merges on similar names alone. */
export async function resolveIdentity(
  tx: Tx | PrismaService,
  r: Pick<
    ProviderBuyerRecord,
    'name' | 'website' | 'city' | 'address' | 'registryId' | 'contacts'
  >,
  cc: string,
  ownerOrganizationId: string | null,
): Promise<ResolutionResult> {
  const scope = ownerOrganizationId
    ? { OR: [{ ownerOrganizationId: null }, { ownerOrganizationId }] }
    : { ownerOrganizationId: null };
  if (r.registryId) {
    const linked = await tx.buyerSourceRecord.findFirst({
      where: {
        rawData: { path: ['record', 'registryId'], equals: r.registryId },
        buyerCompany: scope,
      },
    });
    if (linked)
      return {
        buyerId: linked.buyerCompanyId,
        confidence: 'EXACT',
        reason: `Same registry id ${r.registryId}`,
      };
  }
  const site = normalizeWebsite(r.website);
  if (site?.valid && site.domain) {
    const byDomain = await tx.buyerCompany.findFirst({
      where: { websiteDomain: site.domain, countryCode: cc, ...scope },
    });
    if (byDomain)
      return {
        buyerId: byDomain.id,
        confidence: 'EXACT',
        reason: `Same website domain ${site.domain} in ${cc}`,
      };
  }
  const norm = normalizeCompanyName(r.name);
  const sameName = await tx.buyerCompany.findMany({
    where: { normalizedName: norm, countryCode: cc, ...scope },
    include: { contacts: true },
  });
  const phones = new Set(
    r.contacts
      .filter((c) => c.contactType === 'PHONE' || c.contactType === 'WHATSAPP')
      .map((c) => normalizePhone(c.value))
      .filter(Boolean),
  );
  const mailDomains = new Set(
    r.contacts
      .filter((c) => c.contactType === 'EMAIL')
      .map((c) => analyzeEmail(c.value))
      .filter((e) => e.valid && !e.freeMail)
      .map((e) => e.domain),
  );
  for (const b of sameName) {
    const phoneHit = b.contacts.some((c) =>
      phones.has(normalizePhone(c.value)),
    );
    const mailHit = b.contacts.some(
      (c) =>
        c.contactType === 'EMAIL' &&
        mailDomains.has(analyzeEmail(c.value).domain),
    );
    const addrHit = Boolean(
      r.address &&
      b.address &&
      normalizeCompanyName(r.address) === normalizeCompanyName(b.address),
    );
    if (phoneHit || mailHit || addrHit)
      return {
        buyerId: b.id,
        confidence: 'HIGH',
        reason: `Same name and country plus same ${phoneHit ? 'phone' : mailHit ? 'email domain' : 'address'}`,
      };
  }
  if (sameName[0])
    return {
      buyerId: sameName[0].id,
      confidence: 'POSSIBLE',
      reason: 'Same name and country, no shared identifier',
    };
  if (r.city) {
    const sameCity = await tx.buyerCompany.findMany({
      where: {
        countryCode: cc,
        city: { equals: r.city, mode: 'insensitive' },
        ...scope,
      },
      select: { id: true, canonicalName: true },
    });
    const similar = sameCity.find(
      (b) => nameSimilarity(b.canonicalName, r.name) >= 0.6,
    );
    if (similar)
      return {
        buyerId: similar.id,
        confidence: 'POSSIBLE',
        reason: `Similar name in the same city (${r.city}), no shared identifier`,
      };
  }
  return { buyerId: null, confidence: 'NONE', reason: 'No match' };
}

export async function writeChildren(
  tx: Tx,
  buyerId: string,
  sourceRecordId: string,
  r: ProviderBuyerRecord,
  baseConfidence: number,
) {
  const d = (s: string | null | undefined) => (s ? new Date(s) : null);
  if (r.activities.length)
    await tx.buyerProductActivity.createMany({
      data: r.activities.map((a) => ({
        buyerCompanyId: buyerId,
        sourceRecordId,
        activityType: a.activityType,
        hsCode: a.hsCode?.replace(/\D/g, '') || null,
        productName: sanitizeText(a.productName, 200) ?? 'Unspecified product',
        importFrequency:
          a.activityType === 'TRADE_ACTIVITY'
            ? deriveImportFrequency(a.transactionsLast12m)
            : 'UNKNOWN',
        rawFrequency: a.rawFrequency ?? null,
        transactionCount: a.transactionsLast12m ?? null,
        importValueUsd: a.importValueUsd ?? null,
        importQuantity: a.importQuantity ?? null,
        quantityUnit: a.quantityUnit ?? null,
        originCountries: a.originCountries ?? [],
        periodLabel: a.periodLabel ?? null,
        firstActivityDate: d(a.firstActivityDate),
        lastActivityDate: d(a.lastActivityDate),
        confidence: baseConfidence,
      })),
    });
  if (r.contacts.length)
    await tx.buyerContact.createMany({
      data: r.contacts.map((c) => ({
        buyerCompanyId: buyerId,
        sourceRecordId,
        name: sanitizeText(c.name, 120),
        role: sanitizeText(c.role, 120),
        contactType: c.contactType,
        value: sanitizeText(c.value, 320) ?? '',
        verificationMethod: c.verificationMethod ?? null,
        verifiedAt: d(c.verifiedAt),
        lastCheckedAt: d(c.lastCheckedAt) ?? d(r.sourceUpdatedAt),
        isPrimary: Boolean(c.isPrimary),
      })),
    });
}
