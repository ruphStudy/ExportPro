"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FilePlus2, RefreshCw, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { ComplianceChecklistView, RequirementView, TradeDocumentType } from "@exportpro/types";
import { countryLabel, REQUIREMENT_LEVELS, REQUIREMENT_TYPES, RESPONSIBLE_PARTIES, TRADE_DOCUMENT_TYPES } from "@exportpro/types";
import { complianceApi, documentsApi } from "@/lib/api/compliance";
import { APPLICABILITY, AVAILABILITY, BASIS, COVERAGE, DOC_TYPE, LEVEL, PARTY, READINESS, REQ_STATUS, SEVERITY, SOURCE } from "@/lib/compliance-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";
import { ReasonDialog } from "@/components/commercial/shared";
import { Provenance, useComplianceMutation } from "./shared";
import { UploadDocumentDialog, type UploadDefaults } from "./upload-dialog";

const GROUPS: { title: string; match: (r: RequirementView) => boolean }[] = [
  { title: "India export — registrations & licences", match: (r) => r.jurisdiction === "INDIA_EXPORT" && r.basis !== "BUYER_REQUESTED" && r.basis !== "USER_DEFINED" },
  { title: "Destination import conditions", match: (r) => r.jurisdiction === "DESTINATION_IMPORT" && r.basis !== "BUYER_REQUESTED" && r.basis !== "USER_DEFINED" },
  { title: "Order documents", match: (r) => r.jurisdiction === "TRANSACTION" && r.basis !== "BUYER_REQUESTED" && r.basis !== "USER_DEFINED" },
  { title: "Buyer requested (contractual, not regulatory)", match: (r) => r.basis === "BUYER_REQUESTED" },
  { title: "Added by your team (user defined, not official)", match: (r) => r.basis === "USER_DEFINED" },
];

