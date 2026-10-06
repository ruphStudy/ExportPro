"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, BellRing, CheckCircle2, Contact, Hourglass, ListTodo, Plus, TimerOff } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import type {
  CrmAttentionItem,
  CrmAttentionKind,
  CrmLeadQuery,
  CrmLeadSort,
  CrmLeadSummary,
  CrmPipelineColumn,
  CrmPipelineResponse,
  CrmStage,
  LeadPriority,
  LeadTask,
} from "@exportpro/types";
import {
  COUNTRIES,
  countryLabel,
  CRM_STAGE_LABELS,
  CRM_STAGES,
  LEAD_PRIORITIES,
  LEAD_PRIORITY_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  LEAD_TASK_STATUS_LABELS,
} from "@exportpro/types";
import { crmApi } from "@/lib/api/crm";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { fmtDay, fmtValue, HEALTH_LABEL, PRIORITY_VARIANT, relativeDays, TASK_STATUS_VARIANT } from "@/lib/crm-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { RiskBadge } from "@/components/buyers/buyer-bits";
import { AddLeadModal, DueText, errorToast, LeadCard, StageBadge, useInvalidateCrm } from "@/components/crm/crm-bits";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type Column } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

const VIEWS = ["pipeline", "list", "mine", "tasks", "follow-up"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = { pipeline: "Pipeline", list: "List", mine: "My leads", tasks: "Tasks", "follow-up": "Needs follow-up" };

export default function CrmPage() {
  return (
    <RequirePermission permission="crm.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <CrmWorkspace />
      </Suspense>
    </RequirePermission>
  );
}

function useUrlState() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = React.useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in patch)) next.delete("page");
      router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
    },
    [sp, router, pathname],
  );
  return { sp, set };
}

