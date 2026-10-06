import {
  COUNTRY_META,
  type CodeSystem,
  type MappingStatus,
  type PartnerEntityType,
  type PeriodType,
} from '@exportpro/types';
import { INDIAN_STATES } from '../../product-intelligence/indian-states';

/** Bump when any normalization rule changes; persisted on runs and facts so data can be reprocessed. */
export const TRANSFORM_VERSION = 'trade-normalizer-v1';

const squash = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s._\-,/()&']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// --- HS / ITC-HS -------------------------------------------------------------

export type HsResult =
  | {
      ok: true;
      code: string;
      codeSystem: CodeSystem;
      level: number;
      parent: string | null;
      status: MappingStatus;
    }
  | { ok: false; reason: string };

/**
 * Strips punctuation/spaces; restores a single leading zero lost by
 * spreadsheets (odd length). 2/4/6 digits = HS, 8 digits = ITC-HS (India)
 * only — an 8-digit national line is never treated as portable HS.
 */
export function normalizeHsCode(raw: unknown, allowItc = true): HsResult {
  if (raw === null || raw === undefined)
    return { ok: false, reason: 'Missing HS code' };
  let code = String(raw)
    .trim()
    .replace(/[\s.\-]/g, '');
  if (!/^\d+$/.test(code))
    return { ok: false, reason: `HS code "${String(raw)}" is not numeric` };
  let status: MappingStatus = 'EXACT';
  if (code.length % 2 === 1 && code.length <= 7) {
    code = `0${code}`;
    status = 'HIGH_CONFIDENCE';
  }
  if (![2, 4, 6, 8].includes(code.length))
    return {
      ok: false,
      reason: `HS code "${String(raw)}" has an unsupported length`,
    };
  if (code.length === 8 && !allowItc)
    return {
      ok: false,
      reason: '8-digit national codes are not valid for this source',
    };
  const codeSystem: CodeSystem = code.length === 8 ? 'ITC_HS_INDIA' : 'HS';
  const parent =
    code.length === 2
      ? null
      : code.slice(0, code.length === 8 ? 6 : code.length - 2);
  return { ok: true, code, codeSystem, level: code.length, parent, status };
}

// --- Countries ---------------------------------------------------------------

export interface CountryInput {
  iso2?: string | null;
  iso3?: string | null;
  name?: string | null;
  /** Adapter-resolved entity type when the source reference says so (e.g. Comtrade "World"/groups). */
  entityType?: PartnerEntityType;
}

export interface CountryResult {
  code: string | null;
  entityType: PartnerEntityType;
  status: MappingStatus;
  label: string;
}

/** Common source spellings (incl. TradeStat-style abbreviations). Aggregates are never mapped to a country. */
const COUNTRY_ALIASES: Record<string, string> = {
  uae: 'AE',
  'u a e': 'AE',
  'u arab emts': 'AE',
  'united arab emirates': 'AE',
  usa: 'US',
  'u s a': 'US',
  us: 'US',
  'united states of america': 'US',
  'united states': 'US',
  uk: 'GB',
  'u k': 'GB',
  'united kingdom': 'GB',
  'great britain': 'GB',
  britain: 'GB',
  ksa: 'SA',
  'saudi arab': 'SA',
  'saudi arabia': 'SA',
  'china p rp': 'CN',
  'china p r': 'CN',
  'peoples republic of china': 'CN',
  china: 'CN',
  'bangladesh pr': 'BD',
  bangladesh: 'BD',
  'korea rp': 'KR',
  'south korea': 'KR',
  'republic of korea': 'KR',
  netherland: 'NL',
  netherlands: 'NL',
  holland: 'NL',
  russia: 'RU',
  'russian federation': 'RU',
  'viet nam': 'VN',
  vietnam: 'VN',
  turkiye: 'TR',
  turkey: 'TR',
  iran: 'IR',
  'iran islamic rep': 'IR',
  'hong kong': 'HK',
  'hong kong sar': 'HK',
  taiwan: 'TW',
  'chinese taipei': 'TW',
};
const AGGREGATE_NAMES = new Set([
  'world',
  'total',
  'all countries',
  'grand total',
]);
const OTHER_NAMES = new Set([
  'others',
  'other',
  'unspecified',
  'areas nes',
  'not specified',
  'special categories',
  'bunkers',
  'free zones',
]);

