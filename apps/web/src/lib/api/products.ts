import type {
  ChangeProductClassificationRequest,
  ClarifyProductAnalysisRequest,
  CodeSystem,
  ConfirmClassificationRequest,
  ConfirmClassificationResponse,
  HSReferenceSearchResponse,
  ProductAnalysisInput,
  ProductAnalysisResponse,
  ProductDetail,
  ProductListQuery,
  ProductListResponse,
  RecentProductAnalysis,
  SelectClassificationRequest,
  UpdateProductRequest,
} from "@exportpro/types";
import { apiClient } from "../api-client";

function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const productAnalysisApi = {
  analyze: (body: ProductAnalysisInput) => apiClient.post<ProductAnalysisResponse>("/product-analysis", body),
  recent: () => apiClient.get<RecentProductAnalysis[]>("/product-analysis/recent"),
  getById: (id: string) => apiClient.get<ProductAnalysisResponse>(`/product-analysis/${id}`),
  clarify: (id: string, body: ClarifyProductAnalysisRequest) =>
    apiClient.post<ProductAnalysisResponse>(`/product-analysis/${id}/clarify`, body),
  reanalyze: (id: string) => apiClient.post<ProductAnalysisResponse>(`/product-analysis/${id}/reanalyze`),
  select: (id: string, body: SelectClassificationRequest) =>
    apiClient.post<ProductAnalysisResponse>(`/product-analysis/${id}/select`, body),
  confirm: (id: string, body: ConfirmClassificationRequest) =>
    apiClient.post<ConfirmClassificationResponse>(`/product-analysis/${id}/confirm`, body),
};

export const tariffReferenceApi = {
  search: (q: string, codeSystem: CodeSystem | undefined, page: number, signal?: AbortSignal) =>
    apiClient.get<HSReferenceSearchResponse>(
      `/product-classifications/search${toQueryString({ q, codeSystem, page, pageSize: 10 })}`,
      { signal },
    ),
};

export const productsApi = {
  list: (query: ProductListQuery) => apiClient.get<ProductListResponse>(`/products${toQueryString(query)}`),
  getById: (id: string) => apiClient.get<ProductDetail>(`/products/${id}`),
  update: (id: string, body: UpdateProductRequest) => apiClient.patch<ProductDetail>(`/products/${id}`, body),
  changeClassification: (id: string, body: ChangeProductClassificationRequest) =>
    apiClient.patch<ProductDetail>(`/products/${id}/classification`, body),
  reanalyze: (id: string) => apiClient.post<ProductAnalysisResponse>(`/products/${id}/reanalyze`),
};
