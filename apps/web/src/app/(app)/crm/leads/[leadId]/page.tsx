"use client";

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, ExternalLink, Info, Lightbulb, Paperclip, Pencil, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import type {
  CrmLead,
  CrmLeadDetailResponse,
  CrmMember,
  LeadActivity,
  LeadComment,
  LeadPriority,
  LeadTask,
  LoggableActivityType,
  QualificationField,
} from "@exportpro/types";
import {
  COUNTRIES,
  countryLabel,
  CRM_STAGE_LABELS,
  LEAD_ACTIVITY_LABELS,
  LEAD_PRIORITIES,
  LEAD_PRIORITY_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_TASK_STATUS_LABELS,
  LOGGABLE_ACTIVITY_TYPES,
  LOST_REASON_LABELS,
  QUALIFICATION_FIELDS,
  QUALIFICATION_LABELS,
  QUALIFICATION_MIN_FIELDS,
} from "@exportpro/types";
import { ATTACHMENT_ACCEPT, crmApi } from "@/lib/api/crm";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { fmtDay, fmtValue, fromLocalInput, HEALTH_LABEL, relativeDays, TASK_STATUS_VARIANT, toLocalInput } from "@/lib/crm-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { MatchScore, RiskBadge, VerificationBadge } from "@/components/buyers/buyer-bits";
import { DueText, errorToast, HealthBadge, PriorityBadge, StageBadge, StageControl, useInvalidateCrm } from "@/components/crm/crm-bits";
import { RequirePermission } from "@/components/layout/require-permission";
import { OutreachHistoryCard, StartOutreachButton } from "@/components/outreach/outreach-history";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { LeadCommercialCard } from "@/components/commercial/entry-points";
import { LeadShipmentCard } from "@/components/logistics/entry-cards";
import { BuyerFinanceCard } from "@/components/finance/entry-cards";
import { LeadCostingsCard } from "@/components/costing/costing-entry";
import { LeadInquiriesCard } from "@/components/inquiries/lead-inquiries-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function LeadDetailPage() {
  return (
    <RequirePermission permission="crm.view">
      <LeadDetail />
    </RequirePermission>
  );
}

function useCan() {
  const { data: session } = useSession();
  return { session, can: (p: Parameters<typeof hasPermission>[1]) => hasPermission(session, p) };
}

function LeadDetail() {
  const { leadId } = useParams<{ leadId: string }>();
  const q = useQuery({ queryKey: ["crm", "lead", leadId], queryFn: () => crmApi.detail(leadId), retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2 });
  const members = useQuery({ queryKey: ["crm", "members"], queryFn: crmApi.members, staleTime: 60_000 });
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs items={[{ label: "CRM", href: "/crm" }, { label: "Lead" }]} />
        <ErrorState title={notFound ? "Lead not found" : "Lead unavailable"} message={notFound ? "This lead doesn't exist in your organization." : toFriendlyErrorMessage(q.error)} onRetry={notFound ? undefined : () => q.refetch()} />
      </div>
    );
  }
  const d = q.data;
  const l = d.lead;
  const memberList = members.data ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "CRM", href: "/crm" }, { label: l.buyer.name }]} />
      <Header lead={l} members={memberList} />
      {l.suggestion && <SuggestionBanner key={`${l.stage}-${l.suggestion.suggestedStage}`} lead={l} />}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <LogActivityCard lead={l} />
          <TimelineCard leadId={l.id} />
          <CommentsCard leadId={l.id} comments={d.comments} members={memberList} />
          <TasksCard lead={l} tasks={d.tasks} members={memberList} />
          <AttachmentsCard leadId={l.id} attachments={d.attachments} />
          <OutreachHistoryCard leadId={l.id} />
        </div>
        <aside className="flex min-w-0 flex-col gap-5" aria-label="Lead details">
          <NextActionCard key={`na-${l.version}`} lead={l} />
          <LeadInquiriesCard leadId={l.id} />
          <LeadCostingsCard leadId={l.id} />
          <LeadCommercialCard leadId={l.id} />
          <LeadShipmentCard leadId={l.id} />
          <BuyerFinanceCard buyerId={l.buyer.id} lead />
          <RemindersCard lead={l} reminders={d.reminders} tasks={d.tasks} members={memberList} />
          <DealCard key={`deal-${l.version}`} lead={l} />
          <QualificationCard key={`q-${l.version}`} lead={l} />
          <TagsCard lead={l} />
          <ContactsCard lead={l} />
          <BuyerSummaryCard lead={l} />
          <HistoryCard lead={l} />
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- header

