import type {
  ExtractedField,
  ExtractedItem,
  ExtractedRfq,
  FieldConfidence,
  PaymentTermType,
  RfqIncoterm,
} from '@exportpro/types';
import { normalizeCountry } from '../../trade-data/normalization/normalizers';
import { empty } from './extraction-schema';
import {
  type ExtractionIdentity,
  type ExtractionRequest,
  type InquiryExtractionProvider,
  sourceText,
} from './extraction-provider';

/**
 * DEVELOPMENT extractor: deterministic regular expressions over the
 * inquiry text. It only ever reports wording that literally appears in the
 * text (nothing is inferred) and is labelled DEVELOPMENT_DEMO — never AI.
 * Used when no AI provider is configured outside production.
 */
const f = <T>(
  value: T,
  raw: string,
  confidence: FieldConfidence = 'MEDIUM',
  note: string | null = null,
  ambiguous = false,
): ExtractedField<T> => ({
  value,
  raw: raw.trim().slice(0, 500),
  confidence,
  explicit: true,
  ambiguous,
  note,
});

const UNIT = String.raw`(MT|M\/T|metric\s+tons?|tons?|tonnes?|KGS?|kilograms?|containers?|FCLs?|x\s?20'?\s?(?:ft|FCL)|units?|pcs|pieces|cartons?|boxes|bags)`;
const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const LINE_ITEM = new RegExp(
  String.raw`^[\s\-*•·\d.)]*([A-Za-z][A-Za-z0-9 ()/&'+-]{1,60}?)\s*[-–:,]\s*${NUMBER}\s*${UNIT}\b(.*)$`,
  'i',
);
const INLINE_ITEM = new RegExp(
  String.raw`${NUMBER}\s*${UNIT}\s+(?:of\s+)?([A-Za-z][A-Za-z -]{2,40}?)(?=\s*(?:[,.;\n]|\bfor\b|\bto\b|\bwith\b|$))`,
  'gi',
);
const PRICE =
  /(around|approx\.?|approximately|about|~|target|max(?:imum)?|budget|up to)?\s*(USD|US\$|\$|EUR|€|INR|Rs\.?|₹|AED|GBP|£)\s?(\d+(?:\.\d+)?)\s*(?:\/|per)\s*(kg|mt|ton|tonne|unit|pc|piece|carton)\b/i;
const CURRENCY: Record<string, string> = {
  USD: 'USD',
  US$: 'USD',
  $: 'USD',
  EUR: 'EUR',
  '€': 'EUR',
  INR: 'INR',
  RS: 'INR',
  'RS.': 'INR',
  '₹': 'INR',
  AED: 'AED',
  GBP: 'GBP',
  '£': 'GBP',
};
const CERTS = [
  'FSSAI',
  'HACCP',
  'ISO 22000',
  'ISO 9001',
  'Halal',
  'Kosher',
  'USDA Organic',
  'EU Organic',
  'Organic',
  'Phytosanitary',
  'Certificate of Origin',
  'BRC',
  'FDA',
  'GMP',
  'SGS',
  'Fumigation',
  'CE',
];
const MONTHS =
  'january|february|march|april|may|june|july|august|september|october|november|december';

export class DevelopmentInquiryExtractionProvider implements InquiryExtractionProvider {
  readonly identity: ExtractionIdentity = {
    name: 'development-rules',
    model: null,
    promptVersion: 'rfq-rules-v1',
    provenance: 'DEVELOPMENT_DEMO',
  };

  extract(request: ExtractionRequest): Promise<unknown> {
    return Promise.resolve(extractByRules(sourceText(request)));
  }
}

function normUnit(u: string) {
  const x = u.toLowerCase().replace(/\s+/g, ' ');
  if (/^(mt|m\/t|metric tons?|tons?|tonnes?)$/.test(x)) return 'MT';
  if (/^(kgs?|kilograms?)$/.test(x)) return 'KG';
  if (/container|fcl|20/.test(x)) return 'CONTAINER';
  if (/carton|box/.test(x)) return 'CARTON';
  if (/bag/.test(x)) return 'BAG';
  return 'UNIT';
}

function priceFields(m: RegExpMatchArray) {
  return {
    targetPrice: f(Number(m[3]), m[0], m[1] ? 'MEDIUM' : 'HIGH'),
    priceCurrency: f(
      CURRENCY[m[2].toUpperCase()] ?? CURRENCY[m[2]] ?? m[2],
      m[0],
    ),
    priceUnitBasis: f(
      m[4]
        .toUpperCase()
        .replace('TONNE', 'MT')
        .replace('TON', 'MT')
        .replace('PIECE', 'PC'),
      m[0],
    ),
    priceIndicative: Boolean(m[1]),
  };
}

