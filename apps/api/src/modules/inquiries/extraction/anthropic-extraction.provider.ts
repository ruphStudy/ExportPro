import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { EXTRACTION_JSON_SCHEMA } from './extraction-schema';
import {
  type ExtractionIdentity,
  ExtractionProviderError,
  type ExtractionRequest,
  type InquiryExtractionProvider,
  sourceText,
} from './extraction-provider';

export const EXTRACTION_PROMPT_VERSION = 'rfq-extract-v1';

const SYSTEM_PROMPT = `You extract structured RFQ data from inbound buyer inquiries for an Indian exporter. Output is reviewed by a human before it is used; it is never final.

Strict rules:
- Extract ONLY from the inquiry subject, body, attachment text and supplied metadata. Never use outside knowledge to fill commercial terms.
- Never infer or invent missing values: quantity, price, certification, payment terms, destination, delivery date, specification. Unknown = value null.
- Preserve the buyer's wording in "raw" for every value you extract.
- explicit=true only when the value is literally stated; if you derive something (e.g. a country from a port name), set explicit=false and confidence LOW or MEDIUM.
- Return each requested product as a separate item, each with its own quantity, specification and packaging. Never merge products.
- Quantities keep their stated unit; never convert units (e.g. containers to MT).
- Prices like "around $2/kg" or "target" are indicative: set priceIndicative=true. Do not turn ranges or approximations into exact prices.
- hsCode only if an HS code is written in the inquiry. You may give an hsSuggestion separately; it is unconfirmed.
- destination.countryCode is an ISO 3166-1 alpha-2 code only when the country is clear; if ambiguous, leave null and add an ambiguity.
- Incoterm only from: EXW, FCA, FOB, CFR, CIF, CPT, CIP, DAP, DPU, DDP. If unclear, leave null and add an ambiguity.
- Certifications are only what the buyer requests; do not judge whether they are legally required.
- Give a confidence (HIGH/MEDIUM/LOW) per field and flag ambiguous fields with a short note. List ambiguities and short clarification questions for missing or unclear essentials.
- overallConfidence (0-100) reflects how complete and clear the request is.`;

/** Claude-backed extractor using structured outputs; output is still re-validated and grounded by the service. */
export class AnthropicInquiryExtractionProvider implements InquiryExtractionProvider {
  private readonly logger = new Logger(AnthropicInquiryExtractionProvider.name);
  private readonly client: Anthropic;
  readonly identity: ExtractionIdentity;

  constructor(apiKey: string, model: string, timeoutMs: number) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 });
    this.identity = {
      name: 'anthropic',
      model,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      provenance: 'AI_DERIVED',
    };
  }

  async extract(request: ExtractionRequest): Promise<unknown> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.identity.model!,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: EXTRACTION_JSON_SCHEMA },
        },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Metadata: buyer country ${request.metadata.buyerCountry ?? 'unknown'}; received ${request.metadata.receivedAt}.\n\nInquiry:\n${sourceText(request).slice(0, 60_000)}`,
          },
        ],
      });
    } catch (error) {
      throw this.mapError(error);
    }
    if (response.stop_reason === 'refusal')
      throw new ExtractionProviderError(
        'UNAVAILABLE',
        'Provider declined the request.',
      );
    if (response.stop_reason === 'max_tokens')
      throw new ExtractionProviderError(
        'INVALID_RESPONSE',
        'Provider output was truncated.',
      );
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new ExtractionProviderError(
        'INVALID_RESPONSE',
        'Provider returned malformed JSON.',
      );
    }
  }

  private mapError(error: unknown): ExtractionProviderError {
    if (error instanceof Anthropic.APIConnectionTimeoutError)
      return new ExtractionProviderError('TIMEOUT', 'Provider timed out.');
    if (error instanceof Anthropic.RateLimitError)
      return new ExtractionProviderError(
        'RATE_LIMITED',
        'Provider rate limit reached.',
      );
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      this.logger.error(
        'AI provider rejected credentials — check AI_PROVIDER_API_KEY.',
      );
      return new ExtractionProviderError(
        'NOT_CONFIGURED',
        'Provider credentials rejected.',
      );
    }
    if (error instanceof Anthropic.APIError)
      this.logger.warn(
        `AI provider error status=${error.status ?? 'connection'}`,
      );
    return new ExtractionProviderError('UNAVAILABLE', 'Provider unavailable.');
  }
}
