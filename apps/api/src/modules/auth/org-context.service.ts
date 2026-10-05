import { Injectable } from '@nestjs/common';
import { Membership, Organization, User } from '@prisma/client';
import {
  MembershipRole,
  MembershipSummary,
  OrganizationSummary,
  permissionsForRole,
  SessionContext,
  UserSummary,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';

type MembershipWithOrg = Membership & { organization: Organization };

export interface ResolvedOrgContext {
  organizationId: string | null;
  role: MembershipRole | null;
  memberships: MembershipWithOrg[];
}

/**
 * Single place that turns "a user id" into "their active organization,
 * role, and the full membership list" — used by AuthGuard on every
 * request and by every endpoint that returns a SessionContext. Also
 * owns the Prisma-entity → shared-DTO mapping so no controller hand-rolls it.
 */
@Injectable()
export class OrgContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForUser(
    userId: string,
    preferredOrganizationId?: string | null,
  ): Promise<ResolvedOrgContext> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    if (memberships.length === 0) {
      return { organizationId: null, role: null, memberships: [] };
    }

    const preferred = preferredOrganizationId
      ? memberships.find((m) => m.organizationId === preferredOrganizationId)
      : undefined;
    const active = preferred ?? memberships[0];

    return {
      organizationId: active.organizationId,
      role: active.role as MembershipRole,
      memberships,
    };
  }

  toUserSummary(user: User): UserSummary {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerifiedAt !== null,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  toOrganizationSummary(org: Organization): OrganizationSummary {
    return {
      id: org.id,
      name: org.name,
      legalName: org.legalName,
      slug: org.slug,
      businessType: org.businessType as OrganizationSummary['businessType'],
      industry: org.industry,
      website: org.website,
      email: org.email,
      phone: org.phone,
      logoUrl: org.logoUrl,
      addressLine1: org.addressLine1,
      addressLine2: org.addressLine2,
      city: org.city,
      state: org.state,
      postalCode: org.postalCode,
      country: org.country,
      timezone: org.timezone,
      defaultCurrency: org.defaultCurrency,
      tradeDirections:
        org.tradeDirections as OrganizationSummary['tradeDirections'],
      createdAt: org.createdAt.toISOString(),
    };
  }

  toMembershipSummary(membership: MembershipWithOrg): MembershipSummary {
    return {
      id: membership.id,
      role: membership.role as MembershipRole,
      status: membership.status as MembershipSummary['status'],
      organization: this.toOrganizationSummary(membership.organization),
    };
  }

  async buildSessionContext(
    user: User,
    preferredOrganizationId?: string | null,
  ): Promise<SessionContext> {
    const { organizationId, role, memberships } = await this.resolveForUser(
      user.id,
      preferredOrganizationId,
    );
    return {
      user: this.toUserSummary(user),
      activeOrganizationId: organizationId,
      memberships: memberships.map((m) => this.toMembershipSummary(m)),
      permissions: role ? permissionsForRole(role) : [],
    };
  }
}
