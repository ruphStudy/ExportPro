import type {
  MarketComparisonResponse,
  ProductComparisonResponse,
  RecommendationFilters,
  RecommendationsResponse,
} from "@exportpro/types";
import { apiClient } from "../api-client";

export const MAX_COMPARE = 5;
export const MIN_COMPARE = 2;

export const comparisonsApi = {
  products: (productIds: string[]) => apiClient.post<ProductComparisonResponse>("/comparisons/products", { productIds }),
  markets: (productId: string, countryCodes: string[]) =>
    apiClient.post<MarketComparisonResponse>("/comparisons/markets", { productId, countryCodes }),
  recommendations: (filters: RecommendationFilters) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "" && v !== false) params.set(k, String(v));
    const qs = params.toString();
    return apiClient.get<RecommendationsResponse>(`/recommendations${qs ? `?${qs}` : ""}`);
  },
};

/** Parse a comma-separated URL param into a de-duplicated, capped list. */
export function parseIdList(value: string | null, max = MAX_COMPARE): string[] {
  return [...new Set((value ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, max);
}
