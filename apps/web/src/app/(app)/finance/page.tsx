"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { financeApi, receivablesApi } from "@/lib/api/finance";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { FinanceTabs, money, NOT_ACCOUNTING, pct, RangePicker, words } from "@/components/finance/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function FinanceOverviewPage() {
  return (
    <RequirePermission permission="finance.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Overview />
      </Suspense>
    </RequirePermission>
  );
}

function Overview() {
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
  const q = useQuery({ queryKey: ["finance", "overview", f], queryFn: () => financeApi.overview(f.range === "custom" ? f : { range: f.range }) });
  const rem = useQuery({ queryKey: ["finance", "reminders"], queryFn: receivablesApi.reminders });
  const o = q.data;
  const rc = o?.reportingCurrency;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Finance &amp; Profitability</PageTitle>
        <HelperText className="mt-1">{NOT_ACCOUNTING}</HelperText>
      </div>
      <FinanceTabs />
      <RangePicker range={f.range} from={f.from} to={f.to} onChange={set} />
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError || !o ? (
        <ErrorState title="Could not load finance overview" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7" aria-label="Finance overview">
            {([
              ["Total outstanding", money(o.normalized.outstanding, rc)],
              ["Overdue", money(o.normalized.overdue, rc)],
              ["Due next 7 days", money(o.normalized.dueNext7, rc)],
              [`Collected (${o.range.from} – ${o.range.to})`, money(o.normalized.collected, rc)],
              ["Finalized shipment profit", money(o.profitability.totalProfit, rc)],
              ["Average margin (finalized)", pct(o.profitability.averageMargin)],
              ["Buyers due for reorder", String(o.reorderDue)],
            ] as const).map(([k, v]) => (
              <li key={k}><Card className="h-full p-3"><Caption>{k}</Caption><p className="break-words text-lg font-semibold">{v}</p></Card></li>
            ))}
          </ul>
          <Caption>{o.normalized.missingFx.length ? `Not normalized: no saved FX rate for ${o.normalized.missingFx.join(", ")} → ${rc}. See per-currency totals below.` : o.normalized.basis}</Caption>
          <Card className="overflow-x-auto p-4">
            <SectionTitle className="text-base">By currency (original amounts)</SectionTitle>
            <table className="mt-2 w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Currency</th><th>Outstanding</th><th>Overdue</th><th>Due today</th><th>Due soon</th><th>Collected</th></tr></thead>
              <tbody>
                {o.byCurrency.map((c) => <tr key={c.currency} className="border-t border-border"><td className="py-1 font-medium">{c.currency}</td><td>{money(c.outstanding)}</td><td>{money(c.overdue)}</td><td>{money(c.dueToday)}</td><td>{money(c.dueSoon)}</td><td>{money(c.collected)}</td></tr>)}
              </tbody>
            </table>
            {!o.byCurrency.length && <HelperText className="mt-1">No receivables yet.</HelperText>}
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-4 text-sm">
              <SectionTitle className="text-base">Counts</SectionTitle>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge>{o.counts.open} open</Badge>
                <Badge variant="danger">{o.counts.overdue} overdue</Badge>
                <Badge variant="warning">{o.counts.dueToday} due today</Badge>
                <Badge variant="info">{o.counts.dueSoon} due soon</Badge>
                <Badge variant="warning">{o.counts.disputed} disputed</Badge>
                <Badge>{o.profitability.finalized} finalized · {o.profitability.inProgress} in progress</Badge>
              </div>
            </Card>
            <Card className="p-4 text-sm">
              <SectionTitle className="text-base">Payment reminders</SectionTitle>
              <HelperText className="mt-1">Suggestions only — drafts are copied and sent by you; ExportPro never emails buyers.</HelperText>
              <ul className="mt-2 flex flex-col gap-1.5">
                {(rem.data?.suggestions ?? []).slice(0, 6).map((s) => (
                  <li key={`${s.installmentId}-${s.kind}`} className="flex flex-wrap items-center gap-2">
                    <Badge variant={s.kind === "OVERDUE" ? "danger" : "warning"}>{words(s.kind)}</Badge>
                    <Link className="min-w-0 break-words text-primary hover:underline" href={`/finance/receivables/${s.receivableId}`}>{s.receivableNumber} · {s.buyer} · {money(s.amount, s.currency)}</Link>
                  </li>
                ))}
                {rem.data && !rem.data.suggestions.length && <li className="text-muted-foreground">Nothing due.</li>}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
