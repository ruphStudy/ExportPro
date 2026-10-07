"use client";

import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import type { PoDetail, QuotationDetail } from "@exportpro/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";
import { TermsSelects } from "./shared";

export interface PoLine { key: string; quotationItemId: string | null; buyerProductCode: string; description: string; specification: string; quantity: string; unit: string; unitPrice: string; totalPrice: string; deliveryDate: string }
export interface PoFormState { poNumber: string; poDate: string; currency: string; incoterm: string | null; incotermPlace: string; paymentTerms: string; deliveryTerms: string; destination: string; totalAmount: string; notes: string; items: PoLine[] }

let seq = 0;
const blankLine = (): PoLine => ({ key: `l-${++seq}`, quotationItemId: null, buyerProductCode: "", description: "", specification: "", quantity: "", unit: "MT", unitPrice: "", totalPrice: "", deliveryDate: "" });
const n = (v: string) => v.trim() || null;

export const emptyPo = (): PoFormState => ({ poNumber: "", poDate: new Date().toISOString().slice(0, 10), currency: "USD", incoterm: null, incotermPlace: "", paymentTerms: "", deliveryTerms: "", destination: "", totalAmount: "", notes: "", items: [] });

export const poFromDetail = (d: PoDetail): PoFormState => ({
  poNumber: d.poNumber,
  poDate: d.poDate.slice(0, 10),
  currency: d.currency,
  incoterm: d.incoterm,
  incotermPlace: d.incotermPlace ?? "",
  paymentTerms: d.paymentTerms ?? "",
  deliveryTerms: d.deliveryTerms ?? "",
  destination: d.destination ?? "",
  totalAmount: d.totalAmount ?? "",
  notes: d.notes ?? "",
  items: d.items.map((i) => ({ key: i.id, quotationItemId: i.quotationItemId, buyerProductCode: i.buyerProductCode ?? "", description: i.description, specification: i.specification ?? "", quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, totalPrice: i.totalPrice ?? "", deliveryDate: i.deliveryDate ?? "" })),
});

/** Starting point only: the user overwrites with what the buyer’s PO actually says. */
export const poPrefillFromQuotation = (s: PoFormState, q: QuotationDetail): PoFormState => ({
  ...s,
  currency: q.currency,
  incoterm: q.incoterm,
  incotermPlace: q.incotermPlace ?? "",
  paymentTerms: q.paymentTerms ?? "",
  deliveryTerms: q.deliveryTerms ?? "",
  items: q.items.map((i) => ({ ...blankLine(), quotationItemId: i.id, description: i.description, specification: i.specification ?? "", quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice ?? "" })),
});

export const poBody = (f: PoFormState) => ({
  poNumber: f.poNumber.trim(),
  poDate: f.poDate,
  currency: f.currency,
  incoterm: f.incoterm,
  incotermPlace: n(f.incotermPlace),
  paymentTerms: n(f.paymentTerms),
  deliveryTerms: n(f.deliveryTerms),
  destination: n(f.destination),
  totalAmount: n(f.totalAmount),
  notes: n(f.notes),
  items: f.items.map((i) => ({ quotationItemId: i.quotationItemId, buyerProductCode: n(i.buyerProductCode), description: i.description.trim(), specification: n(i.specification), quantity: i.quantity.trim(), unit: i.unit.trim(), unitPrice: i.unitPrice.trim(), totalPrice: n(i.totalPrice), deliveryDate: n(i.deliveryDate) })),
});

