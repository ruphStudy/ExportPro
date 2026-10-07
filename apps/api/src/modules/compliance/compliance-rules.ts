import type {
  Applicability,
  ComplianceJurisdiction,
  ComplianceSeverity,
  ComplianceSourceType,
  CoverageLevel,
  CoverageView,
  RequirementBasis,
  RequirementLevel,
  RequirementType,
  ResponsibleParty,
  TradeDocumentType,
} from '@exportpro/types';

/**
 * Platform compliance rule set (deterministic, versioned in code).
 *
 * Every rule carries its source. Wording is deliberately conservative:
 * a rule is REQUIRED only when an official/regulator source supports it;
 * importing-country items are kept separate (DESTINATION_IMPORT) and the
 * rule set never claims to be a complete statement of any country's law.
 * Nothing here is AI-derived. Changing a rule = bump `version`; existing
 * checklists keep the version + snapshot they were evaluated with.
 */

export type SatisfiedBy =
  | {
      kind: 'registration';
      type: 'IEC' | 'GST' | 'FSSAI' | 'APEDA';
      acceptNotApplicable?: boolean;
    }
  | { kind: 'certification'; types: string[]; names: string[] }
  | { kind: 'documents' }
  | { kind: 'manual' };

export interface RuleDef {
  code: string;
  version: number;
  name: string;
  description: string;
  requirementType: RequirementType;
  level: RequirementLevel;
  severity: ComplianceSeverity;
  basis: RequirementBasis;
  jurisdiction: ComplianceJurisdiction;
  countryCode: string | null;
  hsPrefixes: string[];
  productCategory: string | null;
  condition: { incoterms?: string[]; shipmentModes?: string[] } | null;
  satisfiedBy: SatisfiedBy;
  documentTypes: TradeDocumentType[];
  responsibleParty: ResponsibleParty;
  sourceType: ComplianceSourceType;
  sourceName: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  lastCheckedAt: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

/** Date this platform rule set was last reviewed against its sources. */
const REVIEWED = '2026-10-07';
const FOOD_CHAPTERS = [
  '02',
  '03',
  '04',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
];
const PLANT_CHAPTERS = ['06', '07', '08', '09', '10', '11', '12', '13', '14'];
const SPICES = ['0904', '0905', '0906', '0907', '0908', '0909', '0910'];

export const PLATFORM_RULES: RuleDef[] = [
  {
    code: 'IN.IEC',
    version: 1,
    name: 'Importer-Exporter Code (IEC)',
    description:
      'An IEC issued by DGFT is required to export goods from India (limited statutory exemptions exist).',
    requirementType: 'REGISTRATION',
    level: 'REQUIRED',
    severity: 'BLOCKER',
    basis: 'REGULATORY_REQUIRED',
    jurisdiction: 'INDIA_EXPORT',
    countryCode: null,
    hsPrefixes: [],
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'registration', type: 'IEC' },
    documentTypes: ['REGISTRATION_CERTIFICATE'],
    responsibleParty: 'EXPORTER',
    sourceType: 'OFFICIAL_GOVERNMENT',
    sourceName:
      'DGFT — Importer Exporter Code (Foreign Trade (Development & Regulation) Act, 1992)',
    sourceUrl: 'https://www.dgft.gov.in',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'HIGH',
  },
  {
    code: 'IN.GST',
    version: 1,
    name: 'GST registration / LUT for zero-rated exports',
    description:
      'GST-registered exporters ship under LUT or with IGST paid. Registration depends on your business; confirm whether it applies to you.',
    requirementType: 'REGISTRATION',
    level: 'CONDITIONAL',
    severity: 'WARNING',
    basis: 'REGULATORY_REQUIRED',
    jurisdiction: 'INDIA_EXPORT',
    countryCode: null,
    hsPrefixes: [],
    productCategory: null,
    condition: null,
    satisfiedBy: {
      kind: 'registration',
      type: 'GST',
      acceptNotApplicable: true,
    },
    documentTypes: ['REGISTRATION_CERTIFICATE'],
    responsibleParty: 'EXPORTER',
    sourceType: 'GOVERNMENT_PORTAL',
    sourceName: 'GST portal — registration and Letter of Undertaking (LUT)',
    sourceUrl: 'https://www.gst.gov.in',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'MEDIUM',
  },
  {
    code: 'IN.FSSAI',
    version: 1,
    name: 'FSSAI Central licence (food exporters)',
    description:
      'Food business operators exporting food products need an FSSAI Central licence.',
    requirementType: 'LICENSE',
    level: 'REQUIRED',
    severity: 'BLOCKER',
    basis: 'REGULATORY_REQUIRED',
    jurisdiction: 'INDIA_EXPORT',
    countryCode: null,
    hsPrefixes: FOOD_CHAPTERS,
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'registration', type: 'FSSAI' },
    documentTypes: ['REGISTRATION_CERTIFICATE'],
    responsibleParty: 'EXPORTER',
    sourceType: 'REGULATOR',
    sourceName:
      'FSSAI — Food Safety and Standards (Licensing and Registration of Food Businesses) Regulations, 2011',
    sourceUrl: 'https://foscos.fssai.gov.in',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'HIGH',
  },
  {
    code: 'IN.SPICES.CRES',
    version: 1,
    name: 'Spices Board registration (CRES)',
    description:
      'Exporters of spices need a Certificate of Registration as Exporter of Spices (CRES) from the Spices Board.',
    requirementType: 'REGISTRATION',
    level: 'REQUIRED',
    severity: 'BLOCKER',
    basis: 'REGULATORY_REQUIRED',
    jurisdiction: 'INDIA_EXPORT',
    countryCode: null,
    hsPrefixes: SPICES,
    productCategory: null,
    condition: null,
    satisfiedBy: {
      kind: 'certification',
      types: ['SPICES_BOARD_CRES', 'CRES'],
      names: ['spices board', 'cres'],
    },
    documentTypes: ['REGISTRATION_CERTIFICATE'],
    responsibleParty: 'EXPORTER',
    sourceType: 'REGULATOR',
    sourceName: 'Spices Board India — CRES (Spices Board Act, 1986)',
    sourceUrl: 'https://www.indianspices.com',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'HIGH',
  },
  {
    code: 'IN.APEDA.RCMC',
    version: 1,
    name: 'APEDA registration (RCMC) — scheduled products',
    description:
      'Required for exporters of APEDA scheduled products. Confirm your product is on the APEDA schedule.',
    requirementType: 'REGISTRATION',
    level: 'CONDITIONAL',
    severity: 'WARNING',
    basis: 'REGULATORY_REQUIRED',
    jurisdiction: 'INDIA_EXPORT',
    countryCode: null,
    hsPrefixes: ['07', '08', '10', '11', '19', '20'],
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'registration', type: 'APEDA' },
    documentTypes: ['REGISTRATION_CERTIFICATE'],
    responsibleParty: 'EXPORTER',
    sourceType: 'REGULATOR',
    sourceName: 'APEDA — Registration-cum-Membership Certificate',
    sourceUrl: 'https://apeda.gov.in',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'MEDIUM',
  },
  {
    code: 'TX.COMMERCIAL_INVOICE',
    version: 1,
    name: 'Commercial invoice',
    description:
      'A commercial invoice is needed for export clearance (shipping bill filing).',
    requirementType: 'DOCUMENT',
    level: 'REQUIRED',
    severity: 'BLOCKER',
    basis: 'REGULATORY_REQUIRED',
    jurisdiction: 'TRANSACTION',
    countryCode: null,
    hsPrefixes: [],
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'documents' },
    documentTypes: ['COMMERCIAL_INVOICE'],
    responsibleParty: 'EXPORTER',
    sourceType: 'GOVERNMENT_PORTAL',
    sourceName: 'CBIC / ICEGATE — documents for export clearance',
    sourceUrl: 'https://www.icegate.gov.in',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'HIGH',
  },
  {
    code: 'TX.PACKING_LIST',
    version: 1,
    name: 'Packing list',
    description:
      'A packing list is needed for export clearance and cargo handling.',
    requirementType: 'DOCUMENT',
    level: 'REQUIRED',
    severity: 'BLOCKER',
    basis: 'REGULATORY_REQUIRED',
    jurisdiction: 'TRANSACTION',
    countryCode: null,
    hsPrefixes: [],
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'documents' },
    documentTypes: ['PACKING_LIST'],
    responsibleParty: 'EXPORTER',
    sourceType: 'GOVERNMENT_PORTAL',
    sourceName: 'CBIC / ICEGATE — documents for export clearance',
    sourceUrl: 'https://www.icegate.gov.in',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'HIGH',
  },
  {
    code: 'TX.SHIPPING_INSTRUCTION',
    version: 1,
    name: 'Shipping instruction to forwarder/carrier',
    description:
      'Recommended practice: give your forwarder written shipping instructions (consignee, ports, cargo, marks).',
    requirementType: 'DOCUMENT',
    level: 'RECOMMENDED',
    severity: 'INFO',
    basis: 'ADVISORY',
    jurisdiction: 'TRANSACTION',
    countryCode: null,
    hsPrefixes: [],
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'documents' },
    documentTypes: ['SHIPPING_INSTRUCTION'],
    responsibleParty: 'EXPORTER',
    sourceType: 'INTERNAL_RULE',
    sourceName: 'ExportPro operating practice',
    sourceUrl: null,
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'HIGH',
  },
  {
    code: 'DEST.PHYTO',
    version: 1,
    name: 'Phytosanitary certificate (plant products)',
    description:
      'Importing countries commonly require a phytosanitary certificate for plant products. It is issued by India’s Plant Quarantine Organisation — confirm the destination’s import conditions.',
    requirementType: 'CERTIFICATION',
    level: 'CONDITIONAL',
    severity: 'WARNING',
    basis: 'ADVISORY',
    jurisdiction: 'DESTINATION_IMPORT',
    countryCode: null,
    hsPrefixes: PLANT_CHAPTERS,
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'documents' },
    documentTypes: ['PHYTOSANITARY_CERTIFICATE'],
    responsibleParty: 'GOVERNMENT',
    sourceType: 'REGULATOR',
    sourceName:
      'Plant Quarantine Organisation of India (NPPO) — export phytosanitary certification',
    sourceUrl: 'https://pqms.cgg.gov.in',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'MEDIUM',
  },
  {
    code: 'AE.PHYTO',
    version: 1,
    name: 'UAE: phytosanitary certificate for plant products',
    description:
      'The UAE requires a phytosanitary certificate from the exporting country for imports of plants and plant products.',
    requirementType: 'DESTINATION_REQUIREMENT',
    level: 'REQUIRED',
    severity: 'BLOCKER',
    basis: 'REGULATORY_REQUIRED',
    jurisdiction: 'DESTINATION_IMPORT',
    countryCode: 'AE',
    hsPrefixes: PLANT_CHAPTERS,
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'documents' },
    documentTypes: ['PHYTOSANITARY_CERTIFICATE'],
    responsibleParty: 'GOVERNMENT',
    sourceType: 'OFFICIAL_GOVERNMENT',
    sourceName:
      'UAE Ministry of Climate Change and Environment — plant import requirements',
    sourceUrl: 'https://www.moccae.gov.ae',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'MEDIUM',
  },
  {
    code: 'AE.COO.CEPA',
    version: 1,
    name: 'UAE: preferential Certificate of Origin (CEPA)',
    description:
      'A preferential Certificate of Origin lets the buyer claim India–UAE CEPA duty benefits. Issued by an authorised agency, not by ExportPro.',
    requirementType: 'CERTIFICATION',
    level: 'RECOMMENDED',
    severity: 'INFO',
    basis: 'ADVISORY',
    jurisdiction: 'DESTINATION_IMPORT',
    countryCode: 'AE',
    hsPrefixes: [],
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'documents' },
    documentTypes: ['CERTIFICATE_OF_ORIGIN'],
    responsibleParty: 'GOVERNMENT',
    sourceType: 'GOVERNMENT_PORTAL',
    sourceName: 'DGFT — Certificate of Origin portal',
    sourceUrl: 'https://coo.dgft.gov.in',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'MEDIUM',
  },
  {
    code: 'TX.INSURANCE.CIF',
    version: 1,
    name: 'Cargo insurance certificate (CIF/CIP)',
    description:
      'Under CIF/CIP the seller contracts cargo insurance (contractual Incoterms® obligation, not a statute).',
    requirementType: 'DOCUMENT',
    level: 'CONDITIONAL',
    severity: 'WARNING',
    basis: 'ADVISORY',
    jurisdiction: 'TRANSACTION',
    countryCode: null,
    hsPrefixes: [],
    productCategory: null,
    condition: { incoterms: ['CIF', 'CIP'] },
    satisfiedBy: { kind: 'documents' },
    documentTypes: ['INSURANCE_CERTIFICATE'],
    responsibleParty: 'EXPORTER',
    sourceType: 'INTERNAL_RULE',
    sourceName: 'Incoterms® 2020 — CIF/CIP insurance obligation',
    sourceUrl: null,
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'HIGH',
  },
  {
    code: 'TX.FUMIGATION',
    version: 1,
    name: 'Wood packaging (ISPM 15) / fumigation',
    description:
      'Wooden packaging must meet ISPM 15; a fumigation certificate may be requested by the buyer or destination.',
    requirementType: 'PACKAGING',
    level: 'RECOMMENDED',
    severity: 'INFO',
    basis: 'ADVISORY',
    jurisdiction: 'TRANSACTION',
    countryCode: null,
    hsPrefixes: [],
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'documents' },
    documentTypes: ['FUMIGATION_CERTIFICATE'],
    responsibleParty: 'INSPECTION_AGENCY',
    sourceType: 'INTERNAL_RULE',
    sourceName: 'IPPC ISPM 15 (regulation of wood packaging material)',
    sourceUrl: 'https://www.ippc.int',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'MEDIUM',
  },
  {
    code: 'TX.SHIPPING_BILL',
    version: 1,
    name: 'Shipping bill (customs)',
    description:
      'Filed on ICEGATE by you or your customs broker at shipment stage. Track or upload the reference — ExportPro does not file customs declarations.',
    requirementType: 'CUSTOMS',
    level: 'INFORMATIONAL',
    severity: 'INFO',
    basis: 'REGULATORY_REQUIRED',
    jurisdiction: 'TRANSACTION',
    countryCode: null,
    hsPrefixes: [],
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'documents' },
    documentTypes: ['SHIPPING_BILL'],
    responsibleParty: 'CUSTOMS_BROKER',
    sourceType: 'GOVERNMENT_PORTAL',
    sourceName: 'CBIC / ICEGATE',
    sourceUrl: 'https://www.icegate.gov.in',
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'HIGH',
  },
  {
    code: 'TX.TRANSPORT_DOC',
    version: 1,
    name: 'Bill of lading / airway bill',
    description:
      'Issued by the carrier after loading. Upload or reference it — ExportPro never generates transport documents.',
    requirementType: 'DOCUMENT',
    level: 'INFORMATIONAL',
    severity: 'INFO',
    basis: 'ADVISORY',
    jurisdiction: 'TRANSACTION',
    countryCode: null,
    hsPrefixes: [],
    productCategory: null,
    condition: null,
    satisfiedBy: { kind: 'documents' },
    documentTypes: ['BILL_OF_LADING', 'AIRWAY_BILL'],
    responsibleParty: 'CARRIER',
    sourceType: 'INTERNAL_RULE',
    sourceName: 'ExportPro operating practice',
    sourceUrl: null,
    sourceDate: null,
    lastCheckedAt: REVIEWED,
    confidence: 'HIGH',
  },
];

