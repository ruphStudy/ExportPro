"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Paperclip, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import type { ComparisonColumn, PoDetail, PODiscrepancy } from "@exportpro/types";
import { fmtAmount, poApi } from "@/lib/api/commercial";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { PO_STATUS, SEVERITY } from "@/lib/commercial-labels";
import { poBody, PoFields, poFromDetail, type PoFormState } from "@/components/commercial/po-form";
import { CommercialTimeline, ReasonDialog, useCommercialMutation } from "@/components/commercial/shared";
import { PoComplianceCard, PoValidationCard } from "@/components/compliance/po-compliance-card";
import { PoLogisticsCard } from "@/components/logistics/entry-cards";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { ConfirmDialog } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function PoDetailPage() {
  return (
    <RequirePermission permission="purchase_orders.view">
      <PoView />
    </RequirePermission>
  );
}

function PoView() {
  const { poId } = useParams<{ poId: string }>();
  const q = useQuery({ queryKey: ["commercial", "po", poId], queryFn: () => poApi.get(poId), retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2 });
  const [editing, setEditing] = React.useState(false);
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState title="Purchase order not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Buyer POs", href: "/purchase-orders" }, { label: d.poNumber }]} />
      <Header d={d} onEdit={() => setEditing(true)} />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {editing ? <PoEditor key={d.rowVersion} d={d} onDone={() => setEditing(false)} /> : <Comparison d={d} />}
          <Discrepancies d={d} />
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Related records">
          <Links d={d} />
          <PoComplianceCard purchaseOrderId={d.id} />
          <PoValidationCard purchaseOrderId={d.id} />
          <PoLogisticsCard purchaseOrderId={d.id} accepted={d.status === "ACCEPTED"} />
          <Attachments d={d} />
          <CommercialTimeline events={d.events} />
        </aside>
      </div>
    </div>
  );
}

