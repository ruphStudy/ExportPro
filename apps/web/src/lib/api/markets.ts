import type {
  CountryDetailResponse,
  CountryListResponse,
  MarketDeepAnalysisResponse,
  ProductMarketsQuery,
  ProductMarketsResponse,
} from "@exportpro/types";
import { apiClient } from "../api-client";

function qs(params: object): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : "";
}

export const marketsApi = {
  productMarkets: (productId: string, query: ProductMarketsQuery) =>
    apiClient.get<ProductMarketsResponse>(`/products/${productId}/markets${qs(query)}`),
  deepAnalysis: (productId: string, countryCode: string) =>
    apiClient.get<MarketDeepAnalysisResponse>(`/products/${productId}/markets/${countryCode}`),
  countries: (query: { q?: string; region?: string; page?: number; pageSize?: number }) =>
    apiClient.get<CountryListResponse>(`/countries${qs(query)}`),
  country: (countryCode: string, page = 1) => apiClient.get<CountryDetailResponse>(`/countries/${countryCode}${qs({ page, pageSize: 20 })}`),
};
