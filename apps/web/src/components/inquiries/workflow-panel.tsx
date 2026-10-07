"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import type { BuyerInquiryDetail, InquiryClarificationQuestion, InquiryRejectCategory, QualificationChecklist } from "@exportpro/types";
import { inquiriesApi } from "@/lib/api/inquiries";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { APPROVAL_LABELS, REJECT_CATEGORIES } from "@/lib/inquiry-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";
import { useInquiryMutation } from "./rfq-panel";

export function WorkflowPanel({ d }: { d: BuyerInquiryDetail }) {
  const can = (a: string) => d.availableActions.includes(a);
  return (
    <Card className="flex min-w-0 flex-col gap-5 p-4">
      <SectionTitle className="text-base">Internal workflow</SectionTitle>
      {d.rejection && (
        <p role="status" className="rounded-md border border-danger/40 bg-danger/5 p-2 text-sm">Rejected — {REJECT_CATEGORIES[d.rejection.category]}: {d.rejection.reason} <Caption>({d.rejection.by ?? "member"}, {new Date(d.rejection.at).toLocaleDateString()})</Caption></p>
      )}
      <Qualification d={d} enabled={can("qualify")} />
      <Clarification d={d} enabled={can("request_clarification")} />
      <Approval d={d} />
      <Handoffs d={d} />
      {can("reject") && <Reject d={d} />}
    </Card>
  );
}

function Qualification({ d, enabled }: { d: BuyerInquiryDetail; enabled: boolean }) {
  const [checks, setChecks] = React.useState<QualificationChecklist>(() =>
    Object.fromEntries(d.qualificationChecks.map((c) => [c.key, d.qualification?.checklist[c.key] ?? c.met === true])) as unknown as QualificationChecklist,
  );
  const [override, setOverride] = React.useState("");
  const [problems, setProblems] = React.useState<string[]>([]);
  const { data: session } = useSession();
  const canOverride = hasPermission(session, "inquiries.approve");
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => inquiriesApi.qualify(d.id, { checklist: checks, overrideReason: override.trim() || undefined, expectedRowVersion: d.rowVersion }),
    onSuccess: (x) => {
      qc.setQueryData(["inquiries", "detail", d.id], x);
      qc.invalidateQueries({ queryKey: ["inquiries", "list"] });
      toast.success("Inquiry qualified");
      setProblems([]);
    },
    onError: (e) => {
      const p = e instanceof ApiRequestError ? (e.details as { problems?: string[] } | undefined)?.problems : undefined;
      if (p) setProblems(p);
      else toast.error("Could not qualify", toFriendlyErrorMessage(e));
    },
  });
  return (
    <section aria-labelledby="q-h">
      <h3 id="q-h" className="text-sm font-semibold">Qualification</h3>
      {d.qualification ? (
        <p className="mt-1 text-sm">Qualified by {d.qualification.decidedBy ?? "member"} on {new Date(d.qualification.decidedAt).toLocaleString()}{d.qualification.overrideReason ? ` — override: ${d.qualification.overrideReason}` : ""}</p>
      ) : (
        <HelperText>AI never qualifies an inquiry — confirm each point yourself.</HelperText>
      )}
      <fieldset className="mt-2 flex flex-col gap-1.5" disabled={!enabled}>
        <legend className="sr-only">Qualification checklist</legend>
        {d.qualificationChecks.map((c) => (
          <div key={c.key} className="flex flex-wrap items-center gap-2">
            <Checkbox label={c.label} checked={checks[c.key]} onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })} />
            <Caption>{c.met === null ? "Your judgement" : c.met ? `✓ ${c.detail}` : `Not met — ${c.detail}`}</Caption>
          </div>
        ))}
      </fieldset>
      {problems.length > 0 && (
        <div role="alert" className="mt-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-sm">
          <p className="font-medium">Cannot qualify yet</p>
          <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          {canOverride ? (
            <Input label="Manager override reason" value={override} onChange={(e) => setOverride(e.target.value)} containerClassName="mt-2" description="Only managers can override; the reason is recorded." />
          ) : (
            <Caption>Resolve these, or ask a manager to override.</Caption>
          )}
        </div>
      )}
      {enabled && <Button size="sm" className="mt-2" onClick={() => m.mutate()} disabled={m.isPending}>Qualify inquiry</Button>}
    </section>
  );
}

