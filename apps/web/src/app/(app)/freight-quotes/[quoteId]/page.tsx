"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import type { FreightQuoteDetail } from "@exportpro/types";
import { attachmentHref, freightApi } from "@/lib/api/logistics";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { ReasonDialog } from "@/components/commercial/shared";
import { FreightQuoteForm } from "@/components/logistics/freight";
import { dateTime, day, label, LogisticsTabs, money, QUOTE_STATUS, useCan, useLogisticsMutation } from "@/components/logistics/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function FreightQuotePage() {
  return (
    <RequirePermission permission="logistics.view">
      <QuoteDetail />
    </RequirePermission>
  );
}

function QuoteDetail() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const q = useQuery({ queryKey: ["logistics", "quote", quoteId], queryFn: () => freightApi.detail(quoteId) });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState title="Freight quote not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const x = q.data;
  const row = (k: string, v: React.ReactNode) => <div className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words">{v ?? "—"}</dd></div>;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Freight quotes", href: "/freight-quotes" }, { label: x.forwarderName }]} />
      <LogisticsTabs />
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <PageTitle className="break-words">{x.forwarderName}{x.quoteReference ? ` · ${x.quoteReference}` : ""}</PageTitle>
            <Caption className="block">{x.purchaseOrder ? <Link className="text-primary hover:underline" href={`/purchase-orders/${x.purchaseOrder.id}`}>PO {x.purchaseOrder.poNumber}</Link> : "Not linked to a PO"} · {label(x.transportMode)}{x.shipmentType ? ` ${x.shipmentType}` : ""} · source {label(x.source)}</Caption>
          </div>
          <Actions x={x} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={QUOTE_STATUS[x.status].variant}>{QUOTE_STATUS[x.status].label}</Badge>
          {x.validity === "EXPIRING_SOON" && <Badge variant="warning">Expiring soon</Badge>}
          {x.shipmentId && <Link href={`/shipments/${x.shipmentId}`}><Badge variant="info">Used by shipment</Badge></Link>}
        </div>
        {x.selection && <Caption>Selected by {x.selection.by ?? "—"} {dateTime(x.selection.at)}{x.selection.note ? ` — ${x.selection.note}` : ""}{x.selection.overrideReason ? ` · Expired-quote override: ${x.selection.overrideReason}` : ""}</Caption>}
        {x.rejectionReason && <Caption>Reason: {x.rejectionReason}</Caption>}
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle className="text-base">Rates</SectionTitle>
          {!x.charges.length ? <HelperText className="mt-1">No rates entered yet — this quote has been requested but not received.</HelperText> : (
            <table className="mt-2 w-full text-sm">
              <tbody>
                {x.charges.map((c, i) => <tr key={c.id ?? i} className="border-b border-border"><td className="py-1 pr-2">{label(c.category)}{c.label ? ` — ${c.label}` : ""}</td><td className="py-1 text-right tabular-nums">{money(c.amount, x.currency)}</td></tr>)}
                <tr><td className="py-1 font-medium">Total</td><td className="py-1 text-right font-medium tabular-nums">{money(x.totalCost, x.currency)}</td></tr>
              </tbody>
            </table>
          )}
        </Card>
        <Card className="p-4">
          <SectionTitle className="text-base">Service</SectionTitle>
          <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {row("Route", x.routeSummary ?? ([x.portOfLoading, x.portOfDischarge].filter(Boolean).join(" → ") || null))}
            {row("Routing", x.direct === null ? null : x.direct ? "Direct" : `Transshipment via ${x.transshipmentPorts.join(", ")}`)}
            {row("Shipping line / carrier", [x.shippingLine, x.carrier].filter(Boolean).join(" / ") || null)}
            {row("Transit time", x.transitDays != null ? `${x.transitDays} days` : null)}
            {row("Free days", x.freeDays)}
            {row("Valid until", day(x.validityUntil))}
            {row("Departure / arrival", `${day(x.departureDate)} / ${day(x.arrivalDate)}`)}
            {row("Inclusions", x.inclusions)}
            {row("Exclusions", x.exclusions)}
            {row("Terms", x.terms)}
          </dl>
        </Card>
      </div>
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Attachments</SectionTitle>
        {!x.attachments.length ? <HelperText className="mt-1">No attachments.</HelperText> : <ul className="mt-2 flex flex-col gap-1">{x.attachments.map((a) => <li key={a.id}><a className="text-primary hover:underline" href={attachmentHref(a.id)}>{a.filename}</a> <Caption>{(a.sizeBytes / 1024).toFixed(1)} KB</Caption></li>)}</ul>}
        {x.availableActions.includes("attach") && <div className="mt-2"><Attach id={x.id} /></div>}
      </Card>
      <Card className="p-4">
        <SectionTitle className="text-base">History</SectionTitle>
        <ol className="mt-2 flex flex-col gap-1.5 text-sm">{x.events.map((e) => <li key={e.id}><p className="break-words">{e.title}</p><Caption>{dateTime(e.createdAt)}{e.actor ? ` · ${e.actor}` : ""}</Caption></li>)}</ol>
      </Card>
    </div>
  );
}

