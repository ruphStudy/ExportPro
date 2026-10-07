import { z } from 'zod';
import {
  type ExtractedField,
  type ExtractedItem,
  type ExtractedRfq,
  type FieldConfidence,
  isValidCountryCode,
  PAYMENT_TERM_TYPES,
  RFQ_INCOTERMS,
} from '@exportpro/types';

/**
 * Strict validation for extraction output. Every field is validated on
 * its own: one bad field is dropped (and reported) without discarding the
 * rest (partial extraction). Afterwards `ground()` checks values against
 * the inquiry text so nothing unstated is presented as explicit.
 */

const CONF = z.enum(['HIGH', 'MEDIUM', 'LOW']);
const fieldSchema = <T extends z.ZodTypeAny>(v: T) =>
  z.object({
    value: v.nullable(),
    raw: z.string().max(500).nullable(),
    confidence: CONF,
    explicit: z.boolean(),
    ambiguous: z.boolean(),
    note: z.string().max(300).nullable(),
  });

const STR = z.string().trim().min(1).max(300);
const NUM = z.number().finite().nonnegative().max(1e12);
const CUR = z.string().regex(/^[A-Z]{3}$/);
const ISO = z.string().regex(/^[A-Z]{2}$/);
const HS = z.string().regex(/^\d{4,10}$/);
const DATEISH = z.string().trim().min(1).max(60);

export const empty = <T>(note: string | null = null): ExtractedField<T> => ({
  value: null,
  raw: null,
  confidence: 'LOW',
  explicit: false,
  ambiguous: false,
  note,
});

type Raw = Record<string, unknown> | undefined | null;
const obj = (x: unknown): Raw =>
  x && typeof x === 'object' && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;

function pick<T>(
  raw: unknown,
  path: string,
  schema: z.ZodTypeAny,
  invalid: string[],
): ExtractedField<T> {
  if (raw === undefined || raw === null) return empty();
  const r = fieldSchema(schema).safeParse(raw);
  if (r.success) return r.data as ExtractedField<T>;
  invalid.push(path);
  return empty('Dropped: value failed validation');
}

export interface Sanitized {
  data: ExtractedRfq;
  invalidFields: string[];
}

