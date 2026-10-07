import type {
  DocumentValidationFindingType,
  NormalizedDocumentView,
  ValidationSeverity,
} from '@exportpro/types';
import { QUANTITY_CRITICAL_PERCENT } from '../commercial/commercial-math';
import { D } from '../costing/costing-calculator';
import {
  addressCountry,
  docRefKey,
  keyWords,
  massFactor,
  textKey,
} from './normalize';

/**
 * Deterministic cross-document validation (document-validation-v1). AI is never
 * consulted here. Reuses the Sprint 14 decimal policy and the Sprint 15 quantity
 * severity threshold. Each finding names source/reference documents, fields and rule.
 */

export type View = NormalizedDocumentView;
export interface EngineFinding {
  type: DocumentValidationFindingType;
  severity: ValidationSeverity;
  field: string;
  itemReference: string | null;
  sourceDocumentId: string | null;
  sourceLabel: string;
  referenceDocumentId: string | null;
  referenceLabel: string | null;
  sourceField: string | null;
  referenceField: string | null;
  rule: string;
  expectedValue: string | null;
  actualValue: string | null;
  normalizedExpected: string | null;
  normalizedActual: string | null;
  message: string;
}
export interface EngineContext {
  tolerance: { quantityPercent: string; pricePercent: string };
  /** ISO date used for expiry checks (passed in so runs are reproducible). */
  today: string;
  expiryWarningDays: number;
}

/** Which documents a document kind is compared against (first available unless "all"). */
export const REFERENCES: Record<string, { kinds: string[]; all?: boolean }> = {
  PO_DOC: { kinds: ['PO', 'PI'], all: true },
  PI_DOC: { kinds: ['PO'] },
  CI: { kinds: ['PO', 'PI'] },
  SB: { kinds: ['CI'] },
  PL: { kinds: ['CI', 'PO'] },
  SI: { kinds: ['PL', 'CI'] },
  BL: { kinds: ['PL', 'SI'], all: true },
  AWB: { kinds: ['PL', 'SI'], all: true },
  CERT: { kinds: ['CI', 'PO'] },
  OTHER: { kinds: ['CI', 'PO'] },
};
const COMMERCIAL = new Set(['PO', 'PI', 'CI', 'PO_DOC', 'PI_DOC', 'SB']);
const ITEM_LEVEL = new Set(['PO', 'PI', 'CI', 'PO_DOC', 'PI_DOC', 'SB', 'PL']);
const LOGISTICS = new Set(['PL', 'SI', 'BL', 'AWB']);

const fmtN = (v: string | null) =>
  v === null
    ? '—'
    : v.replace(
        /^(-?\d+)(\.\d+)?$/,
        (_, i: string, d = '') => i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + d,
      );
const pct = (a: string, b: string) => {
  const x = new D(a);
  const y = new D(b);
  return y.isZero()
    ? x.isZero()
      ? new D(0)
      : new D(100)
    : x.minus(y).abs().div(y).mul(100);
};

