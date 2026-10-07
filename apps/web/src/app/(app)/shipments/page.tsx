"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Ship } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SHIPMENT_STATUSES, SHIPMENT_TRANSPORT_MODES } from "@exportpro/types";
import { shipmentsApi } from "@/lib/api/logistics";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { day, HEALTH, HealthBadge, label, LogisticsTabs, opts, SEVERITY, StatusBadge, useCan } from "@/components/logistics/shared";
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

export default function ShipmentsPage() {
  return (
    <RequirePermission permission="logistics.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Shipments />
      </Suspense>
    </RequirePermission>
  );
}

function Shipments() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const f = { status: params.get("status") ?? "", health: params.get("health") ?? "", mode: params.get("mode") ?? "", page: Number(params.get("page") ?? 1) };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  const ov = useQuery({ queryKey: ["logistics", "overview"], queryFn: shipmentsApi.overview });
  const list = useQuery({ queryKey: ["logistics", "shipments", { ...f, search: params.get("search") ?? "" }], queryFn: () => shipmentsApi.list({ ...f, search: params.get("search") ?? "", pageSize: 20 }) });
  const o = ov.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Shipments &amp; Logistics</PageTitle>
          <HelperText className="mt-1">Shipments created from accepted buyer POs. Tracking is entered manually or reported by your forwarder — ExportPro does not book freight, file customs or provide live carrier tracking.</HelperText>
        </div>
        {can("logistics.shipments.create") && (
          <Button asChild><Link href="/shipments/new"><Plus className="size-4" aria-hidden="true" />New shipment</Link></Button>
        )}
      </div>
      <LogisticsTabs />
      {o && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Shipment overview">
          {([["Active", o.active], ["Departing in 7 days", o.departingSoon], ["Arriving in 7 days", o.arrivingSoon], ["Delayed", o.delayed], ["Customs holds", o.customsHolds], ["Open exceptions", o.openExceptions]] as const).map(([k, v]) => (
            <li key={k}><Card className="p-3"><Caption>{k}</Caption><p className="text-xl font-semibold">{v}</p></Card></li>
          ))}
        </ul>
      )}
      {o && o.actions.length > 0 && (
        <Card className="p-4">
          <SectionTitle className="text-base">Needs attention</SectionTitle>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {o.actions.slice(0, 8).map((a, i) => (
              <li key={`${a.shipmentId}-${a.kind}-${i}`} className="flex flex-wrap items-center gap-2">
                <Badge variant={SEVERITY[a.severity]}>{label(a.severity)}</Badge>
                <Link className="min-w-0 break-words text-primary hover:underline" href={`/shipments/${a.shipmentId}`}>{a.shipmentNumber}: {a.title}</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <form onSubmit={(e) => { e.preventDefault(); set("search", search.trim()); }} role="search">
          <SearchInput aria-label="Search shipments" placeholder="Shipment, B/L, container, vessel, PO, buyer" value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => { setSearch(""); set("search", ""); }} />
        </form>
        <Select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)} options={[{ value: "", label: "All statuses" }, ...opts(SHIPMENT_STATUSES)]} />
        <Select aria-label="Health" value={f.health} onChange={(e) => set("health", e.target.value)} options={[{ value: "", label: "Any health" }, ...Object.entries(HEALTH).map(([value, h]) => ({ value, label: h.label }))]} />
        <Select aria-label="Mode" value={f.mode} onChange={(e) => set("mode", e.target.value)} options={[{ value: "", label: "All modes" }, ...opts(SHIPMENT_TRANSPORT_MODES)]} />
      </div>
      {list.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : list.isError || !list.data ? (
        <ErrorState title="Could not load shipments" message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState icon={Ship} title="No shipments yet" description="Create a shipment from an accepted buyer PO and a selected freight quote." action={can("logistics.shipments.create") ? <Button asChild size="sm"><Link href="/shipments/new">New shipment</Link></Button> : undefined} />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link className="font-medium text-primary hover:underline" href={`/shipments/${s.id}`}>{s.shipmentNumber}</Link>
                    <Caption className="block break-words">{s.buyer.name} · PO {s.purchaseOrder.poNumber} · {label(s.mode)}{s.shipmentType ? ` ${s.shipmentType}` : ""}</Caption>
                    <Caption className="block break-words">{s.route}{s.carrier ? ` · ${s.carrier}` : ""} · ETD {day(s.etd)} · ETA {day(s.eta)}</Caption>
                  </div>
                  <span className="flex flex-wrap gap-1">
                    <StatusBadge status={s.status} />
                    <HealthBadge health={s.health} />
                    {s.openExceptions > 0 && <Badge variant={s.criticalExceptions ? "danger" : "warning"}>{s.openExceptions} exception{s.openExceptions === 1 ? "" : "s"}</Badge>}
                  </span>
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
