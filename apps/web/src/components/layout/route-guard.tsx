"use client";

import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { isUnauthenticated, useSession } from "@/lib/session";
import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Real route protection (Sprint 1's seeded session is gone — see
 * ARCHITECTURE.md "Sprint 1 → Sprint 2"). Renders nothing but a
 * skeleton until the session bootstrap call resolves, so protected
 * content never flashes before auth is known:
 *
 *  - loading    → skeleton, no children
 *  - no session → redirect to /login?returnTo=<here>, no children
 *  - no active organization → redirect to /create-organization
 *  - authenticated + has an organization → render children
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isLoading, isError, error } = useSession();

  React.useEffect(() => {
    if (isLoading) return;

    if (isError || !session) {
      if (isUnauthenticated(error) || !session) {
        router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
      }
      return;
    }

    if (!session.activeOrganizationId) {
      router.replace("/create-organization");
    }
  }, [isLoading, isError, error, session, pathname, router]);

  if (isLoading || isError || !session || !session.activeOrganizationId) {
    return (
      <div className="flex-1 p-6">
        <PageSkeleton />
      </div>
    );
  }

  return <>{children}</>;
}
