import type { DiscrepancySeverity, ProformaInvoiceStatus, PurchaseOrderStatus, QuotationStatus } from "@exportpro/types";

type Variant = "neutral" | "success" | "warning" | "danger" | "info";
const L = (label: string, variant: Variant) => ({ label, variant });

export const Q_STATUS: Record<QuotationStatus, { label: string; variant: Variant }> = {
  DRAFT: L("Draft", "neutral"),
  READY: L("Ready", "info"),
  ISSUED: L("Issued", "info"),
  SENT: L("Sent", "info"),
  ACCEPTED: L("Accepted", "success"),
  REJECTED: L("Rejected", "danger"),
  EXPIRED: L("Expired", "warning"),
  SUPERSEDED: L("Superseded", "neutral"),
  CANCELLED: L("Cancelled", "neutral"),
};
export const PI_STATUS: Record<ProformaInvoiceStatus, { label: string; variant: Variant }> = {
  DRAFT: L("Draft", "neutral"),
  ISSUED: L("Issued", "info"),
  SENT: L("Sent", "info"),
  ACCEPTED: L("Accepted", "success"),
  SUPERSEDED: L("Superseded", "neutral"),
  CANCELLED: L("Cancelled", "neutral"),
};
export const PO_STATUS: Record<PurchaseOrderStatus, { label: string; variant: Variant }> = {
  RECEIVED: L("Received", "info"),
  UNDER_REVIEW: L("Under review", "warning"),
  MATCHED: L("Matched", "success"),
  DISCREPANCY: L("Discrepancy", "danger"),
  ACCEPTED: L("Accepted", "success"),
  REJECTED: L("Rejected", "danger"),
  CANCELLED: L("Cancelled", "neutral"),
};
export const SEVERITY: Record<DiscrepancySeverity, { label: string; variant: Variant }> = {
  CRITICAL: L("Critical", "danger"),
  WARNING: L("Warning", "warning"),
  INFO: L("Info", "neutral"),
};
export const EXPIRY_TEXT = (state: string | null, days: number | null) =>
  state === "EXPIRED" ? "Expired" : state === "EXPIRES_TODAY" ? "Expires today" : state === "EXPIRES_SOON" ? `Expires in ${days} day${days === 1 ? "" : "s"}` : null;