export function compareDocuments(
  src: View,
  ref: View,
  ctx: EngineContext,
): EngineFinding[] {
  const out: EngineFinding[] = [];
  const add = (
    f: Omit<
      EngineFinding,
      | 'sourceDocumentId'
      | 'sourceLabel'
      | 'referenceDocumentId'
      | 'referenceLabel'
    >,
  ) =>
    out.push({
      ...f,
      sourceDocumentId: src.documentId,
      sourceLabel: src.label,
      referenceDocumentId: ref.documentId,
      referenceLabel: ref.label,
    });
  const S = src.fields;
  const R = ref.fields;
  const commercial = COMMERCIAL.has(src.kind) && COMMERCIAL.has(ref.kind);
  const logistic = LOGISTICS.has(src.kind) || src.kind === 'CERT';

  // Buyer / consignee — linked entity first, then names (formatting-normalized only).
  const sParty = logistic ? (S.consigneeName ?? S.buyerName) : S.buyerName;
  const rParty = logistic ? (R.consigneeName ?? R.buyerName) : R.buyerName;
  const pField = logistic && S.consigneeName ? 'consigneeName' : 'buyerName';
  if (
    src.buyerCompanyId &&
    ref.buyerCompanyId &&
    src.buyerCompanyId !== ref.buyerCompanyId
  )
    add({
      type: 'BUYER_MISMATCH',
      severity: 'CRITICAL',
      field: 'buyer',
      itemReference: null,
      sourceField: 'buyerCompanyId',
      referenceField: 'buyerCompanyId',
      rule: 'buyer.entity',
      expectedValue: rParty ?? ref.buyerCompanyId,
      actualValue: sParty ?? src.buyerCompanyId,
      normalizedExpected: ref.buyerCompanyId,
      normalizedActual: src.buyerCompanyId,
      message: `${src.label} is linked to a different buyer than ${ref.label}.`,
    });
  else if (sParty && rParty && textKey(sParty) !== textKey(rParty))
    add({
      type: 'BUYER_MISMATCH',
      severity: 'WARNING',
      field: pField,
      itemReference: null,
      sourceField: pField,
      referenceField: 'buyerName',
      rule: 'buyer.name',
      expectedValue: rParty,
      actualValue: sParty,
      normalizedExpected: textKey(rParty),
      normalizedActual: textKey(sParty),
      message: `Buyer name “${sParty}” on ${src.label} differs from ${ref.label} (“${rParty}”). Review — the buyer is not reassigned automatically.`,
    });
  else if (!sParty && rParty && commercial)
    add({
      type: 'MISSING_FIELD',
      severity: 'INFO',
      field: 'buyerName',
      itemReference: null,
      sourceField: 'buyerName',
      referenceField: 'buyerName',
      rule: 'missing.buyer',
      expectedValue: rParty,
      actualValue: null,
      normalizedExpected: null,
      normalizedActual: null,
      message: `Buyer not stated on ${src.label} — not compared.`,
    });

  // Address — formatting differences are equal; different country is critical, other differences need review.
  const sAddr = logistic
    ? (S.consigneeAddress ?? S.buyerAddress)
    : S.buyerAddress;
  const rAddr = logistic
    ? (R.consigneeAddress ?? R.buyerAddress)
    : R.buyerAddress;
  if (sAddr && rAddr && textKey(sAddr) !== textKey(rAddr)) {
    const sc = addressCountry(sAddr) ?? S.buyerCountry ?? null;
    const rc = addressCountry(rAddr) ?? R.buyerCountry ?? null;
    const countryDiffers = Boolean(sc && rc && sc !== rc);
    add({
      type: 'ADDRESS_MISMATCH',
      severity: countryDiffers ? 'CRITICAL' : 'WARNING',
      field: 'address',
      itemReference: null,
      sourceField: logistic ? 'consigneeAddress' : 'buyerAddress',
      referenceField: 'buyerAddress',
      rule: countryDiffers ? 'address.country' : 'address.text',
      expectedValue: rAddr,
      actualValue: sAddr,
      normalizedExpected: textKey(rAddr),
      normalizedActual: textKey(sAddr),
      message: countryDiffers
        ? `Address country on ${src.label} (${sc}) differs from ${ref.label} (${rc}).`
        : `Address on ${src.label} differs from ${ref.label} beyond formatting.`,
    });
  }

  if (
    S.exporterName &&
    R.exporterName &&
    textKey(S.exporterName) !== textKey(R.exporterName)
  )
    add({
      type: 'EXPORTER_MISMATCH',
      severity: 'WARNING',
      field: 'exporterName',
      itemReference: null,
      sourceField: 'exporterName',
      referenceField: 'exporterName',
      rule: 'exporter.name',
      expectedValue: R.exporterName,
      actualValue: S.exporterName,
      normalizedExpected: textKey(R.exporterName),
      normalizedActual: textKey(S.exporterName),
      message: `Exporter/shipper “${S.exporterName}” on ${src.label} differs from ${ref.label} (“${R.exporterName}”).`,
    });

  if (commercial || (src.kind === 'CERT' && S.currency)) {
    if (S.currency && R.currency && S.currency !== R.currency)
      add({
        type: 'CURRENCY_MISMATCH',
        severity: 'CRITICAL',
        field: 'currency',
        itemReference: null,
        sourceField: 'currency',
        referenceField: 'currency',
        rule: 'currency.iso',
        expectedValue: R.currency,
        actualValue: S.currency,
        normalizedExpected: R.currency,
        normalizedActual: S.currency,
        message: `${src.label} currency ${S.currency} does not match ${ref.label} currency ${R.currency}. Amounts are not converted.`,
      });
    else if (!S.currency && R.currency && commercial)
      add({
        type: 'MISSING_FIELD',
        severity: 'INFO',
        field: 'currency',
        itemReference: null,
        sourceField: 'currency',
        referenceField: 'currency',
        rule: 'missing.currency',
        expectedValue: R.currency,
        actualValue: null,
        normalizedExpected: null,
        normalizedActual: null,
        message: `Currency not stated on ${src.label} — not compared.`,
      });
  }
  if (commercial || src.kind === 'SI') {
    if (S.incoterm && R.incoterm && S.incoterm !== R.incoterm)
      add({
        type: 'INCOTERM_MISMATCH',
        severity: 'CRITICAL',
        field: 'incoterm',
        itemReference: null,
        sourceField: 'incoterm',
        referenceField: 'incoterm',
        rule: 'incoterm.code',
        expectedValue: `${R.incoterm} ${R.incotermPlace ?? ''}`.trim(),
        actualValue: `${S.incoterm} ${S.incotermPlace ?? ''}`.trim(),
        normalizedExpected: R.incoterm,
        normalizedActual: S.incoterm,
        message: `Incoterm ${S.incoterm} on ${src.label} differs from ${ref.label} (${R.incoterm}).`,
      });
    else if (
      S.incoterm &&
      S.incoterm === R.incoterm &&
      S.incotermPlace &&
      R.incotermPlace &&
      textKey(S.incotermPlace) !== textKey(R.incotermPlace)
    )
      add({
        type: 'INCOTERM_MISMATCH',
        severity: 'WARNING',
        field: 'incotermPlace',
        itemReference: null,
        sourceField: 'incotermPlace',
        referenceField: 'incotermPlace',
        rule: 'incoterm.place',
        expectedValue: R.incotermPlace,
        actualValue: S.incotermPlace,
        normalizedExpected: textKey(R.incotermPlace),
        normalizedActual: textKey(S.incotermPlace),
        message: `Named place “${S.incotermPlace}” on ${src.label} differs from ${ref.label} (“${R.incotermPlace}”).`,
      });
  }

  for (const [f, sev] of [
    ['destinationCountry', 'CRITICAL'],
    ['originCountry', 'WARNING'],
  ] as const)
    if (S[f] && R[f] && S[f] !== R[f])
      add({
        type: 'COUNTRY_MISMATCH',
        severity: sev,
        field: f,
        itemReference: null,
        sourceField: f,
        referenceField: f,
        rule: `country.${f}`,
        expectedValue: R[f]!,
        actualValue: S[f]!,
        normalizedExpected: R[f]!,
        normalizedActual: S[f]!,
        message: `${f === 'destinationCountry' ? 'Destination' : 'Origin'} country ${S[f]} on ${src.label} differs from ${ref.label} (${R[f]}).`,
      });

  // Document references written on the source must point at the reference document.
  const refNumberField: Record<string, keyof View['fields']> = {
    PO: 'poNumber',
    PO_DOC: 'poNumber',
    PI: 'piNumber',
    PI_DOC: 'piNumber',
    CI: 'invoiceNumber',
  };
  const nf = refNumberField[ref.kind];
  if (
    nf &&
    S[nf] &&
    R.documentNumber &&
    docRefKey(S[nf]) !== docRefKey(R.documentNumber) &&
    !(src.kind === ref.kind)
  )
    add({
      type: 'DOCUMENT_NUMBER_MISMATCH',
      severity: 'WARNING',
      field: nf,
      itemReference: null,
      sourceField: nf,
      referenceField: 'documentNumber',
      rule: 'reference.number',
      expectedValue: R.documentNumber,
      actualValue: S[nf]!,
      normalizedExpected: docRefKey(R.documentNumber),
      normalizedActual: docRefKey(S[nf]),
      message: `${src.label} refers to ${S[nf]}, but ${ref.label} is numbered ${R.documentNumber}.`,
    });
  // Dates — rule-specific; dates are not expected to be identical.
  if (S.documentDate && R.documentDate) {
    if (
      src.kind === 'CI' &&
      (ref.kind === 'PO' || ref.kind === 'PI') &&
      S.documentDate < R.documentDate
    )
      add({
        type: 'DATE_MISMATCH',
        severity: 'WARNING',
        field: 'documentDate',
        itemReference: null,
        sourceField: 'documentDate',
        referenceField: 'documentDate',
        rule: 'date.invoice_before_order',
        expectedValue: `on or after ${R.documentDate}`,
        actualValue: S.documentDate,
        normalizedExpected: R.documentDate,
        normalizedActual: S.documentDate,
        message: `${src.label} is dated ${S.documentDate}, before ${ref.label} (${R.documentDate}).`,
      });
    if (
      (src.kind === 'BL' || src.kind === 'AWB') &&
      ref.kind === 'CI' &&
      S.documentDate < R.documentDate
    )
      add({
        type: 'DATE_MISMATCH',
        severity: 'INFO',
        field: 'documentDate',
        itemReference: null,
        sourceField: 'documentDate',
        referenceField: 'documentDate',
        rule: 'date.transport_before_invoice',
        expectedValue: `on or after ${R.documentDate}`,
        actualValue: S.documentDate,
        normalizedExpected: R.documentDate,
        normalizedActual: S.documentDate,
        message: `${src.label} date ${S.documentDate} is before ${ref.label} (${R.documentDate}).`,
      });
  }

  // Packages, weights, ports (logistics documents).
  if (
    (LOGISTICS.has(src.kind) || src.kind === 'CERT') &&
    LOGISTICS.has(ref.kind)
  ) {
    if (
      S.packageCount &&
      R.packageCount &&
      !new D(S.packageCount).eq(R.packageCount)
    )
      add({
        type: 'PACKAGING_MISMATCH',
        severity: 'CRITICAL',
        field: 'packageCount',
        itemReference: null,
        sourceField: 'packageCount',
        referenceField: 'packageCount',
        rule: 'packages.count',
        expectedValue: R.packageCount,
        actualValue: S.packageCount,
        normalizedExpected: R.packageCount,
        normalizedActual: S.packageCount,
        message: `${src.label} shows ${fmtN(S.packageCount)} packages; ${ref.label} shows ${fmtN(R.packageCount)}.`,
      });
    for (const w of ['grossWeightKg', 'netWeightKg'] as const)
      if (S[w] && R[w] && !new D(S[w]!).eq(R[w]!)) {
        const d = pct(S[w]!, R[w]!);
        add({
          type: 'WEIGHT_MISMATCH',
          severity: d.gt(1) ? 'CRITICAL' : 'WARNING',
          field: w,
          itemReference: null,
          sourceField: w,
          referenceField: w,
          rule: `weight.${w}`,
          expectedValue: `${fmtN(R[w]!)} kg`,
          actualValue: `${fmtN(S[w]!)} kg`,
          normalizedExpected: R[w]!,
          normalizedActual: S[w]!,
          message: `${w === 'grossWeightKg' ? 'Gross' : 'Net'} weight ${fmtN(S[w]!)} kg on ${src.label} differs from ${ref.label} (${fmtN(R[w]!)} kg).`,
        });
      }
    for (const p of ['portOfLoading', 'portOfDischarge'] as const)
      if (S[p] && R[p] && textKey(S[p]) !== textKey(R[p]))
        add({
          type: 'PORT_MISMATCH',
          severity: 'WARNING',
          field: p,
          itemReference: null,
          sourceField: p,
          referenceField: p,
          rule: `port.${p}`,
          expectedValue: R[p]!,
          actualValue: S[p]!,
          normalizedExpected: textKey(R[p]),
          normalizedActual: textKey(S[p]),
          message: `${p === 'portOfLoading' ? 'Port of loading' : 'Port of discharge'} “${S[p]}” on ${src.label} differs from ${ref.label} (“${R[p]}”).`,
        });
  }

  // Transport documents: cargo description must mention each referenced product.
  if (
    (src.kind === 'BL' || src.kind === 'AWB') &&
    S.cargoDescription &&
    ref.items.length
  ) {
    const words = new Set(keyWords(S.cargoDescription));
    for (const it of ref.items)
      if (!keyWords(it.description).some((w) => words.has(w)))
        add({
          type: 'PRODUCT_MISMATCH',
          severity: 'WARNING',
          field: 'cargoDescription',
          itemReference: it.description,
          sourceField: 'cargoDescription',
          referenceField: 'items.description',
          rule: 'cargo.mentions_product',
          expectedValue: it.description,
          actualValue: S.cargoDescription,
          normalizedExpected: null,
          normalizedActual: null,
          message: `Cargo description on ${src.label} does not mention “${it.description}” from ${ref.label}.`,
        });
  }

  // Certificates: product and HS against the referenced commercial items.
  if (src.kind === 'CERT' && ref.items.length) {
    if (S.productDescription) {
      const words = keyWords(S.productDescription);
      if (
        !ref.items.some((it) =>
          keyWords(it.description).some((w) => words.includes(w)),
        )
      )
        add({
          type: 'PRODUCT_MISMATCH',
          severity: 'WARNING',
          field: 'productDescription',
          itemReference: null,
          sourceField: 'productDescription',
          referenceField: 'items.description',
          rule: 'certificate.product',
          expectedValue: ref.items.map((i) => i.description).join(', '),
          actualValue: S.productDescription,
          normalizedExpected: null,
          normalizedActual: null,
          message: `Product “${S.productDescription}” on ${src.label} does not match any item on ${ref.label}.`,
        });
    }
    if (S.hsCode) {
      const withHs = ref.items.filter((i) => i.hsCode);
      if (
        withHs.length &&
        !withHs.some((i) => i.hsCode!.slice(0, 6) === S.hsCode!.slice(0, 6))
      ) {
        const confirmed =
          withHs.every((i) => i.hsConfirmed) && src.dataSource !== 'UNREVIEWED';
        add({
          type: 'HS_CODE_MISMATCH',
          severity: confirmed ? 'CRITICAL' : 'WARNING',
          field: 'hsCode',
          itemReference: null,
          sourceField: 'hsCode',
          referenceField: 'items.hsCode',
          rule: confirmed ? 'hs.confirmed' : 'hs.unconfirmed',
          expectedValue: withHs.map((i) => i.hsCode).join(', '),
          actualValue: S.hsCode,
          normalizedExpected: withHs
            .map((i) => i.hsCode!.slice(0, 6))
            .join(','),
          normalizedActual: S.hsCode.slice(0, 6),
          message: `HS ${S.hsCode} on ${src.label} does not match ${ref.label} (${withHs.map((i) => i.hsCode).join(', ')})${confirmed ? '' : ' — one side is not confirmed; review'}.`,
        });
      }
    }
  }

  // Items — each product validated independently.
  if (
    ITEM_LEVEL.has(src.kind) &&
    ITEM_LEVEL.has(ref.kind) &&
    (src.items.length || ref.items.length)
  )
    out.push(...compareItems(src, ref, ctx, commercial));
  else if (src.kind === 'CERT' && src.items.length && ref.items.length) {
    const m = matchItems(src.items, ref.items);
    for (const [a, b] of m.pairs) hsCheck(a, b, src, ref, out);
  }

  // Document totals (commercial only; a packing list has no price, so no price findings).
  if (
    commercial &&
    S.totalAmount &&
    R.totalAmount &&
    S.currency === R.currency &&
    !new D(S.totalAmount).eq(R.totalAmount)
  )
    add({
      type: 'TOTAL_MISMATCH',
      severity: 'CRITICAL',
      field: 'totalAmount',
      itemReference: null,
      sourceField: 'totalAmount',
      referenceField: 'totalAmount',
      rule: 'total.document',
      expectedValue: `${R.currency ?? ''} ${fmtN(R.totalAmount)}`.trim(),
      actualValue: `${S.currency ?? ''} ${fmtN(S.totalAmount)}`.trim(),
      normalizedExpected: R.totalAmount,
      normalizedActual: S.totalAmount,
      message: `${src.label} total ${fmtN(S.totalAmount)} differs from ${ref.label} total ${fmtN(R.totalAmount)}.`,
    });
  return out;
}

