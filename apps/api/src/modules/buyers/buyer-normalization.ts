import type { BuyerType, CompanySize, ImportFrequency } from '@exportpro/types';

/**
 * Deterministic normalization for buyer identity fields. Raw source values
 * are always retained on BuyerSourceRecord; these helpers only produce the
 * canonical forms used for matching and display.
 */

const LEGAL_SUFFIXES = new Set([
  'llc',
  'l l c',
  'fze',
  'fzco',
  'fzc',
  'fz',
  'gmbh',
  'ag',
  'kg',
  'ug',
  'ltd',
  'limited',
  'plc',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'est',
  'establishment',
  'sarl',
  'sa',
  'bv',
  'nv',
  'pvt',
  'private',
  'pte',
  'pty',
  'spa',
  'srl',
  'wll',
]);

/** Lowercase, strip accents/punctuation and trailing legal-form tokens. "Acme Gulf Foods Demo L.L.C." → "acme gulf foods". */
export function normalizeCompanyName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\./g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim();
  const tokens = base.split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    const last2 = tokens.slice(-2).join(' ');
    if (LEGAL_SUFFIXES.has(last2)) tokens.splice(-2, 2);
    else if (LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
    else break;
  }
  return tokens.join(' ');
}

/** Token-set Jaccard similarity of normalized names (0–1). Used only for POSSIBLE duplicates. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeCompanyName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeCompanyName(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export interface WebsiteInfo {
  input: string;
  valid: boolean;
  url: string | null;
  domain: string | null;
  problem: string | null;
}

/**
 * Syntax-only website validation: no network request is made (avoids SSRF
 * and never treats an outage as fraud). Rejects credentials, IP literals,
 * localhost, non-http(s) schemes and hosts without a TLD.
 */
export function normalizeWebsite(
  input: string | null | undefined,
): WebsiteInfo | null {
  const raw = input?.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return {
      input: raw,
      valid: false,
      url: null,
      domain: null,
      problem: 'Website address is malformed.',
    };
  }
  const host = u.hostname.toLowerCase();
  const bad = (problem: string): WebsiteInfo => ({
    input: raw,
    valid: false,
    url: null,
    domain: null,
    problem,
  });
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    return bad('Website must use http or https.');
  if (u.username || u.password)
    return bad('Website address contains credentials.');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':'))
    return bad('Website is an IP address, not a company domain.');
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
    return bad('Website is not a public domain.');
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))
    return bad('Website domain is not valid.');
  const domain = host.replace(/^www\./, '');
  return {
    input: raw,
    valid: true,
    url: `${u.protocol}//${host}${u.pathname === '/' ? '' : u.pathname}`,
    domain,
    problem: null,
  };
}

export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mail.ru',
  'yandex.ru',
  'yandex.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
  'qq.com',
  '163.com',
  'zoho.com',
]);

const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export interface EmailInfo {
  valid: boolean;
  domain: string | null;
  freeMail: boolean;
  generic: boolean;
}

const GENERIC_LOCALS = new Set([
  'info',
  'sales',
  'contact',
  'office',
  'hello',
  'admin',
  'enquiries',
  'enquiry',
  'mail',
  'support',
]);

/** Syntax and domain analysis only — no mailbox (SMTP) verification is performed. */
export function analyzeEmail(value: string): EmailInfo {
  const v = value.trim().toLowerCase();
  if (!EMAIL_RE.test(v) || v.includes('..'))
    return { valid: false, domain: null, freeMail: false, generic: false };
  const [local, domain] = v.split('@');
  return {
    valid: true,
    domain,
    freeMail: FREE_MAIL_DOMAINS.has(domain),
    generic: GENERIC_LOCALS.has(local),
  };
}

/** E.164-style check: "+" then 8–15 digits after removing separators. */
export function isValidPhone(value: string): boolean {
  const digits = value.replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(digits);
}

