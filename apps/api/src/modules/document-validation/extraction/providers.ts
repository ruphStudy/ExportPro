import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import {
  EXTRACTION_HEADER_FIELDS,
  EXTRACTION_ITEM_FIELDS,
  TRADE_DOCUMENT_TYPES,
} from '@exportpro/types';
import type { AppConfig } from '../../../config/configuration';
import { ExtractionProviderError } from '../../inquiries/extraction/extraction-provider';

export const DOCUMENT_EXTRACTION_PROVIDER = Symbol(
  'DOCUMENT_EXTRACTION_PROVIDER',
);
export const DOC_EXTRACTION_PROMPT_VERSION = 'doc-extract-prompt-v1';

export interface DocumentExtractionIdentity {
  name: string;
  type: 'AI' | 'RULE' | 'NONE';
  model: string | null;
  promptVersion: string | null;
  /** True when the provider can read PDF/image bytes itself (no local OCR is ever claimed). */
  acceptsFiles: boolean;
}

export interface DocumentExtractionRequest {
  declaredType: string;
  filename: string;
  mimeType: string;
  /** Text layer when available locally (plain text or PDF text layer). */
  text: string | null;
  /** File bytes, only sent to providers that accept files and only when no text layer exists. */
  file: Buffer | null;
}

/** Raw provider output; the service grounds and normalizes it before storing. */
export interface RawField {
  name: string;
  raw: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sourceText?: string | null;
  page?: number | null;
  ambiguous?: boolean;
  note?: string | null;
}
export interface RawExtraction {
  detectedType: string | null;
  detectedTypeConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  fields: RawField[];
  items: { fields: RawField[] }[];
  ambiguities: string[];
  warnings: string[];
  overallConfidence: number | null;
}

export interface DocumentExtractionProvider {
  readonly identity: DocumentExtractionIdentity;
  extract(r: DocumentExtractionRequest): Promise<RawExtraction>;
}

export { ExtractionProviderError };

// ---------------------------------------------------------------- rule-based

