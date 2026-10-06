import {
  ClassificationOutput,
  ClassificationOutputCandidate,
  ClassificationRequest,
  ProductClassificationProvider,
  ProviderIdentity,
} from './classification-provider';

type Candidate = ClassificationOutputCandidate;
type Question =
  ClassificationOutput['ambiguity']['clarifyingQuestions'][number];

const hs = (
  code: string,
  description: string,
  confidence: number,
  reasoning: string,
): Candidate => ({
  code,
  codeSystem: code.length === 8 ? 'ITC_HS_INDIA' : 'HS',
  description,
  confidence,
  reasoning,
});

interface RuleResult {
  name: string;
  summary: string;
  category: string;
  identification: ClassificationOutput['identification'];
  candidates: Candidate[];
  ambiguity?: { reason: string; questions: Question[] };
}

type Rule = { match: RegExp; build: (text: string) => RuleResult };

const has = (text: string, re: RegExp) => re.test(text);

/**
 * Deterministic, rule-based stand-in for an AI provider — development and
 * test environments only (never registered in production). Results are
 * stored with sourceType DEVELOPMENT_DEMO and labeled as demo results in
 * the UI. Covers a handful of sample products; anything else returns a
 * low-confidence, no-candidate result rather than fabricated certainty.
 */
export class DevelopmentClassificationProvider implements ProductClassificationProvider {
  readonly identity: ProviderIdentity = {
    name: 'development',
    model: null,
    sourceType: 'DEVELOPMENT_DEMO',
    promptVersion: 'dev-rules-v1',
  };

  async classify(
    request: ClassificationRequest,
  ): Promise<ClassificationOutput> {
    const text = [
      request.input,
      ...Object.values(request.details),
      ...request.clarifications.map((c) => c.answer),
    ]
      .join(' ')
      .toLowerCase();

    const rule = RULES.find((r) => r.match.test(text));
    if (!rule) return unknownResult(request);

    const result = rule.build(text);
    const [primary, ...alternatives] = result.candidates;
    return {
      normalizedProductName: result.name,
      summary: result.summary,
      category: result.category,
      identification: result.identification,
      primaryCandidate: primary ?? null,
      alternatives,
      ambiguity: result.ambiguity
        ? {
            isAmbiguous: true,
            reason: result.ambiguity.reason,
            clarifyingQuestions: result.ambiguity.questions,
          }
        : { isAmbiguous: false, reason: null, clarifyingQuestions: [] },
    };
  }
}

const id = (
  material: string | null,
  form: string | null,
  intendedUse: string | null,
  confidence: number,
  composition: string | null = null,
) => ({
  material,
  form,
  intendedUse,
  composition,
  confidence,
});

