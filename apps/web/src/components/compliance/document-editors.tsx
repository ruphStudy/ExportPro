"use client";

import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import type { CommercialInvoiceContent, PackingListContent, PartySnapshot, ShippingInstructionContent, TradeDocumentDetail } from "@exportpro/types";
import { COUNTRIES, countryLabel, RFQ_INCOTERMS } from "@exportpro/types";
import { documentsApi } from "@/lib/api/compliance";
import { fmtAmount } from "@/lib/api/commercial";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";
import { useComplianceMutation } from "./shared";

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.label }));
const MODES = ["SEA", "AIR", "ROAD", "RAIL"].map((m) => ({ value: m, label: m.toLowerCase() }));
const s = (v: string | null | undefined) => v ?? "";
const n = (v: string) => (v.trim() === "" ? null : v.trim());

function PartyFields({ label, p, onChange }: { label: string; p: PartySnapshot | null; onChange: (p: PartySnapshot) => void }) {
  const v = p ?? { name: "", address: null, country: null, contactName: null, email: null, phone: null };
  const set = (k: keyof PartySnapshot, x: string) => onChange({ ...v, [k]: x || null, name: k === "name" ? x : v.name });
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <Input label="Name" required value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={200} />
      <Input label="Country" value={s(v.country)} onChange={(e) => set("country", e.target.value)} maxLength={80} />
      <Textarea label="Address" rows={2} value={s(v.address)} onChange={(e) => set("address", e.target.value)} maxLength={500} containerClassName="sm:col-span-2" />
      <Input label="Contact" value={s(v.contactName)} onChange={(e) => set("contactName", e.target.value)} maxLength={120} />
      <Input label="Email / phone" value={s(v.email)} onChange={(e) => set("email", e.target.value)} maxLength={160} />
    </fieldset>
  );
}

function SaveBar({ onSave, saving, note }: { onSave: () => void; saving: boolean; note?: string }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-1 py-3">
      {note && <Caption>{note}</Caption>}
      <Button type="button" onClick={onSave} loading={saving}>Save draft</Button>
    </div>
  );
}

function useSave(d: TradeDocumentDetail) {
  return useComplianceMutation((content: object) => documentsApi.update(d.id, { expectedRowVersion: d.rowVersion, content }), "Draft saved");
}

