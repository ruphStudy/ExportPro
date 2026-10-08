"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { AnalyticsSection, SeriesPoint } from "@exportpro/types";
import { analyticsApi, type AnalyticsKey } from "@/lib/api/ai-ops";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom" },
];
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));

export default function AnalyticsPage() {
  return (
    <RequirePermission permission="analytics.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Analytics />
      </Suspense>
    </RequirePermission>
  );
}

function Analytics() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f = { range: params.get("range") ?? "month", from: params.get("from") ?? "", to: params.get("to") ?? "" };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const rq = f.range === "custom" ? f : { range: f.range };
  const o = useQuery({ queryKey: ["ops", "analytics", "overview", rq], queryFn: () => analyticsApi.overview(rq), enabled: f.range !== "custom" || (!!f.from && !!f.to) });
  const d = o.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Analytics</PageTitle>
        <HelperText className="mt-1">Executive view computed from your recorded data (finalized profitability, receivables, CRM, outreach, shipments). Trends describe the past — no predictions are made.</HelperText>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Select aria-label="Date range" containerClassName="w-44" value={f.range} onChange={(e) => set("range", e.target.value)} options={RANGES} />
        {f.range === "custom" && <><Input type="date" aria-label="From" containerClassName="w-40" value={f.from} onChange={(e) => set("from", e.target.value)} /><Input type="date" aria-label="To" containerClassName="w-40" value={f.to} onChange={(e) => set("to", e.target.value)} /></>}
      </div>
      {o.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : o.isError ? (
        <ErrorState title="Analytics unavailable" message={toFriendlyErrorMessage(o.error)} onRetry={() => o.refetch()} />
      ) : d ? (
        <>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key metrics">
            {d.cards.map((c) => (
              <li key={c.key}>
                <Card className="flex h-full flex-col gap-1 p-3">
                  <Caption>{c.label}</Caption>
                  <p className="break-words text-lg font-semibold">{c.value === null ? "Not available" : `${c.currency ? `${c.currency} ` : ""}${num(c.value)}`}</p>
                  {c.note && <Caption className="block break-words">{c.note}</Caption>}
                  {c.href && <Link className="mt-auto text-xs text-primary hover:underline" href={c.href}>View records →</Link>}
                </Card>
              </li>
            ))}
          </ul>
          <Caption>Reporting currency {d.reportingCurrency} · {d.range.from} – {d.range.to} · calculated {new Date(d.calculatedAt).toLocaleString()}{d.fxBasis.length ? ` · ${d.fxBasis.join(" ")}` : ""}</Caption>
          {d.insights.length > 0 && (
            <Card className="p-4 text-sm">
              <SectionTitle className="text-base">Insights (from computed figures)</SectionTitle>
              <ul className="mt-1 list-disc pl-5">{d.insights.map((i) => <li key={i.text} className="break-words">{i.text} {i.href && <Link className="text-primary hover:underline" href={i.href}>details</Link>}</li>)}</ul>
            </Card>
          )}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{(d.sections as AnalyticsKey[]).map((k) => <Section key={k} k={k} q={rq} />)}</div>
        </>
      ) : null}
    </div>
  );
}

/** Horizontal bars with the numeric value always printed (accessible, no chart library). */
function Bars({ data, label }: { data: (SeriesPoint & { href?: string })[]; label: string }) {
  if (!data.length) return <HelperText>Not enough data for this metric.</HelperText>;
  const max = Math.max(...data.map((x) => Math.abs(x.value)), 1);
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label}>
      {data.map((x) => (
        <li key={x.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate" title={x.label}>{x.href ? <Link className="text-primary hover:underline" href={x.href}>{x.label}</Link> : x.label}</span>
          <span className="h-2 rounded bg-muted" aria-hidden="true"><span className="block h-2 rounded bg-primary" style={{ width: `${(Math.abs(x.value) / max) * 100}%` }} /></span>
          <span className="tabular-nums">{x.display}</span>
        </li>
      ))}
    </ul>
  );
}

const TITLES: Record<AnalyticsKey, { href: string; link: string }> = {
  revenue: { href: "/profitability?view=buyers", link: "Profitability" },
  pipeline: { href: "/crm", link: "CRM" },
  markets: { href: "/profitability?view=countries", link: "Countries" },
  products: { href: "/profitability?view=products", link: "Products" },
  buyers: { href: "/crm", link: "CRM" },
  campaigns: { href: "/outreach", link: "Outreach" },
  shipments: { href: "/shipments", link: "Shipments" },
  receivables: { href: "/finance/receivables", link: "Receivables" },
  profitability: { href: "/profitability", link: "Profitability" },
  opportunities: { href: "/opportunities/watchlist", link: "Watchlist" },
};

