import {
  EXTRACTION_HEADER_FIELDS,
  EXTRACTION_ITEM_FIELDS,
  TRADE_DOCUMENT_TYPES,
  type ExtractedDocumentField,
  type ExtractionConfidence,
  type ExtractionProvenance,
  type ExtractionResult,
  type TradeDocumentType,
} from '@exportpro/types';
import {
  collapse,
  parseCountry,
  parseCurrency,
  parseDate,
  parseHs,
  parseIncoterm,
  parseNumber,
  parseUnit,
  parseWeightKg,
  type Parsed,
} from '../normalize';
import type { RawExtraction, RawField } from './providers';

const DATE = new Set(['documentDate', 'issueDate', 'expiryDate', 'etd', 'eta']);
const COUNTRY = new Set([
  'buyerCountry',
  'originCountry',
  'destinationCountry',
  'countryOfOrigin',
]);
const NUMBER = new Set([
  'totalAmount',
  'unitPrice',
  'total',
  'quantity',
  'volumeCbm',
]);
const INTEGER = new Set(['packageCount']);
const WEIGHT = new Set(['grossWeightKg', 'netWeightKg']);

/** Normalizes one value by field kind. Ambiguous input yields value null + ambiguous. */
export function normalizeField(
  name: string,
  raw: string | null,
  decimalComma: boolean,
): Parsed {
  if (raw === null || collapse(raw) === '')
    return { value: null, ambiguous: false, note: null };
  if (DATE.has(name)) return parseDate(raw);
  if (COUNTRY.has(name)) return parseCountry(raw);
  if (name === 'currency') return parseCurrency(raw);
  if (name === 'incoterm') return parseIncoterm(raw).code;
  if (name === 'unit') return parseUnit(raw);
  if (name === 'hsCode') return parseHs(raw);
  if (WEIGHT.has(name)) return parseWeightKg(raw, decimalComma);
  if (NUMBER.has(name)) return parseNumber(raw, decimalComma);
  if (INTEGER.has(name)) {
    const n = parseNumber(raw.replace(/[A-Za-z].*$/, ''), decimalComma);
    if (n.value !== null && !/^\d+$/.test(n.value))
      return {
        value: null,
        ambiguous: true,
        note: `Package count “${raw}” is not a whole number.`,
      };
    return n;
  }
  return {
    value: collapse(raw).slice(0, 500) || null,
    ambiguous: false,
    note: null,
  };
}

const CONF: ExtractionConfidence[] = ['HIGH', 'MEDIUM', 'LOW'];
const conf = (c: unknown): ExtractionConfidence =>
  CONF.includes(c as ExtractionConfidence)
    ? (c as ExtractionConfidence)
    : 'LOW';

function groundField(
  f: RawField,
  text: string | null,
  provenance: ExtractionProvenance,
  decimalComma: boolean,
): ExtractedDocumentField {
  const raw =
    f.raw === null || f.raw === undefined ? null : String(f.raw).slice(0, 1000);
  const n = normalizeField(f.name, raw, decimalComma);
  let confidence = conf(f.confidence);
  const notes = [f.note, n.note].filter(Boolean) as string[];
  // Grounding: an AI value that cannot be found in the document text is flagged, never trusted.
  if (
    raw &&
    text &&
    provenance === 'AI_EXTRACTED' &&
    !collapse(text).toLowerCase().includes(collapse(raw).toLowerCase())
  ) {
    confidence = 'LOW';
    notes.push('Not found verbatim in the document text — check carefully.');
  }
  if (raw && n.value === null && !n.ambiguous)
    notes.push('Could not be normalized for comparison.');
  return {
    raw,
    value: n.value,
    confidence: n.ambiguous ? 'LOW' : confidence,
    sourceText: f.sourceText ? String(f.sourceText).slice(0, 300) : null,
    page: typeof f.page === 'number' ? f.page : null,
    ambiguous: Boolean(f.ambiguous) || n.ambiguous,
    note: notes.length ? notes.join(' ') : null,
    provenance,
  };
}

/**
 * Converts raw provider output into the stored extraction result: unknown field
 * names are dropped, every value is normalized (originals kept), ambiguity and
 * per-field problems are recorded. One bad field never invalidates the rest.
 */
