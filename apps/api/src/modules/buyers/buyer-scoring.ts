import type {
  BuyerMatch,
  BuyerMatchComponent,
  BuyerRisk,
  BuyerRiskLevel,
  BuyerType,
  BuyerVerificationStatus,
  BuyerWarning,
  CompanySize,
  ContactVerificationStatus,
  ImportFrequency,
  ProductMatchLevel,
  ScoreReason,
  SourceQualityTier,
} from '@exportpro/types';
import { QUALITY_SCORE } from '../trade-data/reliability';
import { analyzeEmail, isValidPhone } from './buyer-normalization';

/**
 * Deterministic buyer scoring (no AI). Three independent scores:
 *  - match (0–100): commercial relevance for a product/market context;
 *  - contact confidence (0–100) per contact;
 *  - risk (0–100, higher = riskier): credibility of the record.
 * Company verification and contact verification are separate statuses.
 */
export const BUYER_SCORE_VERSION = 'buyer-score-v1';
const DAY = 86_400_000;

const monthsSince = (d: Date | null | undefined, now: Date) =>
  d ? (now.getTime() - d.getTime()) / (30.44 * DAY) : null;

// ---------------------------------------------------------------- contacts

export interface ContactInput {
  contactType: string;
  value: string;
  role: string | null;
  name: string | null;
  verificationMethod: string | null;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  sourceTier: SourceQualityTier;
  sourceUpdatedAt: Date | null;
  userProvided: boolean;
}

/** Contacts not checked/updated for more than 24 months are STALE. */
export const CONTACT_STALE_MONTHS = 24;
/** Statuses that satisfy the "Has verified contact" filter. FORMAT_VALID / DOMAIN_MATCHED do not. */
export const VERIFIED_CONTACT_STATUSES: ContactVerificationStatus[] = [
  'VERIFIED',
];
export const VERIFIED_CONTACT_MIN_CONFIDENCE = 50;

/**
 * Status ladder: UNVERIFIED (user-entered) / SOURCE_LISTED (provider) →
 * FORMAT_VALID (syntax) → DOMAIN_MATCHED (email domain = company website
 * domain) → VERIFIED (only when the source records a verification method
 * and date). Invalid syntax → INVALID; not checked for 24 months → STALE.
 */
export function contactStatus(
  c: ContactInput,
  companyDomain: string | null,
  now = new Date(),
): { status: ContactVerificationStatus; evidence: string[] } {
  const evidence: string[] = [];
  let status: ContactVerificationStatus = c.userProvided
    ? 'UNVERIFIED'
    : 'SOURCE_LISTED';
  if (!c.userProvided) evidence.push('Listed by the source');
  if (c.contactType === 'EMAIL') {
    const e = analyzeEmail(c.value);
    if (!e.valid)
      return { status: 'INVALID', evidence: ['Email address is not valid'] };
    status = 'FORMAT_VALID';
    evidence.push('Email format valid (mailbox not tested)');
    if (e.freeMail) evidence.push('Free-mail address, not a company domain');
    else if (
      companyDomain &&
      (e.domain === companyDomain || e.domain!.endsWith(`.${companyDomain}`))
    ) {
      status = 'DOMAIN_MATCHED';
      evidence.push('Email domain matches company website');
    } else if (companyDomain)
      evidence.push('Email domain differs from company website');
  } else if (c.contactType === 'PHONE' || c.contactType === 'WHATSAPP') {
    if (!isValidPhone(c.value))
      return {
        status: 'INVALID',
        evidence: ['Phone number is not in international format'],
      };
    status = 'FORMAT_VALID';
    evidence.push('Phone number format valid (not dialled)');
  }
  if (c.verificationMethod && c.verifiedAt) {
    status = 'VERIFIED';
    evidence.push(
      `Verified by source (${c.verificationMethod.toLowerCase().replace(/_/g, ' ')})`,
    );
  }
  const age = monthsSince(c.lastCheckedAt ?? c.sourceUpdatedAt, now);
  if (age === null || age > CONTACT_STALE_MONTHS) {
    if (age !== null)
      evidence.push(`Not checked for ${Math.round(age)} months`);
    status = 'STALE';
  }
  return { status, evidence };
}

