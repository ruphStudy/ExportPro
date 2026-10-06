import { BadRequestException, Injectable } from '@nestjs/common';
import { ExporterProfile } from '@prisma/client';
import { ExporterProfileSummary } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';
import { UpdateProductsDto } from './dto/update-products.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';

@Injectable()
export class ExporterProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every org gets exactly one ExporterProfile, created lazily on first touch rather than at org-creation time. */
  async getOrCreate(organizationId: string): Promise<ExporterProfile> {
    const existing = await this.prisma.exporterProfile.findUnique({
      where: { organizationId },
    });
    if (existing) return existing;
    return this.prisma.exporterProfile.create({ data: { organizationId } });
  }

  toSummary(profile: ExporterProfile): ExporterProfileSummary {
    return {
      organizationId: profile.organizationId,
      exporterType:
        profile.exporterType as ExporterProfileSummary['exporterType'],
      exportExperience:
        profile.exportExperience as ExporterProfileSummary['exportExperience'],
      riskTolerance:
        profile.riskTolerance as ExporterProfileSummary['riskTolerance'],
      onboardingStatus:
        profile.onboardingStatus as ExporterProfileSummary['onboardingStatus'],
      currentStep: profile.currentStep,
      startedAt: profile.startedAt ? profile.startedAt.toISOString() : null,
      completedAt: profile.completedAt
        ? profile.completedAt.toISOString()
        : null,
      productCategories: profile.productCategories,
      preferredIndustries: profile.preferredIndustries,
      investmentRange:
        profile.investmentRange as ExporterProfileSummary['investmentRange'],
      desiredMarginMin: profile.desiredMarginMin,
      desiredMarginMax: profile.desiredMarginMax,
      shipmentPreference:
        profile.shipmentPreference as ExporterProfileSummary['shipmentPreference'],
      preferredLogistics:
        profile.preferredLogistics as ExporterProfileSummary['preferredLogistics'],
      exportGoals: profile.exportGoals as ExporterProfileSummary['exportGoals'],
    };
  }

  /** First edit of any kind moves NOT_STARTED → IN_PROGRESS and stamps startedAt — never derived from the frontend. */
  private async markStarted(organizationId: string) {
    await this.prisma.exporterProfile.updateMany({
      where: { organizationId, onboardingStatus: 'NOT_STARTED' },
      data: { onboardingStatus: 'IN_PROGRESS', startedAt: new Date() },
    });
  }

  async get(organizationId: string): Promise<ExporterProfileSummary> {
    const profile = await this.getOrCreate(organizationId);
    return this.toSummary(profile);
  }

  async updateBusinessProfile(
    organizationId: string,
    actorId: string,
    dto: UpdateBusinessProfileDto,
  ): Promise<ExporterProfileSummary> {
    await this.getOrCreate(organizationId);
    await this.markStarted(organizationId);
    const profile = await this.prisma.exporterProfile.update({
      where: { organizationId },
      data: dto,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.business_profile_updated',
      entityType: 'ExporterProfile',
      entityId: profile.id,
    });
    return this.toSummary(profile);
  }

  async updateProducts(
    organizationId: string,
    actorId: string,
    dto: UpdateProductsDto,
  ): Promise<ExporterProfileSummary> {
    await this.getOrCreate(organizationId);
    await this.markStarted(organizationId);
    const profile = await this.prisma.exporterProfile.update({
      where: { organizationId },
      data: dto,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.products_updated',
      entityType: 'ExporterProfile',
      entityId: profile.id,
    });
    return this.toSummary(profile);
  }

  async updatePreferences(
    organizationId: string,
    actorId: string,
    dto: UpdatePreferencesDto,
  ): Promise<ExporterProfileSummary> {
    const current = await this.getOrCreate(organizationId);
    const min = dto.desiredMarginMin ?? current.desiredMarginMin;
    const max = dto.desiredMarginMax ?? current.desiredMarginMax;
    if (
      min !== null &&
      min !== undefined &&
      max !== null &&
      max !== undefined &&
      max < min
    ) {
      throw new BadRequestException(
        'Maximum margin cannot be less than minimum margin.',
      );
    }

    await this.markStarted(organizationId);
    const profile = await this.prisma.exporterProfile.update({
      where: { organizationId },
      data: dto,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.preferences_updated',
      entityType: 'ExporterProfile',
      entityId: profile.id,
    });
    return this.toSummary(profile);
  }

  async updateProgress(
    organizationId: string,
    actorId: string,
    dto: UpdateProgressDto,
  ): Promise<ExporterProfileSummary> {
    await this.getOrCreate(organizationId);
    await this.markStarted(organizationId);
    const profile = await this.prisma.exporterProfile.update({
      where: { organizationId },
      data: { currentStep: dto.currentStep },
    });
    return this.toSummary(profile);
  }

  async complete(
    organizationId: string,
    actorId: string,
  ): Promise<ExporterProfileSummary> {
    await this.getOrCreate(organizationId);
    const profile = await this.prisma.exporterProfile.update({
      where: { organizationId },
      data: { onboardingStatus: 'COMPLETED', completedAt: new Date() },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.completed',
      entityType: 'ExporterProfile',
      entityId: profile.id,
    });
    return this.toSummary(profile);
  }
}
