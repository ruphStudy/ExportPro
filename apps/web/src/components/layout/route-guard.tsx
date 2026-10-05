"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useSessionStore } from "@/lib/session-store";
import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Extension point for real route protection. Sprint 1 seeds a
 * foundation session (see lib/session-store.ts) so `session` is never
 * null yet — this component exists so every (app) route is already
 * wrapped by the check Sprint 2 will make meaningful: redirect to
 * sign-in when `session` is null instead of rendering protected UI.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const session = useSessionStore((s) => s.session);
  const isLoading = useSessionStore((s) => s.isLoading);

  React.useEffect(() => {
    if (!isLoading && !session) {
      router.replace("/unauthorized");
    }
  }, [isLoading, session, router]);

  if (isLoading) return <PageSkeleton />;
  if (!session) return null;

  return <>{children}</>;
}
