"use client";

import { useQuery } from "@tanstack/react-query";
import { Calculator, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import type { QuotationDetail } from "@exportpro/types";
import { COUNTRIES } from "@exportpro/types";
import { commercialApi, fmtAmount, quotationsApi } from "@/lib/api/commercial";
import { costingApi } from "@/lib/api/costing";
import { STATUS_LABELS } from "@/lib/costing-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";
import { TermsSelects, useBuyerOptions, useCommercialMutation } from "./shared";

interface ItemDraft {
  key: string;
  id?: string;
  description: string;
  hsCode: string;
  specification: string;
  packaging: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  savedPrice: string | null;
  overrideReason: string;
  costing: QuotationDetail["items"][number]["costing"];
  newCostingId?: string;
  newCostingLabel?: string;
  applyCostingPrice?: boolean;
  priceSource: string;
}

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.label }));
const n = (v: string) => v.trim() || null;
let seq = 0;
const toDraft = (i: QuotationDetail["items"][number]): ItemDraft => ({
  key: i.id,
  id: i.id,
  description: i.description,
  hsCode: i.hsCode ?? "",
  specification: i.specification ?? "",
  packaging: i.packaging ?? "",
  quantity: i.quantity,
  unit: i.unit,
  unitPrice: i.unitPrice ?? "",
  savedPrice: i.unitPrice,
  overrideReason: i.overrideReason ?? "",
  costing: i.costing,
  priceSource: i.priceSource,
});

