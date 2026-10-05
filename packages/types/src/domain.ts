import type { MembershipRole, MembershipStatus, TradeDirection } from "./enums";

/**
 * API-contract shapes for the Sprint 1 identity/tenancy foundation.
 * These mirror the Prisma models but are DTOs, not entities: fields are
 * chosen for what a client needs, not for what the database stores.
 */

export interface UserSummary {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  tradeDirections: TradeDirection[];
}

export interface MembershipSummary {
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
  organization: OrganizationSummary;
}

/** The authenticated session shape the frontend's SessionProvider will consume from Sprint 2 onward. */
export interface SessionContext {
  user: UserSummary;
  activeOrganizationId: string | null;
  memberships: MembershipSummary[];
}

export interface AuditLogEntry {
  id: string;
  organizationId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * Minimal country reference used by selectors ahead of the real trade-data
 * module. Intentionally has no tariff/compliance fields yet.
 */
export interface CountrySummary {
  code: string;
  name: string;
  region?: string;
}

/**
 * Minimal product reference used by selectors ahead of the real product
 * module (HS codes, pricing, etc. arrive with that module).
 */
export interface ProductSummary {
  id: string;
  name: string;
  hsCode?: string;
}