const LABELS: Record<string, string[]> = {
  invoiceNumber: [
    'invoice no',
    'invoice number',
    'inv no',
    'commercial invoice no',
    'invoice ref',
  ],
  poNumber: [
    'po no',
    'po number',
    'purchase order no',
    'purchase order number',
    'order no',
    'order number',
    'buyer po',
    'your order no',
  ],
  piNumber: [
    'pi no',
    'proforma invoice no',
    'proforma no',
    'proforma invoice number',
  ],
  quotationNumber: ['quotation no', 'quote no', 'quotation number'],
  blNumber: ['b/l no', 'bl no', 'bill of lading no', 'b/l number'],
  awbNumber: ['awb no', 'airway bill no', 'air waybill no', 'awb number'],
  certificateNumber: ['certificate no', 'certificate number', 'cert no'],
  documentNumber: ['document no', 'doc no', 'reference no', 'ref no'],
  documentDate: [
    'date',
    'invoice date',
    'po date',
    'order date',
    'document date',
    'dated',
    'b/l date',
    'shipped on board date',
  ],
  buyerName: [
    'buyer',
    'importer',
    'bill to',
    'sold to',
    'customer',
    'purchaser',
  ],
  buyerAddress: [
    'buyer address',
    'importer address',
    'bill to address',
    'customer address',
  ],
  buyerCountry: ['buyer country', 'importer country'],
  exporterName: [
    'exporter',
    'seller',
    'shipper',
    'supplier',
    'vendor',
    'beneficiary',
  ],
  exporterAddress: [
    'exporter address',
    'seller address',
    'shipper address',
    'supplier address',
  ],
  consigneeName: ['consignee', 'ship to'],
  consigneeAddress: ['consignee address', 'ship to address'],
  notifyParty: ['notify', 'notify party'],
  currency: ['currency'],
  incoterm: ['incoterm', 'incoterms', 'price basis', 'terms of delivery'],
  totalAmount: [
    'total',
    'total amount',
    'grand total',
    'invoice total',
    'total value',
    'total invoice value',
  ],
  paymentTerms: ['payment terms', 'terms of payment', 'payment'],
  deliveryTerms: ['delivery terms', 'shipment terms', 'delivery', 'shipment'],
  originCountry: ['country of origin', 'origin'],
  destinationCountry: [
    'country of destination',
    'destination country',
    'final destination country',
    'destination',
  ],
  carrier: ['carrier', 'shipping line', 'airline'],
  vessel: ['vessel', 'vessel name', 'ocean vessel'],
  voyage: ['voyage', 'voyage no'],
  containerNumbers: [
    'container',
    'container no',
    'containers',
    'container numbers',
  ],
  portOfLoading: ['port of loading', 'pol', 'airport of departure'],
  portOfDischarge: ['port of discharge', 'pod', 'airport of destination'],
  placeOfDelivery: ['place of delivery'],
  etd: ['etd'],
  eta: ['eta'],
  packageCount: [
    'total packages',
    'packages',
    'no of packages',
    'number of packages',
    'no. of packages',
  ],
  grossWeightKg: ['gross weight', 'total gross weight', 'gross wt'],
  netWeightKg: ['net weight', 'total net weight', 'net wt'],
  cargoDescription: [
    'description of goods',
    'cargo description',
    'goods description',
    'cargo',
  ],
  certificateType: ['certificate type'],
  issuer: ['issued by', 'issuer', 'issuing authority', 'issuing office'],
  issueDate: ['issue date', 'date of issue', 'issued on'],
  expiryDate: [
    'expiry date',
    'valid until',
    'expiry',
    'valid till',
    'date of expiry',
    'validity',
  ],
  hsCode: ['hs code', 'hs', 'h.s. code', 'hs no'],
  productDescription: [
    'product',
    'commodity',
    'name of produce',
    'description',
  ],
};
const GENERIC = new Set([
  'date',
  'total',
  'description',
  'delivery',
  'payment',
  'origin',
  'destination',
  'product',
  'cargo',
]);
const ITEM_KEYS: [RegExp, string][] = [
  [/^(hs|hs code|h\.s\.)\s*[:\s]/i, 'hsCode'],
  [/^(sku|code|buyer code|item code|article)\s*[:\s]/i, 'buyerSku'],
  [/^(qty|quantity)\s*[:\s]/i, 'quantity'],
  [/^(unit price|rate|price)\s*[:\s]/i, 'unitPrice'],
  [/^(total|amount|line total|value)\s*[:\s]/i, 'total'],
  [/^(spec|specification)\s*[:\s]/i, 'specification'],
  [/^(packing|packaging)\s*[:\s]/i, 'packaging'],
  [/^(origin|country of origin)\s*[:\s]/i, 'countryOfOrigin'],
  [/^(packages|pkgs|no of packages)\s*[:\s]/i, 'packageCount'],
  [/^(package type|pkg type)\s*[:\s]/i, 'packageType'],
  [/^(marks|marks and numbers)\s*[:\s]/i, 'marks'],
  [/^(net|net weight|net wt)\s*[:\s]/i, 'netWeightKg'],
  [/^(gross|gross weight|gross wt)\s*[:\s]/i, 'grossWeightKg'],
  [/^(dims|dimensions)\s*[:\s]/i, 'dimensions'],
  [/^(cbm|volume)\s*[:\s]/i, 'volumeCbm'],
];
const TYPE_KEYWORDS: [RegExp, string, 'HIGH' | 'MEDIUM' | 'LOW'][] = [
  [/PROFORMA INVOICE/, 'PROFORMA_INVOICE', 'HIGH'],
  [/COMMERCIAL INVOICE/, 'COMMERCIAL_INVOICE', 'HIGH'],
  [/PACKING LIST/, 'PACKING_LIST', 'HIGH'],
  [/PURCHASE ORDER/, 'PURCHASE_ORDER', 'HIGH'],
  [/BILL OF LADING/, 'BILL_OF_LADING', 'HIGH'],
  [/AIR ?WAY ?BILL/, 'AIRWAY_BILL', 'HIGH'],
  [/SHIPPING BILL/, 'SHIPPING_BILL', 'HIGH'],
  [/SHIPPING INSTRUCTION/, 'SHIPPING_INSTRUCTION', 'HIGH'],
  [/PHYTOSANITARY/, 'PHYTOSANITARY_CERTIFICATE', 'HIGH'],
  [/CERTIFICATE OF ORIGIN/, 'CERTIFICATE_OF_ORIGIN', 'HIGH'],
  [/FUMIGATION/, 'FUMIGATION_CERTIFICATE', 'HIGH'],
  [/INSURANCE (CERTIFICATE|POLICY)/, 'INSURANCE_CERTIFICATE', 'HIGH'],
  [/INSPECTION CERTIFICATE/, 'INSPECTION_CERTIFICATE', 'HIGH'],
  [
    /CERTIFICATE OF ANALYSIS|TEST (REPORT|CERTIFICATE)/,
    'TEST_CERTIFICATE',
    'HIGH',
  ],
  [/\bINVOICE\b/, 'COMMERCIAL_INVOICE', 'MEDIUM'],
  [/CERTIFICATE/, 'CERTIFICATE', 'LOW'],
];

