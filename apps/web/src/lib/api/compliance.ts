import type { ChecklistSummary, ComplianceChecklistView, ComplianceOverview, ComplianceRuleView, DocumentTemplateView, TradeDocumentDetail, TradeDocumentList } from "@exportpro/types";
import { apiClient } from "../api-client";
import { uploadWithProgress } from "./inquiries";

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

type Body = Record<string, unknown>;

export const complianceApi = {
  overview: () => apiClient.get<ComplianceOverview>("/compliance/overview"),
  checklists: (q: { purchaseOrderId?: string; quotationId?: string; readiness?: string }) => apiClient.get<ChecklistSummary[]>(`/compliance/checklists${qs(q)}`),
  forPo: (poId: string) => apiClient.get<ComplianceChecklistView>(`/compliance/orders/${poId}`),
  evaluatePo: (poId: string) => apiClient.post<ComplianceChecklistView>(`/compliance/orders/${poId}/evaluate`),
  forQuotation: (qid: string) => apiClient.get<ComplianceChecklistView>(`/compliance/quotations/${qid}`),
  evaluateQuotation: (qid: string) => apiClient.post<ComplianceChecklistView>(`/compliance/quotations/${qid}/evaluate`),
  markReady: (poId: string, v: number, note?: string) => apiClient.post<ComplianceChecklistView>(`/compliance/orders/${poId}/mark-ready`, { expectedRowVersion: v, note }),
  updateRequirement: (id: string, b: Body) => apiClient.patch<ComplianceChecklistView>(`/compliance/requirements/${id}`, b),
  override: (id: string, kind: string, reason: string) => apiClient.post<ComplianceChecklistView>(`/compliance/requirements/${id}/override`, { kind, reason }),
  clearOverride: (id: string) => apiClient.delete<ComplianceChecklistView>(`/compliance/requirements/${id}/override`),
  addRequirement: (checklistId: string, b: Body) => apiClient.post<ComplianceChecklistView>(`/compliance/checklists/${checklistId}/requirements`, b),
  rules: () => apiClient.get<ComplianceRuleView[]>("/compliance/rules"),
};

export interface DocumentListQuery {
  tab?: string;
  search?: string;
  documentType?: string;
  status?: string;
  source?: string;
  buyerCompanyId?: string;
  purchaseOrderId?: string;
  expiry?: string;
  createdBy?: string;
  page?: number;
  pageSize?: number;
}

export const documentsApi = {
  list: (q: DocumentListQuery) => apiClient.get<TradeDocumentList>(`/documents${qs(q)}`),
  get: (id: string) => apiClient.get<TradeDocumentDetail>(`/documents/${id}`),
  generate: (b: Body) => apiClient.post<TradeDocumentDetail>("/documents/generate", b),
  createReference: (b: Body) => apiClient.post<TradeDocumentDetail>("/documents", b),
  upload: (file: File, fields: Record<string, string | undefined>, onProgress: (p: number) => void) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
    fd.append("file", file);
    return uploadWithProgress<TradeDocumentDetail>("/documents/upload", fd, onProgress);
  },
  update: (id: string, b: Body) => apiClient.patch<TradeDocumentDetail>(`/documents/${id}`, b),
  review: (id: string, v: number) => apiClient.post<TradeDocumentDetail>(`/documents/${id}/review`, { expectedRowVersion: v }),
  approve: (id: string, v: number, overrideReason?: string) => apiClient.post<TradeDocumentDetail>(`/documents/${id}/approve`, { expectedRowVersion: v, overrideReason }),
  reject: (id: string, v: number, reason: string) => apiClient.post<TradeDocumentDetail>(`/documents/${id}/reject`, { expectedRowVersion: v, reason }),
  revise: (id: string, reason: string) => apiClient.post<TradeDocumentDetail>(`/documents/${id}/revise`, { reason }),
  archive: (id: string, v: number, reason: string) => apiClient.post<TradeDocumentDetail>(`/documents/${id}/archive`, { expectedRowVersion: v, reason }),
  templates: () => apiClient.get<DocumentTemplateView[]>("/documents/templates"),
  updateTemplate: (b: Body) => apiClient.patch<DocumentTemplateView[]>("/documents/templates", b),
  pdfHref: (id: string) => `/api/v1/documents/${id}/pdf`,
  downloadHref: (id: string) => `/api/v1/documents/${id}/download`,
};
