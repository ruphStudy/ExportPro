"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { COSTING_CURRENCIES } from "@exportpro/types";
import { freightApi } from "@/lib/api/logistics";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { day, LogisticsTabs, money, QUOTE_STATUS } from "@/components/logistics/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function ComparePage() {
  return (
    <RequirePermission permission="logistics.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Compare />
      </Suspense>
    </RequirePermission>
  );
}

function Compare() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const currency = params.get("currency") ?? "";
  const q = useQuery({ queryKey: ["logistics", "compare", ids, currency], queryFn: () => freightApi.compare(ids, currency || undefined), enabled: ids.length >= 2, retry: false });
  const needsCurrency = q.error instanceof ApiRequestError && (q.error.details as { code?: string } | undefined)?.code === "CURRENCY_REQUIRED";
  const setCurrency = (c: string) => {
    const p = new URLSearchParams(params.toString());
    if (c) p.set("currency", c);
    else p.delete("currency");
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const c = q.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Freight quotes", href: "/freight-quotes" }, { label: "Compare" }]} />
      <div>
        <PageTitle>Compare freight quotes</PageTitle>
        <HelperText className="mt-1">Scores are deterministic and explained below. They help you compare — you always make the selection.</HelperText>
      </div>
      <LogisticsTabs />
      <Select containerClassName="max-w-xs" label="Compare in currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={[{ value: "", label: "Quotes' own currency" }, ...COSTING_CURRENCIES.map((x) => ({ value: x.code, label: x.code }))]} description="Converted with your latest saved FX snapshot; the rate and its source are shown." />
      {ids.length < 2 ? (
        <HelperText>Pick 2–5 quotes on the <Link className="text-primary hover:underline" href="/freight-quotes">freight quotes</Link> list.</HelperText>
      ) : q.isLoading ? <Skeleton className="h-64 w-full" /> : needsCurrency ? (
        <Card className="p-4 text-sm" role="alert">These quotes use different currencies. Choose a comparison currency above.</Card>
      ) : q.isError || !c ? (
        <ErrorState title="Could not compare" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          {c.notes.length > 0 && (
            <Card className="p-4 text-sm">
              <SectionTitle className="text-base">Trade-offs</SectionTitle>
              <ul className="mt-1 list-disc pl-5">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </Card>
          )}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {c.rows.map((r) => (
              <li key={r.quote.id}>
                <Card className="flex h-full flex-col gap-2 p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="min-w-0 break-words font-medium text-primary hover:underline" href={`/freight-quotes/${r.quote.id}`}>{r.quote.forwarderName}</Link>
                    <span className="flex gap-1">{r.rank && <Badge variant={r.rank === 1 ? "success" : "neutral"}>#{r.rank}</Badge>}<Badge variant={QUOTE_STATUS[r.quote.status].variant}>{QUOTE_STATUS[r.quote.status].label}</Badge></span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Quoted</dt><dd className="text-right tabular-nums">{money(r.quote.totalCost, r.quote.currency)}</dd>
                    <dt className="text-muted-foreground">In {c.targetCurrency}</dt><dd className="text-right tabular-nums">{r.fxMissing ? "No FX rate" : money(r.normalizedTotal, c.targetCurrency)}</dd>
                    <dt className="text-muted-foreground">Transit</dt><dd className="text-right">{r.quote.transitDays != null ? `${r.quote.transitDays} d` : "—"}</dd>
                    <dt className="text-muted-foreground">Routing</dt><dd className="text-right break-words">{r.quote.direct === null ? "—" : r.quote.direct ? "Direct" : `Via ${r.quote.transshipmentPorts.join(", ")}`}</dd>
                    <dt className="text-muted-foreground">Valid until</dt><dd className="text-right">{day(r.quote.validityUntil)}</dd>
                    <dt className="text-muted-foreground">Exclusions</dt><dd className="text-right">{r.exclusionsCount}</dd>
                  </dl>
                  {r.fx && <Caption>FX {r.quote.currency}→{c.targetCurrency} at {r.fx.rate} · {r.fx.sourceLabel ?? "manual"} · {day(r.fx.sourceDate)}</Caption>}
                  {r.fxMissing && <Caption className="text-warning">No FX snapshot for {r.quote.currency}/{c.targetCurrency}. Save a rate in Costing to normalize.</Caption>}
                  <div className="mt-1 border-t border-border pt-2">
                    <p className="font-medium">Score {r.score ?? "—"}/100</p>
                    <ul className="mt-1 flex flex-col gap-0.5">{r.scoreBreakdown.map((b) => <li key={b.factor}><Caption>{b.factor}: {b.points}/{b.max} — {b.explanation}</Caption></li>)}</ul>
                  </div>
                  <Button asChild size="sm" variant="outline" className="mt-auto self-start"><Link href={`/freight-quotes/${r.quote.id}`}>Review &amp; select</Link></Button>
                </Card>
              </li>
            ))}
          </ul>
          <Caption>{c.scoringMethod}</Caption>
        </>
      )}
    </div>
  );
}
