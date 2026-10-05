import type { InvitationSummary, InviteMemberRequest, MemberSummary, UpdateMemberRoleRequest } from "@exportpro/types";
import { apiClient } from "../api-client";

export interface InvitationPreview {
  organizationName: string;
  email: string;
  role: string;
}

export const membersApi = {
  list: () => apiClient.get<MemberSummary[]>("/organizations/current/members"),
  invite: (body: InviteMemberRequest) => apiClient.post<InvitationSummary>("/organizations/current/invitations", body),
  updateRole: (membershipId: string, body: UpdateMemberRoleRequest) =>
    apiClient.patch<{ membershipId: string; role: string }>(`/organizations/current/members/${membershipId}`, body),
  remove: (membershipId: string) =>
    apiClient.delete<{ message: string }>(`/organizations/current/members/${membershipId}`),
};

export const invitationsApi = {
  preview: (token: string) => apiClient.get<InvitationPreview>(`/invitations/${token}`),
  accept: (token: string) => apiClient.post<{ organizationId: string }>(`/invitations/${token}/accept`),
};
