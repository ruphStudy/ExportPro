import type { PaginationMeta } from "./api";

/** Sprint 22 — samples, negotiation workspace and secure deal rooms. */

// ------------------------------------------------------------ samples

export const SAMPLE_STATUSES = ["REQUESTED", "PREPARING", "READY", "COURIER_BOOKED", "SHIPPED", "DELIVERED", "FEEDBACK_RECEIVED", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];
export const SAMPLE_SOURCES = ["INQUIRY", "CRM_LEAD", "QUOTATION", "MANUAL"] as const;
export type SampleSource = (typeof SAMPLE_SOURCES)[number];
export const SAMPLE_COST_CATEGORIES = ["PREPARATION", "PACKAGING", "COURIER", "DOCUMENTATION", "MISCELLANEOUS"] as const;
export type SampleCostCategory = (typeof SAMPLE_COST_CATEGORIES)[number];
export const SAMPLE_ATTACHMENT_CATEGORIES = ["SPECIFICATION", "COA", "SAMPLE_REPORT", "PHOTO", "LAB_REPORT", "PACKAGING_IMAGE", "COURIER_DOCUMENT", "OTHER"] as const;
export type SampleAttachmentCategory = (typeof SAMPLE_ATTACHMENT_CATEGORIES)[number];
export const FEEDBACK_SOURCES = ["EMAIL", "PHONE", "WHATSAPP", "CRM_NOTE", "MANUAL"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];
export const FEEDBACK_VERDICTS = ["ACCEPTED", "REJECTED", "CHANGES_REQUESTED", "NO_DECISION"] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];
export const SAMPLE_REJECTION_REASONS = ["PRICE", "QUALITY", "SPECIFICATION", "PACKAGING", "DELIVERY", "CERTIFICATION", "OTHER"] as const;
export type SampleRejectionReason = (typeof SAMPLE_REJECTION_REASONS)[number];
export const COURIER_UPDATE_SOURCES = ["MANUAL", "COURIER_WEBSITE", "COURIER_EMAIL", "PHONE", "PROVIDER_API"] as const;
export type CourierUpdateSource = (typeof COURIER_UPDATE_SOURCES)[number];

export interface SampleSummary {
  id: string;
  sampleNumber: string;
  iteration: number;
  rootId: string;
  buyer: { id: string | null; name: string | null };
  productName: string;
  quantity: string | null;
  unit: string | null;
  status: SampleStatus;
  courier: { provider: string | null; trackingNumber: string | null } | null;
  expectedDeliveryAt: string | null;
  deliveredAt: string | null;
  feedbackStatus: "NONE" | "RECEIVED" | "PENDING";
  owner: { id: string; name: string | null } | null;
  requiredBy: string | null;
  overdue: { preparation: boolean; delivery: boolean };
  updatedAt: string;
}

export interface SampleCostView {
  id: string;
  category: SampleCostCategory;
  description: string | null;
  amount: string;
  currency: string;
  reportingAmount: string | null;
  reportingCurrency: string;
  fx: { rate: string; sourceLabel: string | null } | null;
  incurredAt: string | null;
  voided: boolean;
  createdBy: string | null;
}

export interface SampleAttachmentView {
  id: string;
  category: SampleAttachmentCategory;
  filename: string;
  sizeBytes: number;
  feedbackId: string | null;
  createdAt: string;
  uploadedBy: string | null;
}