function CrmWorkspace() {
  const { sp, set } = useUrlState();
  const { data: session } = useSession();
  const [addOpen, setAddOpen] = React.useState(false);
  const view = (VIEWS as readonly string[]).includes(sp.get("view") ?? "") ? (sp.get("view") as View) : "pipeline";

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>CRM</PageTitle>
          <HelperText>Buyer leads, follow-ups and collaboration for your organization. Nothing is sent from here — communications are logged manually.</HelperText>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link href="/buyers">Find buyers</Link></Button>
          {hasPermission(session, "crm.create") && (
            <Button onClick={() => setAddOpen(true)}><Plus className="size-4" aria-hidden="true" />Add lead</Button>
          )}
        </div>
      </header>

      <Metrics />

      <Tabs value={view} onValueChange={(v) => set({ view: v === "pipeline" ? undefined : v, stage: undefined })}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList aria-label="CRM views" className="w-max">
            {VIEWS.map((v) => (
              <TabsTrigger key={v} value={v} className="whitespace-nowrap">{VIEW_LABELS[v]}</TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="pipeline"><PipelineView onAdd={() => setAddOpen(true)} /></TabsContent>
        <TabsContent value="list"><LeadListView /></TabsContent>
        <TabsContent value="mine"><LeadListView mine /></TabsContent>
        <TabsContent value="tasks"><TasksView /></TabsContent>
        <TabsContent value="follow-up"><FollowUpView /></TabsContent>
      </Tabs>
      <AddLeadModal open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

// ------------------------------------------------------------- metrics

function Metrics() {
  const q = useQuery({ queryKey: ["crm", "metrics"], queryFn: () => crmApi.pipeline({}).then((r) => r.metrics) });
  if (q.isLoading) return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!q.data) return null;
  const m = q.data;
  const items = [
    { label: "Open leads", value: m.openLeads },
    { label: "Qualified+", value: m.qualifiedPlus },
    { label: "Overdue follow-ups", value: m.overdueFollowUps, warn: m.overdueFollowUps > 0 },
    { label: "Stale leads", value: m.staleLeads, warn: m.staleLeads > 0 },
    { label: "Won / lost this month", value: `${m.wonThisMonth} / ${m.lostThisMonth}` },
    { label: "Pipeline value", value: fmtValue(m.pipelineValue, m.pipelineCurrency) ?? "—" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Pipeline summary">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg border border-border bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className={cn("text-lg font-semibold tabular-nums", i.warn && "text-warning")}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------ pipeline

function PipelineView({ onAdd }: { onAdd: () => void }) {
  const { sp, set } = useUrlState();
  const { data: session } = useSession();
  const qc = useQueryClient();
  const invalidate = useInvalidateCrm();
  const mine = sp.get("owner") === "me";
  const includeClosed = sp.get("closed") === "1";
  const [search, setSearch] = React.useState(sp.get("q") ?? "");
  const deferred = React.useDeferredValue(search);
  const query = { owner: mine ? "me" : undefined, q: deferred || undefined, includeClosed };
  const key = ["crm", "pipeline", query];
  const q = useQuery({ queryKey: key, queryFn: () => crmApi.pipeline(query), placeholderData: keepPreviousData });
  const [pickedStage, setMobileStage] = React.useState<CrmStage | null>(null);
  // Mobile shows one stage at a time; default to the first stage that has leads.
  const mobileStage = pickedStage ?? q.data?.columns.find((c) => c.count > 0)?.stage ?? "NEW";
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overStage, setOverStage] = React.useState<CrmStage | null>(null);
  const canDrag = hasPermission(session, "crm.stage_change");

  const move = useMutation({
    mutationFn: ({ lead, to }: { lead: CrmLeadSummary; to: CrmStage }) => crmApi.stage(lead.id, { stage: to, expectedVersion: lead.version }),
    // Optimistic move with rollback — the server response stays authoritative.
    onMutate: async ({ lead, to }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CrmPipelineResponse>(key);
      if (prev)
        qc.setQueryData<CrmPipelineResponse>(key, {
          ...prev,
          columns: prev.columns.map((c) =>
            c.stage === lead.stage
              ? { ...c, count: c.count - 1, leads: c.leads.filter((l) => l.id !== lead.id) }
              : c.stage === to
                ? { ...c, count: c.count + 1, leads: [{ ...lead, stage: to }, ...c.leads] }
                : c,
          ),
        });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      errorToast("Could not move lead", e);
    },
    onSuccess: (l) => toast.success(`${l.buyer.name} moved to ${CRM_STAGE_LABELS[l.stage]}`),
    onSettled: () => invalidate(),
  });

  const drop = (to: CrmStage) => {
    const lead = q.data?.columns.flatMap((c) => c.leads).find((l) => l.id === dragId);
    setDragId(null);
    setOverStage(null);
    if (!lead || lead.stage === to) return;
    if (to === "WON" || to === "LOST") {
      toast.info("Use the card's stage menu", `${CRM_STAGE_LABELS[to]} needs details — choose “${to === "WON" ? "Won…" : "Lost…"}” on the card.`);
      return;
    }
    move.mutate({ lead, to });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FilterBar search={{ value: search, onChange: (v) => { setSearch(v); set({ q: v || undefined }); }, placeholder: "Search buyer, product, contact, tag" }}>
        <Checkbox label="Only my leads" checked={mine} onChange={(e) => set({ owner: e.target.checked ? "me" : undefined })} />
        <Checkbox label="Show Won / Lost" checked={includeClosed} onChange={(e) => set({ closed: e.target.checked ? "1" : undefined })} />
      </FilterBar>
      {canDrag && <p id="dnd-help" className="sr-only">Drag cards between stage columns, or use the stage selector on each card.</p>}

      {q.isLoading ? (
        <div className="flex gap-3 overflow-hidden">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-80 w-72 shrink-0" />)}</div>
      ) : q.isError || !q.data ? (
        <ErrorState title="Pipeline unavailable" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.data.columns.every((c) => c.count === 0) && !deferred && !mine ? (
        <EmptyState
          icon={Contact}
          title="No CRM leads yet"
          description="Add buyers to CRM from Buyer Discovery, or create a lead from a saved buyer."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild><Link href="/buyers">Find buyers</Link></Button>
              {hasPermission(session, "crm.create") && <Button variant="outline" onClick={onAdd}>Add lead</Button>}
            </div>
          }
        />
      ) : (
        <>
          {/* Mobile: one stage at a time — no desktop board forced onto small screens. */}
          <div className="flex flex-col gap-3 md:hidden">
            <Select
              label="Stage"
              value={mobileStage}
              options={q.data.columns.map((c) => ({ value: c.stage, label: `${CRM_STAGE_LABELS[c.stage]} (${c.count})` }))}
              onChange={(e) => setMobileStage(e.target.value as CrmStage)}
            />
            {q.data.columns.filter((c) => c.stage === mobileStage).map((c) => <StageColumn key={c.stage} column={c} />)}
          </div>
          <div className="hidden min-w-0 md:block">
            <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Pipeline stages" aria-describedby={canDrag ? "dnd-help" : undefined}>
              {q.data.columns.map((c) => (
                <div
                  key={c.stage}
                  role="listitem"
                  className={cn("w-72 shrink-0 rounded-lg transition-colors", overStage === c.stage && "bg-primary/5 ring-2 ring-primary/40")}
                  onDragOver={canDrag ? (e) => { e.preventDefault(); setOverStage(c.stage); } : undefined}
                  onDragLeave={canDrag ? () => setOverStage((s) => (s === c.stage ? null : s)) : undefined}
                  onDrop={canDrag ? (e) => { e.preventDefault(); drop(c.stage); } : undefined}
                >
                  <StageColumn column={c} draggable={canDrag} onDragStart={setDragId} onDragEnd={() => { setDragId(null); setOverStage(null); }} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StageColumn({
  column: c,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  column: CrmPipelineColumn;
  draggable?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
}) {
  const total = c.totalExpectedValue ? fmtValue(c.totalExpectedValue, c.currency) : null;
  return (
    <section aria-labelledby={`col-${c.stage}`} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2">
      <header className="flex items-baseline justify-between gap-2 px-1">
        <h2 id={`col-${c.stage}`} className="text-sm font-semibold">
          {CRM_STAGE_LABELS[c.stage]} <span className="font-normal text-muted-foreground">({c.count})</span>
        </h2>
        {total && <Caption title={c.mixedCurrency ? "Other currencies are excluded from this total" : undefined}>{total}{c.mixedCurrency ? "*" : ""}</Caption>}
      </header>
      {c.leads.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-2 py-6 text-center text-xs text-muted-foreground">No leads in this stage.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {c.leads.map((l) => (
            <li key={l.id}>
              <LeadCard
                lead={l}
                draggable={draggable}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", l.id);
                  onDragStart?.(l.id);
                }}
                onDragEnd={onDragEnd}
              />
            </li>
          ))}
        </ul>
      )}
      {c.hasMore && (
        <Link href={`/crm?view=list&stage=${c.stage}&status=ALL`} className="px-1 text-xs text-primary hover:underline">
          View all {c.count} in list
        </Link>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- list

const SORTS: { value: CrmLeadSort; label: string }[] = [
  { value: "updatedAt", label: "Recently updated" },
  { value: "nextActionDueAt", label: "Next action due" },
  { value: "lastActivityAt", label: "Last activity" },
  { value: "createdAt", label: "Created" },
  { value: "priority", label: "Priority" },
  { value: "stage", label: "Stage" },
  { value: "expectedValue", label: "Expected value" },
  { value: "buyer", label: "Buyer name" },
];

function LeadListView({ mine }: { mine?: boolean }) {
  const { sp, set } = useUrlState();
  const [search, setSearch] = React.useState(sp.get("q") ?? "");
  const deferred = React.useDeferredValue(search);
  const members = useQuery({ queryKey: ["crm", "members"], queryFn: crmApi.members, staleTime: 60_000 });
  const tags = useQuery({ queryKey: ["crm", "tags"], queryFn: crmApi.tags, staleTime: 60_000 });
  const sortBy = (sp.get("sortBy") as CrmLeadSort) ?? (mine ? "nextActionDueAt" : "updatedAt");
  const query: CrmLeadQuery = {
    q: deferred || undefined,
    status: (sp.get("status") as CrmLeadQuery["status"]) ?? "OPEN",
    stage: (sp.get("stage") as CrmStage) || undefined,
    owner: mine ? "me" : sp.get("owner") || undefined,
    priority: (sp.get("priority") as LeadPriority) || undefined,
    tagId: sp.get("tagId") || undefined,
    source: (sp.get("source") as CrmLeadQuery["source"]) || undefined,
    risk: (sp.get("risk") as CrmLeadQuery["risk"]) || undefined,
    country: sp.get("country") || undefined,
    overdue: sp.get("overdue") === "1" || undefined,
    stale: sp.get("stale") === "1" || undefined,
    sortBy,
    sortDir: sortBy === "nextActionDueAt" || sortBy === "buyer" ? "asc" : "desc",
    page: Number(sp.get("page") ?? 1),
    pageSize: 25,
  };
  const q = useQuery({ queryKey: ["crm", "leads", query], queryFn: () => crmApi.list(query), placeholderData: keepPreviousData });
  const filterKeys = ["status", "stage", "owner", "priority", "tagId", "source", "risk", "country", "overdue", "stale"];
  const active = filterKeys.filter((k) => sp.get(k) && !(mine && k === "owner")).length;

  const columns: Column<CrmLeadSummary>[] = [
    {
      key: "buyer",
      header: "Buyer",
      render: (l) => (
        <div className="flex min-w-[11rem] flex-col">
          <Link href={`/crm/leads/${l.id}`} className="font-medium text-primary hover:underline">{l.buyer.name}</Link>
          <span className="flex flex-wrap gap-1">
            {l.signals.stale && <Badge variant="warning">Stale {l.signals.inactiveDays}d</Badge>}
            {l.tags.slice(0, 2).map((t) => <Caption key={t.id}>#{t.name}</Caption>)}
          </span>
        </div>
      ),
    },
    { key: "product", header: "Product", render: (l) => l.product?.name ?? <span className="text-muted-foreground">—</span>, hideOnMobile: true },
    { key: "country", header: "Country", render: (l) => countryLabel(l.countryCode), hideOnMobile: true },
    { key: "stage", header: "Stage", render: (l) => <StageBadge stage={l.stage} /> },
    { key: "owner", header: "Owner", render: (l) => l.owner?.name ?? <span className="text-muted-foreground">Unassigned</span>, hideOnMobile: true },
    { key: "priority", header: "Priority", render: (l) => <Badge variant={PRIORITY_VARIANT[l.priority]}>{LEAD_PRIORITY_LABELS[l.priority]}</Badge> },
    { key: "value", header: "Expected value", align: "right", render: (l) => fmtValue(l.expectedValue, l.currency) ?? "—", hideOnMobile: true },
    { key: "last", header: "Last activity", render: (l) => relativeDays(l.lastActivityAt), hideOnMobile: true },
    { key: "next", header: "Next action", render: (l) => <span className="block max-w-[14rem] truncate" title={l.nextAction ?? undefined}>{l.nextAction ?? <span className="text-muted-foreground">{l.signals.status === "OPEN" ? "None set" : "—"}</span>}</span> },
    { key: "due", header: "Due", render: (l) => (l.nextActionDueAt ? <DueText iso={l.nextActionDueAt} overdue={l.signals.nextActionOverdue} /> : "—") },
    { key: "risk", header: "Buyer risk", render: (l) => <RiskBadge risk={l.buyer.risk} />, hideOnMobile: true },
    { key: "health", header: "Follow-up", render: (l) => <Badge variant={HEALTH_LABEL[l.signals.health].variant}>{HEALTH_LABEL[l.signals.health].label}</Badge>, hideOnMobile: true },
    { key: "updated", header: "Updated", render: (l) => fmtDay(l.updatedAt), hideOnMobile: true },
  ];

  const opt = (o: { value: string; label: string }[], any: string) => [{ value: "", label: any }, ...o];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FilterBar
        search={{ value: search, onChange: (v) => { setSearch(v); set({ q: v || undefined }); }, placeholder: "Search buyer, product, contact, tag" }}
        activeFilterCount={active}
        onClearFilters={() => set(Object.fromEntries(filterKeys.map((k) => [k, undefined])))}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Select aria-label="Status" value={query.status} options={[{ value: "OPEN", label: "Open" }, { value: "WON", label: "Won" }, { value: "LOST", label: "Lost" }, { value: "ALL", label: "All" }]} onChange={(e) => set({ status: e.target.value === "OPEN" ? undefined : e.target.value })} />
          <Select aria-label="Stage" value={query.stage ?? ""} options={opt(CRM_STAGES.map((s) => ({ value: s, label: CRM_STAGE_LABELS[s] })), "Any stage")} onChange={(e) => set({ stage: e.target.value || undefined })} />
          {!mine && (
            <Select aria-label="Owner" value={query.owner ?? ""} options={opt([{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))], "Any owner")} onChange={(e) => set({ owner: e.target.value || undefined })} />
          )}
          <Select aria-label="Priority" value={query.priority ?? ""} options={opt(LEAD_PRIORITIES.map((p) => ({ value: p, label: LEAD_PRIORITY_LABELS[p] })), "Any priority")} onChange={(e) => set({ priority: e.target.value || undefined })} />
          {(tags.data?.length ?? 0) > 0 && (
            <Select aria-label="Tag" value={query.tagId ?? ""} options={opt((tags.data ?? []).map((t) => ({ value: t.id, label: t.name })), "Any tag")} onChange={(e) => set({ tagId: e.target.value || undefined })} />
          )}
          <Select aria-label="Buyer risk" value={query.risk ?? ""} options={opt([{ value: "LOW", label: "Low risk" }, { value: "MODERATE", label: "Moderate risk" }, { value: "HIGH", label: "High risk" }, { value: "VERY_HIGH", label: "Very high risk" }], "Any buyer risk")} onChange={(e) => set({ risk: e.target.value || undefined })} />
          <Select aria-label="Source" value={query.source ?? ""} options={opt(LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABELS[s] })), "Any source")} onChange={(e) => set({ source: e.target.value || undefined })} />
          <Select aria-label="Country" value={query.country ?? ""} options={opt(COUNTRIES.map((c) => ({ value: c.code, label: c.label })), "Any country")} onChange={(e) => set({ country: e.target.value || undefined })} />
          <Checkbox label="Overdue" checked={Boolean(query.overdue)} onChange={(e) => set({ overdue: e.target.checked ? "1" : undefined })} />
          <Checkbox label="Stale" checked={Boolean(query.stale)} onChange={(e) => set({ stale: e.target.checked ? "1" : undefined })} />
          <Select aria-label="Sort by" value={sortBy} options={SORTS} onChange={(e) => set({ sortBy: e.target.value })} />
        </div>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(l) => l.id}
        isLoading={q.isLoading}
        error={q.isError ? toFriendlyErrorMessage(q.error) : undefined}
        onRetry={() => q.refetch()}
        emptyState={{
          icon: Contact,
          title: mine ? "You don't own any leads here" : "No leads match",
          description: mine ? "Leads assigned to you appear here." : "Try clearing filters, or add buyers to CRM from Buyer Discovery.",
        }}
      />
      {q.data && q.data.meta.totalPages > 1 && <Pagination meta={q.data.meta} onPageChange={(p) => set({ page: String(p) })} />}
    </div>
  );
}

// --------------------------------------------------------------- tasks

function TasksView() {
  const { sp, set } = useUrlState();
  const { data: session } = useSession();
  const invalidate = useInvalidateCrm();
  const scope = sp.get("scope") === "all" ? "all" : "mine";
  const status = sp.get("taskStatus") ?? "ACTIVE";
  const overdue = sp.get("overdue") === "1";
  const page = Number(sp.get("page") ?? 1);
  const q = useQuery({
    queryKey: ["crm", "tasks", scope, status, overdue, page],
    queryFn: () => crmApi.tasks({ scope, status, overdue, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const complete = useMutation({
    mutationFn: (id: string) => crmApi.completeTask(id),
    onSuccess: () => {
      toast.success("Task completed");
      invalidate();
    },
    onError: (e) => errorToast("Could not complete task", e),
  });
  const canEdit = hasPermission(session, "crm.tasks");
  const columns: Column<LeadTask>[] = [
    { key: "title", header: "Task", render: (t) => <div className="min-w-[10rem]"><p className="font-medium">{t.title}</p>{t.description && <Caption className="line-clamp-1">{t.description}</Caption>}</div> },
    { key: "lead", header: "Lead", render: (t) => (t.lead ? <Link className="text-primary hover:underline" href={`/crm/leads/${t.lead.id}`}>{t.lead.buyerName}</Link> : "—") },
    { key: "assignee", header: "Assignee", render: (t) => t.assignee?.name ?? "Unassigned", hideOnMobile: true },
    { key: "due", header: "Due", render: (t) => <DueText iso={t.dueAt} overdue={t.overdue} /> },
    { key: "priority", header: "Priority", render: (t) => <Badge variant={PRIORITY_VARIANT[t.priority]}>{LEAD_PRIORITY_LABELS[t.priority]}</Badge>, hideOnMobile: true },
    { key: "status", header: "Status", render: (t) => <Badge variant={TASK_STATUS_VARIANT[t.status]}>{LEAD_TASK_STATUS_LABELS[t.status]}</Badge> },
    {
      key: "actions",
      header: "Actions",
      render: (t) =>
        canEdit && (t.status === "OPEN" || t.status === "IN_PROGRESS") ? (
          <Button size="sm" variant="outline" onClick={() => complete.mutate(t.id)} disabled={complete.isPending} aria-label={`Complete task ${t.title}`}>
            <CheckCircle2 className="size-4" aria-hidden="true" />Complete
          </Button>
        ) : null,
    },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <Select label="Assigned to" value={scope} options={[{ value: "mine", label: "Me" }, { value: "all", label: "Everyone" }]} onChange={(e) => set({ scope: e.target.value === "all" ? "all" : undefined })} />
        <Select label="Status" value={status} options={[{ value: "ACTIVE", label: "Open & in progress" }, { value: "DONE", label: "Done" }, { value: "CANCELLED", label: "Cancelled" }]} onChange={(e) => set({ taskStatus: e.target.value === "ACTIVE" ? undefined : e.target.value })} />
        <div className="pb-2"><Checkbox label="Overdue only" checked={overdue} onChange={(e) => set({ overdue: e.target.checked ? "1" : undefined })} /></div>
      </div>
      <DataTable
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(t) => t.id}
        isLoading={q.isLoading}
        error={q.isError ? toFriendlyErrorMessage(q.error) : undefined}
        onRetry={() => q.refetch()}
        emptyState={{ icon: ListTodo, title: "No open tasks", description: "Create follow-up tasks from a lead's detail page." }}
      />
      {q.data && q.data.meta.totalPages > 1 && <Pagination meta={q.data.meta} onPageChange={(p) => set({ page: String(p) })} />}
    </div>
  );
}

// ----------------------------------------------------------- follow-up

const KIND_META: Record<CrmAttentionKind, { label: string; icon: typeof BellRing; variant: "danger" | "warning" | "info" | "neutral" }> = {
  REMINDER_DUE: { label: "Reminders due", icon: BellRing, variant: "info" },
  OVERDUE_TASK: { label: "Overdue tasks", icon: ListTodo, variant: "danger" },
  OVERDUE_NEXT_ACTION: { label: "Overdue next actions", icon: TimerOff, variant: "danger" },
  STALE_LEAD: { label: "Stale leads", icon: Hourglass, variant: "warning" },
  NO_NEXT_ACTION: { label: "Leads without a next action", icon: Hourglass, variant: "neutral" },
  MENTION: { label: "Mentions of you (7 days)", icon: AtSign, variant: "info" },
};
const KIND_ORDER: CrmAttentionKind[] = ["REMINDER_DUE", "OVERDUE_TASK", "OVERDUE_NEXT_ACTION", "STALE_LEAD", "MENTION", "NO_NEXT_ACTION"];

function FollowUpView() {
  const { sp, set } = useUrlState();
  const { data: session } = useSession();
  const invalidate = useInvalidateCrm();
  const scope = sp.get("scope") === "all" ? "all" : "mine";
  const q = useQuery({ queryKey: ["crm", "attention", scope], queryFn: () => crmApi.attention(scope) });
  const dismiss = useMutation({
    mutationFn: (id: string) => crmApi.updateReminder(id, { status: "DISMISSED" }),
    onSuccess: () => {
      toast.success("Reminder dismissed");
      invalidate();
    },
    onError: (e) => errorToast("Could not dismiss", e),
  });
  const groups = KIND_ORDER.map((k) => ({ kind: k, items: (q.data?.items ?? []).filter((i) => i.kind === k) })).filter((g) => g.items.length);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Select label="Show" value={scope} options={[{ value: "mine", label: "My leads & tasks" }, { value: "all", label: "Whole team" }]} onChange={(e) => set({ scope: e.target.value === "all" ? "all" : undefined })} />
        <Caption>Deterministic rules: stage-based inactivity limits, due dates and reminders. Stages never change automatically.</Caption>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <ErrorState title="Follow-ups unavailable" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="All caught up" description="No overdue tasks, stale leads or due reminders." />
      ) : (
        groups.map((g) => {
          const meta = KIND_META[g.kind];
          const total = q.data!.counts[g.kind];
          return (
            <section key={g.kind} aria-labelledby={`att-${g.kind}`} className="rounded-lg border border-border bg-surface">
              <h2 id={`att-${g.kind}`} className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold">
                <meta.icon className="size-4" aria-hidden="true" />
                {meta.label}
                <Badge variant={meta.variant}>{total}</Badge>
                {total > g.items.length && <Caption>showing {g.items.length}</Caption>}
              </h2>
              <ul className="divide-y divide-border">
                {g.items.map((i) => (
                  <AttentionRow key={`${i.kind}-${i.refId ?? i.leadId}`} item={i} onDismiss={i.kind === "REMINDER_DUE" && hasPermission(session, "crm.tasks") ? () => dismiss.mutate(i.refId!) : undefined} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

function AttentionRow({ item: i, onDismiss }: { item: CrmAttentionItem; onDismiss?: () => void }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium break-words">{i.title}</p>
        <p className="text-muted-foreground break-words">{i.detail}</p>
        <Caption>
          <Link href={`/crm/leads/${i.leadId}`} className="text-primary hover:underline">{i.buyerName}</Link> · {CRM_STAGE_LABELS[i.stage]} · {i.owner?.name ?? "Unassigned"}
        </Caption>
      </div>
      <div className="flex shrink-0 gap-2">
        {onDismiss && <Button size="sm" variant="outline" onClick={onDismiss}>Dismiss</Button>}
        <Button size="sm" variant="ghost" asChild><Link href={`/crm/leads/${i.leadId}`}>Open lead</Link></Button>
      </div>
    </li>
  );
}
