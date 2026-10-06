import type {
  CertificationItem,
  GuidanceItem,
  IntelligenceLevel,
  TradeBarrierSignal,
} from '@exportpro/types';
import {
  CountryDatasetSource,
  CountryProfile,
  CountryTradeDataProvider,
  ProductCountryMarket,
} from './country-trade-data.provider';

/**
 * Deterministic SAMPLE market intelligence for the Sprint 6 sample
 * products × 8 destination countries. Every figure — import values,
 * shares, competitors and especially tariffs and barrier/guidance signals —
 * is illustrative, stored as DEMO, and shown with "verify before
 * commercial use" warnings. Nothing here is official trade or regulatory data.
 */
const SOURCE: CountryDatasetSource = {
  sourceType: 'DEMO',
  sourceName:
    'ExportPro sample market intelligence (illustrative — not official trade or regulatory data)',
  sourceUrl: null,
  sourceDate: '2026-03-31',
  lastUpdatedAt: '2026-04-15',
  quality: 40,
  datasetVersion: 'sample-market-2026.1',
};

const P = (
  countryCode: string,
  riskScore: number,
  currencyStability: number,
  logisticsBase: number,
  majorPorts: string[],
  seaTransit: string,
  airSuitability: string,
  routeComplexity: IntelligenceLevel,
  notes: string[] = [],
): CountryProfile => ({
  countryCode,
  riskScore,
  currencyStability,
  logisticsBase,
  majorPorts,
  seaTransit,
  airSuitability,
  routeComplexity,
  notes,
});

const COUNTRIES: CountryProfile[] = [
  P(
    'AE',
    82,
    92,
    90,
    ['Jebel Ali', 'Khalifa Port'],
    'Short-haul sea (indicatively under a week)',
    'Good',
    'LOW',
    ['Major re-export hub for the Gulf region.'],
  ),
  P(
    'SA',
    70,
    90,
    80,
    ['Jeddah Islamic Port', 'King Abdulaziz (Dammam)'],
    'Short-haul sea (around a week)',
    'Good',
    'LOW',
  ),
  P(
    'US',
    85,
    88,
    66,
    ['New York/New Jersey', 'Los Angeles/Long Beach', 'Savannah'],
    'Long-haul sea (several weeks)',
    'Good for high-value goods',
    'MODERATE',
  ),
  P(
    'DE',
    86,
    84,
    64,
    ['Hamburg', 'Bremerhaven'],
    'Long-haul sea (3–4 weeks)',
    'Good for high-value goods',
    'MODERATE',
  ),
  P(
    'GB',
    84,
    80,
    68,
    ['Felixstowe', 'London Gateway'],
    'Long-haul sea (3–4 weeks)',
    'Good for high-value goods',
    'MODERATE',
  ),
  P(
    'CN',
    62,
    72,
    70,
    ['Shanghai', 'Ningbo-Zhoushan', 'Shenzhen'],
    'Medium-haul sea (2–3 weeks)',
    'Moderate',
    'MODERATE',
  ),
  P(
    'BD',
    52,
    48,
    78,
    ['Chattogram', 'Benapole (land border)'],
    'Short sea or land route',
    'Limited',
    'LOW',
    ['Land-border trade is significant (sample signal).'],
  ),
  P(
    'NG',
    30,
    22,
    36,
    ['Lagos (Apapa / Tin Can)'],
    'Long-haul sea with transhipment',
    'Limited',
    'HIGH',
    [
      'Port congestion and foreign-exchange availability are frequently cited concerns (sample signal).',
    ],
  ),
];

const verify = 'DATASET_ONLY' as const;
const info = 'INFORMATIONAL' as const;
const b = (
  type: TradeBarrierSignal['type'],
  label: string,
  level: IntelligenceLevel,
  note: string,
): TradeBarrierSignal => ({ type, label, level, note, verification: verify });
const g = (
  text: string,
  kind: GuidanceItem['kind'] = 'COMMON_PRACTICE',
): GuidanceItem => ({
  text,
  kind,
  verification: kind === 'COMMON_PRACTICE' ? info : verify,
});
const c = (
  name: string,
  status: CertificationItem['status'],
  note: string,
): CertificationItem => ({ name, status, note, verification: verify });

