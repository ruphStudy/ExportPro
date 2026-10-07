"use client";

import { FlaskConical, Info } from "lucide-react";
import type { CampaignStatus, DeliveryMode, ExclusionReason, OutreachMessageStatus, RecipientStatus } from "@exportpro/types";
import { CAMPAIGN_STATUS_LABELS, EXCLUSION_REASON_LABELS, MESSAGE_STATUS_LABELS } from "@exportpro/types";
import type { BadgeProps } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type V = NonNullable<BadgeProps["variant"]>;

const CAMPAIGN_VARIANT: Record<CampaignStatus, V> = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  RUNNING: "info",
  PAUSED: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
  FAILED: "danger",
};
export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge variant={CAMPAIGN_VARIANT[status]}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>;
}

const MESSAGE_VARIANT: Record<OutreachMessageStatus, V> = {
  DRAFT: "neutral",
  SCHEDULED: "neutral",
  QUEUED: "info",
  SENT: "info",
  DELIVERED: "success",
  OPENED: "success",
  REPLIED: "success",
  BOUNCED: "danger",
  FAILED: "danger",
  CANCELLED: "neutral",
  OPTED_OUT: "warning",
};
/** Development messages never say "Sent" — they were only recorded. */
export function MessageStatusBadge({ status, simulated }: { status: OutreachMessageStatus; simulated?: boolean }) {
  if (simulated && status === "SENT") return <Badge variant="neutral">Recorded (dev — not delivered)</Badge>;
  return <Badge variant={MESSAGE_VARIANT[status]}>{MESSAGE_STATUS_LABELS[status]}</Badge>;
}

const RECIPIENT_LABEL: Record<RecipientStatus, [string, V]> = {
  PENDING: ["Eligible", "info"],
  ACTIVE: ["Active", "info"],
  EXCLUDED: ["Excluded", "neutral"],
  REPLIED: ["Replied", "success"],
  BOUNCED: ["Bounced", "danger"],
  OPTED_OUT: ["Opted out", "warning"],
  COMPLETED: ["Sequence complete", "success"],
  CANCELLED: ["Cancelled", "neutral"],
  FAILED: ["Failed", "danger"],
};
export function RecipientStatusBadge({ status, reason }: { status: RecipientStatus; reason?: ExclusionReason | null }) {
  const [label, v] = RECIPIENT_LABEL[status];
  return (
    <Badge variant={v} title={reason ? EXCLUSION_REASON_LABELS[reason] : undefined}>
      {label}
      {reason ? `: ${EXCLUSION_REASON_LABELS[reason]}` : ""}
    </Badge>
  );
}

export function DeliveryModeBanner({ mode, className }: { mode: DeliveryMode | null | undefined; className?: string }) {
  if (mode !== "DEVELOPMENT") return null;
  return (
    <div role="note" className={cn("flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/5 p-3 text-sm", className)}>
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <p>
        <span className="font-semibold">Development delivery.</span> No email provider is connected. Messages are recorded inside ExportPro and are{" "}
        <span className="font-semibold">never sent to buyers</span>. Delivery, open and bounce metrics are unavailable rather than simulated.
      </p>
    </div>
  );
}

/** A metric that may be unsupported by the provider: shows "Unavailable", never 0. */
export function Metric({ label, value, rate, hint }: { label: string; value: number | null; rate?: number | null; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3" title={hint}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">
        {value === null ? <span className="text-sm font-normal text-muted-foreground">Unavailable</span> : value}
        {rate !== undefined && value !== null && <span className="ml-1 text-xs font-normal text-muted-foreground">{rate === null ? "" : `(${rate}%)`}</span>}
      </dd>
    </div>
  );
}

export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export const fmtDateTime = (iso: string | null, tz?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", ...(tz ? { timeZone: tz } : {}) }) : "—";

export const COMMON_TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Australia/Sydney",
];
