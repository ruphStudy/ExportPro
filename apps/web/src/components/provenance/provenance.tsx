import { AlertTriangle, Bot, Calculator, Database, FlaskConical, Landmark, UserRound } from "lucide-react";
import type { DataProvenance, SectionProvenance } from "@exportpro/types";
import { SOURCE_QUALITY_LABELS } from "@exportpro/types";
import { FRESHNESS_LABELS } from "@/lib/opportunity-labels";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * Provenance badge. "Official source" only when the registry marks the
 * source official AND the value is source data (raw/normalized). Derived,
 * AI-derived, user-provided and demo values each get their own label.
 */
export function ProvenanceBadge({ p, className }: { p: DataProvenance; className?: string }) {
  const sourceData = p.provenanceType === "SOURCE_RAW" || p.provenanceType === "SOURCE_NORMALIZED";
  if (p.provenanceType === "DEMO")
    return <Badge variant="warning" className={className}><FlaskConical className="size-3" aria-hidden="true" />Sample / demo data</Badge>;
  if (p.provenanceType === "AI_DERIVED")
    return <Badge variant="info" className={className}><Bot className="size-3" aria-hidden="true" />AI-derived</Badge>;
  if (p.provenanceType === "USER_PROVIDED")
    return <Badge variant="neutral" className={className}><UserRound className="size-3" aria-hidden="true" />User-provided</Badge>;
  if (p.provenanceType === "SYSTEM_DERIVED")
    return <Badge variant="neutral" className={className}><Calculator className="size-3" aria-hidden="true" />Derived (calculation)</Badge>;
  if (sourceData && p.official)
    return <Badge variant="success" className={className}><Landmark className="size-3" aria-hidden="true" />Official source{p.sourceType === "INTERGOVERNMENTAL" ? " (intergovernmental)" : ""}</Badge>;
  return <Badge variant="info" className={className}><Database className="size-3" aria-hidden="true" />Public source</Badge>;
}

/** One-line provenance with authority, period, version, freshness and confidence — visible text, not a tooltip. */
export function ProvenanceLine({ p, label, className }: { p: DataProvenance; label?: string; className?: string }) {
  const fresh = FRESHNESS_LABELS[p.freshness];
  const stale = p.freshness === "STALE" || p.freshness === "VERY_STALE";
  return (
    <div className={cn("flex flex-col gap-1 text-xs", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {label && <span className="font-medium text-foreground">{label}:</span>}
        <ProvenanceBadge p={p} />
        <span className="text-foreground">{p.sourceName}</span>
      </div>
      <p className="text-muted-foreground">
        {p.authority}
        {p.sourceDate && ` · data to ${p.sourceDate}`}
        {p.lastIngestedAt && ` · ingested ${new Date(p.lastIngestedAt).toLocaleDateString()}`}
        {` · ${fresh.label.toLowerCase()} · confidence ${p.confidence}/100`}
        {p.provenanceType !== "DEMO" && p.provenanceType !== "SYSTEM_DERIVED" && ` · ${SOURCE_QUALITY_LABELS[p.sourceQuality]}`}
      </p>
      {p.methodology && <p className="text-muted-foreground">Method: {p.methodology}</p>}
      {p.datasetVersion && <p className="break-all text-muted-foreground">Dataset version: {p.datasetVersion}</p>}
      {stale && (
        <p role="note" className="flex items-center gap-1 text-warning">
          <AlertTriangle className="size-3" aria-hidden="true" />
          This source has not been refreshed within its expected cycle.
        </p>
      )}
    </div>
  );
}

/** Mixed-source summary + expandable per-section list. */
export function SectionProvenanceList({ provenance, labels }: { provenance: SectionProvenance; labels: Record<string, string> }) {
  const entries = Object.entries(provenance).filter(([k]) => labels[k]);
  const real = entries.filter(([, p]) => p.provenanceType === "SOURCE_NORMALIZED" || p.provenanceType === "SOURCE_RAW");
  const demo = entries.filter(([, p]) => p.provenanceType === "DEMO");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-foreground">
        {real.length === 0 ? (
          <>All sections use <span className="font-medium">sample / demo data</span> — not official statistics.</>
        ) : demo.length === 0 ? (
          <>All data sections use real sourced data.</>
        ) : (
          <>
            <span className="font-medium">Mixed sources:</span> {real.map(([k]) => labels[k].toLowerCase()).join(", ")} from real sourced data;{" "}
            {demo.map(([k]) => labels[k].toLowerCase()).join(", ")} still sample / demo data.
          </>
        )}
      </p>
      <details className="text-xs">
        <summary className="w-fit cursor-pointer rounded-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Data sources by section
        </summary>
        <ul className="mt-2 flex flex-col gap-3">
          {entries.map(([k, p]) => (
            <li key={k}>
              <ProvenanceLine p={p} label={labels[k]} />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
