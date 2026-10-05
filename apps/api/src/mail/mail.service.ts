import { Inject, Injectable, Logger } from '@nestjs/common';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');

/**
 * Thin facade over whatever MailProvider is bound in MailModule. Every
 * caller (auth, invitations, future notifications) depends on this
 * service, never on a concrete provider — swapping in a real
 * transactional-email provider later is a one-line change in
 * mail.module.ts, not a search-and-replace across features.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@Inject(MAIL_PROVIDER) private readonly provider: MailProvider) {}

  async send(message: MailMessage): Promise<void> {
    try {
      await this.provider.send(message);
    } catch (error) {
      this.logger.error(
        `Failed to send mail to ${message.to}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  sendVerificationCode(to: string, code: string) {
    return this.send({
      to,
      subject: 'Verify your ExportPro email',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    });
  }

  sendPasswordResetLink(to: string, resetUrl: string) {
    return this.send({
      to,
      subject: 'Reset your ExportPro password',
      text: `Reset your password: ${resetUrl}\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    });
  }

  sendOrganizationInvite(
    to: string,
    organizationName: string,
    acceptUrl: string,
  ) {
    return this.send({
      to,
      subject: `You've been invited to join ${organizationName} on ExportPro`,
      text: `You've been invited to join ${organizationName}. Accept your invitation: ${acceptUrl}\nThis link expires in 7 days.`,
    });
  }
}
