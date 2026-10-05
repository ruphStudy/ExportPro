import type { BusinessType, MembershipRole, MembershipStatus, TradeDirection } from "./enums";
import type { Permission } from "./permissions";

/**
 * API-contract shapes for identity/tenancy. These mirror the Prisma
 * models but are DTOs, not entities: fields are chosen for what a
 * client needs (never a password/token hash), not for what the
 * database stores.
 */

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  businessType: BusinessType | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  logoUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  timezone: string;
  defaultCurrency: string;
  tradeDirections: TradeDirection[];
  createdAt: string;
}

export interface MembershipSummary {
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
  organization: OrganizationSummary;
}

/** The authenticated session shape the frontend's session bootstrap consumes from `GET /auth/me`. */
export interface SessionContext {
  user: UserSummary;
  activeOrganizationId: string | null;
  memberships: MembershipSummary[];
  /** Effective permissions for the active organization only — empty if the user has no active organization. */
  permissions: Permission[];
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
