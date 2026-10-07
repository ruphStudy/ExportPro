"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, Download, FileText, Lock } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import type { QuotationDetail } from "@exportpro/types";
import { countryLabel } from "@exportpro/types";
import { fmtAmount, piApi, quotationsApi } from "@/lib/api/commercial";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { EXPIRY_TEXT, PI_STATUS, PO_STATUS, Q_STATUS } from "@/lib/commercial-labels";
import { toast } from "@/lib/toast";
import { CommercialTimeline, IssueProblems, ReasonDialog, useCommercialMutation } from "@/components/commercial/shared";
import { QuotationEditor } from "@/components/commercial/quotation-editor";
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

export default function QuotationDetailPage() {
  return (
    <RequirePermission permission="quotations.view">
      <QuotationView />
    </RequirePermission>
  );
}

function QuotationView() {
  const { quotationId } = useParams<{ quotationId: string }>();
  const q = useQuery({ queryKey: ["commercial", "quotation", quotationId], queryFn: () => quotationsApi.get(quotationId), retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2 });
  const [tab, setTab] = React.useState<"edit" | "preview">("edit");
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState title="Quotation not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  const editable = d.availableActions.includes("edit");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Quotes & Orders", href: "/quotations" }, { label: d.displayNumber }]} />
      <Header d={d} />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {editable && (
            <div role="tablist" aria-label="Quotation view" className="flex gap-1">
              {(["edit", "preview"] as const).map((t) => (
                <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "secondary" : "ghost"} onClick={() => setTab(t)}>{t === "edit" ? "Edit" : "Buyer preview"}</Button>
              ))}
            </div>
          )}
          {editable && tab === "edit" ? <QuotationEditor key={`${d.id}-${d.rowVersion}`} d={d} /> : <BuyerPreview d={d} />}
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Related records">
          <Links d={d} />
          <InternalPricing d={d} />
          <CommercialTimeline events={d.events} />
        </aside>
      </div>
    </div>
  );
}

