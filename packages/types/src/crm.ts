import type { PaginationMeta } from "./api";
import type { BuyerMatch, BuyerRisk, BuyerRiskLevel, BuyerVerificationStatus } from "./buyers";

// --------------------------------------------------------------- enums

/** Canonical pipeline order — backend and frontend both iterate this array; never reorder locally. */
export const CRM_STAGES = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "QUALIFIED",
  "QUOTATION",
  "NEGOTIATION",
  "SAMPLE",
  "PO",
  "SHIPMENT",
  "WON",
  "LOST",
] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export const CLOSED_CRM_STAGES: readonly CrmStage[] = ["WON", "LOST"];
export const OPEN_CRM_STAGES: readonly CrmStage[] = CRM_STAGES.filter((s) => !CLOSED_CRM_STAGES.includes(s));

export const CRM_STAGE_LABELS: Record<CrmStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  INTERESTED: "Interested",
  QUALIFIED: "Qualified",
  QUOTATION: "Quotation",
  NEGOTIATION: "Negotiation",
  SAMPLE: "Sample",
  PO: "PO",
  SHIPMENT: "Shipment",
  WON: "Won",
  LOST: "Lost",
};

/** Fixed per-stage "Pipeline probability" (%). Deterministic — not a prediction. */
export const CRM_STAGE_PROBABILITY: Record<CrmStage, number> = {
  NEW: 5,
  CONTACTED: 10,
  REPLIED: 20,
  INTERESTED: 35,
  QUALIFIED: 50,
  QUOTATION: 60,
  NEGOTIATION: 70,
  SAMPLE: 75,
  PO: 90,
  SHIPMENT: 95,
  WON: 100,
  LOST: 0,
};

/** Days without engagement activity after which an open lead is stale. WON/LOST are never stale. */
export const CRM_STALE_THRESHOLD_DAYS: Record<CrmStage, number | null> = {
  NEW: 7,
  CONTACTED: 5,
  REPLIED: 5,
  INTERESTED: 5,
  QUALIFIED: 7,
  QUOTATION: 5,
  NEGOTIATION: 5,
  SAMPLE: 10,
  PO: 14,
  SHIPMENT: 14,
  WON: null,
  LOST: null,
};

/** Deterministic default follow-up per stage — used when a lead is stale or has no next action. */
export const CRM_SUGGESTED_FOLLOW_UP: Record<CrmStage, string | null> = {
  NEW: "Make first contact with the buyer",
  CONTACTED: "Follow up on your first message",
  REPLIED: "Respond and understand the buyer's requirements",
  INTERESTED: "Capture volume, timeline and payment terms to qualify",
  QUALIFIED: "Prepare and share a quotation",
  QUOTATION: "Follow up after quotation",
  NEGOTIATION: "Confirm price and payment terms",
  SAMPLE: "Confirm sample receipt and feedback",
  PO: "Confirm PO details and production schedule",
  SHIPMENT: "Confirm shipment and delivery with the buyer",
  WON: null,
  LOST: null,
};

export const LEAD_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];
export const LEAD_PRIORITY_LABELS: Record<LeadPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };

export const LEAD_SOURCES = ["BUYER_DISCOVERY", "MANUAL", "OPPORTUNITY", "RECOMMENDATION", "OTHER"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  BUYER_DISCOVERY: "Buyer Discovery",
  MANUAL: "Manual",
  OPPORTUNITY: "Opportunity",
  RECOMMENDATION: "Recommendation",
  OTHER: "Other",
};

export type LeadStatus = "OPEN" | "WON" | "LOST";
export type LeadStatusFilter = LeadStatus | "ALL";

export const LEAD_ACTIVITY_TYPES = ["NOTE", "EMAIL", "CALL", "MEETING", "STAGE_CHANGE", "TASK", "COMMENT", "ATTACHMENT", "SYSTEM", "OTHER"] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];
/** Activity types a user may log by hand; the rest are written by the system. */
export const LOGGABLE_ACTIVITY_TYPES = ["NOTE", "EMAIL", "CALL", "MEETING", "OTHER"] as const;
export type LoggableActivityType = (typeof LOGGABLE_ACTIVITY_TYPES)[number];
export const LEAD_ACTIVITY_LABELS: Record<LeadActivityType, string> = {
  NOTE: "Note",
  EMAIL: "Email (logged)",
  CALL: "Call",
  MEETING: "Meeting",
  STAGE_CHANGE: "Stage change",
  TASK: "Task",
  COMMENT: "Comment",
  ATTACHMENT: "Attachment",
  SYSTEM: "System",
  OTHER: "Other",
};

export type ActivityDirection = "INBOUND" | "OUTBOUND";

export const LEAD_TASK_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type LeadTaskStatus = (typeof LEAD_TASK_STATUSES)[number];
export const LEAD_TASK_STATUS_LABELS: Record<LeadTaskStatus, string> = { OPEN: "Open", IN_PROGRESS: "In progress", DONE: "Done", CANCELLED: "Cancelled" };

