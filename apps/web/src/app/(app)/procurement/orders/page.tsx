"use client";

import { useQuery } from "@tanstack/react-query";
import { PackageCheck, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SUPPLIER_PO_STATUSES } from "@exportpro/types";
import { procurementApi } from "@/lib/api/procurement";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { scheduleBody, ScheduleEditor, type ScheduleRow } from "@/components/procurement/schedule-editor";
import { day, money, PayBadge, PoBadge, ProcBadge, ProcurementTabs, QualityBadge, useCan, useProcMutation, words } from "@/components/procurement/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function OrdersPage() {
  return (
    <RequirePermission permission="procurement.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Orders />
      </Suspense>
    </RequirePermission>
  );
}

function Orders() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const g = (k: string) => params.get(k) ?? "";
  const f = { status: g("status"), search: g("search"), overdue: g("overdue"), supplierId: g("supplierId"), buyerPurchaseOrderId: g("buyerPurchaseOrderId"), shipmentId: g("shipmentId"), page: Number(g("page") || 1) };
  const [creating, setCreating] = useState(false);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  const list = useQuery({ queryKey: ["procurement", "orders", f], queryFn: () => procurementApi.orders({ ...f, pageSize: 20 }) });
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Procurement</PageTitle>
          <HelperText className="mt-1">Supplier purchase orders — what you buy from suppliers. Buyer POs stay under Quotes &amp; Orders.</HelperText>
        </div>
        {can("procurement.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New supplier PO</Button>}
      </div>
      <ProcurementTabs />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input aria-label="Search supplier POs" placeholder="SPO number or product" defaultValue={f.search} onKeyDown={(e) => e.key === "Enter" && set("search", (e.target as HTMLInputElement).value.trim())} />
        <Select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)} options={[{ value: "", label: "All statuses" }, ...SUPPLIER_PO_STATUSES.map((s) => ({ value: s, label: words(s) }))]} />
        <Button variant={f.overdue ? "secondary" : "ghost"} aria-pressed={Boolean(f.overdue)} onClick={() => set("overdue", f.overdue ? "" : "true")}>Delayed only</Button>
      </div>
      {list.isLoading ? <Skeleton className="h-48 w-full" /> : list.isError || !list.data ? (
        <ErrorState title="Could not load supplier POs" message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState icon={PackageCheck} title="No supplier POs" description="Create one from a selected supplier quote, or manually." />
      ) : (
        <>
          <ul className="flex flex-col gap-2" aria-label="Supplier POs">
            {list.data.items.map((p) => (
              <li key={p.id}>
                <Card className="flex flex-col gap-2 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link className="font-medium text-primary hover:underline" href={`/procurement/orders/${p.id}`}>{p.spoNumber}{p.revision > 1 ? ` R${p.revision}` : ""}</Link> <span className="break-words">{p.supplier.legalName} · {p.productNames.join(", ")}</span>
                      <Caption className="block">Expected {day(p.expectedDate)}{p.delayDays ? ` (moved ${p.delayDays > 0 ? "+" : ""}${p.delayDays} d)` : ""}{p.buyerPurchaseOrder ? ` · buyer PO ${p.buyerPurchaseOrder.poNumber}` : ""}{p.total ? ` · ${money(p.total, p.currency)}` : ""}</Caption>
                    </div>
                    <div className="flex flex-wrap gap-1"><PoBadge status={p.status} /><ProcBadge status={p.procurementStatus} />{p.overdue && <Badge variant="danger">Delayed</Badge>}<QualityBadge status={p.qualityState} />{p.payable && <PayBadge status={p.payable.status} />}</div>
                  </div>
                  <div className="flex items-center gap-2"><Progress value={p.receivedPercent} label={`${p.receivedPercent}% received`} className="h-1.5 flex-1" /><Caption>{p.receivedPercent}% received</Caption></div>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination meta={list.data.meta} onPageChange={(p) => set("page", String(p))} />
        </>
      )}
      {creating && <ManualPo onClose={() => setCreating(false)} onDone={(id) => router.push(`/procurement/orders/${id}`)} />}
    </div>
  );
}

function ManualPo({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const sups = useQuery({ queryKey: ["procurement", "suppliers", "all"], queryFn: () => procurementApi.suppliers({ pageSize: 50 }) });
  const [v, setV] = useState({ supplierId: "", productName: "", quantity: "", unit: "KG", unitPrice: "", taxPercent: "", currency: "INR", expectedDate: "", deliveryLocation: "", paymentTerms: "" });
  const [sched, setSched] = useState<ScheduleRow[]>([{ label: "Advance", percentage: "30", trigger: "ADVANCE", dueDays: "" }, { label: "On delivery", percentage: "70", trigger: "ON_DELIVERY", dueDays: "" }]);
  const save = useProcMutation(
    () =>
      procurementApi.createOrder({
        supplierId: v.supplierId,
        currency: v.currency,
        items: [{ productName: v.productName, quantity: v.quantity, unit: v.unit, unitPrice: v.unitPrice, taxPercent: v.taxPercent || null }],
        expectedDate: v.expectedDate || null,
        deliveryLocation: v.deliveryLocation || null,
        paymentTerms: v.paymentTerms || null,
        paymentSchedule: scheduleBody(sched),
      }),
    "Supplier PO draft created",
    (r) => onDone(r.id),
  );
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="New supplier PO (manual)" description="Prefer creating it from a selected supplier quote so terms are traceable." className="max-w-2xl"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={save.isPending || !v.supplierId || !v.productName || !v.quantity || !v.unitPrice} onClick={() => save.mutate(undefined)}>Create draft</Button></div>}>
      <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
        <Select label="Supplier" required containerClassName="sm:col-span-2" value={v.supplierId} onChange={set("supplierId")} options={[{ value: "", label: "Choose supplier" }, ...(sups.data?.items ?? []).map((s) => ({ value: s.id, label: s.legalName }))]} />
        <Input label="Product" required value={v.productName} onChange={set("productName")} />
        <div className="flex gap-2">
          <Input label="Quantity" required inputMode="decimal" containerClassName="flex-1" value={v.quantity} onChange={set("quantity")} />
          <Select label="Unit" containerClassName="w-24" value={v.unit} onChange={set("unit")} options={["KG", "MT", "BAG", "PCS"].map((x) => ({ value: x, label: x }))} />
        </div>
        <div className="flex gap-2">
          <Input label="Unit price" required inputMode="decimal" containerClassName="flex-1" value={v.unitPrice} onChange={set("unitPrice")} />
          <Select label="Currency" containerClassName="w-24" value={v.currency} onChange={set("currency")} options={["INR", "USD", "EUR"].map((x) => ({ value: x, label: x }))} />
        </div>
        <Input label="GST %" inputMode="decimal" value={v.taxPercent} onChange={set("taxPercent")} />
        <Input label="Expected delivery" type="date" value={v.expectedDate} onChange={set("expectedDate")} />
        <Input label="Delivery location" value={v.deliveryLocation} onChange={set("deliveryLocation")} />
        <Input label="Payment terms (text)" containerClassName="sm:col-span-2" value={v.paymentTerms} onChange={set("paymentTerms")} />
        <div className="sm:col-span-2"><ScheduleEditor rows={sched} onChange={setSched} /></div>
      </div>
    </Modal>
  );
}
