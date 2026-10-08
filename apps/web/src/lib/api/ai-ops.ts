import type {
  ActionCenterList,
  ActionCenterSummary,
  ActionItemView,
  AiActionDefinitionView,
  AiConfirmResult,
  AiExecutionView,
  AiResponse,
  AnalyticsSection,
  AutomationEvaluation,
  AutomationRuleView,
  AutomationRunView,
  AutomationTemplate,
  ExecutiveOverview,
} from "@exportpro/types";
import { apiClient } from "../api-client";

type Body = Record<string, unknown>;
type Query = Record<string, string | number | boolean | undefined | null>;
const qs = (q: Query = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const aiManagerApi = {
  catalog: () => apiClient.get<{ actions: AiActionDefinitionView[]; quickCommands: { label: string; command: string }[]; provider: { name: string; available: boolean } }>("/ai-manager/catalog"),
  message: (b: { message?: string; command?: string; conversationId?: string | null }) => apiClient.post<AiResponse>("/ai-manager/message", { ...b, conversationId: b.conversationId || undefined }),
  confirm: (id: string) => apiClient.post<AiConfirmResult>(`/ai-manager/actions/${id}/confirm`),
  cancel: (id: string) => apiClient.post<AiExecutionView>(`/ai-manager/actions/${id}/cancel`),
  actions: () => apiClient.get<AiExecutionView[]>("/ai-manager/actions"),
  history: (conversationId?: string) => apiClient.get<{ conversationId: string | null; messages: { id: string; role: "user" | "assistant"; text: string; createdAt: string }[] }>(`/ai-manager/history${qs({ conversationId })}`),
};

export const actionCenterApi = {
  list: (q: Query = {}) => apiClient.get<ActionCenterList>(`/action-center${qs(q)}`),
  summary: () => apiClient.get<ActionCenterSummary>("/action-center/summary"),
  update: (id: string, b: Body) => apiClient.patch<ActionItemView>(`/action-center/${id}`, b),
  complete: (id: string, b: Body) => apiClient.post<ActionItemView>(`/action-center/${id}/complete`, b),
  snooze: (id: string, b: Body) => apiClient.post<ActionItemView>(`/action-center/${id}/snooze`, b),
  dismiss: (id: string, b: Body) => apiClient.post<ActionItemView>(`/action-center/${id}/dismiss`, b),
  evaluate: () => apiClient.post<AutomationEvaluation>("/automation/evaluate", { force: true }),
};

export const automationApi = {
  rules: () => apiClient.get<{ rules: AutomationRuleView[]; templates: AutomationTemplate[]; allowedActions: Record<string, string[]> }>("/automation/rules"),
  create: (b: Body) => apiClient.post<AutomationRuleView>("/automation/rules", b),
  update: (id: string, b: Body) => apiClient.patch<AutomationRuleView>(`/automation/rules/${id}`, b),
  enable: (id: string) => apiClient.post<AutomationRuleView>(`/automation/rules/${id}/enable`),
  disable: (id: string) => apiClient.post<AutomationRuleView>(`/automation/rules/${id}/disable`),
  runs: (q: Query = {}) => apiClient.get<{ items: AutomationRunView[]; meta: { page: number; pageSize: number; totalItems: number; totalPages: number } }>(`/automation/runs${qs(q)}`),
  approve: (runId: string) => apiClient.post<AutomationRunView>(`/automation/runs/${runId}/approve`),
};

export type AnalyticsKey = "revenue" | "pipeline" | "markets" | "products" | "buyers" | "campaigns" | "shipments" | "receivables" | "profitability" | "opportunities";
export const analyticsApi = {
  overview: (q: Query) => apiClient.get<ExecutiveOverview>(`/analytics/overview${qs(q)}`),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  section: (key: AnalyticsKey, q: Query) => apiClient.get<AnalyticsSection<any>>(`/analytics/${key}${qs(q)}`),
};