const NAME_TO_ISO2 = new Map<string, string>(
  Object.values(COUNTRY_META).map((c) => [squash(c.name), c.code]),
);

export function normalizeCountry(input: CountryInput): CountryResult {
  const label = input.name?.trim() || input.iso2 || input.iso3 || 'Unknown';
  if (input.entityType && input.entityType !== 'COUNTRY') {
    return { code: null, entityType: input.entityType, status: 'EXACT', label };
  }
  const iso2 = input.iso2?.trim().toUpperCase();
  if (iso2 && /^[A-Z]{2}$/.test(iso2))
    return { code: iso2, entityType: 'COUNTRY', status: 'EXACT', label };
  if (input.name) {
    const key = squash(input.name);
    if (AGGREGATE_NAMES.has(key))
      return { code: null, entityType: 'WORLD', status: 'EXACT', label };
    if (OTHER_NAMES.has(key))
      return { code: null, entityType: 'OTHER', status: 'EXACT', label };
    const exact = NAME_TO_ISO2.get(key);
    if (exact)
      return { code: exact, entityType: 'COUNTRY', status: 'EXACT', label };
    const alias = COUNTRY_ALIASES[key];
    if (alias)
      return {
        code: alias,
        entityType: 'COUNTRY',
        status: 'HIGH_CONFIDENCE',
        label,
      };
    if (/^[a-z]{2}$/.test(key) && COUNTRY_META[key.toUpperCase()])
      return {
        code: key.toUpperCase(),
        entityType: 'COUNTRY',
        status: 'EXACT',
        label,
      };
  }
  return { code: null, entityType: 'OTHER', status: 'UNRESOLVED', label };
}

// --- Units -------------------------------------------------------------------

/** Canonical unit → (family, factor to the family base). Conversion only within a family. */
const UNIT_DEFS: Record<
  string,
  { family: string; base: string; factor: number }
> = {
  KG: { family: 'MASS', base: 'KG', factor: 1 },
  MT: { family: 'MASS', base: 'KG', factor: 1000 },
  G: { family: 'MASS', base: 'KG', factor: 0.001 },
  CARAT: { family: 'MASS', base: 'KG', factor: 0.0002 },
  NUMBER: { family: 'COUNT', base: 'NUMBER', factor: 1 },
  DOZEN: { family: 'COUNT', base: 'NUMBER', factor: 12 },
  THOUSAND_UNITS: { family: 'COUNT', base: 'NUMBER', factor: 1000 },
  PAIR: { family: 'PAIR', base: 'PAIR', factor: 1 },
  LITRE: { family: 'VOLUME', base: 'LITRE', factor: 1 },
  KILOLITRE: { family: 'VOLUME', base: 'LITRE', factor: 1000 },
  CU_M: { family: 'CUBIC', base: 'CU_M', factor: 1 },
  SQ_M: { family: 'AREA', base: 'SQ_M', factor: 1 },
  M: { family: 'LENGTH', base: 'M', factor: 1 },
  PACKAGE: { family: 'PACKAGE', base: 'PACKAGE', factor: 1 },
  THOUSAND_KWH: { family: 'ENERGY', base: 'THOUSAND_KWH', factor: 1 },
};
const UNIT_ALIASES: Record<string, string> = {
  kg: 'KG',
  kgs: 'KG',
  kilogram: 'KG',
  kilograms: 'KG',
  'weight in kilograms': 'KG',
  mt: 'MT',
  ton: 'MT',
  tons: 'MT',
  tonne: 'MT',
  tonnes: 'MT',
  'metric ton': 'MT',
  'metric tonne': 'MT',
  ton1000kg: 'MT',
  g: 'G',
  gm: 'G',
  gram: 'G',
  grams: 'G',
  carat: 'CARAT',
  ct: 'CARAT',
  crt: 'CARAT',
  u: 'NUMBER',
  nos: 'NUMBER',
  no: 'NUMBER',
  number: 'NUMBER',
  numbers: 'NUMBER',
  pcs: 'NUMBER',
  pieces: 'NUMBER',
  units: 'NUMBER',
  unit: 'NUMBER',
  '12u': 'DOZEN',
  dozen: 'DOZEN',
  doz: 'DOZEN',
  '1000u': 'THOUSAND_UNITS',
  'thousand units': 'THOUSAND_UNITS',
  '2u': 'PAIR',
  pair: 'PAIR',
  pairs: 'PAIR',
  prs: 'PAIR',
  l: 'LITRE',
  ltr: 'LITRE',
  litre: 'LITRE',
  liter: 'LITRE',
  litres: 'LITRE',
  kl: 'KILOLITRE',
  kilolitre: 'KILOLITRE',
  'm³': 'CU_M',
  m3: 'CU_M',
  cbm: 'CU_M',
  'cu m': 'CU_M',
  'm²': 'SQ_M',
  m2: 'SQ_M',
  sqm: 'SQ_M',
  'sq m': 'SQ_M',
  m: 'M',
  mtr: 'M',
  meter: 'M',
  metre: 'M',
  'u jeu pack': 'PACKAGE',
  package: 'PACKAGE',
  packages: 'PACKAGE',
  '1000 kwh': 'THOUSAND_KWH',
};

