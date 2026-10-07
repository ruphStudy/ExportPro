import {
  applicability,
  buyerRequestMapping,
  coverage,
  PLATFORM_RULES,
} from './compliance-rules';
import { computeReadiness, type ReadinessItem } from './compliance-readiness';
import {
  computeTotals,
  sanitizeContent,
  validateContent,
} from './document-content';
import { renderTradeDocPdf } from './document-pdf';

const rule = (code: string) => {
  const r = PLATFORM_RULES.find((x) => x.code === code)!;
  return { ...r, conditionJson: r.condition };
};
const ctx = (p: Partial<Parameters<typeof applicability>[1]> = {}) => ({
  destinationCountry: 'AE',
  incoterm: 'CIF',
  shipmentMode: null,
  products: [{ productId: 'p', description: 'Cumin seeds', hsCode: '090931' }],
  ...p,
});

describe('deterministic compliance rules', () => {
  it('applies product, country and transaction rules with explanations', () => {
    expect(applicability(rule('IN.SPICES.CRES'), ctx())).toMatchObject({
      applicability: 'APPLICABLE',
    });
    expect(applicability(rule('IN.FSSAI'), ctx()).explanation).toMatch(
      /HS 0909 \(Cumin seeds\)/,
    );
    expect(applicability(rule('IN.APEDA.RCMC'), ctx()).applicability).toBe(
      'NOT_APPLICABLE',
    );
    expect(
      applicability(rule('AE.PHYTO'), ctx({ destinationCountry: 'DE' }))
        .applicability,
    ).toBe('NOT_APPLICABLE');
    expect(
      applicability(rule('TX.INSURANCE.CIF'), ctx({ incoterm: 'FOB' }))
        .applicability,
    ).toBe('NOT_APPLICABLE');
  });

  it('treats missing data as UNKNOWN, never as not required', () => {
    expect(
      applicability(
        rule('IN.FSSAI'),
        ctx({
          products: [{ productId: null, description: 'Goods', hsCode: null }],
        }),
      ).applicability,
    ).toBe('UNKNOWN');
    expect(
      applicability(rule('AE.PHYTO'), ctx({ destinationCountry: null }))
        .applicability,
    ).toBe('UNKNOWN');
    expect(
      applicability(rule('TX.INSURANCE.CIF'), ctx({ incoterm: null }))
        .applicability,
    ).toBe('UNKNOWN');
  });

  it('reports coverage separately and never claims complete destination law', () => {
    expect(coverage(ctx())).toMatchObject({
      indiaExport: 'COMPLETE',
      destinationImport: 'PARTIAL',
      overall: 'PARTIAL',
    });
    expect(coverage(ctx({ destinationCountry: 'DE' })).overall).toBe('UNKNOWN');
    expect(
      coverage(
        ctx({
          products: [{ productId: null, description: 'x', hsCode: null }],
        }),
      ).indiaExport,
    ).toBe('UNKNOWN');
  });

  it('has no AI-derived platform rules and only official/regulator sources for REQUIRED regulatory items', () => {
    expect(PLATFORM_RULES.some((r) => r.sourceType === 'AI_DERIVED')).toBe(
      false,
    );
    for (const r of PLATFORM_RULES.filter(
      (x) => x.level === 'REQUIRED' && x.basis === 'REGULATORY_REQUIRED',
    ))
      expect([
        'OFFICIAL_GOVERNMENT',
        'GOVERNMENT_PORTAL',
        'REGULATOR',
      ]).toContain(r.sourceType);
  });

  it('maps buyer requests to evidence without making them statutory', () => {
    expect(buyerRequestMapping('Phytosanitary').documentTypes).toEqual([
      'PHYTOSANITARY_CERTIFICATE',
    ]);
    expect(buyerRequestMapping('Halal').satisfiedBy.kind).toBe('certification');
  });
});

