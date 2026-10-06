import type {
  DataAccessMethod,
  SourceQualityTier,
  TradeDataDomain,
  TradeDataSourceType,
  UpdateFrequency,
} from '@exportpro/types';

export interface SourceDefinition {
  code: string;
  name: string;
  authority: string;
  sourceType: TradeDataSourceType;
  accessMethod: DataAccessMethod;
  baseUrl: string | null;
  termsUrl: string | null;
  description: string;
  countryCode: string | null;
  dataDomains: TradeDataDomain[];
  updateFrequency: UpdateFrequency;
  expectedLagDays: number;
  qualityTier: SourceQualityTier;
  official: boolean;
  /** Initial value only; admins may toggle afterwards. */
  enabledByDefault: boolean;
  notes: string | null;
}

/**
 * Canonical source registry (researched October 2026). Static metadata is
 * synced to the database on startup; operational state (enabled, run
 * results) is never overwritten. `official` marks genuinely authoritative
 * statistics only. No credentials are stored here.
 */
export const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    code: 'UN_COMTRADE',
    name: 'UN Comtrade — public preview API',
    authority: 'United Nations Statistics Division (UNSD)',
    sourceType: 'INTERGOVERNMENTAL',
    accessMethod: 'API',
    baseUrl: 'https://comtradeapi.un.org/public/v1/preview',
    termsUrl: 'https://comtradeplus.un.org/',
    description:
      'Official merchandise trade statistics reported by national authorities to UNSD. Used for India’s annual HS6 exports by partner and destination countries’ annual HS6 imports by partner.',
    countryCode: null,
    dataDomains: ['TRADE_VALUE', 'TRADE_QUANTITY', 'COUNTRY', 'UNIT_REFERENCE'],
    updateFrequency: 'ANNUAL',
    expectedLagDays: 180,
    qualityTier: 'B',
    official: true,
    enabledByDefault: true,
    notes:
      'Keyless public preview: one period and up to 500 records per call; per-minute limit is undocumented, so requests are paced and 429/Retry-After honoured. Free use for non-commercial analysis per UN Comtrade data-use policy — review before commercial redistribution. Values in USD (exports FOB, imports CIF); quantities may be estimated by UNSD.',
  },
  {
    code: 'UN_COMTRADE_HS',
    name: 'HS 2022 classification reference (UN Comtrade H6)',
    authority:
      'United Nations Statistics Division (distributing the WCO Harmonized System)',
    sourceType: 'INTERGOVERNMENTAL',
    accessMethod: 'JSON',
    baseUrl: 'https://comtradeapi.un.org/files/v1/app/reference/HS.json',
    termsUrl: 'https://comtradeplus.un.org/',
    description:
      'Official HS 2022 chapters, headings and subheadings with descriptions. Replaces the Sprint 5 development sample for 2/4/6-digit HS codes.',
    countryCode: null,
    dataDomains: ['HS_CLASSIFICATION', 'COMMODITY'],
    updateFrequency: 'STATIC',
    expectedLagDays: 0,
    qualityTier: 'B',
    official: true,
    enabledByDefault: true,
    notes:
      'India’s 8-digit ITC-HS lines are not part of this file; the ITC-HS development sample remains in use for those.',
  },
  {
    code: 'INDIA_TRADESTAT',
    name: 'Export Import Data Bank (TradeStat)',
    authority:
      'Department of Commerce, Ministry of Commerce & Industry — data compiled by DGCI&S, Kolkata',
    sourceType: 'GOVERNMENT',
    accessMethod: 'MANUAL_IMPORT',
    baseUrl: 'https://tradestat.commerce.gov.in/eidb/',
    termsUrl: 'https://tradestat.commerce.gov.in/',
    description:
      'India’s official commodity × country export/import statistics (from 1996-97). Imported manually using the ExportPro CSV/JSON template.',
    countryCode: 'IN',
    dataDomains: ['TRADE_VALUE', 'TRADE_QUANTITY', 'COUNTRY', 'COMMODITY'],
    updateFrequency: 'MONTHLY',
    expectedLagDays: 60,
    qualityTier: 'A',
    official: true,
    enabledByDefault: true,
    notes:
      'No public API; reports are generated through portal forms, so automated scraping is not used. The portal states figures are for general reference — verify against DGCI&S publications. Download a report, map it to the template columns, and upload.',
  },
  {
    code: 'DATA_GOV_IN_OGD',
    name: 'Open Government Data Platform India (data.gov.in) API',
    authority: 'National Informatics Centre, Ministry of Electronics & IT',
    sourceType: 'GOVERNMENT',
    accessMethod: 'API',
    baseUrl: 'https://api.data.gov.in/',
    termsUrl: 'https://data.gov.in/policies',
    description:
      'Government open-data catalogue; some commerce/trade resources are published as API resources.',
    countryCode: 'IN',
    dataDomains: ['TRADE_VALUE', 'STATE_EXPORT'],
    updateFrequency: 'AD_HOC',
    expectedLagDays: 90,
    qualityTier: 'A',
    official: true,
    enabledByDefault: false,
    notes:
      'Requires a registered API key and per-resource IDs; no adapter is implemented yet. Disabled until a key and resource mapping are configured.',
  },
  {
    code: 'DGCIS_DETAILED',
    name: 'DGCI&S detailed foreign trade statistics (port / state)',
    authority:
      'Directorate General of Commercial Intelligence and Statistics (DGCI&S), Kolkata',
    sourceType: 'GOVERNMENT',
    accessMethod: 'MANUAL_IMPORT',
    baseUrl: 'https://www.dgciskol.gov.in/',
    termsUrl: null,
    description:
      'Port-wise, state-wise and principal-commodity statistics distributed by DGCI&S.',
    countryCode: 'IN',
    dataDomains: ['PORT', 'STATE_EXPORT', 'DISTRICT_EXPORT'],
    updateFrequency: 'MONTHLY',
    expectedLagDays: 60,
    qualityTier: 'A',
    official: true,
    enabledByDefault: false,
    notes:
      'Detailed tables are distributed on request/subscription; registered for transparency, not automated. State/port/district intelligence stays on sample data until such a file is imported.',
  },
  {
    code: 'WITS_TARIFF',
    name: 'World Integrated Trade Solution (WITS) — TRAINS tariffs',
    authority: 'World Bank (with UNCTAD, ITC, WTO)',
    sourceType: 'INTERGOVERNMENTAL',
    accessMethod: 'API',
    baseUrl: 'https://wits.worldbank.org/witsapiintro.aspx',
    termsUrl: 'https://wits.worldbank.org/',
    description: 'Applied and preferential tariff data by HS line and market.',
    countryCode: null,
    dataDomains: ['TARIFF'],
    updateFrequency: 'ANNUAL',
    expectedLagDays: 365,
    qualityTier: 'B',
    official: true,
    enabledByDefault: false,
    notes:
      'Extension point — no tariff adapter yet, so Country Intelligence tariffs remain illustrative sample data.',
  },
  {
    code: 'EXPORTPRO_PORT_REFERENCE',
    name: 'ExportPro Indian port & state reference',
    authority: 'ExportPro (internal reference, UN/LOCODE-style customs codes)',
    sourceType: 'INTERNAL',
    accessMethod: 'JSON',
    baseUrl: null,
    termsUrl: null,
    description:
      'Canonical Indian ports (with aliases such as Nhava Sheva / JNPT) and state/UT codes used by normalization.',
    countryCode: 'IN',
    dataDomains: ['PORT', 'UNIT_REFERENCE'],
    updateFrequency: 'STATIC',
    expectedLagDays: 0,
    qualityTier: 'D',
    official: false,
    enabledByDefault: true,
    notes: 'Code-defined and versioned with the normalizer.',
  },
  {
    code: 'EXPORTPRO_SAMPLE_TRADE',
    name: 'ExportPro sample product trade intelligence',
    authority: 'ExportPro (synthetic)',
    sourceType: 'DEMO',
    accessMethod: 'JSON',
    baseUrl: null,
    termsUrl: null,
    description:
      'Hand-authored illustrative product datasets (states, districts, ports, seasonality, product signals). Not official statistics.',
    countryCode: null,
    dataDomains: ['TRADE_VALUE', 'STATE_EXPORT', 'DISTRICT_EXPORT', 'PORT'],
    updateFrequency: 'STATIC',
    expectedLagDays: 0,
    qualityTier: 'DEMO',
    official: false,
    enabledByDefault: true,
    notes: 'Fallback wherever real coverage is absent; always labelled DEMO.',
  },
  {
    code: 'EXPORTPRO_SAMPLE_MARKET',
    name: 'ExportPro sample market intelligence',
    authority: 'ExportPro (synthetic)',
    sourceType: 'DEMO',
    accessMethod: 'JSON',
    baseUrl: null,
    termsUrl: null,
    description:
      'Illustrative product × country data: tariffs, barriers, guidance, country/currency risk, logistics. Not official trade or regulatory data.',
    countryCode: null,
    dataDomains: ['TARIFF', 'COUNTRY'],
    updateFrequency: 'STATIC',
    expectedLagDays: 0,
    qualityTier: 'DEMO',
    official: false,
    enabledByDefault: true,
    notes: 'Fallback wherever real coverage is absent; always labelled DEMO.',
  },
  {
    code: 'EXPORTPRO_DEMO_OPPORTUNITIES',
    name: 'ExportPro demo opportunity dataset',
    authority: 'ExportPro (synthetic)',
    sourceType: 'DEMO',
    accessMethod: 'JSON',
    baseUrl: null,
    termsUrl: null,
    description:
      'Synthetic product × country discovery opportunities (Sprint 4).',
    countryCode: null,
    dataDomains: ['TRADE_VALUE'],
    updateFrequency: 'STATIC',
    expectedLagDays: 0,
    qualityTier: 'DEMO',
    official: false,
    enabledByDefault: true,
    notes: null,
  },
  {
    code: 'EXPORTPRO_DEV_HS',
    name: 'ExportPro development HS / ITC-HS sample',
    authority: 'ExportPro (development sample)',
    sourceType: 'DEMO',
    accessMethod: 'JSON',
    baseUrl: null,
    termsUrl: null,
    description:
      'Sprint 5 development tariff-code sample; still used for 8-digit ITC-HS lines.',
    countryCode: 'IN',
    dataDomains: ['HS_CLASSIFICATION'],
    updateFrequency: 'STATIC',
    expectedLagDays: 0,
    qualityTier: 'DEMO',
    official: false,
    enabledByDefault: true,
    notes: null,
  },
  // --- Sprint 10: buyer discovery sources -------------------------------
  {
    code: 'GLEIF_LEI',
    name: 'GLEIF LEI records API',
    authority: 'Global Legal Entity Identifier Foundation (GLEIF)',
    sourceType: 'PUBLIC',
    accessMethod: 'API',
    baseUrl: 'https://api.gleif.org/api/v1',
    termsUrl: 'https://www.gleif.org/en/meta/lei-data-terms-of-use/',
    description:
      'Global Legal Entity Identifier (LEI) reference data: legal name, legal address and registration status. Used on demand to check whether a user-entered buyer matches an active legal entity (exact normalized name + country).',
    countryCode: null,
    dataDomains: ['COMPANY_IDENTITY'],
    updateFrequency: 'DAILY',
    expectedLagDays: 1,
    qualityTier: 'B',
    official: false,
    enabledByDefault: true,
    notes:
      'Open data (CC0), free, no API key. Identity evidence only — no contacts, products or trade activity. Many SMEs have no LEI, so “no match” is not a negative signal. Requests are paced (1/s) with a short timeout; results are cached for 30 days.',
  },
  {
    code: 'EXPORTPRO_SAMPLE_BUYER_DIRECTORY',
    name: 'ExportPro sample buyer directory (fictional)',
    authority: 'ExportPro (synthetic)',
    sourceType: 'DEMO',
    accessMethod: 'JSON',
    baseUrl: null,
    termsUrl: null,
    description:
      'Deterministic fictional buyer listings and business contacts for development. Not real companies or contacts.',
    countryCode: null,
    dataDomains: ['BUYER_DIRECTORY', 'BUYER_CONTACT', 'COMPANY_IDENTITY'],
    updateFrequency: 'STATIC',
    expectedLagDays: 0,
    qualityTier: 'DEMO',
    official: false,
    enabledByDefault: true,
    notes:
      'All names contain Demo/Example/Sample; websites use the reserved .example domain; phone numbers use reserved fictional ranges. No legally accessible free buyer-contact dataset was found to integrate this sprint.',
  },
  {
    code: 'EXPORTPRO_SAMPLE_IMPORT_RECORDS',
    name: 'ExportPro sample import records (fictional)',
    authority: 'ExportPro (synthetic)',
    sourceType: 'DEMO',
    accessMethod: 'JSON',
    baseUrl: null,
    termsUrl: null,
    description:
      'Deterministic fictional consignee/import records used to exercise import-activity scoring and cross-source duplicate consolidation. Not real shipments.',
    countryCode: null,
    dataDomains: ['BUYER_TRADE_ACTIVITY'],
    updateFrequency: 'STATIC',
    expectedLagDays: 0,
    qualityTier: 'DEMO',
    official: false,
    enabledByDefault: true,
    notes:
      'Customs-level importer data (bill-of-lading/consignee records) is only available from licensed commercial providers; this fixture stands in until one is contracted.',
  },
];
