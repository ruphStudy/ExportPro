"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, Download, Mail, MailOpen, Paperclip, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import type { BuyerInquiryDetail } from "@exportpro/types";
import { countryLabel } from "@exportpro/types";
import { inquiriesApi } from "@/lib/api/inquiries";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { INQUIRY_STATUS, PRIORITY, SOURCE_LABELS } from "@/lib/inquiry-labels";
import { toast } from "@/lib/toast";
import { RfqPanel, useInquiryMutation } from "@/components/inquiries/rfq-panel";
import { WorkflowPanel } from "@/components/inquiries/workflow-panel";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function InquiryDetailPage() {
  return (
    <RequirePermission permission="inquiries.view">
      <InquiryDetail />
    </RequirePermission>
  );
}

function InquiryDetail() {
  const { inquiryId } = useParams<{ inquiryId: string }>();
  const q = useQuery({ queryKey: ["inquiries", "detail", inquiryId], queryFn: () => inquiriesApi.get(inquiryId), retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2 });
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState title="Inquiry not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Inquiries & RFQs", href: "/inquiries" }, { label: d.reference }]} />
      <Header d={d} />
      {d.possibleDuplicates.length > 0 && (
        <p role="note" className="flex flex-wrap items-center gap-1 rounded-md border border-warning/40 bg-warning/5 p-2 text-sm">
          <AlertTriangle className="size-4 text-warning" aria-hidden="true" />Possible duplicate of {d.possibleDuplicates.map((x, n) => <React.Fragment key={x.id}>{n > 0 && ", "}<Link className="text-primary hover:underline" href={`/inquiries/${x.id}`}>{x.reference}</Link></React.Fragment>)} ({d.possibleDuplicates[0].reason.toLowerCase()}). Not merged — review manually.
        </p>
      )}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Original d={d} />
          <Attachments d={d} />
          <CrmCard d={d} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <RfqPanel key={`${d.id}-${d.rowVersion}`} d={d} />
          <WorkflowPanel key={`wf-${d.rowVersion}`} d={d} />
          <Timeline d={d} />
        </div>
      </div>
    </div>
  );
}