export interface SampleFeedbackView {
  id: string;
  receivedAt: string;
  source: FeedbackSource;
  rating: number | null;
  verdict: FeedbackVerdict;
  comments: string | null;
  qualityNotes: string | null;
  packagingNotes: string | null;
  priceFeedback: string | null;
  requestedChanges: string | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface SampleEventView {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  source: string | null;
  note: string | null;
  occurredAt: string;
  by: string | null;
}

export interface SampleDetail extends SampleSummary {
  rowVersion: number;
  source: SampleSource;
  inquiry: { id: string; reference: string } | null;
  crmLead: { id: string } | null;
  quotation: { id: string; quotationNumber: string; revision: number } | null;
  buyerPurchaseOrder: { id: string; poNumber: string } | null;
  productId: string | null;
  specification: string | null;
  packaging: string | null;
  notes: string | null;
  requestedAt: string;
  requestedBy: string | null;
  preparation: { startedAt: string | null; completedAt: string | null; packagingNotes: string | null; internalComments: string | null };
  courierDetail: { provider: string | null; bookingReference: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; expectedDeliveryAt: string | null; courierCost: string | null; courierCurrency: string | null; liveTracking: false; trackingNote: string };
  delivery: { deliveredAt: string | null; recipient: string | null; source: string | null; notes: string | null };
  decision: { decision: "APPROVED" | "REJECTED"; reasonCode: SampleRejectionReason | null; note: string | null; by: string | null; at: string } | null;
  costs: SampleCostView[];
  costTotal: { reportingCurrency: string; amount: string | null; missingFx: string[]; label: string };
  attachments: SampleAttachmentView[];
  feedback: SampleFeedbackView[];
  events: SampleEventView[];
  iterations: { id: string; sampleNumber: string; iteration: number; status: SampleStatus; decision: string | null; reasonCode: string | null; createdAt: string }[];
  negotiations: { id: string; negotiationNumber: string; status: NegotiationStatus }[];
  activity: { id: string; title: string; actor: string | null; createdAt: string }[];
  allowedStatuses: SampleStatus[];
  availableActions: string[];
}

export interface SampleOverview {
  requested: number;
  preparing: number;
  shipped: number;
  awaitingFeedback: number;
  approved: number;
  rejected: number;
}

// ------------------------------------------------------------ negotiation

export const NEGOTIATION_STATUSES = ["OPEN", "WAITING_BUYER", "WAITING_INTERNAL", "AGREED", "LOST", "ON_HOLD", "CLOSED"] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number];
export const NEGOTIATION_SOURCES = ["INQUIRY", "QUOTATION", "SAMPLE", "CRM_LEAD", "BUYER_PO", "MANUAL"] as const;
export type NegotiationSource = (typeof NEGOTIATION_SOURCES)[number];
export const NEGOTIATION_SIDES = ["BUYER", "EXPORTER"] as const;
export type NegotiationSide = (typeof NEGOTIATION_SIDES)[number];
export const ROUND_SOURCES = ["QUOTATION", "INQUIRY", "EMAIL", "PHONE", "WHATSAPP", "MEETING", "MANUAL"] as const;
export type RoundSource = (typeof ROUND_SOURCES)[number];
export const NEGOTIATION_LOST_REASONS = ["PRICE", "TERMS", "DELIVERY", "QUALITY", "COMPETITOR", "NO_RESPONSE", "BUDGET", "OTHER"] as const;
export type NegotiationLostReason = (typeof NEGOTIATION_LOST_REASONS)[number];

/** Commercial position captured by one round. null = not stated (never assumed). */
export interface CommercialSnapshot {
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  currency: string | null;
  incoterm: string | null;
  namedPlace: string | null;
  paymentTerms: string | null;
  packaging: string | null;
  deliveryDate: string | null;
  leadTimeDays: number | null;
  specification: string | null;
  validUntil: string | null;
  otherTerms: string | null;
}
export const SNAPSHOT_FIELDS = ["quantity", "unit", "unitPrice", "currency", "incoterm", "namedPlace", "paymentTerms", "packaging", "deliveryDate", "leadTimeDays", "specification", "validUntil", "otherTerms"] as const;

export interface TermChange {
  field: (typeof SNAPSHOT_FIELDS)[number];
  label: string;
  from: string | null;
  to: string | null;
  change: string | null;
  direction: "UP" | "DOWN" | "CHANGED" | "ADDED" | "REMOVED";
}

export interface NegotiationRoundView {
  id: string;
  sequence: number;
  side: NegotiationSide;
  source: RoundSource;
  notes: string | null;
  snapshot: CommercialSnapshot;
  changes: TermChange[];
  createdBy: string | null;
  createdAt: string;
}

export interface ProjectedProfitability {
  available: boolean;
  label: "Projected / pre-order";
  reason: string | null;
  basis: { costingId: string; reference: string; scenarioId: string; scenarioName: string; incoterm: string; status: string } | null;
  currency: string | null;
  proposedRevenue: string | null;
  estimatedCost: string | null;
  projectedProfit: string | null;
  projectedMarginPercent: string | null;
  targetMarginPercent: string | null;
  targetSource: string | null;
  notes: string[];
}

export interface NegotiationWarning {
  code: "MARGIN_BELOW_TARGET" | "PAYMENT_TERMS_WORSENED" | "DELIVERY_BEFORE_LEAD_TIME" | "INCOTERM_CHANGED" | "BELOW_SUPPLIER_MOQ" | "CERTIFICATION_UNRESOLVED" | "COSTING_INCOTERM_MISMATCH" | "PROFITABILITY_UNAVAILABLE";
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
}

export interface NegotiationSummary {
  id: string;
  negotiationNumber: string;
  buyer: { id: string; name: string };
  inquiry: { id: string; reference: string } | null;
  quotation: { id: string; quotationNumber: string; revision: number } | null;
  productName: string | null;
  currentRound: number;
  status: NegotiationStatus;
  pendingSide: "BUYER" | "EXPORTER" | null;
  lastActivityAt: string;
  owner: { id: string; name: string | null } | null;
  projectedMarginPercent: string | null;
  approvalRequired: boolean;
}

