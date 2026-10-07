"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, MessageSquare, RefreshCw } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import type { DocumentValidationFindingView, DocumentValidationRunView } from "@exportpro/types";
import { validationApi } from "@/lib/api/document-validation";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { FINDING_STATUS, V_SEVERITY, VALIDATION_STATUS } from "@/lib/compliance-labels";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

export const VALIDATION_DISCLAIMER = "Automated document validation checks consistency across available records. Human review remains required. It does not verify authenticity, detect fraud or certify legal/customs compliance.";

/** Mutation helper for validation actions (invalidates validation, document and compliance queries). */
export function useValidationMutation<A, R>(fn: (a: A) => Promise<R>, success?: string, onDone?: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      for (const k of ["validation", "documents", "compliance"]) qc.invalidateQueries({ queryKey: [k] });
      if (success) toast.success(success);
      onDone?.(r);
    },
    onError: (e) => {
      const problems = e instanceof ApiRequestError ? (e.details as { problems?: string[] } | undefined)?.problems : undefined;
      toast.error(e instanceof ApiRequestError ? e.message : "Action failed", problems?.length ? problems.join(" · ") : toFriendlyErrorMessage(e));
    },
  });
}

/** One validation run: findings with provenance, resolutions, comments, sign-off / rejection. */
export function ValidationRunCard({ run, onRerun, rerunning, history, onSelect }: { run: DocumentValidationRunView; onRerun?: () => void; rerunning?: boolean; history?: { id: string; runNumber: number; status: DocumentValidationRunView["status"]; createdAt: string }[]; onSelect?: (id: string) => void }) {
  const can = (x: string) => run.availableActions.includes(x);
  const [dialog, setDialog] = React.useState<null | "signoff" | "reject">(null);
  const [note, setNote] = React.useState("");
  const [override, setOverride] = React.useState("");
  const [comment, setComment] = React.useState("");
  const close = () => setDialog(null);
  const signOff = useValidationMutation(() => validationApi.signOff(run.id, { note: note.trim() || undefined, overrideReason: override.trim() || undefined }), "Validation signed off", close);
  const reject = useValidationMutation(() => validationApi.reject(run.id, note.trim()), "Validation rejected", close);
  const addComment = useValidationMutation(() => validationApi.runComment(run.id, comment.trim()), "Comment added", () => setComment(""));
  const st = VALIDATION_STATUS[run.status];
  const openCritical = run.counts.openCritical;
  const unconfirmed = run.findings.some((f) => f.type === "UNCONFIRMED_DATA");
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <SectionTitle className="text-base">Validation run {run.runNumber}{run.isLatest ? "" : " (older run)"}</SectionTitle>
          <Caption>{new Date(run.createdAt).toLocaleString()}{run.createdBy ? ` · ${run.createdBy}` : ""} · rules {run.ruleVersion} · {run.scope === "PACKAGE" ? "order package" : "document"}</Caption>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={st.variant}>{st.label}</Badge>
          {run.counts.critical > 0 && <Badge variant="danger">{run.counts.critical} critical</Badge>}
          {run.counts.warning > 0 && <Badge variant="warning">{run.counts.warning} warning{run.counts.warning === 1 ? "" : "s"}</Badge>}
        </div>
      </div>
      <p className="text-sm">{run.summary}</p>
      <HelperText>{VALIDATION_DISCLAIMER}</HelperText>
      {run.comparisons.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Compared</p>
          <ul className="mt-1 list-disc pl-5">{run.comparisons.map((c, i) => <li key={i}>{c.source} vs {c.reference}</li>)}</ul>
        </div>
      )}
      <Caption>Documents used: {run.documents.map((d) => `${d.label} (${d.dataSource === "STRUCTURED" ? "structured" : d.dataSource === "CONFIRMED" ? "human-confirmed" : "unreviewed"})`).join(" · ")}</Caption>
      {run.signoff && <p className="rounded-md bg-success/10 p-2 text-sm">Signed off by {run.signoff.by ?? "reviewer"} on {new Date(run.signoff.at).toLocaleString()}{run.signoff.note ? ` — “${run.signoff.note}”` : ""} · unresolved warnings {run.signoff.unresolvedWarnings}, critical {run.signoff.unresolvedCritical}{run.signoff.overrideReason ? ` · manager override: ${run.signoff.overrideReason}` : ""}</p>}
      {run.rejection && <p className="rounded-md bg-danger/10 p-2 text-sm">Rejected by {run.rejection.by ?? "reviewer"}: {run.rejection.reason}</p>}
      {!run.findings.length ? (
        <p className="text-sm">No material mismatches detected by the configured validation rules.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Findings">{run.findings.map((f) => <FindingRow key={f.id} f={f} run={run} />)}</ul>
      )}
      {run.comments.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Run comments">{run.comments.map((c) => <li key={c.id}><MessageSquare className="mr-1 inline size-3.5" aria-hidden="true" />{c.body} <Caption>— {c.author ?? "user"}, {new Date(c.createdAt).toLocaleString()}</Caption></li>)}</ul>
      )}
      {can("comment") && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Textarea label="Comment on this run" rows={1} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} containerClassName="flex-1" />
          <Button size="sm" variant="outline" disabled={!comment.trim()} loading={addComment.isPending} onClick={() => addComment.mutate(undefined)}>Add comment</Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {onRerun && can("rerun") && <Button size="sm" variant="outline" onClick={onRerun} loading={rerunning}><RefreshCw className="size-4" aria-hidden="true" />Run validation again</Button>}
        {can("sign_off") && <Button size="sm" onClick={() => { setNote(""); setOverride(""); setDialog("signoff"); }}>Sign off validation</Button>}
        {can("reject") && <Button size="sm" variant="ghost" onClick={() => { setNote(""); setDialog("reject"); }}>Reject</Button>}
      </div>
      {history && history.length > 1 && (
        <div className="text-sm">
          <p className="font-medium">History</p>
          <ul className="mt-1 flex flex-col gap-1">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className={`text-left ${h.id === run.id ? "font-medium" : "text-primary hover:underline"}`} onClick={() => onSelect?.(h.id)} aria-current={h.id === run.id ? "true" : undefined}>Run {h.runNumber} · {new Date(h.createdAt).toLocaleString()}</button>
                <Badge variant={VALIDATION_STATUS[h.status].variant}>{VALIDATION_STATUS[h.status].label}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog open={dialog === "signoff"} onOpenChange={(o) => !o && close()} title={`Sign off validation run ${run.runNumber}`} description="Your sign-off confirms you reviewed the consistency findings. It is not an authenticity or legal verification." confirmLabel="Sign off" loading={signOff.isPending} confirmDisabled={unconfirmed || (openCritical > 0 && (!can("override") || override.trim().length < 3))} onConfirm={() => signOff.mutate(undefined)}>
        {unconfirmed && <p role="alert" className="mb-2 text-sm text-danger">Some documents have unconfirmed data. Review them and run validation again first.</p>}
        {openCritical > 0 && (
          <div role="alert" className="mb-2 flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-sm">
            <p className="flex items-center gap-1"><AlertTriangle className="size-4 text-danger" aria-hidden="true" />{openCritical} critical finding{openCritical === 1 ? "" : "s"} unresolved.</p>
            {can("override") ? <Textarea label="Manager override reason (audited)" required rows={2} value={override} onChange={(e) => setOverride(e.target.value)} maxLength={1000} /> : <p>Resolve them before signing off.</p>}
          </div>
        )}
        <Textarea label="Sign-off note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "reject"} onOpenChange={(o) => !o && close()} title="Reject validation" description="Documents are kept. Record why the package/document is rejected." confirmLabel="Reject" destructive loading={reject.isPending} confirmDisabled={note.trim().length < 3} onConfirm={() => reject.mutate(undefined)}>
        <Textarea label="Reason" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </ConfirmDialog>
    </Card>
  );
}