const ROLE_RELEVANT =
  /procure|purchas|buyer|buying|sourcing|import|category manager|supply/i;
const STATUS_POINTS: Record<ContactVerificationStatus, number> = {
  VERIFIED: 35,
  DOMAIN_MATCHED: 25,
  FORMAT_VALID: 15,
  SOURCE_LISTED: 12,
  UNVERIFIED: 5,
  STALE: 5,
  INVALID: 0,
};

/**
 * Contact confidence (0–100) = source quality (25% of tier score, ≤25)
 * + verification level (≤35) + company-domain match (15) + freshness
 * (≤180 days 15, ≤365 10, ≤730 5) + role relevance (procurement 10,
 * named/other role 4, generic/unknown 2) − conflicting identity (10).
 * INVALID contacts are 0.
 */
export function contactConfidence(
  c: ContactInput,
  status: ContactVerificationStatus,
  companyDomain: string | null,
  identityConflict: boolean,
  now = new Date(),
): number {
  if (status === 'INVALID') return 0;
  let pts = 0.25 * QUALITY_SCORE[c.userProvided ? 'D' : c.sourceTier];
  pts += STATUS_POINTS[status];
  if (c.contactType === 'EMAIL') {
    const e = analyzeEmail(c.value);
    if (
      companyDomain &&
      e.domain &&
      !e.freeMail &&
      (e.domain === companyDomain || e.domain.endsWith(`.${companyDomain}`))
    )
      pts += 15;
  }
  const ref = c.lastCheckedAt ?? c.sourceUpdatedAt;
  const ageDays = ref ? (now.getTime() - ref.getTime()) / DAY : null;
  if (ageDays !== null)
    pts += ageDays <= 180 ? 15 : ageDays <= 365 ? 10 : ageDays <= 730 ? 5 : 0;
  pts += c.role && ROLE_RELEVANT.test(c.role) ? 10 : c.role || c.name ? 4 : 2;
  if (identityConflict) pts -= 10;
  return Math.max(0, Math.min(100, Math.round(pts)));
}

export const confidenceLabel = (n: number) =>
  (n >= 75 ? 'High' : n >= 50 ? 'Medium' : n >= 25 ? 'Low' : 'Very low') as
    'High' | 'Medium' | 'Low' | 'Very low';

// ------------------------------------------------------- company verification

export interface IdentitySource {
  tier: SourceQualityTier;
  sourceType: string;
  active: boolean;
  demo: boolean;
  userProvided: boolean;
  registry: boolean;
  registryActive: boolean;
  sourceUpdatedAt: Date | null;
}

/** Sources not updated for more than 24 months are stale. */
export const SOURCE_STALE_MONTHS = 24;

/**
 * Company verification (identity only, never KYC):
 *  SUSPICIOUS — ≥2 CONCERN-level warnings;
 *  NEEDS_REVIEW — conflicting identity, possible duplicate, or only stale sources;
 *  MULTI_SOURCE_VERIFIED — ≥2 independent active provider sources agree on name + country;
 *  VERIFIED_SOURCE — one active provider source of tier A–C, or an active legal-entity registry record;
 *  PARTIALLY_VERIFIED — one provider source (tier D/DEMO) or a valid company website;
 *  UNVERIFIED — user-entered only.
 */
