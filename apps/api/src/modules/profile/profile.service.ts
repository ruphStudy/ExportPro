import { Injectable } from '@nestjs/common';
import { UserSummary } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { OrgContextService } from '../auth/org-context.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgContext: OrgContextService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async update(userId: string, dto: UpdateProfileDto): Promise<UserSummary> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });
    await this.audit.record({
      actorId: userId,
      action: 'profile.updated',
      entityType: 'User',
      entityId: userId,
    });
    return this.orgContext.toUserSummary(user);
  }

  async updateAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<UserSummary> {
    const existing = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const { url } = await this.storage.saveImage('avatars', file);
    await this.storage.deleteByUrl(existing.avatarUrl);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: url },
    });
    await this.audit.record({
      actorId: userId,
      action: 'profile.avatar_updated',
      entityType: 'User',
      entityId: userId,
    });
    return this.orgContext.toUserSummary(user);
  }

  async removeAvatar(userId: string): Promise<UserSummary> {
    const existing = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await this.storage.deleteByUrl(existing.avatarUrl);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });
    await this.audit.record({
      actorId: userId,
      action: 'profile.avatar_removed',
      entityType: 'User',
      entityId: userId,
    });
    return this.orgContext.toUserSummary(user);
  }
}
