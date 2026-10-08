"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useState } from "react";
import type { SupplierPoDetail } from "@exportpro/types";
import { procurementApi } from "@/lib/api/procurement";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { CopyButton } from "@/components/logistics/shared";
import { scheduleBody, ScheduleEditor, type ScheduleRow } from "@/components/procurement/schedule-editor";
import { day, money, PayBadge, PoBadge, ProcBadge, ProcurementTabs, QualityBadge, todayIso, useCan, useProcMutation, words } from "@/components/procurement/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function SupplierPoPage() {
  return (
    <RequirePermission permission="procurement.view">
      <Detail />
    </RequirePermission>
  );
}

const VIA = ["EMAIL", "WHATSAPP", "PHONE", "PORTAL", "OTHER"].map((v) => ({ value: v, label: words(v) }));
const METHODS = ["NEFT", "RTGS", "BANK_TRANSFER", "UPI", "CHEQUE", "CASH", "OTHER"].map((v) => ({ value: v, label: words(v) }));

function Detail() {
  const { spoId } = useParams<{ spoId: string }>();
  const q = useQuery({ queryKey: ["procurement", "order", spoId], queryFn: () => procurementApi.order(spoId) });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState title="Could not load supplier PO" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  return <View s={q.data} />;
}

function View({ s }: { s: SupplierPoDetail }) {
  const can = useCan();
  const has = (x: string) => s.availableActions.includes(x);
  const [via, setVia] = useState("EMAIL");
  const [statusTo, setStatusTo] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState({ expectedDate: s.expectedDate ?? "", reason: "" });
  const [revising, setRevising] = useState(false);
  const issue = useProcMutation(() => procurementApi.issue(s.id, s.rowVersion), "Supplier PO issued — terms frozen in a snapshot");
  const status = useProcMutation(() => procurementApi.status(s.id, { status: statusTo, note: note || undefined, expectedRowVersion: s.rowVersion }), "Status updated", () => { setStatusTo(""); setNote(""); });
  const sent = useProcMutation(() => procurementApi.recordSent(s.id, via), "Recorded as sent (outside ExportPro)");
  const moveDate = useProcMutation(() => procurementApi.updateOrder(s.id, { expectedRowVersion: s.rowVersion, expectedDate: date.expectedDate || null, dateChangeReason: date.reason }), "Expected delivery updated", () => setDate({ ...date, reason: "" }));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>{s.spoNumber}{s.revision > 1 ? ` · Revision ${s.revision}` : ""}</PageTitle>
          <HelperText className="mt-1 break-words">
            <Link className="text-primary hover:underline" href={`/procurement/suppliers/${s.supplier.id}`}>{s.supplier.legalName}</Link>
            {s.rfq && <> · from <Link className="text-primary hover:underline" href={`/procurement/rfqs/${s.rfq.id}`}>{s.rfq.rfqNumber}</Link></>}
            {s.buyerPurchaseOrder && <> · buyer PO <Link className="text-primary hover:underline" href={`/purchase-orders/${s.buyerPurchaseOrder.id}`}>{s.buyerPurchaseOrder.poNumber}</Link></>}
            {s.shipment && <> · shipment <Link className="text-primary hover:underline" href={`/shipments/${s.shipment.id}`}>{s.shipment.shipmentNumber}</Link></>}
          </HelperText>
        </div>
        <div className="flex flex-wrap gap-1"><PoBadge status={s.status} /><ProcBadge status={s.procurementStatus} /><QualityBadge status={s.qualityState} />{s.overdue && <Badge variant="danger">Delivery overdue</Badge>}</div>
      </div>
      <ProcurementTabs />
      <div className="flex flex-wrap gap-2">
        {has("issue") && <Button onClick={() => issue.mutate(undefined)} disabled={issue.isPending}>Issue supplier PO</Button>}
        {has("revise") && <Button variant="secondary" onClick={() => setRevising(true)}>Revise…</Button>}
        {has("pdf") && can("supplier_quotes.manage") && <Button asChild variant="secondary"><a href={procurementApi.pdfHref(s.id)}>Download PDF</a></Button>}
      </div>
      {s.status === "DRAFT" && has("edit") && <DraftEditor key={s.rowVersion} s={s} />}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Delivery</SectionTitle>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words">
            <dt className="text-muted-foreground">PO date</dt><dd>{day(s.poDate)}</dd>
            <dt className="text-muted-foreground">Original expected</dt><dd>{day(s.originalExpectedDate)}</dd>
            <dt className="text-muted-foreground">Current expected</dt><dd>{day(s.expectedDate)}{s.delayDays ? <Badge variant="warning" className="ml-1">{s.delayDays > 0 ? `+${s.delayDays}` : s.delayDays} days</Badge> : null}</dd>
            <dt className="text-muted-foreground">Location</dt><dd>{s.deliveryLocation ?? "—"}</dd>
            <dt className="text-muted-foreground">Quality</dt><dd>{s.qualityRequirements ?? "—"}</dd>
            <dt className="text-muted-foreground">Certificates</dt><dd>{s.certificationRequirements.join(", ") || "—"}</dd>
            <dt className="text-muted-foreground">Sent</dt><dd>{s.externallySent ? `${words(s.externallySent.via)} · ${day(s.externallySent.at)} by ${s.externallySent.by ?? "user"}` : "Not recorded"}</dd>
          </dl>
          {has("expected_date") && (
            <form className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_auto]" onSubmit={(e) => { e.preventDefault(); moveDate.mutate(undefined); }}>
              <Input label="New expected date" type="date" value={date.expectedDate} onChange={(e) => setDate({ ...date, expectedDate: e.target.value })} />
              <Input label="Reason" placeholder="Supplier informed by phone…" value={date.reason} onChange={(e) => setDate({ ...date, reason: e.target.value })} />
              <div className="flex items-end"><Button type="submit" variant="secondary" disabled={date.reason.trim().length < 3 || moveDate.isPending}>Update date</Button></div>
            </form>
          )}
        </Card>
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Status</SectionTitle>
          {has("status") && s.allowedStatuses.length > 0 && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr_auto]">
              <Select aria-label="Next status" value={statusTo} onChange={(e) => setStatusTo(e.target.value)} options={[{ value: "", label: "Change status…" }, ...s.allowedStatuses.map((x) => ({ value: x, label: words(x) }))]} />
              <Input aria-label="Note" placeholder={statusTo === "CANCELLED" ? "Reason (required)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button disabled={!statusTo || status.isPending} onClick={() => status.mutate(undefined)}>Apply</Button>
            </div>
          )}
          {s.completion.blockers.length > 0 && s.status === "RECEIVED" && <div role="status" className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2">Cannot complete yet: {s.completion.blockers.join(" ")}</div>}
          {has("record_sent") && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Select label="Sent via" containerClassName="w-40" value={via} onChange={(e) => setVia(e.target.value)} options={VIA} />
              <Button variant="secondary" onClick={() => sent.mutate(undefined)}>Record PO as sent</Button>
              <CopyButton text={s.messageText} label="Copy message" />
            </div>
          )}
          <HelperText className="mt-2">ExportPro does not email suppliers — send the PDF yourself and record it here.</HelperText>
        </Card>
      </div>
      <Card className="overflow-x-auto p-4 text-sm">
        <SectionTitle className="text-base">Items</SectionTitle>
        <table className="mt-2 w-full min-w-[760px]">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1">Product</th><th>Ordered</th><th>Unit price</th><th>Line total</th><th>Received</th><th>Damaged</th><th>Accepted</th><th>Rejected</th><th>Pending inspection</th></tr></thead>
          <tbody>
            {s.items.map((i) => <tr key={i.id} className="border-t border-border"><td className="py-1">{i.productName}{i.specification ? <Caption className="block">{i.specification}</Caption> : null}</td><td>{i.quantity} {i.unit}</td><td>{i.unitPrice ? money(i.unitPrice, s.currency) : "Hidden"}</td><td>{i.lineTotal ? money(i.lineTotal, s.currency) : "—"}</td><td>{i.receivedQuantity}</td><td>{i.damagedQuantity}</td><td>{i.acceptedQuantity}</td><td>{i.rejectedQuantity}</td><td>{i.pendingInspection}</td></tr>)}
          </tbody>
        </table>
        {s.subtotal && (
          <dl className="mt-3 grid max-w-sm grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
            <dt>Goods</dt><dd>{money(s.subtotal, s.currency)}</dd>
            {([["Packaging", s.charges.packaging], ["Inland transport", s.charges.inlandTransport], ["Inspection", s.charges.inspection], ["Other", s.charges.other], ["GST (shown separately)", s.charges.tax]] as const).map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v ? money(v, s.currency) : "not stated"}</dd></Fragment>)}
            <dt className="font-medium">Total</dt><dd className="font-medium">{money(s.total, s.currency)}</dd>
          </dl>
        )}
      </Card>
      {has("receive") && <ReceiveForm s={s} />}
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Goods receipts</SectionTitle>
        <ul className="mt-2 flex flex-col gap-1">
          {s.receipts.map((g) => <li key={g.id} className="flex flex-wrap items-center gap-2"><Link className="text-primary hover:underline" href={`/procurement/receipts?grn=${g.id}`}>{g.grnNumber}</Link><span>{g.quantity} {g.unit} · {day(g.receivedAt)}{g.location ? ` · ${g.location}` : ""}</span><QualityBadge status={g.qualityStatus} /></li>)}
          {!s.receipts.length && <li className="text-muted-foreground">Nothing received yet.</li>}
        </ul>
      </Card>
      {s.cost.actual !== null || s.cost.committed !== null ? (
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Procurement cost</SectionTitle>
          <dl className="mt-2 grid max-w-md grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
            <dt className="text-muted-foreground">Quote estimate</dt><dd>{money(s.cost.quoteEstimate, s.cost.currency)}</dd>
            <dt className="text-muted-foreground">Committed (PO)</dt><dd>{money(s.cost.committed, s.cost.currency)}</dd>
            <dt className="text-muted-foreground">Received value</dt><dd>{money(s.cost.receivedValue, s.cost.currency)}</dd>
            <dt className="font-medium">Actual (accepted)</dt><dd className="font-medium">{money(s.cost.actual, s.cost.currency)}</dd>
          </dl>
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">{s.cost.components.map((c) => <li key={c.label}>{c.label}: {c.amount ? money(c.amount, s.cost.currency) : "—"} ({c.basis})</li>)}</ul>
          <Caption className="mt-1 block">{s.cost.basis} {s.cost.complete ? "Complete." : `Incomplete: ${s.cost.missing.join("; ")}`}</Caption>
        </Card>
      ) : null}
      {s.payableDetail && <PayablePanel s={s} />}
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">History</SectionTitle>
        <ul className="mt-2 flex flex-col gap-1">{s.history.map((h) => <li key={h.id}>{words(h.type)}{h.from || h.to ? `: ${h.from ?? "—"} → ${h.to ?? "—"}` : ""}{h.reason ? ` — ${h.reason}` : ""} <Caption>{h.by ?? "System"} · {day(h.at)}</Caption></li>)}</ul>
        {s.revisions.length > 0 && <details className="mt-2"><summary className="cursor-pointer">Previous revisions ({s.revisions.length})</summary><ul className="mt-1 list-disc pl-5">{s.revisions.map((r) => <li key={r.revision}>Revision {r.revision}: total {money(String(r.snapshot.total ?? ""), s.currency)} — replaced {day(r.at)} by {r.by ?? "user"}: {r.reason}</li>)}</ul></details>}
      </Card>
      {revising && <ReviseModal s={s} onClose={() => setRevising(false)} />}
    </div>
  );
}

