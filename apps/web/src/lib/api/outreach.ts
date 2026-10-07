import type {
  BuyerOutreachHistory,
  CampaignDetail,
  CampaignDraftInput,
  CampaignListResponse,
  CampaignStatus,
  GenerateContentInput,
  GeneratedContent,
  LaunchCheck,
  MessageListResponse,
  OutreachMessageDetail,
  OutreachSettings,
  OutreachSettingsInput,
  OutreachTemplate,
  RecipientListResponse,
  RecipientView,
  RenderedPreview,
  SuppressionView,
  TemplateInput,
  TemplateValidation,
} from "@exportpro/types";
import { apiClient } from "../api-client";

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export interface MessageQuery {
  q?: string;
  campaignId?: string;
  buyerId?: string;
  leadId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const outreachApi = {
  settings: () => apiClient.get<OutreachSettings>("/outreach/settings"),
  updateSettings: (body: OutreachSettingsInput) => apiClient.put<OutreachSettings>("/outreach/settings", body),
  verifyDomain: () => apiClient.post<OutreachSettings>("/outreach/settings/verify-domain"),
  templates: (includeArchived = false) => apiClient.get<OutreachTemplate[]>(`/outreach/templates${qs({ includeArchived })}`),
  createTemplate: (body: TemplateInput) => apiClient.post<OutreachTemplate>("/outreach/templates", body),
  updateTemplate: (id: string, body: Partial<TemplateInput> & { active?: boolean }) => apiClient.patch<OutreachTemplate>(`/outreach/templates/${id}`, body),
  duplicateTemplate: (id: string) => apiClient.post<OutreachTemplate>(`/outreach/templates/${id}/duplicate`),
  validate: (subject: string, body: string) => apiClient.post<TemplateValidation>("/outreach/templates/validate", { subject, body }),
  generate: (body: GenerateContentInput) => apiClient.post<GeneratedContent>("/outreach/generate", body),
  campaigns: (q: { status?: CampaignStatus; q?: string; page?: number }) => apiClient.get<CampaignListResponse>(`/outreach/campaigns${qs(q)}`),
  createCampaign: (body: { name?: string; productId?: string; countryCode?: string; buyerIds?: string[]; leadId?: string }) => apiClient.post<CampaignDetail>("/outreach/campaigns", body),
  campaign: (id: string) => apiClient.get<CampaignDetail>(`/outreach/campaigns/${id}`),
  updateCampaign: (id: string, body: CampaignDraftInput) => apiClient.patch<CampaignDetail>(`/outreach/campaigns/${id}`, body),
  setRecipients: (id: string, buyerIds: string[]) => apiClient.put<RecipientListResponse>(`/outreach/campaigns/${id}/recipients`, { buyerIds }),
  recipients: (id: string, q: { status?: string; page?: number; pageSize?: number }) => apiClient.get<RecipientListResponse>(`/outreach/campaigns/${id}/recipients${qs(q)}`),
  preview: (id: string, body: { subject?: string; body?: string }) => apiClient.post<RenderedPreview[]>(`/outreach/campaigns/${id}/preview`, body),
  launchCheck: (id: string) => apiClient.get<LaunchCheck>(`/outreach/campaigns/${id}/launch-check`),
  launch: (id: string) => apiClient.post<{ campaign: CampaignDetail; alreadyLaunched: boolean }>(`/outreach/campaigns/${id}/launch`, { confirm: true }),
  testSend: (id: string) => apiClient.post<{ sentTo: string; simulated: boolean; message: string }>(`/outreach/campaigns/${id}/test-send`),
  pause: (id: string) => apiClient.post<CampaignDetail>(`/outreach/campaigns/${id}/pause`),
  resume: (id: string) => apiClient.post<CampaignDetail>(`/outreach/campaigns/${id}/resume`),
  cancel: (id: string) => apiClient.post<CampaignDetail>(`/outreach/campaigns/${id}/cancel`),
  markReplied: (rid: string) => apiClient.post<RecipientView>(`/outreach/recipients/${rid}/replied`),
  markInterested: (rid: string, interested: boolean) => apiClient.post<RecipientView>(`/outreach/recipients/${rid}/interested`, { interested }),
  cancelRecipient: (rid: string) => apiClient.post<RecipientView>(`/outreach/recipients/${rid}/cancel`),
  messages: (q: MessageQuery) => apiClient.get<MessageListResponse>(`/outreach/messages${qs(q)}`),
  message: (id: string) => apiClient.get<OutreachMessageDetail>(`/outreach/messages/${id}`),
  buyerHistory: (buyerId: string) => apiClient.get<BuyerOutreachHistory>(`/outreach/buyers/${buyerId}/history`),
  suppressions: () => apiClient.get<SuppressionView[]>("/outreach/suppressions"),
  addSuppression: (address: string) => apiClient.post<SuppressionView[]>("/outreach/suppressions", { address }),
  unsubscribeStatus: (token: string) => apiClient.get<{ unsubscribed: boolean }>(`/outreach/public/unsubscribe/${token}`),
  unsubscribe: (token: string) => apiClient.post<{ unsubscribed: boolean }>(`/outreach/public/unsubscribe/${token}`),
};

/** Builder deep link with context prefill (buyer profile, CRM lead, saved buyers). */
export function newCampaignHref(ctx: { buyerIds?: string[]; productId?: string | null; country?: string | null; leadId?: string | null }) {
  return `/outreach/campaigns/new${qs({ buyers: ctx.buyerIds?.join(","), productId: ctx.productId ?? undefined, country: ctx.country ?? undefined, leadId: ctx.leadId ?? undefined })}`;
}
