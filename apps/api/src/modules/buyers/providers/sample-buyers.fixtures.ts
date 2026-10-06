import type {
  ProviderActivity,
  ProviderBuyerRecord,
  ProviderContact,
} from './buyer-provider';

/**
 * DETERMINISTIC SAMPLE BUYERS — FICTIONAL. Not real companies or contacts.
 * - Every name contains "Demo", "Example" or "Sample".
 * - Websites and email domains use the reserved `.example` TLD (RFC 2606),
 *   except deliberate free-mail cases used to exercise warnings.
 * - Phone numbers use reserved fictional ranges only (UK Ofcom drama range
 *   +44 20 7946 0xxx, North American 555-01xx).
 * Two simulated providers overlap on purpose so duplicate consolidation is
 * testable: a business directory (listings + contacts) and an
 * import-records feed (trade activity). Fixed dates — never random.
 */

const listing = (hsCode: string, productName: string): ProviderActivity => ({
  activityType: 'BUSINESS_LISTING',
  hsCode,
  productName,
});
const trade = (
  hsCode: string,
  productName: string,
  tx: number,
  last: string,
  first: string,
  extra: Partial<ProviderActivity> = {},
): ProviderActivity => ({
  activityType: 'TRADE_ACTIVITY',
  hsCode,
  productName,
  transactionsLast12m: tx,
  lastActivityDate: last,
  firstActivityDate: first,
  periodLabel: 'Trailing 12 months',
  ...extra,
});
const email = (
  value: string,
  role: string | null,
  extra: Partial<ProviderContact> = {},
): ProviderContact => ({
  contactType: 'EMAIL',
  value,
  role,
  isPrimary: true,
  ...extra,
});
const demoVerified = (at: string): Partial<ProviderContact> => ({
  verificationMethod: 'SAMPLE_PROVIDER_MAILBOX_CHECK',
  verifiedAt: at,
  lastCheckedAt: at,
});

