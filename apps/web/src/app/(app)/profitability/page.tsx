"use client";

import { useQuery } from "@tanstack/react-query";
import { LineChart } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { AnalyticsMeta, ProfitabilityAnalytics, Ranking } from "@exportpro/types";
import { profitabilityApi } from "@/lib/api/finance";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { day, FinanceTabs, money, NOT_ACCOUNTING, pct, PROFIT_STATUS, ProfitBadge, RangePicker } from "@/components/finance/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const VIEWS = [
  { key: "shipments", label: "Shipments" },
  { key: "buyers", label: "Buyers" },
  { key: "products", label: "Products" },
  { key: "countries", label: "Countries" },
] as const;

export default function ProfitabilityPage() {
  return (
    <RequirePermission permission="profitability.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Profitability />
      </Suspense>
    </RequirePermission>
  );
}

function Profitability() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = (params.get("view") ?? "shipments") as (typeof VIEWS)[number]["key"];
  const f = { range: params.get("range") ?? (view === "shipments" ? "all" : "year"), from: params.get("from") ?? "", to: params.get("to") ?? "", includeInProgress: params.get("includeInProgress") ?? "false" };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const rq: Record<string, string> = f.range === "custom" ? { range: "custom", from: f.from, to: f.to } : { range: f.range };
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Finance &amp; Profitability</PageTitle>
        <HelperText className="mt-1">Actual profit = actual revenue − actual costs, compared with the Sprint 14 costing estimate. {NOT_ACCOUNTING}</HelperText>
      </div>
      <FinanceTabs />
      <div role="tablist" aria-label="Profitability views" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {VIEWS.map((v) => <Button key={v.key} role="tab" aria-selected={view === v.key} size="sm" variant={view === v.key ? "secondary" : "ghost"} onClick={() => set("view", v.key === "shipments" ? "" : v.key)}>{v.label}</Button>)}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <RangePicker range={f.range} from={f.from} to={f.to} onChange={set} />
        {view !== "shipments" && <Checkbox checked={f.includeInProgress === "true"} onChange={(e) => set("includeInProgress", e.target.checked ? "true" : "")} label="Include in-progress (not finalized) shipments" />}
      </div>
      {view === "shipments" ? <ShipmentList rq={rq} /> : <Analytics view={view} q={{ ...rq, includeInProgress: f.includeInProgress }} />}
    </div>
  );
}

function ShipmentList({ rq }: { rq: Record<string, string> }) {
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState(search);
  const q = useQuery({ queryKey: ["finance", "profit-list", rq, status, applied, page], queryFn: () => profitabilityApi.list({ ...rq, status, search: applied, page, pageSize: 20 }) });
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <form role="search" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); setPage(1); }}>
          <SearchInput aria-label="Search shipments" placeholder="Shipment, buyer, country" value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => { setSearch(""); setApplied(""); }} />
        </form>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: "", label: "All statuses" }, ...Object.entries(PROFIT_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
      </div>
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError || !q.data ? (
        <ErrorState title="Could not load profitability" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data.items.length ? (
        <EmptyState icon={LineChart} title="No shipments in this range" description="Profitability appears per shipment once a shipment exists." />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {q.data.items.map((s) => (
              <li key={s.shipmentId}>
                <Card className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link className="font-medium text-primary hover:underline" href={`/profitability/shipments/${s.shipmentId}`}>{s.shipmentNumber}</Link>
                    <Caption className="block break-words">{s.buyer.name} · {s.destinationCountry ?? "—"} · {day(s.periodDate)}</Caption>
                    <Caption className="block">Revenue {money(s.revenue, s.reportingCurrency)} · est. profit {money(s.estimatedProfit)} · {s.status === "FINALIZED" || s.status === "ACTUAL_IN_PROGRESS" ? `actual profit ${money(s.actualProfit)} (${pct(s.marginPercent)}) · variance ${money(s.profitVariance)}` : `${s.completeness.missing.filter((m) => !m.startsWith("Note")).length} input(s) missing — no final profit`}</Caption>
                  </div>
                  <ProfitBadge status={s.status} />
                </Card>
              </li>
            ))}
          </ul>
          <Pagination meta={q.data.meta} onPageChange={setPage} />
        </>
      )}
    </>
  );
}

function Meta({ m }: { m: AnalyticsMeta }) {
  return <Caption className="block">{m.basis} Range {m.range.from} – {m.range.to} · {m.finalizedCount} finalized{m.includeInProgress ? ` · ${m.inProgressCount} in progress` : ""} · {m.reportingCurrency} · calculated {new Date(m.calculatedAt).toLocaleString()}</Caption>;
}

function Rankings({ rankings }: { rankings: Ranking[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rankings.map((r) => (
        <Card key={r.key} className="p-3 text-sm">
          <p className="font-medium">{r.label}</p>
          <Caption className="block">{r.explanation}</Caption>
          {!r.rows.length ? <HelperText className="mt-1">Not enough data.</HelperText> : <ol className="mt-1 list-decimal pl-5">{r.rows.map((x) => <li key={`${r.key}-${x.id}-${x.name}`} className="break-words">{x.name} — {x.value}</li>)}</ol>}
        </Card>
      ))}
    </div>
  );
}

