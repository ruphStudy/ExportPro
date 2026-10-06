"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import type { SavedBuyerItem } from "@exportpro/types";
import { countryLabel } from "@exportpro/types";
import { buyersApi } from "@/lib/api/buyers";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { BUYER_TYPE_LABELS, matchLabel } from "@/lib/buyer-labels";
import { RiskBadge, SampleBuyerBanner, SaveBuyerButton, VerificationBadge } from "@/components/buyers/buyer-bits";
import { RequirePermission } from "@/components/layout/require-permission";
import { fmtDate } from "@/components/provenance/source-bits";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { DataTable, type Column } from "@/components/ui/table";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function SavedBuyersPage() {
  return (
    <RequirePermission permission="buyers.view">
      <SavedBuyers />
    </RequirePermission>
  );
}

function detailHref(i: SavedBuyerItem) {
  const s = new URLSearchParams();
  if (i.productId) s.set("productId", i.productId);
  if (i.contextCountryCode) s.set("country", i.contextCountryCode);
  return `/buyers/${i.buyer.id}${s.toString() ? `?${s}` : ""}`;
}

function SavedBuyers() {
  const [page, setPage] = React.useState(1);
  const q = useQuery({ queryKey: ["buyers", "saved", page], queryFn: () => buyersApi.saved({ page, pageSize: 20 }), placeholderData: keepPreviousData });

  const columns: Column<SavedBuyerItem>[] = [
    {
      key: "buyer",
      header: "Buyer",
      render: (i) => (
        <div className="flex min-w-[12rem] flex-col">
          <Link href={detailHref(i)} className="font-medium text-primary hover:underline">{i.buyer.name}</Link>
          <Caption>{BUYER_TYPE_LABELS[i.buyer.buyerType]}{i.buyer.demo ? " · sample" : ""}{i.buyer.userProvided ? " · added by your team" : ""}</Caption>
        </div>
      ),
    },
    { key: "market", header: "Market", render: (i) => [i.buyer.city, countryLabel(i.buyer.countryCode)].filter(Boolean).join(", ") },
    { key: "product", header: "Matched product", render: (i) => (i.productName ? `${i.productName}${i.buyer.match.matchedHsCode ? ` · HS ${i.buyer.match.matchedHsCode}` : ""}` : <span className="text-muted-foreground">No product context</span>) },
    { key: "match", header: "Match", align: "right", render: (i) => <span aria-label={`Match ${i.buyer.match.score} of 100, ${matchLabel(i.buyer.match.score)}`}>{i.buyer.match.score} <Caption>{matchLabel(i.buyer.match.score)}</Caption></span> },
    { key: "risk", header: "Risk", render: (i) => <div className="flex flex-col gap-1"><RiskBadge risk={i.buyer.risk} /><VerificationBadge status={i.buyer.verificationStatus} /></div> },
    { key: "contacts", header: "Contacts", render: (i) => (i.contactCount ? `${i.contactCount}${i.buyer.contactAvailability === "VERIFIED" ? " (verified)" : ""}` : <span className="text-muted-foreground">None</span>) },
    { key: "saved", header: "Saved", render: (i) => <div className="flex flex-col"><span>{fmtDate(i.savedAt)}</span>{i.savedBy && <Caption>by {i.savedBy}</Caption>}</div> },
    { key: "crm", header: "CRM", render: (i) => (i.lead ? <Badge variant="success">Added to CRM</Badge> : <Caption>Not added</Caption>) },
    { key: "actions", header: "Actions", render: (i) => <SaveBuyerButton buyerId={i.buyer.id} shortlisted /> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Buyers", href: "/buyers" }, { label: "Saved buyers" }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageTitle>Saved buyers</PageTitle>
          <HelperText className="mt-1">Your organization’s shortlist. Saved state and notes are never shared with other organizations.</HelperText>
        </div>
        <Button asChild variant="outline"><Link href="/buyers">Find more buyers</Link></Button>
      </div>
      {q.data?.sampleData && <SampleBuyerBanner />}
      {q.data && <p className="text-sm text-muted-foreground" aria-live="polite">{q.data.meta.totalItems} saved buyer{q.data.meta.totalItems === 1 ? "" : "s"}</p>}
      <DataTable
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(i) => i.buyer.id}
        isLoading={q.isLoading}
        error={q.isError ? toFriendlyErrorMessage(q.error) : undefined}
        onRetry={() => q.refetch()}
        emptyState={{ icon: Bookmark, title: "No saved buyers yet", description: "Save buyers from Buyer Search to build your shortlist." }}
      />
      {q.data && q.data.meta.totalPages > 1 && <Pagination meta={q.data.meta} onPageChange={setPage} />}
    </div>
  );
}