export function groundExtraction(
  raw: RawExtraction,
  text: string | null,
  provenance: ExtractionProvenance,
  decimalComma: boolean,
): { result: ExtractionResult; fieldProblems: number } {
  const header = new Set<string>(EXTRACTION_HEADER_FIELDS);
  const itemNames = new Set<string>(EXTRACTION_ITEM_FIELDS);
  const result: ExtractionResult = {
    detectedType: {
      value: (TRADE_DOCUMENT_TYPES as readonly string[]).includes(
        raw.detectedType ?? '',
      )
        ? (raw.detectedType as TradeDocumentType)
        : null,
      confidence: raw.detectedTypeConfidence
        ? conf(raw.detectedTypeConfidence)
        : null,
    },
    fields: {},
    items: [],
    ambiguities: (raw.ambiguities ?? [])
      .map((x) => String(x).slice(0, 300))
      .slice(0, 30),
    warnings: (raw.warnings ?? [])
      .map((x) => String(x).slice(0, 300))
      .slice(0, 30),
  };
  let fieldProblems = 0;
  for (const f of raw.fields ?? []) {
    if (!f || !header.has(f.name)) continue;
    const g = groundField(f, text, provenance, decimalComma);
    if (g.raw && g.value === null) fieldProblems++;
    result.fields[f.name as keyof ExtractionResult['fields']] = g;
    if (
      f.name === 'incoterm' &&
      f.raw &&
      !raw.fields.some((x) => x.name === 'incotermPlace' && x.raw)
    ) {
      const place = parseIncoterm(f.raw).place;
      if (place)
        result.fields.incotermPlace = {
          raw: place,
          value: place,
          confidence: g.confidence,
          sourceText: g.sourceText,
          page: g.page,
          ambiguous: false,
          note: 'Named place taken from the Incoterm line.',
          provenance,
        };
    }
  }
  for (const it of (raw.items ?? []).slice(0, 100)) {
    const fields: ExtractionResult['items'][number]['fields'] = {};
    for (const f of it.fields ?? []) {
      if (!f || !itemNames.has(f.name)) continue;
      const g = groundField(f, text, provenance, decimalComma);
      if (g.raw && g.value === null) fieldProblems++;
      fields[f.name as keyof typeof fields] = g;
    }
    if (Object.keys(fields).length) result.items.push({ fields });
  }
  return { result, fieldProblems };
}

/** Key fields reported as missing (unknown stays unknown). */
export function missingFields(
  result: ExtractionResult | null,
  type: string,
): string[] {
  if (!result) return [];
  const want: Record<string, string[]> = {
    COMMERCIAL_INVOICE: [
      'invoiceNumber',
      'documentDate',
      'buyerName',
      'currency',
      'incoterm',
      'totalAmount',
    ],
    PROFORMA_INVOICE: [
      'piNumber',
      'documentDate',
      'buyerName',
      'currency',
      'totalAmount',
    ],
    PURCHASE_ORDER: [
      'poNumber',
      'documentDate',
      'buyerName',
      'currency',
      'incoterm',
    ],
    PACKING_LIST: ['packageCount', 'grossWeightKg', 'netWeightKg'],
    BILL_OF_LADING: [
      'blNumber',
      'consigneeName',
      'portOfLoading',
      'portOfDischarge',
      'packageCount',
      'grossWeightKg',
    ],
    AIRWAY_BILL: [
      'awbNumber',
      'consigneeName',
      'packageCount',
      'grossWeightKg',
    ],
    SHIPPING_BILL: [
      'documentNumber',
      'invoiceNumber',
      'currency',
      'totalAmount',
    ],
  };
  const keys =
    want[type] ??
    (type.endsWith('CERTIFICATE') || type === 'CERTIFICATE'
      ? ['certificateNumber', 'issuer', 'issueDate']
      : []);
  const out = keys.filter(
    (k) => !result.fields[k as keyof ExtractionResult['fields']]?.value,
  );
  if (
    [
      'COMMERCIAL_INVOICE',
      'PROFORMA_INVOICE',
      'PURCHASE_ORDER',
      'PACKING_LIST',
    ].includes(type) &&
    !result.items.length
  )
    out.push('items');
  return out;
}
