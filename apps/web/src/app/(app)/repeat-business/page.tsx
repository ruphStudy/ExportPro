"use client";

import { useQuery } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { ReorderReminderView, RepeatBusinessSignal } from "@exportpro/types";
import { repeatApi } from "@/lib/api/finance";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { day, FinanceTabs, SignalBadge, useCan, useFinanceMutation, words } from "@/components/finance/shared";
import { CopyButton } from "@/components/logistics/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const TABS = [
  { key: "due", label: "Due for reorder" },
  { key: "followup", label: "Past window" },
  { key: "high", label: "High signal" },
  { key: "all", label: "All buyers" },
] as const;

export default function RepeatBusinessPage() {
  return (
    <RequirePermission permission="repeat_business.view">
      <RepeatBusiness />
    </RequirePermission>
  );
}

function RepeatBusiness() {
  const can = useCan();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("due");
  const q = useQuery({ queryKey: ["finance", "repeat"], queryFn: repeatApi.list });
  const gen = useFinanceMutation(() => repeatApi.create({ all: true }), "Reminders suggested");
  const d = q.data;
  const list = !d ? [] : tab === "due" ? d.dueForReorder : tab === "followup" ? d.overdueFollowUp : tab === "high" ? d.highSignal : d.all;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Finance &amp; Profitability</PageTitle>
          <HelperText className="mt-1">Repeat orders from accepted buyer POs. Signals are transparent points, not probabilities; reminders are suggestions — nothing is sent automatically.</HelperText>
        </div>
        {can("repeat_business.manage") && <Button variant="outline" disabled={gen.isPending} onClick={() => gen.mutate(undefined)}>Suggest reminders for due buyers</Button>}
      </div>
      <FinanceTabs />
      <div role="tablist" aria-label="Repeat business views" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {TABS.map((t) => <Button key={t.key} role="tab" aria-selected={tab === t.key} size="sm" variant={tab === t.key ? "secondary" : "ghost"} onClick={() => setTab(t.key)}>{t.label}{d ? ` (${(t.key === "due" ? d.dueForReorder : t.key === "followup" ? d.overdueFollowUp : t.key === "high" ? d.highSignal : d.all).length})` : ""}</Button>)}
      </div>
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError || !d ? (
        <ErrorState title="Could not load repeat business" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          {d.reminders.length > 0 && <Reminders reminders={d.reminders} />}
          {!list.length ? <EmptyState icon={Repeat} title="Nothing here" description="Buyers appear once they have accepted orders; at least 3 orders are needed for a signal." /> : (
            <ul className="flex flex-col gap-2">{list.map((s) => <li key={s.buyer.id}><SignalCard s={s} /></li>)}</ul>
          )}
          <Caption>{d.method}</Caption>
        </>
      )}
    </div>
  );
}

function SignalCard({ s }: { s: RepeatBusinessSignal }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const create = useFinanceMutation(() => repeatApi.create({ buyerCompanyId: s.buyer.id }), "Reminder suggested");
  return (
    <Card className="flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{s.buyer.name}</span>
        <span className="flex flex-wrap gap-1"><SignalBadge level={s.level} />{s.score !== null && <Badge>{s.score} pts</Badge>}{s.windowState && <Badge variant={s.windowState === "IN_WINDOW" ? "warning" : s.windowState === "PAST_WINDOW" ? "danger" : "neutral"}>{words(s.windowState)}</Badge>}</span>
      </div>
      <Caption className="block break-words">{s.orderCount} order{s.orderCount === 1 ? "" : "s"} · last {day(s.lastOrderDate)}{s.averageIntervalDays ? ` · every ~${Math.round(s.averageIntervalDays)} days` : ""}{s.window ? ` · expected reorder ${day(s.window.start)} – ${day(s.window.end)}` : ""}</Caption>
      <Caption className="block break-words">Usually orders: {s.topProducts.map((p) => `${p.name} (${p.orders}×)`).join(", ") || "—"} · {s.paymentBehavior.label}</Caption>
      {s.level === "INSUFFICIENT_DATA" && <Caption className="block">Insufficient history — at least 3 accepted orders are needed. No probability is shown.</Caption>}
      <div className="flex flex-wrap gap-2">
        {s.factors.length > 0 && <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Why?"}</Button>}
        {can("repeat_business.manage") && s.window && !s.reminder && s.windowState !== "NOT_YET" && <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate(undefined)}>Suggest reminder</Button>}
        {s.crmLeadId && <Button asChild size="sm" variant="ghost"><Link href={`/crm/leads/${s.crmLeadId}`}>CRM lead</Link></Button>}
      </div>
      {open && <ul className="list-disc pl-5">{s.factors.map((f) => <li key={f.factor}>{f.factor}: {f.points}/{f.max} — {f.explanation}</li>)}</ul>}
    </Card>
  );
}

function Reminders({ reminders }: { reminders: ReorderReminderView[] }) {
  const can = useCan();
  const [until, setUntil] = useState("");
  const dismiss = useFinanceMutation((id: string) => repeatApi.dismiss(id), "Dismissed");
  const snooze = useFinanceMutation((id: string) => repeatApi.snooze(id, until), "Snoozed");
  const draft = useFinanceMutation((id: string) => repeatApi.draft(id), "Marked as drafted");
  return (
    <Card className="p-4 text-sm">
      <SectionTitle className="text-base">Reorder reminders</SectionTitle>
      <ul className="mt-2 flex flex-col gap-2">
        {reminders.map((r) => (
          <li key={r.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.buyer.name}</span><Badge>{words(r.status)}</Badge><Caption>window {day(r.windowStart)} – {day(r.windowEnd)}{r.snoozedUntil ? ` · snoozed until ${day(r.snoozedUntil)}` : ""}</Caption></div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-muted-foreground">{r.message}</pre>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <CopyButton text={r.message} label="Copy draft" />
              {can("repeat_business.manage") && (
                <>
                  <Button size="sm" variant="outline" onClick={() => draft.mutate(r.id)}>Mark drafted for outreach</Button>
                  <Input type="date" aria-label="Snooze until" containerClassName="w-40" value={until} onChange={(e) => setUntil(e.target.value)} />
                  <Button size="sm" variant="ghost" disabled={!until} onClick={() => snooze.mutate(r.id)}>Snooze</Button>
                  <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(r.id)}>Dismiss</Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
