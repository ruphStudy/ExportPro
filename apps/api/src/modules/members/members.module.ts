import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MembersController } from './members.controller';
import { InvitationsController } from './invitations.controller';
import { MembersService } from './members.service';

@Module({
  imports: [AuditModule],
  controllers: [MembersController, InvitationsController],
  providers: [MembersService],
})
export class MembersModule {}
