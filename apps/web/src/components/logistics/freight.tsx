"use client";

import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { FreightQuoteDetail, FreightRequestView } from "@exportpro/types";
import { COSTING_CURRENCIES, FREIGHT_CHARGE_CATEGORIES, SHIPMENT_TRANSPORT_MODES, SHIPMENT_TYPES } from "@exportpro/types";
import { poApi } from "@/lib/api/commercial";
import { freightApi } from "@/lib/api/logistics";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText } from "@/components/ui/typography";
import { CopyButton, FIELD_SOURCE, label, opts, useLogisticsMutation } from "./shared";

const CURRENCIES = COSTING_CURRENCIES.map((c) => ({ value: c.code, label: c.code }));

function useAcceptedPos() {
  return useQuery({ queryKey: ["logistics", "accepted-pos"], queryFn: () => poApi.list({ status: "ACCEPTED", pageSize: 50 }) });
}

/** Freight request (RFQ) built from the PO + packing list; produces copyable text, sends nothing. */
export function FreightRequestDialog({ open, onOpenChange, purchaseOrderId }: { open: boolean; onOpenChange: (o: boolean) => void; purchaseOrderId?: string }) {
  const pos = useAcceptedPos();
  const providers = useQuery({ queryKey: ["logistics", "providers"], queryFn: freightApi.providers, enabled: open });
  const [poId, setPoId] = useState(purchaseOrderId ?? "");
  const pf = useQuery({ queryKey: ["logistics", "request-prefill", poId], queryFn: () => freightApi.requestPrefill(poId), enabled: open && !!poId });
  const [f, setF] = useState({ transportMode: "SEA", shipmentType: "FCL", readyDate: "", preferredDeparture: "", specialHandling: "" });
  const [ids, setIds] = useState<string[]>([]);
  const [newFwd, setNewFwd] = useState("");
  const [done, setDone] = useState<FreightRequestView | null>(null);
  const addFwd = useLogisticsMutation(() => freightApi.createProvider({ name: newFwd.trim() }), "Forwarder added", (p) => { setIds([...ids, p.id]); setNewFwd(""); });
  const create = useLogisticsMutation(() => freightApi.createRequest({ purchaseOrderId: poId || undefined, transportMode: f.transportMode, shipmentType: f.shipmentType || undefined, readyDate: f.readyDate || undefined, preferredDeparture: f.preferredDeparture || undefined, specialHandling: f.specialHandling.trim() || undefined, providerIds: ids }), "Freight request created", setDone);
  const close = () => { setDone(null); onOpenChange(false); };
  return (
    <Modal className="max-w-2xl" open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} title={done ? `Request ${done.reference}` : "Request freight quotes"} description={done ? "Copy this text into your email or WhatsApp to forwarders. ExportPro does not send it." : "Shipment data comes from the PO and packing list; nothing is estimated."}
      footer={done ? <div className="flex justify-end gap-2"><CopyButton text={done.rfqText} label="Copy request" /><Button onClick={close}>Done</Button></div> : <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><Button disabled={create.isPending} onClick={() => create.mutate(undefined)}>Create request</Button></div>}>
      {done ? (
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">{done.rfqText}</pre>
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <Select label="Buyer PO" value={poId} onChange={(e) => setPoId(e.target.value)} options={[{ value: "", label: "No PO (manual details)" }, ...(pos.data?.items ?? []).map((o) => ({ value: o.id, label: `${o.poNumber} — ${o.buyer.name}` }))]} />
          {pf.data && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {Object.entries(pf.data.values).filter(([k]) => !["buyer", "incotermPlace", "shipmentMode"].includes(k)).map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{label(k.replace(/([A-Z])/g, "_$1").toUpperCase())}</dt><dd className="whitespace-pre-line break-words">{v.value ?? "—"} <span className="text-xs text-muted-foreground">({FIELD_SOURCE[v.source]})</span></dd></div>
              ))}
            </dl>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Mode" value={f.transportMode} onChange={(e) => setF({ ...f, transportMode: e.target.value })} options={opts(SHIPMENT_TRANSPORT_MODES)} />
            <Select label="Shipment type" value={f.shipmentType} onChange={(e) => setF({ ...f, shipmentType: e.target.value })} options={[{ value: "", label: "Not specified" }, ...opts(SHIPMENT_TYPES)]} />
            <Input type="date" label="Cargo ready date" value={f.readyDate} onChange={(e) => setF({ ...f, readyDate: e.target.value })} />
            <Input type="date" label="Preferred departure" value={f.preferredDeparture} onChange={(e) => setF({ ...f, preferredDeparture: e.target.value })} />
          </div>
          <Textarea label="Special handling" rows={2} value={f.specialHandling} onChange={(e) => setF({ ...f, specialHandling: e.target.value })} />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Forwarders to ask</legend>
            {(providers.data ?? []).map((p) => <Checkbox key={p.id} label={p.name} checked={ids.includes(p.id)} onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />)}
            {!providers.data?.length && <HelperText>No forwarders yet — add one below.</HelperText>}
            <div className="flex items-end gap-2"><Input containerClassName="flex-1" label="Add forwarder" value={newFwd} onChange={(e) => setNewFwd(e.target.value)} /><Button variant="outline" disabled={newFwd.trim().length < 2 || addFwd.isPending} onClick={() => addFwd.mutate(undefined)}>Add</Button></div>
            <Caption>Each selected forwarder gets a &quot;Requested&quot; placeholder quote to fill in when their rates arrive.</Caption>
          </fieldset>
        </div>
      )}
    </Modal>
  );
}