function Header({ d }: { d: BuyerInquiryDetail }) {
  const members = useQuery({ queryKey: ["inquiries", "assignees"], queryFn: inquiriesApi.assignees, staleTime: 60_000 });
  const can = (a: string) => d.availableActions.includes(a);
  const prio = useInquiryMutation(d.id, (p: string) => inquiriesApi.update(d.id, { priority: p, expectedRowVersion: d.rowVersion }), "Priority updated");
  const assign = useInquiryMutation(d.id, (u: string | null) => inquiriesApi.assign(d.id, u, d.rowVersion), "Owner updated");
  const read = useInquiryMutation(d.id, (r: boolean) => inquiriesApi.setRead(d.id, r));
  const archive = useInquiryMutation(d.id, () => (d.status === "ARCHIVED" ? inquiriesApi.restore(d.id, d.rowVersion) : inquiriesApi.archive(d.id, d.rowVersion)), d.status === "ARCHIVED" ? "Inquiry restored" : "Inquiry archived");
  const st = INQUIRY_STATUS[d.status];
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Caption className="font-medium uppercase tracking-wide">{d.reference} · {SOURCE_LABELS[d.source]}</Caption>
          <PageTitle className="break-words">{d.subject}</PageTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={st.variant}>{st.label}</Badge>
            {d.buyer.id ? <Link className="text-primary hover:underline" href={`/buyers/${d.buyer.id}`}>{d.buyer.name}</Link> : <span>{d.buyer.name}</span>}
            {d.buyer.demo && <Badge variant="warning">Sample buyer</Badge>}
            {d.buyer.countryCode && <span className="text-muted-foreground">{countryLabel(d.buyer.countryCode)}</span>}
            {d.buyerRisk && <Badge variant={d.buyerRisk.level === "LOW" ? "success" : d.buyerRisk.level === "MODERATE" ? "info" : "warning"}>Buyer risk: {d.buyerRisk.level.toLowerCase().replace("_", " ")} ({d.buyerRisk.score}/100)</Badge>}
            {d.buyerMatch && <Badge variant="neutral">Buyer match for {d.buyerMatch.productName}: {d.buyerMatch.score}/100</Badge>}
            <span className="text-muted-foreground">Received {new Date(d.receivedAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => read.mutate(d.unread)} aria-pressed={!d.unread}>{d.unread ? <MailOpen className="size-4" aria-hidden="true" /> : <Mail className="size-4" aria-hidden="true" />}{d.unread ? "Mark read" : "Mark unread"}</Button>
          {(can("archive") || can("restore")) && <Button variant="ghost" size="sm" onClick={() => archive.mutate(undefined)}>{d.status === "ARCHIVED" ? <RotateCcw className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}{d.status === "ARCHIVED" ? "Restore" : "Archive"}</Button>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Priority" value={d.priority} disabled={!can("edit")} onChange={(e) => prio.mutate(e.target.value)} options={Object.entries(PRIORITY).map(([k, x]) => ({ value: k, label: x.label }))} description={d.suggestedPriority && d.suggestedPriority !== d.priority ? `Suggested: ${PRIORITY[d.suggestedPriority].label} — ${d.priorityReasons.join(" ")}` : d.suggestedPriority ? "Matches the suggestion." : undefined} />
        <Select label="Owner" placeholder="Unassigned" value={d.owner?.id ?? ""} disabled={!can("assign")} onChange={(e) => assign.mutate(e.target.value || null)} options={(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))} />
        <div className="text-sm">
          <p className="text-xs text-muted-foreground">Source</p>
          <p>{SOURCE_LABELS[d.source]}{d.createdBy ? ` · by ${d.createdBy}` : ""}</p>
          {d.sourceMessage && (d.sourceMessage.available ? <Caption>Reply to outreach “{d.sourceMessage.subject}”{d.sourceMessage.campaignId ? <> · <Link className="text-primary hover:underline" href={`/outreach/campaigns/${d.sourceMessage.campaignId}`}>campaign</Link></> : null}</Caption> : <Caption>Source message is no longer available.</Caption>)}
        </div>
      </div>
    </header>
  );
}

function Original({ d }: { d: BuyerInquiryDetail }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="text-base">Original inquiry</SectionTitle>
        <Badge variant="neutral">Buyer-provided</Badge>
      </div>
      {d.buyerContact && <Caption className="block">From {[d.buyerContact.name, d.buyerContact.email].filter(Boolean).join(" · ")}</Caption>}
      {d.bodyWasHtml && <Caption className="block">Received as HTML — shown as plain text; scripts and styles were removed.</Caption>}
      {/* Rendered as text (React escapes it); inbound HTML is never rendered. */}
      <div className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm">{d.body}</div>
    </Card>
  );
}