function Header({ d, onEdit }: { d: PoDetail; onEdit: () => void }) {
  const can = (a: string) => d.availableActions.includes(a);
  const [dialog, setDialog] = React.useState<null | "accept" | "reject" | "clarify" | "cancel">(null);
  const close = () => setDialog(null);
  const openCritical = d.discrepancies.filter((x) => x.status === "OPEN" && x.severity === "CRITICAL").length;
  const accept = useCommercialMutation((reason?: string) => poApi.accept(d.id, d.rowVersion, reason), "PO accepted", close);
  const reject = useCommercialMutation((r: string) => poApi.reject(d.id, r, d.rowVersion), "PO rejected", close);
  const clarify = useCommercialMutation((r: string) => poApi.clarify(d.id, r, d.rowVersion), "Clarification request recorded", close);
  const cancel = useCommercialMutation((r: string) => poApi.cancel(d.id, r, d.rowVersion), "PO cancelled", close);
  const compare = useCommercialMutation(() => poApi.compare(d.id), "Comparison re-run");
  const st = PO_STATUS[d.status];
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Caption className="font-medium uppercase tracking-wide">Buyer purchase order · {d.source === "UPLOAD" ? "uploaded" : "manual entry"}</Caption>
          <PageTitle className="break-words">PO {d.poNumber} · {d.buyer.name}</PageTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={st.variant}>{st.label}</Badge>
            <span>{d.poDate.slice(0, 10)}</span>
            <span>{fmtAmount(d.totalAmount ?? d.linesTotal, d.currency)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("edit") && <Button size="sm" variant="outline" onClick={onEdit}>Edit PO details</Button>}
          {can("compare") && <Button size="sm" variant="outline" onClick={() => compare.mutate(undefined)} loading={compare.isPending}><RefreshCw className="size-4" aria-hidden="true" />Re-run comparison</Button>}
          {can("accept") && <Button size="sm" onClick={() => setDialog("accept")}>Accept PO</Button>}
          {can("request_clarification") && <Button size="sm" variant="outline" onClick={() => setDialog("clarify")}>Request clarification</Button>}
          {can("reject") && <Button size="sm" variant="outline" onClick={() => setDialog("reject")}>Reject</Button>}
          {can("cancel") && <Button size="sm" variant="ghost" onClick={() => setDialog("cancel")}>Cancel</Button>}
        </div>
      </div>
      {d.review && (
        <p className="text-sm">
          {d.review.decision === "ACCEPTED" ? "Accepted" : "Rejected"} {new Date(d.review.decidedAt).toLocaleDateString()}{d.review.decidedBy ? ` by ${d.review.decidedBy}` : ""}{d.review.reason ? ` — ${d.review.reason}` : ""}
          {d.review.overrideReason && <span className="block text-warning">Accepted with open critical discrepancies. Override: {d.review.overrideReason}</span>}
        </p>
      )}
      {d.crm?.stageSuggestion && (
        <p role="note" className="rounded-md border border-info/40 bg-info/5 p-2 text-sm">
          Suggestion: move the CRM lead to <strong>{d.crm.stageSuggestion.stage.replace(/_/g, " ").toLowerCase()}</strong> — {d.crm.stageSuggestion.reason} <Link className="text-primary hover:underline" href={`/crm/leads/${d.crm.leadId}`}>Review in CRM</Link>. Not changed automatically.
        </p>
      )}
      {openCritical > 0 ? (
        <ReasonDialog open={dialog === "accept"} onOpenChange={(o) => !o && close()} title="Accept PO with critical discrepancies?" description={`${openCritical} critical discrepanc${openCritical === 1 ? "y is" : "ies are"} still open. Accepting requires an override reason, which is recorded in the audit log.`} label="Override reason" confirmLabel="Accept with override" destructive loading={accept.isPending} onConfirm={(r) => accept.mutate(r)} />
      ) : (
        <ConfirmDialog open={dialog === "accept"} onOpenChange={(o) => !o && close()} title={`Accept PO ${d.poNumber}?`} description="Records your decision to accept this purchase order. No shipment, invoice or payment is created." confirmLabel="Accept PO" loading={accept.isPending} onConfirm={() => accept.mutate(undefined)} />
      )}
      <ReasonDialog open={dialog === "reject"} onOpenChange={(o) => !o && close()} title="Reject purchase order" confirmLabel="Reject PO" destructive loading={reject.isPending} onConfirm={(r) => reject.mutate(r)} />
      <ReasonDialog open={dialog === "clarify"} onOpenChange={(o) => !o && close()} title="Request clarification" description="Records what you need to clarify with the buyer. Nothing is sent automatically." label="What needs clarification?" confirmLabel="Record request" loading={clarify.isPending} onConfirm={(r) => clarify.mutate(r)} />
      <ReasonDialog open={dialog === "cancel"} onOpenChange={(o) => !o && close()} title="Cancel purchase order record" confirmLabel="Cancel PO" destructive loading={cancel.isPending} onConfirm={(r) => cancel.mutate(r)} />
    </header>
  );
}

function PoEditor({ d, onDone }: { d: PoDetail; onDone: () => void }) {
  const [f, setF] = React.useState<PoFormState>(() => poFromDetail(d));
  const save = useCommercialMutation(() => poApi.update(d.id, { expectedRowVersion: d.rowVersion, ...poBody(f) }), "PO saved — comparison re-run", onDone);
  return (
    <form className="flex flex-col gap-4" aria-label="Edit purchase order" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      <PoFields f={f} onChange={setF} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>Discard</Button>
        <Button type="submit" loading={save.isPending}>Save</Button>
      </div>
    </form>
  );
}

const TERM_ROWS: { key: keyof ComparisonColumn; label: string }[] = [
  { key: "currency", label: "Currency" },
  { key: "incoterm", label: "Incoterm" },
  { key: "incotermPlace", label: "Named place" },
  { key: "paymentTerms", label: "Payment terms" },
  { key: "deliveryTerms", label: "Delivery terms" },
  { key: "totalAmount", label: "Total" },
];