const toRows = (s: SupplierPoDetail): ScheduleRow[] => (s.paymentSchedule.length ? s.paymentSchedule.map((x) => ({ label: x.label, percentage: x.percentage ?? "", trigger: x.trigger, dueDays: x.dueDays !== null && x.dueDays !== undefined ? String(x.dueDays) : "", fixedDate: x.fixedDate ?? "" })) : [{ label: "Advance", percentage: "30", trigger: "ADVANCE", dueDays: "" }, { label: "On delivery", percentage: "70", trigger: "ON_DELIVERY", dueDays: "" }]);

function DraftEditor({ s }: { s: SupplierPoDetail }) {
  const [v, setV] = useState({ expectedDate: s.expectedDate ?? "", deliveryLocation: s.deliveryLocation ?? "", packagingCost: s.charges.packaging ?? "", inlandTransportCost: s.charges.inlandTransport ?? "", inspectionCost: s.charges.inspection ?? "", otherCharges: s.charges.other ?? "", qualityRequirements: s.qualityRequirements ?? "", paymentTerms: s.paymentTerms ?? "" });
  const [sched, setSched] = useState(() => toRows(s));
  const save = useProcMutation(() => procurementApi.updateOrder(s.id, { expectedRowVersion: s.rowVersion, expectedDate: v.expectedDate || null, deliveryLocation: v.deliveryLocation || null, packagingCost: v.packagingCost || null, inlandTransportCost: v.inlandTransportCost || null, inspectionCost: v.inspectionCost || null, otherCharges: v.otherCharges || null, qualityRequirements: v.qualityRequirements || null, paymentTerms: v.paymentTerms || null, paymentSchedule: scheduleBody(sched) }), "Draft saved");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Card className="p-4 text-sm">
      <SectionTitle className="text-base">Draft terms</SectionTitle>
      <HelperText>Leave a charge blank if it is not part of this PO. Issue freezes these terms.</HelperText>
      <form className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <Input label="Expected delivery" type="date" value={v.expectedDate} onChange={set("expectedDate")} />
        <Input label="Delivery location" value={v.deliveryLocation} onChange={set("deliveryLocation")} />
        <Input label="Packaging (total)" inputMode="decimal" value={v.packagingCost} onChange={set("packagingCost")} />
        <Input label="Inland transport (total)" inputMode="decimal" value={v.inlandTransportCost} onChange={set("inlandTransportCost")} />
        <Input label="Inspection (total)" inputMode="decimal" value={v.inspectionCost} onChange={set("inspectionCost")} />
        <Input label="Other charges" inputMode="decimal" value={v.otherCharges} onChange={set("otherCharges")} />
        <Input label="Payment terms (text)" containerClassName="sm:col-span-2" value={v.paymentTerms} onChange={set("paymentTerms")} />
        <Textarea label="Quality requirements" rows={2} containerClassName="sm:col-span-2 lg:col-span-4" value={v.qualityRequirements} onChange={set("qualityRequirements")} />
        <div className="sm:col-span-2 lg:col-span-4"><ScheduleEditor rows={sched} onChange={setSched} /></div>
        <div><Button type="submit" variant="secondary" disabled={save.isPending}>Save draft</Button></div>
      </form>
    </Card>
  );
}