const labelIndex = Object.entries(LABELS)
  .flatMap(([field, labels]) => labels.map((l) => ({ field, label: l })))
  .sort((a, b) => b.label.length - a.label.length);

/**
 * Deterministic "Label: value" parser for text-layer documents (development and
 * tests). Values are only taken when literally labelled; nothing is inferred.
 */
export class RuleBasedDocumentExtractionProvider implements DocumentExtractionProvider {
  readonly identity: DocumentExtractionIdentity = {
    name: 'rule-based-text-parser',
    type: 'RULE',
    model: null,
    promptVersion: null,
    acceptsFiles: false,
  };

  extract(r: DocumentExtractionRequest): Promise<RawExtraction> {
    if (!r.text?.trim())
      return Promise.reject(
        new ExtractionProviderError(
          'UNAVAILABLE',
          'No text available to parse.',
        ),
      );
    const lines = r.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const upper = r.text.toUpperCase();
    const typeHit = TYPE_KEYWORDS.find(([re]) => re.test(upper));
    const values = new Map<string, { raw: string; line: string }[]>();
    const items: { fields: RawField[] }[] = [];
    for (const line of lines) {
      const itemMatch =
        /^(item|line|package|pkg)\s*#?\d+\s*[:.)-]\s*(.+)$/i.exec(line);
      if (itemMatch) {
        const fields: RawField[] = [];
        itemMatch[2]
          .split(/[;|]/)
          .map((x) => x.trim())
          .filter(Boolean)
          .forEach((seg, i) => {
            const key = ITEM_KEYS.find(([re]) => re.test(seg));
            if (key)
              fields.push({
                name: key[1],
                raw:
                  seg
                    .replace(key[0], '')
                    .replace(/^[:\s]+/, '')
                    .trim() || null,
                confidence: 'MEDIUM',
                sourceText: line,
              });
            else if (i === 0)
              fields.push({
                name: 'description',
                raw: seg,
                confidence: 'MEDIUM',
                sourceText: line,
              });
          });
        // "Qty 10 MT" → quantity + unit
        const q = fields.find((f) => f.name === 'quantity');
        if (q?.raw) {
          const m = /^([\d.,]+)\s*([A-Za-z/]+)?\.?$/.exec(q.raw);
          if (m) {
            q.raw = m[1];
            if (m[2])
              fields.push({
                name: 'unit',
                raw: m[2],
                confidence: 'MEDIUM',
                sourceText: line,
              });
          }
        }
        if (fields.length) items.push({ fields });
        continue;
      }
      const kv = /^([A-Za-z][A-Za-z ./&#()-]{0,40}?)\s*[:]\s*(.+)$/.exec(line);
      if (!kv) continue;
      const label = kv[1]
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[.#]$/, '')
        .trim();
      const hit = labelIndex.find((l) => l.label === label);
      if (!hit) continue;
      const list = values.get(hit.field) ?? [];
      list.push({ raw: kv[2].trim(), line });
      values.set(hit.field, list);
    }
    const fields: RawField[] = [];
    const ambiguities: string[] = [];
    for (const [name, list] of values) {
      const distinct = [...new Set(list.map((x) => x.raw))];
      const generic = labelIndex.find(
        (l) =>
          l.field === name &&
          GENERIC.has(l.label) &&
          list[0].line.toLowerCase().startsWith(l.label),
      );
      const ambiguous = distinct.length > 1;
      if (ambiguous)
        ambiguities.push(`${name}: several values (${distinct.join(' / ')})`);
      fields.push({
        name,
        raw: distinct[0],
        confidence: ambiguous ? 'LOW' : generic ? 'LOW' : 'MEDIUM',
        sourceText: list[0].line,
        ambiguous,
        note: ambiguous
          ? `Several values found: ${distinct.join(' / ')}`
          : null,
      });
    }
    return Promise.resolve({
      detectedType: typeHit?.[1] ?? null,
      detectedTypeConfidence: typeHit?.[2] ?? null,
      fields,
      items,
      ambiguities,
      warnings: [
        'Rule-based parser: only literally labelled values were read.',
      ],
      overallConfidence: null,
    });
  }
}

// ------------------------------------------------------------------ AI (Claude)

const FIELD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'raw',
    'confidence',
    'sourceText',
    'page',
    'ambiguous',
    'note',
  ],
  properties: {
    name: { type: 'string' },
    raw: { type: ['string', 'null'] },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    sourceText: { type: ['string', 'null'] },
    page: { type: ['integer', 'null'] },
    ambiguous: { type: 'boolean' },
    note: { type: ['string', 'null'] },
  },
};
export const DOCUMENT_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'detectedType',
    'detectedTypeConfidence',
    'fields',
    'items',
    'ambiguities',
    'warnings',
    'overallConfidence',
  ],
  properties: {
    detectedType: {
      type: ['string', 'null'],
      enum: [...TRADE_DOCUMENT_TYPES, null],
    },
    detectedTypeConfidence: {
      type: ['string', 'null'],
      enum: ['HIGH', 'MEDIUM', 'LOW', null],
    },
    fields: { type: 'array', items: FIELD_SCHEMA },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fields'],
        properties: { fields: { type: 'array', items: FIELD_SCHEMA } },
      },
    },
    ambiguities: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    overallConfidence: { type: ['integer', 'null'] },
  },
};

