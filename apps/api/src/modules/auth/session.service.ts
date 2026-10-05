import { Injectable } from '@nestjs/common';
import { Session } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SESSION_LIFETIME_MS } from './lib/constants';
import { generateOpaqueToken, hashToken } from './lib/tokens';

export interface CreateSessionInput {
  userId: string;
  rememberMe: boolean;
  userAgent?: string | null;
  ipAddress?: string | null;
  activeOrganizationId?: string | null;
}

function lifetimeFor(rememberMe: boolean): number {
  return rememberMe
    ? SESSION_LIFETIME_MS.rememberMe
    : SESSION_LIFETIME_MS.default;
}

/**
 * Owns the Session table — the server-side source of truth for "who is
 * logged in on which device," including the server-resolved "current
 * organization" for that device. See ARCHITECTURE.md "Authentication
 * Architecture" for why this is a single sliding opaque token rather
 * than a split access/refresh JWT pair.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: CreateSessionInput,
  ): Promise<{ session: Session; rawToken: string }> {
    const rawToken = generateOpaqueToken();
    const session = await this.prisma.session.create({
      data: {
        userId: input.userId,
        tokenHash: hashToken(rawToken),
        rememberMe: input.rememberMe,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        activeOrganizationId: input.activeOrganizationId ?? null,
        expiresAt: new Date(Date.now() + lifetimeFor(input.rememberMe)),
      },
    });
    return { session, rawToken };
  }

  /** Validates a raw cookie token and slides its expiry forward. Returns null for missing/expired/revoked sessions. */
  async validateAndTouch(
    rawToken: string,
  ): Promise<(Session & { user: { isActive: boolean } }) | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { select: { isActive: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      !session.user.isActive
    ) {
      return null;
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + lifetimeFor(session.rememberMe)),
      },
    });
    return session;
  }

  /** Rotates the token for defense-in-depth (old token stops working immediately) and extends expiry. Used by POST /auth/refresh. */
  async rotate(sessionId: string, rememberMe: boolean): Promise<string> {
    const rawToken = generateOpaqueToken();
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        tokenHash: hashToken(rawToken),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + lifetimeFor(rememberMe)),
      },
    });
    return rawToken;
  }

  setActiveOrganization(sessionId: string, organizationId: string | null) {
    return this.prisma.session.update({
      where: { id: sessionId },
      data: { activeOrganizationId: organizationId },
    });
  }

  revoke(sessionId: string) {
    return this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string, exceptSessionId?: string) {
    return this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  listActiveForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  findActiveById(sessionId: string, userId: string) {
    return this.prisma.session.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
    });
  }
}
