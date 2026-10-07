"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, ScanText, Trash2 } from "lucide-react";
import * as React from "react";
import type { DocumentExtractionOverview, DocumentExtractionView, ExtractionResult, TradeDocumentDetail } from "@exportpro/types";
import { EXTRACTION_HEADER_FIELDS, TRADE_DOCUMENT_TYPES } from "@exportpro/types";
import { extractionApi, validationApi } from "@/lib/api/document-validation";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { CONFIDENCE, DOC_TYPE, EXTRACTION_STATUS, FIELD_LABEL, PROVENANCE } from "@/lib/compliance-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";
import { useValidationMutation, ValidationRunCard } from "./validation-run";

const DATE_FIELDS = new Set(["documentDate", "issueDate", "expiryDate", "etd", "eta"]);
const ITEM_COLUMNS = ["description", "hsCode", "buyerSku", "quantity", "unit", "unitPrice", "total", "packageCount", "netWeightKg", "grossWeightKg"] as const;
const label = (k: string) => FIELD_LABEL[k] ?? k;

/** "Extraction & Validation" for a document: original vs extracted, human review, validation runs. */
export function ExtractionValidationSection({ doc }: { doc: TradeDocumentDetail }) {
  const ov = useQuery({ queryKey: ["validation", "extraction", doc.id], queryFn: () => extractionApi.overview(doc.id), retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2 });
  const runs = useQuery({ queryKey: ["validation", "runs", doc.id], queryFn: () => validationApi.documentRuns(doc.id) });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<null | "review" | "manual">(null);
  const extract = useValidationMutation((force: boolean) => extractionApi.extract(doc.id, force), "Extraction finished — review the values");
  const validate = useValidationMutation(() => validationApi.validateDocument(doc.id), "Validation run completed");
  if (ov.isLoading) return <Skeleton className="h-40 w-full" />;
  if (ov.isError || !ov.data) return <ErrorState title="Extraction & validation unavailable" message={toFriendlyErrorMessage(ov.error)} onRetry={() => ov.refetch()} />;
  const o = ov.data;
  const can = (x: string) => o.availableActions.includes(x);
  const ex = o.extractions.find((x) => x.id === selected) ?? o.extractions[0] ?? null;
  const run = runs.data?.[0] ?? null;
  return (
    <section aria-labelledby="xv" className="flex min-w-0 flex-col gap-4">
      <h2 id="xv" className="text-lg font-semibold">Extraction &amp; validation</h2>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <Card className="min-w-0 p-4 text-sm">
          <SectionTitle className="text-base">Original document</SectionTitle>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Selected type</dt><dd>{DOC_TYPE[doc.documentType]}</dd>
            <dt className="text-muted-foreground">Version</dt><dd>v{doc.version}</dd>
            <dt className="text-muted-foreground">Source</dt><dd>{doc.source.replace(/_/g, " ").toLowerCase()}</dd>
            {doc.file && <><dt className="text-muted-foreground">File</dt><dd className="min-w-0 break-all">{doc.file.filename} ({doc.file.mimeType})</dd><dt className="text-muted-foreground">Checksum</dt><dd><code className="text-xs">{doc.file.checksum.slice(0, 16)}…</code></dd></>}
            <dt className="text-muted-foreground">Uploaded</dt><dd>{new Date(doc.updatedAt).toLocaleDateString()}</dd>
          </dl>
          <Caption className="mt-2 block">The original file is never changed by extraction or review.</Caption>
        </Card>
        <Card className="flex min-w-0 flex-col gap-3 p-4">
          {o.structured ? (
            <>
              <div className="flex flex-wrap items-center gap-2"><SectionTitle className="text-base">Structured data</SectionTitle><Badge variant="info">Authoritative — prepared in ExportPro</Badge></div>
              <HelperText>This document was generated from stored structured data, so it is not sent to AI extraction.</HelperText>
              {o.structuredData && <ValueTable values={o.structuredData.fields} items={o.structuredData.items as unknown as Record<string, string | null>[]} />}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <SectionTitle className="text-base">Extracted data</SectionTitle>
                  <Caption>Advisory until a reviewer confirms it. Provider: {o.providerName}.</Caption>
                </div>
                <div className="flex flex-wrap gap-2">
                  {can("extract") && <Button size="sm" variant="outline" loading={extract.isPending} onClick={() => extract.mutate(o.extractions.length > 0)}><ScanText className="size-4" aria-hidden="true" />{o.extractions.length ? "Re-extract (new version)" : "Extract data"}</Button>}
                  {can("review") && ex?.result && ex.status !== "FAILED" && ex.documentVersion === o.documentVersion && <Button size="sm" onClick={() => setMode("review")}>Review &amp; confirm</Button>}
                  {can("manual") && <Button size="sm" variant="ghost" onClick={() => setMode("manual")}>Enter manually</Button>}
                </div>
              </div>
              {!o.extractionAvailable && <p role="note" className="rounded-md border border-border bg-muted/40 p-2 text-sm">{o.extractionUnavailableReason}</p>}
              {o.extractions.length > 1 && <Select label="Extraction version" value={ex?.id ?? ""} onChange={(e) => setSelected(e.target.value)} options={o.extractions.map((x) => ({ value: x.id, label: `v${x.extractionVersion} · ${x.providerName} · ${EXTRACTION_STATUS[x.status].label}${x.documentVersion !== o.documentVersion ? " (older file version)" : ""}` }))} containerClassName="max-w-sm" />}
              {ex ? <ExtractionView ex={ex} selectedType={o.documentType} /> : <HelperText>No extraction yet.</HelperText>}
            </>
          )}
        </Card>
      </div>
      {o.confirmed && (
        <Card className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2"><SectionTitle className="text-base">Confirmed data</SectionTitle><Badge variant="success">Human reviewed</Badge></div>
          <Caption>Reviewed by {o.confirmed.reviewedBy ?? "reviewer"} on {new Date(o.confirmed.reviewedAt).toLocaleString()} · {o.confirmed.correctionCount} correction{o.confirmed.correctionCount === 1 ? "" : "s"}{o.confirmed.extractionVersion ? ` · from extraction v${o.confirmed.extractionVersion}` : " · manual entry"}{o.confirmed.note ? ` · “${o.confirmed.note}”` : ""}</Caption>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <caption className="sr-only">Confirmed values</caption>
              <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="px-2 py-1 text-left font-medium">Field</th><th scope="col" className="px-2 py-1 text-left font-medium">Value</th><th scope="col" className="px-2 py-1 text-left font-medium">Provenance</th></tr></thead>
              <tbody>{Object.entries(o.confirmed.fields).map(([k, v]) => <tr key={k} className="border-t border-border"><td className="px-2 py-1">{label(k)}</td><td className="px-2 py-1 break-words">{v?.unknown ? <Caption>Unknown</Caption> : (v?.value ?? "—")}</td><td className="px-2 py-1"><Caption>{v ? PROVENANCE[v.provenance] : ""}</Caption></td></tr>)}</tbody>
            </table>
          </div>
          {o.confirmed.items.length > 0 && <ValueTable values={{}} items={o.confirmed.items.map((i) => Object.fromEntries(Object.entries(i.fields).map(([k, v]) => [k, v?.value ?? null])))} />}
        </Card>
      )}
      {mode && <ReviewForm o={o} ex={mode === "review" ? ex : null} onClose={() => setMode(null)} />}
      <div className="flex flex-wrap items-center gap-2">
        {(can("validate") && (o.structured || o.confirmed)) && <Button size="sm" variant="outline" onClick={() => validate.mutate(undefined)} loading={validate.isPending}>Validate against related documents</Button>}
        {!o.structured && !o.confirmed && <Caption>Confirm the extracted data (or enter it manually) before it is used for validation.</Caption>}
      </div>
      {runs.data && run ? (
        <ValidationRunCard run={runs.data.find((r) => r.id === (selected && runs.data.some((x) => x.id === selected) ? selected : run.id)) ?? run} onRerun={() => validate.mutate(undefined)} rerunning={validate.isPending} history={runs.data.map((r) => ({ id: r.id, runNumber: r.runNumber, status: r.status, createdAt: r.createdAt }))} onSelect={setSelected} />
      ) : runs.isLoading ? <Skeleton className="h-24 w-full" /> : <HelperText>Not validated yet.</HelperText>}
    </section>
  );
}

