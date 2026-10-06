"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bookmark, Plus, SearchX, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import type { BuyerSearchQuery, BuyerSort, BuyerSourceFilter, BuyerType, CompanySize, ImportFrequency, VerifiedContactFilter } from "@exportpro/types";
import { COUNTRIES, countryLabel } from "@exportpro/types";
import { buyersApi } from "@/lib/api/buyers";
import { productsApi } from "@/lib/api/products";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { BUYER_TYPE_LABELS, COMPANY_SIZE_LABELS, FREQUENCY_LABELS } from "@/lib/buyer-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { BuyerCard, SampleBuyerBanner } from "@/components/buyers/buyer-bits";
import { ManualBuyerModal } from "@/components/buyers/manual-buyer-modal";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

const KEYS = ["productId", "hsCode", "productName", "country", "buyerType", "companySize", "importFrequency", "verifiedContact", "minMatchScore", "maxRisk", "source", "sort", "page"] as const;

const SORTS: { value: BuyerSort; label: string }[] = [
  { value: "BEST_MATCH", label: "Best match" },
  { value: "LOWEST_RISK", label: "Lowest risk" },
  { value: "MOST_ACTIVE", label: "Most active importer" },
  { value: "CONTACT_CONFIDENCE", label: "Highest contact confidence" },
  { value: "RECENTLY_VERIFIED", label: "Recently verified" },
];

function parse(params: URLSearchParams): BuyerSearchQuery {
  const q: Record<string, string | number> = {};
  for (const k of KEYS) {
    const v = params.get(k);
    if (v) q[k] = ["minMatchScore", "maxRisk", "page"].includes(k) ? Number(v) : v;
  }
  return q as BuyerSearchQuery;
}

export default function BuyersPage() {
  return (
    <RequirePermission permission="buyers.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <BuyerSearch />
      </Suspense>
    </RequirePermission>
  );
}

function BuyerSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();
  const query = React.useMemo(() => parse(new URLSearchParams(params.toString())), [params]);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);

  const update = (patch: Partial<BuyerSearchQuery>, keepPage = false) => {
    const next: BuyerSearchQuery = { ...query, ...patch };
    if (!keepPage) delete next.page;
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== "" && v !== null) s.set(k, String(v));
    router.replace(`${pathname}${s.toString() ? `?${s}` : ""}`, { scroll: false });
  };

  const results = useQuery({
    queryKey: ["buyers", "search", query],
    queryFn: () => buyersApi.search({ ...query, pageSize: 12 }),
    placeholderData: keepPreviousData,
  });
  const products = useQuery({ queryKey: ["products", "buyer-picker"], queryFn: () => productsApi.list({ pageSize: 100 }) });
  const ctx = results.data?.context;
  const detailQuery = (() => {
    const s = new URLSearchParams();
    if (query.productId) s.set("productId", query.productId);
    else if (query.hsCode) s.set("hsCode", query.hsCode);
    if (query.country) s.set("country", query.country);
    return s.toString() ? `?${s}` : "";
  })();
  const activeFilters = [query.buyerType, query.companySize, query.importFrequency, query.verifiedContact && query.verifiedContact !== "ANY" ? query.verifiedContact : undefined, query.minMatchScore, query.maxRisk, query.source].filter((v) => v !== undefined).length;

  const filters = (
    <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()} aria-label="Buyer filters">
      <Select
        label="Saved product"
        placeholder="Any product"
        value={query.productId ?? ""}
        onChange={(e) => update({ productId: e.target.value || undefined, hsCode: undefined, productName: undefined })}
        options={(products.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.displayName} (${p.itcHsCode ?? p.hsCode})` }))}
      />
      <Input
        label="Or HS / ITC-HS code"
        placeholder="e.g. 090931"
        inputMode="numeric"
        defaultValue={query.hsCode ?? ""}
        key={`hs-${query.hsCode ?? ""}`}
        disabled={Boolean(query.productId)}
        onBlur={(e) => {
          const v = e.target.value.replace(/\D/g, "");
          if (v !== (query.hsCode ?? "")) update({ hsCode: v || undefined });
        }}
        description="2, 4, 6 or 8 digits"
      />
      <Input
        label="Or product name"
        placeholder="e.g. cumin"
        defaultValue={query.productName ?? ""}
        key={`pn-${query.productName ?? ""}`}
        disabled={Boolean(query.productId)}
        onBlur={(e) => e.target.value.trim() !== (query.productName ?? "") && update({ productName: e.target.value.trim() || undefined })}
      />
      <Select label="Country" placeholder="Any country" value={query.country ?? ""} onChange={(e) => update({ country: e.target.value || undefined })} options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))} />
      <Select label="Buyer type" placeholder="Any type" value={query.buyerType ?? ""} onChange={(e) => update({ buyerType: (e.target.value || undefined) as BuyerType | undefined })} options={(["IMPORTER", "DISTRIBUTOR", "WHOLESALER", "RETAILER", "MANUFACTURER", "AGENT", "OTHER"] as const).map((t) => ({ value: t, label: BUYER_TYPE_LABELS[t] }))} />
      <Select label="Company size" placeholder="Any size" value={query.companySize ?? ""} onChange={(e) => update({ companySize: (e.target.value || undefined) as CompanySize | undefined })} options={(["MICRO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE", "UNKNOWN"] as const).map((t) => ({ value: t, label: COMPANY_SIZE_LABELS[t] }))} />
      <Select label="Import frequency" placeholder="Any frequency" value={query.importFrequency ?? ""} onChange={(e) => update({ importFrequency: (e.target.value || undefined) as ImportFrequency | undefined })} options={(["HIGH_FREQUENCY", "FREQUENT", "REGULAR", "OCCASIONAL", "UNKNOWN"] as const).map((t) => ({ value: t, label: FREQUENCY_LABELS[t] }))} />
      <Select
        label="Contact"
        value={query.verifiedContact ?? "ANY"}
        onChange={(e) => update({ verifiedContact: e.target.value === "ANY" ? undefined : (e.target.value as VerifiedContactFilter) })}
        options={[
          { value: "ANY", label: "Any" },
          { value: "VERIFIED", label: "Has verified contact" },
          { value: "HAS_CONTACT", label: "Has contact" },
          { value: "NO_CONTACT", label: "No contact" },
        ]}
        description="Verified = the source recorded an actual verification check. Format or domain checks alone don't count."
      />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Min. match" placeholder="Any" value={query.minMatchScore?.toString() ?? ""} onChange={(e) => update({ minMatchScore: e.target.value ? Number(e.target.value) : undefined })} options={["40", "60", "80"].map((v) => ({ value: v, label: `${v}+` }))} />
        <Select label="Max. risk" placeholder="Any" value={query.maxRisk?.toString() ?? ""} onChange={(e) => update({ maxRisk: e.target.value ? Number(e.target.value) : undefined })} options={[{ value: "24", label: "Low only" }, { value: "49", label: "≤ Moderate" }, { value: "74", label: "≤ High" }]} />
      </div>
      <Select label="Source" placeholder="All sources" value={query.source ?? ""} onChange={(e) => update({ source: (e.target.value || undefined) as BuyerSourceFilter | undefined })} options={[{ value: "REAL", label: "Real providers" }, { value: "USER_PROVIDED", label: "Added by your team" }, { value: "DEMO", label: "Sample data" }]} />
      <Button type="button" variant="ghost" onClick={() => router.replace(pathname)}>Clear all filters</Button>
    </form>
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Buyer Discovery</PageTitle>
          <HelperText className="mt-1">Find companies that buy your product in a market. Match (commercial fit) and risk (credibility) are scored separately.</HelperText>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/buyers/saved"><Bookmark className="size-4" aria-hidden="true" />Saved buyers</Link>
          </Button>
          {hasPermission(session, "buyers.create") && (
            <Button variant="outline" onClick={() => setAddOpen(true)}><Plus className="size-4" aria-hidden="true" />Add buyer</Button>
          )}
        </div>
      </div>

      {results.data?.sampleData && <SampleBuyerBanner />}

      {ctx && (ctx.productName || ctx.hsCode || ctx.countryCode) && (
        <Card className="flex flex-wrap items-center gap-2 p-3 text-sm" aria-live="polite">
          <span className="text-muted-foreground">Searching for</span>
          <span className="font-medium">{ctx.productName ?? "any product"}{ctx.hsCode ? ` (HS ${ctx.hsCode})` : ""}</span>
          <span className="text-muted-foreground">in</span>
          <span className="font-medium">{ctx.countryCode ? countryLabel(ctx.countryCode) : "all countries"}</span>
        </Card>
      )}

      {results.data?.warnings.map((w) => (
        <p key={w} role="status" className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">{w}</p>
      ))}

      <div className="flex min-w-0 gap-6">
        <aside className="hidden w-72 shrink-0 lg:block" aria-label="Filters">
          <Card className="sticky top-4 p-4">{filters}</Card>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {results.data ? `${results.data.meta.totalItems} buyer${results.data.meta.totalItems === 1 ? "" : "s"} found` : "Searching…"}
            </p>
            <div className="flex items-end gap-2">
              <Button variant="outline" className="lg:hidden" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog">
                <SlidersHorizontal className="size-4" aria-hidden="true" />Filters{activeFilters ? ` (${activeFilters})` : ""}
              </Button>
              <Select label="Sort by" value={query.sort ?? "BEST_MATCH"} onChange={(e) => update({ sort: e.target.value as BuyerSort })} options={SORTS} containerClassName="w-52" />
            </div>
          </div>

          {results.isLoading ? (
            <div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56 w-full" />)}</div>
          ) : results.isError ? (
            <ErrorState title="Could not search buyers" message={toFriendlyErrorMessage(results.error)} onRetry={() => results.refetch()} />
          ) : results.data && results.data.items.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={ctx?.countryCode || ctx?.hsCode ? "No buyers found for this product and country" : "No buyers found"}
              description="Buyers are never invented to fill results. Try widening the search:"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {query.buyerType && <Button size="sm" variant="outline" onClick={() => update({ buyerType: undefined })}>Remove buyer-type filter</Button>}
                  {query.verifiedContact && <Button size="sm" variant="outline" onClick={() => update({ verifiedContact: undefined })}>Include unverified contacts</Button>}
                  {(query.companySize || query.importFrequency || query.minMatchScore || query.maxRisk) && (
                    <Button size="sm" variant="outline" onClick={() => update({ companySize: undefined, importFrequency: undefined, minMatchScore: undefined, maxRisk: undefined })}>Remove other filters</Button>
                  )}
                  {query.country && <Button size="sm" variant="outline" onClick={() => update({ country: undefined })}>Search all countries</Button>}
                  {query.productId && (
                    <Button asChild size="sm" variant="outline"><Link href={`/products/${query.productId}/markets`}>View best markets</Link></Button>
                  )}
                </div>
              }
            />
          ) : (
            <ul className="grid gap-4 xl:grid-cols-2" aria-label="Buyer results">
              {results.data?.items.map((b) => (
                <li key={b.id} className="min-w-0"><BuyerCard b={b} detailQuery={detailQuery} productId={query.productId} /></li>
              ))}
            </ul>
          )}
          {results.data && results.data.meta.totalPages > 1 && <Pagination meta={results.data.meta} onPageChange={(p) => update({ page: p }, true)} />}
          {results.data && <Caption>Scores {results.data.scoreVersion} · calculated {new Date(results.data.calculatedAt).toLocaleString()}</Caption>}
        </div>
      </div>

      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen} title="Filters" side="right" className="overflow-y-auto">
        <div className="p-4">{filters}</div>
      </Drawer>
      <ManualBuyerModal open={addOpen} onOpenChange={setAddOpen} defaultCountry={query.country} />
    </div>
  );
}
