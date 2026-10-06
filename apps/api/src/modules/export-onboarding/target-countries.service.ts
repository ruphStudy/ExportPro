import { Injectable, NotFoundException } from '@nestjs/common';
import { TargetCountry } from '@prisma/client';
import { TargetCountrySummary } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SetTargetCountryDto } from './dto/target-country.dto';

@Injectable()
export class TargetCountriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  toSummary(row: TargetCountry): TargetCountrySummary {
    return {
      id: row.id,
      countryCode: row.countryCode,
      relation: row.relation as TargetCountrySummary['relation'],
    };
  }

  async list(organizationId: string): Promise<TargetCountrySummary[]> {
    const rows = await this.prisma.targetCountry.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toSummary(r));
  }

  async upsert(
    organizationId: string,
    actorId: string,
    dto: SetTargetCountryDto,
  ): Promise<TargetCountrySummary> {
    const row = await this.prisma.targetCountry.upsert({
      where: {
        organizationId_countryCode: {
          organizationId,
          countryCode: dto.countryCode,
        },
      },
      create: {
        organizationId,
        countryCode: dto.countryCode,
        relation: dto.relation,
      },
      update: { relation: dto.relation },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.target_country_set',
      entityType: 'TargetCountry',
      entityId: row.id,
      metadata: { countryCode: dto.countryCode, relation: dto.relation },
    });
    return this.toSummary(row);
  }

  async remove(
    organizationId: string,
    actorId: string,
    countryCode: string,
  ): Promise<{ message: string }> {
    const row = await this.prisma.targetCountry.findUnique({
      where: { organizationId_countryCode: { organizationId, countryCode } },
    });
    if (!row) throw new NotFoundException('Target country not found.');

    await this.prisma.targetCountry.delete({ where: { id: row.id } });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.target_country_removed',
      entityType: 'TargetCountry',
      entityId: row.id,
      metadata: { countryCode },
    });
    return { message: 'Target country removed.' };
  }
}
