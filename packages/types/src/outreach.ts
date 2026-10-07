import type { PaginationMeta } from "./api";
import type { BuyerRiskLevel, BuyerVerificationStatus } from "./buyers";
import type { CrmStage } from "./crm";

// --------------------------------------------------------------- enums

export const OUTREACH_CHANNELS = ["EMAIL", "WHATSAPP", "LINKEDIN_MANUAL", "OTHER"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

/** DEVELOPMENT = processed by the development provider; nothing reaches a buyer. */
export type DeliveryMode = "DEVELOPMENT" | "PRODUCTION";

export const DOMAIN_STATUSES = ["NOT_CONFIGURED", "PENDING", "VERIFIED", "FAILED", "DEVELOPMENT_ONLY"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  RUNNING: "Running",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

export const MESSAGE_STATUSES = ["DRAFT", "SCHEDULED", "QUEUED", "SENT", "DELIVERED", "OPENED", "REPLIED", "BOUNCED", "FAILED", "CANCELLED", "OPTED_OUT"] as const;
export type OutreachMessageStatus = (typeof MESSAGE_STATUSES)[number];
export const MESSAGE_STATUS_LABELS: Record<OutreachMessageStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  QUEUED: "Queued",
  SENT: "Sent",
  DELIVERED: "Delivered",
  OPENED: "Opened",
  REPLIED: "Replied",
  BOUNCED: "Bounced",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  OPTED_OUT: "Opted out",
};

export const RECIPIENT_STATUSES = ["PENDING", "ACTIVE", "EXCLUDED", "REPLIED", "BOUNCED", "OPTED_OUT", "COMPLETED", "CANCELLED", "FAILED"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const EXCLUSION_REASONS = [
  "NO_CONTACT",
  "INVALID_CONTACT",
  "SUPPRESSED_UNSUBSCRIBED",
  "SUPPRESSED_BOUNCE",
  "SUPPRESSED_COMPLAINT",
  "SUPPRESSED_MANUAL",
  "DUPLICATE",
  "DEMO_RECIPIENT",
  "COOLDOWN",
  "CAMPAIGN_LIMIT",
  "UNRESOLVED_VARIABLE",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  NO_CONTACT: "No email contact on record",
  INVALID_CONTACT: "Contact is invalid",
  SUPPRESSED_UNSUBSCRIBED: "Unsubscribed",
  SUPPRESSED_BOUNCE: "Previous hard bounce",
  SUPPRESSED_COMPLAINT: "Spam complaint",
  SUPPRESSED_MANUAL: "Blocked by your team",
  DUPLICATE: "Duplicate contact in this campaign",
  DEMO_RECIPIENT: "Sample/demo buyer — never sent through a real provider",
  COOLDOWN: "Contacted recently (cooldown)",
  CAMPAIGN_LIMIT: "Over the campaign recipient limit",
  UNRESOLVED_VARIABLE: "Message has unresolved variables for this buyer",
};

export const TEMPLATE_TYPES = ["INTRODUCTION", "CATALOG", "QUOTATION_INTRODUCTION", "SAMPLE_OFFER", "FOLLOW_UP", "CUSTOM"] as const;
export type OutreachTemplateType = (typeof TEMPLATE_TYPES)[number];
export const TEMPLATE_TYPE_LABELS: Record<OutreachTemplateType, string> = {
  INTRODUCTION: "Introduction",
  CATALOG: "Catalog",
  QUOTATION_INTRODUCTION: "Quotation introduction",
  SAMPLE_OFFER: "Sample offer",
  FOLLOW_UP: "Follow-up",
  CUSTOM: "Custom",
};
/** Message types the content generator supports (CUSTOM is template-only). */
export const GENERATION_TYPES = ["INTRODUCTION", "CATALOG", "QUOTATION_INTRODUCTION", "SAMPLE_OFFER", "FOLLOW_UP"] as const;
export type GenerationType = (typeof GENERATION_TYPES)[number];

export const TONES = ["PROFESSIONAL", "CONCISE", "WARM", "FORMAL"] as const;
export type OutreachTone = (typeof TONES)[number];

export const OUTREACH_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "tr", label: "Turkish" },
  { code: "zh", label: "Chinese (Simplified)" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "id", label: "Indonesian" },
  { code: "vi", label: "Vietnamese" },
  { code: "hi", label: "Hindi" },
];

export type ContentSource = "TEMPLATE" | "AI" | "AI_EDITED" | "MANUAL";

