"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { freightApi, shipmentsApi } from "@/lib/api/logistics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";
import { day, HealthBadge, money, QUOTE_STATUS, StatusBadge, useCan } from "./shared";

/** PO detail → freight quotes, selected quote and shipment status (Sprint 18). */
export function PoLogisticsCard({ purchaseOrderId, accepted }: { purchaseOrderId: string; accepted: boolean }) {
  const can = useCan();
  const view = can("logistics.view");
  const quotes = useQuery({ queryKey: ["logistics", "quotes", { purchaseOrderId, card: true }], queryFn: () => freightApi.list({ purchaseOrderId, pageSize: 20 }), enabled: view });
  const ships = useQuery({ queryKey: ["logistics", "shipments", { purchaseOrderId, card: true }], queryFn: () => shipmentsApi.list({ purchaseOrderId, pageSize: 5 }), enabled: view });
  if (!view) return null;
  const items = quotes.data?.items ?? [];
  const selected = items.find((q) => q.status === "SELECTED");
  const priced = items.filter((q) => q.totalCost).length;
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle className="text-base">Logistics</SectionTitle>
      {quotes.isLoading ? <HelperText>Loading…</HelperText> : (
        <p>{items.length ? `${items.length} freight quote${items.length === 1 ? "" : "s"} (${priced} priced)` : "No freight quotes yet."}</p>
      )}
      {selected && (
        <p className="flex flex-wrap items-center gap-1.5">Selected: <Link className="text-primary hover:underline" href={`/freight-quotes/${selected.id}`}>{selected.forwarderName}</Link> {money(selected.totalCost, selected.currency)} <Badge variant={QUOTE_STATUS[selected.status].variant}>{QUOTE_STATUS[selected.status].label}</Badge></p>
      )}
      {(ships.data?.items ?? []).map((s) => (
        <div key={s.id} className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5"><Link className="font-medium text-primary hover:underline" href={`/shipments/${s.id}`}>{s.shipmentNumber}</Link><StatusBadge status={s.status} /><HealthBadge health={s.health} /></span>
          <Caption>ETA {day(s.eta)}{s.openExceptions ? ` · ${s.openExceptions} open exception${s.openExceptions === 1 ? "" : "s"}` : ""}</Caption>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline"><Link href={`/freight-quotes?purchaseOrderId=${purchaseOrderId}`}>Freight quotes</Link></Button>
        {accepted && !ships.data?.items.length && can("logistics.shipments.create") && (
          <Button asChild size="sm" variant="ghost"><Link href={`/shipments/new?purchaseOrderId=${purchaseOrderId}${selected ? `&freightQuoteId=${selected.id}` : ""}`}>Create shipment</Link></Button>
        )}
      </div>
    </Card>
  );
}

/** CRM lead → active shipment summary. The CRM stage is never changed from here. */
export function LeadShipmentCard({ leadId }: { leadId: string }) {
  const can = useCan();
  const view = can("logistics.view");
  const q = useQuery({ queryKey: ["logistics", "shipments", { crmLeadId: leadId, card: true }], queryFn: () => shipmentsApi.list({ crmLeadId: leadId, pageSize: 3 }), enabled: view });
  if (!view || !q.data?.items.length) return null;
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle className="text-base">Shipments</SectionTitle>
      {q.data.items.map((s) => (
        <div key={s.id} className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5"><Link className="font-medium text-primary hover:underline" href={`/shipments/${s.id}`}>{s.shipmentNumber}</Link><StatusBadge status={s.status} /><HealthBadge health={s.health} /></span>
          <Caption>ETA {day(s.eta)}{s.criticalExceptions ? ` · ${s.criticalExceptions} critical exception${s.criticalExceptions === 1 ? "" : "s"}` : s.openExceptions ? ` · ${s.openExceptions} open exception${s.openExceptions === 1 ? "" : "s"}` : ""}</Caption>
        </div>
      ))}
      <Caption>Stage suggestion only — move the lead to Shipment manually if appropriate.</Caption>
    </Card>
  );
}