function ExtractionView({ ex, selectedType }: { ex: DocumentExtractionView; selectedType: string }) {
  const st = EXTRACTION_STATUS[ex.status];
  const r = ex.result;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={st.variant}>{st.label}</Badge>
        <Badge variant="neutral">v{ex.extractionVersion}</Badge>
        <Caption>{ex.providerType === "AI" ? "AI" : ex.providerType === "RULE" ? "Rule-based parser" : "Manual"}{ex.providerModel ? ` · ${ex.providerModel}` : ""} · schema {ex.schemaVersion}{ex.promptVersion ? ` · prompt ${ex.promptVersion}` : ""} · {ex.textAvailability.replace(/_/g, " ").toLowerCase()}</Caption>
      </div>
      {ex.errorMessage && <p role="alert" className="text-danger">{ex.errorMessage}</p>}
      {ex.detectedDocumentType && (
        <p>Detected type: <strong>{DOC_TYPE[ex.detectedDocumentType]}</strong>{ex.documentTypeConfidence ? ` (${ex.documentTypeConfidence.toLowerCase()} confidence)` : ""}{ex.detectedDocumentType !== selectedType && <span className="text-warning"> — differs from the selected type; confirm when reviewing.</span>}</p>
      )}
      {ex.overallConfidence !== null && <Caption>Overall confidence {ex.overallConfidence}/100 (informational only).</Caption>}
      {r && <FieldTable r={r} />}
      {r && r.items.length > 0 && <ValueTable values={{}} items={r.items.map((i) => Object.fromEntries(Object.entries(i.fields).map(([k, v]) => [k, v ? `${v.raw ?? "—"}${v.ambiguous ? " ⚠" : ""}` : null])))} />}
      {ex.missingFields.length > 0 && <p><span className="font-medium">Missing values:</span> {ex.missingFields.map(label).join(", ")} — left unknown.</p>}
      {(r?.ambiguities.length || 0) > 0 && <ul className="list-disc pl-5 text-warning">{r!.ambiguities.map((a) => <li key={a}>{a}</li>)}</ul>}
      {[...ex.warnings, ...(r?.warnings ?? [])].map((w) => <Caption key={w} className="block">{w}</Caption>)}
    </div>
  );
}

