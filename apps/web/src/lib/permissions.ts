import type { SessionContext } from "@exportpro/types";

/**
 * Extension point for Sprint 2's real RBAC. Every call site already
 * passes a permission string and the session, so wiring up real checks
 * later touches this one function instead of every caller.
 *
 * Sprint 1 has no permission model yet, so this always allows — it
 * exists purely so `navigation.ts` and the sidebar/route-guard can be
 * written against the real shape now.
 */
export function hasPermission(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature fixed now so Sprint 2's real check is a drop-in
  session: SessionContext | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  permission: string,
): boolean {
  return true;
}
