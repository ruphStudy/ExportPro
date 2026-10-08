"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PRICE_BASES, type SupplierQuoteView } from "@exportpro/types";
import { costingApi } from "@/lib/api/costing";
import { procurementApi, type CostingHandoff } from "@/lib/api/procurement";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { CopyButton } from "@/components/logistics/shared";
import { day, money, ProcurementTabs, RfqBadge, todayIso, useCan, useProcMutation, words } from "@/components/procurement/shared";
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

export default function RfqDetailPage() {
  return (
    <RequirePermission permission="supplier_rfq.view">
      <Detail />
    </RequirePermission>
  );
}

const VIA = ["EMAIL", "WHATSAPP", "PHONE", "PORTAL", "OTHER"].map((v) => ({ value: v, label: words(v) }));

function Detail() {
  const { rfqId } = useParams<{ rfqId: string }>();
  const router = useRouter();
  const can = useCan();
  const q = useQuery({ queryKey: ["procurement", "rfq", rfqId], queryFn: () => procurementApi.rfq(rfqId) });
  const prices = can("supplier_quotes.manage");
  const [cur, setCur] = useState("");
  const cmp = useQuery({ queryKey: ["procurement", "rfq", rfqId, "compare", cur], queryFn: () => procurementApi.compare(rfqId, cur || undefined), enabled: prices });
  const [via, setVia] = useState("EMAIL");
  const [quoteFor, setQuoteFor] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<SupplierQuoteView | null>(null);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState("");
  const [handoff, setHandoff] = useState<CostingHandoff | null>(null);
  const [costingId, setCostingId] = useState("");
  const requested = useProcMutation((ids: string[]) => procurementApi.recordRequested(rfqId, { supplierIds: ids, via }), "Recorded as sent (outside ExportPro)");
  const review = useProcMutation(({ id, decision }: { id: string; decision: string }) => procurementApi.reviewQuote(id, { decision }), "Quote reviewed");
  const select = useProcMutation(() => procurementApi.select(selecting!.id, { expectedRowVersion: q.data!.rowVersion, reason: reason || undefined, expiredOverrideReason: override || undefined }), "Supplier selected", () => setSelecting(null));
  const toCosting = useProcMutation(({ confirm }: { confirm: boolean }) => procurementApi.useInCosting(q.data!.selection!.quoteId, { costingId: costingId || undefined, confirm }), undefined, (r) => {
    if (r.confirmed && r.href) router.push(r.href);
    else setHandoff(r);
  });
  const toPo = useProcMutation(() => procurementApi.createOrder({ quoteId: q.data!.selection!.quoteId }), "Supplier PO draft created", (r) => router.push(`/procurement/orders/${r.id}`));
  const costings = useQuery({ queryKey: ["costing", "list", "for-rfq", q.data?.productId], queryFn: () => costingApi.list({ productId: q.data?.productId ?? undefined, pageSize: 20 } as never), enabled: Boolean(handoff) });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState title="Could not load supplier RFQ" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const r = q.data;
  const manage = can("supplier_rfq.manage") && r.availableActions.length > 0;
  const invited = r.recipients.filter((x) => x.status === "INVITED").map((x) => x.supplier.id);
  const c = cmp.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>{r.rfqNumber}</PageTitle>
          <HelperText className="mt-1 break-words">{r.productName} · {r.quantity} {r.unit}{r.wastagePercent ? ` (base ${r.baseQuantity} + ${r.wastagePercent}% buffer you entered)` : ""}{r.buyerPurchaseOrder ? ` · for buyer PO ${r.buyerPurchaseOrder.poNumber}` : ""}</HelperText>
        </div>
        <RfqBadge status={r.status} />
      </div>
      <ProcurementTabs />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Requirement</SectionTitle>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words">
            <dt className="text-muted-foreground">Required by</dt><dd>{day(r.requiredBy)}</dd>
            <dt className="text-muted-foreground">Quotes due</dt><dd>{day(r.quoteDueDate)}</dd>
            <dt className="text-muted-foreground">Delivery</dt><dd>{r.deliveryLocation ?? "—"}</dd>
            <dt className="text-muted-foreground">Specification</dt><dd>{r.specification ?? "—"}</dd>
            <dt className="text-muted-foreground">Quality</dt><dd>{r.qualityRequirements ?? "—"}</dd>
            <dt className="text-muted-foreground">Certifications</dt><dd>{r.certificationsRequired.join(", ") || "—"}</dd>
            <dt className="text-muted-foreground">Payment terms</dt><dd>{r.paymentTermsRequested ?? "—"}</dd>
          </dl>
        </Card>
        <Card className="p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><SectionTitle className="text-base">RFQ text</SectionTitle><CopyButton text={r.rfqText} /></div>
          <HelperText>ExportPro does not send this. Copy it to email/WhatsApp, then record it as sent.</HelperText>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{r.rfqText}</pre>
        </Card>
      </div>
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Suppliers</SectionTitle>
        <ul className="mt-2 flex flex-col gap-2">
          {r.recipients.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2">
              <Link className="text-primary hover:underline" href={`/procurement/suppliers/${x.supplier.id}`}>{x.supplier.legalName}</Link>
              <Badge variant={x.status === "QUOTED" ? "success" : x.status === "REQUESTED" ? "info" : "neutral"}>{words(x.status)}</Badge>
              {x.requestedAt && <Caption>requested {day(x.requestedAt)} via {words(x.requestedVia ?? "OTHER").toLowerCase()}</Caption>}
              {can("supplier_quotes.manage") && x.status !== "QUOTED" && r.availableActions.includes("add_quote") && <Button size="sm" variant="secondary" onClick={() => setQuoteFor(x.supplier.id)}>Record quote</Button>}
            </li>
          ))}
        </ul>
        {manage && invited.length > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Select label="Sent via" containerClassName="w-40" value={via} onChange={(e) => setVia(e.target.value)} options={VIA} />
            <Button onClick={() => requested.mutate(invited)} disabled={requested.isPending}>Record RFQ as sent to {invited.length} supplier(s)</Button>
          </div>
        )}
      </Card>
      <Card className="overflow-x-auto p-4 text-sm">
        <SectionTitle className="text-base">Quotes</SectionTitle>
        <HelperText>Quotes are entered manually and must be reviewed before comparison.</HelperText>
        <table className="mt-2 w-full min-w-[720px]">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1">Supplier</th><th>Price</th><th>Basis</th><th>MOQ</th><th>Lead time</th><th>Valid until</th><th>Review</th><th /></tr></thead>
          <tbody>
            {r.quotes.map((x) => (
              <tr key={x.id} className="border-t border-border align-top">
                <td className="py-1">{x.supplier.legalName}{x.quoteReference ? ` (${x.quoteReference})` : ""}</td>
                <td>{x.unitPrice ? `${money(x.unitPrice, x.currency)}/${x.unit}` : "Hidden"}</td>
                <td>{words(x.priceBasis)}</td>
                <td>{x.moq ? `${x.moq} ${x.moqUnit ?? ""}` : "—"}</td>
                <td>{x.leadTimeDays !== null ? `${x.leadTimeDays} d` : "—"}</td>
                <td>{day(x.validUntil)}{x.expired && <Badge variant="danger" className="ml-1">Expired</Badge>}</td>
                <td><Badge variant={x.review === "CONFIRMED" ? "success" : x.review === "REJECTED" ? "danger" : "warning"}>{words(x.review)}</Badge></td>
                <td className="whitespace-nowrap">
                  {prices && x.review === "PENDING_REVIEW" && (
                    <span className="inline-flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => review.mutate({ id: x.id, decision: "CONFIRMED" })}>Confirm values</Button>
                      <Button size="sm" variant="ghost" onClick={() => review.mutate({ id: x.id, decision: "REJECTED" })}>Reject</Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!r.quotes.length && <HelperText className="mt-1">No quotes recorded yet.</HelperText>}
      </Card>
      {prices && (
        <Card className="overflow-x-auto p-4 text-sm">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <SectionTitle className="text-base">Comparison</SectionTitle>
            <Select aria-label="Compare in currency" containerClassName="w-32" value={cur} onChange={(e) => setCur(e.target.value)} options={[{ value: "", label: "INR (default)" }, ...["USD", "EUR", "AED", "GBP"].map((x) => ({ value: x, label: x }))]} />
          </div>
          {cmp.isLoading ? <Skeleton className="mt-2 h-32 w-full" /> : cmp.isError || !c ? <ErrorState title="Could not compare" message={toFriendlyErrorMessage(cmp.error)} onRetry={() => cmp.refetch()} /> : (
            <>
              <table className="mt-2 w-full min-w-[860px]">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1">Rank</th><th>Supplier</th><th>Price/{r.unit} ({c.targetCurrency})</th><th>Landed/{r.unit}</th><th>Unknown</th><th>MOQ</th><th>Lead</th><th>Certifications</th><th>Quality history</th><th>Score</th><th /></tr></thead>
                <tbody>
                  {c.rows.map((x) => (
                    <tr key={x.quote.id} className="border-t border-border align-top">
                      <td className="py-1">{x.rank ?? "—"}</td>
                      <td>{x.quote.supplier.legalName}<Caption className="block">{[x.quote.supplier.city, x.quote.supplier.state].filter(Boolean).join(", ")}</Caption></td>
                      <td>{x.normalizedUnitPrice ? money(x.normalizedUnitPrice) : "—"}{x.fx && <Caption className="block">FX {x.fx.from}→{x.fx.to} {x.fx.rate}</Caption>}{x.fxMissing && <Caption className="block text-danger">FX rate missing</Caption>}</td>
                      <td>{x.landedUnitCost ? money(x.landedUnitCost) : "—"}</td>
                      <td>{x.unknownCharges.length ? x.unknownCharges.join(", ") : "None"}</td>
                      <td>{x.moqFit === null ? "Unknown" : x.moqFit ? "Fits" : "Too high"}</td>
                      <td>{x.quote.leadTimeDays !== null ? `${x.quote.leadTimeDays} d` : "—"}{x.leadTimeFit === false && <Caption className="block text-danger">Too slow</Caption>}</td>
                      <td>{x.certification.missing.length ? <span className="text-danger">Missing {x.certification.missing.join(", ")}</span> : x.certification.required.length ? "All stated" : "—"}</td>
                      <td>{x.qualityHistory.inspections ? `${x.qualityHistory.passRatePercent}% of ${x.qualityHistory.inspections}` : "None yet"}</td>
                      <td><details><summary className="cursor-pointer">{x.score ?? "—"} <Caption>({x.confidencePercent}% data)</Caption></summary><ul className="list-disc pl-4 text-xs">{x.breakdown.map((b) => <li key={b.factor}>{b.factor} {b.points}/{b.max}: {b.explanation}</li>)}</ul></details></td>
                      <td>{can("supplier_quotes.manage") && !r.selection && r.availableActions.includes("select") && <Button size="sm" onClick={() => { setSelecting(x.quote); setReason(""); setOverride(""); }}>Select…</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!c.rows.length && <HelperText className="mt-1">No reviewed quotes to compare yet.</HelperText>}
              {c.excluded.length > 0 && <Caption className="mt-1 block">Not compared: {c.excluded.map((e) => `${e.supplier} (${e.reason})`).join("; ")}</Caption>}
              {c.rows.length > 0 && (
                <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
                  <p className="font-medium">Advisory recommendation — you decide</p>
                  <ul className="mt-1 list-disc pl-5">{c.recommendation.statements.map((s) => <li key={s}>{s}</li>)}</ul>
                  <Caption className="mt-1 block">{c.recommendation.basis}</Caption>
                </div>
              )}
            </>
          )}
        </Card>
      )}
      {r.selection && (
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Selected supplier</SectionTitle>
          <p className="mt-1">{r.selectedSupplier?.legalName} — selected by {r.selection.by ?? "a user"} on {day(r.selection.at)}{r.selection.reason ? `: “${r.selection.reason}”` : ""}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {r.availableActions.includes("create_po") && can("procurement.manage") && <Button onClick={() => toPo.mutate(undefined)} disabled={toPo.isPending}>Create supplier PO</Button>}
            {r.availableActions.includes("use_in_costing") && <Button variant="secondary" onClick={() => toCosting.mutate({ confirm: false })}>Use in costing…</Button>}
          </div>
        </Card>
      )}
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Activity</SectionTitle>
        <ul className="mt-2 flex flex-col gap-1">{r.activity.map((a) => <li key={a.id}>{a.title} <Caption>{a.actor ?? "System"} · {day(a.createdAt)}</Caption></li>)}</ul>
      </Card>
      {quoteFor && <QuoteModal rfqId={rfqId} supplierId={quoteFor} unit={r.unit} onClose={() => setQuoteFor(null)} />}
      <Modal open={Boolean(selecting)} onOpenChange={(o) => !o && setSelecting(null)} title={`Select ${selecting?.supplier.legalName ?? ""}`} description="Your decision is recorded with your name and reason. The AI recommendation never selects a supplier."
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setSelecting(null)}>Cancel</Button><Button disabled={select.isPending || (selecting?.expired && override.trim().length < 3)} onClick={() => select.mutate(undefined)}>Confirm selection</Button></div>}>
        <Textarea label="Reason (recommended)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        {selecting?.expired && <Textarea label="This quote has expired — reason to proceed" required rows={2} value={override} onChange={(e) => setOverride(e.target.value)} />}
      </Modal>
      <Modal open={Boolean(handoff)} onOpenChange={(o) => !o && setHandoff(null)} title="Use selected quote in costing" description={handoff?.preview.note}
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setHandoff(null)}>Cancel</Button><Button disabled={toCosting.isPending} onClick={() => toCosting.mutate({ confirm: true })}>Confirm</Button></div>}>
        <div className="flex flex-col gap-2 text-sm">
          <Select label="Costing" value={costingId} onChange={(e) => { setCostingId(e.target.value); setHandoff(null); procurementApi.useInCosting(r.selection!.quoteId, { costingId: e.target.value || undefined }).then(setHandoff); }} options={[{ value: "", label: "Create a new costing" }, ...(costings.data?.items ?? []).map((x) => ({ value: x.id, label: `${x.reference} · ${x.name} (${words(x.status)})` }))]} />
          <p>{handoff?.preview.plan}</p>
          <p>Procurement line: {handoff && `${money(handoff.preview.procurementLine.amount, handoff.preview.procurementLine.currency)} ${words(handoff.preview.procurementLine.basis)} (${handoff.preview.procurementLine.reference})`}</p>
          <Caption>Locked or ready costings are never changed — a new revision is created.</Caption>
        </div>
      </Modal>
    </div>
  );
}

function QuoteModal({ rfqId, supplierId, unit, onClose }: { rfqId: string; supplierId: string; unit: string; onClose: () => void }) {
  const [v, setV] = useState({ quoteReference: "", quoteDate: todayIso(), validUntil: "", unit: unit === "MT" ? "KG" : unit, unitPrice: "", currency: "INR", priceBasis: "EX_FACTORY", moq: "", moqUnit: "MT", leadTimeDays: "", taxPercent: "", taxIncluded: "", packagingPerUnit: "", inlandTransportPerUnit: "", inspectionTotal: "", paymentTerms: "", certificationsOffered: "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const save = useProcMutation(
    async () => {
      const n = (x: string) => (x ? x : null);
      const res = await procurementApi.addQuote(rfqId, { supplierId, quoteReference: n(v.quoteReference), quoteDate: n(v.quoteDate), validUntil: n(v.validUntil), unit: v.unit, unitPrice: v.unitPrice, currency: v.currency, priceBasis: v.priceBasis, moq: n(v.moq), moqUnit: v.moq ? v.moqUnit : null, leadTimeDays: v.leadTimeDays ? Number(v.leadTimeDays) : null, taxPercent: n(v.taxPercent), taxIncluded: v.taxIncluded ? v.taxIncluded === "yes" : null, packagingPerUnit: n(v.packagingPerUnit), inlandTransportPerUnit: n(v.inlandTransportPerUnit), inspectionTotal: n(v.inspectionTotal), paymentTerms: n(v.paymentTerms), certificationsOffered: v.certificationsOffered.split(",").map((x) => x.trim()).filter(Boolean), notes: n(v.notes) });
      const qid = res.rfq.quotes.find((x) => x.supplier.id === supplierId)?.id;
      if (file && qid) {
        const fd = new FormData();
        fd.append("file", file);
        await procurementApi.uploadQuoteFile(qid, fd, () => undefined);
      }
      return res;
    },
    "Quote recorded — review it before comparison",
    onClose,
  );
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Record supplier quote" description="Leave a charge blank if the supplier did not state it — it will be shown as unknown, never as zero." className="max-w-2xl"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={save.isPending || !v.unitPrice} onClick={() => save.mutate(undefined)}>Save quote</Button></div>}>
      <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-3">
        <Input label="Supplier reference" value={v.quoteReference} onChange={set("quoteReference")} />
        <Input label="Quote date" type="date" value={v.quoteDate} onChange={set("quoteDate")} />
        <Input label="Valid until" type="date" value={v.validUntil} onChange={set("validUntil")} />
        <Input label="Unit price" required inputMode="decimal" value={v.unitPrice} onChange={set("unitPrice")} />
        <div className="flex gap-2">
          <Select label="Currency" containerClassName="flex-1" value={v.currency} onChange={set("currency")} options={["INR", "USD", "EUR", "AED"].map((x) => ({ value: x, label: x }))} />
          <Select label="Per" containerClassName="w-24" value={v.unit} onChange={set("unit")} options={["KG", "MT", "BAG", "PCS"].map((x) => ({ value: x, label: x }))} />
        </div>
        <Select label="Price basis" value={v.priceBasis} onChange={set("priceBasis")} options={PRICE_BASES.map((x) => ({ value: x, label: words(x) }))} />
        <div className="flex gap-2">
          <Input label="MOQ" inputMode="decimal" containerClassName="flex-1" value={v.moq} onChange={set("moq")} />
          <Select label="Unit" containerClassName="w-24" value={v.moqUnit} onChange={set("moqUnit")} options={["MT", "KG"].map((x) => ({ value: x, label: x }))} />
        </div>
        <Input label="Lead time (days)" inputMode="numeric" value={v.leadTimeDays} onChange={set("leadTimeDays")} />
        <Input label="GST %" inputMode="decimal" value={v.taxPercent} onChange={set("taxPercent")} />
        <Select label="Tax included in price?" value={v.taxIncluded} onChange={set("taxIncluded")} options={[{ value: "", label: "Not stated" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
        <Input label="Packaging per unit" inputMode="decimal" value={v.packagingPerUnit} onChange={set("packagingPerUnit")} />
        <Input label="Inland transport per unit" inputMode="decimal" value={v.inlandTransportPerUnit} onChange={set("inlandTransportPerUnit")} />
        <Input label="Inspection (total)" inputMode="decimal" value={v.inspectionTotal} onChange={set("inspectionTotal")} />
        <Input label="Certifications offered" placeholder="FSSAI, ISO" value={v.certificationsOffered} onChange={set("certificationsOffered")} />
        <Input label="Payment terms" value={v.paymentTerms} onChange={set("paymentTerms")} />
        <Input label="Quote document (optional)" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Textarea label="Notes" containerClassName="sm:col-span-3" rows={2} value={v.notes} onChange={set("notes")} />
      </div>
    </Modal>
  );
}
