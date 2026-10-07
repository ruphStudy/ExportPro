import {
  type CompareDoc,
  comparePo,
  type ComparePo,
  documentTotals,
  lineTotal,
  normText,
  roundPrice,
} from './commercial-math';
import { renderCommercialPdf } from './pdf/commercial-pdf';
import { pdfSafe, wrap } from './pdf/pdf-writer';

const quote: CompareDoc = {
  kind: 'QUOTATION',
  label: 'quotation QT-1',
  buyerCompanyId: 'b1',
  currency: 'USD',
  incoterm: 'FOB',
  incotermPlace: 'Mundra',
  paymentTerms: '30% advance, 70% against documents',
  deliveryTerms: 'Shipment within 30 days',
  total: '31000.00',
  items: [
    {
      id: 'q1',
      matchKey: 'q1',
      description: 'Cumin seeds',
      unit: 'MT',
      quantity: '10',
      unitPrice: '2100',
      specification: '99% purity',
    },
    {
      id: 'q2',
      matchKey: 'q2',
      description: 'Coriander seeds',
      unit: 'MT',
      quantity: '5',
      unitPrice: '2000',
      specification: null,
    },
  ],
};
const po = (p: Partial<ComparePo> = {}): ComparePo => ({
  buyerCompanyId: 'b1',
  currency: 'USD',
  incoterm: 'FOB',
  incotermPlace: 'MUNDRA',
  paymentTerms: '30% Advance; 70% against documents.',
  deliveryTerms: 'Shipment within 30 days',
  totalAmount: '31000.00',
  items: [
    {
      id: 'p1',
      matchKey: 'q1',
      description: 'Cumin seeds',
      unit: 'MT',
      quantity: '10',
      unitPrice: '2100',
      totalPrice: '21000.00',
      specification: '99% Purity',
    },
    {
      id: 'p2',
      matchKey: 'q2',
      description: 'Coriander seeds',
      unit: 'MT',
      quantity: '5',
      unitPrice: '2000',
      totalPrice: '10000.00',
      specification: null,
    },
  ],
  ...p,
});
const tol = { quantityPercent: '0', pricePercent: '0' };
const sev = (f: ReturnType<typeof comparePo>) =>
  f.map((x) => `${x.severity}:${x.type}:${x.field}`);

describe('document totals (Sprint 14 decimal policy)', () => {
  it('computes item totals, subtotal, charges and discount exactly', () => {
    expect(lineTotal('10', '2100').toString()).toBe('21000');
    expect(lineTotal('0.3', '0.1').toFixed(2)).toBe('0.03');
    expect(
      documentTotals(
        [
          { quantity: '10', unitPrice: '2100' },
          { quantity: '5', unitPrice: '2000' },
        ],
        '150.50',
        '50',
      ),
    ).toEqual({ subtotal: '31000.00', total: '31100.50' });
    expect(
      documentTotals([{ quantity: '1', unitPrice: null }], '0', '0'),
    ).toEqual({ subtotal: null, total: null });
    expect(roundPrice('2950.71545', 2).toString()).toBe('2950.72');
    expect(roundPrice('2950.71545', 4).toString()).toBe('2950.7155');
  });
});

