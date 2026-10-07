"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Plus, RefreshCw, Trash2, UserCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import type { BuyerInquiryDetail, ConfirmedItem, ConfirmedRfq, ExtractedField, ExtractedRfq, InquiryExtraction } from "@exportpro/types";
import { COUNTRIES, countryLabel, PAYMENT_TERM_TYPES, RFQ_INCOTERMS } from "@exportpro/types";
import { inquiriesApi } from "@/lib/api/inquiries";
import { productsApi } from "@/lib/api/products";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { CONFIDENCE, EXTRACTION_LABELS } from "@/lib/inquiry-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Maps an AI extraction into an editable draft. Only explicit HS codes carry over; suggestions never do. */
export function fromExtraction(e: ExtractedRfq): ConfirmedRfq {
  return {
    items: e.items.map((i) => ({
      productName: i.productName.value ?? "",
      productId: null,
      hsCode: i.hsCode.value,
      quantity: s(i.quantity.value),
      quantityUnit: i.quantityUnit.value,
      quantityText: i.quantity.raw,
      specification: i.specification.value,
      packaging: i.packaging.value,
      targetPrice: s(i.targetPrice.value),
      priceCurrency: i.priceCurrency.value,
      priceUnitBasis: i.priceUnitBasis.value,
      priceIndicative: i.priceIndicative,
      deliveryDate: i.deliveryDate.value,
    })),
    destination: { countryCode: e.destination.countryCode.value, city: e.destination.city.value, port: e.destination.port.value, location: e.destination.location.value },
    incoterm: { term: e.incoterm.term.value, place: e.incoterm.place.value },
    certifications: e.certifications.map((c) => c.name),
    paymentTerms: { type: e.paymentTerms.type.value, advancePercent: e.paymentTerms.advancePercent.value, creditDays: e.paymentTerms.creditDays.value, raw: e.paymentTerms.raw },
    delivery: { targetDate: e.delivery.targetDate.value, shipmentWindow: e.delivery.shipmentWindow.value, leadTime: e.delivery.leadTime.value, urgent: e.delivery.urgency.value === "URGENT" },
    sample: { required: e.sample.required.value === true, quantity: e.sample.quantity.value, specification: e.sample.specification.value, deadline: e.sample.deadline.value },
    notes: null,
  };
}

const blankItem = (): ConfirmedItem => ({ productName: "", productId: null, hsCode: null, quantity: null, quantityUnit: null, quantityText: null, specification: null, packaging: null, targetPrice: null, priceCurrency: null, priceUnitBasis: null, priceIndicative: false, deliveryDate: null });
const blankRfq = (): ConfirmedRfq => ({ items: [], destination: { countryCode: null, city: null, port: null, location: null }, incoterm: { term: null, place: null }, certifications: [], paymentTerms: { type: null, advancePercent: null, creditDays: null, raw: null }, delivery: { targetDate: null, shipmentWindow: null, leadTime: null, urgent: false }, sample: { required: false, quantity: null, specification: null, deadline: null }, notes: null });

function useInquiryMutation<T>(id: string, fn: (a: T) => Promise<BuyerInquiryDetail>, ok?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      qc.setQueryData(["inquiries", "detail", id], d);
      qc.invalidateQueries({ queryKey: ["inquiries", "list"] });
      if (ok) toast.success(ok);
    },
    onError: (e) => {
      toast.error("Not saved", toFriendlyErrorMessage(e));
      qc.invalidateQueries({ queryKey: ["inquiries", "detail", id] });
    },
  });
}
export { useInquiryMutation };

function Conf({ f }: { f: ExtractedField<unknown> }) {
  if (f.value === null && !f.ambiguous) return <Caption>Not stated</Caption>;
  const c = CONFIDENCE[f.confidence];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={c.variant}>{c.label}</Badge>
      {!f.explicit && f.value !== null && <Badge variant="warning">Inferred</Badge>}
      {f.ambiguous && <Badge variant="danger">Ambiguous</Badge>}
      {f.note && <Caption>{f.note}</Caption>}
    </span>
  );
}

