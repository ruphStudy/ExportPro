import type { TradeDocumentType } from "./compliance";

/**
 * Sprint 17 — document extraction & cross-document validation.
 *
 * Kept separate on purpose:
 *   original file (TradeDocument, immutable) ≠ extraction (immutable, per version)
 *   ≠ human-confirmed data (separate snapshot) ≠ validation run/findings ≠ sign-off.
 * Extraction is advisory; only confirmed/structured data is compared for sign-off.
 * Validation checks consistency across records — not authenticity or legality.
 */

export const DOCUMENT_EXTRACTION_SCHEMA_VERSION = "doc-extract-v1";
export const DOCUMENT_VALIDATION_RULE_VERSION = "document-validation-v1";

export type DocumentExtractionStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED" | "NEEDS_REVIEW" | "CONFIRMED";
export type ExtractionConfidence = "HIGH" | "MEDIUM" | "LOW";
/** Where a value came from. AI/rule values are never treated as confirmed. */
export type ExtractionProvenance = "AI_EXTRACTED" | "RULE_EXTRACTED" | "USER_CONFIRMED" | "USER_CORRECTED" | "USER_ENTERED" | "STRUCTURED_SOURCE";
export type ExtractionProviderType = "AI" | "RULE" | "MANUAL";
export type TextAvailability = "TEXT" | "PDF_TEXT_LAYER" | "AI_FILE_INPUT" | "UNAVAILABLE";

export const EXTRACTION_HEADER_FIELDS = [
  "documentNumber",
  "documentDate",
  "buyerName",
  "buyerAddress",
  "buyerCountry",
  "exporterName",
  "exporterAddress",
  "consigneeName",
  "consigneeAddress",
  "notifyParty",
  "currency",
  "incoterm",
  "incotermPlace",
  "poNumber",
  "quotationNumber",
  "piNumber",
  "invoiceNumber",
  "originCountry",
  "destinationCountry",
  "totalAmount",
  "paymentTerms",
  "deliveryTerms",
  "carrier",
  "vessel",
  "voyage",
  "containerNumbers",
  "blNumber",
  "awbNumber",
  "portOfLoading",
  "portOfDischarge",
  "placeOfDelivery",
  "etd",
  "eta",
  "packageCount",
  "grossWeightKg",
  "netWeightKg",
  "cargoDescription",
  "certificateNumber",
  "certificateType",
  "issuer",
  "issueDate",
  "expiryDate",
  "hsCode",
  "productDescription",
] as const;
export type ExtractionHeaderField = (typeof EXTRACTION_HEADER_FIELDS)[number];

export const EXTRACTION_ITEM_FIELDS = [
  "description",
  "hsCode",
  "buyerSku",
  "quantity",
  "unit",
  "unitPrice",
  "total",
  "specification",
  "packaging",
  "countryOfOrigin",
  "packageCount",
  "packageType",
  "marks",
  "netWeightKg",
  "grossWeightKg",
  "dimensions",
  "volumeCbm",
] as const;
export type ExtractionItemField = (typeof EXTRACTION_ITEM_FIELDS)[number];

export interface ExtractedDocumentField {
  /** Text exactly as found (or as entered). */
  raw: string | null;
  /** Normalized comparable value (ISO dates, ISO currency, decimals, KG …). Null when unknown/unparseable. */
  value: string | null;
  confidence: ExtractionConfidence;
  sourceText: string | null;
  page: number | null;
  ambiguous: boolean;
  note: string | null;
  provenance: ExtractionProvenance;
}

export interface ExtractedDocumentItem {
  fields: Partial<Record<ExtractionItemField, ExtractedDocumentField>>;
}

export interface ExtractionResult {
  detectedType: { value: TradeDocumentType | null; confidence: ExtractionConfidence | null };
  fields: Partial<Record<ExtractionHeaderField, ExtractedDocumentField>>;
  items: ExtractedDocumentItem[];
  ambiguities: string[];
  warnings: string[];
}

