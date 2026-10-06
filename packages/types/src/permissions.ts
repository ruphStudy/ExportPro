import { MembershipRole } from "./enums";

/**
 * Current permission namespace. Add to this union as real business
 * modules land — don't pre-populate `buyers.*`/`crm.*`/`shipments.*`
 * etc. before those modules exist, per ARCHITECTURE.md.
 */
export const PERMISSIONS = [
  "organization.view",
  "organization.update",
  "team.view",
  "team.invite",
  "team.update",
  "team.remove",
  "profile.view",
  "profile.update",
  "security.manage",
  "audit.view",
  "onboarding.view",
  "onboarding.update",
  "readiness.view",
  "documents.upload",
  "opportunities.view",
  "opportunities.save",
  "opportunities.manage_saved_searches",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Centralized role → permission mapping. This is the single source of
 * truth for authorization: the backend's PermissionGuard and the
 * frontend's permission helper both import this exact map, so there is
 * no way for the two layers to drift apart.
 *
 * A user can always view/update their OWN profile regardless of role —
 * that isn't a permission check, it's an identity check — so
 * `profile.*` here governs managing *other* users' profiles only
 * (nothing currently uses that distinction, but the permission exists
 * for when it does).
 */
export const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
  OWNER: [
    "organization.view",
    "organization.update",
    "team.view",
    "team.invite",
    "team.update",
    "team.remove",
    "profile.view",
    "profile.update",
    "security.manage",
    "audit.view",
    "onboarding.view",
    "onboarding.update",
    "readiness.view",
    "documents.upload",
    "opportunities.view",
    "opportunities.save",
    "opportunities.manage_saved_searches",
  ],
  // Same as OWNER except owner-only destructive actions (transfer
  // ownership, delete organization) are enforced by explicit role
  // checks in the relevant services, not by a permission string.
  ADMIN: [
    "organization.view",
    "organization.update",
    "team.view",
    "team.invite",
    "team.update",
    "team.remove",
    "profile.view",
    "profile.update",
    "security.manage",
    "audit.view",
    "onboarding.view",
    "onboarding.update",
    "readiness.view",
    "documents.upload",
    "opportunities.view",
    "opportunities.save",
    "opportunities.manage_saved_searches",
  ],
  // Can run the exporter-onboarding wizard and opportunity discovery day
  // to day, but not manage team membership or organization identity.
  EXPORT_MANAGER: [
    "organization.view",
    "team.view",
    "profile.view",
    "onboarding.view",
    "onboarding.update",
    "readiness.view",
    "documents.upload",
    "opportunities.view",
    "opportunities.save",
    "opportunities.manage_saved_searches",
  ],
  SALES: [
    "organization.view",
    "team.view",
    "profile.view",
    "onboarding.view",
    "readiness.view",
    "opportunities.view",
    "opportunities.save",
  ],
  DOCUMENTATION: ["organization.view", "team.view", "profile.view", "onboarding.view", "readiness.view", "opportunities.view"],
  LOGISTICS: ["organization.view", "team.view", "profile.view", "onboarding.view", "readiness.view", "opportunities.view"],
  FINANCE: ["organization.view", "team.view", "profile.view", "onboarding.view", "readiness.view", "opportunities.view"],
  VIEWER: ["organization.view", "profile.view", "onboarding.view", "readiness.view", "opportunities.view"],
};

export function roleHasPermission(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: MembershipRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