/** HS prefixes for which India-side product rules are curated in this rule set. */
export const INDIA_CURATED_HS_PREFIXES = SPICES;
/** Destinations with a curated (never exhaustive) import-requirement set. */
export const DESTINATIONS_WITH_RULES = ['AE'];
/** Rule sources older than this are flagged for reconfirmation. */
export const RULE_FRESHNESS_DAYS = 365;

export interface EvalProduct {
  productId: string | null;
  description: string;
  hsCode: string | null;
}

export interface EvalContext {
  destinationCountry: string | null;
  incoterm: string | null;
  shipmentMode: string | null;
  products: EvalProduct[];
}

export interface RuleLike {
  code: string;
  name: string;
  jurisdiction: string;
  countryCode: string | null;
  hsPrefixes: string[];
  conditionJson: unknown;
}

const digits = (hs: string | null) => (hs ?? '').replace(/\D/g, '');

/**
 * Deterministic applicability. UNKNOWN when the data needed to decide is
 * missing (never silently "not applicable"). Returns the products that
 * triggered the rule and a human explanation.
 */
export function applicability(
  rule: RuleLike,
  ctx: EvalContext,
): {
  applicability: Applicability;
  explanation: string;
  productLabel: string | null;
} {
  const reasons: string[] = [];
  let unknown: string | null = null;
  let productLabel: string | null = null;
  if (rule.countryCode) {
    if (!ctx.destinationCountry)
      unknown = 'Destination country is not known yet';
    else if (ctx.destinationCountry !== rule.countryCode)
      return {
        applicability: 'NOT_APPLICABLE',
        explanation: `Applies only to shipments to ${rule.countryCode}.`,
        productLabel: null,
      };
    else reasons.push(`the destination is ${rule.countryCode}`);
  }
  if (rule.hsPrefixes.length) {
    const matched = ctx.products.filter(
      (p) =>
        digits(p.hsCode) &&
        rule.hsPrefixes.some((x) => digits(p.hsCode).startsWith(x)),
    );
    const missing = ctx.products.filter((p) => !digits(p.hsCode));
    if (matched.length) {
      productLabel = matched.map((p) => p.description).join(', ');
      reasons.push(
        `HS ${matched.map((p) => `${digits(p.hsCode).slice(0, 4)} (${p.description})`).join(', ')} is being exported`,
      );
    } else if (missing.length)
      unknown =
        unknown ??
        `HS code missing for ${missing.map((p) => p.description).join(', ')}`;
    else
      return {
        applicability: 'NOT_APPLICABLE',
        explanation: `Applies to HS ${rule.hsPrefixes.join(', ')}; this order’s products are outside that scope.`,
        productLabel: null,
      };
  }
  const cond = (rule.conditionJson ?? {}) as {
    incoterms?: string[];
    shipmentModes?: string[];
  };
  if (cond.incoterms?.length) {
    if (!ctx.incoterm) unknown = unknown ?? 'Incoterm is not known yet';
    else if (!cond.incoterms.includes(ctx.incoterm))
      return {
        applicability: 'NOT_APPLICABLE',
        explanation: `Applies only under ${cond.incoterms.join('/')}; this order is ${ctx.incoterm}.`,
        productLabel: null,
      };
    else reasons.push(`the Incoterm is ${ctx.incoterm}`);
  }
  if (cond.shipmentModes?.length) {
    if (!ctx.shipmentMode)
      unknown = unknown ?? 'Shipment mode is not known yet';
    else if (!cond.shipmentModes.includes(ctx.shipmentMode))
      return {
        applicability: 'NOT_APPLICABLE',
        explanation: `Applies only to ${cond.shipmentModes.join('/')} shipments.`,
        productLabel: null,
      };
    else reasons.push(`the shipment mode is ${ctx.shipmentMode}`);
  }
  if (unknown)
    return {
      applicability: 'UNKNOWN',
      explanation: `${unknown} — cannot confirm whether this applies. Treat as needing confirmation.`,
      productLabel,
    };
  const base =
    rule.jurisdiction === 'INDIA_EXPORT'
      ? 'Applies to exports from India'
      : rule.jurisdiction === 'DESTINATION_IMPORT'
        ? 'Destination import condition'
        : 'Applies to this export transaction';
  return {
    applicability: 'APPLICABLE',
    explanation: reasons.length
      ? `${base} because ${reasons.join(' and ')}.`
      : `${base}.`,
    productLabel,
  };
}

