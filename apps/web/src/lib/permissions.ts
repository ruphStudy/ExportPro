import type { Permission, SessionContext } from "@exportpro/types";

/**
 * Real permission check against the authenticated session's effective
 * permissions (computed server-side by ROLE_PERMISSIONS — see
 * @exportpro/types/permissions.ts). This replaces Sprint 1's
 * `hasPermission() => true` placeholder.
 *
 * This is a UX convenience only — hiding a nav item or disabling a
 * button. The backend's PermissionGuard is the actual authority and
 * enforces the same ROLE_PERMISSIONS map independently of anything
 * computed here.
 */
export function hasPermission(session: SessionContext | null | undefined, permission: Permission): boolean {
  return session?.permissions.includes(permission) ?? false;
}
