"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { poApi } from "@/lib/api/commercial";
import { freightApi, shipmentsApi } from "@/lib/api/logistics";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { READINESS } from "@/lib/compliance-labels";
import { FIELD_SOURCE, label, LogisticsTabs, money, QUOTE_STATUS, useCan, useLogisticsMutation } from "@/components/logistics/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function NewShipmentPage() {
  return (
    <RequirePermission permission="logistics.shipments.create">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <NewShipment />
      </Suspense>
    </RequirePermission>
  );
}

const FIELDS: [string, string][] = [
  ["buyer", "Buyer"],
  ["incoterm", "Incoterm"],
  ["incotermPlace", "Incoterm place"],
  ["originCountry", "Origin country"],
  ["destinationCountry", "Destination country"],
  ["portOfLoading", "Port of loading"],
  ["portOfDischarge", "Port of discharge"],
  ["carrier", "Carrier / line"],
  ["etd", "ETD"],
  ["eta", "ETA"],
  ["cargoDescription", "Cargo"],
  ["packageCount", "Packages"],
  ["grossWeightKg", "Gross weight (kg)"],
  ["netWeightKg", "Net weight (kg)"],
  ["volumeCbm", "Volume (CBM)"],
];

function NewShipment() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const poId = params.get("purchaseOrderId") ?? "";
  const quoteId = params.get("freightQuoteId") ?? "";
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k === "purchaseOrderId") p.delete("freightQuoteId");
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const pos = useQuery({ queryKey: ["logistics", "accepted-pos"], queryFn: () => poApi.list({ status: "ACCEPTED", pageSize: 50 }) });
  const quotes = useQuery({ queryKey: ["logistics", "quotes", { purchaseOrderId: poId }], queryFn: () => freightApi.list({ purchaseOrderId: poId, pageSize: 50 }), enabled: !!poId });
  const pf = useQuery({ queryKey: ["logistics", "prefill", poId, quoteId], queryFn: () => shipmentsApi.prefill(poId, quoteId || undefined), enabled: !!poId });
  const [ack, setAck] = useState(false);
  const [override, setOverride] = useState("");
  const [booked, setBooked] = useState(false);
  const [booking, setBooking] = useState("");
  const [notes, setNotes] = useState("");
  const create = useLogisticsMutation(() => shipmentsApi.create({
    purchaseOrderId: poId,
    freightQuoteId: quoteId || undefined,
    acknowledgeComplianceWarnings: ack || undefined,
    complianceOverrideReason: override.trim() || undefined,
    bookingConfirmed: booked || undefined,
    bookingReference: booking.trim() || undefined,
    notes: notes.trim() || undefined,
  }), "Shipment created", (s) => router.push(`/shipments/${s.id}`));
  const p = pf.data;
  const selectable = (quotes.data?.items ?? []).filter((q) => q.status === "SELECTED" && !q.shipmentId);
  const gateOk = p && (p.gate === "OK" || (p.gate === "WARNINGS_ACK_REQUIRED" && ack) || ((p.gate === "BLOCKED" || p.gate === "NOT_EVALUATED") && override.trim().length >= 3 && can("logistics.override")));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Shipments", href: "/shipments" }, { label: "New shipment" }]} />
      <div>
        <PageTitle>New shipment</PageTitle>
        <HelperText className="mt-1">Values are copied from the accepted PO, packing list and selected freight quote, with their source shown. Nothing is estimated.</HelperText>
      </div>
      <LogisticsTabs />
      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <Select label="Accepted buyer PO" required value={poId} onChange={(e) => setParam("purchaseOrderId", e.target.value)} options={[{ value: "", label: pos.isLoading ? "Loading…" : "Choose a PO" }, ...(pos.data?.items ?? []).map((o) => ({ value: o.id, label: `${o.poNumber} — ${o.buyer.name}` }))]} />
        <Select label="Selected freight quote" value={quoteId} disabled={!poId} onChange={(e) => setParam("freightQuoteId", e.target.value)} options={[{ value: "", label: selectable.length ? "Choose the selected quote" : "No selected quote (optional)" }, ...selectable.map((q) => ({ value: q.id, label: `${q.forwarderName} — ${money(q.totalCost, q.currency)}` }))]} description={poId && !selectable.length ? "Select a quote on Freight quotes first, or continue without one." : undefined} />
        {poId && <Caption className="sm:col-span-2"><Link className="text-primary hover:underline" href={`/freight-quotes?purchaseOrderId=${poId}`}>Compare or request freight quotes for this PO</Link></Caption>}
      </Card>
      {!poId ? null : pf.isLoading ? <Skeleton className="h-64 w-full" /> : pf.isError || !p ? (
        <ErrorState title="Could not prepare the shipment" message={toFriendlyErrorMessage(pf.error)} onRetry={() => pf.refetch()} />
      ) : (
        <>
          <Card className="p-4">
            <SectionTitle className="text-base">Shipment data</SectionTitle>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {FIELDS.map(([k, l]) => {
                const v = p.values[k];
                return (
                  <div key={k} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{l}</dt>
                    <dd className="whitespace-pre-line break-words">{v?.value != null && v.value !== "" ? String(k === "etd" || k === "eta" ? String(v.value).slice(0, 10) : v.value) : "—"} {v && <span className="text-xs text-muted-foreground">({FIELD_SOURCE[v.source]})</span>}</dd>
                  </div>
                );
              })}
            </dl>
            {p.freightQuote && <Caption className="mt-2 block">Quote: {p.freightQuote.forwarderName} <Badge variant={QUOTE_STATUS[p.freightQuote.status].variant}>{QUOTE_STATUS[p.freightQuote.status].label}</Badge></Caption>}
          </Card>
          <Card className="flex flex-col gap-3 p-4 text-sm">
            <SectionTitle className="text-base">Compliance &amp; documents</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {p.readiness.compliance.readiness ? <Badge variant={READINESS[p.readiness.compliance.readiness as keyof typeof READINESS].variant}>{READINESS[p.readiness.compliance.readiness as keyof typeof READINESS].label}</Badge> : <Badge>Not evaluated</Badge>}
              {p.readiness.compliance.blockers > 0 && <Badge variant="danger">{p.readiness.compliance.blockers} blocker{p.readiness.compliance.blockers === 1 ? "" : "s"}</Badge>}
              {p.readiness.compliance.warnings > 0 && <Badge variant="warning">{p.readiness.compliance.warnings} warning{p.readiness.compliance.warnings === 1 ? "" : "s"}</Badge>}
              <Badge variant={p.readiness.documents.complete ? "success" : "neutral"}>Documents {p.readiness.documents.approved}/{p.readiness.documents.requiredNow} approved</Badge>
            </div>
            {p.readiness.documents.reasons.length > 0 && <ul className="list-disc pl-5 text-muted-foreground">{p.readiness.documents.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            {p.gate === "WARNINGS_ACK_REQUIRED" && <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} label="I have reviewed the compliance warnings and want to create the shipment." />}
            {(p.gate === "BLOCKED" || p.gate === "NOT_EVALUATED") && (
              <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3">
                <p className="font-medium">{p.gate === "BLOCKED" ? "Compliance is blocked for this order." : "Compliance has not been evaluated for this order."}</p>
                <p className="mt-1 text-muted-foreground">Resolve it on the <Link className="text-primary hover:underline" href={`/compliance/orders/${poId}`}>compliance checklist</Link>{can("logistics.override") ? ", or record a manager override reason." : ". A manager can override with a written reason."}</p>
                {can("logistics.override") && <Textarea className="mt-2" label="Override reason" rows={2} value={override} onChange={(e) => setOverride(e.target.value)} />}
              </div>
            )}
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <Checkbox checked={booked} onChange={(e) => setBooked(e.target.checked)} label="The forwarder or carrier has confirmed a booking (recorded, not made, by ExportPro)." />
            {booked && <Input label="Booking reference" required value={booking} onChange={(e) => setBooking(e.target.value)} />}
            <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button disabled={!gateOk || create.isPending || (booked && !booking.trim())} onClick={() => create.mutate(undefined)}>{create.isPending ? "Creating…" : "Create shipment"}</Button>
              <Button asChild variant="ghost"><Link href="/shipments">Cancel</Link></Button>
            </div>
            {p.purchaseOrder.status !== "ACCEPTED" && <HelperText>Only accepted POs can be shipped (current status: {label(p.purchaseOrder.status)}).</HelperText>}
          </Card>
        </>
      )}
    </div>
  );
}