type Item = View['items'][number];

/** Priority: explicit link key → buyer SKU → HS + description → description. Ties are ambiguous, never guessed. */
export function matchItems(a: Item[], b: Item[]) {
  const pairs: [Item, Item][] = [];
  const ambiguous: { item: Item; candidates: Item[] }[] = [];
  const used = new Set<Item>();
  const unmatched: Item[] = [];
  const strategies: ((x: Item, y: Item) => boolean)[] = [
    (x, y) => Boolean(x.key && y.key && x.key === y.key),
    (x, y) =>
      Boolean(
        x.buyerSku && y.buyerSku && textKey(x.buyerSku) === textKey(y.buyerSku),
      ),
    (x, y) =>
      Boolean(
        x.hsCode &&
        y.hsCode &&
        x.hsCode.slice(0, 6) === y.hsCode.slice(0, 6) &&
        textKey(x.description) === textKey(y.description),
      ),
    (x, y) => textKey(x.description) === textKey(y.description),
    (x, y) => {
      const p = textKey(x.description);
      const q = textKey(y.description);
      return Boolean(p && q && (p.includes(q) || q.includes(p)));
    },
  ];
  for (const it of a) {
    let done = false;
    for (const s of strategies) {
      const c = b.filter((y) => !used.has(y) && s(it, y));
      if (c.length === 1) {
        pairs.push([it, c[0]]);
        used.add(c[0]);
        done = true;
        break;
      }
      if (c.length > 1) {
        ambiguous.push({ item: it, candidates: c });
        done = true;
        break;
      }
    }
    if (!done) unmatched.push(it);
  }
  const ambiguousRefs = new Set(ambiguous.flatMap((x) => x.candidates));
  return {
    pairs,
    ambiguous,
    unmatched,
    missing: b.filter((y) => !used.has(y) && !ambiguousRefs.has(y)),
  };
}

