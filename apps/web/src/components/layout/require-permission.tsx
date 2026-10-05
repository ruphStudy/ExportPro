"use client";

import { ShieldAlert } from "lucide-react";
import type { Permission } from "@exportpro/types";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Client-side gate for a whole page whose required permission isn't
 * universal (e.g. "team.view", which VIEWER doesn't have). Hiding the
 * nav item (see lib/navigation.ts) stops normal navigation, but a
 * direct URL visit still needs this — the backend's PermissionGuard
 * remains the real authority either way.
 */
export function RequirePermission({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { data: session, isLoading } = useSession();

  if (isLoading) return <PageSkeleton />;
  if (!hasPermission(session, permission)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Access denied"
        description="You don't have permission to view this page."
      />
    );
  }
  return <>{children}</>;
}
