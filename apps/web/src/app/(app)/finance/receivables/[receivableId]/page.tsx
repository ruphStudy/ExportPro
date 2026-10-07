"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { ReceivableDetail } from "@exportpro/types";
import { BANK_CHARGE_TYPES, LC_STATUSES, PAYMENT_METHODS } from "@exportpro/types";
import { receivablesApi } from "@/lib/api/finance";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { ReasonDialog } from "@/components/commercial/shared";
import { day, FinanceTabs, money, opts, RECEIVABLE_STATUS, ReceivableBadge, todayIso, useFinanceMutation, words } from "@/components/finance/shared";
import { CopyButton } from "@/components/logistics/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function ReceivableDetailPage() {
  return (
    <RequirePermission permission="finance.view">
      <Detail />
    </RequirePermission>
  );
}

const row = (k: string, v: React.ReactNode) => (
  <div className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words">{v ?? "—"}</dd></div>
);

function Detail() {
  const { receivableId } = useParams<{ receivableId: string }>();
  const q = useQuery({ queryKey: ["finance", "receivable", receivableId], queryFn: () => receivablesApi.detail(receivableId) });
  const [pay, setPay] = useState(false);
  const [reverse, setReverse] = useState<string | null>(null);
  const [dispute, setDispute] = useState(false);
  const [close, setClose] = useState<"CANCELLED" | "UNCOLLECTIBLE" | null>(null);
  const rev = useFinanceMutation((r: string) => receivablesApi.reverse(reverse!, r), "Payment reversed", () => setReverse(null));
  const closeM = useFinanceMutation((r: string) => receivablesApi.update(receivableId, { expectedRowVersion: q.data?.rowVersion, state: close, reason: r }), "Receivable updated", () => setClose(null));
  const resolve = useFinanceMutation(() => receivablesApi.dispute(receivableId, { reason: "Dispute resolved", resolve: true }), "Dispute resolved");
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState title="Receivable not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const r = q.data;
  const a = (k: string) => r.availableActions.includes(k);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Receivables", href: "/finance/receivables" }, { label: r.receivableNumber }]} />
      <FinanceTabs />
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <PageTitle className="break-words">{r.receivableNumber}</PageTitle>
            <Caption className="block break-words">{r.buyer.name} · {words(r.paymentTermsType)} · created from agreed terms ({words(r.termsSnapshot.source)}{r.termsSnapshot.sourceReference ? ` ${r.termsSnapshot.sourceReference}` : ""})</Caption>
          </div>
          <div className="flex flex-wrap gap-2">
            {a("record_payment") && <Button size="sm" onClick={() => setPay(true)}>Record payment</Button>}
            {a("dispute") && (r.dispute ? <Button size="sm" variant="outline" onClick={() => resolve.mutate(undefined)}>Resolve dispute</Button> : <Button size="sm" variant="outline" onClick={() => setDispute(true)}>Mark disputed</Button>)}
            {a("dispute") && <Button size="sm" variant="ghost" onClick={() => setClose("UNCOLLECTIBLE")}>Mark uncollectible</Button>}
            {a("cancel") && <Button size="sm" variant="ghost" onClick={() => setClose("CANCELLED")}>Cancel</Button>}
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Receivable summary">
          {([["Total", money(r.totalAmount, r.currency)], ["Received", money(r.receivedAmount, r.currency)], ["Outstanding", money(r.outstandingAmount, r.currency)], ["Next due", day(r.nextDueDate)]] as const).map(([k, v]) => <li key={k}><Caption>{k}</Caption><p className="font-semibold">{v}</p></li>)}
        </ul>
        <div className="flex flex-wrap gap-1.5"><ReceivableBadge status={r.status} />{r.daysOverdue ? <Badge variant="danger">{r.daysOverdue} days overdue</Badge> : null}{r.customConfirmed && <Badge variant="warning">Custom schedule (user-confirmed)</Badge>}</div>
        {r.dispute && <p className="text-sm text-warning">Disputed {r.dispute.amount ? `${r.currency} ${r.dispute.amount}` : ""}: {r.dispute.reason} ({day(r.dispute.at)})</p>}
        {r.uncollectible && <p className="text-sm">Marked uncollectible: {r.uncollectible.reason} — operational status only, not an accounting write-off.</p>}
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TermsCard r={r} />
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Linked records</SectionTitle>
          <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {row("Buyer PO", <Link className="text-primary hover:underline" href={`/purchase-orders/${r.purchaseOrder.id}`}>{r.purchaseOrder.poNumber}</Link>)}
            {row("Proforma invoice", r.proformaInvoice ? <Link className="text-primary hover:underline" href={`/proforma-invoices/${r.proformaInvoice.id}`}>{r.proformaInvoice.number}</Link> : null)}
            {row("Quotation", r.quotation ? <Link className="text-primary hover:underline" href={`/quotations/${r.quotation.id}`}>{r.quotation.number}</Link> : null)}
            {row("Commercial invoice", r.commercialInvoice ? <Link className="text-primary hover:underline" href={`/documents/${r.commercialInvoice.id}`}>{r.commercialInvoice.number ?? "Draft"}</Link> : null)}
            {row("Shipment", r.shipment ? <Link className="text-primary hover:underline" href={`/shipments/${r.shipment.id}`}>{r.shipment.shipmentNumber}</Link> : null)}
            {row("Profitability", r.shipment ? <Link className="text-primary hover:underline" href={`/profitability/shipments/${r.shipment.id}`}>View</Link> : null)}
            {row("CRM lead", r.crmLeadId ? <Link className="text-primary hover:underline" href={`/crm/leads/${r.crmLeadId}`}>Open lead</Link> : null)}
            {row("Booking FX", r.bookingFx ? `1 ${r.bookingFx.from} = ${r.bookingFx.rate} ${r.bookingFx.to} (${r.bookingFx.sourceLabel ?? "—"}, ${r.bookingFx.sourceDate ?? "—"})` : r.currency)}
          </dl>
        </Card>
      </div>
      <Installments r={r} />
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Payment history</SectionTitle>
        <HelperText className="mt-1">Recorded payments are never edited or deleted — mistakes are reversed with a reason.</HelperText>
        {!r.payments.length ? <HelperText className="mt-2">No payments recorded.</HelperText> : (
          <ul className="mt-2 flex flex-col gap-2">
            {r.payments.map((p) => (
              <li key={p.id} className={`rounded-md border border-border p-3 ${p.status === "REVERSED" ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{money(p.amount, p.currency)} · {day(p.receivedAt)} · {words(p.paymentMethod)}</span>
                  <span className="flex gap-1">{p.status === "REVERSED" ? <Badge variant="danger">Reversed</Badge> : <Badge variant="success">Recorded</Badge>}{p.fxGainLoss && <Badge variant={Number(p.fxGainLoss) >= 0 ? "success" : "warning"}>FX {Number(p.fxGainLoss) >= 0 ? "gain" : "loss"} {money(p.fxGainLoss)}</Badge>}</span>
                </div>
                <Caption className="block break-words">Applied {money(p.appliedAmount, r.currency)}{Number(p.excessAmount) > 0 ? ` · excess ${money(p.excessAmount)} (${p.overpaymentReason})` : ""}{p.bankReference ? ` · bank ref ${p.bankReference}` : ""}{p.remittanceReference ? ` · remittance ${p.remittanceReference}` : ""}{p.bankName ? ` · ${p.bankName}` : ""}{p.recordedBy ? ` · by ${p.recordedBy}` : ""}</Caption>
                {p.fx && <Caption className="block">FX: 1 {p.fx.from} = {p.fx.rate} {p.fx.to} ({p.fx.sourceLabel ?? "—"}, {p.fx.sourceDate ?? "—"}) → {money(p.fx.convertedAmount, p.fx.to)}</Caption>}
                {p.settlementFx && <Caption className="block">Settlement rate: 1 {p.settlementFx.from} = {p.settlementFx.rate} {p.settlementFx.to} ({p.settlementFx.sourceLabel ?? "—"})</Caption>}
                {p.charges.length > 0 && <Caption className="block">Charges: {p.charges.map((c) => `${words(c.type)} ${money(c.amount, c.currency)}`).join(" · ")}</Caption>}
                {p.reversal && <Caption className="block text-danger">Reversed {day(p.reversal.at)}{p.reversal.by ? ` by ${p.reversal.by}` : ""}: {p.reversal.reason}</Caption>}
                {p.status === "RECORDED" && a("reverse_payment") && <Button className="mt-2" size="sm" variant="ghost" onClick={() => setReverse(p.id)}>Reverse…</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {r.paymentTermsType === "LETTER_OF_CREDIT" && <LcCard r={r} />}
      <RemindersCard r={r} />
      <Card className="p-4">
        <SectionTitle className="text-base">Activity</SectionTitle>
        {r.notes && <p className="mt-1 text-sm">Notes: {r.notes}</p>}
        <ol className="mt-3 flex flex-col gap-2 border-l border-border pl-4">
          {r.events.map((e) => <li key={e.id} className="relative text-sm"><span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" aria-hidden="true" /><p className="break-words">{e.title}</p><Caption>{new Date(e.createdAt).toLocaleString()}{e.actor ? ` · ${e.actor}` : ""}</Caption></li>)}
        </ol>
      </Card>
      {pay && <PaymentDialog r={r} onClose={() => setPay(false)} />}
      {dispute && <DisputeDialog r={r} onClose={() => setDispute(false)} />}
      <ReasonDialog open={!!reverse} onOpenChange={(o) => !o && setReverse(null)} title="Reverse payment" description="The original record is kept and marked reversed; balances are restored." confirmLabel="Reverse" destructive loading={rev.isPending} onConfirm={(x) => rev.mutate(x)} />
      <ReasonDialog open={!!close} onOpenChange={(o) => !o && setClose(null)} title={close === "CANCELLED" ? "Cancel receivable" : "Mark uncollectible"} description={close === "UNCOLLECTIBLE" ? "Operational status only — this is not an accounting write-off." : "Only possible when no payments are recorded."} confirmLabel="Confirm" destructive loading={closeM.isPending} onConfirm={(x) => closeM.mutate(x)} />
    </div>
  );
}

function TermsCard({ r }: { r: ReceivableDetail }) {
  const [f, setF] = useState({ invoiceDate: r.invoiceDate ?? "", termDays: r.termDays?.toString() ?? "", documentsPresentedAt: r.documentsPresentedAt ?? "", collectingBank: r.collectingBank ?? "", acceptedAt: r.acceptedAt ?? "", tenorDays: r.tenorDays?.toString() ?? "" });
  const save = useFinanceMutation(() => {
    const b: Record<string, unknown> = { expectedRowVersion: r.rowVersion };
    if (r.paymentTermsType === "OPEN_ACCOUNT") Object.assign(b, { invoiceDate: f.invoiceDate || null, termDays: f.termDays ? Number(f.termDays) : null });
    if (r.paymentTermsType === "DOCUMENTS_AGAINST_PAYMENT" || r.paymentTermsType === "DOCUMENTS_AGAINST_ACCEPTANCE") Object.assign(b, { documentsPresentedAt: f.documentsPresentedAt || null, collectingBank: f.collectingBank || null });
    if (r.paymentTermsType === "DOCUMENTS_AGAINST_ACCEPTANCE") Object.assign(b, { acceptedAt: f.acceptedAt || null, tenorDays: f.tenorDays ? Number(f.tenorDays) : null });
    return receivablesApi.update(r.id, b);
  }, "Saved");
  const editable = r.availableActions.includes("edit") && ["OPEN_ACCOUNT", "DOCUMENTS_AGAINST_PAYMENT", "DOCUMENTS_AGAINST_ACCEPTANCE"].includes(r.paymentTermsType);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card className="p-4 text-sm">
      <SectionTitle className="text-base">Payment terms (snapshot)</SectionTitle>
      <p className="mt-1 break-words">“{r.termsSnapshot.wording ?? "No wording — custom schedule"}”</p>
      <Caption className="block">Captured {new Date(r.termsSnapshot.capturedAt).toLocaleString()} · PO {r.termsSnapshot.references.purchaseOrder ?? "—"} · PI {r.termsSnapshot.references.proformaInvoice ?? "—"} · Quotation {r.termsSnapshot.references.quotation ?? "—"}</Caption>
      {r.maturityDate && <p className="mt-1">Maturity: {day(r.maturityDate)}</p>}
      {editable && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {r.paymentTermsType === "OPEN_ACCOUNT" && <><Input type="date" label="Invoice date" value={f.invoiceDate} onChange={set("invoiceDate")} /><Input label="Credit days" inputMode="numeric" value={f.termDays} onChange={set("termDays")} /></>}
          {r.paymentTermsType !== "OPEN_ACCOUNT" && <><Input type="date" label="Documents presented / handed over" value={f.documentsPresentedAt} onChange={set("documentsPresentedAt")} /><Input label="Collecting bank" value={f.collectingBank} onChange={set("collectingBank")} /></>}
          {r.paymentTermsType === "DOCUMENTS_AGAINST_ACCEPTANCE" && <><Input type="date" label="Acceptance date" value={f.acceptedAt} onChange={set("acceptedAt")} /><Input label="Tenor days" inputMode="numeric" value={f.tenorDays} onChange={set("tenorDays")} /></>}
          <div className="sm:col-span-2"><Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Save dates</Button></div>
        </div>
      )}
    </Card>
  );
}

function Installments({ r }: { r: ReceivableDetail }) {
  const [edit, setEdit] = useState<{ id: string; date: string } | null>(null);
  const save = useFinanceMutation(() => receivablesApi.installmentDate(r.id, edit!.id, { expectedRowVersion: r.rowVersion, fixedDate: edit!.date || null }), "Due date set", () => setEdit(null));
  return (
    <Card className="p-4 text-sm">
      <SectionTitle className="text-base">Installments</SectionTitle>
      <ul className="mt-2 flex flex-col gap-2">
        {r.installments.map((i) => (
          <li key={i.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{i.sequence}. {i.label}{i.percentage ? ` (${Number(i.percentage)}%)` : ""}</span>
              <span className="flex flex-wrap items-center gap-1"><Badge variant={RECEIVABLE_STATUS[i.status].variant}>{RECEIVABLE_STATUS[i.status].label}</Badge>{i.daysOverdue ? <Caption>{i.daysOverdue} d overdue</Caption> : null}</span>
            </div>
            <Caption className="block">Amount {money(i.amount, r.currency)} · paid {money(i.paidAmount)} · outstanding {money(i.outstandingAmount)} · due {day(i.dueDate)} ({i.dueBasis})</Caption>
            {i.dispute && <Caption className="block text-warning">Disputed: {i.dispute.reason}</Caption>}
            {r.availableActions.includes("edit") && ["MANUAL", "FIXED_DATE", "BEFORE_PRODUCTION", "BEFORE_SHIPMENT"].includes(i.triggerType) && r.paymentTermsType !== "OPEN_ACCOUNT" && (
              edit?.id === i.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2"><Input type="date" aria-label="Due date" value={edit.date} onChange={(e) => setEdit({ id: i.id, date: e.target.value })} /><Button size="sm" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
              ) : <Button className="mt-1" size="sm" variant="ghost" onClick={() => setEdit({ id: i.id, date: i.fixedDate ?? "" })}>Set agreed date</Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PaymentDialog({ r, onClose }: { r: ReceivableDetail; onClose: () => void }) {
  const open = r.installments.filter((i) => i.status !== "PAID");
  const [f, setF] = useState({ installmentId: open[0]?.id ?? "", amount: open[0]?.outstandingAmount ?? "", currency: r.currency, receivedAt: todayIso(), paymentMethod: r.paymentTermsType === "LETTER_OF_CREDIT" ? "LC" : r.paymentTermsType.startsWith("DOCUMENTS") ? "COLLECTION" : "BANK_TRANSFER", bankReference: "", remittanceReference: "", bankName: "", notes: "", fxRate: "", fxSource: "", settleRate: "", allow: false, overReason: "" });
  const [charges, setCharges] = useState<{ type: string; amount: string; currency: string }[]>([]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const foreign = f.currency !== r.currency;
  const needsSettle = r.bookingFx !== null;
  const mut = useFinanceMutation(() => receivablesApi.pay(r.id, {
    expectedRowVersion: r.rowVersion,
    installmentId: f.installmentId || undefined,
    amount: f.amount,
    currency: f.currency,
    receivedAt: f.receivedAt,
    paymentMethod: f.paymentMethod,
    bankReference: f.bankReference.trim() || undefined,
    remittanceReference: f.remittanceReference.trim() || undefined,
    bankName: f.bankName.trim() || undefined,
    notes: f.notes.trim() || undefined,
    fx: foreign && f.fxRate ? { rate: f.fxRate, sourceLabel: f.fxSource || undefined, sourceDate: f.receivedAt } : undefined,
    settlementFx: needsSettle && f.settleRate ? { rate: f.settleRate, sourceLabel: "Bank credit advice", sourceDate: f.receivedAt } : undefined,
    charges: charges.filter((c) => c.amount).length ? charges.filter((c) => c.amount) : undefined,
    allowOverpayment: f.allow || undefined,
    overpaymentReason: f.allow ? f.overReason : undefined,
  }), "Payment recorded", onClose);
  return (
    <Modal className="max-w-2xl" open onOpenChange={(o) => !o && onClose()} title="Record payment" description="Record money actually received. Nothing is collected or confirmed with any bank." footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={mut.isPending || !f.amount || (foreign && !f.fxRate)} onClick={() => mut.mutate(undefined)}>Record</Button></div>}>
      <div className="grid max-h-[62vh] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
        <Select containerClassName="sm:col-span-2" label="Installment" value={f.installmentId} onChange={set("installmentId")} options={[{ value: "", label: "Oldest outstanding first" }, ...open.map((i) => ({ value: i.id, label: `${i.label} — ${money(i.outstandingAmount, r.currency)} outstanding` }))]} />
        <Input label="Amount received" required inputMode="decimal" value={f.amount} onChange={set("amount")} />
        <Input label="Currency" required maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
        <Input type="date" label="Received on" required value={f.receivedAt} onChange={set("receivedAt")} />
        <Select label="Method" value={f.paymentMethod} onChange={set("paymentMethod")} options={opts(PAYMENT_METHODS)} />
        <Input label="Bank reference (UTR)" value={f.bankReference} onChange={set("bankReference")} description="Used to block duplicate entries; shown masked." />
        <Input label="Remittance reference" value={f.remittanceReference} onChange={set("remittanceReference")} />
        <Input label="Bank" value={f.bankName} onChange={set("bankName")} />
        {foreign && <><Input label={`FX: 1 ${f.currency} = ? ${r.currency}`} required inputMode="decimal" value={f.fxRate} onChange={set("fxRate")} /><Input label="FX source" value={f.fxSource} onChange={set("fxSource")} placeholder="Bank advice" /></>}
        {needsSettle && <Input containerClassName="sm:col-span-2" label={`Settlement rate: 1 ${r.currency} = ? ${r.bookingFx?.to}`} inputMode="decimal" value={f.settleRate} onChange={set("settleRate")} description={`Actual rate credited by your bank (booking rate ${r.bookingFx?.rate}). Needed for FX gain/loss; never estimated.`} />}
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Bank charges deducted (actuals)</legend>
          {charges.map((c, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <Select aria-label="Charge type" value={c.type} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} options={opts(BANK_CHARGE_TYPES)} />
              <Input aria-label="Charge amount" inputMode="decimal" value={c.amount} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <Input aria-label="Charge currency" maxLength={3} value={c.currency} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, currency: e.target.value.toUpperCase() } : x)))} />
            </div>
          ))}
          <Button className="self-start" size="sm" variant="outline" onClick={() => setCharges([...charges, { type: "BANK_CHARGES", amount: "", currency: r.currency }])}>Add charge</Button>
        </fieldset>
        <Textarea containerClassName="sm:col-span-2" label="Notes" rows={2} value={f.notes} onChange={set("notes")} />
        <div className="sm:col-span-2"><Checkbox checked={f.allow} onChange={(e) => setF({ ...f, allow: e.target.checked })} label="Allow an overpayment (excess is recorded, never applied below zero)" /></div>
        {f.allow && <Input containerClassName="sm:col-span-2" label="Overpayment reason" required value={f.overReason} onChange={set("overReason")} />}
      </div>
    </Modal>
  );
}

function DisputeDialog({ r, onClose }: { r: ReceivableDetail; onClose: () => void }) {
  const [f, setF] = useState({ installmentId: "", amount: "", reason: "", notes: "" });
  const mut = useFinanceMutation(() => receivablesApi.dispute(r.id, { expectedRowVersion: r.rowVersion, installmentId: f.installmentId || undefined, amount: f.amount || null, reason: f.reason, notes: f.notes || undefined }), "Marked disputed", onClose);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Mark disputed" description="The receivable is kept; it is excluded from due/overdue until resolved." footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={f.reason.trim().length < 3 || mut.isPending} onClick={() => mut.mutate(undefined)}>Save</Button></div>}>
      <div className="flex flex-col gap-3">
        <Select label="Applies to" value={f.installmentId} onChange={(e) => setF({ ...f, installmentId: e.target.value })} options={[{ value: "", label: "Whole receivable" }, ...r.installments.map((i) => ({ value: i.id, label: i.label }))]} />
        <Input label={`Amount disputed (${r.currency})`} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Textarea label="Reason" required rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <Textarea label="Notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
    </Modal>
  );
}

function LcCard({ r }: { r: ReceivableDetail }) {
  const lc = r.letterOfCredit;
  const [f, setF] = useState({ lcNumber: lc?.lcNumber ?? "", issuingBank: lc?.issuingBank ?? "", advisingBank: lc?.advisingBank ?? "", amount: lc?.amount ?? r.totalAmount, issueDate: lc?.issueDate ?? "", expiryDate: lc?.expiryDate ?? "", latestShipmentDate: lc?.latestShipmentDate ?? "", presentationDeadline: lc?.presentationDeadline ?? "", status: lc?.status ?? "RECEIVED" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const body = () => ({ lcNumber: f.lcNumber, issuingBank: f.issuingBank, advisingBank: f.advisingBank || null, amount: f.amount, issueDate: f.issueDate || null, expiryDate: f.expiryDate || null, latestShipmentDate: f.latestShipmentDate || null, presentationDeadline: f.presentationDeadline || null, status: f.status });
  const save = useFinanceMutation((): Promise<unknown> => (lc ? receivablesApi.updateLc(lc.id, { ...body(), expectedRowVersion: lc.rowVersion }) : receivablesApi.createLc(r.id, body())), "Letter of credit saved");
  const can = r.availableActions.includes("letter_of_credit");
  return (
    <Card className="p-4 text-sm">
      <SectionTitle className="text-base">Letter of credit</SectionTitle>
      <HelperText className="mt-1">Operational tracking only — no SWIFT messages, bank API or document submission.</HelperText>
      {lc && <div className="mt-2 flex flex-wrap gap-1.5"><Badge variant={lc.status === "EXPIRED" ? "danger" : "info"}>{words(lc.status)}</Badge>{lc.daysToExpiry !== null && <Badge variant={lc.daysToExpiry < 15 ? "warning" : "neutral"}>{lc.daysToExpiry >= 0 ? `Expires in ${lc.daysToExpiry} d` : "Expired"}</Badge>}</div>}
      {lc && (
        <ul className="mt-2 flex flex-col gap-1">{lc.documents.map((d) => <li key={d.requirement} className="flex flex-wrap justify-between gap-2"><span>{d.requirement}</span>{d.documentId ? <Link className="text-primary hover:underline" href={`/documents/${d.documentId}`}>{d.documentTitle} ({words(d.documentStatus ?? "")})</Link> : <Caption>No document linked</Caption>}</li>)}</ul>
      )}
      {can && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input label="LC number" required value={f.lcNumber} onChange={set("lcNumber")} />
          <Input label="Issuing bank" required value={f.issuingBank} onChange={set("issuingBank")} />
          <Input label="Advising bank" value={f.advisingBank} onChange={set("advisingBank")} />
          <Input label={`Amount (${r.currency})`} inputMode="decimal" value={f.amount} onChange={set("amount")} />
          <Input type="date" label="Issue date" value={f.issueDate} onChange={set("issueDate")} />
          <Input type="date" label="Expiry date" value={f.expiryDate} onChange={set("expiryDate")} />
          <Input type="date" label="Latest shipment date" value={f.latestShipmentDate} onChange={set("latestShipmentDate")} />
          <Input type="date" label="Presentation deadline" value={f.presentationDeadline} onChange={set("presentationDeadline")} />
          <Select label="Status" value={f.status} onChange={set("status")} options={opts(LC_STATUSES)} />
          <div className="sm:col-span-3"><Button size="sm" disabled={save.isPending || f.lcNumber.length < 2 || f.issuingBank.length < 2} onClick={() => save.mutate(undefined)}>{lc ? "Update LC" : "Record LC"}</Button></div>
        </div>
      )}
    </Card>
  );
}

function RemindersCard({ r }: { r: ReceivableDetail }) {
  const [channel, setChannel] = useState("EMAIL");
  const gen = useFinanceMutation(() => receivablesApi.createReminder(r.id, {}), "Reminder drafted");
  const sent = useFinanceMutation((id: string) => receivablesApi.reminderSent(id, channel), "Recorded as sent");
  const dismiss = useFinanceMutation((id: string) => receivablesApi.dismissReminder(id), "Dismissed");
  const can = r.availableActions.includes("reminders");
  return (
    <Card className="p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="text-base">Payment reminders</SectionTitle>
        {can && r.status !== "PAID" && <Button size="sm" variant="outline" disabled={gen.isPending} onClick={() => gen.mutate(undefined)}>Draft reminder</Button>}
      </div>
      <HelperText className="mt-1">Drafts use the recorded amount and due date. ExportPro does not send them — copy, send yourself, then record it.</HelperText>
      {!r.reminders.length ? <HelperText className="mt-2">No reminders.</HelperText> : (
        <ul className="mt-2 flex flex-col gap-2">
          {r.reminders.map((m) => (
            <li key={m.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2"><Badge variant={m.status === "RECORDED_SENT" ? "success" : "neutral"}>{m.status === "RECORDED_SENT" ? `Recorded as sent via ${words(m.channel ?? "OTHER")} (outside ExportPro)` : "Draft — not sent"}</Badge><span className="font-medium">{words(m.kind)}</span></div>
              <p className="mt-1 font-medium break-words">{m.subject}</p>
              <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-muted-foreground">{m.message}</pre>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <CopyButton text={`${m.subject}\n\n${m.message}`} />
                {can && m.status === "DRAFT" && (
                  <>
                    <Select aria-label="Channel used" containerClassName="w-36" value={channel} onChange={(e) => setChannel(e.target.value)} options={opts(["EMAIL", "WHATSAPP", "PHONE", "OTHER"])} />
                    <Button size="sm" variant="outline" onClick={() => sent.mutate(m.id)}>I sent this</Button>
                    <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(m.id)}>Dismiss</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
