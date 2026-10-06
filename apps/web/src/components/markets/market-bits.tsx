import { AlertTriangle, Flag, Scale, Ship } from "lucide-react";
import type { MarketContext, PersonalFit, SourceMetadata } from "@exportpro/types";
import { FRESHNESS_LABELS, SOURCE_TYPE_LABELS } from "@/lib/opportunity-labels";
import { cn } from "@/lib/utils";
import { Badge, type BadgeProps } from "@/components/ui/badge";

type Variant = NonNullable<BadgeProps["variant"]>;

/** Higher = better everywhere in market intelligence. */
export const scoreVariant = (score: number): Variant => (score >= 67 ? "success" : score >= 40 ? "warning" : "danger");
export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Risk-style level (HIGH = bad) → badge variant. */
export const riskVariant = (level: string): Variant => (level === "LOW" || level === "EASY" ? "success" : level === "MODERATE" ? "warning" : "danger");

export function ScorePill({ score, label }: { score: number; label?: string }) {
  return (
    <Badge variant={scoreVariant(score)}>
      {label ? `${label} ` : ""}
      {score}/100
    </Badge>
  );
}

export function ContextBadges({ context }: { context: MarketContext }) {
  return (
    <>
      {context.isCurrentExportMarket && (
        <Badge variant="info">
          <Ship className="size-3" aria-hidden="true" />
          Current Export Market
        </Badge>
      )}
      {context.isTargetMarket && !context.isCurrentExportMarket && (
        <Badge variant="info">
          <Flag className="size-3" aria-hidden="true" />
          Your Target Market
        </Badge>
      )}
    </>
  );
}

export function PersonalFitBadge({ fit }: { fit: PersonalFit | null }) {
  if (!fit) return <span className="text-xs text-muted-foreground">No profile</span>;
  return (
    <span className="text-xs text-foreground" title={fit.reasons.join(" · ") || "No specific profile signals"}>
      Fit {fit.score}/100
    </span>
  );
}

/** Mandatory sample label + source metadata, shown in full (not only in tooltips). */
export function MarketSourcePanel({ source, confidence, className }: { source: SourceMetadata; confidence?: number | null; className?: string }) {
  const fresh = FRESHNESS_LABELS[source.freshness];
  return (
    <section aria-label="Data source" className={cn("flex flex-col gap-3 rounded-lg border border-border bg-surface p-4", className)}>
      {source.isSample && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm font-medium text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          Sample market intelligence — not official trade or regulatory data.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Meta label="Source type" value={SOURCE_TYPE_LABELS[source.sourceType]} />
        <Meta label="Source" value={source.sourceName} className="col-span-2" />
        <Meta label="Period" value={`${source.coverageFrom}–${source.coverageTo}`} />
        <Meta label="Source date" value={new Date(source.sourceDate).toLocaleDateString()} />
        <Meta label="Last updated" value={new Date(source.lastUpdatedAt).toLocaleDateString()} />
        <div>
          <dt className="text-xs text-muted-foreground">Freshness</dt>
          <dd><Badge variant={fresh.variant}>{fresh.label}</Badge></dd>
        </div>
        {confidence !== undefined && confidence !== null && <Meta label="Data confidence" value={`${confidence}/100`} />}
        <Meta label="Dataset version" value={source.datasetVersion} />
      </dl>
    </section>
  );
}

export function Meta({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}

/** Section-level legal/regulatory warning (not repeated on every card). */
export function RegulatoryNotice({ text, isSample }: { text: string; isSample: boolean }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
      <Scale className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <span>
        <span className="font-medium">Human verification required.</span> {isSample && "Illustrative only — verify before commercial use. "}
        {text}
      </span>
    </p>
  );
}

export const VERIFICATION_LABELS: Record<string, string> = {
  DATASET_ONLY: "Dataset only — unverified",
  INFORMATIONAL: "Informational",
  PENDING_VERIFICATION: "Pending verification",
  VERIFIED_SOURCE: "Verified source",
};
