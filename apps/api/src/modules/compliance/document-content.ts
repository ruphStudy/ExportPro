import { BadRequestException } from '@nestjs/common';
import type {
  CommercialInvoiceContent,
  DocumentTotals,
  GeneratedDocumentType,
  PackingListContent,
  PartySnapshot,
  ShippingInstructionContent,
} from '@exportpro/types';
import { D, money } from '../costing/costing-calculator';
import { lineTotal } from '../commercial/commercial-math';

/**
 * Generated-document content: sanitizing (types/lengths/number formats only — nothing is
 * invented), deterministic validation, server-computed totals and a simple revision diff.
 */

const QTY = /^\d{1,14}(\.\d{1,4})?$/;
const PRICE = /^\d{1,14}(\.\d{1,6})?$/;
const WEIGHT = /^\d{1,10}(\.\d{1,3})?$/;
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;

const str = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number')
    throw new BadRequestException('Invalid text field.');
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const num = (v: unknown, re: RegExp, label: string): string | null => {
  const s = str(v, 30);
  if (s === null) return null;
  if (!re.test(s))
    throw new BadRequestException(`${label} must be a non-negative number.`);
  return s;
};
const country = (v: unknown) => {
  const s = str(v, 2);
  if (s && !/^[A-Z]{2}$/.test(s))
    throw new BadRequestException('Country must be an ISO alpha-2 code.');
  return s;
};
const party = (v: unknown): PartySnapshot | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') throw new BadRequestException('Invalid party.');
  const o = v as Record<string, unknown>;
  return {
    name: str(o.name, 200) ?? '',
    address: str(o.address, 500),
    country: str(o.country, 80),
    contactName: str(o.contactName, 120),
    email: str(o.email, 160),
    phone: str(o.phone, 60),
  };
};
const arr = (v: unknown, max: number): Record<string, unknown>[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max)
    throw new BadRequestException(`Up to ${max} lines are allowed.`);
  return v.map((x) => {
    if (!x || typeof x !== 'object')
      throw new BadRequestException('Invalid line.');
    return x as Record<string, unknown>;
  });
};

export function sanitizeContent(
  type: GeneratedDocumentType,
  raw: Record<string, unknown>,
  base: Record<string, unknown>,
) {
  const r = { ...base, ...raw };
  if (type === 'COMMERCIAL_INVOICE') {
    const c: CommercialInvoiceContent = {
      invoiceDate: str(r.invoiceDate, 10),
      buyerPoReference: str(r.buyerPoReference, 80),
      consignee: party(r.consignee),
      currency: str(r.currency, 3) ?? 'USD',
      incoterm: str(r.incoterm, 3),
      incotermPlace: str(r.incotermPlace, 80),
      originCountry: country(r.originCountry),
      destinationCountry: country(r.destinationCountry),
      portOfLoading: str(r.portOfLoading, 80),
      portOfDischarge: str(r.portOfDischarge, 80),
      shipmentMode: str(r.shipmentMode, 10),
      paymentTerms: str(r.paymentTerms, 1000),
      shippingTerms: str(r.shippingTerms, 1000),
      items: arr(r.items, 50).map((i, n) => ({
        description: str(i.description, 300) ?? '',
        hsCode: str(i.hsCode, 10),
        quantity: num(i.quantity, QTY, `Item ${n + 1} quantity`) ?? '',
        unit: (str(i.unit, 20) ?? '').toUpperCase(),
        unitPrice: num(i.unitPrice, PRICE, `Item ${n + 1} unit price`) ?? '',
      })),
      additionalCharges: num(r.additionalCharges, MONEY, 'Additional charges'),
      chargesLabel: str(r.chargesLabel, 80),
      discount: num(r.discount, MONEY, 'Discount'),
      marks: str(r.marks, 500),
      declaration: str(r.declaration, 2000),
    };
    if (c.invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(c.invoiceDate))
      throw new BadRequestException('Invoice date must be YYYY-MM-DD.');
    return c;
  }
  if (type === 'PACKING_LIST') {
    const c: PackingListContent = {
      invoiceReference: str(r.invoiceReference, 80),
      consignee: party(r.consignee),
      destinationCountry: country(r.destinationCountry),
      portOfLoading: str(r.portOfLoading, 80),
      portOfDischarge: str(r.portOfDischarge, 80),
      packages: arr(r.packages, 100).map((p, n) => {
        const cnt =
          p.packageCount === null ||
          p.packageCount === undefined ||
          p.packageCount === ''
            ? 0
            : Number(p.packageCount);
        if (!Number.isInteger(cnt) || cnt < 0 || cnt > 1_000_000)
          throw new BadRequestException(
            `Line ${n + 1}: package count must be a whole number ≥ 0.`,
          );
        return {
          marks: str(p.marks, 200),
          packageType: str(p.packageType, 60) ?? '',
          packageCount: cnt,
          description: str(p.description, 300) ?? '',
          quantity: num(p.quantity, QTY, `Line ${n + 1} quantity`),
          unit: str(p.unit, 20),
          netWeightKg: num(p.netWeightKg, WEIGHT, `Line ${n + 1} net weight`),
          grossWeightKg: num(
            p.grossWeightKg,
            WEIGHT,
            `Line ${n + 1} gross weight`,
          ),
          dimensions: str(p.dimensions, 80),
          volumeCbm: num(p.volumeCbm, WEIGHT, `Line ${n + 1} volume`),
        };
      }),
      notes: str(r.notes, 2000),
    };
    return c;
  }
  const pc =
    r.packageCount === null ||
    r.packageCount === undefined ||
    r.packageCount === ''
      ? null
      : Number(r.packageCount);
  if (pc !== null && (!Number.isInteger(pc) || pc < 0))
    throw new BadRequestException('Package count must be a whole number ≥ 0.');
  const c: ShippingInstructionContent = {
    consignee: party(r.consignee),
    notifyParty: str(r.notifyParty, 500),
    originCountry: country(r.originCountry),
    destinationCountry: country(r.destinationCountry),
    placeOfReceipt: str(r.placeOfReceipt, 80),
    portOfLoading: str(r.portOfLoading, 80),
    portOfDischarge: str(r.portOfDischarge, 80),
    finalDestination: str(r.finalDestination, 80),
    incoterm: str(r.incoterm, 3),
    incotermPlace: str(r.incotermPlace, 80),
    shipmentMode: str(r.shipmentMode, 10),
    cargoDescription: str(r.cargoDescription, 2000),
    hsCodes: str(r.hsCodes, 200),
    packageCount: pc,
    netWeightKg: num(r.netWeightKg, WEIGHT, 'Net weight'),
    grossWeightKg: num(r.grossWeightKg, WEIGHT, 'Gross weight'),
    volumeCbm: num(r.volumeCbm, WEIGHT, 'Volume'),
    shippingMarks: str(r.shippingMarks, 500),
    freightPayableAt: str(r.freightPayableAt, 80),
    specialInstructions: str(r.specialInstructions, 2000),
  };
  return c;
}

