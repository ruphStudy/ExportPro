import { Injectable } from '@nestjs/common';
import type { InvestmentRange } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { ReadinessService } from '../export-onboarding/readiness.service';
import { INDIAN_STATES } from '../product-intelligence/indian-states';
import { FitProfile } from './personal-fit';

/**
 * Loads the current organization's Sprint 2/3 profile once per request
 * for personal-fit scoring. Only this organization's data is read.
 */
@Injectable()
export class PersonalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
  ) {}

  async loadProfile(organizationId: string): Promise<FitProfile> {
    const [org, profile, targets, interests, registrations, readiness] =
      await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { businessType: true, state: true },
        }),
        this.prisma.exporterProfile.findUnique({ where: { organizationId } }),
        this.prisma.targetCountry.findMany({
          where: { organizationId },
          select: { countryCode: true, relation: true },
        }),
        this.prisma.productInterest.findMany({
          where: { organizationId },
          select: { category: true },
        }),
        this.prisma.registration.findMany({
          where: { organizationId },
          select: { type: true, status: true },
        }),
        this.readiness.calculate(organizationId).catch(() => null),
      ]);
    const stateEntry = org?.state
      ? Object.entries(INDIAN_STATES).find(
          ([code, s]) =>
            code === org.state!.trim().toUpperCase() ||
            s.name.toLowerCase() === org.state!.trim().toLowerCase(),
        )
      : undefined;
    return {
      hasProfile: Boolean(profile),
      investmentRange:
        (profile?.investmentRange as InvestmentRange | null) ?? null,
      exportExperience: profile?.exportExperience ?? null,
      riskTolerance: profile?.riskTolerance ?? null,
      businessType: profile?.exporterType ?? org?.businessType ?? null,
      stateCode: stateEntry?.[0] ?? null,
      stateName: stateEntry?.[1].name ?? null,
      productCategories: profile?.productCategories ?? [],
      interestCategories: interests
        .map((i) => i.category)
        .filter((c): c is string => Boolean(c)),
      targets: new Map(targets.map((t) => [t.countryCode, t.relation])),
      preferredLogistics: profile?.preferredLogistics ?? [],
      shipmentPreference: profile?.shipmentPreference ?? null,
      desiredMarginMin: profile?.desiredMarginMin ?? null,
      registrations: new Map(registrations.map((r) => [r.type, r.status])),
      readinessScore: readiness?.score ?? null,
      readinessActions: readiness?.missingActions ?? [],
    };
  }
}
