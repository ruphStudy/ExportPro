import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import type { GenerationType, OutreachTone } from '@exportpro/types';
import type { AppConfig } from '../../../config/configuration';

export const OUTREACH_CONTENT_PROVIDER = Symbol('OUTREACH_CONTENT_PROVIDER');

export interface ContentRequest {
  type: GenerationType;
  tone: OutreachTone;
  language: string;
  languageLabel: string;
  instructions: string | null;
  /** The ONLY facts the generator may use, one per line, built from the database. */
  facts: string[];
  /** True when a single, non-demo buyer is targeted and buyer facts may be referenced. */
  buyerSpecific: boolean;
}

export interface ContentResult {
  subject: string;
  body: string;
}

export class ContentProviderError extends Error {
  constructor(
    readonly code: 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
  }
}

export interface OutreachContentProvider {
  readonly name: string;
  /** False for the deterministic development generator. */
  readonly aiGenerated: boolean;
  readonly languages: 'ANY' | string[];
  generate(req: ContentRequest): Promise<ContentResult>;
}

const TYPE_GUIDE: Record<GenerationType, string> = {
  INTRODUCTION:
    'a first introduction of the exporter and product to an importer',
  CATALOG: 'an offer to share a product catalogue / specifications',
  QUOTATION_INTRODUCTION:
    'an invitation to discuss a quotation, asking for specification, quantity, packaging, destination and Incoterms. Do NOT state any price or terms.',
  SAMPLE_OFFER:
    'an offer to discuss sending samples, asking what specification and delivery address they need. Do NOT promise dates or free samples.',
  FOLLOW_UP:
    'a short, polite follow-up to an earlier message that offers an easy way to decline',
};

const SYSTEM = `You write B2B export outreach emails for an Indian exporter. The user will review and edit before anything is sent.

Hard rules — honesty:
- Use ONLY the facts provided. Never invent certifications, registrations, prices, production capacity, delivery times, awards, years in business, clients, buyer history, import volumes, transactions or any prior relationship.
- If a fact is not provided, leave it out. Do not hint at it.
- Only reference the buyer's activity or products when the facts explicitly include them.
- No pressure tactics, false urgency, all-caps or spam language. No emojis.
- Plain text only (no HTML, no markdown). Do not include links other than the {{website}} variable.

Personalization variables — use these exact placeholders instead of real names so one draft works for every recipient:
{{buyerCompany}}, {{contactName}}, {{productName}}, {{country}}, {{senderName}}, {{companyName}}, {{website}}, {{hsCode}}.
Do not use any other {{...}} placeholder.
Start with "Dear {{contactName}}," and end with a sign-off using {{senderName}} and {{companyName}}.
Keep the body under 180 words.`;

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body'],
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
  },
};

export class AnthropicContentProvider implements OutreachContentProvider {
  private readonly logger = new Logger('AnthropicContentProvider');
  private readonly client: Anthropic;
  readonly name: string;
  readonly aiGenerated = true;
  readonly languages = 'ANY' as const;

