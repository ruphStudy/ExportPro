import { Module } from '@nestjs/common';
import { DevMailboxController } from './dev-mailbox.controller';

/**
 * Only imported by AppModule when NODE_ENV !== 'production' (see
 * app.module.ts). The controller also self-checks NODE_ENV as a second
 * layer of defense.
 */
@Module({
  controllers: [DevMailboxController],
})
export class DevModule {}
