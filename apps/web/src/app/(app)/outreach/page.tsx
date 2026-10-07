"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, History, Plus, Send, ShieldOff } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import type { CampaignStatus, CampaignSummary, OutreachMessageView } from "@exportpro/types";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUSES, countryLabel, MESSAGE_STATUS_LABELS, MESSAGE_STATUSES } from "@exportpro/types";
import { outreachApi } from "@/lib/api/outreach";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { RequirePermission } from "@/components/layout/require-permission";
import { CampaignStatusBadge, DeliveryModeBanner, fmtDateTime, MessageStatusBadge } from "@/components/outreach/outreach-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type Column } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

const VIEWS = ["campaigns", "history", "suppressions"] as const;

export default function OutreachPage() {
  return (
    <RequirePermission permission="outreach.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Outreach />
      </Suspense>
    </RequirePermission>
  );
}

function useUrl() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!("page" in patch)) p.delete("page");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  return { sp, set };
}

function Outreach() {
  const { sp, set } = useUrl();
  const { data: session } = useSession();
  const settings = useQuery({ queryKey: ["outreach", "settings"], queryFn: outreachApi.settings });
  const view = (VIEWS as readonly string[]).includes(sp.get("view") ?? "") ? sp.get("view")! : "campaigns";
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Outreach</PageTitle>
          <HelperText>Email campaigns to buyers with reviewed content, follow-ups that stop on reply, and honest delivery tracking.</HelperText>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link href="/outreach/templates"><FileText className="size-4" aria-hidden="true" />Templates</Link></Button>
          {hasPermission(session, "outreach.create") && (
            <Button asChild><Link href="/outreach/campaigns/new"><Plus className="size-4" aria-hidden="true" />Create campaign</Link></Button>
          )}
        </div>
      </header>
      <DeliveryModeBanner mode={settings.data?.provider.deliveryMode} />
      <Tabs value={view} onValueChange={(v) => set({ view: v === "campaigns" ? undefined : v, status: undefined, q: undefined })}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList aria-label="Outreach views" className="w-max">
            <TabsTrigger value="campaigns" className="whitespace-nowrap">Campaigns</TabsTrigger>
            <TabsTrigger value="history" className="whitespace-nowrap">Communication history</TabsTrigger>
            <TabsTrigger value="suppressions" className="whitespace-nowrap">Suppression list</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="campaigns"><Campaigns /></TabsContent>
        <TabsContent value="history"><HistoryView /></TabsContent>
        <TabsContent value="suppressions"><Suppressions /></TabsContent>
      </Tabs>
    </div>
  );
}

const unavailable = <span className="text-muted-foreground" title="Not reported by the delivery provider">n/a</span>;

