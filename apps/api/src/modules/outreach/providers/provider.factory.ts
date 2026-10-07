import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../../config/configuration';
import {
  DevelopmentOutreachProvider,
  DisabledOutreachProvider,
} from './development.provider';
import type { OutreachProvider } from './outreach-provider';
import { ResendOutreachProvider } from './resend.provider';

/**
 * Selects the email provider from env config. Production never falls
 * back to the development provider — without credentials it fails closed.
 */
export function createOutreachProvider(
  cfg: AppConfig['outreach'],
  nodeEnv: AppConfig['app']['nodeEnv'],
): OutreachProvider {
  const logger = new Logger('OutreachProvider');
  const prod = nodeEnv === 'production';
  const choice =
    cfg.provider ?? (cfg.apiKey ? 'resend' : prod ? 'none' : 'development');
  if (choice === 'resend') {
    if (!cfg.apiKey) {
      logger.error(
        'OUTREACH_EMAIL_PROVIDER=resend but EMAIL_PROVIDER_API_KEY is not set.',
      );
      return new DisabledOutreachProvider();
    }
    logger.log('Outreach email provider: Resend (real delivery).');
    return new ResendOutreachProvider(cfg.apiKey, cfg.webhookSecret);
  }
  if (choice === 'development' && !prod) {
    logger.warn(
      'Outreach email provider: DEVELOPMENT — messages are recorded, never delivered.',
    );
    return new DevelopmentOutreachProvider();
  }
  logger.warn('Outreach email sending is not configured.');
  return new DisabledOutreachProvider();
}