function Attachments({ d }: { d: BuyerInquiryDetail }) {
  const [progress, setProgress] = React.useState<number | null>(null);
  const can = d.availableActions.includes("add_attachment");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const upload = useInquiryMutation(d.id, (f: File) => inquiriesApi.addAttachment(d.id, f, setProgress), "Attachment uploaded");
  const del = useInquiryMutation(d.id, (aid: string) => inquiriesApi.deleteAttachment(d.id, aid), "Attachment removed");
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="text-base">Attachments ({d.attachments.length})</SectionTitle>
        {can && (
          <>
            <input ref={inputRef} type="file" className="sr-only" aria-label="Upload attachment" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx,.xlsx,.xls,.eml" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={upload.isPending}><Paperclip className="size-4" aria-hidden="true" />Add file</Button>
          </>
        )}
      </div>
      {progress !== null && upload.isPending && <Progress value={progress} label={`Uploading ${progress}%`} className="mt-2" />}
      {d.attachments.length === 0 ? (
        <HelperText className="mt-1">No attachments. Files are stored privately and only downloadable by your organization.</HelperText>
      ) : (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {d.attachments.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{x.filename}</p>
                <Caption>{(x.sizeBytes / 1024).toFixed(0)} KB · {x.textExtraction === "AVAILABLE" ? "text read for extraction" : "Text extraction not available"}{x.uploadedBy ? ` · ${x.uploadedBy}` : ""}</Caption>
              </div>
              <div className="flex gap-1">
                <Button asChild size="icon" variant="ghost"><a href={inquiriesApi.downloadHref(d.id, x.id)} aria-label={`Download ${x.filename}`}><Download className="size-4" aria-hidden="true" /></a></Button>
                {can && <Button size="icon" variant="ghost" aria-label={`Remove ${x.filename}`} onClick={() => del.mutate(x.id)}><Trash2 className="size-4" aria-hidden="true" /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CrmCard({ d }: { d: BuyerInquiryDetail }) {
  const link = useInquiryMutation(d.id, (leadId: string) => inquiriesApi.update(d.id, { crmLeadId: leadId, expectedRowVersion: d.rowVersion }), "Linked to CRM lead");
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">CRM context</SectionTitle>
      {d.crm ? (
        <div className="mt-2 flex flex-col gap-1 text-sm">
          <p>Stage: <Badge variant="neutral">{d.crm.stage.toLowerCase()}</Badge> · Owner: {d.crm.owner ?? "unassigned"}</p>
          {d.crm.stageSuggestion && <p className="text-muted-foreground">Suggested stage: <strong>{d.crm.stageSuggestion.stage.toLowerCase()}</strong> — {d.crm.stageSuggestion.reason} The stage is never changed automatically; confirm it in CRM.</p>}
          <Button asChild size="sm" variant="outline" className="w-fit"><Link href={`/crm/leads/${d.crm.leadId}`}>View CRM lead</Link></Button>
        </div>
      ) : d.crmCandidates.length ? (
        <div className="mt-2 flex flex-col gap-2 text-sm">
          <p>This buyer has CRM lead(s). Link one (no new lead is created):</p>
          {d.crmCandidates.map((c) => (
            <div key={c.leadId} className="flex flex-wrap items-center gap-2">
              <span>{c.productName ?? "Lead"} · {c.stage.toLowerCase()}</span>
              {d.availableActions.includes("edit") && <Button size="sm" variant="outline" onClick={() => link.mutate(c.leadId)}>Link</Button>}
            </div>
          ))}
        </div>
      ) : (
        <HelperText className="mt-1">Not linked to a CRM lead.{d.buyer.id ? " Add the buyer to CRM from the buyer profile to track the relationship." : ""}</HelperText>
      )}
    </Card>
  );
}

function Timeline({ d }: { d: BuyerInquiryDetail }) {
  const [text, setText] = React.useState("");
  const note = useMutation({
    mutationFn: () => inquiriesApi.note(d.id, text),
    onError: (e) => toast.error("Could not add note", toFriendlyErrorMessage(e)),
  });
  const add = useInquiryMutation(d.id, () => note.mutateAsync(), "Note added");
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Inquiry timeline</SectionTitle>
      {d.availableActions.includes("add_note") && (
        <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(undefined, { onSuccess: () => setText("") }); }}>
          <Textarea label="Internal note" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
          <Button type="submit" size="sm" className="w-fit" disabled={!text.trim() || add.isPending}>Add note</Button>
        </form>
      )}
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {d.activities.map((a) => (
          <li key={a.id} className="border-l-2 border-border pl-3">
            <p>{a.title}</p>
            {a.type === "NOTE" && typeof a.metadata?.text === "string" && <p className="whitespace-pre-wrap text-muted-foreground">{a.metadata.text}</p>}
            <Caption>{new Date(a.createdAt).toLocaleString()}{a.actor ? ` · ${a.actor}` : ""}</Caption>
          </li>
        ))}
      </ol>
    </Card>
  );
}
