"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import type { CommercialList } from "@exportpro/types";
import type { CommercialListQuery } from "@/lib/api/commercial";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption } from "@/components/ui/typography";

const KEYS = ["search", "status", "buyerCompanyId", "crmLeadId", "inquiryId", "costingId", "quotationId", "from", "to", "page"] as const;

export interface ListColumn<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

type Variant = "neutral" | "success" | "warning" | "danger" | "info";

/** URL-driven, server-paginated list with desktop table and mobile cards. */
export function CommercialListView<T extends { id: string }>({ name, queryKey, fetcher, statuses, columns, title, href, badge, meta, emptyIcon, emptyTitle, emptyAction }: {
  name: string;
  queryKey: string;
  fetcher: (q: CommercialListQuery) => Promise<CommercialList<T>>;
  statuses: Record<string, { label: string }>;
  columns: ListColumn<T>[];
  title: (row: T) => string;
  href: (row: T) => string;
  badge: (row: T) => { label: string; variant: Variant };
  meta: (row: T) => React.ReactNode;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyAction?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const query = React.useMemo(() => {
    const q: Record<string, string | number> = {};
    for (const k of KEYS) {
      const v = params.get(k);
      if (v) q[k] = k === "page" ? Number(v) : v;
    }
    return q as CommercialListQuery;
  }, [params]);
  const update = (patch: Partial<CommercialListQuery>) => {
    const next = { ...query, ...patch };
    if (!("page" in patch)) delete next.page;
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== "") s.set(k, String(v));
    router.replace(`${pathname}${s.toString() ? `?${s}` : ""}`, { scroll: false });
  };
  const list = useQuery({ queryKey: ["commercial", queryKey, "list", query], queryFn: () => fetcher({ ...query, pageSize: 20 }), placeholderData: keepPreviousData });
  const contextual = query.buyerCompanyId || query.crmLeadId || query.inquiryId || query.costingId || query.quotationId;

  return (
    <div className="flex flex-col gap-4">
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()} aria-label={`${name} filters`}>
        <Input label="Search" placeholder="Number, buyer, product…" defaultValue={query.search ?? ""} key={`s-${query.search ?? ""}`} onBlur={(e) => e.target.value !== (query.search ?? "") && update({ search: e.target.value || undefined })} onKeyDown={(e) => e.key === "Enter" && update({ search: e.currentTarget.value || undefined })} containerClassName="lg:col-span-2" />
        <Select label="Status" placeholder="Any (current)" value={query.status ?? ""} onChange={(e) => update({ status: e.target.value || undefined })} options={Object.entries(statuses).map(([k, x]) => ({ value: k, label: x.label }))} />
        <Input label="From" type="date" value={query.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} />
        <Input label="To" type="date" value={query.to ?? ""} onChange={(e) => update({ to: e.target.value || undefined })} />
      </form>
      {contextual && (
        <p className="text-sm text-muted-foreground">
          Filtered by linked record.{" "}
          <button type="button" className="text-primary hover:underline" onClick={() => update({ buyerCompanyId: undefined, crmLeadId: undefined, inquiryId: undefined, costingId: undefined, quotationId: undefined })}>Clear</button>
        </p>
      )}
      <p className="sr-only" aria-live="polite">{list.data ? `${list.data.meta.totalItems} ${name.toLowerCase()}` : ""}</p>
      {list.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : list.isError ? (
        <ErrorState title={`Could not load ${name.toLowerCase()}`} message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !list.data?.items.length ? (
        <EmptyState icon={emptyIcon} title={query.search || query.status || contextual ? `No ${name.toLowerCase()} match this view` : emptyTitle} action={emptyAction} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{name}</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Number</th>
                  {columns.map((c) => <th key={c.header} scope="col" className={`px-3 py-2 text-left font-medium ${c.className ?? ""}`}>{c.header}</th>)}
                  <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => {
                  const b = badge(r);
                  return (
                    <tr key={r.id} className="border-t border-border align-top">
                      <td className="whitespace-nowrap px-3 py-2"><Link href={href(r)} className="font-medium text-primary hover:underline">{title(r)}</Link></td>
                      {columns.map((c) => <td key={c.header} className={`px-3 py-2 ${c.className ?? ""}`}>{c.cell(r)}</td>)}
                      <td className="px-3 py-2"><Badge variant={b.variant}>{b.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden" aria-label={name}>
            {list.data.items.map((r) => {
              const b = badge(r);
              return (
                <li key={r.id}>
                  <Card className="flex flex-col gap-1 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={href(r)} className="min-w-0 break-words text-sm font-medium text-primary hover:underline">{title(r)}</Link>
                      <Badge variant={b.variant}>{b.label}</Badge>
                    </div>
                    <Caption className="break-words">{meta(r)}</Caption>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {list.data && list.data.meta.totalPages > 1 && <Pagination meta={list.data.meta} onPageChange={(p) => update({ page: p })} />}
    </div>
  );
}
