import { Logger } from '@nestjs/common';
import type { DomainStatus } from '@exportpro/types';
import { maskAddress } from '../outreach-rules';
import type {
  NormalizedProviderEvent,
  OutboundMessage,
  OutreachProvider,
  SendResult,
} from './outreach-provider';

/**
 * Development delivery: the message is persisted (by the caller) and
 * marked simulated. Nothing is sent anywhere, and no delivered / opened /
 * replied / bounced signal is ever produced — those metrics stay
 * "Unavailable" rather than being faked.
 */
export class DevelopmentOutreachProvider implements OutreachProvider {
  private readonly logger = new Logger('DevelopmentOutreachProvider');
  readonly name = 'development';
  readonly label = 'Development delivery (nothing is sent)';
  readonly channel = 'EMAIL' as const;
  readonly deliveryMode = 'DEVELOPMENT' as const;
  readonly configured = true;
  readonly webhookConfigured = false;
  readonly handlesUnsubscribeHeader = false;
  readonly capabilities = {
    realDelivery: false,
    delivered: false,
    opened: false,
    replies: false,
    bounces: false,
    complaints: false,
    testSend: true,
  };

  validateConfiguration(): Promise<{ status: DomainStatus; message: string }> {
    return Promise.resolve({
      status: 'DEVELOPMENT_ONLY',
      message:
        'No email provider is configured. Messages are recorded locally and never delivered.',
    });
  }

  send(message: OutboundMessage): Promise<SendResult> {
    // Masked address only — never log bodies or full recipient data.
    this.logger.log(
      `[development] recorded ${message.testSend ? 'test ' : ''}message to ${maskAddress(message.to)} (not delivered)`,
    );
    return Promise.resolve({ providerMessageId: null, simulated: true });
  }

  /** No webhooks exist for the development provider. */
  verifyWebhook(): boolean {
    return false;
  }

  parseWebhook(): NormalizedProviderEvent[] {
    return [];
  }
}

/** Used when sending is disabled/misconfigured — fails closed. */
export class DisabledOutreachProvider implements OutreachProvider {
  readonly name = 'none';
  readonly label = 'Email sending not configured';
  readonly channel = 'EMAIL' as const;
  readonly deliveryMode = 'PRODUCTION' as const;
  readonly configured = false;
  readonly webhookConfigured = false;
  readonly handlesUnsubscribeHeader = false;
  readonly capabilities = {
    realDelivery: false,
    delivered: false,
    opened: false,
    replies: false,
    bounces: false,
    complaints: false,
    testSend: false,
  };

  validateConfiguration(): Promise<{ status: DomainStatus; message: string }> {
    return Promise.resolve({
      status: 'NOT_CONFIGURED',
      message: 'Email sending is not configured for this environment.',
    });
  }

  send(): Promise<SendResult> {
    return Promise.reject(
      new Error('Email sending is not configured for this environment.'),
    );
  }

  verifyWebhook(): boolean {
    return false;
  }

  parseWebhook(): NormalizedProviderEvent[] {
    return [];
  }
}