export interface UnitResult {
  canonical: string | null;
  normalizedUnit: string | null;
  normalizedQuantity: number | null;
  status: MappingStatus;
}

/** Converts only within a physical family (KG never becomes pieces). Unknown units keep the raw value with UNRESOLVED status. */
export function normalizeQuantity(
  quantity: number | null,
  rawUnit: string | null | undefined,
): UnitResult {
  if (quantity === null) {
    const canonical = rawUnit ? (UNIT_ALIASES[squash(rawUnit)] ?? null) : null;
    return {
      canonical,
      normalizedUnit: null,
      normalizedQuantity: null,
      status: canonical || !rawUnit ? 'EXACT' : 'UNRESOLVED',
    };
  }
  if (!rawUnit || ['n a', 'na', '-1'].includes(squash(rawUnit)))
    return {
      canonical: null,
      normalizedUnit: null,
      normalizedQuantity: null,
      status: 'UNRESOLVED',
    };
  const canonical = UNIT_DEFS[rawUnit.toUpperCase()]
    ? rawUnit.toUpperCase()
    : (UNIT_ALIASES[squash(rawUnit)] ?? UNIT_ALIASES[rawUnit.trim()] ?? null);
  if (!canonical)
    return {
      canonical: null,
      normalizedUnit: null,
      normalizedQuantity: null,
      status: 'UNRESOLVED',
    };
  const def = UNIT_DEFS[canonical];
  return {
    canonical,
    normalizedUnit: def.base,
    normalizedQuantity: round4(quantity * def.factor),
    status: 'EXACT',
  };
}

export const unitFamily = (unit: string | null) =>
  unit && UNIT_DEFS[unit] ? UNIT_DEFS[unit].family : null;

// --- Period ------------------------------------------------------------------

export type PeriodResult =
  | {
      ok: true;
      periodType: PeriodType;
      year: number;
      month: number | null;
      periodStart: Date;
      periodEnd: Date;
      label: string;
    }
  | { ok: false; reason: string };

/** Annual data stays annual — never expanded to months. */
export function normalizePeriod(
  year: unknown,
  month?: unknown,
  quarter?: unknown,
  now = new Date(),
): PeriodResult {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1988 || y > now.getUTCFullYear() + 1)
    return { ok: false, reason: `Invalid year "${String(year)}"` };
  const hasMonth =
    month !== undefined && month !== null && String(month).trim() !== '';
  if (hasMonth) {
    const m = Number(month);
    if (!Number.isInteger(m) || m < 1 || m > 12)
      return { ok: false, reason: `Invalid month "${String(month)}"` };
    return {
      ok: true,
      periodType: 'MONTH',
      year: y,
      month: m,
      periodStart: utc(y, m - 1, 1),
      periodEnd: utc(y, m, 0),
      label: `${y}-${String(m).padStart(2, '0')}`,
    };
  }
  const hasQuarter =
    quarter !== undefined && quarter !== null && String(quarter).trim() !== '';
  if (hasQuarter) {
    const q = Number(String(quarter).replace(/^q/i, ''));
    if (!Number.isInteger(q) || q < 1 || q > 4)
      return { ok: false, reason: `Invalid quarter "${String(quarter)}"` };
    return {
      ok: true,
      periodType: 'QUARTER',
      year: y,
      month: null,
      periodStart: utc(y, (q - 1) * 3, 1),
      periodEnd: utc(y, q * 3, 0),
      label: `${y}-Q${q}`,
    };
  }
  return {
    ok: true,
    periodType: 'YEAR',
    year: y,
    month: null,
    periodStart: utc(y, 0, 1),
    periodEnd: utc(y, 12, 0),
    label: String(y),
  };
}

