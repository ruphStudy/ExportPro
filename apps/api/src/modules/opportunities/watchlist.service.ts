import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SavedOpportunity as SavedOpportunityDto } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OpportunityMapperService } from './opportunity-mapper.service';

@Injectable()
export class WatchlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: OpportunityMapperService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<SavedOpportunityDto[]> {
    const [rows, profile, countries, interests] = await Promise.all([
      this.prisma.savedOpportunity.findMany({
        where: { organizationId },
        include: { opportunity: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.exporterProfile.findUnique({ where: { organizationId } }),
      this.prisma.targetCountry.findMany({
        where: { organizationId },
        select: { countryCode: true },
      }),
      this.prisma.productInterest.findMany({
        where: { organizationId },
        select: { category: true },
      }),
    ]);

    const opportunityIds = rows.map((r) => r.opportunityId);
    const snapshots =
      opportunityIds.length > 0
        ? await this.prisma.opportunityScoreSnapshot.findMany({
            where: { opportunityId: { in: opportunityIds } },
            orderBy: { capturedAt: 'desc' },
          })
        : [];
    const byOpportunity = new Map<string, typeof snapshots>();
    for (const s of snapshots)
      byOpportunity.set(s.opportunityId, [
        ...(byOpportunity.get(s.opportunityId) ?? []),
        s,
      ]);

    const ctx = {
      profile,
      targetCountryCodes: countries.map((c) => c.countryCode),
      productInterestCategories: interests
        .map((i) => i.category)
        .filter((c): c is string => Boolean(c)),
    };

    return rows.map((row) => ({
      id: row.id,
      opportunity: this.mapper.toSummary(row.opportunity, {
        isSaved: true,
        scoreDelta: this.mapper.scoreDelta(
          byOpportunity.get(row.opportunityId) ?? [],
        ),
        personalization: this.mapper.personalize(row.opportunity, ctx),
      }),
      savedByUserId: row.savedByUserId,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async save(
    organizationId: string,
    userId: string,
    opportunityId: string,
    notes?: string,
  ) {
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
    });
    if (!opportunity) throw new NotFoundException('Opportunity not found.');

    const existing = await this.prisma.savedOpportunity.findUnique({
      where: {
        organizationId_opportunityId: { organizationId, opportunityId },
      },
    });
    if (existing) throw new ConflictException('Already in your watchlist.');

    const saved = await this.prisma.savedOpportunity.create({
      data: { organizationId, opportunityId, savedByUserId: userId, notes },
    });
    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'opportunity.saved',
      entityType: 'Opportunity',
      entityId: opportunityId,
    });
    return { id: saved.id, message: 'Opportunity saved.' };
  }

  async remove(organizationId: string, userId: string, opportunityId: string) {
    const existing = await this.prisma.savedOpportunity.findUnique({
      where: {
        organizationId_opportunityId: { organizationId, opportunityId },
      },
    });
    if (!existing) throw new NotFoundException('Not in your watchlist.');

    await this.prisma.savedOpportunity.delete({ where: { id: existing.id } });
    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'opportunity.unsaved',
      entityType: 'Opportunity',
      entityId: opportunityId,
    });
    return { message: 'Removed from watchlist.' };
  }
}
