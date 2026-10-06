import type { VerificationStatus } from "@exportpro/types";
import type { BadgeProps } from "@/components/ui/badge";

/**
 * "VERIFIED" is never shown unless the backend actually set it (which
 * nothing in Sprint 3 does) — see ARCHITECTURE.md "No Fake Government
 * Verification". Never infer verification from a number or file alone.
 */
export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  NOT_PROVIDED: { label: "Not provided", variant: "neutral" },
  USER_DECLARED: { label: "Provided", variant: "info" },
  FORMAT_VALID: { label: "Format checked", variant: "info" },
  DOCUMENT_UPLOADED: { label: "Document uploaded", variant: "success" },
  PENDING_REVIEW: { label: "Pending review", variant: "warning" },
  VERIFIED: { label: "Verified", variant: "success" },
  REJECTED: { label: "Rejected", variant: "danger" },
};