export const SAMPLE_DIRECTORY: ProviderBuyerRecord[] = [
  // ---- Cumin (0909.31) — UAE
  {
    externalId: 'DIR-0001',
    name: 'Acme Gulf Foods Demo LLC',
    country: 'AE',
    city: 'Dubai',
    website: 'https://www.acme-gulf-foods.example',
    rawBuyerType: 'Importer & Distributor',
    businessCategory: 'SPICES',
    companySize: '51-200 employees',
    sourceUpdatedAt: '2026-08-20',
    activities: [
      listing('090931', 'Cumin seeds, whole'),
      listing('090421', 'Dried chillies'),
    ],
    contacts: [
      email('procurement@acme-gulf-foods.example', 'Procurement Manager', {
        name: 'Demo Contact A',
        ...demoVerified('2026-08-15'),
      }),
    ],
  },
  {
    externalId: 'DIR-0002',
    name: 'Example Spice Traders Demo FZE',
    country: 'United Arab Emirates',
    city: 'Sharjah',
    website: 'example-spice-traders.example',
    rawBuyerType: 'Wholesale trader',
    businessCategory: 'SPICES',
    companySize: 'Small',
    sourceUpdatedAt: '2026-06-11',
    activities: [listing('0909', 'Seed spices (cumin, coriander, fennel)')],
    contacts: [
      email('info@example-spice-traders.example', null, {
        lastCheckedAt: '2026-06-11',
      }),
    ],
  },
  {
    externalId: 'DIR-0003',
    name: 'Sample Desert Retail Demo LLC',
    country: 'AE',
    city: 'Abu Dhabi',
    website: 'https://sample-desert-retail.example',
    rawBuyerType: 'Supermarket chain',
    businessCategory: 'SPICES',
    companySize: '250-999 employees',
    sourceUpdatedAt: '2026-07-02',
    activities: [listing('090931', 'Cumin, packaged retail')],
    contacts: [
      {
        contactType: 'WEBSITE_FORM',
        value: 'https://sample-desert-retail.example/suppliers',
        role: 'Supplier enquiries',
        isPrimary: true,
        lastCheckedAt: '2026-07-02',
      },
    ],
  },
  {
    // High match / high risk: stale listing, free-mail primary contact, name conflicts with import record.
    externalId: 'DIR-0004',
    name: 'Mirage Commodities Demo Trading',
    country: 'AE',
    city: 'Dubai',
    website: 'mirage-commodities-demo.example',
    rawBuyerType: 'Importer',
    businessCategory: 'SPICES',
    companySize: null,
    sourceUpdatedAt: '2023-02-14',
    activities: [listing('090931', 'Cumin seeds')],
    contacts: [
      email('mirage.demo.trading@gmail.com', 'Owner', {
        lastCheckedAt: '2023-02-14',
      }),
    ],
  },
  {
    // POSSIBLE duplicate of import record IMP-0005 (similar name, same city, no shared identifier) — never auto-merged.
    externalId: 'DIR-0005',
    name: 'Oasis Example Distributors Demo',
    country: 'AE',
    city: 'Dubai',
    website: null,
    rawBuyerType: 'Distributor',
    businessCategory: 'SPICES',
    companySize: null,
    sourceUpdatedAt: '2026-01-19',
    activities: [listing('0909', 'Spices')],
    contacts: [],
  },
  // ---- Cumin — Germany
  {
    externalId: 'DIR-0006',
    name: 'Example Gewürz Import Demo GmbH',
    country: 'DE',
    city: 'Hamburg',
    website: 'https://example-gewuerz-import.example',
    rawBuyerType: 'Importeur (importer)',
    businessCategory: 'SPICES',
    companySize: '10-49 employees',
    sourceUpdatedAt: '2026-05-28',
    activities: [listing('090931', 'Kreuzkümmel / cumin seeds')],
    contacts: [
      email('einkauf@example-gewuerz-import.example', 'Einkauf / Purchasing', {
        lastCheckedAt: '2026-05-28',
      }),
    ],
  },
  {
    externalId: 'DIR-0007',
    name: 'Sample Bio Spices Demo GmbH',
    country: 'DE',
    city: 'Munich',
    website: 'sample-bio-spices.example',
    rawBuyerType: 'Organic retail shops',
    businessCategory: 'SPICES',
    companySize: 'Small',
    sourceUpdatedAt: '2026-04-03',
    activities: [listing('0909', 'Organic seed spices')],
    contacts: [
      email('kontakt@@sample-bio-spices.example', 'Sortiment', {
        lastCheckedAt: '2026-04-03',
      }),
    ],
  },
  // ---- Cumin — United Kingdom
  {
    externalId: 'DIR-0008',
    name: 'Example Curry House Supplies Demo Ltd',
    country: 'GB',
    city: 'Leicester',
    website: 'example-curry-supplies.example',
    rawBuyerType: 'Cash and carry wholesaler',
    businessCategory: 'SPICES',
    companySize: 'Medium',
    sourceUpdatedAt: '2026-03-17',
    activities: [listing('090931', 'Cumin seeds (jeera)')],
    contacts: [
      email('purchasing@example-curry-supplies.example', 'Purchasing', {
        lastCheckedAt: '2026-03-17',
      }),
      {
        contactType: 'PHONE',
        value: '+44 20 7946 0101',
        role: 'Office',
        isPrimary: false,
        lastCheckedAt: '2026-03-17',
      },
    ],
  },
  {
    // Low match / low risk for cumin: chapter-only (ginger/turmeric) manufacturer, two agreeing sources.
    externalId: 'DIR-0009',
    name: 'Demo Northern Foods Ltd',
    country: 'GB',
    city: 'Manchester',
    website: 'demo-northern-foods.example',
    rawBuyerType: 'Food processor / ready meals manufacturer',
    businessCategory: 'PROCESSED_FOOD',
    companySize: '1000+ employees',
    sourceUpdatedAt: '2026-07-21',
    activities: [listing('091011', 'Ginger'), listing('091030', 'Turmeric')],
    contacts: [
      {
        contactType: 'WEBSITE_FORM',
        value: 'https://demo-northern-foods.example/supplier-portal',
        role: 'Supplier portal',
        isPrimary: true,
        lastCheckedAt: '2026-07-21',
      },
    ],
  },
  // ---- Cumin — Saudi Arabia
  {
    externalId: 'DIR-0010',
    name: 'Example Riyadh Provisions Demo Co',
    country: 'SA',
    city: 'Riyadh',
    website: 'example-riyadh-provisions.example',
    rawBuyerType: 'Food importer',
    businessCategory: 'SPICES',
    companySize: 'Large',
    sourceUpdatedAt: '2026-06-30',
    activities: [listing('090931', 'Cumin seeds')],
    contacts: [
      email(
        'procurement@example-riyadh-provisions.example',
        'Head of Procurement',
        { lastCheckedAt: '2026-06-30' },
      ),
    ],
  },
  {
    externalId: 'DIR-0011',
    name: 'Sample Hijaz Wholesale Demo Est',
    country: 'SA',
    city: 'Jeddah',
    website: null,
    rawBuyerType: 'Wholesaler',
    businessCategory: 'SPICES',
    companySize: null,
    sourceUpdatedAt: '2025-12-08',
    activities: [listing('0909', 'Spices and seeds')],
    contacts: [
      {
        contactType: 'PHONE',
        value: '0555 12',
        role: null,
        isPrimary: true,
        lastCheckedAt: '2025-12-08',
      },
    ],
  },
  // ---- Cumin — United States
  {
    externalId: 'DIR-0012',
    name: 'Example Americas Spice Importers Demo Inc',
    country: 'US',
    city: 'Newark',
    stateRegion: 'New Jersey',
    website: 'https://example-americas-spice.example',
    rawBuyerType: 'Importer',
    businessCategory: 'SPICES',
    companySize: '51-200 employees',
    sourceUpdatedAt: '2026-09-01',
    activities: [listing('090931', 'Cumin seeds, whole and ground')],
    contacts: [
      email('sourcing@example-americas-spice.example', 'Sourcing Director', {
        name: 'Demo Contact B',
        ...demoVerified('2026-08-28'),
      }),
      {
        contactType: 'PHONE',
        value: '+1 202 555 0143',
        role: 'Sourcing office',
        isPrimary: false,
        lastCheckedAt: '2026-08-28',
      },
    ],
  },
  {
    // Stale buyer: listing and contact not refreshed since 2022.
    externalId: 'DIR-0013',
    name: 'Demo Pantry Retail Inc',
    country: 'US',
    city: 'Chicago',
    stateRegion: 'Illinois',
    website: 'demo-pantry-retail.example',
    rawBuyerType: 'Grocery retailer',
    businessCategory: 'SPICES',
    companySize: '1000+ employees',
    sourceUpdatedAt: '2022-05-10',
    activities: [listing('090931', 'Cumin (private label)')],
    contacts: [
      email(
        'category.spices@demo-pantry-retail.example',
        'Category Manager — Spices',
        { lastCheckedAt: '2022-05-10' },
      ),
    ],
  },
  // ---- T-shirts (6109.10) — US / DE
  {
    externalId: 'DIR-0014',
    name: 'Example Threads Apparel Demo Inc',
    country: 'US',
    city: 'Los Angeles',
    stateRegion: 'California',
    website: 'example-threads.example',
    rawBuyerType: 'Apparel importer',
    businessCategory: 'TEXTILES',
    companySize: 'Large',
    sourceUpdatedAt: '2026-08-12',
    activities: [listing('610910', 'Cotton T-shirts, knitted')],
    contacts: [
      email('buying@example-threads.example', 'Senior Buyer', {
        ...demoVerified('2026-08-10'),
      }),
    ],
  },
  {
    // Conflicting country across sources (linked by the same registry id).
    externalId: 'DIR-0015',
    name: 'Sample Streetwear Retail Demo LLC',
    country: 'US',
    city: 'New York',
    stateRegion: 'New York',
    website: 'sample-streetwear.example',
    rawBuyerType: 'Fashion retailer',
    businessCategory: 'TEXTILES',
    companySize: 'Small',
    registryId: 'DEMO-REG-0015',
    sourceUpdatedAt: '2026-05-05',
    activities: [listing('610910', 'Graphic T-shirts')],
    contacts: [
      {
        contactType: 'WEBSITE_FORM',
        value: 'https://sample-streetwear.example/contact',
        role: null,
        isPrimary: true,
        lastCheckedAt: '2026-05-05',
      },
    ],
  },
  {
    externalId: 'DIR-0016',
    name: 'Example Textil Handel Demo GmbH',
    country: 'DE',
    city: 'Düsseldorf',
    website: 'example-textil-handel.example',
    rawBuyerType: 'Großhandel (wholesale)',
    businessCategory: 'TEXTILES',
    companySize: 'Medium',
    sourceUpdatedAt: '2026-02-26',
    activities: [listing('6109', 'T-shirts and vests, knitted')],
    contacts: [
      email('einkauf@example-textil-handel.example', 'Einkauf', {
        lastCheckedAt: '2026-02-26',
      }),
    ],
  },
  {
    // Micro company with free-mail contact: caution only — small size is never a risk factor.
    externalId: 'DIR-0017',
    name: 'Demo Mode Agentur',
    country: 'DE',
    city: 'Berlin',
    website: null,
    rawBuyerType: 'Sourcing agent',
    businessCategory: 'TEXTILES',
    companySize: '1-9 employees',
    sourceUpdatedAt: '2026-07-14',
    activities: [listing('610910', 'T-shirts (private label sourcing)')],
    contacts: [
      email('buying.demo.agentur@web.de', 'Owner / buyer', {
        lastCheckedAt: '2026-07-14',
      }),
    ],
  },
  // ---- Areca leaf plates (1404.90) — US / GB / DE
  {
    externalId: 'DIR-0018',
    name: 'Example Green Tableware Demo LLC',
    country: 'US',
    city: 'Portland',
    stateRegion: 'Oregon',
    website: 'example-green-tableware.example',
    rawBuyerType: 'Distributor',
    businessCategory: 'HANDICRAFTS',
    companySize: 'Small',
    sourceUpdatedAt: '2026-05-19',
    activities: [listing('140490', 'Areca palm leaf plates')],
    contacts: [
      email('purchasing@example-green-tableware.example', 'Purchasing', {
        lastCheckedAt: '2026-05-19',
      }),
    ],
  },
  {
    externalId: 'DIR-0019',
    name: 'Sample Eco Catering Supplies Demo Ltd',
    country: 'GB',
    city: 'Bristol',
    website: 'sample-eco-catering.example',
    rawBuyerType: 'Catering wholesaler',
    businessCategory: 'HANDICRAFTS',
    companySize: 'Small',
    sourceUpdatedAt: '2026-07-08',
    activities: [listing('140490', 'Compostable leaf plates')],
    contacts: [
      {
        contactType: 'PHONE',
        value: '+44 20 7946 0222',
        role: 'Sales office',
        isPrimary: true,
        lastCheckedAt: '2026-07-08',
      },
    ],
  },
  {
    externalId: 'DIR-0020',
    name: 'Example Naturgeschirr Demo GmbH',
    country: 'DE',
    city: 'Cologne',
    website: 'example-naturgeschirr.example',
    rawBuyerType: 'Online shop (e-commerce)',
    businessCategory: 'HANDICRAFTS',
    companySize: null,
    sourceUpdatedAt: '2026-03-30',
    activities: [listing('140490', 'Palmblattgeschirr / leaf plates')],
    contacts: [],
  },
  // ---- Plastic household articles (3924.10) — AE / US
  {
    externalId: 'DIR-0021',
    name: 'Example Household Plastics Demo FZCO',
    country: 'AE',
    city: 'Jebel Ali',
    website: 'example-household-plastics.example',
    rawBuyerType: 'Importer',
    businessCategory: 'PLASTICS',
    companySize: 'Medium',
    sourceUpdatedAt: '2026-08-04',
    activities: [listing('392410', 'Plastic tableware and kitchenware')],
    contacts: [
      email('imports@example-household-plastics.example', 'Import Manager', {
        lastCheckedAt: '2026-08-04',
      }),
    ],
  },
  {
    // Malformed website.
    externalId: 'DIR-0022',
    name: 'Demo Home Living Stores LLC',
    country: 'US',
    city: 'Dallas',
    stateRegion: 'Texas',
    website: 'http://demo home living',
    rawBuyerType: 'Home-goods retailer',
    businessCategory: 'PLASTICS',
    companySize: 'Large',
    sourceUpdatedAt: '2026-04-22',
    activities: [listing('3924', 'Household plastic articles')],
    contacts: [],
  },
  // ---- LED drivers / static converters (8504.40) — DE / AE / US
  {
    externalId: 'DIR-0023',
    name: 'Example Lichttechnik Import Demo GmbH',
    country: 'DE',
    city: 'Stuttgart',
    website: 'example-lichttechnik.example',
    rawBuyerType: 'Importer',
    businessCategory: 'ELECTRONICS',
    companySize: 'Medium',
    sourceUpdatedAt: '2026-07-25',
    activities: [listing('850440', 'LED drivers / power supplies')],
    contacts: [
      email('beschaffung@example-lichttechnik.example', 'Procurement', {
        ...demoVerified('2026-07-20'),
      }),
    ],
  },
  {
    externalId: 'DIR-0024',
    name: 'Sample Gulf Electricals Demo LLC',
    country: 'AE',
    city: 'Dubai',
    website: 'sample-gulf-electricals.example',
    rawBuyerType: 'Electrical distributor',
    businessCategory: 'ELECTRONICS',
    companySize: 'Large',
    sourceUpdatedAt: '2026-06-18',
    activities: [listing('8504', 'Transformers and converters')],
    contacts: [
      email('sales@sample-gulf-electricals.example', null, {
        lastCheckedAt: '2026-06-18',
      }),
    ],
  },
  {
    externalId: 'DIR-0025',
    name: 'Example Lighting Components Demo Inc',
    country: 'US',
    city: 'Austin',
    stateRegion: 'Texas',
    website: 'example-lighting-components.example',
    rawBuyerType: 'Luminaire manufacturer',
    businessCategory: 'ELECTRONICS',
    companySize: '250-999 employees',
    sourceUpdatedAt: '2026-05-12',
    activities: [listing('850440', 'LED driver modules (component input)')],
    contacts: [],
  },
  {
    // Contact email domain differs from website domain.
    externalId: 'DIR-0026',
    name: 'Demo Bright Electric Supply Co',
    country: 'US',
    city: 'Phoenix',
    stateRegion: 'Arizona',
    website: 'demo-bright-electric.example',
    rawBuyerType: 'Electrical wholesaler',
    businessCategory: 'ELECTRONICS',
    companySize: 'Medium',
    sourceUpdatedAt: '2026-06-02',
    activities: [listing('850440', 'LED drivers')],
    contacts: [
      email('purchasing@unrelated-demo-domain.example', 'Purchasing', {
        lastCheckedAt: '2026-06-02',
      }),
    ],
  },
];