export interface DocumentExtractionView {
  id: string;
  tradeDocumentId: string;
  documentVersion: number;
  extractionVersion: number;
  providerType: ExtractionProviderType;
  providerName: string;
  providerModel: string | null;
  promptVersion: string | null;
  schemaVersion: string;
  status: DocumentExtractionStatus;
  textAvailability: TextAvailability;
  detectedDocumentType: TradeDocumentType | null;
  documentTypeConfidence: ExtractionConfidence | null;
  overallConfidence: number | null;
  result: ExtractionResult | null;
  warnings: string[];
  errorMessage: string | null;
  missingFields: string[];
  startedAt: string;
  completedAt: string | null;
  createdBy: string | null;
}

/** Human-reviewed snapshot (never overwrites the extraction it was based on). */
export interface ConfirmedDocumentData {
  id: string;
  extractionId: string | null;
  extractionVersion: number | null;
  documentVersion: number;
  confirmedDocumentType: TradeDocumentType;
  fields: Partial<Record<ExtractionHeaderField, { value: string | null; raw: string | null; provenance: ExtractionProvenance; unknown: boolean }>>;
  items: { fields: Partial<Record<ExtractionItemField, { value: string | null; raw: string | null; provenance: ExtractionProvenance }>> }[];
  correctionCount: number;
  note: string | null;
  reviewedBy: string | null;
  reviewedAt: string;
}

/** Normalized comparable representation of any document (structured or confirmed). */
export interface NormalizedDocumentView {
  documentId: string | null;
  label: string;
  kind: string;
  version: number | null;
  dataSource: "STRUCTURED" | "CONFIRMED" | "UNREVIEWED";
  buyerCompanyId: string | null;
  fields: Partial<Record<ExtractionHeaderField, string | null>>;
  items: {
    key: string | null;
    description: string;
    hsCode: string | null;
    hsConfirmed: boolean;
    buyerSku: string | null;
    quantity: string | null;
    unit: string | null;
    unitPrice: string | null;
    total: string | null;
    packageCount: string | null;
    netWeightKg: string | null;
    grossWeightKg: string | null;
  }[];
}

export interface DocumentExtractionOverview {
  documentId: string;
  documentType: TradeDocumentType;
  documentVersion: number;
  /** Generated ExportPro documents use their stored structured snapshot — no extraction. */
  structured: boolean;
  structuredData: NormalizedDocumentView | null;
  hasFile: boolean;
  fileKind: "PDF" | "IMAGE" | "TEXT" | "OFFICE" | "NONE";
  extractionAvailable: boolean;
  extractionUnavailableReason: string | null;
  providerName: string;
  extractions: DocumentExtractionView[];
  confirmed: ConfirmedDocumentData | null;
  availableActions: string[];
}

export type DocumentValidationStatus = "NOT_RUN" | "PROCESSING" | "NEEDS_REVIEW" | "FAILED" | "PASSED" | "PASSED_WITH_WARNINGS" | "REJECTED" | "SIGNED_OFF";
export type ValidationSeverity = "INFO" | "WARNING" | "CRITICAL";
export type ValidationFindingStatus = "OPEN" | "ACCEPTED_DIFFERENCE" | "CORRECTED" | "FALSE_POSITIVE" | "RESOLVED";
export const DOCUMENT_VALIDATION_FINDING_TYPES = [
  "QUANTITY_MISMATCH",
  "PRICE_MISMATCH",
  "ADDRESS_MISMATCH",
  "CURRENCY_MISMATCH",
  "INCOTERM_MISMATCH",
  "DATE_MISMATCH",
  "HS_CODE_MISMATCH",
  "BUYER_MISMATCH",
  "EXPORTER_MISMATCH",
  "PRODUCT_MISMATCH",
  "UNIT_MISMATCH",
  "TOTAL_MISMATCH",
  "DOCUMENT_NUMBER_MISMATCH",
  "WEIGHT_MISMATCH",
  "PACKAGING_MISMATCH",
  "COUNTRY_MISMATCH",
  "PORT_MISMATCH",
  "MISSING_FIELD",
  "UNEXPECTED_FIELD",
  "UNCONFIRMED_DATA",
] as const;
export type DocumentValidationFindingType = (typeof DOCUMENT_VALIDATION_FINDING_TYPES)[number];

export interface DocumentValidationComment {
  id: string;
  findingId: string | null;
  body: string;
  author: string | null;
  createdAt: string;
}

