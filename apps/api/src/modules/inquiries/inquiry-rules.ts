import type {
  InquiryClarificationQuestion,
  ConfirmedRfq,
  ExtractedRfq,
  InquiryPriority,
  MissingField,
  QualificationChecklist,
} from '@exportpro/types';

/**
 * Deterministic inquiry rules (no AI): HTML → safe text, priority
 * suggestion, missing-field summary, clarification questions,
 * qualification facts and CRM stage suggestion.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** Converts inbound email HTML to plain text. Script/style content is removed entirely; nothing is ever rendered as HTML. */
export function htmlToText(input: string): string {
  return input
    .replace(
      /<(script|style|head|title|iframe|object|embed|svg)[\s\S]*?<\/\1\s*>/gi,
      ' ',
    )
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6]|table|ul|ol)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d{1,5});/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const looksLikeHtml = (s: string) =>
  /<\s*(html|body|div|p|br|table|span|a|script|style)\b/i.test(s);

/** Strips control characters (keeps newlines/tabs) and caps length. */
export function cleanText(
  s: string | null | undefined,
  max: number,
): string | null {
  if (s === null || s === undefined) return null;
  // eslint-disable-next-line no-control-regex
  const v = s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return v ? v.slice(0, max) : null;
}

const URGENT_WORDS =
  /\b(urgent(?:ly)?|asap|as soon as possible|immediately)\b/i;

/**
 * Priority suggestion (kept separate from the chosen priority):
 *  URGENT — only when the buyer explicitly says urgent/ASAP/immediately;
 *  HIGH   — buyer reply to outreach, linked lead already QUALIFIED or later,
 *           or a clearly stated large quantity (≥10 MT, ≥10,000 kg or ≥1 container);
 *  LOW    — no product or quantity identifiable;
 *  MEDIUM — otherwise.
 */
export function suggestPriority(i: {
  text: string;
  source: string;
  leadStage: string | null;
  items: { quantity: number | null; unit: string | null }[];
}): { priority: InquiryPriority; reasons: string[] } {
  const reasons: string[] = [];
  const urgent = URGENT_WORDS.exec(i.text);
  if (urgent)
    return { priority: 'URGENT', reasons: [`Buyer wrote “${urgent[0]}”.`] };
  if (i.source === 'EMAIL_REPLY')
    reasons.push('Buyer replied to your outreach.');
  if (
    i.leadStage &&
    [
      'QUALIFIED',
      'QUOTATION',
      'NEGOTIATION',
      'SAMPLE',
      'PO',
      'SHIPMENT',
    ].includes(i.leadStage)
  )
    reasons.push(`CRM lead is already ${i.leadStage.toLowerCase()}.`);
  const big = i.items.find(
    (x) =>
      x.quantity !== null &&
      ((x.unit === 'MT' && x.quantity >= 10) ||
        (x.unit === 'KG' && x.quantity >= 10_000) ||
        (x.unit === 'CONTAINER' && x.quantity >= 1)),
  );
  if (big) reasons.push(`Large stated quantity (${big.quantity} ${big.unit}).`);
  if (reasons.length) return { priority: 'HIGH', reasons };
  if (!i.items.length)
    return {
      priority: 'LOW',
      reasons: ['No product with a quantity identified yet.'],
    };
  return { priority: 'MEDIUM', reasons: ['Standard inquiry.'] };
}

const LABELS: Record<string, string> = {
  product: 'Product',
  quantity: 'Quantity',
  destination: 'Destination (country or port)',
  incoterm: 'Incoterm',
  delivery: 'Delivery date / shipment window',
  payment: 'Payment terms',
  packaging: 'Packaging',
};

/** Missing/low-confidence essentials — from the confirmed RFQ when present, otherwise from the latest extraction. */
export function missingFields(
  confirmed: ConfirmedRfq | null,
  extracted: ExtractedRfq | null,
): MissingField[] {
  const out: MissingField[] = [];
  const add = (field: string, reason: MissingField['reason']) =>
    out.push({ field, label: LABELS[field] ?? field, reason });
  if (confirmed) {
    if (!confirmed.items.length) add('product', 'MISSING');
    if (confirmed.items.some((i) => !i.quantity)) add('quantity', 'MISSING');
    if (!confirmed.destination.countryCode && !confirmed.destination.port)
      add('destination', 'MISSING');
    if (!confirmed.incoterm.term) add('incoterm', 'MISSING');
    if (
      !confirmed.delivery.targetDate &&
      !confirmed.delivery.shipmentWindow &&
      !confirmed.delivery.leadTime
    )
      add('delivery', 'MISSING');
    if (!confirmed.paymentTerms.type) add('payment', 'MISSING');
    if (confirmed.items.some((i) => !i.packaging)) add('packaging', 'MISSING');
    return out;
  }
  if (!extracted) return [];
  const st = (f: { value: unknown; confidence: string; ambiguous: boolean }) =>
    f.value === null
      ? f.ambiguous
        ? 'AMBIGUOUS'
        : 'MISSING'
      : f.ambiguous
        ? 'AMBIGUOUS'
        : f.confidence === 'LOW'
          ? 'LOW_CONFIDENCE'
          : null;
  if (!extracted.items.length) add('product', 'MISSING');
  const q = extracted.items.map((i) => st(i.quantity)).find(Boolean);
  if (q) add('quantity', q as MissingField['reason']);
  const dest =
    extracted.destination.countryCode.value === null &&
    extracted.destination.port.value === null
      ? extracted.destination.countryCode.ambiguous
        ? 'AMBIGUOUS'
        : 'MISSING'
      : null;
  if (dest) add('destination', dest);
  const inc = st(extracted.incoterm.term);
  if (inc) add('incoterm', inc as MissingField['reason']);
  const d = extracted.delivery;
  if (
    d.targetDate.value === null &&
    d.shipmentWindow.value === null &&
    d.leadTime.value === null
  )
    add('delivery', 'MISSING');
  const pay = st(extracted.paymentTerms.type);
  if (pay) add('payment', pay as MissingField['reason']);
  if (
    extracted.items.length &&
    extracted.items.some((i) => i.packaging.value === null)
  )
    add('packaging', 'MISSING');
  return out;
}

