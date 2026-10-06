"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Scale, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import { formatTariffCode } from "@exportpro/types";
import { comparisonsApi, MAX_COMPARE, MIN_COMPARE, parseIdList } from "@/lib/api/comparisons";
import { productsApi } from "@/lib/api/products";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { RequirePermission } from "@/components/layout/require-permission";
import { ComparisonBars, ComparisonSummaryCard, ComparisonTable, ProfileNote } from "@/components/comparisons/comparison-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function CompareProductsPage() {
  return (
    <RequirePermission permission="comparisons.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <CompareProductsContent />
      </Suspense>
    </RequirePermission>
  );
}

function CompareProductsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ids = parseIdList(params.get("ids"));
  const [q, setQ] = React.useState("");
  const setIds = (next: string[]) => router.replace(next.length ? `${pathname}?ids=${next.join(",")}` : pathname, { scroll: false });
  const toggle = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_COMPARE ? ids : [...ids, id]);

  const products = useQuery({
    queryKey: ["products", "list", "compare-picker", q],
    queryFn: () => productsApi.list({ q: q.trim() || undefined, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const comparison = useQuery({
    queryKey: ["comparisons", "products", ids],
    queryFn: () => comparisonsApi.products(ids),
    enabled: ids.length >= MIN_COMPARE,
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <PageTitle>Compare Products</PageTitle>
        <HelperText className="mt-1">
          Compare 2–5 of your saved products on the same Product Intelligence signals. Opportunity scores are the same for every organization; personal fit is shown separately.
        </HelperText>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Selected ({ids.length}/{MAX_COMPARE})</SectionTitle>
          {ids.length > 0 && <Button variant="ghost" size="sm" onClick={() => setIds([])}>Clear comparison</Button>}
        </div>
        <SelectedChips
          ids={ids}
          names={new Map([...(comparison.data?.items ?? []).map((i) => [i.id, i.product.displayName] as const), ...(products.data?.items ?? []).map((p) => [p.id, p.displayName] as const)])}
          onRemove={toggle}
        />
        <SearchInput aria-label="Search your saved products" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Search saved products" />
        {products.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : products.isError ? (
          <ErrorState message={toFriendlyErrorMessage(products.error)} onRetry={() => products.refetch()} className="p-6" />
        ) : !products.data?.items.length ? (
          <EmptyState title="No saved products" description="Analyze and save products first." action={<Button asChild><Link href="/products/analyze">Analyze Product</Link></Button>} className="p-6" />
        ) : (
          <fieldset>
            <legend className="sr-only">Choose products to compare (up to {MAX_COMPARE})</legend>
            <ul className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {products.data.items.map((p) => {
                const checked = ids.includes(p.id);
                const disabled = !checked && ids.length >= MAX_COMPARE;
                return (
                  <li key={p.id}>
                    <label className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm focus-within:ring-2 focus-within:ring-ring", checked ? "border-primary bg-primary/5" : "border-border", disabled && "cursor-not-allowed opacity-60")}>
                      <input type="checkbox" className="mt-0.5 size-4" checked={checked} disabled={disabled} onChange={() => toggle(p.id)} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.displayName}</span>
                        <Caption>{formatTariffCode(p.classificationCode)}</Caption>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {ids.length >= MAX_COMPARE && <HelperText className="mt-2" role="status">Maximum of {MAX_COMPARE} products reached — remove one to add another.</HelperText>}
          </fieldset>
        )}
      </Card>

      {ids.length < MIN_COMPARE ? (
        <EmptyState icon={Scale} title="Select at least 2 products" description="Pick 2–5 saved products above to compare them side by side." />
      ) : comparison.isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : comparison.isError || !comparison.data ? (
        <ErrorState title="Comparison couldn't load" message={toFriendlyErrorMessage(comparison.error)} onRetry={() => comparison.refetch()} />
      ) : (
        <ProductComparisonResult data={comparison.data} />
      )}
    </div>
  );
}

function SelectedChips({ ids, names, onRemove }: { ids: string[]; names: Map<string, string>; onRemove: (id: string) => void }) {
  if (!ids.length) return <HelperText>No products selected yet.</HelperText>;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Selected products">
      {ids.map((id) => (
        <li key={id}>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs">
            {names.get(id) ?? "Product"}
            <button type="button" aria-label={`Remove ${names.get(id) ?? "product"}`} onClick={() => onRemove(id)} className="rounded-full p-0.5 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProductComparisonResult({ data }: { data: Awaited<ReturnType<typeof comparisonsApi.products>> }) {
  const columns = data.items.map((it) => ({
    id: it.id,
    title: it.product.displayName,
    subtitle: (
      <>
        {formatTariffCode(it.product.classificationCode)}
        {it.source && ` · ${it.source.freshness.toLowerCase()} · ${it.confidence}/100 confidence`}
        {it.source && (it.source.realTradeData ? " · real trade data + sample signals" : " · sample data")}
      </>
    ),
    metrics: it.metrics,
    unavailableMessage: it.status === "AVAILABLE" ? null : it.message,
  }));
  const anySample = data.items.some((i) => i.source?.isSample);
  return (
    <div className="flex flex-col gap-4">
      {anySample && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          Based on sample trade intelligence — not official government statistics.
        </p>
      )}
      <ComparisonSummaryCard summary={data.summary} />
      <ComparisonTable caption="Product comparison" columns={columns} rows={data.rows} />
      <ComparisonBars
        columns={columns}
        dims={[
          { key: "demand", label: "Demand" },
          { key: "growth", label: "Growth" },
          { key: "competition", label: "Competition" },
          { key: "compliance", label: "Compliance" },
          { key: "logistics", label: "Logistics" },
          { key: "margin", label: "Margin potential" },
        ]}
      />
      <ProfileNote missing={data.profile.missingInputs} />
      <div className="flex flex-wrap gap-2">
        {data.items.filter((i) => i.status === "AVAILABLE").map((i) => (
          <Button key={i.id} asChild variant="outline" size="sm">
            <Link href={`/products/${i.id}/intelligence`}>{i.product.displayName} intelligence</Link>
          </Button>
        ))}
      </div>
    </div>
  );
}
