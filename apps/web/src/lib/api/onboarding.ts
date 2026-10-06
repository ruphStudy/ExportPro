import type {
  CertificationSummary,
  CreateCertificationRequest,
  CreateProductInterestRequest,
  ExporterProfileSummary,
  OnboardingDocumentSummary,
  ProductInterestSummary,
  ReadinessResponse,
  RegistrationSummary,
  RegistrationType,
  TargetCountrySummary,
  UpdateCertificationRequest,
  UpdateExporterBusinessProfileRequest,
  UpdateExporterPreferencesRequest,
  UpdateExporterProductsRequest,
  UpdateOnboardingProgressRequest,
  UpdateProductInterestRequest,
  UpsertRegistrationRequest,
} from "@exportpro/types";
import { apiClient } from "../api-client";

export const onboardingApi = {
  get: () => apiClient.get<ExporterProfileSummary>("/export-onboarding"),
  updateProfile: (body: UpdateExporterBusinessProfileRequest) =>
    apiClient.patch<ExporterProfileSummary>("/export-onboarding/profile", body),
  updateProducts: (body: UpdateExporterProductsRequest) =>
    apiClient.patch<ExporterProfileSummary>("/export-onboarding/products", body),
  updatePreferences: (body: UpdateExporterPreferencesRequest) =>
    apiClient.patch<ExporterProfileSummary>("/export-onboarding/preferences", body),
  updateProgress: (body: UpdateOnboardingProgressRequest) =>
    apiClient.patch<ExporterProfileSummary>("/export-onboarding/progress", body),
  complete: () => apiClient.post<ExporterProfileSummary>("/export-onboarding/complete"),
  readiness: () => apiClient.get<ReadinessResponse>("/export-onboarding/readiness"),
};

export const productInterestsApi = {
  list: () => apiClient.get<ProductInterestSummary[]>("/export-onboarding/products"),
  create: (body: CreateProductInterestRequest) =>
    apiClient.post<ProductInterestSummary>("/export-onboarding/products", body),
  update: (id: string, body: UpdateProductInterestRequest) =>
    apiClient.patch<ProductInterestSummary>(`/export-onboarding/products/${id}`, body),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/export-onboarding/products/${id}`),
};

export const targetCountriesApi = {
  list: () => apiClient.get<TargetCountrySummary[]>("/export-onboarding/countries"),
  upsert: (body: { countryCode: string; relation: TargetCountrySummary["relation"] }) =>
    apiClient.post<TargetCountrySummary>("/export-onboarding/countries", body),
  remove: (countryCode: string) =>
    apiClient.delete<{ message: string }>(`/export-onboarding/countries/${countryCode}`),
};

export const registrationsApi = {
  list: () => apiClient.get<RegistrationSummary[]>("/export-onboarding/registrations"),
  upsert: (type: RegistrationType, body: UpsertRegistrationRequest) =>
    apiClient.patch<RegistrationSummary>(`/export-onboarding/registrations/${type}`, body),
  uploadDocument: (type: RegistrationType, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.post<OnboardingDocumentSummary>(`/export-onboarding/registrations/${type}/document`, form);
  },
  removeDocument: (documentId: string) =>
    apiClient.delete<{ message: string }>(`/export-onboarding/registrations/documents/${documentId}`),
};

export const certificationsApi = {
  list: () => apiClient.get<CertificationSummary[]>("/export-onboarding/certifications"),
  create: (body: CreateCertificationRequest) =>
    apiClient.post<CertificationSummary>("/export-onboarding/certifications", body),
  update: (id: string, body: UpdateCertificationRequest) =>
    apiClient.patch<CertificationSummary>(`/export-onboarding/certifications/${id}`, body),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/export-onboarding/certifications/${id}`),
  uploadDocument: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.post<OnboardingDocumentSummary>(`/export-onboarding/certifications/${id}/document`, form);
  },
  removeDocument: (documentId: string) =>
    apiClient.delete<{ message: string }>(`/export-onboarding/certifications/documents/${documentId}`),
};