export function verificationStatus(
  sources: IdentitySource[],
  warnings: BuyerWarning[],
  websiteValid: boolean,
  now = new Date(),
): { status: BuyerVerificationStatus; explanation: string } {
  const concerns = warnings.filter((w) => w.severity === 'CONCERN').length;
  if (concerns >= 2)
    return {
      status: 'SUSPICIOUS',
      explanation:
        'Several potential concerns were found in this record. This is not evidence of fraud — verify the company independently before engaging.',
    };
  const active = sources.filter((s) => s.active && !s.userProvided);
  const fresh = active.filter(
    (s) =>
      (monthsSince(s.sourceUpdatedAt, now) ?? Infinity) <= SOURCE_STALE_MONTHS,
  );
  if (
    warnings.some(
      (w) =>
        w.code === 'CONFLICTING_COUNTRY' ||
        w.code === 'CONFLICTING_NAME' ||
        w.code === 'POSSIBLE_DUPLICATE',
    )
  )
    return {
      status: 'NEEDS_REVIEW',
      explanation:
        'Sources disagree about this company’s identity or a possible duplicate exists. Review the source records.',
    };
  if (active.length > 0 && fresh.length === 0)
    return {
      status: 'NEEDS_REVIEW',
      explanation:
        'All sources for this company are more than 24 months old. Re-verification recommended.',
    };
  if (fresh.length >= 2)
    return {
      status: 'MULTI_SOURCE_VERIFIED',
      explanation: `${fresh.length} independent sources agree on this company’s name and country.`,
    };
  const one = fresh[0];
  if (
    one &&
    (one.registry ? one.registryActive : ['A', 'B', 'C'].includes(one.tier))
  )
    return {
      status: 'VERIFIED_SOURCE',
      explanation: one.registry
        ? 'An active legal-entity registry record matches this company’s name and country.'
        : 'One reliable source lists this company.',
    };
  if (one || websiteValid)
    return {
      status: 'PARTIALLY_VERIFIED',
      explanation: one
        ? 'Listed by one source only; identity is not independently confirmed.'
        : 'Only a company website supports this record.',
    };
  return {
    status: 'UNVERIFIED',
    explanation:
      'Entered by your organization; not confirmed by any external source.',
  };
}

// ------------------------------------------------------------------- risk

export interface RiskInput {
  verification: BuyerVerificationStatus;
  warnings: BuyerWarning[];
  newestSourceUpdate: Date | null;
  hasTradeActivity: boolean;
  traceableSource: boolean;
}

const VERIFICATION_RISK: Record<BuyerVerificationStatus, number> = {
  UNVERIFIED: 25,
  PARTIALLY_VERIFIED: 15,
  VERIFIED_SOURCE: 5,
  MULTI_SOURCE_VERIFIED: 0,
  NEEDS_REVIEW: 20,
  SUSPICIOUS: 30,
};
const WARNING_RISK: Partial<Record<BuyerWarning['code'], number>> = {
  WEBSITE_MALFORMED: 10,
  WEBSITE_DOMAIN_MISMATCH: 10,
  FREE_MAIL_PRIMARY: 8,
  INVALID_CONTACT: 8,
  CONFLICTING_COUNTRY: 15,
  CONFLICTING_NAME: 10,
  POSSIBLE_DUPLICATE: 8,
  STALE_CONTACT: 5,
};

/**
 * Buyer risk (0 low – 100 high), additive and capped:
 * verification weakness (0–30) + source age (>24 months 15, >12 months 7)
 * + warning penalties (malformed website 10, website/email domain mismatch 10,
 * free-mail primary 8, invalid contact 8, conflicting country 15,
 * conflicting name 10, possible duplicate 8, stale contacts 5)
 * + no trade activity on record 10 + no traceable source 10.
 * Company size is never a risk factor.
 * Levels: <25 LOW, <50 MODERATE, <75 HIGH, else VERY_HIGH.
 */