function Clarification({ d, enabled }: { d: BuyerInquiryDetail; enabled: boolean }) {
  const [qs, setQs] = React.useState<(InquiryClarificationQuestion & { on: boolean })[]>(() => d.suggestedQuestions.map((q) => ({ ...q, on: true })));
  const [custom, setCustom] = React.useState("");
  const m = useInquiryMutation(d.id, () => inquiriesApi.clarify(d.id, qs.filter((q) => q.on && q.text.trim()).map(({ text, source }) => ({ text: text.trim(), source })), d.rowVersion), "Clarification requested — status: needs clarification");
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Draft copied");
    } catch {
      toast.error("Could not copy", "Select the text and copy it manually.");
    }
  };
  return (
    <section aria-labelledby="c-h">
      <h3 id="c-h" className="text-sm font-semibold">Clarification</h3>
      {d.clarification && (
        <div className="mt-1 rounded-md border border-border p-2 text-sm">
          <p>Requested {new Date(d.clarification.requestedAt).toLocaleString()}{d.clarification.requestedBy ? ` by ${d.clarification.requestedBy}` : ""}:</p>
          <ol className="list-decimal pl-5">{d.clarification.questions.map((q, n) => <li key={n}>{q.text} <Caption>({q.source === "AI_SUGGESTED" ? "AI-suggested" : q.source === "SYSTEM" ? "from missing fields" : "manual"})</Caption></li>)}</ol>
          <Textarea label="Message draft (not sent)" readOnly rows={6} value={d.clarification.draftMessage} containerClassName="mt-2" />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => copy(d.clarification!.draftMessage)}><Copy className="size-4" aria-hidden="true" />Copy draft</Button>
            <Caption>Outreach supports campaigns only, so one-off messages are not sent from here — paste this into your email.</Caption>
          </div>
        </div>
      )}
      {enabled && (
        <div className="mt-2 flex flex-col gap-2">
          <HelperText>Suggested questions are editable and are never sent automatically.</HelperText>
          {qs.map((q, n) => (
            <div key={n} className="flex items-start gap-2">
              <input type="checkbox" className="mt-2.5 size-4" aria-label={`Include question ${n + 1}`} checked={q.on} onChange={(e) => setQs(qs.map((x, i) => (i === n ? { ...x, on: e.target.checked } : x)))} />
              <Input label={`Question ${n + 1}${q.source === "AI_SUGGESTED" ? " (AI-suggested)" : q.source === "SYSTEM" ? " (missing field)" : ""}`} value={q.text} onChange={(e) => setQs(qs.map((x, i) => (i === n ? { ...x, text: e.target.value, source: x.source === "MANUAL" ? "MANUAL" : x.source } : x)))} containerClassName="flex-1" />
              <Button size="icon" variant="ghost" className="mt-6" aria-label={`Remove question ${n + 1}`} onClick={() => setQs(qs.filter((_, i) => i !== n))}><Trash2 className="size-4" aria-hidden="true" /></Button>
            </div>
          ))}
          <div className="flex items-end gap-2">
            <Input label="Add a question" value={custom} onChange={(e) => setCustom(e.target.value)} containerClassName="flex-1" />
            <Button size="sm" variant="outline" onClick={() => { if (custom.trim().length > 2) { setQs([...qs, { text: custom.trim(), source: "MANUAL", on: true }]); setCustom(""); } }}><Plus className="size-4" aria-hidden="true" />Add</Button>
          </div>
          <Button size="sm" variant="outline" className="w-fit" disabled={m.isPending || !qs.some((q) => q.on && q.text.trim())} onClick={() => m.mutate(undefined)}>Request clarification</Button>
        </div>
      )}
    </section>
  );
}

function Approval({ d }: { d: BuyerInquiryDetail }) {
  const [reason, setReason] = React.useState("");
  const submit = useInquiryMutation(d.id, () => inquiriesApi.submitApproval(d.id, reason || undefined, d.rowVersion), "Submitted for approval");
  const approve = useInquiryMutation(d.id, () => inquiriesApi.approve(d.id, reason || undefined, d.rowVersion), "Approved");
  const reject = useInquiryMutation(d.id, () => inquiriesApi.rejectApproval(d.id, reason, d.rowVersion), "Approval rejected");
  const can = (a: string) => d.availableActions.includes(a);
  const st = APPROVAL_LABELS[d.approval.status];
  const any = can("submit_approval") || can("approve");
  return (
    <section aria-labelledby="a-h">
      <h3 id="a-h" className="flex items-center gap-2 text-sm font-semibold">Internal approval <Badge variant={st.variant}>{st.label}</Badge></h3>
      {d.approval.history.length > 0 && (
        <ol className="mt-1 flex flex-col gap-0.5 text-xs">{d.approval.history.map((h, n) => <li key={n}>{h.action.toLowerCase()} by {h.actor ?? "member"} · {new Date(h.at).toLocaleString()}{h.reason ? ` — “${h.reason}”` : ""}</li>)}</ol>
      )}
      {any && (
        <div className="mt-2 flex flex-col gap-2">
          <Input label={can("approve") ? "Reason (required to reject)" : "Note for the approver (optional)"} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {can("submit_approval") && <Button size="sm" variant="outline" onClick={() => submit.mutate(undefined)} disabled={submit.isPending}>Submit for approval</Button>}
            {can("approve") && <Button size="sm" onClick={() => approve.mutate(undefined)} disabled={approve.isPending}>Approve</Button>}
            {can("reject_approval") && <Button size="sm" variant="destructive" onClick={() => (reason.trim().length < 3 ? toast.error("A reason is required to reject.") : reject.mutate(undefined))} disabled={reject.isPending}>Reject approval</Button>}
          </div>
        </div>
      )}
    </section>
  );
}

