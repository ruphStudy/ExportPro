import type { UserSummary } from "@exportpro/types";
import { apiClient } from "../api-client";

export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export const profileApi = {
  update: (body: UpdateProfileRequest) => apiClient.patch<UserSummary>("/profile", body),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.post<UserSummary>("/profile/avatar", form);
  },
  removeAvatar: () => apiClient.delete<UserSummary>("/profile/avatar"),
};