function Trend({ data, currency }: { data: ProfitabilityAnalytics<unknown>["trend"]; currency: string }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => Math.abs(Number(d.marginPercent ?? 0))), 1);
  return (
    <Card className="p-4 text-sm">
      <SectionTitle className="text-base">Margin trend (monthly)</SectionTitle>
      <ul className="mt-2 flex flex-col gap-1.5" aria-label="Monthly margin">
        {data.map((d) => (
          <li key={d.period} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
            <span>{d.period}</span>
            <span className="h-2 rounded bg-muted" aria-hidden="true"><span className="block h-2 rounded bg-primary" style={{ width: `${(Math.abs(Number(d.marginPercent ?? 0)) / max) * 100}%` }} /></span>
            <span className="tabular-nums">{pct(d.marginPercent)} · {money(d.profit, currency)} · {d.shipments} shp</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Analytics({ view, q }: { view: "buyers" | "products" | "countries"; q: Record<string, string> }) {
  const fn = view === "buyers" ? profitabilityApi.buyers : view === "products" ? profitabilityApi.products : profitabilityApi.countries;
  const r = useQuery({ queryKey: ["finance", "analytics", view, q], queryFn: () => fn(q) as unknown as Promise<ProfitabilityAnalytics<Record<string, unknown>>> });
  if (r.isLoading) return <Skeleton className="h-64 w-full" />;
  if (r.isError || !r.data) return <ErrorState title="Could not load analytics" message={toFriendlyErrorMessage(r.error)} onRetry={() => r.refetch()} />;
  const d = r.data;
  const cur = d.meta.reportingCurrency;
  return (
    <div className="flex flex-col gap-4">
      <Meta m={d.meta} />
      {!d.rows.length ? <EmptyState icon={LineChart} title="No finalized profitability in this range" description="Finalize shipment profitability (or include in-progress shipments) to see aggregates." /> : (
        <>
          {d.insights.length > 0 && <Card className="p-4 text-sm"><SectionTitle className="text-base">Facts from the figures</SectionTitle><ul className="mt-1 list-disc pl-5">{d.insights.map((i) => <li key={i}>{i}</li>)}</ul></Card>}
          <Rankings rankings={d.rankings} />
          <Card className="overflow-x-auto p-4">
            <table className="w-full min-w-[720px] text-sm">
              {view === "buyers" ? (
                <>
                  <thead><tr className="text-left text-muted-foreground"><th className="py-1">Buyer</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th><th>Shipments</th><th>Orders</th><th>Outstanding</th><th>Overdue</th><th>Avg order</th><th>Historical customer value</th></tr></thead>
                  <tbody>{(d.rows as never as import("@exportpro/types").BuyerProfitability[]).map((b) => <tr key={b.buyer.id} className="border-t border-border"><td className="py-1">{b.buyer.name}</td><td>{money(b.revenue)}</td><td>{money(b.totalCost)}</td><td>{money(b.grossProfit)}</td><td>{pct(b.marginPercent)}</td><td>{b.shipments}</td><td>{b.orders} ({b.repeatOrders} repeat)</td><td>{money(b.outstanding)}</td><td>{money(b.overdue)}</td><td>{money(b.averageOrderValue)}</td><td>{money(b.historicalCustomerValue)}</td></tr>)}</tbody>
                </>
              ) : view === "products" ? (
                <>
                  <thead><tr className="text-left text-muted-foreground"><th className="py-1">Product</th><th>Revenue</th><th>Volume</th><th>Cost</th><th>Profit</th><th>Margin</th><th>Shipments</th><th>Orders</th><th>Repeat buyers</th></tr></thead>
                  <tbody>{(d.rows as never as import("@exportpro/types").ProductProfitability[]).map((p) => <tr key={p.product.id ?? p.product.name} className="border-t border-border"><td className="py-1">{p.product.name}</td><td>{money(p.revenue)}</td><td>{p.volume.map((v) => `${v.quantity} ${v.unit}`).join(", ")}</td><td>{money(p.totalCost)}</td><td>{money(p.profit)}</td><td>{pct(p.marginPercent)}</td><td>{p.shipments}</td><td>{p.orders}</td><td>{p.repeatBuyers}</td></tr>)}</tbody>
                </>
              ) : (
                <>
                  <thead><tr className="text-left text-muted-foreground"><th className="py-1">Destination</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th><th>Shipments</th><th>Avg freight</th><th>Avg payment delay</th><th>Repeat rate</th><th>Overdue</th></tr></thead>
                  <tbody>{(d.rows as never as import("@exportpro/types").CountryProfitability[]).map((c) => <tr key={c.country} className="border-t border-border"><td className="py-1">{c.country}</td><td>{money(c.revenue)}</td><td>{money(c.cost)}</td><td>{money(c.profit)}</td><td>{pct(c.marginPercent)}</td><td>{c.shipments}</td><td>{money(c.averageFreightCost)}</td><td>{c.averagePaymentDelayDays ? `${c.averagePaymentDelayDays} d` : "—"}</td><td>{c.repeatRatePercent ? `${c.repeatRatePercent}%` : "—"}</td><td>{money(c.overdueExposure)}</td></tr>)}</tbody>
                </>
              )}
            </table>
            <Caption className="mt-2 block">All amounts in {cur}{view === "buyers" ? ". Historical customer value = realized gross profit to date — not a prediction." : view === "countries" ? ". Destination = shipment destination, not buyer head office." : "."}</Caption>
          </Card>
          <Trend data={d.trend} currency={cur} />
        </>
      )}
    </div>
  );
}
