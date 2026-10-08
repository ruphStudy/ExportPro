/**
 * Sprint 20 — AI Export Manager, Action Center, automation and executive analytics.
 * An orchestration layer: every figure comes from an existing module service; the
 * AI never invents prices, buyers, payments, shipment events or compliance facts.
 */

// ------------------------------------------------------------ AI Export Manager

export const AI_ACTION_NAMES = [
  "navigate",
  "analyze_product_market",
  "product_markets",
  "discover_opportunities",
  "find_buyers",
  "create_crm_lead",
  "inspect_inquiry",
  "prepare_quotation",
  "missing_documents",
  "shipment_status",
  "shipment_exceptions",
  "overdue_receivables",
  "record_payment",
  "draft_payment_reminder",
  "profitability_summary",
  "reorder_followups",
  "follow_ups_today",
  "needs_attention",
  "analytics_summary",
  "find_suppliers",
  "compare_supplier_quotes",
  "procurement_status",
  "supplier_payments_due",
] as const;
export type AiActionName = (typeof AI_ACTION_NAMES)[number];
export type AiActionKind = "READ" | "WRITE";

export interface AiActionDefinitionView {
  name: AiActionName;
  label: string;
  description: string;
  kind: AiActionKind;
  /** Writes that change commercial/financial state always require confirmation. */
  confirmationRequired: boolean;
  permission: string;
  allowed: boolean;
}

export interface AiIntent {
  intent: string;
  action: AiActionName | null;
  entities: {
    product?: string | null;
    country?: string | null;
    buyer?: string | null;
    inquiry?: string | null;
    quotation?: string | null;
    shipment?: string | null;
    receivable?: string | null;
    amount?: string | null;
    currency?: string | null;
    reference?: string | null;
    module?: string | null;
    maxInvestment?: string | null;
  };
  parameters: Record<string, string | number | boolean | null>;
  missingInputs: string[];
  clarificationRequired: boolean;
  confidence: number;
}

export interface AiProvenance {
  module: string;
  source: string;
  freshness: string | null;
  asOf: string | null;
  confidence: number | null;
}

export interface AiLink {
  label: string;
  href: string;
}

export type AiExecutionStatus = "PROPOSED" | "CONFIRMED" | "EXECUTED" | "FAILED" | "CANCELLED";

export interface AiActionPreview {
  executionId: string;
  action: AiActionName;
  label: string;
  target: string;
  values: { label: string; value: string }[];
  effect: string;
  status: AiExecutionStatus;
}

export interface AiResponse {
  conversationId: string;
  messageId: string;
  /** "ai" when an AI provider interpreted the text; "rules" for the deterministic fallback. */
  interpretedBy: "ai" | "rules" | "command";
  providerAvailable: boolean;
  intent: AiIntent | null;
  text: string;
  bullets: string[];
  table: { columns: string[]; rows: string[][] } | null;
  provenance: AiProvenance[];
  links: AiLink[];
  suggestions: { label: string; command: string }[];
  clarification: { question: string; options: { label: string; command: string }[] } | null;
  preview: AiActionPreview | null;
  denied: { action: string; permission: string; reason: string } | null;
  context: Record<string, string | null>;
}

export interface AiExecutionView {
  id: string;
  action: AiActionName;
  label: string;
  target: string;
  status: AiExecutionStatus;
  result: { href: string | null; message: string } | null;
  error: string | null;
  createdAt: string;
  executedAt: string | null;
}

export interface AiConfirmResult {
  execution: AiExecutionView;
  next: { label: string; command: string }[];
}

export interface AiHistoryEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

// ------------------------------------------------------------ Action Center

export const ACTION_TRIGGERS = [
  "NO_BUYER_RESPONSE",
  "PAYMENT_OVERDUE",
  "DOCUMENT_EXPIRY",
  "ETA_CHANGE",
  "SHIPMENT_EXCEPTION",
  "COMPLIANCE_BLOCKER",
  "VALIDATION_CRITICAL",
  "REORDER_WINDOW",
  "QUOTATION_EXPIRY",
  "NEW_OPPORTUNITY",
  "CRM_TASK_OVERDUE",
  "SAMPLE_DELIVERED",
  "SUPPLIER_DELIVERY_OVERDUE",
  "SUPPLIER_QUOTE_OVERDUE",
  "QUALITY_HOLD",
  "SUPPLIER_PAYMENT_DUE",
] as const;
export type ActionTrigger = (typeof ACTION_TRIGGERS)[number];
export type ActionItemState = "OPEN" | "IN_PROGRESS" | "SNOOZED" | "COMPLETED" | "DISMISSED" | "EXPIRED";
export type ActionPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ActionModule = "CRM" | "OUTREACH" | "FINANCE" | "LOGISTICS" | "COMPLIANCE" | "DOCUMENTS" | "COMMERCIAL" | "OPPORTUNITIES" | "INQUIRIES" | "PROCUREMENT";

