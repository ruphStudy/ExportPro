/**
 * String-literal mirrors of the Prisma enums in apps/api/prisma/schema.prisma.
 * Duplicated intentionally: the frontend must never depend on @prisma/client
 * (that would couple it to the persistence layer and to a Node-only package).
 * If you change a Prisma enum, update the matching one here in the same commit.
 */

export const TradeDirection = {
  EXPORT: "EXPORT",
  IMPORT: "IMPORT",
} as const;
export type TradeDirection = (typeof TradeDirection)[keyof typeof TradeDirection];

/** Sprint 2 roles. MEMBER (Sprint 1 placeholder) no longer exists — see ARCHITECTURE.md "Roles & Permissions". */
export const MembershipRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  EXPORT_MANAGER: "EXPORT_MANAGER",
  SALES: "SALES",
  DOCUMENTATION: "DOCUMENTATION",
  LOGISTICS: "LOGISTICS",
  FINANCE: "FINANCE",
  VIEWER: "VIEWER",
} as const;
export type MembershipRole = (typeof MembershipRole)[keyof typeof MembershipRole];

export const MembershipStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  REMOVED: "REMOVED",
} as const;
export type MembershipStatus = (typeof MembershipStatus)[keyof typeof MembershipStatus];

/** How an organization (tenant) is structured as a business entity. */
export const BusinessType = {
  MANUFACTURER: "MANUFACTURER",
  MERCHANT_EXPORTER: "MERCHANT_EXPORTER",
  TRADER: "TRADER",
  IMPORTER: "IMPORTER",
  EXPORTER_IMPORTER: "EXPORTER_IMPORTER",
} as const;
export type BusinessType = (typeof BusinessType)[keyof typeof BusinessType];

/**
 * Conceptual trade-entity roles a counterparty can play (future
 * buyers/suppliers module). Kept as a type-only taxonomy — no table
 * backs this yet. Distinct from BusinessType, which classifies the
 * tenant's own organization.
 */
export const TradeEntityKind = {
  EXPORTER: "EXPORTER",
  IMPORTER: "IMPORTER",
  MANUFACTURER: "MANUFACTURER",
  MERCHANT_EXPORTER: "MERCHANT_EXPORTER",
  TRADER: "TRADER",
  SUPPLIER: "SUPPLIER",
  BUYER: "BUYER",
} as const;
export type TradeEntityKind = (typeof TradeEntityKind)[keyof typeof TradeEntityKind];

// --- Sprint 3: exporter onboarding -----------------------------------

export const OnboardingStatus = {
  NOT_STARTED: "NOT_STARTED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
} as const;
export type OnboardingStatus = (typeof OnboardingStatus)[keyof typeof OnboardingStatus];

export const ExportExperience = {
  NONE: "NONE",
  LESS_THAN_1_YEAR: "LESS_THAN_1_YEAR",
  ONE_TO_THREE_YEARS: "ONE_TO_THREE_YEARS",
  THREE_TO_FIVE_YEARS: "THREE_TO_FIVE_YEARS",
  FIVE_TO_TEN_YEARS: "FIVE_TO_TEN_YEARS",
  TEN_PLUS_YEARS: "TEN_PLUS_YEARS",
} as const;
export type ExportExperience = (typeof ExportExperience)[keyof typeof ExportExperience];

export const RiskTolerance = {
  CONSERVATIVE: "CONSERVATIVE",
  BALANCED: "BALANCED",
  AGGRESSIVE: "AGGRESSIVE",
} as const;
export type RiskTolerance = (typeof RiskTolerance)[keyof typeof RiskTolerance];

export const InvestmentRange = {
  UNDER_1L: "UNDER_1L",
  L1_5: "L1_5",
  L5_10: "L5_10",
  L10_25: "L10_25",
  L25_50: "L25_50",
  L50_1CR: "L50_1CR",
  ABOVE_1CR: "ABOVE_1CR",
} as const;
export type InvestmentRange = (typeof InvestmentRange)[keyof typeof InvestmentRange];

export const ShipmentPreference = {
  SAMPLES_ONLY: "SAMPLES_ONLY",
  COURIER_PARCEL: "COURIER_PARCEL",
  UNDER_100KG: "UNDER_100KG",
  KG_100_500: "KG_100_500",
  KG_500_1MT: "KG_500_1MT",
  MT_1_5: "MT_1_5",
  MT_5_20: "MT_5_20",
  CONTAINER_SCALE: "CONTAINER_SCALE",
  FLEXIBLE: "FLEXIBLE",
} as const;
export type ShipmentPreference = (typeof ShipmentPreference)[keyof typeof ShipmentPreference];

