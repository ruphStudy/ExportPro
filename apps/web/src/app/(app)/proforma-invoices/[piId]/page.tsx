"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Lock, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import type { PiDetail } from "@exportpro/types";
import { COUNTRIES, countryLabel } from "@exportpro/types";
import { commercialApi, fmtAmount, piApi } from "@/lib/api/commercial";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { PI_STATUS, PO_STATUS } from "@/lib/commercial-labels";
import { toast } from "@/lib/toast";
import { CommercialTimeline, IssueProblems, ReasonDialog, TermsSelects, useCommercialMutation } from "@/components/commercial/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function PiDetailPage() {
  return (
    <RequirePermission permission="proforma_invoice.view">
      <PiView />
    </RequirePermission>
  );
}

function PiView() {
  const { piId } = useParams<{ piId: string }>();
  const q = useQuery({ queryKey: ["commercial", "pi", piId], queryFn: () => piApi.get(piId), retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2 });
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState title="Proforma invoice not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Proforma invoices", href: "/proforma-invoices" }, { label: d.displayNumber }]} />
      <Header d={d} />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {d.availableActions.includes("edit") ? <PiEditor key={`${d.id}-${d.rowVersion}`} d={d} /> : <PiReadOnly d={d} />}
          <Bank d={d} />
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Related records">
          <PiLinks d={d} />
          <CommercialTimeline events={d.events} />
        </aside>
      </div>
    </div>
  );
}