export function buyerRisk(input: RiskInput, now = new Date()): BuyerRisk {
  const reasons: ScoreReason[] = [];
  let score = VERIFICATION_RISK[input.verification];
  if (input.verification === 'MULTI_SOURCE_VERIFIED')
    reasons.push({
      text: 'Multiple recent sources agree on identity',
      positive: true,
    });
  else if (input.verification === 'VERIFIED_SOURCE')
    reasons.push({
      text: 'Identity supported by a reliable source',
      positive: true,
    });
  else
    reasons.push({
      text:
        input.verification === 'UNVERIFIED'
          ? 'Identity not verified by any external source'
          : input.verification === 'PARTIALLY_VERIFIED'
            ? 'Identity only partially supported'
            : input.verification === 'NEEDS_REVIEW'
              ? 'Record needs review'
              : 'Potential concerns found — requires verification',
      positive: false,
    });
  const age = monthsSince(input.newestSourceUpdate, now);
  if (age === null || age > 24) {
    score += 15;
    reasons.push({
      text:
        age === null
          ? 'Source update date unknown'
          : 'Stale listing — re-verification recommended',
      positive: false,
    });
  } else if (age > 12) {
    score += 7;
    reasons.push({
      text: 'Source data is more than 12 months old',
      positive: false,
    });
  } else
    reasons.push({
      text: 'Source data updated within the last 12 months',
      positive: true,
    });
  for (const w of input.warnings) {
    const p = WARNING_RISK[w.code];
    if (p) {
      score += p;
      reasons.push({ text: w.message, positive: false });
    }
  }
  if (input.hasTradeActivity)
    reasons.push({ text: 'Trade activity on record', positive: true });
  else {
    score += 10;
    reasons.push({
      text: 'No trade activity on record (business listing only)',
      positive: false,
    });
  }
  if (!input.traceableSource) {
    score += 10;
    reasons.push({
      text: 'No traceable external source or website',
      positive: false,
    });
  }
  score = Math.max(0, Math.min(100, score));
  return { score, level: riskLevel(score), reasons };
}

export const riskLevel = (s: number): BuyerRiskLevel =>
  s < 25 ? 'LOW' : s < 50 ? 'MODERATE' : s < 75 ? 'HIGH' : 'VERY_HIGH';

// ------------------------------------------------------------------ match

export interface MatchContext {
  hsCode: string | null;
  itcHsCode: string | null;
  categoryCode: string | null;
  productName: string | null;
  countryCode: string | null;
  targetCountries: string[];
}

export interface MatchActivity {
  activityType: 'TRADE_ACTIVITY' | 'BUSINESS_LISTING';
  hsCode: string | null;
  productName: string;
  importFrequency: ImportFrequency;
  lastActivityDate: Date | null;
}

export interface MatchBuyer {
  countryCode: string;
  buyerType: BuyerType;
  businessCategory: string | null;
  companySize: CompanySize;
  activities: MatchActivity[];
  bestContactConfidence: number | null;
}

const TYPE_POINTS: Record<BuyerType, number> = {
  IMPORTER: 15,
  DISTRIBUTOR: 14,
  WHOLESALER: 13,
  AGENT: 9,
  MANUFACTURER: 8,
  RETAILER: 7,
  OTHER: 4,
  UNKNOWN: 3,
};
const FREQ_POINTS: Record<ImportFrequency, number> = {
  HIGH_FREQUENCY: 20,
  FREQUENT: 16,
  REGULAR: 12,
  OCCASIONAL: 7,
  UNKNOWN: 0,
};
const SIZE_POINTS: Record<CompanySize, number> = {
  ENTERPRISE: 4,
  LARGE: 4,
  MEDIUM: 4,
  SMALL: 3,
  MICRO: 2,
  UNKNOWN: 1,
};
const LEVEL_POINTS: Record<ProductMatchLevel, number> = {
  EXACT_HS: 30,
  HS_HEADING: 20,
  HS_CHAPTER: 10,
  CATEGORY: 8,
  ALIAS: 6,
  NONE: 0,
  NOT_APPLICABLE: 0,
};
const LEVEL_TEXT: Record<ProductMatchLevel, string> = {
  EXACT_HS: 'Exact HS code match',
  HS_HEADING: 'Same HS heading (4-digit)',
  HS_CHAPTER: 'Same HS chapter only (broad match)',
  CATEGORY: 'Product category match only',
  ALIAS: 'Product name match only',
  NONE: 'No product match',
  NOT_APPLICABLE: 'No product selected',
};