export const LogisticsMode = {
  SEA: "SEA",
  AIR: "AIR",
  COURIER: "COURIER",
  ROAD: "ROAD",
  FLEXIBLE: "FLEXIBLE",
} as const;
export type LogisticsMode = (typeof LogisticsMode)[keyof typeof LogisticsMode];

export const ExportGoal = {
  FIND_FIRST_PRODUCT: "FIND_FIRST_PRODUCT",
  START_EXPORTING_EXISTING: "START_EXPORTING_EXISTING",
  FIND_BUYERS: "FIND_BUYERS",
  EXPAND_COUNTRIES: "EXPAND_COUNTRIES",
  INCREASE_REVENUE: "INCREASE_REVENUE",
  IMPROVE_PROFITABILITY: "IMPROVE_PROFITABILITY",
  REDUCE_RISK: "REDUCE_RISK",
  AUTOMATE_OPERATIONS: "AUTOMATE_OPERATIONS",
  BUILD_REPEAT_BUSINESS: "BUILD_REPEAT_BUSINESS",
} as const;
export type ExportGoal = (typeof ExportGoal)[keyof typeof ExportGoal];

export const ProductInterestType = {
  CURRENT: "CURRENT",
  INTERESTED: "INTERESTED",
} as const;
export type ProductInterestType = (typeof ProductInterestType)[keyof typeof ProductInterestType];

export const CountryRelation = {
  CURRENT: "CURRENT",
  INTERESTED: "INTERESTED",
} as const;
export type CountryRelation = (typeof CountryRelation)[keyof typeof CountryRelation];

/** IEC / GST / FSSAI / APEDA share one model — see ARCHITECTURE.md "Registrations". */
export const RegistrationType = {
  IEC: "IEC",
  GST: "GST",
  FSSAI: "FSSAI",
  APEDA: "APEDA",
} as const;
export type RegistrationType = (typeof RegistrationType)[keyof typeof RegistrationType];

export const RegistrationStatus = {
  NOT_APPLICABLE: "NOT_APPLICABLE",
  NOT_APPLIED: "NOT_APPLIED",
  APPLIED_PENDING: "APPLIED_PENDING",
  AVAILABLE: "AVAILABLE",
  NOT_SURE: "NOT_SURE",
} as const;
export type RegistrationStatus = (typeof RegistrationStatus)[keyof typeof RegistrationStatus];

/**
 * Deliberately conservative — see ARCHITECTURE.md "No Fake Government
 * Verification". VERIFIED is never set by anything in Sprint 3; it
 * exists only so the type is ready for a real verification integration later.
 */