function Header({ d }: { d: QuotationDetail }) {
  const router = useRouter();
  const can = (a: string) => d.availableActions.includes(a);
  const [dialog, setDialog] = React.useState<null | "issue" | "accept" | "reject" | "cancel" | "revise" | "pi_override">(null);
  const [accept, setAccept] = React.useState({ source: "MANUAL", buyerReference: "", note: "" });
  const close = () => setDialog(null);
  const issue = useCommercialMutation(() => quotationsApi.issue(d.id, d.rowVersion), "Quotation issued — it is now locked", close);
  const acc = useCommercialMutation(() => quotationsApi.accept(d.id, { expectedRowVersion: d.rowVersion, source: accept.source, buyerReference: accept.buyerReference.trim() || undefined, note: accept.note.trim() || undefined }), "Marked as accepted", close);
  const reject = useCommercialMutation((r: string) => quotationsApi.reject(d.id, r, d.rowVersion), "Marked as rejected", close);
  const cancel = useCommercialMutation((r: string) => quotationsApi.cancel(d.id, r, d.rowVersion), "Quotation cancelled", close);
  const revise = useCommercialMutation((r: string) => quotationsApi.revise(d.id, r), "Revision created", (n) => router.push(`/quotations/${n.id}`));
  const createPi = useCommercialMutation(
    (overrideReason?: string) =>
      piApi.create({ quotationId: d.id, overrideReason }).catch((e) => {
        const existing = e instanceof ApiRequestError ? (e.details as { existingPiId?: string } | undefined)?.existingPiId : undefined;
        if (existing) {
          toast.info("A proforma invoice already exists", "Opening it instead.");
          router.push(`/proforma-invoices/${existing}`);
          return null;
        }
        throw e;
      }),
    undefined,
    (pi) => {
      if (!pi) return;
      toast.success(`Proforma invoice ${pi.displayNumber} created`);
      router.push(`/proforma-invoices/${pi.id}`);
    },
  );
  const st = Q_STATUS[d.status];
  const exp = EXPIRY_TEXT(d.expiry.state, d.expiry.days);
  const copyEmail = async () => {
    if (!d.emailDraft) return;
    try {
      await navigator.clipboard.writeText(d.emailDraft);
      toast.success("Email draft copied", "Paste it into your email and attach the PDF. Nothing was sent.");
    } catch {
      toast.error("Could not copy", "Your browser blocked clipboard access.");
    }
  };
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Caption className="font-medium uppercase tracking-wide">Quotation{d.revision > 1 ? ` · revision ` : ""}</Caption>
          <PageTitle className="break-words">{d.displayNumber} · {d.buyer.name}</PageTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={st.variant}>{st.label}</Badge>
            {exp && <Badge variant={d.expiry.state === "EXPIRED" ? "danger" : "warning"}>{exp}</Badge>}
            {d.status !== "DRAFT" && d.status !== "READY" && <Caption className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden="true" />Issued documents are locked; changes need a revision.</Caption>}
            <span>{fmtAmount(d.totalAmount, d.currency)}</span>
          </div>
          {d.revisionReason && <HelperText className="mt-1">Revision reason: {d.revisionReason}</HelperText>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline"><a href={quotationsApi.pdfHref(d.id)} download><Download className="size-4" aria-hidden="true" />{d.status === "DRAFT" ? "Draft PDF" : "PDF"}</a></Button>
          {d.emailDraft && <Button size="sm" variant="outline" onClick={copyEmail}><Copy className="size-4" aria-hidden="true" />Copy email draft</Button>}
          {can("issue") && <Button size="sm" onClick={() => setDialog("issue")}>Issue quotation</Button>}
          {can("accept") && <Button size="sm" onClick={() => setDialog("accept")}>Mark accepted</Button>}
          {can("reject") && <Button size="sm" variant="outline" onClick={() => setDialog("reject")}>Mark rejected</Button>}
          {can("revise") && <Button size="sm" variant="outline" onClick={() => setDialog("revise")}>Revise</Button>}
          {can("create_pi") && <Button size="sm" onClick={() => createPi.mutate(undefined)} loading={createPi.isPending}><FileText className="size-4" aria-hidden="true" />Create proforma invoice</Button>}
          {can("create_pi_override") && <Button size="sm" variant="outline" onClick={() => setDialog("pi_override")}>Create PI (manager override)</Button>}
          {can("record_po") && <Button asChild size="sm" variant="outline"><Link href={`/purchase-orders/new?quotationId=${d.id}${d.buyer.id ? `&buyerCompanyId=${d.buyer.id}` : ""}`}>Record buyer PO</Link></Button>}
          {can("cancel") && <Button size="sm" variant="ghost" onClick={() => setDialog("cancel")}>Cancel</Button>}
        </div>
      </div>
      {d.status === "DRAFT" && <IssueProblems problems={d.issueProblems} />}
      {d.acceptance && <p className="text-sm">Accepted {new Date(d.acceptance.at).toLocaleDateString()}{d.acceptance.by ? ` by ${d.acceptance.by}` : ""} ({d.acceptance.source.replace("_", " ").toLowerCase()}){d.acceptance.buyerReference ? ` · buyer ref ${d.acceptance.buyerReference}` : ""}{d.acceptance.note ? ` — ${d.acceptance.note}` : ""}</p>}
      {d.rejection && <p className="text-sm">Rejected {new Date(d.rejection.at).toLocaleDateString()}: {d.rejection.reason}</p>}
      {d.cancellation && <p className="text-sm">Cancelled {new Date(d.cancellation.at).toLocaleDateString()}: {d.cancellation.reason}</p>}

      <ConfirmDialog open={dialog === "issue"} onOpenChange={(o) => !o && close()} title={`Issue ${d.displayNumber}?`} description="Buyer, exporter, items, terms and totals are snapshotted and locked. Later changes need a revision. Nothing is emailed automatically." confirmLabel="Issue" loading={issue.isPending} confirmDisabled={d.issueProblems.length > 0} onConfirm={() => issue.mutate(undefined)}>
        <IssueProblems problems={d.issueProblems} />
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "accept"} onOpenChange={(o) => !o && close()} title="Record buyer acceptance" description="Records that the buyer accepted this quotation. This is a manual business decision." confirmLabel="Mark accepted" loading={acc.isPending} onConfirm={() => acc.mutate(undefined)}>
        <div className="flex flex-col gap-3">
          <Select label="How was it accepted?" value={accept.source} onChange={(e) => setAccept((p) => ({ ...p, source: e.target.value }))} options={[{ value: "MANUAL", label: "Confirmed manually" }, { value: "EMAIL_REPLY", label: "Email reply" }, { value: "PO_RECEIVED", label: "Purchase order received" }, { value: "OTHER", label: "Other" }]} />
          <Input label="Buyer reference (optional)" value={accept.buyerReference} onChange={(e) => setAccept((p) => ({ ...p, buyerReference: e.target.value }))} maxLength={120} />
          <Textarea label="Note (optional)" rows={2} value={accept.note} onChange={(e) => setAccept((p) => ({ ...p, note: e.target.value }))} maxLength={1000} />
        </div>
      </ConfirmDialog>
      <ReasonDialog open={dialog === "reject"} onOpenChange={(o) => !o && close()} title="Mark quotation rejected" confirmLabel="Mark rejected" destructive loading={reject.isPending} onConfirm={(r) => reject.mutate(r)} />
      <ReasonDialog open={dialog === "cancel"} onOpenChange={(o) => !o && close()} title="Cancel quotation" description="Cancelled quotations stay in history and cannot be reopened." confirmLabel="Cancel quotation" destructive loading={cancel.isPending} onConfirm={(r) => cancel.mutate(r)} />
      <ReasonDialog open={dialog === "revise"} onOpenChange={(o) => !o && close()} title="Create a revision" description="A new draft revision is created with the same number. When issued, this revision becomes superseded and stays downloadable." label="Revision reason" confirmLabel="Create revision" loading={revise.isPending} onConfirm={(r) => revise.mutate(r)} />
      <ReasonDialog open={dialog === "pi_override"} onOpenChange={(o) => !o && close()} title="Create PI before acceptance" description="The quotation is not accepted yet. A manager override is recorded in the audit log." label="Override reason" confirmLabel="Create proforma invoice" loading={createPi.isPending} onConfirm={(r) => createPi.mutate(r)} />
    </header>
  );
}