/** Totals are always computed server-side from the lines (never typed in). */
export function computeTotals(
  type: GeneratedDocumentType,
  content: unknown,
): DocumentTotals {
  if (type === 'COMMERCIAL_INVOICE') {
    const c = content as CommercialInvoiceContent;
    const ok = c.items.every(
      (i) => QTY.test(i.quantity) && PRICE.test(i.unitPrice),
    );
    if (!ok || !c.items.length) return { subtotal: null, total: null };
    const sub = c.items.reduce(
      (s, i) => s.plus(lineTotal(i.quantity, i.unitPrice)),
      new D(0),
    );
    return {
      subtotal: money(sub),
      total: money(
        sub.plus(c.additionalCharges ?? '0').minus(c.discount ?? '0'),
      ),
    };
  }
  if (type === 'PACKING_LIST') {
    const c = content as PackingListContent;
    const sum = (k: 'netWeightKg' | 'grossWeightKg' | 'volumeCbm') =>
      c.packages.every((p) => p[k] !== null) && c.packages.length
        ? c.packages
            .reduce((s, p) => s.plus(p[k]!), new D(0))
            .toDecimalPlaces(3)
            .toString()
        : null;
    return {
      packages: c.packages.reduce((s, p) => s + p.packageCount, 0),
      netWeightKg: sum('netWeightKg'),
      grossWeightKg: sum('grossWeightKg'),
      volumeCbm: c.packages.some((p) => p.volumeCbm) ? sum('volumeCbm') : null,
    };
  }
  return {};
}

