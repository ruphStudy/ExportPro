import type {
  IngestionRunDetail,
  IngestionRunSummary,
  ManualImportPreview,
  TradeDataIssue,
  TradeDataQualitySummary,
  TradeDataSourceSummary,
  TradeFactListResponse,
  TradeFactProvenance,
  TradeFactQuery,
} from "@exportpro/types";
import type { PaginationMeta } from "@exportpro/types";
import { apiClient } from "../api-client";

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

const fileBody = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return form;
};

export const tradeDataApi = {
  sources: () => apiClient.get<TradeDataSourceSummary[]>("/trade-data/sources"),
  source: (id: string) => apiClient.get<TradeDataSourceSummary & { runs: IngestionRunSummary[] }>(`/trade-data/sources/${id}`),
  setEnabled: (id: string, enabled: boolean) => apiClient.patch<TradeDataSourceSummary>(`/trade-data/sources/${id}`, { enabled }),
  ingest: (id: string, datasets?: string[]) => apiClient.post<IngestionRunDetail>(`/trade-data/sources/${id}/ingest`, { datasets }),
  preview: (id: string, file: File) => apiClient.post<ManualImportPreview>(`/trade-data/sources/${id}/import/preview`, fileBody(file)),
  importFile: (id: string, file: File) => apiClient.post<IngestionRunDetail>(`/trade-data/sources/${id}/import`, fileBody(file)),
  runs: (q: { sourceId?: string; page?: number; pageSize?: number }) =>
    apiClient.get<{ items: IngestionRunSummary[]; meta: PaginationMeta }>(`/trade-data/runs${qs(q)}`),
  run: (id: string) => apiClient.get<IngestionRunDetail>(`/trade-data/runs/${id}`),
  facts: (q: TradeFactQuery) => apiClient.get<TradeFactListResponse>(`/trade-data/facts${qs(q)}`),
  factProvenance: (id: string) => apiClient.get<TradeFactProvenance>(`/trade-data/facts/${id}/provenance`),
  issues: (q: { sourceId?: string; kind?: string; severity?: string; page?: number; pageSize?: number }) =>
    apiClient.get<{ items: TradeDataIssue[]; meta: PaginationMeta }>(`/trade-data/issues${qs(q)}`),
  quality: () => apiClient.get<TradeDataQualitySummary>("/trade-data/quality"),
};
