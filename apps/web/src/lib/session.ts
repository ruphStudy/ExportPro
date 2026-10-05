import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionContext } from "@exportpro/types";
import { apiClient, ApiRequestError } from "./api-client";

export const SESSION_QUERY_KEY = ["session", "me"] as const;

/**
 * The single source of truth for "is anyone signed in, and who/what
 * organization/permissions do they have." Every other hook/component
 * reads auth state through this — there is no separate client-side
 * session store to drift out of sync with the server (Sprint 1's
 * seeded session is gone; see ARCHITECTURE.md "Sprint 1 → Sprint 2").
 */
export function useSession() {
  return useQuery<SessionContext, ApiRequestError>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => apiClient.get<SessionContext>("/auth/me"),
    retry: false,
    staleTime: 30_000,
  });
}

export function useInvalidateSession() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
}

/**
 * Used right after logout. `setQueryData(key, undefined)` is a no-op in
 * React Query (an updater returning undefined is ignored), which would
 * leave the stale authenticated session cached — and because a failed
 * refetch keeps the last-known `data` by default, that stale session
 * would keep passing truthy checks in RouteGuard / useRedirectIfAuthenticated
 * even as `/auth/me` 401s, causing a login↔dashboard redirect loop.
 * `removeQueries` actually drops the cached data.
 */
export function useClearSession() {
  const queryClient = useQueryClient();
  return () => queryClient.removeQueries({ queryKey: SESSION_QUERY_KEY });
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "UNAUTHORIZED";
}
