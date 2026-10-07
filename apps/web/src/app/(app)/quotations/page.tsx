"use client";

import { useQuery } from "@tanstack/react-query";
import { FileSignature, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { countryLabel } from "@exportpro/types";
import { commercialApi, fmtAmount, quotationsApi } from "@/lib/api/commercial";
import { EXPIRY_TEXT, Q_STATUS } from "@/lib/commercial-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { CommercialListView } from "@/components/commercial/commercial-list";
import { CommercialTabs } from "@/components/commercial/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function QuotationsPage() {
  return (
    <RequirePermission permission="quotations.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Quotations />
      </Suspense>
    </RequirePermission>
  );
}

function Quotations() {
  const { data: session } = useSession();
  const canCreate = hasPermission(session, "quotations.create");
  const summary = useQuery({ queryKey: ["commercial", "summary"], queryFn: commercialApi.summary, staleTime: 30_000 });
  const s = summary.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Quotes &amp; Orders</PageTitle>
          <HelperText className="mt-1">Buyer quotations, proforma invoices and purchase orders. Prices come from a preserved costing snapshot or an explicit, recorded override.</HelperText>
        </div>
        {canCreate && <Button asChild><Link href="/quotations/new"><Plus className="size-4" aria-hidden="true" />New quotation</Link></Button>}
      </div>
      <CommercialTabs />
      {s && (s.quotationsExpiringSoon > 0 || s.draftPis > 0 || s.posNeedingReview > 0) && (
        <ul className="flex flex-wrap gap-2 text-sm" aria-label="Needs attention">
          {s.quotationsExpiringSoon > 0 && <li className="rounded-md border border-warning/40 bg-warning/5 px-2 py-1">{s.quotationsExpiringSoon} quotation{s.quotationsExpiringSoon === 1 ? "" : "s"} expiring within 7 days</li>}
          {s.draftPis > 0 && <li className="rounded-md border border-border px-2 py-1"><Link className="text-primary hover:underline" href="/proforma-invoices?status=DRAFT">{s.draftPis} draft proforma invoice{s.draftPis === 1 ? "" : "s"}</Link></li>}
          {s.posNeedingReview > 0 && <li className="rounded-md border border-danger/40 bg-danger/5 px-2 py-1"><Link className="text-primary hover:underline" href="/purchase-orders">{s.posNeedingReview} PO{s.posNeedingReview === 1 ? "" : "s"} need review</Link></li>}
        </ul>
      )}
      <CommercialListView
        name="Quotations"
        queryKey="quotations"
        fetcher={quotationsApi.list}
        statuses={Q_STATUS}
        title={(q) => q.displayNumber}
        href={(q) => `/quotations/${q.id}`}
        badge={(q) => Q_STATUS[q.status]}
        meta={(q) => `${q.buyer.name} · ${q.productSummary || "No items"} · ${fmtAmount(q.totalAmount, q.currency)}${q.validUntil ? ` · valid until ${q.validUntil}` : ""}`}
        emptyIcon={FileSignature}
        emptyTitle="No quotations yet"
        emptyAction={
          <div className="flex flex-wrap justify-center gap-2">
            {canCreate && <Button asChild size="sm"><Link href="/quotations/new">Create quotation</Link></Button>}
            <Button asChild size="sm" variant="outline"><Link href="/inquiries?tab=rfq">Quote from an RFQ</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href="/costing">Quote from a costing</Link></Button>
          </div>
        }
        columns={[
          { header: "Buyer", className: "max-w-[12rem]", cell: (q) => <><span className="block truncate">{q.buyer.name}</span>{q.buyer.countryCode && <Caption>{countryLabel(q.buyer.countryCode)}</Caption>}</> },
          { header: "Products", className: "max-w-[14rem]", cell: (q) => <span className="block truncate">{q.productSummary || "—"}</span> },
          { header: "Total", className: "whitespace-nowrap text-right", cell: (q) => fmtAmount(q.totalAmount, q.currency) },
          { header: "Incoterm", cell: (q) => (q.incoterm ? `${q.incoterm}${q.incotermPlace ? ` ${q.incotermPlace}` : ""}` : "—") },
          { header: "Valid until", className: "whitespace-nowrap", cell: (q) => { const t = EXPIRY_TEXT(q.expiry.state, q.expiry.days); return <>{q.validUntil ?? "—"}{t && <Caption className={`block ${q.expiry.state === "EXPIRED" ? "text-danger" : "text-warning"}`}>{t}</Caption>}</>; } },
          { header: "Inquiry", cell: (q) => (q.inquiry ? <Link className="text-primary hover:underline" href={`/inquiries/${q.inquiry.id}`}>{q.inquiry.reference}</Link> : <Caption>—</Caption>) },
        ]}
      />
    </div>
  );
}
