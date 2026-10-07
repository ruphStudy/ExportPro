/**
 * Minimal, dependency-free PDF 1.4 writer for commercial documents:
 * standard Helvetica fonts (WinAnsi), text, lines, filled rectangles and
 * an optional JPEG image. Output is deterministic for the same input
 * (no timestamps or random ids), so a re-generated issued document is
 * byte-identical.
 */

// Helvetica / Helvetica-Bold advance widths for ASCII 32–126 (Adobe AFM, 1/1000 em).
const W_REG = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
];

const REPLACE: Record<string, string> = {
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '•': '-',
  '×': 'x',
  '…': '...',
  '₹': 'INR ',
  '€': 'EUR ',
  '£': 'GBP ',
  ' ': ' ',
  '\t': ' ',
};

/** Restricts text to printable ASCII so standard fonts render it faithfully. */
export function pdfSafe(s: string): string {
  return [...s.normalize('NFKD').replace(/[̀-ͯ]/g, '')]
    .map(
      (c) =>
        REPLACE[c] ??
        (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126 ? c : '?'),
    )
    .join('');
}

export function textWidth(s: string, size: number, bold = false) {
  const w = bold ? W_BOLD : W_REG;
  let t = 0;
  for (const c of s) t += w[c.charCodeAt(0) - 32] ?? 556;
  return (t * size) / 1000;
}

/** Greedy word wrap (long words are hard-split). */
export function wrap(
  s: string,
  maxWidth: number,
  size: number,
  bold = false,
): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(s).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const cand = line ? `${line} ${word}` : word;
      if (textWidth(cand, size, bold) <= maxWidth) {
        line = cand;
        continue;
      }
      if (line) out.push(line);
      let w = word;
      while (textWidth(w, size, bold) > maxWidth && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && textWidth(w.slice(0, n), size, bold) > maxWidth) n--;
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

const esc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

export interface JpegImage {
  data: Buffer;
  width: number;
  height: number;
  components: number;
}

/** Reads dimensions from a baseline/progressive JPEG; null if not a JPEG. */
export function readJpeg(buf: Buffer): JpegImage | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    )
      return {
        data: buf,
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
        components: buf[i + 9],
      };
    i += 2 + len;
  }
  return null;
}

export class PdfDoc {
  readonly width = 595.28;
  readonly height = 841.89;
  private pages: string[] = [];
  private cur: string[] = [];
  private image: JpegImage | null = null;

  constructor() {
    this.addPage();
  }

  addPage() {
    if (this.cur.length || this.pages.length)
      this.pages.push(this.cur.join('\n'));
    this.cur = [];
  }

  get pageCount() {
    return this.pages.length + 1;
  }

  text(
    x: number,
    y: number,
    s: string,
    size = 9,
    opts: { bold?: boolean; gray?: number; align?: 'left' | 'right' } = {},
  ) {
    const t = pdfSafe(s);
    const bold = Boolean(opts.bold);
    const tx = opts.align === 'right' ? x - textWidth(t, size, bold) : x;
    const g = opts.gray ?? 0;
    this.cur.push(
      `BT ${g} g /${bold ? 'F2' : 'F1'} ${size} Tf ${n(tx)} ${n(this.height - y)} Td (${esc(t)}) Tj ET`,
    );
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width = 0.5,
    gray = 0.7,
  ) {
    this.cur.push(
      `${gray} G ${width} w ${n(x1)} ${n(this.height - y1)} m ${n(x2)} ${n(this.height - y2)} l S`,
    );
  }

  rect(x: number, y: number, w: number, h: number, gray = 0.93) {
    this.cur.push(
      `${gray} g ${n(x)} ${n(this.height - y - h)} ${n(w)} ${n(h)} re f 0 g`,
    );
  }

  /** Draws the (single) JPEG image scaled to fit w×h, top-left at (x, y). */
  jpeg(img: JpegImage, x: number, y: number, maxW: number, maxH: number) {
    this.image = img;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    this.cur.push(
      `q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(this.height - y - h)} cm /Im1 Do Q`,
    );
    return { w, h };
  }

  build(): Buffer {
    const pages = [...this.pages, this.cur.join('\n')];
    const objs: (string | Buffer)[] = [];
    const add = (o: string | Buffer) => objs.push(o) && objs.length;
    const catalog = add('');
    const pagesObj = add('');
    const f1 = add(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
    const f2 = add(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );
    let im = 0;
    if (this.image) {
      const cs =
        this.image.components === 1
          ? '/DeviceGray'
          : this.image.components === 4
            ? '/DeviceCMYK'
            : '/DeviceRGB';
      im = add(
        Buffer.concat([
          Buffer.from(
            `<< /Type /XObject /Subtype /Image /Width ${this.image.width} /Height ${this.image.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${this.image.data.length} >>\nstream\n`,
            'latin1',
          ),
          this.image.data,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      );
    }
    const pageIds: number[] = [];
    for (const content of pages) {
      const c = add(
        `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
      );
      pageIds.push(
        add(
          `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${im ? ` /XObject << /Im1 ${im} 0 R >>` : ''} >> /Contents ${c} 0 R >>`,
        ),
      );
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] =
      `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const chunks: Buffer[] = [
      Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1'),
    ];
    const offsets: number[] = [];
    let pos = chunks[0].length;
    objs.forEach((o, i) => {
      offsets.push(pos);
      const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
      const body = typeof o === 'string' ? Buffer.from(o, 'latin1') : o;
      const tail = Buffer.from('\nendobj\n', 'latin1');
      chunks.push(head, body, tail);
      pos += head.length + body.length + tail.length;
    });
    const xref = [
      `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`,
      ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
      `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`,
    ].join('');
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}