// --- Numbers & currency --------------------------------------------------------

export type NumberResult =
  { ok: true; value: number | null } | { ok: false; reason: string };

/** Missing stays null (never 0). Negative or non-numeric values are rejected. */
export function parseNonNegative(raw: unknown): NumberResult {
  if (
    raw === null ||
    raw === undefined ||
    (typeof raw === 'string' && raw.trim() === '')
  )
    return { ok: true, value: null };
  const n =
    typeof raw === 'number'
      ? raw
      : Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n))
    return { ok: false, reason: `"${String(raw)}" is not a number` };
  if (n < 0) return { ok: false, reason: `Negative value ${n} is not allowed` };
  return { ok: true, value: n };
}

export function normalizeCurrency(
  raw: unknown,
): { ok: true; code: string } | { ok: false; reason: string } {
  const c = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/^US\$$/, 'USD');
  if (!/^[A-Z]{3}$/.test(c))
    return { ok: false, reason: `Unknown currency "${String(raw)}"` };
  return { ok: true, code: c };
}

// --- Indian ports, states, districts ---------------------------------------------

export interface IndianPort {
  code: string;
  name: string;
  stateCode: string;
  type: 'SEA' | 'AIR' | 'ICD';
  aliases: string[];
}

/** Canonical Indian port reference (UN/LOCODE-style customs codes). One identity per physical port. */
export const INDIAN_PORTS: IndianPort[] = [
  {
    code: 'INNSA1',
    name: 'Nhava Sheva (JNPT)',
    stateCode: 'MH',
    type: 'SEA',
    aliases: [
      'nhava sheva',
      'jnpt',
      'jawaharlal nehru port',
      'jawaharlal nehru port trust',
      'jn port',
      'nhava sheva sea',
      'nhava sheva jnpt',
    ],
  },
  {
    code: 'INMUN1',
    name: 'Mundra',
    stateCode: 'GJ',
    type: 'SEA',
    aliases: ['mundra', 'mundra port', 'mundra sea'],
  },
  {
    code: 'INIXY1',
    name: 'Deendayal (Kandla)',
    stateCode: 'GJ',
    type: 'SEA',
    aliases: [
      'kandla',
      'deendayal',
      'deendayal port',
      'deendayal kandla',
      'kandla sea',
    ],
  },
  {
    code: 'INPAV1',
    name: 'Pipavav',
    stateCode: 'GJ',
    type: 'SEA',
    aliases: ['pipavav', 'pipavav victor port'],
  },
  {
    code: 'INMAA1',
    name: 'Chennai',
    stateCode: 'TN',
    type: 'SEA',
    aliases: ['chennai', 'chennai sea', 'madras'],
  },
  {
    code: 'INENR1',
    name: 'Kamarajar (Ennore)',
    stateCode: 'TN',
    type: 'SEA',
    aliases: ['ennore', 'kamarajar', 'kamarajar port'],
  },
  {
    code: 'INKAT1',
    name: 'Kattupalli',
    stateCode: 'TN',
    type: 'SEA',
    aliases: ['kattupalli'],
  },
  {
    code: 'INTUT1',
    name: 'V.O. Chidambaranar (Tuticorin)',
    stateCode: 'TN',
    type: 'SEA',
    aliases: [
      'tuticorin',
      'thoothukudi',
      'v o chidambaranar',
      'voc port',
      'tuticorin sea',
    ],
  },
  {
    code: 'INCOK1',
    name: 'Cochin',
    stateCode: 'KL',
    type: 'SEA',
    aliases: ['cochin', 'kochi', 'cochin sea'],
  },
  {
    code: 'INIXE1',
    name: 'New Mangalore',
    stateCode: 'KA',
    type: 'SEA',
    aliases: ['new mangalore', 'mangalore', 'mangaluru', 'panambur'],
  },
  {
    code: 'INCCU1',
    name: 'Kolkata',
    stateCode: 'WB',
    type: 'SEA',
    aliases: [
      'kolkata',
      'calcutta',
      'kolkata sea',
      'syama prasad mookerjee port',
    ],
  },
  {
    code: 'INHAL1',
    name: 'Haldia',
    stateCode: 'WB',
    type: 'SEA',
    aliases: ['haldia'],
  },
  {
    code: 'INVTZ1',
    name: 'Visakhapatnam',
    stateCode: 'AP',
    type: 'SEA',
    aliases: ['visakhapatnam', 'vizag', 'vishakhapatnam'],
  },
  {
    code: 'INTKD6',
    name: 'ICD Tughlakabad',
    stateCode: 'DL',
    type: 'ICD',
    aliases: ['icd tughlakabad', 'tughlakabad', 'icd tkd'],
  },
  {
    code: 'INDEL4',
    name: 'Delhi Air Cargo',
    stateCode: 'DL',
    type: 'AIR',
    aliases: ['delhi air cargo', 'delhi air', 'igi airport', 'new delhi air'],
  },
  {
    code: 'INBOM4',
    name: 'Mumbai Air Cargo',
    stateCode: 'MH',
    type: 'AIR',
    aliases: ['mumbai air cargo', 'mumbai air', 'sahar air cargo'],
  },
  {
    code: 'INBLR4',
    name: 'Bengaluru Air Cargo',
    stateCode: 'KA',
    type: 'AIR',
    aliases: [
      'bengaluru air cargo',
      'bangalore air cargo',
      'bangalore air',
      'bengaluru air',
    ],
  },
  {
    code: 'INHYD4',
    name: 'Hyderabad Air Cargo',
    stateCode: 'TS',
    type: 'AIR',
    aliases: ['hyderabad air cargo', 'hyderabad air'],
  },
];
const PORT_INDEX = new Map<string, string>();
for (const p of INDIAN_PORTS) {
  PORT_INDEX.set(p.code.toLowerCase(), p.code);
  PORT_INDEX.set(squash(p.name), p.code);
  for (const a of p.aliases) PORT_INDEX.set(squash(a), p.code);
}