export interface DocumentValidationFindingView {
  id: string;
  type: DocumentValidationFindingType;
  severity: ValidationSeverity;
  field: string;
  itemReference: string | null;
  sourceDocument: { id: string | null; label: string };
  referenceDocument: { id: string | null; label: string } | null;
  sourceField: string | null;
  referenceField: string | null;
  rule: string;
  expectedValue: string | null;
  actualValue: string | null;
  normalizedExpected: string | null;
  normalizedActual: string | null;
  message: string;
  status: ValidationFindingStatus;
  resolution: { note: string; by: string | null; at: string; carriedFromRun: number | null } | null;
  comments: DocumentValidationComment[];
}

export interface ValidationSignoff {
  by: string | null;
  at: string;
  note: string | null;
  unresolvedWarnings: number;
  unresolvedCritical: number;
  overrideReason: string | null;
}

export interface DocumentValidationRunView {
  id: string;
  runNumber: number;
  scope: "DOCUMENT" | "PACKAGE";
  purchaseOrderId: string | null;
  primaryDocumentId: string | null;
  ruleVersion: string;
  status: DocumentValidationStatus;
  documents: { id: string | null; label: string; kind: string; version: number | null; dataSource: NormalizedDocumentView["dataSource"] }[];
  comparisons: { source: string; reference: string }[];
  counts: { critical: number; warning: number; info: number; open: number; openCritical: number };
  summary: string;
  createdBy: string | null;
  createdAt: string;
  isLatest: boolean;
  signoff: ValidationSignoff | null;
  rejection: { by: string | null; at: string; reason: string } | null;
  findings: DocumentValidationFindingView[];
  comments: DocumentValidationComment[];
  availableActions: string[];
}

export type MissingDocumentState = "AVAILABLE" | "MISSING_NOW" | "EXPECTED_LATER" | "NOT_APPLICABLE" | "UNKNOWN";

export interface MissingDocumentRow {
  documentType: TradeDocumentType;
  label: string;
  state: MissingDocumentState;
  requirementId: string | null;
  requirementName: string;
  level: string;
  basis: string;
  responsibleParty: string;
  generatable: boolean;
  reason: string;
  document: { id: string; title: string; status: string; validationStatus: DocumentValidationStatus } | null;
}

export interface PackageDocumentRow {
  id: string;
  title: string;
  documentType: TradeDocumentType;
  version: number;
  status: string;
  generated: boolean;
  dataSource: NormalizedDocumentView["dataSource"] | "NONE";
  extractionStatus: DocumentExtractionStatus | null;
  validationStatus: DocumentValidationStatus;
  openIssues: number;
  purchaseOrderId: string | null;
}

export interface ValidationPackageView {
  purchaseOrder: { id: string; poNumber: string; status: string; buyerName: string };
  checklistId: string | null;
  status: DocumentValidationStatus;
  completeness: { requiredNow: number; availableNow: number; expectedLater: number; unknown: number; warnings: number; validationIssues: number };
  sprint15OpenDiscrepancies: number;
  documents: PackageDocumentRow[];
  missing: MissingDocumentRow[];
  latestRun: DocumentValidationRunView | null;
  history: { id: string; runNumber: number; status: DocumentValidationStatus; counts: DocumentValidationRunView["counts"]; createdAt: string; createdBy: string | null; signedOffBy: string | null; documents: number }[];
  availableActions: string[];
}

export interface ValidationDashboard {
  needsValidation: PackageDocumentRow[];
  issues: { runId: string; purchaseOrderId: string | null; primaryDocumentId: string | null; label: string; critical: number; warning: number; status: DocumentValidationStatus; createdAt: string }[];
  missing: { purchaseOrderId: string; poNumber: string; buyerName: string; rows: MissingDocumentRow[] }[];
  signedOff: { runId: string; purchaseOrderId: string | null; primaryDocumentId: string | null; label: string; signedOffAt: string; signedOffBy: string | null }[];
  history: { runId: string; purchaseOrderId: string | null; primaryDocumentId: string | null; label: string; status: DocumentValidationStatus; critical: number; warning: number; createdAt: string }[];
  summary: { documentsValidated: number; critical: number; warnings: number; missing: number; unresolved: number; signedOff: number; lastValidationAt: string | null };
}
