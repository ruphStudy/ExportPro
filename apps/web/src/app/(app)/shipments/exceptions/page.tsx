"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SHIPMENT_EXCEPTION_TYPES } from "@exportpro/types";
import { shipmentsApi } from "@/lib/api/logistics";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { ReasonDialog } from "@/components/commercial/shared";
import { dateTime, label, LogisticsTabs, opts, SEVERITY, SOURCE_LABEL, useCan, useLogisticsMutation } from "@/components/logistics/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function ShipmentExceptionsPage() {
  return (
    <RequirePermission permission="logistics.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Exceptions />
      </Suspense>
    </RequirePermission>
  );
}

function Exceptions() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f = { status: params.get("status") ?? "OPEN", severity: params.get("severity") ?? "", type: params.get("type") ?? "", page: Number(params.get("page") ?? 1) };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    p.set(k, v);
    if (k !== "page") p.delete("page");
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const q = useQuery({ queryKey: ["logistics", "exceptions", f], queryFn: () => shipmentsApi.exceptions({ ...f, pageSize: 20 }) });
  const [resolve, setResolve] = useState<string | null>(null);
  const res = useLogisticsMutation((r: string) => shipmentsApi.resolveException(resolve!, r), "Exception resolved", () => setResolve(null));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Shipments &amp; Logistics</PageTitle>
        <HelperText className="mt-1">Delays, holds and incidents across shipments. Delays are derived from recorded ETA/ETD changes; holds and incidents are recorded by your team.</HelperText>
      </div>
      <LogisticsTabs />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)} options={[{ value: "OPEN", label: "Open" }, { value: "RESOLVED", label: "Resolved" }, { value: "ALL", label: "All" }]} />
        <Select aria-label="Severity" value={f.severity} onChange={(e) => set("severity", e.target.value)} options={[{ value: "", label: "Any severity" }, ...opts(["CRITICAL", "WARNING", "INFO"])]} />
        <Select aria-label="Type" value={f.type} onChange={(e) => set("type", e.target.value)} options={[{ value: "", label: "All types" }, ...opts(SHIPMENT_EXCEPTION_TYPES)]} />
      </div>
      {q.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : q.isError || !q.data ? (
        <ErrorState title="Could not load exceptions" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data.items.length ? (
        <EmptyState icon={ShieldCheck} title="No exceptions" description="Nothing matches these filters." />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {q.data.items.map((e) => (
              <li key={e.id}>
                <Card className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={SEVERITY[e.severity]}>{label(e.severity)}</Badge>
                      <Badge variant={e.status === "OPEN" ? "warning" : "success"}>{label(e.status)}</Badge>
                      <span className="min-w-0 break-words font-medium">{e.title}</span>
                    </div>
                    <Caption className="block break-words">{e.shipment ? <Link className="text-primary hover:underline" href={`/shipments/${e.shipment.id}?tab=exceptions`}>{e.shipment.shipmentNumber}</Link> : null} · {label(e.type)} · {SOURCE_LABEL[e.source]} · {dateTime(e.detectedAt)}</Caption>
                    {e.resolution && <Caption className="block break-words">Resolved: {e.resolution.text}</Caption>}
                  </div>
                  {e.status === "OPEN" && can("logistics.exceptions.manage") && <Button size="sm" variant="outline" onClick={() => setResolve(e.id)}>Resolve</Button>}
                </Card>
              </li>
            ))}
          </ul>
          <Pagination meta={q.data.meta} onPageChange={(p) => set("page", String(p))} />
        </>
      )}
      <ReasonDialog open={!!resolve} onOpenChange={(o) => !o && setResolve(null)} title="Resolve exception" label="Resolution" confirmLabel="Resolve" loading={res.isPending} onConfirm={(r) => res.mutate(r)} />
    </div>
  );
}
