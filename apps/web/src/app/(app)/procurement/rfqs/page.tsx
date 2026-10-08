"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SUPPLIER_RFQ_STATUSES, type ProcurementRequirement } from "@exportpro/types";
import { procurementApi } from "@/lib/api/procurement";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { day, ProcurementTabs, RfqBadge, useCan, useProcMutation, words } from "@/components/procurement/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function RfqsPage() {
  return (
    <RequirePermission permission="supplier_rfq.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Rfqs />
      </Suspense>
    </RequirePermission>
  );
}

function Rfqs() {
  const can = useCan();
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
  const list = useQuery({ queryKey: ["procurement", "rfqs", f], queryFn: () => procurementApi.rfqs({ ...f, pageSize: 20 }) });
  const creating = g("new") === "1" && can("supplier_rfq.manage");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Procurement</PageTitle>
          <HelperText className="mt-1">Supplier RFQs and quotes — separate from buyer inquiries and quotations.</HelperText>
        </div>
        {can("supplier_rfq.manage") && !creating && <Button onClick={() => set("new", "1")}><Plus className="size-4" aria-hidden="true" />New supplier RFQ</Button>}
      </div>
      <ProcurementTabs />
      {creating && <CreateRfq onDone={(id) => router.push(`/procurement/rfqs/${id}`)} onCancel={() => set("new", "")} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input aria-label="Search RFQs" placeholder="RFQ number or product" defaultValue={f.search} onKeyDown={(e) => e.key === "Enter" && set("search", (e.target as HTMLInputElement).value.trim())} />
        <Select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)} options={[{ value: "", label: "All statuses" }, ...SUPPLIER_RFQ_STATUSES.map((s) => ({ value: s, label: words(s) }))]} />
      </div>
      {list.isLoading ? <Skeleton className="h-48 w-full" /> : list.isError || !list.data ? (
        <ErrorState title="Could not load supplier RFQs" message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState icon={ClipboardList} title="No supplier RFQs" description="Find suppliers for a product or buyer PO, then request quotes." />
      ) : (
        <>
          <ul className="flex flex-col gap-2" aria-label="Supplier RFQs">
            {list.data.items.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <Link className="font-medium text-primary hover:underline" href={`/procurement/rfqs/${r.id}`}>{r.rfqNumber}</Link> <span className="break-words">{r.productName} · {r.quantity} {r.unit}</span>
                    <Caption className="block">{r.suppliersRequested} supplier(s) · {r.quotesReceived} quote(s) · quotes due {day(r.quoteDueDate)}{r.buyerPurchaseOrder ? ` · buyer PO ${r.buyerPurchaseOrder.poNumber}` : ""}{r.selectedSupplier ? ` · selected ${r.selectedSupplier.legalName}` : ""}</Caption>
                  </div>
                  <RfqBadge status={r.status} />
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

function CreateRfq(props: { onDone: (id: string) => void; onCancel: () => void }) {
  const params = useSearchParams();
  const buyerPoId = params.get("buyerPurchaseOrderId") ?? "";
  const req = useQuery({ queryKey: ["procurement", "requirement", buyerPoId], queryFn: () => procurementApi.requirement(buyerPoId), enabled: Boolean(buyerPoId) });
  if (buyerPoId && req.isLoading) return <Skeleton className="h-40 w-full" />;
  return <CreateRfqForm {...props} buyerPoId={buyerPoId} req={req.data ?? null} />;
}

function CreateRfqForm({ onDone, onCancel, buyerPoId, req: reqData }: { onDone: (id: string) => void; onCancel: () => void; buyerPoId: string; req: ProcurementRequirement | null }) {
  const params = useSearchParams();
  const g = (k: string) => params.get(k) ?? "";
  const it = reqData?.items[0];
  const [v, setV] = useState({ productId: it?.productId ?? g("productId"), productName: it?.productName ?? g("product"), specification: it?.specification ?? "", quantity: it?.quantity ?? g("quantity"), unit: it?.unit ?? (g("unit") || "MT"), wastagePercent: "", requiredBy: "", quoteDueDate: "", deliveryLocation: "", packaging: it?.packaging ?? "", qualityRequirements: "", certificationsRequired: "", paymentTermsRequested: "", notes: "" });
  const [ids, setIds] = useState<string[]>(g("supplierIds").split(",").filter(Boolean));
  const req = { data: reqData };
  const sups = useQuery({ queryKey: ["procurement", "suppliers", "pick", v.productId, v.productName], queryFn: () => procurementApi.suppliers({ productId: v.productId || undefined, product: v.productId ? undefined : v.productName || undefined, pageSize: 50 }) });
  const save = useProcMutation(
    () =>
      procurementApi.createRfq({
        productId: v.productId || null,
        productName: v.productName.trim(),
        specification: v.specification || null,
        quantity: v.quantity,
        unit: v.unit,
        wastagePercent: v.wastagePercent || null,
        requiredBy: v.requiredBy || null,
        quoteDueDate: v.quoteDueDate || null,
        deliveryLocation: v.deliveryLocation || null,
        packaging: v.packaging || null,
        qualityRequirements: v.qualityRequirements || null,
        certificationsRequired: v.certificationsRequired.split(",").map((x) => x.trim()).filter(Boolean),
        paymentTermsRequested: v.paymentTermsRequested || null,
        notes: v.notes || null,
        buyerPurchaseOrderId: buyerPoId || undefined,
        opportunityId: g("opportunityId") || undefined,
        supplierIds: ids,
      }),
    "Supplier RFQ created",
    (r) => onDone(r.id),
  );
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const total = v.quantity && v.wastagePercent ? (Number(v.quantity) * (1 + Number(v.wastagePercent) / 100)).toFixed(4).replace(/\.?0+$/, "") : null;
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">New supplier RFQ{req.data ? ` for buyer PO ${req.data.buyerPurchaseOrder.poNumber}` : ""}</SectionTitle>
      {req.data && req.data.existingRfqs.length > 0 && <Caption className="block">Existing RFQs for this PO: {req.data.existingRfqs.map((r) => r.rfqNumber).join(", ")}</Caption>}
      <form className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <Input label="Product" required value={v.productName} onChange={set("productName")} />
        <div className="flex gap-2">
          <Input label="Quantity" required inputMode="decimal" containerClassName="flex-1" value={v.quantity} onChange={set("quantity")} />
          <Select label="Unit" containerClassName="w-24" value={v.unit} onChange={set("unit")} options={["MT", "KG", "BAG", "PCS"].map((u) => ({ value: u, label: u }))} />
        </div>
        <Input label="Wastage / buffer % (optional)" inputMode="decimal" value={v.wastagePercent} onChange={set("wastagePercent")} description={total ? `Requested quantity: ${total} ${v.unit}` : "Only applied if you enter it."} />
        <Input label="Delivery location" value={v.deliveryLocation} onChange={set("deliveryLocation")} />
        <Input label="Required by" type="date" value={v.requiredBy} onChange={set("requiredBy")} />
        <Input label="Quotes due" type="date" value={v.quoteDueDate} onChange={set("quoteDueDate")} />
        <Input label="Certifications required" placeholder="FSSAI, ISO 22000" value={v.certificationsRequired} onChange={set("certificationsRequired")} />
        <Input label="Payment terms requested" value={v.paymentTermsRequested} onChange={set("paymentTermsRequested")} />
        <Textarea label="Specification" containerClassName="sm:col-span-2" rows={2} value={v.specification} onChange={set("specification")} />
        <Textarea label="Quality requirements" containerClassName="sm:col-span-2" rows={2} value={v.qualityRequirements} onChange={set("qualityRequirements")} />
        <fieldset className="sm:col-span-2 lg:col-span-4">
          <legend className="text-sm font-medium">Suppliers to invite</legend>
          {sups.isLoading ? <Skeleton className="mt-2 h-10 w-full" /> : (
            <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {(sups.data?.items ?? []).map((s) => <li key={s.id}><Checkbox label={`${s.legalName}${s.state ? ` (${s.state})` : ""}`} checked={ids.includes(s.id)} onChange={(e) => setIds(e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))} /></li>)}
              {!sups.data?.items.length && <li className="text-sm text-muted-foreground">No suppliers for this product yet — add them under Suppliers.</li>}
            </ul>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={save.isPending || v.productName.trim().length < 2 || !v.quantity}>Create RFQ</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