/** Simulated import/customs records (trade activity). Overlaps DIRECTORY by domain + country, name + country + phone, or registry id. */
export const SAMPLE_IMPORT_RECORDS: ProviderBuyerRecord[] = [
  {
    externalId: 'IMP-0001',
    name: 'ACME GULF FOODS DEMO L.L.C.',
    country: 'AE',
    city: 'DUBAI',
    website: 'acme-gulf-foods.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-09-05',
    activities: [
      trade('090931', 'Cumin seeds', 30, '2026-09-02', '2022-03-10', {
        importValueUsd: 2_400_000,
        importQuantity: 820_000,
        quantityUnit: 'KG',
        originCountries: ['IN', 'TR'],
      }),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0004',
    name: 'Mirage General Trading Demo LLC',
    country: 'AE',
    city: 'Dubai',
    website: 'mirage-commodities-demo.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-08-21',
    activities: [
      trade('090931', 'Cumin seeds', 16, '2026-08-18', '2025-06-02', {
        originCountries: ['IN'],
      }),
    ],
    contacts: [],
  },
  {
    // Trade history but no contact at all (partial profile).
    externalId: 'IMP-0005',
    name: 'Oasis Example Distribution Demo LLC',
    country: 'AE',
    city: 'Dubai',
    website: null,
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-05-02',
    activities: [
      trade('090931', 'Cumin seeds', 6, '2026-04-27', '2024-11-15', {
        importQuantity: 96_000,
        quantityUnit: 'KG',
        originCountries: ['IN'],
      }),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0006',
    name: 'Example Gewurz Import Demo GmbH',
    country: 'Germany',
    city: 'Hamburg',
    website: 'example-gewuerz-import.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-07-30',
    activities: [
      trade('090931', 'Cumin seeds', 14, '2026-07-22', '2023-02-01', {
        importValueUsd: 610_000,
        originCountries: ['IN'],
      }),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0008',
    name: 'Example Curry House Supplies Demo Ltd',
    country: 'GB',
    city: 'Leicester',
    website: null,
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2025-12-02',
    activities: [
      trade('090931', 'Cumin seeds', 2, '2025-11-20', '2024-12-05', {
        originCountries: ['IN'],
      }),
    ],
    contacts: [
      {
        contactType: 'PHONE',
        value: '+442079460101',
        role: null,
        isPrimary: true,
        lastCheckedAt: '2025-12-02',
      },
    ],
  },
  {
    externalId: 'IMP-0009',
    name: 'Demo Northern Foods Limited',
    country: 'GB',
    city: 'Manchester',
    website: 'www.demo-northern-foods.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-06-15',
    activities: [
      trade('091011', 'Fresh ginger', 2, '2025-01-14', '2023-06-01', {
        originCountries: ['IN', 'CN'],
      }),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0010',
    name: 'Example Riyadh Provisions Demo Co',
    country: 'SA',
    city: 'Riyadh',
    website: 'example-riyadh-provisions.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-06-28',
    activities: [
      trade('090931', 'Cumin seeds', 18, '2026-06-20', '2021-09-01', {
        originCountries: ['IN', 'SY'],
      }),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0012',
    name: 'Example Americas Spice Importers Demo Inc',
    country: 'US',
    city: 'Newark',
    website: 'example-americas-spice.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-09-04',
    activities: [
      trade('090931', 'Cumin seed', 26, '2026-08-30', '2020-01-15', {
        importValueUsd: 3_150_000,
        importQuantity: 1_020_000,
        quantityUnit: 'KG',
        originCountries: ['IN'],
      }),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0014',
    name: 'Example Threads Apparel Demo Inc',
    country: 'US',
    city: 'Los Angeles',
    website: 'example-threads.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-08-25',
    activities: [
      trade(
        '610910',
        'Cotton knitted T-shirts',
        40,
        '2026-08-19',
        '2019-04-01',
        { originCountries: ['IN', 'BD', 'VN'] },
      ),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0015',
    name: 'Sample Streetwear Retail Demo LLC',
    country: 'Canada',
    city: 'Toronto',
    website: 'sample-streetwear.example',
    rawBuyerType: 'Consignee',
    registryId: 'DEMO-REG-0015',
    sourceUpdatedAt: '2026-04-11',
    activities: [
      trade('610910', 'T-shirts', 3, '2026-03-30', '2025-08-12', {
        originCountries: ['IN'],
      }),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0016',
    name: 'Example Textil Handel Demo GmbH',
    country: 'DE',
    city: 'Dusseldorf',
    website: 'example-textil-handel.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-02-20',
    activities: [
      trade('610910', 'T-shirts of cotton', 8, '2026-02-11', '2024-03-01', {
        originCountries: ['IN', 'TR'],
      }),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0018',
    name: 'Example Green Tableware Demo LLC',
    country: 'US',
    city: 'Portland',
    website: 'example-green-tableware.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-05-20',
    activities: [
      trade('140490', 'Areca leaf plates', 3, '2026-05-06', '2025-07-01', {
        originCountries: ['IN'],
      }),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0021',
    name: 'Example Household Plastics Demo FZCO',
    country: 'AE',
    city: 'Jebel Ali',
    website: 'example-household-plastics.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-08-10',
    activities: [
      trade('392410', 'Plastic tableware', 15, '2026-08-02', '2022-10-01', {
        originCountries: ['IN', 'CN'],
      }),
    ],
    contacts: [],
  },
  {
    externalId: 'IMP-0023',
    name: 'Example Lichttechnik Import Demo GmbH',
    country: 'DE',
    city: 'Stuttgart',
    website: 'example-lichttechnik.example',
    rawBuyerType: 'Consignee',
    sourceUpdatedAt: '2026-07-28',
    activities: [
      trade('850440', 'LED drivers', 10, '2026-07-15', '2023-05-01', {
        originCountries: ['IN', 'CN'],
      }),
    ],
    contacts: [],
  },
];