/** Transaction compliance checklist (PO-anchored, or provisional from a quotation). */
export function ChecklistView({ d, onReevaluate, reevaluating }: { d: ComplianceChecklistView; onReevaluate?: () => void; reevaluating?: boolean }) {
  const can = (x: string) => d.availableActions.includes(x);
  const [upload, setUpload] = React.useState<UploadDefaults | null>(null);
  const [ready, setReady] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const applicable = d.requirements.filter((r) => r.applicability !== "NOT_APPLICABLE");
  const na = d.requirements.filter((r) => r.applicability === "NOT_APPLICABLE");
  const st = READINESS[d.readiness];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Caption className="font-medium uppercase tracking-wide">{d.provisional ? "Provisional compliance checklist" : "Order compliance checklist"}</Caption>
            <PageTitle className="break-words">{d.purchaseOrder ? `PO ${d.purchaseOrder.poNumber}` : d.quotation?.displayNumber} · {d.buyer.name}</PageTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={st.variant}>{st.label}</Badge>
              <Badge variant={COVERAGE[d.coverage.overall].variant}>Coverage: {COVERAGE[d.coverage.overall].label}</Badge>
              {d.ready && <Badge variant={d.ready.stillValid ? "success" : "warning"}>{d.ready.stillValid ? "Ready confirmed" : "Ready confirmation outdated"}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can("evaluate") && onReevaluate && <Button size="sm" variant="outline" onClick={onReevaluate} loading={reevaluating}><RefreshCw className="size-4" aria-hidden="true" />Re-evaluate</Button>}
            {can("generate_documents") && d.purchaseOrder && <Button asChild size="sm" variant="outline"><Link href={`/documents?generate=1&purchaseOrderId=${d.purchaseOrder.id}`}><FilePlus2 className="size-4" aria-hidden="true" />Prepare documents</Link></Button>}
            {can("mark_ready") && <Button size="sm" onClick={() => setReady(true)}><CheckCircle2 className="size-4" aria-hidden="true" />Mark compliance ready</Button>}
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted-foreground">Destination</dt><dd>{d.destinationCountry ? countryLabel(d.destinationCountry) : <span className="text-warning">Unknown</span>}</dd></div>
          <div><dt className="text-muted-foreground">Incoterm</dt><dd>{d.incoterm ? `${d.incoterm}${d.incotermPlace ? ` ${d.incotermPlace}` : ""}` : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Products</dt><dd>{d.products.map((p) => `${p.description}${p.hsCode ? ` (HS ${p.hsCode})` : " (no HS)"}`).join(", ") || "—"}</dd></div>
          <div><dt className="text-muted-foreground">Lineage</dt><dd className="flex flex-wrap gap-x-2">
            {d.purchaseOrder && <Link className="text-primary hover:underline" href={`/purchase-orders/${d.purchaseOrder.id}`}>PO</Link>}
            {d.proformaInvoice && <Link className="text-primary hover:underline" href={`/proforma-invoices/${d.proformaInvoice.id}`}>{d.proformaInvoice.displayNumber}</Link>}
            {d.quotation && <Link className="text-primary hover:underline" href={`/quotations/${d.quotation.id}`}>{d.quotation.displayNumber}</Link>}
            {d.inquiryId && <Link className="text-primary hover:underline" href={`/inquiries/${d.inquiryId}`}>Inquiry</Link>}
          </dd></div>
        </dl>
        {d.purchaseOrder && d.purchaseOrder.openCriticalDiscrepancies > 0 && (
          <p role="note" className="flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger/5 p-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />The PO has {d.purchaseOrder.openCriticalDiscrepancies} open critical discrepanc{d.purchaseOrder.openCriticalDiscrepancies === 1 ? "y" : "ies"}. A final commercial invoice needs a manager override until they are resolved.</p>
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-3"><Caption>Required readiness (regulatory)</Caption><p className="text-xl font-semibold">{d.requiredReadiness.percent ?? "—"}{d.requiredReadiness.percent !== null && "%"}</p><Caption>{d.requiredReadiness.satisfied} of {d.requiredReadiness.applicable} satisfied</Caption></Card>
        <Card className="p-3"><Caption>Recommended / buyer / own items</Caption><p className="text-xl font-semibold">{d.recommendedCompletion.percent ?? "—"}{d.recommendedCompletion.percent !== null && "%"}</p><Caption>{d.recommendedCompletion.satisfied} of {d.recommendedCompletion.applicable} done</Caption></Card>
        <Card className="p-3"><Caption>Coverage</Caption><p className="text-sm">India export: <strong>{d.coverage.indiaExport.toLowerCase()}</strong></p><p className="text-sm">Destination import: <strong>{d.coverage.destinationImport.toLowerCase()}</strong></p></Card>
      </div>

      {d.blockers.length > 0 && (
        <section role="alert" aria-labelledby="blk" className="rounded-lg border border-danger/40 bg-danger/5 p-4">
          <h2 id="blk" className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 text-danger" aria-hidden="true" />{d.blockers.length} blocker{d.blockers.length === 1 ? "" : "s"}</h2>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">{d.blockers.map((b) => <li key={b.requirementId}><a className="hover:underline" href={`#req-${b.requirementId}`}>{b.name}</a> — {b.reason}</li>)}</ul>
        </section>
      )}
      {d.warnings.length > 0 && (
        <section aria-labelledby="wrn" className="rounded-lg border border-warning/40 bg-warning/5 p-4">
          <h2 id="wrn" className="text-sm font-semibold">{d.warnings.length} warning{d.warnings.length === 1 ? "" : "s"}</h2>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">{d.warnings.map((w, i) => <li key={`${w.requirementId}-${i}`}><a className="hover:underline" href={`#req-${w.requirementId}`}>{w.name}</a> — {w.reason}</li>)}</ul>
        </section>
      )}
      {d.coverage.notes.length > 0 && (
        <div role="note" className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">About coverage</p>
          <ul className="mt-1 list-disc pl-5">{d.coverage.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
      {d.ready && (
        <p className="text-sm">Marked {d.ready.readiness === "READY" ? "ready" : "ready with warnings"} {new Date(d.ready.at).toLocaleString()}{d.ready.by ? ` by ${d.ready.by}` : ""}{d.ready.note ? ` — “${d.ready.note}”` : ""}. This confirms compliance/document readiness only; no shipment was created.</p>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {GROUPS.map((g) => {
            const items = applicable.filter(g.match);
            if (!items.length) return null;
            return (
              <Card key={g.title} className="p-4">
                <SectionTitle className="text-base">{g.title}</SectionTitle>
                <ul className="mt-3 flex flex-col gap-3">{items.map((r) => <RequirementRow key={r.id} r={r} d={d} onUpload={setUpload} />)}</ul>
              </Card>
            );
          })}
          {can("add_requirement") && <div><Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add requirement</Button></div>}
          {na.length > 0 && (
            <details className="rounded-lg border border-border p-3 text-sm">
              <summary className="cursor-pointer font-medium">{na.length} rule{na.length === 1 ? "" : "s"} not applicable to this order</summary>
              <ul className="mt-2 flex flex-col gap-1.5">{na.map((r) => <li key={r.id}><span className="font-medium">{r.name}</span> <Caption>— {r.explanation}</Caption></li>)}</ul>
            </details>
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Documents and timeline">
          <DocumentMatrix d={d} onUpload={setUpload} />
          <Card className="p-4">
            <SectionTitle className="text-base">Compliance timeline</SectionTitle>
            {!d.events.length ? <HelperText className="mt-1">No events yet.</HelperText> : (
              <ol className="mt-2 flex flex-col gap-2 text-sm">{d.events.map((e) => <li key={e.id}><p>{e.title}</p><Caption>{new Date(e.createdAt).toLocaleString()}{e.actor ? ` · ${e.actor}` : ""}</Caption></li>)}</ol>
            )}
          </Card>
        </aside>
      </div>
      {upload && <UploadDocumentDialog open onClose={() => setUpload(null)} defaults={upload} />}
      {ready && <MarkReadyDialog d={d} onClose={() => setReady(false)} />}
      {adding && <AddRequirementDialog checklistId={d.id} onClose={() => setAdding(false)} />}
    </div>
  );
}

function RequirementRow({ r, d, onUpload }: { r: RequirementView; d: ComplianceChecklistView; onUpload: (u: UploadDefaults) => void }) {
  const can = (x: string) => d.availableActions.includes(x);
  const [dialog, setDialog] = React.useState<null | "override" | "confirm" | "link" | "notes">(null);
  const [kind, setKind] = React.useState("WAIVED");
  const close = () => setDialog(null);
  const override = useComplianceMutation((reason: string) => complianceApi.override(r.id, kind, reason), "Override recorded", close);
  const clear = useComplianceMutation(() => complianceApi.clearOverride(r.id), "Override removed");
  const confirm = useComplianceMutation((note: string) => complianceApi.updateRequirement(r.id, { manualConfirmation: note }), "Requirement confirmed", close);
  const st = REQ_STATUS[r.status];
  const uploadable = r.documentTypes.filter((t) => t !== "COMMERCIAL_INVOICE" && t !== "PACKING_LIST" && t !== "SHIPPING_INSTRUCTION");
  const generatable = r.documentTypes.filter((t) => t === "COMMERCIAL_INVOICE" || t === "PACKING_LIST" || t === "SHIPPING_INSTRUCTION");
  return (
    <li id={`req-${r.id}`} className={`scroll-mt-20 rounded-md border p-3 ${r.open && r.severity === "BLOCKER" ? "border-danger/50" : "border-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 font-medium">{r.name}</p>
        <Badge variant={st.variant}>{st.label}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <Badge variant={LEVEL[r.level].variant}>{LEVEL[r.level].label}</Badge>
        <Badge variant={SEVERITY[r.severity].variant}>{SEVERITY[r.severity].label}</Badge>
        <Badge variant="neutral">{BASIS[r.basis]}</Badge>
        {r.applicability === "UNKNOWN" && <Badge variant="warning">{APPLICABILITY.UNKNOWN}</Badge>}
        {r.expiringSoon && <Badge variant="warning">Evidence expires soon</Badge>}
      </div>
      <p className="mt-2 text-sm">{r.explanation}</p>
      <p className="text-sm text-muted-foreground">{r.description}</p>
      <Caption className="mt-1 block">Satisfied by: {r.satisfiedBy} · Provided by: {PARTY[r.responsibleParty]}{r.productLabel ? ` · Products: ${r.productLabel}` : ""}</Caption>
      <Provenance p={r.provenance} />
      {r.evidence.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Evidence">
          {r.evidence.map((e, i) => (
            <li key={`${e.id}-${i}`}>
              {e.kind === "DOCUMENT" && e.id ? <Link className="text-primary hover:underline" href={`/documents/${e.id}`}>{e.label}</Link> : <span>{e.label}</span>}
              <Caption> · {e.status.replace(/_/g, " ").toLowerCase()}{e.expiryDate ? ` · expires ${e.expiryDate}` : ""}{e.verificationNote ? ` · ${e.verificationNote}` : ""}</Caption>
            </li>
          ))}
        </ul>
      )}
      {r.override && <p className="mt-2 text-sm text-warning">{r.override.kind.replace("_", " ").toLowerCase()} by {r.override.by ?? "a manager"} on {new Date(r.override.at).toLocaleDateString()}: {r.override.reason}</p>}
      {r.manualConfirmation && <p className="mt-2 text-sm">Confirmed by {r.manualConfirmation.by ?? "reviewer"}: {r.manualConfirmation.note}</p>}
      {r.notes && <p className="mt-1 text-sm"><span className="font-medium">Notes:</span> {r.notes}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {d.purchaseOrder && generatable.length > 0 && can("generate_documents") && r.status !== "SATISFIED" && <Button asChild size="sm" variant="outline"><Link href={`/documents?generate=1&purchaseOrderId=${d.purchaseOrder.id}&documentType=${generatable[0]}`}>Prepare {DOC_TYPE[generatable[0]].toLowerCase()}</Link></Button>}
        {uploadable.length > 0 && can("upload_documents") && !r.override && r.status !== "SATISFIED" && (
          <Button size="sm" variant="outline" onClick={() => onUpload({ allowedTypes: uploadable as TradeDocumentType[], documentType: uploadable[0], purchaseOrderId: d.purchaseOrder?.id, requirementId: r.id, requirementName: r.name })}><Upload className="size-4" aria-hidden="true" />Upload evidence</Button>
        )}
        {can("link_evidence") && r.documentTypes.length > 0 && !r.override && r.status !== "SATISFIED" && <Button size="sm" variant="ghost" onClick={() => setDialog("link")}>Link existing document</Button>}
        {can("manual_confirm") && r.satisfiedBy.startsWith("Manual") && r.status !== "SATISFIED" && <Button size="sm" variant="ghost" onClick={() => setDialog("confirm")}>Confirm manually</Button>}
        {can("update_requirement") && <Button size="sm" variant="ghost" onClick={() => setDialog("notes")}>Notes</Button>}
        {can("override") && !r.override && r.status !== "SATISFIED" && <Button size="sm" variant="ghost" onClick={() => setDialog("override")}>Override…</Button>}
        {can("override") && r.override && <Button size="sm" variant="ghost" onClick={() => clear.mutate(undefined)} loading={clear.isPending}>Remove override</Button>}
      </div>
      <ReasonDialog open={dialog === "override"} onOpenChange={(o) => !o && close()} title={`Override “${r.name}”`} description="The requirement stays on record with your reason, name and time. Use only when you have a documented basis." label="Reason" confirmLabel="Record override" destructive loading={override.isPending} onConfirm={(reason) => override.mutate(reason)}>
        <Select label="Mark as" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: "NOT_APPLICABLE", label: "Not applicable" }, { value: "WAIVED", label: "Waived" }, { value: "ACCEPTED_RISK", label: "Accepted risk" }]} containerClassName="mb-3" />
      </ReasonDialog>
      <ReasonDialog open={dialog === "confirm"} onOpenChange={(o) => !o && close()} title="Confirm requirement manually" description="Record what evidence you checked. This is your team's confirmation, not an official verification." label="Evidence note" confirmLabel="Confirm" loading={confirm.isPending} onConfirm={(n) => confirm.mutate(n)} />
      {dialog === "link" && <LinkEvidenceDialog r={r} d={d} onClose={close} />}
      {dialog === "notes" && <NotesDialog r={r} onClose={close} />}
    </li>
  );
}

function LinkEvidenceDialog({ r, d, onClose }: { r: RequirementView; d: ComplianceChecklistView; onClose: () => void }) {
  const q = useQuery({ queryKey: ["documents", "list", { link: r.id }], queryFn: () => documentsApi.list({ purchaseOrderId: d.purchaseOrder?.id, pageSize: 50 }) });
  const docs = (q.data?.items ?? []).filter((x) => r.documentTypes.includes(x.documentType));
  const [id, setId] = React.useState("");
  const link = useComplianceMutation(() => complianceApi.updateRequirement(r.id, { evidenceDocumentId: id }), "Evidence linked", onClose);
  return (
    <ConfirmDialog open onOpenChange={(o) => !o && onClose()} title="Link existing document" description={`Only ${r.documentTypes.map((t) => DOC_TYPE[t]).join(" / ")} can satisfy this requirement, and it must be approved and not expired.`} confirmLabel="Link" confirmDisabled={!id} loading={link.isPending} onConfirm={() => link.mutate(undefined)}>
      {q.isLoading ? <HelperText>Loading…</HelperText> : !docs.length ? <HelperText>No matching documents for this order yet.</HelperText> : (
        <Select label="Document" placeholder="Select" value={id} onChange={(e) => setId(e.target.value)} options={docs.map((x) => ({ value: x.id, label: `${x.title} · v${x.version} · ${x.status.toLowerCase()}` }))} />
      )}
    </ConfirmDialog>
  );
}

function NotesDialog({ r, onClose }: { r: RequirementView; onClose: () => void }) {
  const [notes, setNotes] = React.useState(r.notes ?? "");
  const [due, setDue] = React.useState(r.dueDate ?? "");
  const save = useComplianceMutation(() => complianceApi.updateRequirement(r.id, { notes: notes.trim() || null, dueDate: due || null }), "Saved", onClose);
  return (
    <ConfirmDialog open onOpenChange={(o) => !o && onClose()} title={`Notes — ${r.name}`} confirmLabel="Save" loading={save.isPending} onConfirm={() => save.mutate(undefined)}>
      <div className="flex flex-col gap-3">
        <Textarea label="Notes (internal)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        <Input label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
    </ConfirmDialog>
  );
}

function MarkReadyDialog({ d, onClose }: { d: ComplianceChecklistView; onClose: () => void }) {
  const [note, setNote] = React.useState("");
  const warn = d.readiness === "READY_WITH_WARNINGS";
  const m = useComplianceMutation(() => complianceApi.markReady(d.purchaseOrder!.id, d.rowVersion, note.trim() || undefined), "Compliance marked ready", onClose);
  return (
    <ConfirmDialog open onOpenChange={(o) => !o && onClose()} title="Mark compliance ready for logistics" description="Stores a snapshot of rule versions, statuses and document references. This does not create a shipment, file customs or book freight." confirmLabel="Mark ready" loading={m.isPending} confirmDisabled={warn && note.trim().length < 3} onConfirm={() => m.mutate(undefined)}>
      {warn && <p className="mb-2 text-sm text-warning">{d.warnings.length} warning{d.warnings.length === 1 ? "" : "s"} remain — add a note acknowledging them.</p>}
      <Textarea label={warn ? "Acknowledgement note" : "Note (optional)"} required={warn} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
    </ConfirmDialog>
  );
}

function AddRequirementDialog({ checklistId, onClose }: { checklistId: string; onClose: () => void }) {
  const [f, setF] = React.useState({ name: "", description: "", requirementType: "DOCUMENT", level: "REQUIRED", severity: "WARNING", basis: "USER_DEFINED", responsibleParty: "EXPORTER", documentType: "" });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const add = useComplianceMutation(
    () => complianceApi.addRequirement(checklistId, { name: f.name.trim(), description: f.description.trim() || undefined, requirementType: f.requirementType, level: f.level, severity: f.severity, basis: f.basis, responsibleParty: f.responsibleParty, documentTypes: f.documentType ? [f.documentType] : undefined }),
    "Requirement added",
    onClose,
  );
  return (
    <ConfirmDialog open onOpenChange={(o) => !o && onClose()} title="Add requirement" description="User-defined items are labelled as such and never presented as official rules." confirmLabel="Add" confirmDisabled={f.name.trim().length < 3} loading={add.isPending} onConfirm={() => add.mutate(undefined)} className="max-h-[90vh] overflow-y-auto">
      <div className="flex flex-col gap-3">
        <Input label="Name" required value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={160} />
        <Textarea label="Description" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={1000} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Basis" value={f.basis} onChange={(e) => set("basis", e.target.value)} options={[{ value: "USER_DEFINED", label: "User defined" }, { value: "BUYER_REQUESTED", label: "Buyer requested" }]} />
          <Select label="Type" value={f.requirementType} onChange={(e) => set("requirementType", e.target.value)} options={REQUIREMENT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ").toLowerCase() }))} />
          <Select label="Level" value={f.level} onChange={(e) => set("level", e.target.value)} options={REQUIREMENT_LEVELS.map((t) => ({ value: t, label: LEVEL[t].label }))} />
          <Select label="Severity" value={f.severity} onChange={(e) => set("severity", e.target.value)} options={[{ value: "BLOCKER", label: "Blocker" }, { value: "WARNING", label: "Warning" }, { value: "INFO", label: "Info" }]} />
          <Select label="Provided by" value={f.responsibleParty} onChange={(e) => set("responsibleParty", e.target.value)} options={RESPONSIBLE_PARTIES.map((p) => ({ value: p, label: PARTY[p] }))} />
          <Select label="Satisfied by document (optional)" placeholder="Manual confirmation" value={f.documentType} onChange={(e) => set("documentType", e.target.value)} options={TRADE_DOCUMENT_TYPES.map((t) => ({ value: t, label: DOC_TYPE[t] }))} />
        </div>
      </div>
    </ConfirmDialog>
  );
}

/** Document / who-provides / status matrix (not a claim of universal completeness). */
function DocumentMatrix({ d, onUpload }: { d: ComplianceChecklistView; onUpload: (u: UploadDefaults) => void }) {
  const router = useRouter();
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Document checklist</SectionTitle>
      <HelperText className="mt-1">Documents this checklist refers to. Official documents are provided by the listed party and uploaded here; ExportPro only prepares exporter documents.</HelperText>
      {!d.documents.length ? <HelperText className="mt-2">No documents referenced.</HelperText> : (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {d.documents.map((x) => (
            <li key={x.documentType} className="rounded-md border border-border p-2">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-medium">{x.label}</span>
                <Badge variant={AVAILABILITY[x.availability].variant}>{AVAILABILITY[x.availability].label}</Badge>
              </div>
              <Caption className="block">{LEVEL[x.level].label} · {BASIS[x.basis]} · {PARTY[x.responsibleParty]}{x.generatable ? " · ExportPro can prepare it" : " · upload/reference only"}</Caption>
              {x.document && <Caption className="block"><Link className="text-primary hover:underline" href={`/documents/${x.document.id}`}>{x.document.title} v{x.document.version}</Link> · {SOURCE[x.document.source].label}</Caption>}
              {!x.document && d.purchaseOrder && (x.generatable ? d.availableActions.includes("generate_documents") : d.availableActions.includes("upload_documents")) && (
                <Button size="sm" variant="ghost" className="mt-1" onClick={() => (x.generatable ? router.push(`/documents?generate=1&purchaseOrderId=${d.purchaseOrder!.id}&documentType=${x.documentType}`) : onUpload({ documentType: x.documentType, allowedTypes: [x.documentType], purchaseOrderId: d.purchaseOrder!.id }))}>
                  {x.generatable ? "Prepare" : "Upload"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
