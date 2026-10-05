import type { ApiResponse } from "@exportpro/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

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
 * Auth-token attachment is a single extension point (`getAuthHeader`)
 * so Sprint 2 can wire real tokens in one place instead of touching
 * every call site.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, signal, ...rest } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!json) {
    throw new ApiRequestError("The server returned an unreadable response.", "INTERNAL_ERROR", response.status);
  }

  if (!json.success) {
    throw new ApiRequestError(json.error.message, json.error.code, response.status, json.error.details);
  }

  return json.data;
}

/** Extension point for Sprint 2's session/token strategy. */
function getAuthHeader(): Record<string, string> {
  return {};
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "DELETE" }),
};

/** Friendly, non-technical message for the generic API error fallback UI. */
export function toFriendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "UNAUTHORIZED") return "Your session has expired. Please sign in again.";
    if (error.code === "FORBIDDEN") return "You don't have permission to do that.";
    if (error.code === "NOT_FOUND") return "We couldn't find what you were looking for.";
    if (error.code === "VALIDATION_ERROR") return error.message;
    return "Something went wrong on our end. Please try again.";
  }
  return "Something went wrong. Please try again.";
}