export const VerificationStatus = {
  NOT_PROVIDED: "NOT_PROVIDED",
  USER_DECLARED: "USER_DECLARED",
  FORMAT_VALID: "FORMAT_VALID",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  PENDING_REVIEW: "PENDING_REVIEW",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const CertificationStatus = {
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  PENDING: "PENDING",
} as const;
export type CertificationStatus = (typeof CertificationStatus)[keyof typeof CertificationStatus];

export const OnboardingDocumentType = {
  IEC: "IEC",
  GST: "GST",
  FSSAI: "FSSAI",
  APEDA: "APEDA",
  CERTIFICATE: "CERTIFICATE",
} as const;
export type OnboardingDocumentType = (typeof OnboardingDocumentType)[keyof typeof OnboardingDocumentType];

/** Where a readiness-relevant value came from — see ARCHITECTURE.md "Future Data Transparency Preparation". */
export const SourceType = {
  USER_PROVIDED: "USER_PROVIDED",
} as const;
export type SourceType = (typeof SourceType)[keyof typeof SourceType];

// --- Sprint 4: opportunity discovery -----------------------------------

/** Sprint 4 only ever produces DEMO — see ARCHITECTURE.md "No Fake Government Verification" (same principle applied to trade data). */
export const OpportunitySourceType = {
  DEMO: "DEMO",
  OFFICIAL: "OFFICIAL",
  PUBLIC_DATA: "PUBLIC_DATA",
  PARTNER: "PARTNER",
  INTERNAL: "INTERNAL",
  AI_DERIVED: "AI_DERIVED",
} as const;
export type OpportunitySourceType = (typeof OpportunitySourceType)[keyof typeof OpportunitySourceType];

export const FreshnessStatus = {
  FRESH: "FRESH",
  RECENT: "RECENT",
  STALE: "STALE",
  VERY_STALE: "VERY_STALE",
  UNKNOWN: "UNKNOWN",
} as const;
export type FreshnessStatus = (typeof FreshnessStatus)[keyof typeof FreshnessStatus];

export const CompetitionLevel = {
  LOW: "LOW",
  MODERATE: "MODERATE",
  HIGH: "HIGH",
} as const;
export type CompetitionLevel = (typeof CompetitionLevel)[keyof typeof CompetitionLevel];

export const ComplianceDifficulty = {
  EASY: "EASY",
  MODERATE: "MODERATE",
  COMPLEX: "COMPLEX",
} as const;
export type ComplianceDifficulty = (typeof ComplianceDifficulty)[keyof typeof ComplianceDifficulty];

export const SeasonalityLevel = {
  LOW: "LOW",
  MODERATE: "MODERATE",
  HIGH: "HIGH",
} as const;
export type SeasonalityLevel = (typeof SeasonalityLevel)[keyof typeof SeasonalityLevel];

export const OpportunitySort = {
  BEST: "BEST",
  GROWTH: "GROWTH",
  LOW_COMPETITION: "LOW_COMPETITION",
  HIGH_MARGIN: "HIGH_MARGIN",
  CONFIDENCE: "CONFIDENCE",
  RECENT: "RECENT",
} as const;
export type OpportunitySort = (typeof OpportunitySort)[keyof typeof OpportunitySort];

// --- Sprint 5: product analysis & classification ------------------------

export const ProductInputType = {
  PRODUCT_NAME: "PRODUCT_NAME",
  HS_CODE: "HS_CODE",
  ITC_HS_CODE: "ITC_HS_CODE",
  DESCRIPTION: "DESCRIPTION",
} as const;
export type ProductInputType = (typeof ProductInputType)[keyof typeof ProductInputType];

/** HS = international 2/4/6-digit nomenclature; ITC_HS_INDIA = India's 8-digit national extension. */
export const CodeSystem = {
  HS: "HS",
  ITC_HS_INDIA: "ITC_HS_INDIA",
} as const;
export type CodeSystem = (typeof CodeSystem)[keyof typeof CodeSystem];

/**
 * OFFICIALLY_VERIFIED exists only for future-proofing — no Sprint 5 code
 * path sets it. USER_CONFIRMED means "use this for platform analysis",
 * never customs/government verification.
 */
export const ProductClassificationStatus = {
  AI_SUGGESTED: "AI_SUGGESTED",
  USER_SELECTED: "USER_SELECTED",
  USER_CONFIRMED: "USER_CONFIRMED",
  OFFICIALLY_VERIFIED: "OFFICIALLY_VERIFIED",
} as const;
export type ProductClassificationStatus = (typeof ProductClassificationStatus)[keyof typeof ProductClassificationStatus];

/** Where a classification candidate (and therefore a saved product's code) came from. */
export const ClassificationSource = {
  AI_SUGGESTED: "AI_SUGGESTED",
  REFERENCE_LOOKUP: "REFERENCE_LOOKUP",
  USER_SELECTED: "USER_SELECTED",
} as const;
export type ClassificationSource = (typeof ClassificationSource)[keyof typeof ClassificationSource];

export const AmbiguityStatus = {
  CLEAR: "CLEAR",
  AMBIGUOUS: "AMBIGUOUS",
  INSUFFICIENT_INFORMATION: "INSUFFICIENT_INFORMATION",
} as const;
export type AmbiguityStatus = (typeof AmbiguityStatus)[keyof typeof AmbiguityStatus];

export const ProductAnalysisStatus = {
  PENDING_REVIEW: "PENDING_REVIEW",
  CONFIRMED: "CONFIRMED",
} as const;
export type ProductAnalysisStatus = (typeof ProductAnalysisStatus)[keyof typeof ProductAnalysisStatus];

/** DEVELOPMENT_DEMO = deterministic rule-based dev provider, never a real AI model. */
export const AnalysisSourceType = {
  AI_DERIVED: "AI_DERIVED",
  DEVELOPMENT_DEMO: "DEVELOPMENT_DEMO",
  REFERENCE_LOOKUP: "REFERENCE_LOOKUP",
} as const;
export type AnalysisSourceType = (typeof AnalysisSourceType)[keyof typeof AnalysisSourceType];

export const TariffReferenceSourceType = {
  OFFICIAL: "OFFICIAL",
  DEVELOPMENT_SAMPLE: "DEVELOPMENT_SAMPLE",
} as const;
export type TariffReferenceSourceType = (typeof TariffReferenceSourceType)[keyof typeof TariffReferenceSourceType];