const SYSTEM_PROMPT = `You extract structured data from an export trade document (invoice, proforma, purchase order, packing list, bill of lading, airway bill, shipping bill, certificate) for an Indian exporter. A human reviews everything you return; nothing is final.

Strict rules:
- Extract only what is written in the document. Never infer or invent absent values: no invented dates, totals, addresses, HS codes, weights, prices or quantities. Unknown = raw null.
- "raw" is the text exactly as written (keep the buyer/exporter wording, units and currency symbols). Do not convert units or currencies.
- Return every product line as a separate item. Never merge products.
- Header field names must be one of: ${EXTRACTION_HEADER_FIELDS.join(', ')}.
- Item field names must be one of: ${EXTRACTION_ITEM_FIELDS.join(', ')}.
- If several different values could be the same field (e.g. two invoice numbers or dates), set ambiguous=true and explain in note.
- Give per-field confidence HIGH/MEDIUM/LOW honestly. sourceText is the short snippet the value came from.
- Do not judge authenticity, legality or compliance. Do not include reasoning.`;

export class AnthropicDocumentExtractionProvider implements DocumentExtractionProvider {
  private readonly logger = new Logger(
    AnthropicDocumentExtractionProvider.name,
  );
  private readonly client: Anthropic;
  readonly identity: DocumentExtractionIdentity;

