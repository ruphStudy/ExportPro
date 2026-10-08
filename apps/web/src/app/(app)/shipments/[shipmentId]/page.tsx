"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { ShipmentDetail } from "@exportpro/types";
import { shipmentsApi } from "@/lib/api/logistics";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { ReasonDialog } from "@/components/commercial/shared";
import { day, HealthBadge, LogisticsTabs, money, SHIPMENT_STATUS, StatusBadge, useLogisticsMutation } from "@/components/logistics/shared";
import { ActivitySection, BuyerUpdatesSection, CargoSection, CostsSection, DocumentsSection, ExceptionsSection, OverviewSection, TimelineSection, TrackingSection } from "@/components/logistics/shipment-sections";
import { ShipmentFinanceCard } from "@/components/finance/entry-cards";
import { ShipmentProcurementCard } from "@/components/procurement/entry-cards";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, PageTitle } from "@/components/ui/typography";

const SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "timeline", label: "Timeline" },
  { key: "tracking", label: "Tracking" },
  { key: "cargo", label: "Cargo & containers" },
  { key: "documents", label: "Documents" },
  { key: "exceptions", label: "Exceptions & claims" },
  { key: "updates", label: "Buyer updates" },
  { key: "costs", label: "Costs" },
  { key: "activity", label: "Activity" },
] as const;

export default function ShipmentDetailPage() {
  return (
    <RequirePermission permission="logistics.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Detail />
      </Suspense>
    </RequirePermission>
  );
}

function Detail() {
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (params.get("tab") ?? "overview") as (typeof SECTIONS)[number]["key"];
  const q = useQuery({ queryKey: ["logistics", "shipment", shipmentId], queryFn: () => shipmentsApi.detail(shipmentId) });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState title="Shipment not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const s = q.data;
  const open = s.exceptions.filter((e) => e.status === "OPEN");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Shipments", href: "/shipments" }, { label: s.shipmentNumber }]} />
      <LogisticsTabs />
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <PageTitle className="break-words">{s.shipmentNumber}</PageTitle>
            <Caption className="block break-words">{s.buyer.name} · <Link className="text-primary hover:underline" href={`/purchase-orders/${s.purchaseOrder.id}`}>PO {s.purchaseOrder.poNumber}</Link>{s.freightQuote ? <> · <Link className="text-primary hover:underline" href={`/freight-quotes/${s.freightQuote.id}`}>{s.freightQuote.forwarderName} quote</Link> ({money(s.freightQuote.totalCost, s.freightQuote.currency)})</> : null}</Caption>
            <Caption className="block break-words">{s.route} · ETD {day(s.etd)} · ETA {day(s.eta)}{s.etaDelayDays ? ` (${s.etaDelayDays > 0 ? "+" : ""}${s.etaDelayDays} d vs original)` : ""}</Caption>
          </div>
          <HeaderActions s={s} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={s.status} />
          <HealthBadge health={s.health} />
          {open.length > 0 && <Badge variant={open.some((e) => e.severity === "CRITICAL") ? "danger" : "warning"}>{open.length} open exception{open.length === 1 ? "" : "s"}</Badge>}
          {!s.tracking.provider && <Badge>Manual tracking</Badge>}
        </div>
      </Card>
      <div role="tablist" aria-label="Shipment sections" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {SECTIONS.map((t) => (
          <Button key={t.key} role="tab" aria-selected={tab === t.key} size="sm" variant={tab === t.key ? "secondary" : "ghost"} onClick={() => router.replace(`${pathname}${t.key === "overview" ? "" : `?tab=${t.key}`}`, { scroll: false })}>
            {t.label}
          </Button>
        ))}
      </div>
      <div role="tabpanel" className="min-w-0">
        {tab === "overview" && <OverviewSection s={s} />}
        {tab === "timeline" && <TimelineSection s={s} />}
        {tab === "tracking" && <TrackingSection s={s} />}
        {tab === "cargo" && <CargoSection s={s} />}
        {tab === "documents" && <DocumentsSection s={s} />}
        {tab === "exceptions" && <ExceptionsSection s={s} />}
        {tab === "updates" && <BuyerUpdatesSection s={s} />}
        {tab === "costs" && <CostsSection s={s} />}
        {tab === "activity" && <ActivitySection s={s} />}
      </div>
      {(tab === "overview" || tab === "costs") && <ShipmentProcurementCard shipmentId={s.id} />}
      {(tab === "overview" || tab === "costs") && <ShipmentFinanceCard shipmentId={s.id} />}
    </div>
  );
}

function HeaderActions({ s }: { s: ShipmentDetail }) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancel = useLogisticsMutation((r: string) => shipmentsApi.cancel(s.id, r), "Shipment cancelled", () => setCancelOpen(false));
  const can = (a: string) => s.availableActions.includes(a);
  return (
    <div className="flex flex-wrap gap-2">
      {can("status") && s.allowedStatuses.length > 0 && <Button size="sm" onClick={() => setStatusOpen(true)}>Change status</Button>}
      {can("edit") && <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>Edit details</Button>}
      {can("cancel") && <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}>Cancel shipment</Button>}
      {statusOpen && <StatusDialog s={s} onClose={() => setStatusOpen(false)} />}
      {editOpen && <EditDialog s={s} onClose={() => setEditOpen(false)} />}
      <ReasonDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Cancel shipment" description="Only possible before departure. The record and its history are kept." confirmLabel="Cancel shipment" destructive loading={cancel.isPending} onConfirm={(r) => cancel.mutate(r)} />
    </div>
  );
}

