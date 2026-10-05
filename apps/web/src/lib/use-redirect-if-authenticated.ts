"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useSession } from "./session";

/**
 * Used by /login and /signup — an already-authenticated visitor
 * shouldn't linger there. Checks `isError` explicitly rather than just
 * `!session`: React Query keeps the last-known `data` across a failed
 * refetch by default, so a revoked/expired session can still look
 * "truthy" for a moment after the server has already rejected it —
 * trusting that would redirect back into the app and fight RouteGuard's
 * own redirect back to /login (see lib/session.ts useClearSession).
 */
export function useRedirectIfAuthenticated() {
  const router = useRouter();
  const { data: session, isLoading, isError } = useSession();
  const authenticated = !isLoading && !isError && Boolean(session);

  React.useEffect(() => {
    if (!authenticated || !session) return;
    router.replace(session.activeOrganizationId ? "/dashboard" : "/create-organization");
  }, [authenticated, session, router]);

  return { checking: isLoading || authenticated };
}