function Campaigns() {
  const { sp, set } = useUrl();
  const router = useRouter();
  const [search, setSearch] = React.useState(sp.get("q") ?? "");
  const deferred = React.useDeferredValue(search);
  const status = (sp.get("status") as CampaignStatus) || undefined;
  const page = Number(sp.get("page") ?? 1);
  const q = useQuery({ queryKey: ["outreach", "campaigns", status, deferred, page], queryFn: () => outreachApi.campaigns({ status, q: deferred || undefined, page }), placeholderData: keepPreviousData });
  const cols: Column<CampaignSummary>[] = [
    {
      key: "name",
      header: "Campaign",
      render: (c) => (
        <div className="flex min-w-[10rem] flex-col">
          <Link href={c.status === "DRAFT" ? `/outreach/campaigns/new?campaignId=${c.id}&step=1` : `/outreach/campaigns/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link>
          {c.deliveryMode === "DEVELOPMENT" && <Caption>Development delivery</Caption>}
        </div>
      ),
    },
    { key: "product", header: "Product", render: (c) => c.product?.name ?? "—", hideOnMobile: true },
    { key: "country", header: "Country", render: (c) => (c.countryCode ? countryLabel(c.countryCode) : "—"), hideOnMobile: true },
    { key: "status", header: "Status", render: (c) => <CampaignStatusBadge status={c.status} /> },
    { key: "recipients", header: "Recipients", align: "right", render: (c) => c.counts.recipients },
    { key: "sent", header: "Sent", align: "right", render: (c) => (c.deliveryMode === "DEVELOPMENT" && c.counts.sent ? <span title="Recorded by the development provider; not delivered">{c.counts.sent}*</span> : c.counts.sent) },
    { key: "delivered", header: "Delivered", align: "right", render: (c) => c.counts.delivered ?? unavailable, hideOnMobile: true },
    { key: "opened", header: "Opened", align: "right", render: (c) => c.counts.opened ?? unavailable, hideOnMobile: true },
    { key: "replied", header: "Replied", align: "right", render: (c) => c.counts.replied },
    { key: "bounced", header: "Bounced", align: "right", render: (c) => c.counts.bounced, hideOnMobile: true },
    { key: "interested", header: "Interested", align: "right", render: (c) => c.counts.interested, hideOnMobile: true },
    { key: "converted", header: "Converted", align: "right", render: (c) => c.counts.converted, hideOnMobile: true },
    { key: "schedule", header: "Schedule", render: (c) => (c.scheduledAt ? fmtDateTime(c.scheduledAt, c.timezone) : "—"), hideOnMobile: true },
    { key: "creator", header: "Created by", render: (c) => c.createdBy ?? "—", hideOnMobile: true },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FilterBar search={{ value: search, onChange: (v) => { setSearch(v); set({ q: v || undefined }); }, placeholder: "Search campaigns" }} activeFilterCount={status ? 1 : 0} onClearFilters={() => set({ status: undefined })}>
        <Select aria-label="Status" value={status ?? ""} options={[{ value: "", label: "All statuses" }, ...CAMPAIGN_STATUSES.map((s) => ({ value: s, label: CAMPAIGN_STATUS_LABELS[s] }))]} onChange={(e) => set({ status: e.target.value || undefined })} />
      </FilterBar>
      <DataTable
        columns={cols}
        rows={q.data?.items ?? []}
        rowKey={(c) => c.id}
        isLoading={q.isLoading}
        error={q.isError ? toFriendlyErrorMessage(q.error) : undefined}
        onRetry={() => q.refetch()}
        emptyState={{ icon: Send, title: "No campaigns yet", description: "Create a campaign to reach saved buyers with a reviewed message.", action: <Button onClick={() => router.push("/outreach/campaigns/new")}>Create campaign</Button> }}
      />
      <Caption>* Development delivery: recorded only, never delivered. “n/a” means the provider does not report that signal.</Caption>
      {q.data && q.data.meta.totalPages > 1 && <Pagination meta={q.data.meta} onPageChange={(p) => set({ page: String(p) })} />}
    </div>
  );
}

function HistoryView() {
  const { sp, set } = useUrl();
  const [search, setSearch] = React.useState(sp.get("q") ?? "");
  const deferred = React.useDeferredValue(search);
  const status = sp.get("status") || undefined;
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  const page = Number(sp.get("page") ?? 1);
  const q = useQuery({
    queryKey: ["outreach", "messages", deferred, status, from, to, page],
    queryFn: () => outreachApi.messages({ q: deferred || undefined, status, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined, page }),
    placeholderData: keepPreviousData,
  });
  const cols: Column<OutreachMessageView>[] = [
    { key: "buyer", header: "Buyer", render: (m) => (m.buyer ? <Link className="text-primary hover:underline" href={`/buyers/${m.buyer.id}`}>{m.buyer.name}</Link> : "—") },
    { key: "subject", header: "Subject", render: (m) => <span className="block max-w-[16rem] truncate" title={m.subject}>{m.subject}{m.stepOrder > 0 && <Caption className="ml-1">follow-up {m.stepOrder}</Caption>}</span> },
    { key: "campaign", header: "Campaign", render: (m) => (m.campaign ? <Link className="text-primary hover:underline" href={`/outreach/campaigns/${m.campaign.id}`}>{m.campaign.name}</Link> : "—"), hideOnMobile: true },
    { key: "to", header: "To", render: (m) => <span className="break-all">{m.toAddress}</span>, hideOnMobile: true },
    { key: "status", header: "Status", render: (m) => <MessageStatusBadge status={m.status} simulated={m.simulated} /> },
    { key: "when", header: "Sent / scheduled", render: (m) => fmtDateTime(m.sentAt ?? m.scheduledAt) },
    { key: "lead", header: "CRM", render: (m) => (m.crmLeadId ? <Link className="text-primary hover:underline" href={`/crm/leads/${m.crmLeadId}`}>Lead</Link> : "—"), hideOnMobile: true },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FilterBar search={{ value: search, onChange: (v) => { setSearch(v); set({ q: v || undefined }); }, placeholder: "Search buyer, campaign, subject, email" }} activeFilterCount={[status, from, to].filter(Boolean).length} onClearFilters={() => set({ status: undefined, from: undefined, to: undefined })}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select aria-label="Status" value={status ?? ""} options={[{ value: "", label: "Any status" }, ...MESSAGE_STATUSES.filter((s) => s !== "DRAFT").map((s) => ({ value: s, label: MESSAGE_STATUS_LABELS[s] }))]} onChange={(e) => set({ status: e.target.value || undefined })} />
          <Input aria-label="From date" type="date" value={from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
          <Input aria-label="To date" type="date" value={to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
        </div>
      </FilterBar>
      <DataTable
        columns={cols}
        rows={q.data?.items ?? []}
        rowKey={(m) => m.id}
        isLoading={q.isLoading}
        error={q.isError ? toFriendlyErrorMessage(q.error) : undefined}
        onRetry={() => q.refetch()}
        emptyState={{ icon: History, title: "No messages have been sent yet." }}
      />
      {q.data && q.data.meta.totalPages > 1 && <Pagination meta={q.data.meta} onPageChange={(p) => set({ page: String(p) })} />}
    </div>
  );
}

const SUP_LABEL = { UNSUBSCRIBED: "Unsubscribed", COMPLAINT: "Spam complaint", MANUAL_BLOCK: "Blocked by your team", HARD_BOUNCE: "Hard bounce" } as const;

function Suppressions() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [address, setAddress] = React.useState("");
  const q = useQuery({ queryKey: ["outreach", "suppressions"], queryFn: outreachApi.suppressions });
  const add = useMutation({
    mutationFn: () => outreachApi.addSuppression(address),
    onSuccess: () => {
      setAddress("");
      toast.success("Address blocked", "It will be excluded from all future outreach.");
      qc.invalidateQueries({ queryKey: ["outreach"] });
    },
    onError: (e) => toast.error("Could not block address", toFriendlyErrorMessage(e)),
  });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HelperText>Suppressed addresses never receive outreach from your organization. Unsubscribes, complaints and hard bounces are added automatically.</HelperText>
      {hasPermission(session, "outreach.settings") && (
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (address.trim()) add.mutate(); }}>
          <Input label="Block an email address" type="email" value={address} onChange={(e) => setAddress(e.target.value)} containerClassName="sm:w-80" />
          <Button type="submit" variant="outline" loading={add.isPending} disabled={!address.trim()}>Block</Button>
        </form>
      )}
      <DataTable
        columns={[
          { key: "a", header: "Address", render: (s) => <span className="break-all">{s.address}</span> },
          { key: "r", header: "Reason", render: (s) => <Badge variant={s.reason === "MANUAL_BLOCK" ? "neutral" : "warning"}>{SUP_LABEL[s.reason]}</Badge> },
          { key: "b", header: "Buyer", render: (s) => (s.buyer ? <Link className="text-primary hover:underline" href={`/buyers/${s.buyer.id}`}>{s.buyer.name}</Link> : "—"), hideOnMobile: true },
          { key: "d", header: "Since", render: (s) => fmtDateTime(s.createdAt) },
        ]}
        rows={q.data ?? []}
        rowKey={(s) => s.id}
        isLoading={q.isLoading}
        error={q.isError ? toFriendlyErrorMessage(q.error) : undefined}
        onRetry={() => q.refetch()}
        emptyState={{ icon: ShieldOff, title: "No suppressed addresses" }}
      />
    </div>
  );
}