/** Side-by-side Quotation vs PI vs PO, with differing cells highlighted. */
function Comparison({ d }: { d: PoDetail }) {
  const cols = [d.comparison.quotation, d.comparison.pi, d.comparison.po].filter(Boolean) as ComparisonColumn[];
  const po = d.comparison.po;
  const cellCls = (c: ComparisonColumn, k: keyof ComparisonColumn) => {
    if (c === po || cols.length < 2) return "";
    const a = String(c[k] ?? "").trim().toLowerCase();
    const b = String(po[k] ?? "").trim().toLowerCase();
    return a !== b ? "bg-warning/10" : "";
  };
  const rows = Math.max(...cols.map((c) => c.items.length), 0);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionTitle className="text-base">Comparison</SectionTitle>
        <Caption>Tolerance: quantity {d.comparison.tolerance.quantityPercent}% · price {d.comparison.tolerance.pricePercent}%</Caption>
      </div>
      {cols.length < 2 && <HelperText>Link a quotation or proforma invoice to compare against.</HelperText>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="sr-only">Quotation, proforma invoice and PO terms side by side</caption>
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr><th scope="col" className="px-2 py-1.5 text-left font-medium">Field</th>{cols.map((c) => <th key={c.label} scope="col" className="px-2 py-1.5 text-left font-medium">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {TERM_ROWS.map((r) => (
              <tr key={r.key} className="border-b border-border align-top">
                <th scope="row" className="px-2 py-1.5 text-left font-medium">{r.label}</th>
                {cols.map((c) => <td key={c.label} className={`px-2 py-1.5 break-words ${cellCls(c, r.key)}`}>{r.key === "totalAmount" ? fmtAmount(c.totalAmount) : ((c[r.key] as string | null) ?? "—")}</td>)}
              </tr>
            ))}
            {Array.from({ length: rows }, (_, n) => (
              <tr key={`i${n}`} className="border-b border-border align-top">
                <th scope="row" className="px-2 py-1.5 text-left font-medium">Line {n + 1}</th>
                {cols.map((c) => {
                  const it = c.items[n];
                  return <td key={c.label} className="px-2 py-1.5">{it ? <><span className="block">{it.description}</span><Caption>{it.quantity} {it.unit} × {it.unitPrice ? fmtAmount(it.unitPrice) : "—"}</Caption></> : "—"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!d.items.length && <p role="note" className="text-sm text-warning">No PO lines entered yet — use “Edit PO details” to enter them from the buyer’s document.</p>}
    </Card>
  );
}

function Discrepancies({ d }: { d: PoDetail }) {
  const [resolving, setResolving] = React.useState<PODiscrepancy | null>(null);
  const can = d.availableActions.includes("resolve");
  const open = d.discrepancies.filter((x) => x.status === "OPEN");
  const done = d.discrepancies.filter((x) => x.status !== "OPEN");
  return (
    <Card className="flex flex-col gap-3 p-4">
      <SectionTitle className="text-base">Discrepancies</SectionTitle>
      <HelperText>Detected by fixed rules (not AI). Critical: currency, Incoterm, unit, price, product, total, quantity &gt;10%.</HelperText>
      {!d.discrepancies.length ? (
        <p className="text-sm">{d.status === "MATCHED" ? "PO matches the linked documents." : "No discrepancies recorded."}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Open discrepancies">
          {[...open, ...done].map((x) => (
            <li key={x.id} className={`rounded-md border p-2 text-sm ${x.status === "OPEN" ? "border-border" : "border-dashed border-border opacity-80"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="flex min-w-0 items-start gap-1.5">{x.severity === "CRITICAL" && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />}<span className="break-words">{x.message}</span></p>
                <span className="flex shrink-0 gap-1"><Badge variant={SEVERITY[x.severity].variant}>{SEVERITY[x.severity].label}</Badge>{x.status !== "OPEN" && <Badge variant="success">{x.status.replace(/_/g, " ").toLowerCase()}</Badge>}</span>
              </div>
              <Caption className="block">vs {x.against.toLowerCase()}{x.itemLabel ? ` · ${x.itemLabel}` : ""}{x.expectedValue !== null || x.actualValue !== null ? ` · expected ${x.expectedValue ?? "—"}, PO ${x.actualValue ?? "—"}` : ""}</Caption>
              {x.resolutionNote && <Caption className="block">Resolution{x.resolvedBy ? ` by ${x.resolvedBy}` : ""}: {x.resolutionNote}</Caption>}
              {can && x.status === "OPEN" && <Button size="sm" variant="ghost" className="mt-1" onClick={() => setResolving(x)}>Resolve</Button>}
            </li>
          ))}
        </ul>
      )}
      {resolving && <ResolveDialog d={d} x={resolving} onClose={() => setResolving(null)} />}
    </Card>
  );
}

function ResolveDialog({ d, x, onClose }: { d: PoDetail; x: PODiscrepancy; onClose: () => void }) {
  const [status, setStatus] = React.useState("ACCEPTED_DIFFERENCE");
  const [note, setNote] = React.useState("");
  const m = useCommercialMutation(() => poApi.resolve(d.id, x.id, status, note.trim()), "Discrepancy resolved", onClose);
  return (
    <ConfirmDialog open onOpenChange={(o) => !o && onClose()} title="Resolve discrepancy" description={x.message} confirmLabel="Resolve" loading={m.isPending} confirmDisabled={note.trim().length < 3} onConfirm={() => m.mutate(undefined)}>
      <div className="flex flex-col gap-3">
        <Select label="Resolution" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "ACCEPTED_DIFFERENCE", label: "Accept the difference" }, { value: "CORRECTED", label: "Corrected (buyer will revise / we revised)" }, { value: "RESOLVED", label: "Resolved otherwise" }]} />
        <Textarea label="Resolution note" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </div>
    </ConfirmDialog>
  );
}

function Links({ d }: { d: PoDetail }) {
  return (
    <Card className="flex flex-col gap-1 p-4 text-sm">
      <SectionTitle className="text-base">Linked records</SectionTitle>
      {d.quotation ? <p>Quotation: <Link className="text-primary hover:underline" href={`/quotations/${d.quotation.id}`}>{d.quotation.displayNumber}</Link></p> : <p>No quotation linked.</p>}
      {d.proformaInvoice ? <p>Proforma invoice: <Link className="text-primary hover:underline" href={`/proforma-invoices/${d.proformaInvoice.id}`}>{d.proformaInvoice.displayNumber}</Link></p> : <p>No proforma invoice linked.</p>}
      {d.inquiryId && <p>Inquiry: <Link className="text-primary hover:underline" href={`/inquiries/${d.inquiryId}`}>Open inquiry</Link></p>}
      {d.crmLeadId && <p>CRM lead: <Link className="text-primary hover:underline" href={`/crm/leads/${d.crmLeadId}`}>Open lead</Link></p>}
    </Card>
  );
}

function Attachments({ d }: { d: PoDetail }) {
  const [progress, setProgress] = React.useState(0);
  const up = useCommercialMutation((f: File) => poApi.addAttachment(d.id, f, setProgress), "Attachment uploaded");
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle className="text-base">PO documents</SectionTitle>
      {!d.attachments.length ? <HelperText>No documents attached.</HelperText> : (
        <ul className="flex flex-col gap-1">
          {d.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5">
              <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
              <a className="min-w-0 truncate text-primary hover:underline" href={poApi.attachmentHref(d.id, a.id)} download>{a.filename}</a>
              <Caption className="shrink-0">{Math.max(1, Math.round(a.sizeBytes / 1024))} KB</Caption>
            </li>
          ))}
        </ul>
      )}
      {d.availableActions.includes("add_attachment") && (
        <div>
          <label htmlFor="po-attach" className="text-xs font-medium">Add document</label>
          <input id="po-attach" type="file" className="mt-1 block w-full text-xs" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml" disabled={up.isPending} onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} />
          {up.isPending && <Progress value={progress} aria-label="Upload progress" className="mt-2" />}
        </div>
      )}
    </Card>
  );
}
