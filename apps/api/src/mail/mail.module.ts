import { Global, Module } from '@nestjs/common';
import { ConsoleMailProvider } from './providers/console-mail.provider';
import { MailService, MAIL_PROVIDER } from './mail.service';

/**
 * Binds MAIL_PROVIDER to the development console transport. Production
 * requires swapping this to a real provider (SES/Postmark/SendGrid/...)
 * — see ARCHITECTURE.md "Email Abstraction". No production credentials
 * exist in this codebase; do not hardcode any here.
 */
@Global()
@Module({
  providers: [
    ConsoleMailProvider,
    { provide: MAIL_PROVIDER, useExisting: ConsoleMailProvider },
    MailService,
  ],
  exports: [MailService, ConsoleMailProvider],
})
export class MailModule {}