const RULES: Rule[] = [
  {
    match: /cumin|jeera/,
    build: (t) => {
      const ground = has(
        t.replace(/neither crushed nor ground|not (crushed|ground)/g, ''),
        /ground|powder|crushed/,
      );
      return {
        name: ground ? 'Cumin Powder' : 'Cumin Seeds',
        summary: ground
          ? 'Ground cumin (Cuminum cyminum) spice.'
          : 'Whole dried cumin seeds (Cuminum cyminum), a spice, neither crushed nor ground.',
        category: 'SPICES',
        identification: id(
          'Cumin seed',
          ground ? 'Ground powder' : 'Whole dried seeds',
          'Culinary spice',
          90,
        ),
        candidates: ground
          ? [
              hs(
                '090932',
                'Seeds of cumin, crushed or ground',
                82,
                'Cumin seed that has been ground falls under the crushed/ground subheading.',
              ),
              hs(
                '090931',
                'Seeds of cumin, neither crushed nor ground',
                20,
                'Applies only if the seeds are whole.',
              ),
            ]
          : [
              hs(
                '090931',
                'Seeds of cumin, neither crushed nor ground',
                85,
                'Whole cumin seeds are specifically named under heading 0909.',
              ),
              hs(
                '090932',
                'Seeds of cumin, crushed or ground',
                20,
                'Applies if the product is ground or crushed.',
              ),
              hs(
                '091030',
                'Turmeric (curcuma)',
                5,
                'Only if the product is a spice blend dominated by turmeric — unlikely.',
              ),
            ],
      };
    },
  },
  {
    match: /areca|palm leaf|palm-leaf/,
    build: () => ({
      name: 'Areca Palm Leaf Dinner Plates',
      summary:
        'Disposable, biodegradable tableware (plates) pressed from naturally fallen areca palm leaf sheaths.',
      category: 'HANDICRAFTS',
      identification: id(
        'Areca palm leaf sheath',
        'Heat-pressed plates',
        'Disposable tableware',
        80,
      ),
      candidates: [
        hs(
          '140490',
          'Vegetable products n.e.s. — other',
          58,
          'Pressed leaf articles are often treated as vegetable products not elsewhere specified; practice varies.',
        ),
        hs(
          '460219',
          'Articles of vegetable plaiting materials — other',
          35,
          'May apply if the article is considered made directly to shape from vegetable material.',
        ),
        hs(
          '482369',
          'Trays, dishes, plates of paper or paperboard — other',
          15,
          'Only if the plates are pulp-moulded rather than pressed whole leaf.',
        ),
      ],
    }),
  },
  {
    match: /plastic (container|box|jar|tub|bottle)|container.*plastic/,
    build: (t) => {
      const household = has(t, /household|kitchen|home|food storage|lunch/);
      const packaging = has(
        t,
        /packaging|packing|transport|shipping|conveyance/,
      );
      const bottle = has(t, /bottle|jar|flask|carboy/);
      if (household) {
        return {
          name: 'Plastic Household Storage Container',
          summary: 'Plastic container for household / kitchen storage use.',
          category: 'PLASTICS',
          identification: id(
            resin(t),
            'Moulded container',
            'Household / kitchen storage',
            78,
          ),
          candidates: [
            hs(
              '392410',
              'Tableware and kitchenware, of plastics',
              72,
              'Household kitchen storage containers are classified as plastic kitchenware.',
            ),
            hs(
              '392490',
              'Household articles of plastics — other',
              30,
              'Applies for non-kitchen household use.',
            ),
            hs(
              '392310',
              'Boxes, cases, crates of plastics',
              12,
              'Only if sold as packaging for goods.',
            ),
          ],
        };
      }
      if (packaging) {
        return {
          name: bottle
            ? 'Plastic Packaging Bottle'
            : 'Plastic Packaging Container',
          summary:
            'Plastic container used for the conveyance or packing of goods.',
          category: 'PLASTICS',
          identification: id(
            resin(t),
            bottle ? 'Bottle / jar' : 'Box / case',
            'Packaging of goods',
            78,
          ),
          candidates: bottle
            ? [
                hs(
                  '392330',
                  'Carboys, bottles, flasks and similar articles, of plastics',
                  72,
                  'Bottle-type packaging containers are named in this subheading.',
                ),
                hs(
                  '392310',
                  'Boxes, cases, crates of plastics',
                  20,
                  'If the container is box-shaped rather than a bottle.',
                ),
              ]
            : [
                hs(
                  '392310',
                  'Boxes, cases, crates and similar articles, of plastics',
                  70,
                  'Box-type packaging containers.',
                ),
                hs(
                  '392390',
                  'Articles for packing of goods, of plastics — other',
                  25,
                  'Other packaging forms.',
                ),
              ],
        };
      }
      return {
        name: 'Plastic Container',
        summary:
          'A plastic container — use, shape and resin are not specified.',
        category: 'PLASTICS',
        identification: id(resin(t), 'Container', null, 55),
        candidates: [
          hs(
            '392310',
            'Boxes, cases, crates and similar articles, of plastics',
            35,
            'If used to pack or transport goods.',
          ),
          hs(
            '392410',
            'Tableware and kitchenware, of plastics',
            30,
            'If it is household / kitchen ware.',
          ),
          hs(
            '392330',
            'Carboys, bottles, flasks, of plastics',
            20,
            'If it is a bottle or jar used as packaging.',
          ),
        ],
        ambiguity: {
          reason:
            'Plastic containers fall under different headings depending on whether they are packaging for goods (3923) or household/kitchen articles (3924), and on their shape.',
          questions: [
            {
              id: 'intended_use',
              question: 'What is the container mainly used for?',
              options: [
                'Packaging / transport of goods',
                'Household / kitchen storage',
                'Industrial storage',
              ],
            },
            {
              id: 'shape',
              question: 'What is its shape?',
              options: ['Box / tub', 'Bottle / jar', 'Crate', 'Other'],
            },
            {
              id: 'resin',
              question: 'What plastic / resin is it made of?',
              options: ['PP', 'PET', 'HDPE', 'Not sure'],
            },
            {
              id: 'capacity',
              question: 'Approximate capacity?',
              options: ['Under 1 litre', '1–10 litres', 'Over 10 litres'],
            },
          ],
        },
      };
    },
  },
  {
    match: /t-?shirt|tee shirt|\btees?\b/,
    build: (t) => {
      const cotton = has(t, /cotton/);
      const synthetic = has(t, /polyester|synthetic|nylon|viscose/);
      if (!cotton && !synthetic) {
        return {
          name: 'T-Shirts',
          summary: 'Knitted T-shirts — fibre content not specified.',
          category: 'TEXTILES',
          identification: id(null, 'Knitted garment', 'Apparel', 70),
          candidates: [
            hs(
              '610910',
              'T-shirts, knitted or crocheted, of cotton',
              45,
              'If predominantly cotton.',
            ),
            hs(
              '610990',
              'T-shirts, knitted or crocheted, of other textile materials',
              40,
              'If predominantly synthetic or other fibres.',
            ),
          ],
          ambiguity: {
            reason: 'The T-shirt subheading depends on the predominant fibre.',
            questions: [
              {
                id: 'fibre',
                question: 'What is the main fibre content?',
                options: [
                  '100% cotton',
                  'Cotton blend (mostly cotton)',
                  'Polyester / synthetic',
                ],
              },
            ],
          },
        };
      }
      return {
        name: cotton ? 'Cotton T-Shirts' : 'Synthetic T-Shirts',
        summary: cotton
          ? 'Knitted T-shirts made predominantly of cotton.'
          : 'Knitted T-shirts made of synthetic or other textile fibres.',
        category: 'TEXTILES',
        identification: id(
          cotton ? 'Cotton' : 'Synthetic fibre',
          'Knitted garment',
          'Apparel',
          88,
        ),
        candidates: cotton
          ? [
              hs(
                '610910',
                'T-shirts, singlets and other vests, knitted or crocheted, of cotton',
                82,
                'T-shirts are named in heading 6109; cotton determines the subheading.',
              ),
              hs(
                '610990',
                'T-shirts, knitted, of other textile materials',
                12,
                'Only if cotton is not the predominant fibre.',
              ),
              hs(
                '620520',
                'Men’s shirts, not knitted, of cotton',
                6,
                'Only if the garment is woven rather than knitted.',
              ),
            ]
          : [
              hs(
                '610990',
                'T-shirts, knitted or crocheted, of other textile materials',
                78,
                'Synthetic-fibre knitted T-shirts.',
              ),
              hs(
                '610910',
                'T-shirts, knitted, of cotton',
                12,
                'Only if cotton predominates.',
              ),
            ],
      };
    },
  },
  {
    match: /led (driver|power supply)|power supply|smps|led driver/,
    build: () => ({
      name: 'LED Driver (Power Supply)',
      summary:
        'Electronic power supply / static converter that drives LED lighting.',
      category: 'ELECTRONICS',
      identification: id(
        'Electronic components',
        'Standalone power supply unit',
        'Powering LED lighting',
        80,
      ),
      candidates: [
        hs(
          '850440',
          'Static converters',
          70,
          'Standalone LED drivers convert AC to regulated DC and are generally static converters.',
        ),
        hs(
          '940599',
          'Parts of luminaires and lighting fittings — other',
          18,
          'May apply if the driver is a dedicated, non-standalone part of a specific luminaire.',
        ),
        hs(
          '854141',
          'Light-emitting diodes (LED)',
          5,
          'Only if the product is the LED itself, not the driver.',
        ),
      ],
    }),
  },
  {
    match: /stainless steel|steel (utensil|kitchen|cookware)/,
    build: (t) => {
      const cutlery = has(t, /spoon|fork|ladle|cutlery|skimmer/);
      const cookware = has(
        t,
        /pot|pan|bowl|plate|tiffin|vessel|cookware|tumbler|kadai/,
      );
      if (!cutlery && !cookware) {
        return {
          name: 'Stainless Steel Kitchen Utensils',
          summary:
            'Stainless steel kitchen articles — specific type not stated.',
          category: 'HOME_KITCHEN',
          identification: id(
            'Stainless steel',
            null,
            'Kitchen / household use',
            70,
          ),
          candidates: [
            hs(
              '732393',
              'Table, kitchen or household articles, of stainless steel',
              55,
              'Covers pots, pans, bowls and similar articles.',
            ),
            hs(
              '821599',
              'Spoons, forks, ladles and similar tableware — other',
              35,
              'Covers spoons, ladles and serving utensils.',
            ),
          ],
          ambiguity: {
            reason:
              'Stainless steel cookware/vessels (7323) and spoons/ladles/cutlery (8215) are classified differently.',
            questions: [
              {
                id: 'article_type',
                question: 'Which kind of utensils are these?',
                options: [
                  'Pots, pans, bowls, plates',
                  'Spoons, ladles, cutlery',
                  'A mixed set',
                ],
              },
            ],
          },
        };
      }
      return {
        name: cutlery
          ? 'Stainless Steel Spoons & Ladles'
          : 'Stainless Steel Kitchenware',
        summary: cutlery
          ? 'Stainless steel spoons, ladles or similar kitchen/tableware.'
          : 'Stainless steel cookware and household vessels.',
        category: 'HOME_KITCHEN',
        identification: id(
          'Stainless steel',
          cutlery ? 'Cutlery / serving utensils' : 'Vessels / cookware',
          'Kitchen / household use',
          85,
        ),
        candidates: cutlery
          ? [
              hs(
                '821599',
                'Spoons, forks, ladles and similar tableware — other',
                72,
                'Spoons and ladles are named in heading 8215.',
              ),
              hs(
                '732393',
                'Kitchen articles of stainless steel',
                15,
                'If the items are vessels rather than cutlery.',
              ),
            ]
          : [
              hs(
                '732393',
                'Table, kitchen or other household articles, of stainless steel',
                76,
                'Stainless steel household vessels are named in this subheading.',
              ),
              hs(
                '821599',
                'Spoons, ladles and similar tableware',
                10,
                'Only for cutlery-type items.',
              ),
            ],
      };
    },
  },
  {
    match: /cream|lotion|cosmetic|ayurvedic (cosmetic|skin)/,
    build: (t) => {
      const medicinal = has(
        t,
        /therapeutic|medicinal|medicine|ayush licen|treat/,
      );
      const cosmetic = has(
        t,
        /no therapeutic|no medicinal|cosmetic only|beauty|moisturi/,
      );
      if (medicinal && !cosmetic) {
        return {
          name: 'Herbal Medicinal Cream',
          summary:
            'Herbal/Ayurvedic cream marketed with therapeutic or medicinal claims.',
          category: 'PHARMACEUTICALS',
          identification: id(
            'Herbal extracts',
            'Cream',
            'Therapeutic / medicinal use',
            75,
          ),
          candidates: [
            hs(
              '300490',
              'Medicaments for retail sale — other',
              60,
              'Products with genuine therapeutic purpose may be medicaments; depends on licensing and claims.',
            ),
            hs(
              '330499',
              'Skin-care preparations — other',
              30,
              'If the therapeutic claims are secondary to cosmetic use.',
            ),
          ],
        };
      }
      if (cosmetic) {
        return {
          name: 'Herbal Cosmetic Cream',
          summary:
            'Herbal skin-care cream sold as a cosmetic without therapeutic claims.',
          category: 'BEAUTY_PERSONAL_CARE',
          identification: id(
            'Herbal extracts',
            'Cream',
            'Cosmetic skin care',
            82,
          ),
          candidates: [
            hs(
              '330499',
              'Beauty or skin-care preparations — other',
              74,
              'Skin-care creams without therapeutic claims are cosmetic preparations.',
            ),
            hs(
              '300490',
              'Medicaments for retail sale — other',
              10,
              'Only if sold as a medicine.',
            ),
          ],
        };
      }
      return {
        name: 'Herbal Cream',
        summary:
          'Herbal cream — not stated whether it is a cosmetic or a medicinal product.',
        category: 'BEAUTY_PERSONAL_CARE',
        identification: id('Herbal extracts', 'Cream', null, 65),
        candidates: [
          hs(
            '330499',
            'Beauty or skin-care preparations — other',
            50,
            'If sold as a cosmetic.',
          ),
          hs(
            '300490',
            'Medicaments for retail sale — other',
            35,
            'If sold as an Ayurvedic/herbal medicine with therapeutic claims.',
          ),
        ],
        ambiguity: {
          reason:
            'Herbal creams may be cosmetics (3304) or medicaments (3004) depending on claims, composition and licensing.',
          questions: [
            {
              id: 'claims',
              question: 'Is the cream sold with therapeutic/medicinal claims?',
              options: [
                'Yes — medicinal / Ayurvedic medicine',
                'No — cosmetic only',
              ],
            },
          ],
        },
      };
    },
  },
  {
    match: /basmati/,
    build: () => ({
      name: 'Basmati Rice',
      summary: 'Milled basmati rice.',
      category: 'AGRICULTURE',
      identification: id('Rice', 'Milled grain', 'Food', 90),
      candidates: [
        hs(
          '10063020',
          'Basmati rice',
          80,
          'India has a dedicated national tariff line for basmati rice under 1006.30.',
        ),
        hs(
          '100630',
          'Semi-milled or wholly milled rice',
          70,
          'International HS subheading for milled rice.',
        ),
      ],
    }),
  },
  {
    match: /turmeric|haldi/,
    build: () => ({
      name: 'Turmeric',
      summary: 'Turmeric (curcuma), whole or powdered.',
      category: 'SPICES',
      identification: id('Turmeric root', null, 'Culinary spice', 88),
      candidates: [
        hs(
          '091030',
          'Turmeric (curcuma)',
          84,
          'Turmeric is specifically named in heading 0910.',
        ),
      ],
    }),
  },
  {
    match: /honey/,
    build: () => ({
      name: 'Natural Honey',
      summary: 'Natural honey.',
      category: 'FOOD_BEVERAGES',
      identification: id('Honey', 'Liquid', 'Food', 88),
      candidates: [
        hs(
          '040900',
          'Natural honey',
          85,
          'Natural honey has its own heading 0409.',
        ),
      ],
    }),
  },
];

function resin(text: string): string | null {
  const m = text.match(/\b(pp|pet|hdpe|ldpe|pvc|polypropylene|polyethylene)\b/);
  return m ? m[1].toUpperCase() : null;
}

function unknownResult(request: ClassificationRequest): ClassificationOutput {
  const name = request.input
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return {
    normalizedProductName: name || 'Unidentified product',
    summary:
      'The development provider does not recognise this product. Add details or select a code manually.',
    category: request.categoryHint ?? 'OTHER',
    identification: {
      material: null,
      form: null,
      intendedUse: null,
      composition: null,
      confidence: 20,
    },
    primaryCandidate: null,
    alternatives: [],
    ambiguity: {
      isAmbiguous: true,
      reason: 'Not enough information to suggest a classification.',
      clarifyingQuestions: [
        {
          id: 'material',
          question: 'What is the product mainly made of?',
          options: [],
        },
        {
          id: 'intended_use',
          question: 'What is it used for, and by whom?',
          options: [],
        },
        {
          id: 'form',
          question:
            'In what form is it sold (raw, processed, finished article, part)?',
          options: [
            'Raw / unprocessed',
            'Processed',
            'Finished article',
            'Part / component',
          ],
        },
      ],
    },
  };
}
