import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ConsoleMailProvider } from '../../mail/providers/console-mail.provider';

/**
 * Lets manual/E2E testing read OTPs and reset links without a real
 * mail provider configured. Only ever mounted when NODE_ENV !==
 * 'production' (see DevModule) — never reachable in production
 * regardless of this controller's own code.
 */
@ApiTags('dev')
@Public()
@Controller('dev/mailbox')
export class DevMailboxController {
  constructor(private readonly mailProvider: ConsoleMailProvider) {}

  @Get()
  list(@Query('email') email?: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    return this.mailProvider.getOutbox(email);
  }
}
