import type { PaginationMeta } from "./api";

/**
 * Sprint 21 — supplier & procurement (merchant-exporter sourcing side).
 * Supplier ≠ discovery result ≠ supplier RFQ ≠ supplier quote ≠ supplier PO ≠
 * goods receipt ≠ quality inspection ≠ supplier payment ≠ export buyer PO.
 */

export const SUPPLIER_TYPES = ["MANUFACTURER", "TRADER", "PROCESSOR", "WHOLESALER", "EXPORTER_SUPPLIER", "OTHER"] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];
export const SUPPLIER_SOURCES = ["USER_ADDED", "PUBLIC_DATA", "DIRECTORY", "IMPORTED", "EXTERNAL_PROVIDER", "AI_DERIVED_SUGGESTION", "DEMO"] as const;
export type SupplierSource = (typeof SUPPLIER_SOURCES)[number];
export const SUPPLIER_VERIFICATION = ["UNVERIFIED", "USER_CONFIRMED", "DOCUMENT_VERIFIED", "EXTERNAL_VERIFIED"] as const;
export type SupplierVerification = (typeof SUPPLIER_VERIFICATION)[number];
/** UPLOADED = a file exists; it is never treated as authenticated by itself. */
export const CERT_VERIFICATION = ["NOT_PROVIDED", "UPLOADED", "USER_CONFIRMED", "DOCUMENT_REVIEWED", "EXTERNAL_VERIFIED"] as const;
export type CertificationVerification = (typeof CERT_VERIFICATION)[number];
export const SUPPLIER_ATTACHMENT_CATEGORIES = ["GST_CERTIFICATE", "FSSAI", "ISO", "PRODUCT_CERTIFICATE", "LAB_REPORT", "CATALOG", "PRICE_LIST", "FACTORY_PROFILE", "SUPPLIER_QUOTE", "COA", "INSPECTION_IMAGE", "CHECKLIST", "OTHER"] as const;
export type SupplierAttachmentCategory = (typeof SUPPLIER_ATTACHMENT_CATEGORIES)[number];

export const SUPPLIER_RFQ_STATUSES = ["DRAFT", "READY", "REQUESTED", "PARTIALLY_QUOTED", "QUOTED", "CLOSED", "CANCELLED"] as const;
export type SupplierRfqStatus = (typeof SUPPLIER_RFQ_STATUSES)[number];
export type SupplierQuoteReview = "PENDING_REVIEW" | "CONFIRMED" | "REJECTED";
export type SupplierQuoteStatus = "RECORDED" | "SELECTED" | "NOT_SELECTED" | "EXPIRED";
export const PRICE_BASES = ["EX_FACTORY", "DELIVERED", "FOR_DESTINATION", "OTHER"] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

export const SUPPLIER_PO_STATUSES = ["DRAFT", "ISSUED", "ACKNOWLEDGED", "IN_PRODUCTION", "READY", "PARTIALLY_RECEIVED", "RECEIVED", "COMPLETED", "CANCELLED"] as const;
export type SupplierPoStatus = (typeof SUPPLIER_PO_STATUSES)[number];
export const PROCUREMENT_STATUSES = ["NOT_ORDERED", "ORDERED", "SUPPLIER_ACKNOWLEDGED", "IN_PRODUCTION", "READY", "DISPATCHED", "PARTIALLY_RECEIVED", "RECEIVED", "QUALITY_HOLD", "CLOSED", "CANCELLED"] as const;
export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];
export const QUALITY_STATUSES = ["PENDING", "PASSED", "FAILED", "PARTIAL", "HOLD", "WAIVED"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];
export const SUPPLIER_PAYMENT_TRIGGERS = ["ADVANCE", "ON_DISPATCH", "ON_DELIVERY", "CREDIT_DAYS", "FIXED_DATE", "CUSTOM"] as const;
export type SupplierPaymentTrigger = (typeof SUPPLIER_PAYMENT_TRIGGERS)[number];
export type PayableStatus = "NOT_DUE" | "DUE_SOON" | "DUE" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "DISPUTED" | "CANCELLED";

