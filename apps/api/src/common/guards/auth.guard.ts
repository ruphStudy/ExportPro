import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { OrgContextService } from '../../modules/auth/org-context.service';
import { SessionService } from '../../modules/auth/session.service';
import { SESSION_COOKIE_NAME } from '../../modules/auth/lib/constants';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Registered globally in AppModule so every new route is protected by
 * default — a route becomes public by opting in with `@Public()`.
 *
 * Reads the HttpOnly session cookie, validates it against the Session
 * table (not a stateless JWT — see ARCHITECTURE.md "Authentication
 * Architecture"), and attaches `request.user` / `request.sessionId` /
 * `request.organizationId` / `request.membershipRole`. A missing,
 * expired, or revoked session fails closed with 401, regardless of
 * what the frontend UI would have allowed.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly orgContext: OrgContextService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const rawToken = request.cookies?.[SESSION_COOKIE_NAME] as
      string | undefined;

    if (!rawToken) {
      if (isPublic) return true;
      throw new UnauthorizedException('Not authenticated.');
    }

    const session = await this.sessions.validateAndTouch(rawToken);
    if (!session) {
      if (isPublic) return true;
      throw new UnauthorizedException('Session expired or invalid.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user || !user.isActive) {
      if (isPublic) return true;
      throw new UnauthorizedException('Account is not available.');
    }

    const { organizationId, role } = await this.orgContext.resolveForUser(
      user.id,
      session.activeOrganizationId,
    );
    if (organizationId && organizationId !== session.activeOrganizationId) {
      await this.sessions.setActiveOrganization(session.id, organizationId);
    }

    request.user = this.orgContext.toUserSummary(user);
    request.sessionId = session.id;
    request.organizationId = organizationId ?? undefined;
    request.membershipRole = role ?? undefined;

    return true;
  }
}
