import { deflateSync } from 'zlib';
import type { NormalizedDocumentView } from '@exportpro/types';
import { groundExtraction } from './extraction/grounding';
import { RuleBasedDocumentExtractionProvider } from './extraction/providers';
import {
  parseCurrency,
  parseDate,
  parseHs,
  parseIncoterm,
  parseNumber,
  parseWeightKg,
} from './normalize';
import { extractPdfText } from './pdf-text';
import {
  checkDocument,
  compareDocuments,
  matchItems,
} from './validation-engine';

const ctx = {
  tolerance: { quantityPercent: '0', pricePercent: '0' },
  today: '2026-10-07',
  expiryWarningDays: 30,
};
const item = (
  p: Partial<NormalizedDocumentView['items'][number]>,
): NormalizedDocumentView['items'][number] => ({
  key: null,
  description: 'Cumin seeds',
  hsCode: '090931',
  hsConfirmed: true,
  buyerSku: null,
  quantity: '10',
  unit: 'MT',
  unitPrice: '2600',
  total: null,
  packageCount: null,
  netWeightKg: null,
  grossWeightKg: null,
  ...p,
});
const view = (p: Partial<NormalizedDocumentView>): NormalizedDocumentView => ({
  documentId: 'x',
  label: 'Doc',
  kind: 'CI',
  version: 1,
  dataSource: 'CONFIRMED',
  buyerCompanyId: null,
  fields: {},
  items: [],
  ...p,
});

describe('normalizers (originals preserved by callers, ambiguity never guessed)', () => {
  it('parses numbers, dates, currencies, Incoterms, HS and weights', () => {
    expect(parseNumber('1,234.50').value).toBe('1234.5');
    expect(parseNumber('1.234,50').value).toBe('1234.5');
    expect(parseNumber('1,234', true)).toMatchObject({
      value: null,
      ambiguous: true,
    });
    expect(parseDate('07/10/2026')).toMatchObject({
      value: null,
      ambiguous: true,
    });
    expect(parseDate('25/10/2026').value).toBe('2026-10-25');
    expect(parseDate('15 Dec 2026').value).toBe('2026-12-15');
    expect(parseCurrency('US$').value).toBe('USD');
    expect(parseCurrency('$')).toMatchObject({ value: null, ambiguous: true });
    expect(parseIncoterm('CIF Jebel Ali')).toEqual({
      code: { value: 'CIF', ambiguous: false, note: null },
      place: 'Jebel Ali',
    });
    expect(parseIncoterm('FOB or CIF').code.ambiguous).toBe(true);
    expect(parseHs('0909.31').value).toBe('090931');
    expect(parseWeightKg('10.12 MT').value).toBe('10120');
    expect(parseWeightKg('10,120 KGS').value).toBe('10120');
  });
});

describe('extraction', () => {
  it('reads only labelled values, keeps items separate and flags ambiguity', async () => {
    const raw = await new RuleBasedDocumentExtractionProvider().extract({
      declaredType: 'PURCHASE_ORDER',
      filename: 'po.txt',
      mimeType: 'text/plain',
      file: null,
      text: 'PURCHASE ORDER\nPO No: A-1\nPO No: A-2\nCurrency: USD\nItem 1: Cumin; Qty 10 MT; Unit price 2600\nItem 2: Coriander; Qty 5 MT; Unit price 2000\nRandom line without label',
    });
    const { result } = groundExtraction(raw, null, 'RULE_EXTRACTED', false);
    expect(result.detectedType).toEqual({
      value: 'PURCHASE_ORDER',
      confidence: 'HIGH',
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].fields.quantity?.value).toBe('10');
    expect(result.items[0].fields.unit?.value).toBe('MT');
    expect(result.fields.poNumber?.ambiguous).toBe(true);
    expect(result.fields.totalAmount).toBeUndefined();
  });
  it('flags AI values not found in the text', () => {
    const { result } = groundExtraction(
      {
        detectedType: null,
        detectedTypeConfidence: null,
        fields: [{ name: 'invoiceNumber', raw: 'INV-9', confidence: 'HIGH' }],
        items: [],
        ambiguities: [],
        warnings: [],
        overallConfidence: 90,
      },
      'Invoice No: INV-1',
      'AI_EXTRACTED',
      false,
    );
    expect(result.fields.invoiceNumber?.confidence).toBe('LOW');
  });
  it('reads a text-layer PDF (Flate) and returns nothing for image-only data', () => {
    const content = Buffer.from(
      'BT /F1 9 Tf 40 800 Td (Invoice No: INV-1) Tj ET\nBT 40 788 Td [(Total: ) -300 (26000)] TJ ET',
    );
    const z = deflateSync(content);
    const pdf = Buffer.concat([
      Buffer.from(
        `%PDF-1.4\n2 0 obj << /Length ${z.length} /Filter /FlateDecode >>\nstream\n`,
      ),
      z,
      Buffer.from('\nendstream\nendobj\n%%EOF'),
    ]);
    expect(extractPdfText(pdf)).toBe('Invoice No: INV-1\nTotal:  26000');
    expect(extractPdfText(Buffer.from('not a pdf'))).toBe('');
  });
});

