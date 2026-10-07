import { extractByRules } from './extraction/development-extraction.provider';
import { ground, sanitizeExtraction } from './extraction/extraction-schema';
import {
  clarificationDraft,
  htmlToText,
  missingFields,
  suggestPriority,
  suggestQuestions,
} from './inquiry-rules';

const RFQ = `Dear Sir,
We are importers in Dubai and need a quotation for:
- Cumin seeds: 10 MT, Europe quality, purity 99%, packed in 25 kg PP bags
- Coriander seeds - 5 MT, split, moisture max 10%
Price target around USD 2.8/kg.
Please quote CIF Jebel Ali, destination United Arab Emirates.
Payment: 30% advance, balance against D/P.
Shipment by 15 December 2026. Certificates required: Phytosanitary, FSSAI and Halal.
Please send 1 kg sample of each by 20 November.`;

describe('rule-based development extractor', () => {
  const r = extractByRules(RFQ);

  it('keeps multiple products separate with their own quantity and specification', () => {
    expect(r.items).toHaveLength(2);
    expect(
      r.items.map((i) => [
        i.productName.value,
        i.quantity.value,
        i.quantityUnit.value,
      ]),
    ).toEqual([
      ['Cumin seeds', 10, 'MT'],
      ['Coriander seeds', 5, 'MT'],
    ]);
    expect(r.items[0].specification.value).toContain('purity 99%');
    expect(r.items[1].specification.value).toContain('moisture max 10%');
  });

  it('extracts destination, Incoterm, certifications, payment, delivery and sample', () => {
    expect(r.destination.countryCode.value).toBe('AE');
    expect(r.incoterm.term.value).toBe('CIF');
    expect(r.incoterm.place.value).toBe('Jebel Ali');
    expect(r.certifications.map((c) => c.name).sort()).toEqual([
      'FSSAI',
      'Halal',
      'Phytosanitary',
    ]);
    expect(r.paymentTerms.type.value).toBe('MIXED');
    expect(r.paymentTerms.advancePercent.value).toBe(30);
    expect(r.delivery.targetDate.value).toBe('15 December 2026');
    expect(r.sample).toMatchObject({
      required: { value: true },
      quantity: { value: '1 kg' },
    });
  });

  it('does not attach line-specific packaging or an untied price to other products', () => {
    expect(r.items[0].packaging.value).toBe('25 kg PP bags');
    expect(r.items[1].packaging.value).toBeNull();
    expect(r.items.every((i) => i.targetPrice.value === null)).toBe(true);
    expect(r.ambiguities.some((a) => a.field === 'targetPrice')).toBe(true);
  });

  it('marks several Incoterms as ambiguous instead of choosing one', () => {
    const x = extractByRules(
      'Need 5 MT turmeric. Quote FOB Mundra or CIF Dammam.',
    );
    expect(x.incoterm.term.value).toBeNull();
    expect(x.incoterm.term.ambiguous).toBe(true);
  });

  it('leaves unknown values null — nothing is invented', () => {
    const x = extractByRules('Hello, please send your catalogue.');
    expect(x.items).toHaveLength(0);
    expect(x.destination.countryCode.value).toBeNull();
    expect(x.paymentTerms.type.value).toBeNull();
    expect(x.delivery.targetDate.value).toBeNull();
  });

  it('keeps indicative prices indicative', () => {
    const x = extractByRules(
      'Need 2 containers of Basmati rice. Price around USD 1100/MT.',
    );
    expect(x.items[0].quantityUnit.value).toBe('CONTAINER');
    expect(x.items[0].targetPrice.value).toBe(1100);
    expect(x.items[0].priceIndicative).toBe(true);
  });
});

