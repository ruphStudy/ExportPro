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

export const MembershipRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
} as const;
export type MembershipRole = (typeof MembershipRole)[keyof typeof MembershipRole];

export const MembershipStatus = {
  INVITED: "INVITED",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  REMOVED: "REMOVED",
} as const;
export type MembershipStatus = (typeof MembershipStatus)[keyof typeof MembershipStatus];

/**
 * Conceptual trade-entity roles a counterparty or the tenant itself can
 * play. Kept as a type-only taxonomy in Sprint 1 — no table backs this yet.
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
