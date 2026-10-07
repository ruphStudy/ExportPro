import type { DocumentExtractionOverview, DocumentExtractionView, DocumentValidationRunView, ValidationDashboard, ValidationPackageView } from "@exportpro/types";
import { apiClient } from "../api-client";

type Body = Record<string, unknown>;

export const extractionApi = {
  overview: (docId: string) => apiClient.get<DocumentExtractionOverview>(`/documents/${docId}/extractions`),
  one: (docId: string, id: string) => apiClient.get<DocumentExtractionView>(`/documents/${docId}/extractions/${id}`),
  extract: (docId: string, force = false) => apiClient.post<DocumentExtractionOverview>(`/documents/${docId}/extract`, { force }),
  confirm: (docId: string, extractionId: string, b: Body) => apiClient.post<DocumentExtractionOverview>(`/documents/${docId}/extractions/${extractionId}/confirm`, b),
  manual: (docId: string, b: Body) => apiClient.post<DocumentExtractionOverview>(`/documents/${docId}/extract/manual`, b),
};

export const validationApi = {
  validateDocument: (docId: string) => apiClient.post<DocumentValidationRunView>(`/documents/${docId}/validate`),
  documentRuns: (docId: string) => apiClient.get<DocumentValidationRunView[]>(`/documents/${docId}/validations`),
  run: (runId: string) => apiClient.get<DocumentValidationRunView>(`/document-validation/runs/${runId}`),
  signOff: (runId: string, b: Body) => apiClient.post<DocumentValidationRunView>(`/document-validation/runs/${runId}/sign-off`, b),
  reject: (runId: string, reason: string) => apiClient.post<DocumentValidationRunView>(`/document-validation/runs/${runId}/reject`, { reason }),
  runComment: (runId: string, body: string) => apiClient.post<DocumentValidationRunView>(`/document-validation/runs/${runId}/comments`, { body }),
  resolve: (findingId: string, status: string, note?: string) => apiClient.post<DocumentValidationRunView>(`/document-validation/findings/${findingId}/resolve`, { status, note }),
  findingComment: (findingId: string, body: string) => apiClient.post<DocumentValidationRunView>(`/document-validation/findings/${findingId}/comments`, { body }),
  packageView: (poId: string) => apiClient.get<ValidationPackageView>(`/document-validation/orders/${poId}`),
  runPackage: (poId: string) => apiClient.post<ValidationPackageView>(`/document-validation/orders/${poId}/run`),
  dashboard: () => apiClient.get<ValidationDashboard>("/document-validation/dashboard"),
};
