import { Landmark } from "lucide-react";
import type { IngestionRunStatus, TradeDataSourceSummary } from "@exportpro/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

type Variant = NonNullable<BadgeProps["variant"]>;

export const RUN_STATUS: Record<IngestionRunStatus, { label: string; variant: Variant }> = {
  PENDING: { label: "Pending", variant: "neutral" },
  RUNNING: { label: "Running", variant: "info" },
  SUCCEEDED: { label: "Succeeded", variant: "success" },
  PARTIAL: { label: "Partial", variant: "warning" },
  FAILED: { label: "Failed", variant: "danger" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
};

export function RunStatusBadge({ status }: { status: IngestionRunStatus }) {
  const s = RUN_STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/** Source classification badge — "Official" only when the registry marks the source official. */
export function SourceKindBadge({ s }: { s: Pick<TradeDataSourceSummary, "official" | "sourceType"> }) {
  if (s.sourceType === "DEMO") return <Badge variant="warning">Demo / sample</Badge>;
  if (s.sourceType === "INTERNAL") return <Badge variant="neutral">Internal reference</Badge>;
  if (s.official)
    return (
      <Badge variant="success">
        <Landmark className="size-3" aria-hidden="true" />
        Official{s.sourceType === "INTERGOVERNMENTAL" ? " (intergovernmental)" : " (government)"}
      </Badge>
    );
  return <Badge variant="info">Public</Badge>;
}

export const ACCESS_LABELS: Record<string, string> = {
  API: "API",
  CSV: "CSV download",
  XLSX: "XLSX download",
  JSON: "JSON file",
  ZIP: "ZIP download",
  MANUAL_IMPORT: "Manual import",
};

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());