function Header({ lead: l, members }: { lead: CrmLead; members: CrmMember[] }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const update = useMutation({
    mutationFn: (body: { priority: LeadPriority }) => crmApi.update(l.id, { ...body, expectedVersion: l.version }),
    onSuccess: () => {
      toast.success("Lead updated");
      invalidate();
    },
    onError: (e) => {
      errorToast("Could not update lead", e);
      invalidate();
    },
  });
  const assign = useMutation({
    mutationFn: (ownerUserId: string | null) => crmApi.assign(l.id, { ownerUserId, expectedVersion: l.version }),
    onSuccess: (r) => {
      toast.success(r.owner ? `Assigned to ${r.owner.name}` : "Owner removed");
      invalidate();
    },
    onError: (e) => {
      errorToast("Could not assign lead", e);
      invalidate();
    },
  });
  const buyerHref = `/buyers/${l.buyer.id}?${new URLSearchParams({ ...(l.product ? { productId: l.product.id } : {}), country: l.countryCode })}`;
  const value = fmtValue(l.expectedValue, l.currency);
  const closed = l.signals.status !== "OPEN";
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle className="break-words">{l.buyer.name}</PageTitle>
          <p className="text-sm text-muted-foreground">
            {l.product ? `${l.product.name}${l.product.hsCode ? ` (HS ${l.product.hsCode})` : ""}` : "No product context"} · {countryLabel(l.countryCode)}
          </p>
          {l.countryDiffersFromBuyer && (
            <p className="mt-1 flex items-center gap-1 text-xs text-warning"><Info className="size-3.5" aria-hidden="true" />Commercial market differs from the buyer’s country ({countryLabel(l.buyer.countryCode)}).</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <StartOutreachButton size="sm" ctx={{ leadId: l.id }} disabledReason={l.contacts.some((c) => c.contactType === "EMAIL" && c.verificationStatus !== "INVALID") ? null : "No usable email contact on record"} />
          <Button variant="outline" size="sm" asChild>
            <Link href={buyerHref}>Buyer profile<ExternalLink className="size-3.5" aria-hidden="true" /></Link>
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StageBadge stage={l.stage} />
        <PriorityBadge priority={l.priority} />
        <HealthBadge health={l.signals.health} reasons={l.signals.healthReasons} />
        {l.signals.stale && <Badge variant="warning">Stale · no activity for {l.signals.inactiveDays} days</Badge>}
        {l.buyer.demo && <Badge variant="neutral">Sample buyer data</Badge>}
        {l.stage === "WON" && l.wonAt && <Badge variant="success">Won {fmtDay(l.wonAt)}</Badge>}
        {l.stage === "LOST" && l.lostReason && <Badge variant="danger">Lost: {LOST_REASON_LABELS[l.lostReason]}</Badge>}
      </div>
      <div className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0"><StageControl lead={l} /></div>
        {can("crm.edit") ? (
          <Select label="Priority" value={l.priority} disabled={update.isPending} options={LEAD_PRIORITIES.map((p) => ({ value: p, label: LEAD_PRIORITY_LABELS[p] }))} onChange={(e) => update.mutate({ priority: e.target.value as LeadPriority })} />
        ) : (
          <Fact label="Priority">{LEAD_PRIORITY_LABELS[l.priority]}</Fact>
        )}
        {can("crm.assign") ? (
          <Select
            label="Owner"
            value={l.owner?.id ?? ""}
            disabled={assign.isPending}
            options={[{ value: "", label: "Unassigned" }, ...members.map((m) => ({ value: m.id, label: m.name })), ...(l.owner && !members.some((m) => m.id === l.owner!.id) ? [{ value: l.owner.id, label: l.owner.name }] : [])]}
            onChange={(e) => assign.mutate(e.target.value || null)}
          />
        ) : (
          <Fact label="Owner">{l.owner?.name ?? "Unassigned"}</Fact>
        )}
        <Fact label={closed ? "Final value" : "Expected value · Pipeline probability"}>
          {value ?? <span className="text-muted-foreground">Not set</span>}
          {!closed && <Caption className="ml-1">· {l.signals.probability}%</Caption>}
        </Fact>
      </div>
    </header>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function SuggestionBanner({ lead: l }: { lead: CrmLead }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const [hidden, setHidden] = React.useState(false);
  const s = l.suggestion!;
  const m = useMutation({
    mutationFn: () => crmApi.stage(l.id, { stage: s.suggestedStage, reason: `Accepted suggestion: ${s.reason}`, expectedVersion: l.version }),
    onSuccess: () => {
      toast.success(`Moved to ${CRM_STAGE_LABELS[s.suggestedStage]}`);
      invalidate();
    },
    onError: (e) => errorToast("Could not change stage", e),
  });
  if (hidden) return null;
  return (
    <section aria-label="Stage suggestion" className="flex flex-col gap-3 rounded-lg border border-info/40 bg-info/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
        <p>
          <span className="font-medium">Suggested stage: {CRM_STAGE_LABELS[s.suggestedStage]}</span> — {s.reason}{" "}
          <Caption>Rule-based suggestion ({s.confidence.toLowerCase()} confidence). The stage only changes if you confirm.</Caption>
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {can("crm.stage_change") && <Button size="sm" onClick={() => m.mutate()} loading={m.isPending}>Move to {CRM_STAGE_LABELS[s.suggestedStage]}<ArrowRight className="size-4" aria-hidden="true" /></Button>}
        <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>Not now</Button>
      </div>
    </section>
  );
}

// ----------------------------------------------------------- activity

const TYPE_LABEL: Record<LoggableActivityType, string> = { NOTE: "Note", CALL: "Call", MEETING: "Meeting", EMAIL: "Email (manual log)", OTHER: "Other" };

function LogActivityCard({ lead: l }: { lead: CrmLead }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const [type, setType] = React.useState<LoggableActivityType>("NOTE");
  const [direction, setDirection] = React.useState<"OUTBOUND" | "INBOUND">("OUTBOUND");
  const [when, setWhen] = React.useState("");
  const [contactId, setContactId] = React.useState("");
  const [outcome, setOutcome] = React.useState("");
  const [duration, setDuration] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [body, setBody] = React.useState("");
  const comm = type === "CALL" || type === "MEETING" || type === "EMAIL";
  const reset = () => {
    setWhen("");
    setOutcome("");
    setDuration("");
    setLocation("");
    setBody("");
  };
  const m = useMutation({
    mutationFn: () =>
      crmApi.logActivity(l.id, {
        type,
        body: body || undefined,
        direction: comm ? direction : undefined,
        occurredAt: fromLocalInput(when),
        contactId: contactId || undefined,
        outcome: outcome || undefined,
        durationMinutes: duration ? Number(duration) : undefined,
        location: type === "MEETING" ? location || undefined : undefined,
      }),
    onSuccess: (r) => {
      toast.success(`${TYPE_LABEL[type]} logged`, r.suggestion ? `Suggested next stage: ${CRM_STAGE_LABELS[r.suggestion.suggestedStage]} (confirm at the top of the page).` : undefined);
      reset();
      invalidate();
    },
    onError: (e) => errorToast("Could not log activity", e),
  });
  if (!can("crm.notes")) return null;
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Log activity</SectionTitle>
      <HelperText>Record what happened. Nothing is sent to the buyer from here.</HelperText>
      <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (type === "NOTE" && !body.trim()) return toast.warning("Write the note first"); m.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Type" value={type} options={LOGGABLE_ACTIVITY_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} onChange={(e) => setType(e.target.value as LoggableActivityType)} />
          {comm && (
            <Select label="Direction" value={direction} options={[{ value: "OUTBOUND", label: "We reached out" }, { value: "INBOUND", label: "Buyer responded / reached us" }]} onChange={(e) => setDirection(e.target.value as "OUTBOUND" | "INBOUND")} />
          )}
          {type !== "NOTE" && <Input label="When" type="datetime-local" value={when} max={toLocalInput(new Date().toISOString())} description="Leave empty for now" onChange={(e) => setWhen(e.target.value)} />}
          {comm && l.contacts.length > 0 && (
            <Select label="Contact" value={contactId} options={[{ value: "", label: "Not specified" }, ...l.contacts.map((c) => ({ value: c.id, label: c.name ?? c.role ?? c.value }))]} onChange={(e) => setContactId(e.target.value)} />
          )}
          {(type === "CALL" || type === "MEETING") && <Input label="Duration (minutes)" type="number" min={0} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} />}
          {type === "MEETING" && <Input label="Location or link" value={location} maxLength={300} onChange={(e) => setLocation(e.target.value)} />}
          {type !== "NOTE" && <Input label="Outcome" value={outcome} maxLength={200} placeholder="e.g. Asked for price list" onChange={(e) => setOutcome(e.target.value)} />}
        </div>
        <Textarea label={type === "NOTE" ? "Note" : "Notes"} required={type === "NOTE"} value={body} rows={3} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
        <div className="flex justify-end">
          <Button type="submit" loading={m.isPending}>Log {TYPE_LABEL[type].toLowerCase()}</Button>
        </div>
      </form>
    </Card>
  );
}

function TimelineCard({ leadId }: { leadId: string }) {
  const q = useInfiniteQuery({
    queryKey: ["crm", "lead", leadId, "activities"],
    queryFn: ({ pageParam }) => crmApi.activities(leadId, { page: pageParam, pageSize: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Activity timeline</SectionTitle>
      <Caption>Newest first · business collaboration history (separate from the security audit log)</Caption>
      {q.isLoading ? (
        <div className="mt-3 flex flex-col gap-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : q.isError ? (
        <ErrorState className="mt-3" title="Timeline unavailable" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <HelperText className="mt-3">No activity yet.</HelperText>
      ) : (
        <ol className="mt-3 flex flex-col">
          {items.map((a) => <TimelineItem key={a.id} a={a} />)}
        </ol>
      )}
      {q.hasNextPage && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>Load older activity</Button>
      )}
    </Card>
  );
}

function TimelineItem({ a }: { a: LeadActivity }) {
  const variant = a.type === "STAGE_CHANGE" ? "info" : a.type === "SYSTEM" || a.type === "ATTACHMENT" ? "neutral" : a.type === "TASK" ? "warning" : "success";
  const meta = [a.direction === "INBOUND" ? "Buyer → us" : a.direction === "OUTBOUND" ? "Us → buyer" : null, a.contact?.name, a.durationMinutes ? `${a.durationMinutes} min` : null, a.location, a.outcome ? `Outcome: ${a.outcome}` : null].filter(Boolean);
  return (
    <li className="relative border-l-2 border-border py-2 pl-4">
      <span className="absolute -left-[5px] top-3.5 size-2 rounded-full bg-primary" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={variant}>{LEAD_ACTIVITY_LABELS[a.type]}</Badge>
        <span className="text-sm font-medium break-words">{a.title}</span>
      </div>
      {meta.length > 0 && <p className="text-xs text-muted-foreground break-words">{meta.join(" · ")}</p>}
      {a.body && <p className="mt-1 whitespace-pre-wrap text-sm break-words">{a.body}</p>}
      <Caption>
        <time dateTime={a.occurredAt}>{new Date(a.occurredAt).toLocaleString()}</time>
        {a.actor ? ` · ${a.actor.name}` : ""}
      </Caption>
    </li>
  );
}

// ----------------------------------------------------------- comments

function MentionText({ body, mentions }: { body: string; mentions: LeadComment["mentions"] }) {
  if (!mentions.length) return <>{body}</>;
  const names = mentions.flatMap((m) => [m.name, m.name.split(" ")[0]]).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "gi");
  return (
    <>
      {body.split(re).map((part, i) =>
        i % 2 === 1 ? <mark key={i} className="rounded bg-primary/10 px-0.5 text-primary">{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>,
      )}
    </>
  );
}

function CommentsCard({ leadId, comments, members }: { leadId: string; comments: LeadComment[]; members: CrmMember[] }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const [body, setBody] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editBody, setEditBody] = React.useState("");
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const add = useMutation({
    mutationFn: () => crmApi.comment(leadId, body),
    onSuccess: (c) => {
      toast.success("Comment added", c.mentions.length ? `Mentioned ${c.mentions.map((m) => m.name).join(", ")}.` : undefined);
      setBody("");
      invalidate();
    },
    onError: (e) => errorToast("Could not add comment", e),
  });
  const edit = useMutation({
    mutationFn: (id: string) => crmApi.editComment(leadId, id, editBody),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: (e) => errorToast("Could not edit comment", e),
  });
  const insertMention = (m: CrmMember) => {
    setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${m.name} `);
    ref.current?.focus();
  };
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Team comments</SectionTitle>
      <HelperText>Internal to your organization. Mention a teammate with @First Last.</HelperText>
      {can("crm.notes") && (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
          <Textarea ref={ref} label="Comment" value={body} rows={3} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1" aria-label="Mention a teammate">
              {members.slice(0, 8).map((m) => (
                <button key={m.id} type="button" className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => insertMention(m)}>
                  @{m.name}
                </button>
              ))}
            </div>
            <Button type="submit" size="sm" loading={add.isPending} disabled={!body.trim()}>Comment</Button>
          </div>
        </form>
      )}
      {comments.length === 0 ? (
        <HelperText className="mt-3">No comments yet.</HelperText>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{c.author?.name ?? "Former member"}</span>
                <Caption>{new Date(c.createdAt).toLocaleString()}{c.editedAt ? " · edited" : ""}</Caption>
              </div>
              {editing === c.id ? (
                <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (editBody.trim()) edit.mutate(c.id); }}>
                  <Textarea aria-label="Edit comment" value={editBody} rows={3} maxLength={5000} onChange={(e) => setEditBody(e.target.value)} />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    <Button type="submit" size="sm" loading={edit.isPending}>Save</Button>
                  </div>
                </form>
              ) : (
                <p className="mt-1 whitespace-pre-wrap break-words"><MentionText body={c.body} mentions={c.mentions} /></p>
              )}
              {c.canEdit && editing !== c.id && can("crm.notes") && (
                <Button size="sm" variant="ghost" className="mt-1 h-7 px-2" onClick={() => { setEditing(c.id); setEditBody(c.body); }}>
                  <Pencil className="size-3.5" aria-hidden="true" />Edit
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// -------------------------------------------------------------- tasks

function TasksCard({ lead: l, tasks, members }: { lead: CrmLead; tasks: LeadTask[]; members: CrmMember[] }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const [title, setTitle] = React.useState("");
  const [assignee, setAssignee] = React.useState("");
  const [due, setDue] = React.useState("");
  const [priority, setPriority] = React.useState<LeadPriority>("MEDIUM");
  const [editTask, setEditTask] = React.useState<LeadTask | null>(null);
  const open = tasks.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS");
  const closed = tasks.filter((t) => t.status === "DONE" || t.status === "CANCELLED");
  const create = useMutation({
    mutationFn: () => crmApi.createTask(l.id, { title, assignedToUserId: assignee || undefined, dueAt: fromLocalInput(due), priority }),
    onSuccess: () => {
      toast.success("Task created");
      setTitle("");
      setDue("");
      invalidate();
    },
    onError: (e) => errorToast("Could not create task", e),
  });
  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: LeadTask["status"] }) => crmApi.updateTask(id, { status: s }),
    onSuccess: (t) => {
      toast.success(`Task ${LEAD_TASK_STATUS_LABELS[t.status].toLowerCase()}`);
      invalidate();
    },
    onError: (e) => errorToast("Could not update task", e),
  });
  const canEdit = can("crm.tasks");
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Tasks</SectionTitle>
      {canEdit && (
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (title.trim().length >= 2) create.mutate(); }}>
          <Input label="New task" required value={title} maxLength={200} placeholder="e.g. Send revised price list" containerClassName="sm:col-span-2" onChange={(e) => setTitle(e.target.value)} />
          <Select label="Assignee" value={assignee} options={[{ value: "", label: l.owner ? `Lead owner (${l.owner.name})` : "Me" }, ...members.map((m) => ({ value: m.id, label: m.name }))]} onChange={(e) => setAssignee(e.target.value)} />
          <Input label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          <Select label="Priority" value={priority} options={LEAD_PRIORITIES.map((p) => ({ value: p, label: LEAD_PRIORITY_LABELS[p] }))} onChange={(e) => setPriority(e.target.value as LeadPriority)} />
          <div className="flex items-end justify-end"><Button type="submit" loading={create.isPending} disabled={title.trim().length < 2}>Add task</Button></div>
        </form>
      )}
      <h3 className="mt-4 text-sm font-medium">Open ({open.length})</h3>
      {open.length === 0 ? (
        <HelperText>No open tasks.</HelperText>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {open.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium break-words">{t.title}</p>
                {t.description && <p className="text-xs text-muted-foreground break-words">{t.description}</p>}
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>{t.assignee?.name ?? "Unassigned"}</span>
                  <DueText iso={t.dueAt} overdue={t.overdue} />
                  <span>Priority: {LEAD_PRIORITY_LABELS[t.priority]}</span>
                  <Badge variant={TASK_STATUS_VARIANT[t.status]}>{LEAD_TASK_STATUS_LABELS[t.status]}</Badge>
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 flex-wrap gap-1">
                  <Button size="sm" onClick={() => status.mutate({ id: t.id, s: "DONE" })} disabled={status.isPending} aria-label={`Complete ${t.title}`}>Complete</Button>
                  {t.status === "OPEN" && <Button size="sm" variant="outline" onClick={() => status.mutate({ id: t.id, s: "IN_PROGRESS" })} disabled={status.isPending}>Start</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setEditTask(t)} aria-label={`Edit ${t.title}`}><Pencil className="size-3.5" aria-hidden="true" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: t.id, s: "CANCELLED" })} disabled={status.isPending} aria-label={`Cancel ${t.title}`}><X className="size-3.5" aria-hidden="true" /></Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-primary">Completed &amp; cancelled ({closed.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {closed.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
                <span className="break-words line-through decoration-muted-foreground/60">{t.title}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={TASK_STATUS_VARIANT[t.status]}>{LEAD_TASK_STATUS_LABELS[t.status]}</Badge>
                  {t.completedAt && <Caption>{fmtDay(t.completedAt)}</Caption>}
                  {canEdit && <Button size="sm" variant="ghost" className="h-7" onClick={() => status.mutate({ id: t.id, s: "OPEN" })}>Reopen</Button>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {editTask && <EditTaskModal key={editTask.id} task={editTask} members={members} onClose={() => setEditTask(null)} />}
    </Card>
  );
}

function EditTaskModal({ task, members, onClose }: { task: LeadTask; members: CrmMember[]; onClose: () => void }) {
  const invalidate = useInvalidateCrm();
  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description ?? "");
  const [assignee, setAssignee] = React.useState(task.assignee?.id ?? "");
  const [due, setDue] = React.useState(toLocalInput(task.dueAt));
  const [priority, setPriority] = React.useState<LeadPriority>(task.priority);
  const m = useMutation({
    mutationFn: () => crmApi.updateTask(task.id, { title, description: description || null, assignedToUserId: assignee || null, dueAt: fromLocalInput(due) ?? null, priority }),
    onSuccess: () => {
      toast.success("Task updated");
      invalidate();
      onClose();
    },
    onError: (e) => errorToast("Could not update task", e),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit task"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={title.trim().length < 2}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input label="Title" required value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        <Textarea label="Description" value={description} rows={2} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        <Select label="Assignee" value={assignee} options={[{ value: "", label: "Unassigned" }, ...members.map((mb) => ({ value: mb.id, label: mb.name }))]} onChange={(e) => setAssignee(e.target.value)} />
        <Input label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        <Select label="Priority" value={priority} options={LEAD_PRIORITIES.map((p) => ({ value: p, label: LEAD_PRIORITY_LABELS[p] }))} onChange={(e) => setPriority(e.target.value as LeadPriority)} />
      </div>
    </Modal>
  );
}

// -------------------------------------------------------- attachments

function AttachmentsCard({ leadId, attachments }: { leadId: string; attachments: CrmLeadDetailResponse["attachments"] }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (f: File) => crmApi.uploadAttachment(leadId, f),
    onSuccess: (a) => {
      setError(null);
      toast.success("Attachment uploaded", a.filename);
      invalidate();
    },
    onError: (e) => setError(toFriendlyErrorMessage(e)),
    onSettled: () => {
      if (inputRef.current) inputRef.current.value = "";
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => crmApi.deleteAttachment(leadId, id),
    onSuccess: () => {
      toast.success("Attachment removed");
      invalidate();
    },
    onError: (e) => errorToast("Could not remove attachment", e),
  });
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="text-base">Attachments</SectionTitle>
        {can("crm.attachments") && (
          <>
            <input
              ref={inputRef}
              id="lead-attachment"
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 10 * 1024 * 1024) {
                  setError("File must be 10MB or smaller.");
                  e.target.value = "";
                  return;
                }
                upload.mutate(f);
              }}
            />
            <Button size="sm" variant="outline" loading={upload.isPending} onClick={() => inputRef.current?.click()}>
              <Paperclip className="size-4" aria-hidden="true" />Upload
            </Button>
          </>
        )}
      </div>
      <Caption>Private to your organization · PDF, images, DOCX, XLSX, CSV, TXT · max 10MB</Caption>
      {error && <p role="alert" className="mt-2 text-sm text-danger">Upload failed: {error}</p>}
      {attachments.length === 0 ? (
        <HelperText className="mt-2">No attachments.</HelperText>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {attachments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="break-all font-medium">{a.filename}</p>
                <Caption>{(a.sizeBytes / 1024).toFixed(0)} KB · {a.uploadedBy?.name ?? "Former member"} · {fmtDay(a.createdAt)}</Caption>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" asChild>
                  <a href={crmApi.downloadHref(leadId, a.id)} aria-label={`Download ${a.filename}`}><Download className="size-4" aria-hidden="true" /></a>
                </Button>
                {a.canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(a.id)} disabled={remove.isPending} aria-label={`Remove ${a.filename}`}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// -------------------------------------------------------------- side

function NextActionCard({ lead: l }: { lead: CrmLead }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const [text, setText] = React.useState(l.nextAction ?? "");
  const [due, setDue] = React.useState(toLocalInput(l.nextActionDueAt));
  const m = useMutation({
    mutationFn: (clear?: boolean) =>
      crmApi.update(l.id, clear ? { nextAction: null, nextActionDueAt: null, expectedVersion: l.version } : { nextAction: text || null, nextActionDueAt: fromLocalInput(due) ?? null, expectedVersion: l.version }),
    onSuccess: () => {
      toast.success("Next action saved");
      invalidate();
    },
    onError: (e) => errorToast("Could not save next action", e),
  });
  const closed = l.signals.status !== "OPEN";
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Next action</SectionTitle>
      {l.nextAction ? (
        <div className="mt-2 text-sm">
          <p className="break-words font-medium">{l.nextAction}</p>
          <DueText iso={l.nextActionDueAt} overdue={l.signals.nextActionOverdue} />
        </div>
      ) : (
        <HelperText className="mt-1">{closed ? "Closed lead." : "No next action set."}</HelperText>
      )}
      {l.signals.suggestedFollowUp && !closed && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/60 p-2 text-xs">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>Suggested follow-up: {l.signals.suggestedFollowUp}{" "}
            {can("crm.edit") && <button type="button" className="text-primary underline" onClick={() => setText(l.signals.suggestedFollowUp ?? "")}>Use</button>}
          </span>
        </p>
      )}
      {can("crm.edit") && !closed && (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(false); }}>
          <Input label="Action" value={text} maxLength={200} placeholder="e.g. Confirm payment terms" onChange={(e) => setText(e.target.value)} />
          <Input label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          <div className="flex justify-end gap-2">
            {l.nextAction && <Button type="button" size="sm" variant="ghost" onClick={() => m.mutate(true)}>Clear</Button>}
            <Button type="submit" size="sm" loading={m.isPending} disabled={!text.trim()}>Save</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function RemindersCard({ lead: l, reminders, tasks, members }: { lead: CrmLead; reminders: CrmLeadDetailResponse["reminders"]; tasks: LeadTask[]; members: CrmMember[] }) {
  const { can, session } = useCan();
  const invalidate = useInvalidateCrm();
  const [when, setWhen] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [taskId, setTaskId] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const create = useMutation({
    mutationFn: () => crmApi.createReminder(l.id, { remindAt: fromLocalInput(when)!, message, taskId: taskId || undefined, userId: userId || undefined, type: taskId ? "TASK" : "FOLLOW_UP" }),
    onSuccess: () => {
      toast.success("Reminder set");
      setWhen("");
      setMessage("");
      setTaskId("");
      invalidate();
    },
    onError: (e) => errorToast("Could not set reminder", e),
  });
  const change = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "DISMISSED" | "CANCELLED" }) => crmApi.updateReminder(id, { status }),
    onSuccess: () => invalidate(),
    onError: (e) => errorToast("Could not update reminder", e),
  });
  const openTasks = tasks.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS");
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Follow-up reminders</SectionTitle>
      {reminders.length === 0 ? (
        <HelperText className="mt-1">No active reminders.</HelperText>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {reminders.map((r) => (
            <li key={r.id} className="rounded-md border border-border p-2 text-sm">
              <p className="break-words">{r.message}</p>
              <p className="text-xs">
                {r.due ? <span className="font-medium text-danger">Due · </span> : null}
                {new Date(r.remindAt).toLocaleString()} · for {r.user?.id === session?.user.id ? "you" : (r.user?.name ?? "—")}
              </p>
              {can("crm.tasks") && (
                <div className="mt-1 flex gap-1">
                  {r.due && <Button size="sm" variant="outline" className="h-7" onClick={() => change.mutate({ id: r.id, status: "DISMISSED" })}>Dismiss</Button>}
                  {!r.due && <Button size="sm" variant="ghost" className="h-7" onClick={() => change.mutate({ id: r.id, status: "CANCELLED" })}>Cancel</Button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {can("crm.tasks") && (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (when && message.trim().length >= 2) create.mutate(); }}>
          <Input label="Remind at" required type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <Input label="Message" required value={message} maxLength={300} placeholder="e.g. Chase sample feedback" onChange={(e) => setMessage(e.target.value)} />
          <Select label="Remind" value={userId} options={[{ value: "", label: "Me" }, ...members.filter((m) => m.id !== session?.user.id).map((m) => ({ value: m.id, label: m.name }))]} onChange={(e) => setUserId(e.target.value)} />
          {openTasks.length > 0 && <Select label="Linked task (optional)" value={taskId} options={[{ value: "", label: "None" }, ...openTasks.map((t) => ({ value: t.id, label: t.title }))]} onChange={(e) => setTaskId(e.target.value)} />}
          <div className="flex justify-end"><Button type="submit" size="sm" loading={create.isPending} disabled={!when || message.trim().length < 2}>Add reminder</Button></div>
        </form>
      )}
      <Caption className="mt-2 block">Due reminders appear in CRM → Needs follow-up.</Caption>
    </Card>
  );
}

function DealCard({ lead: l }: { lead: CrmLead }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const [value, setValue] = React.useState(l.expectedValue?.toString() ?? "");
  const [currency, setCurrency] = React.useState(l.currency ?? "");
  const [country, setCountry] = React.useState(l.countryCode);
  const m = useMutation({
    mutationFn: () => crmApi.update(l.id, { expectedValue: value ? Number(value) : null, currency: currency ? currency.toUpperCase() : value ? undefined : null, countryCode: country, expectedVersion: l.version }),
    onSuccess: () => {
      toast.success("Saved");
      invalidate();
    },
    onError: (e) => errorToast("Could not save", e),
  });
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Deal context</SectionTitle>
      <Caption>Indicative only — formal quotations come in a later module. Pipeline probability ({l.signals.probability}%) is a fixed per-stage value, not a prediction.</Caption>
      {can("crm.edit") ? (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <div className="grid grid-cols-[1fr_5.5rem] gap-2">
            <Input label="Expected value" type="number" min={0} step="0.01" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            <Input label="Currency" value={currency} maxLength={3} placeholder="USD" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
          <Select label="Market (country)" value={country} options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))} onChange={(e) => setCountry(e.target.value)} />
          <div className="flex justify-end"><Button type="submit" size="sm" loading={m.isPending}>Save</Button></div>
        </form>
      ) : (
        <p className="mt-2 text-sm">{fmtValue(l.expectedValue, l.currency) ?? "Not set"} · {countryLabel(l.countryCode)}</p>
      )}
    </Card>
  );
}

function QualificationCard({ lead: l }: { lead: CrmLead }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const [values, setValues] = React.useState<Record<QualificationField, string>>(() => Object.fromEntries(QUALIFICATION_FIELDS.map((f) => [f, l.qualification[f] ?? ""])) as Record<QualificationField, string>);
  const filled = QUALIFICATION_FIELDS.filter((f) => (l.qualification[f] ?? "").trim()).length;
  const m = useMutation({
    mutationFn: () => crmApi.update(l.id, { qualification: Object.fromEntries(QUALIFICATION_FIELDS.map((f) => [f, values[f] || null])), expectedVersion: l.version }),
    onSuccess: () => {
      toast.success("Qualification saved");
      invalidate();
    },
    onError: (e) => errorToast("Could not save qualification", e),
  });
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Qualification</SectionTitle>
      <Caption>{filled} of {QUALIFICATION_FIELDS.length} captured · {QUALIFICATION_MIN_FIELDS}+ suggests “Qualified”</Caption>
      {can("crm.edit") ? (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          {QUALIFICATION_FIELDS.map((f) => (
            <Input key={f} label={QUALIFICATION_LABELS[f]} value={values[f]} maxLength={300} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} />
          ))}
          <div className="flex justify-end"><Button type="submit" size="sm" loading={m.isPending}>Save</Button></div>
        </form>
      ) : (
        <dl className="mt-2 flex flex-col gap-1 text-sm">
          {QUALIFICATION_FIELDS.map((f) => (
            <div key={f}><dt className="text-xs text-muted-foreground">{QUALIFICATION_LABELS[f]}</dt><dd>{l.qualification[f] ?? "—"}</dd></div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function TagsCard({ lead: l }: { lead: CrmLead }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const tags = useQuery({ queryKey: ["crm", "tags"], queryFn: crmApi.tags, staleTime: 60_000, enabled: can("crm.edit") });
  const [name, setName] = React.useState("");
  const setTags = useMutation({
    mutationFn: (ids: string[]) => crmApi.update(l.id, { tagIds: ids, expectedVersion: l.version }),
    onSuccess: () => invalidate(),
    onError: (e) => errorToast("Could not update tags", e),
  });
  const create = useMutation({
    mutationFn: async () => {
      const t = await crmApi.createTag(name);
      return crmApi.update(l.id, { tagIds: [...new Set([...l.tags.map((x) => x.id), t.id])], expectedVersion: l.version });
    },
    onSuccess: () => {
      setName("");
      invalidate();
    },
    onError: (e) => errorToast("Could not add tag", e),
  });
  const available = (tags.data ?? []).filter((t) => !l.tags.some((x) => x.id === t.id));
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Tags</SectionTitle>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {l.tags.length === 0 && <HelperText>No tags.</HelperText>}
        {l.tags.map((t) => (
          <Badge key={t.id} variant="neutral" className="gap-1">
            #{t.name}
            {can("crm.edit") && (
              <button type="button" className="rounded-full hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remove tag ${t.name}`} onClick={() => setTags.mutate(l.tags.filter((x) => x.id !== t.id).map((x) => x.id))}>
                <X className="size-3" aria-hidden="true" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      {can("crm.edit") && (
        <div className="mt-3 flex flex-col gap-2">
          {available.length > 0 && (
            <Select aria-label="Add existing tag" value="" placeholder="Add existing tag" options={available.map((t) => ({ value: t.id, label: t.name }))} onChange={(e) => e.target.value && setTags.mutate([...l.tags.map((x) => x.id), e.target.value])} />
          )}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
            <Input aria-label="New tag" value={name} maxLength={40} placeholder="New tag, e.g. GCC" containerClassName="flex-1" onChange={(e) => setName(e.target.value)} />
            <Button type="submit" size="sm" variant="outline" className="h-9" loading={create.isPending} disabled={!name.trim()}>Add</Button>
          </form>
        </div>
      )}
    </Card>
  );
}

function ContactsCard({ lead: l }: { lead: CrmLead }) {
  const { can } = useCan();
  const invalidate = useInvalidateCrm();
  const m = useMutation({
    mutationFn: (id: string | null) => crmApi.update(l.id, { primaryContactId: id, expectedVersion: l.version }),
    onSuccess: () => invalidate(),
    onError: (e) => errorToast("Could not set primary contact", e),
  });
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Buyer contacts</SectionTitle>
      <Caption>From the buyer profile — not duplicated in CRM. Nothing is sent from here.</Caption>
      {l.contacts.length === 0 ? (
        <HelperText className="mt-2">No contacts on record.</HelperText>
      ) : (
        <>
          <ul className="mt-2 flex flex-col gap-2">
            {l.contacts.map((c) => (
              <li key={c.id} className="text-sm">
                <p className="font-medium">
                  {c.name ?? c.role ?? "General contact"}
                  {l.primaryContactId === c.id && <Badge variant="success" className="ml-1">Lead contact</Badge>}
                </p>
                <p className="break-all text-xs"><span className="text-muted-foreground">{c.contactType.toLowerCase().replace(/_/g, " ")}: </span>{c.value}</p>
                <Caption>Contact confidence {c.confidence}%{c.demo ? " · sample contact — do not use" : ""}</Caption>
              </li>
            ))}
          </ul>
          {can("crm.edit") && (
            <Select
              label="Lead contact"
              containerClassName="mt-3"
              value={l.primaryContactId ?? ""}
              options={[{ value: "", label: "None selected" }, ...l.contacts.map((c) => ({ value: c.id, label: c.name ?? c.role ?? c.value }))]}
              onChange={(e) => m.mutate(e.target.value || null)}
            />
          )}
        </>
      )}
    </Card>
  );
}

