"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Globe2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import type { CountryProductRanking } from "@exportpro/types";
import { marketsApi } from "@/lib/api/markets";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { categoryLabel } from "@/lib/product-labels";
import { useSession } from "@/lib/session";
import { RequirePermission } from "@/components/layout/require-permission";
import {
  ContextBadges,
  MarketSourcePanel,
  Meta,
  PersonalFitBadge,
  riskVariant,
  ScorePill,
  titleCase,
} from "@/components/markets/market-bits";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function CountryDetailPage() {
  return (
    <RequirePermission permission="country_intelligence.view">
      <CountryDetailContent />
    </RequirePermission>
  );
}

function CountryDetailContent() {
  const { countryCode } = useParams<{ countryCode: string }>();
  const [page, setPage] = React.useState(1);
  const { data: session } = useSession();
  const canAnalyze = hasPermission(session, "products.analyze");
  const detail = useQuery({
    queryKey: ["markets", "detail", countryCode, page],
    queryFn: () => marketsApi.country(countryCode, page),
    placeholderData: keepPreviousData,
  });

  if (detail.isLoading) return <PageSkeleton />;
  if (detail.isError || !detail.data) {
    return <ErrorState title="Market not found" message={toFriendlyErrorMessage(detail.error)} onRetry={() => detail.refetch()} />;
  }
  const d = detail.data;
  const crumbs = [{ label: "Markets", href: "/markets" }, { label: d.country.name }];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Breadcrumbs items={crumbs} />
      <div className="flex flex-col gap-2">
        <PageTitle>{d.country.name}</PageTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{d.country.code} · {d.country.region}</Badge>
          <ContextBadges context={d.context} />
        </div>
      </div>

      {!d.supported ? (
        <EmptyState
          icon={Globe2}
          title="Market intelligence not available yet"
          description={`The current dataset does not cover ${d.country.name}.`}
          action={<Button asChild variant="outline"><Link href="/markets">Browse supported markets</Link></Button>}
        />
      ) : (
        <>
          {d.source && <MarketSourcePanel source={d.source} confidence={d.confidence} />}
          <section aria-labelledby="summary-h" className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="p-4">
              <SectionTitle id="summary-h" className="text-base">Market attractiveness</SectionTitle>
              <p className="mt-2 text-3xl font-semibold">{d.attractiveness}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
              <HelperText>Average of the top 3 product opportunities here.</HelperText>
            </Card>
            {d.risk && (
              <Card className="p-4">
                <h2 className="text-base font-semibold">Risk &amp; currency</h2>
                <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Country risk</dt><dd><Badge variant={riskVariant(d.risk.countryRiskLevel)}>{titleCase(d.risk.countryRiskLevel)}</Badge></dd></div>
                  <div><dt className="text-xs text-muted-foreground">Currency ({d.risk.currency})</dt><dd><Badge variant={riskVariant(d.risk.currencyRiskLevel)}>{titleCase(d.risk.currencyRiskLevel)} risk</Badge></dd></div>
                </dl>
                <HelperText className="mt-2">Broad sample signals — not a credit rating or FX forecast.</HelperText>
              </Card>
            )}
            {d.logistics && (
              <Card className="p-4">
                <div className="flex items-center gap-2"><h2 className="text-base font-semibold">Logistics from India</h2><ScorePill score={d.logistics.score} /></div>
                <dl className="mt-2 flex flex-col gap-1.5 text-sm">
                  <Meta label="Major ports" value={d.logistics.majorPorts.join(", ")} />
                  <Meta label="Sea transit (indicative)" value={d.logistics.seaTransit} />
                  <Meta label="Air suitability" value={d.logistics.airSuitability} />
                </dl>
              </Card>
            )}
          </section>

          <section aria-labelledby="products-h" className="flex flex-col gap-3">
            <div>
              <SectionTitle id="products-h">Best Indian products for {d.country.name}</SectionTitle>
              <HelperText>Advisory ranking from the sample dataset. Scores are global; personal fit is shown separately.</HelperText>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-max text-sm">
                <caption className="sr-only">Products ranked by opportunity in {d.country.name}</caption>
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    {["Rank", "Product", "Opportunity", "Demand", "Growth", "India share", "Tariff", "Competition", "Confidence", "Fit", "Actions"].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.products.map((p) => <ProductRow key={p.productCode} p={p} countryCode={d.country.code} canAnalyze={canAnalyze} />)}
                </tbody>
              </table>
            </div>
            {d.meta.totalPages > 1 && <Pagination meta={d.meta} onPageChange={setPage} />}
          </section>
        </>
      )}
    </div>
  );
}

function ProductRow({ p, countryCode, canAnalyze }: { p: CountryProductRanking; countryCode: string; canAnalyze: boolean }) {
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2">{p.rank}</td>
      <td className="px-3 py-2">
        <div className="flex max-w-[16rem] flex-col whitespace-normal">
          <span className="font-medium">{p.productLabel}</span>
          <Caption>{categoryLabel(p.categoryCode)} · HS {p.productCode}</Caption>
          <Caption>{p.realTradeData ? "Real import statistics + sample signals" : "Sample market data"}</Caption>
        </div>
      </td>
      <td className="px-3 py-2"><ScorePill score={p.opportunityScore} /></td>
      <td className="px-3 py-2">{p.components.demand}</td>
      <td className="px-3 py-2">{p.components.growth}</td>
      <td className="px-3 py-2">{p.indiaSharePercent}%</td>
      <td className="px-3 py-2">{p.components.tariff}</td>
      <td className="px-3 py-2">{p.components.competition}</td>
      <td className="px-3 py-2">{p.confidence}</td>
      <td className="px-3 py-2"><PersonalFitBadge fit={p.personalFit} /></td>
      <td className="px-3 py-2">
        {p.savedProductId ? (
          <div className="flex gap-1">
            <Button asChild variant="ghost" size="sm"><Link href={`/products/${p.savedProductId}`}>View product</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={`/products/${p.savedProductId}/markets/${countryCode}`}>View market analysis</Link></Button>
          </div>
        ) : canAnalyze ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/products/analyze?${new URLSearchParams({ input: p.productCode })}`}>Analyze &amp; save first</Link>
          </Button>
        ) : (
          <Caption>Not in your products</Caption>
        )}
      </td>
    </tr>
  );
}
