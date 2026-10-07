import type { PaginationMeta } from "./api";

/**
 * Sprint 14 export costing contracts. All money values travel as decimal
 * STRINGS (never JS floats) and are computed only by the backend's
 * deterministic calculator. `null` always means "not provided" — distinct
 * from an intentionally entered zero.
 */

export const COSTING_FORMULA_VERSION = "export-costing-v1";

export const CostingStatus = { DRAFT: "DRAFT", READY: "READY", LOCKED: "LOCKED", ARCHIVED: "ARCHIVED" } as const;
export type CostingStatus = (typeof CostingStatus)[keyof typeof CostingStatus];

export const CostCategory = {
  PROCUREMENT: "PROCUREMENT",
  PACKAGING: "PACKAGING",
  INLAND_TRANSPORT: "INLAND_TRANSPORT",
  INSPECTION: "INSPECTION",
  CHA: "CHA",
  CUSTOMS: "CUSTOMS",
  PORT: "PORT",
  FREIGHT: "FREIGHT",
  INSURANCE: "INSURANCE",
  BANKING: "BANKING",
  CERTIFICATES: "CERTIFICATES",
  MISCELLANEOUS: "MISCELLANEOUS",
} as const;
export type CostCategory = (typeof CostCategory)[keyof typeof CostCategory];

export const COST_CATEGORY_ORDER: CostCategory[] = [
  "PROCUREMENT",
  "PACKAGING",
  "INLAND_TRANSPORT",
  "INSPECTION",
  "CHA",
  "CUSTOMS",
  "PORT",
  "FREIGHT",
  "INSURANCE",
  "BANKING",
  "CERTIFICATES",
  "MISCELLANEOUS",
];

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  PROCUREMENT: "Procurement / product",
  PACKAGING: "Packaging",
  INLAND_TRANSPORT: "Inland transport",
  INSPECTION: "Inspection",
  CHA: "CHA (customs house agent)",
  CUSTOMS: "Customs / statutory charges",
  PORT: "Port & terminal",
  FREIGHT: "Main freight",
  INSURANCE: "Cargo insurance",
  BANKING: "Banking & collection",
  CERTIFICATES: "Certificates & documents",
  MISCELLANEOUS: "Miscellaneous",
};

/** Categories a LOGISTICS user may edit (with costing.edit_logistics). */
export const LOGISTICS_COST_CATEGORIES: CostCategory[] = ["INLAND_TRANSPORT", "CHA", "PORT", "FREIGHT", "INSURANCE"];

export const CostBasis = {
  FIXED: "FIXED",
  PER_UNIT: "PER_UNIT",
  PER_KG: "PER_KG",
  PER_MT: "PER_MT",
  PER_CARTON: "PER_CARTON",
  PER_CONTAINER: "PER_CONTAINER",
  PERCENTAGE: "PERCENTAGE",
} as const;
export type CostBasis = (typeof CostBasis)[keyof typeof CostBasis];

/** What a PERCENTAGE line is a percentage of (always explicit — never assumed). */
export const PercentageBase = {
  PROCUREMENT_VALUE: "PROCUREMENT_VALUE",
  PRE_INSURANCE_COST: "PRE_INSURANCE_COST",
} as const;
export type PercentageBase = (typeof PercentageBase)[keyof typeof PercentageBase];

export const CostSourceType = {
  USER_ENTERED: "USER_ENTERED",
  SUPPLIER_QUOTE: "SUPPLIER_QUOTE",
  FREIGHT_QUOTE: "FREIGHT_QUOTE",
  SYSTEM_DERIVED: "SYSTEM_DERIVED",
  PUBLIC_DATA: "PUBLIC_DATA",
  IMPORTED: "IMPORTED",
  DEMO: "DEMO",
} as const;
export type CostSourceType = (typeof CostSourceType)[keyof typeof CostSourceType];

export const CostConfidence = { CONFIRMED: "CONFIRMED", ESTIMATE: "ESTIMATE", UNKNOWN: "UNKNOWN" } as const;
export type CostConfidence = (typeof CostConfidence)[keyof typeof CostConfidence];