type Kind = 'FOOD' | 'TEXTILE' | 'TABLEWARE' | 'PLASTIC' | 'ELECTRONIC';
const PRODUCT_KIND: Record<string, { kind: Kind; unit: string | null }> = {
  '090931': { kind: 'FOOD', unit: 'KG' },
  '610910': { kind: 'TEXTILE', unit: 'NOS' },
  '140490': { kind: 'TABLEWARE', unit: 'KG' },
  '392410': { kind: 'PLASTIC', unit: 'KG' },
  '850440': { kind: 'ELECTRONIC', unit: null },
};

const LANGUAGE: Record<string, string> = {
  AE: 'Arabic (often alongside English)',
  SA: 'Arabic (often alongside English)',
  CN: 'Simplified Chinese',
  DE: 'German',
  BD: 'English and/or Bengali',
  US: 'English',
  GB: 'English',
  NG: 'English',
};

const CUSTOMS: Record<string, IntelligenceLevel> = {
  NG: 'HIGH',
  BD: 'MODERATE',
  CN: 'MODERATE',
};

function barriersFor(
  kind: Kind,
  cc: string,
  tariff: number | null,
): TradeBarrierSignal[] {
  const out: TradeBarrierSignal[] = [];
  if (tariff !== null)
    out.push(
      b(
        'TARIFF',
        'Tariff barrier',
        tariff >= 15 ? 'HIGH' : tariff >= 6 ? 'MODERATE' : 'LOW',
        'Derived from the sample tariff in this dataset.',
      ),
    );
  if (kind === 'FOOD') {
    out.push(
      b(
        'SPS',
        'Sanitary / phytosanitary controls',
        'MODERATE',
        'Spices are typically subject to plant-health and food-safety checks; residue limits vary by market.',
      ),
    );
    out.push(
      b(
        'IMPORT_REGISTRATION',
        'Importer / food registration',
        cc === 'US' || cc === 'CN' ? 'MODERATE' : 'LOW',
        'Food imports often involve importer or facility registration — confirm with the importer.',
      ),
    );
  }
  if (kind === 'TABLEWARE')
    out.push(
      b(
        'SPS',
        'Plant-health / fumigation checks',
        'MODERATE',
        'Plant-based articles may face plant-health inspection or treatment expectations.',
      ),
    );
  if (kind === 'TEXTILE')
    out.push(
      b(
        'TECHNICAL_STANDARDS',
        'Textile labeling / chemical standards',
        cc === 'DE' || cc === 'GB' ? 'MODERATE' : 'LOW',
        'Fibre-content labeling and restricted-substance expectations are common in retail supply chains.',
      ),
    );
  if (kind === 'PLASTIC')
    out.push(
      b(
        'TECHNICAL_STANDARDS',
        'Food-contact material standards',
        cc === 'DE' || cc === 'US' ? 'MODERATE' : 'LOW',
        'Kitchenware intended for food contact may need migration/test evidence.',
      ),
    );
  if (kind === 'ELECTRONIC') {
    out.push(
      b(
        'TECHNICAL_STANDARDS',
        'Electrical safety / EMC conformity',
        'HIGH',
        'Power electronics are commonly subject to conformity assessment before sale.',
      ),
    );
    out.push(
      b(
        'CERTIFICATION',
        'Product certification marks',
        cc === 'NG' ? 'MODERATE' : 'HIGH',
        'Market-specific conformity marks are frequently required by buyers or regulators.',
      ),
    );
  }
  out.push(
    b(
      'CUSTOMS_COMPLEXITY',
      'Customs complexity',
      CUSTOMS[cc] ?? 'LOW',
      'Broad sample signal for clearance complexity.',
    ),
  );
  return out;
}

function packagingFor(kind: Kind): GuidanceItem[] {
  switch (kind) {
    case 'FOOD':
      return [
        g(
          'Bulk shipments commonly use multi-wall paper or PP bags with inner liners.',
        ),
        g('Retail packs are common for supermarket channels.'),
        g(
          'Food-grade packaging materials may be required for direct food contact.',
          'POSSIBLE_REQUIREMENT',
        ),
      ];
    case 'TEXTILE':
      return [
        g(
          'Individually poly-bagged pieces in export cartons are common commercial practice.',
        ),
        g(
          'Buyer-specific hang tags and carton markings are frequently requested.',
        ),
      ];
    case 'TABLEWARE':
      return [
        g('Shrink-wrapped stacks in corrugated cartons are commonly used.'),
        g(
          'Moisture protection is commonly used to prevent mould during long sea transits.',
        ),
      ];
    case 'PLASTIC':
      return [
        g(
          'Retail-ready packs with product information are common for household goods.',
        ),
        g(
          'Packaging-waste or recycling-marking obligations may apply in some markets.',
          'POSSIBLE_REQUIREMENT',
        ),
      ];
    default:
      return [
        g(
          'Anti-static and shock-protective packaging is common practice for electronics.',
        ),
        g(
          'Battery / electrical-goods packaging rules may apply depending on the product.',
          'POSSIBLE_REQUIREMENT',
        ),
      ];
  }
}

