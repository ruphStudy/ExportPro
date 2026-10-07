"use client";

import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import { fmtAmount, piApi } from "@/lib/api/commercial";
import { PI_STATUS } from "@/lib/commercial-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { CommercialListView } from "@/components/commercial/commercial-list";
import { CommercialTabs, CURRENCY_OPTIONS, useBuyerOptions, useCommercialMutation } from "@/components/commercial/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function ProformaInvoicesPage() {
  return (
    <RequirePermission permission="proforma_invoice.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <ProformaInvoices />
      </Suspense>
    </RequirePermission>
  );
}

function ProformaInvoices() {
  const { data: session } = useSession();
  const [manual, setManual] = React.useState(false);
  const canCreate = hasPermission(session, "proforma_invoice.create");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Quotes &amp; Orders</PageTitle>
          <HelperText className="mt-1">Proforma invoices are normally created from an accepted quotation. A proforma invoice is not a tax or commercial invoice.</HelperText>
        </div>
        {canCreate && <Button variant="outline" onClick={() => setManual(true)}><Plus className="size-4" aria-hidden="true" />Manual proforma invoice</Button>}
      </div>
      <CommercialTabs />
      <CommercialListView
        name="Proforma invoices"
        queryKey="pis"
        fetcher={piApi.list}
        statuses={PI_STATUS}
        title={(p) => p.displayNumber}
        href={(p) => `/proforma-invoices/${p.id}`}
        badge={(p) => PI_STATUS[p.status]}
        meta={(p) => `${p.buyer.name} · ${fmtAmount(p.totalAmount, p.currency)}${p.quotation ? ` · from ${p.quotation.displayNumber}` : " · manual"}`}
        emptyIcon={FileText}
        emptyTitle="No proforma invoices yet"
        emptyAction={<Button asChild size="sm" variant="outline"><Link href="/quotations?status=ACCEPTED">View accepted quotations</Link></Button>}
        columns={[
          { header: "Buyer", className: "max-w-[14rem]", cell: (p) => <span className="block truncate">{p.buyer.name}</span> },
          { header: "Quotation", cell: (p) => (p.quotation ? <Link className="text-primary hover:underline" href={`/quotations/${p.quotation.id}`}>{p.quotation.displayNumber}</Link> : <Badge variant="warning">Manual</Badge>) },
          { header: "Total", className: "whitespace-nowrap text-right", cell: (p) => fmtAmount(p.totalAmount, p.currency) },
          { header: "Incoterm", cell: (p) => (p.incoterm ? `${p.incoterm}${p.incotermPlace ? ` ${p.incotermPlace}` : ""}` : "—") },
          { header: "Issued", className: "whitespace-nowrap", cell: (p) => p.issueDate ?? <Caption>Draft</Caption> },
        ]}
      />
      {manual && <ManualPiDialog onClose={() => setManual(false)} />}
    </div>
  );
}

function ManualPiDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const buyers = useBuyerOptions();
  const [f, setF] = React.useState({ buyerCompanyId: "", buyerName: "", currency: "USD" });
  const create = useCommercialMutation(
    () => piApi.create({ buyerCompanyId: f.buyerCompanyId || undefined, buyerName: f.buyerCompanyId ? undefined : f.buyerName.trim() || undefined, currency: f.currency }),
    "Manual proforma invoice created",
    (pi) => router.push(`/proforma-invoices/${pi.id}`),
  );
  return (
    <ConfirmDialog open onOpenChange={(o) => !o && onClose()} title="Manual proforma invoice" description="Not linked to a quotation — it is labelled MANUAL and prices are entered by hand." confirmLabel="Create draft" loading={create.isPending} confirmDisabled={!f.buyerCompanyId && f.buyerName.trim().length < 2} onConfirm={() => create.mutate(undefined)}>
      <div className="flex flex-col gap-3">
        <Select label="Buyer" placeholder="Select a saved buyer" value={f.buyerCompanyId} onChange={(e) => setF((p) => ({ ...p, buyerCompanyId: e.target.value }))} options={buyers} />
        {!f.buyerCompanyId && <Input label="Or buyer name" value={f.buyerName} onChange={(e) => setF((p) => ({ ...p, buyerName: e.target.value }))} maxLength={160} />}
        <Select label="Currency" value={f.currency} onChange={(e) => setF((p) => ({ ...p, currency: e.target.value }))} options={CURRENCY_OPTIONS} />
      </div>
    </ConfirmDialog>
  );
}
