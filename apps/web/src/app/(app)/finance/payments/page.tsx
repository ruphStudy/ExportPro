"use client";

import { useQuery } from "@tanstack/react-query";
import { Banknote } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { financeApi } from "@/lib/api/finance";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { day, FinanceTabs, money, NOT_ACCOUNTING, RangePicker, words } from "@/components/finance/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function PaymentsPage() {
  return (
    <RequirePermission permission="finance.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Payments />
      </Suspense>
    </RequirePermission>
  );
}

function Payments() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f = { range: params.get("range") ?? "month", from: params.get("from") ?? "", to: params.get("to") ?? "", page: Number(params.get("page") ?? 1) };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const q = useQuery({ queryKey: ["finance", "payments", f], queryFn: () => financeApi.payments({ ...(f.range === "custom" ? { from: f.from, to: f.to } : { range: f.range }), page: f.page }) });
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Finance &amp; Profitability</PageTitle>
        <HelperText className="mt-1">{NOT_ACCOUNTING}</HelperText>
      </div>
      <FinanceTabs />
      <RangePicker range={f.range} from={f.from} to={f.to} onChange={set} />
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError || !q.data ? (
        <ErrorState title="Could not load payments" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data.items.length ? (
        <EmptyState icon={Banknote} title="No payments in this period" description="Payments are recorded on a receivable as money is actually received." />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {q.data.items.map((p) => (
              <li key={p.id}>
                <Card className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <span className="font-medium">{money(p.amount, p.currency)}</span> <Caption>{day(p.receivedAt)} · {words(p.paymentMethod)}{p.bankReference ? ` · ref ${p.bankReference}` : ""}</Caption>
                    <Caption className="block break-words"><Link className="text-primary hover:underline" href={`/finance/receivables/${p.receivable.id}`}>{p.receivable.receivableNumber}</Link> · {p.buyer} · applied {money(p.appliedAmount, p.receivable.currency)}{p.charges.length ? ` · charges ${p.charges.map((c) => money(c.amount, c.currency)).join(", ")}` : ""}</Caption>
                  </div>
                  <span className="flex gap-1">{p.status === "REVERSED" ? <Badge variant="danger">Reversed</Badge> : <Badge variant="success">Recorded</Badge>}{p.fxGainLoss && <Badge>FX {money(p.fxGainLoss)}</Badge>}</span>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination meta={q.data.meta} onPageChange={(p) => set("page", String(p))} />
        </>
      )}
    </div>
  );
}
