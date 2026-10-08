import type { PaginationMeta } from "./api";

/**
 * Sprint 19 — operational finance: receivables, payments, shipment profitability
 * and repeat business. Payment terms ≠ receivable ≠ payment received ≠ bank
 * settlement ≠ profitability. This is not an accounting ledger, tax system,
 * payment gateway or bank integration.
 */

export const PAYMENT_TERMS_TYPES = ["ADVANCE", "LETTER_OF_CREDIT", "DOCUMENTS_AGAINST_PAYMENT", "DOCUMENTS_AGAINST_ACCEPTANCE", "OPEN_ACCOUNT", "CUSTOM"] as const;
export type PaymentTermsType = (typeof PAYMENT_TERMS_TYPES)[number];

export const INSTALLMENT_TRIGGERS = ["ORDER_CONFIRMATION", "PI_ISSUE", "BEFORE_PRODUCTION", "BEFORE_SHIPMENT", "ON_SHIPMENT", "ON_DOCUMENT_PRESENTATION", "ON_DELIVERY", "AFTER_DELIVERY_DAYS", "FIXED_DATE", "MANUAL"] as const;
export type InstallmentTrigger = (typeof INSTALLMENT_TRIGGERS)[number];

export const RECEIVABLE_STATUSES = ["NOT_DUE", "DUE_SOON", "DUE", "PARTIALLY_PAID", "PAID", "OVERDUE", "DISPUTED", "CANCELLED", "UNCOLLECTIBLE"] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