/** Coverage is separate from readiness. Destination import law is never reported as COMPLETE. */
export function coverage(ctx: EvalContext): CoverageView {
  const notes: string[] = [];
  let indiaExport: CoverageLevel;
  const hs = ctx.products.map((p) => digits(p.hsCode));
  if (!ctx.products.length || hs.some((h) => !h)) {
    indiaExport = 'UNKNOWN';
    notes.push(
      'Some products have no HS code — product-specific India export rules could not be evaluated.',
    );
  } else if (
    hs.every((h) => INDIA_CURATED_HS_PREFIXES.some((x) => h.startsWith(x)))
  )
    indiaExport = 'COMPLETE';
  else {
    indiaExport = 'PARTIAL';
    notes.push(
      'Only general India export rules apply to some products; product-specific rules (e.g. commodity boards) are not curated for them.',
    );
  }
  let destinationImport: CoverageLevel;
  if (!ctx.destinationCountry) {
    destinationImport = 'UNKNOWN';
    notes.push(
      'Destination country unknown — destination import requirements were not evaluated.',
    );
  } else if (DESTINATIONS_WITH_RULES.includes(ctx.destinationCountry)) {
    destinationImport = 'PARTIAL';
    notes.push(
      `Destination rules for ${ctx.destinationCountry} are a curated subset, not a complete statement of import law. Confirm with the buyer/importer.`,
    );
  } else {
    destinationImport = 'UNKNOWN';
    notes.push(
      `No destination rules are configured for ${ctx.destinationCountry}. Compliance coverage incomplete — confirm import requirements with the buyer/importer.`,
    );
  }
  const rank = { UNKNOWN: 0, PARTIAL: 1, COMPLETE: 2 } as const;
  const overall =
    rank[indiaExport] <= rank[destinationImport]
      ? indiaExport
      : destinationImport;
  return { overall, indiaExport, destinationImport, notes };
}

