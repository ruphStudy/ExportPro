"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Bookmark, BookmarkCheck, CheckCircle2, Info, Sparkles, Wrench } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PRODUCT_CATEGORIES, type PersonalizedRecommendation, type RecommendationGroupKey } from "@exportpro/types";
import { comparisonsApi } from "@/lib/api/comparisons";
import { watchlistApi } from "@/lib/api/opportunities";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { categoryLabel } from "@/lib/product-labels";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { RequirePermission } from "@/components/layout/require-permission";
import { MarketSourcePanel, riskVariant, ScorePill, titleCase } from "@/components/markets/market-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function RecommendationsPage() {
  return (
    <RequirePermission permission="recommendations.view">
      <RecommendationsContent />
    </RequirePermission>
  );
}

function RecommendationsContent() {
  const [category, setCategory] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [risk, setRisk] = React.useState("");
  const [budgetFit, setBudgetFit] = React.useState(false);
  const [group, setGroup] = React.useState<RecommendationGroupKey | "">("");
  const [page, setPage] = React.useState(1);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const recs = useQuery({
    queryKey: ["recommendations", category, country, risk, budgetFit, group, page],
    queryFn: () =>
      comparisonsApi.recommendations({
        category: category || undefined,
        country: country || undefined,
        risk: (risk || undefined) as "LOW" | "MODERATE" | "HIGH" | undefined,
        budgetFit: budgetFit || undefined,
        group: group || undefined,
        page,
        pageSize: 12,
      }),
    placeholderData: keepPreviousData,
  });
  // Unfiltered list (small, bounded) only to offer country options that actually have recommendations.
  const allForOptions = useQuery({ queryKey: ["recommendations", "options"], queryFn: () => comparisonsApi.recommendations({ pageSize: 50 }) });
  const countryOptions = [...new Map((allForOptions.data?.items ?? []).map((r) => [r.country.code, r.country.name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <PageTitle>Recommendations</PageTitle>
        <HelperText className="mt-1">Product × market opportunities ranked for your business profile. Recommended based on current data and your profile.</HelperText>
      </div>

      {recs.data && (
        <>
          <p role="note" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm font-medium text-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            {recs.data.disclaimer}
          </p>
          <ProfileBanner data={recs.data} />
        </>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Category" placeholder="All categories" value={category} onChange={(e) => reset(setCategory)(e.target.value)} options={PRODUCT_CATEGORIES.map((c) => ({ value: c.code, label: c.label }))} />
        <Select label="Country" placeholder="All countries" value={country} onChange={(e) => reset(setCountry)(e.target.value)} options={countryOptions} />
        <Select label="Country risk" placeholder="Any risk" value={risk} onChange={(e) => reset(setRisk)(e.target.value)} options={[{ value: "LOW", label: "Low" }, { value: "MODERATE", label: "Moderate" }, { value: "HIGH", label: "High" }]} />
        <label className="flex items-center gap-2 self-end rounded-md border border-border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring">
          <input type="checkbox" className="size-4" checked={budgetFit} onChange={(e) => reset(setBudgetFit)(e.target.checked)} />
          Within my budget only
        </label>
      </div>

      {recs.data && (
        <div role="radiogroup" aria-label="Recommendation groups" className="flex flex-wrap gap-2">
          {[{ key: "" as const, label: "All", count: null as number | null }, ...recs.data.groups].map((g) => (
            <label key={g.key || "all"} className={cn("cursor-pointer rounded-full border px-3 py-1.5 text-xs focus-within:ring-2 focus-within:ring-ring", group === g.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
              <input type="radio" name="rec-group" className="sr-only" checked={group === g.key} onChange={() => reset(setGroup)(g.key)} />
              {g.label}
              {g.count !== null && <span className="ml-1 opacity-80">({g.count})</span>}
            </label>
          ))}
        </div>
      )}

      {recs.isLoading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : recs.isError || !recs.data ? (
        <ErrorState title="Recommendations couldn't load" message={toFriendlyErrorMessage(recs.error)} onRetry={() => recs.refetch()} />
      ) : recs.data.items.length === 0 ? (
        <EmptyState icon={Sparkles} title="No recommendations match" description="Try removing a filter. Only product–market pairs with supported intelligence are recommended." />
      ) : (
        <ol className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Recommended opportunities">
          {recs.data.items.map((r) => <RecommendationCard key={r.id} rec={r} />)}
        </ol>
      )}
      {recs.data && recs.data.meta.totalPages > 1 && <Pagination meta={recs.data.meta} onPageChange={setPage} />}

      {recs.data && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">How recommendations are ranked</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p>{recs.data.rankingFormula}</p>
            <table className="w-full max-w-md text-left text-xs">
              <caption className="sr-only">Personal fit weights</caption>
              <thead><tr className="text-muted-foreground"><th scope="col" className="py-1 font-medium">Personal-fit component</th><th scope="col" className="py-1 text-right font-medium">Max points</th></tr></thead>
              <tbody>{recs.data.weights.map((w) => <tr key={w.key} className="border-t border-border"><td className="py-1">{w.label}</td><td className="py-1 text-right">{w.max}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
      {recs.data && <MarketSourcePanel source={recs.data.source} />}
    </div>
  );
}

function ProfileBanner({ data }: { data: NonNullable<Awaited<ReturnType<typeof comparisonsApi.recommendations>>> }) {
  const p = data.profile;
  if (!p.missingInputs.length) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
      <span>
        Profile {p.completenessPercent}% complete. Recommendation confidence is lower because {p.missingInputs.join(", ")} {p.missingInputs.length === 1 ? "is" : "are"} incomplete.{" "}
        <Link href="/export-setup" className="font-medium text-primary hover:underline">Complete Export Setup</Link>
      </span>
    </p>
  );
}

function RecommendationCard({ rec }: { rec: PersonalizedRecommendation }) {
  const { data: session } = useSession();
  const canSave = hasPermission(session, "opportunities.save");
  const queryClient = useQueryClient();
  const toggleSave = useMutation({
    mutationFn: () => (rec.opportunity!.isSaved ? watchlistApi.remove(rec.opportunity!.id) : watchlistApi.save(rec.opportunity!.id)),
    onSuccess: () => {
      toast.success(rec.opportunity!.isSaved ? "Removed from watchlist" : "Opportunity saved");
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities", "watchlist"] });
    },
    onError: (e) => toast.error("Could not update watchlist", toFriendlyErrorMessage(e)),
  });
  const fit = rec.personalFit;
  return (
    <li>
      <Card className="flex h-full flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Caption>#{rec.rank} · {categoryLabel(rec.categoryCode)}</Caption>
            <h2 className="break-words text-base font-semibold">{rec.productLabel} → {rec.country.name}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {rec.isTargetMarket && <Badge variant="info">Your Target Market</Badge>}
              {rec.realTradeData ? <Badge variant="success">Real import data</Badge> : <Badge variant="warning">Sample data</Badge>}
              {rec.withinBudget && <Badge variant="success">Within your budget</Badge>}
              <Badge variant={riskVariant(rec.marketEntry)}>{titleCase(rec.marketEntry)} entry</Badge>
              <Badge variant={riskVariant(rec.countryRiskLevel)}>{titleCase(rec.countryRiskLevel)} country risk</Badge>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold">{rec.recommendationScore}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
            <Caption>Recommendation rank score</Caption>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Market opportunity</dt><dd><ScorePill score={rec.baseOpportunityScore} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">Personal fit</dt><dd><ScorePill score={fit.score} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">Product opportunity</dt><dd>{rec.productOpportunityScore === null ? "—" : <ScorePill score={rec.productOpportunityScore} />}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Confidence</dt><dd className="text-sm">{rec.confidence}/100</dd></div>
        </dl>
        {fit.reasons.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold">Why this fits your business</h3>
            <ul className="mt-1 flex flex-col gap-0.5">{fit.reasons.slice(0, 5).map((r) => <li key={r.text} className="flex items-start gap-1.5 text-sm"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />{r.text}</li>)}</ul>
          </div>
        )}
        {fit.cautions.filter((c) => c.component !== "readiness").length > 0 && (
          <div>
            <h3 className="text-xs font-semibold">Cautions</h3>
            <ul className="mt-1 flex flex-col gap-0.5">{fit.cautions.filter((c) => c.component !== "readiness").slice(0, 4).map((c) => <li key={c.text} className="flex items-start gap-1.5 text-sm"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />{c.text}</li>)}</ul>
          </div>
        )}
        {rec.fixFirst.length > 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-2.5">
            <h3 className="flex items-center gap-1 text-xs font-semibold"><Wrench className="size-3.5" aria-hidden="true" />What should I fix first?</h3>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">{rec.fixFirst.map((f) => <li key={f}>• {f}</li>)}</ul>
            <Link href="/export-setup" className="mt-1 inline-block text-xs font-medium text-primary hover:underline">Open Export Setup</Link>
          </div>
        )}
        <div className="mt-auto flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={rec.nextAction.href}>{rec.nextAction.label}<ArrowRight className="size-4" aria-hidden="true" /></Link>
          </Button>
          {rec.savedProductId && (
            <Button asChild variant="outline" size="sm"><Link href={`/compare/markets?product=${rec.savedProductId}&countries=${rec.country.code}`}>Compare markets</Link></Button>
          )}
          {rec.opportunity && canSave && (
            <Button variant="outline" size="sm" onClick={() => toggleSave.mutate()} loading={toggleSave.isPending}>
              {rec.opportunity.isSaved ? <BookmarkCheck className="size-4" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}
              {rec.opportunity.isSaved ? "Saved" : "Save Opportunity"}
            </Button>
          )}
        </div>
      </Card>
    </li>
  );
}