/** Product relevance for one activity: exact HS6/ITC-HS → heading → chapter → sourced category → normalized name alias. */
export function productLevel(
  ctx: MatchContext,
  a: MatchActivity,
  businessCategory: string | null,
): ProductMatchLevel {
  const code = a.hsCode?.replace(/\D/g, '') ?? '';
  const target = (ctx.itcHsCode ?? ctx.hsCode ?? '').replace(/\D/g, '');
  if (target && code) {
    const t6 = target.slice(0, 6);
    if (code.slice(0, 6) === t6 && t6.length === 6) return 'EXACT_HS';
    if (code.slice(0, 4) === target.slice(0, 4) && target.length >= 4)
      return 'HS_HEADING';
    if (code.slice(0, 2) === target.slice(0, 2)) return 'HS_CHAPTER';
  }
  if (
    ctx.categoryCode &&
    businessCategory &&
    ctx.categoryCode === businessCategory
  )
    return 'CATEGORY';
  if (ctx.productName) {
    const words = ctx.productName
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    const name = a.productName.toLowerCase();
    if (words.length && words.some((w) => name.includes(w))) return 'ALIAS';
  }
  return 'NONE';
}

const ORDER: ProductMatchLevel[] = [
  'EXACT_HS',
  'HS_HEADING',
  'HS_CHAPTER',
  'CATEGORY',
  'ALIAS',
  'NONE',
];

/**
 * Buyer–product match (0–100):
 * product relevance 30 (exact HS 30, heading 20, chapter 10, category 8, name alias 6)
 * + buyer type 15 (importer 15, distributor 14, wholesaler 13, agent 9, manufacturer 8, retailer 7, other 4, unknown 3)
 * + market 10 (selected country 10; else exporter target country 8; else 4)
 * + import activity 20 (frequency on the matched product: high 20, frequent 16, regular 12, occasional 7; listing only 3)
 * + recency 10 (last activity ≤12 months 10, ≤24 6, ≤36 3)
 * + business fit 10 (sourced category alignment 6 + stated size capacity ≤4)
 * + contact 5 (best contact confidence / 20).
 * Without product context the product component is excluded and the rest is rescaled to 100.
 */
