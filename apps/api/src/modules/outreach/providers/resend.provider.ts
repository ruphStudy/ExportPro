import { createHmac, timingSafeEqual } from 'crypto';
import { Logger } from '@nestjs/common';
import type { DomainStatus, OutreachEventType } from '@exportpro/types';
import {
  type NormalizedProviderEvent,
  type OutboundMessage,
  type OutreachProvider,
  OutreachSendError,
  type SendResult,
} from './outreach-provider';

const API = 'https://api.resend.com';
const WEBHOOK_TOLERANCE_S = 300;

const EVENT_MAP: Record<string, OutreachEventType> = {
  'email.sent': 'SENT',
  'email.delivered': 'DELIVERED',
  'email.opened': 'OPENED',
  'email.clicked': 'CLICKED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINT',
  'email.failed': 'FAILED',
};

/**
 * Real email delivery through Resend's HTTP API (no SDK dependency).
 * Delivery/open/bounce/complaint signals arrive via signed webhooks.
 * Resend does not report inbound replies, so replies are recorded
 * manually and labelled as such.
 */
export class ResendOutreachProvider implements OutreachProvider {
  private readonly logger = new Logger('ResendOutreachProvider');
  readonly name = 'resend';
  readonly label = 'Resend (real email delivery)';
  readonly channel = 'EMAIL' as const;
  readonly deliveryMode = 'PRODUCTION' as const;
  readonly configured = true;
  readonly handlesUnsubscribeHeader = false;
  readonly webhookConfigured: boolean;
  readonly capabilities = {
    realDelivery: true,
    delivered: true,
    // Requires open tracking enabled on the sending domain; never guaranteed.
    opened: true,
    replies: false,
    bounces: true,
    complaints: true,
    testSend: true,
  };

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string | undefined,
  ) {
    this.webhookConfigured = Boolean(webhookSecret);
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async validateConfiguration(
    fromEmail: string | null,
  ): Promise<{ status: DomainStatus; message: string }> {
    if (!fromEmail)
      return {
        status: 'NOT_CONFIGURED',
        message: 'Set a sender email address.',
      };
    const domain = fromEmail.split('@')[1]?.toLowerCase();
    try {
      const res = await fetch(`${API}/domains`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401 || res.status === 403)
        return { status: 'FAILED', message: 'Provider rejected the API key.' };
      if (!res.ok)
        return {
          status: 'PENDING',
          message: `Provider check unavailable (HTTP ${res.status}).`,
        };
      const json = (await res.json()) as {
        data?: { name: string; status: string }[];
      };
      const d = json.data?.find((x) => x.name.toLowerCase() === domain);
      if (!d)
        return {
          status: 'NOT_CONFIGURED',
          message: `Domain ${domain} is not added to the email provider.`,
        };
      if (d.status === 'verified')
        return {
          status: 'VERIFIED',
          message: `Domain ${domain} is verified by the provider.`,
        };
      if (d.status === 'failed')
        return {
          status: 'FAILED',
          message: `Domain ${domain} failed provider verification.`,
        };
      return {
        status: 'PENDING',
        message: `Domain ${domain} verification is ${d.status}.`,
      };
    } catch {
      return { status: 'PENDING', message: 'Provider check timed out.' };
    }
  }

  async send(m: OutboundMessage): Promise<SendResult> {
    const headers: Record<string, string> = {};
    if (m.unsubscribeUrl) {
      headers['List-Unsubscribe'] = `<${m.unsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    let res: Response;
    try {
      res = await fetch(`${API}/emails`, {
        method: 'POST',
        headers: this.headers({ 'Idempotency-Key': m.idempotencyKey }),
        body: JSON.stringify({
          from: `${m.fromName.replace(/[<>"]/g, '')} <${m.fromEmail}>`,
          to: [m.to],
          subject: m.subject,
          text: m.text,
          html: m.html,
          ...(m.replyTo ? { reply_to: m.replyTo } : {}),
          headers,
          tags: m.testSend ? [{ name: 'type', value: 'test' }] : undefined,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new OutreachSendError('NETWORK', 'Provider unreachable.', false);
    }
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return { providerMessageId: json.id ?? null, simulated: false };
    }
    if (res.status === 429 || res.status >= 500)
      throw new OutreachSendError(
        `HTTP_${res.status}`,
        'Provider temporarily unavailable.',
        false,
      );
    if (res.status === 401 || res.status === 403) {
      this.logger.error(
        'Email provider rejected credentials — check EMAIL_PROVIDER_API_KEY.',
      );
      throw new OutreachSendError(
        'AUTH',
        'Provider rejected credentials.',
        true,
      );
    }
    throw new OutreachSendError(
      `HTTP_${res.status}`,
      'Provider rejected the message.',
      true,
    );
  }

  /** Svix-style signature: base64(HMAC-SHA256(secret, `${id}.${ts}.${body}`)). */
  verifyWebhook(
    rawBody: Buffer,
    h: Record<string, string | undefined>,
  ): boolean {
    if (!this.webhookSecret) return false;
    const id = h['svix-id'];
    const ts = h['svix-timestamp'];
    const sig = h['svix-signature'];
    if (!id || !ts || !sig) return false;
    const t = Number(ts);
    if (
      !Number.isFinite(t) ||
      Math.abs(Date.now() / 1000 - t) > WEBHOOK_TOLERANCE_S
    )
      return false;
    const key = Buffer.from(
      this.webhookSecret.replace(/^whsec_/, ''),
      'base64',
    );
    const expected = createHmac('sha256', key)
      .update(`${id}.${ts}.${rawBody.toString('utf8')}`)
      .digest();
    return sig.split(' ').some((part) => {
      const [, value] = part.split(',');
      if (!value) return false;
      const got = Buffer.from(value, 'base64');
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
  }

  parseWebhook(payload: unknown): NormalizedProviderEvent[] {
    const p = payload as {
      type?: string;
      created_at?: string;
      data?: {
        email_id?: string;
        bounce?: { type?: string; subType?: string };
      };
    };
    const type = p?.type ? EVENT_MAP[p.type] : undefined;
    const emailId = p?.data?.email_id;
    if (!type || !emailId) return [];
    const occurredAt = p.created_at ? new Date(p.created_at) : new Date();
    return [
      {
        providerEventId: `${p.type}:${emailId}:${p.created_at ?? ''}`,
        providerMessageId: emailId,
        type,
        occurredAt: Number.isNaN(occurredAt.getTime())
          ? new Date()
          : occurredAt,
        permanentBounce:
          type === 'BOUNCED'
            ? (p.data?.bounce?.type ?? 'Permanent').toLowerCase() !==
              'transient'
            : undefined,
        // Only non-personal fields are retained.
        metadata: {
          providerType: p.type,
          bounceType: p.data?.bounce?.type ?? null,
        },
      },
    ];
  }
}
