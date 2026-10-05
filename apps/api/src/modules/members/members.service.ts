import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvitationSummary,
  MemberSummary,
  MembershipRole,
} from '@exportpro/types';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { generateOpaqueToken, hashToken } from '../auth/lib/tokens';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig>,
  ) {}

  async list(organizationId: string): Promise<MemberSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, status: { not: 'REMOVED' } },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.role as MembershipRole,
      status: m.status as MemberSummary['status'],
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  async invite(
    organizationId: string,
    invitedById: string,
    email: string,
    role: Exclude<MembershipRole, 'OWNER'>,
  ): Promise<InvitationSummary> {
    const normalized = normalizeEmail(email);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (existingUser) {
      const existingMembership = await this.prisma.membership.findUnique({
        where: {
          userId_organizationId: { userId: existingUser.id, organizationId },
        },
      });
      if (existingMembership && existingMembership.status === 'ACTIVE') {
        throw new BadRequestException(
          'This person is already a member of your organization.',
        );
      }
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const rawToken = generateOpaqueToken();
    const invitation = await this.prisma.organizationInvitation.create({
      data: {
        organizationId,
        email: normalized,
        role,
        invitedById,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });

    const frontendUrl = this.config.get('app.frontendUrl', { infer: true });
    const acceptUrl = `${frontendUrl}/invitations/${rawToken}`;
    await this.mail.sendOrganizationInvite(
      normalized,
      organization.name,
      acceptUrl,
    );

    await this.audit.record({
      organizationId,
      actorId: invitedById,
      action: 'team.invite_created',
      entityType: 'OrganizationInvitation',
      entityId: invitation.id,
      metadata: { email: normalized, role },
    });

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role as MembershipRole,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }

  async previewInvitation(rawToken: string) {
    const invitation = await this.prisma.organizationInvitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { organization: true },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt < new Date()
    ) {
      throw new NotFoundException('This invitation is invalid or has expired.');
    }
    return {
      organizationName: invitation.organization.name,
      email: invitation.email,
      role: invitation.role as MembershipRole,
    };
  }

  async accept(rawToken: string, userId: string, userEmail: string) {
    const invitation = await this.prisma.organizationInvitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt < new Date()
    ) {
      throw new BadRequestException(
        'This invitation is invalid or has expired.',
      );
    }
    if (normalizeEmail(userEmail) !== invitation.email) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.membership.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId: invitation.organizationId,
          },
        },
        create: {
          userId,
          organizationId: invitation.organizationId,
          role: invitation.role,
          status: 'ACTIVE',
        },
        update: { role: invitation.role, status: 'ACTIVE' },
      }),
      this.prisma.organizationInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      organizationId: invitation.organizationId,
      actorId: userId,
      action: 'team.invite_accepted',
      entityType: 'OrganizationInvitation',
      entityId: invitation.id,
    });

    return { organizationId: invitation.organizationId };
  }

  async updateRole(
    organizationId: string,
    membershipId: string,
    actorId: string,
    role: Exclude<MembershipRole, 'OWNER'>,
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
    });
    if (!membership) throw new NotFoundException('Member not found.');
    if (membership.role === 'OWNER') {
      throw new ForbiddenException(
        "The organization Owner's role cannot be changed here.",
      );
    }

    const updated = await this.prisma.membership.update({
      where: { id: membershipId },
      data: { role },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'team.member_role_changed',
      entityType: 'Membership',
      entityId: membershipId,
      metadata: { previousRole: membership.role, newRole: role },
    });
    return { membershipId: updated.id, role: updated.role as MembershipRole };
  }

  async remove(organizationId: string, membershipId: string, actorId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
    });
    if (!membership) throw new NotFoundException('Member not found.');
    if (membership.role === 'OWNER') {
      throw new ForbiddenException('The organization Owner cannot be removed.');
    }
    if (membership.userId === actorId) {
      throw new ForbiddenException(
        'You cannot remove yourself from the organization.',
      );
    }

    await this.prisma.membership.update({
      where: { id: membershipId },
      data: { status: 'REMOVED' },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'team.member_removed',
      entityType: 'Membership',
      entityId: membershipId,
      metadata: { removedUserId: membership.userId },
    });
    return { message: 'Member removed.' };
  }
}
