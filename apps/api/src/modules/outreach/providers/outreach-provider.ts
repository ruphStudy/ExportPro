import type {
  DeliveryMode,
  DomainStatus,
  OutreachChannel,
  OutreachEventType,
  ProviderCapabilities,
} from '@exportpro/types';

export const OUTREACH_PROVIDER = Symbol('OUTREACH_PROVIDER');

export interface OutboundMessage {
  channel: OutreachChannel;
  idempotencyKey: string;
  to: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string;
  unsubscribeUrl: string | null;
  testSend: boolean;
}

export interface SendResult {
  providerMessageId: string | null;
  /** True when nothing left the system (development provider). */
  simulated: boolean;
}

/** permanent=false → bounded retry; permanent=true → mark FAILED, never retry. */
export class OutreachSendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

export interface NormalizedProviderEvent {
  providerEventId: string;
  providerMessageId: string;
  type: OutreachEventType;
  occurredAt: Date;
  /** For BOUNCED: true = hard/permanent bounce. */
  permanentBounce?: boolean;
  metadata: Record<string, unknown>;
}

/**
 * Channel provider contract. Campaign logic depends only on this
 * interface; selecting SES/SendGrid/Postmark/SMTP later means adding an
 * implementation and a factory branch — no campaign code changes.
 */
export interface OutreachProvider {
  readonly name: string;
  readonly label: string;
  readonly channel: OutreachChannel;
  readonly deliveryMode: DeliveryMode;
  readonly capabilities: ProviderCapabilities;
  readonly configured: boolean;
  readonly webhookConfigured: boolean;
  validateConfiguration(
    fromEmail: string | null,
  ): Promise<{ status: DomainStatus; message: string }>;
  send(message: OutboundMessage): Promise<SendResult>;
  /** Signature check over the exact raw body. Must reject anything unverified. */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean;
  parseWebhook(payload: unknown): NormalizedProviderEvent[];
  /** Whether the provider adds its own one-click unsubscribe handling. */
  readonly handlesUnsubscribeHeader: boolean;
}
