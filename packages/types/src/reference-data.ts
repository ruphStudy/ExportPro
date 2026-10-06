import {
  ExportExperience,
  ExportGoal,
  InvestmentRange,
  LogisticsMode,
  RiskTolerance,
  ShipmentPreference,
} from "./enums";

export interface ReferenceOption {
  code: string;
  label: string;
}

/**
 * Stable, code-defined taxonomy rather than a database table — this
 * list changes with a deploy, not with user action, so a config
 * constant is the right place for it (see ARCHITECTURE.md "Reference
 * Data"). Codes are what gets stored; labels are what gets displayed.
 */
export const PRODUCT_CATEGORIES: ReferenceOption[] = [
  { code: "AGRICULTURE", label: "Agriculture" },
  { code: "FOOD_BEVERAGES", label: "Food & Beverages" },
  { code: "SPICES", label: "Spices" },
  { code: "TEXTILES", label: "Textiles" },
  { code: "HANDICRAFTS", label: "Handicrafts" },
  { code: "CHEMICALS", label: "Chemicals" },
  { code: "PHARMACEUTICALS", label: "Pharmaceuticals" },
  { code: "ENGINEERING_GOODS", label: "Engineering Goods" },
  { code: "AUTO_COMPONENTS", label: "Auto Components" },
  { code: "ELECTRONICS", label: "Electronics" },
  { code: "PLASTICS", label: "Plastics" },
  { code: "FURNITURE", label: "Furniture" },
  { code: "PACKAGING", label: "Packaging" },
  { code: "LEATHER", label: "Leather" },
  { code: "GEMS_JEWELLERY", label: "Gems & Jewellery" },
  { code: "HOME_KITCHEN", label: "Home & Kitchen" },
  { code: "BEAUTY_PERSONAL_CARE", label: "Beauty / Personal Care" },
  { code: "OTHER", label: "Other" },
];

/** Categories where FSSAI/APEDA are plausibly relevant — used only to decide what to show and avoid penalizing, never to assert a legal requirement. */
export const FOOD_RELATED_CATEGORY_CODES = ["AGRICULTURE", "FOOD_BEVERAGES", "SPICES"];

export const PREFERRED_INDUSTRIES: ReferenceOption[] = [
  { code: "FOOD_RETAIL", label: "Food Retail" },
  { code: "HOSPITALITY", label: "Hospitality" },
  { code: "CONSTRUCTION", label: "Construction" },
  { code: "AUTOMOTIVE", label: "Automotive" },
  { code: "HEALTHCARE", label: "Healthcare" },
  { code: "CONSUMER_GOODS", label: "Consumer Goods" },
  { code: "INDUSTRIAL_MANUFACTURING", label: "Industrial Manufacturing" },
  { code: "DISTRIBUTION_WHOLESALE", label: "Distribution / Wholesale" },
  { code: "ECOMMERCE", label: "E-commerce" },
];

export const EXPORT_EXPERIENCE_LABELS: Record<ExportExperience, string> = {
  NONE: "No export experience",
  LESS_THAN_1_YEAR: "Less than 1 year",
  ONE_TO_THREE_YEARS: "1–3 years",
  THREE_TO_FIVE_YEARS: "3–5 years",
  FIVE_TO_TEN_YEARS: "5–10 years",
  TEN_PLUS_YEARS: "10+ years",
};

export const INVESTMENT_RANGE_LABELS: Record<InvestmentRange, string> = {
  UNDER_1L: "Under ₹1 lakh",
  L1_5: "₹1–5 lakh",
  L5_10: "₹5–10 lakh",
  L10_25: "₹10–25 lakh",
  L25_50: "₹25–50 lakh",
  L50_1CR: "₹50 lakh – ₹1 crore",
  ABOVE_1CR: "Above ₹1 crore",
};

export const SHIPMENT_PREFERENCE_LABELS: Record<ShipmentPreference, string> = {
  SAMPLES_ONLY: "Samples only",
  COURIER_PARCEL: "Courier / small parcel",
  UNDER_100KG: "Less than 100 kg",
  KG_100_500: "100–500 kg",
  KG_500_1MT: "500 kg – 1 MT",
  MT_1_5: "1–5 MT",
  MT_5_20: "5–20 MT",
  CONTAINER_SCALE: "Container-scale",
  FLEXIBLE: "Flexible / Not sure",
};

export const LOGISTICS_MODE_LABELS: Record<LogisticsMode, string> = {
  SEA: "Sea",
  AIR: "Air",
  COURIER: "Courier",
  ROAD: "Road / cross-border",
  FLEXIBLE: "Flexible / Recommend for me",
};

export const EXPORT_GOAL_LABELS: Record<ExportGoal, string> = {
  FIND_FIRST_PRODUCT: "Find my first export product",
  START_EXPORTING_EXISTING: "Start exporting existing products",
  FIND_BUYERS: "Find international buyers",
  EXPAND_COUNTRIES: "Expand into new countries",
  INCREASE_REVENUE: "Increase export revenue",
  IMPROVE_PROFITABILITY: "Improve profitability",
  REDUCE_RISK: "Reduce export risk",
  AUTOMATE_OPERATIONS: "Automate export operations",
  BUILD_REPEAT_BUSINESS: "Build repeat international business",
};

export const RISK_TOLERANCE_LABELS: Record<RiskTolerance, { label: string; description: string }> = {
  CONSERVATIVE: {
    label: "Conservative",
    description: "Prefer easier markets and lower regulatory/logistics risk.",
  },
  BALANCED: {
    label: "Balanced",
    description: "Mix opportunity with manageable complexity.",
  },
  AGGRESSIVE: {
    label: "Aggressive",
    description: "Higher-growth markets even with higher complexity.",
  },
};

export const CERTIFICATION_TYPE_OPTIONS: ReferenceOption[] = [
  { code: "ISO", label: "ISO" },
  { code: "HACCP", label: "HACCP" },
  { code: "ORGANIC", label: "Organic" },
  { code: "GMP", label: "GMP" },
  { code: "CE", label: "CE" },
  { code: "BIS", label: "BIS" },
  { code: "HALAL", label: "Halal" },
  { code: "KOSHER", label: "Kosher" },
  { code: "PHYTOSANITARY", label: "Phytosanitary" },
  { code: "PRODUCT_SPECIFIC", label: "Product-specific certificate" },
  { code: "CUSTOM", label: "Other / custom" },
];