function StatusDialog({ s, onClose }: { s: ShipmentDetail; onClose: () => void }) {
  const [status, setStatus] = useState<string>(s.allowedStatuses.filter((x) => x !== "CANCELLED")[0] ?? "");
  const [note, setNote] = useState("");
  const [booking, setBooking] = useState(s.bookingReference ?? "");
  // A booking is recorded as a forwarder-confirmed tracking event carrying the reference.
  const mut = useLogisticsMutation(
    () =>
      status === "BOOKED"
        ? shipmentsApi.track(s.id, { eventType: "BOOKED", eventTime: new Date().toISOString(), sourceReference: booking.trim(), source: "FORWARDER", description: note.trim() || undefined }).then((r) => r.shipment)
        : shipmentsApi.status(s.id, { expectedRowVersion: s.rowVersion, status, note: note.trim() || undefined }),
    "Status updated",
    onClose,
  );
  const needsNote = status === "ON_HOLD";
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Change shipment status" description="Lifecycle status is separate from health. Only valid transitions are offered." footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!status || mut.isPending || (needsNote && note.trim().length < 3) || (status === "BOOKED" && !booking.trim())} onClick={() => mut.mutate(undefined)}>Update</Button></div>}>
      <div className="flex flex-col gap-3">
        <Select label="New status" value={status} onChange={(e) => setStatus(e.target.value)} options={s.allowedStatuses.filter((x) => x !== "CANCELLED").map((x) => ({ value: x, label: SHIPMENT_STATUS[x].label }))} />
        {status === "BOOKED" && <Input label="Booking reference" required value={booking} onChange={(e) => setBooking(e.target.value)} description="Booking confirmed by the forwarder or carrier. ExportPro does not book freight." />}
        <Textarea label={needsNote ? "Reason" : "Note"} required={needsNote} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

function EditDialog({ s, onClose }: { s: ShipmentDetail; onClose: () => void }) {
  const [f, setF] = useState({ carrier: s.carrier ?? "", vesselName: s.vesselName ?? "", voyageNumber: s.voyageNumber ?? "", blNumber: s.blNumber ?? "", awbNumber: s.awbNumber ?? "", portOfLoading: s.portOfLoading ?? "", portOfDischarge: s.portOfDischarge ?? "", shippingBillNumber: s.customs.shippingBillNumber ?? "", customsBroker: s.customs.customsBroker ?? "", etd: s.etd?.slice(0, 10) ?? "", eta: s.eta?.slice(0, 10) ?? "", changeReason: "", notes: s.notes ?? "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const datesChanged = f.etd !== (s.etd?.slice(0, 10) ?? "") || f.eta !== (s.eta?.slice(0, 10) ?? "");
  const mut = useLogisticsMutation(() => {
    const b: Record<string, unknown> = { expectedRowVersion: s.rowVersion };
    for (const k of ["carrier", "vesselName", "voyageNumber", "blNumber", "awbNumber", "portOfLoading", "portOfDischarge", "shippingBillNumber", "customsBroker", "notes"] as const) b[k] = f[k].trim() || null;
    if (datesChanged) {
      b.etd = f.etd ? new Date(f.etd).toISOString() : null;
      b.eta = f.eta ? new Date(f.eta).toISOString() : null;
      b.changeReason = f.changeReason.trim() || undefined;
    }
    return shipmentsApi.update(s.id, b);
  }, "Shipment updated", onClose);
  return (
    <Modal className="max-w-2xl" open onOpenChange={(o) => !o && onClose()} title="Edit shipment details" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={mut.isPending} onClick={() => mut.mutate(undefined)}>Save</Button></div>}>
      <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
        <Input label="Carrier / line" value={f.carrier} onChange={set("carrier")} />
        <Input label="Vessel" value={f.vesselName} onChange={set("vesselName")} />
        <Input label="Voyage" value={f.voyageNumber} onChange={set("voyageNumber")} />
        <Input label="B/L number" value={f.blNumber} onChange={set("blNumber")} />
        <Input label="AWB number" value={f.awbNumber} onChange={set("awbNumber")} />
        <Input label="Port of loading" value={f.portOfLoading} onChange={set("portOfLoading")} />
        <Input label="Port of discharge" value={f.portOfDischarge} onChange={set("portOfDischarge")} />
        <Input label="Shipping bill no. (recorded)" value={f.shippingBillNumber} onChange={set("shippingBillNumber")} />
        <Input label="Customs broker" value={f.customsBroker} onChange={set("customsBroker")} />
        <Input type="date" label="ETD" value={f.etd} onChange={set("etd")} />
        <Input type="date" label="ETA" value={f.eta} onChange={set("eta")} />
        {datesChanged && <Input label="Reason for date change" value={f.changeReason} onChange={set("changeReason")} description="Date changes are kept in tracking history; originals are preserved." />}
        <Textarea containerClassName="sm:col-span-2" label="Notes" rows={2} value={f.notes} onChange={set("notes")} />
      </div>
    </Modal>
  );
}