/** Validates untrusted provider output field-by-field. Never throws for bad content. */
export function sanitizeExtraction(raw: unknown): Sanitized {
  const invalid: string[] = [];
  const root = obj(raw) ?? {};
  const itemsRaw = Array.isArray(root.items) ? root.items.slice(0, 25) : [];
  if (root.items !== undefined && !Array.isArray(root.items))
    invalid.push('items');
  const items: ExtractedItem[] = itemsRaw.map((it, i) => {
    const o = obj(it) ?? {};
    const p = `items[${i}]`;
    const sug = obj(o.hsSuggestion);
    const sugOk =
      sug &&
      HS.safeParse(sug.code).success &&
      CONF.safeParse(sug.confidence).success;
    if (o.hsSuggestion && !sugOk) invalid.push(`${p}.hsSuggestion`);
    return {
      productName: pick<string>(
        o.productName,
        `${p}.productName`,
        STR,
        invalid,
      ),
      hsCode: pick<string>(o.hsCode, `${p}.hsCode`, HS, invalid),
      hsSuggestion: sugOk
        ? {
            code: String(sug!.code),
            confidence: sug!.confidence as FieldConfidence,
          }
        : null,
      quantity: pick<number>(o.quantity, `${p}.quantity`, NUM, invalid),
      quantityUnit: pick<string>(
        o.quantityUnit,
        `${p}.quantityUnit`,
        z.string().trim().min(1).max(30),
        invalid,
      ),
      specification: pick<string>(
        o.specification,
        `${p}.specification`,
        z.string().trim().min(1).max(1000),
        invalid,
      ),
      packaging: pick<string>(
        o.packaging,
        `${p}.packaging`,
        z.string().trim().min(1).max(500),
        invalid,
      ),
      targetPrice: pick<number>(
        o.targetPrice,
        `${p}.targetPrice`,
        NUM,
        invalid,
      ),
      priceCurrency: pick<string>(
        o.priceCurrency,
        `${p}.priceCurrency`,
        CUR,
        invalid,
      ),
      priceUnitBasis: pick<string>(
        o.priceUnitBasis,
        `${p}.priceUnitBasis`,
        z.string().trim().min(1).max(30),
        invalid,
      ),
      priceIndicative: o.priceIndicative === true,
      deliveryDate: pick<string>(
        o.deliveryDate,
        `${p}.deliveryDate`,
        DATEISH,
        invalid,
      ),
    };
  });
  const d = obj(root.destination) ?? {};
  const inc = obj(root.incoterm) ?? {};
  const pay = obj(root.paymentTerms) ?? {};
  const del = obj(root.delivery) ?? {};
  const smp = obj(root.sample) ?? {};
  const certs = Array.isArray(root.certifications)
    ? root.certifications
        .map((c) => obj(c))
        .filter((c): c is Record<string, unknown> =>
          Boolean(c && STR.safeParse(c.name).success),
        )
        .slice(0, 20)
        .map((c) => ({
          name: String(c.name).trim(),
          raw: typeof c.raw === 'string' ? c.raw.slice(0, 300) : null,
          confidence: (CONF.safeParse(c.confidence).success
            ? c.confidence
            : 'LOW') as FieldConfidence,
        }))
    : [];
  const ambiguities = Array.isArray(root.ambiguities)
    ? root.ambiguities
        .map((a) => obj(a))
        .filter((a): a is Record<string, unknown> =>
          Boolean(
            a && typeof a.field === 'string' && typeof a.reason === 'string',
          ),
        )
        .slice(0, 30)
        .map((a) => ({
          field: String(a.field).slice(0, 80),
          reason: String(a.reason).slice(0, 300),
        }))
    : [];
  const questions = Array.isArray(root.suggestedQuestions)
    ? root.suggestedQuestions
        .filter(
          (q): q is string => typeof q === 'string' && q.trim().length > 3,
        )
        .slice(0, 8)
        .map((q) => q.trim().slice(0, 300))
    : [];
  const overall = z
    .number()
    .int()
    .min(0)
    .max(100)
    .safeParse(root.overallConfidence);
  if (!overall.success) invalid.push('overallConfidence');
  return {
    invalidFields: invalid,
    data: {
      items,
      destination: {
        countryCode: pick<string>(
          d.countryCode,
          'destination.countryCode',
          ISO,
          invalid,
        ),
        city: pick<string>(d.city, 'destination.city', STR, invalid),
        port: pick<string>(d.port, 'destination.port', STR, invalid),
        location: pick<string>(
          d.location,
          'destination.location',
          STR,
          invalid,
        ),
      },
      incoterm: {
        term: pick(inc.term, 'incoterm.term', z.enum(RFQ_INCOTERMS), invalid),
        place: pick<string>(inc.place, 'incoterm.place', STR, invalid),
      },
      certifications: certs,
      paymentTerms: {
        type: pick(
          pay.type,
          'paymentTerms.type',
          z.enum(PAYMENT_TERM_TYPES),
          invalid,
        ),
        advancePercent: pick<number>(
          pay.advancePercent,
          'paymentTerms.advancePercent',
          z.number().min(0).max(100),
          invalid,
        ),
        creditDays: pick<number>(
          pay.creditDays,
          'paymentTerms.creditDays',
          z.number().int().min(0).max(720),
          invalid,
        ),
        raw: typeof pay.raw === 'string' ? pay.raw.slice(0, 500) : null,
      },
      delivery: {
        targetDate: pick<string>(
          del.targetDate,
          'delivery.targetDate',
          DATEISH,
          invalid,
        ),
        shipmentWindow: pick<string>(
          del.shipmentWindow,
          'delivery.shipmentWindow',
          STR,
          invalid,
        ),
        leadTime: pick<string>(del.leadTime, 'delivery.leadTime', STR, invalid),
        urgency: pick(
          del.urgency,
          'delivery.urgency',
          z.enum(['URGENT', 'NORMAL']),
          invalid,
        ),
      },
      sample: {
        required: pick<boolean>(
          smp.required,
          'sample.required',
          z.boolean(),
          invalid,
        ),
        quantity: pick<string>(smp.quantity, 'sample.quantity', STR, invalid),
        specification: pick<string>(
          smp.specification,
          'sample.specification',
          STR,
          invalid,
        ),
        deadline: pick<string>(
          smp.deadline,
          'sample.deadline',
          DATEISH,
          invalid,
        ),
      },
      ambiguities,
      suggestedQuestions: questions,
      overallConfidence: overall.success ? overall.data : 0,
    },
  };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s,]+/g, ' ')
    .trim();
const digits = (n: number) => {
  const s = String(n);
  return [s, Number.isInteger(n) ? n.toLocaleString('en-US') : s];
};

/**
 * Grounding: an "explicit" value must be traceable to the inquiry text.
 * Wording/numbers that cannot be found are downgraded (explicit=false,
 * LOW, ambiguous) — never silently trusted. HS codes not present in the
 * text are moved to the separate, unconfirmed hsSuggestion.
 */