export function buyerMatch(
  ctx: MatchContext,
  b: MatchBuyer,
  now = new Date(),
): BuyerMatch {
  const noProduct =
    !ctx.hsCode && !ctx.itcHsCode && !ctx.productName && !ctx.categoryCode;
  let best: { level: ProductMatchLevel; a: MatchActivity | null } = {
    level: noProduct ? 'NOT_APPLICABLE' : 'NONE',
    a: null,
  };
  if (!noProduct)
    for (const a of b.activities) {
      const l = productLevel(ctx, a, b.businessCategory);
      const better =
        ORDER.indexOf(l) < ORDER.indexOf(best.level) ||
        (l === best.level &&
          best.a &&
          a.activityType === 'TRADE_ACTIVITY' &&
          best.a.activityType !== 'TRADE_ACTIVITY');
      if (better) best = { level: l, a };
    }
  const relevant = noProduct
    ? b.activities
    : best.a
      ? b.activities.filter(
          (a) => productLevel(ctx, a, b.businessCategory) === best.level,
        )
      : [];
  const trade = relevant.filter((a) => a.activityType === 'TRADE_ACTIVITY');
  const freq = trade.reduce<ImportFrequency>(
    (f, a) =>
      FREQ_POINTS[a.importFrequency] > FREQ_POINTS[f] ? a.importFrequency : f,
    'UNKNOWN',
  );
  const last =
    trade
      .map((a) => a.lastActivityDate)
      .filter((d): d is Date => Boolean(d))
      .sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
  const age = monthsSince(last, now);

  const comps: BuyerMatchComponent[] = [];
  const reasons: ScoreReason[] = [];
  const add = (
    key: BuyerMatchComponent['key'],
    label: string,
    points: number,
    max: number,
    explanation: string,
  ) =>
    comps.push({
      key,
      label,
      points: Math.round(points * 10) / 10,
      max,
      explanation,
    });

  if (!noProduct) {
    const p = LEVEL_POINTS[best.level];
    const code = best.a?.hsCode;
    add(
      'product',
      'Product relevance',
      p,
      30,
      best.level === 'EXACT_HS' ? `Imports HS ${code}` : LEVEL_TEXT[best.level],
    );
    reasons.push(
      best.level === 'EXACT_HS'
        ? { text: `Deals in HS ${code}`, positive: true }
        : {
            text: LEVEL_TEXT[best.level],
            positive: best.level === 'HS_HEADING',
          },
    );
  }
  add(
    'buyerType',
    'Buyer type',
    TYPE_POINTS[b.buyerType],
    15,
    `${b.buyerType.toLowerCase()} buyer`,
  );
  if (b.buyerType === 'IMPORTER')
    reasons.push({ text: 'Direct importer', positive: true });
  const market = ctx.countryCode
    ? b.countryCode === ctx.countryCode
      ? 10
      : 0
    : ctx.targetCountries.includes(b.countryCode)
      ? 8
      : 4;
  add(
    'market',
    'Market',
    market,
    10,
    ctx.countryCode
      ? market
        ? 'Located in the selected country'
        : 'Outside the selected country'
      : market === 8
        ? 'In one of your target countries'
        : 'No market selected',
  );
  if (market >= 8)
    reasons.push({
      text: ctx.countryCode
        ? 'Located in selected target country'
        : 'Located in one of your target countries',
      positive: true,
    });
  const actPts = trade.length ? FREQ_POINTS[freq] : relevant.length ? 3 : 0;
  add(
    'activity',
    'Import activity',
    actPts,
    20,
    trade.length
      ? freq === 'UNKNOWN'
        ? 'Trade activity without frequency data'
        : `${freq.toLowerCase().replace('_', ' ')} importer`
      : relevant.length
        ? 'Business listing only — no trade activity'
        : 'No relevant activity',
  );
  if (trade.length && freq !== 'UNKNOWN')
    reasons.push({
      text: `${freq === 'HIGH_FREQUENCY' ? 'High-frequency' : freq.charAt(0) + freq.slice(1).toLowerCase()} importer`,
      positive: FREQ_POINTS[freq] >= 12,
    });
  else reasons.push({ text: 'No import history on record', positive: false });
  const rec =
    age === null ? 0 : age <= 12 ? 10 : age <= 24 ? 6 : age <= 36 ? 3 : 0;
  add(
    'recency',
    'Recency',
    rec,
    10,
    age === null
      ? 'Last activity unknown'
      : `Last activity ${Math.round(age)} months ago`,
  );
  if (rec === 10)
    reasons.push({ text: 'Active within last 12 months', positive: true });
  else if (age !== null)
    reasons.push({ text: 'No recent activity', positive: false });
  const catFit =
    ctx.categoryCode && b.businessCategory === ctx.categoryCode ? 6 : 0;
  add(
    'businessFit',
    'Business fit',
    catFit + SIZE_POINTS[b.companySize],
    10,
    `${catFit ? 'Category aligned' : 'Category not aligned or unknown'}; size ${b.companySize.toLowerCase()}`,
  );
  const cp =
    b.bestContactConfidence === null ? 0 : b.bestContactConfidence / 20;
  add(
    'contact',
    'Contact',
    cp,
    5,
    b.bestContactConfidence === null
      ? 'Contact unavailable'
      : `Best contact confidence ${b.bestContactConfidence}%`,
  );
  if (b.bestContactConfidence === null)
    reasons.push({ text: 'Contact unavailable', positive: false });
  else if (b.bestContactConfidence >= 75)
    reasons.push({ text: 'Reliable business contact', positive: true });

  const raw = comps.reduce((s, c) => s + c.points, 0);
  const max = comps.reduce((s, c) => s + c.max, 0);
  return {
    score: Math.round((100 * raw) / max),
    level: best.level,
    matchedHsCode: best.a?.hsCode ?? null,
    matchedProductName: best.a?.productName ?? null,
    components: comps,
    reasons,
    productContextMissing: noProduct,
  };
}
