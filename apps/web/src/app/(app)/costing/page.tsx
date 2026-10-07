"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Calculator, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import type { ExportCostingSummary } from "@exportpro/types";
import { COUNTRIES, countryLabel, INCOTERM_ORDER } from "@exportpro/types";
import { type CostingListQuery, costingApi, fmtMoney, fmtPct } from "@/lib/api/costing";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { FEASIBILITY_LABELS, STATUS_LABELS } from "@/lib/costing-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type Column } from "@/components/ui/table";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

const KEYS = ["search", "status", "incoterm", "country", "productId", "buyerCompanyId", "crmLeadId", "from", "to", "page"] as const;

export default function CostingListPage() {
  return (
    <RequirePermission permission="costing.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <CostingList />
      </Suspense>
    </RequirePermission>
  );
}

function CostingList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();
  const query = React.useMemo(() => {
    const q: Record<string, string | number> = {};
    for (const k of KEYS) {
      const v = params.get(k);
      if (v) q[k] = k === "page" ? Number(v) : v;
    }
    return q as CostingListQuery;
  }, [params]);
  const update = (patch: Partial<CostingListQuery>) => {
    const next = { ...query, ...patch };
    if (!("page" in patch)) delete next.page;
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== "") s.set(k, String(v));
    router.replace(`${pathname}${s.toString() ? `?${s}` : ""}`, { scroll: false });
  };
  const list = useQuery({ queryKey: ["costings", "list", query], queryFn: () => costingApi.list({ ...query, pageSize: 20 }), placeholderData: keepPreviousData });
  const canCreate = hasPermission(session, "costing.create");

  const columns: Column<ExportCostingSummary>[] = [
    {
      key: "ref",
      header: "Costing",
      render: (c) => (
        <div className="flex min-w-[12rem] flex-col">
          <Link href={`/costing/${c.id}`} className="font-medium text-primary hover:underline">{c.reference}</Link>
          <Caption className="truncate">{c.name}{c.version > 1 ? ` · v${c.version}` : ""}</Caption>
        </div>
      ),
    },
    { key: "buyer", header: "Buyer", render: (c) => c.buyerName ?? <span className="text-muted-foreground">—</span> },
    { key: "product", header: "Product", render: (c) => c.productName ?? <span className="text-muted-foreground">Not linked</span> },
    { key: "market", header: "Market", render: (c) => (c.destinationCountryCode ? countryLabel(c.destinationCountryCode) : "—") },
    { key: "qty", header: "Quantity", align: "right", render: (c) => (c.base ? `${c.base.quantity} ${c.base.quantityUnit}` : "—") },
    { key: "inco", header: "Incoterm®", render: (c) => (c.base ? `${c.base.incoterm}${c.base.incotermPlace ? ` ${c.base.incotermPlace}` : ""}` : "—") },
    { key: "cost", header: "Total cost", align: "right", render: (c) => (c.base?.totalCost ? fmtMoney(c.base.totalCost, c.calculationCurrency) : <Caption>Incomplete</Caption>) },
    { key: "price", header: "Price / unit", align: "right", render: (c) => (c.base?.sellingPricePerUnit ? fmtMoney(c.base.sellingPricePerUnit, c.calculationCurrency) : "—") },
    {
      key: "margin",
      header: "Margin",
      align: "right",
      render: (c) => (
        <div className="flex flex-col items-end">
          <span>{fmtPct(c.base?.marginPercent)}</span>
          {c.base?.feasibility && <Badge variant={FEASIBILITY_LABELS[c.base.feasibility].variant}>{FEASIBILITY_LABELS[c.base.feasibility].label}</Badge>}
        </div>
      ),
    },
    { key: "status", header: "Status", render: (c) => <Badge variant={STATUS_LABELS[c.status].variant}>{STATUS_LABELS[c.status].label}</Badge> },
    { key: "updated", header: "Updated", render: (c) => <span className="whitespace-nowrap">{new Date(c.updatedAt).toLocaleDateString()}</span> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Export Costing</PageTitle>
          <HelperText className="mt-1">Deterministic cost sheets, Incoterms® pricing, margin and scenario comparison. No rates are fetched or assumed — every cost and FX rate comes from your inputs.</HelperText>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/costing/new"><Plus className="size-4" aria-hidden="true" />New costing</Link>
          </Button>
        )}
      </div>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Costing filters">
        <Input label="Search" placeholder="Reference, name, product, buyer" defaultValue={query.search ?? ""} key={`s-${query.search ?? ""}`} onBlur={(e) => e.target.value !== (query.search ?? "") && update({ search: e.target.value || undefined })} containerClassName="lg:col-span-2" />
        <Select label="Status" placeholder="Active (not archived)" value={query.status ?? ""} onChange={(e) => update({ status: e.target.value || undefined })} options={Object.entries(STATUS_LABELS).map(([v, l]) => ({ value: v, label: l.label }))} />
        <Select label="Incoterm®" placeholder="Any" value={query.incoterm ?? ""} onChange={(e) => update({ incoterm: e.target.value || undefined })} options={INCOTERM_ORDER.map((t) => ({ value: t, label: t }))} />
        <Select label="Market" placeholder="Any country" value={query.country ?? ""} onChange={(e) => update({ country: e.target.value || undefined })} options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))} />
        <Input label="Updated from" type="date" value={query.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} />
      </form>
      {(query.productId || query.buyerCompanyId || query.crmLeadId) && (
        <p className="text-sm text-muted-foreground">
          Filtered by {query.productId ? "product" : query.buyerCompanyId ? "buyer" : "CRM lead"}.{" "}
          <button type="button" className="text-primary hover:underline" onClick={() => update({ productId: undefined, buyerCompanyId: undefined, crmLeadId: undefined })}>Clear</button>
        </p>
      )}
      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(c) => c.id}
        isLoading={list.isLoading}
        error={list.isError ? toFriendlyErrorMessage(list.error) : undefined}
        onRetry={() => list.refetch()}
        emptyState={{
          icon: Calculator,
          title: "Create your first export costing",
          description: "Start from a product, market or CRM lead, enter your costs and compare Incoterms® and scenarios.",
          action: canCreate ? <Button asChild size="sm"><Link href="/costing/new">New costing</Link></Button> : undefined,
        }}
      />
      {list.data && list.data.meta.totalPages > 1 && <Pagination meta={list.data.meta} onPageChange={(p) => update({ page: p })} />}
    </div>
  );
}
