import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import {
  CLASSIFICATION_OUTPUT_JSON_SCHEMA,
  ClassificationProviderError,
  ClassificationRequest,
  ProductClassificationProvider,
  ProviderIdentity,
} from './classification-provider';

export const CLASSIFICATION_PROMPT_VERSION = 'hs-classify-v1';

const SYSTEM_PROMPT = `You assist Indian exporters by identifying products for trade purposes and suggesting HS / ITC-HS (India) codes. Your output is advisory analysis support, never a legal or customs determination.

Rules:
- Separate product identification (what the product is) from classification (which code may apply). Give each its own confidence (0-100).
- Classify conservatively. Confidence must reflect real uncertainty; do not give high confidence just because you produced one answer.
- If information material to classification is missing (material, composition, processing state, finished product vs part, garment construction, intended use, etc.), set ambiguity.isAmbiguous=true, explain why, list the alternatives, and ask up to 4 short, targeted clarifying questions with suggested answer options.
- Use HS codes at 6 digits (or 4 digits if only the heading can be determined). Only use 8-digit ITC_HS_INDIA codes when you are confident the national line exists; otherwise prefer the 6-digit HS subheading.
- Do not invent regulatory facts, duties, licences or certifications. Do not claim certainty.
- Do not fabricate detail that cannot be inferred from the input; use null for unknown identification fields.
- "category" must be one of the allowed category codes provided, or OTHER.
- primaryCandidate is null if no code can reasonably be suggested.`;

/**
 * Claude-backed provider. Uses structured outputs (output_config.format)
 * so the response is constrained JSON; the service still re-validates it.
 * SDK retries are disabled — the user decides whether to retry.
 */
export class AnthropicClassificationProvider implements ProductClassificationProvider {
  private readonly logger = new Logger(AnthropicClassificationProvider.name);
  private readonly client: Anthropic;
  readonly identity: ProviderIdentity;

  constructor(apiKey: string, model: string, timeoutMs: number) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 });
    this.identity = {
      name: 'anthropic',
      model,
      sourceType: 'AI_DERIVED',
      promptVersion: CLASSIFICATION_PROMPT_VERSION,
    };
  }

  async classify(request: ClassificationRequest): Promise<unknown> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.identity.model!,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'medium',
          format: {
            type: 'json_schema',
            schema: CLASSIFICATION_OUTPUT_JSON_SCHEMA,
          },
        },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(request) }],
      });
    } catch (error) {
      throw this.mapError(error);
    }

    if (response.stop_reason === 'refusal') {
      throw new ClassificationProviderError(
        'UNAVAILABLE',
        'Provider declined the request.',
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ClassificationProviderError(
        'INVALID_RESPONSE',
        'Provider output was truncated.',
      );
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new ClassificationProviderError(
        'INVALID_RESPONSE',
        'Provider returned malformed JSON.',
      );
    }
  }

  private mapError(error: unknown): ClassificationProviderError {
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new ClassificationProviderError('TIMEOUT', 'Provider timed out.');
    }
    if (error instanceof Anthropic.RateLimitError) {
      return new ClassificationProviderError(
        'RATE_LIMITED',
        'Provider rate limit reached.',
      );
    }
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      this.logger.error(
        'AI provider rejected credentials — check AI_PROVIDER_API_KEY.',
      );
      return new ClassificationProviderError(
        'NOT_CONFIGURED',
        'Provider credentials rejected.',
      );
    }
    if (error instanceof Anthropic.APIError) {
      this.logger.warn(
        `AI provider error status=${error.status ?? 'connection'}`,
      );
      return new ClassificationProviderError(
        'UNAVAILABLE',
        'Provider unavailable.',
      );
    }
    return new ClassificationProviderError(
      'UNAVAILABLE',
      'Provider unavailable.',
    );
  }
}

function buildUserMessage(request: ClassificationRequest): string {
  const lines = [
    `Allowed category codes: ${request.allowedCategoryCodes.join(', ')}`,
    `Input type: ${request.inputType}`,
    `User input: ${request.input}`,
  ];
  if (request.categoryHint)
    lines.push(`User-selected category: ${request.categoryHint}`);
  if (request.codeHint)
    lines.push(`User-entered code (unverified): ${request.codeHint}`);
  const details = Object.entries(request.details);
  if (details.length) {
    lines.push(
      'Additional details:',
      ...details.map(([k, v]) => `- ${k}: ${v}`),
    );
  }
  if (request.clarifications.length) {
    lines.push(
      'Answers to clarifying questions:',
      ...request.clarifications.map(
        (c) => `- Q: ${c.question}\n  A: ${c.answer}`,
      ),
    );
  }
  return lines.join('\n');
}
