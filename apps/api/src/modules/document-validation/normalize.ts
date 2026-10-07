import { COUNTRIES, RFQ_INCOTERMS } from '@exportpro/types';

/**
 * Deterministic normalizers for comparison. Originals are always kept by the
 * caller; these return a comparable value or null, plus an ambiguity flag when
 * the input cannot be read safely (never a silent guess).
 */
export interface Parsed {
  value: string | null;
  ambiguous: boolean;
  note: string | null;
}
const ok = (value: string | null, note: string | null = null): Parsed => ({
  value,
  ambiguous: false,
  note,
});
const amb = (note: string): Parsed => ({ value: null, ambiguous: true, note });

export const collapse = (s: string | null | undefined) =>
  (s ?? '').replace(/\s+/g, ' ').trim();

/** Case/whitespace/punctuation-insensitive text key (formatting only — no fuzzy matching). */
export const textKey = (s: string | null | undefined) =>
  collapse(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

/** Documents that write decimals with a comma (e.g. "12,5") make "1,234" ambiguous. */
export const usesDecimalComma = (text: string) =>
  /\d,\d{1,2}(?!\d)/.test(text) && !/\d\.\d{1,2}(?!\d)/.test(text);

export function parseNumber(
  raw: string | null | undefined,
  decimalComma = false,
): Parsed {
  if (raw === null || raw === undefined) return ok(null);
  let s = String(raw)
    .replace(/[^\d.,-]/g, '')
    .replace(/(?!^)-/g, '');
  if (!s || !/\d/.test(s)) return ok(null, 'No number found.');
  const hasC = s.includes(',');
  const hasD = s.includes('.');
  if (hasC && hasD) {
    const decimalIsComma = s.lastIndexOf(',') > s.lastIndexOf('.');
    s = decimalIsComma
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasC) {
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) {
      if (decimalComma)
        return amb(
          `“${raw}” could be a thousands separator or a decimal comma.`,
        );
      s = s.replace(/,/g, '');
    } else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    else return amb(`Cannot read number “${raw}”.`);
  } else if (hasD && /^-?\d{1,3}(\.\d{3}){2,}$/.test(s))
    s = s.replace(/\./g, '');
  else if (hasD && /^-?\d{1,3}\.\d{3}$/.test(s) && decimalComma)
    return amb(`“${raw}” could be a thousands separator or a decimal point.`);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return amb(`Cannot read number “${raw}”.`);
  const n = s.replace(/^(-?)0+(?=\d)/, '$1');
  return ok(n.includes('.') ? n.replace(/0+$/, '').replace(/\.$/, '') : n);
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  )
    return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Dates → ISO. Numeric a/b/yyyy with both parts ≤ 12 is ambiguous (DD/MM vs MM/DD). */
export function parseDate(raw: string | null | undefined): Parsed {
  const s = collapse(raw).replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return ok(null);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ok(iso(+m[1], +m[2], +m[3]), null);
  m = /^(\d{1,2})[\s.-]*([A-Za-z]{3,9})[\s.-]*(\d{2,4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase().slice(0, 4)] !== undefined)
    return ok(
      iso(
        year(m[3]),
        MONTHS[m[2].toLowerCase().slice(0, 4)] ??
          MONTHS[m[2].toLowerCase().slice(0, 3)],
        +m[1],
      ),
    );
  if (m && MONTHS[m[2].toLowerCase().slice(0, 3)])
    return ok(iso(year(m[3]), MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1]));
  m = /^([A-Za-z]{3,9})[\s.-]*(\d{1,2})[\s.-]+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase().slice(0, 3)])
    return ok(iso(+m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = year(m[3]);
    if (a > 12 && b <= 12) return ok(iso(y, b, a));
    if (b > 12 && a <= 12) return ok(iso(y, a, b));
    if (a === b) return ok(iso(y, a, b));
    return amb(`“${raw}” could be DD/MM or MM/DD — confirm the date.`);
  }
  return amb(`Cannot read date “${raw}”.`);
}

const CURRENCY_SYMBOLS: [RegExp, string][] = [
  [/^(us\$|usd|us dollars?|u\.s\. dollars?)$/i, 'USD'],
  [/^(€|eur|euros?)$/i, 'EUR'],
  [/^(£|gbp|pounds? sterling)$/i, 'GBP'],
  [/^(₹|inr|rs\.?|rupees?|indian rupees?)$/i, 'INR'],
  [/^(aed|dirhams?|uae dirhams?)$/i, 'AED'],
  [/^(¥|jpy|yen)$/i, 'JPY'],
];
/** ISO currency. A bare "$" is ambiguous (USD/AUD/SGD …) and is flagged. */
export function parseCurrency(raw: string | null | undefined): Parsed {
  const s = collapse(raw)
    .replace(/[0-9.,\s]+$/, '')
    .trim();
  if (!s) return ok(null);
  for (const [re, code] of CURRENCY_SYMBOLS) if (re.test(s)) return ok(code);
  if (/^[A-Z]{3}$/.test(s.toUpperCase()) && /^[A-Za-z]{3}$/.test(s))
    return ok(s.toUpperCase());
  if (s === '$')
    return amb('“$” alone does not identify the currency (USD, AUD, SGD …).');
  return amb(`Unknown currency “${raw}”.`);
}

