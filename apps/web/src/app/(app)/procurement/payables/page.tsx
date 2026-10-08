"use client";

import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { procurementApi } from "@/lib/api/procurement";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { day, money, NOT_ACCOUNTING_PROC, PayBadge, ProcurementTabs, words } from "@/components/procurement/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function PayablesPage() {
  return (
    <RequirePermission permission="supplier_payments.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Payables />
      </Suspense>
    </RequirePermission>
  );
}

const STATUSES = ["NOT_DUE", "DUE_SOON", "DUE", "PARTIALLY_PAID", "OVERDUE", "PAID", "CANCELLED"];

function Payables() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const g = (k: string) => params.get(k) ?? "";
  const f = { status: g("status"), search: g("search"), page: Number(g("page") || 1) };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  const list = useQuery({ queryKey: ["procurement", "payables", f], queryFn: () => procurementApi.payables({ ...f, pageSize: 20 }) });
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Procurement</PageTitle>
        <HelperText className="mt-1">What you owe suppliers, from issued supplier POs and their agreed payment schedules. {NOT_ACCOUNTING_PROC}</HelperText>
      </div>
      <ProcurementTabs />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input aria-label="Search payables" placeholder="Supplier or SPO number" defaultValue={f.search} onKeyDown={(e) => e.key === "Enter" && set("search", (e.target as HTMLInputElement).value.trim())} />
        <Select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)} options={[{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: words(s) }))]} />
      </div>
      {list.isLoading ? <Skeleton className="h-48 w-full" /> : list.isError || !list.data ? (
        <ErrorState title="Could not load supplier payables" message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState icon={Wallet} title="No supplier payables" description="A payable is created when a supplier PO is issued." />
      ) : (
        <>
          <ul className="flex flex-col gap-2" aria-label="Supplier payables">
            {list.data.items.map((p) => (
              <li key={p.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <Link className="font-medium text-primary hover:underline" href={`/procurement/orders/${p.supplierPo.id}`}>{p.supplierPo.spoNumber}</Link> <span className="break-words">{p.supplier.legalName}</span>
                    <Caption className="block">Outstanding {money(p.outstanding, p.currency)} of {money(p.total, p.currency)} · next due {day(p.nextDueDate)}</Caption>
                  </div>
                  <PayBadge status={p.status} />
                </Card>
              </li>
            ))}
          </ul>
          <Pagination meta={list.data.meta} onPageChange={(p) => set("page", String(p))} />
        </>
      )}
    </div>
  );
}
