import type { PaginationMeta } from "./api";
import type { FreshnessStatus } from "./enums";
import type { DataProvenance } from "./trade-data";

/**
 * Sprint 10 buyer-discovery contracts. Global buyer identity, trade
 * activity and contacts are kept separate from organization-private state
 * (saved, notes, CRM handoff). Buyer match (commercial relevance) and buyer
 * risk (credibility) are always separate scores.
 */

export const BuyerType = {
  IMPORTER: "IMPORTER",
  DISTRIBUTOR: "DISTRIBUTOR",
  WHOLESALER: "WHOLESALER",
  RETAILER: "RETAILER",
  MANUFACTURER: "MANUFACTURER",
  AGENT: "AGENT",
  OTHER: "OTHER",
  UNKNOWN: "UNKNOWN",
} as const;
export type BuyerType = (typeof BuyerType)[keyof typeof BuyerType];

export const CompanySize = {
  MICRO: "MICRO",
  SMALL: "SMALL",
  MEDIUM: "MEDIUM",
  LARGE: "LARGE",
  ENTERPRISE: "ENTERPRISE",
  UNKNOWN: "UNKNOWN",
} as const;
export type CompanySize = (typeof CompanySize)[keyof typeof CompanySize];

export const ImportFrequency = {
  OCCASIONAL: "OCCASIONAL",
  REGULAR: "REGULAR",
  FREQUENT: "FREQUENT",
  HIGH_FREQUENCY: "HIGH_FREQUENCY",
  UNKNOWN: "UNKNOWN",
} as const;
export type ImportFrequency = (typeof ImportFrequency)[keyof typeof ImportFrequency];

/** Where a buyer record came from. PUBLIC_REGISTRY = legal-entity registries such as GLEIF. */
export const BuyerSourceType = {
  PUBLIC_TRADE_DATA: "PUBLIC_TRADE_DATA",
  GOVERNMENT: "GOVERNMENT",
  PUBLIC_REGISTRY: "PUBLIC_REGISTRY",
  BUSINESS_DIRECTORY: "BUSINESS_DIRECTORY",
  COMMERCIAL_PROVIDER: "COMMERCIAL_PROVIDER",
  USER_PROVIDED: "USER_PROVIDED",
  MANUAL_IMPORT: "MANUAL_IMPORT",
  DEMO: "DEMO",
} as const;
export type BuyerSourceType = (typeof BuyerSourceType)[keyof typeof BuyerSourceType];

export const BuyerContactType = {
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  WHATSAPP: "WHATSAPP",
  WEBSITE_FORM: "WEBSITE_FORM",
  LINKEDIN_OR_SOCIAL_REFERENCE: "LINKEDIN_OR_SOCIAL_REFERENCE",
  OTHER: "OTHER",
} as const;
export type BuyerContactType = (typeof BuyerContactType)[keyof typeof BuyerContactType];

/** Contact-level verification. VERIFIED requires an actual verification mechanism recorded by the source. */
export const ContactVerificationStatus = {
  UNVERIFIED: "UNVERIFIED",
  SOURCE_LISTED: "SOURCE_LISTED",
  FORMAT_VALID: "FORMAT_VALID",
  DOMAIN_MATCHED: "DOMAIN_MATCHED",
  VERIFIED: "VERIFIED",
  INVALID: "INVALID",
  STALE: "STALE",
} as const;
export type ContactVerificationStatus = (typeof ContactVerificationStatus)[keyof typeof ContactVerificationStatus];

/** Company-level (identity) verification — separate from contact verification. Never a legal/KYC claim. */
export const BuyerVerificationStatus = {
  UNVERIFIED: "UNVERIFIED",
  PARTIALLY_VERIFIED: "PARTIALLY_VERIFIED",
  VERIFIED_SOURCE: "VERIFIED_SOURCE",
  MULTI_SOURCE_VERIFIED: "MULTI_SOURCE_VERIFIED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  SUSPICIOUS: "SUSPICIOUS",
} as const;
export type BuyerVerificationStatus = (typeof BuyerVerificationStatus)[keyof typeof BuyerVerificationStatus];

/** Plain-language labels — deliberately never "Verified buyer". */
export const BUYER_VERIFICATION_LABELS: Record<BuyerVerificationStatus, string> = {
  UNVERIFIED: "Identity not verified",
  PARTIALLY_VERIFIED: "Identity partially supported",
  VERIFIED_SOURCE: "Source-verified record",
  MULTI_SOURCE_VERIFIED: "Identity supported by multiple sources",
  NEEDS_REVIEW: "Needs review",
  SUSPICIOUS: "Potential concern — requires verification",
};

