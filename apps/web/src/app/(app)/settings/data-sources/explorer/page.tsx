"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SearchX } from "lucide-react";
import * as React from "react";
import type { TradeFactQuery, TradeFactRow } from "@exportpro/types";
import { countryLabel, formatTariffCode } from "@exportpro/types";
import { tradeDataApi } from "@/lib/api/trade-data";
import { formatMoney } from "@/lib/api/product-intelligence";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { FRESHNESS_LABELS } from "@/lib/opportunity-labels";
import { RequirePermission } from "@/components/layout/require-permission";
import { ProvenanceLine } from "@/components/provenance/provenance";
import { fmtNum } from "@/components/provenance/source-bits";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/table";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

export default function ExplorerPage() {
  return (
    <RequirePermission permission="trade_data.view">
      <ExplorerContent />
    </RequirePermission>
  );
}

function ExplorerContent() {
  const [draft, setDraft] = React.useState<TradeFactQuery>({});
  const [filters, setFilters] = React.useState<TradeFactQuery>({});
  const [page, setPage] = React.useState(1);
  const [provenanceId, setProvenanceId] = React.useState<string | null>(null);
  const sources = useQuery({ queryKey: ["trade-data", "sources"], queryFn: tradeDataApi.sources });
  const facts = useQuery({ queryKey: ["trade-data", "facts", filters, page], queryFn: () => tradeDataApi.facts({ ...filters, page, pageSize: 25 }), placeholderData: keepPreviousData });

  const columns: Column<TradeFactRow>[] = [
    { key: "hs", header: "HS", render: (f) => <div className="flex flex-col"><span className="font-mono">{formatTariffCode(f.hsCode)}</span><Caption>{f.codeSystem === "ITC_HS_INDIA" ? "ITC-HS" : `HS${f.hsLevel}`}{f.sourceHsCode !== f.hsCode ? ` · src "${f.sourceHsCode}"` : ""}</Caption></div> },
    { key: "dir", header: "Flow", render: (f) => f.tradeDirection.toLowerCase() },
    { key: "rep", header: "Reporter", render: (f) => countryLabel(f.reporterCountryCode) },
    {
      key: "par",
      header: "Partner",
      render: (f) => (
        <div className="flex flex-col">
          <span>{f.partnerCountryCode ? countryLabel(f.partnerCountryCode) : f.partnerLabel}</span>
          {f.partnerEntityType !== "COUNTRY" && <Caption>{f.partnerEntityType.toLowerCase()}</Caption>}
        </div>
      ),
    },
    { key: "per", header: "Period", render: (f) => f.period },
    { key: "val", header: "Value", align: "right", render: (f) => <div className="flex flex-col items-end"><span>{f.tradeValue === null ? "Unavailable" : formatMoney(f.tradeValue, f.currency)}</span>{f.valueBasis && <Caption>{f.valueBasis}</Caption>}</div> },
    {
      key: "qty",
      header: "Quantity",
      align: "right",
      render: (f) => (
        <div className="flex flex-col items-end">
          <span>{f.normalizedQuantity !== null ? `${fmtNum(Math.round(f.normalizedQuantity))} ${f.normalizedUnit}` : f.quantity !== null ? `${fmtNum(f.quantity)} ${f.quantityUnit ?? ""}` : "—"}</span>
          {f.unitMappingStatus === "UNRESOLVED" && <Caption className="text-warning">unit unresolved</Caption>}
          {f.isEstimated && <Caption>estimated</Caption>}
        </div>
      ),
    },
    { key: "src", header: "Source", render: (f) => <div className="flex max-w-[12rem] flex-col whitespace-normal"><span className="text-xs">{f.sourceName}</span><Badge variant={FRESHNESS_LABELS[f.freshness].variant} className="w-fit">{FRESHNESS_LABELS[f.freshness].label}</Badge></div> },
    { key: "prov", header: "Lineage", render: (f) => <Button variant="ghost" size="sm" onClick={() => setProvenanceId(f.id)}>Provenance</Button> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Breadcrumbs items={[{ label: "Data Sources", href: "/settings/data-sources" }, { label: "Trade Data Explorer" }]} />
      <div>
        <PageTitle>Trade Data Explorer</PageTitle>
        <HelperText className="mt-1">Canonical, normalized trade facts. Original source codes and values are preserved; open Provenance to see lineage back to the raw record.</HelperText>
      </div>
      <form
        className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
          setPage(1);
        }}
      >
        <Input label="HS code" placeholder="e.g. 0909 or 090931" value={draft.hsCode ?? ""} onChange={(e) => setDraft({ ...draft, hsCode: e.target.value || undefined })} />
        <Select label="Flow" placeholder="Both" value={draft.tradeDirection ?? ""} onChange={(e) => setDraft({ ...draft, tradeDirection: (e.target.value || undefined) as TradeFactQuery["tradeDirection"] })} options={[{ value: "EXPORT", label: "Export" }, { value: "IMPORT", label: "Import" }]} />
        <Input label="Reporter (ISO2)" placeholder="IN" maxLength={2} value={draft.reporter ?? ""} onChange={(e) => setDraft({ ...draft, reporter: e.target.value || undefined })} />
        <Input label="Partner (ISO2 / WORLD)" placeholder="AE" maxLength={5} value={draft.partner ?? ""} onChange={(e) => setDraft({ ...draft, partner: e.target.value || undefined })} />
        <Input label="Year" type="number" placeholder="2023" value={draft.year ?? ""} onChange={(e) => setDraft({ ...draft, year: e.target.value ? Number(e.target.value) : undefined })} />
        <Select label="Source" placeholder="All sources" value={draft.sourceId ?? ""} onChange={(e) => setDraft({ ...draft, sourceId: e.target.value || undefined })} options={(sources.data ?? []).filter((s) => s.factCount > 0).map((s) => ({ value: s.id, label: s.name }))} />
        <div className="flex items-end gap-2">
          <Button type="submit">Apply</Button>
          <Button type="button" variant="ghost" onClick={() => { setDraft({}); setFilters({}); setPage(1); }}>Reset</Button>
        </div>
      </form>
      <div aria-live="polite" className="sr-only">{facts.data ? `${facts.data.meta.totalItems} records` : ""}</div>
      <DataTable
        columns={columns}
        rows={facts.data?.items ?? []}
        rowKey={(f) => f.id}
        isLoading={facts.isLoading}
        error={facts.isError ? toFriendlyErrorMessage(facts.error) : undefined}
        onRetry={() => facts.refetch()}
        emptyState={{ icon: SearchX, title: "No matching records", description: "Adjust filters, or ingest a source first." }}
      />
      {facts.data && facts.data.meta.totalPages > 1 && <Pagination meta={facts.data.meta} onPageChange={setPage} />}
      {provenanceId && <ProvenanceModal id={provenanceId} onClose={() => setProvenanceId(null)} />}
    </div>
  );
}

