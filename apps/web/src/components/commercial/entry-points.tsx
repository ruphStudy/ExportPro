"use client";

import { useQuery } from "@tanstack/react-query";
import { FileSignature } from "lucide-react";
import Link from "next/link";
import { piApi, poApi, quotationsApi, type CommercialListQuery } from "@/lib/api/commercial";
import { PI_STATUS, PO_STATUS, Q_STATUS } from "@/lib/commercial-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

type Ctx = { inquiryId?: string | null; quotationRequestId?: string | null; costingId?: string | null; crmLeadId?: string | null; buyerCompanyId?: string | null };

function newHref(ctx: Ctx) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(ctx)) if (v) s.set(k, v);
  return `/quotations/new${s.toString() ? `?${s}` : ""}`;
}

/** Contextual "Create quotation" entry point; renders nothing without quotations.create. */
export function CreateQuotationButton({ className, variant = "outline", ...ctx }: Ctx & { className?: string; variant?: "outline" | "primary" }) {
  const { data: session } = useSession();
  if (!hasPermission(session, "quotations.create")) return null;
  return (
    <Button asChild size="sm" variant={variant} className={className}>
      <Link href={newHref(ctx)}><FileSignature className="size-4" aria-hidden="true" />Create quotation</Link>
    </Button>
  );
}

/** Quotations linked to a record (inquiry, costing, lead, buyer) plus create. */
export function LinkedQuotationsCard({ filter, create, title = "Quotations" }: { filter: Pick<CommercialListQuery, "inquiryId" | "costingId" | "crmLeadId" | "buyerCompanyId">; create?: Ctx; title?: string }) {
  const { data: session } = useSession();
  const canView = hasPermission(session, "quotations.view");
  const q = useQuery({ queryKey: ["commercial", "quotations", "list", { ...filter, linked: true }], queryFn: () => quotationsApi.list({ ...filter, pageSize: 3 }), enabled: canView });
  if (!canView) return null;
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">{title}</SectionTitle>
      {q.isLoading ? (
        <HelperText className="mt-1">Loading…</HelperText>
      ) : !q.data?.items.length ? (
        <HelperText className="mt-1">No quotation yet.</HelperText>
      ) : (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {q.data.items.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/quotations/${x.id}`} className="font-medium text-primary hover:underline">{x.displayNumber}</Link>
              <span className="flex items-center gap-2">
                <Caption>{x.totalAmount ? `${x.currency} ${x.totalAmount}` : "unpriced"}</Caption>
                <Badge variant={Q_STATUS[x.status].variant}>{Q_STATUS[x.status].label}</Badge>
              </span>
            </li>
          ))}
          {q.data.meta.totalItems > 3 && <li><Link className="text-xs text-primary hover:underline" href={`/quotations?${qs}`}>View all {q.data.meta.totalItems}</Link></li>}
        </ul>
      )}
      {create && <CreateQuotationButton {...create} className="mt-3" />}
    </Card>
  );
}

/** CRM lead → quotation / PI / PO status at a glance (stage changes stay manual). */
export function LeadCommercialCard({ leadId }: { leadId: string }) {
  const { data: session } = useSession();
  const canQ = hasPermission(session, "quotations.view");
  const canPi = hasPermission(session, "proforma_invoice.view");
  const canPo = hasPermission(session, "purchase_orders.view");
  const quotes = useQuery({ queryKey: ["commercial", "quotations", "list", { crmLeadId: leadId, linked: true }], queryFn: () => quotationsApi.list({ crmLeadId: leadId, pageSize: 1 }), enabled: canQ });
  const pis = useQuery({ queryKey: ["commercial", "pis", "list", { crmLeadId: leadId, linked: true }], queryFn: () => piApi.list({ crmLeadId: leadId, pageSize: 1 }), enabled: canPi });
  const pos = useQuery({ queryKey: ["commercial", "pos", "list", { crmLeadId: leadId, linked: true }], queryFn: () => poApi.list({ crmLeadId: leadId, pageSize: 1 }), enabled: canPo });
  if (!canQ) return null;
  const q = quotes.data?.items[0];
  const pi = pis.data?.items[0];
  const po = pos.data?.items[0];
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Quotes &amp; orders</SectionTitle>
      <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Quotation</dt>
        <dd>{q ? <span className="flex flex-wrap items-center gap-2"><Link className="text-primary hover:underline" href={`/quotations/${q.id}`}>{q.displayNumber}</Link><Badge variant={Q_STATUS[q.status].variant}>{Q_STATUS[q.status].label}</Badge></span> : "—"}</dd>
        {canPi && <><dt className="text-muted-foreground">Proforma</dt><dd>{pi ? <span className="flex flex-wrap items-center gap-2"><Link className="text-primary hover:underline" href={`/proforma-invoices/${pi.id}`}>{pi.displayNumber}</Link><Badge variant={PI_STATUS[pi.status].variant}>{PI_STATUS[pi.status].label}</Badge></span> : "—"}</dd></>}
        {canPo && <><dt className="text-muted-foreground">Buyer PO</dt><dd>{po ? <span className="flex flex-wrap items-center gap-2"><Link className="text-primary hover:underline" href={`/purchase-orders/${po.id}`}>{po.poNumber}</Link><Badge variant={PO_STATUS[po.status].variant}>{PO_STATUS[po.status].label}</Badge></span> : "—"}</dd></>}
      </dl>
      {(quotes.data?.meta.totalItems ?? 0) > 1 && <Link className="mt-2 block text-xs text-primary hover:underline" href={`/quotations?crmLeadId=${leadId}`}>All quotations for this lead</Link>}
      <CreateQuotationButton crmLeadId={leadId} className="mt-3" />
    </Card>
  );
}
