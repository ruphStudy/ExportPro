import { PoliteHttpClient } from '../../trade-data/adapters/http';
import { normalizeCompanyName } from '../buyer-normalization';
import type { BuyerIdentityProvider, IdentityMatch } from './buyer-provider';

interface GleifRecord {
  attributes?: {
    lei?: string;
    entity?: {
      legalName?: { name?: string };
      legalAddress?: { city?: string; country?: string };
      status?: string;
    };
    registration?: { status?: string; lastUpdateDate?: string };
  };
}

/**
 * GLEIF LEI records API (open data, CC0, no key). Used only to check
 * whether a buyer's legal name + country matches a registered legal entity.
 * Accepts an exact normalized-name + country match only — never "closest"
 * results. Provides identity evidence; no contacts, products or activity.
 * The base URL is fixed configuration; user input is only ever sent as
 * encoded query parameters (no SSRF surface).
 */
export class GleifIdentityProvider implements BuyerIdentityProvider {
  readonly sourceCode = 'GLEIF_LEI';
  readonly version = 'gleif-api-v1';
  private readonly http: PoliteHttpClient;

  constructor(
    private readonly baseUrl: string,
    timeoutMs = 8_000,
  ) {
    // 1 request/second, short timeout, no retries on the request path.
    this.http = new PoliteHttpClient(1_000, timeoutMs, 0);
  }

  async lookup(
    legalName: string,
    countryCode: string,
  ): Promise<IdentityMatch | null> {
    const target = normalizeCompanyName(legalName);
    if (!target) return null;
    const params = new URLSearchParams({
      'filter[fulltext]': legalName.slice(0, 120),
      'filter[entity.legalAddress.country]': countryCode,
      'page[size]': '10',
    });
    const body = (await this.http.getJson(
      `${this.baseUrl.replace(/\/$/, '')}/lei-records?${params.toString()}`,
    )) as { data?: GleifRecord[] };
    if (!body || !Array.isArray(body.data))
      throw new Error('Unexpected GLEIF response shape');
    const hit = body.data.find(
      (r) =>
        normalizeCompanyName(r.attributes?.entity?.legalName?.name ?? '') ===
        target,
    );
    const a = hit?.attributes;
    if (!a?.lei) return null;
    return {
      externalId: a.lei,
      legalName: a.entity?.legalName?.name ?? legalName,
      countryCode: a.entity?.legalAddress?.country ?? countryCode,
      city: a.entity?.legalAddress?.city ?? null,
      entityStatus: a.entity?.status ?? 'UNKNOWN',
      registrationStatus: a.registration?.status ?? 'UNKNOWN',
      lastUpdated: a.registration?.lastUpdateDate ?? null,
      sourceUrl: `https://search.gleif.org/#/record/${encodeURIComponent(a.lei)}`,
      raw: {
        lei: a.lei,
        legalName: a.entity?.legalName?.name,
        legalAddress: a.entity?.legalAddress,
        entityStatus: a.entity?.status,
        registration: a.registration,
      },
    };
  }
}
