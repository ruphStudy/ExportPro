import type {
  BuyerActivityType,
  BuyerContactType,
  BuyerSourceType,
} from '@exportpro/types';

/**
 * Provider-neutral buyer record. Adapters translate their own API/file
 * format into this shape and keep provider details to themselves; the
 * buyer core (identity resolution, enrichment, scoring) never sees them.
 * Values are raw source values — normalization happens in the core.
 */
export interface ProviderBuyerRecord {
  externalId: string;
  name: string;
  /** ISO2 or a source country name (normalized centrally). */
  country: string;
  city?: string | null;
  stateRegion?: string | null;
  address?: string | null;
  website?: string | null;
  rawBuyerType?: string | null;
  businessCategory?: string | null;
  /** Source-stated size, e.g. "Medium" or "51-200 employees". */
  companySize?: string | null;
  /** Cross-source identifier (e.g. registry number) when the source provides one. */
  registryId?: string | null;
  sourceUrl?: string | null;
  sourceUpdatedAt: string;
  activities: ProviderActivity[];
  contacts: ProviderContact[];
}

export interface ProviderActivity {
  activityType: BuyerActivityType;
  hsCode: string | null;
  productName: string;
  /** Shipments/transactions in the trailing 12 months, when the source counts them. */
  transactionsLast12m?: number | null;
  rawFrequency?: string | null;
  importValueUsd?: number | null;
  importQuantity?: number | null;
  quantityUnit?: string | null;
  originCountries?: string[];
  periodLabel?: string | null;
  firstActivityDate?: string | null;
  lastActivityDate?: string | null;
}

export interface ProviderContact {
  contactType: BuyerContactType;
  value: string;
  name?: string | null;
  role?: string | null;
  isPrimary?: boolean;
  /** Only set when the source actually ran a verification (e.g. mailbox check). */
  verificationMethod?: string | null;
  verifiedAt?: string | null;
  lastCheckedAt?: string | null;
}

/** Bulk provider: periodically synced into the canonical buyer store, so search never calls a provider per result. */
export interface BuyerDataProvider {
  /** Sprint 9 source-registry code. */
  readonly sourceCode: string;
  readonly sourceType: BuyerSourceType;
  readonly demo: boolean;
  readonly version: string;
  fetchAll(): Promise<ProviderBuyerRecord[]>;
}

export interface IdentityMatch {
  externalId: string;
  legalName: string;
  countryCode: string;
  city: string | null;
  entityStatus: string;
  registrationStatus: string;
  lastUpdated: string | null;
  sourceUrl: string;
  raw: Record<string, unknown>;
}

/** On-demand identity provider (enrichment), called only for buyer detail views and cached. */
export interface BuyerIdentityProvider {
  readonly sourceCode: string;
  readonly version: string;
  lookup(legalName: string, countryCode: string): Promise<IdentityMatch | null>;
}

export const BUYER_DATA_PROVIDERS = Symbol('BUYER_DATA_PROVIDERS');
export const BUYER_IDENTITY_PROVIDER = Symbol('BUYER_IDENTITY_PROVIDER');