describe('schema validation and grounding', () => {
  const field = (
    value: unknown,
    raw: string | null = null,
    explicit = true,
  ) => ({
    value,
    raw,
    confidence: 'HIGH',
    explicit,
    ambiguous: false,
    note: null,
  });

  it('drops only invalid fields (partial extraction)', () => {
    const { data, invalidFields } = sanitizeExtraction({
      items: [
        {
          productName: field('Cumin', 'Cumin'),
          quantity: field(-5, '-5 MT'),
          quantityUnit: field('MT', 'MT'),
          priceIndicative: false,
        },
      ],
      incoterm: { term: field('FOBX', 'FOBX'), place: field(null) },
      overallConfidence: 70,
    });
    expect(data.items[0].productName.value).toBe('Cumin');
    expect(data.items[0].quantity.value).toBeNull();
    expect(invalidFields).toEqual(
      expect.arrayContaining(['items[0].quantity', 'incoterm.term']),
    );
    expect(data.overallConfidence).toBe(70);
  });

  it('survives completely invalid output', () => {
    const { data, invalidFields } = sanitizeExtraction('not json');
    expect(data.items).toEqual([]);
    expect(invalidFields).toContain('overallConfidence');
  });

  it('downgrades values that are not in the inquiry and moves unstated HS codes to a suggestion', () => {
    const { data } = sanitizeExtraction({
      items: [
        {
          productName: field('Cumin', 'Cumin'),
          hsCode: field('090931', 'HS 090931'),
          quantity: field(25, '25 MT'),
          quantityUnit: field('MT', 'MT'),
          priceIndicative: false,
        },
      ],
      paymentTerms: {
        type: field('LC', 'LC at sight'),
        advancePercent: field(null),
        creditDays: field(null),
        raw: null,
      },
      overallConfidence: 80,
    });
    const g = ground(data, 'Please quote 10 MT cumin.');
    expect(g.items[0].quantity).toMatchObject({
      explicit: false,
      confidence: 'LOW',
      ambiguous: true,
    });
    expect(g.items[0].hsCode.value).toBeNull();
    expect(g.items[0].hsSuggestion).toEqual({
      code: '090931',
      confidence: 'LOW',
    });
    expect(g.ambiguities.length).toBeGreaterThan(0);
  });
});

describe('inquiry rules', () => {
  it('strips script/style and markup from inbound HTML', () => {
    const t = htmlToText(
      '<html><style>p{color:red}</style><script>alert(1)</script><p>Need <b>10 MT</b> cumin&nbsp;&amp; coriander</p><br>Thanks</html>',
    );
    expect(t).toBe('Need 10 MT cumin & coriander\n\nThanks');
    expect(t).not.toContain('alert');
  });

  it('only suggests URGENT on explicit urgency and keeps it a suggestion', () => {
    expect(
      suggestPriority({
        text: 'Please quote ASAP',
        source: 'MANUAL',
        leadStage: null,
        items: [],
      }).priority,
    ).toBe('URGENT');
    expect(
      suggestPriority({
        text: 'Quote please',
        source: 'EMAIL_REPLY',
        leadStage: null,
        items: [],
      }).priority,
    ).toBe('HIGH');
    expect(
      suggestPriority({
        text: 'Quote',
        source: 'MANUAL',
        leadStage: null,
        items: [{ quantity: 12, unit: 'MT' }],
      }).priority,
    ).toBe('HIGH');
    expect(
      suggestPriority({
        text: 'Quote',
        source: 'MANUAL',
        leadStage: null,
        items: [],
      }).priority,
    ).toBe('LOW');
  });

  it('summarises missing fields and proposes editable questions', () => {
    const r = extractByRules('Need cumin seeds - 5 MT.');
    const m = missingFields(null, r);
    expect(m.map((x) => x.field)).toEqual(
      expect.arrayContaining([
        'destination',
        'incoterm',
        'delivery',
        'payment',
        'packaging',
      ]),
    );
    const q = suggestQuestions(m, ['Is organic certification required?']);
    expect(q.some((x) => x.source === 'AI_SUGGESTED')).toBe(true);
    expect(clarificationDraft('RFQ', 'Buyer', q)).toContain('1. ');
  });
});
