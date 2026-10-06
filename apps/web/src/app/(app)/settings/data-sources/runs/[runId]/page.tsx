"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { tradeDataApi } from "@/lib/api/trade-data";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { RequirePermission } from "@/components/layout/require-permission";
import { fmtDate, fmtNum, RunStatusBadge } from "@/components/provenance/source-bits";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function RunDetailPage() {
  return (
    <RequirePermission permission="trade_data.view">
      <RunDetailContent />
    </RequirePermission>
  );
}

function RunDetailContent() {
  const { runId } = useParams<{ runId: string }>();
  const run = useQuery({
    queryKey: ["trade-data", "run", runId],
    queryFn: () => tradeDataApi.run(runId),
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" || q.state.data?.status === "PENDING" ? 4000 : false),
  });
  if (run.isLoading) return <PageSkeleton />;
  if (run.isError || !run.data) return <ErrorState title="Run not found" message={toFriendlyErrorMessage(run.error)} onRetry={() => run.refetch()} />;
  const r = run.data;
  const counts: [string, number][] = [
    ["Fetched", r.recordsFetched],
    ["Accepted", r.recordsAccepted],
    ["Rejected", r.recordsRejected],
    ["Inserted", r.recordsInserted],
    ["Updated (revised)", r.recordsUpdated],
    ["Duplicates skipped", r.duplicatesSkipped],
    ["Unresolved mappings", r.unresolvedMappings],
  ];
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Breadcrumbs items={[{ label: "Data Sources", href: "/settings/data-sources" }, { label: r.sourceName, href: `/settings/data-sources/${r.sourceId}` }, { label: "Run" }]} />
      <div className="flex flex-col gap-2">
        <PageTitle>Ingestion run</PageTitle>
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          <RunStatusBadge status={r.status} />
          <Caption>{r.sourceName} · {r.mode.toLowerCase().replace("_", " ")} · {r.datasetKeys.join(", ")}</Caption>
        </div>
        {r.status === "RUNNING" && <HelperText role="status">Running in the background — counts appear when the run finishes. This page refreshes automatically.</HelperText>}
      </div>
      <Card className="p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Started</dt><dd>{fmtDate(r.startedAt)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Finished</dt><dd>{fmtDate(r.finishedAt)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Initiated by</dt><dd>{r.initiatedBy ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Quality score</dt><dd>{r.qualityScore === null ? "—" : `${r.qualityScore}/100`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Source version</dt><dd className="break-all">{r.sourceVersion ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Transform version</dt><dd>{r.transformVersion}</dd></div>
          {r.fileName && <div><dt className="text-xs text-muted-foreground">File</dt><dd className="break-all">{r.fileName}</dd></div>}
        </dl>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
          {counts.map(([label, value]) => (
            <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-semibold">{fmtNum(value)}</dd></div>
          ))}
        </dl>
        {r.errorSummary && <p role="alert" className="mt-3 text-sm text-foreground"><span className="font-medium">Summary:</span> {r.errorSummary}</p>}
        {r.status === "FAILED" && <HelperText className="mt-2">A failed run never deletes previously ingested data — the last successful data stays in use.</HelperText>}
      </Card>
      <section aria-labelledby="issues-h" className="flex flex-col gap-3">
        <SectionTitle id="issues-h" className="text-base">Issues ({Object.values(r.issueCounts).reduce((s, n) => s + (n ?? 0), 0)})</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {Object.entries(r.issueCounts).map(([k, n]) => <Badge key={k} variant="neutral">{k.toLowerCase().replace(/_/g, " ")}: {n}</Badge>)}
        </div>
        {r.issues.length === 0 ? (
          <HelperText>No issues recorded.</HelperText>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-max text-sm">
              <caption className="sr-only">Run issues</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>{["Severity", "Issue", "Field", "Source value", "Reason", "Row"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {r.issues.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="px-3 py-2"><Badge variant={i.severity === "REJECTED" ? "danger" : i.severity === "UNRESOLVED" ? "warning" : "neutral"}>{i.severity.toLowerCase()}</Badge></td>
                    <td className="px-3 py-2 text-xs">{i.kind.toLowerCase().replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 text-xs">{i.field ?? "—"}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2 text-xs" title={i.sourceValue ?? ""}>{i.sourceValue ?? "—"}</td>
                    <td className="max-w-[24rem] whitespace-normal px-3 py-2 text-xs">{i.message}</td>
                    <td className="px-3 py-2 text-xs">{i.rowRef ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Link href="/settings/data-sources/explorer" className="w-fit text-sm text-primary hover:underline">Open Trade Data Explorer</Link>
    </div>
  );
}