function ProvenanceModal({ id, onClose }: { id: string; onClose: () => void }) {
  const p = useQuery({ queryKey: ["trade-data", "provenance", id], queryFn: () => tradeDataApi.factProvenance(id) });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Record provenance" className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
      {p.isLoading ? (
        <HelperText>Loading…</HelperText>
      ) : p.isError || !p.data ? (
        <p role="alert" className="text-sm text-danger">{toFriendlyErrorMessage(p.error)}</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <ProvenanceLine p={p.data.provenance} />
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-muted-foreground">Original HS code</dt><dd>{p.data.original.hsCode}</dd></div>
            <div><dt className="text-muted-foreground">Original partner</dt><dd>{p.data.original.partner ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Original value</dt><dd>{p.data.original.value ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Original quantity / unit</dt><dd>{p.data.original.quantity ?? "—"} {p.data.original.unit ?? ""}</dd></div>
            <div><dt className="text-muted-foreground">Ingestion run</dt><dd className="break-all">{p.data.run?.id ?? "—"} ({p.data.run?.status.toLowerCase()})</dd></div>
            <div><dt className="text-muted-foreground">Transform</dt><dd>{p.data.transformVersion} · revision {p.data.fact.revision}</dd></div>
            <div><dt className="text-muted-foreground">Raw record</dt><dd className="break-all">{p.data.raw ? `${p.data.raw.datasetKey} · ${p.data.raw.sourceRecordKey ?? ""}` : "—"}</dd></div>
            <div><dt className="text-muted-foreground">Raw checksum</dt><dd className="break-all">{p.data.raw?.checksum.slice(0, 16) ?? "—"}…</dd></div>
          </dl>
          {p.data.raw?.excerpt != null && (
            <details>
              <summary className="cursor-pointer text-xs text-primary">Raw source row</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px]">{JSON.stringify(p.data.raw.excerpt, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