/** Incoterm code (existing RFQ_INCOTERMS) and the named place, kept separate. */
export function parseIncoterm(raw: string | null | undefined): {
  code: Parsed;
  place: string | null;
} {
  const s = collapse(raw);
  if (!s) return { code: ok(null), place: null };
  const tokens = s
    .toUpperCase()
    .replace(/INCOTERMS?\s*(®|\(R\))?\s*(20\d\d)?/g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  const found = tokens.filter((t) =>
    (RFQ_INCOTERMS as readonly string[]).includes(t),
  );
  if (new Set(found).size > 1)
    return { code: amb(`Several Incoterms in “${raw}”.`), place: null };
  if (!found.length)
    return { code: amb(`No recognised Incoterm in “${raw}”.`), place: null };
  const idx = s.toUpperCase().indexOf(found[0]);
  const place =
    collapse(
      s
        .slice(idx + found[0].length)
        .replace(/^[\s,:-]+/, '')
        .replace(/incoterms?.*$/i, ''),
    ) || null;
  return { code: ok(found[0]), place };
}

const UNIT_MAP: [RegExp, string][] = [
  [/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/i, 'KG'],
  [/^(mt|mts|m\/t|ton|tons|tonne|tonnes|metric tons?|metric tonnes?)$/i, 'MT'],
  [/^(g|gm|gms|gram|grams)$/i, 'G'],
  [/^(lb|lbs|pound|pounds)$/i, 'LB'],
  [/^(pcs|pc|piece|pieces|nos|no|unit|units)$/i, 'UNIT'],
  [/^(ctn|ctns|carton|cartons)$/i, 'CARTON'],
  [/^(bag|bags)$/i, 'BAG'],
];
/** Units: synonyms only (no guessing between unrelated units). */
export function parseUnit(raw: string | null | undefined): Parsed {
  const s = collapse(raw).replace(/\.$/, '');
  if (!s) return ok(null);
  for (const [re, u] of UNIT_MAP) if (re.test(s)) return ok(u);
  return ok(s.toUpperCase());
}

/** Safe mass conversions only (no carton → kg). */
const TO_KG: Record<string, string> = {
  KG: '1',
  MT: '1000',
  G: '0.001',
  LB: '0.45359237',
};
export const massFactor = (unit: string | null) =>
  unit ? (TO_KG[unit] ?? null) : null;

/** Weight like "10,120 KGS" or "10.12 MT" → kg. No unit → kept as stated (field is kg) with a note. */
export function parseWeightKg(
  raw: string | null | undefined,
  decimalComma = false,
): Parsed {
  const s = collapse(raw);
  if (!s) return ok(null);
  const unitMatch = /([A-Za-z/]+)\.?\s*$/.exec(s);
  const n = parseNumber(s.replace(/[A-Za-z/]+\.?\s*$/, ''), decimalComma);
  if (n.ambiguous || n.value === null) return n;
  const unit = unitMatch ? parseUnit(unitMatch[1]).value : null;
  if (!unit)
    return ok(n.value, 'Unit not stated — read as kg per the field label.');
  const f = massFactor(unit);
  if (!f) return amb(`Weight unit “${unitMatch![1]}” is not a mass unit.`);
  const v = (Number(n.value) * Number(f)).toFixed(3).replace(/\.?0+$/, '');
  return ok(v, unit === 'KG' ? null : `Converted from ${unit}.`);
}

const COUNTRY_ALIASES: Record<string, string> = {
  uae: 'AE',
  'u a e': 'AE',
  usa: 'US',
  'u s a': 'US',
  'united states of america': 'US',
  uk: 'GB',
  'u k': 'GB',
  'great britain': 'GB',
  england: 'GB',
  holland: 'NL',
};
export function parseCountry(raw: string | null | undefined): Parsed {
  const s = collapse(raw);
  if (!s) return ok(null);
  if (/^[A-Z]{2}$/.test(s) && COUNTRIES.some((c) => c.code === s)) return ok(s);
  const k = textKey(s);
  if (COUNTRY_ALIASES[k]) return ok(COUNTRY_ALIASES[k]);
  const c = COUNTRIES.find((x) => textKey(x.label) === k);
  return c ? ok(c.code) : amb(`Unknown country “${raw}”.`);
}

/** Country mentioned in an address (formatting-only detection). */
export function addressCountry(addr: string | null | undefined): string | null {
  const k = ` ${textKey(addr)} `;
  if (!k.trim()) return null;
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES))
    if (k.includes(` ${alias} `)) return code;
  const hit = COUNTRIES.filter((c) => k.includes(` ${textKey(c.label)} `)).sort(
    (a, b) => b.label.length - a.label.length,
  )[0];
  return hit?.code ?? null;
}

/** HS: strip formatting ("0909.31" → "090931"); 4–10 digits. */
export function parseHs(raw: string | null | undefined): Parsed {
  const s = collapse(raw);
  if (!s) return ok(null);
  const d = s.replace(/[\s.-]/g, '');
  if (!/^\d{4,10}$/.test(d)) return amb(`“${raw}” is not an HS code.`);
  return ok(d);
}

export const docRefKey = (s: string | null | undefined) =>
  collapse(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Significant words for deterministic product/cargo presence checks. */
const STOP = new Set([
  'with',
  'from',
  'packed',
  'pack',
  'bags',
  'quality',
  'grade',
  'export',
  'goods',
  'item',
  'items',
  'total',
  'and',
  'the',
]);
export const keyWords = (s: string | null | undefined) =>
  textKey(s)
    .split(' ')
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
