import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SavedSearch as SavedSearchDto } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateSavedSearchDto,
  UpdateSavedSearchDto,
} from './dto/saved-search.dto';

@Injectable()
export class SavedSearchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toDto(row: {
    id: string;
    name: string;
    query: unknown;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  }): SavedSearchDto {
    return {
      id: row.id,
      name: row.name,
      query: row.query as SavedSearchDto['query'],
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(organizationId: string): Promise<SavedSearchDto[]> {
    const rows = await this.prisma.savedOpportunitySearch.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: CreateSavedSearchDto,
  ): Promise<SavedSearchDto> {
    const row = await this.prisma.savedOpportunitySearch.create({
      data: {
        organizationId,
        name: dto.name,
        query: dto.query as object,
        createdByUserId: actorId,
      },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'opportunity.saved_search_created',
      entityType: 'SavedOpportunitySearch',
      entityId: row.id,
      metadata: { name: dto.name },
    });
    return this.toDto(row);
  }

  private async findOwned(organizationId: string, id: string) {
    const row = await this.prisma.savedOpportunitySearch.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Saved search not found.');
    if (row.organizationId !== organizationId)
      throw new ForbiddenException('Not found in this organization.');
    return row;
  }

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    dto: UpdateSavedSearchDto,
  ): Promise<SavedSearchDto> {
    await this.findOwned(organizationId, id);
    const row = await this.prisma.savedOpportunitySearch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.query !== undefined ? { query: dto.query as object } : {}),
      },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'opportunity.saved_search_updated',
      entityType: 'SavedOpportunitySearch',
      entityId: id,
    });
    return this.toDto(row);
  }

  async remove(
    organizationId: string,
    actorId: string,
    id: string,
  ): Promise<{ message: string }> {
    await this.findOwned(organizationId, id);
    await this.prisma.savedOpportunitySearch.delete({ where: { id } });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'opportunity.saved_search_deleted',
      entityType: 'SavedOpportunitySearch',
      entityId: id,
    });
    return { message: 'Saved search deleted.' };
  }
}