export const PAYMENT_METHODS = ["BANK_TRANSFER", "LC", "COLLECTION", "CARD", "CASH", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BANK_CHARGE_TYPES = ["BANK_CHARGES", "INTERMEDIARY_FEES", "LC_CHARGES", "COLLECTION_CHARGES", "REMITTANCE_CHARGES"] as const;
export type BankChargeType = (typeof BANK_CHARGE_TYPES)[number];

export const LC_STATUSES = ["DRAFT", "RECEIVED", "UNDER_REVIEW", "ACCEPTED", "AMENDMENT_REQUIRED", "ACTIVE", "DOCUMENTS_PRESENTED", "PAID", "EXPIRED", "CANCELLED"] as const;
export type LCStatus = (typeof LC_STATUSES)[number];

export const ACTUAL_COST_CATEGORIES = ["PROCUREMENT", "PACKAGING", "INLAND_TRANSPORT", "INSPECTION", "CHA_CUSTOMS_BROKER", "CUSTOMS_PORT", "FREIGHT", "INSURANCE", "BANK_CHARGES", "CERTIFICATES", "FX_GAIN_LOSS", "WAREHOUSING", "COURIER", "MISCELLANEOUS"] as const;
export type ActualCostCategory = (typeof ACTUAL_COST_CATEGORIES)[number];

export const ACTUAL_COST_SOURCES = ["MANUAL", "FREIGHT_QUOTE", "LOGISTICS_ACTUAL", "PAYMENT", "BANK_CHARGE", "SUPPLIER_INVOICE", "PROCUREMENT", "OTHER"] as const;
export type ActualCostSource = (typeof ACTUAL_COST_SOURCES)[number];

export const REVENUE_ADJUSTMENT_TYPES = ["CREDIT_ADJUSTMENT", "DISCOUNT", "DEBIT_CLAIM_ADJUSTMENT"] as const;
export type RevenueAdjustmentType = (typeof REVENUE_ADJUSTMENT_TYPES)[number];

/** INCOMPLETE = required inputs missing; ESTIMATED = only the Sprint 14 estimate; ACTUAL_IN_PROGRESS = actuals complete, not finalized. */
export type ProfitabilityStatus = "INCOMPLETE" | "ESTIMATED" | "ACTUAL_IN_PROGRESS" | "FINALIZED";
export type RepeatSignalLevel = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
export type ReminderKind = "UPCOMING_DUE" | "DUE_TODAY" | "OVERDUE" | "FOLLOW_UP";
/** RECORDED_SENT = a user recorded sending it outside ExportPro; ExportPro never sends it. */
export type ReminderStatus = "DRAFT" | "RECORDED_SENT" | "DISMISSED";
export type ReorderReminderStatus = "SUGGESTED" | "SNOOZED" | "DISMISSED" | "DRAFTED";

export interface FxBasis {
  rate: string;
  from: string;
  to: string;
  sourceLabel: string | null;
  sourceDate: string | null;
  snapshotId: string | null;
}

export interface FinanceSettingsView {
  reportingCurrency: string;
  dueSoonDays: number;
  reorderLeadDays: number;
}

export interface ReceivableInstallmentView {
  id: string;
  sequence: number;
  label: string;
  percentage: string | null;
  amount: string;
  triggerType: InstallmentTrigger;
  dueDays: number | null;
  fixedDate: string | null;
  /** Resolved deterministically from the trigger; null = trigger not reached yet. */
  dueDate: string | null;
  dueBasis: string;
  paidAmount: string;
  outstandingAmount: string;
  status: ReceivableStatus;
  daysOverdue: number | null;
  dispute: { amount: string | null; reason: string; at: string; notes: string | null } | null;
}

export interface PaymentReceiptView {
  id: string;
  installmentId: string | null;
  amount: string;
  currency: string;
  receivedAt: string;
  paymentMethod: PaymentMethod;
  /** Masked except the last 4 characters. */
  bankReference: string | null;
  remittanceReference: string | null;
  bankName: string | null;
  notes: string | null;
  source: string;
  fx: (FxBasis & { convertedAmount: string }) | null;
  appliedAmount: string;
  excessAmount: string;
  overpaymentReason: string | null;
  settlementFx: FxBasis | null;
  charges: { type: BankChargeType; amount: string; currency: string }[];
  fxGainLoss: string | null;
  status: "RECORDED" | "REVERSED";
  reversal: { reason: string; by: string | null; at: string } | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface LetterOfCreditView {
  id: string;
  lcNumber: string;
  issuingBank: string;
  advisingBank: string | null;
  amount: string;
  currency: string;
  issueDate: string | null;
  expiryDate: string | null;
  latestShipmentDate: string | null;
  presentationDeadline: string | null;
  status: LCStatus;
  daysToExpiry: number | null;
  documents: { requirement: string; documentId: string | null; documentTitle: string | null; documentStatus: string | null }[];
  notes: string | null;
  rowVersion: number;
}

export interface ReceivableReminderView {
  id: string;
  installmentId: string | null;
  kind: ReminderKind;
  status: ReminderStatus;
  subject: string;
  message: string;
  dueAmount: string;
  currency: string;
  dueDate: string | null;
  channel: string | null;
  recordedSentAt: string | null;
  recordedSentBy: string | null;
  createdAt: string;
}

export interface ReceivableSummary {
  id: string;
  receivableNumber: string;
  buyer: { id: string; name: string };
  purchaseOrder: { id: string; poNumber: string };
  shipment: { id: string; shipmentNumber: string } | null;
  commercialInvoice: { id: string; number: string | null } | null;
  destinationCountry: string | null;
  currency: string;
  totalAmount: string;
  receivedAmount: string;
  outstandingAmount: string;
  nextDueDate: string | null;
  status: ReceivableStatus;
  paymentTermsType: PaymentTermsType;
  daysOverdue: number | null;
  updatedAt: string;
}

export interface PaymentTermsSnapshot {
  type: PaymentTermsType;
  wording: string | null;
  source: "PURCHASE_ORDER" | "PROFORMA_INVOICE" | "QUOTATION" | "COMMERCIAL_INVOICE" | "MANUAL";
  sourceId: string | null;
  sourceReference: string | null;
  currency: string;
  totalAmount: string;
  installments: { label: string; percentage: string | null; amount: string; triggerType: InstallmentTrigger; dueDays: number | null; fixedDate: string | null }[];
  references: { purchaseOrder: string | null; proformaInvoice: string | null; quotation: string | null };
  capturedAt: string;
}

export interface ReceivableDetail extends ReceivableSummary {
  rowVersion: number;
  paymentTermsText: string | null;
  termsSnapshot: PaymentTermsSnapshot;
  customConfirmed: boolean;
  invoiceDate: string | null;
  termDays: number | null;
  documentsPresentedAt: string | null;
  collectingBank: string | null;
  acceptedAt: string | null;
  tenorDays: number | null;
  maturityDate: string | null;
  paymentReceivedAt: string | null;
  bookingFx: FxBasis | null;
  proformaInvoice: { id: string; number: string } | null;
  quotation: { id: string; number: string } | null;
  crmLeadId: string | null;
  installments: ReceivableInstallmentView[];
  payments: PaymentReceiptView[];
  letterOfCredit: LetterOfCreditView | null;
  reminders: ReceivableReminderView[];
  dispute: { amount: string | null; reason: string; at: string; notes: string | null } | null;
  uncollectible: { reason: string; at: string } | null;
  notes: string | null;
  events: { id: string; type: string; title: string; actor: string | null; createdAt: string }[];
  availableActions: string[];
}

export interface ParsedPaymentTerms {
  type: PaymentTermsType | null;
  wording: string | null;
  source: PaymentTermsSnapshot["source"] | null;
  installments: PaymentTermsSnapshot["installments"];
  termDays: number | null;
  tenorDays: number | null;
  /** True when the wording was fully understood; otherwise the user must confirm a custom schedule. */
  recognized: boolean;
  notes: string[];
}

export interface ReceivablePrefill {
  purchaseOrder: { id: string; poNumber: string; status: string; buyerName: string };
  currency: string;
  totalAmount: string | null;
  totalSource: string;
  terms: ParsedPaymentTerms;
  commercialInvoice: { id: string; number: string | null; invoiceDate: string | null; total: string | null } | null;
  shipment: { id: string; shipmentNumber: string } | null;
  existingReceivableId: string | null;
}

export interface AgingBucketRow {
  key: string;
  label: string;
  currency: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90plus: string;
  total: string;
}

export interface FinanceOverview {
  reportingCurrency: string;
  range: { from: string; to: string };
  byCurrency: { currency: string; outstanding: string; overdue: string; dueSoon: string; dueToday: string; collected: string; total: string }[];
  normalized: { outstanding: string | null; overdue: string | null; dueNext7: string | null; collected: string | null; basis: string; missingFx: string[] };
  counts: { open: number; overdue: number; dueSoon: number; dueToday: number; disputed: number };
  profitability: { finalized: number; inProgress: number; totalProfit: string | null; averageMargin: string | null };
  reorderDue: number;
  reminders: { suggested: number; drafts: number };
}

export interface ShipmentActualCostView {
  id: string | null;
  category: ActualCostCategory;
  description: string;
  amount: string;
  currency: string;
  fx: FxBasis | null;
  reportingAmount: string | null;
  source: ActualCostSource;
  sourceReference: string | null;
  incurredAt: string | null;
  vendorName: string | null;
  attachment: { id: string; filename: string } | null;
  /** Derived rows (Sprint 18 logistics actuals, payment bank charges) are edited at their source. */
  derived: boolean;
  createdBy: string | null;
}

export interface ProfitabilityVariance {
  group: string;
  label: string;
  estimated: string | null;
  actual: string | null;
  variance: string | null;
  variancePercent: string | null;
  /** For costs: positive variance = overrun. */
  direction: "OVERRUN" | "SAVING" | "ON_ESTIMATE" | "N/A";
}

export interface ShipmentProfitabilitySummary {
  shipmentId: string;
  shipmentNumber: string;
  buyer: { id: string; name: string };
  destinationCountry: string | null;
  reportingCurrency: string;
  revenue: string | null;
  estimatedProfit: string | null;
  actualProfit: string | null;
  marginPercent: string | null;
  profitVariance: string | null;
  completeness: { complete: boolean; missing: string[] };
  status: ProfitabilityStatus;
  periodDate: string;
  finalizedAt: string | null;
}

export interface ShipmentProfitabilityDetail extends ShipmentProfitabilitySummary {
  rowVersion: number;
  purchaseOrder: { id: string; poNumber: string };
  revenueDetail: {
    source: string;
    sourceId: string | null;
    currency: string | null;
    gross: string | null;
    adjustments: { id: string; type: RevenueAdjustmentType; amount: string; currency: string; reason: string; createdAt: string }[];
    net: string | null;
    fx: FxBasis | null;
    reporting: string | null;
  };
  estimate: {
    available: boolean;
    source: string | null;
    costings: { costingId: string; reference: string; snapshotId: string | null; snapshotKind: string; scenarioName: string }[];
    scale: string | null;
    revenue: string | null;
    totalCost: string | null;
    profit: string | null;
    marginPercent: string | null;
    currency: string | null;
    notes: string[];
  };
  costs: ShipmentActualCostView[];
  totals: { actualCost: string | null; operationalProfit: string | null; fxGainLoss: string | null; finalProfit: string | null; marginPercent: string | null };
  variance: ProfitabilityVariance[];
  fxImpact: { payments: { paymentId: string; applied: string; bookingRate: string | null; settlementRate: string | null; gainLoss: string | null }[]; manual: string; total: string | null; notes: string[] };
  confirmedNone: ActualCostCategory[];
  snapshots: { id: string; version: number; finalizedAt: string; finalizedBy: string | null; reopenedAt: string | null; reopenReason: string | null; data: unknown }[];
  receivable: { id: string; receivableNumber: string; status: ReceivableStatus; outstanding: string; currency: string } | null;
  availableActions: string[];
  calculatedAt: string;
}

export interface AnalyticsMeta {
  range: { from: string; to: string };
  reportingCurrency: string;
  includeInProgress: boolean;
  finalizedCount: number;
  inProgressCount: number;
  calculatedAt: string;
  basis: string;
}

export interface BuyerProfitability {
  buyer: { id: string; name: string; country: string | null };
  revenue: string;
  totalCost: string;
  grossProfit: string;
  marginPercent: string | null;
  shipments: number;
  orders: number;
  paid: string | null;
  outstanding: string | null;
  overdue: string | null;
  averageOrderValue: string | null;
  repeatOrders: number;
  /** Historical customer value = realized gross profit to date (not a prediction). */
  historicalCustomerValue: string;
}

export interface ProductProfitability {
  product: { id: string | null; name: string };
  revenue: string;
  volume: { quantity: string; unit: string }[];
  totalCost: string;
  profit: string;
  marginPercent: string | null;
  shipments: number;
  orders: number;
  repeatBuyers: number;
  trend: { period: string; marginPercent: string | null }[];
}

export interface CountryProfitability {
  country: string;
  revenue: string;
  cost: string;
  profit: string;
  marginPercent: string | null;
  shipments: number;
  averageFreightCost: string | null;
  averagePaymentDelayDays: string | null;
  repeatRatePercent: string | null;
  overdueExposure: string | null;
  averageReorderDays: string | null;
}

export interface Ranking {
  key: string;
  label: string;
  explanation: string;
  rows: { id: string | null; name: string; value: string }[];
}

export interface ProfitabilityAnalytics<T> {
  meta: AnalyticsMeta;
  rows: T[];
  rankings: Ranking[];
  trend: { period: string; revenue: string; profit: string; marginPercent: string | null; shipments: number }[];
  insights: string[];
}

export interface RepeatBusinessSignal {
  buyer: { id: string; name: string; country: string | null };
  orderCount: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  intervalsDays: number[];
  averageIntervalDays: number | null;
  daysSinceLastOrder: number | null;
  topProducts: { productId: string | null; name: string; orders: number }[];
  level: RepeatSignalLevel;
  score: number | null;
  factors: { factor: string; points: number; max: number; explanation: string }[];
  window: { start: string; end: string } | null;
  windowState: "NOT_YET" | "APPROACHING" | "IN_WINDOW" | "PAST_WINDOW" | null;
  paymentBehavior: { overdue: string | null; averageDelayDays: string | null; label: string };
  reminder: { id: string; status: ReorderReminderStatus; snoozedUntil: string | null } | null;
  crmLeadId: string | null;
}

export interface ReorderReminderView {
  id: string;
  buyer: { id: string; name: string };
  product: { id: string | null; name: string } | null;
  windowStart: string;
  windowEnd: string;
  status: ReorderReminderStatus;
  snoozedUntil: string | null;
  message: string;
  basis: Record<string, unknown>;
  createdAt: string;
}

export interface FinanceBuyerSummary {
  buyerId: string;
  currencyTotals: { currency: string; outstanding: string; overdue: string }[];
  lastPayment: { amount: string; currency: string; receivedAt: string } | null;
  nextDue: { amount: string; currency: string; dueDate: string } | null;
  profitability: { revenue: string; profit: string; marginPercent: string | null; shipments: number; reportingCurrency: string } | null;
  repeat: Pick<RepeatBusinessSignal, "level" | "orderCount" | "window" | "averageIntervalDays"> | null;
}

export interface FinanceList<T> {
  items: T[];
  meta: PaginationMeta;
}