function Row({ label, f, show }: { label: string; f: ExtractedField<unknown>; show?: string | null }) {
  return (
    <tr className="border-t border-border align-top">
      <th scope="row" className="px-2 py-1.5 text-left text-xs font-normal text-muted-foreground">{label}</th>
      <td className="px-2 py-1.5 text-sm">{show ?? (f.value === null ? <span className="text-muted-foreground">Unknown</span> : String(f.value))}{f.raw && f.explicit && <Caption className="block">“{f.raw}”</Caption>}</td>
      <td className="px-2 py-1.5"><Conf f={f} /></td>
    </tr>
  );
}

function ExtractionView({ e }: { e: InquiryExtraction }) {
  const d = e.data!;
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="info"><Bot className="size-3" aria-hidden="true" />{e.provenance === "AI_DERIVED" ? "AI-extracted — not confirmed" : "Rule-based development extraction (not AI) — not confirmed"}</Badge>
        <span>Overall confidence {e.overallConfidence ?? 0}%</span>
        <Caption>v{e.version} · {e.provider}{e.model ? ` (${e.model})` : ""} · {new Date(e.generatedAt).toLocaleString()}</Caption>
      </p>
      {e.invalidFields.length > 0 && <p className="text-xs text-warning" role="status">Dropped invalid fields: {e.invalidFields.join(", ")}</p>}
      {e.attachmentsSkipped.length > 0 && <p className="text-xs text-muted-foreground">Text extraction not available for: {e.attachmentsSkipped.map((x) => x.filename).join(", ")}</p>}
      {d.items.length === 0 && <p className="text-sm text-muted-foreground">No product with a quantity was identified.</p>}
      {d.items.map((it, n) => (
        <div key={n} className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[30rem]">
            <caption className="bg-muted/40 px-2 py-1 text-left text-xs font-semibold">Item {n + 1}</caption>
            <tbody>
              <Row label="Product" f={it.productName} />
              <Row label="HS code (stated)" f={it.hsCode} />
              {it.hsSuggestion && (
                <tr className="border-t border-border"><th scope="row" className="px-2 py-1.5 text-left text-xs font-normal text-muted-foreground">HS suggestion</th><td colSpan={2} className="px-2 py-1.5 text-xs">{it.hsSuggestion.code} — unconfirmed suggestion, not from the inquiry</td></tr>
              )}
              <Row label="Quantity" f={it.quantity} show={it.quantity.value === null ? null : `${it.quantity.value} ${it.quantityUnit.value ?? ""}`} />
              <Row label="Specification" f={it.specification} />
              <Row label="Packaging" f={it.packaging} />
              <Row label="Target price" f={it.targetPrice} show={it.targetPrice.value === null ? null : `${it.priceIndicative ? "≈ " : ""}${it.priceCurrency.value ?? ""} ${it.targetPrice.value}${it.priceUnitBasis.value ? ` / ${it.priceUnitBasis.value}` : ""}${it.priceIndicative ? " (indicative)" : ""}`} />
              <Row label="Delivery" f={it.deliveryDate} />
            </tbody>
          </table>
        </div>
      ))}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[30rem]">
          <caption className="bg-muted/40 px-2 py-1 text-left text-xs font-semibold">Terms</caption>
          <tbody>
            <Row label="Destination country" f={d.destination.countryCode} show={d.destination.countryCode.value ? countryLabel(d.destination.countryCode.value) : null} />
            <Row label="Port" f={d.destination.port} />
            <Row label="Incoterm" f={d.incoterm.term} show={d.incoterm.term.value ? `${d.incoterm.term.value}${d.incoterm.place.value ? ` ${d.incoterm.place.value}` : ""}` : null} />
            <Row label="Payment terms" f={d.paymentTerms.type} show={d.paymentTerms.type.value ? `${d.paymentTerms.type.value}${d.paymentTerms.advancePercent.value !== null ? ` · ${d.paymentTerms.advancePercent.value}% advance` : ""}${d.paymentTerms.creditDays.value !== null ? ` · ${d.paymentTerms.creditDays.value} days` : ""}` : null} />
            <Row label="Delivery date" f={d.delivery.targetDate} />
            <Row label="Shipment window" f={d.delivery.shipmentWindow} />
            <Row label="Lead time" f={d.delivery.leadTime} />
            <Row label="Urgency" f={d.delivery.urgency} />
            <Row label="Sample required" f={d.sample.required} show={d.sample.required.value === null ? null : d.sample.required.value ? `Yes${d.sample.quantity.value ? ` — ${d.sample.quantity.value}` : ""}${d.sample.deadline.value ? ` by ${d.sample.deadline.value}` : ""}` : "No"} />
          </tbody>
        </table>
      </div>
      <p className="text-sm">Certifications requested: {d.certifications.length ? d.certifications.map((c) => `${c.name}${c.confidence === "LOW" ? " (low confidence)" : ""}`).join(", ") : <span className="text-muted-foreground">none stated</span>} <Caption>(buyer request only — not a compliance determination)</Caption></p>
      {d.ambiguities.length > 0 && (
        <div role="note" className="rounded-md border border-warning/40 bg-warning/5 p-2 text-sm">
          <p className="font-medium">Ambiguous / unresolved</p>
          <ul className="list-disc pl-5">{d.ambiguities.map((a, n) => <li key={n}>{a.field}: {a.reason}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function RfqPanel({ d }: { d: BuyerInquiryDetail }) {
  const { data: session } = useSession();
  const can = (a: string) => d.availableActions.includes(a);
  const [editing, setEditing] = React.useState(false);
  const [version, setVersion] = React.useState<number | null>(null);
  const extract = useInquiryMutation(d.id, () => inquiriesApi.extract(d.id));
  const shown = d.extractions.find((e) => e.version === version) ?? d.latestExtraction;
  const failed = d.extractions[0]?.status === "FAILED" ? d.extractions[0] : null;
  const st = EXTRACTION_LABELS[extract.isPending ? "PROCESSING" : d.extractionStatus];
  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="text-base">Structured RFQ</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={st.variant} aria-live="polite">{st.label}</Badge>
          {can("extract") && (
            <Button size="sm" variant="outline" onClick={() => extract.mutate(undefined)} disabled={extract.isPending}>
              <RefreshCw className={`size-4 ${extract.isPending ? "animate-spin" : ""}`} aria-hidden="true" />{extract.isPending ? "Extracting…" : d.extractions.length ? "Re-run extraction" : "Extract RFQ"}
            </Button>
          )}
          {can("confirm") && !editing && <Button size="sm" onClick={() => setEditing(true)}>{d.confirmed ? "Edit confirmed RFQ" : d.latestExtraction ? "Review & confirm" : "Enter RFQ manually"}</Button>}
        </div>
      </div>
      {failed && !extract.isPending && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-2 text-sm">Extraction v{failed.version} failed: {failed.error} The inquiry is still fully usable — you can enter the RFQ manually.</p>
      )}
      {editing ? (
        <RfqEditor d={d} onDone={() => setEditing(false)} />
      ) : (
        <>
          {d.confirmed && (
            <section aria-labelledby="confirmed-h" className="flex flex-col gap-2">
              <h3 id="confirmed-h" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <Badge variant="success"><UserCheck className="size-3" aria-hidden="true" />Human-confirmed RFQ</Badge>
                <Caption>by {d.confirmed.confirmedBy ?? "member"} · {new Date(d.confirmed.confirmedAt).toLocaleString()}{d.confirmed.basedOnExtractionVersion ? ` · from extraction v${d.confirmed.basedOnExtractionVersion}` : " · entered manually"}</Caption>
              </h3>
              <ConfirmedView c={d.confirmed} d={d} />
            </section>
          )}
          {d.reviewDraft && !d.confirmed && <p className="text-sm text-muted-foreground">A review draft was saved {new Date(d.reviewDraft.savedAt).toLocaleString()}{d.reviewDraft.savedBy ? ` by ${d.reviewDraft.savedBy}` : ""} — not confirmed yet.</p>}
          {shown?.data ? (
            <details open={!d.confirmed} className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Extraction output (v{shown.version}){d.confirmed ? " — kept as evidence" : ""}</summary>
              {d.extractions.filter((e) => e.status === "COMPLETED").length > 1 && (
                <Select label="Extraction version" value={String(shown.version)} onChange={(e) => setVersion(Number(e.target.value))} options={d.extractions.filter((e) => e.status === "COMPLETED").map((e) => ({ value: String(e.version), label: `v${e.version} · ${new Date(e.generatedAt).toLocaleString()}` }))} containerClassName="my-2 max-w-xs" />
              )}
              <div className="mt-2"><ExtractionView e={shown} /></div>
            </details>
          ) : (
            !d.confirmed && (
              <div className="rounded-md border border-dashed border-border p-4 text-center text-sm">
                <p className="font-medium">No structured RFQ yet</p>
                <p className="text-muted-foreground">Extract it from the message, or enter it manually.</p>
              </div>
            )
          )}
          {d.missingFields.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-sm" role="note">
              <p className="font-medium">Missing / needs clarification</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">{d.missingFields.map((m) => <li key={m.field}><Badge variant="warning">{m.label} — {m.reason === "MISSING" ? "missing" : m.reason === "AMBIGUOUS" ? "ambiguous" : "low confidence"}</Badge></li>)}</ul>
            </div>
          )}
          {hasPermission(session, "costing.create") && d.confirmed?.items.some((i) => i.productId) && (
            <Caption>Next step for pricing: <Link className="text-primary hover:underline" href={costingHref(d)}>create an export costing</Link> (existing costing module).</Caption>
          )}
        </>
      )}
    </Card>
  );
}

function costingHref(d: BuyerInquiryDetail) {
  const it = d.confirmed!.items.find((i) => i.productId)!;
  const unit = ["KG", "MT", "UNIT", "CARTON", "CONTAINER"].includes((it.quantityUnit ?? "").toUpperCase()) ? it.quantityUnit!.toUpperCase() : "";
  const q = new URLSearchParams({ productId: it.productId!, ...(d.confirmed!.destination.countryCode ? { country: d.confirmed!.destination.countryCode } : {}), ...(it.quantity ? { quantity: it.quantity } : {}), ...(unit ? { unit } : {}), ...(d.crm ? { crmLeadId: d.crm.leadId } : {}) });
  return `/costing/new?${q}`;
}

function ConfirmedView({ c, d }: { c: ConfirmedRfq; d: BuyerInquiryDetail }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {c.items.length === 0 ? <p className="text-muted-foreground">No items.</p> : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[34rem]">
            <caption className="sr-only">Confirmed items</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{["Product", "Quantity", "Specification", "Packaging", "Buyer price"].map((h) => <th key={h} scope="col" className="px-2 py-1.5 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {c.items.map((i, n) => (
                <tr key={i.id ?? n} className="border-t border-border align-top">
                  <td className="px-2 py-1.5">{i.productName}{i.hsCode && <Caption className="block">HS {i.hsCode}</Caption>}{i.productId ? <Caption className="block">Linked to saved product</Caption> : <Caption className="block">Not linked — <Link className="text-primary hover:underline" href={`/products/analyze?input=${encodeURIComponent(i.productName)}`}>Analyze / save product</Link></Caption>}</td>
                  <td className="px-2 py-1.5">{i.quantity ? `${i.quantity} ${i.quantityUnit ?? ""}` : <span className="text-muted-foreground">Unknown</span>}</td>
                  <td className="px-2 py-1.5">{i.specification ?? "—"}</td>
                  <td className="px-2 py-1.5">{i.packaging ?? "—"}</td>
                  <td className="px-2 py-1.5">{i.targetPrice ? `${i.priceIndicative ? "≈ " : ""}${i.priceCurrency ?? ""} ${i.targetPrice}${i.priceUnitBasis ? `/${i.priceUnitBasis}` : ""}` : "—"}<Caption className="block">buyer input only</Caption></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        <div><dt className="inline text-muted-foreground">Destination: </dt><dd className="inline">{[c.destination.port, c.destination.city, c.destination.countryCode ? countryLabel(c.destination.countryCode) : null].filter(Boolean).join(", ") || "—"}{d.buyer.countryCode && c.destination.countryCode && d.buyer.countryCode !== c.destination.countryCode ? ` (buyer is in ${countryLabel(d.buyer.countryCode)})` : ""}</dd></div>
        <div><dt className="inline text-muted-foreground">Incoterm: </dt><dd className="inline">{c.incoterm.term ? `${c.incoterm.term}${c.incoterm.place ? ` ${c.incoterm.place}` : ""}` : "—"}</dd></div>
        <div><dt className="inline text-muted-foreground">Payment: </dt><dd className="inline">{c.paymentTerms.type ?? "—"}{c.paymentTerms.advancePercent !== null ? ` · ${c.paymentTerms.advancePercent}% advance` : ""}{c.paymentTerms.creditDays !== null ? ` · ${c.paymentTerms.creditDays} days` : ""}</dd></div>
        <div><dt className="inline text-muted-foreground">Delivery: </dt><dd className="inline">{[c.delivery.targetDate, c.delivery.shipmentWindow, c.delivery.leadTime].filter(Boolean).join(" · ") || "—"}{c.delivery.urgent ? " · urgent" : ""}</dd></div>
        <div><dt className="inline text-muted-foreground">Certifications: </dt><dd className="inline">{c.certifications.join(", ") || "—"}</dd></div>
        <div><dt className="inline text-muted-foreground">Sample: </dt><dd className="inline">{c.sample.required ? `Required${c.sample.quantity ? ` — ${c.sample.quantity}` : ""}${c.sample.deadline ? ` by ${c.sample.deadline}` : ""}` : "Not requested"}</dd></div>
      </dl>
    </div>
  );
}

function RfqEditor({ d, onDone }: { d: BuyerInquiryDetail; onDone: () => void }) {
  const products = useQuery({ queryKey: ["products", "inquiry-picker"], queryFn: () => productsApi.list({ pageSize: 100 }) });
  const base = d.latestExtraction;
  const [v, setV] = React.useState<ConfirmedRfq>(() => {
    if (d.confirmed) return { ...d.confirmed };
    if (d.reviewDraft) return { ...d.reviewDraft };
    return base?.data ? fromExtraction(base.data) : blankRfq();
  });
  const [errors, setErrors] = React.useState<string[]>([]);
  const basedOn = d.confirmed ? d.confirmed.basedOnExtractionVersion : (base?.version ?? null);
  const payload = () => ({ ...v, basedOnExtractionVersion: basedOn, expectedRowVersion: d.rowVersion });
  const save = useInquiryMutation(d.id, () => inquiriesApi.saveDraft(d.id, payload()), "Review draft saved");
  const confirm = useInquiryMutation(d.id, () => inquiriesApi.confirm(d.id, payload()), "RFQ confirmed");
  const validate = () => {
    const er: string[] = [];
    v.items.forEach((i, n) => {
      if (!i.productName.trim()) er.push(`Item ${n + 1}: product name is required.`);
      if (i.quantity && !/^\d{1,14}(\.\d{1,4})?$/.test(i.quantity)) er.push(`Item ${n + 1}: quantity must be a non-negative number.`);
      if (i.targetPrice && !/^\d{1,14}(\.\d{1,6})?$/.test(i.targetPrice)) er.push(`Item ${n + 1}: price must be a non-negative number.`);
      if (i.hsCode && !/^\d{4,10}$/.test(i.hsCode)) er.push(`Item ${n + 1}: HS code must be 4–10 digits.`);
      if (i.priceCurrency && !/^[A-Z]{3}$/.test(i.priceCurrency)) er.push(`Item ${n + 1}: currency must be a 3-letter code.`);
    });
    setErrors(er);
    return er.length === 0;
  };
  const setItem = (n: number, patch: Partial<ConfirmedItem>) => setV({ ...v, items: v.items.map((x, i) => (i === n ? { ...x, ...patch } : x)) });
  const ai = base?.data;
  const hint = (f: ExtractedField<unknown> | undefined) => (f && f.value !== null && (f.confidence === "LOW" || f.ambiguous || !f.explicit) ? `AI: ${f.ambiguous ? "ambiguous" : !f.explicit ? "inferred" : "low confidence"}${f.note ? ` — ${f.note}` : ""}` : undefined);
  const nul = (x: string) => (x.trim() === "" ? null : x);
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (validate()) confirm.mutate(undefined, { onSuccess: onDone }); }} noValidate>
      <HelperText>{ai ? `Prefilled from extraction v${base!.version} (${base!.provenance === "AI_DERIVED" ? "AI" : "rule-based"}). Check every value against the original message — nothing here is confirmed until you click Confirm.` : "Enter the RFQ as stated by the buyer. Leave unknown values empty."}</HelperText>
      {errors.length > 0 && <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-2 text-sm"><ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
      {v.items.map((it, n) => {
        const x = ai?.items[n];
        return (
          <fieldset key={n} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
            <legend className="px-1 text-sm font-medium">Item {n + 1}</legend>
            <Input label="Product" required value={it.productName} onChange={(e) => setItem(n, { productName: e.target.value })} description={hint(x?.productName)} />
            <Select label="Saved product" placeholder="Not linked" value={it.productId ?? ""} onChange={(e) => setItem(n, { productId: e.target.value || null })} options={(products.data?.items ?? []).map((p) => ({ value: p.id, label: p.displayName }))} />
            <Input label="HS code (if stated)" inputMode="numeric" value={it.hsCode ?? ""} onChange={(e) => setItem(n, { hsCode: nul(e.target.value) })} description={x?.hsSuggestion ? `Unconfirmed suggestion: ${x.hsSuggestion.code}` : undefined} />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Quantity" inputMode="decimal" value={it.quantity ?? ""} onChange={(e) => setItem(n, { quantity: nul(e.target.value) })} description={hint(x?.quantity)} />
              <Input label="Unit" placeholder="MT, KG, containers…" value={it.quantityUnit ?? ""} onChange={(e) => setItem(n, { quantityUnit: nul(e.target.value) })} />
            </div>
            <Textarea label="Specification" rows={2} value={it.specification ?? ""} onChange={(e) => setItem(n, { specification: nul(e.target.value) })} containerClassName="sm:col-span-2" description={hint(x?.specification)} />
            <Input label="Packaging" value={it.packaging ?? ""} onChange={(e) => setItem(n, { packaging: nul(e.target.value) })} description={hint(x?.packaging)} />
            <Input label="Delivery date" value={it.deliveryDate ?? ""} onChange={(e) => setItem(n, { deliveryDate: nul(e.target.value) })} />
            <Input label="Buyer price" inputMode="decimal" value={it.targetPrice ?? ""} onChange={(e) => setItem(n, { targetPrice: nul(e.target.value) })} description="Buyer input only — not your price" />
            <Input label="Currency" placeholder="USD" maxLength={3} value={it.priceCurrency ?? ""} onChange={(e) => setItem(n, { priceCurrency: nul(e.target.value.toUpperCase()) })} />
            <Input label="Per" placeholder="KG, MT…" value={it.priceUnitBasis ?? ""} onChange={(e) => setItem(n, { priceUnitBasis: nul(e.target.value) })} />
            <div className="flex items-end justify-between gap-2 pb-1">
              <Checkbox label="Indicative price" checked={it.priceIndicative} onChange={(e) => setItem(n, { priceIndicative: e.target.checked })} />
              <Button type="button" size="icon" variant="ghost" aria-label={`Remove item ${n + 1}`} onClick={() => setV({ ...v, items: v.items.filter((_, i) => i !== n) })}><Trash2 className="size-4" aria-hidden="true" /></Button>
            </div>
          </fieldset>
        );
      })}
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setV({ ...v, items: [...v.items, blankItem()] })}><Plus className="size-4" aria-hidden="true" />Add item</Button>
      <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-1 text-sm font-medium">Destination &amp; Incoterm</legend>
        <Select label="Destination country" placeholder="Unknown" value={v.destination.countryCode ?? ""} onChange={(e) => setV({ ...v, destination: { ...v.destination, countryCode: e.target.value || null } })} options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))} description={hint(ai?.destination.countryCode)} />
        <Input label="Port" value={v.destination.port ?? ""} onChange={(e) => setV({ ...v, destination: { ...v.destination, port: nul(e.target.value) } })} />
        <Select label="Incoterm" placeholder="Unknown" value={v.incoterm.term ?? ""} onChange={(e) => setV({ ...v, incoterm: { ...v.incoterm, term: (e.target.value || null) as ConfirmedRfq["incoterm"]["term"] } })} options={RFQ_INCOTERMS.map((t) => ({ value: t, label: t }))} description={hint(ai?.incoterm.term)} />
        <Input label="Named place" value={v.incoterm.place ?? ""} onChange={(e) => setV({ ...v, incoterm: { ...v.incoterm, place: nul(e.target.value) } })} />
      </fieldset>
      <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-1 text-sm font-medium">Payment, delivery &amp; certifications</legend>
        <Select label="Payment terms" placeholder="Unknown" value={v.paymentTerms.type ?? ""} onChange={(e) => setV({ ...v, paymentTerms: { ...v.paymentTerms, type: (e.target.value || null) as ConfirmedRfq["paymentTerms"]["type"] } })} options={PAYMENT_TERM_TYPES.map((t) => ({ value: t, label: t.replace("_", " ") }))} />
        <Input label="Advance %" inputMode="decimal" value={v.paymentTerms.advancePercent ?? ""} onChange={(e) => setV({ ...v, paymentTerms: { ...v.paymentTerms, advancePercent: e.target.value === "" ? null : Number(e.target.value) } })} />
        <Input label="Credit days" inputMode="numeric" value={v.paymentTerms.creditDays ?? ""} onChange={(e) => setV({ ...v, paymentTerms: { ...v.paymentTerms, creditDays: e.target.value === "" ? null : Number(e.target.value) } })} />
        <Input label="Buyer's payment wording" value={v.paymentTerms.raw ?? ""} onChange={(e) => setV({ ...v, paymentTerms: { ...v.paymentTerms, raw: nul(e.target.value) } })} />
        <Input label="Target delivery date" value={v.delivery.targetDate ?? ""} onChange={(e) => setV({ ...v, delivery: { ...v.delivery, targetDate: nul(e.target.value) } })} />
        <Input label="Shipment window" value={v.delivery.shipmentWindow ?? ""} onChange={(e) => setV({ ...v, delivery: { ...v.delivery, shipmentWindow: nul(e.target.value) } })} />
        <Input label="Lead time" value={v.delivery.leadTime ?? ""} onChange={(e) => setV({ ...v, delivery: { ...v.delivery, leadTime: nul(e.target.value) } })} />
        <div className="flex items-end pb-2"><Checkbox label="Buyer marked urgent" checked={v.delivery.urgent} onChange={(e) => setV({ ...v, delivery: { ...v.delivery, urgent: e.target.checked } })} /></div>
        <Input label="Certifications requested" placeholder="Comma-separated" value={v.certifications.join(", ")} onChange={(e) => setV({ ...v, certifications: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} containerClassName="sm:col-span-2" description="Buyer request only." />
      </fieldset>
      <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-1 text-sm font-medium">Sample</legend>
        <div className="flex items-end pb-2"><Checkbox label="Sample requested" checked={v.sample.required} onChange={(e) => setV({ ...v, sample: { ...v.sample, required: e.target.checked } })} /></div>
        <Input label="Sample quantity" value={v.sample.quantity ?? ""} onChange={(e) => setV({ ...v, sample: { ...v.sample, quantity: nul(e.target.value) } })} />
        <Input label="Sample specification" value={v.sample.specification ?? ""} onChange={(e) => setV({ ...v, sample: { ...v.sample, specification: nul(e.target.value) } })} />
        <Input label="Sample deadline" value={v.sample.deadline ?? ""} onChange={(e) => setV({ ...v, sample: { ...v.sample, deadline: nul(e.target.value) } })} />
      </fieldset>
      <Textarea label="Review notes" rows={2} value={v.notes ?? ""} onChange={(e) => setV({ ...v, notes: nul(e.target.value) })} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={() => validate() && save.mutate(undefined)}>Save draft</Button>
        <Button type="submit" disabled={confirm.isPending}><CheckCircle2 className="size-4" aria-hidden="true" />{confirm.isPending ? "Confirming…" : "Confirm RFQ"}</Button>
      </div>
    </form>
  );
}
