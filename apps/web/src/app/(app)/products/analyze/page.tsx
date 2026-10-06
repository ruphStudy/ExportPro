"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import {
  detectProductInput,
  PRODUCT_CATEGORIES,
  type ProductAnalysisDetails,
  type ProductAnalysisInput,
  type ProductInputType,
} from "@exportpro/types";
import { productAnalysisApi } from "@/lib/api/products";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { INPUT_TYPE_LABELS } from "@/lib/product-labels";
import { toast } from "@/lib/toast";
import { RequirePermission } from "@/components/layout/require-permission";
import { AnalysisProgress, PROVIDER_UNAVAILABLE_MESSAGE } from "@/components/products/classification-bits";
import { RecentAnalyses } from "@/components/products/recent-analyses";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const EXAMPLES = ["Cumin Seeds", "Biodegradable areca palm leaf dinner plates", "Plastic container", "090931", "Cotton T-shirt", "LED power supply/driver"];

const DETAIL_FIELDS: { key: keyof ProductAnalysisDetails; label: string; placeholder: string }[] = [
  { key: "material", label: "Material", placeholder: "e.g. 100% cotton, stainless steel 304" },
  { key: "intendedUse", label: "Intended use", placeholder: "e.g. household food storage" },
  { key: "form", label: "Form / state", placeholder: "e.g. whole dried, powder, finished article" },
  { key: "manufacturingMethod", label: "Manufacturing method", placeholder: "e.g. knitted, heat-pressed, moulded" },
  { key: "composition", label: "Composition", placeholder: "e.g. herbal extracts in a cream base" },
  { key: "endUseApplication", label: "End-user application", placeholder: "e.g. LED street lights" },
];

export default function AnalyzeProductPage() {
  return (
    <RequirePermission permission="products.analyze">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AnalyzeProductContent />
      </Suspense>
    </RequirePermission>
  );
}

