import type { ExtractionStatus, FieldConfidence, InquiryApprovalStatus, InquiryPriority, InquiryRejectCategory, InquirySource, InquiryStatus } from "@exportpro/types";

type Variant = "neutral" | "success" | "warning" | "danger" | "info";

export const INQUIRY_STATUS: Record<InquiryStatus, { label: string; variant: Variant }> = {
  NEW: { label: "New", variant: "info" },
  REVIEWING: { label: "Reviewing", variant: "neutral" },
  NEEDS_CLARIFICATION: { label: "Needs clarification", variant: "warning" },
  QUALIFIED: { label: "Qualified", variant: "success" },
  REJECTED: { label: "Rejected", variant: "danger" },
  ARCHIVED: { label: "Archived", variant: "neutral" },
  CONVERTED: { label: "Converted", variant: "success" },
};

export const PRIORITY: Record<InquiryPriority, { label: string; variant: Variant }> = {
  LOW: { label: "Low", variant: "neutral" },
  MEDIUM: { label: "Medium", variant: "info" },
  HIGH: { label: "High", variant: "warning" },
  URGENT: { label: "Urgent", variant: "danger" },
};

export const SOURCE_LABELS: Record<InquirySource, string> = {
  EMAIL_REPLY: "Outreach reply",
  MANUAL: "Manual",
  RFQ_UPLOAD: "RFQ upload",
  CRM: "CRM lead",
  OTHER: "Other",
};

export const EXTRACTION_LABELS: Record<ExtractionStatus, { label: string; variant: Variant }> = {
  NOT_STARTED: { label: "Not extracted", variant: "neutral" },
  PROCESSING: { label: "Extracting…", variant: "info" },
  COMPLETED: { label: "RFQ confirmed", variant: "success" },
  NEEDS_REVIEW: { label: "Extracted — needs review", variant: "warning" },
  FAILED: { label: "Extraction failed", variant: "danger" },
};

export const APPROVAL_LABELS: Record<InquiryApprovalStatus, { label: string; variant: Variant }> = {
  NOT_REQUIRED: { label: "No approval requested", variant: "neutral" },
  PENDING: { label: "Approval pending", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  REJECTED: { label: "Approval rejected", variant: "danger" },
};

export const REJECT_CATEGORIES: Record<InquiryRejectCategory, string> = {
  NOT_RELEVANT: "Not relevant",
  PRODUCT_UNAVAILABLE: "Product unavailable",
  COMMERCIAL_MISMATCH: "Commercial mismatch",
  BUYER_RISK: "Buyer risk",
  INCOMPLETE_REQUIREMENT: "Incomplete requirement",
  OTHER: "Other",
};

export const CONFIDENCE: Record<FieldConfidence, { label: string; variant: Variant }> = {
  HIGH: { label: "High confidence", variant: "success" },
  MEDIUM: { label: "Medium confidence", variant: "info" },
  LOW: { label: "Low confidence", variant: "warning" },
};