export const CONTACT_VERIFICATION_LABELS: Record<ContactVerificationStatus, string> = {
  UNVERIFIED: "Unverified",
  SOURCE_LISTED: "Listed by source",
  FORMAT_VALID: "Format valid",
  DOMAIN_MATCHED: "Company-domain match",
  VERIFIED: "Contact verified",
  INVALID: "Invalid",
  STALE: "Stale — re-verification recommended",
};

export const BuyerActivityType = {
  /** Shipment/customs/import records — the only kind shown as "import history". */
  TRADE_ACTIVITY: "TRADE_ACTIVITY",
  /** Directory/business listing saying the company deals in a product. Not import history. */
  BUSINESS_LISTING: "BUSINESS_LISTING",
} as const;
export type BuyerActivityType = (typeof BuyerActivityType)[keyof typeof BuyerActivityType];

export type DuplicateConfidence = "EXACT" | "HIGH" | "POSSIBLE" | "NONE";
export type BuyerRiskLevel = "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH";
export type ProductMatchLevel = "EXACT_HS" | "HS_HEADING" | "HS_CHAPTER" | "CATEGORY" | "ALIAS" | "NONE" | "NOT_APPLICABLE";
export type ContactAvailability = "VERIFIED" | "HAS_CONTACT" | "NONE";
export type BuyerSort = "BEST_MATCH" | "LOWEST_RISK" | "MOST_ACTIVE" | "CONTACT_CONFIDENCE" | "RECENTLY_VERIFIED";
export type VerifiedContactFilter = "ANY" | "VERIFIED" | "HAS_CONTACT" | "NO_CONTACT";
export type BuyerSourceFilter = "DEMO" | "USER_PROVIDED" | "REAL";

export interface BuyerSearchQuery {
  productId?: string;
  hsCode?: string;
  productName?: string;
  country?: string;
  buyerType?: BuyerType;
  companySize?: CompanySize;
  importFrequency?: ImportFrequency;
  verifiedContact?: VerifiedContactFilter;
  minMatchScore?: number;
  maxRisk?: number;
  source?: BuyerSourceFilter;
  sort?: BuyerSort;
  page?: number;
  pageSize?: number;
}

export interface ScoreReason {
  text: string;
  positive: boolean;
}

export interface BuyerMatchComponent {
  key: "product" | "buyerType" | "market" | "activity" | "recency" | "businessFit" | "contact";
  label: string;
  points: number;
  max: number;
  explanation: string;
}

export interface BuyerMatch {
  /** 0–100 commercial relevance for the selected product/market. */
  score: number;
  level: ProductMatchLevel;
  matchedHsCode: string | null;
  matchedProductName: string | null;
  components: BuyerMatchComponent[];
  reasons: ScoreReason[];
  /** True when no product context was given; product points excluded and the rest rescaled. */
  productContextMissing: boolean;
}

export interface BuyerRisk {
  /** 0 = low risk, 100 = high risk. Credibility, not commercial fit. */
  score: number;
  level: BuyerRiskLevel;
  reasons: ScoreReason[];
}

export interface BuyerWarning {
  code:
    | "WEBSITE_MALFORMED"
    | "WEBSITE_DOMAIN_MISMATCH"
    | "FREE_MAIL_PRIMARY"
    | "INVALID_CONTACT"
    | "CONFLICTING_COUNTRY"
    | "CONFLICTING_NAME"
    | "NO_TRACEABLE_SOURCE"
    | "POSSIBLE_DUPLICATE"
    | "STALE_SOURCE"
    | "STALE_CONTACT"
    | "IDENTITY_SOURCE_UNAVAILABLE";
  severity: "INFO" | "CAUTION" | "CONCERN";
  message: string;
}

export interface FieldConflict {
  field: string;
  chosen: string | null;
  uncertain: boolean;
  values: { value: string; sourceName: string; sourceUpdatedAt: string | null }[];
}

export interface BuyerContactView {
  id: string;
  name: string | null;
  role: string | null;
  contactType: BuyerContactType;
  /** Email/phone/URL as listed by the source — never inferred. */
  value: string;
  verificationStatus: ContactVerificationStatus;
  verificationLabel: string;
  confidence: number;
  confidenceLabel: "High" | "Medium" | "Low" | "Very low";
  evidence: string[];
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  isPrimary: boolean;
  sourceName: string;
  demo: boolean;
}

export interface BuyerActivityView {
  id: string;
  activityType: BuyerActivityType;
  hsCode: string | null;
  productName: string;
  importFrequency: ImportFrequency;
  transactionCount: number | null;
  importValueUsd: number | null;
  importQuantity: number | null;
  quantityUnit: string | null;
  originCountries: string[];
  firstActivityDate: string | null;
  lastActivityDate: string | null;
  periodLabel: string | null;
  sourceName: string;
  confidence: number;
}

