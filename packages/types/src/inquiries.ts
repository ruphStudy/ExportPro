import type { PaginationMeta } from "./api";

/**
 * Sprint 13 buyer inquiry / RFQ contracts. Provenance is always explicit:
 * inquiry content is BUYER_PROVIDED, extraction output is AI_DERIVED (or
 * DEVELOPMENT_DEMO for the rule-based dev extractor) and reviewed data is
 * USER_CONFIRMED. AI output never becomes confirmed data without a human.
 */

export const InquirySource = { EMAIL_REPLY: "EMAIL_REPLY", MANUAL: "MANUAL", RFQ_UPLOAD: "RFQ_UPLOAD", CRM: "CRM", OTHER: "OTHER" } as const;
export type InquirySource = (typeof InquirySource)[keyof typeof InquirySource];

export const InquiryStatus = {
  NEW: "NEW",
  REVIEWING: "REVIEWING",
  NEEDS_CLARIFICATION: "NEEDS_CLARIFICATION",
  QUALIFIED: "QUALIFIED",
  REJECTED: "REJECTED",
  ARCHIVED: "ARCHIVED",
  CONVERTED: "CONVERTED",
} as const;
export type InquiryStatus = (typeof InquiryStatus)[keyof typeof InquiryStatus];

export const InquiryPriority = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", URGENT: "URGENT" } as const;
export type InquiryPriority = (typeof InquiryPriority)[keyof typeof InquiryPriority];

export const ExtractionStatus = { NOT_STARTED: "NOT_STARTED", PROCESSING: "PROCESSING", COMPLETED: "COMPLETED", NEEDS_REVIEW: "NEEDS_REVIEW", FAILED: "FAILED" } as const;
export type ExtractionStatus = (typeof ExtractionStatus)[keyof typeof ExtractionStatus];

