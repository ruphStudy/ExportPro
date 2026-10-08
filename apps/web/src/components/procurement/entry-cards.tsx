"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { procurementApi } from "@/lib/api/procurement";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";
import { FindSuppliersButton, PoBadge, ProcBadge, QualityBadge, RfqBadge, useCan, useProcMutation } from "./shared";

/** Buyer PO → procurement requirement, supplier RFQs and supplier POs. Never shows supplier prices on the buyer side. */
export function PoProcurementCard({ purchaseOrderId }: { purchaseOrderId: string }) {
  const can = useCan();
  const view = can("procurement.view");
  const q = useQuery({ queryKey: ["procurement", "requirement", purchaseOrderId], queryFn: () => procurementApi.requirement(purchaseOrderId), enabled: view });
  if (!view || !q.data) return null;
  const r = q.data;
  const first = r.items[0];
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle className="text-base">Procurement</SectionTitle>
      {r.items.map((i) => <p key={`${i.productName}-${i.quantity}`}>Need {i.quantity} {i.unit} {i.productName}</p>)}
      <ul className="flex flex-col gap-1">
        {r.existingRfqs.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2"><Link className="text-primary hover:underline" href={`/procurement/rfqs/${x.id}`}>{x.rfqNumber}</Link><RfqBadge status={x.status} /></li>)}
        {r.existingSupplierPos.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2"><Link className="text-primary hover:underline" href={`/procurement/orders/${x.id}`}>{x.spoNumber}</Link><PoBadge status={x.status} /></li>)}
        {!r.existingRfqs.length && !r.existingSupplierPos.length && <li className="text-muted-foreground">No supplier RFQ or supplier PO yet.</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <FindSuppliersButton product={first?.productName} productId={first?.productId} buyerPurchaseOrderId={purchaseOrderId} />
        {can("supplier_rfq.manage") && <Button asChild size="sm" variant="outline"><Link href={`/procurement/rfqs?new=1&buyerPurchaseOrderId=${purchaseOrderId}`}>Create supplier RFQ</Link></Button>}
      </div>
    </Card>
  );
}

/** Shipment → supplier POs, goods received, quality approved and the procurement cost source. */
export function ShipmentProcurementCard({ shipmentId }: { shipmentId: string }) {
  const can = useCan();
  const view = can("procurement.view");
  const q = useQuery({ queryKey: ["procurement", "shipment", shipmentId], queryFn: () => procurementApi.shipment(shipmentId), enabled: view });
  const resolve = useProcMutation((source: "LINKED" | "MANUAL") => procurementApi.setCostSource(shipmentId, source), "Procurement cost source saved");
  if (!view || !q.data) return null;
  const s = q.data;
  if (!s.supplierPos.length && s.costSource === "NONE") return null;
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle className="text-base">Procurement</SectionTitle>
      <ul className="flex flex-col gap-1">
        {s.supplierPos.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-1.5">
            <Link className="text-primary hover:underline" href={`/procurement/orders/${p.id}`}>{p.spoNumber}</Link><span>{p.supplier}</span><ProcBadge status={p.procurementStatus} /><QualityBadge status={p.qualityState} /><Caption>{p.receivedPercent}% received</Caption>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={s.goodsReceived ? "success" : "neutral"}>{s.goodsReceived ? "Goods received" : "Goods not fully received"}</Badge>
        <Badge variant={s.qualityApproved ? "success" : "warning"}>{s.qualityApproved ? "Quality approved" : "Quality not approved"}</Badge>
        <Badge variant={s.costComplete ? "success" : "warning"}>{s.costComplete ? "Procurement cost complete" : "Procurement cost incomplete"}</Badge>
      </div>
      {s.costSource === "CONFLICT" ? (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-2">
          <p>Both a manual procurement cost and linked supplier POs exist. Choose one so procurement is counted once (manual entries are kept, never deleted).</p>
          {can("procurement.manage") && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => resolve.mutate("LINKED")}>Use supplier PO cost</Button>
              <Button size="sm" variant="outline" onClick={() => resolve.mutate("MANUAL")}>Keep manual cost</Button>
            </div>
          )}
        </div>
      ) : (
        <HelperText>Cost source in profitability: {s.costSource === "LINKED" ? "linked supplier POs" : s.costSource === "MANUAL" ? "manual entry" : "none"}.</HelperText>
      )}
      {s.missing.length > 0 && <Caption>{s.missing.join(" · ")}</Caption>}
    </Card>
  );
}
