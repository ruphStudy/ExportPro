import type {
  DuplicateCheck,
  GoodsReceiptDetail,
  GoodsReceiptSummary,
  ProcurementList,
  ProcurementOverview,
  ProcurementRequirement,
  ShipmentProcurement,
  SupplierComparison,
  SupplierDetail,
  SupplierPayableView,
  SupplierPoDetail,
  SupplierPoSummary,
  SupplierRfqDetail,
  SupplierRfqSummary,
  SupplierSearchResult,
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
const B = "/procurement";

export type CostingHandoff = { confirmed: boolean; preview: { plan: string; procurementLine: { amount: string; currency: string; basis: string; source: string; reference: string }; note: string }; costingId?: string; href?: string };

/** Sprint 21 — suppliers & procurement (supplier side; never mixed with buyer quotations). */
export const procurementApi = {
  overview: () => apiClient.get<ProcurementOverview>(`${B}/overview`),
  suppliers: (q: Query = {}) => apiClient.get<SupplierSearchResult>(`${B}/suppliers${qs(q)}`),
  supplier: (id: string) => apiClient.get<SupplierDetail>(`${B}/suppliers/${id}`),
  duplicates: (b: Body) => apiClient.post<DuplicateCheck>(`${B}/suppliers/duplicates`, b),
  createSupplier: (b: Body) => apiClient.post<SupplierDetail>(`${B}/suppliers`, b),
  updateSupplier: (id: string, b: Body) => apiClient.patch<SupplierDetail>(`${B}/suppliers/${id}`, b),
  addCertification: (id: string, b: Body) => apiClient.post<SupplierDetail>(`${B}/suppliers/${id}/certifications`, b),
  updateCertification: (id: string, b: Body) => apiClient.patch<SupplierDetail>(`${B}/certifications/${id}`, b),
  uploadSupplierFile: (id: string, form: FormData, onProgress: (p: number) => void) => uploadWithProgress<SupplierDetail>(`${B}/suppliers/${id}/attachments`, form, onProgress),
  attachmentHref: (id: string) => `/api/v1${B}/attachments/${id}`,
  shortlist: (id: string, b: Body) => apiClient.post<{ shortlisted: boolean }>(`${B}/suppliers/${id}/shortlist`, b),

  rfqs: (q: Query = {}) => apiClient.get<ProcurementList<SupplierRfqSummary>>(`${B}/rfqs${qs(q)}`),
  rfq: (id: string) => apiClient.get<SupplierRfqDetail>(`${B}/rfqs/${id}`),
  createRfq: (b: Body) => apiClient.post<SupplierRfqDetail>(`${B}/rfqs`, b),
  updateRfq: (id: string, b: Body) => apiClient.patch<SupplierRfqDetail>(`${B}/rfqs/${id}`, b),
  recordRequested: (id: string, b: Body) => apiClient.post<SupplierRfqDetail>(`${B}/rfqs/${id}/record-requested`, b),
  closeRfq: (id: string, reason: string, cancel = false) => apiClient.post<SupplierRfqDetail>(`${B}/rfqs/${id}/${cancel ? "cancel" : "close"}`, { reason }),
  addQuote: (id: string, b: Body) => apiClient.post<{ duplicate: boolean; rfq: SupplierRfqDetail }>(`${B}/rfqs/${id}/quotes`, b),
  reviewQuote: (qid: string, b: Body) => apiClient.post<SupplierRfqDetail>(`${B}/quotes/${qid}/review`, b),
  uploadQuoteFile: (qid: string, form: FormData, onProgress: (p: number) => void) => uploadWithProgress<SupplierRfqDetail>(`${B}/quotes/${qid}/attachments`, form, onProgress),
  compare: (id: string, targetCurrency?: string) => apiClient.get<SupplierComparison>(`${B}/rfqs/${id}/comparison${qs({ targetCurrency })}`),
  select: (qid: string, b: Body) => apiClient.post<SupplierRfqDetail>(`${B}/quotes/${qid}/select`, b),
  useInCosting: (qid: string, b: Body) => apiClient.post<CostingHandoff>(`${B}/quotes/${qid}/use-in-costing`, b),

  orders: (q: Query = {}) => apiClient.get<ProcurementList<SupplierPoSummary>>(`${B}/orders${qs(q)}`),
  order: (id: string) => apiClient.get<SupplierPoDetail>(`${B}/orders/${id}`),
  createOrder: (b: Body) => apiClient.post<SupplierPoDetail>(`${B}/orders`, b),
  updateOrder: (id: string, b: Body) => apiClient.patch<SupplierPoDetail>(`${B}/orders/${id}`, b),
  issue: (id: string, expectedRowVersion: number) => apiClient.post<SupplierPoDetail>(`${B}/orders/${id}/issue`, { expectedRowVersion }),
  revise: (id: string, b: Body) => apiClient.post<SupplierPoDetail>(`${B}/orders/${id}/revise`, b),
  status: (id: string, b: Body) => apiClient.post<SupplierPoDetail>(`${B}/orders/${id}/status`, b),
  recordSent: (id: string, via: string) => apiClient.post<SupplierPoDetail>(`${B}/orders/${id}/record-sent`, { via }),
  pdfHref: (id: string) => `/api/v1${B}/orders/${id}/pdf`,
  receive: (id: string, b: Body) => apiClient.post<{ duplicate: boolean; goodsReceiptId: string; supplierPo: SupplierPoDetail }>(`${B}/orders/${id}/receipts`, b),

  receipts: (q: Query = {}) => apiClient.get<ProcurementList<GoodsReceiptSummary>>(`${B}/receipts${qs(q)}`),
  receipt: (id: string) => apiClient.get<GoodsReceiptDetail>(`${B}/receipts/${id}`),
  inspect: (id: string, b: Body) => apiClient.post<GoodsReceiptDetail>(`${B}/receipts/${id}/inspections`, b),
  reinspect: (id: string, iid: string, b: Body) => apiClient.patch<GoodsReceiptDetail>(`${B}/receipts/${id}/inspections/${iid}`, b),
  uploadInspectionFile: (iid: string, form: FormData, onProgress: (p: number) => void) => uploadWithProgress<GoodsReceiptDetail>(`${B}/inspections/${iid}/attachments`, form, onProgress),

  payables: (q: Query = {}) => apiClient.get<ProcurementList<SupplierPayableView>>(`${B}/payables${qs(q)}`),
  payable: (id: string) => apiClient.get<SupplierPayableView>(`${B}/payables/${id}`),
  pay: (id: string, b: Body) => apiClient.post<SupplierPayableView>(`${B}/payables/${id}/payments`, b),
  reversePayment: (paymentId: string, reason: string) => apiClient.post<SupplierPayableView>(`${B}/payments/${paymentId}/reverse`, { reason }),

  requirement: (buyerPoId: string) => apiClient.get<ProcurementRequirement>(`${B}/requirements/${buyerPoId}`),
  shipment: (shipmentId: string) => apiClient.get<ShipmentProcurement>(`${B}/shipments/${shipmentId}`),
  setCostSource: (shipmentId: string, source: "LINKED" | "MANUAL") => apiClient.post<ShipmentProcurement>(`${B}/shipments/${shipmentId}/cost-source`, { source }),
};
