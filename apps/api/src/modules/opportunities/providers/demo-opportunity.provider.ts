import { Injectable } from '@nestjs/common';
import { FreshnessStatus, InvestmentRange } from '@exportpro/types';
import {
  OpportunityCandidate,
  OpportunityDataProvider,
} from './opportunity-data.provider';

const PRODUCTS: { name: string; category: string }[] = [
  { name: 'Basmati Rice', category: 'AGRICULTURE' },
  { name: 'Fresh Mangoes', category: 'AGRICULTURE' },
  { name: 'Organic Honey', category: 'FOOD_BEVERAGES' },
  { name: 'Processed Snacks', category: 'FOOD_BEVERAGES' },
  { name: 'Cumin Seeds', category: 'SPICES' },
  { name: 'Turmeric Powder', category: 'SPICES' },
  { name: 'Black Pepper', category: 'SPICES' },
  { name: 'Cotton T-Shirts', category: 'TEXTILES' },
  { name: 'Cotton Yarn', category: 'TEXTILES' },
  { name: 'Areca Leaf Plates', category: 'HANDICRAFTS' },
  { name: 'Wooden Handicrafts', category: 'HANDICRAFTS' },
  { name: 'Industrial Chemicals', category: 'CHEMICALS' },
  { name: 'Generic Pharmaceuticals', category: 'PHARMACEUTICALS' },
  { name: 'Precision Engineering Parts', category: 'ENGINEERING_GOODS' },
  { name: 'Auto Components', category: 'AUTO_COMPONENTS' },
  { name: 'LED Components', category: 'ELECTRONICS' },
  { name: 'Plastic Packaging Rolls', category: 'PLASTICS' },
  { name: 'Wooden Furniture', category: 'FURNITURE' },
  { name: 'Corrugated Packaging', category: 'PACKAGING' },
  { name: 'Leather Bags', category: 'LEATHER' },
  { name: 'Silver Jewellery', category: 'GEMS_JEWELLERY' },
  { name: 'Stainless Steel Kitchenware', category: 'HOME_KITCHEN' },
  { name: 'Ayurvedic Cosmetics', category: 'BEAUTY_PERSONAL_CARE' },
];

const COUNTRIES = ['AE', 'US', 'DE', 'GB', 'SA', 'SG', 'NL', 'JP'];

const INVESTMENT_RANGES: InvestmentRange[] = [
  'UNDER_1L',
  'L1_5',
  'L5_10',
  'L10_25',
  'L25_50',
  'L50_1CR',
  'ABOVE_1CR',
];

/** Deterministic string hash (FNV-1a) — same input always produces the same demo row, so re-seeding is idempotent. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** [0, 1) pseudo-random value derived from a key + salt, decorrelated per metric via the salt. */
function rand(key: string, salt: string): number {
  return (hash(`${key}::${salt}`) % 10_000) / 10_000;
}

@Injectable()
export class DemoOpportunityProvider implements OpportunityDataProvider {
  generate(): OpportunityCandidate[] {
    const candidates: OpportunityCandidate[] = [];
    const now = Date.now();

    for (const product of PRODUCTS) {
      for (const country of COUNTRIES) {
        const key = `${product.name}|${country}`;
        // Keep roughly half of the full product×country matrix so the
        // dataset lands in the 30-100 range the spec asks for, rather
        // than every product appearing in every country.
        if (hash(key) % 2 !== 0) continue;

        const freshnessRoll = Math.floor(rand(key, 'freshness') * 10);
        const freshnessStatus: FreshnessStatus =
          freshnessRoll <= 4
            ? 'FRESH'
            : freshnessRoll <= 7
              ? 'RECENT'
              : freshnessRoll === 8
                ? 'STALE'
                : 'UNKNOWN';
        const ageDays = { FRESH: 15, RECENT: 120, STALE: 420, UNKNOWN: 600 }[
          freshnessStatus
        ];
        const sourceDate = new Date(
          now -
            ageDays * 24 * 60 * 60 * 1000 -
            Math.floor(rand(key, 'age') * 30) * 86_400_000,
        );

        candidates.push({
          productName: product.name,
          productCategoryCode: product.category,
          destinationCountryCode: country,
          raw: {
            demandRaw: 30 + rand(key, 'demand') * 70,
            indiaExportRaw: 20 + rand(key, 'india') * 75,
            growthPct: -15 + rand(key, 'growth') * 65,
            competitionRaw: 15 + rand(key, 'competition') * 80,
            complianceDifficultyRaw: 10 + rand(key, 'compliance') * 75,
            logisticsComplexityRaw: 10 + rand(key, 'logistics') * 75,
            marginPct: 5 + rand(key, 'margin') * 45,
            seasonalityRaw: 10 + rand(key, 'seasonality') * 80,
            marketDiversityRaw: 25 + rand(key, 'diversity') * 70,
          },
          investmentRange:
            INVESTMENT_RANGES[
              Math.floor(rand(key, 'investment') * INVESTMENT_RANGES.length)
            ],
          sourceType: 'DEMO',
          sourceName: 'Internal Demo Dataset',
          sourceUrl: null,
          sourceDate,
          freshnessStatus,
        });
      }
    }

    return candidates;
  }
}