export const LEAD_REMINDER_TYPES = ["FOLLOW_UP", "TASK", "NEXT_ACTION", "CUSTOM"] as const;
export type LeadReminderType = (typeof LEAD_REMINDER_TYPES)[number];
export const LEAD_REMINDER_STATUSES = ["PENDING", "TRIGGERED", "DISMISSED", "CANCELLED"] as const;
export type LeadReminderStatus = (typeof LEAD_REMINDER_STATUSES)[number];

export const LOST_REASONS = ["PRICE", "COMPETITOR", "NO_RESPONSE", "PRODUCT_FIT", "PAYMENT_TERMS", "DELIVERY", "COMPLIANCE", "BUYER_CANCELLED", "OTHER"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const LOST_REASON_LABELS: Record<LostReason, string> = {
  PRICE: "Price",
  COMPETITOR: "Lost to competitor",
  NO_RESPONSE: "No response",
  PRODUCT_FIT: "Product fit",
  PAYMENT_TERMS: "Payment terms",
  DELIVERY: "Delivery",
  COMPLIANCE: "Compliance",
  BUYER_CANCELLED: "Buyer cancelled",
  OTHER: "Other",
};

/** CRM Lead Health — follow-up discipline only. Independent of Buyer Risk (credibility of the company). */
export type LeadHealth = "HEALTHY" | "NEEDS_ATTENTION" | "AT_RISK" | "CLOSED";

export const QUALIFICATION_FIELDS = ["requirement", "volume", "timeline", "paymentTerms", "decisionMaker"] as const;
export type QualificationField = (typeof QUALIFICATION_FIELDS)[number];
export type LeadQualification = Partial<Record<QualificationField, string | null>>;
export const QUALIFICATION_LABELS: Record<QualificationField, string> = {
  requirement: "Requirement / specification",
  volume: "Volume",
  timeline: "Timeline",
  paymentTerms: "Payment terms",
  decisionMaker: "Decision maker",
};
/** Filled qualification fields needed before suggesting QUALIFIED. */
export const QUALIFICATION_MIN_FIELDS = 3;

// -------------------------------------------------------------- views

export interface CrmUserRef {
  id: string;
  name: string;
}

export interface CrmMember extends CrmUserRef {
  email: string;
  role: string;
}

export interface LeadTag {
  id: string;
  name: string;
  color: string | null;
}

export interface CrmBuyerRef {
  id: string;
  name: string;
  countryCode: string;
  city: string | null;
  demo: boolean;
  userProvided: boolean;
  verificationStatus: BuyerVerificationStatus;
  /** Reused Sprint 10 Buyer Risk — never recalculated by CRM. */
  risk: { score: number; level: BuyerRiskLevel };
}

export interface LeadSignals {
  status: LeadStatus;
  stale: boolean;
  inactiveDays: number;
  staleThresholdDays: number | null;
  nextActionOverdue: boolean;
  overdueTaskCount: number;
  openTaskCount: number;
  health: LeadHealth;
  healthReasons: string[];
  suggestedFollowUp: string | null;
  probability: number;
}

export interface CrmLeadSummary {
  id: string;
  buyer: CrmBuyerRef;
  product: { id: string; name: string; hsCode: string | null } | null;
  countryCode: string;
  stage: CrmStage;
  priority: LeadPriority;
  source: LeadSource;
  owner: CrmUserRef | null;
  expectedValue: number | null;
  currency: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  lastActivityAt: string;
  stageChangedAt: string;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: LostReason | null;
  tags: LeadTag[];
  signals: LeadSignals;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmContactView {
  id: string;
  name: string | null;
  role: string | null;
  contactType: string;
  value: string;
  verificationStatus: string;
  confidence: number;
  isPrimary: boolean;
  demo: boolean;
}

export interface StageHistoryEntry {
  id: string;
  fromStage: CrmStage | null;
  toStage: CrmStage;
  changedBy: CrmUserRef | null;
  changedAt: string;
  reason: string | null;
}

export interface StageSuggestion {
  suggestedStage: CrmStage;
  reason: string;
  confidence: "HIGH" | "MEDIUM";
  /** Never applied automatically — the user must confirm via the stage-change API. */
  requiresConfirmation: true;
}

export interface CrmLead extends CrmLeadSummary {
  createdBy: CrmUserRef | null;
  countryDiffersFromBuyer: boolean;
  wonReason: string | null;
  lostDetails: string | null;
  qualification: LeadQualification;
  primaryContactId: string | null;
  contacts: CrmContactView[];
  /** Reused Sprint 10 buyer match for this lead's product/market context. */
  match: Pick<BuyerMatch, "score" | "level" | "productContextMissing" | "reasons">;
  risk: BuyerRisk;
  history: StageHistoryEntry[];
  suggestion: StageSuggestion | null;
  context: { note: string | null };
}

export interface LeadActivity {
  id: string;
  type: LeadActivityType;
  title: string;
  body: string | null;
  direction: ActivityDirection | null;
  occurredAt: string;
  contact: { id: string; name: string } | null;
  outcome: string | null;
  durationMinutes: number | null;
  location: string | null;
  actor: CrmUserRef | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface LeadComment {
  id: string;
  body: string;
  author: CrmUserRef | null;
  mentions: CrmUserRef[];
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
}

export interface LeadTask {
  id: string;
  leadId: string;
  lead?: { id: string; buyerName: string; stage: CrmStage };
  title: string;
  description: string | null;
  assignee: CrmUserRef | null;
  dueAt: string | null;
  priority: LeadPriority;
  status: LeadTaskStatus;
  overdue: boolean;
  completedAt: string | null;
  createdBy: CrmUserRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadReminder {
  id: string;
  leadId: string;
  taskId: string | null;
  user: CrmUserRef | null;
  remindAt: string;
  type: LeadReminderType;
  status: LeadReminderStatus;
  message: string;
  due: boolean;
  createdAt: string;
}

export interface LeadAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: CrmUserRef | null;
  createdAt: string;
  canDelete: boolean;
}

export interface CrmLeadDetailResponse {
  lead: CrmLead;
  tasks: LeadTask[];
  reminders: LeadReminder[];
  comments: LeadComment[];
  attachments: LeadAttachment[];
}

export interface CrmLeadListResponse {
  items: CrmLeadSummary[];
  meta: PaginationMeta;
}

export interface CrmActivitiesResponse {
  items: LeadActivity[];
  meta: PaginationMeta;
}

export interface CrmTaskListResponse {
  items: LeadTask[];
  meta: PaginationMeta;
}

export interface CrmPipelineColumn {
  stage: CrmStage;
  count: number;
  totalExpectedValue: number;
  /** Mixed currencies are not converted — totals only include `currency`. */
  currency: string | null;
  mixedCurrency: boolean;
  leads: CrmLeadSummary[];
  hasMore: boolean;
}

export interface CrmPipelineMetrics {
  openLeads: number;
  qualifiedPlus: number;
  overdueFollowUps: number;
  staleLeads: number;
  wonThisMonth: number;
  lostThisMonth: number;
  pipelineValue: number;
  pipelineCurrency: string | null;
}

export interface CrmPipelineResponse {
  columns: CrmPipelineColumn[];
  metrics: CrmPipelineMetrics;
}

export type CrmAttentionKind = "OVERDUE_TASK" | "OVERDUE_NEXT_ACTION" | "STALE_LEAD" | "REMINDER_DUE" | "NO_NEXT_ACTION" | "MENTION";

export interface CrmAttentionItem {
  kind: CrmAttentionKind;
  leadId: string;
  buyerName: string;
  stage: CrmStage;
  owner: CrmUserRef | null;
  title: string;
  detail: string;
  dueAt: string | null;
  refId: string | null;
}

export interface CrmAttentionResponse {
  items: CrmAttentionItem[];
  counts: Record<CrmAttentionKind, number>;
}

export interface CreateLeadResult {
  leadId: string;
  alreadyExists: boolean;
}

// ------------------------------------------------------------- inputs

export type CrmLeadSort = "updatedAt" | "createdAt" | "lastActivityAt" | "nextActionDueAt" | "expectedValue" | "priority" | "stage" | "buyer";

export interface CrmLeadQuery {
  q?: string;
  status?: LeadStatusFilter;
  stage?: CrmStage;
  owner?: string; // "me" | "unassigned" | userId
  productId?: string;
  country?: string;
  priority?: LeadPriority;
  tagId?: string;
  source?: LeadSource;
  risk?: BuyerRiskLevel;
  overdue?: boolean;
  stale?: boolean;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  sortBy?: CrmLeadSort;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface CreateLeadInput {
  buyerCompanyId: string;
  productId?: string;
  countryCode?: string;
  ownerUserId?: string;
  priority?: LeadPriority;
  source?: LeadSource;
  nextAction?: string;
  nextActionDueAt?: string;
}

export interface UpdateLeadInput {
  priority?: LeadPriority;
  productId?: string | null;
  countryCode?: string;
  expectedValue?: number | null;
  currency?: string | null;
  nextAction?: string | null;
  nextActionDueAt?: string | null;
  primaryContactId?: string | null;
  qualification?: LeadQualification;
  tagIds?: string[];
  expectedVersion?: number;
}

export interface LogActivityInput {
  type: LoggableActivityType;
  title?: string;
  body?: string;
  direction?: ActivityDirection;
  occurredAt?: string;
  contactId?: string;
  outcome?: string;
  durationMinutes?: number;
  location?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  assignedToUserId?: string;
  dueAt?: string;
  priority?: LeadPriority;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  assignedToUserId?: string | null;
  dueAt?: string | null;
  priority?: LeadPriority;
  status?: LeadTaskStatus;
}

export interface CreateReminderInput {
  remindAt: string;
  type?: LeadReminderType;
  message: string;
  taskId?: string;
  userId?: string;
}
