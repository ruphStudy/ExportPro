import type {
  CreateLeadInput,
  CreateLeadResult,
  CreateReminderInput,
  CreateTaskInput,
  CrmActivitiesResponse,
  CrmAttentionResponse,
  CrmLeadDetailResponse,
  CrmLeadListResponse,
  CrmLeadQuery,
  CrmLeadSummary,
  CrmMember,
  CrmPipelineResponse,
  CrmStage,
  LeadAttachment,
  LeadComment,
  LeadPriority,
  LeadReminder,
  LeadTag,
  LeadTask,
  LogActivityInput,
  LostReason,
  StageSuggestion,
  UpdateLeadInput,
  UpdateTaskInput,
} from "@exportpro/types";
import { apiClient } from "../api-client";

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export interface PipelineQuery {
  owner?: string;
  q?: string;
  priority?: LeadPriority;
  tagId?: string;
  includeClosed?: boolean;
}

export type CloseResult = { lead: CrmLeadSummary; openTasks: number; pendingReminders: number };

export const crmApi = {
  pipeline: (q: PipelineQuery) => apiClient.get<CrmPipelineResponse>(`/crm/pipeline${qs(q)}`),
  list: (q: CrmLeadQuery) => apiClient.get<CrmLeadListResponse>(`/crm/leads${qs(q)}`),
  create: (body: CreateLeadInput) => apiClient.post<CreateLeadResult>("/crm/leads", body),
  detail: (id: string) => apiClient.get<CrmLeadDetailResponse>(`/crm/leads/${id}`),
  update: (id: string, body: UpdateLeadInput) => apiClient.patch<CrmLeadSummary>(`/crm/leads/${id}`, body),
  stage: (id: string, body: { stage: CrmStage; reason?: string; expectedVersion?: number }) => apiClient.patch<CrmLeadSummary>(`/crm/leads/${id}/stage`, body),
  assign: (id: string, body: { ownerUserId: string | null; expectedVersion?: number }) => apiClient.patch<CrmLeadSummary>(`/crm/leads/${id}/assign`, body),
  won: (id: string, body: { reason?: string; value?: number; currency?: string; wonAt?: string; expectedVersion?: number }) => apiClient.post<CloseResult>(`/crm/leads/${id}/won`, body),
  lost: (id: string, body: { reason: LostReason; details?: string; expectedVersion?: number }) => apiClient.post<CloseResult>(`/crm/leads/${id}/lost`, body),
  reopen: (id: string, body: { stage: CrmStage; reason?: string }) => apiClient.post<CrmLeadSummary>(`/crm/leads/${id}/reopen`, body),
  activities: (id: string, q: { page?: number; pageSize?: number }) => apiClient.get<CrmActivitiesResponse>(`/crm/leads/${id}/activities${qs(q)}`),
  logActivity: (id: string, body: LogActivityInput) => apiClient.post<{ lead: CrmLeadSummary; suggestion: StageSuggestion | null }>(`/crm/leads/${id}/activities`, body),
  comment: (id: string, body: string) => apiClient.post<LeadComment>(`/crm/leads/${id}/comments`, { body }),
  editComment: (id: string, commentId: string, body: string) => apiClient.patch<LeadComment>(`/crm/leads/${id}/comments/${commentId}`, { body }),
  tasks: (q: { scope?: "mine" | "all"; status?: string; overdue?: boolean; page?: number; pageSize?: number }) => apiClient.get<{ items: LeadTask[]; meta: import("@exportpro/types").PaginationMeta }>(`/crm/tasks${qs(q)}`),
  createTask: (id: string, body: CreateTaskInput) => apiClient.post<LeadTask>(`/crm/leads/${id}/tasks`, body),
  updateTask: (taskId: string, body: UpdateTaskInput) => apiClient.patch<LeadTask>(`/crm/tasks/${taskId}`, body),
  completeTask: (taskId: string) => apiClient.post<LeadTask>(`/crm/tasks/${taskId}/complete`),
  createReminder: (id: string, body: CreateReminderInput) => apiClient.post<LeadReminder>(`/crm/leads/${id}/reminders`, body),
  updateReminder: (reminderId: string, body: { status?: "DISMISSED" | "CANCELLED"; remindAt?: string }) => apiClient.patch<LeadReminder>(`/crm/reminders/${reminderId}`, body),
  tags: () => apiClient.get<LeadTag[]>("/crm/tags"),
  createTag: (name: string) => apiClient.post<LeadTag>("/crm/tags", { name }),
  members: () => apiClient.get<CrmMember[]>("/crm/members"),
  attention: (scope: "mine" | "all") => apiClient.get<CrmAttentionResponse>(`/crm/attention${qs({ scope })}`),
  uploadAttachment: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiClient.post<LeadAttachment>(`/crm/leads/${id}/attachments`, fd);
  },
  deleteAttachment: (id: string, attachmentId: string) => apiClient.delete<{ id: string }>(`/crm/leads/${id}/attachments/${attachmentId}`),
  downloadHref: (id: string, attachmentId: string) => `/api/v1/crm/leads/${id}/attachments/${attachmentId}/download`,
};

/** Accept list for the attachment file input — mirrors the API allow-list. */
export const ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx,.xlsx";
