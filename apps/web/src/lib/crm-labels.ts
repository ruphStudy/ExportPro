import type { BadgeProps } from "@/components/ui/badge";
import type { LeadHealth, LeadPriority, LeadTaskStatus } from "@exportpro/types";

export const PRIORITY_VARIANT: Record<LeadPriority, NonNullable<BadgeProps["variant"]>> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "danger",
};

export const HEALTH_LABEL: Record<LeadHealth, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  HEALTHY: { label: "On track", variant: "success" },
  NEEDS_ATTENTION: { label: "Needs attention", variant: "warning" },
  AT_RISK: { label: "Follow-up at risk", variant: "danger" },
  CLOSED: { label: "Closed", variant: "neutral" },
};

export const TASK_STATUS_VARIANT: Record<LeadTaskStatus, NonNullable<BadgeProps["variant"]>> = {
  OPEN: "info",
  IN_PROGRESS: "warning",
  DONE: "success",
  CANCELLED: "neutral",
};

export function fmtDay(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export function relativeDays(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}

export function fmtValue(value: number | null, currency: string | null): string | null {
  if (value === null) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency ?? ""}`.trim();
  }
}

/** `<input type="datetime-local">` value ↔ ISO. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function fromLocalInput(v: string): string | undefined {
  return v ? new Date(v).toISOString() : undefined;
}