function hsCheck(a: Item, b: Item, src: View, ref: View, out: EngineFinding[]) {
  if (!a.hsCode || !b.hsCode || a.hsCode === b.hsCode) return;
  const six = a.hsCode.slice(0, 6) !== b.hsCode.slice(0, 6);
  const confirmed = a.hsConfirmed && b.hsConfirmed;
  out.push({
    type: 'HS_CODE_MISMATCH',
    severity: six && confirmed ? 'CRITICAL' : 'WARNING',
    field: 'hsCode',
    itemReference: a.description,
    sourceDocumentId: src.documentId,
    sourceLabel: src.label,
    referenceDocumentId: ref.documentId,
    referenceLabel: ref.label,
    sourceField: 'items.hsCode',
    referenceField: 'items.hsCode',
    rule: confirmed ? 'hs.confirmed' : 'hs.unconfirmed',
    expectedValue: b.hsCode,
    actualValue: a.hsCode,
    normalizedExpected: b.hsCode,
    normalizedActual: a.hsCode,
    message: `“${a.description}”: HS ${a.hsCode} on ${src.label} differs from ${ref.label} (${b.hsCode})${confirmed ? '' : ' — not confirmed on both sides; review'}.`,
  });
}

function compareItems(
  src: View,
  ref: View,
  ctx: EngineContext,
  commercial: boolean,
): EngineFinding[] {
  const out: EngineFinding[] = [];
  const base = {
    sourceDocumentId: src.documentId,
    sourceLabel: src.label,
    referenceDocumentId: ref.documentId,
    referenceLabel: ref.label,
  };
  const m = matchItems(src.items, ref.items);
  const qTol = new D(ctx.tolerance.quantityPercent || 0);
  const pTol = new D(ctx.tolerance.pricePercent || 0);
  for (const { item, candidates } of m.ambiguous)
    out.push({
      ...base,
      type: 'PRODUCT_MISMATCH',
      severity: 'WARNING',
      field: 'item',
      itemReference: item.description,
      sourceField: 'items',
      referenceField: 'items',
      rule: 'item.ambiguous_match',
      expectedValue: candidates.map((c) => c.description).join(' | '),
      actualValue: item.description,
      normalizedExpected: null,
      normalizedActual: null,
      message: `“${item.description}” on ${src.label} could match several items on ${ref.label} — not compared. Link or correct the item.`,
    });
  for (const it of m.unmatched)
    out.push({
      ...base,
      type: 'PRODUCT_MISMATCH',
      severity: 'CRITICAL',
      field: 'item',
      itemReference: it.description,
      sourceField: 'items',
      referenceField: 'items',
      rule: 'item.not_on_reference',
      expectedValue: null,
      actualValue: it.description,
      normalizedExpected: null,
      normalizedActual: textKey(it.description),
      message: `“${it.description}” on ${src.label} is not on ${ref.label}.`,
    });
  for (const it of m.missing)
    out.push({
      ...base,
      type: 'PRODUCT_MISMATCH',
      severity: 'WARNING',
      field: 'item',
      itemReference: it.description,
      sourceField: 'items',
      referenceField: 'items',
      rule: 'item.missing_on_source',
      expectedValue: it.description,
      actualValue: null,
      normalizedExpected: textKey(it.description),
      normalizedActual: null,
      message: `“${it.description}” from ${ref.label} is missing on ${src.label}.`,
    });
  for (const [a, b] of m.pairs) {
    const ref1 = a.description;
    if (a.quantity && b.quantity && a.unit && b.unit) {
      let qa: string | null = a.quantity;
      let qb: string | null = b.quantity;
      let unit = a.unit;
      if (a.unit !== b.unit) {
        const fa = massFactor(a.unit);
        const fb = massFactor(b.unit);
        if (fa && fb) {
          qa = new D(a.quantity).mul(fa).toString();
          qb = new D(b.quantity).mul(fb).toString();
          unit = 'KG';
        } else {
          out.push({
            ...base,
            type: 'UNIT_MISMATCH',
            severity: 'CRITICAL',
            field: 'unit',
            itemReference: ref1,
            sourceField: 'items.unit',
            referenceField: 'items.unit',
            rule: 'unit.not_convertible',
            expectedValue: `${fmtN(b.quantity)} ${b.unit}`,
            actualValue: `${fmtN(a.quantity)} ${a.unit}`,
            normalizedExpected: b.unit,
            normalizedActual: a.unit,
            message: `“${ref1}”: unit ${a.unit} on ${src.label} cannot be compared with ${b.unit} on ${ref.label} (no conversion data).`,
          });
          qa = qb = null;
        }
      }
      if (qa !== null && qb !== null && !new D(qa).eq(qb)) {
        const d = pct(qa, qb);
        if (d.gt(qTol))
          out.push({
            ...base,
            type: 'QUANTITY_MISMATCH',
            severity: d.gt(D.max(qTol, QUANTITY_CRITICAL_PERCENT))
              ? 'CRITICAL'
              : 'WARNING',
            field: 'quantity',
            itemReference: ref1,
            sourceField: 'items.quantity',
            referenceField: 'items.quantity',
            rule: 'quantity.tolerance',
            expectedValue: `${fmtN(b.quantity)} ${b.unit}`,
            actualValue: `${fmtN(a.quantity)} ${a.unit}`,
            normalizedExpected: `${new D(qb).toString()} ${unit}`,
            normalizedActual: `${new D(qa).toString()} ${unit}`,
            message: `${src.label} quantity ${fmtN(new D(qa).toString())} ${unit} does not match ${ref.label} ${fmtN(new D(qb).toString())} ${unit} (“${ref1}”).`,
          });
      }
    }
    if (commercial && a.unitPrice && b.unitPrice && a.unit === b.unit) {
      const d = pct(a.unitPrice, b.unitPrice);
      if (d.gt(pTol))
        out.push({
          ...base,
          type: 'PRICE_MISMATCH',
          severity: 'CRITICAL',
          field: 'unitPrice',
          itemReference: ref1,
          sourceField: 'items.unitPrice',
          referenceField: 'items.unitPrice',
          rule: 'price.unit',
          expectedValue: fmtN(b.unitPrice),
          actualValue: fmtN(a.unitPrice),
          normalizedExpected: new D(b.unitPrice).toString(),
          normalizedActual: new D(a.unitPrice).toString(),
          message: `“${ref1}”: unit price ${fmtN(a.unitPrice)} on ${src.label} differs from ${ref.label} (${fmtN(b.unitPrice)}).`,
        });
    }
    hsCheck(a, b, src, ref, out);
    if (
      src.kind === 'PL' &&
      a.packageCount &&
      b.packageCount &&
      !new D(a.packageCount).eq(b.packageCount)
    )
      out.push({
        ...base,
        type: 'PACKAGING_MISMATCH',
        severity: 'WARNING',
        field: 'packageCount',
        itemReference: ref1,
        sourceField: 'items.packageCount',
        referenceField: 'items.packageCount',
        rule: 'packages.item',
        expectedValue: b.packageCount,
        actualValue: a.packageCount,
        normalizedExpected: b.packageCount,
        normalizedActual: a.packageCount,
        message: `“${ref1}”: ${a.packageCount} packages on ${src.label} vs ${b.packageCount} on ${ref.label}.`,
      });
  }
  return out;
}

