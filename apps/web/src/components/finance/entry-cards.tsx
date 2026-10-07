"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { financeApi, profitabilityApi, receivablesApi } from "@/lib/api/finance";
import { shipmentsApi } from "@/lib/api/logistics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";
import { day, money, pct, ProfitBadge, ReceivableBadge, SignalBadge, useCan } from "./shared";

/** Shipment detail → receivable status, actual-cost completeness and profitability status. */
export function ShipmentFinanceCard({ shipmentId }: { shipmentId: string }) {
  const can = useCan();
  const view = can("profitability.view");
  const q = useQuery({ queryKey: ["finance", "shipment-status", shipmentId], queryFn: () => profitabilityApi.status(shipmentId), enabled: view });
  if (!view || !q.data) return null;
  const s = q.data;
  const missing = s.completeness.missing.filter((m) => !m.startsWith("Note"));
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle className="text-base">Payment &amp; profitability</SectionTitle>
      <div className="flex flex-wrap items-center gap-1.5">
        {s.receivable ? <><ReceivableBadge status={s.receivable.status} /><Caption>{s.receivable.receivableNumber} · {money(s.receivable.outstanding, s.receivable.currency)} outstanding</Caption></> : <Caption>No receivable linked yet.</Caption>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5"><ProfitBadge status={s.status} /><Caption>{s.costLines} actual cost line{s.costLines === 1 ? "" : "s"}{missing.length ? ` · ${missing.length} input(s) missing` : " · actual costs complete"}{s.actualProfit && (s.status === "FINALIZED" || s.status === "ACTUAL_IN_PROGRESS") ? ` · profit ${money(s.actualProfit, s.reportingCurrency)} (${pct(s.marginPercent)})` : ""}</Caption></div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline"><Link href={`/profitability/shipments/${shipmentId}`}>Profitability</Link></Button>
        {s.receivable && can("finance.view") && <Button asChild size="sm" variant="ghost"><Link href={`/finance/receivables/${s.receivable.id}`}>Receivable</Link></Button>}
      </div>
    </Card>
  );
}

/** PO detail → receivable, payment status and shipment profitability. */
export function PoFinanceCard({ purchaseOrderId, accepted }: { purchaseOrderId: string; accepted: boolean }) {
  const can = useCan();
  const view = can("finance.view");
  const r = useQuery({ queryKey: ["finance", "receivables", { purchaseOrderId, card: true }], queryFn: () => receivablesApi.list({ purchaseOrderId, pageSize: 5 }), enabled: view });
  const ships = useQuery({ queryKey: ["logistics", "shipments", { purchaseOrderId, card: true }], queryFn: () => shipmentsApi.list({ purchaseOrderId, pageSize: 5 }), enabled: view && can("logistics.view") });
  if (!view) return null;
  const items = r.data?.items ?? [];
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle className="text-base">Payments &amp; profitability</SectionTitle>
      {r.isLoading ? <HelperText>Loading…</HelperText> : !items.length ? <Caption>No receivable yet.</Caption> : items.map((x) => (
        <div key={x.id} className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5"><Link className="font-medium text-primary hover:underline" href={`/finance/receivables/${x.id}`}>{x.receivableNumber}</Link><ReceivableBadge status={x.status} /></span>
          <Caption>Received {money(x.receivedAmount, x.currency)} of {money(x.totalAmount)} · next due {day(x.nextDueDate)}</Caption>
        </div>
      ))}
      {(ships.data?.items ?? []).map((s) => <ShipmentProfitLine key={s.id} id={s.id} number={s.shipmentNumber} />)}
      {accepted && !items.length && can("receivables.manage") && <Button asChild size="sm" variant="outline" className="self-start"><Link href={`/finance/receivables/new?purchaseOrderId=${purchaseOrderId}`}>Create receivable</Link></Button>}
    </Card>
  );
}

function ShipmentProfitLine({ id, number }: { id: string; number: string }) {
  const can = useCan();
  const q = useQuery({ queryKey: ["finance", "shipment-status", id], queryFn: () => profitabilityApi.status(id), enabled: can("profitability.view") });
  if (!q.data) return null;
  return <span className="flex flex-wrap items-center gap-1.5"><Link className="text-primary hover:underline" href={`/profitability/shipments/${id}`}>{number}</Link><ProfitBadge status={q.data.status} />{q.data.status === "FINALIZED" && <Caption>{money(q.data.actualProfit, q.data.reportingCurrency)} ({pct(q.data.marginPercent)})</Caption>}</span>;
}

/** Buyer / CRM lead → compact financial summary and repeat signal. Never changes CRM stage. */
export function BuyerFinanceCard({ buyerId, lead }: { buyerId: string; lead?: boolean }) {
  const can = useCan();
  const view = can("finance.view");
  const q = useQuery({ queryKey: ["finance", "buyer-summary", buyerId], queryFn: () => financeApi.buyerSummary(buyerId), enabled: view });
  if (!view || !q.data) return null;
  const s = q.data;
  if (!s.currencyTotals.length && !s.profitability && !s.repeat) return null;
  return (
    <Card className="flex flex-col gap-1.5 p-4 text-sm">
      <SectionTitle className="text-base">Finance</SectionTitle>
      {s.currencyTotals.map((c) => <p key={c.currency}>Outstanding {money(c.outstanding, c.currency)}{Number(c.overdue) > 0 ? <Badge className="ml-1" variant="danger">{money(c.overdue, c.currency)} overdue</Badge> : null}</p>)}
      {s.lastPayment && <Caption>Last payment {money(s.lastPayment.amount, s.lastPayment.currency)} on {day(s.lastPayment.receivedAt)}</Caption>}
      {s.nextDue && <Caption>Next due {money(s.nextDue.amount, s.nextDue.currency)} on {day(s.nextDue.dueDate)}</Caption>}
      {s.profitability && <Caption>Finalized: revenue {money(s.profitability.revenue, s.profitability.reportingCurrency)} · profit {money(s.profitability.profit)} ({pct(s.profitability.marginPercent)}) · {s.profitability.shipments} shipment(s)</Caption>}
      {s.repeat && <span className="flex flex-wrap items-center gap-1.5"><SignalBadge level={s.repeat.level} /><Caption>{s.repeat.orderCount} order(s){s.repeat.window ? ` · next likely reorder ${day(s.repeat.window.start)} – ${day(s.repeat.window.end)}` : ""}</Caption></span>}
      {lead && <Caption>Shown for reference — the CRM stage is never changed by payments.</Caption>}
      {can("repeat_business.view") && <Link className="text-xs text-primary hover:underline" href="/repeat-business">Repeat business</Link>}
    </Card>
  );
}

/** Commercial invoice document → linked receivable (no accounting entries). */
export function InvoiceReceivableCard({ documentId }: { documentId: string }) {
  const can = useCan();
  const q = useQuery({ queryKey: ["finance", "receivables", { commercialInvoiceId: documentId }], queryFn: () => receivablesApi.list({ commercialInvoiceId: documentId, pageSize: 3 }), enabled: can("finance.view") });
  if (!q.data?.items.length) return null;
  return (
    <Card className="flex flex-col gap-1 p-4 text-sm">
      <SectionTitle className="text-base">Receivable</SectionTitle>
      {q.data.items.map((x) => <span key={x.id} className="flex flex-wrap items-center gap-1.5"><Link className="text-primary hover:underline" href={`/finance/receivables/${x.id}`}>{x.receivableNumber}</Link><ReceivableBadge status={x.status} /><Caption>{money(x.outstandingAmount, x.currency)} outstanding</Caption></span>)}
    </Card>
  );
}