export function ground(data: ExtractedRfq, sourceText: string): ExtractedRfq {
  const text = norm(sourceText);
  const compact = sourceText.replace(/[\s,]/g, '');
  const check = <T>(f: ExtractedField<T>, path: string): ExtractedField<T> => {
    if (f.value === null) return f;
    let found = true;
    if (typeof f.value === 'number')
      found = digits(f.value).some((d) =>
        compact.includes(d.replace(/,/g, '')),
      );
    else if (f.explicit && f.raw) found = text.includes(norm(f.raw));
    if (f.explicit && !found) {
      data.ambiguities.push({
        field: path,
        reason:
          'Value not found verbatim in the inquiry — verify before confirming.',
      });
      return {
        ...f,
        explicit: false,
        confidence: 'LOW',
        ambiguous: true,
        note: 'Not found verbatim in the inquiry text',
      };
    }
    return f;
  };
  data.items = data.items.map((it, i) => {
    const p = `items[${i}]`;
    let hsCode = it.hsCode;
    let hsSuggestion = it.hsSuggestion;
    if (hsCode.value && !compact.includes(hsCode.value)) {
      hsSuggestion = { code: hsCode.value, confidence: 'LOW' };
      hsCode = empty(
        'HS code is not stated in the inquiry — shown only as an unconfirmed suggestion',
      );
    }
    return {
      ...it,
      productName: check(it.productName, `${p}.productName`),
      hsCode,
      hsSuggestion,
      quantity: check(it.quantity, `${p}.quantity`),
      quantityUnit: check(it.quantityUnit, `${p}.quantityUnit`),
      specification: check(it.specification, `${p}.specification`),
      packaging: check(it.packaging, `${p}.packaging`),
      targetPrice: check(it.targetPrice, `${p}.targetPrice`),
      deliveryDate: check(it.deliveryDate, `${p}.deliveryDate`),
    };
  });
  const cc = data.destination.countryCode;
  if (cc.value && !isValidCountryCode(cc.value)) {
    data.ambiguities.push({
      field: 'destination.countryCode',
      reason: `Unrecognised country code ${cc.value}.`,
    });
    data.destination.countryCode = empty('Unrecognised country');
  }
  data.destination.port = check(data.destination.port, 'destination.port');
  data.destination.city = check(data.destination.city, 'destination.city');
  data.incoterm.place = check(data.incoterm.place, 'incoterm.place');
  if (
    data.incoterm.term.value &&
    !new RegExp(`\\b${data.incoterm.term.value}\\b`, 'i').test(sourceText) &&
    !(
      data.incoterm.term.value === 'CFR' &&
      /\bC\s?&\s?F\b|\bCNF\b/i.test(sourceText)
    )
  ) {
    data.ambiguities.push({
      field: 'incoterm.term',
      reason: 'Incoterm not stated in the inquiry.',
    });
    data.incoterm.term = {
      ...data.incoterm.term,
      explicit: false,
      confidence: 'LOW',
      ambiguous: true,
      note: 'Incoterm not stated in the inquiry text',
    };
  }
  data.paymentTerms.advancePercent = check(
    data.paymentTerms.advancePercent,
    'paymentTerms.advancePercent',
  );
  data.paymentTerms.creditDays = check(
    data.paymentTerms.creditDays,
    'paymentTerms.creditDays',
  );
  data.certifications = data.certifications.map((c) =>
    text.includes(norm(c.name)) ? c : { ...c, confidence: 'LOW' },
  );
  return data;
}

const fieldJson = (value: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: ['value', 'raw', 'confidence', 'explicit', 'ambiguous', 'note'],
  properties: {
    value: { anyOf: [value, { type: 'null' }] },
    raw: { type: ['string', 'null'] },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    explicit: { type: 'boolean' },
    ambiguous: { type: 'boolean' },
    note: { type: ['string', 'null'] },
  },
});
const S = { type: 'string' };
const N = { type: 'number' };
const objJson = (props: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(props),
  properties: props,
});

/** JSON schema handed to the provider for structured output (re-validated by sanitizeExtraction). */
export const EXTRACTION_JSON_SCHEMA = objJson({
  items: {
    type: 'array',
    items: objJson({
      productName: fieldJson(S),
      hsCode: fieldJson(S),
      hsSuggestion: {
        anyOf: [
          objJson({
            code: S,
            confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          }),
          { type: 'null' },
        ],
      },
      quantity: fieldJson(N),
      quantityUnit: fieldJson(S),
      specification: fieldJson(S),
      packaging: fieldJson(S),
      targetPrice: fieldJson(N),
      priceCurrency: fieldJson(S),
      priceUnitBasis: fieldJson(S),
      priceIndicative: { type: 'boolean' },
      deliveryDate: fieldJson(S),
    }),
  },
  destination: objJson({
    countryCode: fieldJson(S),
    city: fieldJson(S),
    port: fieldJson(S),
    location: fieldJson(S),
  }),
  incoterm: objJson({
    term: fieldJson({ type: 'string', enum: [...RFQ_INCOTERMS] }),
    place: fieldJson(S),
  }),
  certifications: {
    type: 'array',
    items: objJson({
      name: S,
      raw: { type: ['string', 'null'] },
      confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    }),
  },
  paymentTerms: objJson({
    type: fieldJson({ type: 'string', enum: [...PAYMENT_TERM_TYPES] }),
    advancePercent: fieldJson(N),
    creditDays: fieldJson(N),
    raw: { type: ['string', 'null'] },
  }),
  delivery: objJson({
    targetDate: fieldJson(S),
    shipmentWindow: fieldJson(S),
    leadTime: fieldJson(S),
    urgency: fieldJson({ type: 'string', enum: ['URGENT', 'NORMAL'] }),
  }),
  sample: objJson({
    required: fieldJson({ type: 'boolean' }),
    quantity: fieldJson(S),
    specification: fieldJson(S),
    deadline: fieldJson(S),
  }),
  ambiguities: { type: 'array', items: objJson({ field: S, reason: S }) },
  suggestedQuestions: { type: 'array', items: S },
  overallConfidence: { type: 'integer' },
});
