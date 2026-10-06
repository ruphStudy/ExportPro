import {
  confidenceLevel,
  PRODUCT_CATEGORIES,
  type AmbiguityStatus,
  type ClassificationSource,
  type CodeSystem,
  type ProductClassificationStatus,
  type ProductInputType,
} from "@exportpro/types";
import type { BadgeProps } from "@/components/ui/badge";

type Variant = NonNullable<BadgeProps["variant"]>;

export function categoryLabel(code: string | null | undefined): string {
  if (!code) return "Uncategorized";
  return PRODUCT_CATEGORIES.find((c) => c.code === code)?.label ?? code;
}

export const INPUT_TYPE_LABELS: Record<ProductInputType, string> = {
  PRODUCT_NAME: "Product name",
  HS_CODE: "HS code",
  ITC_HS_CODE: "ITC-HS code",
  DESCRIPTION: "Product description",
};

export const CODE_SYSTEM_LABELS: Record<CodeSystem, string> = {
  HS: "HS",
  ITC_HS_INDIA: "ITC-HS (India)",
};

export const CLASSIFICATION_STATUS_LABELS: Record<ProductClassificationStatus, { label: string; variant: Variant }> = {
  AI_SUGGESTED: { label: "AI suggested", variant: "info" },
  USER_SELECTED: { label: "Selected — not confirmed", variant: "warning" },
  USER_CONFIRMED: { label: "Confirmed for platform use", variant: "success" },
  // Never set in this release; kept so the label exists if official verification is added.
  OFFICIALLY_VERIFIED: { label: "Officially verified", variant: "success" },
};

export const CLASSIFICATION_SOURCE_LABELS: Record<ClassificationSource, string> = {
  AI_SUGGESTED: "AI suggestion",
  REFERENCE_LOOKUP: "Entered code (reference lookup)",
  USER_SELECTED: "Selected manually",
};

export const AMBIGUITY_LABELS: Record<AmbiguityStatus, { label: string; variant: Variant }> = {
  CLEAR: { label: "No major ambiguity", variant: "success" },
  AMBIGUOUS: { label: "More information needed", variant: "warning" },
  INSUFFICIENT_INFORMATION: { label: "Insufficient information", variant: "danger" },
};

export function confidenceDisplay(confidence: number | null): { label: string; variant: Variant } {
  if (confidence === null) return { label: "No AI confidence", variant: "neutral" };
  const level = confidenceLevel(confidence);
  if (level === "HIGH") return { label: `High confidence · ${confidence}`, variant: "success" };
  if (level === "MEDIUM") return { label: `Medium confidence · ${confidence}`, variant: "warning" };
  return { label: `Low confidence · ${confidence}`, variant: "danger" };
}

/** Prefills Analyze Product from an Export Setup product interest (the interest itself is never modified here). */
export function analyzeInterestHref(interest: { id: string; name: string; category: string | null }): string {
  const params = new URLSearchParams({ input: interest.name, productInterestId: interest.id });
  if (interest.category) params.set("category", interest.category);
  return `/products/analyze?${params}`;
}
