import type { CostBasis, CostConfidence, CostingStatus, CostSourceType, FreightQuoteType, PricingFeasibility, PricingMode, TransportMode } from "@exportpro/types";

type Variant = "neutral" | "success" | "warning" | "danger" | "info";

export const STATUS_LABELS: Record<CostingStatus, { label: string; variant: Variant }> = {
  DRAFT: { label: "Draft", variant: "neutral" },
  READY: { label: "Ready", variant: "info" },
  LOCKED: { label: "Locked", variant: "success" },
  ARCHIVED: { label: "Archived", variant: "warning" },
};

export const BASIS_LABELS: Record<CostBasis, string> = {
  FIXED: "Fixed amount",
  PER_UNIT: "Per quantity unit",
  PER_KG: "Per kg",
  PER_MT: "Per MT",
  PER_CARTON: "Per carton",
  PER_CONTAINER: "Per container",
  PERCENTAGE: "Percentage of a base",
};

export const SOURCE_LABELS: Record<CostSourceType, string> = {
  USER_ENTERED: "User entered",
  SUPPLIER_QUOTE: "Supplier quote",
  FREIGHT_QUOTE: "Freight quote",
  SYSTEM_DERIVED: "System derived",
  PUBLIC_DATA: "Public data",
  IMPORTED: "Imported",
  DEMO: "Demo",
};

export const CONFIDENCE_LABELS: Record<CostConfidence, { label: string; variant: Variant }> = {
  CONFIRMED: { label: "Confirmed", variant: "success" },
  ESTIMATE: { label: "Estimate", variant: "warning" },
  UNKNOWN: { label: "Unknown", variant: "neutral" },
};

export const FREIGHT_QUOTE_LABELS: Record<FreightQuoteType, string> = {
  MANUAL_ESTIMATE: "Manual estimate (not a quote)",
  FORWARDER_QUOTE: "Forwarder quote",
  PROVIDER_RATE: "Provider rate",
  ACTUAL: "Actual (invoiced)",
};

export const TRANSPORT_LABELS: Record<TransportMode, string> = { SEA: "Sea", AIR: "Air", ROAD: "Road", RAIL: "Rail", MULTIMODAL: "Multimodal", OTHER: "Other" };

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  MARGIN: "Desired margin % (profit ÷ selling price)",
  MARKUP: "Markup % (profit ÷ cost)",
  TARGET_PRICE: "Target selling price per unit",
};

export const FEASIBILITY_LABELS: Record<PricingFeasibility, { label: string; variant: Variant }> = {
  PROFITABLE: { label: "Profitable", variant: "success" },
  THIN_MARGIN: { label: "Thin margin", variant: "warning" },
  BREAK_EVEN: { label: "Break-even", variant: "info" },
  LOSS: { label: "Loss", variant: "danger" },
};
