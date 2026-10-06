"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Play, Upload } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import type { ManualImportPreview } from "@exportpro/types";
import { SOURCE_QUALITY_LABELS } from "@exportpro/types";
import { tradeDataApi } from "@/lib/api/trade-data";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { FRESHNESS_LABELS } from "@/lib/opportunity-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { RequirePermission } from "@/components/layout/require-permission";
import { ACCESS_LABELS, fmtDate, fmtNum, RunStatusBadge, SourceKindBadge } from "@/components/provenance/source-bits";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function SourceDetailPage() {
  return (
    <RequirePermission permission="trade_data.view">
      <SourceDetailContent />
    </RequirePermission>
  );
}

function SourceDetailContent() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canManage = hasPermission(session, "trade_data.manage");
  const canIngest = hasPermission(session, "trade_data.ingest");
  const source = useQuery({
    queryKey: ["trade-data", "source", id],
    queryFn: () => tradeDataApi.source(id),
    refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === "RUNNING" || r.status === "PENDING") ? 4000 : false),
  });
  const issues = useQuery({ queryKey: ["trade-data", "issues", id], queryFn: () => tradeDataApi.issues({ sourceId: id, pageSize: 15 }) });
  const [datasets, setDatasets] = React.useState<string[] | null>(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["trade-data"] });
  };

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => tradeDataApi.setEnabled(id, enabled),
    onSuccess: () => {
      toast.success("Source updated");
      refresh();
    },
    onError: (e) => toast.error("Could not update source", toFriendlyErrorMessage(e)),
  });
  const ingest = useMutation({
    mutationFn: () => tradeDataApi.ingest(id, datasets ?? undefined),
    onSuccess: () => {
      toast.success("Ingestion started", "Running in the background — this page updates automatically.");
      refresh();
    },
    onError: (e) => toast.error("Could not start ingestion", toFriendlyErrorMessage(e)),
  });

  if (source.isLoading) return <PageSkeleton />;
  if (source.isError || !source.data) return <ErrorState title="Source not found" message={toFriendlyErrorMessage(source.error)} onRetry={() => source.refetch()} />;
  const s = source.data;
  const fresh = FRESHNESS_LABELS[s.freshness];
  const running = s.runs.some((r) => r.status === "RUNNING" || r.status === "PENDING");
  const selected = datasets ?? s.datasets;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Breadcrumbs items={[{ label: "Data Sources", href: "/settings/data-sources" }, { label: s.name }]} />
      <div className="flex flex-col gap-2">
        <PageTitle className="break-words">{s.name}</PageTitle>
        <div className="flex flex-wrap items-center gap-2">
          <SourceKindBadge s={s} />
          <Badge variant="neutral">{SOURCE_QUALITY_LABELS[s.qualityTier]}</Badge>
          <Badge variant={fresh.variant}>{fresh.label}</Badge>
          {s.enabled ? <Badge variant="success">Enabled</Badge> : <Badge variant="neutral">Disabled</Badge>}
        </div>
        <HelperText className="max-w-3xl">{s.description}</HelperText>
      </div>

      <Card className="p-4">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Authority" value={s.authority} />
          <Meta label="Access method" value={ACCESS_LABELS[s.accessMethod]} />
          <Meta label="Update frequency" value={`${s.updateFrequency.toLowerCase()} · expected lag ${s.expectedLagDays} days`} />
          <Meta label="Domains" value={s.dataDomains.map((d) => d.toLowerCase().replace(/_/g, " ")).join(", ")} />
          <Meta label="Latest source period" value={s.latestSourcePeriod ?? "—"} />
          <Meta label="Last successful ingestion" value={fmtDate(s.lastSuccessfulRunAt)} />
          <Meta label="Next expected refresh" value={fmtDate(s.nextExpectedRefreshAt)} />
          <Meta label="Source confidence" value={`${s.confidence}/100 · ${fmtNum(s.factCount)} records`} />
        </dl>
        {s.notes && <p className="mt-3 text-xs text-muted-foreground">{s.notes}</p>}
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {s.baseUrl && <a href={s.baseUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">Source site <ExternalLink className="size-3" aria-hidden="true" /></a>}
          {s.termsUrl && <a href={s.termsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">Terms / data policy <ExternalLink className="size-3" aria-hidden="true" /></a>}
        </div>
        {s.configurationProblems.length > 0 && (
          <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Not configured: {s.configurationProblems.join(" ")}
          </p>
        )}
      </Card>

      {(canManage || (canIngest && (s.automated || s.manualImport))) && (
        <Card className="flex flex-col gap-4 p-4">
          <SectionTitle className="text-base">Administration</SectionTitle>
          <HelperText>Changes affect global data for every organization and are audited. Only platform data administrators can perform them.</HelperText>
          <div className="flex flex-wrap items-center gap-3">
            {canManage && (
              <Button variant="outline" onClick={() => toggle.mutate(!s.enabled)} loading={toggle.isPending}>
                {s.enabled ? "Disable source" : "Enable source"}
              </Button>
            )}
            {canIngest && s.automated && (
              <>
                {s.datasets.length > 1 && (
                  <fieldset className="flex flex-wrap items-center gap-3">
                    <legend className="sr-only">Datasets to ingest</legend>
                    {s.datasets.map((d) => (
                      <label key={d} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={selected.includes(d)}
                          onChange={() => setDatasets(selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d])}
                        />
                        {d.toLowerCase().replace(/_/g, " ")}
                      </label>
                    ))}
                  </fieldset>
                )}
                <Button onClick={() => ingest.mutate()} loading={ingest.isPending} disabled={running || !s.enabled || selected.length === 0 || s.configurationProblems.length > 0}>
                  <Play className="size-4" aria-hidden="true" />
                  {running ? "Ingestion running…" : "Run ingestion"}
                </Button>
              </>
            )}
          </div>
          {canIngest && s.manualImport && <ManualImport sourceId={s.id} disabled={!s.enabled || running} onImported={refresh} />}
        </Card>
      )}

      <section aria-labelledby="runs-h" className="flex flex-col gap-3">
        <SectionTitle id="runs-h" className="text-base">Ingestion history</SectionTitle>
        {s.runs.length === 0 ? (
          <HelperText>No runs yet.</HelperText>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-max text-sm">
              <caption className="sr-only">Ingestion runs for {s.name}</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>{["Run", "Status", "Started", "Finished", "Fetched", "Accepted", "Rejected", "Inserted", "Updated", "Duplicates", "Unresolved", "Summary"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {s.runs.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2"><Link href={`/settings/data-sources/runs/${r.id}`} className="text-primary hover:underline">{r.fileName ?? r.mode.toLowerCase().replace("_", " ")}</Link></td>
                    <td className="px-3 py-2"><RunStatusBadge status={r.status} /></td>
                    <td className="px-3 py-2">{fmtDate(r.startedAt)}</td>
                    <td className="px-3 py-2">{fmtDate(r.finishedAt)}</td>
                    <td className="px-3 py-2">{fmtNum(r.recordsFetched)}</td>
                    <td className="px-3 py-2">{fmtNum(r.recordsAccepted)}</td>
                    <td className="px-3 py-2">{fmtNum(r.recordsRejected)}</td>
                    <td className="px-3 py-2">{fmtNum(r.recordsInserted)}</td>
                    <td className="px-3 py-2">{fmtNum(r.recordsUpdated)}</td>
                    <td className="px-3 py-2">{fmtNum(r.duplicatesSkipped)}</td>
                    <td className="px-3 py-2">{fmtNum(r.unresolvedMappings)}</td>
                    <td className="max-w-[18rem] whitespace-normal px-3 py-2 text-xs text-muted-foreground">{r.errorSummary ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="issues-h" className="flex flex-col gap-3">
        <SectionTitle id="issues-h" className="text-base">Normalization issues</SectionTitle>
        {issues.data?.items.length ? (
          <IssueTable issues={issues.data.items} />
        ) : (
          <HelperText>{issues.isLoading ? "Loading…" : "No rejected rows or unresolved mappings recorded for this source."}</HelperText>
        )}
      </section>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}

function IssueTable({ issues }: { issues: { id: string; kind: string; severity: string; field: string | null; sourceValue: string | null; message: string; rowRef: string | null }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-max text-sm">
        <caption className="sr-only">Normalization issues</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>{["Severity", "Issue", "Field", "Source value", "Reason", "Row"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.id} className="border-t border-border">
              <td className="px-3 py-2"><Badge variant={i.severity === "REJECTED" ? "danger" : i.severity === "UNRESOLVED" ? "warning" : "neutral"}>{i.severity.toLowerCase()}</Badge></td>
              <td className="px-3 py-2 text-xs">{i.kind.toLowerCase().replace(/_/g, " ")}</td>
              <td className="px-3 py-2 text-xs">{i.field ?? "—"}</td>
              <td className="max-w-[12rem] truncate px-3 py-2 text-xs" title={i.sourceValue ?? ""}>{i.sourceValue ?? "—"}</td>
              <td className="max-w-[22rem] whitespace-normal px-3 py-2 text-xs">{i.message}</td>
              <td className="px-3 py-2 text-xs">{i.rowRef ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManualImport({ sourceId, disabled, onImported }: { sourceId: string; disabled: boolean; onImported: () => void }) {
  const inputId = React.useId();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ManualImportPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const reset = () => {
    setFile(null);
    setPreview(null);
    setError(null);
  };
  const describe = (e: unknown) => {
    if (e instanceof ApiRequestError && e.details && typeof e.details === "object" && "expected" in (e.details as object)) {
      const d = e.details as { expected: string[]; actual: string[] };
      return `${e.message}. Expected columns: ${d.expected.join(", ")}. Found: ${d.actual.join(", ") || "none"}.`;
    }
    return e instanceof ApiRequestError ? e.message : toFriendlyErrorMessage(e);
  };
  const doPreview = useMutation({ mutationFn: (f: File) => tradeDataApi.preview(sourceId, f), onSuccess: setPreview, onError: (e) => setError(describe(e)) });
  const doImport = useMutation({
    mutationFn: (f: File) => tradeDataApi.importFile(sourceId, f),
    onSuccess: () => {
      toast.success("Import started", "Validated rows are being normalized in the background.");
      reset();
      onImported();
    },
    onError: (e) => setError(describe(e)),
  });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <h3 className="text-sm font-semibold">Manual import</h3>
      <HelperText>
        Upload a CSV or JSON file (max 10MB) using the template columns: trade_direction, hs_code, commodity, partner_country, year, month, value, value_unit
        (USD, USD_MILLION, INR, INR_LAKH, INR_CRORE), quantity, quantity_unit, port, state, district. Unexpected columns fail the import rather than being guessed.
      </HelperText>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">File</label>
        <input
          id={inputId}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          disabled={disabled || doPreview.isPending || doImport.isPending}
          onChange={(e) => {
            setPreview(null);
            setError(null);
            setFile(e.target.files?.[0] ?? null);
          }}
          className="text-sm file:mr-2 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm"
        />
        <Button variant="outline" size="sm" disabled={!file || disabled} loading={doPreview.isPending} onClick={() => file && doPreview.mutate(file)}>
          <Upload className="size-4" aria-hidden="true" />
          Validate &amp; preview
        </Button>
      </div>
      <div aria-live="polite">
        {doPreview.isPending && <HelperText>Validating file…</HelperText>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
      {preview && (
        <div className="flex flex-col gap-3">
          {preview.alreadyImported && (
            <p role="alert" className="flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              This exact file (same checksum) was already imported — importing again will be skipped.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-7">
            <Meta label="Format" value={preview.detectedFormat} />
            <Meta label="Rows" value={fmtNum(preview.rows)} />
            <Meta label="Valid" value={fmtNum(preview.valid)} />
            <Meta label="Rejected" value={fmtNum(preview.rejected)} />
            <Meta label="Duplicates in file" value={fmtNum(preview.duplicatesInFile)} />
            <Meta label="Already in database" value={fmtNum(preview.existingFacts)} />
            <Meta label="Unresolved mappings" value={fmtNum(preview.unresolvedMappings)} />
          </dl>
          <Caption className="break-all">Checksum {preview.checksum}</Caption>
          {preview.issues.length > 0 && (
            <IssueTable issues={preview.issues.map((i, n) => ({ ...i, id: String(n) }))} />
          )}
          <div className="flex gap-2">
            <Button disabled={!file || preview.alreadyImported || preview.valid === 0} loading={doImport.isPending} onClick={() => file && doImport.mutate(file)}>
              Import {fmtNum(preview.valid)} valid rows
            </Button>
            <Button variant="outline" onClick={reset}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
