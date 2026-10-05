/**
 * Standard API envelope. Every apps/api response — success or error —
 * is shaped like one of these two, produced by the global
 * ResponseInterceptor / HttpExceptionFilter rather than built ad hoc
 * in individual controllers.
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: PaginationMeta | Record<string, unknown>;
  requestId: string;
  timestamp: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
  requestId: string;
  timestamp: string;
  path: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export type SortDirection = "asc" | "desc";

export interface SortParams {
  sortBy?: string;
  sortDir?: SortDirection;
}

export type FilterValue = string | number | boolean | Array<string | number>;

export type FilterParams = Record<string, FilterValue | undefined>;

export interface SelectOption<TValue = string> {
  label: string;
  value: TValue;
  disabled?: boolean;
}