function labelingFor(kind: Kind, cc: string): GuidanceItem[] {
  return [
    g(
      `Product information in ${LANGUAGE[cc] ?? 'the local language'} is commonly expected for retail channels.`,
      'POSSIBLE_REQUIREMENT',
    ),
    g(
      'Country of origin ("Made in India" / "Product of India") marking is commonly expected.',
      'POSSIBLE_REQUIREMENT',
    ),
    g(
      'Importer / distributor details on the label are common for consumer goods.',
    ),
    kind === 'FOOD'
      ? g(
          'Food labels typically include net weight, batch/lot, and best-before date.',
          'POSSIBLE_REQUIREMENT',
        )
      : kind === 'TEXTILE'
        ? g(
            'Fibre composition and care instructions are typically shown on garment labels.',
            'POSSIBLE_REQUIREMENT',
          )
        : g(
            'Basic product details (model, material, ratings) are typically shown.',
          ),
  ];
}

function certificationsFor(kind: Kind, cc: string): CertificationItem[] {
  const gulf = cc === 'AE' || cc === 'SA';
  switch (kind) {
    case 'FOOD':
      return [
        c(
          'Phytosanitary certificate',
          'POTENTIALLY_REQUIRED',
          'Often requested for plant products — confirm with the importing authority.',
        ),
        c(
          'HACCP / ISO 22000 food-safety certification',
          'COMMONLY_REQUESTED',
          'Frequently asked for by buyers.',
        ),
        ...(gulf
          ? [
              c(
                'Halal certification',
                'COMMONLY_REQUESTED',
                'Common buyer expectation in this market.',
              ),
            ]
          : []),
      ];
    case 'TEXTILE':
      return [
        c(
          'OEKO-TEX or similar chemical-safety certification',
          'COMMONLY_REQUESTED',
          'Common buyer requirement for apparel.',
        ),
        c(
          'GOTS (only for organic claims)',
          'VERIFY_APPLICABILITY',
          'Relevant only if organic content is claimed.',
        ),
      ];
    case 'TABLEWARE':
      return [
        c(
          'Food-contact suitability test report',
          'COMMONLY_REQUESTED',
          'Buyers commonly ask for lab test evidence.',
        ),
        c(
          'Phytosanitary / fumigation certificate',
          'VERIFY_APPLICABILITY',
          'May apply to plant-based articles.',
        ),
      ];
    case 'PLASTIC':
      return [
        c(
          'Food-contact compliance test report',
          'POTENTIALLY_REQUIRED',
          'Depends on intended food use and market rules.',
        ),
      ];
    default:
      return [
        c(
          `Market conformity marking (${cc === 'DE' || cc === 'GB' ? 'e.g. CE / UKCA' : cc === 'US' ? 'e.g. UL / ETL listing' : 'local scheme'})`,
          'POTENTIALLY_REQUIRED',
          'Conformity assessment is common for power electronics — verify the applicable scheme.',
        ),
        c(
          'RoHS-type restricted-substance declaration',
          'COMMONLY_REQUESTED',
          'Common buyer request.',
        ),
      ];
  }
}

type Row = [
  product: string,
  country: string,
  importValue2025: number,
  cagrPercent: number,
  indiaShare: number,
  indiaSharePrev: number | null,
  indiaRank: number | null,
  competitors: [string, number, number | null][],
  tariff:
    | [applied: number, preferential: number | null, scheme: string | null]
    | null,
  unitValue: [current: number, previous: number] | null,
];

