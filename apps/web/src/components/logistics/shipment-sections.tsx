"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { ShipmentDetail, ShipmentMilestoneView } from "@exportpro/types";
import { BUYER_UPDATE_TRIGGERS, CLAIM_STATUSES, MILESTONE_STATUSES, SHIPMENT_EXCEPTION_TYPES, SHIPMENT_TRANSPORT_MODES, TRACKING_EVENT_TYPES } from "@exportpro/types";
import { attachmentHref, shipmentsApi } from "@/lib/api/logistics";
import { DOC_TYPE, READINESS } from "@/lib/compliance-labels";
import { ReasonDialog } from "@/components/commercial/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";
import { CopyButton, dateTime, day, label, MILESTONE_STATUS, money, opts, SEVERITY, SOURCE_LABEL, UPDATE_STATUS, useLogisticsMutation } from "./shared";

type S = { s: ShipmentDetail };
const has = (s: ShipmentDetail, a: string) => s.availableActions.includes(a);
const iso = (v: string) => (v ? new Date(v).toISOString() : undefined);
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined));

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="break-words">{v ?? "—"}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ overview */

export function OverviewSection({ s }: S) {
  const r = s.readiness;
  const t = s.tracking;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <SectionTitle className="text-base">Route &amp; carrier</SectionTitle>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <Row k="Route" v={s.route} />
          <Row k="Incoterm" v={s.incoterm ? `${s.incoterm}${s.incotermPlace ? ` ${s.incotermPlace}` : ""}` : null} />
          <Row k="Port of loading" v={s.portOfLoading} />
          <Row k="Port of discharge" v={s.portOfDischarge} />
          <Row k="Carrier / line" v={s.carrier ?? s.shippingLine} />
          <Row k="Vessel / voyage" v={s.vesselName ? `${s.vesselName}${s.voyageNumber ? ` / ${s.voyageNumber}` : ""}` : s.flightNumber} />
          <Row k="Booking reference" v={s.bookingReference} />
          <Row k="B/L or AWB" v={s.blNumber ?? s.awbNumber} />
          <Row k="ETD (original → current)" v={`${day(s.originalEtd)} → ${day(s.etd)}${s.etdDelayDays ? ` (${s.etdDelayDays > 0 ? "+" : ""}${s.etdDelayDays} d)` : ""}`} />
          <Row k="ETA (original → current)" v={`${day(s.originalEta)} → ${day(s.eta)}${s.etaDelayDays ? ` (${s.etaDelayDays > 0 ? "+" : ""}${s.etaDelayDays} d)` : ""}`} />
          <Row k="Actual departure" v={day(s.actualDeparture)} />
          <Row k="Actual arrival / delivered" v={`${day(s.actualArrival)} / ${day(s.deliveredAt)}`} />
        </dl>
      </Card>
      <div className="flex flex-col gap-4">
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Tracking source</SectionTitle>
          {t.provider ? (
            <p className="mt-1">Provider: {t.provider} · last fetched {dateTime(t.lastFetchedAt)}</p>
          ) : (
            <p className="mt-1">Manual tracking — no carrier tracking provider is configured. Positions and dates are only as current as the last recorded event.</p>
          )}
          <Caption className="block">Last update: {dateTime(t.lastUpdateAt)}{t.lastUpdateSource ? ` · ${SOURCE_LABEL[t.lastUpdateSource]}` : ""}</Caption>
          {t.lastError && <p className="mt-1 text-danger">Last provider error: {t.lastError}</p>}
        </Card>
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Readiness</SectionTitle>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.compliance.readiness ? <Badge variant={READINESS[r.compliance.readiness as keyof typeof READINESS].variant}>Compliance: {READINESS[r.compliance.readiness as keyof typeof READINESS].label}</Badge> : <Badge>Compliance not evaluated</Badge>}
            <Badge variant={r.documents.complete ? "success" : "warning"}>Documents {r.documents.approved}/{r.documents.requiredNow} approved</Badge>
            {r.documents.validated > 0 && <Badge variant="info">{r.documents.validated} validated</Badge>}
          </div>
          {s.compliance.acknowledgedWarnings && <Caption className="mt-1 block">Compliance warnings acknowledged at creation.</Caption>}
          {s.compliance.overrideReason && <Caption className="mt-1 block">Compliance override: {s.compliance.overrideReason}</Caption>}
        </Card>
        {s.crm && (
          <Card className="p-4 text-sm">
            <SectionTitle className="text-base">CRM</SectionTitle>
            <p className="mt-1">Lead stage: {label(s.crm.stage)} · <Link className="text-primary hover:underline" href={`/crm/leads/${s.crm.leadId}`}>Open lead</Link></p>
            {s.crm.stageSuggestion && <Caption className="block">Suggestion only: move to {label(s.crm.stageSuggestion.stage)} — {s.crm.stageSuggestion.reason} The stage is never changed automatically.</Caption>}
          </Card>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ timeline */

export function TimelineSection({ s }: S) {
  const [edit, setEdit] = useState<ShipmentMilestoneView | null>(null);
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Milestones</SectionTitle>
      <ol className="mt-3 flex flex-col gap-3 border-l border-border pl-4">
        {s.milestones.map((m) => (
          <li key={m.id} className="relative text-sm">
            <span className={`absolute -left-[1.3rem] top-1.5 size-2 rounded-full ${m.status === "COMPLETED" ? "bg-success" : m.status === "BLOCKED" ? "bg-danger" : m.status === "DELAYED" ? "bg-warning" : "bg-border"}`} aria-hidden="true" />
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{label(m.stage)}</span>
              <Badge variant={MILESTONE_STATUS[m.status].variant}>{MILESTONE_STATUS[m.status].label}</Badge>
              {m.delayDays ? <Badge variant="warning">+{m.delayDays} d</Badge> : null}
              {has(s, "milestones") && <Button size="sm" variant="ghost" onClick={() => setEdit(m)} aria-label={`Update ${label(m.stage)} milestone`}>Update</Button>}
            </div>
            <Caption className="block">
              {m.actualAt ? `Done ${day(m.actualAt)}` : m.estimatedAt ? `Estimated ${day(m.estimatedAt)}` : m.plannedAt ? `Planned ${day(m.plannedAt)}` : "No date"} · {SOURCE_LABEL[m.source]}{m.completedBy ? ` · ${m.completedBy}` : ""}
            </Caption>
            {m.reason && <p className="break-words text-muted-foreground">Reason: {m.reason}</p>}
            {m.notes && <p className="break-words text-muted-foreground">{m.notes}</p>}
          </li>
        ))}
      </ol>
      {edit && <MilestoneDialog s={s} m={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function MilestoneDialog({ s, m, onClose }: { s: ShipmentDetail; m: ShipmentMilestoneView; onClose: () => void }) {
  const [status, setStatus] = useState<string>(m.status);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState(m.notes ?? "");
  const [planned, setPlanned] = useState(m.plannedAt?.slice(0, 10) ?? "");
  const needsReason = status === "SKIPPED" || status === "BLOCKED";
  const mut = useLogisticsMutation(() => shipmentsApi.milestone(s.id, m.id, clean({ status, reason: reason.trim() || undefined, notes: notes.trim() || null, plannedAt: planned ? iso(planned) : undefined })), "Milestone updated", onClose);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${label(m.stage)} milestone`} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={mut.isPending || (needsReason && reason.trim().length < 3)} onClick={() => mut.mutate(undefined)}>Save</Button></div>}>
      <div className="flex flex-col gap-3">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={MILESTONE_STATUSES.filter((x) => !(m.stage === "DOCUMENTATION" && x === "SKIPPED")).map((x) => ({ value: x, label: MILESTONE_STATUS[x].label }))} />
        {needsReason && <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} description="Required to skip or block a milestone." />}
        <Input type="date" label="Planned date" value={planned} onChange={(e) => setPlanned(e.target.value)} />
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {m.stage === "DOCUMENTATION" && <HelperText>Documentation completes only when required documents are available and approved (Sprint 16/17 checks).</HelperText>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ tracking */

const MANUAL_SOURCES = [
  { value: "MANUAL", label: "Manual entry" },
  { value: "FORWARDER", label: "Reported by forwarder" },
  { value: "USER_UPLOAD", label: "From uploaded document" },
];

export function TrackingSection({ s }: S) {
  const [f, setF] = useState({ eventType: "NOTE", eventTime: nowLocal(), location: "", vesselName: "", voyageNumber: "", containerNumber: "", newEta: "", newEtd: "", description: "", source: "MANUAL", sourceReference: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const add = useLogisticsMutation(
    () => shipmentsApi.track(s.id, clean({ ...f, eventTime: iso(f.eventTime), newEta: f.newEta ? iso(f.newEta) : undefined, newEtd: f.newEtd ? iso(f.newEtd) : undefined })),
    undefined,
    (r) => {
      setF({ ...f, location: "", description: "", newEta: "", newEtd: "", sourceReference: "" });
      return r.duplicate;
    },
  );
  const refresh = useLogisticsMutation(() => shipmentsApi.refresh(s.id), "Tracking refreshed");
  const dateEvent = ["ETA_CHANGED", "ETD_CHANGED", "MISSED_SAILING", "PORT_DELAY", "TRANSSHIPMENT_DELAY", "DELIVERY_DELAY"].includes(f.eventType);
  return (
    <div className="flex flex-col gap-4">
      <div role="note" className="rounded-md border border-border bg-muted/40 p-3 text-sm">
        {s.tracking.provider ? `Provider-fed events show their source and fetch time. Last fetched ${dateTime(s.tracking.lastFetchedAt)}.` : "Manual tracking: events are recorded by your team or reported by the forwarder. This is not live carrier tracking."}
        {has(s, "refresh_tracking") && <Button className="ml-2" size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate(undefined)}>Refresh from provider</Button>}
      </div>
      {has(s, "tracking") && (
        <Card className="p-4">
          <SectionTitle className="text-base">Record tracking event</SectionTitle>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select label="Event" value={f.eventType} onChange={set("eventType")} options={opts(TRACKING_EVENT_TYPES)} />
            <Input type="datetime-local" label="Event time" required value={f.eventTime} onChange={set("eventTime")} />
            <Select label="Source" value={f.source} onChange={set("source")} options={MANUAL_SOURCES} />
            <Input label="Location" value={f.location} onChange={set("location")} />
            <Input label="Vessel" value={f.vesselName} onChange={set("vesselName")} />
            <Input label="Voyage" value={f.voyageNumber} onChange={set("voyageNumber")} />
            <Input label="Container" value={f.containerNumber} onChange={set("containerNumber")} />
            {dateEvent && <Input type="date" label="New ETA" value={f.newEta} onChange={set("newEta")} />}
            {dateEvent && <Input type="date" label="New ETD" value={f.newEtd} onChange={set("newEtd")} />}
            <Input label="Source reference" value={f.sourceReference} onChange={set("sourceReference")} description={f.eventType === "BOOKED" ? "Booking reference confirmed by the forwarder/carrier." : undefined} />
            <Textarea containerClassName="sm:col-span-2 lg:col-span-3" label="Description" rows={2} value={f.description} onChange={set("description")} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={add.isPending || !f.eventTime} onClick={() => add.mutate(undefined)}>{add.isPending ? "Saving…" : "Add event"}</Button>
            {add.data?.duplicate && <Caption>Identical event already recorded — nothing changed.</Caption>}
          </div>
        </Card>
      )}
      <Card className="p-4">
        <SectionTitle className="text-base">Tracking history</SectionTitle>
        {!s.trackingEvents.length ? <HelperText className="mt-1">No tracking events yet.</HelperText> : (
          <ol className="mt-3 flex flex-col gap-2.5 border-l border-border pl-4">
            {s.trackingEvents.map((t) => (
              <li key={t.id} className="relative text-sm">
                <span className={`absolute -left-[1.3rem] top-1.5 size-2 rounded-full ${t.applied ? "bg-primary" : "bg-border"}`} aria-hidden="true" />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{label(t.eventType)}</span>
                  <Badge variant={t.source === "CARRIER_API" ? "info" : "neutral"}>{SOURCE_LABEL[t.source]}</Badge>
                  {t.estimated && <Badge>Estimated</Badge>}
                  {!t.applied && <Badge variant="warning">History only</Badge>}
                </div>
                <p className="break-words">{t.description}</p>
                {t.previousValue || t.newValue ? <Caption className="block">{t.previousValue ?? "—"} → {t.newValue ?? "—"}</Caption> : null}
                {t.appliedNote && <Caption className="block">{t.appliedNote}</Caption>}
                <Caption className="block">{dateTime(t.eventTime)}{t.location ? ` · ${t.location}` : ""}{t.vesselName ? ` · ${t.vesselName}` : ""}{t.sourceReference ? ` · ref ${t.sourceReference}` : ""}{t.createdBy ? ` · ${t.createdBy}` : ""}</Caption>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ cargo */

export function CargoSection({ s }: S) {
  const [c, setC] = useState({ containerNumber: "", containerType: "", sealNumber: "", packageCount: "", grossWeightKg: "" });
  const [mismatch, setMismatch] = useState(false);
  const [leg, setLeg] = useState({ mode: "SEA", origin: "", destination: "", carrier: "", vesselName: "", voyageNumber: "" });
  const add = useLogisticsMutation(() => shipmentsApi.addContainer(s.id, clean({ ...c, packageCount: c.packageCount ? Number(c.packageCount) : undefined, acceptCheckDigitMismatch: mismatch || undefined })), "Container added", () => setC({ containerNumber: "", containerType: "", sealNumber: "", packageCount: "", grossWeightKg: "" }));
  const del = useLogisticsMutation((cid: string) => shipmentsApi.deleteContainer(s.id, cid), "Container removed");
  const addLeg = useLogisticsMutation(() => shipmentsApi.addLeg(s.id, clean(leg)), "Leg added", () => setLeg({ ...leg, origin: "", destination: "", vesselName: "", voyageNumber: "" }));
  const g = s.cargo;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <SectionTitle className="text-base">Cargo</SectionTitle>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {([["Description", g.description], ["Packages", g.packageCount], ["Gross weight (kg)", g.grossWeightKg], ["Net weight (kg)", g.netWeightKg], ["Volume (CBM)", g.volumeCbm]] as const).map(([k, v]) => (
            <Row key={k} k={k} v={<span className="whitespace-pre-line">{v.value ?? "—"} <span className="text-xs text-muted-foreground">({v.source === "NONE" ? "not available" : label(v.source)})</span></span>} />
          ))}
        </dl>
      </Card>
      <Card className="p-4">
        <SectionTitle className="text-base">Containers</SectionTitle>
        {!s.containers.length ? <HelperText className="mt-1">No containers recorded.</HelperText> : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {s.containers.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2">
                <div className="min-w-0">
                  <span className="font-mono font-medium">{x.containerNumber}</span> {x.containerType && <Caption>{x.containerType}</Caption>} {!x.checkDigitValid && <Badge variant="warning">Check digit mismatch accepted</Badge>}
                  <Caption className="block">Seal {x.sealNumber ?? "—"} · {x.packageCount ?? "—"} pkgs · {x.grossWeightKg ?? "—"} kg{x.lastEvent ? ` · last: ${label(x.lastEvent.type)} ${dateTime(x.lastEvent.at)} (${SOURCE_LABEL[x.lastEvent.source]})` : ""}</Caption>
                </div>
                {has(s, "containers") && s.actualDeparture === null && <Button size="sm" variant="ghost" onClick={() => del.mutate(x.id)} aria-label={`Remove container ${x.containerNumber}`}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
        {has(s, "containers") && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input label="Container number" value={c.containerNumber} onChange={(e) => setC({ ...c, containerNumber: e.target.value })} description="ISO 6346, e.g. CSQU3054383" />
            <Input label="Type" value={c.containerType} onChange={(e) => setC({ ...c, containerType: e.target.value })} placeholder="20GP" />
            <Input label="Seal" value={c.sealNumber} onChange={(e) => setC({ ...c, sealNumber: e.target.value })} />
            <Input label="Packages" inputMode="numeric" value={c.packageCount} onChange={(e) => setC({ ...c, packageCount: e.target.value })} />
            <Input label="Gross kg" inputMode="decimal" value={c.grossWeightKg} onChange={(e) => setC({ ...c, grossWeightKg: e.target.value })} />
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={mismatch} onChange={(e) => setMismatch(e.target.checked)} />Accept a check-digit mismatch (number confirmed on the container)</label>
            <div className="sm:col-span-2 lg:col-span-3"><Button disabled={!c.containerNumber.trim() || add.isPending} onClick={() => add.mutate(undefined)}>Add container</Button></div>
          </div>
        )}
      </Card>
      <Card className="p-4">
        <SectionTitle className="text-base">Legs &amp; transshipment</SectionTitle>
        {!s.legs.length ? <HelperText className="mt-1">No legs yet. Departure and transshipment events create legs automatically.</HelperText> : (
          <ol className="mt-2 flex flex-col gap-2 text-sm">
            {s.legs.map((l) => (
              <li key={l.id} className="rounded-md border border-border p-2">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">Leg {l.sequence}: {l.origin ?? "—"} → {l.destination ?? "—"}</span><Badge>{label(l.status)}</Badge></div>
                <Caption className="block">{label(l.mode)}{l.vesselName ? ` · ${l.vesselName}` : ""}{l.voyageNumber ? ` / ${l.voyageNumber}` : ""}{l.carrier ? ` · ${l.carrier}` : ""} · dep {day(l.actualDeparture ?? l.plannedDeparture)} · arr {day(l.actualArrival ?? l.plannedArrival)}</Caption>
              </li>
            ))}
          </ol>
        )}
        {has(s, "legs") && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="Mode" value={leg.mode} onChange={(e) => setLeg({ ...leg, mode: e.target.value })} options={opts(SHIPMENT_TRANSPORT_MODES)} />
            <Input label="From" value={leg.origin} onChange={(e) => setLeg({ ...leg, origin: e.target.value })} />
            <Input label="To" value={leg.destination} onChange={(e) => setLeg({ ...leg, destination: e.target.value })} />
            <Input label="Carrier" value={leg.carrier} onChange={(e) => setLeg({ ...leg, carrier: e.target.value })} />
            <Input label="Vessel" value={leg.vesselName} onChange={(e) => setLeg({ ...leg, vesselName: e.target.value })} />
            <Input label="Voyage" value={leg.voyageNumber} onChange={(e) => setLeg({ ...leg, voyageNumber: e.target.value })} />
            <div className="sm:col-span-3"><Button variant="outline" disabled={addLeg.isPending || (!leg.origin && !leg.destination)} onClick={() => addLeg.mutate(undefined)}>Add planned leg</Button></div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ documents */

export function DocumentsSection({ s }: S) {
  const d = s.readiness.documents;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Documentation gate</SectionTitle>
        <p className="mt-1">{d.complete ? "Required documents available now are on file and approved." : "Documentation is not complete yet."} Uses the order&apos;s compliance checklist and document validation — nothing is filed with customs.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>{d.available}/{d.requiredNow} available</Badge>
          <Badge variant={d.approved === d.requiredNow ? "success" : "warning"}>{d.approved} approved</Badge>
          <Badge variant="info">{d.validated} validated</Badge>
          {d.validationWarnings > 0 && <Badge variant="warning">{d.validationWarnings} with validation findings</Badge>}
        </div>
        {d.reasons.length > 0 && <ul className="mt-2 list-disc pl-5 text-muted-foreground">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline"><Link href={`/compliance/orders/${s.purchaseOrder.id}`}>Compliance checklist</Link></Button>
          <Button asChild size="sm" variant="ghost"><Link href={`/documents/validation/orders/${s.purchaseOrder.id}`}>Validation package</Link></Button>
        </div>
      </Card>
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Order documents</SectionTitle>
        {!s.documents.length ? <HelperText className="mt-1">No documents for this order yet.</HelperText> : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {s.documents.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                <Link className="min-w-0 truncate text-primary hover:underline" href={`/documents/${x.id}`}>{DOC_TYPE[x.documentType as keyof typeof DOC_TYPE] ?? x.title}</Link>
                <span className="flex gap-1"><Badge>{label(x.status)}</Badge><Badge variant="info">Validation: {label(x.validationStatus)}</Badge></span>
              </li>
            ))}
          </ul>
        )}
        <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Row k="Shipping bill (recorded, not filed)" v={s.customs.shippingBillNumber ? `${s.customs.shippingBillNumber} · ${day(s.customs.shippingBillDate)}` : null} />
          <Row k="Customs broker" v={s.customs.customsBroker} />
        </dl>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ exceptions + claims */

function AttachButton({ s, extra, text = "Attach file" }: { s: ShipmentDetail; extra: { exceptionId?: string; claimId?: string }; text?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const up = useLogisticsMutation((f: File) => shipmentsApi.attach(s.id, f, extra, setPct), "File attached", () => setPct(null));
  return (
    <>
      <input ref={ref} type="file" className="sr-only" aria-label={text} onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} />
      <Button size="sm" variant="outline" disabled={up.isPending} onClick={() => ref.current?.click()}>{up.isPending ? `Uploading ${pct ?? 0}%` : text}</Button>
    </>
  );
}

export function ExceptionsSection({ s }: S) {
  const [resolve, setResolve] = useState<string | null>(null);
  const [x, setX] = useState({ type: "PORT_DELAY", severity: "WARNING", title: "", description: "", impact: "", location: "" });
  const [cl, setCl] = useState({ exceptionId: "", description: "", quantityAffected: "", estimatedLoss: "", currency: "", insurerReference: "", carrierReference: "" });
  const res = useLogisticsMutation((r: string) => shipmentsApi.resolveException(resolve!, r), "Exception resolved", () => setResolve(null));
  const add = useLogisticsMutation(() => shipmentsApi.addException(s.id, clean(x)), "Exception recorded", () => setX({ ...x, title: "", description: "", impact: "", location: "" }));
  const addClaim = useLogisticsMutation(() => shipmentsApi.addClaim(s.id, clean(cl)), "Claim recorded", () => setCl({ exceptionId: "", description: "", quantityAffected: "", estimatedLoss: "", currency: "", insurerReference: "", carrierReference: "" }));
  const claimStatus = useLogisticsMutation(({ id, status }: { id: string; status: string }) => shipmentsApi.updateClaim(id, { status }), "Claim updated");
  const files = (k: "exceptionId" | "claimId", id: string) => s.attachments.filter((a) => a[k] === id);
  const manage = has(s, "exceptions");
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <SectionTitle className="text-base">Exceptions</SectionTitle>
        {!s.exceptions.length ? <HelperText className="mt-1">No exceptions recorded.</HelperText> : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {s.exceptions.map((e) => (
              <li key={e.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={SEVERITY[e.severity]}>{label(e.severity)}</Badge>
                  <Badge variant={e.status === "OPEN" ? "warning" : "success"}>{label(e.status)}</Badge>
                  <span className="min-w-0 break-words font-medium">{e.title}</span>
                </div>
                <Caption className="block">{label(e.type)} · {SOURCE_LABEL[e.source]} · detected {dateTime(e.detectedAt)}{e.location ? ` · ${e.location}` : ""}</Caption>
                {e.description && <p className="break-words">{e.description}</p>}
                {e.impact && <p className="break-words text-muted-foreground">Impact: {e.impact}</p>}
                {e.resolution && <p className="break-words text-success">Resolved: {e.resolution.text} ({e.resolution.by ?? "system"}, {dateTime(e.resolution.at)})</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {manage && e.status === "OPEN" && <Button size="sm" variant="outline" onClick={() => setResolve(e.id)}>Resolve</Button>}
                  {manage && <AttachButton s={s} extra={{ exceptionId: e.id }} text="Attach evidence" />}
                  {files("exceptionId", e.id).map((a) => <a key={a.id} className="text-primary hover:underline" href={attachmentHref(a.id)}>{a.filename}</a>)}
                </div>
              </li>
            ))}
          </ul>
        )}
        {manage && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="Type" value={x.type} onChange={(e) => setX({ ...x, type: e.target.value })} options={opts(SHIPMENT_EXCEPTION_TYPES)} />
            <Select label="Severity" value={x.severity} onChange={(e) => setX({ ...x, severity: e.target.value })} options={opts(["INFO", "WARNING", "CRITICAL"])} />
            <Input label="Title" required value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} />
            <Input label="Location" value={x.location} onChange={(e) => setX({ ...x, location: e.target.value })} />
            <Input containerClassName="sm:col-span-2" label="Impact" value={x.impact} onChange={(e) => setX({ ...x, impact: e.target.value })} />
            <Textarea containerClassName="sm:col-span-3" label="Description" rows={2} value={x.description} onChange={(e) => setX({ ...x, description: e.target.value })} />
            <div className="sm:col-span-3"><Button disabled={x.title.trim().length < 3 || add.isPending} onClick={() => add.mutate(undefined)}>Record exception</Button></div>
          </div>
        )}
      </Card>
      <Card className="p-4">
        <SectionTitle className="text-base">Damage &amp; claims</SectionTitle>
        <HelperText className="mt-1">Claim records only — ExportPro does not submit claims to insurers or carriers.</HelperText>
        {s.claims.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {s.claims.map((c) => (
              <li key={c.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2"><Badge>{label(c.status)}</Badge><span className="min-w-0 break-words">{c.description}</span></div>
                <Caption className="block">Affected {c.quantityAffected ?? "—"} · est. loss {money(c.estimatedLoss, c.currency)} · claim {c.claimReference ?? "—"} · insurer {c.insurerReference ?? "—"} · carrier {c.carrierReference ?? "—"}</Caption>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  {has(s, "claims") && c.status !== "CLOSED" && <Select aria-label="Claim status" containerClassName="w-44" value={c.status} onChange={(e) => claimStatus.mutate({ id: c.id, status: e.target.value })} options={opts(CLAIM_STATUSES)} />}
                  {has(s, "claims") && <AttachButton s={s} extra={{ claimId: c.id }} text="Attach evidence" />}
                  {files("claimId", c.id).map((a) => <a key={a.id} className="text-sm text-primary hover:underline" href={attachmentHref(a.id)}>{a.filename}</a>)}
                </div>
              </li>
            ))}
          </ul>
        )}
        {has(s, "claims") && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="Linked exception" value={cl.exceptionId} onChange={(e) => setCl({ ...cl, exceptionId: e.target.value })} options={[{ value: "", label: "None" }, ...s.exceptions.map((e) => ({ value: e.id, label: e.title }))]} />
            <Input label="Quantity affected" value={cl.quantityAffected} onChange={(e) => setCl({ ...cl, quantityAffected: e.target.value })} />
            <Input label="Estimated loss" inputMode="decimal" value={cl.estimatedLoss} onChange={(e) => setCl({ ...cl, estimatedLoss: e.target.value })} />
            <Input label="Currency" value={cl.currency} maxLength={3} onChange={(e) => setCl({ ...cl, currency: e.target.value.toUpperCase() })} />
            <Input label="Insurer reference" value={cl.insurerReference} onChange={(e) => setCl({ ...cl, insurerReference: e.target.value })} />
            <Input label="Carrier reference" value={cl.carrierReference} onChange={(e) => setCl({ ...cl, carrierReference: e.target.value })} />
            <Textarea containerClassName="sm:col-span-3" label="Description" required rows={2} value={cl.description} onChange={(e) => setCl({ ...cl, description: e.target.value })} />
            <div className="sm:col-span-3"><Button variant="outline" disabled={cl.description.trim().length < 3 || addClaim.isPending} onClick={() => addClaim.mutate(undefined)}>Record claim</Button></div>
          </div>
        )}
      </Card>
      <ReasonDialog open={!!resolve} onOpenChange={(o) => !o && setResolve(null)} title="Resolve exception" label="Resolution" confirmLabel="Resolve" loading={res.isPending} onConfirm={(r) => res.mutate(r)} />
    </div>
  );
}

/* ------------------------------------------------------------------ buyer updates */

export function BuyerUpdatesSection({ s }: S) {
  const [trigger, setTrigger] = useState<string>("DEPARTED");
  const [channel, setChannel] = useState<Record<string, string>>({});
  const gen = useLogisticsMutation(() => shipmentsApi.generateUpdate(s.id, trigger), "Draft created");
  const approve = useLogisticsMutation((uid: string) => shipmentsApi.approveUpdate(s.id, uid), "Approved — not sent");
  const sent = useLogisticsMutation((uid: string) => shipmentsApi.recordSent(s.id, uid, channel[uid] ?? "EMAIL"), "Recorded as sent");
  const discard = useLogisticsMutation((uid: string) => shipmentsApi.discardUpdate(s.id, uid), "Draft discarded");
  const manage = has(s, "buyer_updates");
  return (
    <div className="flex flex-col gap-4">
      <div role="note" className="rounded-md border border-border bg-muted/40 p-3 text-sm">ExportPro drafts buyer updates from recorded events only. It does not send them: copy the approved text, send it yourself, then record how it was sent.</div>
      {manage && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <Select containerClassName="w-56" label="Draft an update for" value={trigger} onChange={(e) => setTrigger(e.target.value)} options={opts(BUYER_UPDATE_TRIGGERS)} />
          <Button variant="outline" disabled={gen.isPending} onClick={() => gen.mutate(undefined)}>Generate draft</Button>
        </Card>
      )}
      {!s.buyerUpdates.length ? <HelperText>No buyer updates yet.</HelperText> : (
        <ul className="flex flex-col gap-3">
          {s.buyerUpdates.map((u) => (
            <li key={u.id}>
              <Card className="p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Badge variant={UPDATE_STATUS[u.status].variant}>{UPDATE_STATUS[u.status].label}</Badge><span className="font-medium">{label(u.trigger)}</span><Caption>{dateTime(u.createdAt)}{u.basedOnEvent ? ` · based on ${SOURCE_LABEL[u.basedOnEvent.source].toLowerCase()} event` : ""}</Caption></div>
                <p className="mt-2 font-medium break-words">{u.subject}</p>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-muted-foreground">{u.message}</pre>
                {u.approvedAt && <Caption className="block">Approved by {u.approvedBy ?? "—"} {dateTime(u.approvedAt)}</Caption>}
                {u.recordedSentAt && <Caption className="block">Recorded as sent via {label(u.channel ?? "OTHER")} by {u.recordedSentBy ?? "—"} {dateTime(u.recordedSentAt)} — sent outside ExportPro</Caption>}
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <CopyButton text={`${u.subject}\n\n${u.message}`} />
                  {manage && u.status === "DRAFT" && <Button size="sm" onClick={() => approve.mutate(u.id)} disabled={approve.isPending}>Approve</Button>}
                  {manage && u.status === "APPROVED" && (
                    <>
                      <Select aria-label="Channel used" containerClassName="w-36" value={channel[u.id] ?? "EMAIL"} onChange={(e) => setChannel({ ...channel, [u.id]: e.target.value })} options={opts(["EMAIL", "WHATSAPP", "PHONE", "OTHER"])} />
                      <Button size="sm" variant="outline" onClick={() => sent.mutate(u.id)} disabled={sent.isPending}>I sent this</Button>
                    </>
                  )}
                  {manage && (u.status === "DRAFT" || u.status === "APPROVED") && <Button size="sm" variant="ghost" onClick={() => discard.mutate(u.id)}>Discard</Button>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ costs */

export function CostsSection({ s }: S) {
  const a = s.costs.actual;
  const [f, setF] = useState({ actualFreight: a.freight ?? "", actualSurcharges: a.surcharges ?? "", actualLocalCharges: a.localCharges ?? "", currency: a.currency ?? s.costs.quoted.currency ?? "", notes: a.notes ?? "" });
  const save = useLogisticsMutation(() => shipmentsApi.costs(s.id, { expectedRowVersion: s.rowVersion, actualFreight: f.actualFreight || null, actualSurcharges: f.actualSurcharges || null, actualLocalCharges: f.actualLocalCharges || null, currency: f.currency || null, notes: f.notes || null }), "Costs saved");
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Logistics costs</SectionTitle>
      <HelperText className="mt-1">Quoted vs actual logistics cost only. Shipment profitability is not calculated here.</HelperText>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <Row k="Quoted (selected freight quote)" v={money(s.costs.quoted.total, s.costs.quoted.currency)} />
        <Row k="Actual total" v={money(a.total, a.currency)} />
      </dl>
      {s.costs.quoted.currency && a.currency && s.costs.quoted.currency !== a.currency && <Caption className="mt-1 block">Different currencies — no conversion applied.</Caption>}
      {has(s, "costs") && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Input label="Freight" inputMode="decimal" value={f.actualFreight} onChange={(e) => setF({ ...f, actualFreight: e.target.value })} />
          <Input label="Surcharges" inputMode="decimal" value={f.actualSurcharges} onChange={(e) => setF({ ...f, actualSurcharges: e.target.value })} />
          <Input label="Local charges" inputMode="decimal" value={f.actualLocalCharges} onChange={(e) => setF({ ...f, actualLocalCharges: e.target.value })} />
          <Input label="Currency" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
          <Textarea containerClassName="sm:col-span-4" label="Notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <div className="sm:col-span-4"><Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>Save actual costs</Button></div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ activity */

export function ActivitySection({ s }: S) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <SectionTitle className="text-base">Activity</SectionTitle>
        {!s.events.length ? <HelperText className="mt-1">No activity yet.</HelperText> : (
          <ol className="mt-3 flex flex-col gap-2.5 border-l border-border pl-4">
            {s.events.map((e) => (
              <li key={e.id} className="relative text-sm">
                <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" aria-hidden="true" />
                <p className="break-words">{e.title}</p>
                <Caption>{dateTime(e.createdAt)}{e.actor ? ` · ${e.actor}` : ""}</Caption>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Attachments</SectionTitle>
        {!s.attachments.length ? <HelperText className="mt-1">No attachments.</HelperText> : (
          <ul className="mt-2 flex flex-col gap-1">{s.attachments.map((a) => <li key={a.id}><a className="text-primary hover:underline" href={attachmentHref(a.id)}>{a.filename}</a> <Caption>{(a.sizeBytes / 1024).toFixed(1)} KB · {dateTime(a.createdAt)}</Caption></li>)}</ul>
        )}
        {has(s, "attach") && <div className="mt-2"><AttachButton s={s} extra={{}} /></div>}
      </Card>
    </div>
  );
}