/** Deterministic problems that block review/approval (missing data is reported, never invented). */
export function validateContent(
  type: GeneratedDocumentType,
  content: unknown,
  exporter: PartySnapshot | null,
): string[] {
  const p: string[] = [];
  if (!exporter?.name)
    p.push('Exporter name missing — complete your organization profile.');
  else if (!exporter.address && !exporter.email)
    p.push(
      'Exporter address or email missing — complete your organization profile.',
    );
  if (type === 'COMMERCIAL_INVOICE') {
    const c = content as CommercialInvoiceContent;
    if (!c.consignee?.name) p.push('Buyer / consignee is missing.');
    if (!c.invoiceDate) p.push('Invoice date is missing.');
    if (!c.currency) p.push('Currency is missing.');
    if (!c.incoterm) p.push('Incoterm is missing.');
    if (!c.items.length) p.push('Add at least one item.');
    c.items.forEach((i, n) => {
      if (!i.description) p.push(`Item ${n + 1}: description missing.`);
      if (!i.quantity || new D(i.quantity).lte(0))
        p.push(`Item ${n + 1}: quantity must be greater than 0.`);
      if (!i.unit) p.push(`Item ${n + 1}: unit missing.`);
      if (!i.unitPrice) p.push(`Item ${n + 1}: unit price missing.`);
    });
    const t = computeTotals(type, c);
    if (t.total !== null && t.total !== undefined && new D(t.total).lte(0))
      p.push('Invoice total must be greater than 0.');
  } else if (type === 'PACKING_LIST') {
    const c = content as PackingListContent;
    if (!c.packages.length) p.push('Add at least one package line.');
    c.packages.forEach((x, n) => {
      const l = `Line ${n + 1}`;
      if (!x.description) p.push(`${l}: description missing.`);
      if (!x.packageType) p.push(`${l}: package type missing.`);
      if (x.packageCount <= 0)
        p.push(`${l}: number of packages must be at least 1.`);
      if (x.netWeightKg === null) p.push(`${l}: net weight missing.`);
      if (x.grossWeightKg === null) p.push(`${l}: gross weight missing.`);
      if (
        x.netWeightKg !== null &&
        x.grossWeightKg !== null &&
        new D(x.grossWeightKg).lt(x.netWeightKg)
      )
        p.push(`${l}: gross weight must be ≥ net weight.`);
    });
    if (!c.consignee?.name) p.push('Consignee is missing.');
  } else {
    const c = content as ShippingInstructionContent;
    if (!c.consignee?.name) p.push('Consignee is missing.');
    if (!c.cargoDescription) p.push('Cargo description is missing.');
    if (!c.portOfLoading && !c.placeOfReceipt)
      p.push('Port of loading (or place of receipt) is missing.');
    if (!c.portOfDischarge && !c.finalDestination)
      p.push('Port of discharge (or final destination) is missing.');
    if (!c.packageCount) p.push('Package count is missing.');
    if (
      c.netWeightKg &&
      c.grossWeightKg &&
      new D(c.grossWeightKg).lt(c.netWeightKg)
    )
      p.push('Gross weight must be ≥ net weight.');
  }
  return p;
}

/** Simple deterministic field/item diff between two versions. */
export function diffContent(prev: unknown, next: unknown): string[] {
  if (!prev || !next) return [];
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const out: string[] = [];
  const label = (k: string) => k.replace(/([A-Z])/g, ' $1').toLowerCase();
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k];
    const y = b[k];
    if (Array.isArray(x) || Array.isArray(y)) {
      const xs = (x as unknown[]) ?? [];
      const ys = (y as unknown[]) ?? [];
      if (xs.length !== ys.length)
        out.push(`${label(k)}: ${xs.length} → ${ys.length} lines`);
      for (let n = 0; n < Math.min(xs.length, ys.length); n++)
        for (const f of new Set([
          ...Object.keys((xs[n] ?? {}) as object),
          ...Object.keys((ys[n] ?? {}) as object),
        ])) {
          const u = (xs[n] as Record<string, unknown>)[f];
          const v = (ys[n] as Record<string, unknown>)[f];
          if (JSON.stringify(u ?? null) !== JSON.stringify(v ?? null))
            out.push(
              `${label(k)} line ${n + 1} ${label(f)}: ${String(u ?? '—')} → ${String(v ?? '—')}`,
            );
        }
    } else if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null))
      out.push(
        typeof x === 'object' || typeof y === 'object'
          ? `${label(k)} changed`
          : `${label(k)}: ${String(x ?? '—')} → ${String(y ?? '—')}`,
      );
  }
  return out.slice(0, 50);
}

export const DEFAULT_TEMPLATE: Record<
  GeneratedDocumentType,
  { declaration: string | null; footer: string; subtitle: string }
> = {
  COMMERCIAL_INVOICE: {
    declaration:
      'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
    footer: 'Commercial invoice prepared by the exporter.',
    subtitle: 'Exporter-prepared commercial document - not a GST tax invoice',
  },
  PACKING_LIST: {
    declaration: null,
    footer: 'Packing list prepared by the exporter.',
    subtitle: 'Exporter-prepared packing list',
  },
  SHIPPING_INSTRUCTION: {
    declaration: null,
    footer: 'Shipping instruction to forwarder/carrier.',
    subtitle:
      'Instruction to forwarder/carrier - not a bill of lading or airway bill',
  },
};

export const lineAmount = (q: string, p: string) =>
  QTY.test(q) && PRICE.test(p) ? money(lineTotal(q, p)) : null;