function FieldTable({ r }: { r: ExtractionResult }) {
  const rows = EXTRACTION_HEADER_FIELDS.filter((k) => r.fields[k]);
  if (!rows.length) return <HelperText>No header fields extracted.</HelperText>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">Extracted fields</caption>
        <thead className="text-xs text-muted-foreground"><tr>{["Field", "As written", "Normalized", "Confidence", "Notes"].map((h) => <th key={h} scope="col" className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((k) => {
            const f = r.fields[k]!;
            return (
              <tr key={k} className="border-t border-border align-top">
                <td className="px-2 py-1">{label(k)}</td>
                <td className="px-2 py-1 break-words">{f.raw ?? "—"}</td>
                <td className="px-2 py-1 break-words">{f.value ?? <Caption>—</Caption>}</td>
                <td className="px-2 py-1"><Badge variant={CONFIDENCE[f.confidence]}>{f.confidence.toLowerCase()}</Badge></td>
                <td className="px-2 py-1">{f.ambiguous && <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="size-3.5" aria-hidden="true" />Ambiguous. </span>}<Caption>{f.note ?? ""}</Caption></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ValueTable({ values, items }: { values: Record<string, string | null | undefined>; items: Record<string, string | null | boolean | undefined>[] }) {
  const entries = Object.entries(values).filter(([, v]) => v !== null && v !== undefined && v !== "");
  const cols = ITEM_COLUMNS.filter((c) => items.some((i) => i[c] !== null && i[c] !== undefined && i[c] !== ""));
  return (
    <div className="flex flex-col gap-2">
      {entries.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">{entries.map(([k, v]) => <React.Fragment key={k}><dt className="text-muted-foreground">{label(k)}</dt><dd className="break-words">{String(v)}</dd></React.Fragment>)}</dl>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <caption className="sr-only">Items</caption>
            <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="px-2 py-1 text-left font-medium">#</th>{cols.map((c) => <th key={c} scope="col" className="px-2 py-1 text-left font-medium">{label(c)}</th>)}</tr></thead>
            <tbody>{items.map((it, n) => <tr key={n} className="border-t border-border"><td className="px-2 py-1">{n + 1}</td>{cols.map((c) => <td key={c} className="px-2 py-1 break-words">{it[c] === null || it[c] === undefined ? "—" : String(it[c])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Human review: confirm, correct, clear or mark unknown; add missing values; confirm type. Original extraction is untouched. */
function ReviewForm({ o, ex, onClose }: { o: DocumentExtractionOverview; ex: DocumentExtractionView | null; onClose: () => void }) {
  const r = ex?.result ?? null;
  const [fields, setFields] = React.useState<Record<string, string>>(() => Object.fromEntries(Object.entries(r?.fields ?? {}).map(([k, v]) => [k, v?.value ?? ""])));
  const [unknown, setUnknown] = React.useState<Set<string>>(new Set());
  const [items, setItems] = React.useState<Record<string, string>[]>(() => (r?.items ?? []).map((i) => Object.fromEntries(Object.entries(i.fields).map(([k, v]) => [k, v?.value ?? ""]))));
  const [type, setType] = React.useState<string>(ex?.detectedDocumentType && ex.detectedDocumentType !== o.documentType ? o.documentType : o.documentType);
  const [typeOk, setTypeOk] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [add, setAdd] = React.useState("");
  const save = useValidationMutation(
    () => {
      const body = {
        fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, unknown.has(k) ? null : v.trim() || null])),
        unknownFields: [...unknown],
        items: items.map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v.trim() || null]))),
        confirmedDocumentType: type,
        confirmTypeChange: type !== o.documentType ? typeOk : undefined,
        note: note.trim() || undefined,
      };
      return ex ? extractionApi.confirm(o.documentId, ex.id, body) : extractionApi.manual(o.documentId, body);
    },
    ex ? "Extraction confirmed — deterministic validation ran automatically" : "Data saved",
    onClose,
  );
  const remaining = EXTRACTION_HEADER_FIELDS.filter((k) => !(k in fields));
  return (
    <Card className="flex flex-col gap-3 p-4">
      <SectionTitle className="text-base">{ex ? `Review extraction v${ex.extractionVersion}` : "Enter document data manually"}</SectionTitle>
      <HelperText>Values are stored as a separate reviewed snapshot; the {ex ? "extraction result" : "file"} is never overwritten. Leave a value empty to clear it, or mark it unknown. Dates as YYYY-MM-DD.</HelperText>
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.keys(fields).map((k) => {
          const e = r?.fields[k as keyof ExtractionResult["fields"]];
          return (
            <div key={k} className="flex flex-col gap-1 rounded-md border border-border p-2">
              <Input label={label(k)} type={DATE_FIELDS.has(k) ? "date" : "text"} value={fields[k]} disabled={unknown.has(k)} onChange={(ev) => setFields((p) => ({ ...p, [k]: ev.target.value }))} description={e ? `As written: ${e.raw ?? "—"}${e.ambiguous ? " — ambiguous, please confirm" : ""}` : "Added by you"} />
              <Checkbox label="Unknown" checked={unknown.has(k)} onChange={(ev) => setUnknown((p) => { const n = new Set(p); if (ev.target.checked) n.add(k); else n.delete(k); return n; })} />
            </div>
          );
        })}
      </div>
      {remaining.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Add a missing field" placeholder="Choose field" value={add} onChange={(e) => setAdd(e.target.value)} options={remaining.map((k) => ({ value: k, label: label(k) }))} containerClassName="w-60" />
          <Button size="sm" variant="outline" disabled={!add} onClick={() => { setFields((p) => ({ ...p, [add]: "" })); setAdd(""); }}><Plus className="size-4" aria-hidden="true" />Add</Button>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Items (each product separately)</p>
        {items.map((it, n) => (
          <fieldset key={n} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-3 lg:grid-cols-5">
            <legend className="sr-only">Item {n + 1}</legend>
            {[...new Set(["description", "hsCode", "quantity", "unit", "unitPrice", ...Object.keys(it)])].map((k) => (
              <Input key={k} label={`${n + 1}: ${label(k)}`} value={it[k] ?? ""} onChange={(ev) => setItems((p) => p.map((x, j) => (j === n ? { ...x, [k]: ev.target.value } : x)))} containerClassName={k === "description" ? "sm:col-span-2" : undefined} />
            ))}
            <Button size="sm" variant="ghost" onClick={() => setItems((p) => p.filter((_, j) => j !== n))} aria-label={`Remove item ${n + 1}`}><Trash2 className="size-4" aria-hidden="true" />Remove</Button>
          </fieldset>
        ))}
        <Button size="sm" variant="outline" className="self-start" onClick={() => setItems((p) => [...p, { description: "", quantity: "", unit: "" }])}><Plus className="size-4" aria-hidden="true" />Add item</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Document type" value={type} onChange={(e) => { setType(e.target.value); setTypeOk(false); }} options={TRADE_DOCUMENT_TYPES.filter((t) => !["COMMERCIAL_INVOICE", "PACKING_LIST", "SHIPPING_INSTRUCTION"].includes(t) || t === o.documentType).map((t) => ({ value: t, label: DOC_TYPE[t] }))} description={ex?.detectedDocumentType ? `Detected: ${DOC_TYPE[ex.detectedDocumentType]}` : undefined} />
        {type !== o.documentType && <Checkbox label={`Confirm changing the type from ${DOC_TYPE[o.documentType]}`} checked={typeOk} onChange={(e) => setTypeOk(e.target.checked)} />}
      </div>
      <Textarea label="Review note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={type !== o.documentType && !typeOk}>{ex ? "Confirm reviewed data" : "Save data"}</Button>
      </div>
    </Card>
  );
}