function BuyerSummaryCard({ lead: l }: { lead: CrmLead }) {
  const h = HEALTH_LABEL[l.signals.health];
  return (
    <Card className="flex flex-col gap-3 p-4">
      <SectionTitle className="text-base">Buyer &amp; lead signals</SectionTitle>
      <div className="flex items-start justify-between gap-3">
        <MatchScore score={l.match.score} />
        <div className="flex flex-col items-end gap-1">
          <RiskBadge risk={l.risk} />
          <VerificationBadge status={l.buyer.verificationStatus} />
        </div>
      </div>
      <HelperText>{l.match.productContextMissing ? "No product on this lead — match covers non-product factors only." : "Buyer match for this lead’s product and market (Buyer Discovery scoring)."}</HelperText>
      {l.risk.reasons.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground" aria-label="Buyer risk factors">
          {l.risk.reasons.map((r) => <li key={r.text}>{r.text}</li>)}
        </ul>
      )}
      <div className="border-t border-border pt-3">
        <h3 className="text-sm font-medium">CRM lead health: <span className={h.variant === "danger" ? "text-danger" : h.variant === "warning" ? "text-warning" : undefined}>{h.label}</span></h3>
        <Caption>Follow-up discipline only — separate from Buyer Risk (company credibility).</Caption>
        {l.signals.healthReasons.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-xs">{l.signals.healthReasons.map((r) => <li key={r}>{r}</li>)}</ul>
        )}
        <Caption className="block">Last activity {relativeDays(l.lastActivityAt)} · {l.signals.openTaskCount} open task(s)</Caption>
      </div>
    </Card>
  );
}

