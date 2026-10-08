import type { BankDetails, PartySnapshot } from '@exportpro/types';
import { type JpegImage, PdfDoc, wrap } from './pdf-writer';

/**
 * Buyer-facing layout for quotations and proforma invoices. The input type
 * deliberately has no fields for cost, margin, supplier rates or internal
 * notes, so internal costing data cannot reach the document.
 */
export interface CommercialPdfInput {
  title: 'QUOTATION' | 'PROFORMA INVOICE' | 'PURCHASE ORDER';
  /** Recipient label; defaults to buyer (Sprint 21 supplier POs pass 'Supplier'). */
  partyLabel?: string;
  number: string;
  draft: boolean;
  issueDate: string | null;
  validUntil: string | null;
  exporter: PartySnapshot;
  buyer: PartySnapshot;
  currency: string;
  items: {
    description: string;
    hsCode: string | null;
    specification: string | null;
    packaging: string | null;
    quantity: string;
    unit: string;
    unitPrice: string | null;
    total: string | null;
  }[];
  subtotal: string | null;
  charges: { label: string; amount: string } | null;
  discount: string | null;
  total: string | null;
  incoterm: string | null;
  destination: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  buyerNotes: string | null;
  terms: string | null;
  bank: BankDetails | null;
  reference: string | null;
  footer: string;
}