export function normalizePhone(value: string): string | null {
  const digits = value.replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** Maps source terminology to the canonical buyer type; the raw value is kept on the source record. Order matters: importer wins over distributor in "Importer & Distributor". */
export function normalizeBuyerType(raw: string | null | undefined): BuyerType {
  const v = raw?.toLowerCase() ?? '';
  if (!v.trim()) return 'UNKNOWN';
  if (/import|consignee/.test(v)) return 'IMPORTER';
  if (/distribut/.test(v)) return 'DISTRIBUTOR';
  if (/wholesal|cash and carry|trader/.test(v)) return 'WHOLESALER';
  if (/retail|supermarket|hypermarket|e-?commerce|store|shop/.test(v))
    return 'RETAILER';
  if (/manufactur|processor|factory|producer|brand owner/.test(v))
    return 'MANUFACTURER';
  if (/agent|broker|indent|sourcing office/.test(v)) return 'AGENT';
  return 'OTHER';
}

/**
 * Broad size category. Uses a source-stated category or employee range only;
 * never inferred from website, type or revenue guesses.
 * Employees: <10 MICRO, 10–49 SMALL, 50–249 MEDIUM, 250–999 LARGE, ≥1000 ENTERPRISE.
 */
export function normalizeCompanySize(
  raw: string | null | undefined,
): CompanySize {
  const v = raw?.trim().toLowerCase() ?? '';
  if (!v) return 'UNKNOWN';
  for (const s of ['micro', 'small', 'medium', 'large', 'enterprise'] as const)
    if (v === s) return s.toUpperCase() as CompanySize;
  const m = /(\d[\d,]*)\s*(?:-|to|–)?\s*(\d[\d,]*)?\s*\+?\s*employees?/.exec(v);
  if (!m) return 'UNKNOWN';
  const low = Number(m[1].replace(/,/g, ''));
  if (low >= 1000) return 'ENTERPRISE';
  if (low >= 250) return 'LARGE';
  if (low >= 50) return 'MEDIUM';
  if (low >= 10) return 'SMALL';
  return 'MICRO';
}

/**
 * Import frequency from shipment/transaction counts over the trailing 12
 * months: ≥24 HIGH_FREQUENCY (≈2+/month), 12–23 FREQUENT (≈monthly),
 * 4–11 REGULAR (≈quarterly), 1–3 OCCASIONAL. No history → UNKNOWN.
 */
export const FREQUENCY_THRESHOLDS = {
  HIGH_FREQUENCY: 24,
  FREQUENT: 12,
  REGULAR: 4,
  OCCASIONAL: 1,
} as const;

export function deriveImportFrequency(
  transactionsLast12m: number | null | undefined,
): ImportFrequency {
  if (transactionsLast12m === null || transactionsLast12m === undefined)
    return 'UNKNOWN';
  if (transactionsLast12m >= FREQUENCY_THRESHOLDS.HIGH_FREQUENCY)
    return 'HIGH_FREQUENCY';
  if (transactionsLast12m >= FREQUENCY_THRESHOLDS.FREQUENT) return 'FREQUENT';
  if (transactionsLast12m >= FREQUENCY_THRESHOLDS.REGULAR) return 'REGULAR';
  if (transactionsLast12m >= FREQUENCY_THRESHOLDS.OCCASIONAL)
    return 'OCCASIONAL';
  return 'UNKNOWN';
}

export const FREQUENCY_RANK: Record<ImportFrequency, number> = {
  UNKNOWN: 0,
  OCCASIONAL: 1,
  REGULAR: 2,
  FREQUENT: 3,
  HIGH_FREQUENCY: 4,
};

/** Strip control characters and trim; notes and manual fields are plain text, never HTML-rendered. */
export function sanitizeText(
  value: string | null | undefined,
  max: number,
): string | null {
  if (value === null || value === undefined) return null;
  // eslint-disable-next-line no-control-regex
  const v = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return v ? v.slice(0, max) : null;
}
