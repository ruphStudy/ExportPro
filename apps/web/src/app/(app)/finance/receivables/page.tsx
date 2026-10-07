"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RECEIVABLE_STATUSES } from "@exportpro/types";
import { financeApi, receivablesApi } from "@/lib/api/finance";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { day, FinanceTabs, money, NOT_ACCOUNTING, RECEIVABLE_STATUS, ReceivableBadge, useCan, words } from "@/components/finance/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function ReceivablesPage() {
  return (
    <RequirePermission permission="finance.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Receivables />
      </Suspense>
    </RequirePermission>
  );
}

function Receivables() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const g = (k: string) => params.get(k) ?? "";
  const f = { status: g("status"), currency: g("currency"), country: g("country"), from: g("from"), to: g("to"), search: g("search"), buyerCompanyId: g("buyerCompanyId"), page: Number(g("page") || 1) };
  const [search, setSearch] = useState(f.search);
  const [groupBy, setGroupBy] = useState("buyer");
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  const list = useQuery({ queryKey: ["finance", "receivables", f], queryFn: () => receivablesApi.list({ ...f, pageSize: 20 }) });
  const ov = useQuery({ queryKey: ["finance", "overview", "tiles"], queryFn: () => financeApi.overview({ range: "month" }) });
  const aging = useQuery({ queryKey: ["finance", "aging", groupBy], queryFn: () => financeApi.aging(groupBy) });
  const o = ov.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Finance &amp; Profitability</PageTitle>
          <HelperText className="mt-1">{NOT_ACCOUNTING}</HelperText>
        </div>
        {can("receivables.manage") && <Button asChild><Link href="/finance/receivables/new"><Plus className="size-4" aria-hidden="true" />New receivable</Link></Button>}
      </div>
      <FinanceTabs />
      {o && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Receivable totals">
          {([
            ["Total receivable", o.byCurrency.map((c) => money(c.total, c.currency)).join(" · ") || "—"],
            ["Due soon", o.byCurrency.map((c) => money(c.dueSoon, c.currency)).join(" · ") || "—"],
            ["Due today", o.byCurrency.map((c) => money(c.dueToday, c.currency)).join(" · ") || "—"],
            ["Overdue", o.byCurrency.map((c) => money(c.overdue, c.currency)).join(" · ") || "—"],
            ["Paid this month", o.byCurrency.map((c) => money(c.collected, c.currency)).join(" · ") || "—"],
            ["Outstanding", o.byCurrency.map((c) => money(c.outstanding, c.currency)).join(" · ") || "—"],
          ] as const).map(([k, v]) => <li key={k}><Card className="h-full p-3"><Caption>{k}</Caption><p className="break-words text-sm font-semibold">{v}</p></Card></li>)}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <form role="search" className="lg:col-span-2" onSubmit={(e) => { e.preventDefault(); set("search", search.trim()); }}>
          <SearchInput aria-label="Search receivables" placeholder="Receivable, buyer, PO, shipment, invoice" value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => { setSearch(""); set("search", ""); }} />
        </form>
        <Select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)} options={[{ value: "", label: "All statuses" }, { value: "OPEN", label: "All open" }, ...RECEIVABLE_STATUSES.map((s) => ({ value: s, label: RECEIVABLE_STATUS[s].label }))]} />
        <Input aria-label="Currency" placeholder="Currency (USD)" maxLength={3} value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
        <Input aria-label="Destination country" placeholder="Country (AE)" maxLength={2} value={f.country} onChange={(e) => set("country", e.target.value.toUpperCase())} />
        <div className="flex gap-2"><Input type="date" aria-label="Created from" value={f.from} onChange={(e) => set("from", e.target.value)} /><Input type="date" aria-label="Created to" value={f.to} onChange={(e) => set("to", e.target.value)} /></div>
      </div>
      {list.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : list.isError || !list.data ? (
        <ErrorState title="Could not load receivables" message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState icon={Wallet} title="No receivables" description="Create a receivable from an accepted buyer PO; the agreed payment terms become the schedule." />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link className="font-medium text-primary hover:underline" href={`/finance/receivables/${r.id}`}>{r.receivableNumber}</Link>
                    <Caption className="block break-words">{r.buyer.name} · PO {r.purchaseOrder.poNumber}{r.shipment ? ` · ${r.shipment.shipmentNumber}` : ""}{r.commercialInvoice?.number ? ` · CI ${r.commercialInvoice.number}` : ""} · {words(r.paymentTermsType)}</Caption>
                    <Caption className="block">Total {money(r.totalAmount, r.currency)} · received {money(r.receivedAmount)} · outstanding {money(r.outstandingAmount)} · next due {day(r.nextDueDate)}</Caption>
                  </div>
                  <span className="flex flex-wrap items-center gap-1"><ReceivableBadge status={r.status} />{r.daysOverdue ? <Caption>{r.daysOverdue} d overdue</Caption> : null}</span>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination meta={list.data.meta} onPageChange={(p) => set("page", String(p))} />
        </>
      )}
      <Card className="overflow-x-auto p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Payment aging</SectionTitle>
          <Select aria-label="Group aging by" containerClassName="w-40" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} options={[{ value: "buyer", label: "By buyer" }, { value: "currency", label: "By currency" }, { value: "country", label: "By country" }]} />
        </div>
        <Caption className="mt-1 block">Amounts stay in their own currency — never summed across currencies.</Caption>
        {aging.data && (aging.data.length ? (
          <table className="mt-2 w-full min-w-[600px] text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1">Group</th><th>Cur.</th><th>Current</th><th>1–30</th><th>31–60</th><th>61–90</th><th>90+</th><th>Total</th></tr></thead>
            <tbody>{aging.data.map((r) => <tr key={`${r.key}-${r.currency}`} className="border-t border-border"><td className="py-1">{r.label}</td><td>{r.currency}</td><td>{money(r.current)}</td><td>{money(r.d1_30)}</td><td>{money(r.d31_60)}</td><td>{money(r.d61_90)}</td><td>{money(r.d90plus)}</td><td className="font-medium">{money(r.total)}</td></tr>)}</tbody>
          </table>
        ) : <HelperText className="mt-1">Nothing outstanding.</HelperText>)}
      </Card>
    </div>
  );
}
