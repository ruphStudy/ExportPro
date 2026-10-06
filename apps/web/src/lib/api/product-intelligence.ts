import type { ProductIntelligenceResponse, ProductIntelligenceSummaryItem } from "@exportpro/types";
import { apiClient } from "../api-client";

export const productIntelligenceApi = {
  get: (productId: string) => apiClient.get<ProductIntelligenceResponse>(`/products/${productId}/intelligence`),
  summary: (productIds: string[]) =>
    apiClient.get<ProductIntelligenceSummaryItem[]>(
      `/product-intelligence/summary?productIds=${encodeURIComponent(productIds.join(","))}`,
    ),
};

export function formatMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatQuantity(value: number | null | undefined, unit: string | null): string {
  if (value === null || value === undefined) return "—";
  const n = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return unit ? `${n} ${unit}` : n;
}

export function formatPercent(value: number | null | undefined, signed = true): string {
  if (value === null || value === undefined) return "—";
  return `${signed && value > 0 ? "+" : ""}${value}%`;
}
