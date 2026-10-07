import type {
  AgingBucketRow,
  BuyerProfitability,
  CountryProfitability,
  FinanceBuyerSummary,
  FinanceList,
  FinanceOverview,
  FinanceSettingsView,
  LetterOfCreditView,
  PaymentReceiptView,
  ProductProfitability,
  ProfitabilityAnalytics,
  ReceivableDetail,
  ReceivablePrefill,
  ReceivableReminderView,
  ReceivableSummary,
  ReorderReminderView,
  RepeatBusinessSignal,
  ShipmentProfitabilityDetail,
  ShipmentProfitabilitySummary,
} from "@exportpro/types";
import { apiClient } from "../api-client";
import { uploadWithProgress } from "./inquiries";

type Body = Record<string, unknown>;
type Query = Record<string, string | number | boolean | undefined | null>;
const qs = (q: Query = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export type ReminderSuggestion = { receivableId: string; receivableNumber: string; buyer: string; installmentId: string; label: string; kind: string; amount: string; currency: string; dueDate: string | null; daysOverdue: number | null };
export type PaymentRow = PaymentReceiptView & { receivable: { id: string; receivableNumber: string; currency: string }; buyer: string };
export type RepeatBusinessView = { dueForReorder: RepeatBusinessSignal[]; overdueFollowUp: RepeatBusinessSignal[]; highSignal: RepeatBusinessSignal[]; all: RepeatBusinessSignal[]; reminders: ReorderReminderView[]; method: string };
export type ShipmentFinanceStatus = ShipmentProfitabilitySummary & { receivable: ShipmentProfitabilityDetail["receivable"]; costLines: number };

export const financeApi = {
  settings: () => apiClient.get<FinanceSettingsView>("/finance/settings"),
  updateSettings: (b: Body) => apiClient.patch<FinanceSettingsView>("/finance/settings", b),
  overview: (q: Query = {}) => apiClient.get<FinanceOverview>(`/finance/overview${qs(q)}`),
  aging: (groupBy: string) => apiClient.get<AgingBucketRow[]>(`/finance/aging${qs({ groupBy })}`),
  payments: (q: Query = {}) => apiClient.get<FinanceList<PaymentRow> & { range: { from: string; to: string } }>(`/finance/payments${qs(q)}`),
  buyerSummary: (buyerId: string) => apiClient.get<FinanceBuyerSummary>(`/finance/buyers/${buyerId}/summary`),
};

export const receivablesApi = {
  list: (q: Query = {}) => apiClient.get<FinanceList<ReceivableSummary>>(`/receivables${qs(q)}`),
  prefill: (purchaseOrderId: string, shipmentId?: string) => apiClient.get<ReceivablePrefill>(`/receivables/prefill${qs({ purchaseOrderId, shipmentId })}`),
  create: (b: Body) => apiClient.post<ReceivableDetail>("/receivables", b),
  detail: (id: string) => apiClient.get<ReceivableDetail>(`/receivables/${id}`),
  update: (id: string, b: Body) => apiClient.patch<ReceivableDetail>(`/receivables/${id}`, b),
  installmentDate: (id: string, iid: string, b: Body) => apiClient.patch<ReceivableDetail>(`/receivables/${id}/installments/${iid}`, b),
  dispute: (id: string, b: Body) => apiClient.post<ReceivableDetail>(`/receivables/${id}/dispute`, b),
  pay: (id: string, b: Body) => apiClient.post<ReceivableDetail>(`/receivables/${id}/payments`, b),
  reverse: (paymentId: string, reason: string) => apiClient.post<ReceivableDetail>(`/payments/${paymentId}/reverse`, { reason }),
  createLc: (id: string, b: Body) => apiClient.post<ReceivableDetail>(`/receivables/${id}/letter-of-credit`, b),
  updateLc: (lcId: string, b: Body) => apiClient.patch<LetterOfCreditView>(`/letters-of-credit/${lcId}`, b),
  reminders: () => apiClient.get<{ suggestions: ReminderSuggestion[]; drafts: (ReceivableReminderView & { receivableId: string; receivableNumber: string; buyer: string })[] }>("/receivables/reminders"),
  createReminder: (id: string, b: Body) => apiClient.post<{ reminderId: string; receivable: ReceivableDetail }>(`/receivables/${id}/reminders`, b),
  dismissReminder: (rid: string) => apiClient.post<ReceivableDetail>(`/receivable-reminders/${rid}/dismiss`),
  reminderSent: (rid: string, channel: string) => apiClient.post<ReceivableDetail>(`/receivable-reminders/${rid}/record-sent`, { channel }),
};

export const profitabilityApi = {
  list: (q: Query = {}) => apiClient.get<FinanceList<ShipmentProfitabilitySummary>>(`/profitability/shipments${qs(q)}`),
  detail: (shipmentId: string) => apiClient.get<ShipmentProfitabilityDetail>(`/profitability/shipments/${shipmentId}`),
  status: (shipmentId: string) => apiClient.get<ShipmentFinanceStatus>(`/profitability/shipments/${shipmentId}/status`),
  addCost: (shipmentId: string, b: Body) => apiClient.post<ShipmentProfitabilityDetail>(`/profitability/shipments/${shipmentId}/costs`, b),
  updateCost: (costId: string, b: Body) => apiClient.patch<ShipmentProfitabilityDetail>(`/profitability/costs/${costId}`, b),
  attachCost: (costId: string, f: File, onProgress: (p: number) => void) => {
    const fd = new FormData();
    fd.append("file", f);
    return uploadWithProgress<ShipmentProfitabilityDetail>(`/profitability/costs/${costId}/attachment`, fd, onProgress);
  },
  attachmentHref: (costId: string) => `/api/v1/profitability/costs/${costId}/attachment`,
  adjust: (shipmentId: string, b: Body) => apiClient.post<ShipmentProfitabilityDetail>(`/profitability/shipments/${shipmentId}/adjustments`, b),
  confirmNone: (shipmentId: string, b: Body) => apiClient.post<ShipmentProfitabilityDetail>(`/profitability/shipments/${shipmentId}/confirm-none`, b),
  finalize: (shipmentId: string, expectedRowVersion: number) => apiClient.post<ShipmentProfitabilityDetail>(`/profitability/shipments/${shipmentId}/finalize`, { expectedRowVersion }),
  reopen: (shipmentId: string, reason: string, expectedRowVersion: number) => apiClient.post<ShipmentProfitabilityDetail>(`/profitability/shipments/${shipmentId}/reopen`, { reason, expectedRowVersion }),
  buyers: (q: Query = {}) => apiClient.get<ProfitabilityAnalytics<BuyerProfitability>>(`/profitability/buyers${qs(q)}`),
  products: (q: Query = {}) => apiClient.get<ProfitabilityAnalytics<ProductProfitability>>(`/profitability/products${qs(q)}`),
  countries: (q: Query = {}) => apiClient.get<ProfitabilityAnalytics<CountryProfitability>>(`/profitability/countries${qs(q)}`),
};

export const repeatApi = {
  list: () => apiClient.get<RepeatBusinessView>("/repeat-business"),
  buyer: (buyerId: string) => apiClient.get<{ signal: RepeatBusinessSignal | null; orders: { id: string; poNumber: string; poDate: string | null; currency: string; totalAmount: string | null }[] }>(`/repeat-business/buyers/${buyerId}`),
  create: (b: Body) => apiClient.post<{ created: number; reminders: ReorderReminderView[] }>("/repeat-business/reminders", b),
  dismiss: (id: string, reason?: string) => apiClient.post<ReorderReminderView>(`/reorder-reminders/${id}/dismiss`, { reason }),
  snooze: (id: string, until: string) => apiClient.post<ReorderReminderView>(`/reorder-reminders/${id}/snooze`, { until }),
  draft: (id: string) => apiClient.post<ReorderReminderView>(`/reorder-reminders/${id}/draft`),
};
