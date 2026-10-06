"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, Database, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { formatTariffCode, type ProductMarketRanking, type ProductMarketsQuery } from "@exportpro/types";
import { marketsApi } from "@/lib/api/markets";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { RequirePermission } from "@/components/layout/require-permission";
import {
  ContextBadges,
  MarketSourcePanel,
  PersonalFitBadge,
  riskVariant,
  ScorePill,
  titleCase,
} from "@/components/markets/market-bits";
import { CodeLabel } from "@/components/products/classification-bits";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { FindBuyersButton } from "@/components/buyers/buyer-bits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

const SORTS: { value: NonNullable<ProductMarketsQuery["sort"]>; label: string }[] = [
  { value: "OPPORTUNITY", label: "Opportunity score" },
  { value: "DEMAND", label: "Demand" },
  { value: "GROWTH", label: "Growth" },
  { value: "TARIFF", label: "Tariff attractiveness" },
  { value: "COMPETITION", label: "Competition attractiveness" },
  { value: "LOGISTICS", label: "Logistics" },
  { value: "RISK", label: "Lowest country risk" },
];

export default function ProductMarketsPage() {
  return (
    <RequirePermission permission="country_intelligence.view">
      <ProductMarketsContent />
    </RequirePermission>
  );
}

function ProductMarketsContent() {
  const { id } = useParams<{ id: string }>();
  const [region, setRegion] = React.useState("");
  const [minScore, setMinScore] = React.useState("");
  const [sort, setSort] = React.useState<NonNullable<ProductMarketsQuery["sort"]>>("OPPORTUNITY");
  const [page, setPage] = React.useState(1);
  const [compare, setCompare] = React.useState<string[]>([]);
  const toggleCompare = (cc: string) =>
    setCompare((cur) => (cur.includes(cc) ? cur.filter((c) => c !== cc) : cur.length >= 5 ? cur : [...cur, cc]));
  const query = useQuery({
    queryKey: ["product-markets", id, region, minScore, sort, page],
    queryFn: () => marketsApi.productMarkets(id, { region: region || undefined, minScore: minScore ? Number(minScore) : undefined, sort, page, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });
  const update = (fn: () => void) => {
    fn();
    setPage(1);
  };

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading best markets">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorState title="Best markets couldn't load" message={toFriendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  const d = query.data;
  const crumbs = [{ label: "Products", href: "/products" }, { label: d.product.displayName, href: `/products/${d.product.id}` }, { label: "Best Markets" }];

  if (d.status !== "AVAILABLE") {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={crumbs} />
        <PageTitle className="break-words">Best Markets — {d.product.displayName}</PageTitle>
        <EmptyState
          icon={d.status === "CLASSIFICATION_REQUIRED" ? ShieldAlert : Database}
          title={d.status === "CLASSIFICATION_REQUIRED" ? "Classification confirmation required" : "No market intelligence yet"}
          description={d.message ?? undefined}
          action={<Button asChild variant="outline"><Link href={`/products/${d.product.id}`}>Back to product</Link></Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Breadcrumbs items={crumbs} />
      <div className="flex flex-col gap-2">
        <Caption className="font-medium uppercase tracking-wide">Product → Best Markets</Caption>
        <PageTitle className="break-words">{d.product.displayName}</PageTitle>
        <div className="flex flex-wrap items-center gap-2">
          <CodeLabel code={d.product.classificationCode} codeSystem={d.product.codeSystem} />
          {d.match?.level === "HS_HEADING" && <Badge variant="warning">Matched at heading level ({formatTariffCode(d.match.matchedCode)})</Badge>}
        </div>
        <HelperText>
          Advisory ranking of destination markets. Opportunity score is the same for every organization; personal fit is shown separately and never changes it.
        </HelperText>
      </div>
      {d.source && <MarketSourcePanel source={d.source} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select
          label="Region"
          placeholder="All regions"
          value={region}
          onChange={(e) => update(() => setRegion(e.target.value))}
          options={d.regions.map((r) => ({ value: r, label: r }))}
        />
        <Select
          label="Minimum opportunity score"
          placeholder="Any score"
          value={minScore}
          onChange={(e) => update(() => setMinScore(e.target.value))}
          options={[50, 60, 70, 80].map((n) => ({ value: String(n), label: `${n}+` }))}
        />
        <Select label="Sort by" value={sort} onChange={(e) => update(() => setSort(e.target.value as typeof sort))} options={SORTS} />
      </div>

      {d.items.length === 0 ? (
        <EmptyState title="No markets match these filters" description="Try a different region or a lower minimum score." />
      ) : (
        <>
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-3 text-sm">
          <span>{compare.length === 0 ? "Select 2–5 markets to compare them." : `${compare.length} selected${compare.length >= 5 ? " (maximum)" : ""}.`}</span>
          {compare.length >= 2 && (
            <Button asChild size="sm">
              <Link href={`/compare/markets?product=${d.product.id}&countries=${compare.join(",")}`}>Compare Markets ({compare.length})</Link>
            </Button>
          )}
          {compare.length > 0 && <Button variant="ghost" size="sm" onClick={() => setCompare([])}>Clear</Button>}
        </div>
        <ol aria-label="Ranked destination markets" className="flex flex-col gap-3">
          {d.items.map((r) => (
            <MarketCard
              key={r.country.code}
              row={r}
              productId={d.product.id}
              selected={compare.includes(r.country.code)}
              selectDisabled={!compare.includes(r.country.code) && compare.length >= 5}
              onToggle={() => toggleCompare(r.country.code)}
            />
          ))}
        </ol>
        </>
      )}
      {d.meta.totalPages > 1 && <Pagination meta={d.meta} onPageChange={setPage} />}
    </div>
  );
}

function MarketCard({
  row,
  productId,
  selected,
  selectDisabled,
  onToggle,
}: {
  row: ProductMarketRanking;
  productId: string;
  selected: boolean;
  selectDisabled: boolean;
  onToggle: () => void;
}) {
  const c = row.components;
  const metrics: [string, number | string][] = [
    ["Demand", c.demand],
    ["Growth", c.growth],
    ["India presence", c.indiaPresence],
    ["Tariff", row.tariffAvailable ? c.tariff : "Unavailable"],
    ["Competition", c.competition],
    ["Logistics", c.logistics],
  ];
  return (
    <li>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">#{row.rank} · {row.country.region}</p>
            <h2 className="text-lg font-semibold text-foreground">{row.country.name}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <ContextBadges context={row.context} />
              {row.realTradeData ? <Badge variant="success">Real import statistics</Badge> : <Badge variant="warning">Sample market data</Badge>}
              <Badge variant={riskVariant(row.marketEntry)}>{titleCase(row.marketEntry)} entry</Badge>
              <Badge variant={riskVariant(row.countryRiskLevel)}>{titleCase(row.countryRiskLevel)} country risk</Badge>
              <Badge variant={riskVariant(row.currencyRiskLevel)}>{titleCase(row.currencyRiskLevel)} currency risk</Badge>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <p className="text-2xl font-semibold text-foreground">
              {row.opportunityScore}<span className="text-sm font-normal text-muted-foreground">/100</span>
            </p>
            <Caption>Opportunity · confidence {row.confidence}/100</Caption>
            <PersonalFitBadge fit={row.personalFit} />
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
          {metrics.map(([label, v]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd>{typeof v === "number" ? <ScorePill score={v} /> : <span className="text-xs text-muted-foreground">{v}</span>}</dd>
            </div>
          ))}
        </dl>
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          {row.reasons.length > 0 && <p className="text-foreground"><span className="font-medium text-success">Why: </span>{row.reasons.join(" · ")}</p>}
          {row.risks.length > 0 && <p className="text-foreground"><span className="font-medium text-warning">Risks: </span>{row.risks.join(" · ")}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link href={`/products/${productId}/markets/${row.country.code}`}>
              View Market Analysis
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <FindBuyersButton productId={productId} country={row.country.code} />
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input type="checkbox" className="size-4" checked={selected} disabled={selectDisabled} onChange={onToggle} />
            Add {row.country.name} to comparison
          </label>
        </div>
      </Card>
    </li>
  );
}
