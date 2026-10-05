import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  ResendVerificationRequest,
  ResetPasswordRequest,
  SessionContext,
  SessionDeviceSummary,
  SignupRequest,
  SignupResponse,
  VerifyEmailRequest,
} from "@exportpro/types";
import { apiClient } from "../api-client";

export const authApi = {
  signup: (body: SignupRequest) => apiClient.post<SignupResponse>("/auth/signup", body),
  verifyEmail: (body: VerifyEmailRequest) => apiClient.post<{ message: string }>("/auth/verify-email", body),
  resendVerification: (body: ResendVerificationRequest) =>
    apiClient.post<{ message: string }>("/auth/resend-verification", body),
  login: (body: LoginRequest) => apiClient.post<SessionContext>("/auth/login", body),
  logout: () => apiClient.post<{ message: string }>("/auth/logout"),
  logoutOthers: () => apiClient.post<{ message: string }>("/auth/logout-others"),
  forgotPassword: (body: ForgotPasswordRequest) => apiClient.post<{ message: string }>("/auth/forgot-password", body),
  resetPassword: (body: ResetPasswordRequest) => apiClient.post<{ message: string }>("/auth/reset-password", body),
  changePassword: (body: ChangePasswordRequest) => apiClient.post<{ message: string }>("/auth/change-password", body),
};

export const sessionsApi = {
  list: () => apiClient.get<SessionDeviceSummary[]>("/sessions"),
  revoke: (id: string) => apiClient.delete<{ message: string }>(`/sessions/${id}`),
};
