"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TradeDataSourceSummary } from "@exportpro/types";
import { tradeDataApi } from "@/lib/api/trade-data";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { FRESHNESS_LABELS } from "@/lib/opportunity-labels";
import { RequirePermission } from "@/components/layout/require-permission";
import { ACCESS_LABELS, fmtDate, fmtNum, RunStatusBadge, SourceKindBadge } from "@/components/provenance/source-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/table";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function DataSourcesPage() {
  return (
    <RequirePermission permission="trade_data.view">
      <DataSourcesContent />
    </RequirePermission>
  );
}

function DataSourcesContent() {
  const router = useRouter();
  const sources = useQuery({ queryKey: ["trade-data", "sources"], queryFn: tradeDataApi.sources, refetchInterval: (q) => (q.state.data?.some((s) => s.latestRun?.status === "RUNNING") ? 5000 : false) });
  const quality = useQuery({ queryKey: ["trade-data", "quality"], queryFn: tradeDataApi.quality });
  const runs = useQuery({ queryKey: ["trade-data", "runs", "recent"], queryFn: () => tradeDataApi.runs({ pageSize: 8 }) });

  const columns: Column<TradeDataSourceSummary>[] = [
    {
      key: "name",
      header: "Source",
      render: (s) => (
        <div className="flex max-w-[22rem] flex-col whitespace-normal">
          <Link href={`/settings/data-sources/${s.id}`} className="font-medium text-foreground hover:underline">{s.name}</Link>
          <Caption>{s.authority}</Caption>
        </div>
      ),
    },
    { key: "kind", header: "Type", render: (s) => <div className="flex flex-col items-start gap-1"><SourceKindBadge s={s} /><Caption>Tier {s.qualityTier}</Caption></div> },
    { key: "access", header: "Access", hideOnMobile: true, render: (s) => <div className="flex flex-col"><span>{ACCESS_LABELS[s.accessMethod]}</span><Caption>{s.updateFrequency.toLowerCase()}</Caption></div> },
    { key: "domains", header: "Domains", hideOnMobile: true, render: (s) => <span className="block max-w-[12rem] whitespace-normal text-xs">{s.dataDomains.map((d) => d.toLowerCase().replace(/_/g, " ")).join(", ")}</span> },
    { key: "enabled", header: "Enabled", render: (s) => (s.enabled ? <Badge variant="success">Enabled</Badge> : <Badge variant="neutral">Disabled</Badge>) },
    {
      key: "fresh",
      header: "Freshness",
      render: (s) => {
        const f = FRESHNESS_LABELS[s.freshness];
        return <div className="flex flex-col items-start gap-1"><Badge variant={f.variant}>{f.label}</Badge><Caption>Latest period: {s.latestSourcePeriod ?? "—"}</Caption></div>;
      },
    },
    { key: "conf", header: "Confidence", hideOnMobile: true, render: (s) => `${s.confidence}/100` },
    { key: "facts", header: "Records", hideOnMobile: true, render: (s) => fmtNum(s.factCount) },
    {
      key: "status",
      header: "Last run",
      render: (s) =>
        s.latestRun ? (
          <div className="flex flex-col items-start gap-1">
            <RunStatusBadge status={s.latestRun.status} />
            <Caption>{fmtDate(s.lastSuccessfulRunAt)}</Caption>
            {s.recentFailures > 0 && <Caption className="text-danger">{s.recentFailures} recent failure(s)</Caption>}
          </div>
        ) : (
          <Caption>{s.automated || s.manualImport ? "Never run" : "Not automated"}</Caption>
        ),
    },
  ];

  const q = quality.data;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageTitle>Data Sources</PageTitle>
          <HelperText className="mt-1 max-w-3xl">
            Registry of government, intergovernmental, internal and demo sources feeding trade intelligence. Quality tier (authority) and freshness are tracked separately. No credentials are shown here.
          </HelperText>
        </div>
        <Button asChild variant="outline">
          <Link href="/settings/data-sources/explorer"><Search className="size-4" aria-hidden="true" />Trade Data Explorer</Link>
        </Button>
      </div>

      <section aria-labelledby="quality-h" className="flex flex-col gap-3">
        <SectionTitle id="quality-h" className="text-base">Data quality</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Canonical records" value={fmtNum(q?.totalFacts)} />
          <Stat label="Real (non-demo) sources" value={q ? `${q.officialOrPublicSources} of ${q.sources}` : "—"} />
          <Stat label="Rejected rows" value={q?.rejectedPercent === null || q === undefined ? "—" : `${q.rejectedPercent}%`} />
          <Stat label="Unresolved mappings" value={fmtNum(q?.unresolvedMappings)} />
          <Stat label="Duplicates skipped" value={fmtNum(q?.duplicatesSkipped)} />
          <Stat label="Stale / failed sources" value={q ? `${q.staleSources} stale · ${q.latestRunsFailed} failed` : "—"} />
        </div>
      </section>

      <section aria-labelledby="sources-h" className="flex flex-col gap-3">
        <SectionTitle id="sources-h" className="text-base">Sources</SectionTitle>
        <DataTable
          columns={columns}
          rows={sources.data ?? []}
          rowKey={(s) => s.id}
          isLoading={sources.isLoading}
          error={sources.isError ? toFriendlyErrorMessage(sources.error) : undefined}
          onRetry={() => sources.refetch()}
          onRowClick={(s) => router.push(`/settings/data-sources/${s.id}`)}
          emptyState={{ icon: Database, title: "No sources registered", description: "Sources are registered automatically when the API starts." }}
        />
      </section>

      <section aria-labelledby="runs-h" className="flex flex-col gap-3">
        <SectionTitle id="runs-h" className="text-base">Recent ingestion runs</SectionTitle>
        {runs.data?.items.length ? (
          <ul className="flex flex-col gap-2">
            {runs.data.items.map((r) => (
              <li key={r.id}>
                <Link href={`/settings/data-sources/runs/${r.id}`} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <RunStatusBadge status={r.status} />
                  <span className="font-medium">{r.sourceName}</span>
                  <Caption>{r.mode.toLowerCase().replace("_", " ")} · {fmtDate(r.startedAt)}</Caption>
                  <Caption>{fmtNum(r.recordsAccepted)} accepted · {fmtNum(r.recordsRejected)} rejected · {fmtNum(r.recordsInserted)} new</Caption>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <HelperText>{runs.isLoading ? "Loading runs…" : "No ingestion runs yet."}</HelperText>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <Caption>{label}</Caption>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </Card>
  );
}