  constructor(apiKey: string, model: string, timeoutMs: number) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 });
    this.identity = {
      name: 'anthropic',
      type: 'AI',
      model,
      promptVersion: DOC_EXTRACTION_PROMPT_VERSION,
      acceptsFiles: true,
    };
  }

  async extract(r: DocumentExtractionRequest): Promise<RawExtraction> {
    const intro = `Declared document type (user-selected): ${r.declaredType}. File: ${r.filename}.`;
    let content: Anthropic.Beta.BetaContentBlockParam[];
    if (r.text?.trim())
      content = [
        {
          type: 'text',
          text: `${intro}\n\nDocument text:\n${r.text.slice(0, 80_000)}`,
        },
      ];
    else if (r.file && r.mimeType === 'application/pdf')
      content = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: r.file.toString('base64'),
          },
        },
        { type: 'text', text: intro },
      ];
    else if (
      r.file &&
      ['image/png', 'image/jpeg', 'image/webp'].includes(r.mimeType)
    )
      content = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: r.mimeType as 'image/png',
            data: r.file.toString('base64'),
          },
        },
        { type: 'text', text: intro },
      ];
    else
      throw new ExtractionProviderError(
        'UNAVAILABLE',
        'This file type cannot be read by the provider.',
      );
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.identity.model!,
        max_tokens: 12000,
        output_config: {
          effort: 'medium',
          format: {
            type: 'json_schema',
            schema: DOCUMENT_EXTRACTION_JSON_SCHEMA,
          },
        },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      });
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError)
        throw new ExtractionProviderError('TIMEOUT', 'Provider timed out.');
      if (error instanceof Anthropic.RateLimitError)
        throw new ExtractionProviderError(
          'RATE_LIMITED',
          'Provider rate limit reached.',
        );
      if (
        error instanceof Anthropic.AuthenticationError ||
        error instanceof Anthropic.PermissionDeniedError
      )
        throw new ExtractionProviderError(
          'NOT_CONFIGURED',
          'Provider credentials rejected.',
        );
      if (error instanceof Anthropic.APIError)
        this.logger.warn(
          `AI provider error status=${error.status ?? 'connection'}`,
        );
      throw new ExtractionProviderError('UNAVAILABLE', 'Provider unavailable.');
    }
    if (response.stop_reason === 'refusal')
      throw new ExtractionProviderError(
        'UNAVAILABLE',
        'Provider declined the request.',
      );
    if (response.stop_reason === 'max_tokens')
      throw new ExtractionProviderError(
        'INVALID_RESPONSE',
        'Provider output was truncated.',
      );
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    try {
      return JSON.parse(text) as RawExtraction;
    } catch {
      throw new ExtractionProviderError(
        'INVALID_RESPONSE',
        'Provider returned malformed JSON.',
      );
    }
  }
}

class UnconfiguredDocumentExtractionProvider implements DocumentExtractionProvider {
  readonly identity: DocumentExtractionIdentity = {
    name: 'unconfigured',
    type: 'NONE',
    model: null,
    promptVersion: null,
    acceptsFiles: false,
  };
  extract(): Promise<RawExtraction> {
    return Promise.reject(
      new ExtractionProviderError(
        'NOT_CONFIGURED',
        'Automated extraction is not configured — enter the data manually.',
      ),
    );
  }
}

/** Same selection rules as Sprint 13: production never falls back to the development parser. */
export function createDocumentExtractionProvider(
  ai: AppConfig['ai'],
  nodeEnv: AppConfig['app']['nodeEnv'],
): DocumentExtractionProvider {
  const isProduction = nodeEnv === 'production';
  if (!ai.enabled) return new UnconfiguredDocumentExtractionProvider();
  const choice =
    ai.provider ??
    (ai.apiKey ? 'anthropic' : isProduction ? 'none' : 'development');
  if (choice === 'anthropic' && ai.apiKey)
    return new AnthropicDocumentExtractionProvider(
      ai.apiKey,
      ai.model,
      ai.timeoutMs,
    );
  if (choice === 'development' && !isProduction)
    return new RuleBasedDocumentExtractionProvider();
  return new UnconfiguredDocumentExtractionProvider();
}