describe('readiness', () => {
  const item = (p: Partial<ReadinessItem>): ReadinessItem => ({
    id: 'i',
    name: 'X',
    level: 'REQUIRED',
    severity: 'BLOCKER',
    basis: 'REGULATORY_REQUIRED',
    applicability: 'APPLICABLE',
    status: 'SATISFIED',
    expiringSoon: false,
    ...p,
  });
  it('blocks on open blockers (including unknown applicability) and separates required from recommended', () => {
    expect(
      computeReadiness([item({ status: 'MISSING' })], {
        provisional: false,
        coverage: 'PARTIAL',
      }).readiness,
    ).toBe('BLOCKED');
    expect(
      computeReadiness(
        [item({ applicability: 'UNKNOWN', status: 'NOT_STARTED' })],
        { provisional: false, coverage: 'PARTIAL' },
      ).readiness,
    ).toBe('BLOCKED');
    expect(
      computeReadiness([item({ status: 'EXPIRED' })], {
        provisional: false,
        coverage: 'PARTIAL',
      }).blockers[0].reason,
    ).toBe('Evidence expired');
    const r = computeReadiness(
      [
        item({}),
        item({
          level: 'RECOMMENDED',
          severity: 'INFO',
          basis: 'ADVISORY',
          status: 'MISSING',
        }),
      ],
      { provisional: false, coverage: 'PARTIAL' },
    );
    expect(r.readiness).toBe('READY');
    expect(r.requiredReadiness).toEqual({
      satisfied: 1,
      applicable: 1,
      percent: 100,
    });
    expect(r.recommendedCompletion).toEqual({
      satisfied: 0,
      applicable: 1,
      percent: 0,
    });
    expect(
      computeReadiness([item({ severity: 'WARNING', status: 'MISSING' })], {
        provisional: false,
        coverage: 'PARTIAL',
      }).readiness,
    ).toBe('READY_WITH_WARNINGS');
    expect(
      computeReadiness([item({})], { provisional: false, coverage: 'UNKNOWN' })
        .readiness,
    ).toBe('READY_WITH_WARNINGS');
    expect(
      computeReadiness([item({})], { provisional: true, coverage: 'PARTIAL' })
        .readiness,
    ).toBe('NOT_READY');
    expect(
      computeReadiness([item({ status: 'WAIVED' })], {
        provisional: false,
        coverage: 'PARTIAL',
      }).readiness,
    ).toBe('READY');
  });
});

describe('generated document content', () => {
  const exporter = {
    name: 'Exporter',
    address: 'Unjha',
    country: 'India',
    contactName: null,
    email: null,
    phone: null,
  };
  it('computes invoice totals server-side and validates required fields', () => {
    const c = sanitizeContent(
      'COMMERCIAL_INVOICE',
      {
        items: [
          {
            description: 'Cumin',
            quantity: '10',
            unit: 'mt',
            unitPrice: '2600',
          },
        ],
        additionalCharges: '150',
        discount: '50',
      },
      { currency: 'USD' },
    );
    expect(computeTotals('COMMERCIAL_INVOICE', c)).toEqual({
      subtotal: '26000.00',
      total: '26100.00',
    });
    expect(validateContent('COMMERCIAL_INVOICE', c, exporter)).toEqual(
      expect.arrayContaining([
        'Buyer / consignee is missing.',
        'Invoice date is missing.',
        'Incoterm is missing.',
      ]),
    );
  });
  it('never invents weights and enforces gross ≥ net', () => {
    const c = sanitizeContent(
      'PACKING_LIST',
      {
        packages: [
          {
            packageType: 'Bags',
            packageCount: 2,
            description: 'Cumin',
            netWeightKg: '50',
            grossWeightKg: '49',
          },
        ],
      },
      {},
    );
    expect(validateContent('PACKING_LIST', c, exporter).join('|')).toMatch(
      /gross weight must be ≥ net weight/,
    );
    expect(() =>
      sanitizeContent(
        'PACKING_LIST',
        { packages: [{ netWeightKg: '-1' }] },
        {},
      ),
    ).toThrow();
    const ok = sanitizeContent(
      'PACKING_LIST',
      {
        packages: [
          {
            packageType: 'Bags',
            packageCount: 2,
            description: 'Cumin',
            netWeightKg: '50',
            grossWeightKg: '50.4',
          },
          {
            packageType: 'Bags',
            packageCount: 1,
            description: 'Cumin',
            netWeightKg: '25',
            grossWeightKg: '25.2',
          },
        ],
      },
      {},
    );
    expect(computeTotals('PACKING_LIST', ok)).toMatchObject({
      packages: 3,
      netWeightKg: '75',
      grossWeightKg: '75.6',
    });
  });
  it('renders a deterministic PDF without internal fields', () => {
    const input = {
      title: 'COMMERCIAL INVOICE',
      subtitle: 'Exporter-prepared commercial document - not a GST tax invoice',
      number: 'CI-2026-000001',
      draft: false,
      watermark: null,
      exporter,
      parties: [{ label: 'Buyer', lines: ['Acme'] }],
      meta: [['Currency', 'USD']] as [string, string][],
      table: { columns: [{ label: 'Item', width: 1 }], rows: [['Cumin']] },
      totals: [['Total', 'USD 1.00']] as [string, string][],
      blocks: [],
      declaration: 'True and correct.',
      signatureLabel: 'Authorised signatory',
      footer: 'f',
    };
    const a = renderTradeDocPdf(input, null);
    expect(a.equals(renderTradeDocPdf(input, null))).toBe(true);
    expect(a.toString('latin1')).toContain('not a GST tax invoice');
    expect(a.toString('latin1')).not.toMatch(/margin|internal/i);
  });
});
