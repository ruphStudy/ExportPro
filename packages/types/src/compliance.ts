import type { PaginationMeta } from "./api";
import type { PartySnapshot } from "./commercial";

/**
 * Sprint 16 — export compliance & trade documents.
 *
 * Principles encoded in these types:
 *  - REQUIRED / CONDITIONAL / RECOMMENDED / INFORMATIONAL stay distinct.
 *  - Basis distinguishes regulatory rules from buyer requests and user-defined items.
 *  - Unknown coverage is explicit (never "no requirements").
 *  - Compliance status never claims government verification.
 *  - ExportPro only generates exporter-prepared documents; official/third-party
 *    documents are uploaded and tracked, never generated.
 */

export const REQUIREMENT_TYPES = ["REGISTRATION", "LICENSE", "CERTIFICATION", "DOCUMENT", "LABELING", "INSPECTION", "TESTING", "PACKAGING", "CUSTOMS", "DESTINATION_REQUIREMENT", "OTHER"] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const REQUIREMENT_LEVELS = ["REQUIRED", "CONDITIONAL", "RECOMMENDED", "INFORMATIONAL"] as const;
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

export type ComplianceSeverity = "BLOCKER" | "WARNING" | "INFO";

/** Why an item is on the checklist. Buyer requests are never statutory. */
export type RequirementBasis = "REGULATORY_REQUIRED" | "ADVISORY" | "BUYER_REQUESTED" | "USER_DEFINED";

/** INDIA_EXPORT and DESTINATION_IMPORT are kept distinguishable; TRANSACTION covers order documents. */
export type ComplianceJurisdiction = "INDIA_EXPORT" | "DESTINATION_IMPORT" | "TRANSACTION";

export const COMPLIANCE_SOURCE_TYPES = ["OFFICIAL_GOVERNMENT", "GOVERNMENT_PORTAL", "REGULATOR", "USER_DEFINED", "INTERNAL_RULE", "PARTNER_DATA", "AI_DERIVED"] as const;
export type ComplianceSourceType = (typeof COMPLIANCE_SOURCE_TYPES)[number];

export const REQUIREMENT_STATUSES = ["NOT_STARTED", "MISSING", "IN_PROGRESS", "DOCUMENT_UPLOADED", "UNDER_REVIEW", "SATISFIED", "NOT_APPLICABLE", "EXPIRED", "REJECTED", "WAIVED", "ACCEPTED_RISK"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/** UNKNOWN = the system lacks data to decide (never treated as "not required"). */
export type Applicability = "APPLICABLE" | "NOT_APPLICABLE" | "UNKNOWN";

export type CoverageLevel = "COMPLETE" | "PARTIAL" | "UNKNOWN";
export type ComplianceReadiness = "NOT_READY" | "BLOCKED" | "READY_WITH_WARNINGS" | "READY";
export type OverrideKind = "NOT_APPLICABLE" | "WAIVED" | "ACCEPTED_RISK";

export const RESPONSIBLE_PARTIES = ["EXPORTER", "BUYER", "GOVERNMENT", "CARRIER", "BANK", "INSPECTION_AGENCY", "CUSTOMS_BROKER", "OTHER"] as const;
export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];

export const TRADE_DOCUMENT_TYPES = [
  "COMMERCIAL_INVOICE",
  "PACKING_LIST",
  "SHIPPING_INSTRUCTION",
  "CERTIFICATE_OF_ORIGIN",
  "PHYTOSANITARY_CERTIFICATE",
  "INSPECTION_CERTIFICATE",
  "TEST_CERTIFICATE",
  "FUMIGATION_CERTIFICATE",
  "INSURANCE_CERTIFICATE",
  "SHIPPING_BILL",
  "BILL_OF_LADING",
  "AIRWAY_BILL",
  "REGISTRATION_CERTIFICATE",
  "OTHER",
] as const;
export type TradeDocumentType = (typeof TRADE_DOCUMENT_TYPES)[number];

/** The only types ExportPro may generate (exporter-prepared). Everything else is upload/reference only. */
export const GENERATABLE_DOCUMENT_TYPES = ["COMMERCIAL_INVOICE", "PACKING_LIST", "SHIPPING_INSTRUCTION"] as const;
export type GeneratedDocumentType = (typeof GENERATABLE_DOCUMENT_TYPES)[number];

