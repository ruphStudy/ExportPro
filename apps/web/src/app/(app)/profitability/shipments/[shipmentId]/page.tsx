"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import type { ShipmentProfitabilityDetail } from "@exportpro/types";
import { ACTUAL_COST_CATEGORIES, ACTUAL_COST_SOURCES, REVENUE_ADJUSTMENT_TYPES } from "@exportpro/types";
import { profitabilityApi } from "@/lib/api/finance";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { ReasonDialog } from "@/components/commercial/shared";
import { FinanceTabs, money, opts, pct, PROFIT_STATUS, ProfitBadge, ReceivableBadge, todayIso, useFinanceMutation, words } from "@/components/finance/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function ShipmentProfitabilityPage() {
  return (
    <RequirePermission permission="profitability.view">
      <Detail />
    </RequirePermission>
  );
}

function Detail() {
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const q = useQuery({ queryKey: ["finance", "profit", shipmentId], queryFn: () => profitabilityApi.detail(shipmentId) });
  const [reopen, setReopen] = useState(false);
  const fin = useFinanceMutation(() => profitabilityApi.finalize(shipmentId, q.data!.rowVersion), "Profitability finalized");
  const reo = useFinanceMutation((r: string) => profitabilityApi.reopen(shipmentId, r, q.data!.rowVersion), "Reopened", () => setReopen(false));
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState title="Profitability not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  const c = d.reportingCurrency;
  const a = (k: string) => d.availableActions.includes(k);
  const final = d.status === "FINALIZED";
  const blocking = d.completeness.missing.filter((m) => !m.startsWith("Note:"));
  const notes = d.completeness.missing.filter((m) => m.startsWith("Note:"));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Profitability", href: "/profitability" }, { label: d.shipmentNumber }]} />
      <FinanceTabs />
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <PageTitle className="break-words">{d.shipmentNumber} profitability</PageTitle>
            <Caption className="block break-words">{d.buyer.name} · destination {d.destinationCountry ?? "—"} · <Link className="text-primary hover:underline" href={`/shipments/${d.shipmentId}`}>Shipment</Link> · <Link className="text-primary hover:underline" href={`/purchase-orders/${d.purchaseOrder.id}`}>PO {d.purchaseOrder.poNumber}</Link>{d.receivable ? <> · <Link className="text-primary hover:underline" href={`/finance/receivables/${d.receivable.id}`}>{d.receivable.receivableNumber}</Link></> : null}</Caption>
          </div>
          <div className="flex flex-wrap gap-2">
            {a("finalize") && <Button size="sm" disabled={fin.isPending} onClick={() => fin.mutate(undefined)}>Finalize profitability</Button>}
            {a("reopen") && <Button size="sm" variant="outline" onClick={() => setReopen(true)}>Reopen…</Button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5"><ProfitBadge status={d.status} /><Caption>{PROFIT_STATUS[d.status].hint}</Caption>{d.receivable && <ReceivableBadge status={d.receivable.status} />}</div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Profit summary">
          {([["Revenue", money(d.revenue, c)], ["Actual cost", money(d.totals.actualCost, c)], ["Operational profit", money(d.totals.operationalProfit, c)], ["Forex gain/loss", money(d.totals.fxGainLoss, c)], [final ? "Final profit" : "Profit so far (not final)", money(d.totals.finalProfit, c)], ["Margin", pct(d.totals.marginPercent)]] as const).map(([k, v]) => <li key={k}><Caption>{k}</Caption><p className="font-semibold">{v}</p></li>)}
        </ul>
        {blocking.length > 0 && (
          <div role="note" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
            <p className="font-medium">Missing before this can be finalized:</p>
            <ul className="mt-1 list-disc pl-5">{blocking.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
        {notes.map((n) => <Caption key={n} className="block">{n.replace(/^Note: /, "")}</Caption>)}
      </Card>
      <Variance d={d} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Revenue d={d} />
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Estimate (Sprint 14 costing)</SectionTitle>
          {d.estimate.available ? (
            <>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <div><dt className="text-xs text-muted-foreground">Estimated revenue</dt><dd>{money(d.estimate.revenue, c)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Estimated cost</dt><dd>{money(d.estimate.totalCost, c)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Estimated profit</dt><dd>{money(d.estimate.profit, c)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Estimated margin</dt><dd>{pct(d.estimate.marginPercent)}</dd></div>
              </dl>
              <Caption className="mt-2 block">{d.estimate.source}: {d.estimate.costings.map((x) => `${x.reference} (${x.scenarioName}, ${words(x.snapshotKind)} snapshot)`).join(", ")}{d.estimate.scale && d.estimate.scale !== "1" ? ` · scaled to this shipment's share ${Number(d.estimate.scale).toFixed(4)}` : ""}</Caption>
            </>
          ) : <HelperText className="mt-1">No estimate available.</HelperText>}
          {d.estimate.notes.map((n) => <Caption key={n} className="block">{n}</Caption>)}
        </Card>
      </div>
      <Costs d={d} />
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">FX impact</SectionTitle>
        <HelperText className="mt-1">Booking rate vs the actual settlement rate on each payment. Shown separately from operating costs; no forecasts.</HelperText>
        <ul className="mt-2 flex flex-col gap-1">
          {d.fxImpact.payments.map((p) => <li key={p.paymentId}>Payment {money(p.applied)} · booking {p.bookingRate ?? "—"} · settled {p.settlementRate ?? "—"} → {p.gainLoss ? money(p.gainLoss, c) : "not calculated"}</li>)}
          {!d.fxImpact.payments.length && <li className="text-muted-foreground">No payments recorded.</li>}
        </ul>
        <p className="mt-1">Manual FX lines: {money(d.fxImpact.manual, c)} · Total: <span className="font-medium">{money(d.fxImpact.total, c)}</span></p>
        {d.fxImpact.notes.map((n) => <Caption key={n} className="block">{n}</Caption>)}
      </Card>
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Finalized snapshots</SectionTitle>
        {!d.snapshots.length ? <HelperText className="mt-1">Not finalized yet.</HelperText> : (
          <ul className="mt-2 flex flex-col gap-1">{d.snapshots.map((s) => <li key={s.id}>v{s.version} · finalized {new Date(s.finalizedAt).toLocaleString()}{s.finalizedBy ? ` by ${s.finalizedBy}` : ""}{s.reopenedAt ? ` · reopened ${new Date(s.reopenedAt).toLocaleString()}: ${s.reopenReason}` : " · current"}</li>)}</ul>
        )}
        <Caption className="mt-1 block">Calculated {new Date(d.calculatedAt).toLocaleString()}</Caption>
      </Card>
      <ReasonDialog open={reopen} onOpenChange={setReopen} title="Reopen profitability" description="The finalized snapshot is kept in history. Costs and revenue can be edited again." confirmLabel="Reopen" loading={reo.isPending} onConfirm={(r) => reo.mutate(r)} />
    </div>
  );
}

function Variance({ d }: { d: ShipmentProfitabilityDetail }) {
  return (
    <Card className="overflow-x-auto p-4">
      <SectionTitle className="text-base">Estimated vs actual</SectionTitle>
      <Caption className="block">Variance = actual − estimated. For costs a positive variance is an overrun; for revenue and profit a positive variance is better.</Caption>
      <table className="mt-2 w-full min-w-[560px] text-sm">
        <thead><tr className="text-left text-muted-foreground"><th className="py-1">Line</th><th>Estimated</th><th>Actual</th><th>Variance</th><th>%</th><th /></tr></thead>
        <tbody>
          {d.variance.map((v) => (
            <tr key={v.group} className={`border-t border-border ${v.group === "PROFIT" || v.group === "REVENUE" ? "font-medium" : ""}`}>
              <td className="py-1 pr-2">{v.label}</td><td>{money(v.estimated)}</td><td>{money(v.actual)}</td><td>{money(v.variance)}</td><td>{v.variancePercent ? `${v.variancePercent}%` : "—"}</td>
              <td>{v.direction !== "N/A" && <Badge variant={v.direction === "OVERRUN" ? "danger" : v.direction === "SAVING" ? "success" : "neutral"}>{v.group === "PROFIT" || v.group === "REVENUE" ? (v.direction === "SAVING" ? "Better" : v.direction === "OVERRUN" ? "Worse" : "On estimate") : words(v.direction)}</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Revenue({ d }: { d: ShipmentProfitabilityDetail }) {
  const r = d.revenueDetail;
  const [f, setF] = useState({ type: "DISCOUNT", amount: "", reason: "" });
  const add = useFinanceMutation(() => profitabilityApi.adjust(d.shipmentId, { ...f, currency: r.currency }), "Adjustment recorded", () => setF({ type: "DISCOUNT", amount: "", reason: "" }));
  return (
    <Card className="p-4 text-sm">
      <SectionTitle className="text-base">Revenue</SectionTitle>
      <p className="mt-1">Source: {words(r.source)} · gross {money(r.gross, r.currency)} → net {money(r.net, r.currency)} → {money(r.reporting, d.reportingCurrency)}</p>
      {r.fx && <Caption className="block">FX 1 {r.fx.from} = {r.fx.rate} {r.fx.to} ({r.fx.sourceLabel ?? "—"}, {r.fx.sourceDate ?? "—"})</Caption>}
      {r.adjustments.length > 0 && <ul className="mt-2 flex flex-col gap-1">{r.adjustments.map((x) => <li key={x.id}>{words(x.type)} {money(x.amount, x.currency)} — {x.reason}</li>)}</ul>}
      {d.availableActions.includes("adjust_revenue") && r.currency && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select aria-label="Adjustment type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={REVENUE_ADJUSTMENT_TYPES.map((t) => ({ value: t, label: t === "DEBIT_CLAIM_ADJUSTMENT" ? "Debit adjustment (adds)" : `${words(t)} (reduces)` }))} />
          <Input aria-label={`Amount (${r.currency})`} placeholder={`Amount (${r.currency})`} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <Input aria-label="Reason" placeholder="Reason (required)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          <div className="sm:col-span-3"><Button size="sm" variant="outline" disabled={!f.amount || f.reason.trim().length < 3 || add.isPending} onClick={() => add.mutate(undefined)}>Add revenue adjustment</Button></div>
        </div>
      )}
    </Card>
  );
}

function Costs({ d }: { d: ShipmentProfitabilityDetail }) {
  const [f, setF] = useState({ category: "PROCUREMENT", description: "", amount: "", currency: d.reportingCurrency, fxRate: "", source: "MANUAL", sourceReference: "", vendorName: "", incurredAt: todayIso() });
  const [voidId, setVoidId] = useState<string | null>(null);
  const can = d.availableActions.includes("add_cost");
  const add = useFinanceMutation(() => profitabilityApi.addCost(d.shipmentId, { category: f.category, description: f.description, amount: f.amount, currency: f.currency, fx: f.fxRate ? { rate: f.fxRate, sourceLabel: "Entered with cost" } : undefined, source: f.source, sourceReference: f.sourceReference || undefined, vendorName: f.vendorName || undefined, incurredAt: f.incurredAt || undefined }), "Cost added", () => setF({ ...f, description: "", amount: "", fxRate: "", sourceReference: "", vendorName: "" }));
  const voidM = useFinanceMutation((reason: string) => profitabilityApi.updateCost(voidId!, { voidReason: reason }), "Cost voided", () => setVoidId(null));
  const none = useFinanceMutation((x: { category: string; none: boolean }) => profitabilityApi.confirmNone(d.shipmentId, { ...x, expectedRowVersion: d.rowVersion }), "Saved");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card className="p-4 text-sm">
      <SectionTitle className="text-base">Actual costs</SectionTitle>
      <HelperText className="mt-1">Freight and local charges come from the shipment’s logistics costs (Sprint 18); bank charges come from recorded payments. Edit them at their source.</HelperText>
      <ul className="mt-2 flex flex-col gap-2">
        {d.costs.map((x, i) => (
          <li key={x.id ?? `d-${i}`} className="flex flex-col gap-1 rounded-md border border-border p-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <span className="font-medium">{words(x.category)}</span> <Caption>{x.description}</Caption>
              <Caption className="block">{money(x.amount, x.currency)}{x.fx ? ` × ${x.fx.rate} (${x.fx.sourceLabel ?? "—"}, ${x.fx.sourceDate ?? "—"})` : ""} = {money(x.reportingAmount, d.reportingCurrency)} · {words(x.source)}{x.vendorName ? ` · ${x.vendorName}` : ""}{x.sourceReference && !x.derived ? ` · ref ${x.sourceReference}` : ""}</Caption>
            </div>
            <span className="flex flex-wrap items-center gap-1">
              {x.derived ? (x.source === "LOGISTICS_ACTUAL" ? <Link className="text-primary hover:underline" href={`/shipments/${d.shipmentId}?tab=costs`}>Edit on shipment</Link> : <Badge>From payment</Badge>) : null}
              {x.attachment && x.id && <a className="text-primary hover:underline" href={profitabilityApi.attachmentHref(x.id)}>{x.attachment.filename}</a>}
              {can && x.id && !x.derived && <AttachCost costId={x.id} />}
              {can && x.id && !x.derived && <Button size="sm" variant="ghost" onClick={() => setVoidId(x.id)}>Void</Button>}
            </span>
          </li>
        ))}
        {!d.costs.length && <li className="text-muted-foreground">No actual costs yet.</li>}
      </ul>
      {can && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="Category" value={f.category} onChange={set("category")} options={opts(ACTUAL_COST_CATEGORIES.filter((c) => c !== "FREIGHT"))} />
            <Input label="Description" required value={f.description} onChange={set("description")} />
            <Input label="Amount" required inputMode="decimal" value={f.amount} onChange={set("amount")} description={f.category === "FX_GAIN_LOSS" ? "Positive = loss, negative = gain." : undefined} />
            <Input label="Currency" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
            {f.currency !== d.reportingCurrency && <Input label={`FX: 1 ${f.currency} = ? ${d.reportingCurrency}`} inputMode="decimal" value={f.fxRate} onChange={set("fxRate")} description="Leave empty to use the latest saved FX snapshot." />}
            <Select label="Source" value={f.source} onChange={set("source")} options={opts(ACTUAL_COST_SOURCES.filter((s) => !["LOGISTICS_ACTUAL", "PAYMENT", "BANK_CHARGE"].includes(s)))} />
            <Input label="Vendor" value={f.vendorName} onChange={set("vendorName")} />
            <Input label="Invoice / reference" value={f.sourceReference} onChange={set("sourceReference")} />
            <Input type="date" label="Incurred on" value={f.incurredAt} onChange={set("incurredAt")} />
            <div className="sm:col-span-3"><Button disabled={add.isPending || !f.amount || f.description.trim().length < 2} onClick={() => add.mutate(undefined)}>Add actual cost</Button></div>
          </div>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Confirm categories with no cost</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {ACTUAL_COST_CATEGORIES.filter((x) => x !== "FX_GAIN_LOSS").map((cat) => {
                const on = d.confirmedNone.includes(cat);
                return <Button key={cat} size="sm" variant={on ? "secondary" : "ghost"} aria-pressed={on} onClick={() => none.mutate({ category: cat, none: !on })}>{on ? "✓ " : ""}No {words(cat).toLowerCase()}</Button>;
              })}
            </div>
          </fieldset>
        </>
      )}
      <ReasonDialog open={!!voidId} onOpenChange={(o) => !o && setVoidId(null)} title="Void cost line" description="The line is kept for history and excluded from totals." confirmLabel="Void" destructive loading={voidM.isPending} onConfirm={(r) => voidM.mutate(r)} />
      <Caption className="mt-2 block">Each manual cost keeps its original amount and the FX rate stored when it was entered.</Caption>
    </Card>
  );
}

function AttachCost({ costId }: { costId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pct2, setPct] = useState(0);
  const up = useFinanceMutation((f: File) => profitabilityApi.attachCost(costId, f, setPct), "Attachment saved");
  return (
    <>
      <input ref={ref} type="file" className="sr-only" aria-label="Attach invoice or receipt" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} />
      <Button size="sm" variant="outline" disabled={up.isPending} onClick={() => ref.current?.click()}>{up.isPending ? `${pct2}%` : "Attach"}</Button>
    </>
  );
}
