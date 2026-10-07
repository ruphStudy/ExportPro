import {
  type ExclusionReason,
  type SuppressionReason,
  TEMPLATE_VARIABLES,
  type TemplateValidation,
  type TemplateVariable,
} from '@exportpro/types';
import { analyzeEmail } from '../buyers/buyer-normalization';

/**
 * Deterministic outreach rules (Sprint 12). Template rendering is plain
 * substitution of a fixed variable allow-list — nothing is evaluated.
 */

const VAR_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const KNOWN = new Set<string>(TEMPLATE_VARIABLES);

export type VariableValues = Partial<Record<TemplateVariable, string | null>>;

/** Variables with a safe fallback when the value is unknown. */
const FALLBACKS: Partial<Record<TemplateVariable, string>> = {
  contactName: 'Sir/Madam',
};

export function extractVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VAR_RE)].map((m) => m[1]))];
}

export function validateTemplate(
  subject: string,
  body: string,
): TemplateValidation {
  const errors: string[] = [];
  if (!subject.trim()) errors.push('Subject is empty.');
  if (!body.trim()) errors.push('Message body is empty.');
  const unknownVariables = [
    ...extractVariables(subject),
    ...extractVariables(body),
  ].filter((v) => !KNOWN.has(v));
  const unique = [...new Set(unknownVariables)];
  if (unique.length)
    errors.push(
      `Unknown variable${unique.length > 1 ? 's' : ''}: ${unique.map((v) => `{{${v}}}`).join(', ')}.`,
    );
  const stray = (t: string) => /\{\{|\}\}/.test(t.replace(VAR_RE, ''));
  if (stray(subject) || stray(body)) errors.push('Unbalanced {{ }} braces.');
  return { valid: errors.length === 0, unknownVariables: unique, errors };
}

export interface Rendered {
  subject: string;
  body: string;
  /** Variables that had no value and no fallback — must not be sent. */
  unresolved: string[];
}

export function render(
  subject: string,
  body: string,
  values: VariableValues,
): Rendered {
  const unresolved = new Set<string>();
  const sub = (text: string) =>
    text.replace(VAR_RE, (whole, raw: string) => {
      const name = raw as TemplateVariable;
      if (!KNOWN.has(name)) {
        unresolved.add(raw);
        return whole;
      }
      const v = values[name]?.trim() || FALLBACKS[name];
      if (!v) {
        unresolved.add(name);
        return whole;
      }
      return v;
    });
  return {
    subject: sub(subject).replace(/\s+/g, ' ').trim(),
    body: sub(body),
    unresolved: [...unresolved],
  };
}

/** Plain text → minimal safe HTML. Bodies are never accepted as HTML. */
export function textToHtml(text: string): string {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${esc
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;
}

/** Only absolute http(s) URLs without credentials or private hosts. */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (u.username || u.password) return null;
    if (
      /^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname)
    )
      return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export const normalizeAddress = (a: string) => a.trim().toLowerCase();

export const SUPPRESSION_EXCLUSION: Record<SuppressionReason, ExclusionReason> =
  {
    UNSUBSCRIBED: 'SUPPRESSED_UNSUBSCRIBED',
    HARD_BOUNCE: 'SUPPRESSED_BOUNCE',
    COMPLAINT: 'SUPPRESSED_COMPLAINT',
    MANUAL_BLOCK: 'SUPPRESSED_MANUAL',
  };

export interface ContactCandidate {
  id: string;
  name: string | null;
  contactType: string;
  value: string;
  verificationStatus: string;
  confidence: number;
  isPrimary: boolean;
}

/**
 * Best usable email contact: email type, syntactically valid and not
 * INVALID. Format validity is NOT deliverability — it is only the minimum.
 */
