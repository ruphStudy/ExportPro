import type { BuyerRiskLevel, BuyerType, BuyerVerificationStatus, CompanySize, ContactAvailability, ImportFrequency, ProductMatchLevel } from "@exportpro/types";

type Variant = "neutral" | "success" | "warning" | "danger" | "info";

export const BUYER_TYPE_LABELS: Record<BuyerType, string> = {
  IMPORTER: "Importer",
  DISTRIBUTOR: "Distributor",
  WHOLESALER: "Wholesaler",
  RETAILER: "Retailer",
  MANUFACTURER: "Manufacturer",
  AGENT: "Agent",
  OTHER: "Other",
  UNKNOWN: "Type unknown",
};

export const COMPANY_SIZE_LABELS: Record<CompanySize, string> = {
  MICRO: "Micro",
  SMALL: "Small",
  MEDIUM: "Medium",
  LARGE: "Large",
  ENTERPRISE: "Enterprise",
  UNKNOWN: "Size unknown",
};

export const FREQUENCY_LABELS: Record<ImportFrequency, string> = {
  OCCASIONAL: "Occasional importer",
  REGULAR: "Regular importer",
  FREQUENT: "Frequent importer",
  HIGH_FREQUENCY: "High-frequency importer",
  UNKNOWN: "Import frequency unavailable",
};

export const RISK_LABELS: Record<BuyerRiskLevel, { label: string; variant: Variant }> = {
  LOW: { label: "Low risk", variant: "success" },
  MODERATE: { label: "Moderate risk", variant: "info" },
  HIGH: { label: "High risk", variant: "warning" },
  VERY_HIGH: { label: "Very high risk", variant: "danger" },
};

export const VERIFICATION_VARIANTS: Record<BuyerVerificationStatus, Variant> = {
  UNVERIFIED: "neutral",
  PARTIALLY_VERIFIED: "neutral",
  VERIFIED_SOURCE: "info",
  MULTI_SOURCE_VERIFIED: "success",
  NEEDS_REVIEW: "warning",
  SUSPICIOUS: "danger",
};

export const CONTACT_AVAILABILITY_LABELS: Record<ContactAvailability, string> = {
  VERIFIED: "Verified contact",
  HAS_CONTACT: "Contact listed (not verified)",
  NONE: "Contact not available",
};

export const MATCH_LEVEL_LABELS: Record<ProductMatchLevel, string> = {
  EXACT_HS: "Exact HS match",
  HS_HEADING: "HS heading match",
  HS_CHAPTER: "Broad HS chapter match",
  CATEGORY: "Category match only",
  ALIAS: "Product-name match only",
  NONE: "No product match",
  NOT_APPLICABLE: "No product selected",
};

export const matchLabel = (score: number) => (score >= 80 ? "Strong" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Weak");
