import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { OrganizationSummary, SessionContext } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { OrgContextService } from '../auth/org-context.service';
import { SessionService } from '../auth/session.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'organization'
  );
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgContext: OrgContextService,
    private readonly sessions: SessionService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await this.prisma.organization.findUnique({
        where: { slug: candidate },
      });
      if (!existing) return candidate;
      candidate = `${base}-${randomBytes(2).toString('hex')}`;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }

  async create(
    userId: string,
    sessionId: string,
    dto: CreateOrganizationDto,
  ): Promise<SessionContext> {
    const slug = await this.uniqueSlug(dto.name);

    const organization = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.name.trim(),
          slug,
          businessType: dto.businessType,
          industry: dto.industry,
          tradeDirections: dto.tradeDirections?.length
            ? dto.tradeDirections
            : ['EXPORT'],
        },
      });
      await tx.membership.create({
        data: {
          userId,
          organizationId: org.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      return org;
    });

    await this.sessions.setActiveOrganization(sessionId, organization.id);
    await this.audit.record({
      organizationId: organization.id,
      actorId: userId,
      action: 'organization.created',
      entityType: 'Organization',
      entityId: organization.id,
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return this.orgContext.buildSessionContext(user, organization.id);
  }

  async getCurrent(organizationId: string): Promise<OrganizationSummary> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found.');
    return this.orgContext.toOrganizationSummary(org);
  }

  async update(
    organizationId: string,
    actorId: string,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationSummary> {
    const changedFields = Object.keys(dto);
    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: dto,
    });

    await this.audit.record({
      organizationId,
      actorId,
      action: 'organization.updated',
      entityType: 'Organization',
      entityId: organizationId,
      metadata: { changedFields },
    });
    return this.orgContext.toOrganizationSummary(org);
  }

  async updateLogo(
    organizationId: string,
    actorId: string,
    file: Express.Multer.File,
  ): Promise<OrganizationSummary> {
    const existing = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const { url } = await this.storage.saveImage('logos', file);
    await this.storage.deleteByUrl(existing.logoUrl);

    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { logoUrl: url },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'organization.logo_updated',
      entityType: 'Organization',
      entityId: organizationId,
    });
    return this.orgContext.toOrganizationSummary(org);
  }

  async removeLogo(
    organizationId: string,
    actorId: string,
  ): Promise<OrganizationSummary> {
    const existing = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    await this.storage.deleteByUrl(existing.logoUrl);

    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { logoUrl: null },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'organization.logo_removed',
      entityType: 'Organization',
      entityId: organizationId,
    });
    return this.orgContext.toOrganizationSummary(org);
  }

  async switch(
    userId: string,
    sessionId: string,
    organizationId: string,
  ): Promise<SessionContext> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'You are not a member of that organization.',
      );
    }

    await this.sessions.setActiveOrganization(sessionId, organizationId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return this.orgContext.buildSessionContext(user, organizationId);
  }
}
