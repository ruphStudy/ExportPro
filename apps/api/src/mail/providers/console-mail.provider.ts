import { Injectable, Logger } from '@nestjs/common';
import { MailMessage, MailProvider } from '../mail.service';

export interface SentMail extends MailMessage {
  sentAt: string;
}

const MAX_OUTBOX_SIZE = 50;

/**
 * Development-only transport: logs the email and keeps a short in-memory
 * outbox so DevMailboxController can serve it back during manual/E2E
 * testing when no real SMTP/provider is configured. Never wired up
 * outside development — see mail.module.ts and DevModule's own guard.
 */
@Injectable()
export class ConsoleMailProvider implements MailProvider {
  private readonly logger = new Logger('Mail (dev transport)');
  private readonly outbox: SentMail[] = [];

  async send(message: MailMessage): Promise<void> {
    const sent: SentMail = { ...message, sentAt: new Date().toISOString() };
    this.outbox.unshift(sent);
    if (this.outbox.length > MAX_OUTBOX_SIZE)
      this.outbox.length = MAX_OUTBOX_SIZE;

    this.logger.warn(
      `[DEV MAIL — not actually delivered] to=${message.to} subject="${message.subject}"\n${message.text}`,
    );
  }

  getOutbox(email?: string): SentMail[] {
    return email
      ? this.outbox.filter((m) => m.to.toLowerCase() === email.toLowerCase())
      : this.outbox;
  }
}
