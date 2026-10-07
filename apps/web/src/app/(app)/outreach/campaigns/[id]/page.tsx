"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import type { CampaignDetail, RecipientView } from "@exportpro/types";
import { countryLabel, CRM_STAGE_LABELS, MESSAGE_STATUS_LABELS, RECIPIENT_STATUSES } from "@exportpro/types";
import { outreachApi } from "@/lib/api/outreach";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { RiskBadge } from "@/components/buyers/buyer-bits";
import { RequirePermission } from "@/components/layout/require-permission";
import { CampaignStatusBadge, DeliveryModeBanner, fmtDateTime, InfoNote, Metric, MessageStatusBadge, RecipientStatusBadge } from "@/components/outreach/outreach-bits";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { DataTable, type Column } from "@/components/ui/table";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function CampaignDetailPage() {
  return (
    <RequirePermission permission="outreach.view">
      <Detail />
    </RequirePermission>
  );
}

function Detail() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["outreach", "campaign", id],
    queryFn: () => outreachApi.campaign(id),
    refetchInterval: (query) => (["RUNNING", "SCHEDULED"].includes(query.state.data?.status ?? "") ? 15_000 : false),
    retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2,
  });
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) {
    const nf = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs items={[{ label: "Outreach", href: "/outreach" }, { label: "Campaign" }]} />
        <ErrorState title={nf ? "Campaign not found" : "Campaign unavailable"} message={nf ? "This campaign doesn't exist in your organization." : toFriendlyErrorMessage(q.error)} onRetry={nf ? undefined : () => q.refetch()} />
      </div>
    );
  }
  const c = q.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Outreach", href: "/outreach" }, { label: c.name }]} />
      <Header c={c} />
      <DeliveryModeBanner mode={c.deliveryMode ?? c.analytics.deliveryMode} />
      <Analytics c={c} />
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Recipients c={c} />
        </div>
        <aside className="flex min-w-0 flex-col gap-5" aria-label="Campaign details">
          <Overview c={c} />
          <Sequence c={c} />
        </aside>
      </div>
    </div>
  );
}