function Handoffs({ d }: { d: BuyerInquiryDetail }) {
  const qc = useQueryClient();
  const [item, setItem] = React.useState("0");
  const run = (fn: () => Promise<{ alreadyExists: boolean; inquiry: BuyerInquiryDetail }>, label: string) => ({
    mutationFn: fn,
    onSuccess: (r: { alreadyExists: boolean; inquiry: BuyerInquiryDetail }) => {
      qc.setQueryData(["inquiries", "detail", d.id], r.inquiry);
      qc.invalidateQueries({ queryKey: ["inquiries", "list"] });
      toast.success(r.alreadyExists ? `${label} already exists` : `${label} created`, r.alreadyExists ? "No duplicate was created." : undefined);
    },
    onError: (e: unknown) => toast.error(`Could not create ${label.toLowerCase()}`, toFriendlyErrorMessage(e)),
  });
  const quote = useMutation(run(() => inquiriesApi.quotation(d.id), "Quotation request"));
  const sample = useMutation(run(() => inquiriesApi.sample(d.id, Number(item)), "Sample request"));
  const can = (a: string) => d.availableActions.includes(a);
  return (
    <section aria-labelledby="h-h">
      <h3 id="h-h" className="text-sm font-semibold">Handoffs</h3>
      <HelperText>Creates a request for the future quotation / sample modules. No quotation document, pricing or sample logistics are produced here.</HelperText>
      <div className="mt-2 flex flex-col gap-2 text-sm">
        {d.quotationRequest ? (
          <p role="status"><Badge variant="success">Quotation request created</Badge> <Caption>{d.quotationRequest.status === "READY_FOR_FUTURE_MODULE" ? "Ready for the quotation module" : "Pending — some item quantities are missing"} · {new Date(d.quotationRequest.createdAt).toLocaleString()}{d.quotationRequest.requestedBy ? ` · ${d.quotationRequest.requestedBy}` : ""}</Caption></p>
        ) : can("create_quotation_request") ? (
          <Button size="sm" className="w-fit" onClick={() => quote.mutate()} disabled={quote.isPending}>Create quotation request</Button>
        ) : (
          <Caption>Quotation request: available once the inquiry is qualified{d.approval.status === "PENDING" ? " and approval is decided" : ""}.</Caption>
        )}
        {d.sampleRequest ? (
          <p role="status"><Badge variant="success">Sample request created</Badge> <Caption>{d.sampleRequest.productName ?? "Product"}{d.sampleRequest.quantity ? ` · ${d.sampleRequest.quantity}` : ""}{d.sampleRequest.deadline ? ` · by ${d.sampleRequest.deadline}` : ""}</Caption></p>
        ) : can("create_sample_request") ? (
          <div className="flex flex-wrap items-end gap-2">
            {d.confirmed && d.confirmed.items.length > 1 && <Select label="Sample for" value={item} onChange={(e) => setItem(e.target.value)} options={d.confirmed.items.map((x, n) => ({ value: String(n), label: x.productName }))} containerClassName="w-48" />}
            <Button size="sm" variant="outline" onClick={() => sample.mutate()} disabled={sample.isPending}>Create sample request</Button>
          </div>
        ) : (
          <Caption>Sample request: available after the RFQ is confirmed.</Caption>
        )}
      </div>
    </section>
  );
}

function Reject({ d }: { d: BuyerInquiryDetail }) {
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<InquiryRejectCategory>("NOT_RELEVANT");
  const [reason, setReason] = React.useState("");
  const [err, setErr] = React.useState<string | undefined>();
  const m = useInquiryMutation(d.id, () => inquiriesApi.reject(d.id, { category, reason: reason.trim(), expectedRowVersion: d.rowVersion }), "Inquiry rejected (kept in history)");
  if (!open) return <Button size="sm" variant="ghost" className="w-fit text-danger" onClick={() => setOpen(true)}>Reject inquiry…</Button>;
  return (
    <section aria-labelledby="r-h" className="rounded-md border border-danger/30 p-3">
      <h3 id="r-h" className="text-sm font-semibold">Reject inquiry</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value as InquiryRejectCategory)} options={Object.entries(REJECT_CATEGORIES).map(([k, l]) => ({ value: k, label: l }))} />
        <Input label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} error={err} />
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="destructive" disabled={m.isPending} onClick={() => (reason.trim().length < 3 ? setErr("A reason is required.") : m.mutate(undefined))}>Reject</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </section>
  );
}
