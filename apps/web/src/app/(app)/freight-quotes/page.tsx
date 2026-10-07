"use client";

import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { FREIGHT_QUOTE_STATUSES } from "@exportpro/types";
import { freightApi } from "@/lib/api/logistics";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { FreightQuoteForm, FreightRequestDialog } from "@/components/logistics/freight";
import { CopyButton, day, LogisticsTabs, money, opts, QUOTE_STATUS, useCan } from "@/components/logistics/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function FreightQuotesPage() {
  return (
    <RequirePermission permission="logistics.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <FreightQuotes />
      </Suspense>
    </RequirePermission>
  );
}

function FreightQuotes() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const poId = params.get("purchaseOrderId") ?? "";
  const f = { status: params.get("status") ?? "", search: params.get("search") ?? "", purchaseOrderId: poId, page: Number(params.get("page") ?? 1) };
  const [search, setSearch] = useState(f.search);
  const [picked, setPicked] = useState<string[]>([]);
  const [reqOpen, setReqOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  const q = useQuery({ queryKey: ["logistics", "quotes", f], queryFn: () => freightApi.list({ ...f, pageSize: 20 }) });
  const reqs = useQuery({ queryKey: ["logistics", "requests", poId], queryFn: () => freightApi.requests(poId || undefined) });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 5 ? p : [...p, id]));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Shipments &amp; Logistics</PageTitle>
          <HelperText className="mt-1">Freight quotes are rate offers from forwarders. Selecting a quote does not book freight — book with your forwarder and record the booking on the shipment.</HelperText>
        </div>
        {can("logistics.freight_quotes.create") && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setReqOpen(true)}>Request quotes</Button>
            <Button variant="outline" onClick={() => setEntryOpen(true)}>Enter quote</Button>
          </div>
        )}
      </div>
      <LogisticsTabs />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <form role="search" onSubmit={(e) => { e.preventDefault(); set("search", search.trim()); }}>
          <SearchInput aria-label="Search freight quotes" placeholder="Forwarder, reference, port, line" value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => { setSearch(""); set("search", ""); }} />
        </form>
        <Select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)} options={[{ value: "", label: "All statuses" }, ...opts(FREIGHT_QUOTE_STATUSES)]} />
        {poId && <Button variant="ghost" onClick={() => set("purchaseOrderId", "")}>Clear PO filter</Button>}
      </div>
      {picked.length > 0 && (
        <div role="status" className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2 text-sm shadow-sm">
          <span>{picked.length} selected for comparison (2–5)</span>
          <Button size="sm" disabled={picked.length < 2} onClick={() => router.push(`/freight-quotes/compare?ids=${picked.join(",")}`)}>Compare</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked([])}>Clear</Button>
        </div>
      )}
      {q.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : q.isError || !q.data ? (
        <ErrorState title="Could not load freight quotes" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data.items.length ? (
        <EmptyState icon={Receipt} title="No freight quotes yet" description="Request quotes from forwarders for an accepted PO, or enter a quote you received." />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {q.data.items.map((x) => {
              const priced = !!x.totalCost && !["REJECTED", "CANCELLED"].includes(x.status);
              return (
                <li key={x.id}>
                  <Card className="flex gap-3 p-3 text-sm">
                    <input type="checkbox" className="mt-1 size-4 shrink-0" aria-label={`Compare ${x.forwarderName}`} disabled={!priced} checked={picked.includes(x.id)} onChange={() => toggle(x.id)} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <Link className="font-medium text-primary hover:underline" href={`/freight-quotes/${x.id}`}>{x.forwarderName}{x.quoteReference ? ` · ${x.quoteReference}` : ""}</Link>
                        <Caption className="block break-words">{x.purchaseOrder ? `PO ${x.purchaseOrder.poNumber} · ` : ""}{x.routeSummary ?? ([x.portOfLoading, x.portOfDischarge].filter(Boolean).join(" → ") || "Route not stated")}</Caption>
                        <Caption className="block">{money(x.totalCost, x.currency)} · {x.transitDays != null ? `${x.transitDays} days` : "transit n/a"} · {x.direct === null ? "routing n/a" : x.direct ? "direct" : `via ${x.transshipmentPorts.join(", ")}`} · valid until {day(x.validityUntil)}</Caption>
                      </div>
                      <span className="flex flex-wrap gap-1">
                        <Badge variant={QUOTE_STATUS[x.status].variant}>{QUOTE_STATUS[x.status].label}</Badge>
                        {x.validity === "EXPIRING_SOON" && <Badge variant="warning">Expiring soon</Badge>}
                        {x.shipmentId && <Badge variant="info">Used by shipment</Badge>}
                      </span>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
          <Pagination meta={q.data.meta} onPageChange={(p) => set("page", String(p))} />
        </>
      )}
      {!!reqs.data?.length && (
        <Card className="p-4">
          <SectionTitle className="text-base">Freight requests</SectionTitle>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {reqs.data.slice(0, 10).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0"><span className="font-medium">{r.reference}</span> <Caption>{r.purchaseOrder ? `PO ${r.purchaseOrder.poNumber} · ` : ""}{r.quotes.length} forwarder{r.quotes.length === 1 ? "" : "s"} · {day(r.createdAt)}</Caption></div>
                <CopyButton text={r.rfqText} label="Copy request text" />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {reqOpen && <FreightRequestDialog open onOpenChange={setReqOpen} purchaseOrderId={poId || undefined} />}
      {entryOpen && <FreightQuoteForm open onOpenChange={setEntryOpen} purchaseOrderId={poId || undefined} onSaved={(x) => router.push(`/freight-quotes/${x.id}`)} />}
    </div>
  );
}
