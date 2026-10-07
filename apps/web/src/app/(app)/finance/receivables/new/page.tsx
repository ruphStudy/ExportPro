"use client";

import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { ReceivablePrefill } from "@exportpro/types";
import { INSTALLMENT_TRIGGERS, PAYMENT_TERMS_TYPES } from "@exportpro/types";
import { poApi } from "@/lib/api/commercial";
import { receivablesApi } from "@/lib/api/finance";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { FinanceTabs, money, opts, useFinanceMutation, words } from "@/components/finance/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function NewReceivablePage() {
  return (
    <RequirePermission permission="receivables.manage">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <NewReceivable />
      </Suspense>
    </RequirePermission>
  );
}

function NewReceivable() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const poId = params.get("purchaseOrderId") ?? "";
  const shipmentId = params.get("shipmentId") ?? "";
  const pos = useQuery({ queryKey: ["finance", "accepted-pos"], queryFn: () => poApi.list({ status: "ACCEPTED", pageSize: 50 }) });
  const pf = useQuery({ queryKey: ["finance", "receivable-prefill", poId, shipmentId], queryFn: () => receivablesApi.prefill(poId, shipmentId || undefined), enabled: !!poId });
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Receivables", href: "/finance/receivables" }, { label: "New receivable" }]} />
      <div>
        <PageTitle>New receivable</PageTitle>
        <HelperText className="mt-1">The schedule is read from the payment terms agreed on the PO / PI / quotation and frozen as a snapshot. Later document edits never change it.</HelperText>
      </div>
      <FinanceTabs />
      <Card className="p-4">
        <Select label="Accepted buyer PO" required value={poId} onChange={(e) => router.replace(`${pathname}?purchaseOrderId=${e.target.value}`, { scroll: false })} options={[{ value: "", label: pos.isLoading ? "Loading…" : "Choose a PO" }, ...(pos.data?.items ?? []).map((o) => ({ value: o.id, label: `${o.poNumber} — ${o.buyer.name} (${o.currency} ${o.totalAmount ?? "—"})` }))]} />
      </Card>
      {!poId ? null : pf.isLoading ? <Skeleton className="h-64 w-full" /> : pf.isError || !pf.data ? (
        <ErrorState title="Could not read the order" message={toFriendlyErrorMessage(pf.error)} onRetry={() => pf.refetch()} />
      ) : (
        <Form key={`${poId}-${shipmentId}`} p={pf.data} onDone={(id) => router.push(`/finance/receivables/${id}`)} />
      )}
    </div>
  );
}

type Row = { label: string; percentage: string; amount: string; triggerType: string; dueDays: string; fixedDate: string };

