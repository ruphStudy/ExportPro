"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileUp, Inbox, Paperclip, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import type { InquirySummary } from "@exportpro/types";
import { COUNTRIES, countryLabel } from "@exportpro/types";
import { inquiriesApi, type InquiryListQuery } from "@/lib/api/inquiries";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { INQUIRY_STATUS, PRIORITY, SOURCE_LABELS } from "@/lib/inquiry-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { NewInquiryModal } from "@/components/inquiries/new-inquiry-modal";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

const KEYS = ["tab", "search", "status", "priority", "assignedTo", "source", "country", "unread", "from", "to", "crmLeadId", "buyerCompanyId", "productId", "page"] as const;
const TABS: { key: string; label: string; count?: "unread" | "needsReview" | "qualified" | "needsClarification" }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread", count: "unread" },
  { key: "needs_review", label: "Needs review", count: "needsReview" },
  { key: "qualified", label: "Qualified", count: "qualified" },
  { key: "needs_clarification", label: "Needs clarification", count: "needsClarification" },
  { key: "rfq", label: "RFQs" },
  { key: "archived", label: "Archived" },
];

export default function InquiriesPage() {
  return (
    <RequirePermission permission="inquiries.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <InquiryInbox />
      </Suspense>
    </RequirePermission>
  );
}

function InquiryInbox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();
  const query = React.useMemo(() => {
    const q: Record<string, string | number> = {};
    for (const k of KEYS) {
      const val = params.get(k);
      if (val) q[k] = k === "page" ? Number(val) : val;
    }
    if (params.get("type") === "rfq") q.tab = "rfq";
    return q as InquiryListQuery;
  }, [params]);
  const [dialog, setDialog] = React.useState<null | "manual" | "upload">(params.get("new") ? "manual" : null);
  const newLeadId = params.get("new") ? (params.get("crmLeadId") ?? undefined) : undefined;
  const update = (patch: Partial<InquiryListQuery>) => {
    const next = { ...query, ...patch };
    if (!("page" in patch)) delete next.page;
    const s = new URLSearchParams();
    for (const [k, val] of Object.entries(next)) if (val !== undefined && val !== "") s.set(k, String(val));
    router.replace(`${pathname}${s.toString() ? `?${s}` : ""}`, { scroll: false });
  };
  const list = useQuery({ queryKey: ["inquiries", "list", query], queryFn: () => inquiriesApi.list({ ...query, pageSize: 20 }), placeholderData: keepPreviousData });
  const members = useQuery({ queryKey: ["inquiries", "assignees"], queryFn: inquiriesApi.assignees, staleTime: 60_000 });
  const canCreate = hasPermission(session, "inquiries.create");
  const tab = query.tab ?? "all";
  const counts = list.data?.counts;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Inquiries &amp; RFQs</PageTitle>
          <HelperText className="mt-1">Inbound buyer requests — extract, review, qualify and hand off. AI extraction is always reviewed by a person before it counts.</HelperText>
        </div>
        {canCreate && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog("upload")}><FileUp className="size-4" aria-hidden="true" />Upload RFQ</Button>
            <Button onClick={() => setDialog("manual")}><Plus className="size-4" aria-hidden="true" />Add inquiry</Button>
          </div>
        )}
      </div>

      <nav aria-label="Inquiry views" className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 px-1">
          {TABS.map((t) => (
            <li key={t.key}>
              <Button size="sm" variant={tab === t.key ? "secondary" : "ghost"} aria-current={tab === t.key ? "page" : undefined} onClick={() => update({ tab: t.key === "all" ? undefined : t.key })}>
                {t.label}{t.count && counts ? ` (${counts[t.count]})` : ""}
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Inquiry filters">
        <Input label="Search" placeholder="Buyer, subject, message, product, INQ-…" defaultValue={query.search ?? ""} key={`s-${query.search ?? ""}`} onBlur={(e) => e.target.value !== (query.search ?? "") && update({ search: e.target.value || undefined })} containerClassName="lg:col-span-2" />
        <Select label="Status" placeholder="Any" value={query.status ?? ""} onChange={(e) => update({ status: e.target.value || undefined })} options={Object.entries(INQUIRY_STATUS).map(([k, x]) => ({ value: k, label: x.label }))} />
        <Select label="Priority" placeholder="Any" value={query.priority ?? ""} onChange={(e) => update({ priority: e.target.value || undefined })} options={Object.entries(PRIORITY).map(([k, x]) => ({ value: k, label: x.label }))} />
        <Select label="Owner" placeholder="Anyone" value={query.assignedTo ?? ""} onChange={(e) => update({ assignedTo: e.target.value || undefined })} options={[{ value: "me", label: "Assigned to me" }, { value: "unassigned", label: "Unassigned" }, ...(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))]} />
        <Select label="Source" placeholder="Any" value={query.source ?? ""} onChange={(e) => update({ source: e.target.value || undefined })} options={Object.entries(SOURCE_LABELS).map(([k, l]) => ({ value: k, label: l }))} />
        <Select label="Market" placeholder="Any" value={query.country ?? ""} onChange={(e) => update({ country: e.target.value || undefined })} options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))} />
        <Select label="Read state" placeholder="Any" value={query.unread ?? ""} onChange={(e) => update({ unread: e.target.value || undefined })} options={[{ value: "true", label: "Unread" }, { value: "false", label: "Read" }]} />
        <Input label="Received from" type="date" value={query.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} />
        <Input label="Received to" type="date" value={query.to ?? ""} onChange={(e) => update({ to: e.target.value || undefined })} />
      </form>
      {(query.crmLeadId || query.buyerCompanyId || query.productId) && (
        <p className="text-sm text-muted-foreground">Filtered by {query.crmLeadId ? "CRM lead" : query.buyerCompanyId ? "buyer" : "product"}. <button type="button" className="text-primary hover:underline" onClick={() => update({ crmLeadId: undefined, buyerCompanyId: undefined, productId: undefined })}>Clear</button></p>
      )}

      <p className="sr-only" aria-live="polite">{list.data ? `${list.data.meta.totalItems} inquiries` : ""}</p>
      {list.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : list.isError ? (
        <ErrorState title="Could not load inquiries" message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !list.data?.items.length ? (
        <EmptyState
          icon={Inbox}
          title={tab === "all" && !query.search ? "No buyer inquiries yet" : "No inquiries match this view"}
          description="Inquiries arrive from outreach replies, or add one manually / upload an RFQ."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {canCreate && <Button size="sm" onClick={() => setDialog("manual")}>Add inquiry</Button>}
              <Button asChild size="sm" variant="outline"><Link href="/buyers">Go to Buyers</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/outreach">View Outreach</Link></Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Buyer inquiries</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>{["", "Buyer", "Subject", "Product", "Status", "Priority", "Owner", "Received", ""].map((h, i) => <th key={i} scope="col" className="px-3 py-2 text-left font-medium">{h || <span className="sr-only">{i === 0 ? "Unread" : "Attachments"}</span>}</th>)}</tr>
              </thead>
              <tbody>{list.data.items.map((i) => <Row key={i.id} i={i} />)}</tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Buyer inquiries">
            {list.data.items.map((i) => <MobileCard key={i.id} i={i} />)}
          </ul>
        </>
      )}
      {list.data && list.data.meta.totalPages > 1 && <Pagination meta={list.data.meta} onPageChange={(p) => update({ page: p })} />}
      {dialog && <NewInquiryModal open onOpenChange={(o) => !o && setDialog(null)} mode={dialog} crmLeadId={newLeadId} />}
    </div>
  );
}