/** Checks that need no reference: expiry, issue/expiry order, own arithmetic. */
export function checkDocument(src: View, ctx: EngineContext): EngineFinding[] {
  const out: EngineFinding[] = [];
  const base = {
    sourceDocumentId: src.documentId,
    sourceLabel: src.label,
    referenceDocumentId: null,
    referenceLabel: null,
    referenceField: null,
    itemReference: null,
  };
  const S = src.fields;
  if (S.issueDate && S.expiryDate && S.issueDate > S.expiryDate)
    out.push({
      ...base,
      type: 'DATE_MISMATCH',
      severity: 'CRITICAL',
      field: 'expiryDate',
      sourceField: 'issueDate',
      rule: 'date.issue_after_expiry',
      expectedValue: `after ${S.issueDate}`,
      actualValue: S.expiryDate,
      normalizedExpected: S.issueDate,
      normalizedActual: S.expiryDate,
      message: `${src.label} issue date ${S.issueDate} is after its expiry date ${S.expiryDate}.`,
    });
  if (S.expiryDate) {
    const soon = new Date(
      new Date(`${ctx.today}T00:00:00Z`).getTime() +
        ctx.expiryWarningDays * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    if (S.expiryDate < ctx.today)
      out.push({
        ...base,
        type: 'DATE_MISMATCH',
        severity: 'CRITICAL',
        field: 'expiryDate',
        sourceField: 'expiryDate',
        rule: 'date.expired',
        expectedValue: `on or after ${ctx.today}`,
        actualValue: S.expiryDate,
        normalizedExpected: ctx.today,
        normalizedActual: S.expiryDate,
        message: `${src.label} has expired (${S.expiryDate}).`,
      });
    else if (S.expiryDate <= soon)
      out.push({
        ...base,
        type: 'DATE_MISMATCH',
        severity: 'WARNING',
        field: 'expiryDate',
        sourceField: 'expiryDate',
        rule: 'date.expiring_soon',
        expectedValue: `after ${soon}`,
        actualValue: S.expiryDate,
        normalizedExpected: soon,
        normalizedActual: S.expiryDate,
        message: `${src.label} expires soon (${S.expiryDate}).`,
      });
  }
  for (const it of src.items)
    if (
      it.quantity &&
      it.unitPrice &&
      it.total &&
      !new D(it.quantity)
        .mul(it.unitPrice)
        .toDecimalPlaces(2)
        .eq(new D(it.total).toDecimalPlaces(2))
    )
      out.push({
        ...base,
        type: 'TOTAL_MISMATCH',
        severity: 'WARNING',
        field: 'items.total',
        sourceField: 'items.total',
        rule: 'total.line_arithmetic',
        itemReference: it.description,
        expectedValue: fmtN(
          new D(it.quantity).mul(it.unitPrice).toDecimalPlaces(2).toFixed(2),
        ),
        actualValue: fmtN(it.total),
        normalizedExpected: new D(it.quantity)
          .mul(it.unitPrice)
          .toDecimalPlaces(2)
          .toFixed(2),
        normalizedActual: new D(it.total).toFixed(2),
        message: `“${it.description}” line total on ${src.label} does not equal quantity × unit price.`,
      });
  if (
    COMMERCIAL.has(src.kind) &&
    S.totalAmount &&
    src.items.length &&
    src.items.every((i) => i.total)
  ) {
    const sum = src.items.reduce((s, i) => s.plus(i.total!), new D(0));
    if (!sum.eq(S.totalAmount) && src.dataSource !== 'STRUCTURED')
      out.push({
        ...base,
        type: 'TOTAL_MISMATCH',
        severity: 'WARNING',
        field: 'totalAmount',
        sourceField: 'totalAmount',
        rule: 'total.lines_sum',
        expectedValue: fmtN(sum.toString()),
        actualValue: fmtN(S.totalAmount),
        normalizedExpected: sum.toString(),
        normalizedActual: S.totalAmount,
        message: `${src.label} stated total ${fmtN(S.totalAmount)} differs from the sum of its lines (${fmtN(sum.toString())}).`,
      });
  }
  return out;
}

export const signature = (f: EngineFinding) =>
  [
    f.rule,
    f.sourceDocumentId ?? f.sourceLabel,
    f.referenceDocumentId ?? f.referenceLabel ?? '',
    f.field,
    f.itemReference ?? '',
    f.normalizedExpected ?? f.expectedValue ?? '',
    f.normalizedActual ?? f.actualValue ?? '',
  ]
    .join('|')
    .slice(0, 480);
