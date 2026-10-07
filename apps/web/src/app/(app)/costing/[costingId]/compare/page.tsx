"use client";

import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import type { ComparisonObjective, ScenarioComparisonRow } from "@exportpro/types";
import { COST_CATEGORY_LABELS, COST_CATEGORY_ORDER } from "@exportpro/types";
import { costingApi, fmtMoney, fmtPct } from "@/lib/api/costing";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { TRANSPORT_LABELS } from "@/lib/costing-labels";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Select } from "@/components/ui/select";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

const LABEL_TEXT: Record<ScenarioComparisonRow["labels"][number], string> = {
  LOWEST_COST: "Lowest cost",
  HIGHEST_MARGIN: "Highest margin",
  HIGHEST_PROFIT: "Highest profit",
  CLOSEST_TO_TARGET: "Closest to buyer target",
};

export default function ComparePage() {
  return (
    <RequirePermission permission="costing.view">
      <Compare />
    </RequirePermission>
  );
}

function Compare() {
  const { costingId } = useParams<{ costingId: string }>();
  const c = useQuery({ queryKey: ["costings", "detail", costingId], queryFn: () => costingApi.get(costingId) });
  const [picked, setPicked] = React.useState<string[] | null>(null);
  const [objective, setObjective] = React.useState<ComparisonObjective | "">("");
  const ids = picked ?? c.data?.scenarios.slice(0, 5).map((s) => s.id) ?? [];
  const cmp = useQuery({
    queryKey: ["costings", "compare", costingId, ids, objective, c.data?.rowVersion],
    queryFn: () => costingApi.compare(costingId, ids, objective || undefined),
    enabled: ids.length >= 2,
  });
  if (c.isLoading) return <PageSkeleton />;
  if (c.isError || !c.data) return <ErrorState title="Costing not available" message={toFriendlyErrorMessage(c.error)} onRetry={() => c.refetch()} />;
  const d = c.data;
  const toggle = (id: string) => setPicked(ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 5 ? ids : [...ids, id]);
  const rows = cmp.data?.rows ?? [];
  const cur = d.calculationCurrency;
  const metric = (label: string, get: (r: ScenarioComparisonRow) => React.ReactNode) => ({ label, get });
  const delta = (v: string | null | undefined, suffix: string, money = true) =>
    v === null || v === undefined ? null : <Caption className="block">vs Base {v.startsWith("-") ? "" : "+"}{money ? fmtMoney(v, cur) : `${v}${suffix}`}</Caption>;
  const cats = COST_CATEGORY_ORDER.filter((cat) => rows.some((r) => r.categoryTotals[cat] !== undefined));
  const metrics = [
    metric("Quantity", (r) => `${r.quantity} ${r.quantityUnit}`),
    metric("Supplier", (r) => r.supplierLabel ?? "—"),
    metric("Transport", (r) => (r.transportMode ? TRANSPORT_LABELS[r.transportMode] : "—")),
    metric("Origin → destination port", (r) => `${r.originPort ?? "—"} → ${r.destinationPort ?? "—"}`),
    metric("Incoterm®", (r) => `${r.incoterm}${r.incotermPlace ? ` ${r.incotermPlace}` : ""}`),
    metric("FX", (r) => (r.fx.length ? r.fx.map((f) => `${f.pair} ${f.rate}`).join(", ") : "—")),
    ...cats.map((cat) => metric(COST_CATEGORY_LABELS[cat], (r) => (r.categoryTotals[cat] === null ? <Caption>Excluded / missing</Caption> : r.categoryTotals[cat] === undefined ? "—" : fmtMoney(r.categoryTotals[cat] as string, cur)))),
    metric("Total cost", (r) => (r.complete ? <>{fmtMoney(r.totalCost, cur)}{delta(r.deltaVsBase?.totalCost, "")}</> : <Badge variant="warning">Incomplete</Badge>)),
    metric("Cost per unit", (r) => <>{fmtMoney(r.costPerUnit, cur)}{delta(r.deltaVsBase?.costPerUnit, "")}</>),
    metric("Selling price per unit", (r) => <>{fmtMoney(r.sellingPricePerUnit, cur)}{r.sellingPricePerUnitQuote && <Caption className="block">{fmtMoney(r.sellingPricePerUnitQuote, d.quoteCurrency, 4)}</Caption>}</>),
    metric("Margin", (r) => <>{fmtPct(r.marginPercent)}{delta(r.deltaVsBase?.marginPoints, " pts", false)}</>),
    metric("Total profit", (r) => <>{fmtMoney(r.totalProfit, cur)}{delta(r.deltaVsBase?.totalProfit, "")}</>),
    metric("Buyer target gap", (r) => (r.buyerTargetGapPercent === null ? "—" : `${r.buyerTargetGapPercent}%`)),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Export Costing", href: "/costing" }, { label: d.reference, href: `/costing/${d.id}` }, { label: "Compare scenarios" }]} />
      <div>
        <PageTitle>Compare scenarios</PageTitle>
        <HelperText className="mt-1">Side-by-side, deterministic results for {d.reference}. Fixed costs stay fixed when quantity changes; nothing is assumed beyond your inputs.</HelperText>
      </div>
      {d.scenarios.length < 2 ? (
        <EmptyState icon={Scale} title="Add at least 2 scenarios" description="Duplicate the Base scenario and change supplier, port, freight, quantity, Incoterm® or FX." action={<Button asChild size="sm"><Link href={`/costing/${d.id}`}>Back to costing</Link></Button>} />
      ) : (
        <>
          <Card className="flex flex-col gap-3 p-4">
            <fieldset>
              <legend className="text-sm font-medium">Scenarios (2–5)</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {d.scenarios.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm">
                    <input type="checkbox" className="size-4" checked={ids.includes(s.id)} onChange={() => toggle(s.id)} disabled={!ids.includes(s.id) && ids.length >= 5} />
                    {s.name}{s.isBase ? " (Base)" : ""}
                  </label>
                ))}
              </div>
            </fieldset>
            <Select
              label="Optimize for (optional ranking)"
              placeholder="No objective — show labels only"
              value={objective}
              onChange={(e) => setObjective(e.target.value as ComparisonObjective | "")}
              options={[
                { value: "LOWEST_COST", label: "Lowest cost" },
                { value: "HIGHEST_MARGIN", label: "Highest margin" },
                { value: "HIGHEST_PROFIT", label: "Highest profit" },
                { value: "CLOSEST_TO_TARGET", label: "Closest to buyer target" },
              ]}
              containerClassName="max-w-sm"
            />
          </Card>
          {ids.length < 2 ? (
            <EmptyState icon={Scale} title="Select at least 2 scenarios" />
          ) : cmp.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : cmp.isError || !cmp.data ? (
            <ErrorState title="Could not compare" message={toFriendlyErrorMessage(cmp.error)} onRetry={() => cmp.refetch()} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <table className="w-full min-w-max text-sm">
                  <caption className="sr-only">Scenario comparison in {cur}</caption>
                  <thead className="bg-muted/50 text-xs">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
                      {rows.map((r) => (
                        <th key={r.scenarioId} scope="col" className="px-3 py-2 text-left align-top">
                          <span className="font-semibold">{r.name}{r.isBase ? " (Base)" : ""}</span>
                          {r.rank !== null && <Caption className="block">Rank #{r.rank}</Caption>}
                          <div className="mt-1 flex flex-wrap gap-1">{r.labels.map((l) => <Badge key={l} variant="success">{LABEL_TEXT[l]}</Badge>)}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((m) => (
                      <tr key={m.label} className="border-t border-border">
                        <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">{m.label}</th>
                        {rows.map((r) => <td key={r.scenarioId} className="px-3 py-2 align-top tabular-nums">{m.get(r)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Caption>{cmp.data.note} Amounts in {cur}. Labels are factual for the selected metric only — not an overall “best” recommendation.</Caption>
            </>
          )}
        </>
      )}
    </div>
  );
}
