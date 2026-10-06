"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import * as React from "react";
import {
  LOW_CONFIDENCE_THRESHOLD,
  PLATFORM_CONFIRMATION_NOTE,
  type DuplicateConflictDetails,
  type ProductAnalysisResponse,
  type ProductClassificationCandidate,
  type ProductDetail,
  type ProductSummary,
} from "@exportpro/types";
import { productAnalysisApi } from "@/lib/api/products";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { categoryLabel } from "@/lib/product-labels";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/modal";
import { Caption } from "@/components/ui/typography";
import { ClassificationDisclaimer, CodeLabel, ConfidenceBadge, SourceLabel } from "./classification-bits";

/** Mirrors the backend rule — the backend still enforces it. */
export function needsLowConfidenceAck(candidate: ProductClassificationCandidate, analysis: ProductAnalysisResponse): boolean {
  if (candidate.source === "AI_SUGGESTED") {
    return analysis.ambiguity.status !== "CLEAR" || (candidate.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD;
  }
  return !candidate.inReferenceData || (candidate.codeSystem === "HS" && candidate.code.length < 6);
}

type Resolution = { kind: "UPDATE_EXISTING"; productId: string } | { kind: "CREATE_NEW" } | null;

export function ConfirmClassificationDialog({
  open,
  onOpenChange,
  analysis,
  candidate,
  onConfirmed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysis: ProductAnalysisResponse;
  candidate: ProductClassificationCandidate;
  onConfirmed: (product: ProductDetail, created: boolean) => void;
}) {
  const [displayName, setDisplayName] = React.useState(analysis.identification.normalizedProductName);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [duplicates, setDuplicates] = React.useState<ProductSummary[]>([]);
  const [resolution, setResolution] = React.useState<Resolution>(null);
  const [error, setError] = React.useState<string | null>(null);
  const needsAck = needsLowConfidenceAck(candidate, analysis);

  const confirm = useMutation({
    mutationFn: () =>
      productAnalysisApi.confirm(analysis.id, {
        candidateId: candidate.id,
        confirmation: true,
        displayName: displayName.trim() || undefined,
        acknowledgeLowConfidence: needsAck ? acknowledged : undefined,
        duplicateResolution: resolution?.kind,
        existingProductId: resolution?.kind === "UPDATE_EXISTING" ? resolution.productId : undefined,
      }),
    onSuccess: (result) => onConfirmed(result.product, result.created),
    onError: (err) => {
      if (err instanceof ApiRequestError && err.code === "CONFLICT" && err.details) {
        const found = (err.details as DuplicateConflictDetails).duplicates ?? [];
        if (found.length > 0) {
          setDuplicates(found);
          setResolution({ kind: "UPDATE_EXISTING", productId: found[0].id });
          setError("A similar product is already saved. Choose whether to update it or save a new product.");
          return;
        }
      }
      setError(toFriendlyErrorMessage(err));
    },
  });

  const nameValid = displayName.trim().length >= 2;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Use this classification for platform analysis"
      description="Review before saving. You can change it later."
      confirmLabel="Confirm & Save"
      loading={confirm.isPending}
      confirmDisabled={!nameValid || (needsAck && !acknowledged) || (duplicates.length > 0 && !resolution)}
      onConfirm={() => confirm.mutate()}
      className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto"
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Product name"
          required
          value={displayName}
          maxLength={200}
          onChange={(e) => setDisplayName(e.target.value)}
          error={nameValid ? undefined : "Enter at least 2 characters."}
        />
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-3">
          <Caption>Selected classification</Caption>
          <CodeLabel code={candidate.code} codeSystem={candidate.codeSystem} />
          <p className="break-words text-sm text-foreground">{candidate.referenceDescription ?? candidate.description}</p>
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceBadge confidence={candidate.source === "AI_SUGGESTED" ? candidate.confidence : null} />
            <SourceLabel source={candidate.source} />
            <Caption>· Category: {categoryLabel(analysis.identification.categoryCode)}</Caption>
          </div>
        </div>

        {analysis.linkedProduct && (
          <p className="text-xs text-muted-foreground">
            This updates the saved product <span className="font-medium text-foreground">{analysis.linkedProduct.displayName}</span>.
          </p>
        )}

        {needsAck && (
          <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
            <p className="flex items-start gap-2 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              This classification has low confidence, open questions, or is not a complete code. Confirming records that you
              chose it anyway — its confidence is not raised.
            </p>
            <Checkbox
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              label="I understand and want to use it for platform analysis"
            />
          </div>
        )}

        {duplicates.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">Similar saved product found</legend>
            {duplicates.map((d) => (
              <ResolutionOption
                key={d.id}
                checked={resolution?.kind === "UPDATE_EXISTING" && resolution.productId === d.id}
                onSelect={() => setResolution({ kind: "UPDATE_EXISTING", productId: d.id })}
                label={`Update “${d.displayName}”`}
                hint={`Currently ${d.classificationCode}`}
              />
            ))}
            <ResolutionOption
              checked={resolution?.kind === "CREATE_NEW"}
              onSelect={() => setResolution({ kind: "CREATE_NEW" })}
              label="Save as a new product"
              hint="Only if this is genuinely a different product"
            />
          </fieldset>
        )}

        <ClassificationDisclaimer>
          <p className="font-medium">This does not represent customs or government verification.</p>
          <p>{PLATFORM_CONFIRMATION_NOTE}</p>
        </ClassificationDisclaimer>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}

function ResolutionOption({ checked, onSelect, label, hint }: { checked: boolean; onSelect: () => void; label: string; hint: string }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col rounded-md border p-2.5 text-sm focus-within:ring-2 focus-within:ring-ring",
        checked ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <input type="radio" name="duplicate-resolution" checked={checked} onChange={onSelect} className="sr-only" />
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </label>
  );
}
