import type { ApiResponse, BuyerInquiryDetail, ConfirmedRfq, InquiryClarificationQuestion, InquiryListResponse, QualificationChecklist } from "@exportpro/types";
import { apiClient, ApiRequestError } from "../api-client";

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export interface InquiryListQuery {
  tab?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
  buyerCompanyId?: string;
  productId?: string;
  crmLeadId?: string;
  country?: string;
  unread?: string;
  source?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

type V = { expectedRowVersion?: number };
type Handoff = { alreadyExists: boolean; inquiry: BuyerInquiryDetail };

/** Multipart upload with progress (fetch has no upload progress). Same-origin, cookie session. */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new ApiRequestError("Upload failed. Check your connection and try again.", "NETWORK_ERROR", 0));
    xhr.onload = () => {
      let json: ApiResponse<T> | null = null;
      try {
        json = JSON.parse(xhr.responseText) as ApiResponse<T>;
      } catch {
        return reject(new ApiRequestError("The server returned an unreadable response.", "INTERNAL_ERROR", xhr.status));
      }
      if (json.success) resolve(json.data);
      else reject(new ApiRequestError(json.error.message, json.error.code, xhr.status, json.error.details));
    };
    xhr.send(form);
  });
}

export const inquiriesApi = {
  list: (q: InquiryListQuery) => apiClient.get<InquiryListResponse>(`/inquiries${qs(q)}`),
  get: (id: string) => apiClient.get<BuyerInquiryDetail>(`/inquiries/${id}`),
  assignees: () => apiClient.get<{ id: string; name: string; role: string }[]>("/inquiries/assignees"),
  create: (body: Record<string, unknown>) => apiClient.post<BuyerInquiryDetail>("/inquiries", body),
  upload: (file: File, fields: Record<string, string | undefined>, onProgress: (p: number) => void) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
    fd.append("file", file);
    return uploadWithProgress<BuyerInquiryDetail>("/inquiries/upload", fd, onProgress);
  },
  addAttachment: (id: string, file: File, onProgress: (p: number) => void) => {
    const fd = new FormData();
    fd.append("file", file);
    return uploadWithProgress<BuyerInquiryDetail>(`/inquiries/${id}/attachments`, fd, onProgress);
  },
  deleteAttachment: (id: string, aid: string) => apiClient.delete<BuyerInquiryDetail>(`/inquiries/${id}/attachments/${aid}`),
  downloadHref: (id: string, aid: string) => `/api/v1/inquiries/${id}/attachments/${aid}/download`,
  update: (id: string, body: Record<string, unknown>) => apiClient.patch<BuyerInquiryDetail>(`/inquiries/${id}`, body),
  setRead: (id: string, read: boolean) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/${read ? "read" : "unread"}`),
  assign: (id: string, userId: string | null, v?: number) => apiClient.patch<BuyerInquiryDetail>(`/inquiries/${id}/assign`, { userId, expectedRowVersion: v }),
  note: (id: string, text: string) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/notes`, { text }),
  extract: (id: string) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/extract`),
  saveDraft: (id: string, body: ConfirmedRfq & V & { basedOnExtractionVersion?: number | null }) => apiClient.patch<BuyerInquiryDetail>(`/inquiries/${id}/extraction`, body),
  confirm: (id: string, body: ConfirmedRfq & V & { basedOnExtractionVersion?: number | null }) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/extraction/confirm`, body),
  qualify: (id: string, body: { checklist: QualificationChecklist; overrideReason?: string } & V) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/qualify`, body),
  clarify: (id: string, questions: InquiryClarificationQuestion[], v?: number) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/request-clarification`, { questions, expectedRowVersion: v }),
  reject: (id: string, body: { category: string; reason: string } & V) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/reject`, body),
  archive: (id: string, v?: number) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/archive`, { expectedRowVersion: v }),
  restore: (id: string, v?: number) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/restore`, { expectedRowVersion: v }),
  submitApproval: (id: string, reason?: string, v?: number) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/submit-approval`, { reason, expectedRowVersion: v }),
  approve: (id: string, reason?: string, v?: number) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/approve`, { reason, expectedRowVersion: v }),
  rejectApproval: (id: string, reason: string, v?: number) => apiClient.post<BuyerInquiryDetail>(`/inquiries/${id}/reject-approval`, { reason, expectedRowVersion: v }),
  quotation: (id: string) => apiClient.post<Handoff>(`/inquiries/${id}/create-quotation-request`),
  sample: (id: string, itemIndex?: number) => apiClient.post<Handoff>(`/inquiries/${id}/create-sample-request`, { itemIndex }),
};