describe('deterministic PO comparison', () => {
  it('a matching PO (case/punctuation differences only) has no discrepancies', () => {
    expect(comparePo(po(), [quote], tol)).toEqual([]);
    expect(normText(' 30% Advance; ')).toBe(normText('30% advance'));
  });

  it('flags price mismatch as CRITICAL and the total as CRITICAL', () => {
    const f = comparePo(
      po({
        items: [
          { ...po().items[0], unitPrice: '2000', totalPrice: '20000.00' },
          po().items[1],
        ],
        totalAmount: '30000.00',
      }),
      [quote],
      tol,
    );
    expect(sev(f)).toEqual(
      expect.arrayContaining([
        'CRITICAL:PRICE:unitPrice',
        'CRITICAL:TOTAL:total',
      ]),
    );
  });

  it('grades quantity differences: within tolerance none, ≤10% WARNING, >10% CRITICAL', () => {
    const q = (n: string) =>
      comparePo(
        po({
          items: [
            { ...po().items[0], quantity: n, totalPrice: null },
            po().items[1],
          ],
          totalAmount: null,
        }),
        [quote],
        { quantityPercent: '2', pricePercent: '0' },
      ).filter((x) => x.type === 'QUANTITY');
    expect(q('10.1')).toEqual([]);
    expect(q('10.5')[0].severity).toBe('WARNING');
    expect(q('12')[0].severity).toBe('CRITICAL');
  });

  it('flags currency and Incoterm as CRITICAL, named place / payment / delivery as WARNING', () => {
    const f = comparePo(
      po({
        currency: 'EUR',
        incoterm: 'CIF',
        incotermPlace: 'Jebel Ali',
        paymentTerms: 'LC at sight',
        deliveryTerms: 'Within 60 days',
      }),
      [quote],
      tol,
    );
    expect(sev(f)).toEqual(
      expect.arrayContaining([
        'CRITICAL:CURRENCY:currency',
        'CRITICAL:INCOTERM:incoterm',
        'WARNING:PAYMENT_TERM:paymentTerms',
        'WARNING:DELIVERY:deliveryTerms',
      ]),
    );
    const place = comparePo(po({ incotermPlace: 'Nhava Sheva' }), [quote], tol);
    expect(sev(place)).toEqual(['WARNING:INCOTERM:incotermPlace']);
  });

  it('detects unknown and missing products and unit changes without converting', () => {
    const f = comparePo(
      po({
        items: [
          { ...po().items[0], unit: 'KG', quantity: '10000', totalPrice: null },
          {
            id: 'p3',
            matchKey: null,
            description: 'Fennel',
            unit: 'MT',
            quantity: '1',
            unitPrice: '1500',
            specification: null,
          },
        ],
        totalAmount: null,
      }),
      [quote],
      tol,
    );
    expect(sev(f)).toEqual(
      expect.arrayContaining([
        'CRITICAL:QUANTITY:unit',
        'CRITICAL:PRODUCT:item',
        'WARNING:PRODUCT:item',
      ]),
    );
  });

  it('checks the PO’s own arithmetic and compares against quotation and PI separately', () => {
    const f = comparePo(
      po({ totalAmount: '31500.00' }),
      [quote, { ...quote, kind: 'PI', label: 'PI-1', total: '31500.00' }],
      tol,
    );
    expect(f.some((x) => x.against === 'PO' && x.type === 'TOTAL')).toBe(true);
    expect(
      f.some(
        (x) =>
          x.against === 'QUOTATION' &&
          x.type === 'TOTAL' &&
          x.severity === 'CRITICAL',
      ),
    ).toBe(true);
    expect(f.some((x) => x.against === 'PI' && x.type === 'TOTAL')).toBe(false);
    expect(new Set(f.map((x) => x.signature)).size).toBe(f.length);
  });
});

describe('PDF generation', () => {
  const input = {
    title: 'QUOTATION' as const,
    number: 'QT-2026-000001',
    draft: false,
    issueDate: '2026-10-07',
    validUntil: '2026-11-06',
    exporter: {
      name: 'Spice Exports (test)',
      address: 'Unjha, Gujarat',
      country: 'India',
      contactName: null,
      email: 'sales@spice.example',
      phone: null,
      registrations: [{ type: 'IEC', number: '0123456789' }],
    },
    buyer: {
      name: 'Acme Gulf Foods Demo LLC',
      address: 'Dubai',
      country: 'United Arab Emirates',
      contactName: 'Demo Contact',
      email: 'buying@acme.example',
      phone: null,
    },
    currency: 'USD',
    items: Array.from({ length: 40 }, (_, i) => ({
      description: `Cumin seeds lot ${i + 1} — Europe quality`,
      hsCode: '090931',
      specification: 'Purity 99%',
      packaging: '25 kg PP bags',
      quantity: '10',
      unit: 'MT',
      unitPrice: '2100.00',
      total: '21000.00',
    })),
    subtotal: '840000.00',
    charges: null,
    discount: '0.00',
    total: '840000.00',
    incoterm: 'FOB Mundra',
    destination: 'Jebel Ali, United Arab Emirates',
    paymentTerms: '30% advance',
    deliveryTerms: 'Within 30 days',
    buyerNotes: 'Thank you for your inquiry.',
    terms: '1. Validity as stated.',
    bank: null,
    reference: null,
    footer: 'Prices exclude taxes/duties unless explicitly stated.',
  };

  it('produces a valid, multi-page, deterministic PDF', () => {
    const a = renderCommercialPdf(input, null);
    const b = renderCommercialPdf(input, null);
    expect(a.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(a.subarray(-6).toString('latin1')).toContain('%%EOF');
    expect(a.equals(b)).toBe(true);
    expect(/\/Count (\d+)/.exec(a.toString('latin1'))![1]).not.toBe('1');
    expect(a.toString('latin1')).toContain('QT-2026-000001');
  });

  it('only renders buyer-facing fields (input has no cost/margin fields at all)', () => {
    const text = renderCommercialPdf(input, null).toString('latin1');
    expect(text).not.toMatch(/margin|procurement|supplier/i);
  });

  it('sanitizes text for standard fonts and wraps long words', () => {
    expect(pdfSafe('Café – 5 × ₹')).toBe('Cafe - 5 x INR ');
    expect(wrap('a'.repeat(300), 100, 9).length).toBeGreaterThan(1);
  });
});