function Header({ c }: { c: CampaignDetail }) {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const act = useMutation({
    mutationFn: (a: "pause" | "resume" | "cancel") => outreachApi[a](c.id),
    onSuccess: (r) => {
      toast.success(`Campaign ${r.status.toLowerCase()}`);
      setConfirmCancel(false);
      qc.invalidateQueries({ queryKey: ["outreach"] });
    },
    onError: (e) => toast.error("Action failed", toFriendlyErrorMessage(e)),
  });
  const can = hasPermission(session, "outreach.pause");
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <PageTitle className="break-words">{c.name}</PageTitle>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <CampaignStatusBadge status={c.status} />
          <Badge variant="neutral">Email</Badge>
          {c.product && <Badge variant="neutral">{c.product.name}</Badge>}
          {c.countryCode && <Badge variant="neutral">{countryLabel(c.countryCode)}</Badge>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {c.status === "DRAFT" && <Button asChild><Link href={`/outreach/campaigns/new?campaignId=${c.id}&step=1`}>Continue editing</Link></Button>}
        {can && ["SCHEDULED", "RUNNING"].includes(c.status) && <Button variant="outline" onClick={() => act.mutate("pause")} loading={act.isPending}><Pause className="size-4" aria-hidden="true" />Pause</Button>}
        {can && c.status === "PAUSED" && <Button variant="outline" onClick={() => act.mutate("resume")} loading={act.isPending}><Play className="size-4" aria-hidden="true" />Resume</Button>}
        {can && ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED"].includes(c.status) && <Button variant="destructive" onClick={() => setConfirmCancel(true)}><XCircle className="size-4" aria-hidden="true" />Cancel</Button>}
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this campaign?"
        description="All unsent messages and follow-ups are cancelled. Messages already sent stay in history."
        confirmLabel="Cancel campaign"
        destructive
        loading={act.isPending}
        onConfirm={() => act.mutate("cancel")}
      />
    </header>
  );
}

function Analytics({ c }: { c: CampaignDetail }) {
  const a = c.analytics;
  const dev = a.deliveryMode === "DEVELOPMENT";
  if (!c.launchedAt)
    return <HelperText>Not launched yet — analytics appear once messages are sent.</HelperText>;
  return (
    <section aria-labelledby="analytics-h" className="flex flex-col gap-2">
      <h2 id="analytics-h" className="text-sm font-semibold">Analytics</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Recipients" value={a.recipients} />
        <Metric label="Queued" value={a.queued} />
        <Metric label={dev ? "Recorded (dev, not delivered)" : "Sent"} value={a.sent} hint={a.methodology.sent} />
        <Metric label="Delivered" value={a.delivered} rate={a.deliveryRate} hint={a.methodology.delivered} />
        <Metric label="Opened" value={a.opened} rate={a.openRate} hint={a.methodology.opened} />
        <Metric label={a.repliedManual ? `Replied (${a.repliedManual} marked manually)` : "Replied"} value={a.replied} rate={a.replyRate} hint={a.methodology.replied} />
        <Metric label="Bounced" value={a.capabilities.bounces ? a.bounced : null} hint={a.methodology.bounced} />
        <Metric label="Opted out" value={a.optedOut} />
        <Metric label="Interested" value={a.interested} hint={a.methodology.interested} />
        <Metric label="Converted" value={a.converted} hint={a.methodology.converted} />
      </dl>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer text-primary">How these numbers are calculated</summary>
        <dl className="mt-2 grid gap-1">
          {Object.entries(a.methodology).map(([k, v]) => (
            <div key={k}><dt className="inline font-medium text-foreground">{k}: </dt><dd className="inline">{v}</dd></div>
          ))}
        </dl>
        {!a.capabilities.replies && <p className="mt-2">Replies are not detected automatically with this provider — record them with “Mark replied”.</p>}
      </details>
    </section>
  );
}

function Overview({ c }: { c: CampaignDetail }) {
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Overview</SectionTitle>
      <dl className="mt-2 grid gap-2 text-sm">
        <Row label="Sender">{c.sender.fromName ? `${c.sender.fromName} <${c.sender.fromEmail ?? "—"}>` : "—"}</Row>
        <Row label="Schedule">{c.sendMode === "NOW" ? `On launch${c.launchedAt ? ` · ${fmtDateTime(c.launchedAt, c.timezone)}` : ""}` : fmtDateTime(c.scheduledAt, c.timezone)} <Caption>({c.timezone})</Caption></Row>
        <Row label="Launched by">{c.launchedBy ?? "—"}</Row>
        <Row label="Created by">{c.createdBy ?? "—"}</Row>
        <Row label="Content">{c.contentSource === "AI" ? "Generated" : c.contentSource === "AI_EDITED" ? "Generated, edited by user" : c.contentSource === "TEMPLATE" ? `Template v${c.templateVersion ?? "?"}` : "Written manually"}{c.generationProvider ? ` · ${c.generationProvider}` : ""}</Row>
        <Row label="Language">{c.language}</Row>
        {c.completedAt && <Row label="Completed">{fmtDateTime(c.completedAt, c.timezone)}</Row>}
      </dl>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function Sequence({ c }: { c: CampaignDetail }) {
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Message &amp; follow-ups</SectionTitle>
      <Caption>{c.locked ? "Locked snapshot taken at launch — later template edits don’t change it." : "Draft"}</Caption>
      <ol className="mt-2 flex flex-col gap-3">
        {c.steps.map((s) => (
          <li key={s.order} className="rounded-md border border-border p-3 text-sm">
            <p className="text-xs text-muted-foreground">{s.order === 0 ? "Initial message" : `Follow-up ${s.order} · ${s.delayDays} day(s) after the previous message, only if no reply`}</p>
            <p className="mt-1 font-medium break-words">{s.subject || "—"}</p>
            <details>
              <summary className="cursor-pointer text-xs text-primary">Show body</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs">{s.body}</pre>
            </details>
          </li>
        ))}
      </ol>
      <InfoNote>Follow-ups stop automatically on reply, unsubscribe, hard bounce, complaint, pause or cancel.</InfoNote>
    </Card>
  );
}

function Recipients({ c }: { c: CampaignDetail }) {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [status, setStatus] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [msgFor, setMsgFor] = React.useState<RecipientView | null>(null);
  const q = useQuery({
    queryKey: ["outreach", "recipients", c.id, status, page],
    queryFn: () => outreachApi.recipients(c.id, { status: status || undefined, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const act = useMutation({
    mutationFn: ({ r, a }: { r: RecipientView; a: "replied" | "interested" | "notInterested" | "cancel" }) =>
      a === "replied" ? outreachApi.markReplied(r.id) : a === "cancel" ? outreachApi.cancelRecipient(r.id) : outreachApi.markInterested(r.id, a === "interested"),
    onSuccess: (_r, v) => {
      toast.success(v.a === "replied" ? "Reply recorded — follow-ups stopped" : v.a === "cancel" ? "Recipient stopped" : "Updated");
      qc.invalidateQueries({ queryKey: ["outreach"] });
      qc.invalidateQueries({ queryKey: ["crm"] });
    },
    onError: (e) => toast.error("Action failed", toFriendlyErrorMessage(e)),
  });
  const canEdit = hasPermission(session, "outreach.edit");
  const cols: Column<RecipientView>[] = [
    {
      key: "buyer",
      header: "Buyer",
      render: (r) => (
        <div className="flex min-w-[10rem] flex-col">
          <Link className="font-medium text-primary hover:underline" href={`/buyers/${r.buyer.id}`}>{r.buyer.name}</Link>
          <span className="flex flex-wrap gap-1">{r.buyer.demo && <Caption>Sample</Caption>}<RiskBadge risk={r.buyer.risk} /></span>
        </div>
      ),
    },
    { key: "contact", header: "Contact", render: (r) => (r.contact ? <span className="break-all">{r.contact.name ? `${r.contact.name} · ` : ""}{r.contact.address}</span> : "—"), hideOnMobile: true },
    { key: "status", header: "Status", render: (r) => <div className="flex flex-col gap-1"><RecipientStatusBadge status={r.status} reason={r.excludedReason} />{r.interested && <Badge variant="success">Interested</Badge>}</div> },
    { key: "last", header: "Latest message", render: (r) => (r.lastMessage ? <MessageStatusBadge status={r.lastMessage.status} simulated={r.lastMessage.simulated} /> : "—") },
    { key: "sent", header: "Sent", render: (r) => fmtDateTime(r.sentAt), hideOnMobile: true },
    { key: "delivered", header: "Delivered", render: (r) => (c.analytics.capabilities.delivered ? fmtDateTime(r.deliveredAt) : "n/a"), hideOnMobile: true },
    { key: "opened", header: "Opened", render: (r) => (c.analytics.capabilities.opened ? fmtDateTime(r.openedAt) : "n/a"), hideOnMobile: true },
    { key: "replied", header: "Replied", render: (r) => (r.repliedAt ? <span>{fmtDateTime(r.repliedAt)}{r.replySource === "MANUAL" && <Caption className="block">marked manually</Caption>}</span> : "—"), hideOnMobile: true },
    { key: "bounce", header: "Bounce", render: (r) => (r.bouncedAt ? fmtDateTime(r.bouncedAt) : "—"), hideOnMobile: true },
    { key: "next", header: "Next follow-up", render: (r) => (r.nextFollowUpAt ? fmtDateTime(r.nextFollowUpAt, c.timezone) : "—"), hideOnMobile: true },
    { key: "lead", header: "CRM lead", render: (r) => (r.crmLead ? <Link className="text-primary hover:underline" href={`/crm/leads/${r.crmLead.id}`}>{CRM_STAGE_LABELS[r.crmLead.stage]}</Link> : "—") },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.sentAt && <Button size="sm" variant="ghost" onClick={() => setMsgFor(r)}>View</Button>}
          {canEdit && r.sentAt && r.status !== "REPLIED" && <Button size="sm" variant="outline" onClick={() => act.mutate({ r, a: "replied" })} aria-label={`Mark ${r.buyer.name} as replied`}>Mark replied</Button>}
          {canEdit && r.sentAt && <Button size="sm" variant="ghost" onClick={() => act.mutate({ r, a: r.interested ? "notInterested" : "interested" })}>{r.interested ? "Unmark interested" : "Interested"}</Button>}
          {hasPermission(session, "outreach.pause") && r.status === "ACTIVE" && <Button size="sm" variant="ghost" onClick={() => act.mutate({ r, a: "cancel" })}>Stop</Button>}
        </div>
      ),
    },
  ];
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <SectionTitle className="text-base">Recipients</SectionTitle>
        <Select aria-label="Filter recipients by status" value={status} options={[{ value: "", label: "All recipients" }, ...RECIPIENT_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ") }))]} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
      </div>
      <DataTable
        columns={cols}
        rows={q.data?.items ?? []}
        rowKey={(r) => r.id}
        isLoading={q.isLoading}
        error={q.isError ? toFriendlyErrorMessage(q.error) : undefined}
        onRetry={() => q.refetch()}
        emptyState={{ title: "No recipients", description: status ? "No recipients with this status." : undefined }}
      />
      {q.data && q.data.meta.totalPages > 1 && <Pagination meta={q.data.meta} onPageChange={setPage} />}
      {msgFor && <MessagesModal campaignId={c.id} r={msgFor} onClose={() => setMsgFor(null)} />}
    </Card>
  );
}

function MessagesModal({ campaignId, r, onClose }: { campaignId: string; r: RecipientView; onClose: () => void }) {
  const list = useQuery({ queryKey: ["outreach", "messages", "recipient", r.id], queryFn: () => outreachApi.messages({ campaignId, buyerId: r.buyer.id, pageSize: 10 }) });
  const first = list.data?.items.find((m) => m.recipientId === r.id && m.sentAt);
  const detail = useQuery({ queryKey: ["outreach", "message", first?.id], queryFn: () => outreachApi.message(first!.id), enabled: Boolean(first) });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Messages to ${r.buyer.name}`} className="max-w-2xl">
      {list.isLoading || detail.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {(list.data?.items ?? []).filter((m) => m.recipientId === r.id).map((m) => (
            <div key={m.id} className="rounded-md border border-border p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium break-words">{m.subject}</span>
                <MessageStatusBadge status={m.status} simulated={m.simulated} />
              </div>
              <Caption>{m.stepOrder ? `Follow-up ${m.stepOrder}` : "Initial"} · {MESSAGE_STATUS_LABELS[m.status]} · {fmtDateTime(m.sentAt ?? m.scheduledAt)}</Caption>
            </div>
          ))}
          {detail.data && (
            <div>
              <h3 className="text-sm font-medium">Initial message as sent</h3>
              <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-sans text-xs">{detail.data.body}</pre>
              <h3 className="mt-2 text-sm font-medium">Events</h3>
              <ul className="text-xs">
                {detail.data.events.map((e) => <li key={e.id}>{e.type.toLowerCase()} · {e.source.toLowerCase()} · {fmtDateTime(e.occurredAt)}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