/** Freight quote kind — a manual estimate is never shown as a verified quote. */
export const FreightQuoteType = {
  MANUAL_ESTIMATE: "MANUAL_ESTIMATE",
  FORWARDER_QUOTE: "FORWARDER_QUOTE",
  PROVIDER_RATE: "PROVIDER_RATE",
  ACTUAL: "ACTUAL",
} as const;
export type FreightQuoteType = (typeof FreightQuoteType)[keyof typeof FreightQuoteType];

export const TransportMode = { SEA: "SEA", AIR: "AIR", ROAD: "ROAD", RAIL: "RAIL", MULTIMODAL: "MULTIMODAL", OTHER: "OTHER" } as const;
export type TransportMode = (typeof TransportMode)[keyof typeof TransportMode];

/** Initially supported; the policy table is the extension point for further Incoterms®. */
export const Incoterm = { EXW: "EXW", FCA: "FCA", FOB: "FOB", CFR: "CFR", CIF: "CIF" } as const;
export type Incoterm = (typeof Incoterm)[keyof typeof Incoterm];
export const INCOTERM_ORDER: Incoterm[] = ["EXW", "FCA", "FOB", "CFR", "CIF"];

export const CostingQuantityUnit = { KG: "KG", MT: "MT", UNIT: "UNIT", CARTON: "CARTON", CONTAINER: "CONTAINER" } as const;
export type CostingQuantityUnit = (typeof CostingQuantityUnit)[keyof typeof CostingQuantityUnit];

export const PricingMode = { MARGIN: "MARGIN", MARKUP: "MARKUP", TARGET_PRICE: "TARGET_PRICE" } as const;
export type PricingMode = (typeof PricingMode)[keyof typeof PricingMode];

export const PricingFeasibility = { PROFITABLE: "PROFITABLE", THIN_MARGIN: "THIN_MARGIN", BREAK_EVEN: "BREAK_EVEN", LOSS: "LOSS" } as const;
export type PricingFeasibility = (typeof PricingFeasibility)[keyof typeof PricingFeasibility];

export const FxSourceType = { MANUAL: "MANUAL", PUBLIC_API: "PUBLIC_API", COMMERCIAL_PROVIDER: "COMMERCIAL_PROVIDER", BANK_RATE: "BANK_RATE", DEMO: "DEMO" } as const;
export type FxSourceType = (typeof FxSourceType)[keyof typeof FxSourceType];

export type ComparisonObjective = "LOWEST_COST" | "HIGHEST_MARGIN" | "HIGHEST_PROFIT" | "CLOSEST_TO_TARGET";