export const isStale = (
  lastCheckedAt: Date | string | null,
  now = new Date(),
) =>
  !lastCheckedAt ||
  now.getTime() - new Date(lastCheckedAt).getTime() >
    RULE_FRESHNESS_DAYS * 86400000;

/** Maps a buyer-requested certificate/document name (Sprint 13 RFQ) to evidence types. Buyer requests are never statutory. */
export function buyerRequestMapping(name: string): {
  documentTypes: TradeDocumentType[];
  satisfiedBy: SatisfiedBy;
} {
  const n = name.toLowerCase();
  const docs = (
    t: TradeDocumentType[],
  ): { documentTypes: TradeDocumentType[]; satisfiedBy: SatisfiedBy } => ({
    documentTypes: t,
    satisfiedBy: { kind: 'documents' },
  });
  if (/phyto/.test(n)) return docs(['PHYTOSANITARY_CERTIFICATE']);
  if (/origin|\bcoo\b/.test(n)) return docs(['CERTIFICATE_OF_ORIGIN']);
  if (/fumigat/.test(n)) return docs(['FUMIGATION_CERTIFICATE']);
  if (/insurance/.test(n)) return docs(['INSURANCE_CERTIFICATE']);
  if (/inspection|sgs|bureau veritas|intertek/.test(n))
    return docs(['INSPECTION_CERTIFICATE']);
  if (/analysis|test|lab|\bcoa\b/.test(n)) return docs(['TEST_CERTIFICATE']);
  if (/fssai/.test(n))
    return {
      documentTypes: ['REGISTRATION_CERTIFICATE'],
      satisfiedBy: { kind: 'registration', type: 'FSSAI' },
    };
  return {
    documentTypes: ['OTHER', 'TEST_CERTIFICATE', 'INSPECTION_CERTIFICATE'],
    satisfiedBy: {
      kind: 'certification',
      types: [name.toUpperCase()],
      names: [n],
    },
  };
}
