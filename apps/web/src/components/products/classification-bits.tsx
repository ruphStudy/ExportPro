"use client";

import { Info, Loader2 } from "lucide-react";
import * as React from "react";
import {
  CLASSIFICATION_DISCLAIMER,
  formatTariffCode,
  type ClassificationSource,
  type CodeSystem,
} from "@exportpro/types";
import { CLASSIFICATION_SOURCE_LABELS, CODE_SYSTEM_LABELS, confidenceDisplay } from "@/lib/product-labels";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/** Text label + numeric value — confidence is never conveyed by color alone. */
export function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  const { label, variant } = confidenceDisplay(confidence);
  return <Badge variant={variant}>{label}</Badge>;
}

export function CodeLabel({ code, codeSystem, className }: { code: string; codeSystem: CodeSystem; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span className="font-mono text-base font-semibold text-foreground">{formatTariffCode(code)}</span>
      <Badge variant="neutral">{CODE_SYSTEM_LABELS[codeSystem]}</Badge>
    </span>
  );
}

export function SourceLabel({ source }: { source: ClassificationSource }) {
  return <span className="text-xs text-muted-foreground">{CLASSIFICATION_SOURCE_LABELS[source]}</span>;
}

export function ClassificationDisclaimer({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div role="note" className={cn("flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-foreground", className)}>
      <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p>
          <span className="font-medium">Not customs/government verified.</span> {CLASSIFICATION_DISCLAIMER}
        </p>
        {children}
      </div>
    </div>
  );
}

const STAGES = ["Identifying product…", "Evaluating possible classifications…", "Preparing alternatives…"];

/** Staged progress text (no fake percentages); stays on the last stage until the request finishes. */
export function AnalysisProgress({ label }: { label?: string }) {
  const [stage, setStage] = React.useState(0);
  React.useEffect(() => {
    if (label) return;
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 2500);
    return () => clearInterval(timer);
  }, [label]);
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
      <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
      {label ?? STAGES[stage]}
    </div>
  );
}

export const PROVIDER_UNAVAILABLE_MESSAGE = "Product analysis is temporarily unavailable. Please try again later.";