function AnalyzeProductContent() {
  const router = useRouter();
  const params = useSearchParams();
  const productInterestId = params.get("productInterestId") ?? undefined;
  const opportunityId = params.get("opportunityId") ?? undefined;
  const validCategory = (c: string | null) => (c && PRODUCT_CATEGORIES.some((p) => p.code === c) ? c : "");

  const [input, setInput] = React.useState(params.get("input") ?? "");
  const [category, setCategory] = React.useState(validCategory(params.get("category")));
  const [typeOverride, setTypeOverride] = React.useState<ProductInputType | "">("");
  const [showDetails, setShowDetails] = React.useState(false);
  const [details, setDetails] = React.useState<ProductAnalysisDetails>({});
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [lastPayload, setLastPayload] = React.useState<ProductAnalysisInput | null>(null);

  const detected = detectProductInput(input);
  const effectiveType = typeOverride || detected.inputType;
  const isCode = effectiveType === "HS_CODE" || effectiveType === "ITC_HS_CODE";

  const analyze = useMutation({
    mutationFn: productAnalysisApi.analyze,
    onSuccess: (result) => {
      if (result.reused) toast.info("Reopened your recent identical analysis", "No new analysis was needed.");
      router.push(`/products/analyze/${result.id}`);
    },
  });

  const providerDown = analyze.error instanceof ApiRequestError && analyze.error.code === "SERVICE_UNAVAILABLE";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed.length < 2) {
      setFieldError("Enter a product name, HS / ITC-HS code, or description.");
      return;
    }
    if (!typeOverride && detected.formatError) {
      setFieldError(detected.formatError);
      return;
    }
    setFieldError(null);
    const cleanDetails = Object.fromEntries(
      Object.entries(details).filter(([, v]) => typeof v === "string" && v.trim()),
    ) as ProductAnalysisDetails;
    const payload: ProductAnalysisInput = {
      input: trimmed,
      inputType: typeOverride || undefined,
      categoryCode: category || undefined,
      details: Object.keys(cleanDetails).length ? cleanDetails : undefined,
      productInterestId,
      opportunityId,
    };
    setLastPayload(payload);
    analyze.mutate(payload);
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "Products", href: "/products" }, { label: "Analyze Product" }]} />
      <div>
        <PageTitle>Analyze Product</PageTitle>
        <HelperText className="mt-1 max-w-2xl">
          Describe a product or enter an HS / ITC-HS code. You&apos;ll get AI-assisted identification and classification
          suggestions to review — nothing is saved until you explicitly confirm a classification.
        </HelperText>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <Textarea
                label="Product name, HS / ITC-HS code, or description"
                required
                rows={3}
                maxLength={1000}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setFieldError(null);
                }}
                placeholder="e.g. Cumin seeds · 090931 · Biodegradable dinner plates made from areca palm leaves"
                error={fieldError ?? undefined}
                disabled={analyze.isPending}
              />

              {input.trim() && (
                <div className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
                  <span className="text-muted-foreground">Detected as:</span>
                  <Badge variant="info">{INPUT_TYPE_LABELS[effectiveType]}</Badge>
                  {!typeOverride && detected.isPartialCode && (
                    <Badge variant="warning">
                      {detected.codeLevel === 2 ? "HS chapter" : "HS heading"} — not a complete classification
                    </Badge>
                  )}
                  <label className="flex items-center gap-1 text-muted-foreground">
                    <span>Not right?</span>
                    <select
                      aria-label="Override input type"
                      value={typeOverride}
                      onChange={(e) => setTypeOverride(e.target.value as ProductInputType | "")}
                      className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Auto-detect</option>
                      {(Object.keys(INPUT_TYPE_LABELS) as ProductInputType[]).map((t) => (
                        <option key={t} value={t}>
                          {INPUT_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <Select
                label="Category (optional)"
                placeholder="Let the analysis suggest one"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                options={PRODUCT_CATEGORIES.map((c) => ({ value: c.code, label: c.label }))}
                disabled={analyze.isPending}
              />

              {!isCode && (
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    aria-expanded={showDetails}
                    onClick={() => setShowDetails((v) => !v)}
                    className="flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showDetails ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
                    Add details (optional)
                  </button>
                  {showDetails && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {DETAIL_FIELDS.map((f) => (
                        <Input
                          key={f.key}
                          label={f.label}
                          placeholder={f.placeholder}
                          maxLength={300}
                          value={details[f.key] ?? ""}
                          onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))}
                        />
                      ))}
                      <Textarea
                        containerClassName="sm:col-span-2"
                        label="Additional details"
                        maxLength={1000}
                        rows={2}
                        value={details.additionalDetails ?? ""}
                        onChange={(e) => setDetails((d) => ({ ...d, additionalDetails: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
              )}

              {(productInterestId || opportunityId) && (
                <HelperText>
                  Prefilled from {productInterestId ? "your Export Setup product interests" : "an opportunity"}. The original
                  record is not changed.
                </HelperText>
              )}

              {analyze.isPending && <AnalysisProgress label={isCode ? "Looking up code in the reference data…" : undefined} />}

              {analyze.isError &&
                (providerDown ? (
                  <ErrorState
                    title="Analysis unavailable"
                    message={PROVIDER_UNAVAILABLE_MESSAGE}
                    onRetry={() => lastPayload && analyze.mutate(lastPayload)}
                    className="p-6"
                  />
                ) : (
                  <p role="alert" className="text-sm text-danger">
                    {toFriendlyErrorMessage(analyze.error)}
                  </p>
                ))}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" loading={analyze.isPending}>
                  <Sparkles className="size-4" aria-hidden="true" />
                  Analyze Product
                </Button>
                {providerDown && (
                  <HelperText>You can still enter a code directly or search codes after analysis.</HelperText>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <SectionTitle className="text-sm">Try an example</SectionTitle>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setInput(ex);
                    setTypeOverride("");
                    setFieldError(null);
                  }}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {ex}
                </button>
              ))}
            </div>
          </Card>
          <RecentAnalyses />
        </div>
      </div>
    </div>
  );
}