export function extractByRules(text: string): ExtractedRfq {
  const ambiguities: { field: string; reason: string }[] = [];
  const lines = text.split(/\r?\n/);
  const items: (ExtractedItem & { _line: string })[] = [];
  const blank = (): ExtractedItem => ({
    productName: empty(),
    hsCode: empty(),
    hsSuggestion: null,
    quantity: empty(),
    quantityUnit: empty(),
    specification: empty(),
    packaging: empty(),
    targetPrice: empty(),
    priceCurrency: empty(),
    priceUnitBasis: empty(),
    priceIndicative: false,
    deliveryDate: empty(),
  });
  for (const line of lines) {
    const m = LINE_ITEM.exec(line);
    if (
      !m ||
      /^(subject|re|price|payment|delivery|shipment|sample|packing|packaging)\b/i.test(
        m[1].trim(),
      )
    )
      continue;
    const rest = m[4].replace(/^[\s,;:-]+/, '').trim();
    const it = { ...blank(), _line: line };
    it.productName = f(m[1].trim(), m[1]);
    it.quantity = f(Number(m[2].replace(/,/g, '')), `${m[2]} ${m[3]}`, 'HIGH');
    it.quantityUnit = f(
      normUnit(m[3]),
      m[3],
      /container|fcl/i.test(m[3]) ? 'MEDIUM' : 'HIGH',
      /container|fcl/i.test(m[3])
        ? 'Container quantity — weight per container not stated'
        : null,
    );
    const spec = rest
      .replace(PRICE, '')
      .replace(/[,;]\s*$/, '')
      .trim();
    if (spec.length > 2) it.specification = f(spec, spec);
    const pm = PRICE.exec(line);
    if (pm) Object.assign(it, priceFields(pm));
    items.push(it);
  }
  if (!items.length) {
    for (const m of text.matchAll(INLINE_ITEM)) {
      const it = { ...blank(), _line: m[0] };
      it.productName = f(m[3].trim(), m[3]);
      it.quantity = f(
        Number(m[1].replace(/,/g, '')),
        `${m[1]} ${m[2]}`,
        'HIGH',
      );
      it.quantityUnit = f(normUnit(m[2]), m[2]);
      items.push(it);
      if (items.length >= 10) break;
    }
  }
  if (!items.length)
    ambiguities.push({
      field: 'items',
      reason: 'No product with a stated quantity was found.',
    });

  // HS codes: only when literally present.
  for (const m of text.matchAll(/\bHS(?:\s*code)?\s*[:#-]?\s*(\d{4,8})\b/gi)) {
    const target =
      items.find((it) => it._line.includes(m[0])) ??
      (items.length === 1 ? items[0] : null);
    if (target) target.hsCode = f(m[1], m[0], 'HIGH');
  }
  // Global price applies only when there is exactly one product.
  const gp = PRICE.exec(text);
  if (gp && !items.some((it) => it.targetPrice.value !== null)) {
    if (items.length === 1) Object.assign(items[0], priceFields(gp));
    else
      ambiguities.push({
        field: 'targetPrice',
        reason: `Price “${gp[0].trim()}” is not tied to a specific product.`,
      });
  }
  const pk =
    /(?:packing|packaging|packed in)\s*[:\-]?\s*([^\n.;]{3,80})/i.exec(text) ??
    /(\d+\s*(?:kg|g|lb)s?\s+(?:pp |jute |paper |vacuum )?(?:bags?|cartons?|boxes|pouches))/i.exec(
      text,
    );
  if (pk) {
    // Packaging written on one product's line belongs to that product only.
    const onItemLine = items.some((it) => it._line.includes(pk[0]));
    for (const it of items) {
      const own =
        /(\d+\s*(?:kg|g|lb)s?\s+(?:pp |jute |paper |vacuum )?(?:bags?|cartons?|boxes|pouches))/i.exec(
          it._line,
        );
      if (own) it.packaging = f(own[1], own[1], 'HIGH');
      else if (onItemLine) continue;
      else
        it.packaging =
          items.length === 1
            ? f(pk[1].trim(), pk[0])
            : f(
                pk[1].trim(),
                pk[0],
                'LOW',
                'Packaging stated once for the whole inquiry',
                true,
              );
    }
  }

  // Incoterm
  const terms = [
    ...text.matchAll(
      /\b(EXW|FCA|FOB|CFR|CNF|C\s?&\s?F|CIF|CPT|CIP|DAP|DPU|DDP)\b(?:\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?))?/g,
    ),
  ];
  const norm = (t: string) =>
    (/^(CNF|C\s?&\s?F)$/i.test(t) ? 'CFR' : t.toUpperCase()) as RfqIncoterm;
  const distinct = [...new Set(terms.map((t) => norm(t[1])))];
  const incoterm = { term: empty<RfqIncoterm>(), place: empty<string>() };
  if (distinct.length === 1) {
    incoterm.term = f(distinct[0], terms[0][0], 'HIGH');
    if (terms[0][2]) incoterm.place = f(terms[0][2], terms[0][2]);
  } else if (distinct.length > 1) {
    incoterm.term = {
      ...empty(),
      raw: terms.map((t) => t[0]).join(' / '),
      ambiguous: true,
      note: `Several Incoterms mentioned: ${distinct.join(', ')}`,
    };
    ambiguities.push({
      field: 'incoterm.term',
      reason: `Several Incoterms mentioned (${distinct.join(', ')}).`,
    });
  }

  // Destination
  const destination = {
    countryCode: empty<string>(),
    city: empty<string>(),
    port: empty<string>(),
    location: empty<string>(),
  };
  const port =
    /(?:port of discharge|discharge port|destination port|POD|port)\s*[:\-]?\s*([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)/.exec(
      text,
    );
  if (port) destination.port = f(port[1], port[0]);
  else if (
    incoterm.place.value &&
    /CFR|CIF|CPT|CIP|DAP|DPU|DDP/.test(incoterm.term.value ?? '')
  )
    destination.port = f(
      incoterm.place.value,
      incoterm.place.raw ?? incoterm.place.value,
      'MEDIUM',
      'Named place of the Incoterm',
    );
  const countries = new Map<string, string>();
  for (const m of text.matchAll(
    /(?:destination|deliver(?:ed|y)? to|ship(?:ped|ment)? to|import(?:ing|ed)? (?:in)?to|to)[ \t]*[:\-]?[ \t]*([A-Z][A-Za-z.]+(?:[ \t][A-Z][A-Za-z.]+){0,3})/g,
  )) {
    for (let n = m[1].split(' ').length; n >= 1; n--) {
      const cand = m[1]
        .split(' ')
        .slice(0, n)
        .join(' ')
        .replace(/[.,;:]+$/, '');
      const r = normalizeCountry({ name: cand });
      if (
        r.code &&
        r.entityType === 'COUNTRY' &&
        (r.status === 'EXACT' || r.status === 'HIGH_CONFIDENCE')
      ) {
        countries.set(r.code, m[0]);
        break;
      }
    }
  }
  if (countries.size === 1) {
    const [code, raw] = [...countries.entries()][0];
    destination.countryCode = f(code, raw, 'HIGH');
  } else if (countries.size > 1) {
    destination.countryCode = {
      ...empty(),
      raw: [...countries.values()].join(' / '),
      ambiguous: true,
      note: `Several countries mentioned: ${[...countries.keys()].join(', ')}`,
    };
    ambiguities.push({
      field: 'destination.countryCode',
      reason: `Several destination countries mentioned (${[...countries.keys()].join(', ')}).`,
    });
  }

  // Certifications (buyer-requested only)
  const certifications: ExtractedRfq['certifications'] = [];
  for (const c of CERTS) {
    const m = new RegExp(`\\b${c.replace(/ /g, '\\s')}\\b`, 'i').exec(text);
    if (
      m &&
      !certifications.some((x) =>
        x.name.toLowerCase().includes(c.toLowerCase()),
      )
    )
      certifications.push({ name: c, raw: m[0], confidence: 'HIGH' });
  }

  // Payment terms
  const pay: ExtractedRfq['paymentTerms'] = {
    type: empty(),
    advancePercent: empty(),
    creditDays: empty(),
    raw: null,
  };
  const types: PaymentTermType[] = [];
  const adv = /(\d{1,3})\s*%\s*(?:TT\s*)?(?:advance|in advance|upfront)/i.exec(
    text,
  );
  if (adv) {
    types.push('ADVANCE');
    pay.advancePercent = f(Number(adv[1]), adv[0], 'HIGH');
  }
  if (/\bL\/?C\b|letter of credit/i.test(text)) types.push('LC');
  if (/\bD\/P\b|\bDP\b(?=\s|$|,)|documents against payment/i.test(text))
    types.push('DP');
  if (/\bD\/A\b|documents against acceptance/i.test(text)) types.push('DA');
  if (/open account/i.test(text)) types.push('OPEN_ACCOUNT');
  const cr =
    /(\d{1,3})\s*days?\s*(?:credit|payment terms|after (?:BL|B\/L|invoice))|net\s*(\d{1,3})\b/i.exec(
      text,
    );
  if (cr) {
    types.push('CREDIT');
    pay.creditDays = f(Number(cr[1] ?? cr[2]), cr[0], 'HIGH');
  }
  if (types.length) {
    const sentence =
      /[^.\n]*(?:payment|advance|L\/?C|letter of credit|D\/P|D\/A|credit|open account)[^.\n]*/i.exec(
        text,
      );
    pay.raw = sentence ? sentence[0].trim().slice(0, 300) : null;
    pay.type = f(
      types.length > 1 ? 'MIXED' : types[0],
      pay.raw ?? types.join('+'),
    );
  }

  // Delivery
  const delivery: ExtractedRfq['delivery'] = {
    targetDate: empty(),
    shipmentWindow: empty(),
    leadTime: empty(),
    urgency: empty(),
  };
  const by =
    /(?:deliver(?:y|ed)?|ship(?:ment|ped)?|dispatch|arriv(?:e|al)|required|needed)\s+(by|before|within|latest by)\s+([^.\n;,]{3,40})/i.exec(
      text,
    );
  if (by) {
    if (/within/i.test(by[1])) delivery.leadTime = f(by[2].trim(), by[0]);
    else delivery.targetDate = f(by[2].trim(), by[0]);
  }
  const win = new RegExp(
    `(?:shipment|delivery)\\s+(?:in|during)\\s+((?:${MONTHS}|Q[1-4])[^.\\n;,]{0,20})`,
    'i',
  ).exec(text);
  if (win) delivery.shipmentWindow = f(win[1].trim(), win[0]);
  const urg = /\b(urgent(?:ly)?|asap|as soon as possible|immediately)\b/i.exec(
    text,
  );
  if (urg) delivery.urgency = f('URGENT', urg[0], 'HIGH');

  // Sample
  const sample: ExtractedRfq['sample'] = {
    required: empty(),
    quantity: empty(),
    specification: empty(),
    deadline: empty(),
  };
  const noSample =
    /\bno samples?\b|\bsamples? (?:are )?not (?:required|needed)\b/i.exec(text);
  const sm = /\bsamples?\b/i.exec(text);
  if (noSample) sample.required = f(false, noSample[0], 'HIGH');
  else if (sm) {
    sample.required = f(true, sm[0], 'MEDIUM');
    const sq =
      /(\d+(?:\.\d+)?\s*(?:kg|g|grams?|gm|pcs|pieces|units?))\s*(?:of\s+)?samples?|samples?\s*(?:of\s+)?(\d+(?:\.\d+)?\s*(?:kg|g|grams?|gm|pcs|pieces|units?))/i.exec(
        text,
      );
    if (sq) sample.quantity = f((sq[1] ?? sq[2]).trim(), sq[0], 'HIGH');
    const sd = /samples?[^.\n]*?\b(?:by|before)\s+([^.\n;,]{3,30})/i.exec(text);
    if (sd) sample.deadline = f(sd[1].trim(), sd[0]);
  }

  const known = [
    items.length > 0,
    items.length > 0 && items.every((i) => i.quantity.value !== null),
    destination.countryCode.value !== null || destination.port.value !== null,
    incoterm.term.value !== null,
    pay.type.value !== null,
    delivery.targetDate.value !== null ||
      delivery.shipmentWindow.value !== null ||
      delivery.leadTime.value !== null,
  ];
  const overall = Math.min(90, 20 + known.filter(Boolean).length * 12);
  return {
    items: items.map((it) => {
      const copy: Partial<typeof it> = { ...it };
      delete copy._line;
      return copy as ExtractedItem;
    }),
    destination,
    incoterm,
    certifications,
    paymentTerms: pay,
    delivery,
    sample,
    ambiguities,
    suggestedQuestions: [],
    overallConfidence: overall,
  };
}