describe('deterministic validation', () => {
  it('treats formatting-only address differences as equal and different countries as critical', () => {
    const a = view({
      fields: {
        buyerAddress: 'Plot 4, Jebel Ali,  Dubai, United Arab Emirates',
      },
    });
    const b = view({
      kind: 'PO',
      label: 'PO',
      fields: { buyerAddress: 'PLOT 4 JEBEL ALI DUBAI UNITED ARAB EMIRATES.' },
    });
    expect(
      compareDocuments(a, b, ctx).filter((f) => f.type === 'ADDRESS_MISMATCH'),
    ).toHaveLength(0);
    const c = view({ fields: { buyerAddress: 'Plot 4, Muscat, Oman' } });
    expect(
      compareDocuments(c, b, ctx).find((f) => f.type === 'ADDRESS_MISMATCH')
        ?.severity,
    ).toBe('CRITICAL');
  });
  it('converts mass units only, never cartons to kg', () => {
    const pl = view({
      kind: 'PL',
      items: [item({ quantity: '9500', unit: 'KG', unitPrice: null })],
    });
    const ci = view({ kind: 'CI', label: 'CI', items: [item({})] });
    const q = compareDocuments(pl, ci, ctx);
    expect(q.find((f) => f.type === 'QUANTITY_MISMATCH')?.severity).toBe(
      'WARNING',
    );
    expect(q.some((f) => f.type === 'PRICE_MISMATCH')).toBe(false);
    const cartons = compareDocuments(
      view({ kind: 'PL', items: [item({ quantity: '400', unit: 'CARTON' })] }),
      ci,
      ctx,
    );
    expect(cartons.find((f) => f.type === 'UNIT_MISMATCH')?.severity).toBe(
      'CRITICAL',
    );
  });
  it('grades HS differences by confirmation and flags ambiguous item matches', () => {
    const a = view({ kind: 'PO_DOC', items: [item({ hsCode: '090932' })] });
    expect(
      compareDocuments(
        a,
        view({ kind: 'PO', label: 'PO', items: [item({})] }),
        ctx,
      ).find((f) => f.type === 'HS_CODE_MISMATCH')?.severity,
    ).toBe('CRITICAL');
    expect(
      compareDocuments(
        a,
        view({
          kind: 'PO',
          label: 'PO',
          items: [item({ hsConfirmed: false })],
        }),
        ctx,
      ).find((f) => f.type === 'HS_CODE_MISMATCH')?.severity,
    ).toBe('WARNING');
    const m = matchItems(
      [item({ description: 'Cumin', hsCode: null })],
      [
        item({ description: 'Cumin seeds A', hsCode: null }),
        item({ description: 'Cumin seeds B', hsCode: null }),
      ],
    );
    expect(m.ambiguous).toHaveLength(1);
    expect(m.pairs).toHaveLength(0);
  });
  it('compares currency/Incoterm/place and checks expiry', () => {
    const f = compareDocuments(
      view({
        fields: { currency: 'EUR', incoterm: 'FOB', incotermPlace: 'Mundra' },
      }),
      view({
        kind: 'PO',
        label: 'PO',
        fields: {
          currency: 'USD',
          incoterm: 'CIF',
          incotermPlace: 'Jebel Ali',
        },
      }),
      ctx,
    );
    expect(f.map((x) => `${x.severity}:${x.type}`)).toEqual(
      expect.arrayContaining([
        'CRITICAL:CURRENCY_MISMATCH',
        'CRITICAL:INCOTERM_MISMATCH',
      ]),
    );
    const place = compareDocuments(
      view({ fields: { incoterm: 'CIF', incotermPlace: 'Dubai' } }),
      view({
        kind: 'PO',
        label: 'PO',
        fields: { incoterm: 'CIF', incotermPlace: 'Jebel Ali' },
      }),
      ctx,
    );
    expect(place.map((x) => `${x.severity}:${x.field}`)).toEqual([
      'WARNING:incotermPlace',
    ]);
    expect(
      checkDocument(
        view({
          kind: 'CERT',
          fields: { issueDate: '2026-01-01', expiryDate: '2026-10-01' },
        }),
        ctx,
      ).map((x) => x.rule),
    ).toEqual(['date.expired']);
    expect(
      checkDocument(
        view({ kind: 'CERT', fields: { expiryDate: '2026-10-20' } }),
        ctx,
      )[0].severity,
    ).toBe('WARNING');
  });
});
