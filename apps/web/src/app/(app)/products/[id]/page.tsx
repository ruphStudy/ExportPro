"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BarChart3, Map as MapIcon, Pencil, RotateCw, Search } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import {
  PLATFORM_CONFIRMATION_NOTE,
  PRODUCT_CATEGORIES,
  type HSReferenceItem,
  type ProductDetail,
} from "@exportpro/types";
import { productIntelligenceApi } from "@/lib/api/product-intelligence";
import { productsApi } from "@/lib/api/products";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { categoryLabel, CLASSIFICATION_SOURCE_LABELS, CLASSIFICATION_STATUS_LABELS } from "@/lib/product-labels";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { RequirePermission } from "@/components/layout/require-permission";
import { ClassificationDisclaimer, CodeLabel, ConfidenceBadge } from "@/components/products/classification-bits";
import { HsCodeSearch } from "@/components/products/hs-code-search";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function ProductDetailPage() {
  return (
    <RequirePermission permission="products.view">
      <Suspense fallback={<PageSkeleton />}>
        <ProductDetailContent />
      </Suspense>
    </RequirePermission>
  );
}

function marketHref(p: ProductDetail): string {
  const params = new URLSearchParams();
  if (p.marketAnalysis.opportunitySearch) params.set("search", p.marketAnalysis.opportunitySearch);
  if (p.marketAnalysis.categoryCode) params.set("category", p.marketAnalysis.categoryCode);
  const qs = params.toString();
  return `/opportunities${qs ? `?${qs}` : ""}`;
}

function ProductDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canAnalyze = hasPermission(session, "products.analyze");
  const canUpdate = hasPermission(session, "products.update");
  const canConfirm = hasPermission(session, "products.confirm_classification");
  const canViewOpportunities = hasPermission(session, "opportunities.view");
  const canViewIntelligence = hasPermission(session, "product_intelligence.view");
  const canViewMarkets = hasPermission(session, "country_intelligence.view");

  const detail = useQuery({ queryKey: ["products", "detail", id], queryFn: () => productsApi.getById(id) });
  const intelligence = useQuery({
    queryKey: ["product-intelligence", "summary", id, detail.data?.classificationCode],
    queryFn: () => productIntelligenceApi.summary([id]).then((r) => r[0] ?? null),
    enabled: canViewIntelligence && Boolean(detail.data),
  });
  const [editOpen, setEditOpen] = React.useState(false);
  const [changeOpen, setChangeOpen] = React.useState(searchParams.get("change") === "classification");
  const [pick, setPick] = React.useState<HSReferenceItem | null>(null);
  const [confirmChangeOpen, setConfirmChangeOpen] = React.useState(false);

  const onSaved = (updated: ProductDetail) => {
    queryClient.setQueryData(["products", "detail", id], updated);
    queryClient.invalidateQueries({ queryKey: ["products", "list"] });
  };

  const reanalyze = useMutation({
    mutationFn: () => productsApi.reanalyze(id),
    onSuccess: (analysis) => router.push(`/products/analyze/${analysis.id}`),
    onError: (error) => toast.error("Could not start re-analysis", toFriendlyErrorMessage(error)),
  });
  const changeClassification = useMutation({
    mutationFn: (item: HSReferenceItem) =>
      productsApi.changeClassification(id, { code: item.code, codeSystem: item.codeSystem, confirmation: true }),
    onSuccess: (updated) => {
      onSaved(updated);
      setConfirmChangeOpen(false);
      setChangeOpen(false);
      setPick(null);
      toast.success("Classification changed", "Confirmed for platform analysis.");
    },
    onError: (error) => toast.error("Could not change classification", toFriendlyErrorMessage(error)),
  });

  if (detail.isLoading) return <PageSkeleton />;
  if (detail.isError || !detail.data) {
    return <ErrorState title="Product not found" message={toFriendlyErrorMessage(detail.error)} onRetry={() => detail.refetch()} />;
  }

  const p = detail.data;
  const status = CLASSIFICATION_STATUS_LABELS[p.classificationStatus];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Breadcrumbs items={[{ label: "Products", href: "/products" }, { label: p.displayName }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle className="break-words">{p.displayName}</PageTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            <Badge variant="neutral">Not customs/government verified</Badge>
            <Caption>{categoryLabel(p.categoryCode)}</Caption>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpdate && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          )}
          {canAnalyze && (
            <Button variant="outline" onClick={() => reanalyze.mutate()} loading={reanalyze.isPending}>
              <RotateCw className="size-4" aria-hidden="true" />
              Re-analyze
            </Button>
          )}
          {canConfirm && (
            <Button variant="outline" onClick={() => setChangeOpen(true)}>
              <Search className="size-4" aria-hidden="true" />
              Change classification
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="p-4">
            <SectionTitle>Classification</SectionTitle>
            <div className="mt-3 flex flex-col gap-2">
              <CodeLabel code={p.classificationCode} codeSystem={p.codeSystem} />
              <p className="break-words text-sm text-foreground">{p.classificationDescription}</p>
              {p.itcHsCode && <Caption>HS subheading {p.hsCode} · ITC-HS line {p.itcHsCode}</Caption>}
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Source</dt>
                <dd className="text-foreground">{CLASSIFICATION_SOURCE_LABELS[p.classificationSource]}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Confidence</dt>
                <dd>
                  <ConfidenceBadge confidence={p.classificationConfidence} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Confirmed by</dt>
                <dd className="text-foreground">{p.confirmedBy?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Confirmed on</dt>
                <dd className="text-foreground">{p.confirmedAt ? new Date(p.confirmedAt).toLocaleString() : "—"}</dd>
              </div>
            </dl>
            {p.lowConfidenceAcknowledged && (
              <p className="mt-3 flex items-start gap-2 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                Confirmed despite low confidence, open questions, or an incomplete code.
              </p>
            )}
            <ClassificationDisclaimer className="mt-4">
              <p>{PLATFORM_CONFIRMATION_NOTE}</p>
            </ClassificationDisclaimer>
          </Card>

          <Card className="p-4">
            <SectionTitle>Product</SectionTitle>
            <p className="mt-2 whitespace-pre-line break-words text-sm text-foreground">{p.description || "No description."}</p>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Category</dt>
                <dd className="text-foreground">{categoryLabel(p.categoryCode)}</dd>
              </div>
              {p.analysisId && (
                <div>
                  <dt className="text-xs text-muted-foreground">Analysis</dt>
                  <dd>
                    <Link href={`/products/analyze/${p.analysisId}`} className="text-primary hover:underline">
                      View confirmed analysis
                    </Link>
                  </dd>
                </div>
              )}
              {p.productInterest && (
                <div>
                  <dt className="text-xs text-muted-foreground">From Export Setup interest</dt>
                  <dd className="text-foreground">{p.productInterest.name}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">Last updated</dt>
                <dd className="text-foreground">{new Date(p.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          {canViewIntelligence && (
            <Card className="p-4">
              <SectionTitle className="text-sm">Product Intelligence</SectionTitle>
              {intelligence.isLoading ? (
                <HelperText className="mt-1">Checking available trade intelligence…</HelperText>
              ) : intelligence.data?.status === "CLASSIFICATION_REQUIRED" ? (
                <HelperText className="mt-1">Confirm product classification before viewing detailed intelligence.</HelperText>
              ) : intelligence.data?.status === "NO_DATA" ? (
                <HelperText className="mt-1">Trade intelligence is not available for this product yet.</HelperText>
              ) : intelligence.data ? (
                <>
                  <HelperText className="mt-1">
                    {intelligence.data.status === "AVAILABLE"
                      ? `Opportunity ${intelligence.data.opportunityScore}/100 · data confidence ${intelligence.data.confidence}/100.`
                      : "Export trends, India supply ecosystem, markets and risk signals."}
                  </HelperText>
                  <Button asChild className="mt-3 w-full">
                    <Link href={`/products/${p.id}/intelligence`}>
                      <BarChart3 className="size-4" aria-hidden="true" />
                      View Product Intelligence
                    </Link>
                  </Button>
                </>
              ) : (
                <HelperText className="mt-1">Product intelligence status is unavailable right now.</HelperText>
              )}
            </Card>
          )}
          {canViewMarkets && (
            <Card className="p-4">
              <SectionTitle className="text-sm">Best Markets</SectionTitle>
              {intelligence.data?.status === "CLASSIFICATION_REQUIRED" ? (
                <HelperText className="mt-1">Confirm product classification before viewing market intelligence.</HelperText>
              ) : (
                <>
                  <HelperText className="mt-1">Advisory ranking of destination countries for this product.</HelperText>
                  <Button asChild variant="outline" className="mt-3 w-full">
                    <Link href={`/products/${p.id}/markets`}>
                      <MapIcon className="size-4" aria-hidden="true" />
                      View Best Markets
                    </Link>
                  </Button>
                </>
              )}
            </Card>
          )}
          <Card className="p-4">
            <SectionTitle className="text-sm">Opportunity discovery</SectionTitle>
            <HelperText className="mt-1">
              {p.marketAnalysis.matchingOpportunityCount > 0
                ? `${p.marketAnalysis.matchingOpportunityCount} matching opportunit${p.marketAnalysis.matchingOpportunityCount === 1 ? "y" : "ies"} in opportunity discovery${p.marketAnalysis.opportunitySearch ? ` for “${p.marketAnalysis.opportunitySearch}”` : " in this category"}.`
                : "No matching opportunities yet — you can still browse opportunity discovery."}
            </HelperText>
            {canViewOpportunities && (
              <Button asChild className="mt-3 w-full">
                <Link href={marketHref(p)}>
                  Continue to Market Analysis
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
            <HelperText className="mt-3">
              For a country-by-country market ranking, use Best Markets above.
            </HelperText>
          </Card>
        </aside>
      </div>

      {editOpen && <EditProductModal product={p} onClose={() => setEditOpen(false)} onSaved={onSaved} />}

      <Modal
        open={changeOpen}
        onOpenChange={setChangeOpen}
        title="Change classification"
        description="Search the tariff reference and select a code. You'll confirm before anything changes."
        className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto"
        footer={
          <>
            <Button variant="outline" onClick={() => setChangeOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!pick} onClick={() => setConfirmChangeOpen(true)}>
              Review change
            </Button>
          </>
        }
      >
        <HsCodeSearch selected={pick} onSelect={setPick} initialQuery={p.hsCode.slice(0, 4)} />
      </Modal>

      {pick && (
        <ConfirmDialog
          open={confirmChangeOpen}
          onOpenChange={setConfirmChangeOpen}
          title="Use this classification for platform analysis"
          confirmLabel="Confirm & Save"
          loading={changeClassification.isPending}
          onConfirm={() => changeClassification.mutate(pick)}
          className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto"
        >
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <Caption>Product</Caption>
              <p className="font-medium text-foreground">{p.displayName}</p>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-border p-3">
              <Caption>From</Caption>
              <CodeLabel code={p.classificationCode} codeSystem={p.codeSystem} />
              <Caption className="mt-2">To</Caption>
              <CodeLabel code={pick.code} codeSystem={pick.codeSystem} />
              <p className="break-words text-foreground">{pick.description}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <ConfidenceBadge confidence={null} />
                <Caption>Selected manually</Caption>
              </div>
            </div>
            <ClassificationDisclaimer>
              <p className="font-medium">This does not represent customs or government verification.</p>
            </ClassificationDisclaimer>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

function EditProductModal({
  product,
  onClose,
  onSaved,
}: {
  product: ProductDetail;
  onClose: () => void;
  onSaved: (p: ProductDetail) => void;
}) {
  const [name, setName] = React.useState(product.displayName);
  const [description, setDescription] = React.useState(product.description ?? "");
  const [category, setCategory] = React.useState(product.categoryCode ?? "");
  const nameError = name.trim().length < 2 ? "Enter at least 2 characters." : undefined;

  const save = useMutation({
    mutationFn: () =>
      productsApi.update(product.id, {
        displayName: name.trim(),
        description: description.trim() || null,
        categoryCode: category || null,
      }),
    onSuccess: (updated) => {
      onSaved(updated);
      toast.success("Product updated");
      onClose();
    },
    onError: (error) => toast.error("Could not update product", toFriendlyErrorMessage(error)),
  });

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Edit product"
      description="Classification is changed separately."
      className="w-[calc(100%-2rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={Boolean(nameError)}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input label="Product name" required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} error={nameError} />
        <Textarea label="Description" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        <Select
          label="Category"
          placeholder="Uncategorized"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={PRODUCT_CATEGORIES.map((c) => ({ value: c.code, label: c.label }))}
        />
      </div>
    </Modal>
  );
}