// Compact, hand-authored sample parameters. Partial-data cases: GB has no tariff data; LED has no unit values.
const ROWS: Row[] = [
  [
    '090931',
    'AE',
    210e6,
    6,
    72,
    70,
    1,
    [
      ['TR', 9, 4],
      ['AF', 6, 12],
      ['IR', 5, -3],
    ],
    [5, 0, 'India–UAE CEPA (sample)'],
    [3.4, 3.1],
  ],
  [
    '090931',
    'US',
    180e6,
    4,
    48,
    50,
    1,
    [
      ['TR', 18, 6],
      ['MX', 7, 2],
      ['EG', 6, 5],
      ['CN', 5, 1],
    ],
    [1, null, null],
    [4.1, 3.9],
  ],
  [
    '090931',
    'BD',
    95e6,
    5,
    88,
    87,
    1,
    [
      ['AF', 6, 9],
      ['EG', 3, 2],
    ],
    [25, null, null],
    [2.9, 2.7],
  ],
  [
    '090931',
    'CN',
    260e6,
    9,
    28,
    24,
    2,
    [
      ['IR', 30, 3],
      ['TR', 15, 6],
      ['EG', 12, 4],
      ['AF', 8, 15],
    ],
    [15, null, null],
    [2.8, 2.6],
  ],
  [
    '090931',
    'NG',
    12e6,
    2,
    40,
    41,
    1,
    [
      ['TR', 20, 3],
      ['EG', 15, 2],
    ],
    [20, null, null],
    [3.6, 3.5],
  ],
  [
    '090931',
    'GB',
    40e6,
    3,
    60,
    59,
    1,
    [
      ['TR', 14, 2],
      ['IR', 6, -1],
    ],
    null,
    [4.3, 4.2],
  ],
  [
    '610910',
    'US',
    5200e6,
    3,
    6,
    6.3,
    5,
    [
      ['CN', 28, -4],
      ['VN', 18, 8],
      ['BD', 14, 6],
      ['PK', 7, 5],
    ],
    [16.5, null, null],
    [3.9, 3.8],
  ],
  [
    '610910',
    'DE',
    2100e6,
    1,
    7,
    6.8,
    4,
    [
      ['BD', 32, 5],
      ['CN', 22, -3],
      ['TR', 14, 1],
    ],
    [12, null, null],
    [4.2, 4.2],
  ],
  [
    '610910',
    'GB',
    1400e6,
    2,
    8,
    7.5,
    4,
    [
      ['BD', 30, 4],
      ['CN', 20, -2],
      ['TR', 12, 2],
      ['PK', 6, 6],
    ],
    null,
    [4.0, 3.9],
  ],
  [
    '610910',
    'AE',
    600e6,
    6,
    18,
    16,
    2,
    [
      ['CN', 35, 2],
      ['BD', 15, 7],
    ],
    [5, 0, 'India–UAE CEPA (sample)'],
    [3.1, 3.0],
  ],
  [
    '610910',
    'SA',
    380e6,
    4,
    12,
    11,
    3,
    [
      ['CN', 40, 1],
      ['BD', 18, 6],
      ['TR', 10, 3],
    ],
    [12, null, null],
    [3.3, 3.2],
  ],
  [
    '610910',
    'NG',
    90e6,
    1,
    4,
    4,
    5,
    [
      ['CN', 55, 2],
      ['TR', 12, 1],
    ],
    [20, null, null],
    [2.6, 2.6],
  ],
  [
    '140490',
    'US',
    95e6,
    18,
    22,
    19,
    2,
    [
      ['CN', 40, 9],
      ['VN', 18, 14],
      ['TH', 8, 6],
    ],
    [0, null, null],
    [5.8, 5.4],
  ],
  [
    '140490',
    'DE',
    40e6,
    15,
    15,
    13,
    3,
    [
      ['CN', 35, 8],
      ['VN', 20, 12],
    ],
    [0, null, null],
    [6.1, 5.9],
  ],
  [
    '140490',
    'AE',
    8e6,
    12,
    30,
    27,
    2,
    [['CN', 30, 5]],
    [5, 0, 'India–UAE CEPA (sample)'],
    [4.9, 4.7],
  ],
  [
    '140490',
    'GB',
    18e6,
    14,
    14,
    12,
    3,
    [
      ['CN', 38, 7],
      ['VN', 15, 10],
    ],
    null,
    [6.0, 5.7],
  ],
  [
    '392410',
    'US',
    3100e6,
    -1,
    3,
    3.2,
    8,
    [
      ['CN', 62, -1],
      ['VN', 9, 10],
      ['MX', 6, 4],
      ['TW', 4, 0],
    ],
    [3.4, null, null],
    [4.4, 4.5],
  ],
  [
    '392410',
    'AE',
    310e6,
    2,
    14,
    15,
    2,
    [
      ['CN', 48, 3],
      ['TR', 9, 2],
    ],
    [5, 0, 'India–UAE CEPA (sample)'],
    [2.9, 2.9],
  ],
  [
    '392410',
    'SA',
    280e6,
    1,
    9,
    9.5,
    3,
    [
      ['CN', 52, 2],
      ['TR', 10, 1],
    ],
    [6, null, null],
    [2.8, 2.8],
  ],
  [
    '392410',
    'NG',
    140e6,
    4,
    6,
    6,
    3,
    [['CN', 58, 5]],
    [20, null, null],
    [2.2, 2.1],
  ],
  [
    '392410',
    'DE',
    1200e6,
    0,
    2,
    2.1,
    9,
    [
      ['CN', 45, -2],
      ['PL', 12, 3],
      ['TR', 6, 2],
    ],
    [6.5, null, null],
    [5.1, 5.2],
  ],
  [
    '850440',
    'US',
    14000e6,
    7,
    1.5,
    1.2,
    9,
    [
      ['CN', 46, 2],
      ['MX', 18, 12],
      ['VN', 8, 20],
      ['TW', 6, 1],
    ],
    [1.5, null, null],
    null,
  ],
  [
    '850440',
    'DE',
    6200e6,
    5,
    1.2,
    1.0,
    11,
    [
      ['CN', 40, 1],
      ['PL', 9, 6],
      ['MY', 6, 3],
    ],
    [2, null, null],
    null,
  ],
  [
    '850440',
    'AE',
    900e6,
    9,
    6,
    5,
    4,
    [['CN', 55, 4]],
    [5, 0, 'India–UAE CEPA (sample)'],
    null,
  ],
  ['850440', 'SA', 700e6, 6, 4, 3.5, 5, [['CN', 58, 3]], [5, null, null], null],
];