export interface NegotiationDetail extends NegotiationSummary {
  rowVersion: number;
  source: NegotiationSource;
  sample: { id: string; sampleNumber: string; status: SampleStatus } | null;
  crmLead: { id: string; stage: string } | null;
  costing: { id: string; reference: string; scenarioId: string | null } | null;
  openedAt: string;
  closedAt: string | null;
  outcome: { outcome: "AGREED" | "LOST" | "ON_HOLD"; reason: NegotiationLostReason | null; note: string | null; by: string | null; at: string } | null;
  agreedRoundId: string | null;
  current: CommercialSnapshot | null;
  rounds: NegotiationRoundView[];
  profitability: ProjectedProfitability;
  warnings: NegotiationWarning[];
  procurement: { source: string; leadTimeDays: number | null; moq: string | null; moqUnit: string | null; supplier: string | null; note: string } | null;
  handoff: { quotationId: string; quotationNumber: string; revision: number; status: string } | null;
  dealRooms: { id: string; name: string; status: DealRoomStatus }[];
  activity: { id: string; title: string; actor: string | null; createdAt: string }[];
  availableActions: string[];
}

export interface NegotiationSummaryText {
  advisory: true;
  position: string;
  changes: string[];
  unresolved: string[];
  marginImpact: string | null;
  buyerConcerns: string[];
  suggestions: string[];
  basis: string;
}

// ------------------------------------------------------------ deal room

export const DEAL_ROOM_STATUSES = ["ACTIVE", "EXPIRED", "REVOKED"] as const;
export type DealRoomStatus = (typeof DEAL_ROOM_STATUSES)[number];
export const DEAL_ROOM_DOC_TYPES = ["QUOTATION", "PROFORMA_INVOICE", "TRADE_DOCUMENT", "BUYER_PO_ATTACHMENT", "SAMPLE_ATTACHMENT", "INQUIRY_ATTACHMENT"] as const;
export type DealRoomDocType = (typeof DEAL_ROOM_DOC_TYPES)[number];
export const SHARE_PERMISSIONS = ["VIEW", "DOWNLOAD"] as const;
export type SharePermission = (typeof SHARE_PERMISSIONS)[number];

export interface DealRoomShareView {
  id: string;
  docType: DealRoomDocType;
  sourceId: string;
  rootId: string | null;
  title: string;
  versionLabel: string;
  filename: string;
  permission: SharePermission;
  addedAt: string;
  sharedBy: string | null;
  removedAt: string | null;
  removedBy: string | null;
  replacedByShareId: string | null;
  replacesShareId: string | null;
  newerVersion: { sourceId: string; versionLabel: string } | null;
  downloads: number;
}

export interface DealRoomAccessView {
  id: string;
  event: string;
  shareId: string | null;
  document: string | null;
  guestEmail: string | null;
  sessionRef: string | null;
  at: string;
}

export interface DealRoomSummary {
  id: string;
  name: string;
  buyer: { id: string | null; name: string | null };
  status: DealRoomStatus;
  createdAt: string;
  expiresAt: string;
  documentCount: number;
  lastAccessAt: string | null;
}

export interface DealRoomDetail extends DealRoomSummary {
  rowVersion: number;
  tokenHint: string;
  /** Returned only once, right after creation or rotation. */
  link: string | null;
  allowedEmail: string | null;
  accessCodeEnabled: boolean;
  allowComments: boolean;
  revoked: { at: string; by: string | null; reason: string | null } | null;
  links: { inquiry: { id: string; reference: string } | null; quotation: { id: string; label: string } | null; proformaInvoice: { id: string; label: string } | null; buyerPurchaseOrder: { id: string; poNumber: string } | null; shipment: { id: string; shipmentNumber: string } | null; negotiation: { id: string; negotiationNumber: string } | null };
  shares: DealRoomShareView[];
  comments: { id: string; guestName: string; body: string; shareId: string | null; createdAt: string }[];
  activity: { id: string; title: string; actor: string | null; createdAt: string }[];
  availableActions: string[];
}

export interface ShareableDocument {
  docType: DealRoomDocType;
  sourceId: string;
  title: string;
  versionLabel: string;
  shareable: boolean;
  blockedReason: string | null;
}

export interface GuestDealRoomView {
  exporter: { name: string; country: string | null; hasLogo: boolean };
  name: string;
  buyerName: string | null;
  expiresAt: string;
  gate: null | { accessCode: boolean; email: boolean };
  allowComments: boolean;
  documents: { shareId: string; title: string; versionLabel: string; filename: string; permission: SharePermission; addedAt: string; previewable: boolean }[];
  comments: { id: string; guestName: string; body: string; createdAt: string }[];
}

export interface ExecutionList<T> {
  items: T[];
  meta: PaginationMeta;
}