function ReviseModal({ s, onClose }: { s: SupplierPoDetail; onClose: () => void }) {
  const [v, setV] = useState({ reason: "", expectedDate: s.expectedDate ?? "", packagingCost: s.charges.packaging ?? "", inlandTransportCost: s.charges.inlandTransport ?? "", inspectionCost: s.charges.inspection ?? "", otherCharges: s.charges.other ?? "", unitPrice: s.items[0]?.unitPrice ?? "", quantity: s.items[0]?.quantity ?? "" });
  const save = useProcMutation(
    () =>
      procurementApi.revise(s.id, {
        expectedRowVersion: s.rowVersion,
        reason: v.reason,
        packagingCost: v.packagingCost || null,
        inlandTransportCost: v.inlandTransportCost || null,
        inspectionCost: v.inspectionCost || null,
        otherCharges: v.otherCharges || null,
        ...(s.items.length === 1 && (v.unitPrice !== s.items[0].unitPrice || v.quantity !== s.items[0].quantity) ? { items: [{ productId: s.items[0].productId, productName: s.items[0].productName, specification: s.items[0].specification, quantity: v.quantity, unit: s.items[0].unit, unitPrice: v.unitPrice, taxPercent: s.items[0].taxPercent }] } : {}),
      }),
    "Revision created — previous version kept in history",
    onClose,
  );
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Revise ${s.spoNumber}`} description="Creates revision with a new snapshot; the issued version is preserved. Not allowed after goods are received." className="max-w-lg"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={v.reason.trim().length < 3 || save.isPending} onClick={() => save.mutate(undefined)}>Create revision</Button></div>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Textarea label="Reason" required rows={2} containerClassName="sm:col-span-2" value={v.reason} onChange={set("reason")} />
        {s.items.length === 1 && <><Input label={`Quantity (${s.items[0].unit})`} inputMode="decimal" value={v.quantity} onChange={set("quantity")} /><Input label="Unit price" inputMode="decimal" value={v.unitPrice} onChange={set("unitPrice")} /></>}
        <Input label="Packaging (total)" inputMode="decimal" value={v.packagingCost} onChange={set("packagingCost")} />
        <Input label="Inland transport (total)" inputMode="decimal" value={v.inlandTransportCost} onChange={set("inlandTransportCost")} />
        <Input label="Inspection (total)" inputMode="decimal" value={v.inspectionCost} onChange={set("inspectionCost")} />
        <Input label="Other charges" inputMode="decimal" value={v.otherCharges} onChange={set("otherCharges")} />
      </div>
    </Modal>
  );
}

function ReceiveForm({ s }: { s: SupplierPoDetail }) {
  const [rows, setRows] = useState<Record<string, { rec: string; dmg: string }>>({});
  const [v, setV] = useState({ receivedAt: todayIso(), location: s.deliveryLocation ?? "", notes: "", overReceiptReason: "" });
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())));
  const [over, setOver] = useState(false);
  const save = useProcMutation(
    () => procurementApi.receive(s.id, { items: Object.entries(rows).filter(([, r]) => Number(r.rec) > 0).map(([id, r]) => ({ supplierPoItemId: id, receivedQuantity: r.rec, damagedQuantity: r.dmg || undefined })), receivedAt: v.receivedAt, location: v.location || undefined, notes: v.notes || undefined, idempotencyKey: `${key}-${Object.values(rows).map((r) => r.rec).join("-")}`, overReceiptReason: over ? v.overReceiptReason : undefined }),
    "Goods receipt recorded — inspect quality next",
    () => { setRows({}); setOver(false); },
  );
  return (
    <Card className="p-4 text-sm">
      <SectionTitle className="text-base">Receive goods</SectionTitle>
      <HelperText>Record what physically arrived. Partial deliveries keep the PO open. Quality is inspected separately.</HelperText>
      <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onError: (err) => /more than ordered/i.test(String((err as Error).message)) && setOver(true) }); }}>
        {s.items.map((i) => {
          const balance = Math.max(0, Number(i.quantity) - (Number(i.receivedQuantity) - Number(i.damagedQuantity) - Number(i.rejectedQuantity)));
          return (
            <div key={i.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_9rem_9rem]">
              <p className="self-center break-words">{i.productName} — balance {balance} {i.unit}</p>
              <Input aria-label={`Received quantity for ${i.productName}`} placeholder={`Received (${i.unit})`} inputMode="decimal" value={rows[i.id]?.rec ?? ""} onChange={(e) => setRows({ ...rows, [i.id]: { rec: e.target.value, dmg: rows[i.id]?.dmg ?? "" } })} />
              <Input aria-label={`Damaged quantity for ${i.productName}`} placeholder="Damaged" inputMode="decimal" value={rows[i.id]?.dmg ?? ""} onChange={(e) => setRows({ ...rows, [i.id]: { rec: rows[i.id]?.rec ?? "", dmg: e.target.value } })} />
            </div>
          );
        })}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Input label="Received on" type="date" value={v.receivedAt} onChange={(e) => setV({ ...v, receivedAt: e.target.value })} />
          <Input label="Location" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
          <Input label="Notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </div>
        {over && <Textarea label="Over-receipt reason (manager approval)" required rows={2} value={v.overReceiptReason} onChange={(e) => setV({ ...v, overReceiptReason: e.target.value })} />}
        <div><Button type="submit" disabled={save.isPending || !Object.values(rows).some((r) => Number(r.rec) > 0)}>Record goods receipt</Button></div>
      </form>
    </Card>
  );
}

function PayablePanel({ s }: { s: SupplierPoDetail }) {
  const p = s.payableDetail!;
  const can = useCan();
  const [v, setV] = useState({ amount: "", currency: p.currency, paidAt: todayIso(), method: "NEFT", reference: "", installmentId: "", fxRate: "", notes: "" });
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const pay = useProcMutation(() => procurementApi.pay(p.id, { amount: v.amount, currency: v.currency, paidAt: v.paidAt, method: v.method, reference: v.reference || undefined, installmentId: v.installmentId || undefined, fxRate: v.currency !== p.currency ? v.fxRate : undefined, notes: v.notes || undefined, expectedRowVersion: p.rowVersion }), "Supplier payment recorded", () => setV({ ...v, amount: "", reference: "", notes: "" }));
  const reverse = useProcMutation(() => procurementApi.reversePayment(reversing!, reason), "Payment reversed — record kept", () => { setReversing(null); setReason(""); });
  return (
    <Card className="overflow-x-auto p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><SectionTitle className="text-base">Supplier payable</SectionTitle><PayBadge status={p.status} /></div>
      <p className="mt-1">Total {money(p.total, p.currency)} · paid {money(p.paid, p.currency)} · outstanding {money(p.outstanding, p.currency)}</p>
      <table className="mt-2 w-full min-w-[620px]">
        <thead><tr className="text-left text-muted-foreground"><th className="py-1">Installment</th><th>Amount</th><th>Due</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead>
        <tbody>{p.installments.map((i) => <tr key={i.id} className="border-t border-border"><td className="py-1">{i.label}{i.percentage ? ` (${i.percentage}%)` : ""}</td><td>{money(i.amount, p.currency)}</td><td>{day(i.dueDate)}<Caption className="block">{i.dueBasis}</Caption></td><td>{money(i.paid, p.currency)}</td><td>{money(i.outstanding, p.currency)}</td><td><PayBadge status={i.status} /></td></tr>)}</tbody>
      </table>
      <SectionTitle className="mt-4 text-sm">Payments</SectionTitle>
      <ul className="mt-1 flex flex-col gap-1">
        {p.payments.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-2">
            <span className={x.status === "REVERSED" ? "line-through" : ""}>{money(x.amount, x.currency)} · {day(x.paidAt)} · {words(x.method)}{x.reference ? ` · ref ${x.reference}` : ""}</span>
            {x.status === "REVERSED" && <Badge variant="neutral">Reversed: {x.reversal?.reason}</Badge>}
            {x.status === "RECORDED" && can("supplier_payments.manage") && <Button size="sm" variant="ghost" onClick={() => setReversing(x.id)}>Reverse…</Button>}
          </li>
        ))}
        {!p.payments.length && <li className="text-muted-foreground">No payments recorded.</li>}
      </ul>
      {s.availableActions.includes("pay") && (
        <form className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); pay.mutate(undefined); }}>
          <Input label="Amount" required inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
          <Select label="Currency" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} options={[...new Set([p.currency, "INR", "USD"])].map((x) => ({ value: x, label: x }))} />
          {v.currency !== p.currency && <Input label={`Rate ${v.currency}→${p.currency}`} required inputMode="decimal" value={v.fxRate} onChange={(e) => setV({ ...v, fxRate: e.target.value })} />}
          <Input label="Paid on" type="date" value={v.paidAt} onChange={(e) => setV({ ...v, paidAt: e.target.value })} />
          <Select label="Method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })} options={METHODS} />
          <Input label="Bank reference / UTR" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
          <Select label="Apply to" value={v.installmentId} onChange={(e) => setV({ ...v, installmentId: e.target.value })} options={[{ value: "", label: "Oldest due first" }, ...p.installments.filter((i) => Number(i.outstanding) > 0).map((i) => ({ value: i.id, label: i.label }))]} />
          <div className="flex items-end"><Button type="submit" disabled={!v.amount || pay.isPending}>Record payment</Button></div>
        </form>
      )}
      <Caption className="mt-2 block">Payments settle the payable only — they are never added to procurement cost again.</Caption>
      <Modal open={Boolean(reversing)} onOpenChange={(o) => !o && setReversing(null)} title="Reverse supplier payment" description="The payment stays on record as reversed; its reference becomes reusable."
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setReversing(null)}>Cancel</Button><Button variant="destructive" disabled={reason.trim().length < 3 || reverse.isPending} onClick={() => reverse.mutate(undefined)}>Reverse</Button></div>}>
        <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </Card>
  );
}