export const InquiryApprovalStatus = { NOT_REQUIRED: "NOT_REQUIRED", PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED" } as const;
export type InquiryApprovalStatus = (typeof InquiryApprovalStatus)[keyof typeof InquiryApprovalStatus];

export const InquiryRejectCategory = {
  NOT_RELEVANT: "NOT_RELEVANT",
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  COMMERCIAL_MISMATCH: "COMMERCIAL_MISMATCH",
  BUYER_RISK: "BUYER_RISK",
  INCOMPLETE_REQUIREMENT: "INCOMPLETE_REQUIREMENT",
  OTHER: "OTHER",
} as const;
export type InquiryRejectCategory = (typeof InquiryRejectCategory)[keyof typeof InquiryRejectCategory];

export const RFQ_INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;
export type RfqIncoterm = (typeof RFQ_INCOTERMS)[number];

export const PAYMENT_TERM_TYPES = ["ADVANCE", "LC", "DP", "DA", "OPEN_ACCOUNT", "CREDIT", "MIXED", "OTHER"] as const;
export type PaymentTermType = (typeof PAYMENT_TERM_TYPES)[number];

export type FieldConfidence = "HIGH" | "MEDIUM" | "LOW";
export type InquiryProvenance = "BUYER_PROVIDED" | "AI_DERIVED" | "DEVELOPMENT_DEMO" | "USER_CONFIRMED";

/** One extracted value with its own confidence, buyer wording and ambiguity flag. */
export interface ExtractedField<T> {
  value: T | null;
  /** Buyer's original wording, when explicit. */
  raw: string | null;
  confidence: FieldConfidence;
  /** true = stated in the inquiry; false = inferred (shown as such, never confirmed automatically). */
  explicit: boolean;
  ambiguous: boolean;
  note: string | null;
}

export interface ExtractedItem {
  productName: ExtractedField<string>;
  /** Only when the HS code appears in the inquiry text. */
  hsCode: ExtractedField<string>;
  /** Separate, unconfirmed AI suggestion — never treated as confirmed. */
  hsSuggestion: { code: string; confidence: FieldConfidence } | null;
  quantity: ExtractedField<number>;
  quantityUnit: ExtractedField<string>;
  specification: ExtractedField<string>;
  packaging: ExtractedField<string>;
  targetPrice: ExtractedField<number>;
  priceCurrency: ExtractedField<string>;
  priceUnitBasis: ExtractedField<string>;
  /** "around $2/kg" is indicative, never an exact price. */
  priceIndicative: boolean;
  deliveryDate: ExtractedField<string>;
}

export interface ExtractedRfq {
  items: ExtractedItem[];
  destination: { countryCode: ExtractedField<string>; city: ExtractedField<string>; port: ExtractedField<string>; location: ExtractedField<string> };
  incoterm: { term: ExtractedField<RfqIncoterm>; place: ExtractedField<string> };
  certifications: { name: string; raw: string | null; confidence: FieldConfidence }[];
  paymentTerms: { type: ExtractedField<PaymentTermType>; advancePercent: ExtractedField<number>; creditDays: ExtractedField<number>; raw: string | null };
  delivery: { targetDate: ExtractedField<string>; shipmentWindow: ExtractedField<string>; leadTime: ExtractedField<string>; urgency: ExtractedField<"URGENT" | "NORMAL"> };
  sample: { required: ExtractedField<boolean>; quantity: ExtractedField<string>; specification: ExtractedField<string>; deadline: ExtractedField<string> };
  ambiguities: { field: string; reason: string }[];
  suggestedQuestions: string[];
  /** 0–100, separate from field confidence. */
  overallConfidence: number;
}

export interface InquiryExtraction {
  id: string;
  version: number;
  status: "COMPLETED" | "FAILED";
  provider: string;
  model: string | null;
  promptVersion: string;
  provenance: "AI_DERIVED" | "DEVELOPMENT_DEMO";
  generatedAt: string;
  overallConfidence: number | null;
  data: ExtractedRfq | null;
  /** Fields dropped by schema validation (partial extraction keeps the rest). */
  invalidFields: string[];
  error: string | null;
  attachmentsUsed: string[];
  attachmentsSkipped: { filename: string; reason: string }[];
  createdBy: string | null;
}

export interface ConfirmedItem {
  id?: string;
  productName: string;
  productId: string | null;
  hsCode: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  quantityText: string | null;
  specification: string | null;
  packaging: string | null;
  targetPrice: string | null;
  priceCurrency: string | null;
  priceUnitBasis: string | null;
  priceIndicative: boolean;
  deliveryDate: string | null;
}

/** Human-confirmed RFQ (USER_CONFIRMED). Stored separately from every AI extraction. */
export interface ConfirmedRfq {
  items: ConfirmedItem[];
  destination: { countryCode: string | null; city: string | null; port: string | null; location: string | null };
  incoterm: { term: RfqIncoterm | null; place: string | null };
  certifications: string[];
  paymentTerms: { type: PaymentTermType | null; advancePercent: number | null; creditDays: number | null; raw: string | null };
  delivery: { targetDate: string | null; shipmentWindow: string | null; leadTime: string | null; urgent: boolean };
  sample: { required: boolean; quantity: string | null; specification: string | null; deadline: string | null };
  notes: string | null;
}

export interface InquiryClarificationQuestion {
  text: string;
  source: "MANUAL" | "AI_SUGGESTED" | "SYSTEM";
}

export interface QualificationChecklist {
  buyerIdentified: boolean;
  productIdentified: boolean;
  quantityKnown: boolean;
  destinationKnown: boolean;
  requirementClear: boolean;
  contactAvailable: boolean;
  commercialReviewed: boolean;
}

export interface QuotationRequest {
  id: string;
  inquiryId: string;
  status: "PENDING" | "READY_FOR_FUTURE_MODULE";
  crmLeadId: string | null;
  buyerCompanyId: string | null;
  items: ConfirmedItem[];
  requestedBy: string | null;
  createdAt: string;
}

export interface SampleRequest {
  id: string;
  inquiryId: string;
  status: "PENDING";
  buyerCompanyId: string | null;
  productName: string | null;
  productId: string | null;
  quantity: string | null;
  specification: string | null;
  deadline: string | null;
  requestedBy: string | null;
  createdAt: string;
}

export interface InquirySummary {
  id: string;
  reference: string;
  subject: string;
  snippet: string;
  source: InquirySource;
  status: InquiryStatus;
  priority: InquiryPriority;
  suggestedPriority: InquiryPriority | null;
  unread: boolean;
  receivedAt: string;
  buyer: { id: string | null; name: string; countryCode: string | null; demo: boolean };
  products: string[];
  countryCode: string | null;
  owner: { id: string; name: string } | null;
  attachmentCount: number;
  extractionStatus: ExtractionStatus;
  approvalStatus: InquiryApprovalStatus;
  isRfq: boolean;
  crmLeadId: string | null;
}

export interface InquiryListResponse {
  items: InquirySummary[];
  meta: PaginationMeta;
  counts: { unread: number; needsReview: number; qualified: number; needsClarification: number };
}

export interface InquiryActivity {
  id: string;
  type: string;
  title: string;
  actor: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface InquiryAttachmentView {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  textExtraction: "AVAILABLE" | "NOT_AVAILABLE";
  uploadedBy: string | null;
  createdAt: string;
}

export interface MissingField {
  field: string;
  label: string;
  reason: "MISSING" | "LOW_CONFIDENCE" | "AMBIGUOUS";
}

export interface BuyerInquiryDetail extends InquirySummary {
  body: string;
  bodyWasHtml: boolean;
  bodyProvenance: "BUYER_PROVIDED";
  buyerContact: { email: string | null; name: string | null } | null;
  buyerRisk: { score: number; level: string; verificationStatus: string } | null;
  buyerMatch: { score: number; level: string; productName: string } | null;
  sourceMessage: { id: string; subject: string; campaignId: string | null; sentAt: string | null; available: boolean } | null;
  priorityReasons: string[];
  rowVersion: number;
  createdBy: string | null;
  attachments: InquiryAttachmentView[];
  extractions: InquiryExtraction[];
  latestExtraction: InquiryExtraction | null;
  confirmed: (ConfirmedRfq & { confirmedAt: string; confirmedBy: string | null; basedOnExtractionVersion: number | null }) | null;
  /** Edited-but-unconfirmed RFQ saved for later (not confirmed data). */
  reviewDraft: (ConfirmedRfq & { savedAt: string; savedBy: string | null }) | null;
  missingFields: MissingField[];
  suggestedQuestions: InquiryClarificationQuestion[];
  clarification: { questions: InquiryClarificationQuestion[]; requestedAt: string; requestedBy: string | null; draftMessage: string } | null;
  qualification: { checklist: QualificationChecklist; decidedAt: string; decidedBy: string | null; overrideReason: string | null } | null;
  qualificationChecks: { key: keyof QualificationChecklist; label: string; met: boolean | null; detail: string }[];
  approval: { status: InquiryApprovalStatus; history: { action: string; reason: string | null; actor: string | null; at: string }[] };
  rejection: { category: InquiryRejectCategory; reason: string; at: string; by: string | null } | null;
  quotationRequest: QuotationRequest | null;
  sampleRequest: SampleRequest | null;
  crm: { leadId: string; stage: string; owner: string | null; stageSuggestion: { stage: string; reason: string } | null } | null;
  crmCandidates: { leadId: string; stage: string; productName: string | null }[];
  possibleDuplicates: { id: string; reference: string; subject: string; receivedAt: string; reason: string }[];
  activities: InquiryActivity[];
  availableActions: string[];
}