export const EVENT_TYPES = ["QUEUED", "SENT", "DELIVERED", "OPENED", "CLICKED", "BOUNCED", "REPLIED", "COMPLAINT", "UNSUBSCRIBED", "FAILED"] as const;
export type OutreachEventType = (typeof EVENT_TYPES)[number];
export type EventSource = "PROVIDER" | "MANUAL" | "SYSTEM" | "DEVELOPMENT";

export const SUPPRESSION_REASONS = ["UNSUBSCRIBED", "COMPLAINT", "MANUAL_BLOCK", "HARD_BOUNCE"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/**
 * Controlled template variables. Rendering is plain substitution of these
 * names only — no expressions are ever evaluated.
 */
export const TEMPLATE_VARIABLES = [
  "buyerCompany",
  "contactName",
  "productName",
  "country",
  "senderName",
  "companyName",
  "website",
  "hsCode",
  "unsubscribeLink",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export const TEMPLATE_VARIABLE_HELP: Record<TemplateVariable, string> = {
  buyerCompany: "Buyer company name",
  contactName: "Contact name (falls back to “Sir/Madam”)",
  productName: "Campaign product name",
  country: "Target market",
  senderName: "Sender name from outreach settings",
  companyName: "Your company name",
  website: "Your company website",
  hsCode: "Product HS / ITC-HS code",
  unsubscribeLink: "Recipient-specific unsubscribe link",
};

/** Hard ceilings — organization settings may be lower, never higher. */
export const OUTREACH_HARD_LIMITS = {
  dailyLimit: 200,
  maxRecipientsPerCampaign: 100,
  maxFollowUps: 3,
  maxFollowUpDelayDays: 30,
  minContactCooldownDays: 1,
} as const;
export const OUTREACH_DEFAULT_LIMITS = {
  dailyLimit: 50,
  maxRecipientsPerCampaign: 25,
  maxFollowUps: 2,
  contactCooldownDays: 14,
} as const;

// -------------------------------------------------------------- views

export interface ProviderCapabilities {
  /** Real delivery to external mailboxes. False for the development provider. */
  realDelivery: boolean;
  delivered: boolean;
  opened: boolean;
  /** Automatic inbound reply detection. When false, replies are marked manually. */
  replies: boolean;
  bounces: boolean;
  complaints: boolean;
  testSend: boolean;
}

export interface OutreachProviderStatus {
  provider: string;
  label: string;
  deliveryMode: DeliveryMode;
  configured: boolean;
  capabilities: ProviderCapabilities;
  webhookConfigured: boolean;
  message: string;
}

export interface OutreachSettings {
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  signature: string | null;
  dailyLimit: number;
  maxRecipientsPerCampaign: number;
  maxFollowUps: number;
  contactCooldownDays: number;
  timezone: string;
  enabled: boolean;
  domainStatus: DomainStatus;
  domainCheckedAt: string | null;
  domainMessage: string | null;
  provider: OutreachProviderStatus;
  defaults: { companyName: string; companyWebsite: string | null };
  sentToday: number;
  updatedAt: string | null;
}

export interface OutreachTemplate {
  id: string;
  system: boolean;
  name: string;
  type: OutreachTemplateType;
  subject: string;
  body: string;
  language: string;
  variables: string[];
  active: boolean;
  version: number;
  createdBy: string | null;
  updatedAt: string;
}

export interface CampaignStep {
  order: number;
  delayDays: number;
  subject: string;
  body: string;
  active: boolean;
}

export interface CampaignCounts {
  recipients: number;
  eligible: number;
  excluded: number;
  queued: number;
  sent: number;
  delivered: number | null;
  opened: number | null;
  replied: number;
  repliedManual: number;
  bounced: number;
  optedOut: number;
  failed: number;
  interested: number;
  converted: number;
}

export interface CampaignAnalytics extends CampaignCounts {
  deliveryMode: DeliveryMode;
  capabilities: ProviderCapabilities;
  deliveryRate: number | null;
  openRate: number | null;
  replyRate: number | null;
  methodology: Record<string, string>;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: CampaignStatus;
  channel: OutreachChannel;
  deliveryMode: DeliveryMode | null;
  product: { id: string; name: string } | null;
  countryCode: string | null;
  scheduledAt: string | null;
  timezone: string;
  launchedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  counts: CampaignCounts;
}

export interface CampaignDetail extends CampaignSummary {
  subject: string;
  body: string;
  language: string;
  templateId: string | null;
  templateVersion: number | null;
  contentSource: ContentSource;
  generationProvider: string | null;
  generatedAt: string | null;
  steps: CampaignStep[];
  sendMode: "NOW" | "SCHEDULED";
  completedAt: string | null;
  launchedBy: string | null;
  analytics: CampaignAnalytics;
  sender: { fromName: string | null; fromEmail: string | null; replyTo: string | null };
  locked: boolean;
}

export interface RecipientView {
  id: string;
  buyer: {
    id: string;
    name: string;
    countryCode: string;
    demo: boolean;
    verificationStatus: BuyerVerificationStatus;
    risk: { score: number; level: BuyerRiskLevel };
  };
  contact: { id: string; name: string | null; address: string; verificationStatus: string; confidence: number } | null;
  crmLead: { id: string; stage: CrmStage } | null;
  status: RecipientStatus;
  excludedReason: ExclusionReason | null;
  warnings: string[];
  interested: boolean;
  lastMessage: { status: OutreachMessageStatus; stepOrder: number; sentAt: string | null; simulated: boolean } | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  repliedAt: string | null;
  bouncedAt: string | null;
  replySource: EventSource | null;
  nextFollowUpAt: string | null;
}

export interface RecipientListResponse {
  items: RecipientView[];
  meta: PaginationMeta;
}

export interface OutreachMessageView {
  id: string;
  campaign: { id: string; name: string } | null;
  buyer: { id: string; name: string } | null;
  crmLeadId: string | null;
  recipientId: string | null;
  channel: OutreachChannel;
  direction: "OUTBOUND" | "INBOUND";
  toAddress: string;
  subject: string;
  stepOrder: number;
  provider: string;
  simulated: boolean;
  testSend: boolean;
  status: OutreachMessageStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  repliedAt: string | null;
  bouncedAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface OutreachMessageDetail extends OutreachMessageView {
  body: string;
  events: { id: string; type: OutreachEventType; source: EventSource; occurredAt: string }[];
}

export interface MessageListResponse {
  items: OutreachMessageView[];
  meta: PaginationMeta;
}

export interface CampaignListResponse {
  items: CampaignSummary[];
  meta: PaginationMeta;
}

export interface RenderedPreview {
  recipientId: string | null;
  buyerName: string;
  toAddress: string | null;
  subject: string;
  body: string;
  unresolved: string[];
}

export interface TemplateValidation {
  valid: boolean;
  unknownVariables: string[];
  errors: string[];
}

export interface LaunchCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  deliveryMode: DeliveryMode;
  provider: OutreachProviderStatus;
  recipients: number;
  eligible: number;
  excluded: { reason: ExclusionReason; count: number }[];
  estimatedMessages: number;
  dailyRemaining: number;
  sender: { fromName: string | null; fromEmail: string | null; replyTo: string | null };
}

export interface GeneratedContent {
  subject: string;
  body: string;
  language: string;
  provider: string;
  aiGenerated: boolean;
  generatedAt: string;
  /** Facts the generator was allowed to use. */
  factsUsed: string[];
  /** Deterministic post-checks (possible claims not backed by facts). */
  warnings: string[];
}

export interface SuppressionView {
  id: string;
  address: string;
  reason: SuppressionReason;
  source: string;
  buyer: { id: string; name: string } | null;
  createdAt: string;
}

export interface BuyerOutreachHistory {
  latest: OutreachMessageView | null;
  messages: OutreachMessageView[];
  suppressed: boolean;
}

// ------------------------------------------------------------- inputs

export interface CampaignDraftInput {
  name?: string;
  productId?: string | null;
  countryCode?: string | null;
  subject?: string;
  body?: string;
  language?: string;
  templateId?: string | null;
  contentSource?: ContentSource;
  generationProvider?: string | null;
  generatedAt?: string | null;
  sendMode?: "NOW" | "SCHEDULED";
  scheduledAt?: string | null;
  timezone?: string;
  followUps?: { delayDays: number; subject: string; body: string }[];
}

export interface GenerateContentInput {
  type: GenerationType;
  tone: OutreachTone;
  language: string;
  productId?: string;
  countryCode?: string;
  buyerId?: string;
  instructions?: string;
}

export interface OutreachSettingsInput {
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
  companyName?: string | null;
  companyWebsite?: string | null;
  signature?: string | null;
  dailyLimit?: number;
  maxRecipientsPerCampaign?: number;
  maxFollowUps?: number;
  contactCooldownDays?: number;
  timezone?: string;
  enabled?: boolean;
}

export interface TemplateInput {
  name: string;
  type: OutreachTemplateType;
  subject: string;
  body: string;
  language?: string;
}