export interface SupplierProductView {
  id: string;
  productId: string | null;
  productName: string;
  hsCode: string | null;
  specification: string | null;
  moq: string | null;
  moqUnit: string | null;
  capacity: string | null;
  capacityUnit: string | null;
  capacityPeriod: string | null;
  /** Hidden (null) for roles without procurement pricing access. */
  indicativePrice: string | null;
  currency: string | null;
  priceUnit: string | null;
  leadTimeDays: number | null;
  packaging: string | null;
  originState: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface SupplierCertificationView {
  id: string;
  type: string;
  number: string | null;
  issuingBody: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  expired: boolean;
  verification: CertificationVerification;
  attachment: { id: string; filename: string } | null;
}

export interface SupplierAttachmentView {
  id: string;
  category: SupplierAttachmentCategory;
  filename: string;
  sizeBytes: number;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface SupplierPerformance {
  orders: number;
  receipts: number;
  onTimeRatePercent: string | null;
  averageLeadTimeDays: string | null;
  acceptedQuantity: string;
  rejectedQuantity: string;
  qualityPassRatePercent: string | null;
  inspections: number;
  priceHistory: { date: string; unitPrice: string; currency: string; unit: string; reference: string }[];
  basis: string;
}

export interface SupplierProvenance {
  source: SupplierSource;
  sourceLabel: string;
  verification: SupplierVerification;
  lastUpdatedAt: string;
  lastCheckedAt: string | null;
  demo: boolean;
}

export interface SupplierSummary {
  id: string;
  legalName: string;
  tradeName: string | null;
  supplierType: SupplierType | null;
  state: string | null;
  city: string | null;
  products: { productName: string; moq: string | null; moqUnit: string | null; capacity: string | null; capacityUnit: string | null; capacityPeriod: string | null; indicativePrice: string | null; currency: string | null; priceUnit: string | null; leadTimeDays: number | null }[];
  certifications: { type: string; verification: CertificationVerification; expired: boolean }[];
  provenance: SupplierProvenance;
  shortlisted: boolean;
  /** Only when a requirement was given; deterministic and explained. */
  fit: { score: number; confidencePercent: number; factors: { factor: string; points: number; max: number; explanation: string }[] } | null;
}

export interface SupplierDetail extends SupplierSummary {
  rowVersion: number;
  address: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  gstin: string | null;
  pan: string | null;
  notes: string | null;
  productRows: SupplierProductView[];
  certificationRows: SupplierCertificationView[];
  attachments: SupplierAttachmentView[];
  rfqs: { id: string; rfqNumber: string; productName: string; status: SupplierRfqStatus; recipientStatus: string }[];
  quotes: { id: string; rfqId: string; rfqNumber: string; unitPrice: string | null; currency: string; unit: string; leadTimeDays: number | null; review: SupplierQuoteReview; status: SupplierQuoteStatus; quoteDate: string | null }[];
  purchaseOrders: { id: string; spoNumber: string; status: SupplierPoStatus; procurementStatus: ProcurementStatus; total: string | null; currency: string; expectedDate: string | null }[];
  qualityHistory: { inspectionId: string; grnNumber: string; status: QualityStatus; accepted: string; rejected: string; at: string }[];
  payments: { id: string; spoNumber: string; amount: string | null; currency: string; paidAt: string; status: string }[];
  performance: SupplierPerformance;
  activity: { id: string; title: string; actor: string | null; createdAt: string }[];
  duplicates: { id: string; legalName: string; reason: string; exact: boolean }[];
  availableActions: string[];
}

export interface SupplierSearchResult {
  items: SupplierSummary[];
  meta: PaginationMeta;
  sources: { name: string; status: "OK" | "NOT_CONFIGURED" | "UNAVAILABLE"; note: string }[];
}

export interface DuplicateCheck {
  exact: { id: string; legalName: string; reason: string }[];
  possible: { id: string; legalName: string; reason: string }[];
}

export interface SupplierRfqRecipientView {
  id: string;
  supplier: { id: string; legalName: string; state: string | null };
  status: "INVITED" | "REQUESTED" | "QUOTED" | "DECLINED";
  requestedAt: string | null;
  requestedVia: string | null;
}

export interface SupplierQuoteView {
  id: string;
  supplier: { id: string; legalName: string; state: string | null; city: string | null };
  quoteReference: string | null;
  quoteDate: string | null;
  validUntil: string | null;
  expired: boolean;
  quantity: string | null;
  unit: string;
  unitPrice: string | null;
  currency: string;
  priceBasis: PriceBasis;
  moq: string | null;
  moqUnit: string | null;
  leadTimeDays: number | null;
  capacity: string | null;
  capacityUnit: string | null;
  capacityPeriod: string | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  packaging: string | null;
  /** null = not stated by the supplier (never treated as zero). */
  charges: { taxPercent: string | null; packagingPerUnit: string | null; inlandTransportPerUnit: string | null; inspectionTotal: string | null; otherTotal: string | null; taxIncluded: boolean | null };
  certificationsOffered: string[];
  specificationOffered: string | null;
  notes: string | null;
  review: SupplierQuoteReview;
  reviewedBy: string | null;
  reviewedAt: string | null;
  status: SupplierQuoteStatus;
  attachments: SupplierAttachmentView[];
  rowVersion: number;
}

export interface SupplierRfqSummary {
  id: string;
  rfqNumber: string;
  productName: string;
  quantity: string;
  unit: string;
  requiredBy: string | null;
  quoteDueDate: string | null;
  status: SupplierRfqStatus;
  suppliersRequested: number;
  quotesReceived: number;
  selectedSupplier: { id: string; legalName: string } | null;
  buyerPurchaseOrder: { id: string; poNumber: string } | null;
  updatedAt: string;
}

export interface SupplierRfqDetail extends SupplierRfqSummary {
  rowVersion: number;
  productId: string | null;
  specification: string | null;
  deliveryLocation: string | null;
  packaging: string | null;
  qualityRequirements: string | null;
  certificationsRequired: string[];
  paymentTermsRequested: string | null;
  validUntil: string | null;
  notes: string | null;
  wastagePercent: string | null;
  baseQuantity: string | null;
  recipients: SupplierRfqRecipientView[];
  quotes: SupplierQuoteView[];
  selection: { quoteId: string; supplierId: string; by: string | null; at: string; reason: string | null } | null;
  rfqText: string;
  activity: { id: string; title: string; actor: string | null; createdAt: string }[];
  availableActions: string[];
}

export interface SupplierComparisonRow {
  quote: SupplierQuoteView;
  normalizedUnitPrice: string | null;
  landedUnitCost: string | null;
  landedTotal: string | null;
  unknownCharges: string[];
  fx: { rate: string; from: string; to: string; sourceLabel: string | null; sourceDate: string | null } | null;
  fxMissing: boolean;
  moqFit: boolean | null;
  leadTimeFit: boolean | null;
  certification: { required: string[]; offered: string[]; onFile: string[]; missing: string[] };
  capacityFit: boolean | null;
  qualityHistory: { passRatePercent: string | null; inspections: number };
  score: number | null;
  confidencePercent: number;
  breakdown: { factor: string; points: number; max: number; explanation: string }[];
  rank: number | null;
}

export interface SupplierComparison {
  targetCurrency: string;
  rows: SupplierComparisonRow[];
  recommendation: {
    advisory: true;
    bestPrice: string | null;
    fastest: string | null;
    lowestMoq: string | null;
    certificationFit: string | null;
    balanced: string | null;
    statements: string[];
    basis: string;
  };
  excluded: { quoteId: string; supplier: string; reason: string }[];
}

export interface SupplierPoItemView {
  id: string;
  productId: string | null;
  productName: string;
  specification: string | null;
  quantity: string;
  unit: string;
  unitPrice: string | null;
  taxPercent: string | null;
  lineTotal: string | null;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  damagedQuantity: string;
  pendingInspection: string;
}

export interface PayableInstallmentView {
  id: string;
  sequence: number;
  label: string;
  percentage: string | null;
  amount: string;
  trigger: SupplierPaymentTrigger;
  dueDays: number | null;
  dueDate: string | null;
  dueBasis: string;
  paid: string;
  outstanding: string;
  status: PayableStatus;
  daysOverdue: number | null;
}

export interface SupplierPaymentView {
  id: string;
  amount: string;
  currency: string;
  appliedAmount: string;
  paidAt: string;
  method: string;
  reference: string | null;
  bankName: string | null;
  notes: string | null;
  status: "RECORDED" | "REVERSED";
  reversal: { reason: string; by: string | null; at: string } | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface SupplierPayableView {
  id: string;
  supplier: { id: string; legalName: string };
  supplierPo: { id: string; spoNumber: string };
  currency: string;
  total: string;
  paid: string;
  outstanding: string;
  nextDueDate: string | null;
  status: PayableStatus;
  installments: PayableInstallmentView[];
  payments: SupplierPaymentView[];
  rowVersion: number;
}

export interface SupplierPoSummary {
  id: string;
  spoNumber: string;
  revision: number;
  supplier: { id: string; legalName: string };
  buyerPurchaseOrder: { id: string; poNumber: string } | null;
  shipment: { id: string; shipmentNumber: string } | null;
  productNames: string[];
  currency: string;
  total: string | null;
  originalExpectedDate: string | null;
  expectedDate: string | null;
  delayDays: number | null;
  overdue: boolean;
  status: SupplierPoStatus;
  procurementStatus: ProcurementStatus;
  receivedPercent: number;
  qualityState: QualityStatus | "NONE";
  payable: { status: PayableStatus; outstanding: string } | null;
  updatedAt: string;
}

export interface SupplierPoDetail extends SupplierPoSummary {
  rowVersion: number;
  rfq: { id: string; rfqNumber: string } | null;
  quote: { id: string; reference: string | null } | null;
  poDate: string | null;
  items: SupplierPoItemView[];
  charges: { packaging: string | null; inlandTransport: string | null; inspection: string | null; other: string | null; tax: string | null };
  subtotal: string | null;
  deliveryLocation: string | null;
  paymentTerms: string | null;
  paymentSchedule: { label: string; percentage: string | null; trigger: SupplierPaymentTrigger; dueDays: number | null; fixedDate: string | null }[];
  qualityRequirements: string | null;
  certificationRequirements: string[];
  notes: string | null;
  issuedAt: string | null;
  issuedBy: string | null;
  externallySent: { at: string; via: string; by: string | null } | null;
  snapshot: Record<string, unknown> | null;
  revisions: { revision: number; at: string; by: string | null; reason: string; snapshot: Record<string, unknown> }[];
  history: { id: string; type: string; from: string | null; to: string | null; reason: string | null; at: string; by: string | null }[];
  receipts: GoodsReceiptSummary[];
  payableDetail: SupplierPayableView | null;
  cost: ProcurementCostView;
  completion: { allowed: boolean; blockers: string[] };
  allowedStatuses: string[];
  availableActions: string[];
  messageText: string;
}

export interface GoodsReceiptSummary {
  id: string;
  grnNumber: string;
  supplier: { id: string; legalName: string };
  supplierPo: { id: string; spoNumber: string };
  receivedAt: string;
  location: string | null;
  quantity: string;
  unit: string;
  qualityStatus: QualityStatus;
}

export interface QualityInspectionView {
  id: string;
  itemId: string | null;
  inspectedAt: string;
  inspector: string | null;
  status: QualityStatus;
  checks: { requirement: string; result: "PASS" | "FAIL" | "NA"; note: string | null }[];
  acceptedQuantity: string;
  rejectedQuantity: string;
  reason: string | null;
  notes: string | null;
  attachments: SupplierAttachmentView[];
  rowVersion: number;
}

export interface GoodsReceiptDetail extends GoodsReceiptSummary {
  receivedBy: string | null;
  notes: string | null;
  overReceiptReason: string | null;
  items: { id: string; spoItemId: string; productName: string; received: string; damaged: string; accepted: string; rejected: string; unit: string }[];
  inspections: QualityInspectionView[];
  qualityRequirements: string | null;
  availableActions: string[];
}

export interface ProcurementCostView {
  currency: string;
  quoteEstimate: string | null;
  committed: string | null;
  receivedValue: string | null;
  actual: string | null;
  components: { label: string; amount: string | null; basis: string }[];
  complete: boolean;
  missing: string[];
  basis: string;
}

export interface ProcurementOverview {
  suppliers: number;
  openRfqs: number;
  quotesAwaitingReview: number;
  openSupplierPos: number;
  delayed: number;
  awaitingInspection: number;
  qualityHolds: number;
  paymentsDue: number;
  overduePayables: { currency: string; amount: string }[];
  actions: { kind: string; title: string; href: string }[];
}

export interface ProcurementRequirement {
  buyerPurchaseOrder: { id: string; poNumber: string; status: string };
  items: { productId: string | null; productName: string; quantity: string; unit: string; specification: string | null; packaging: string | null }[];
  existingRfqs: { id: string; rfqNumber: string; status: SupplierRfqStatus }[];
  existingSupplierPos: { id: string; spoNumber: string; status: SupplierPoStatus }[];
}

export interface ShipmentProcurement {
  shipmentId: string;
  supplierPos: { id: string; spoNumber: string; supplier: string; status: SupplierPoStatus; procurementStatus: ProcurementStatus; expectedDate: string | null; receivedPercent: number; qualityState: QualityStatus | "NONE" }[];
  goodsReceived: boolean;
  qualityApproved: boolean;
  costComplete: boolean;
  costSource: "LINKED" | "MANUAL" | "CONFLICT" | "NONE";
  missing: string[];
}

export interface ProcurementList<T> {
  items: T[];
  meta: PaginationMeta;
}
