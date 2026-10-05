import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { SessionsController } from './sessions.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { OrgContextService } from './org-context.service';

@Module({
  imports: [AuditModule],
  controllers: [AuthController, SessionsController],
  providers: [AuthService, SessionService, OrgContextService],
  exports: [SessionService, OrgContextService],
})
export class AuthModule {}
