import { CodeSystem } from '@exportpro/types';

/**
 * Limited DEVELOPMENT_SAMPLE tariff reference — enough to exercise code
 * validation, lookup and manual search for the Sprint 5 sample products.
 * It is NOT a complete or verified HS / ITC-HS schedule; descriptions are
 * paraphrased. An official dataset import writes the same `tariff_codes`
 * table with sourceType OFFICIAL (see prisma/seed-tariff-codes.ts).
 */
export const DEVELOPMENT_TARIFF_SOURCE_NAME =
  'ExportPro development sample (not an official tariff schedule)';

export interface DevTariffCode {
  codeSystem: CodeSystem;
  code: string;
  description: string;
}

const HS: [string, string][] = [
  [
    '04',
    'Dairy produce; birds’ eggs; natural honey; edible products of animal origin n.e.s.',
  ],
  ['0409', 'Natural honey'],
  ['040900', 'Natural honey'],
  ['08', 'Edible fruit and nuts; peel of citrus fruit or melons'],
  [
    '0804',
    'Dates, figs, pineapples, avocados, guavas, mangoes and mangosteens, fresh or dried',
  ],
  ['080450', 'Guavas, mangoes and mangosteens'],
  ['09', 'Coffee, tea, maté and spices'],
  [
    '0904',
    'Pepper of the genus Piper; dried, crushed or ground fruits of the genus Capsicum or Pimenta',
  ],
  ['090411', 'Pepper (Piper), neither crushed nor ground'],
  ['090412', 'Pepper (Piper), crushed or ground'],
  [
    '0909',
    'Seeds of anise, badian, fennel, coriander, cumin or caraway; juniper berries',
  ],
  ['090921', 'Seeds of coriander, neither crushed nor ground'],
  ['090922', 'Seeds of coriander, crushed or ground'],
  ['090931', 'Seeds of cumin, neither crushed nor ground'],
  ['090932', 'Seeds of cumin, crushed or ground'],
  [
    '0910',
    'Ginger, saffron, turmeric (curcuma), thyme, bay leaves, curry and other spices',
  ],
  ['091030', 'Turmeric (curcuma)'],
  ['10', 'Cereals'],
  ['1006', 'Rice'],
  [
    '100630',
    'Semi-milled or wholly milled rice, whether or not polished or glazed',
  ],
  [
    '14',
    'Vegetable plaiting materials; vegetable products not elsewhere specified',
  ],
  ['1404', 'Vegetable products not elsewhere specified or included'],
  ['140490', 'Vegetable products n.e.s. — other'],
  [
    '19',
    'Preparations of cereals, flour, starch or milk; pastrycooks’ products',
  ],
  ['1905', 'Bread, pastry, cakes, biscuits and other bakers’ wares'],
  ['190590', 'Bakers’ wares — other'],
  ['21', 'Miscellaneous edible preparations'],
  ['2106', 'Food preparations not elsewhere specified or included'],
  ['210690', 'Food preparations n.e.s. — other'],
  ['30', 'Pharmaceutical products'],
  [
    '3004',
    'Medicaments (mixed or unmixed) put up in measured doses or for retail sale',
  ],
  ['300490', 'Medicaments for retail sale — other'],
  [
    '33',
    'Essential oils and resinoids; perfumery, cosmetic or toilet preparations',
  ],
  [
    '3304',
    'Beauty or make-up preparations and preparations for the care of the skin',
  ],
  ['330499', 'Beauty or skin-care preparations — other (e.g. creams, lotions)'],
  ['39', 'Plastics and articles thereof'],
  [
    '3920',
    'Other plates, sheets, film, foil and strip, of plastics, non-cellular, not reinforced',
  ],
  ['392010', 'Plates, sheets, film of polymers of ethylene'],
  [
    '3923',
    'Articles for the conveyance or packing of goods, of plastics; stoppers, lids, caps',
  ],
  ['392310', 'Boxes, cases, crates and similar articles, of plastics'],
  ['392330', 'Carboys, bottles, flasks and similar articles, of plastics'],
  [
    '392390',
    'Articles for conveyance or packing of goods, of plastics — other',
  ],
  [
    '3924',
    'Tableware, kitchenware, other household articles and toilet articles, of plastics',
  ],
  ['392410', 'Tableware and kitchenware, of plastics'],
  ['392490', 'Household and toilet articles, of plastics — other'],
  ['42', 'Articles of leather; handbags and similar containers'],
  ['4202', 'Trunks, suitcases, handbags, wallets and similar containers'],
  ['420221', 'Handbags with outer surface of leather or composition leather'],
  ['44', 'Wood and articles of wood; wood charcoal'],
  [
    '4420',
    'Wood marquetry; caskets and cases; statuettes and other ornaments, of wood',
  ],
  [
    '442019',
    'Statuettes and other ornaments of wood — other than tropical wood',
  ],
  [
    '46',
    'Manufactures of straw, of esparto or of other plaiting materials; basketware',
  ],
  [
    '4602',
    'Basketwork, wickerwork and other articles made directly to shape from plaiting materials',
  ],
  ['460219', 'Articles of vegetable plaiting materials — other'],
  [
    '48',
    'Paper and paperboard; articles of paper pulp, of paper or of paperboard',
  ],
  [
    '4819',
    'Cartons, boxes, cases, bags and other packing containers, of paper or paperboard',
  ],
  ['481910', 'Cartons, boxes and cases, of corrugated paper or paperboard'],
  [
    '4823',
    'Other paper, paperboard, cellulose wadding; other articles of paper pulp or paper',
  ],
  [
    '482369',
    'Trays, dishes, plates, cups and the like, of paper or paperboard — other',
  ],
  ['52', 'Cotton'],
  [
    '5205',
    'Cotton yarn (other than sewing thread), ≥85% cotton, not put up for retail sale',
  ],
  ['61', 'Articles of apparel and clothing accessories, knitted or crocheted'],
  ['6109', 'T-shirts, singlets and other vests, knitted or crocheted'],
  [
    '610910',
    'T-shirts, singlets and other vests, knitted or crocheted, of cotton',
  ],
  [
    '610990',
    'T-shirts, singlets and other vests, knitted or crocheted, of other textile materials',
  ],
  [
    '62',
    'Articles of apparel and clothing accessories, not knitted or crocheted',
  ],
  ['6205', 'Men’s or boys’ shirts, not knitted or crocheted'],
  ['620520', 'Men’s or boys’ shirts, not knitted, of cotton'],
  ['71', 'Pearls, precious stones, precious metals; jewellery'],
  ['7113', 'Articles of jewellery and parts thereof, of precious metal'],
  ['711311', 'Articles of jewellery of silver'],
  ['73', 'Articles of iron or steel'],
  ['7323', 'Table, kitchen or other household articles, of iron or steel'],
  ['732393', 'Table, kitchen or other household articles, of stainless steel'],
  ['82', 'Tools, implements, cutlery, spoons and forks, of base metal'],
  [
    '8215',
    'Spoons, forks, ladles, skimmers, cake-servers and similar kitchen or tableware',
  ],
  [
    '821599',
    'Spoons, forks, ladles and similar tableware — other (not plated)',
  ],
  ['84', 'Nuclear reactors, boilers, machinery and mechanical appliances'],
  [
    '8487',
    'Machinery parts not containing electrical connectors or other electrical features',
  ],
  ['848790', 'Machinery parts, non-electrical — other'],
  ['85', 'Electrical machinery and equipment and parts thereof'],
  [
    '8504',
    'Electrical transformers, static converters (e.g. rectifiers) and inductors',
  ],
  [
    '850440',
    'Static converters (e.g. power supplies, LED drivers, rectifiers)',
  ],
  ['8541', 'Semiconductor devices; light-emitting diodes (LED)'],
  ['854141', 'Light-emitting diodes (LED)'],
  ['87', 'Vehicles other than railway or tramway rolling stock, and parts'],
  ['8708', 'Parts and accessories of motor vehicles'],
  ['870899', 'Parts and accessories of motor vehicles — other'],
  ['94', 'Furniture; bedding; luminaires and lighting fittings'],
  ['9403', 'Other furniture and parts thereof'],
  ['940360', 'Other wooden furniture'],
  ['9405', 'Luminaires and lighting fittings; illuminated signs'],
  ['940599', 'Parts of luminaires and lighting fittings — other'],
];

/** Small set of India 8-digit lines for the sample products only. */
const ITC: [string, string][] = [
  ['04090000', 'Natural honey'],
  ['10063020', 'Basmati rice'],
  ['14049090', 'Vegetable products n.e.s. — others'],
  ['33049990', 'Beauty or skin-care preparations — others'],
  [
    '39239090',
    'Articles for conveyance or packing of goods, of plastics — others',
  ],
  [
    '61091000',
    'T-shirts, singlets and other vests, knitted or crocheted, of cotton',
  ],
  ['85044090', 'Static converters — others'],
];

export const DEVELOPMENT_TARIFF_CODES: DevTariffCode[] = [
  ...HS.map(([code, description]) => ({
    codeSystem: 'HS' as const,
    code,
    description,
  })),
  ...ITC.map(([code, description]) => ({
    codeSystem: 'ITC_HS_INDIA' as const,
    code,
    description,
  })),
];

export function parentCodeOf(code: string): string | null {
  if (code.length === 8) return code.slice(0, 6);
  if (code.length === 6) return code.slice(0, 4);
  if (code.length === 4) return code.slice(0, 2);
  return null;
}