/** ISO 4217 codes supported in costing (symbols are display-only). */
export const COSTING_CURRENCIES: { code: string; symbol: string; label: string }[] = [
  { code: "INR", symbol: "₹", label: "Indian rupee" },
  { code: "USD", symbol: "$", label: "US dollar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "Pound sterling" },
  { code: "AED", symbol: "AED", label: "UAE dirham" },
  { code: "SAR", symbol: "SAR", label: "Saudi riyal" },
  { code: "CNY", symbol: "CN¥", label: "Chinese yuan" },
  { code: "JPY", symbol: "¥", label: "Japanese yen" },
  { code: "AUD", symbol: "A$", label: "Australian dollar" },
  { code: "CAD", symbol: "C$", label: "Canadian dollar" },
  { code: "SGD", symbol: "S$", label: "Singapore dollar" },
  { code: "CHF", symbol: "CHF", label: "Swiss franc" },
  { code: "BDT", symbol: "৳", label: "Bangladeshi taka" },
  { code: "LKR", symbol: "Rs", label: "Sri Lankan rupee" },
  { code: "NPR", symbol: "Rs", label: "Nepalese rupee" },
  { code: "ZAR", symbol: "R", label: "South African rand" },
  { code: "NGN", symbol: "₦", label: "Nigerian naira" },
  { code: "KES", symbol: "KSh", label: "Kenyan shilling" },
];
export const isCostingCurrency = (c: string) => COSTING_CURRENCIES.some((x) => x.code === c);

export interface IncotermPolicyView {
  incoterm: Incoterm;
  label: string;
  explanation: string;
  included: CostCategory[];
  excluded: CostCategory[];
  /** Included by default; a line may explicitly opt out (or in, for excluded-by-default conditionals). */
  conditional: { category: CostCategory; defaultIncluded: boolean }[];
  /** Categories that must have a provided amount before READY. */
  required: CostCategory[];
}

export interface FxRateSnapshot {
  id: string;
  /** 1 baseCurrency = rate × quoteCurrency */
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  sourceType: FxSourceType;
  sourceLabel: string | null;
  sourceDate: string;
  capturedAt: string;
  isManual: boolean;
  createdBy: string | null;
}

export interface CostingLineItem {
  id: string;
  scenarioId: string;
  category: CostCategory;
  label: string;
  /** null = NOT PROVIDED (distinct from "0"). */
  amount: string | null;
  currency: string;
  basis: CostBasis;
  percentageBase: PercentageBase | null;
  wastagePercent: string | null;
  sourceType: CostSourceType;
  confidence: CostConfidence;
  freightQuoteType: FreightQuoteType | null;
  quoteReference: string | null;
  carrier: string | null;
  transitDays: number | null;
  quoteDate: string | null;
  validUntil: string | null;
  routeNotes: string | null;
  notes: string | null;
  /** Only for conditional categories: null = policy default. */
  includeOverride: boolean | null;
  sortOrder: number;
}

export interface ScenarioFxSelection {
  currency: string;
  snapshot: FxRateSnapshot;
}

export interface CostingScenario {
  id: string;
  costingId: string;
  name: string;
  isBase: boolean;
  sortOrder: number;
  quantity: string;
  quantityUnit: CostingQuantityUnit;
  /** Explicit weight when quantity is not in KG/MT — required for PER_KG / PER_MT lines. */
  netWeightKg: string | null;
  cartonCount: string | null;
  containerCount: string | null;
  incoterm: Incoterm;
  incotermPlace: string | null;
  originPort: string | null;
  destinationPort: string | null;
  transportMode: TransportMode | null;
  supplierLabel: string | null;
  pricingMode: PricingMode;
  /** Margin %, markup % or target price per unit (quote currency) depending on mode. */
  pricingValue: string | null;
  buyerTargetPrice: string | null;
  notes: string | null;
  fx: ScenarioFxSelection[];
  lines: CostingLineItem[];
  result: CostingResult | null;
  calculatedAt: string | null;
  updatedAt: string;
}

export interface CostingIssue {
  code:
    | "QUANTITY_INVALID"
    | "AMOUNT_MISSING"
    | "FX_REQUIRED"
    | "BASIS_QUANTITY_MISSING"
    | "PERCENTAGE_BASE_MISSING"
    | "REQUIRED_CATEGORY_MISSING"
    | "PROCUREMENT_MISSING"
    | "PRICING_INPUT_MISSING"
    | "PRICING_FX_REQUIRED"
    | "QUOTE_EXPIRED"
    | "ESTIMATE_USED"
    | "MARGIN_INVALID";
  blocking: boolean;
  message: string;
  lineId?: string;
  category?: CostCategory;
  currency?: string;
}

export interface LineCalculation {
  lineId: string;
  category: CostCategory;
  label: string;
  included: boolean;
  inclusionReason: string;
  /** Extended amount in the line's own currency (null if not computable). */
  extendedOriginal: string | null;
  originalCurrency: string;
  /** Converted to the calculation currency. */
  converted: string | null;
  formula: string;
  fxRateUsed: string | null;
  confidence: CostConfidence;
  sourceType: CostSourceType;
}

export interface CategoryBreakdown {
  category: CostCategory;
  included: boolean;
  amount: string | null;
  lineCount: number;
}

export interface PricingResult {
  mode: PricingMode;
  /** Calculation currency, per quantity unit. */
  costPerUnit: string;
  sellingPricePerUnit: string;
  profitPerUnit: string;
  totalRevenue: string;
  totalProfit: string;
  marginPercent: string | null;
  markupPercent: string | null;
  feasibility: PricingFeasibility;
  /** Quote-currency view (null when FX for the quote currency is missing). */
  quoteCurrency: string;
  sellingPricePerUnitQuote: string | null;
  costPerUnitQuote: string | null;
  buyerTarget: { pricePerUnit: string; currency: string; gapPercent: string | null; position: "ABOVE" | "BELOW" | "EQUAL" | null } | null;
}

export interface CostingResult {
  formulaVersion: string;
  calculatedAt: string;
  calculationCurrency: string;
  incoterm: Incoterm;
  incotermLabel: string;
  complete: boolean;
  issues: CostingIssue[];
  lines: LineCalculation[];
  categories: CategoryBreakdown[];
  /** Totals are null whenever a blocking issue makes them misleading. */
  totalCost: string | null;
  costPerUnit: string | null;
  quantity: string;
  quantityUnit: CostingQuantityUnit;
  pricing: PricingResult | null;
  fxUsed: { pair: string; rate: string; snapshotId: string; sourceType: FxSourceType; sourceDate: string }[];
}

export interface IncotermComparisonRow {
  incoterm: Incoterm;
  totalCost: string | null;
  costPerUnit: string | null;
  sellingPricePerUnit: string | null;
  profitPerUnit: string | null;
  totalProfit: string | null;
  marginPercent: string | null;
  includedCategories: CostCategory[];
  complete: boolean;
}

export interface FxSensitivityRow {
  shiftPercent: number;
  rates: { pair: string; rate: string }[];
  totalCost: string | null;
  sellingPricePerUnitQuote: string | null;
  totalProfit: string | null;
  marginPercent: string | null;
}

export interface ExportCostingSummary {
  id: string;
  reference: string;
  name: string;
  status: CostingStatus;
  version: number;
  productId: string | null;
  productName: string | null;
  buyerCompanyId: string | null;
  buyerName: string | null;
  crmLeadId: string | null;
  destinationCountryCode: string | null;
  calculationCurrency: string;
  quoteCurrency: string;
  base: {
    quantity: string;
    quantityUnit: CostingQuantityUnit;
    incoterm: Incoterm;
    incotermPlace: string | null;
    totalCost: string | null;
    sellingPricePerUnit: string | null;
    marginPercent: string | null;
    feasibility: PricingFeasibility | null;
    complete: boolean;
  } | null;
  createdBy: string | null;
  updatedAt: string;
}

export interface CostingSnapshotView {
  id: string;
  kind: "READY" | "LOCKED";
  formulaVersion: string;
  createdAt: string;
  createdBy: string | null;
}

export interface ExportCostingDetail extends Omit<ExportCostingSummary, "base"> {
  notes: string | null;
  thinMarginPercent: string;
  rowVersion: number;
  revisionOfId: string | null;
  rootId: string;
  readyAt: string | null;
  lockedAt: string | null;
  archivedAt: string | null;
  scenarios: CostingScenario[];
  snapshots: CostingSnapshotView[];
  revisions: { id: string; version: number; status: CostingStatus; reference: string }[];
  policies: IncotermPolicyView[];
  readiness: { ready: boolean; problems: string[] };
  context: { productHsCode: string | null; buyerRiskLevel: string | null; leadStage: string | null };
}

export interface CostingListResponse {
  items: ExportCostingSummary[];
  meta: PaginationMeta;
}

export interface ScenarioComparisonRow {
  scenarioId: string;
  name: string;
  isBase: boolean;
  quantity: string;
  quantityUnit: CostingQuantityUnit;
  supplierLabel: string | null;
  transportMode: TransportMode | null;
  originPort: string | null;
  destinationPort: string | null;
  incoterm: Incoterm;
  incotermPlace: string | null;
  fx: { pair: string; rate: string }[];
  categoryTotals: Partial<Record<CostCategory, string | null>>;
  totalCost: string | null;
  costPerUnit: string | null;
  sellingPricePerUnit: string | null;
  sellingPricePerUnitQuote: string | null;
  marginPercent: string | null;
  totalProfit: string | null;
  buyerTargetGapPercent: string | null;
  complete: boolean;
  deltaVsBase: { totalCost: string | null; costPerUnit: string | null; marginPoints: string | null; totalProfit: string | null } | null;
  labels: ("LOWEST_COST" | "HIGHEST_MARGIN" | "HIGHEST_PROFIT" | "CLOSEST_TO_TARGET")[];
  rank: number | null;
}

export interface ScenarioComparison {
  calculationCurrency: string;
  quoteCurrency: string;
  objective: ComparisonObjective | null;
  rows: ScenarioComparisonRow[];
  note: string | null;
}
