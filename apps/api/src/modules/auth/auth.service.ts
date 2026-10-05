import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Session, User } from '@prisma/client';
import { SessionContext } from '@exportpro/types';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  PASSWORD_RESET_TTL_MS,
} from './lib/constants';
import { hashPassword, verifyPassword } from './lib/password';
import { generateOpaqueToken, generateOtp, hashToken } from './lib/tokens';
import { OrgContextService } from './org-context.service';
import { SessionService } from './session.service';

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

// Dummy hash so login timing is identical whether or not the email exists —
// a cheap, worthwhile account-enumeration mitigation.
const DUMMY_PASSWORD_HASH =
  '$2a$12$CwTycUXWue0Thq9StjUM0uJ8FiSHQKhNSSNLITBJwyV5P2WYoKVP.';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly orgContext: OrgContextService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig>,
  ) {}

  async signup(input: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }) {
    const email = normalizeEmail(input.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
      },
    });

    await this.audit.record({
      actorId: user.id,
      action: 'user.signup',
      entityType: 'User',
      entityId: user.id,
    });
    await this.issueVerificationCode(user);

    return { userId: user.id, email: user.email };
  }

  private async issueVerificationCode(user: User) {
    const code = generateOtp();
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await this.mail.sendVerificationCode(user.email, code);
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
    // Privacy-safe: identical response whether or not the account exists or is already verified.
    if (!user || user.emailVerifiedAt)
      return {
        message: 'If an unverified account exists, a new code has been sent.',
      };

    const latest = await this.prisma.verificationToken.findFirst({
      where: {
        userId: user.id,
        purpose: 'EMAIL_VERIFICATION',
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      throw new BadRequestException(
        'Please wait a moment before requesting another code.',
      );
    }

    await this.issueVerificationCode(user);
    return {
      message: 'If an unverified account exists, a new code has been sent.',
    };
  }

  async verifyEmail(email: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
    if (!user)
      throw new BadRequestException('Invalid or expired verification code.');
    if (user.emailVerifiedAt) return { message: 'Email already verified.' };

    const token = await this.prisma.verificationToken.findFirst({
      where: {
        userId: user.id,
        purpose: 'EMAIL_VERIFICATION',
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!token || token.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification code.');
    }
    if (token.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many attempts. Request a new code.');
    }

    if (hashToken(code) !== token.codeHash) {
      await this.prisma.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid or expired verification code.');
    }

    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorId: user.id,
      action: 'user.email_verified',
      entityType: 'User',
      entityId: user.id,
    });

    return { message: 'Email verified.' };
  }

  async login(
    input: { email: string; password: string; rememberMe?: boolean },
    meta: RequestMeta,
  ) {
    const email = normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    const passwordOk = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (!user.isActive) {
      throw new ForbiddenException('This account has been deactivated.');
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(
        'Please verify your email before signing in.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { session, rawToken } = await this.sessions.create({
      userId: user.id,
      rememberMe: Boolean(input.rememberMe),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    await this.audit.record({
      actorId: user.id,
      action: 'user.login',
      entityType: 'User',
      entityId: user.id,
    });

    const context = await this.orgContext.buildSessionContext(user);
    return { rawToken, session, context };
  }

  async logout(sessionId: string, userId: string) {
    await this.sessions.revoke(sessionId);
    await this.audit.record({
      actorId: userId,
      action: 'user.logout',
      entityType: 'Session',
      entityId: sessionId,
    });
  }

  async logoutOthers(userId: string, currentSessionId: string) {
    await this.sessions.revokeAllForUser(userId, currentSessionId);
    await this.audit.record({
      actorId: userId,
      action: 'session.revoked_others',
      entityType: 'User',
      entityId: userId,
    });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
    if (user) {
      const rawToken = generateOpaqueToken();
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });
      const frontendUrl = this.config.get('app.frontendUrl', { infer: true });
      const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;
      await this.mail.sendPasswordResetLink(user.email, resetUrl);
    }
    // Always the same response — never reveal whether the account exists.
    return {
      message:
        'If an account exists for this email, password reset instructions have been sent.',
    };
  }

  async resetPassword(rawToken: string, newPassword: string) {
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!token || token.consumedAt || token.expiresAt < new Date()) {
      throw new BadRequestException(
        'This password reset link is invalid or has expired.',
      );
    }

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      }),
    ]);
    // Security-sensitive change: invalidate every existing session everywhere.
    await this.sessions.revokeAllForUser(token.userId);

    await this.audit.record({
      actorId: token.userId,
      action: 'user.password_reset',
      entityType: 'User',
      entityId: token.userId,
    });
    return {
      message: 'Password reset. Please sign in with your new password.',
    };
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect.');

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    // Keep the session that made this change alive; sign out every other device.
    await this.sessions.revokeAllForUser(userId, currentSessionId);

    await this.audit.record({
      actorId: userId,
      action: 'user.password_changed',
      entityType: 'User',
      entityId: userId,
    });
    return {
      message: "Password changed. You've been signed out of other devices.",
    };
  }

  async refresh(
    session: Session,
  ): Promise<{ rawToken: string; context: SessionContext }> {
    const rawToken = await this.sessions.rotate(session.id, session.rememberMe);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
    });
    const context = await this.orgContext.buildSessionContext(
      user,
      session.activeOrganizationId,
    );
    return { rawToken, context };
  }
}
