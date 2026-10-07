import type { PaginationMeta } from "./api";

/**
 * Sprint 15 commercial documents. RFQ, costing, quotation, proforma
 * invoice and buyer PO are separate records linked by reference. Money
 * values are decimal strings computed by the backend (Sprint 14 decimal
 * policy). Buyer-facing views never contain internal cost or margin.
 */

export const QuotationStatus = {
  DRAFT: "DRAFT",
  READY: "READY",
  ISSUED: "ISSUED",
  SENT: "SENT",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  SUPERSEDED: "SUPERSEDED",
  CANCELLED: "CANCELLED",
} as const;
export type QuotationStatus = (typeof QuotationStatus)[keyof typeof QuotationStatus];

export const ProformaInvoiceStatus = { DRAFT: "DRAFT", ISSUED: "ISSUED", SENT: "SENT", ACCEPTED: "ACCEPTED", SUPERSEDED: "SUPERSEDED", CANCELLED: "CANCELLED" } as const;
export type ProformaInvoiceStatus = (typeof ProformaInvoiceStatus)[keyof typeof ProformaInvoiceStatus];

export const PurchaseOrderStatus = { RECEIVED: "RECEIVED", UNDER_REVIEW: "UNDER_REVIEW", MATCHED: "MATCHED", DISCREPANCY: "DISCREPANCY", ACCEPTED: "ACCEPTED", REJECTED: "REJECTED", CANCELLED: "CANCELLED" } as const;
export type PurchaseOrderStatus = (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

export const PODiscrepancyType = { QUANTITY: "QUANTITY", PRICE: "PRICE", CURRENCY: "CURRENCY", PRODUCT: "PRODUCT", SPECIFICATION: "SPECIFICATION", INCOTERM: "INCOTERM", DELIVERY: "DELIVERY", PAYMENT_TERM: "PAYMENT_TERM", TOTAL: "TOTAL", OTHER: "OTHER" } as const;
export type PODiscrepancyType = (typeof PODiscrepancyType)[keyof typeof PODiscrepancyType];

export type DiscrepancySeverity = "INFO" | "WARNING" | "CRITICAL";
export type DiscrepancyResolution = "OPEN" | "ACCEPTED_DIFFERENCE" | "CORRECTED" | "RESOLVED";
export type CommercialDocumentSource = "INQUIRY" | "QUOTATION_REQUEST" | "COSTING" | "CRM_LEAD" | "BUYER" | "MANUAL" | "QUOTATION";
export type AcceptanceSource = "MANUAL" | "EMAIL_REPLY" | "PO_RECEIVED" | "OTHER";
export type PriceSource = "COSTING" | "MANUAL" | "OVERRIDE";

export interface PartySnapshot {
  name: string;
  legalName?: string | null;
  address: string | null;
  country: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website?: string | null;
  registrations?: { type: string; number: string }[];
  hasLogo?: boolean;
}

export interface BankDetails {
  bankName: string | null;
  beneficiary: string | null;
  accountNumber: string | null;
  swift: string | null;
  iban: string | null;
  bankAddress: string | null;
  intermediary: string | null;
}

export interface CommercialSettings {
  quotationPrefix: string;
  piPrefix: string;
  yearlyReset: boolean;
  unitPricePrecision: number;
  defaultValidityDays: number;
  quantityTolerancePercent: string;
  priceTolerancePercent: string;
  quotationTerms: string | null;
  piTerms: string | null;
  /** Masked unless the viewer may manage commercial settings. */
  bankDetails: BankDetails | null;
  bankDetailsMasked: boolean;
}

export interface QuotationItem {
  id: string;
  sortOrder: number;
  productId: string | null;
  inquiryItemId: string | null;
  description: string;
  hsCode: string | null;
  specification: string | null;
  packaging: string | null;
  quantity: string;
  unit: string;
  unitPrice: string | null;
  totalPrice: string | null;
  deliveryNotes: string | null;
  countryOfOrigin: string | null;
  priceSource: PriceSource;
  /** Internal only (never on buyer documents). */
  costing: { costingId: string; scenarioId: string; reference: string; costingUnitPrice: string; snapshotKind: "READY" | "LOCKED" | "LIVE"; formulaVersion: string } | null;
  priceDiffersFromCosting: boolean;
  overrideReason: string | null;
  overriddenBy: string | null;
}

export interface CommercialEvent {
  id: string;
  type: string;
  title: string;
  entityType: "QUOTATION" | "PI" | "PO" | "DOCUMENT" | "COMPLIANCE";
  entityId: string;
  actor: string | null;
  createdAt: string;
}

export interface QuotationSummary {
  id: string;
  quotationNumber: string;
  revision: number;
  displayNumber: string;
  status: QuotationStatus;
  buyer: { id: string | null; name: string; countryCode: string | null };
  inquiry: { id: string; reference: string } | null;
  productSummary: string;
  totalAmount: string | null;
  currency: string;
  incoterm: string | null;
  incotermPlace: string | null;
  issueDate: string | null;
  validUntil: string | null;
  expiry: { state: "EXPIRED" | "EXPIRES_TODAY" | "EXPIRES_SOON" | "VALID" | null; days: number | null };
  createdBy: string | null;
  updatedAt: string;
}

export interface QuotationDetail extends QuotationSummary {
  rootId: string;
  rowVersion: number;
  revisionReason: string | null;
  crmLeadId: string | null;
  quotationRequestId: string | null;
  costingId: string | null;
  originCountry: string | null;
  destinationCountry: string | null;
  destinationPort: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  leadTime: string | null;
  shipmentWindow: string | null;
  partialShipment: boolean | null;
  transshipment: boolean | null;
  buyerNotes: string | null;
  internalNotes: string | null;
  termsAndConditions: string | null;
  additionalCharges: string;
  chargesLabel: string | null;
  discount: string;
  subtotal: string | null;
  items: QuotationItem[];
  buyerSnapshot: PartySnapshot | null;
  exporterSnapshot: PartySnapshot | null;
  issuedAt: string | null;
  acceptance: { at: string; by: string | null; source: AcceptanceSource; buyerReference: string | null; note: string | null } | null;
  rejection: { at: string; reason: string } | null;
  cancellation: { at: string; reason: string } | null;
  revisions: { id: string; revision: number; status: QuotationStatus; issuedAt: string | null }[];
  proformaInvoices: { id: string; displayNumber: string; status: ProformaInvoiceStatus }[];
  purchaseOrders: { id: string; poNumber: string; status: PurchaseOrderStatus }[];
  issueProblems: string[];
  crm: { leadId: string; stage: string; stageSuggestion: { stage: string; reason: string } | null } | null;
  emailDraft: string | null;
  events: CommercialEvent[];
  availableActions: string[];
}

export interface PiItem {
  id: string;
  sortOrder: number;
  quotationItemId: string | null;
  productId: string | null;
  description: string;
  hsCode: string | null;
  specification: string | null;
  packaging: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  totalPrice: string;
}

export interface PiSummary {
  id: string;
  piNumber: string;
  revision: number;
  displayNumber: string;
  status: ProformaInvoiceStatus;
  source: "QUOTATION" | "MANUAL";
  buyer: { id: string | null; name: string; countryCode: string | null };
  quotation: { id: string; displayNumber: string } | null;
  totalAmount: string;
  currency: string;
  incoterm: string | null;
  incotermPlace: string | null;
  issueDate: string | null;
  createdBy: string | null;
  updatedAt: string;
}

export interface PiDetail extends PiSummary {
  rootId: string;
  rowVersion: number;
  revisionReason: string | null;
  crmLeadId: string | null;
  inquiryId: string | null;
  validUntil: string | null;
  destinationCountry: string | null;
  destinationPort: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  buyerNotes: string | null;
  internalNotes: string | null;
  terms: string | null;
  subtotal: string;
  additionalCharges: string;
  chargesLabel: string | null;
  discount: string;
  items: PiItem[];
  buyerSnapshot: PartySnapshot | null;
  exporterSnapshot: PartySnapshot | null;
  bankDetails: BankDetails | null;
  bankDetailsMasked: boolean;
  overrideReason: string | null;
  differencesFromQuotation: string[];
  issuedAt: string | null;
  cancellation: { at: string; reason: string } | null;
  revisions: { id: string; revision: number; status: ProformaInvoiceStatus }[];
  purchaseOrders: { id: string; poNumber: string; status: PurchaseOrderStatus }[];
  issueProblems: string[];
  events: CommercialEvent[];
  availableActions: string[];
}

export interface PoItem {
  id: string;
  sortOrder: number;
  quotationItemId: string | null;
  productId: string | null;
  buyerProductCode: string | null;
  description: string;
  specification: string | null;
  packaging: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  totalPrice: string | null;
  deliveryDate: string | null;
}

export interface PODiscrepancy {
  id: string;
  against: "QUOTATION" | "PI" | "PO";
  type: PODiscrepancyType;
  severity: DiscrepancySeverity;
  field: string;
  itemLabel: string | null;
  expectedValue: string | null;
  actualValue: string | null;
  message: string;
  status: DiscrepancyResolution;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface PoSummary {
  id: string;
  poNumber: string;
  poDate: string;
  status: PurchaseOrderStatus;
  source: "MANUAL" | "UPLOAD";
  buyer: { id: string; name: string };
  quotation: { id: string; displayNumber: string } | null;
  proformaInvoice: { id: string; displayNumber: string } | null;
  totalAmount: string | null;
  currency: string;
  discrepancyCounts: { critical: number; warning: number; info: number };
  updatedAt: string;
}

export interface ComparisonColumn {
  label: string;
  currency: string | null;
  incoterm: string | null;
  incotermPlace: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  totalAmount: string | null;
  items: { description: string; quantity: string; unit: string; unitPrice: string | null }[];
}

export interface PoDetail extends PoSummary {
  rowVersion: number;
  crmLeadId: string | null;
  inquiryId: string | null;
  incoterm: string | null;
  incotermPlace: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  destination: string | null;
  notes: string | null;
  items: PoItem[];
  linesTotal: string | null;
  attachments: { id: string; filename: string; mimeType: string; sizeBytes: number; createdAt: string }[];
  discrepancies: PODiscrepancy[];
  comparison: { quotation: ComparisonColumn | null; pi: ComparisonColumn | null; po: ComparisonColumn; tolerance: { quantityPercent: string; pricePercent: string } };
  review: { decidedAt: string; decidedBy: string | null; decision: "ACCEPTED" | "REJECTED"; reason: string | null; overrideReason: string | null } | null;
  crm: { leadId: string; stage: string; stageSuggestion: { stage: string; reason: string } | null } | null;
  events: CommercialEvent[];
  availableActions: string[];
}

export interface CommercialList<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface CommercialActionSummary {
  quotationsExpiringSoon: number;
  draftPis: number;
  posNeedingReview: number;
}