export interface ActionItemView {
  id: string;
  type: ActionTrigger;
  severity: "INFO" | "WARNING" | "CRITICAL";
  priority: ActionPriority;
  priorityScore: number;
  priorityReasons: string[];
  title: string;
  description: string;
  sourceModule: ActionModule;
  sourceEntityType: string;
  sourceEntityId: string;
  context: { label: string; value: string }[];
  links: AiLink[];
  suggestedAction: string | null;
  dueAt: string | null;
  state: ActionItemState;
  snoozedUntil: string | null;
  assignedTo: { id: string; name: string } | null;
  generatedBy: "AUTOMATION" | "USER" | "AI";
  ruleId: string | null;
  resolution: { by: string | null; at: string; reason: string | null; auto: boolean } | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActionCenterSummary {
  open: number;
  critical: number;
  high: number;
  today: number;
  overdue: number;
  upcoming: number;
  snoozed: number;
  byModule: { module: ActionModule; count: number }[];
  lastEvaluatedAt: string | null;
}

export interface ActionCenterList {
  items: ActionItemView[];
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: ActionCenterSummary;
}

// ------------------------------------------------------------ Automation

export const AUTOMATION_ACTIONS = ["CREATE_ACTION_ITEM", "DRAFT_PAYMENT_REMINDER", "CREATE_CRM_TASK", "SUGGEST_FOLLOW_UP", "NOTIFY_IN_APP"] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTIONS)[number];

/** Limited, typed conditions — never arbitrary code. */
export interface AutomationConditions {
  minDaysOverdue?: number;
  minAmount?: number;
  noReplyDays?: number;
  minSeverity?: "INFO" | "WARNING" | "CRITICAL";
  daysBeforeExpiry?: number;
  minEtaDelayDays?: number;
  minScore?: number;
  windowStates?: ("APPROACHING" | "IN_WINDOW" | "PAST_WINDOW")[];
}

export interface AutomationRuleView {
  id: string;
  name: string;
  triggerType: ActionTrigger;
  enabled: boolean;
  conditions: AutomationConditions;
  actionType: AutomationActionType;
  actionConfig: { priority?: ActionPriority; assigneeUserId?: string | null; taskDueDays?: number };
  requiresApproval: boolean;
  template: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunStatus = "EXECUTED" | "SKIPPED" | "FAILED" | "PENDING_APPROVAL";

export interface AutomationRunView {
  id: string;
  ruleId: string;
  ruleName: string;
  triggerType: ActionTrigger;
  sourceKey: string;
  status: AutomationRunStatus;
  condition: string;
  result: string | null;
  skippedReason: string | null;
  error: string | null;
  actionItemId: string | null;
  createdAt: string;
}

export interface AutomationEvaluation {
  evaluatedAt: string;
  signals: number;
  created: number;
  updated: number;
  resolved: number;
  skipped: number;
  failed: number;
  pendingApproval: number;
}

export interface AutomationTemplate {
  key: string;
  name: string;
  triggerType: ActionTrigger;
  actionType: AutomationActionType;
  conditions: AutomationConditions;
  requiresApproval: boolean;
  description: string;
}

// ------------------------------------------------------------ Executive analytics

export interface MetricSource {
  source: string;
  range: { from: string; to: string };
  calculatedAt: string;
  freshness: string | null;
  note: string | null;
}

export interface KpiCard {
  key: string;
  label: string;
  value: string | null;
  currency: string | null;
  href: string | null;
  source: MetricSource;
  note: string | null;
}

export interface SeriesPoint {
  label: string;
  value: number;
  display: string;
}

export interface AnalyticsSection<T = unknown> {
  key: string;
  title: string;
  available: boolean;
  /** Why the section is hidden (permission) or empty (no data). */
  unavailableReason: string | null;
  source: MetricSource;
  metrics: T | null;
}

export interface ExecutiveOverview {
  reportingCurrency: string;
  range: { key: string; from: string; to: string };
  cards: KpiCard[];
  insights: { text: string; source: string; href: string | null }[];
  fxBasis: string[];
  calculatedAt: string;
  sections: string[];
}