function HistoryCard({ lead: l }: { lead: CrmLead }) {
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Stage history</SectionTitle>
      <ol className="mt-2 flex flex-col gap-2 text-sm">
        {l.history.map((h) => (
          <li key={h.id}>
            <p>{h.fromStage ? `${CRM_STAGE_LABELS[h.fromStage]} → ` : ""}<span className="font-medium">{CRM_STAGE_LABELS[h.toStage]}</span></p>
            {h.reason && <p className="text-xs text-muted-foreground break-words">{h.reason}</p>}
            <Caption>{new Date(h.changedAt).toLocaleString()}{h.changedBy ? ` · ${h.changedBy.name}` : ""}</Caption>
          </li>
        ))}
      </ol>
      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
        <div><dt className="text-muted-foreground">Source</dt><dd>{LEAD_SOURCE_LABELS[l.source] ?? l.source}</dd></div>
        <div><dt className="text-muted-foreground">Created</dt><dd>{fmtDay(l.createdAt)}{l.createdBy ? ` · ${l.createdBy.name}` : ""}</dd></div>
        {l.context.note && <div className="col-span-2"><dt className="text-muted-foreground">Handoff note</dt><dd className="break-words">{l.context.note}</dd></div>}
        {l.wonReason && <div className="col-span-2"><dt className="text-muted-foreground">Won reason</dt><dd className="break-words">{l.wonReason}</dd></div>}
        {l.lostDetails && <div className="col-span-2"><dt className="text-muted-foreground">Lost details</dt><dd className="break-words">{l.lostDetails}</dd></div>}
      </dl>
    </Card>
  );
}
