import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  SNAPSHOT_FIELDS,
  type CommercialSnapshot,
  type SampleStatus,
  type TermChange,
} from '@exportpro/types';
import { D, type Dec } from '../costing/costing-calculator';

/** Sprint 22 — pure rules for samples, negotiation and deal rooms (no guessing). */

// ------------------------------------------------------------ sanitization

/** Plain text only: strips tags and control characters (React escapes on render as well). */
export function plain(v: string | null | undefined, max = 4000): string | null {
  if (v === null || v === undefined) return null;
  const s = v
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
  return s || null;
}
export function safeFilename(name: string): string {
  const s = name
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 180);
  return s || 'document';
}

// ------------------------------------------------------------ samples

/** Generic status moves; courier/feedback/decision moves have dedicated endpoints. */
export const SAMPLE_TRANSITIONS: Record<SampleStatus, SampleStatus[]> = {
  REQUESTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COURIER_BOOKED', 'CANCELLED'],
  COURIER_BOOKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['FEEDBACK_RECEIVED', 'APPROVED', 'REJECTED'],
  FEEDBACK_RECEIVED: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};
export const SAMPLE_DECIDABLE: SampleStatus[] = ['DELIVERED', 'FEEDBACK_RECEIVED'];
export const SAMPLE_OPEN: SampleStatus[] = ['REQUESTED', 'PREPARING', 'READY', 'COURIER_BOOKED', 'SHIPPED', 'DELIVERED', 'FEEDBACK_RECEIVED'];

/** Only http(s) tracking links the user typed are shown; nothing is fetched. */
export function safeUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ negotiation

export const EMPTY_SNAPSHOT: CommercialSnapshot = {
  quantity: null,
  unit: null,
  unitPrice: null,
  currency: null,
  incoterm: null,
  namedPlace: null,
  paymentTerms: null,
  packaging: null,
  deliveryDate: null,
  leadTimeDays: null,
  specification: null,
  validUntil: null,
  otherTerms: null,
};
const LABELS: Record<(typeof SNAPSHOT_FIELDS)[number], string> = {
  quantity: 'Quantity',
  unit: 'Unit',
  unitPrice: 'Unit price',
  currency: 'Currency',
  incoterm: 'Incoterm',
  namedPlace: 'Named place',
  paymentTerms: 'Payment terms',
  packaging: 'Packaging',
  deliveryDate: 'Delivery date',
  leadTimeDays: 'Lead time (days)',
  specification: 'Specification',
  validUntil: 'Validity',
  otherTerms: 'Other terms',
};

/** Normalizes a snapshot; numeric fields are canonical decimal strings. */
export function normalizeSnapshot(s: Partial<CommercialSnapshot>, carry?: CommercialSnapshot | null): CommercialSnapshot {
  const out = { ...EMPTY_SNAPSHOT, ...(carry ?? {}) } as CommercialSnapshot;
  for (const k of SNAPSHOT_FIELDS) {
    if (!(k in s) || s[k] === undefined) continue;
    const v = s[k];
    if (v === null || v === '') (out as unknown as Record<string, unknown>)[k] = null;
    else if (k === 'leadTimeDays') out.leadTimeDays = Number(v);
    else if (k === 'quantity' || k === 'unitPrice') (out as unknown as Record<string, unknown>)[k] = new D(String(v)).toString();
    else if (k === 'currency' || k === 'incoterm' || k === 'unit') (out as unknown as Record<string, unknown>)[k] = String(v).trim().toUpperCase();
    else (out as unknown as Record<string, unknown>)[k] = plain(String(v), 2000);
  }
  return out;
}

const fmtPct = (d: Dec) => `${d.gt(0) ? '+' : ''}${d.toDecimalPlaces(2).toFixed(2)}%`;