/** DRAFT quotation editor (header, buyer, items, terms). Remount with key on rowVersion. */
export function QuotationEditor({ d }: { d: QuotationDetail }) {
  const { data: session } = useSession();
  const buyers = useBuyerOptions(d.buyer);
  const [f, setF] = React.useState({
    buyerCompanyId: d.buyer.id ?? "",
    buyerName: d.buyer.id ? "" : d.buyer.name,
    currency: d.currency,
    validUntil: d.validUntil ?? "",
    incoterm: d.incoterm,
    incotermPlace: d.incotermPlace ?? "",
    originCountry: d.originCountry ?? "",
    destinationCountry: d.destinationCountry ?? "",
    destinationPort: d.destinationPort ?? "",
    paymentTerms: d.paymentTerms ?? "",
    deliveryTerms: d.deliveryTerms ?? "",
    leadTime: d.leadTime ?? "",
    shipmentWindow: d.shipmentWindow ?? "",
    partialShipment: d.partialShipment === null ? "" : String(d.partialShipment),
    transshipment: d.transshipment === null ? "" : String(d.transshipment),
    buyerNotes: d.buyerNotes ?? "",
    internalNotes: d.internalNotes ?? "",
    termsAndConditions: d.termsAndConditions ?? "",
    additionalCharges: d.additionalCharges === "0.00" ? "" : d.additionalCharges,
    chargesLabel: d.chargesLabel ?? "",
    discount: d.discount === "0.00" ? "" : d.discount,
  });
  const [items, setItems] = React.useState<ItemDraft[]>(d.items.map(toDraft));
  const [currencyConfirm, setCurrencyConfirm] = React.useState(false);
  const [costingFor, setCostingFor] = React.useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | null) => setF((p) => ({ ...p, [k]: v ?? "" }));
  const setItem = (key: string, patch: Partial<ItemDraft>) => setItems((p) => p.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const canInternal = hasPermission(session, "quotations.edit");
  const currencyChanged = f.currency !== d.currency;
  const pricedItems = d.items.some((i) => i.unitPrice !== null);

  const save = useCommercialMutation(
    () =>
      quotationsApi.update(d.id, {
        expectedRowVersion: d.rowVersion,
        buyerCompanyId: f.buyerCompanyId || null,
        ...(f.buyerCompanyId ? {} : { buyerName: n(f.buyerName) }),
        currency: f.currency,
        clearPricesOnCurrencyChange: currencyChanged && pricedItems ? true : undefined,
        validUntil: n(f.validUntil),
        incoterm: f.incoterm,
        incotermPlace: n(f.incotermPlace),
        originCountry: n(f.originCountry),
        destinationCountry: n(f.destinationCountry),
        destinationPort: n(f.destinationPort),
        paymentTerms: n(f.paymentTerms),
        deliveryTerms: n(f.deliveryTerms),
        leadTime: n(f.leadTime),
        shipmentWindow: n(f.shipmentWindow),
        partialShipment: f.partialShipment === "" ? null : f.partialShipment === "true",
        transshipment: f.transshipment === "" ? null : f.transshipment === "true",
        buyerNotes: n(f.buyerNotes),
        internalNotes: canInternal ? n(f.internalNotes) : undefined,
        termsAndConditions: n(f.termsAndConditions),
        additionalCharges: f.additionalCharges.trim() || "0",
        chargesLabel: n(f.chargesLabel),
        discount: f.discount.trim() || "0",
        items: items.map((i) => ({
          id: i.id,
          description: i.description.trim(),
          hsCode: n(i.hsCode),
          specification: n(i.specification),
          packaging: n(i.packaging),
          quantity: i.quantity.trim(),
          unit: i.unit.trim(),
          ...(i.newCostingId ? { costingId: i.newCostingId } : i.applyCostingPrice ? { applyCostingPrice: true } : currencyChanged && pricedItems ? {} : { unitPrice: n(i.unitPrice) }),
          overrideReason: n(i.overrideReason) ?? undefined,
        })),
      }),
    "Quotation saved",
  );

  const starter = useCommercialMutation(() => commercialApi.starterTerms(), undefined, (t) => {
    set("termsAndConditions", f.termsAndConditions ? `${f.termsAndConditions}\n\n${t.text}` : t.text);
    toast.info("Starter terms inserted", t.notice);
  });

  const submit = () => (currencyChanged && pricedItems ? setCurrencyConfirm(true) : save.mutate(undefined));
  const priceChanged = (i: ItemDraft) => Boolean(i.costing || i.newCostingId) && !i.applyCostingPrice && !i.newCostingId && (i.unitPrice.trim() || null) !== i.savedPrice;
  const needsReason = (i: ItemDraft) => priceChanged(i) || i.priceSource === "OVERRIDE";

  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label="Quotation editor">
      <Card className="flex flex-col gap-4 p-4">
        <SectionTitle className="text-base">Buyer &amp; validity</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Buyer" placeholder="Not selected" value={f.buyerCompanyId} onChange={(e) => set("buyerCompanyId", e.target.value)} options={buyers} containerClassName="lg:col-span-2" />
          {!f.buyerCompanyId && <Input label="Buyer name (no buyer record)" value={f.buyerName} onChange={(e) => set("buyerName", e.target.value)} maxLength={160} containerClassName="lg:col-span-2" />}
          <TermsSelects currency={f.currency} incoterm={f.incoterm} onCurrency={(v) => set("currency", v)} onIncoterm={(v) => set("incoterm", v)} />
          <Input label="Named place" value={f.incotermPlace} onChange={(e) => set("incotermPlace", e.target.value)} maxLength={80} placeholder="e.g. Mundra" />
          <Input label="Valid until" type="date" value={f.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
        </div>
        {currencyChanged && pricedItems && <p role="note" className="text-sm text-warning">Changing currency clears all unit prices. Re-enter them or re-apply a costing in {f.currency}.</p>}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Items</SectionTitle>
          <Button type="button" size="sm" variant="outline" disabled={items.length >= 50} onClick={() => setItems((p) => [...p, { key: `new-${++seq}`, description: "", hsCode: "", specification: "", packaging: "", quantity: "", unit: "MT", unitPrice: "", savedPrice: null, overrideReason: "", costing: null, priceSource: "MANUAL" }])}>
            <Plus className="size-4" aria-hidden="true" />Add item
          </Button>
        </div>
        {!items.length && <HelperText>No items yet. Add at least one item before issuing.</HelperText>}
        <ol className="flex flex-col gap-3">
          {items.map((i, idx) => (
            <li key={i.key} className="rounded-md border border-border p-3">
              <fieldset className="flex flex-col gap-3">
                <legend className="sr-only">Item {idx + 1}</legend>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <Input label={`Item ${idx + 1} description`} required value={i.description} onChange={(e) => setItem(i.key, { description: e.target.value })} maxLength={300} containerClassName="sm:col-span-2 lg:col-span-3" />
                  <Input label="HS code" inputMode="numeric" value={i.hsCode} onChange={(e) => setItem(i.key, { hsCode: e.target.value })} maxLength={10} />
                  <Input label="Quantity" required inputMode="decimal" value={i.quantity} onChange={(e) => setItem(i.key, { quantity: e.target.value })} />
                  <Input label="Unit" required value={i.unit} onChange={(e) => setItem(i.key, { unit: e.target.value.toUpperCase() })} maxLength={20} />
                  <Input label="Specification" value={i.specification} onChange={(e) => setItem(i.key, { specification: e.target.value })} maxLength={1000} containerClassName="sm:col-span-2 lg:col-span-3" />
                  <Input label="Packaging" value={i.packaging} onChange={(e) => setItem(i.key, { packaging: e.target.value })} maxLength={500} containerClassName="lg:col-span-2" />
                  <Input label={`Unit price (${f.currency})`} inputMode="decimal" value={i.unitPrice} disabled={Boolean(i.newCostingId || i.applyCostingPrice)} onChange={(e) => setItem(i.key, { unitPrice: e.target.value })} />
                </div>
                {(i.costing || i.newCostingId) && canInternal && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-xs">
                    <Calculator className="size-3.5" aria-hidden="true" />
                    {i.newCostingId ? (
                      <span>Will link costing {i.newCostingLabel} and take its price on save.</span>
                    ) : i.costing ? (
                      <span>
                        Internal: costing {i.costing.reference} · {i.costing.snapshotKind === "LIVE" ? "live result (not yet a ready/locked snapshot)" : `${i.costing.snapshotKind.toLowerCase()} snapshot`} · {i.costing.costingUnitPrice} {f.currency}/{i.unit}
                        {i.priceSource === "OVERRIDE" && " · price overridden"}
                      </span>
                    ) : null}
                    {i.costing && !i.newCostingId && (
                      <Checkbox label="Re-apply costing price" checked={Boolean(i.applyCostingPrice)} onChange={(e) => setItem(i.key, { applyCostingPrice: e.target.checked })} />
                    )}
                  </div>
                )}
                {needsReason(i) && !i.applyCostingPrice && (
                  <Input label="Price override reason" required={priceChanged(i)} value={i.overrideReason} onChange={(e) => setItem(i.key, { overrideReason: e.target.value })} maxLength={500} description="Required when the price differs from the linked costing. Recorded internally only." />
                )}
                <div className="flex flex-wrap gap-2">
                  {canInternal && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setCostingFor(i.key)}>
                      <Calculator className="size-4" aria-hidden="true" />{i.costing ? "Change costing" : "Price from costing"}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setItems((p) => p.filter((x) => x.key !== i.key))} aria-label={`Remove item ${idx + 1}`}>
                    <Trash2 className="size-4" aria-hidden="true" />Remove
                  </Button>
                </div>
              </fieldset>
            </li>
          ))}
        </ol>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Additional charges" inputMode="decimal" value={f.additionalCharges} onChange={(e) => set("additionalCharges", e.target.value)} placeholder="0.00" />
          <Input label="Charges label" value={f.chargesLabel} onChange={(e) => set("chargesLabel", e.target.value)} maxLength={80} placeholder="e.g. Fumigation" />
          <Input label="Discount" inputMode="decimal" value={f.discount} onChange={(e) => set("discount", e.target.value)} placeholder="0.00" />
        </div>
        <p className="text-sm">Saved total: <strong>{fmtAmount(d.totalAmount, d.currency)}</strong> <Caption>(recalculated by the server on save)</Caption></p>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">Shipment &amp; terms</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Origin country" placeholder="—" value={f.originCountry} onChange={(e) => set("originCountry", e.target.value)} options={COUNTRY_OPTIONS} />
          <Select label="Destination country" placeholder="—" value={f.destinationCountry} onChange={(e) => set("destinationCountry", e.target.value)} options={COUNTRY_OPTIONS} />
          <Input label="Destination port" value={f.destinationPort} onChange={(e) => set("destinationPort", e.target.value)} maxLength={80} />
          <Input label="Lead time" value={f.leadTime} onChange={(e) => set("leadTime", e.target.value)} maxLength={200} />
          <Input label="Shipment window" value={f.shipmentWindow} onChange={(e) => set("shipmentWindow", e.target.value)} maxLength={200} />
          <Select label="Partial shipment" placeholder="Not stated" value={f.partialShipment} onChange={(e) => set("partialShipment", e.target.value)} options={[{ value: "true", label: "Allowed" }, { value: "false", label: "Not allowed" }]} />
          <Select label="Transshipment" placeholder="Not stated" value={f.transshipment} onChange={(e) => set("transshipment", e.target.value)} options={[{ value: "true", label: "Allowed" }, { value: "false", label: "Not allowed" }]} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Textarea label="Payment terms" rows={2} value={f.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} maxLength={1000} />
          <Textarea label="Delivery terms" rows={2} value={f.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} maxLength={1000} />
          <Textarea label="Notes to buyer" rows={3} value={f.buyerNotes} onChange={(e) => set("buyerNotes", e.target.value)} maxLength={3000} />
          {canInternal && <Textarea label="Internal notes (never shown to the buyer)" rows={3} value={f.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} maxLength={3000} />}
        </div>
        <Textarea label="Terms & conditions" rows={6} value={f.termsAndConditions} onChange={(e) => set("termsAndConditions", e.target.value)} maxLength={20000} />
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => starter.mutate(undefined)} loading={starter.isPending}>Insert starter terms</Button>
          <Caption className="ml-2">Starter template only — not legal advice. Review before issuing.</Caption>
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-1 flex justify-end gap-2 border-t border-border bg-background/95 px-1 py-3">
        <Button type="submit" loading={save.isPending}>Save draft</Button>
      </div>

      <ConfirmDialog open={currencyConfirm} onOpenChange={setCurrencyConfirm} title={`Change currency to ${f.currency}?`} description="All unit prices on this quotation will be cleared. Costing prices are only re-applied from a costing quoted in the same currency." confirmLabel="Change and clear prices" destructive loading={save.isPending} onConfirm={() => { setCurrencyConfirm(false); save.mutate(undefined); }} />
      {costingFor && (
        <CostingPicker
          currency={f.currency}
          onClose={() => setCostingFor(null)}
          onPick={(c) => {
            setItem(costingFor, { newCostingId: c.id, newCostingLabel: c.reference, applyCostingPrice: false, overrideReason: "" });
            setCostingFor(null);
          }}
        />
      )}
    </form>
  );
}

