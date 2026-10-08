"use client";

import { useQuery } from "@tanstack/react-query";
import { Factory, Plus, Star } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SUPPLIER_TYPES } from "@exportpro/types";
import { procurementApi } from "@/lib/api/procurement";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { AddSupplier } from "@/components/procurement/add-supplier";
import { CertBadge, money, ProcurementTabs, ProvenanceBadges, useCan, useProcMutation, words } from "@/components/procurement/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function SuppliersPage() {
  return (
    <RequirePermission permission="suppliers.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Suppliers />
      </Suspense>
    </RequirePermission>
  );
}

const KEYS = ["search", "product", "productId", "state", "supplierType", "certifications", "maxMoq", "moqUnit", "minCapacity", "maxPrice", "priceCurrency", "maxLeadTimeDays", "quantity", "unit", "shortlisted", "buyerPurchaseOrderId", "opportunityId", "page"] as const;

function Suppliers() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f = Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? ""])) as Record<(typeof KEYS)[number], string>;
  const [draft, setDraft] = useState(f);
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const apply = (next: Partial<typeof f>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...next, page: next.page ?? "" })) if (v) p.set(k, v);
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  const query = Object.fromEntries(Object.entries(f).filter(([k]) => k !== "buyerPurchaseOrderId" && k !== "opportunityId"));
  const list = useQuery({ queryKey: ["procurement", "suppliers", f], queryFn: () => procurementApi.suppliers({ ...query, page: f.page || 1, pageSize: 20 }) });
  const shortlist = useProcMutation(({ id, remove }: { id: string; remove: boolean }) => procurementApi.shortlist(id, { product: f.product || undefined, remove }), undefined);
  const rfqHref = () => {
    const p = new URLSearchParams({ new: "1" });
    if (picked.length) p.set("supplierIds", picked.join(","));
    for (const k of ["product", "productId", "buyerPurchaseOrderId", "opportunityId", "quantity", "unit"] as const) if (f[k]) p.set(k, f[k]);
    return `/procurement/rfqs?${p}`;
  };
  const r = list.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Procurement</PageTitle>
          <HelperText className="mt-1">Supplier discovery from your own supplier master. Every supplier shows where it came from and whether anything was verified.</HelperText>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("supplier_rfq.manage") && <Button asChild variant="secondary"><Link href={rfqHref()}>{picked.length ? `Create RFQ (${picked.length})` : "Create RFQ"}</Link></Button>}
          {can("suppliers.manage") && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" />Add supplier</Button>}
        </div>
      </div>
      <ProcurementTabs />
      {(f.buyerPurchaseOrderId || f.opportunityId) && <Caption>Finding suppliers for {f.buyerPurchaseOrderId ? "a buyer PO" : "an opportunity"}{f.product ? ` — ${f.product}` : ""}. Select suppliers and create an RFQ.</Caption>}
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
        aria-label="Supplier filters"
      >
        <Input label="Search" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder="Name, GSTIN, city" />
        <Input label="Product" value={draft.product} onChange={(e) => setDraft({ ...draft, product: e.target.value, productId: "" })} placeholder="e.g. cumin seeds" />
        <Input label="State" value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} placeholder="e.g. Gujarat" />
        <Select label="Supplier type" value={draft.supplierType} onChange={(e) => setDraft({ ...draft, supplierType: e.target.value })} options={[{ value: "", label: "Any type" }, ...SUPPLIER_TYPES.map((t) => ({ value: t, label: words(t) }))]} />
        <Input label="Certifications (comma separated)" value={draft.certifications} onChange={(e) => setDraft({ ...draft, certifications: e.target.value })} placeholder="FSSAI, ISO 22000" />
        <div className="flex gap-2">
          <Input label="Max MOQ" inputMode="decimal" containerClassName="flex-1" value={draft.maxMoq} onChange={(e) => setDraft({ ...draft, maxMoq: e.target.value })} />
          <Select label="Unit" containerClassName="w-24" value={draft.moqUnit || "MT"} onChange={(e) => setDraft({ ...draft, moqUnit: e.target.value })} options={["MT", "KG"].map((u) => ({ value: u, label: u }))} />
        </div>
        <Input label="Max lead time (days)" inputMode="numeric" value={draft.maxLeadTimeDays} onChange={(e) => setDraft({ ...draft, maxLeadTimeDays: e.target.value })} />
        <div className="flex gap-2">
          <Input label="Required quantity (fit)" inputMode="decimal" containerClassName="flex-1" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} />
          <Select label="Unit" containerClassName="w-24" value={draft.unit || "MT"} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} options={["MT", "KG"].map((u) => ({ value: u, label: u }))} />
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">Apply filters</Button>
          <Button type="button" variant="ghost" onClick={() => { setDraft(Object.fromEntries(KEYS.map((k) => [k, ""])) as typeof f); apply(Object.fromEntries(KEYS.map((k) => [k, ""])) as typeof f); }}>Clear</Button>
          <Button type="button" variant={f.shortlisted ? "secondary" : "ghost"} aria-pressed={Boolean(f.shortlisted)} onClick={() => apply({ shortlisted: f.shortlisted ? "" : "true" })}>
            <Star className="size-4" aria-hidden="true" />Shortlisted only
          </Button>
        </div>
      </form>
      {r && (
        <ul className="flex flex-wrap gap-2 text-xs" aria-label="Supplier sources">
          {r.sources.map((s) => <li key={s.name}><Badge variant={s.status === "OK" ? "success" : "neutral"} title={s.note}>{s.name}: {s.status === "OK" ? "searched" : words(s.status).toLowerCase()}</Badge></li>)}
        </ul>
      )}
      {list.isLoading ? <Skeleton className="h-48 w-full" /> : list.isError || !r ? (
        <ErrorState title="Could not load suppliers" message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !r.items.length ? (
        <EmptyState icon={Factory} title="No matching suppliers" description="Only suppliers in your supplier master are shown — none are invented. External directories are not configured. Add suppliers you work with." action={can("suppliers.manage") ? <Button onClick={() => setAdding(true)}>Add supplier</Button> : undefined} />
      ) : (
        <>
          <ul className="flex flex-col gap-3" aria-label="Suppliers">
            {r.items.map((s) => {
              const prod = s.products.find((p) => !f.product || p.productName.toLowerCase().includes(f.product.toLowerCase())) ?? s.products[0];
              return (
                <li key={s.id}>
                  <Card className="flex flex-col gap-2 p-4 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        {can("supplier_rfq.manage") && <Checkbox aria-label={`Select ${s.legalName} for RFQ`} checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />}
                        <div className="min-w-0">
                          <Link href={`/procurement/suppliers/${s.id}`} className="break-words font-medium text-primary hover:underline">{s.legalName}</Link>
                          <p className="text-muted-foreground">{[s.supplierType && words(s.supplierType), [s.city, s.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "—"}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ProvenanceBadges p={s.provenance} />
                        {can("suppliers.manage") && (
                          <Button size="sm" variant="ghost" aria-pressed={s.shortlisted} aria-label={s.shortlisted ? `Remove ${s.legalName} from shortlist` : `Shortlist ${s.legalName}`} onClick={() => shortlist.mutate({ id: s.id, remove: s.shortlisted })}>
                            <Star className={`size-4 ${s.shortlisted ? "fill-current" : ""}`} aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {prod && (
                      <p className="break-words">
                        {prod.productName} · MOQ {prod.moq ? `${prod.moq} ${prod.moqUnit ?? ""}` : "not stated"} · capacity {prod.capacity ? `${prod.capacity} ${prod.capacityUnit ?? ""}/${(prod.capacityPeriod ?? "month").toLowerCase()}` : "not stated"} · lead time {prod.leadTimeDays !== null ? `${prod.leadTimeDays} days` : "not stated"}
                        {prod.indicativePrice !== null && ` · indicative ${money(prod.indicativePrice, prod.currency)}${prod.priceUnit ? `/${prod.priceUnit}` : ""}`}
                      </p>
                    )}
                    {s.certifications.length > 0 && <div className="flex flex-wrap gap-1">{s.certifications.map((c) => <span key={c.type} className="inline-flex items-center gap-1"><Badge variant={c.expired ? "danger" : "neutral"}>{c.type}{c.expired ? " (expired)" : ""}</Badge><CertBadge v={c.verification} /></span>)}</div>}
                    {s.fit && (
                      <details>
                        <summary className="cursor-pointer">Fit {s.fit.score}/100 · confidence {s.fit.confidencePercent}%</summary>
                        <ul className="mt-1 list-disc pl-5 text-muted-foreground">{s.fit.factors.map((x) => <li key={x.factor}>{x.factor}: {x.points}/{x.max} — {x.explanation}</li>)}</ul>
                      </details>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
          <Pagination meta={r.meta} onPageChange={(p) => apply({ page: String(p) })} />
        </>
      )}
      <AddSupplier open={adding} onOpenChange={setAdding} defaultProduct={f.product} defaultProductId={f.productId} onCreated={(id) => router.push(`/procurement/suppliers/${id}`)} />
    </div>
  );
}
