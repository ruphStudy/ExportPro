import type { PaginationMeta } from "./api";

/**
 * Sprint 18 — logistics & shipment management.
 * Freight request ≠ freight quote ≠ shipment ≠ leg ≠ tracking event ≠ exception ≠ claim ≠ buyer update.
 * Tracking is manual or provider-fed and always labelled with its source; nothing here books
 * freight, files customs or claims real-time tracking.
 */

export const SHIPMENT_TRANSPORT_MODES = ["SEA", "AIR", "ROAD", "RAIL", "COURIER", "MULTIMODAL"] as const;
export type ShipmentTransportMode = (typeof SHIPMENT_TRANSPORT_MODES)[number];
export const SHIPMENT_TYPES = ["FCL", "LCL", "GENERAL_CARGO", "BREAK_BULK", "OTHER"] as const;
export type ShipmentType = (typeof SHIPMENT_TYPES)[number];

export const FREIGHT_QUOTE_STATUSES = ["DRAFT", "REQUESTED", "RECEIVED", "VALID", "EXPIRED", "SELECTED", "REJECTED", "CANCELLED"] as const;
export type FreightQuoteStatus = (typeof FREIGHT_QUOTE_STATUSES)[number];
export const FREIGHT_CHARGE_CATEGORIES = ["FREIGHT", "ORIGIN_CHARGES", "DESTINATION_CHARGES", "HANDLING", "DOCUMENTATION", "CUSTOMS_BROKERAGE", "INSURANCE", "FUEL_SURCHARGE", "SECURITY_SURCHARGE", "OTHER"] as const;
export type FreightChargeCategory = (typeof FREIGHT_CHARGE_CATEGORIES)[number];