export function normalizePort(
  raw: string | null | undefined,
): { code: string | null; status: MappingStatus } | null {
  if (!raw || !raw.trim()) return null;
  const code =
    PORT_INDEX.get(squash(raw)) ?? PORT_INDEX.get(raw.trim().toLowerCase());
  return code
    ? { code, status: 'EXACT' }
    : { code: null, status: 'UNRESOLVED' };
}

const STATE_ALIASES: Record<string, string> = {
  orissa: 'OD',
  uttaranchal: 'UK',
  pondicherry: 'PY',
  'nct of delhi': 'DL',
  'new delhi': 'DL',
  'j k': 'JK',
  'jammu kashmir': 'JK',
  'jammu and kashmir': 'JK',
  'daman and diu': 'DH',
  'dadra and nagar haveli': 'DH',
  'andaman nicobar': 'AN',
  telengana: 'TS',
};
const STATE_INDEX = new Map<string, string>();
for (const [code, s] of Object.entries(INDIAN_STATES)) {
  STATE_INDEX.set(code.toLowerCase(), code);
  STATE_INDEX.set(squash(s.name), code);
}
for (const [alias, code] of Object.entries(STATE_ALIASES))
  STATE_INDEX.set(alias, code);

export function normalizeState(
  raw: string | null | undefined,
): { code: string | null; status: MappingStatus } | null {
  if (!raw || !raw.trim()) return null;
  const key = squash(raw);
  const code =
    STATE_INDEX.get(key) ?? STATE_INDEX.get(raw.trim().toLowerCase());
  if (!code) return { code: null, status: 'UNRESOLVED' };
  return { code, status: STATE_ALIASES[key] ? 'HIGH_CONFIDENCE' : 'EXACT' };
}

/** Districts are keyed within their state only — never merged by name across states. Without a state the district stays unresolved. */
export function normalizeDistrict(
  raw: string | null | undefined,
  stateCode: string | null,
) {
  if (!raw || !raw.trim()) return null;
  const label = raw.trim().replace(/\s+/g, ' ');
  if (!stateCode)
    return { key: null, label, status: 'UNRESOLVED' as MappingStatus };
  return {
    key: `${stateCode}:${squash(label).replace(/ /g, '-')}`,
    label,
    status: 'HIGH_CONFIDENCE' as MappingStatus,
  };
}

/** Display-only label cleanup; canonical trade identity is the HS code, never the name. */
export function normalizeProductLabel(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;:])\s*/g, '$1 ')
    .trim();
}

function utc(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d));
}
function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