function FindingRow({ f, run }: { f: DocumentValidationFindingView; run: DocumentValidationRunView }) {
  const can = (x: string) => run.availableActions.includes(x);
  const [dialog, setDialog] = React.useState<null | "resolve" | "comment">(null);
  const [status, setStatus] = React.useState("ACCEPTED_DIFFERENCE");
  const [text, setText] = React.useState("");
  const close = () => setDialog(null);
  const resolve = useValidationMutation(() => validationApi.resolve(f.id, status, text.trim() || undefined), "Finding resolved", close);
  const comment = useValidationMutation(() => validationApi.findingComment(f.id, text.trim()), "Comment added", close);
  const sev = V_SEVERITY[f.severity];
  const docLink = (d: { id: string | null; label: string }) => (d.id ? <Link className="text-primary hover:underline" href={`/documents/${d.id}`}>{d.label}</Link> : <span>{d.label}</span>);
  return (
    <li className={`rounded-md border p-3 text-sm ${f.status === "OPEN" && f.severity === "CRITICAL" ? "border-danger/50" : "border-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words">{f.message}</p>
        <span className="flex shrink-0 gap-1"><Badge variant={sev.variant}>{sev.label}</Badge>{f.status !== "OPEN" && <Badge variant="success">{FINDING_STATUS[f.status]}</Badge>}</span>
      </div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <dt>Source</dt><dd>{docLink(f.sourceDocument)}{f.sourceField ? ` · ${f.sourceField}` : ""}</dd>
        {f.referenceDocument && <><dt>Reference</dt><dd>{docLink(f.referenceDocument)}{f.referenceField ? ` · ${f.referenceField}` : ""}</dd></>}
        {(f.expectedValue || f.actualValue) && <><dt>Expected / actual</dt><dd className="break-words">{f.expectedValue ?? "—"} / {f.actualValue ?? "—"}</dd></>}
        {f.itemReference && <><dt>Item</dt><dd>{f.itemReference}</dd></>}
        <dt>Rule</dt><dd>{f.rule}</dd>
      </dl>
      {f.resolution && <p className="mt-1 text-xs">{FINDING_STATUS[f.status]} by {f.resolution.by ?? "reviewer"}{f.resolution.note ? `: ${f.resolution.note}` : ""}{f.resolution.carriedFromRun ? ` (carried from run ${f.resolution.carriedFromRun})` : ""}</p>}
      {f.comments.map((c) => <p key={c.id} className="mt-1 text-xs"><MessageSquare className="mr-1 inline size-3" aria-hidden="true" />{c.body} — {c.author ?? "user"}</p>)}
      <div className="mt-1 flex flex-wrap gap-2">
        {f.status === "OPEN" && f.type !== "UNCONFIRMED_DATA" && can("resolve") && <Button size="sm" variant="ghost" onClick={() => { setText(""); setDialog("resolve"); }}>Resolve</Button>}
        {can("comment") && <Button size="sm" variant="ghost" onClick={() => { setText(""); setDialog("comment"); }}>Comment</Button>}
      </div>
      <ConfirmDialog open={dialog === "resolve"} onOpenChange={(o) => !o && close()} title="Resolve finding" description={f.message} confirmLabel="Resolve" loading={resolve.isPending} confirmDisabled={f.severity === "CRITICAL" && text.trim().length < 3} onConfirm={() => resolve.mutate(undefined)}>
        <div className="flex flex-col gap-3">
          <Select label="Resolution" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "ACCEPTED_DIFFERENCE", label: "Accept the difference" }, { value: "CORRECTED", label: "Corrected (re-run validation)" }, { value: "FALSE_POSITIVE", label: "False positive" }, { value: "RESOLVED", label: "Resolved otherwise" }]} />
          <Textarea label={f.severity === "CRITICAL" ? "Comment (required)" : "Comment"} required={f.severity === "CRITICAL"} rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
        </div>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "comment"} onOpenChange={(o) => !o && close()} title="Comment on finding" confirmLabel="Add comment" loading={comment.isPending} confirmDisabled={!text.trim()} onConfirm={() => comment.mutate(undefined)}>
        <Textarea label="Comment" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
      </ConfirmDialog>
    </li>
  );
}
