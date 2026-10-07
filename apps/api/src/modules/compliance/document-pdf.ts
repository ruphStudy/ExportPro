import type { PartySnapshot } from '@exportpro/types';
import {
  type JpegImage,
  PdfDoc,
  textWidth,
  wrap,
} from '../commercial/pdf/pdf-writer';

/**
 * Layout for exporter-prepared trade documents (commercial invoice, packing
 * list, shipping instruction), reusing the Sprint 15 dependency-free PDF
 * writer. The input carries only document-facing text — internal notes,
 * costing and margin data have no field here, so they cannot be printed.
 */
export interface TradeDocPdfInput {
  title: string;
  subtitle: string;
  number: string;
  draft: boolean;
  watermark: string | null;
  exporter: PartySnapshot;
  parties: { label: string; lines: (string | null | undefined)[] }[];
  meta: [string, string | null | undefined][];
  table: {
    columns: { label: string; width: number; align?: 'left' | 'right' }[];
    rows: string[][];
  } | null;
  totals: [string, string][];
  blocks: [string, string | null | undefined][];
  declaration: string | null;
  signatureLabel: string;
  footer: string;
}

export function renderTradeDocPdf(
  d: TradeDocPdfInput,
  logo: JpegImage | null,
): Buffer {
  const pdf = new PdfDoc();
  const L = 40;
  const R = pdf.width - 40;
  let y = 40;
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
  const ensure = (h: number) => {
    if (y + h > pdf.height - 55) {
      footer();
      pdf.addPage();
      y = 45;
      return true;
    }
    return false;
  };
  const para = (label: string, value: string | null | undefined) => {
    if (!value) return;
    const lines = wrap(value, R - L, 8.5);
    ensure(14 + Math.min(lines.length, 4) * 11);
    pdf.text(L, y, label, 8.5, { bold: true });
    y += 12;
    for (const ln of lines) {
      ensure(11);
      pdf.text(L, y, ln, 8.5);
      y += 11;
    }
    y += 6;
  };

  // Header: exporter (left), title block (right)
  let hy = y;
  if (logo) hy += pdf.jpeg(logo, L, y, 120, 50).h + 6;
  pdf.text(L, hy + 10, d.exporter.legalName || d.exporter.name, 12, {
    bold: true,
  });
  hy += 24;
  for (const ln of [
    d.exporter.address,
    d.exporter.country,
    [d.exporter.email, d.exporter.phone].filter(Boolean).join(' | '),
    ...(d.exporter.registrations ?? []).map((r) => `${r.type}: ${r.number}`),
  ].filter(Boolean) as string[])
    for (const w of wrap(ln, 290, 8)) {
      pdf.text(L, hy, w, 8, { gray: 0.25 });
      hy += 10;
    }
  pdf.text(R, y + 12, d.title, 15, { bold: true, align: 'right' });
  let ry = y + 26;
  for (const w of wrap(d.subtitle, 220, 7)) {
    pdf.text(R, ry, w, 7, { align: 'right', gray: 0.35 });
    ry += 9;
  }
  pdf.text(R, ry + 6, `No. ${d.number}`, 9, { align: 'right' });
  ry += 18;
  if (d.draft) {
    pdf.text(R, ry + 4, 'DRAFT - NOT APPROVED', 10, {
      bold: true,
      align: 'right',
      gray: 0.45,
    });
    ry += 14;
  }
  if (d.watermark) {
    pdf.text(R, ry + 4, d.watermark, 8, { align: 'right', gray: 0.3 });
    ry += 12;
  }
  y = Math.max(hy, ry) + 8;
  pdf.line(L, y, R, y, 1, 0.5);
  y += 14;

  // Parties (up to three columns)
  const parties = d.parties.filter((p) => p.lines.some(Boolean));
  if (parties.length) {
    const w = (R - L) / parties.length;
    let maxY = y;
    parties.forEach((p, i) => {
      const x = L + i * w;
      let py = y;
      pdf.text(x, py, p.label, 8.5, { bold: true });
      py += 12;
      for (const ln of p.lines.filter(Boolean) as string[])
        for (const ww of wrap(ln, w - 12, 8.5)) {
          pdf.text(x, py, ww, 8.5);
          py += 11;
        }
      maxY = Math.max(maxY, py);
    });
    y = maxY + 8;
  }

  // Meta grid (two columns of label: value)
  const meta = d.meta.filter(([, v]) => v);
  if (meta.length) {
    const half = Math.ceil(meta.length / 2);
    const colX = [L, L + (R - L) / 2];
    let maxY = y;
    [meta.slice(0, half), meta.slice(half)].forEach((col, ci) => {
      let my = y;
      for (const [k, v] of col) {
        const label = `${k}: `;
        const lw = textWidth(label, 8.5, true);
        const lines = wrap(v!, (R - L) / 2 - lw - 10, 8.5);
        pdf.text(colX[ci], my, label, 8.5, { bold: true });
        lines.forEach((ln, n) => pdf.text(colX[ci] + lw, my + n * 11, ln, 8.5));
        my += lines.length * 11 + 2;
      }
      maxY = Math.max(maxY, my);
    });
    y = maxY + 8;
  }

  // Table
  if (d.table && d.table.rows.length) {
    const t = d.table;
    const totalW = t.columns.reduce((s, c) => s + c.width, 0);
    const xs: number[] = [];
    let acc = L;
    for (const c of t.columns) {
      xs.push(acc);
      acc += ((R - L) * c.width) / totalW;
    }
    const colW = (i: number) => ((R - L) * t.columns[i].width) / totalW;
    const cellX = (i: number) =>
      t.columns[i].align === 'right' ? xs[i] + colW(i) - 4 : xs[i];
    const header = () => {
      pdf.rect(L, y - 10, R - L, 16);
      t.columns.forEach((c, i) =>
        pdf.text(cellX(i), y + 1, c.label, 7.5, {
          bold: true,
          align: c.align ?? 'left',
        }),
      );
      y += 18;
    };
    ensure(40);
    header();
    for (const row of t.rows) {
      const cells = row.map((v, i) => wrap(v || '-', colW(i) - 6, 8));
      const h = Math.max(...cells.map((c) => c.length)) * 10 + 6;
      if (ensure(h + 18)) header();
      cells.forEach((lines, i) =>
        lines.forEach((ln, k) =>
          pdf.text(cellX(i), y + k * 10, ln, 8, {
            align: t.columns[i].align ?? 'left',
          }),
        ),
      );
      y += h;
      pdf.line(L, y - 6, R, y - 6, 0.3, 0.85);
    }
    y += 4;
  }

  // Totals (right aligned)
  if (d.totals.length) {
    ensure(d.totals.length * 13 + 10);
    d.totals.forEach(([k, v], i) => {
      const bold = i === d.totals.length - 1;
      pdf.text(R - 130, y, k, 9, { bold, align: 'right' });
      pdf.text(R, y, v, 9, { bold, align: 'right' });
      y += 13;
    });
    y += 8;
  }

  for (const [k, v] of d.blocks) para(k, v);
  para('Declaration', d.declaration);

  ensure(50);
  y += 18;
  pdf.line(R - 200, y, R, y);
  for (const [n, w] of wrap(d.signatureLabel, 200, 8).entries())
    pdf.text(R, y + 12 + n * 10, w, 8, { align: 'right', gray: 0.3 });
  footer();
  return pdf.build();
}
