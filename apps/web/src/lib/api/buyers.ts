import type {
  AddToCrmResult,
  BuyerDetail,
  BuyerOrgState,
  BuyerSearchQuery,
  BuyerSearchResponse,
  CreateManualBuyerInput,
  SavedBuyersResponse,
} from "@exportpro/types";
import { apiClient } from "../api-client";

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export interface BuyerContextQuery {
  productId?: string;
  hsCode?: string;
  productName?: string;
  country?: string;
}

export const buyersApi = {
  search: (q: BuyerSearchQuery) => apiClient.get<BuyerSearchResponse>(`/buyers${qs(q)}`),
  detail: (id: string, ctx: BuyerContextQuery) => apiClient.get<BuyerDetail>(`/buyers/${id}${qs(ctx)}`),
  saved: (q: { page?: number; pageSize?: number }) => apiClient.get<SavedBuyersResponse>(`/buyers/saved${qs(q)}`),
  save: (id: string, body: { productId?: string; countryCode?: string }) => apiClient.post<BuyerOrgState>(`/buyers/${id}/save`, body),
  unsave: (id: string) => apiClient.delete<BuyerOrgState>(`/buyers/${id}/save`),
  notes: (id: string, notes: string) => apiClient.patch<BuyerOrgState>(`/buyers/${id}/notes`, { notes }),
  addToCrm: (id: string, body: { productId?: string; countryCode?: string; context?: string }) => apiClient.post<AddToCrmResult>(`/buyers/${id}/add-to-crm`, body),
  create: (body: CreateManualBuyerInput) => apiClient.post<{ id: string }>("/buyers", body),
};

/** Deep link into Buyer Search with product/market context prefilled. */
export function findBuyersHref(ctx: { productId?: string | null; hsCode?: string | null; country?: string | null }) {
  return `/buyers${qs({ productId: ctx.productId ?? undefined, hsCode: ctx.productId ? undefined : (ctx.hsCode ?? undefined), country: ctx.country ?? undefined })}`;
}