  constructor(
    apiKey: string,
    private readonly model: string,
    timeoutMs: number,
  ) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 });
    this.name = `anthropic:${model}`;
  }

  async generate(req: ContentRequest): Promise<ContentResult> {
    const user = [
      `Write ${TYPE_GUIDE[req.type]}.`,
      `Tone: ${req.tone.toLowerCase()}.`,
      `Language: ${req.languageLabel} (${req.language}). Keep the {{...}} placeholders untranslated.`,
      req.buyerSpecific
        ? 'You may reference the buyer facts below.'
        : 'This draft goes to several buyers: do not reference any single buyer’s activity.',
      'Facts (the only information you may use):',
      ...req.facts.map((f) => `- ${f}`),
      req.instructions
        ? `User instructions (follow only if consistent with the rules): ${req.instructions}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 2000,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: JSON_SCHEMA },
        },
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      });
    } catch (e) {
      this.logger.warn(
        `Content provider error: ${e instanceof Anthropic.APIError ? e.status : 'connection'}`,
      );
      throw new ContentProviderError('UNAVAILABLE', 'AI provider unavailable.');
    }
    if (
      response.stop_reason === 'refusal' ||
      response.stop_reason === 'max_tokens'
    )
      throw new ContentProviderError(
        'INVALID_RESPONSE',
        'AI provider returned no usable draft.',
      );
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    try {
      const j = JSON.parse(text) as ContentResult;
      if (typeof j.subject !== 'string' || typeof j.body !== 'string')
        throw new Error();
      return { subject: j.subject.trim(), body: j.body.trim() };
    } catch {
      throw new ContentProviderError(
        'INVALID_RESPONSE',
        'AI provider returned malformed output.',
      );
    }
  }
}

/**
 * Deterministic composer used when no AI provider is configured (outside
 * production). It is NOT AI and is labelled as such; it only arranges
 * the supplied facts into a neutral draft. English only.
 */
export class DevelopmentContentProvider implements OutreachContentProvider {
  readonly name = 'development-composer';
  readonly aiGenerated = false;
  readonly languages = ['en'];

  generate(req: ContentRequest): Promise<ContentResult> {
    const close =
      req.tone === 'WARM'
        ? 'Warm regards'
        : req.tone === 'FORMAL'
          ? 'Yours faithfully'
          : 'Best regards';
    const sign = `${close},\n{{senderName}}\n{{companyName}}`;
    const buyerLine =
      req.buyerSpecific &&
      req.facts.some((f) => f.startsWith('Buyer known products:'))
        ? `We understand {{buyerCompany}} works with products related to {{productName}}, so this may be relevant to your sourcing.\n\n`
        : '';
    const bodies: Record<GenerationType, [string, string]> = {
      INTRODUCTION: [
        '{{productName}} from India — {{companyName}}',
        `Dear {{contactName}},\n\nI am writing from {{companyName}}, an exporter of {{productName}} (HS {{hsCode}}) from India.\n\n${buyerLine}We would like to understand whether {{buyerCompany}} is sourcing {{productName}} for the {{country}} market, and if so, what specifications matter to you.\n\n${sign}`,
      ],
      CATALOG: [
        '{{productName}} catalogue for {{buyerCompany}}',
        `Dear {{contactName}},\n\n${buyerLine}{{companyName}} can share product details and specifications for {{productName}} (HS {{hsCode}}).\n\nWould it be useful if I sent our catalogue? Please let me know the grades or packaging you usually buy.\n\n${sign}`,
      ],
      QUOTATION_INTRODUCTION: [
        'Quotation request details — {{productName}}',
        `Dear {{contactName}},\n\nWe would be glad to prepare a quotation for {{productName}} for {{buyerCompany}}.\n\nCould you share the specification, quantity, packaging, destination port in {{country}} and preferred Incoterms?\n\n${sign}`,
      ],
      SAMPLE_OFFER: [
        'Samples of {{productName}}',
        `Dear {{contactName}},\n\nIf it helps {{buyerCompany}} evaluate our {{productName}}, we can discuss arranging samples.\n\nPlease let me know the specification you would like to test and where they should be delivered in {{country}}.\n\n${sign}`,
      ],
      FOLLOW_UP: [
        'Re: {{productName}} for {{buyerCompany}}',
        `Dear {{contactName}},\n\nI am following up on my earlier note about {{productName}}. If it is not relevant for {{buyerCompany}} right now, just let me know and I will not follow up again.\n\n${sign}`,
      ],
    };
    const [subject, body] = bodies[req.type];
    return Promise.resolve({ subject, body });
  }
}

class UnavailableContentProvider implements OutreachContentProvider {
  readonly name = 'none';
  readonly aiGenerated = false;
  readonly languages = [];
  generate(): Promise<ContentResult> {
    return Promise.reject(
      new ContentProviderError(
        'NOT_CONFIGURED',
        'AI message generation is not configured.',
      ),
    );
  }
}

/** Mirrors the Sprint 5 classification provider selection rules. */
export function createContentProvider(
  ai: AppConfig['ai'],
  nodeEnv: AppConfig['app']['nodeEnv'],
): OutreachContentProvider {
  if (!ai.enabled) return new UnavailableContentProvider();
  const prod = nodeEnv === 'production';
  const choice =
    ai.provider ?? (ai.apiKey ? 'anthropic' : prod ? 'none' : 'development');
  if (choice === 'anthropic' && ai.apiKey)
    return new AnthropicContentProvider(ai.apiKey, ai.model, ai.timeoutMs);
  if (choice === 'development' && !prod)
    return new DevelopmentContentProvider();
  return new UnavailableContentProvider();
}