export interface BuyerSourceView {
  id: string;
  sourceName: string;
  sourceType: BuyerSourceType;
  provenance: DataProvenance;
  externalId: string | null;
  rawName: string;
  rawBuyerType: string | null;
  sourceUrl: string | null;
  retrievedAt: string;
  sourceUpdatedAt: string | null;
  lastSeenAt: string;
  active: boolean;
  confidence: number;
}

export interface BuyerOrgState {
  shortlisted: boolean;
  savedAt: string | null;
  notes: string | null;
  notesUpdatedAt: string | null;
  lead: BuyerLeadView | null;
}

export interface BuyerLeadView {
  id: string;
  productId: string | null;
  countryCode: string;
  createdAt: string;
}

export interface BuyerSearchResult {
  id: string;
  name: string;
  countryCode: string;
  city: string | null;
  buyerType: BuyerType;
  companySize: CompanySize;
  importFrequency: ImportFrequency;
  match: Pick<BuyerMatch, "score" | "level" | "matchedHsCode" | "matchedProductName" | "productContextMissing"> & { reasons: ScoreReason[] };
  risk: BuyerRisk;
  verificationStatus: BuyerVerificationStatus;
  contactAvailability: ContactAvailability;
  contactConfidence: number | null;
  activitySummary: string;
  lastActivityDate: string | null;
  lastVerifiedAt: string | null;
  sourceCount: number;
  /** Identity-source provenance (Sprint 9 contract). */
  provenance: DataProvenance;
  freshness: FreshnessStatus;
  confidence: number;
  demo: boolean;
  userProvided: boolean;
  shortlisted: boolean;
  inCrm: boolean;
}

export interface BuyerProviderStatus {
  code: string;
  name: string;
  sourceType: BuyerSourceType;
  demo: boolean;
  enabled: boolean;
  status: "OK" | "UNAVAILABLE" | "DISABLED";
  lastSyncedAt: string | null;
  message: string | null;
}

export interface BuyerSearchContext {
  productId: string | null;
  productName: string | null;
  hsCode: string | null;
  countryCode: string | null;
}

export interface BuyerSearchResponse {
  items: BuyerSearchResult[];
  meta: PaginationMeta;
  context: BuyerSearchContext;
  /** True when any result comes from a demo/sample provider. */
  sampleData: boolean;
  providers: BuyerProviderStatus[];
  warnings: string[];
  scoreVersion: string;
  calculatedAt: string;
}

export interface BuyerDetail {
  id: string;
  name: string;
  countryCode: string;
  stateRegion: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  websiteDomain: string | null;
  buyerType: BuyerType;
  rawBuyerTypes: string[];
  businessCategory: string | null;
  companySize: CompanySize;
  /** Only when a source states it, e.g. "51-200 employees". */
  employeeRange: string | null;
  importFrequency: ImportFrequency;
  knownProducts: { hsCode: string | null; productName: string }[];
  demo: boolean;
  userProvided: boolean;
  active: boolean;
  context: BuyerSearchContext;
  match: BuyerMatch;
  risk: BuyerRisk;
  verification: { status: BuyerVerificationStatus; label: string; explanation: string; checkedAt: string | null };
  contactConfidence: number | null;
  warnings: BuyerWarning[];
  conflicts: FieldConflict[];
  possibleDuplicates: { id: string; name: string; city: string | null; reason: string }[];
  tradeActivity: BuyerActivityView[];
  businessListings: BuyerActivityView[];
  contacts: BuyerContactView[];
  sources: BuyerSourceView[];
  /** Identity, trade activity and contacts can come from different sources. */
  provenance: { identity: DataProvenance; activity: DataProvenance | null; contacts: DataProvenance | null };
  orgState: BuyerOrgState;
  enrichment: { enrichedAt: string | null; expiresAt: string | null; version: string; warnings: string[] };
  scoreVersion: string;
  calculatedAt: string;
  datasetVersion: string;
}

export interface SavedBuyerItem {
  buyer: BuyerSearchResult;
  savedAt: string;
  savedBy: string | null;
  productId: string | null;
  productName: string | null;
  contextCountryCode: string | null;
  contactCount: number;
  lead: BuyerLeadView | null;
}

export interface SavedBuyersResponse {
  items: SavedBuyerItem[];
  meta: PaginationMeta;
  sampleData: boolean;
}

export interface AddToCrmResult {
  leadId: string;
  alreadyAdded: boolean;
  createdAt: string;
}

export interface CreateManualBuyerInput {
  name: string;
  countryCode: string;
  city?: string;
  website?: string;
  buyerType?: BuyerType;
  businessCategory?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactName?: string;
  contactRole?: string;
  hsCode?: string;
  productName?: string;
  notes?: string;
}
