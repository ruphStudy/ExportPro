import type {
  FieldSourced,
  FreightComparison,
  FreightQuoteDetail,
  FreightQuoteSummary,
  FreightRequestView,
  LogisticsList,
  LogisticsOverview,
  LogisticsProviderView,
  LogisticsSettingsView,
  ShipmentDetail,
  ShipmentExceptionView,
  ShipmentPrefill,
  ShipmentSummary,
} from "@exportpro/types";
import { apiClient } from "../api-client";
import { uploadWithProgress } from "./inquiries";

type Body = Record<string, unknown>;
type Query = Record<string, string | number | boolean | undefined | null>;

const qs = (q: Query = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const file = (f: File, extra: Record<string, string | undefined> = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extra)) if (v) fd.append(k, v);
  fd.append("file", f);
  return fd;
};

export const freightApi = {
  list: (q: Query = {}) => apiClient.get<LogisticsList<FreightQuoteSummary>>(`/freight-quotes${qs(q)}`),
  detail: (id: string) => apiClient.get<FreightQuoteDetail>(`/freight-quotes/${id}`),
  create: (b: Body) => apiClient.post<FreightQuoteDetail>("/freight-quotes", b),
  update: (id: string, b: Body) => apiClient.patch<FreightQuoteDetail>(`/freight-quotes/${id}`, b),
  select: (id: string, b: Body) => apiClient.post<FreightQuoteDetail>(`/freight-quotes/${id}/select`, b),
  reject: (id: string, reason: string) => apiClient.post<FreightQuoteDetail>(`/freight-quotes/${id}/reject`, { reason }),
  cancel: (id: string, reason: string) => apiClient.post<FreightQuoteDetail>(`/freight-quotes/${id}/cancel`, { reason }),
  compare: (quoteIds: string[], targetCurrency?: string) => apiClient.post<FreightComparison>("/freight-quotes/compare", { quoteIds, targetCurrency }),
  attach: (id: string, f: File, onProgress: (p: number) => void) => uploadWithProgress<FreightQuoteDetail>(`/freight-quotes/${id}/attachments`, file(f), onProgress),
  providers: () => apiClient.get<LogisticsProviderView[]>("/logistics/providers"),
  createProvider: (b: Body) => apiClient.post<LogisticsProviderView>("/logistics/providers", b),
  requests: (purchaseOrderId?: string) => apiClient.get<FreightRequestView[]>(`/logistics/freight-requests${qs({ purchaseOrderId })}`),
  request: (id: string) => apiClient.get<FreightRequestView>(`/logistics/freight-requests/${id}`),
  requestPrefill: (purchaseOrderId: string) => apiClient.get<{ purchaseOrder: { id: string; poNumber: string; status: string; buyerName: string }; values: Record<string, FieldSourced<string | number | null>> }>(`/logistics/freight-requests/prefill${qs({ purchaseOrderId })}`),
  createRequest: (b: Body) => apiClient.post<FreightRequestView>("/logistics/freight-requests", b),
};

export const attachmentHref = (id: string) => `/api/v1/logistics/attachments/${id}/download`;

export const shipmentsApi = {
  overview: () => apiClient.get<LogisticsOverview>("/logistics/overview"),
  settings: () => apiClient.get<LogisticsSettingsView>("/logistics/settings"),
  updateSettings: (b: Body) => apiClient.patch<LogisticsSettingsView>("/logistics/settings", b),
  list: (q: Query = {}) => apiClient.get<LogisticsList<ShipmentSummary>>(`/shipments${qs(q)}`),
  prefill: (purchaseOrderId: string, freightQuoteId?: string) => apiClient.get<ShipmentPrefill>(`/shipments/prefill${qs({ purchaseOrderId, freightQuoteId })}`),
  create: (b: Body) => apiClient.post<ShipmentDetail>("/shipments", b),
  detail: (id: string) => apiClient.get<ShipmentDetail>(`/shipments/${id}`),
  update: (id: string, b: Body) => apiClient.patch<ShipmentDetail>(`/shipments/${id}`, b),
  status: (id: string, b: Body) => apiClient.post<ShipmentDetail>(`/shipments/${id}/status`, b),
  cancel: (id: string, reason: string) => apiClient.post<ShipmentDetail>(`/shipments/${id}/cancel`, { reason }),
  milestone: (id: string, mid: string, b: Body) => apiClient.patch<ShipmentDetail>(`/shipments/${id}/milestones/${mid}`, b),
  track: (id: string, b: Body) => apiClient.post<{ duplicate: boolean; shipment: ShipmentDetail }>(`/shipments/${id}/tracking`, b),
  refresh: (id: string) => apiClient.post<ShipmentDetail>(`/shipments/${id}/tracking/refresh`),
  addContainer: (id: string, b: Body) => apiClient.post<ShipmentDetail>(`/shipments/${id}/containers`, b),
  deleteContainer: (id: string, cid: string) => apiClient.delete<ShipmentDetail>(`/shipments/${id}/containers/${cid}`),
  addLeg: (id: string, b: Body) => apiClient.post<ShipmentDetail>(`/shipments/${id}/legs`, b),
  addException: (id: string, b: Body) => apiClient.post<ShipmentDetail>(`/shipments/${id}/exceptions`, b),
  resolveException: (eid: string, resolution: string) => apiClient.post<ShipmentDetail>(`/shipment-exceptions/${eid}/resolve`, { resolution }),
  exceptions: (q: Query = {}) => apiClient.get<LogisticsList<ShipmentExceptionView>>(`/shipment-exceptions${qs(q)}`),
  addClaim: (id: string, b: Body) => apiClient.post<ShipmentDetail>(`/shipments/${id}/claims`, b),
  updateClaim: (cid: string, b: Body) => apiClient.patch<ShipmentDetail>(`/shipment-claims/${cid}`, b),
  attach: (id: string, f: File, extra: { exceptionId?: string; claimId?: string }, onProgress: (p: number) => void) => uploadWithProgress<ShipmentDetail>(`/shipments/${id}/attachments`, file(f, extra), onProgress),
  generateUpdate: (id: string, trigger: string) => apiClient.post<ShipmentDetail>(`/shipments/${id}/buyer-updates/generate`, { trigger }),
  approveUpdate: (id: string, uid: string) => apiClient.post<ShipmentDetail>(`/shipments/${id}/buyer-updates/${uid}/approve`),
  recordSent: (id: string, uid: string, channel: string) => apiClient.post<ShipmentDetail>(`/shipments/${id}/buyer-updates/${uid}/record-sent`, { channel }),
  discardUpdate: (id: string, uid: string) => apiClient.post<ShipmentDetail>(`/shipments/${id}/buyer-updates/${uid}/discard`),
  costs: (id: string, b: Body) => apiClient.patch<ShipmentDetail>(`/shipments/${id}/costs`, b),
};