function Section({ k, q }: { k: AnalyticsKey; q: Record<string, string> }) {
  const s = useQuery({ queryKey: ["ops", "analytics", k, q], queryFn: () => analyticsApi.section(k, q) });
  if (s.isLoading) return <Skeleton className="h-48 w-full" />;
  if (s.isError || !s.data) return <ErrorState title="Section unavailable" message={toFriendlyErrorMessage(s.error)} onRetry={() => s.refetch()} />;
  const x = s.data as AnalyticsSection<Record<string, never>>;
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="text-base">{x.title}</SectionTitle>
        <Button asChild size="sm" variant="ghost"><Link href={TITLES[k].href}>{TITLES[k].link} →</Link></Button>
      </div>
      {!x.available || !x.metrics ? <HelperText>{x.unavailableReason ?? "Not enough data for this metric."}</HelperText> : <Body k={k} m={x.metrics} />}
      <Caption className="block break-words">Source: {x.source.source}{x.source.freshness ? ` · ${x.source.freshness}` : ""}{x.source.note ? ` · ${x.source.note}` : ""} · {x.source.range.from} – {x.source.range.to}</Caption>
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Body({ k, m }: { k: AnalyticsKey; m: any }) {
  switch (k) {
    case "revenue":
      return (
        <>
          <p>Finalized: <span className="font-medium">{m.reportingCurrency} {num(m.finalized.revenue)}</span> revenue · {num(m.finalized.profit)} profit · {m.finalized.shipments} shipment(s)</p>
          <Caption className="block">{m.inProgress.label}: {m.reportingCurrency} {num(m.inProgress.revenue)} ({m.inProgress.shipments} shipment(s))</Caption>
          <Bars label="Revenue trend" data={m.trend} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div><Caption>By buyer</Caption><Bars label="Revenue by buyer" data={m.byBuyer} /></div><div><Caption>By market</Caption><Bars label="Revenue by market" data={m.byCountry} /></div><div><Caption>By product</Caption><Bars label="Revenue by product" data={m.byProduct} /></div></div>
        </>
      );
    case "pipeline":
      return (
        <>
          <p>{m.metrics.openLeads} open lead(s) · {m.metrics.qualifiedPlus} qualified+ · {m.metrics.overdueFollowUps} overdue follow-up(s){m.conversion ? ` · ${m.conversion}` : ""}</p>
          <Bars label="Leads by stage" data={m.stages} />
          <Caption>Last activity</Caption>
          <Bars label="Lead aging" data={m.aging} />
        </>
      );
    case "markets":
    case "products":
      return m.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-left text-xs">
            <thead><tr className="text-muted-foreground"><th className="py-1">{k === "markets" ? "Destination" : "Product"}</th><th>Revenue</th><th>Profit</th><th>Margin</th><th>{k === "markets" ? "Growth" : "Repeat buyers"}</th></tr></thead>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <tbody>{m.rows.map((r: any) => <tr key={r.country ?? r.product?.name} className="border-t border-border"><td className="py-1">{r.country ?? r.product.name}</td><td>{num(r.revenue)}</td><td>{num(r.profit)}</td><td>{r.marginPercent ? `${r.marginPercent}%` : "—"}</td><td>{k === "markets" ? (r.growthPercent ? `${r.growthPercent}%` : "—") : r.repeatBuyers}</td></tr>)}</tbody>
          </table>
          <Caption className="block">Amounts in {m.reportingCurrency}{k === "markets" ? "; growth vs the previous period of equal length" : ""}.</Caption>
        </div>
      ) : <HelperText>Not enough finalized profitability in this range.</HelperText>;
    case "buyers":
      return <Bars label="Buyer conversion funnel" data={m.funnel} />;
    case "campaigns":
      return <p className="break-words">Sent {m.totals.sent} · delivered {m.totals.delivered ?? "not measured"} · opened {m.totals.opened ?? "not measured"} · replied {m.totals.replied} · bounced {m.totals.bounced} · interested {m.totals.interested} · converted {m.totals.converted}</p>;
    case "shipments":
      return (
        <>
          <p>{m.overview.active} active · {m.inTransit} in transit · {m.overview.delayed} delayed · {m.delivered} delivered · {m.openExceptions.total} open exception(s) ({m.openExceptions.critical} critical)</p>
          <Bars label="Shipments by status" data={m.byStatus} />
        </>
      );
    case "receivables":
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-left text-xs">
            <thead><tr className="text-muted-foreground"><th className="py-1">Currency</th><th>Current</th><th>1–30</th><th>31–60</th><th>61–90</th><th>90+</th></tr></thead>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <tbody>{m.aging.map((r: any) => <tr key={r.currency} className="border-t border-border"><td className="py-1">{r.currency}</td><td>{num(r.current)}</td><td>{num(r.d1_30)}</td><td>{num(r.d31_60)}</td><td>{num(r.d61_90)}</td><td>{num(r.d90plus)}</td></tr>)}</tbody>
          </table>
          <Caption className="block">Outstanding {m.reportingCurrency} {num(m.normalized.outstanding)} · {m.normalized.missingFx.length ? `no FX for ${m.normalized.missingFx.join(", ")}` : m.normalized.basis}</Caption>
        </div>
      );
    case "profitability":
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {[m.finalized, m.inProgress].map((g: any) => <div key={g.label} className="rounded-md border border-border p-2"><p className="font-medium">{g.label}</p><Caption className="block">{g.shipments} shipment(s) · revenue {num(g.revenue)} · cost {num(g.cost)} · profit {num(g.profit)} · margin {g.marginPercent ? `${g.marginPercent}%` : "—"} · variance vs estimate {num(g.profitVariance)}</Caption></div>)}
          <Caption className="block sm:col-span-2">{m.incomplete} shipment(s) with incomplete inputs are excluded. Amounts in {m.reportingCurrency}.</Caption>
        </div>
      );
    case "opportunities":
      return (
        <>
          <p>{m.saved} on watchlist ({m.savedInRange} added in range)</p>
          <Caption>Average score of watchlist opportunities (observed)</Caption>
          <Bars label="Average score by month" data={m.averageScoreTrend} />
          <Bars label="Top watchlist opportunities" data={m.top} />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {m.freshness.length > 0 && <Caption className="block break-words">Data freshness: {m.freshness.map((f: any) => `${f.source} (run ${f.lastRunAt.slice(0, 10)}${f.latestPeriodEnd ? `, data to ${f.latestPeriodEnd}` : ""})`).join("; ")}</Caption>}
        </>
      );
  }
}