function CostingPicker({ currency, onClose, onPick }: { currency: string; onClose: () => void; onPick: (c: { id: string; reference: string }) => void }) {
  const [search, setSearch] = React.useState("");
  const q = useQuery({ queryKey: ["costings", "list", { search, pick: true }], queryFn: () => costingApi.list({ search: search || undefined, pageSize: 20 }) });
  const items = (q.data?.items ?? []).filter((c) => c.status !== "ARCHIVED");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Price from an export costing" description={`Only costings quoted in ${currency} can price this item. The base scenario’s preserved snapshot (locked, else ready, else live) is used.`} className="max-w-lg">
      <Input label="Search costings" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Reference, product, buyer" />
      <ul className="mt-3 flex max-h-80 flex-col gap-1 overflow-y-auto" aria-label="Costings">
        {q.isLoading && <li><HelperText>Loading…</HelperText></li>}
        {!q.isLoading && !items.length && <li><HelperText>No costings found.</HelperText></li>}
        {items.map((c) => {
          const ok = c.quoteCurrency === currency;
          return (
            <li key={c.id}>
              <button type="button" disabled={!ok} onClick={() => onPick(c)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
                <span className="min-w-0">
                  <span className="font-medium">{c.reference}</span> · {c.productName ?? c.name}
                  <Caption className="block">{c.quoteCurrency}{c.base?.sellingPricePerUnit ? ` · ${c.base.sellingPricePerUnit}/${c.base.quantityUnit}` : ""}{ok ? "" : " · different currency"}</Caption>
                </span>
                <Badge variant={STATUS_LABELS[c.status].variant}>{STATUS_LABELS[c.status].label}</Badge>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