function build(row: Row): ProductCountryMarket {
  const [
    productCode,
    countryCode,
    latest,
    cagrPct,
    indiaShare,
    indiaPrev,
    indiaRank,
    competitors,
    tariff,
    unit,
  ] = row;
  const { kind, unit: qUnit } = PRODUCT_KIND[productCode];
  // Deterministic back-cast from the 2025 value at the sample CAGR (whole dollars).
  const yearly = [2021, 2022, 2023, 2024, 2025].map((yr) => {
    const value = Math.round(latest / Math.pow(1 + cagrPct / 100, 2025 - yr));
    const quantity =
      unit && qUnit
        ? Math.round(
            value / (yr === 2025 ? unit[0] : yr === 2024 ? unit[1] : unit[1]),
          )
        : null;
    return { period: String(yr), value, quantity };
  });
  const effective = tariff ? (tariff[1] ?? tariff[0]) : null;
  return {
    productCode,
    countryCode,
    currency: 'USD',
    quantityUnit: unit && qUnit ? qUnit : null,
    yearly,
    monthly: [],
    indiaSharePercent: indiaShare,
    indiaSharePreviousPercent: indiaPrev,
    indiaRank,
    competitors: competitors.map(([cc, share, growth]) => ({
      countryCode: cc,
      sharePercent: share,
      growthPercent: growth,
    })),
    tariff: tariff
      ? {
          appliedRatePercent: tariff[0],
          preferentialRatePercent: tariff[1],
          preferentialScheme: tariff[2],
          tariffType: 'Ad valorem (sample)',
          effectiveDate: '2026-01-01',
        }
      : null,
    barriers: barriersFor(kind, countryCode, effective),
    unitValue:
      unit && qUnit
        ? {
            current: unit[0],
            previous: unit[1],
            unit: `USD/${qUnit === 'NOS' ? 'piece' : 'kg'}`,
          }
        : null,
    packaging: packagingFor(kind),
    labeling: labelingFor(kind, countryCode),
    certifications: certificationsFor(kind, countryCode),
  };
}

const MARKETS = ROWS.map(build);

export class SampleCountryDataProvider implements CountryTradeDataProvider {
  readonly source = SOURCE;

  countryProfile(countryCode: string): CountryProfile | null {
    return COUNTRIES.find((p) => p.countryCode === countryCode) ?? null;
  }

  supportedCountries(): string[] {
    return COUNTRIES.map((p) => p.countryCode);
  }

  marketsForProduct(productCode: string): ProductCountryMarket[] {
    return MARKETS.filter((m) => m.productCode === productCode);
  }

  marketsForCountry(countryCode: string): ProductCountryMarket[] {
    return MARKETS.filter((m) => m.countryCode === countryCode);
  }

  market(
    productCode: string,
    countryCode: string,
  ): ProductCountryMarket | null {
    return (
      MARKETS.find(
        (m) => m.productCode === productCode && m.countryCode === countryCode,
      ) ?? null
    );
  }
}