export const DOCUMENT_SOURCES = ["SYSTEM_GENERATED", "USER_UPLOADED", "GOVERNMENT_ISSUED", "CARRIER_ISSUED", "INSPECTION_AGENCY", "BANK", "BUYER", "OTHER"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export const DOCUMENT_STATUSES = ["DRAFT", "GENERATED", "UPLOADED", "UNDER_REVIEW", "APPROVED", "REJECTED", "ISSUED_EXTERNAL", "EXPIRED", "SUPERSEDED", "ARCHIVED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export type DocumentAvailability = "NOT_AVAILABLE" | "REQUESTED" | "DRAFT" | "AVAILABLE" | "APPROVED" | "EXPIRED";
export type ExpiryState = "VALID" | "EXPIRING_SOON" | "EXPIRED" | null;

export interface RuleProvenance {
  sourceType: ComplianceSourceType;
  sourceName: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  lastCheckedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** True when lastCheckedAt is older than the freshness window. */
  stale: boolean;
}

export interface ComplianceRuleView {
  id: string;
  code: string;
  version: number;
  name: string;
  description: string;
  requirementType: RequirementType;
  level: RequirementLevel;
  severity: ComplianceSeverity;
  basis: RequirementBasis;
  jurisdiction: ComplianceJurisdiction;
  countryCode: string | null;
  hsPrefixes: string[];
  productCategory: string | null;
  responsibleParty: ResponsibleParty;
  satisfiedBy: string;
  documentTypes: TradeDocumentType[];
  provenance: RuleProvenance;
  organizationSpecific: boolean;
  active: boolean;
}

export interface RequirementEvidence {
  kind: "REGISTRATION" | "CERTIFICATION" | "DOCUMENT" | "MANUAL";
  id: string | null;
  label: string;
  status: string;
  expiryDate: string | null;
  /** Conservative verification wording (e.g. "User declared — not government verified"). */
  verificationNote: string | null;
}

export interface RequirementView {
  id: string;
  ruleCode: string;
  ruleVersion: number;
  name: string;
  description: string;
  requirementType: RequirementType;
  level: RequirementLevel;
  severity: ComplianceSeverity;
  basis: RequirementBasis;
  jurisdiction: ComplianceJurisdiction;
  responsibleParty: ResponsibleParty;
  applicability: Applicability;
  status: RequirementStatus;
  /** Human explanation: why this applies (never just a rule code). */
  explanation: string;
  satisfiedBy: string;
  documentTypes: TradeDocumentType[];
  productLabel: string | null;
  provenance: RuleProvenance;
  evidence: RequirementEvidence[];
  expiringSoon: boolean;
  notes: string | null;
  dueDate: string | null;
  override: { kind: OverrideKind; reason: string; by: string | null; at: string } | null;
  manualConfirmation: { note: string; by: string | null; at: string } | null;
  /** True when the item counts against readiness (applicable, not overridden, not satisfied). */
  open: boolean;
}

export interface CoverageView {
  overall: CoverageLevel;
  indiaExport: CoverageLevel;
  destinationImport: CoverageLevel;
  notes: string[];
}

export interface ChecklistDocumentRow {
  documentType: TradeDocumentType;
  label: string;
  level: RequirementLevel;
  basis: RequirementBasis;
  responsibleParty: ResponsibleParty;
  generatable: boolean;
  availability: DocumentAvailability;
  document: { id: string; title: string; status: DocumentStatus; source: DocumentSource; version: number } | null;
}

export interface ComplianceChecklistView {
  id: string;
  provisional: boolean;
  purchaseOrder: { id: string; poNumber: string; status: string; openCriticalDiscrepancies: number } | null;
  quotation: { id: string; displayNumber: string } | null;
  proformaInvoice: { id: string; displayNumber: string } | null;
  inquiryId: string | null;
  buyer: { id: string | null; name: string };
  destinationCountry: string | null;
  incoterm: string | null;
  incotermPlace: string | null;
  shipmentMode: string | null;
  products: { productId: string | null; description: string; hsCode: string | null }[];
  evaluatedAt: string;
  rowVersion: number;
  readiness: ComplianceReadiness;
  readinessReasons: string[];
  requiredReadiness: { satisfied: number; applicable: number; percent: number | null };
  recommendedCompletion: { satisfied: number; applicable: number; percent: number | null };
  coverage: CoverageView;
  blockers: { requirementId: string; name: string; reason: string }[];
  warnings: { requirementId: string; name: string; reason: string }[];
  requirements: RequirementView[];
  documents: ChecklistDocumentRow[];
  ready: { readiness: ComplianceReadiness; at: string; by: string | null; note: string | null; stillValid: boolean } | null;
  events: { id: string; type: string; title: string; actor: string | null; createdAt: string }[];
  availableActions: string[];
}

export interface ChecklistSummary {
  id: string;
  provisional: boolean;
  purchaseOrder: { id: string; poNumber: string } | null;
  quotation: { id: string; displayNumber: string } | null;
  buyerName: string;
  destinationCountry: string | null;
  readiness: ComplianceReadiness;
  coverage: CoverageLevel;
  blockers: number;
  warnings: number;
  readyConfirmed: boolean;
  evaluatedAt: string;
}

export interface RegistrationComplianceRow {
  type: "IEC" | "GST" | "FSSAI" | "APEDA";
  status: string;
  number: string | null;
  verificationStatus: string;
  verificationNote: string;
  expiryDate: string | null;
  expiry: ExpiryState;
  hasEvidence: boolean;
}

export interface CertificationComplianceRow {
  id: string;
  type: string;
  name: string;
  number: string | null;
  issuer: string | null;
  status: string;
  verificationStatus: string;
  expiryDate: string | null;
  expiry: ExpiryState;
  hasEvidence: boolean;
}

export interface ComplianceOverview {
  counts: Record<ComplianceReadiness, number>;
  acceptedPosWithoutChecklist: { id: string; poNumber: string; buyerName: string }[];
  topBlockers: { checklistId: string; label: string; name: string; reason: string }[];
  registrations: RegistrationComplianceRow[];
  certifications: CertificationComplianceRow[];
  expiringDocuments: number;
  expiredDocuments: number;
  checklists: ChecklistSummary[];
}

// ---------------------------------------------------------------- documents

export interface CommercialInvoiceContent {
  invoiceDate: string | null;
  buyerPoReference: string | null;
  consignee: PartySnapshot | null;
  currency: string;
  incoterm: string | null;
  incotermPlace: string | null;
  originCountry: string | null;
  destinationCountry: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  shipmentMode: string | null;
  paymentTerms: string | null;
  shippingTerms: string | null;
  items: { description: string; hsCode: string | null; quantity: string; unit: string; unitPrice: string; total?: string | null }[];
  additionalCharges: string | null;
  chargesLabel: string | null;
  discount: string | null;
  marks: string | null;
  declaration: string | null;
}

export interface PackingListContent {
  invoiceReference: string | null;
  consignee: PartySnapshot | null;
  destinationCountry: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  packages: {
    marks: string | null;
    packageType: string;
    packageCount: number;
    description: string;
    quantity: string | null;
    unit: string | null;
    netWeightKg: string | null;
    grossWeightKg: string | null;
    dimensions: string | null;
    volumeCbm: string | null;
  }[];
  notes: string | null;
}

export interface ShippingInstructionContent {
  consignee: PartySnapshot | null;
  notifyParty: string | null;
  originCountry: string | null;
  destinationCountry: string | null;
  placeOfReceipt: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  finalDestination: string | null;
  incoterm: string | null;
  incotermPlace: string | null;
  shipmentMode: string | null;
  cargoDescription: string | null;
  hsCodes: string | null;
  packageCount: number | null;
  netWeightKg: string | null;
  grossWeightKg: string | null;
  volumeCbm: string | null;
  shippingMarks: string | null;
  freightPayableAt: string | null;
  specialInstructions: string | null;
}

export type GeneratedDocumentContent = CommercialInvoiceContent | PackingListContent | ShippingInstructionContent;

export interface DocumentTotals {
  subtotal?: string | null;
  total?: string | null;
  packages?: number;
  netWeightKg?: string | null;
  grossWeightKg?: string | null;
  volumeCbm?: string | null;
}

export interface TradeDocumentSummary {
  id: string;
  rootId: string;
  documentType: TradeDocumentType;
  title: string;
  documentNumber: string | null;
  version: number;
  status: DocumentStatus;
  source: DocumentSource;
  responsibleParty: ResponsibleParty;
  generated: boolean;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  expiry: ExpiryState;
  buyer: { id: string; name: string } | null;
  purchaseOrder: { id: string; poNumber: string } | null;
  countryCode: string | null;
  createdBy: string | null;
  updatedAt: string;
}

export interface TradeDocumentDetail extends TradeDocumentSummary {
  rowVersion: number;
  previousVersionId: string | null;
  revisionReason: string | null;
  quotation: { id: string; displayNumber: string } | null;
  proformaInvoice: { id: string; displayNumber: string } | null;
  inquiryId: string | null;
  productId: string | null;
  notes: string | null;
  internalNotes: string | null;
  file: { filename: string; mimeType: string; sizeBytes: number; checksum: string } | null;
  content: GeneratedDocumentContent | null;
  totals: DocumentTotals | null;
  exporterSnapshot: PartySnapshot | null;
  validationProblems: string[];
  overrideReason: string | null;
  review: { reviewedBy: string | null; reviewedAt: string | null; approvedBy: string | null; approvedAt: string | null; rejectionReason: string | null };
  versions: { id: string; version: number; status: DocumentStatus; createdAt: string }[];
  differences: string[];
  requirements: { id: string; checklistId: string; name: string; status: RequirementStatus }[];
  events: { id: string; type: string; title: string; actor: string | null; createdAt: string }[];
  availableActions: string[];
}

export interface TradeDocumentList {
  items: TradeDocumentSummary[];
  meta: PaginationMeta;
  counts: { expiring: number; expired: number; underReview: number };
}

export interface DocumentTemplateView {
  documentType: GeneratedDocumentType | "GENERAL";
  footer: string | null;
  terms: string | null;
  declaration: string | null;
  signatureLabel: string | null;
  expiryWarningDays: number;
}
