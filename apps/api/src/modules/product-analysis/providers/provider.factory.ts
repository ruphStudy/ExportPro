import { Logger } from '@nestjs/common';
import { AppConfig } from '../../../config/configuration';
import { AnthropicClassificationProvider } from './anthropic-classification.provider';
import {
  ClassificationProviderError,
  ProductClassificationProvider,
} from './classification-provider';
import { DevelopmentClassificationProvider } from './development-classification.provider';

class UnconfiguredClassificationProvider implements ProductClassificationProvider {
  readonly identity = {
    name: 'unconfigured',
    model: null,
    sourceType: 'AI_DERIVED' as const,
    promptVersion: 'none',
  };

  async classify(): Promise<never> {
    throw new ClassificationProviderError(
      'NOT_CONFIGURED',
      'No classification provider is configured.',
    );
  }
}

/**
 * Chooses the provider from config. Production never falls back to the
 * development provider: without a working AI configuration it fails
 * safely (every analysis request returns "temporarily unavailable").
 */
export function createClassificationProvider(
  ai: AppConfig['ai'],
  nodeEnv: AppConfig['app']['nodeEnv'],
): ProductClassificationProvider {
  const logger = new Logger('ClassificationProvider');
  const isProduction = nodeEnv === 'production';

  if (!ai.enabled) {
    logger.warn('AI classification disabled (AI_ENABLED=false).');
    return new UnconfiguredClassificationProvider();
  }

  const choice =
    ai.provider ??
    (ai.apiKey ? 'anthropic' : isProduction ? 'none' : 'development');

  if (choice === 'anthropic') {
    if (!ai.apiKey) {
      logger.error('AI_PROVIDER=anthropic but AI_PROVIDER_API_KEY is not set.');
      return new UnconfiguredClassificationProvider();
    }
    logger.log(`Using Anthropic classification provider (model ${ai.model}).`);
    return new AnthropicClassificationProvider(
      ai.apiKey,
      ai.model,
      ai.timeoutMs,
    );
  }
  if (choice === 'development') {
    if (isProduction) {
      logger.error(
        'Development classification provider is not allowed in production.',
      );
      return new UnconfiguredClassificationProvider();
    }
    logger.warn(
      'Using DEVELOPMENT classification provider — results are demo data, not AI output.',
    );
    return new DevelopmentClassificationProvider();
  }
  logger.warn('No classification provider configured.');
  return new UnconfiguredClassificationProvider();
}
