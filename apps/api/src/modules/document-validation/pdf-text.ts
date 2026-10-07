import { inflateSync } from 'zlib';

/**
 * Minimal PDF text-layer reader (no OCR, no dependency): inflates Flate content
 * streams and collects strings shown with Tj/TJ/'/". Works for text-based PDFs
 * with standard single-byte fonts. Scanned/image-only or CID-font PDFs yield no
 * text, and the caller then reports "Text extraction not available" honestly.
 */
export function extractPdfText(buf: Buffer): string {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return '';
  const src = buf.toString('latin1');
  const out: string[] = [];
  const re = /<<((?:(?!>>)[\s\S])*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const dict = m[1];
    const start = m.index + m[0].length;
    const end = src.indexOf('endstream', start);
    if (end < 0) break;
    if (/\/Subtype\s*\/Image/.test(dict) || /\/Type\s*\/XObject/.test(dict))
      continue;
    let data = buf.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(data);
      } catch {
        continue;
      }
    } else if (/\/Filter/.test(dict)) continue;
    const text = showText(data.toString('latin1'));
    if (text.trim()) out.push(text);
    re.lastIndex = end;
  }
  return out
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unescape(s: string) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return (
      (
        {
          n: '\n',
          r: '\r',
          t: '\t',
          b: '',
          f: '',
          '(': '(',
          ')': ')',
          '\\': '\\',
        } as Record<string, string>
      )[c] ?? c
    );
  });
}

function hexText(h: string) {
  const clean = h.replace(/\s/g, '');
  let s = '';
  for (let i = 0; i + 1 < clean.length; i += 2)
    s += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  return /^[\x20-\x7e\n\t]*$/.test(s) ? s : '';
}

/** Walks content-stream operators; a new line starts at each text block / line move. */
function showText(content: string): string {
  if (!/\bBT\b/.test(content)) return '';
  let line = '';
  const lines: string[] = [];
  const flush = () => {
    if (line.trim()) lines.push(line.trim());
    line = '';
  };
  const tokens =
    /\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\[(?:\\.|[^\]])*\]|\b(?:Tj|TJ|Td|TD|T\*|Tm|ET|BT)\b|'|"/g;
  let pending = '';
  let t: RegExpExecArray | null;
  while ((t = tokens.exec(content))) {
    const v = t[0];
    if (v.startsWith('(')) pending += unescape(v.slice(1, -1));
    else if (v.startsWith('<')) pending += hexText(v.slice(1, -1));
    else if (v.startsWith('[')) {
      const parts =
        v
          .slice(1, -1)
          .match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|-?\d+(\.\d+)?/g) ?? [];
      for (const p of parts) {
        if (p.startsWith('(')) pending += unescape(p.slice(1, -1));
        else if (p.startsWith('<')) pending += hexText(p.slice(1, -1));
        else if (Number(p) < -200) pending += ' ';
      }
    } else if (v === 'Tj' || v === 'TJ') {
      line += pending;
      pending = '';
    } else if (v === "'" || v === '"') {
      flush();
      line += pending;
      pending = '';
    } else if (['Td', 'TD', 'T*', 'Tm', 'ET', 'BT'].includes(v)) {
      pending = '';
      flush();
    }
  }
  flush();
  return lines.join('\n');
}