function Header({ d }: { d: PiDetail }) {
  const router = useRouter();
  const can = (a: string) => d.availableActions.includes(a);
  const [dialog, setDialog] = React.useState<null | "issue" | "revise" | "cancel">(null);
  const close = () => setDialog(null);
  const issue = useCommercialMutation(() => piApi.issue(d.id, d.rowVersion), "Proforma invoice issued — it is now locked", close);
  const revise = useCommercialMutation((r: string) => piApi.revise(d.id, r), "Revision created", (n) => router.push(`/proforma-invoices/${n.id}`));
  const cancel = useCommercialMutation((r: string) => piApi.cancel(d.id, r, d.rowVersion), "Proforma invoice cancelled", close);
  const st = PI_STATUS[d.status];
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Caption className="font-medium uppercase tracking-wide">Proforma invoice{d.revision > 1 ? ` · revision ` : ""}</Caption>
          <PageTitle className="break-words">{d.displayNumber} · {d.buyer.name}</PageTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={st.variant}>{st.label}</Badge>
            {d.source === "MANUAL" && <Badge variant="warning">Manual — no quotation</Badge>}
            {d.status !== "DRAFT" && <Caption className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden="true" />Locked after issue.</Caption>}
            <span>{fmtAmount(d.totalAmount, d.currency)}</span>
          </div>
          {d.overrideReason && <HelperText className="mt-1">Created before quotation acceptance (override): {d.overrideReason}</HelperText>}
          {d.revisionReason && <HelperText className="mt-1">Revision reason: {d.revisionReason}</HelperText>}
        </div>
        <div className="flex flex-wrap gap-2">
          {can("download") && <Button asChild size="sm" variant="outline"><a href={piApi.pdfHref(d.id)} download><Download className="size-4" aria-hidden="true" />{d.status === "DRAFT" ? "Draft PDF" : "PDF"}</a></Button>}
          {can("issue") && <Button size="sm" onClick={() => setDialog("issue")}>Issue PI</Button>}
          {can("revise") && <Button size="sm" variant="outline" onClick={() => setDialog("revise")}>Revise</Button>}
          {can("record_po") && <Button asChild size="sm" variant="outline"><Link href={`/purchase-orders/new?proformaInvoiceId=${d.id}${d.quotation ? `&quotationId=${d.quotation.id}` : ""}${d.buyer.id ? `&buyerCompanyId=${d.buyer.id}` : ""}`}>Record buyer PO</Link></Button>}
          {can("cancel") && <Button size="sm" variant="ghost" onClick={() => setDialog("cancel")}>Cancel</Button>}
        </div>
      </div>
      {d.differencesFromQuotation.length > 0 && (
        <div role="note" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <p className="flex items-center gap-1 font-medium"><AlertTriangle className="size-4 text-warning" aria-hidden="true" />Differs from {d.quotation?.displayNumber ?? "the quotation"}</p>
          <ul className="mt-1 list-disc pl-5">{d.differencesFromQuotation.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {d.status === "DRAFT" && <IssueProblems problems={d.issueProblems} />}
      {d.cancellation && <p className="text-sm">Cancelled {new Date(d.cancellation.at).toLocaleDateString()}: {d.cancellation.reason}</p>}
      <ConfirmDialog open={dialog === "issue"} onOpenChange={(o) => !o && close()} title={`Issue ${d.displayNumber}?`} description="Buyer, exporter, items, terms, totals and bank details are snapshotted and locked. Nothing is emailed automatically." confirmLabel="Issue" loading={issue.isPending} confirmDisabled={d.issueProblems.length > 0} onConfirm={() => issue.mutate(undefined)}>
        <IssueProblems problems={d.issueProblems} />
      </ConfirmDialog>
      <ReasonDialog open={dialog === "revise"} onOpenChange={(o) => !o && close()} title="Create a PI revision" description="The current PI becomes superseded once the revision is issued." label="Revision reason" confirmLabel="Create revision" loading={revise.isPending} onConfirm={(r) => revise.mutate(r)} />
      <ReasonDialog open={dialog === "cancel"} onOpenChange={(o) => !o && close()} title="Cancel proforma invoice" confirmLabel="Cancel PI" destructive loading={cancel.isPending} onConfirm={(r) => cancel.mutate(r)} />
    </header>
  );
}

interface Line { key: string; id?: string; quotationItemId: string | null; description: string; hsCode: string; specification: string; packaging: string; quantity: string; unit: string; unitPrice: string }
const n = (v: string) => v.trim() || null;
let seq = 0;

function PiEditor({ d }: { d: PiDetail }) {
  const [f, setF] = React.useState({
    currency: d.currency,
    incoterm: d.incoterm,
    incotermPlace: d.incotermPlace ?? "",
    validUntil: d.validUntil ?? "",
    destinationCountry: d.destinationCountry ?? "",
    destinationPort: d.destinationPort ?? "",
    paymentTerms: d.paymentTerms ?? "",
    deliveryTerms: d.deliveryTerms ?? "",
    buyerNotes: d.buyerNotes ?? "",
    internalNotes: d.internalNotes ?? "",
    terms: d.terms ?? "",
    additionalCharges: d.additionalCharges === "0.00" ? "" : d.additionalCharges,
    chargesLabel: d.chargesLabel ?? "",
    discount: d.discount === "0.00" ? "" : d.discount,
  });
  const [items, setItems] = React.useState<Line[]>(d.items.map((i) => ({ key: i.id, id: i.id, quotationItemId: i.quotationItemId, description: i.description, hsCode: i.hsCode ?? "", specification: i.specification ?? "", packaging: i.packaging ?? "", quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice })));
  const set = (k: keyof typeof f, v: string | null) => setF((p) => ({ ...p, [k]: v ?? "" }));
  const setItem = (key: string, patch: Partial<Line>) => setItems((p) => p.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const save = useCommercialMutation(
    () =>
      piApi.update(d.id, {
        expectedRowVersion: d.rowVersion,
        currency: f.currency,
        incoterm: f.incoterm,
        incotermPlace: n(f.incotermPlace),
        validUntil: n(f.validUntil),
        destinationCountry: n(f.destinationCountry),
        destinationPort: n(f.destinationPort),
        paymentTerms: n(f.paymentTerms),
        deliveryTerms: n(f.deliveryTerms),
        buyerNotes: n(f.buyerNotes),
        internalNotes: n(f.internalNotes),
        terms: n(f.terms),
        additionalCharges: f.additionalCharges.trim() || "0",
        chargesLabel: n(f.chargesLabel),
        discount: f.discount.trim() || "0",
        items: items.map((i) => ({ id: i.id, quotationItemId: i.quotationItemId, description: i.description.trim(), hsCode: n(i.hsCode), specification: n(i.specification), packaging: n(i.packaging), quantity: i.quantity.trim(), unit: i.unit.trim(), unitPrice: i.unitPrice.trim() })),
      }),
    "Proforma invoice saved",
  );
  const starter = useCommercialMutation(() => commercialApi.starterTerms(), undefined, (t) => {
    set("terms", f.terms ? `${f.terms}\n\n${t.text}` : t.text);
    toast.info("Starter terms inserted", t.notice);
  });
  return (
    <form className="flex flex-col gap-4" aria-label="Proforma invoice editor" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">Header</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TermsSelects currency={f.currency} incoterm={f.incoterm} onCurrency={(v) => set("currency", v)} onIncoterm={(v) => set("incoterm", v)} />
          <Input label="Named place" value={f.incotermPlace} onChange={(e) => set("incotermPlace", e.target.value)} maxLength={80} />
          <Input label="Valid until" type="date" value={f.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
          <Select label="Destination country" placeholder="—" value={f.destinationCountry} onChange={(e) => set("destinationCountry", e.target.value)} options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))} />
          <Input label="Destination port" value={f.destinationPort} onChange={(e) => set("destinationPort", e.target.value)} maxLength={80} />
        </div>
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Items</SectionTitle>
          <Button type="button" size="sm" variant="outline" disabled={items.length >= 50} onClick={() => setItems((p) => [...p, { key: `new-${++seq}`, quotationItemId: null, description: "", hsCode: "", specification: "", packaging: "", quantity: "", unit: "MT", unitPrice: "" }])}><Plus className="size-4" aria-hidden="true" />Add item</Button>
        </div>
        {d.source === "QUOTATION" && <HelperText>Copied from the quotation. Any change is listed as a difference above after saving.</HelperText>}
        <ol className="flex flex-col gap-3">
          {items.map((i, idx) => (
            <li key={i.key} className="rounded-md border border-border p-3">
              <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <legend className="sr-only">Item {idx + 1}</legend>
                <Input label={`Item ${idx + 1} description`} required value={i.description} onChange={(e) => setItem(i.key, { description: e.target.value })} maxLength={300} containerClassName="sm:col-span-2 lg:col-span-3" />
                <Input label="HS code" value={i.hsCode} onChange={(e) => setItem(i.key, { hsCode: e.target.value })} maxLength={10} />
                <Input label="Quantity" required inputMode="decimal" value={i.quantity} onChange={(e) => setItem(i.key, { quantity: e.target.value })} />
                <Input label="Unit" required value={i.unit} onChange={(e) => setItem(i.key, { unit: e.target.value.toUpperCase() })} maxLength={20} />
                <Input label="Specification" value={i.specification} onChange={(e) => setItem(i.key, { specification: e.target.value })} maxLength={1000} containerClassName="sm:col-span-2 lg:col-span-3" />
                <Input label="Packaging" value={i.packaging} onChange={(e) => setItem(i.key, { packaging: e.target.value })} maxLength={500} containerClassName="lg:col-span-2" />
                <Input label={`Unit price (${f.currency})`} required inputMode="decimal" value={i.unitPrice} onChange={(e) => setItem(i.key, { unitPrice: e.target.value })} />
              </fieldset>
              <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setItems((p) => p.filter((x) => x.key !== i.key))} aria-label={`Remove item ${idx + 1}`}><Trash2 className="size-4" aria-hidden="true" />Remove</Button>
            </li>
          ))}
        </ol>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Additional charges" inputMode="decimal" value={f.additionalCharges} onChange={(e) => set("additionalCharges", e.target.value)} placeholder="0.00" />
          <Input label="Charges label" value={f.chargesLabel} onChange={(e) => set("chargesLabel", e.target.value)} maxLength={80} />
          <Input label="Discount" inputMode="decimal" value={f.discount} onChange={(e) => set("discount", e.target.value)} placeholder="0.00" />
        </div>
        <p className="text-sm">Saved total: <strong>{fmtAmount(d.totalAmount, d.currency)}</strong></p>
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">Terms</SectionTitle>
        <div className="grid gap-3 lg:grid-cols-2">
          <Textarea label="Payment terms" rows={2} value={f.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} maxLength={1000} />
          <Textarea label="Delivery terms" rows={2} value={f.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} maxLength={1000} />
          <Textarea label="Notes to buyer" rows={3} value={f.buyerNotes} onChange={(e) => set("buyerNotes", e.target.value)} maxLength={3000} />
          <Textarea label="Internal notes (never shown to the buyer)" rows={3} value={f.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} maxLength={3000} />
        </div>
        <Textarea label="Terms & conditions" rows={5} value={f.terms} onChange={(e) => set("terms", e.target.value)} maxLength={20000} />
        <div><Button type="button" size="sm" variant="outline" onClick={() => starter.mutate(undefined)} loading={starter.isPending}>Insert starter terms</Button><Caption className="ml-2">Starter template only — not legal advice.</Caption></div>
      </Card>
      <div className="sticky bottom-0 z-10 -mx-1 flex justify-end gap-2 border-t border-border bg-background/95 px-1 py-3">
        <Button type="submit" loading={save.isPending}>Save draft</Button>
      </div>
    </form>
  );
}

