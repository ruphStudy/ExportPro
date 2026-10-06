"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Globe2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { marketsApi } from "@/lib/api/markets";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { RequirePermission } from "@/components/layout/require-permission";
import { ContextBadges, MarketSourcePanel, riskVariant, ScorePill, titleCase } from "@/components/markets/market-bits";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function MarketsPage() {
  return (
    <RequirePermission permission="country_intelligence.view">
      <MarketsContent />
    </RequirePermission>
  );
}

function MarketsContent() {
  const [q, setQ] = React.useState("");
  const [term, setTerm] = React.useState("");
  const [region, setRegion] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useQuery({
    queryKey: ["markets", term, region, page],
    queryFn: () => marketsApi.countries({ q: term || undefined, region: region || undefined, page, pageSize: 24 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <PageTitle>Markets</PageTitle>
        <HelperText className="mt-1">
          Country market intelligence for Indian exporters. Open a market to see which products look most attractive there.
        </HelperText>
      </div>
      {list.data && <MarketSourcePanel source={list.data.source} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
        <SearchInput
          aria-label="Search markets by country name, ISO code or region"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onClear={() => setQ("")}
          loading={list.isFetching && !list.isLoading}
          placeholder="Search by country, ISO code (e.g. AE) or region"
        />
        <Select
          aria-label="Region"
          placeholder="All regions"
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
            setPage(1);
          }}
          options={(list.data?.regions ?? []).map((r) => ({ value: r, label: r }))}
        />
      </div>

      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : list.isError || !list.data ? (
        <ErrorState title="Markets couldn't load" message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={Globe2} title="No matching countries" description="Try another name, ISO code or region." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.items.map((c) => (
            <li key={c.country.code}>
              <Link
                href={`/markets/${c.country.code}`}
                className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:bg-muted/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{c.country.name}</p>
                      <Caption>{c.country.code} · {c.country.region} · {c.country.currency}</Caption>
                    </div>
                    {c.topScore !== null ? <ScorePill score={c.topScore} label="Top" /> : <Badge variant="neutral">No data yet</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <ContextBadges context={c.context} />
                    {c.countryRiskLevel && <Badge variant={riskVariant(c.countryRiskLevel)}>{titleCase(c.countryRiskLevel)} country risk</Badge>}
                  </div>
                  {c.supported ? (
                    <p className="text-xs text-muted-foreground">
                      {c.productCount} products with data · Top: {c.topProducts.join("; ")}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Market intelligence not available in the current dataset.</p>
                  )}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.meta.totalPages > 1 && <Pagination meta={list.data.meta} onPageChange={setPage} />}
    </div>
  );
}
