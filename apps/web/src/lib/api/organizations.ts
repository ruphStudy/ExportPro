import type {
  CreateOrganizationRequest,
  MembershipSummary,
  OrganizationSummary,
  SessionContext,
  SwitchOrganizationRequest,
  UpdateOrganizationRequest,
} from "@exportpro/types";
import { apiClient } from "../api-client";

export const organizationsApi = {
  create: (body: CreateOrganizationRequest) => apiClient.post<SessionContext>("/organizations", body),
  mine: () => apiClient.get<MembershipSummary[]>("/organizations/mine"),
  getCurrent: () => apiClient.get<OrganizationSummary>("/organizations/current"),
  update: (body: UpdateOrganizationRequest) => apiClient.patch<OrganizationSummary>("/organizations/current", body),
  uploadLogo: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.post<OrganizationSummary>("/organizations/current/logo", form);
  },
  removeLogo: () => apiClient.delete<OrganizationSummary>("/organizations/current/logo"),
  switch: (body: SwitchOrganizationRequest) => apiClient.post<SessionContext>("/organizations/switch", body),
};