type Charge = { category: string; label: string; amount: string };

/** Manual entry / edit of a received freight quote. Total = sum of charges. */
export function FreightQuoteForm({ open, onOpenChange, quote, purchaseOrderId, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; quote?: FreightQuoteDetail; purchaseOrderId?: string; onSaved?: (q: FreightQuoteDetail) => void }) {
  const pos = useAcceptedPos();
  const d = (v: string | null | undefined) => v?.slice(0, 10) ?? "";
  const [f, setF] = useState({
    purchaseOrderId: quote?.purchaseOrder?.id ?? purchaseOrderId ?? "",
    forwarderName: quote?.forwarderName ?? "",
    quoteReference: quote?.quoteReference ?? "",
    transportMode: quote?.transportMode ?? "SEA",
    shipmentType: quote?.shipmentType ?? "",
    shippingLine: quote?.shippingLine ?? "",
    carrier: quote?.carrier ?? "",
    portOfLoading: quote?.portOfLoading ?? "",
    portOfDischarge: quote?.portOfDischarge ?? "",
    routeSummary: quote?.routeSummary ?? "",
    transshipmentPorts: quote?.transshipmentPorts.join(", ") ?? "",
    currency: quote?.currency ?? "USD",
    transitDays: quote?.transitDays?.toString() ?? "",
    freeDays: quote?.freeDays?.toString() ?? "",
    validityUntil: d(quote?.validityUntil),
    departureDate: d(quote?.departureDate),
    arrivalDate: d(quote?.arrivalDate),
    inclusions: quote?.inclusions ?? "",
    exclusions: quote?.exclusions ?? "",
    terms: quote?.terms ?? "",
  });
  const [charges, setCharges] = useState<Charge[]>(quote?.charges.length ? quote.charges.map((c) => ({ category: c.category, label: c.label ?? "", amount: c.amount })) : [{ category: "FREIGHT", label: "", amount: "" }]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const total = charges.reduce((t, c) => t + (Number(c.amount) || 0), 0);
  const body = () => {
    const b: Record<string, unknown> = {
      forwarderName: f.forwarderName.trim(),
      quoteReference: f.quoteReference.trim() || null,
      transportMode: f.transportMode,
      shipmentType: f.shipmentType || null,
      shippingLine: f.shippingLine.trim() || null,
      carrier: f.carrier.trim() || null,
      portOfLoading: f.portOfLoading.trim() || null,
      portOfDischarge: f.portOfDischarge.trim() || null,
      routeSummary: f.routeSummary.trim() || null,
      transshipmentPorts: f.transshipmentPorts.split(",").map((x) => x.trim()).filter(Boolean),
      currency: f.currency,
      transitDays: f.transitDays ? Number(f.transitDays) : null,
      freeDays: f.freeDays ? Number(f.freeDays) : null,
      validityUntil: f.validityUntil || null,
      departureDate: f.departureDate || null,
      arrivalDate: f.arrivalDate || null,
      inclusions: f.inclusions.trim() || null,
      exclusions: f.exclusions.trim() || null,
      terms: f.terms.trim() || null,
      charges: charges.filter((c) => c.amount.trim()).map((c) => ({ category: c.category, label: c.label.trim() || null, amount: c.amount.trim() })),
    };
    if (quote) b.expectedRowVersion = quote.rowVersion;
    else if (f.purchaseOrderId) b.purchaseOrderId = f.purchaseOrderId;
    return b;
  };
  const save = useLogisticsMutation(() => (quote ? freightApi.update(quote.id, body()) : freightApi.create(body())), "Freight quote saved", (q) => { onOpenChange(false); onSaved?.(q); });
  return (
    <Modal className="max-w-3xl" open={open} onOpenChange={onOpenChange} title={quote ? `Edit quote — ${quote.forwarderName}` : "Enter freight quote"} description="Enter the rates exactly as quoted by the forwarder."
      footer={<div className="flex flex-wrap items-center justify-end gap-2"><Caption className="mr-auto">Total {f.currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Caption><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={f.forwarderName.trim().length < 2 || save.isPending} onClick={() => save.mutate(undefined)}>Save quote</Button></div>}>
      <div className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {!quote && <Select containerClassName="sm:col-span-3" label="Buyer PO" value={f.purchaseOrderId} onChange={set("purchaseOrderId")} options={[{ value: "", label: "Not linked" }, ...(pos.data?.items ?? []).map((o) => ({ value: o.id, label: `${o.poNumber} — ${o.buyer.name}` }))]} />}
          <Input label="Forwarder" required value={f.forwarderName} onChange={set("forwarderName")} disabled={!!quote?.provider} />
          <Input label="Quote reference" value={f.quoteReference} onChange={set("quoteReference")} />
          <Select label="Currency" value={f.currency} onChange={set("currency")} options={CURRENCIES} />
          <Select label="Mode" value={f.transportMode} onChange={set("transportMode")} options={opts(SHIPMENT_TRANSPORT_MODES)} />
          <Select label="Type" value={f.shipmentType} onChange={set("shipmentType")} options={[{ value: "", label: "—" }, ...opts(SHIPMENT_TYPES)]} />
          <Input label="Shipping line" value={f.shippingLine} onChange={set("shippingLine")} />
          <Input label="Carrier" value={f.carrier} onChange={set("carrier")} />
          <Input label="Port of loading" value={f.portOfLoading} onChange={set("portOfLoading")} />
          <Input label="Port of discharge" value={f.portOfDischarge} onChange={set("portOfDischarge")} />
          <Input containerClassName="sm:col-span-2" label="Route" value={f.routeSummary} onChange={set("routeSummary")} />
          <Input label="Transshipment ports" value={f.transshipmentPorts} onChange={set("transshipmentPorts")} description="Comma separated; empty = direct" />
          <Input label="Transit days" inputMode="numeric" value={f.transitDays} onChange={set("transitDays")} />
          <Input label="Free days" inputMode="numeric" value={f.freeDays} onChange={set("freeDays")} />
          <Input type="date" label="Valid until" value={f.validityUntil} onChange={set("validityUntil")} />
          <Input type="date" label="Departure" value={f.departureDate} onChange={set("departureDate")} />
          <Input type="date" label="Arrival" value={f.arrivalDate} onChange={set("arrivalDate")} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Charges</legend>
          {charges.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[12rem_1fr_8rem_auto]">
              <Select aria-label="Charge category" containerClassName="col-span-2 sm:col-span-1" value={c.category} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} options={opts(FREIGHT_CHARGE_CATEGORIES)} />
              <Input aria-label="Charge label" placeholder="Label (optional)" value={c.label} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input aria-label="Amount" inputMode="decimal" placeholder="0.00" value={c.amount} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <Button variant="ghost" size="sm" aria-label="Remove charge" onClick={() => setCharges(charges.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden="true" /></Button>
            </div>
          ))}
          <Button className="self-start" size="sm" variant="outline" onClick={() => setCharges([...charges, { category: "OTHER", label: "", amount: "" }])}>Add charge</Button>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Textarea label="Inclusions" rows={2} value={f.inclusions} onChange={set("inclusions")} />
          <Textarea label="Exclusions" rows={2} value={f.exclusions} onChange={set("exclusions")} description="Separate with ; or new lines" />
          <Textarea label="Terms" rows={2} value={f.terms} onChange={set("terms")} />
        </div>
      </div>
    </Modal>
  );
}