function UnreadDot({ unread }: { unread: boolean }) {
  return unread ? <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-primary" aria-hidden="true" /><span className="sr-only">Unread</span></span> : <span className="sr-only">Read</span>;
}

function Row({ i }: { i: InquirySummary }) {
  const st = INQUIRY_STATUS[i.status];
  const pr = PRIORITY[i.priority];
  return (
    <tr className={`border-t border-border align-top ${i.unread ? "font-medium" : ""}`}>
      <td className="px-3 py-2"><UnreadDot unread={i.unread} /></td>
      <td className="max-w-[12rem] px-3 py-2">
        <span className="block truncate">{i.buyer.name}</span>
        <Caption>{SOURCE_LABELS[i.source]}{i.buyer.countryCode ? ` · ${countryLabel(i.buyer.countryCode)}` : ""}</Caption>
      </td>
      <td className="max-w-[18rem] px-3 py-2">
        <Link href={`/inquiries/${i.id}`} className="block truncate text-primary hover:underline">{i.reference} · {i.subject}</Link>
        <Caption className="block truncate font-normal">{i.snippet}</Caption>
      </td>
      <td className="max-w-[10rem] px-3 py-2 font-normal">{i.products.length ? <span className="block truncate">{i.products.join(", ")}</span> : <Caption>{i.isRfq ? "RFQ — not reviewed" : "—"}</Caption>}</td>
      <td className="px-3 py-2"><Badge variant={st.variant}>{st.label}</Badge></td>
      <td className="px-3 py-2"><Badge variant={pr.variant}>{pr.label}</Badge></td>
      <td className="px-3 py-2 font-normal">{i.owner?.name ?? <Caption>Unassigned</Caption>}</td>
      <td className="whitespace-nowrap px-3 py-2 font-normal">{new Date(i.receivedAt).toLocaleDateString()}</td>
      <td className="px-3 py-2 font-normal">{i.attachmentCount > 0 && <span className="inline-flex items-center gap-1 text-xs"><Paperclip className="size-3.5" aria-hidden="true" />{i.attachmentCount}<span className="sr-only"> attachments</span></span>}</td>
    </tr>
  );
}

function MobileCard({ i }: { i: InquirySummary }) {
  const st = INQUIRY_STATUS[i.status];
  const pr = PRIORITY[i.priority];
  return (
    <li>
      <Card className="flex flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/inquiries/${i.id}`} className={`min-w-0 text-sm text-primary hover:underline ${i.unread ? "font-semibold" : ""}`}><UnreadDot unread={i.unread} /> {i.reference} · {i.subject}</Link>
          <Caption className="shrink-0">{new Date(i.receivedAt).toLocaleDateString()}</Caption>
        </div>
        <p className="truncate text-sm">{i.buyer.name}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={st.variant}>{st.label}</Badge>
          <Badge variant={pr.variant}>{pr.label}</Badge>
          <Caption>{SOURCE_LABELS[i.source]}</Caption>
          {i.attachmentCount > 0 && <Caption><Paperclip className="inline size-3" aria-hidden="true" /> {i.attachmentCount}</Caption>}
          {i.owner && <Caption>· {i.owner.name}</Caption>}
        </div>
        {i.products.length > 0 && <Caption className="truncate">{i.products.join(", ")}</Caption>}
      </Card>
    </li>
  );
}
