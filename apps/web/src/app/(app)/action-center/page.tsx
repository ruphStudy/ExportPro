"use client";

import { useQuery } from "@tanstack/react-query";
import { ListChecks, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { ActionItemView } from "@exportpro/types";
import { actionCenterApi } from "@/lib/api/ai-ops";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { ActionTabs, PriorityBadge, useCan, useOpsMutation, words } from "@/components/ai-ops/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

const VIEWS = [
  { key: "", label: "All open" },
  { key: "today", label: "Today" },
  { key: "overdue", label: "Overdue" },
  { key: "upcoming", label: "Upcoming" },
  { key: "critical", label: "Critical" },
  { key: "closed", label: "Closed / snoozed" },
] as const;
const MODULES = ["CRM", "OUTREACH", "FINANCE", "LOGISTICS", "COMPLIANCE", "DOCUMENTS", "COMMERCIAL", "OPPORTUNITIES", "INQUIRIES"];

export default function ActionCenterPage() {
  return (
    <RequirePermission permission="action_center.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <ActionCenter />
      </Suspense>
    </RequirePermission>
  );
}

function ActionCenter() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const g = (k: string) => params.get(k) ?? "";
  const view = g("view");
  const f = { priority: g("priority"), module: g("module"), assignee: g("assignee"), page: Number(g("page") || 1) };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  const q = useQuery({
    queryKey: ["ops", "items", view, f],
    queryFn: () => actionCenterApi.list({ ...f, ...(view === "closed" ? { state: "SNOOZED,COMPLETED,DISMISSED,EXPIRED" } : view ? { due: view } : {}), pageSize: 20 }),
  });
  const refresh = useOpsMutation(() => actionCenterApi.evaluate(), "Action Center refreshed");
  const s = q.data?.summary;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Action Center</PageTitle>
          <HelperText className="mt-1">Needs your attention — generated from overdue payments, shipment exceptions, document expiry, CRM follow-ups, reorder windows and more. Priority is deterministic and explained on each item. Nothing is sent or approved automatically.</HelperText>
        </div>
        <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate(undefined)}><RefreshCw className="size-4" aria-hidden="true" />{refresh.isPending ? "Refreshing…" : "Refresh"}</Button>
      </div>
      <ActionTabs />
      {s && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Summary">
          {([["Open", s.open], ["Critical", s.critical], ["High", s.high], ["Due today", s.today], ["Overdue", s.overdue], ["Snoozed", s.snoozed]] as const).map(([k, v]) => <li key={k}><Card className="p-3"><Caption>{k}</Caption><p className="text-xl font-semibold">{v}</p></Card></li>)}
        </ul>
      )}
      {s?.lastEvaluatedAt && <Caption>Last evaluated {new Date(s.lastEvaluatedAt).toLocaleString()}</Caption>}
      <div role="tablist" aria-label="Daily view" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {VIEWS.map((v) => <Button key={v.key} role="tab" aria-selected={view === v.key} size="sm" variant={view === v.key ? "secondary" : "ghost"} onClick={() => set("view", v.key)}>{v.label}</Button>)}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select aria-label="Priority" value={f.priority} onChange={(e) => set("priority", e.target.value)} options={[{ value: "", label: "Any priority" }, ...["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((x) => ({ value: x, label: words(x) }))]} />
        <Select aria-label="Module" value={f.module} onChange={(e) => set("module", e.target.value)} options={[{ value: "", label: "All modules" }, ...MODULES.map((m) => ({ value: m, label: words(m) }))]} />
        <Select aria-label="Assignee" value={f.assignee} onChange={(e) => set("assignee", e.target.value)} options={[{ value: "", label: "Anyone" }, { value: "me", label: "Assigned to me" }, { value: "unassigned", label: "Unassigned" }]} />
      </div>
      {q.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : q.isError || !q.data ? (
        <ErrorState title="Could not load the Action Center" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data.items.length ? (
        <EmptyState icon={ListChecks} title="No urgent actions" description="Nothing matches this view. Items appear when a trigger (e.g. an overdue payment) is detected." />
      ) : (
        <>
          <ul className="flex flex-col gap-2">{q.data.items.map((i) => <li key={i.id}><ItemCard i={i} /></li>)}</ul>
          <Pagination meta={q.data.meta} onPageChange={(p) => set("page", String(p))} />
        </>
      )}
    </div>
  );
}

function ItemCard({ i }: { i: ActionItemView }) {
  const can = useCan();
  const manage = can("action_center.manage");
  const live = ["OPEN", "IN_PROGRESS", "SNOOZED"].includes(i.state);
  const [snooze, setSnooze] = useState("tomorrow");
  const [until, setUntil] = useState("");
  const [dismiss, setDismiss] = useState(false);
  const [why, setWhy] = useState(false);
  const v = { expectedRowVersion: i.rowVersion };
  const start = useOpsMutation(() => actionCenterApi.update(i.id, { ...v, state: "IN_PROGRESS" }), "Marked in progress");
  const done = useOpsMutation(() => actionCenterApi.complete(i.id, v), "Completed");
  const sn = useOpsMutation(() => actionCenterApi.snooze(i.id, { ...v, preset: snooze, until: snooze === "custom" ? new Date(until).toISOString() : undefined }), "Snoozed");
  return (
    <Card className="flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge p={i.priority} />
        <span className="text-xs text-muted-foreground">{words(i.sourceModule)} · {words(i.type)}{i.state !== "OPEN" ? ` · ${words(i.state)}` : ""}</span>
      </div>
      <p className="break-words font-medium">{i.title}</p>
      <p className="break-words text-muted-foreground">{i.description}</p>
      {i.context.length > 0 && <Caption className="block break-words">{i.context.map((c) => `${c.label}: ${c.value}`).join(" · ")}</Caption>}
      {i.dueAt && <Caption className="block">Due {new Date(i.dueAt).toLocaleDateString()}{i.snoozedUntil ? ` · snoozed until ${new Date(i.snoozedUntil).toLocaleDateString()}` : ""}{i.assignedTo ? ` · ${i.assignedTo.name}` : ""}</Caption>}
      {i.suggestedAction && <p className="break-words">Suggested: {i.suggestedAction}</p>}
      {i.resolution && <Caption className="block">{i.resolution.auto ? "Closed automatically" : `Closed by ${i.resolution.by ?? "—"}`} · {new Date(i.resolution.at).toLocaleString()}{i.resolution.reason ? ` — ${i.resolution.reason}` : ""}</Caption>}
      <div className="flex flex-wrap items-end gap-2">
        {i.links.map((l) => <Button key={l.label + l.href} asChild size="sm" variant="outline"><Link href={l.href}>{l.label}</Link></Button>)}
        <Button size="sm" variant="ghost" aria-expanded={why} onClick={() => setWhy(!why)}>Why this priority?</Button>
        {manage && live && (
          <>
            {i.state !== "IN_PROGRESS" && <Button size="sm" variant="ghost" disabled={start.isPending} onClick={() => start.mutate(undefined)}>Start</Button>}
            <Button size="sm" variant="ghost" disabled={done.isPending} onClick={() => done.mutate(undefined)}>Complete</Button>
            <Select aria-label="Snooze for" containerClassName="w-32" value={snooze} onChange={(e) => setSnooze(e.target.value)} options={[{ value: "tomorrow", label: "Tomorrow" }, { value: "3d", label: "3 days" }, { value: "1w", label: "1 week" }, { value: "custom", label: "Custom" }]} />
            {snooze === "custom" && <Input type="datetime-local" aria-label="Snooze until" containerClassName="w-52" value={until} onChange={(e) => setUntil(e.target.value)} />}
            <Button size="sm" variant="ghost" disabled={sn.isPending || (snooze === "custom" && !until)} onClick={() => sn.mutate(undefined)}>Snooze</Button>
            <Button size="sm" variant="ghost" onClick={() => setDismiss(true)}>Dismiss</Button>
          </>
        )}
      </div>
      {why && <ul className="list-disc pl-5 text-xs text-muted-foreground">{i.priorityReasons.map((r) => <li key={r}>{r}</li>)}<li>score {i.priorityScore}/100</li></ul>}
      {dismiss && <DismissDialog i={i} onClose={() => setDismiss(false)} />}
    </Card>
  );
}

function DismissDialog({ i, onClose }: { i: ActionItemView; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const required = i.priority === "CRITICAL" || i.priority === "HIGH";
  const m = useOpsMutation(() => actionCenterApi.dismiss(i.id, { expectedRowVersion: i.rowVersion, reason: reason.trim() || undefined }), "Dismissed", onClose);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Dismiss action item" description="The item is kept in history." footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={m.isPending || (required && reason.trim().length < 3)} onClick={() => m.mutate(undefined)}>Dismiss</Button></div>}>
      <Textarea label={required ? "Reason (required for high/critical items)" : "Reason (optional)"} required={required} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
