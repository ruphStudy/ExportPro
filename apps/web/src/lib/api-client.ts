import type { ApiResponse } from "@exportpro/types";

// Same-origin, relative path — next.config.ts rewrites this to the API so the
// HttpOnly session cookie never has to cross an origin. See ARCHITECTURE.md.
const API_BASE_URL = "/api/v1";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** AbortSignal for cancellation — wire a TanStack Query signal straight through. */
  signal?: AbortSignal;
}

/**
 * Thin fetch wrapper around the shared ApiResponse envelope (see
 * packages/types/src/api.ts). Every call site gets back the unwrapped
 * `data` on success, or a normalized ApiRequestError on failure — no
 * caller should need to know the response is JSON, or shaped as
 * `{ success, data | error }`.
 *
 * `credentials: "include"` is required even though the API is same-origin
 * via the rewrite proxy in production builds behind certain reverse
 * proxies — harmless no-op for a true same-origin request otherwise.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, signal, ...rest } = options;
  const isFormData = body instanceof FormData;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    signal,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const json = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!json) {
    throw new ApiRequestError("The server returned an unreadable response.", "INTERNAL_ERROR", response.status);
  }

  if (!json.success) {
    throw new ApiRequestError(json.error.message, json.error.code, response.status, json.error.details);
  }

  return json.data;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PUT", body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "DELETE" }),
};

/** Friendly, non-technical message for the generic API error fallback UI. */
export function toFriendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "UNAUTHORIZED") return "Your session has expired. Please sign in again.";
    if (error.code === "FORBIDDEN") return "You don't have permission to do that.";
    if (error.code === "NOT_FOUND") return "We couldn't find what you were looking for.";
    if (error.code === "VALIDATION_ERROR") return error.message;
    if (error.code === "CONFLICT") return error.message;
    if (error.code === "SERVICE_UNAVAILABLE") return error.message;
    if (error.code === "RATE_LIMITED") return "Too many requests. Please wait a moment and try again.";
    return "Something went wrong on our end. Please try again.";
  }
  return "Something went wrong. Please try again.";
}