function Attach({ id }: { id: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState(0);
  const up = useLogisticsMutation((f: File) => freightApi.attach(id, f, setPct), "File attached");
  return (
    <>
      <input ref={ref} type="file" className="sr-only" aria-label="Attach rate sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} />
      <Button size="sm" variant="outline" disabled={up.isPending} onClick={() => ref.current?.click()}>{up.isPending ? `Uploading ${pct}%` : "Attach rate sheet / email"}</Button>
    </>
  );
}

function Actions({ x }: { x: FreightQuoteDetail }) {
  const can = useCan();
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState(false);
  const [rej, setRej] = useState<"reject" | "cancel" | null>(null);
  const a = (k: string) => x.availableActions.includes(k);
  const close = useLogisticsMutation((r: string) => (rej === "reject" ? freightApi.reject(x.id, r) : freightApi.cancel(x.id, r)), "Quote updated", () => setRej(null));
  return (
    <div className="flex flex-wrap gap-2">
      {a("select") && <Button size="sm" onClick={() => setSel(true)}>Select quote</Button>}
      {a("create_shipment") && x.purchaseOrder && can("logistics.shipments.create") && <Button asChild size="sm"><Link href={`/shipments/new?purchaseOrderId=${x.purchaseOrder.id}&freightQuoteId=${x.id}`}>Create shipment</Link></Button>}
      {a("edit") && <Button size="sm" variant="outline" onClick={() => setEdit(true)}>{x.totalCost ? "Edit" : "Enter rates"}</Button>}
      {a("reject") && <Button size="sm" variant="ghost" onClick={() => setRej("reject")}>Reject</Button>}
      {a("cancel") && <Button size="sm" variant="ghost" onClick={() => setRej("cancel")}>Cancel</Button>}
      {edit && <FreightQuoteForm open onOpenChange={setEdit} quote={x} />}
      {sel && <SelectDialog x={x} onClose={() => setSel(false)} />}
      <ReasonDialog open={!!rej} onOpenChange={(o) => !o && setRej(null)} title={rej === "reject" ? "Reject quote" : "Cancel quote"} confirmLabel={rej === "reject" ? "Reject" : "Cancel quote"} destructive loading={close.isPending} onConfirm={(r) => close.mutate(r)} />
    </div>
  );
}

function SelectDialog({ x, onClose }: { x: FreightQuoteDetail; onClose: () => void }) {
  const can = useCan();
  const expired = x.status === "EXPIRED";
  const [note, setNote] = useState("");
  const [override, setOverride] = useState("");
  const mut = useLogisticsMutation(() => freightApi.select(x.id, { expectedRowVersion: x.rowVersion, note: note.trim() || undefined, overrideReason: expired ? override.trim() : undefined }), "Quote selected", onClose);
  const blocked = expired && (!can("logistics.override") || override.trim().length < 3);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Select this freight quote" description="Selection records your choice for the PO. It does not book freight with the forwarder." footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={blocked || mut.isPending} onClick={() => mut.mutate(undefined)}>Select</Button></div>}>
      <div className="flex flex-col gap-3">
        {expired && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm">
            This quote expired on {day(x.validityUntil)}. {can("logistics.override") ? "Record why it can still be used (e.g. forwarder re-confirmed the rate)." : "Ask a manager to override, or request a fresh quote."}
          </div>
        )}
        {expired && can("logistics.override") && <Textarea label="Override reason" required rows={2} value={override} onChange={(e) => setOverride(e.target.value)} />}
        <Textarea label="Selection note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
