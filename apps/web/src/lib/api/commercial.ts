import type { CommercialActionSummary, CommercialList, CommercialSettings, PiDetail, PiSummary, PoDetail, PoSummary, QuotationDetail, QuotationSummary } from "@exportpro/types";
import { apiClient } from "../api-client";
import { uploadWithProgress } from "./inquiries";

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export interface CommercialListQuery {
  search?: string;
  status?: string;
  buyerCompanyId?: string;
  crmLeadId?: string;
  inquiryId?: string;
  costingId?: string;
  quotationId?: string;
  productId?: string;
  country?: string;
  createdBy?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

type Body = Record<string, unknown>;

export const quotationsApi = {
  list: (q: CommercialListQuery) => apiClient.get<CommercialList<QuotationSummary>>(`/quotations${qs(q)}`),
  get: (id: string) => apiClient.get<QuotationDetail>(`/quotations/${id}`),
  create: (b: Body) => apiClient.post<QuotationDetail>("/quotations", b),
  update: (id: string, b: Body) => apiClient.patch<QuotationDetail>(`/quotations/${id}`, b),
  issue: (id: string, v: number) => apiClient.post<QuotationDetail>(`/quotations/${id}/issue`, { expectedRowVersion: v }),
  revise: (id: string, reason: string) => apiClient.post<QuotationDetail>(`/quotations/${id}/revise`, { reason }),
  accept: (id: string, b: Body) => apiClient.post<QuotationDetail>(`/quotations/${id}/accept`, b),
  reject: (id: string, reason: string, v: number) => apiClient.post<QuotationDetail>(`/quotations/${id}/reject`, { reason, expectedRowVersion: v }),
  cancel: (id: string, reason: string, v: number) => apiClient.post<QuotationDetail>(`/quotations/${id}/cancel`, { reason, expectedRowVersion: v }),
  pdfHref: (id: string) => `/api/v1/quotations/${id}/pdf`,
};

export const piApi = {
  list: (q: CommercialListQuery) => apiClient.get<CommercialList<PiSummary>>(`/proforma-invoices${qs(q)}`),
  get: (id: string) => apiClient.get<PiDetail>(`/proforma-invoices/${id}`),
  create: (b: Body) => apiClient.post<PiDetail>("/proforma-invoices", b),
  update: (id: string, b: Body) => apiClient.patch<PiDetail>(`/proforma-invoices/${id}`, b),
  issue: (id: string, v: number) => apiClient.post<PiDetail>(`/proforma-invoices/${id}/issue`, { expectedRowVersion: v }),
  revise: (id: string, reason: string) => apiClient.post<PiDetail>(`/proforma-invoices/${id}/revise`, { reason }),
  cancel: (id: string, reason: string, v: number) => apiClient.post<PiDetail>(`/proforma-invoices/${id}/cancel`, { reason, expectedRowVersion: v }),
  pdfHref: (id: string) => `/api/v1/proforma-invoices/${id}/pdf`,
};

export const poApi = {
  list: (q: CommercialListQuery) => apiClient.get<CommercialList<PoSummary>>(`/purchase-orders${qs(q)}`),
  get: (id: string) => apiClient.get<PoDetail>(`/purchase-orders/${id}`),
  create: (b: Body) => apiClient.post<PoDetail>("/purchase-orders", b),
  upload: (file: File, fields: Record<string, string | undefined>, onProgress: (p: number) => void) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
    fd.append("file", file);
    return uploadWithProgress<PoDetail>("/purchase-orders/upload", fd, onProgress);
  },
  update: (id: string, b: Body) => apiClient.patch<PoDetail>(`/purchase-orders/${id}`, b),
  compare: (id: string) => apiClient.post<PoDetail>(`/purchase-orders/${id}/compare`),
  resolve: (id: string, did: string, status: string, note: string) => apiClient.post<PoDetail>(`/purchase-orders/${id}/discrepancies/${did}/resolve`, { status, note }),
  accept: (id: string, v: number, overrideReason?: string) => apiClient.post<PoDetail>(`/purchase-orders/${id}/accept`, { expectedRowVersion: v, overrideReason }),
  reject: (id: string, reason: string, v: number) => apiClient.post<PoDetail>(`/purchase-orders/${id}/reject`, { reason, expectedRowVersion: v }),
  clarify: (id: string, reason: string, v: number) => apiClient.post<PoDetail>(`/purchase-orders/${id}/request-clarification`, { reason, expectedRowVersion: v }),
  cancel: (id: string, reason: string, v: number) => apiClient.post<PoDetail>(`/purchase-orders/${id}/cancel`, { reason, expectedRowVersion: v }),
  addAttachment: (id: string, file: File, onProgress: (p: number) => void) => {
    const fd = new FormData();
    fd.append("file", file);
    return uploadWithProgress<PoDetail>(`/purchase-orders/${id}/attachments`, fd, onProgress);
  },
  attachmentHref: (id: string, aid: string) => `/api/v1/purchase-orders/${id}/attachments/${aid}/download`,
};

export const commercialApi = {
  settings: () => apiClient.get<CommercialSettings>("/commercial/settings"),
  updateSettings: (b: Body) => apiClient.patch<CommercialSettings>("/commercial/settings", b),
  starterTerms: () => apiClient.get<{ text: string; notice: string }>("/commercial/starter-terms"),
  summary: () => apiClient.get<CommercialActionSummary>("/commercial/summary"),
};

/** Display formatting only (amounts come computed from the API). */
export function fmtAmount(v: string | null | undefined, currency?: string) {
  if (v === null || v === undefined) return "—";
  const [i, d] = v.split(".");
  const neg = i.startsWith("-");
  const g = (neg ? i.slice(1) : i).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency ? `${currency} ` : ""}${neg ? "-" : ""}${g}${d ? `.${d}` : ""}`;
}