/** Buyer-facing preview: renders only fields that appear on the PDF (no cost, margin or internal notes). */
function BuyerPreview({ d }: { d: QuotationDetail }) {
  const ex = d.exporterSnapshot;
  const by = d.buyerSnapshot;
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6" aria-label="Buyer-facing preview">
      {d.status === "DRAFT" && <p className="self-start rounded bg-muted px-2 py-0.5 text-xs font-medium uppercase">Draft preview — snapshots are taken at issue</p>}
      <div className="flex flex-wrap justify-between gap-4">
        <div className="min-w-0 text-sm">
          <p className="font-semibold">{ex?.name ?? "Your organization"}</p>
          {ex?.address && <p className="whitespace-pre-line">{ex.address}</p>}
          {ex?.email && <p>{ex.email}</p>}
          {ex?.registrations?.map((r) => <Caption key={r.type} className="block">{r.type}: {r.number}</Caption>)}
        </div>
        <div className="text-sm sm:text-right">
          <p className="text-lg font-semibold">QUOTATION</p>
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
        {by?.contactName && <p>Attn: {by.contactName}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">Quoted items</caption>
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>{["#", "Description", "Qty", "Unit price", "Amount"].map((h) => <th key={h} scope="col" className={`px-2 py-1.5 font-medium ${h === "#" || h === "Description" ? "text-left" : "text-right"}`}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {d.items.map((i, n) => (
              <tr key={i.id} className="border-b border-border align-top">
                <td className="px-2 py-1.5">{n + 1}</td>
                <td className="px-2 py-1.5">
                  {i.description}
                  {(i.hsCode || i.specification || i.packaging) && <Caption className="block">{[i.hsCode && `HS ${i.hsCode}`, i.specification, i.packaging].filter(Boolean).join(" · ")}</Caption>}
                </td>
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
        {d.additionalCharges !== "0.00" && <><dt>{d.chargesLabel ?? "Additional charges"}</dt><dd className="text-right">{fmtAmount(d.additionalCharges, d.currency)}</dd></>}
        {d.discount !== "0.00" && <><dt>Discount</dt><dd className="text-right">-{fmtAmount(d.discount, d.currency)}</dd></>}
        <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{fmtAmount(d.totalAmount, d.currency)}</dd>
      </dl>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {d.incoterm && <><dt className="font-medium">Incoterm</dt><dd>{d.incoterm}{d.incotermPlace ? ` ${d.incotermPlace}` : ""} (Incoterms® 2020)</dd></>}
        {(d.destinationPort || d.destinationCountry) && <><dt className="font-medium">Destination</dt><dd>{[d.destinationPort, d.destinationCountry && countryLabel(d.destinationCountry)].filter(Boolean).join(", ")}</dd></>}
        {d.paymentTerms && <><dt className="font-medium">Payment</dt><dd className="whitespace-pre-line">{d.paymentTerms}</dd></>}
        {d.deliveryTerms && <><dt className="font-medium">Delivery</dt><dd className="whitespace-pre-line">{d.deliveryTerms}</dd></>}
        {d.leadTime && <><dt className="font-medium">Lead time</dt><dd>{d.leadTime}</dd></>}
        {d.shipmentWindow && <><dt className="font-medium">Shipment</dt><dd>{d.shipmentWindow}</dd></>}
      </dl>
      {d.buyerNotes && <p className="whitespace-pre-line text-sm">{d.buyerNotes}</p>}
      {d.termsAndConditions && <div className="text-xs"><p className="font-medium">Terms &amp; conditions</p><p className="whitespace-pre-line">{d.termsAndConditions}</p></div>}
    </Card>
  );
}

function Links({ d }: { d: QuotationDetail }) {
  return (
    <Card className="flex flex-col gap-3 p-4 text-sm">
      <SectionTitle className="text-base">Linked records</SectionTitle>
      <ul className="flex flex-col gap-1">
        {d.inquiry && <li>Inquiry: <Link className="text-primary hover:underline" href={`/inquiries/${d.inquiry.id}`}>{d.inquiry.reference}</Link></li>}
        {d.costingId && <li>Costing: <Link className="text-primary hover:underline" href={`/costing/${d.costingId}`}>Open costing</Link></li>}
        {d.crm && <li>CRM lead: <Link className="text-primary hover:underline" href={`/crm/leads/${d.crm.leadId}`}>Open lead</Link> <Caption>(stage {d.crm.stage.replace(/_/g, " ").toLowerCase()})</Caption></li>}
        {!d.inquiry && !d.costingId && !d.crm && <li><HelperText>Manual quotation — no linked inquiry, costing or lead.</HelperText></li>}
      </ul>
      {d.crm?.stageSuggestion && (
        <p role="note" className="rounded-md border border-info/40 bg-info/5 p-2">
          Suggestion: move the CRM lead to <strong>{d.crm.stageSuggestion.stage.replace(/_/g, " ").toLowerCase()}</strong> — {d.crm.stageSuggestion.reason} <Link className="text-primary hover:underline" href={`/crm/leads/${d.crm.leadId}`}>Review in CRM</Link>. Stages are never changed automatically.
        </p>
      )}
      {d.revisions.length > 1 && (
        <div>
          <p className="font-medium">Revisions</p>
          <ul className="mt-1 flex flex-col gap-1">
            {d.revisions.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                {r.id === d.id ? <span>Rev {r.revision} (this)</span> : <Link className="text-primary hover:underline" href={`/quotations/${r.id}`}>Rev {r.revision}</Link>}
                <Badge variant={Q_STATUS[r.status].variant}>{Q_STATUS[r.status].label}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.proformaInvoices.length > 0 && (
        <div>
          <p className="font-medium">Proforma invoices</p>
          <ul className="mt-1 flex flex-col gap-1">{d.proformaInvoices.map((p) => <li key={p.id} className="flex items-center justify-between gap-2"><Link className="text-primary hover:underline" href={`/proforma-invoices/${p.id}`}>{p.displayNumber}</Link><Badge variant={PI_STATUS[p.status].variant}>{PI_STATUS[p.status].label}</Badge></li>)}</ul>
        </div>
      )}
      {d.purchaseOrders.length > 0 && (
        <div>
          <p className="font-medium">Buyer purchase orders</p>
          <ul className="mt-1 flex flex-col gap-1">{d.purchaseOrders.map((p) => <li key={p.id} className="flex items-center justify-between gap-2"><Link className="text-primary hover:underline" href={`/purchase-orders/${p.id}`}>{p.poNumber}</Link><Badge variant={PO_STATUS[p.status].variant}>{PO_STATUS[p.status].label}</Badge></li>)}</ul>
        </div>
      )}
    </Card>
  );
}

/** Internal pricing provenance (only returned to users who may edit quotations). */
function InternalPricing({ d }: { d: QuotationDetail }) {
  const linked = d.items.filter((i) => i.costing);
  if (!linked.length && !d.internalNotes) return null;
  return (
    <Card className="flex flex-col gap-2 border-dashed p-4 text-sm">
      <SectionTitle className="text-base">Internal — not on buyer documents</SectionTitle>
      {linked.map((i) => (
        <div key={i.id}>
          <p className="font-medium">{i.description}</p>
          <Caption className="block">
            <Link className="text-primary hover:underline" href={`/costing/${i.costing!.costingId}`}>{i.costing!.reference}</Link> · {i.costing!.snapshotKind.toLowerCase()} · costing price {i.costing!.costingUnitPrice} {d.currency}/{i.unit} · quoted {i.unitPrice ?? "—"}
          </Caption>
          {i.priceSource === "OVERRIDE" && <Caption className="block text-warning">Override{i.overriddenBy ? ` by ${i.overriddenBy}` : ""}: {i.overrideReason}</Caption>}
        </div>
      ))}
      {d.internalNotes && <p className="whitespace-pre-line"><span className="font-medium">Notes:</span> {d.internalNotes}</p>}
    </Card>
  );
}
