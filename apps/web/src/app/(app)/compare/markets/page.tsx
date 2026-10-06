"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import { formatTariffCode } from "@exportpro/types";
import { comparisonsApi, MAX_COMPARE, MIN_COMPARE, parseIdList } from "@/lib/api/comparisons";
import { marketsApi } from "@/lib/api/markets";
import { productsApi } from "@/lib/api/products";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { RequirePermission } from "@/components/layout/require-permission";
import { ComparisonBars, ComparisonSummaryCard, ComparisonTable, ProfileNote } from "@/components/comparisons/comparison-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function CompareMarketsPage() {
  return (
    <RequirePermission permission="comparisons.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <CompareMarketsContent />
      </Suspense>
    </RequirePermission>
  );
}

function CompareMarketsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const productId = params.get("product") ?? "";
  const countries = parseIdList(params.get("countries")).map((c) => c.toUpperCase());
  const update = (product: string, codes: string[]) => {
    const qs = new URLSearchParams();
    if (product) qs.set("product", product);
    if (codes.length) qs.set("countries", codes.join(","));
    router.replace(`${pathname}${qs.toString() ? `?${qs}` : ""}`, { scroll: false });
  };
  const toggle = (cc: string) =>
    update(productId, countries.includes(cc) ? countries.filter((c) => c !== cc) : countries.length >= MAX_COMPARE ? countries : [...countries, cc]);

  const products = useQuery({ queryKey: ["products", "list", "compare-markets"], queryFn: () => productsApi.list({ pageSize: 50 }) });
  const markets = useQuery({
    queryKey: ["product-markets", productId, "all"],
    queryFn: () => marketsApi.productMarkets(productId, { pageSize: 50 }),
    enabled: Boolean(productId),
  });
  const comparison = useQuery({
    queryKey: ["comparisons", "markets", productId, countries],
    queryFn: () => comparisonsApi.markets(productId, countries),
    enabled: Boolean(productId) && countries.length >= MIN_COMPARE,
  });
  const product = products.data?.items.find((p) => p.id === productId);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <PageTitle>{product ? `Compare Markets for ${product.displayName}` : "Compare Markets"}</PageTitle>
        <HelperText className="mt-1">
          Product-specific comparison of 2–5 destination markets using Country Intelligence. Market scores are the same for every organization; personal fit is separate.
        </HelperText>
      </div>

      <Card className="flex flex-col gap-4 p-4">
        <Select
          label="Product"
          placeholder={products.isLoading ? "Loading products…" : "Choose a saved product"}
          value={productId}
          onChange={(e) => update(e.target.value, [])}
          options={(products.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.displayName} (${formatTariffCode(p.classificationCode)})` }))}
        />
        {productId && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle className="text-base">Markets ({countries.length}/{MAX_COMPARE})</SectionTitle>
              {countries.length > 0 && <Button variant="ghost" size="sm" onClick={() => update(productId, [])}>Clear</Button>}
            </div>
            {markets.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : markets.isError ? (
              <ErrorState message={toFriendlyErrorMessage(markets.error)} onRetry={() => markets.refetch()} className="p-6" />
            ) : markets.data?.status !== "AVAILABLE" ? (
              <HelperText>{markets.data?.message ?? "No market data for this product."}</HelperText>
            ) : (
              <fieldset>
                <legend className="sr-only">Choose markets to compare (up to {MAX_COMPARE})</legend>
                <div className="flex flex-wrap gap-2">
                  {markets.data.items.map((m) => {
                    const checked = countries.includes(m.country.code);
                    const disabled = !checked && countries.length >= MAX_COMPARE;
                    return (
                      <label key={m.country.code} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs focus-within:ring-2 focus-within:ring-ring", checked ? "border-primary bg-primary/10 font-medium" : "border-border", disabled && "cursor-not-allowed opacity-60")}>
                        <input type="checkbox" className="size-3.5" checked={checked} disabled={disabled} onChange={() => toggle(m.country.code)} />
                        {m.country.name}
                        <span className="text-muted-foreground">{m.opportunityScore}</span>
                      </label>
                    );
                  })}
                </div>
                {countries.length >= MAX_COMPARE && <HelperText className="mt-2" role="status">Maximum of {MAX_COMPARE} markets reached.</HelperText>}
              </fieldset>
            )}
          </div>
        )}
      </Card>

      {!productId ? (
        <EmptyState icon={MapIcon} title="Choose a product first" description="Market comparison is always for a specific saved product." />
      ) : countries.length < MIN_COMPARE ? (
        <EmptyState icon={MapIcon} title="Select at least 2 markets" description="Pick 2–5 markets above to compare them for this product." />
      ) : comparison.isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : comparison.isError || !comparison.data ? (
        <ErrorState title="Comparison couldn't load" message={toFriendlyErrorMessage(comparison.error)} onRetry={() => comparison.refetch()} />
      ) : comparison.data.status !== "AVAILABLE" ? (
        <EmptyState title="Comparison unavailable" description={comparison.data.message ?? undefined} />
      ) : (
        <MarketResult data={comparison.data} productId={productId} />
      )}
    </div>
  );
}

function MarketResult({ data, productId }: { data: Awaited<ReturnType<typeof comparisonsApi.markets>>; productId: string }) {
  const columns = data.items.map((it) => ({
    id: it.id,
    title: it.country.name,
    subtitle: it.source ? `${it.source.freshness.toLowerCase()} · ${it.confidence}/100 confidence${it.tariffAvailable ? "" : " · tariff missing"}` : undefined,
    metrics: it.metrics,
    unavailableMessage: it.status === "AVAILABLE" ? null : `No market data for ${data.product.displayName} in ${it.country.name}.`,
  }));
  return (
    <div className="flex flex-col gap-4">
      <Caption className="font-medium uppercase tracking-wide">Product: {data.product.displayName} · {formatTariffCode(data.product.classificationCode)}</Caption>
      {data.items.some((i) => i.source?.isSample) && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          Sample market intelligence — not official trade or regulatory data. Tariffs are illustrative; logistics is a suitability signal, not a freight rate.
        </p>
      )}
      {data.items.some((i) => i.status === "AVAILABLE" && !i.tariffAvailable) && (
        <HelperText>Markets marked &quot;tariff missing&quot; have lower data confidence; their tariff is shown as Unavailable rather than scored.</HelperText>
      )}
      <ComparisonSummaryCard summary={data.summary} />
      <ComparisonTable caption={`Market comparison for ${data.product.displayName}`} columns={columns} rows={data.rows} />
      <ComparisonBars
        columns={columns}
        dims={[
          { key: "demand", label: "Demand" },
          { key: "growth", label: "Growth" },
          { key: "tariff", label: "Tariff" },
          { key: "competition", label: "Competition" },
          { key: "logistics", label: "Logistics" },
          { key: "marketEntry", label: "Market entry" },
        ]}
      />
      <ProfileNote missing={data.profile.missingInputs} />
      <div className="flex flex-wrap gap-2">
        {data.items.filter((i) => i.status === "AVAILABLE").map((i) => (
          <Button key={i.id} asChild variant="outline" size="sm">
            <Link href={`/products/${productId}/markets/${i.id}`}>{i.country.name} market analysis</Link>
          </Button>
        ))}
      </div>
    </div>
  );
}
