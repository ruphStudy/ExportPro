import type {
  CostCategory,
  Incoterm,
  IncotermPolicyView,
} from '@exportpro/types';

/**
 * Central Incoterm® cost-allocation policy (operational pricing aid, not
 * legal advice). Which exporter cost categories contribute to the price
 * quoted under each term. Adding a term = adding one entry here; no
 * formula branches elsewhere.
 *
 *  - included: always part of the price under this term;
 *  - excluded: never part of it (not overridable — e.g. main freight is not in FOB);
 *  - conditional: seller-side costs whose inclusion depends on the deal;
 *    defaultIncluded applies unless a line explicitly overrides it;
 *  - required: categories that must have a provided amount before READY.
 */
const SELLER_OWN: { category: CostCategory; defaultIncluded: boolean }[] = [
  { category: 'INSPECTION', defaultIncluded: true },
  { category: 'CERTIFICATES', defaultIncluded: true },
  { category: 'BANKING', defaultIncluded: true },
  { category: 'MISCELLANEOUS', defaultIncluded: true },
];

export const INCOTERM_POLICIES: Record<Incoterm, IncotermPolicyView> = {
  EXW: {
    incoterm: 'EXW',
    label: 'Ex Works',
    explanation:
      'Goods made available at the seller’s premises. Price covers product and packaging plus seller-side costs up to pickup-ready; no inland transport, export clearance, port or freight.',
    included: ['PROCUREMENT', 'PACKAGING'],
    excluded: [
      'INLAND_TRANSPORT',
      'CHA',
      'CUSTOMS',
      'PORT',
      'FREIGHT',
      'INSURANCE',
    ],
    conditional: SELLER_OWN,
    required: ['PROCUREMENT'],
  },
  FCA: {
    incoterm: 'FCA',
    label: 'Free Carrier',
    explanation:
      'Delivered to the buyer’s carrier at the named place, export-cleared. Adds inland transport to the named place and export clearance (CHA, customs/statutory charges). Port/terminal charges only if the named place is the terminal.',
    included: [
      'PROCUREMENT',
      'PACKAGING',
      'INLAND_TRANSPORT',
      'CHA',
      'CUSTOMS',
    ],
    excluded: ['FREIGHT', 'INSURANCE'],
    conditional: [...SELLER_OWN, { category: 'PORT', defaultIncluded: false }],
    required: ['PROCUREMENT'],
  },
  FOB: {
    incoterm: 'FOB',
    label: 'Free On Board',
    explanation:
      'Delivered on board the vessel at the named port of shipment. Adds port/terminal and loading charges. Main (ocean) freight and insurance are excluded.',
    included: [
      'PROCUREMENT',
      'PACKAGING',
      'INLAND_TRANSPORT',
      'CHA',
      'CUSTOMS',
      'PORT',
    ],
    excluded: ['FREIGHT', 'INSURANCE'],
    conditional: SELLER_OWN,
    required: ['PROCUREMENT'],
  },
  CFR: {
    incoterm: 'CFR',
    label: 'Cost and Freight',
    explanation:
      'FOB cost basis plus main freight to the named destination port. Seller does not provide marine insurance.',
    included: [
      'PROCUREMENT',
      'PACKAGING',
      'INLAND_TRANSPORT',
      'CHA',
      'CUSTOMS',
      'PORT',
      'FREIGHT',
    ],
    excluded: ['INSURANCE'],
    conditional: SELLER_OWN,
    required: ['PROCUREMENT', 'FREIGHT'],
  },
  CIF: {
    incoterm: 'CIF',
    label: 'Cost, Insurance and Freight',
    explanation:
      'CFR plus cargo insurance to the named destination port. Destination import duties and taxes are not included.',
    included: [
      'PROCUREMENT',
      'PACKAGING',
      'INLAND_TRANSPORT',
      'CHA',
      'CUSTOMS',
      'PORT',
      'FREIGHT',
      'INSURANCE',
    ],
    excluded: [],
    conditional: SELLER_OWN,
    required: ['PROCUREMENT', 'FREIGHT', 'INSURANCE'],
  },
};

export const INCOTERM_DISCLAIMER =
  'Cost allocation is an operational pricing aid. Contractual responsibilities depend on the named place and agreed Incoterms® terms.';

/** Whether a line of `category` contributes under `incoterm`, honouring an explicit override for conditional categories only. */
export function lineIncluded(
  incoterm: Incoterm,
  category: CostCategory,
  override: boolean | null,
): { included: boolean; reason: string } {
  const p = INCOTERM_POLICIES[incoterm];
  if (p.included.includes(category))
    return { included: true, reason: `Included in ${incoterm}` };
  if (p.excluded.includes(category))
    return {
      included: false,
      reason: `Not part of ${incoterm} (buyer’s cost)`,
    };
  const c = p.conditional.find((x) => x.category === category);
  if (c) {
    if (override !== null)
      return {
        included: override,
        reason: override
          ? 'Included (set on this line)'
          : 'Excluded (set on this line)',
      };
    return {
      included: c.defaultIncluded,
      reason: c.defaultIncluded
        ? `Seller cost — included by default in ${incoterm}`
        : `Excluded by default in ${incoterm}`,
    };
  }
  return { included: false, reason: `Not part of ${incoterm}` };
}