function PiReadOnly({ d }: { d: PiDetail }) {
  const by = d.buyerSnapshot;
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6" aria-label="Proforma invoice">
      <div className="flex flex-wrap justify-between gap-4 text-sm">
        <div className="min-w-0">
          <p className="font-semibold">{d.exporterSnapshot?.name}</p>
          {d.exporterSnapshot?.address && <p className="whitespace-pre-line">{d.exporterSnapshot.address}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-lg font-semibold">PROFORMA INVOICE</p>
          <p>{d.displayNumber}</p>
          {d.issueDate && <p>Date: {d.issueDate}</p>}
          {d.validUntil && <p>Valid until: {d.validUntil}</p>}
        </div>
      </div>
      <div className="text-sm">
        <SectionTitle className="text-sm">To</SectionTitle>
        <p className="font-medium">{by?.name ?? d.buyer.name}</p>
        {by?.address && <p className="whitespace-pre-line">{by.address}</p>}
        {(by?.country ?? d.buyer.countryCode) && <p>{by?.country ?? countryLabel(d.buyer.countryCode!)}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">Items</caption>
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>{["Description", "Qty", "Unit price", "Amount"].map((h) => <th key={h} scope="col" className={`px-2 py-1.5 font-medium ${h === "Description" ? "text-left" : "text-right"}`}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.id} className="border-b border-border align-top">
                <td className="px-2 py-1.5">{i.description}{(i.hsCode || i.specification) && <Caption className="block">{[i.hsCode && `HS ${i.hsCode}`, i.specification, i.packaging].filter(Boolean).join(" · ")}</Caption>}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right">{i.quantity} {i.unit}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right">{fmtAmount(i.unitPrice)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right">{fmtAmount(i.totalPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-1 text-sm">
        <dt>Subtotal</dt><dd className="text-right">{fmtAmount(d.subtotal, d.currency)}</dd>
        {d.additionalCharges !== "0.00" && <><dt>{d.chargesLabel ?? "Charges"}</dt><dd className="text-right">{fmtAmount(d.additionalCharges, d.currency)}</dd></>}
        {d.discount !== "0.00" && <><dt>Discount</dt><dd className="text-right">-{fmtAmount(d.discount, d.currency)}</dd></>}
        <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{fmtAmount(d.totalAmount, d.currency)}</dd>
      </dl>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {d.incoterm && <><dt className="font-medium">Incoterm</dt><dd>{d.incoterm}{d.incotermPlace ? ` ${d.incotermPlace}` : ""}</dd></>}
        {d.paymentTerms && <><dt className="font-medium">Payment</dt><dd className="whitespace-pre-line">{d.paymentTerms}</dd></>}
        {d.deliveryTerms && <><dt className="font-medium">Delivery</dt><dd className="whitespace-pre-line">{d.deliveryTerms}</dd></>}
      </dl>
      {d.terms && <p className="whitespace-pre-line text-xs">{d.terms}</p>}
      <Caption>Proforma invoice — not a tax or commercial invoice.</Caption>
    </Card>
  );
}

function Bank({ d }: { d: PiDetail }) {
  const b = d.bankDetails;
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle className="text-base">Bank details {d.status === "DRAFT" ? "(taken from settings at issue)" : "(snapshot)"}</SectionTitle>
      {!b ? (
        <HelperText>No bank details configured. {d.status === "DRAFT" && <Link className="text-primary hover:underline" href="/quotations/settings">Add them in commercial settings</Link>}</HelperText>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          {([["Bank", b.bankName], ["Beneficiary", b.beneficiary], ["Account", b.accountNumber], ["SWIFT", b.swift], ["IBAN", b.iban], ["Bank address", b.bankAddress], ["Intermediary", b.intermediary]] as const).filter(([, v]) => v).map(([k, v]) => <React.Fragment key={k}><dt className="font-medium">{k}</dt><dd className="break-all">{v}</dd></React.Fragment>)}
        </dl>
      )}
      {d.bankDetailsMasked && <Caption>Masked for your role.</Caption>}
    </Card>
  );
}

function PiLinks({ d }: { d: PiDetail }) {
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle className="text-base">Linked records</SectionTitle>
      {d.quotation ? <p>Quotation: <Link className="text-primary hover:underline" href={`/quotations/${d.quotation.id}`}>{d.quotation.displayNumber}</Link></p> : <p>Manual PI — no quotation.</p>}
      {d.inquiryId && <p>Inquiry: <Link className="text-primary hover:underline" href={`/inquiries/${d.inquiryId}`}>Open inquiry</Link></p>}
      {d.crmLeadId && <p>CRM lead: <Link className="text-primary hover:underline" href={`/crm/leads/${d.crmLeadId}`}>Open lead</Link></p>}
      {d.revisions.length > 1 && (
        <ul className="flex flex-col gap-1">{d.revisions.map((r) => <li key={r.id} className="flex items-center justify-between gap-2">{r.id === d.id ? <span>Rev {r.revision} (this)</span> : <Link className="text-primary hover:underline" href={`/proforma-invoices/${r.id}`}>Rev {r.revision}</Link>}<Badge variant={PI_STATUS[r.status].variant}>{PI_STATUS[r.status].label}</Badge></li>)}</ul>
      )}
      {d.purchaseOrders.map((p) => <p key={p.id} className="flex items-center justify-between gap-2"><span>PO <Link className="text-primary hover:underline" href={`/purchase-orders/${p.id}`}>{p.poNumber}</Link></span><Badge variant={PO_STATUS[p.status].variant}>{PO_STATUS[p.status].label}</Badge></p>)}
    </Card>
  );
}
