/**
 * String-literal mirrors of the Prisma enums in apps/api/prisma/schema.prisma.
 * Duplicated intentionally: the frontend must never depend on @prisma/client
 * (that would couple it to the persistence layer and to a Node-only package).
 * If you change a Prisma enum, update the matching one here in the same commit.
 */

export const TradeDirection = {
  EXPORT: "EXPORT",
  IMPORT: "IMPORT",
} as const;
export type TradeDirection = (typeof TradeDirection)[keyof typeof TradeDirection];

/** Sprint 2 roles. MEMBER (Sprint 1 placeholder) no longer exists — see ARCHITECTURE.md "Roles & Permissions". */
export const MembershipRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  EXPORT_MANAGER: "EXPORT_MANAGER",
  SALES: "SALES",
  DOCUMENTATION: "DOCUMENTATION",
  LOGISTICS: "LOGISTICS",
  FINANCE: "FINANCE",
  VIEWER: "VIEWER",
} as const;
export type MembershipRole = (typeof MembershipRole)[keyof typeof MembershipRole];

export const MembershipStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  REMOVED: "REMOVED",
} as const;
export type MembershipStatus = (typeof MembershipStatus)[keyof typeof MembershipStatus];

/** How an organization (tenant) is structured as a business entity. */
export const BusinessType = {
  MANUFACTURER: "MANUFACTURER",
  MERCHANT_EXPORTER: "MERCHANT_EXPORTER",
  TRADER: "TRADER",
  IMPORTER: "IMPORTER",
  EXPORTER_IMPORTER: "EXPORTER_IMPORTER",
} as const;
export type BusinessType = (typeof BusinessType)[keyof typeof BusinessType];

/**
 * Conceptual trade-entity roles a counterparty can play (future
 * buyers/suppliers module). Kept as a type-only taxonomy — no table
 * backs this yet. Distinct from BusinessType, which classifies the
 * tenant's own organization.
 */
export const TradeEntityKind = {
  EXPORTER: "EXPORTER",
  IMPORTER: "IMPORTER",
  MANUFACTURER: "MANUFACTURER",
  MERCHANT_EXPORTER: "MERCHANT_EXPORTER",
  TRADER: "TRADER",
  SUPPLIER: "SUPPLIER",
  BUYER: "BUYER",
} as const;
export type TradeEntityKind = (typeof TradeEntityKind)[keyof typeof TradeEntityKind];
