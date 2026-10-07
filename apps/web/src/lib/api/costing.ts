import type {
  ComparisonObjective,
  CostingLineItem,
  CostingListResponse,
  CostingResult,
  CostingScenario,
  ExportCostingDetail,
  FxRateSnapshot,
  FxSensitivityRow,
  IncotermComparisonRow,
  ScenarioComparison,
} from "@exportpro/types";
import { COSTING_CURRENCIES } from "@exportpro/types";
import { apiClient } from "../api-client";

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export interface CostingListQuery {
  search?: string;
  productId?: string;
  buyerCompanyId?: string;
  crmLeadId?: string;
  country?: string;
  incoterm?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export type LineInput = Partial<Omit<CostingLineItem, "id" | "scenarioId" | "sortOrder">> & { expectedRowVersion?: number };
export type ScenarioInput = Partial<Omit<CostingScenario, "id" | "costingId" | "isBase" | "sortOrder" | "fx" | "lines" | "result" | "calculatedAt" | "updatedAt">> & {
  fx?: { currency: string; snapshotId: string }[];
  expectedRowVersion?: number;
};

export const costingApi = {
  list: (q: CostingListQuery) => apiClient.get<CostingListResponse>(`/costings${qs(q)}`),
  get: (id: string) => apiClient.get<ExportCostingDetail>(`/costings/${id}`),
  create: (body: Record<string, unknown>) => apiClient.post<ExportCostingDetail>("/costings", body),
  update: (id: string, body: Record<string, unknown>) => apiClient.patch<ExportCostingDetail>(`/costings/${id}`, body),
  addLine: (id: string, body: LineInput & { scenarioId: string }) => apiClient.post<ExportCostingDetail>(`/costings/${id}/lines`, body),
  updateLine: (id: string, lineId: string, body: LineInput) => apiClient.patch<ExportCostingDetail>(`/costings/${id}/lines/${lineId}`, body),
  deleteLine: (id: string, lineId: string, v?: number) => apiClient.delete<ExportCostingDetail>(`/costings/${id}/lines/${lineId}${qs({ expectedRowVersion: v })}`),
  createScenario: (id: string, body: ScenarioInput & { cloneFromScenarioId?: string }) => apiClient.post<ExportCostingDetail>(`/costings/${id}/scenarios`, body),
  updateScenario: (id: string, sid: string, body: ScenarioInput) => apiClient.patch<ExportCostingDetail>(`/costings/${id}/scenarios/${sid}`, body),
  deleteScenario: (id: string, sid: string, v?: number) => apiClient.delete<ExportCostingDetail>(`/costings/${id}/scenarios/${sid}${qs({ expectedRowVersion: v })}`),
  calculate: (id: string, sid: string) => apiClient.post<CostingResult>(`/costings/${id}/scenarios/${sid}/calculate`),
  analysis: (id: string, sid: string, shifts?: string) =>
    apiClient.get<{ incoterms: IncotermComparisonRow[]; fxSensitivity: FxSensitivityRow[] }>(`/costings/${id}/scenarios/${sid}/analysis${qs({ shifts })}`),
  compare: (id: string, scenarioIds: string[], objective?: ComparisonObjective) => apiClient.post<ScenarioComparison>(`/costings/${id}/compare`, { scenarioIds, objective }),
  ready: (id: string, v?: number) => apiClient.post<ExportCostingDetail>(`/costings/${id}/ready`, { expectedRowVersion: v }),
  lock: (id: string, v?: number) => apiClient.post<ExportCostingDetail>(`/costings/${id}/lock`, { expectedRowVersion: v }),
  revise: (id: string) => apiClient.post<ExportCostingDetail>(`/costings/${id}/revise`),
  archive: (id: string) => apiClient.post<ExportCostingDetail>(`/costings/${id}/archive`),
  restore: (id: string) => apiClient.post<ExportCostingDetail>(`/costings/${id}/restore`),
  fxRates: (q: { baseCurrency?: string; quoteCurrency?: string }) => apiClient.get<FxRateSnapshot[]>(`/fx/rates${qs(q)}`),
  manualFx: (body: { baseCurrency: string; quoteCurrency: string; rate: string; sourceDate: string; sourceLabel?: string; sourceType?: "MANUAL" | "BANK_RATE" }) =>
    apiClient.post<FxRateSnapshot>("/fx/manual-rate", body),
};

/** Display-only formatting of backend decimal strings (all arithmetic happens on the server). */
export function fmtMoney(value: string | null | undefined, currency: string, digits = 2): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return `${currency} ${n.toFixed(digits)}`;
  }
}
export const fmtPct = (v: string | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);
export const currencyOptions = COSTING_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.label}` }));
