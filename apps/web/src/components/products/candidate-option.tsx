"use client";

import { CheckCircle2, CircleAlert } from "lucide-react";
import type { ProductClassificationCandidate } from "@exportpro/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CodeLabel, ConfidenceBadge, SourceLabel } from "./classification-bits";

/** One selectable candidate. A native radio inside a label keeps arrow-key navigation within the group. */
export function CandidateOption({
  candidate,
  name,
  checked,
  disabled,
  tag,
  onSelect,
}: {
  candidate: ProductClassificationCandidate;
  name: string;
  checked: boolean;
  disabled?: boolean;
  tag?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <label
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border p-4 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
        disabled ? "cursor-default" : "cursor-pointer",
        checked ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-muted/50",
      )}
    >
      <input
        type="radio"
        name={name}
        value={candidate.id}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(candidate.id)}
        className="sr-only"
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CodeLabel code={candidate.code} codeSystem={candidate.codeSystem} />
        <div className="flex flex-wrap items-center gap-1.5">
          {tag && <Badge variant="info">{tag}</Badge>}
          {checked && (
            <Badge variant="success">
              <CheckCircle2 className="size-3" aria-hidden="true" />
              Selected
            </Badge>
          )}
        </div>
      </div>
      <p className="break-words font-medium text-foreground">{candidate.referenceDescription ?? candidate.description}</p>
      {candidate.referenceDescription && candidate.referenceDescription !== candidate.description && (
        <p className="break-words text-xs text-muted-foreground">Suggested as: {candidate.description}</p>
      )}
      {candidate.reasoningSummary && <p className="break-words text-xs text-muted-foreground">{candidate.reasoningSummary}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={candidate.confidence} />
        <SourceLabel source={candidate.source} />
        {!candidate.inReferenceData && (
          <span className="flex items-center gap-1 text-xs text-warning">
            <CircleAlert className="size-3.5" aria-hidden="true" />
            Not in reference dataset
          </span>
        )}
      </div>
    </label>
  );
}
