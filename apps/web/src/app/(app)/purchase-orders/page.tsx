"use client";

import { ClipboardCheck, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { fmtAmount, poApi } from "@/lib/api/commercial";
import { PO_STATUS } from "@/lib/commercial-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { CommercialListView } from "@/components/commercial/commercial-list";
import { CommercialTabs } from "@/components/commercial/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function PurchaseOrdersPage() {
  return (
    <RequirePermission permission="purchase_orders.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <PurchaseOrders />
      </Suspense>
    </RequirePermission>
  );
}

function PurchaseOrders() {
  const { data: session } = useSession();
  const canCreate = hasPermission(session, "purchase_orders.create");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Quotes &amp; Orders</PageTitle>
          <HelperText className="mt-1">Buyer purchase orders are compared deterministically against the quotation and proforma invoice. People decide whether to accept.</HelperText>
        </div>
        {canCreate && <Button asChild><Link href="/purchase-orders/new"><Plus className="size-4" aria-hidden="true" />Record buyer PO</Link></Button>}
      </div>
      <CommercialTabs />
      <CommercialListView
        name="Purchase orders"
        queryKey="pos"
        fetcher={poApi.list}
        statuses={PO_STATUS}
        title={(p) => p.poNumber}
        href={(p) => `/purchase-orders/${p.id}`}
        badge={(p) => PO_STATUS[p.status]}
        meta={(p) => `${p.buyer.name} · ${p.poDate.slice(0, 10)} · ${fmtAmount(p.totalAmount, p.currency)}${p.discrepancyCounts.critical ? ` · ${p.discrepancyCounts.critical} critical` : ""}`}
        emptyIcon={ClipboardCheck}
        emptyTitle="No buyer purchase orders yet"
        emptyAction={canCreate ? <Button asChild size="sm"><Link href="/purchase-orders/new">Record buyer PO</Link></Button> : undefined}
        columns={[
          { header: "Buyer", className: "max-w-[14rem]", cell: (p) => <span className="block truncate">{p.buyer.name}</span> },
          { header: "PO date", className: "whitespace-nowrap", cell: (p) => p.poDate.slice(0, 10) },
          { header: "Against", cell: (p) => <>{p.quotation && <Link className="block text-primary hover:underline" href={`/quotations/${p.quotation.id}`}>{p.quotation.displayNumber}</Link>}{p.proformaInvoice && <Link className="block text-primary hover:underline" href={`/proforma-invoices/${p.proformaInvoice.id}`}>{p.proformaInvoice.displayNumber}</Link>}{!p.quotation && !p.proformaInvoice && <Caption>Not linked</Caption>}</> },
          { header: "Total", className: "whitespace-nowrap text-right", cell: (p) => fmtAmount(p.totalAmount, p.currency) },
          { header: "Discrepancies", cell: (p) => (p.discrepancyCounts.critical || p.discrepancyCounts.warning ? <span className="flex flex-wrap gap-1">{p.discrepancyCounts.critical > 0 && <Badge variant="danger">{p.discrepancyCounts.critical} critical</Badge>}{p.discrepancyCounts.warning > 0 && <Badge variant="warning">{p.discrepancyCounts.warning} warning</Badge>}</span> : <Caption>None open</Caption>) },
        ]}
      />
    </div>
  );
}