export function pickEmailContact(
  contacts: ContactCandidate[],
  preferredId?: string | null,
): { contact: ContactCandidate | null; reason: ExclusionReason | null } {
  const emails = contacts.filter((c) => c.contactType === 'EMAIL');
  if (!emails.length) return { contact: null, reason: 'NO_CONTACT' };
  const usable = emails.filter(
    (c) => c.verificationStatus !== 'INVALID' && analyzeEmail(c.value)?.valid,
  );
  if (!usable.length) return { contact: null, reason: 'INVALID_CONTACT' };
  const preferred = preferredId
    ? usable.find((c) => c.id === preferredId)
    : null;
  const best =
    preferred ??
    [...usable].sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        b.confidence - a.confidence,
    )[0];
  return { contact: best, reason: null };
}

export interface EligibilityInput {
  address: string | null;
  contactReason: ExclusionReason | null;
  isDemo: boolean;
  production: boolean;
  suppression: SuppressionReason | null;
  duplicate: boolean;
  inCooldown: boolean;
  overCampaignLimit: boolean;
}

/** First failing rule wins, in a fixed, explainable order. */
export function exclusionReason(i: EligibilityInput): ExclusionReason | null {
  if (i.contactReason) return i.contactReason;
  if (!i.address) return 'NO_CONTACT';
  if (i.suppression) return SUPPRESSION_EXCLUSION[i.suppression];
  if (i.isDemo && i.production) return 'DEMO_RECIPIENT';
  if (i.duplicate) return 'DUPLICATE';
  if (i.inCooldown) return 'COOLDOWN';
  if (i.overCampaignLimit) return 'CAMPAIGN_LIMIT';
  return null;
}

/** null when the denominator is 0 or the metric is unsupported. */
export function rate(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator === null || denominator === null || denominator === 0)
    return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

const CLAIM_PATTERNS: { re: RegExp; label: string }[] = [
  {
    re: /(?:US\$|USD|INR|EUR|AED|₹|\$|€|£)\s?\d|\d\s?(?:USD|INR|EUR|AED)\b|per\s+(?:kg|mt|ton|tonne|unit|piece)/i,
    label: 'a price',
  },
  {
    re: /\b(?:ISO\s?\d{3,5}|HACCP|BRC|FSSC|GMP|Halal|Kosher|organic certified|USDA|FDA[- ]registered|CE marked|FSSAI|APEDA|Spices Board)\b/i,
    label: 'a certification or registration',
  },
  {
    re: /\b\d[\d,.]*\s?(?:MT|tons?|tonnes?|containers?|FCL|kg)\s*(?:per|\/|a)\s*(?:month|year|annum|week|day)\b/i,
    label: 'a capacity or volume figure',
  },
  {
    re: /\b(?:our (?:long[- ]standing|existing) (?:relationship|partnership)|as you know|following our (?:call|meeting)|thank you for your order|your previous orders?)\b/i,
    label: 'a prior relationship',
  },
];

/**
 * Deterministic honesty check on generated text: flags prices,
 * certifications, capacity and relationship claims that do not appear in
 * the facts the generator was given. Shown to the user before saving.
 */
export function unsupportedClaims(text: string, facts: string[]): string[] {
  const factText = facts.join('\n').toLowerCase();
  const out: string[] = [];
  for (const p of CLAIM_PATTERNS) {
    const m = text.match(p.re);
    if (m && !factText.includes(m[0].toLowerCase().trim()))
      out.push(
        `Mentions ${p.label} (“${m[0].trim()}”) that is not in your company data — verify or remove it.`,
      );
  }
  return out;
}

/** Masks an email for logs: ab***@example.com */
export const maskAddress = (a: string) =>
  a.replace(/^(.{0,2})[^@]*(@.*)$/, '$1***$2');

/** Signature and the unsubscribe line, appended as plain text. */
export function withFooter(
  body: string,
  signature: string | null,
  unsubscribeUrl: string | null,
) {
  const parts = [body.trimEnd()];
  if (signature?.trim() && !body.includes(signature.trim()))
    parts.push(signature.trim());
  if (unsubscribeUrl && !body.includes(unsubscribeUrl))
    parts.push(`—\nTo stop receiving these emails: ${unsubscribeUrl}`);
  return parts.join('\n\n');
}