const fmt = (v: string | null, cur?: string) => {
  if (v === null || v === undefined) return '-';
  const [i, d] = v.split('.');
  const neg = i.startsWith('-');
  const g = (neg ? i.slice(1) : i).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cur ? `${cur} ` : ''}${neg ? '-' : ''}${g}${d ? `.${d}` : ''}`;
};

export function renderCommercialPdf(
  d: CommercialPdfInput,
  logo: JpegImage | null,
): Buffer {
  const pdf = new PdfDoc();
  const L = 40;
  const R = pdf.width - 40;
  let y = 40;
  const ensure = (h: number) => {
    if (y + h > pdf.height - 50) {
      footer();
      pdf.addPage();
      y = 40;
    }
  };
  const footer = () => {
    pdf.line(L, pdf.height - 40, R, pdf.height - 40);
    pdf.text(
      L,
      pdf.height - 28,
      `${d.title} ${d.number} - page ${pdf.pageCount}`,
      7,
      { gray: 0.4 },
    );
    pdf.text(R, pdf.height - 28, d.footer, 7, { gray: 0.4, align: 'right' });
  };
  const para = (label: string, value: string | null, width = R - L) => {
    if (!value) return;
    const lines = wrap(value, width, 8.5);
    ensure(14 + lines.length * 11);
    pdf.text(L, y, label, 8.5, { bold: true });
    y += 12;
    for (const ln of lines) {
      ensure(11);
      pdf.text(L, y, ln, 8.5);
      y += 11;
    }
    y += 6;
  };

  // Header: exporter identity (left), title (right)
  let headerBottom = y;
  if (logo) {
    const s = pdf.jpeg(logo, L, y, 120, 50);
    headerBottom = y + s.h + 6;
  }
  let hy = logo ? headerBottom : y;
  pdf.text(L, hy + 10, d.exporter.legalName || d.exporter.name, 12, {
    bold: true,
  });
  hy += 24;
  for (const ln of [
    d.exporter.address,
    [d.exporter.email, d.exporter.phone].filter(Boolean).join(' | '),
    d.exporter.website,
    ...(d.exporter.registrations ?? []).map((r) => `${r.type}: ${r.number}`),
  ].filter(Boolean) as string[]) {
    for (const w of wrap(ln, 300, 8)) {
      pdf.text(L, hy, w, 8, { gray: 0.25 });
      hy += 10;
    }
  }
  pdf.text(R, y + 12, d.title, 16, { bold: true, align: 'right' });
  pdf.text(R, y + 30, `No. ${d.number}`, 9, { align: 'right' });
  if (d.issueDate)
    pdf.text(R, y + 43, `Date: ${d.issueDate}`, 9, { align: 'right' });
  if (d.validUntil)
    pdf.text(R, y + 56, `Valid until: ${d.validUntil}`, 9, { align: 'right' });
  if (d.reference)
    pdf.text(R, y + 69, d.reference, 8, { align: 'right', gray: 0.3 });
  if (d.draft)
    pdf.text(R, y + 84, 'DRAFT - NOT ISSUED', 10, {
      bold: true,
      align: 'right',
      gray: 0.45,
    });
  y = Math.max(hy, y + 92) + 8;
  pdf.line(L, y, R, y, 1, 0.5);
  y += 14;

  // Buyer + commercial terms
  pdf.text(L, y, `To (${(d.partyLabel ?? 'buyer').toLowerCase()})`, 8.5, {
    bold: true,
  });
  pdf.text(320, y, 'Commercial terms', 8.5, { bold: true });
  y += 12;
  const buyerLines = [
    d.buyer.name,
    d.buyer.address,
    d.buyer.country,
    d.buyer.contactName ? `Attn: ${d.buyer.contactName}` : null,
    d.buyer.email,
  ].filter(Boolean) as string[];
  const termLines = [
    d.incoterm ? `Incoterms(R): ${d.incoterm}` : null,
    d.destination ? `Destination: ${d.destination}` : null,
    `Currency: ${d.currency}`,
  ].filter(Boolean) as string[];
  let by = y;
  for (const ln of buyerLines)
    for (const w of wrap(ln, 260, 8.5)) {
      pdf.text(L, by, w, 8.5);
      by += 11;
    }
  let ty = y;
  for (const ln of termLines)
    for (const w of wrap(ln, R - 320, 8.5)) {
      pdf.text(320, ty, w, 8.5);
      ty += 11;
    }
  y = Math.max(by, ty) + 10;

  // Items table
  const cols = { no: L, desc: L + 22, qty: 360, price: 450, total: R };
  const header = () => {
    pdf.rect(L, y - 10, R - L, 16);
    pdf.text(cols.no, y + 1, '#', 8, { bold: true });
    pdf.text(cols.desc, y + 1, 'Description', 8, { bold: true });
    pdf.text(cols.qty + 40, y + 1, 'Quantity', 8, {
      bold: true,
      align: 'right',
    });
    pdf.text(cols.price + 30, y + 1, `Unit price (${d.currency})`, 8, {
      bold: true,
      align: 'right',
    });
    pdf.text(cols.total, y + 1, `Amount (${d.currency})`, 8, {
      bold: true,
      align: 'right',
    });
    y += 18;
  };
  ensure(40);
  header();
  d.items.forEach((it, i) => {
    const descLines = [
      ...wrap(it.description, cols.qty - cols.desc - 50, 8.5, true),
      ...(it.hsCode ? [`HS code: ${it.hsCode}`] : []),
      ...(it.specification
        ? wrap(`Spec: ${it.specification}`, cols.qty - cols.desc - 50, 7.5)
        : []),
      ...(it.packaging
        ? wrap(`Packing: ${it.packaging}`, cols.qty - cols.desc - 50, 7.5)
        : []),
    ];
    const h = descLines.length * 10 + 6;
    if (y + h > pdf.height - 60) {
      footer();
      pdf.addPage();
      y = 50;
      header();
    }
    pdf.text(cols.no, y, String(i + 1), 8.5);
    descLines.forEach((ln, k) =>
      pdf.text(cols.desc, y + k * 10, ln, k === 0 ? 8.5 : 7.5, {
        bold: k === 0,
        gray: k === 0 ? 0 : 0.3,
      }),
    );
    pdf.text(cols.qty + 40, y, `${fmt(it.quantity)} ${it.unit}`, 8.5, {
      align: 'right',
    });
    pdf.text(cols.price + 30, y, fmt(it.unitPrice), 8.5, { align: 'right' });
    pdf.text(cols.total, y, fmt(it.total), 8.5, { align: 'right' });
    y += h;
    pdf.line(L, y - 6, R, y - 6, 0.3, 0.85);
  });

  // Totals
  ensure(70);
  y += 4;
  const tot = (label: string, v: string | null, bold = false) => {
    pdf.text(cols.price + 30, y, label, 9, { bold, align: 'right' });
    pdf.text(cols.total, y, fmt(v, d.currency), 9, { bold, align: 'right' });
    y += 13;
  };
  tot('Subtotal', d.subtotal);
  if (d.charges) tot(d.charges.label, d.charges.amount);
  if (d.discount && d.discount !== '0.00') tot('Discount', `-${d.discount}`);
  tot('Total', d.total, true);
  y += 10;

  para('Payment terms', d.paymentTerms);
  para('Delivery terms', d.deliveryTerms);
  para('Notes', d.buyerNotes);
  if (d.bank) {
    const b = d.bank;
    para(
      'Bank details for payment',
      [
        b.beneficiary && `Beneficiary: ${b.beneficiary}`,
        b.bankName && `Bank: ${b.bankName}`,
        b.accountNumber && `Account no.: ${b.accountNumber}`,
        b.iban && `IBAN: ${b.iban}`,
        b.swift && `SWIFT/BIC: ${b.swift}`,
        b.bankAddress && `Bank address: ${b.bankAddress}`,
        b.intermediary && `Intermediary: ${b.intermediary}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  para('Terms & conditions', d.terms);
  ensure(50);
  y += 16;
  pdf.line(R - 180, y, R, y);
  pdf.text(R, y + 12, `For ${d.exporter.legalName || d.exporter.name}`, 8, {
    align: 'right',
    gray: 0.3,
  });
  pdf.text(R, y + 23, 'Authorised signatory', 8, { align: 'right', gray: 0.3 });
  footer();
  return pdf.build();
}