export function CommercialInvoiceEditor({ d }: { d: TradeDocumentDetail }) {
  const [c, setC] = React.useState(d.content as CommercialInvoiceContent);
  const save = useSave(d);
  const set = <K extends keyof CommercialInvoiceContent>(k: K, v: CommercialInvoiceContent[K]) => setC((p) => ({ ...p, [k]: v }));
  const setItem = (i: number, patch: Partial<CommercialInvoiceContent["items"][number]>) => setC((p) => ({ ...p, items: p.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  return (
    <form className="flex flex-col gap-4" aria-label="Commercial invoice editor" onSubmit={(e) => e.preventDefault()}>
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">Invoice details</SectionTitle>
        <HelperText>Prefilled from the accepted buyer PO (prices are the PO prices, never recalculated from costing).</HelperText>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Invoice date" type="date" value={s(c.invoiceDate)} onChange={(e) => set("invoiceDate", n(e.target.value))} />
          <Input label="Buyer PO ref." value={s(c.buyerPoReference)} onChange={(e) => set("buyerPoReference", n(e.target.value))} maxLength={80} />
          <Input label="Currency" value={c.currency} disabled />
          <Select label="Incoterm" placeholder="—" value={s(c.incoterm)} onChange={(e) => set("incoterm", n(e.target.value))} options={RFQ_INCOTERMS.map((t) => ({ value: t, label: t }))} />
          <Input label="Named place" value={s(c.incotermPlace)} onChange={(e) => set("incotermPlace", n(e.target.value))} maxLength={80} />
          <Select label="Country of origin" placeholder="—" value={s(c.originCountry)} onChange={(e) => set("originCountry", n(e.target.value))} options={COUNTRY_OPTIONS} />
          <Select label="Destination" placeholder="—" value={s(c.destinationCountry)} onChange={(e) => set("destinationCountry", n(e.target.value))} options={COUNTRY_OPTIONS} />
          <Select label="Shipment mode" placeholder="—" value={s(c.shipmentMode)} onChange={(e) => set("shipmentMode", n(e.target.value))} options={MODES} />
          <Input label="Port of loading" value={s(c.portOfLoading)} onChange={(e) => set("portOfLoading", n(e.target.value))} maxLength={80} />
          <Input label="Port of discharge" value={s(c.portOfDischarge)} onChange={(e) => set("portOfDischarge", n(e.target.value))} maxLength={80} />
        </div>
      </Card>
      <Card className="p-4"><PartyFields label="Buyer / consignee" p={c.consignee} onChange={(p) => set("consignee", p)} /></Card>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Items</SectionTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => set("items", [...c.items, { description: "", hsCode: null, quantity: "", unit: "MT", unitPrice: "" }])}><Plus className="size-4" aria-hidden="true" />Add item</Button>
        </div>
        <ol className="flex flex-col gap-3">
          {c.items.map((it, i) => (
            <li key={i} className="rounded-md border border-border p-3">
              <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <legend className="sr-only">Item {i + 1}</legend>
                <Input label={`Item ${i + 1} description`} required value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} maxLength={300} containerClassName="sm:col-span-2 lg:col-span-2" />
                <Input label="HS code" value={s(it.hsCode)} onChange={(e) => setItem(i, { hsCode: n(e.target.value) })} maxLength={10} />
                <Input label="Quantity" inputMode="decimal" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} />
                <Input label="Unit" value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value.toUpperCase() })} maxLength={20} />
                <Input label={`Unit price (${c.currency})`} inputMode="decimal" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} />
              </fieldset>
              <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => set("items", c.items.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`}><Trash2 className="size-4" aria-hidden="true" />Remove</Button>
            </li>
          ))}
        </ol>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Additional charges" inputMode="decimal" value={s(c.additionalCharges)} onChange={(e) => set("additionalCharges", n(e.target.value))} />
          <Input label="Charges label" value={s(c.chargesLabel)} onChange={(e) => set("chargesLabel", n(e.target.value))} maxLength={80} />
          <Input label="Discount" inputMode="decimal" value={s(c.discount)} onChange={(e) => set("discount", n(e.target.value))} />
        </div>
        <p className="text-sm">Saved total: <strong>{fmtAmount(d.totals?.total ?? null, c.currency)}</strong> <Caption>(computed by the server)</Caption></p>
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <Textarea label="Payment terms" rows={2} value={s(c.paymentTerms)} onChange={(e) => set("paymentTerms", n(e.target.value))} maxLength={1000} />
          <Textarea label="Shipping terms" rows={2} value={s(c.shippingTerms)} onChange={(e) => set("shippingTerms", n(e.target.value))} maxLength={1000} />
          <Textarea label="Marks & numbers" rows={2} value={s(c.marks)} onChange={(e) => set("marks", n(e.target.value))} maxLength={500} />
          <Textarea label="Declaration" rows={2} value={s(c.declaration)} onChange={(e) => set("declaration", n(e.target.value))} maxLength={2000} description="Your declaration as exporter. Review before approval." />
        </div>
      </Card>
      <SaveBar onSave={() => save.mutate(c)} saving={save.isPending} />
    </form>
  );
}

export function PackingListEditor({ d }: { d: TradeDocumentDetail }) {
  const [c, setC] = React.useState(d.content as PackingListContent);
  const save = useSave(d);
  const set = <K extends keyof PackingListContent>(k: K, v: PackingListContent[K]) => setC((p) => ({ ...p, [k]: v }));
  const setPkg = (i: number, patch: Partial<PackingListContent["packages"][number]>) => setC((p) => ({ ...p, packages: p.packages.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  return (
    <form className="flex flex-col gap-4" aria-label="Packing list editor" onSubmit={(e) => e.preventDefault()}>
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">Shipment</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Invoice ref." value={s(c.invoiceReference)} onChange={(e) => set("invoiceReference", n(e.target.value))} maxLength={80} />
          <Select label="Destination" placeholder="—" value={s(c.destinationCountry)} onChange={(e) => set("destinationCountry", n(e.target.value))} options={COUNTRY_OPTIONS} />
          <Input label="Port of loading" value={s(c.portOfLoading)} onChange={(e) => set("portOfLoading", n(e.target.value))} maxLength={80} />
          <Input label="Port of discharge" value={s(c.portOfDischarge)} onChange={(e) => set("portOfDischarge", n(e.target.value))} maxLength={80} />
        </div>
      </Card>
      <Card className="p-4"><PartyFields label="Consignee" p={c.consignee} onChange={(p) => set("consignee", p)} /></Card>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Packages</SectionTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => set("packages", [...c.packages, { marks: null, packageType: "", packageCount: 0, description: "", quantity: null, unit: null, netWeightKg: null, grossWeightKg: null, dimensions: null, volumeCbm: null }])}><Plus className="size-4" aria-hidden="true" />Add line</Button>
        </div>
        <HelperText>Enter actual package counts and weights — ExportPro never estimates them. Gross weight must be at least the net weight.</HelperText>
        <ol className="flex flex-col gap-3">
          {c.packages.map((p, i) => (
            <li key={i} className="rounded-md border border-border p-3">
              <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <legend className="sr-only">Package line {i + 1}</legend>
                <Input label={`Line ${i + 1} description`} value={p.description} onChange={(e) => setPkg(i, { description: e.target.value })} maxLength={300} containerClassName="sm:col-span-2" />
                <Input label="Package type" value={p.packageType} onChange={(e) => setPkg(i, { packageType: e.target.value })} maxLength={60} />
                <Input label="No. of packages" type="number" min={0} value={String(p.packageCount)} onChange={(e) => setPkg(i, { packageCount: Number(e.target.value || 0) })} />
                <Input label="Marks & nos." value={s(p.marks)} onChange={(e) => setPkg(i, { marks: n(e.target.value) })} maxLength={200} containerClassName="sm:col-span-2" />
                <Input label="Quantity" inputMode="decimal" value={s(p.quantity)} onChange={(e) => setPkg(i, { quantity: n(e.target.value) })} />
                <Input label="Unit" value={s(p.unit)} onChange={(e) => setPkg(i, { unit: n(e.target.value) })} maxLength={20} />
                <Input label="Net weight (kg)" inputMode="decimal" value={s(p.netWeightKg)} onChange={(e) => setPkg(i, { netWeightKg: n(e.target.value) })} />
                <Input label="Gross weight (kg)" inputMode="decimal" value={s(p.grossWeightKg)} onChange={(e) => setPkg(i, { grossWeightKg: n(e.target.value) })} />
                <Input label="Dimensions" value={s(p.dimensions)} onChange={(e) => setPkg(i, { dimensions: n(e.target.value) })} maxLength={80} />
                <Input label="Volume (CBM)" inputMode="decimal" value={s(p.volumeCbm)} onChange={(e) => setPkg(i, { volumeCbm: n(e.target.value) })} />
              </fieldset>
              <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => set("packages", c.packages.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}><Trash2 className="size-4" aria-hidden="true" />Remove</Button>
            </li>
          ))}
        </ol>
        {d.totals && <p className="text-sm">Saved totals: {d.totals.packages ?? 0} packages · net {d.totals.netWeightKg ?? "—"} kg · gross {d.totals.grossWeightKg ?? "—"} kg{d.totals.volumeCbm ? ` · ${d.totals.volumeCbm} CBM` : ""}</p>}
        <Textarea label="Notes (printed)" rows={2} value={s(c.notes)} onChange={(e) => set("notes", n(e.target.value))} maxLength={2000} />
      </Card>
      <SaveBar onSave={() => save.mutate({ ...c, packages: c.packages.map((p) => ({ ...p, packageCount: Number.isFinite(p.packageCount) ? p.packageCount : 0 })) })} saving={save.isPending} />
    </form>
  );
}

export function ShippingInstructionEditor({ d }: { d: TradeDocumentDetail }) {
  const [c, setC] = React.useState(d.content as ShippingInstructionContent);
  const save = useSave(d);
  const set = <K extends keyof ShippingInstructionContent>(k: K, v: ShippingInstructionContent[K]) => setC((p) => ({ ...p, [k]: v }));
  return (
    <form className="flex flex-col gap-4" aria-label="Shipping instruction editor" onSubmit={(e) => e.preventDefault()}>
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">Routing</SectionTitle>
        <HelperText>Instruction to your forwarder/carrier. The bill of lading or airway bill is issued by the carrier, not here.</HelperText>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Origin" placeholder="—" value={s(c.originCountry)} onChange={(e) => set("originCountry", n(e.target.value))} options={COUNTRY_OPTIONS} />
          <Select label="Destination" placeholder="—" value={s(c.destinationCountry)} onChange={(e) => set("destinationCountry", n(e.target.value))} options={COUNTRY_OPTIONS} />
          <Input label="Place of receipt" value={s(c.placeOfReceipt)} onChange={(e) => set("placeOfReceipt", n(e.target.value))} maxLength={80} />
          <Input label="Port of loading" value={s(c.portOfLoading)} onChange={(e) => set("portOfLoading", n(e.target.value))} maxLength={80} />
          <Input label="Port of discharge" value={s(c.portOfDischarge)} onChange={(e) => set("portOfDischarge", n(e.target.value))} maxLength={80} />
          <Input label="Final destination" value={s(c.finalDestination)} onChange={(e) => set("finalDestination", n(e.target.value))} maxLength={80} />
          <Select label="Incoterm" placeholder="—" value={s(c.incoterm)} onChange={(e) => set("incoterm", n(e.target.value))} options={RFQ_INCOTERMS.map((t) => ({ value: t, label: t }))} />
          <Input label="Named place" value={s(c.incotermPlace)} onChange={(e) => set("incotermPlace", n(e.target.value))} maxLength={80} />
          <Select label="Shipment mode" placeholder="—" value={s(c.shipmentMode)} onChange={(e) => set("shipmentMode", n(e.target.value))} options={MODES} />
          <Input label="Freight payable at" value={s(c.freightPayableAt)} onChange={(e) => set("freightPayableAt", n(e.target.value))} maxLength={80} />
        </div>
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <PartyFields label="Consignee" p={c.consignee} onChange={(p) => set("consignee", p)} />
        <Textarea label="Notify party" rows={2} value={s(c.notifyParty)} onChange={(e) => set("notifyParty", n(e.target.value))} maxLength={500} />
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">Cargo</SectionTitle>
        <Textarea label="Cargo description" rows={3} value={s(c.cargoDescription)} onChange={(e) => set("cargoDescription", n(e.target.value))} maxLength={2000} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input label="HS codes" value={s(c.hsCodes)} onChange={(e) => set("hsCodes", n(e.target.value))} maxLength={200} />
          <Input label="Packages" type="number" min={0} value={c.packageCount === null ? "" : String(c.packageCount)} onChange={(e) => set("packageCount", e.target.value === "" ? null : Number(e.target.value))} />
          <Input label="Net weight (kg)" inputMode="decimal" value={s(c.netWeightKg)} onChange={(e) => set("netWeightKg", n(e.target.value))} />
          <Input label="Gross weight (kg)" inputMode="decimal" value={s(c.grossWeightKg)} onChange={(e) => set("grossWeightKg", n(e.target.value))} />
          <Input label="Volume (CBM)" inputMode="decimal" value={s(c.volumeCbm)} onChange={(e) => set("volumeCbm", n(e.target.value))} />
        </div>
        <Textarea label="Shipping marks" rows={2} value={s(c.shippingMarks)} onChange={(e) => set("shippingMarks", n(e.target.value))} maxLength={500} />
        <Textarea label="Special instructions" rows={3} value={s(c.specialInstructions)} onChange={(e) => set("specialInstructions", n(e.target.value))} maxLength={2000} />
      </Card>
      <SaveBar onSave={() => save.mutate(c)} saving={save.isPending} />
    </form>
  );
}

/** Document-facing preview (exactly the fields printed on the PDF; never internal notes). */
export function DocumentPreview({ d }: { d: TradeDocumentDetail }) {
  const c = d.content as unknown as Record<string, unknown> | null;
  if (!c) return null;
  const party = (p: PartySnapshot | null) => (p ? [p.name, p.address, p.country, p.contactName && `Attn: ${p.contactName}`, p.email].filter(Boolean).join(", ") : "—");
  const row = (label: string, v: unknown) => (v ? <><dt className="font-medium">{label}</dt><dd className="break-words">{String(v)}</dd></> : null);
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-6" aria-label="Document preview">
      {!["APPROVED", "SUPERSEDED", "EXPIRED", "ARCHIVED"].includes(d.status) && <p className="self-start rounded bg-muted px-2 py-0.5 text-xs font-medium uppercase">Draft preview</p>}
      {d.documentType === "COMMERCIAL_INVOICE" && (() => {
        const x = c as unknown as CommercialInvoiceContent;
        return (
          <>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              {row("Buyer / consignee", party(x.consignee))}{row("Invoice date", x.invoiceDate)}{row("Buyer PO", x.buyerPoReference)}
              {row("Incoterms® 2020", x.incoterm && `${x.incoterm} ${x.incotermPlace ?? ""}`)}{row("Origin", x.originCountry && countryLabel(x.originCountry))}{row("Destination", x.destinationCountry && countryLabel(x.destinationCountry))}
              {row("Port of loading", x.portOfLoading)}{row("Port of discharge", x.portOfDischarge)}
            </dl>
            <div className="overflow-x-auto"><table className="w-full min-w-[30rem] text-sm"><caption className="sr-only">Invoice items</caption><thead className="border-b border-border text-xs text-muted-foreground"><tr>{["Description", "HS", "Qty", "Unit price", "Amount"].map((h) => <th key={h} scope="col" className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody>{x.items.map((i, k) => <tr key={k} className="border-b border-border"><td className="px-2 py-1">{i.description}</td><td className="px-2 py-1">{i.hsCode ?? "—"}</td><td className="px-2 py-1">{i.quantity} {i.unit}</td><td className="px-2 py-1">{i.unitPrice}</td><td className="px-2 py-1">{i.quantity && i.unitPrice ? fmtAmount((Number(i.quantity) * Number(i.unitPrice)).toFixed(2)) : "—"}</td></tr>)}</tbody></table></div>
            <p className="text-right text-sm font-semibold">Total {fmtAmount(d.totals?.total ?? null, x.currency)}</p>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">{row("Payment terms", x.paymentTerms)}{row("Shipping terms", x.shippingTerms)}{row("Marks", x.marks)}{row("Declaration", x.declaration)}</dl>
          </>
        );
      })()}
      {d.documentType === "PACKING_LIST" && (() => {
        const x = c as unknown as PackingListContent;
        return (
          <>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">{row("Consignee", party(x.consignee))}{row("Invoice ref.", x.invoiceReference)}{row("Port of loading", x.portOfLoading)}{row("Port of discharge", x.portOfDischarge)}</dl>
            <div className="overflow-x-auto"><table className="w-full min-w-[30rem] text-sm"><caption className="sr-only">Packages</caption><thead className="border-b border-border text-xs text-muted-foreground"><tr>{["Marks", "Packages", "Description", "Net kg", "Gross kg"].map((h) => <th key={h} scope="col" className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody>{x.packages.map((p, k) => <tr key={k} className="border-b border-border"><td className="px-2 py-1">{p.marks ?? "—"}</td><td className="px-2 py-1">{p.packageCount} × {p.packageType || "—"}</td><td className="px-2 py-1">{p.description}</td><td className="px-2 py-1">{p.netWeightKg ?? "—"}</td><td className="px-2 py-1">{p.grossWeightKg ?? "—"}</td></tr>)}</tbody></table></div>
            {d.totals && <p className="text-right text-sm font-semibold">{d.totals.packages} packages · net {d.totals.netWeightKg ?? "—"} kg · gross {d.totals.grossWeightKg ?? "—"} kg</p>}
          </>
        );
      })()}
      {d.documentType === "SHIPPING_INSTRUCTION" && (() => {
        const x = c as unknown as ShippingInstructionContent;
        return (
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            {row("Consignee", party(x.consignee))}{row("Notify party", x.notifyParty)}{row("Port of loading", x.portOfLoading)}{row("Port of discharge", x.portOfDischarge)}{row("Final destination", x.finalDestination)}
            {row("Incoterms® 2020", x.incoterm && `${x.incoterm} ${x.incotermPlace ?? ""}`)}{row("Mode", x.shipmentMode)}{row("Cargo", x.cargoDescription)}{row("HS codes", x.hsCodes)}
            {row("Packages", x.packageCount)}{row("Gross weight (kg)", x.grossWeightKg)}{row("Shipping marks", x.shippingMarks)}{row("Special instructions", x.specialInstructions)}
          </dl>
        );
      })()}
    </Card>
  );
}
