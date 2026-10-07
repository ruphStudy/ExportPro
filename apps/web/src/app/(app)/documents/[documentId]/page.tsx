"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Lock } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import type { TradeDocumentDetail } from "@exportpro/types";
import { countryLabel } from "@exportpro/types";
import { documentsApi } from "@/lib/api/compliance";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { DOC_STATUS, DOC_TYPE, EXPIRY, PARTY, REQ_STATUS, SOURCE } from "@/lib/compliance-labels";
import { ReasonDialog } from "@/components/commercial/shared";
import { CommercialInvoiceEditor, DocumentPreview, PackingListEditor, ShippingInstructionEditor } from "@/components/compliance/document-editors";
import { useComplianceMutation } from "@/components/compliance/shared";
import { ExtractionValidationSection } from "@/components/document-validation/extraction-panel";
import { UploadDocumentDialog } from "@/components/compliance/upload-dialog";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/modal";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function DocumentDetailPage() {
  return (
    <RequirePermission permission="documents.view">
      <DocumentView />
    </RequirePermission>
  );
}

function DocumentView() {
  const { documentId } = useParams<{ documentId: string }>();
  const q = useQuery({ queryKey: ["documents", "detail", documentId], queryFn: () => documentsApi.get(documentId), retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2 });
  const [tab, setTab] = React.useState<"edit" | "preview">("edit");
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState title="Document not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  const editable = d.availableActions.includes("edit");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Documents", href: "/documents" }, { label: d.title }]} />
      <Header d={d} />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {d.generated && editable && (
            <div role="tablist" aria-label="Document view" className="flex gap-1">
              {(["edit", "preview"] as const).map((t) => <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "secondary" : "ghost"} onClick={() => setTab(t)}>{t === "edit" ? "Edit" : "Preview"}</Button>)}
            </div>
          )}
          {d.generated && editable && tab === "edit" ? (
            d.documentType === "COMMERCIAL_INVOICE" ? <CommercialInvoiceEditor key={d.rowVersion} d={d} /> : d.documentType === "PACKING_LIST" ? <PackingListEditor key={d.rowVersion} d={d} /> : <ShippingInstructionEditor key={d.rowVersion} d={d} />
          ) : d.generated ? (
            <DocumentPreview d={d} />
          ) : (
            <ExternalMetadata key={d.rowVersion} d={d} />
          )}
          <ExtractionValidationSection key={`xv-${d.id}-${d.version}`} doc={d} />
          {d.differences.length > 0 && (
            <Card className="p-4">
              <SectionTitle className="text-base">Changes from previous version</SectionTitle>
              <ul className="mt-2 list-disc pl-5 text-sm">{d.differences.map((x) => <li key={x}>{x}</li>)}</ul>
            </Card>
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Document details">
          <Meta d={d} />
          <Card className="p-4 text-sm">
            <SectionTitle className="text-base">Versions</SectionTitle>
            <ul className="mt-2 flex flex-col gap-1">{d.versions.map((v) => <li key={v.id} className="flex items-center justify-between gap-2">{v.id === d.id ? <span>v{v.version} (this)</span> : <Link className="text-primary hover:underline" href={`/documents/${v.id}`}>v{v.version}</Link>}<Badge variant={DOC_STATUS[v.status].variant}>{DOC_STATUS[v.status].label}</Badge></li>)}</ul>
          </Card>
          {d.requirements.length > 0 && (
            <Card className="p-4 text-sm">
              <SectionTitle className="text-base">Compliance requirements</SectionTitle>
              <ul className="mt-2 flex flex-col gap-1">{d.requirements.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span>{r.name}</span><Badge variant={REQ_STATUS[r.status].variant}>{REQ_STATUS[r.status].label}</Badge></li>)}</ul>
              {d.purchaseOrder && <Link className="mt-2 block text-primary hover:underline" href={`/compliance/orders/${d.purchaseOrder.id}`}>Open order checklist</Link>}
            </Card>
          )}
          <Card className="p-4 text-sm">
            <SectionTitle className="text-base">Activity</SectionTitle>
            {!d.events.length ? <HelperText className="mt-1">No activity.</HelperText> : <ol className="mt-2 flex flex-col gap-2">{d.events.map((e) => <li key={e.id}><p>{e.title}</p><Caption>{new Date(e.createdAt).toLocaleString()}{e.actor ? ` · ${e.actor}` : ""}</Caption></li>)}</ol>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Header({ d }: { d: TradeDocumentDetail }) {
  const router = useRouter();
  const can = (a: string) => d.availableActions.includes(a);
  const [dialog, setDialog] = React.useState<null | "approve" | "reject" | "revise" | "archive" | "replace">(null);
  const [overrideReason, setOverrideReason] = React.useState("");
  const close = () => setDialog(null);
  const review = useComplianceMutation(() => documentsApi.review(d.id, d.rowVersion), "Sent for review");
  const approve = useComplianceMutation(() => documentsApi.approve(d.id, d.rowVersion, overrideReason.trim() || undefined), "Approved — this version is now locked", close);
  const reject = useComplianceMutation((r: string) => documentsApi.reject(d.id, d.rowVersion, r), "Rejected", close);
  const revise = useComplianceMutation((r: string) => documentsApi.revise(d.id, r), "New version created", (n) => router.push(`/documents/${n.id}`));
  const archive = useComplianceMutation((r: string) => documentsApi.archive(d.id, d.rowVersion, r), "Archived", close);
  const needsOverride = d.validationProblems.some((p) => /override required/.test(p));
  const hardProblems = d.validationProblems.filter((p) => !/override required/.test(p));
  const st = DOC_STATUS[d.status];
  const src = SOURCE[d.source];
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Caption className="font-medium uppercase tracking-wide">{DOC_TYPE[d.documentType]}{d.version > 1 ? ` · version ${d.version}` : ""}</Caption>
          <PageTitle className="break-words">{d.title}</PageTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={st.variant}>{st.label}</Badge>
            <Badge variant={src.variant}>{src.label}</Badge>
            {d.expiry && <Badge variant={EXPIRY[d.expiry].variant}>{EXPIRY[d.expiry].label}</Badge>}
            {["APPROVED", "SUPERSEDED", "EXPIRED"].includes(d.status) && <Caption className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden="true" />This version is immutable.</Caption>}
          </div>
          {d.documentType === "COMMERCIAL_INVOICE" && <HelperText className="mt-1">Exporter-prepared commercial invoice — not a GST tax invoice.</HelperText>}
          {d.documentType === "SHIPPING_INSTRUCTION" && <HelperText className="mt-1">Instruction to your forwarder/carrier — not a bill of lading or airway bill.</HelperText>}
          {!d.generated && <HelperText className="mt-1">External document recorded by your team. Approval means it was reviewed as evidence — ExportPro does not verify authenticity.</HelperText>}
          {d.revisionReason && <HelperText className="mt-1">Revision reason: {d.revisionReason}</HelperText>}
          {d.overrideReason && <p className="mt-1 text-sm text-warning">Manager override: {d.overrideReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {can("pdf") && <Button asChild size="sm" variant="outline"><a href={documentsApi.pdfHref(d.id)} download><Download className="size-4" aria-hidden="true" />{["APPROVED", "SUPERSEDED", "EXPIRED", "ARCHIVED"].includes(d.status) ? "PDF" : "Draft PDF"}</a></Button>}
          {can("download") && <Button asChild size="sm" variant="outline"><a href={documentsApi.downloadHref(d.id)} download><Download className="size-4" aria-hidden="true" />Download file</a></Button>}
          {can("submit_review") && <Button size="sm" variant="outline" onClick={() => review.mutate(undefined)} loading={review.isPending} disabled={hardProblems.length > 0}>Send for review</Button>}
          {can("approve") && <Button size="sm" onClick={() => setDialog("approve")}>Approve</Button>}
          {can("reject") && <Button size="sm" variant="outline" onClick={() => setDialog("reject")}>Reject</Button>}
          {can("revise") && <Button size="sm" variant="outline" onClick={() => setDialog("revise")}>Create new version</Button>}
          {can("replace") && <Button size="sm" variant="outline" onClick={() => setDialog("replace")}>Upload replacement</Button>}
          {can("archive") && <Button size="sm" variant="ghost" onClick={() => setDialog("archive")}>Archive</Button>}
        </div>
      </div>
      {d.validationProblems.length > 0 && (
        <div role="note" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <p className="flex items-center gap-1 font-medium"><AlertTriangle className="size-4 text-warning" aria-hidden="true" />Before approval</p>
          <ul className="mt-1 list-disc pl-5">{d.validationProblems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {d.review.rejectionReason && d.status === "REJECTED" && <p className="text-sm text-danger">Rejected: {d.review.rejectionReason}</p>}
      <ConfirmDialog open={dialog === "approve"} onOpenChange={(o) => !o && close()} title={`Approve ${d.title}?`} description={d.generated ? "Exporter, buyer, items, totals and template are frozen into this version. Later changes need a new version." : "Records that your team reviewed this document as evidence. It does not certify authenticity."} confirmLabel={needsOverride ? "Approve with override" : "Approve"} loading={approve.isPending} confirmDisabled={hardProblems.length > 0 || (needsOverride && overrideReason.trim().length < 3)} onConfirm={() => approve.mutate(undefined)}>
        {hardProblems.length > 0 && <ul className="mb-2 list-disc pl-5 text-sm text-danger">{hardProblems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {needsOverride && <Textarea label="Manager override reason" required rows={2} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} maxLength={1000} />}
      </ConfirmDialog>
      <ReasonDialog open={dialog === "reject"} onOpenChange={(o) => !o && close()} title="Reject document" confirmLabel="Reject" destructive loading={reject.isPending} onConfirm={(r) => reject.mutate(r)} />
      <ReasonDialog open={dialog === "revise"} onOpenChange={(o) => !o && close()} title="Create a new version" description="The approved version and its PDF stay unchanged and downloadable. The new version becomes current once approved." label="Reason for change" confirmLabel="Create version" loading={revise.isPending} onConfirm={(r) => revise.mutate(r)} />
      <ReasonDialog open={dialog === "archive"} onOpenChange={(o) => !o && close()} title="Archive document" description="Archived documents are kept (not deleted) and no longer count as evidence." confirmLabel="Archive" destructive loading={archive.isPending} onConfirm={(r) => archive.mutate(r)} />
      {dialog === "replace" && <UploadDocumentDialog open onClose={close} defaults={{ documentType: d.documentType, allowedTypes: [d.documentType], purchaseOrderId: d.purchaseOrder?.id, replacesDocumentId: d.id }} />}
    </header>
  );
}

function Meta({ d }: { d: TradeDocumentDetail }) {
  const row = (k: string, v: React.ReactNode) => (v ? <><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></> : null);
  return (
    <Card className="p-4 text-sm">
      <SectionTitle className="text-base">Details & lineage</SectionTitle>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {row("Number", d.documentNumber)}
        {row("Provided by", PARTY[d.responsibleParty])}
        {row("Issuer", d.issuer)}
        {row("Issue date", d.issueDate)}
        {row("Expiry", d.expiryDate)}
        {row("Country", d.countryCode && countryLabel(d.countryCode))}
        {row("Buyer", d.buyer?.name)}
        {row("Buyer PO", d.purchaseOrder && <Link className="text-primary hover:underline" href={`/purchase-orders/${d.purchaseOrder.id}`}>{d.purchaseOrder.poNumber}</Link>)}
        {row("Proforma", d.proformaInvoice && <Link className="text-primary hover:underline" href={`/proforma-invoices/${d.proformaInvoice.id}`}>{d.proformaInvoice.displayNumber}</Link>)}
        {row("Quotation", d.quotation && <Link className="text-primary hover:underline" href={`/quotations/${d.quotation.id}`}>{d.quotation.displayNumber}</Link>)}
        {row("File", d.file && `${d.file.filename} · ${Math.max(1, Math.round(d.file.sizeBytes / 1024))} KB`)}
        {row("Checksum", d.file && <code className="break-all text-xs">{d.file.checksum.slice(0, 16)}…</code>)}
        {row("Reviewed", d.review.reviewedAt && `${new Date(d.review.reviewedAt).toLocaleDateString()}${d.review.reviewedBy ? ` · ${d.review.reviewedBy}` : ""}`)}
        {row("Approved", d.review.approvedAt && `${new Date(d.review.approvedAt).toLocaleDateString()}${d.review.approvedBy ? ` · ${d.review.approvedBy}` : ""}`)}
        {row("Created by", d.createdBy)}
      </dl>
      {d.internalNotes && <p className="mt-2 rounded bg-muted/50 p-2"><span className="font-medium">Internal notes (never printed):</span> {d.internalNotes}</p>}
    </Card>
  );
}

/** Metadata editor for uploaded/referenced documents. */
function ExternalMetadata({ d }: { d: TradeDocumentDetail }) {
  const editable = d.availableActions.includes("edit");
  const [f, setF] = React.useState({ documentNumber: d.documentNumber ?? "", issuer: d.issuer ?? "", issueDate: d.issueDate ?? "", expiryDate: d.expiryDate ?? "", notes: d.notes ?? "", internalNotes: d.internalNotes ?? "" });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = useComplianceMutation(() => documentsApi.update(d.id, { expectedRowVersion: d.rowVersion, documentNumber: f.documentNumber || null, issuer: f.issuer || null, issueDate: f.issueDate || null, expiryDate: f.expiryDate || null, notes: f.notes || null, internalNotes: f.internalNotes || null }), "Saved");
  return (
    <Card className="flex flex-col gap-3 p-4">
      <SectionTitle className="text-base">Document metadata</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Document number" value={f.documentNumber} onChange={(e) => set("documentNumber", e.target.value)} disabled={!editable} maxLength={80} />
        <Input label="Issuer" value={f.issuer} onChange={(e) => set("issuer", e.target.value)} disabled={!editable} maxLength={160} />
        <Input label="Issue date" type="date" value={f.issueDate} onChange={(e) => set("issueDate", e.target.value)} disabled={!editable} />
        <Input label="Expiry date" type="date" value={f.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} disabled={!editable} />
      </div>
      <Textarea label="Notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} disabled={!editable} maxLength={2000} />
      {editable && <Textarea label="Internal notes" rows={2} value={f.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} maxLength={3000} />}
      {editable && <div className="flex justify-end"><Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save</Button></div>}
      {!editable && <HelperText>Locked ({DOC_STATUS[d.status].label.toLowerCase()}). Upload a replacement to create a new version.</HelperText>}
    </Card>
  );
}