/** Header + items exactly as written on the buyer’s PO (no OCR, no conversion). */
export function PoFields({ f, onChange, headerOnly }: { f: PoFormState; onChange: (f: PoFormState) => void; headerOnly?: boolean }) {
  const set = (k: keyof PoFormState, v: string | null) => onChange({ ...f, [k]: v ?? "" });
  const setItem = (key: string, patch: Partial<PoLine>) => onChange({ ...f, items: f.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  return (
    <>
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">PO header</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Buyer PO number" required value={f.poNumber} onChange={(e) => set("poNumber", e.target.value)} maxLength={80} />
          <Input label="PO date" type="date" required value={f.poDate} onChange={(e) => set("poDate", e.target.value)} />
          <TermsSelects currency={f.currency} incoterm={f.incoterm} onCurrency={(v) => set("currency", v)} onIncoterm={(v) => onChange({ ...f, incoterm: v })} />
          {!headerOnly && (
            <>
              <Input label="Named place" value={f.incotermPlace} onChange={(e) => set("incotermPlace", e.target.value)} maxLength={80} />
              <Input label="Destination" value={f.destination} onChange={(e) => set("destination", e.target.value)} maxLength={200} />
              <Input label="PO total (as stated)" inputMode="decimal" value={f.totalAmount} onChange={(e) => set("totalAmount", e.target.value)} description="Leave blank if the PO states none." />
            </>
          )}
        </div>
        {!headerOnly && (
          <div className="grid gap-3 lg:grid-cols-2">
            <Textarea label="Payment terms" rows={2} value={f.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} maxLength={1000} />
            <Textarea label="Delivery terms" rows={2} value={f.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} maxLength={1000} />
            <Textarea label="Notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={3000} containerClassName="lg:col-span-2" />
          </div>
        )}
      </Card>
      {!headerOnly && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle className="text-base">PO items</SectionTitle>
            <Button type="button" size="sm" variant="outline" disabled={f.items.length >= 50} onClick={() => onChange({ ...f, items: [...f.items, blankLine()] })}><Plus className="size-4" aria-hidden="true" />Add item</Button>
          </div>
          {!f.items.length && <HelperText>Enter each line as written on the buyer’s PO. Without items, the PO stays under review.</HelperText>}
          <ol className="flex flex-col gap-3">
            {f.items.map((i, idx) => (
              <li key={i.key} className="rounded-md border border-border p-3">
                <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <legend className="sr-only">PO line {idx + 1}</legend>
                  <Input label={`Line ${idx + 1} description`} required value={i.description} onChange={(e) => setItem(i.key, { description: e.target.value })} maxLength={300} containerClassName="sm:col-span-2 lg:col-span-3" />
                  <Input label="Buyer code" value={i.buyerProductCode} onChange={(e) => setItem(i.key, { buyerProductCode: e.target.value })} maxLength={80} />
                  <Input label="Quantity" required inputMode="decimal" value={i.quantity} onChange={(e) => setItem(i.key, { quantity: e.target.value })} />
                  <Input label="Unit" required value={i.unit} onChange={(e) => setItem(i.key, { unit: e.target.value.toUpperCase() })} maxLength={20} />
                  <Input label="Specification" value={i.specification} onChange={(e) => setItem(i.key, { specification: e.target.value })} maxLength={1000} containerClassName="sm:col-span-2 lg:col-span-2" />
                  <Input label={`Unit price (${f.currency})`} required inputMode="decimal" value={i.unitPrice} onChange={(e) => setItem(i.key, { unitPrice: e.target.value })} />
                  <Input label="Line total (as stated)" inputMode="decimal" value={i.totalPrice} onChange={(e) => setItem(i.key, { totalPrice: e.target.value })} />
                  <Input label="Delivery date" value={i.deliveryDate} onChange={(e) => setItem(i.key, { deliveryDate: e.target.value })} maxLength={60} containerClassName="lg:col-span-2" />
                </fieldset>
                <div className="mt-2 flex items-center justify-between gap-2">
                  {i.quotationItemId ? <Caption>Matched to a quotation item</Caption> : <span />}
                  <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...f, items: f.items.filter((x) => x.key !== i.key) })} aria-label={`Remove line ${idx + 1}`}><Trash2 className="size-4" aria-hidden="true" />Remove</Button>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}
