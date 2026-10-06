"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FlaskConical, RotateCw, Search, SearchX, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import type { HSReferenceItem, ProductAnalysisResponse, SelectClassificationRequest } from "@exportpro/types";
import { productAnalysisApi } from "@/lib/api/products";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { AMBIGUITY_LABELS, categoryLabel, INPUT_TYPE_LABELS } from "@/lib/product-labels";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { RequirePermission } from "@/components/layout/require-permission";
import { CandidateOption } from "@/components/products/candidate-option";
import { ClarificationForm } from "@/components/products/clarification-form";
import {
  AnalysisProgress,
  ClassificationDisclaimer,
  ConfidenceBadge,
  PROVIDER_UNAVAILABLE_MESSAGE,
} from "@/components/products/classification-bits";
import { ConfirmClassificationDialog } from "@/components/products/confirm-classification-dialog";
import { HsCodeSearch } from "@/components/products/hs-code-search";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError && error.code === "SERVICE_UNAVAILABLE"
    ? PROVIDER_UNAVAILABLE_MESSAGE
    : toFriendlyErrorMessage(error);
}

export default function AnalysisResultPage() {
  return (
    <RequirePermission permission="products.view">
      <AnalysisResultContent />
    </RequirePermission>
  );
}

function AnalysisResultContent() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canAnalyze = hasPermission(session, "products.analyze");
  const canConfirm = hasPermission(session, "products.confirm_classification");
  const queryKey = ["product-analysis", analysisId];

  const detail = useQuery({ queryKey, queryFn: () => productAnalysisApi.getById(analysisId) });
  const [picked, setPicked] = React.useState<{ key: string; id: string } | null>(null);
  const [showSearch, setShowSearch] = React.useState(false);
  const [manualPick, setManualPick] = React.useState<HSReferenceItem | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const data = detail.data;
  // A local pick applies only to the analysis version it was made on; new results fall back to the server selection.
  const resultKey = data ? `${data.revision}:${data.selectedCandidateId}:${data.candidates.length}` : "";
  const selectedId = picked?.key === resultKey ? picked.id : (data?.selectedCandidateId ?? data?.primaryCandidateId ?? null);
  const setSelectedId = (id: string) => setPicked({ key: resultKey, id });

  const onUpdated = (updated: ProductAnalysisResponse) => {
    queryClient.setQueryData(queryKey, updated);
    queryClient.invalidateQueries({ queryKey: ["product-analysis", "recent"] });
  };

  const clarify = useMutation({
    mutationFn: (answers: { questionId: string; answer: string }[]) => productAnalysisApi.clarify(analysisId, { answers }),
    onSuccess: (updated) => {
      onUpdated(updated);
      toast.success("Analysis updated", "Review the updated candidates below.");
    },
  });
  const rerun = useMutation({
    mutationFn: () => productAnalysisApi.reanalyze(analysisId),
    onSuccess: onUpdated,
  });
  const select = useMutation({
    mutationFn: (body: SelectClassificationRequest) => productAnalysisApi.select(analysisId, body),
    onSuccess: (updated) => {
      onUpdated(updated);
      setShowSearch(false);
      setManualPick(null);
      toast.success("Selection saved", "Not confirmed yet — confirm to save the product.");
    },
    onError: (error) => toast.error("Could not select code", toFriendlyErrorMessage(error)),
  });

  if (detail.isLoading) return <PageSkeleton />;
  if (detail.isError || !data) {
    return (
      <ErrorState
        title="Analysis not found"
        message={toFriendlyErrorMessage(detail.error)}
        onRetry={() => detail.refetch()}
      />
    );
  }

  const a = data;
  const confirmed = a.status === "CONFIRMED";
  const editable = !confirmed && canAnalyze;
  const busy = clarify.isPending || rerun.isPending;
  const aiCandidates = a.candidates.filter((c) => c.source !== "USER_SELECTED");
  const manualCandidates = a.candidates.filter((c) => c.source === "USER_SELECTED");
  const primary = a.candidates.find((c) => c.id === a.primaryCandidateId) ?? null;
  const alternatives = aiCandidates.filter((c) => c.id !== a.primaryCandidateId);
  const selected = a.candidates.find((c) => c.id === selectedId) ?? null;
  const ambiguity = AMBIGUITY_LABELS[a.ambiguity.status];
  const isReference = a.provenance.sourceType === "REFERENCE_LOOKUP";
  const showClarify = editable && a.ambiguity.clarifyingQuestions.length > 0;
  const candidateTag = (id: string) =>
    id === a.primaryCandidateId ? (isReference ? "Entered code" : "Recommended") : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Products", href: "/products" },
          { label: "Analyze", href: "/products/analyze" },
          { label: a.identification.normalizedProductName },
        ]}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {isReference ? (
            <Badge variant="neutral">Reference lookup</Badge>
          ) : (
            <Badge variant="info">AI-assisted classification</Badge>
          )}
          {a.provenance.isDevelopmentResult && (
            <Badge variant="warning">
              <FlaskConical className="size-3" aria-hidden="true" />
              Development demo result
            </Badge>
          )}
          <Badge variant="neutral">Not customs/government verified</Badge>
          <Badge variant={ambiguity.variant}>{ambiguity.label}</Badge>
        </div>
        <PageTitle className="break-words">{a.identification.normalizedProductName}</PageTitle>
        <p className="max-w-3xl text-sm text-foreground">{a.identification.summary}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Category: <span className="text-foreground">{categoryLabel(a.identification.categoryCode)}</span></span>
          <span className="flex items-center gap-1">
            Product identification: <ConfidenceBadge confidence={a.identification.confidence} />
          </span>
          <span>Revision {a.revision}</span>
        </div>
      </div>

      {confirmed && a.linkedProduct && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm">
          <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          Confirmed for platform use and saved as
          <Link href={`/products/${a.linkedProduct.id}`} className="font-medium text-primary hover:underline">
            {a.linkedProduct.displayName}
          </Link>
        </div>
      )}
      {!confirmed && a.linkedProduct && (
        <HelperText>
          Re-analysis of saved product <Link href={`/products/${a.linkedProduct.id}`} className="text-primary hover:underline">{a.linkedProduct.displayName}</Link>.
          Its classification only changes if you confirm a code here.
        </HelperText>
      )}
      {!confirmed && a.possibleDuplicates.length > 0 && !a.linkedProduct && (
        <div role="status" className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <span className="font-medium text-foreground">You already have a similar saved product</span>
          {a.possibleDuplicates.map((d) => (
            <Link key={d.id} href={`/products/${d.id}`} className="w-fit text-primary hover:underline">
              {d.displayName} · {d.classificationCode}
            </Link>
          ))}
          <HelperText>When you confirm, you can update it instead of creating a duplicate.</HelperText>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {(a.ambiguity.status !== "CLEAR" || showClarify) && (
            <Card className="p-4">
              {a.ambiguity.status !== "CLEAR" ? (
                <div role="alert" className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
                  <div>
                    <SectionTitle className="text-base">More information is needed for stronger classification confidence.</SectionTitle>
                    {a.ambiguity.reason && <p className="mt-1 text-sm text-foreground">{a.ambiguity.reason}</p>}
                  </div>
                </div>
              ) : (
                <SectionTitle className="text-base">Optional: describe the product for an AI-assisted check</SectionTitle>
              )}
              {showClarify && (
                <div className="mt-4">
                  {busy ? (
                    <AnalysisProgress />
                  ) : (
                    <ClarificationForm
                      key={a.revision}
                      questions={a.ambiguity.clarifyingQuestions}
                      previousAnswers={a.clarificationAnswers}
                      submitting={clarify.isPending}
                      onSubmit={(answers) => clarify.mutate(answers)}
                    />
                  )}
                  {clarify.isError && (
                    <p role="alert" className="mt-3 text-sm text-danger">{errorMessage(clarify.error)}</p>
                  )}
                </div>
              )}
              {!confirmed && a.ambiguity.status !== "CLEAR" && (
                <HelperText className="mt-3">You can still select a candidate or search for a code manually below.</HelperText>
              )}
            </Card>
          )}

          <section aria-labelledby="candidates-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle id="candidates-heading">Classification candidates</SectionTitle>
              {editable && (
                <Button variant="outline" size="sm" onClick={() => setShowSearch((v) => !v)} aria-expanded={showSearch}>
                  {showSearch ? <X className="size-4" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
                  {showSearch ? "Close search" : "Change HS Code"}
                </Button>
              )}
            </div>

            {showSearch && (
              <Card className="p-4">
                <SectionTitle className="mb-3 text-base">Search classification</SectionTitle>
                <HsCodeSearch selected={manualPick} onSelect={setManualPick} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    disabled={!manualPick}
                    loading={select.isPending}
                    onClick={() => manualPick && select.mutate({ code: manualPick.code, codeSystem: manualPick.codeSystem })}
                  >
                    Use selected code
                  </Button>
                  <HelperText className="self-center">Manually selected codes carry no AI confidence.</HelperText>
                </div>
              </Card>
            )}

            {a.candidates.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No classification could be suggested"
                description={editable ? "Answer the questions above or search for a code manually." : "No candidates for this analysis."}
              />
            ) : (
              <div role="radiogroup" aria-labelledby="candidates-heading" className="flex flex-col gap-4">
                {primary && (
                  <div className="flex flex-col gap-2">
                    <Caption className="font-medium uppercase tracking-wide">
                      {isReference ? "Code you entered" : "Primary suggestion"}
                    </Caption>
                    <CandidateOption candidate={primary} name="candidate" checked={selectedId === primary.id} disabled={confirmed} tag={candidateTag(primary.id)} onSelect={setSelectedId} />
                  </div>
                )}
                {alternatives.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <Caption className="font-medium uppercase tracking-wide">
                      {isReference ? "More specific codes" : "Alternative classifications"}
                    </Caption>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {alternatives.map((c) => (
                        <CandidateOption key={c.id} candidate={c} name="candidate" checked={selectedId === c.id} disabled={confirmed} onSelect={setSelectedId} />
                      ))}
                    </div>
                  </div>
                )}
                {manualCandidates.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <Caption className="font-medium uppercase tracking-wide">Your manual selections</Caption>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {manualCandidates.map((c) => (
                        <CandidateOption key={c.id} candidate={c} name="candidate" checked={selectedId === c.id} disabled={confirmed} tag="Manual" onSelect={setSelectedId} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <ClassificationDisclaimer />

            {!confirmed && (
              <div className="flex flex-wrap items-center gap-2">
                {canConfirm ? (
                  <Button disabled={!selected} onClick={() => setConfirmOpen(true)}>
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    Use this classification
                  </Button>
                ) : (
                  canAnalyze && (
                    <Button
                      disabled={!selected || selected.id === a.selectedCandidateId}
                      loading={select.isPending}
                      onClick={() => selected && select.mutate({ candidateId: selected.id })}
                    >
                      Save selection for review
                    </Button>
                  )
                )}
                {canAnalyze && !isReference && (
                  <Button variant="outline" onClick={() => rerun.mutate()} loading={rerun.isPending} disabled={busy}>
                    <RotateCw className="size-4" aria-hidden="true" />
                    Re-analyze
                  </Button>
                )}
                {!canConfirm && <HelperText>Confirming a classification requires a manager role.</HelperText>}
              </div>
            )}
            {rerun.isError && <p role="alert" className="text-sm text-danger">{errorMessage(rerun.error)}</p>}
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="p-4">
            <SectionTitle className="text-sm">Your input</SectionTitle>
            <dl className="mt-2 flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{INPUT_TYPE_LABELS[a.inputType]}</dt>
                <dd className="break-words text-foreground">{a.rawInput}</dd>
              </div>
              {Object.entries(a.details).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                  <dd className="break-words text-foreground">{v}</dd>
                </div>
              ))}
              {a.clarificationAnswers.map((ans) => (
                <div key={ans.questionId}>
                  <dt className="text-xs text-muted-foreground">{ans.question}</dt>
                  <dd className="break-words text-foreground">{ans.answer}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {(a.identification.material || a.identification.form || a.identification.intendedUse || a.identification.composition) && (
            <Card className="p-4">
              <SectionTitle className="text-sm">{isReference ? "Identification" : "AI interpretation"}</SectionTitle>
              <dl className="mt-2 flex flex-col gap-2 text-sm">
                {(
                  [
                    ["Material", a.identification.material],
                    ["Form", a.identification.form],
                    ["Intended use", a.identification.intendedUse],
                    ["Composition", a.identification.composition],
                  ] as const
                ).map(([label, value]) =>
                  value ? (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="break-words text-foreground">{value}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </Card>
          )}

          <Card className="p-4">
            <SectionTitle className="text-sm">Source &amp; provenance</SectionTitle>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <dt className="text-muted-foreground">Source</dt>
              <dd className="text-foreground">
                {a.provenance.sourceType === "AI_DERIVED" ? "AI model" : a.provenance.sourceType === "DEVELOPMENT_DEMO" ? "Development demo rules" : "Tariff reference data"}
              </dd>
              <dt className="text-muted-foreground">Provider</dt>
              <dd className="break-words text-foreground">{a.provenance.provider}</dd>
              {a.provenance.model && (
                <>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="break-words text-foreground">{a.provenance.model}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Version</dt>
              <dd className="text-foreground">{a.provenance.promptVersion}</dd>
              <dt className="text-muted-foreground">Generated</dt>
              <dd className="text-foreground">{new Date(a.provenance.generatedAt).toLocaleString()}</dd>
            </dl>
            {a.provenance.isDevelopmentResult && (
              <HelperText className="mt-3">
                Generated by deterministic development rules, not a real AI model. For demo and testing only.
              </HelperText>
            )}
          </Card>
        </aside>
      </div>

      {selected && canConfirm && !confirmed && (
        <ConfirmClassificationDialog
          key={`${selected.id}-${confirmOpen}`}
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          analysis={a}
          candidate={selected}
          onConfirmed={(product, created) => {
            setConfirmOpen(false);
            queryClient.invalidateQueries({ queryKey: ["products"] });
            queryClient.invalidateQueries({ queryKey: ["product-analysis"] });
            toast.success(created ? "Product saved" : "Product updated", "Classification confirmed for platform analysis.");
            router.push(`/products/${product.id}`);
          }}
        />
      )}
    </div>
  );
}