/** Deterministic Old → New → Change for every term that differs. */
export function diffSnapshots(prev: CommercialSnapshot | null, next: CommercialSnapshot): TermChange[] {
  if (!prev) return [];
  const out: TermChange[] = [];
  for (const k of SNAPSHOT_FIELDS) {
    const a = prev[k];
    const b = next[k];
    if ((a ?? null) === (b ?? null)) continue;
    const from = a === null || a === undefined ? null : String(a);
    const to = b === null || b === undefined ? null : String(b);
    let change: string | null = null;
    let direction: TermChange['direction'] = from === null ? 'ADDED' : to === null ? 'REMOVED' : 'CHANGED';
    if ((k === 'quantity' || k === 'unitPrice' || k === 'leadTimeDays') && from !== null && to !== null) {
      const x = new D(from);
      const y = new D(to);
      direction = y.gt(x) ? 'UP' : 'DOWN';
      change = x.isZero() ? null : fmtPct(y.minus(x).div(x).mul(100));
      if (k === 'leadTimeDays') change = `${y.minus(x).gt(0) ? '+' : ''}${y.minus(x).toString()} days`;
    }
    if (k === 'unitPrice' && (prev.currency !== next.currency || prev.unit !== next.unit) && from && to) change = 'not comparable (currency/unit changed)';
    out.push({ field: k, label: LABELS[k], from: k === 'unitPrice' && from ? `${prev.currency ?? ''} ${from}/${prev.unit ?? 'unit'}`.trim() : from, to: k === 'unitPrice' && to ? `${next.currency ?? ''} ${to}/${next.unit ?? 'unit'}`.trim() : to, change, direction });
  }
  return out;
}

/** Advance % and credit days stated in payment-term wording (null when not stated). */
export function paymentTermProfile(t: string | null) {
  if (!t) return null;
  const l = t.toLowerCase();
  const adv = /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:advance|in advance|upfront|down)/.exec(l)?.[1] ?? (/\b(100%\s*)?advance\b/.test(l) && !/%/.test(l) ? '100' : null);
  const days = /(\d{1,3})\s*days?/.exec(l)?.[1] ?? null;
  const credit = /\b(da|d\/a|open account|credit|after (?:delivery|arrival|b\/?l))\b/.test(l);
  return { advancePercent: adv ? Number(adv) : credit ? 0 : null, creditDays: days ? Number(days) : null, credit };
}

/** True only when the stated terms are clearly worse for the exporter. */
export function paymentTermsWorsened(prev: string | null, next: string | null): string | null {
  const a = paymentTermProfile(prev);
  const b = paymentTermProfile(next);
  if (!a || !b) return null;
  if (a.advancePercent !== null && b.advancePercent !== null && b.advancePercent < a.advancePercent) return `Advance reduced from ${a.advancePercent}% to ${b.advancePercent}%.`;
  if (a.creditDays !== null && b.creditDays !== null && b.credit && b.creditDays > a.creditDays) return `Credit period extended from ${a.creditDays} to ${b.creditDays} days.`;
  if (!a.credit && b.credit) return 'Moved from advance terms to credit terms.';
  return null;
}

export function marginPercent(revenue: Dec, cost: Dec): Dec | null {
  return revenue.isZero() ? null : revenue.minus(cost).div(revenue).mul(100).toDecimalPlaces(2);
}

// ------------------------------------------------------------ deal room

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token), hint: token.slice(-4) };
}
/** Access codes are stored as salted SHA-256 (high-entropy token gates the room; the code is a second factor). */
export function hashCode(code: string, salt = randomBytes(12).toString('hex')) {
  return `${salt}:${sha256(`${salt}:${code}`)}`;
}
export function checkCode(code: string, stored: string) {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(sha256(`${salt}:${code}`));
  const b = Buffer.from(h ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

const SECRET = process.env.DEAL_ROOM_SESSION_SECRET ?? randomBytes(32).toString('hex');
/** Signed guest session (room + token version + expiry) — rotation/revocation invalidate it. */
export function signGuest(roomId: string, tokenVersion: number, email: string | null, ttlMs = 8 * 3600_000) {
  const body = Buffer.from(JSON.stringify({ r: roomId, v: tokenVersion, e: email, x: Date.now() + ttlMs })).toString('base64url');
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
export function readGuest(v: string | undefined): { r: string; v: number; e: string | null; x: number } | null {
  if (!v) return null;
  const [body, sig] = v.split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', SECRET).update(body).digest('base64url');
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { r: string; v: number; e: string | null; x: number };
    return p.x > Date.now() ? p : null;
  } catch {
    return null;
  }
}

/** Never shareable externally, whatever the request says. */
export const BLOCKED_DOC_TYPES = ['COSTING', 'COSTING_SCENARIO', 'PROFITABILITY', 'SUPPLIER_QUOTE', 'SUPPLIER_PO', 'SUPPLIER_ATTACHMENT', 'PROCUREMENT', 'GOODS_RECEIPT', 'AUDIT_LOG', 'RECEIVABLE', 'PAYMENT', 'BANK', 'INTERNAL_NOTE', 'NEGOTIATION'];

export function dealRoomStatus(r: { revokedAt: Date | null; expiresAt: Date }, now = new Date()) {
  return r.revokedAt ? 'REVOKED' : r.expiresAt <= now ? 'EXPIRED' : 'ACTIVE';
}