const QUESTION: Record<string, string> = {
  product: 'Could you confirm the exact product(s) and grade you require?',
  quantity: 'Please confirm the required quantity and unit for each product.',
  destination:
    'Which destination country and port of discharge should we quote for?',
  incoterm: 'Which Incoterm would you like us to quote (e.g. FOB or CIF)?',
  delivery: 'What is your required delivery date or shipment window?',
  payment: 'What payment terms do you propose (e.g. advance, LC, DP)?',
  packaging: 'Which packaging and pack size do you need?',
};

/** Editable suggestions: deterministic questions for missing fields plus AI-suggested ones (labelled). Never sent automatically. */
export function suggestQuestions(
  missing: MissingField[],
  ai: string[],
): InquiryClarificationQuestion[] {
  const out: InquiryClarificationQuestion[] = missing.map((m) => ({
    text: QUESTION[m.field] ?? `Please clarify: ${m.label}.`,
    source: 'SYSTEM' as const,
  }));
  for (const q of ai)
    if (!out.some((o) => o.text.toLowerCase() === q.toLowerCase()))
      out.push({ text: q, source: 'AI_SUGGESTED' });
  return out.slice(0, 10);
}

export function clarificationDraft(
  subject: string,
  buyerName: string,
  questions: InquiryClarificationQuestion[],
) {
  return [
    `Subject: Re: ${subject}`,
    '',
    `Dear ${buyerName || 'Sir/Madam'},`,
    '',
    'Thank you for your inquiry. To prepare an accurate offer, could you please confirm the following:',
    ...questions.map((q, i) => `${i + 1}. ${q.text}`),
    '',
    'Best regards,',
  ].join('\n');
}

export const QUALIFICATION_LABELS: Record<
  keyof QualificationChecklist,
  string
> = {
  buyerIdentified: 'Buyer identified',
  productIdentified: 'Product identified',
  quantityKnown: 'Quantity known',
  destinationKnown: 'Destination known',
  requirementClear: 'Requirement sufficiently clear',
  contactAvailable: 'Contact available',
  commercialReviewed: 'Commercial viability reviewed',
};

/** System-checkable facts behind the checklist (null = needs human judgement). */
export function qualificationFacts(i: {
  buyerKnown: boolean;
  confirmed: ConfirmedRfq | null;
  contactKnown: boolean;
}): {
  key: keyof QualificationChecklist;
  label: string;
  met: boolean | null;
  detail: string;
}[] {
  const c = i.confirmed;
  return [
    {
      key: 'buyerIdentified',
      label: QUALIFICATION_LABELS.buyerIdentified,
      met: i.buyerKnown,
      detail: i.buyerKnown
        ? 'Linked buyer or named company.'
        : 'No buyer recorded.',
    },
    {
      key: 'productIdentified',
      label: QUALIFICATION_LABELS.productIdentified,
      met: c ? c.items.length > 0 : false,
      detail: c
        ? `${c.items.length} confirmed item(s).`
        : 'RFQ not confirmed yet.',
    },
    {
      key: 'quantityKnown',
      label: QUALIFICATION_LABELS.quantityKnown,
      met: c
        ? c.items.length > 0 && c.items.every((x) => Boolean(x.quantity))
        : false,
      detail: c ? 'From confirmed items.' : 'RFQ not confirmed yet.',
    },
    {
      key: 'destinationKnown',
      label: QUALIFICATION_LABELS.destinationKnown,
      met: c ? Boolean(c.destination.countryCode || c.destination.port) : false,
      detail: c ? 'From confirmed RFQ.' : 'RFQ not confirmed yet.',
    },
    {
      key: 'requirementClear',
      label: QUALIFICATION_LABELS.requirementClear,
      met: null,
      detail: 'Your judgement.',
    },
    {
      key: 'contactAvailable',
      label: QUALIFICATION_LABELS.contactAvailable,
      met: i.contactKnown,
      detail: i.contactKnown
        ? 'Contact email or buyer contact on record.'
        : 'No contact recorded.',
    },
    {
      key: 'commercialReviewed',
      label: QUALIFICATION_LABELS.commercialReviewed,
      met: null,
      detail: 'Your judgement.',
    },
  ];
}

/** CRM stage suggestion only — never applied; the user confirms in CRM. */
export function crmStageSuggestion(
  stage: string,
  hasConfirmedItems: boolean,
): { stage: string; reason: string } | null {
  if (stage === 'NEW' || stage === 'CONTACTED')
    return { stage: 'REPLIED', reason: 'The buyer sent an inquiry.' };
  if (stage === 'REPLIED' && hasConfirmedItems)
    return {
      stage: 'INTERESTED',
      reason:
        'The buyer sent a concrete RFQ (products and quantities confirmed).',
    };
  return null;
}

/** Token-set similarity of subjects for fuzzy duplicate warnings. */
export function subjectSimilarity(a: string, b: string) {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/^(re|fw|fwd):\s*/i, '')
        .split(/\W+/)
        .filter((w) => w.length > 2),
    );
  const x = tok(a);
  const y = tok(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}
