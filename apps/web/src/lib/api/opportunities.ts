import type {
  CreateSavedSearchRequest,
  OpportunityDetail,
  OpportunityDiscoveryResponse,
  OpportunityScoreSnapshotEntry,
  OpportunitySearchRequest,
  OpportunitySearchResponse,
  SaveOpportunityRequest,
  SavedOpportunity,
  SavedSearch,
  UpdateSavedSearchRequest,
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

export const opportunitiesApi = {
  discovery: () => apiClient.get<OpportunityDiscoveryResponse>("/opportunities/discovery"),
  search: (filters: OpportunitySearchRequest) =>
    apiClient.get<OpportunitySearchResponse>(`/opportunities${toQueryString(filters)}`),
  getById: (id: string) => apiClient.get<OpportunityDetail>(`/opportunities/${id}`),
  history: (id: string) => apiClient.get<OpportunityScoreSnapshotEntry[]>(`/opportunities/${id}/history`),
};

export const watchlistApi = {
  list: () => apiClient.get<SavedOpportunity[]>("/opportunities/watchlist"),
  save: (id: string, body?: SaveOpportunityRequest) => apiClient.post<{ message: string }>(`/opportunities/${id}/save`, body),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/opportunities/${id}/save`),
};

export const savedSearchesApi = {
  list: () => apiClient.get<SavedSearch[]>("/opportunities/saved-searches"),
  create: (body: CreateSavedSearchRequest) => apiClient.post<SavedSearch>("/opportunities/saved-searches", body),
  update: (id: string, body: UpdateSavedSearchRequest) =>
    apiClient.patch<SavedSearch>(`/opportunities/saved-searches/${id}`, body),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/opportunities/saved-searches/${id}`),
};
