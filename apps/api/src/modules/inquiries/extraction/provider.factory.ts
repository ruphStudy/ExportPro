import { Logger } from '@nestjs/common';
import { AppConfig } from '../../../config/configuration';
import { AnthropicInquiryExtractionProvider } from './anthropic-extraction.provider';
import { DevelopmentInquiryExtractionProvider } from './development-extraction.provider';
import {
  ExtractionProviderError,
  type InquiryExtractionProvider,
} from './extraction-provider';

class UnconfiguredExtractionProvider implements InquiryExtractionProvider {
  readonly identity = {
    name: 'unconfigured',
    model: null,
    promptVersion: 'none',
    provenance: 'AI_DERIVED' as const,
  };
  extract(): Promise<never> {
    return Promise.reject(
      new ExtractionProviderError(
        'NOT_CONFIGURED',
        'AI extraction is not configured.',
      ),
    );
  }
}

/** Same selection rules as product classification: production never falls back to the development extractor. */
export function createExtractionProvider(
  ai: AppConfig['ai'],
  nodeEnv: AppConfig['app']['nodeEnv'],
): InquiryExtractionProvider {
  const logger = new Logger('InquiryExtractionProvider');
  const isProduction = nodeEnv === 'production';
  if (!ai.enabled) {
    logger.warn(
      'AI inquiry extraction disabled (AI_ENABLED=false) — manual RFQ entry only.',
    );
    return new UnconfiguredExtractionProvider();
  }
  const choice =
    ai.provider ??
    (ai.apiKey ? 'anthropic' : isProduction ? 'none' : 'development');
  if (choice === 'anthropic') {
    if (!ai.apiKey) return new UnconfiguredExtractionProvider();
    return new AnthropicInquiryExtractionProvider(
      ai.apiKey,
      ai.model,
      ai.timeoutMs,
    );
  }
  if (choice === 'development' && !isProduction) {
    logger.warn(
      'Using DEVELOPMENT rule-based inquiry extractor — not AI output.',
    );
    return new DevelopmentInquiryExtractionProvider();
  }
  return new UnconfiguredExtractionProvider();
}