function Form({ p, onDone }: { p: ReceivablePrefill; onDone: (id: string) => void }) {
  const t = p.terms;
  const [type, setType] = useState<string>(t.type ?? "CUSTOM");
  const [custom, setCustom] = useState(!t.recognized);
  const [rows, setRows] = useState<Row[]>(t.installments.length ? t.installments.map((i) => ({ label: i.label, percentage: i.percentage ?? "", amount: i.amount, triggerType: i.triggerType, dueDays: i.dueDays?.toString() ?? "", fixedDate: i.fixedDate ?? "" })) : [{ label: "Payment", percentage: "100", amount: p.totalAmount ?? "", triggerType: "MANUAL", dueDays: "", fixedDate: "" }]);
  const [confirm, setConfirm] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(p.commercialInvoice?.invoiceDate ?? "");
  const [termDays, setTermDays] = useState(t.termDays?.toString() ?? "");
  const [tenorDays, setTenorDays] = useState(t.tenorDays?.toString() ?? "");
  const [bank, setBank] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [notes, setNotes] = useState("");
  const usesDocs = !custom && t.recognized && type === t.type;
  const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const create = useFinanceMutation(() => receivablesApi.create({
    purchaseOrderId: p.purchaseOrder.id,
    shipmentId: p.shipment?.id,
    paymentTermsType: type,
    installments: usesDocs ? undefined : rows.map((r) => ({ label: r.label.trim() || "Installment", percentage: r.percentage || null, amount: r.amount, triggerType: r.triggerType, dueDays: r.dueDays ? Number(r.dueDays) : null, fixedDate: r.fixedDate || null })),
    confirmCustomSchedule: usesDocs ? undefined : confirm,
    invoiceDate: invoiceDate || undefined,
    termDays: termDays ? Number(termDays) : undefined,
    tenorDays: tenorDays ? Number(tenorDays) : undefined,
    collectingBank: bank.trim() || undefined,
    bookingFx: fxRate ? { rate: fxRate, sourceLabel: "Entered at receivable creation" } : undefined,
    notes: notes.trim() || undefined,
  }), "Receivable created", (r) => onDone(r.id));
  if (p.existingReceivableId) return <Card className="p-4 text-sm" role="alert">This order already has an open receivable. <Link className="text-primary hover:underline" href={`/finance/receivables/${p.existingReceivableId}`}>Open it</Link>.</Card>;
  return (
    <>
      <Card className="flex flex-col gap-2 p-4 text-sm">
        <SectionTitle className="text-base">Agreed terms</SectionTitle>
        <p className="break-words">“{t.wording ?? "No payment terms on the documents"}” <Caption>({t.source ? words(t.source) : "—"})</Caption></p>
        <p>Total: <span className="font-medium">{money(p.totalAmount, p.currency)}</span> <Caption>from {p.totalSource}</Caption></p>
        <div className="flex flex-wrap gap-1.5">{t.recognized ? <Badge variant="success">Read as {words(t.type ?? "")}</Badge> : <Badge variant="warning">Not fully recognized — define and confirm a schedule</Badge>}{p.shipment && <Badge variant="info">Shipment {p.shipment.shipmentNumber}</Badge>}{p.commercialInvoice && <Badge>CI {p.commercialInvoice.number ?? "draft"}</Badge>}</div>
        {t.notes.map((n) => <Caption key={n} className="block text-warning">{n}</Caption>)}
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Payment terms type" value={type} onChange={(e) => setType(e.target.value)} options={opts(PAYMENT_TERMS_TYPES)} />
          {type === "OPEN_ACCOUNT" && <><Input type="date" label="Invoice date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /><Input label="Credit days (Net)" inputMode="numeric" value={termDays} onChange={(e) => setTermDays(e.target.value)} /></>}
          {type === "DOCUMENTS_AGAINST_ACCEPTANCE" && <Input label="Tenor days" inputMode="numeric" value={tenorDays} onChange={(e) => setTenorDays(e.target.value)} />}
          {(type === "DOCUMENTS_AGAINST_PAYMENT" || type === "DOCUMENTS_AGAINST_ACCEPTANCE") && <Input label="Collecting bank" value={bank} onChange={(e) => setBank(e.target.value)} />}
          <Input label={`Booking FX (1 ${p.currency} = ? reporting currency)`} inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} description="Optional — defaults to your latest saved FX snapshot." />
        </div>
        {t.recognized && type === t.type && <Checkbox checked={custom} onChange={(e) => setCustom(e.target.checked)} label="Edit the schedule manually instead of using the agreed terms" />}
        {usesDocs ? (
          <ul className="flex flex-col gap-1 text-sm">{t.installments.map((i) => <li key={i.label} className="flex flex-wrap justify-between gap-2 rounded-md border border-border p-2"><span>{i.label} <Caption>({words(i.triggerType)}{i.dueDays ? ` + ${i.dueDays} d` : ""})</Caption></span><span className="font-medium">{money(i.amount, p.currency)}</span></li>)}</ul>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Installments (must add up to {money(p.totalAmount, p.currency)}; now {money(sum.toFixed(2))})</legend>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_8rem_12rem_6rem_10rem_auto]">
                <Input aria-label="Label" value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Input aria-label="Percent" placeholder="%" value={r.percentage} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, percentage: e.target.value, amount: p.totalAmount && e.target.value ? ((Number(p.totalAmount) * Number(e.target.value)) / 100).toFixed(2) : x.amount } : x)))} />
                <Input aria-label="Amount" inputMode="decimal" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <Select aria-label="Trigger" value={r.triggerType} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, triggerType: e.target.value } : x)))} options={opts(INSTALLMENT_TRIGGERS)} />
                <Input aria-label="Days" placeholder="days" value={r.dueDays} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dueDays: e.target.value } : x)))} />
                <Input type="date" aria-label="Fixed date" value={r.fixedDate} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, fixedDate: e.target.value } : x)))} />
                <Button variant="ghost" size="sm" aria-label="Remove installment" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden="true" /></Button>
              </div>
            ))}
            <Button className="self-start" size="sm" variant="outline" onClick={() => setRows([...rows, { label: "Installment", percentage: "", amount: "", triggerType: "MANUAL", dueDays: "", fixedDate: "" }])}>Add installment</Button>
            <Checkbox checked={confirm} onChange={(e) => setConfirm(e.target.checked)} label="I confirm this schedule matches what was agreed with the buyer." />
          </fieldset>
        )}
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={create.isPending || (!usesDocs && !confirm) || !p.totalAmount} onClick={() => create.mutate(undefined)}>{create.isPending ? "Creating…" : "Create receivable"}</Button>
          <Button asChild variant="ghost"><Link href="/finance/receivables">Cancel</Link></Button>
        </div>
        {!p.totalAmount && <HelperText>The order has no agreed total — record it on the PO or commercial invoice first.</HelperText>}
      </Card>
    </>
  );
}