export const SHIPMENT_STATUSES = ["DRAFT", "PLANNED", "BOOKED", "READY_FOR_PICKUP", "PICKED_UP", "CUSTOMS_PROCESSING", "CUSTOMS_CLEARED", "AT_ORIGIN_PORT", "DEPARTED", "IN_TRANSIT", "TRANSSHIPMENT", "ARRIVED_DESTINATION", "OUT_FOR_DELIVERY", "DELIVERED", "ON_HOLD", "CANCELLED"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export type ShipmentHealth = "ON_TRACK" | "AT_RISK" | "DELAYED" | "BLOCKED";

export const MILESTONE_STAGES = ["ORDER", "PROCUREMENT", "PRODUCTION", "PACKING", "DOCUMENTATION", "PICKUP", "CUSTOMS", "PORT", "VESSEL", "DESTINATION", "DELIVERY"] as const;
export type ShipmentMilestoneStage = (typeof MILESTONE_STAGES)[number];
export const MILESTONE_STATUSES = ["NOT_STARTED", "PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED", "BLOCKED", "SKIPPED"] as const;
export type ShipmentMilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const TRACKING_SOURCES = ["MANUAL", "CARRIER_API", "FORWARDER", "USER_UPLOAD", "SYSTEM_DERIVED"] as const;
export type TrackingSource = (typeof TRACKING_SOURCES)[number];
export const TRACKING_EVENT_TYPES = [
  "BOOKED",
  "PICKED_UP",
  "CUSTOMS_SUBMITTED",
  "CUSTOMS_QUERY",
  "CUSTOMS_HOLD",
  "CUSTOMS_RELEASED",
  "CUSTOMS_CLEARED",
  "GATE_IN",
  "LOADED",
  "DEPARTED",
  "TRANSSHIPMENT_ARRIVED",
  "TRANSSHIPMENT_DEPARTED",
  "ARRIVED",
  "DISCHARGED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "ETD_CHANGED",
  "ETA_CHANGED",
  "MISSED_SAILING",
  "PORT_DELAY",
  "TRANSSHIPMENT_DELAY",
  "DELIVERY_DELAY",
  "ROUTE_CHANGE",
  "CARRIER_CHANGE",
  "NOTE",
] as const;
export type TrackingEventType = (typeof TRACKING_EVENT_TYPES)[number];

export const SHIPMENT_EXCEPTION_TYPES = ["ETA_DELAY", "ETD_DELAY", "MISSED_SAILING", "CUSTOMS_HOLD", "PORT_DELAY", "TRANSSHIPMENT_DELAY", "DOCUMENT_ISSUE", "DAMAGE", "LOST_CARGO", "SHORT_SHIPMENT", "DELIVERY_DELAY", "CARRIER_CHANGE", "ROUTE_CHANGE", "OTHER"] as const;
export type ShipmentExceptionType = (typeof SHIPMENT_EXCEPTION_TYPES)[number];
export type ShipmentExceptionSeverity = "INFO" | "WARNING" | "CRITICAL";
export type ShipmentExceptionStatus = "OPEN" | "RESOLVED";
export const CLAIM_STATUSES = ["REPORTED", "UNDER_REVIEW", "SUBMITTED", "ACCEPTED", "REJECTED", "CLOSED"] as const;
export type ShipmentClaimStatus = (typeof CLAIM_STATUSES)[number];
export const BUYER_UPDATE_TRIGGERS = ["BOOKING_CONFIRMED", "DEPARTED", "ETA_UPDATED", "DELAY", "ARRIVED", "DELIVERED"] as const;
export type BuyerUpdateTrigger = (typeof BUYER_UPDATE_TRIGGERS)[number];
/** RECORDED_SENT = a user recorded that they sent it outside ExportPro; ExportPro itself never sent it. */
export type BuyerUpdateStatus = "DRAFT" | "APPROVED" | "RECORDED_SENT" | "DISCARDED";

export interface FieldSourced<T = string | null> {
  value: T;
  source: "PURCHASE_ORDER" | "PROFORMA_INVOICE" | "QUOTATION" | "PACKING_LIST" | "SHIPPING_INSTRUCTION" | "FREIGHT_QUOTE" | "ORGANIZATION" | "MANUAL" | "NONE";
}

export interface LogisticsProviderView {
  id: string;
  name: string;
  company: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface FreightRequestView {
  id: string;
  reference: string;
  purchaseOrder: { id: string; poNumber: string } | null;
  transportMode: ShipmentTransportMode;
  shipmentType: ShipmentType | null;
  origin: string | null;
  destination: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  incoterm: string | null;
  cargoDescription: string | null;
  packageCount: number | null;
  grossWeightKg: string | null;
  netWeightKg: string | null;
  volumeCbm: string | null;
  readyDate: string | null;
  preferredDeparture: string | null;
  specialHandling: string | null;
  sources: Record<string, FieldSourced["source"]>;
  rfqText: string;
  quotes: { id: string; forwarderName: string; status: FreightQuoteStatus; totalCost: string | null; currency: string }[];
  createdAt: string;
}

export interface FreightQuoteCharge {
  id?: string;
  category: FreightChargeCategory;
  label: string | null;
  amount: string;
}

export interface FreightQuoteSummary {
  id: string;
  requestId: string | null;
  purchaseOrder: { id: string; poNumber: string } | null;
  forwarderName: string;
  provider: LogisticsProviderView | null;
  quoteReference: string | null;
  transportMode: ShipmentTransportMode;
  shipmentType: ShipmentType | null;
  shippingLine: string | null;
  carrier: string | null;
  origin: string | null;
  destination: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  routeSummary: string | null;
  transshipmentPorts: string[];
  direct: boolean | null;
  currency: string;
  totalCost: string | null;
  transitDays: number | null;
  freeDays: number | null;
  validityFrom: string | null;
  validityUntil: string | null;
  validity: "VALID" | "EXPIRING_SOON" | "EXPIRED" | "UNKNOWN";
  departureDate: string | null;
  arrivalDate: string | null;
  status: FreightQuoteStatus;
  selected: boolean;
  shipmentId: string | null;
  updatedAt: string;
}

export interface FreightQuoteDetail extends FreightQuoteSummary {
  rowVersion: number;
  quotationId: string | null;
  serviceName: string | null;
  containerSummary: string | null;
  charges: FreightQuoteCharge[];
  inclusions: string | null;
  exclusions: string | null;
  terms: string | null;
  riskNotes: string | null;
  source: "MANUAL" | "EMAIL" | "FORWARDER_PORTAL" | "OTHER";
  selection: { by: string | null; at: string; note: string | null; overrideReason: string | null } | null;
  rejectionReason: string | null;
  attachments: { id: string; filename: string; mimeType: string; sizeBytes: number; createdAt: string }[];
  events: { id: string; title: string; actor: string | null; createdAt: string }[];
  availableActions: string[];
}

export interface FreightComparison {
  targetCurrency: string;
  rows: {
    quote: FreightQuoteSummary;
    normalizedTotal: string | null;
    fx: { rate: string; sourceLabel: string | null; sourceDate: string; snapshotId: string } | null;
    fxMissing: boolean;
    score: number | null;
    scoreBreakdown: { factor: string; points: number; max: number; explanation: string }[];
    exclusionsCount: number;
    rank: number | null;
  }[];
  notes: string[];
  /** Deterministic scoring; the user always selects. */
  scoringMethod: string;
}

export interface ShipmentMilestoneView {
  id: string;
  stage: ShipmentMilestoneStage;
  status: ShipmentMilestoneStatus;
  plannedAt: string | null;
  estimatedAt: string | null;
  actualAt: string | null;
  location: string | null;
  source: TrackingSource;
  notes: string | null;
  reason: string | null;
  delayDays: number | null;
  completedBy: string | null;
  updatedAt: string;
}

export interface ShipmentLegView {
  id: string;
  sequence: number;
  mode: ShipmentTransportMode;
  origin: string | null;
  destination: string | null;
  carrier: string | null;
  vesselName: string | null;
  voyageNumber: string | null;
  flightNumber: string | null;
  plannedDeparture: string | null;
  plannedArrival: string | null;
  actualDeparture: string | null;
  actualArrival: string | null;
  status: "PLANNED" | "DEPARTED" | "ARRIVED" | "CANCELLED";
}

export interface ShipmentContainerView {
  id: string;
  containerNumber: string;
  containerType: string | null;
  sealNumber: string | null;
  packageCount: number | null;
  grossWeightKg: string | null;
  netWeightKg: string | null;
  checkDigitValid: boolean;
  lastEvent: { type: string; location: string | null; at: string; source: TrackingSource } | null;
}

export interface ShipmentTrackingEventView {
  id: string;
  eventType: TrackingEventType;
  eventTime: string;
  estimated: boolean;
  location: string | null;
  containerNumber: string | null;
  vesselName: string | null;
  voyageNumber: string | null;
  flightNumber: string | null;
  source: TrackingSource;
  sourceReference: string | null;
  description: string;
  previousValue: string | null;
  newValue: string | null;
  applied: boolean;
  appliedNote: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ShipmentExceptionView {
  id: string;
  shipment: { id: string; shipmentNumber: string } | null;
  type: ShipmentExceptionType;
  severity: ShipmentExceptionSeverity;
  status: ShipmentExceptionStatus;
  title: string;
  description: string | null;
  impact: string | null;
  location: string | null;
  source: TrackingSource;
  detectedAt: string;
  occurredAt: string | null;
  owner: string | null;
  dueAt: string | null;
  resolution: { text: string; by: string | null; at: string } | null;
}

export interface ShipmentClaimView {
  id: string;
  exceptionId: string | null;
  description: string;
  quantityAffected: string | null;
  estimatedLoss: string | null;
  currency: string | null;
  claimReference: string | null;
  insurerReference: string | null;
  carrierReference: string | null;
  status: ShipmentClaimStatus;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuyerShipmentUpdateView {
  id: string;
  trigger: BuyerUpdateTrigger;
  subject: string;
  message: string;
  status: BuyerUpdateStatus;
  channel: string | null;
  basedOnEvent: { id: string; source: TrackingSource } | null;
  approvedBy: string | null;
  approvedAt: string | null;
  recordedSentBy: string | null;
  recordedSentAt: string | null;
  createdAt: string;
}

export interface ShipmentSummary {
  id: string;
  shipmentNumber: string;
  buyer: { id: string; name: string };
  purchaseOrder: { id: string; poNumber: string };
  mode: ShipmentTransportMode;
  shipmentType: ShipmentType | null;
  route: string;
  carrier: string | null;
  etd: string | null;
  eta: string | null;
  status: ShipmentStatus;
  health: ShipmentHealth;
  openExceptions: number;
  criticalExceptions: number;
  updatedAt: string;
}

export interface ShipmentReadiness {
  compliance: { checklistId: string | null; readiness: string | null; blockers: number; warnings: number };
  documents: { requiredNow: number; available: number; approved: number; validated: number; missing: string[]; validationWarnings: number; complete: boolean; reasons: string[] };
}

export interface ShipmentDetail extends ShipmentSummary {
  rowVersion: number;
  freightQuote: { id: string; forwarderName: string; totalCost: string | null; currency: string; quoteReference: string | null } | null;
  proformaInvoiceId: string | null;
  quotationId: string | null;
  crmLeadId: string | null;
  incoterm: string | null;
  incotermPlace: string | null;
  originCountry: string | null;
  destinationCountry: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  placeOfReceipt: string | null;
  placeOfDelivery: string | null;
  shippingLine: string | null;
  vesselName: string | null;
  voyageNumber: string | null;
  flightNumber: string | null;
  vehicleReference: string | null;
  bookingReference: string | null;
  blNumber: string | null;
  awbNumber: string | null;
  originalEtd: string | null;
  originalEta: string | null;
  actualDeparture: string | null;
  actualArrival: string | null;
  deliveredAt: string | null;
  etaDelayDays: number | null;
  etdDelayDays: number | null;
  cargo: { description: FieldSourced; packageCount: FieldSourced<number | null>; grossWeightKg: FieldSourced; netWeightKg: FieldSourced; volumeCbm: FieldSourced };
  customs: { shippingBillNumber: string | null; shippingBillDate: string | null; customsBroker: string | null; clearedAt: string | null; shippingBillDocumentId: string | null };
  compliance: { acknowledgedWarnings: boolean; overrideReason: string | null };
  owner: string | null;
  notes: string | null;
  tracking: { provider: string | null; lastFetchedAt: string | null; lastError: string | null; lastUpdateAt: string | null; lastUpdateSource: TrackingSource | null };
  costs: { quoted: { total: string | null; currency: string | null }; actual: { freight: string | null; surcharges: string | null; localCharges: string | null; total: string | null; currency: string | null; notes: string | null } };
  readiness: ShipmentReadiness;
  milestones: ShipmentMilestoneView[];
  legs: ShipmentLegView[];
  containers: ShipmentContainerView[];
  trackingEvents: ShipmentTrackingEventView[];
  exceptions: ShipmentExceptionView[];
  claims: ShipmentClaimView[];
  buyerUpdates: BuyerShipmentUpdateView[];
  documents: { id: string; title: string; documentType: string; status: string; validationStatus: string }[];
  attachments: { id: string; filename: string; mimeType: string; sizeBytes: number; exceptionId: string | null; claimId: string | null; createdAt: string }[];
  crm: { leadId: string; stage: string; stageSuggestion: { stage: string; reason: string } | null } | null;
  events: { id: string; type: string; title: string; actor: string | null; createdAt: string }[];
  availableActions: string[];
  allowedStatuses: ShipmentStatus[];
}

export interface ShipmentPrefill {
  purchaseOrder: { id: string; poNumber: string; status: string; buyerName: string };
  freightQuote: FreightQuoteSummary | null;
  values: Record<string, FieldSourced<string | number | null>>;
  readiness: ShipmentReadiness;
  gate: "OK" | "WARNINGS_ACK_REQUIRED" | "BLOCKED" | "NOT_EVALUATED";
}

export interface LogisticsList<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface LogisticsOverview {
  active: number;
  departingSoon: number;
  arrivingSoon: number;
  delayed: number;
  customsHolds: number;
  openExceptions: number;
  actions: { kind: string; title: string; shipmentId: string; shipmentNumber: string; severity: ShipmentExceptionSeverity }[];
}

export interface LogisticsSettingsView {
  etaDelayWarningDays: number;
  etaDelayCriticalDays: number;
  autoDraftBuyerUpdates: boolean;
  /** Only draft/approval is supported; ExportPro has no one-off transactional sender. */
  buyerUpdateMode: "DRAFT_ONLY" | "REQUIRE_APPROVAL";
  autoSendSupported: false;
}
