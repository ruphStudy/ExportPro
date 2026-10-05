import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SessionDeviceSummary } from '@exportpro/types';
import { AuditService } from '../audit/audit.service';
import { SessionService } from './session.service';

@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Req() req: Request): Promise<SessionDeviceSummary[]> {
    const sessions = await this.sessions.listActiveForUser(req.user!.id);
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      rememberMe: s.rememberMe,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      isCurrent: s.id === req.sessionId,
    }));
  }

  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  async revoke(@Param('id') id: string, @Req() req: Request) {
    const session = await this.sessions.findActiveById(id, req.user!.id);
    if (!session) throw new ForbiddenException('Session not found.');

    await this.sessions.revoke(id);
    await this.audit.record({
      actorId: req.user!.id,
      action: 'session.revoked',
      entityType: 'Session',
      entityId: id,
      metadata: { self: id === req.sessionId },
    });
    return { message: 'Session revoked.' };
  }
}
