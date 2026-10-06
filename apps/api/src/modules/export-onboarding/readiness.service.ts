import { Injectable } from '@nestjs/common';
import {
  FOOD_RELATED_CATEGORY_CODES,
  MissingAction,
  ReadinessResponse,
  ReadinessSection,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Deterministic, explainable onboarding-completion score — NOT an AI
 * recommendation and NOT a legal/compliance approval. See
 * ARCHITECTURE.md "Export Readiness Score" for the full methodology;
 * the weights below are the single source of truth for it.
 *
 * Section weights (sum to 100):
 *   business_profile        15
 *   products                15
 *   markets                 15
 *   commercial_preferences  15
 *   registrations           25
 *   certifications          15
 */
@Injectable()
export class ReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(organizationId: string): Promise<ReadinessResponse> {
    const [
      organization,
      profile,
      productInterests,
      targetCountries,
      registrations,
      certifications,
    ] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
      }),
      this.prisma.exporterProfile.findUnique({ where: { organizationId } }),
      this.prisma.productInterest.count({ where: { organizationId } }),
      this.prisma.targetCountry.count({ where: { organizationId } }),
      this.prisma.registration.findMany({ where: { organizationId } }),
      this.prisma.certification.findMany({
        where: { organizationId },
        include: { documents: true },
      }),
    ]);

    const sections: ReadinessSection[] = [];
    const missingActions: MissingAction[] = [];

    // --- Business profile (15) -----------------------------------
    {
      const complete: string[] = [];
      const missing: string[] = [];
      let score = 0;

      if (profile?.exporterType) {
        score += 5;
        complete.push('Exporter type selected');
      } else {
        missing.push('Exporter type not selected');
        missingActions.push({
          priority: 'IMPORTANT',
          message: 'Select your exporter type',
          section: 'business_profile',
        });
      }

      if (profile?.exportExperience) {
        score += 5;
        complete.push('Export experience added');
      } else {
        missing.push('Export experience not added');
        missingActions.push({
          priority: 'RECOMMENDED',
          message: 'Add your export experience',
          section: 'business_profile',
        });
      }

      const companyComplete = Boolean(
        organization.businessType && organization.country,
      );
      if (companyComplete) {
        score += 5;
        complete.push('Company details complete');
      } else {
        missing.push('Company details incomplete');
        missingActions.push({
          priority: 'IMPORTANT',
          message: 'Complete your company details in Organization Settings',
          section: 'business_profile',
        });
      }

      sections.push({
        key: 'business_profile',
        label: 'Business Profile',
        score,
        maxScore: 15,
        complete,
        missing,
      });
    }

    // --- Products (15) --------------------------------------------
    {
      const complete: string[] = [];
      const missing: string[] = [];
      let score = 0;

      const hasCategories = (profile?.productCategories.length ?? 0) > 0;
      if (hasCategories) {
        score += 7;
        complete.push('Product categories selected');
      } else {
        missing.push('No product categories selected');
        missingActions.push({
          priority: 'IMPORTANT',
          message: 'Select products you plan to export',
          section: 'products',
        });
      }

      if (productInterests > 0) {
        score += 8;
        complete.push('Product interests added');
      } else {
        missing.push('No specific products added');
        missingActions.push({
          priority: 'RECOMMENDED',
          message: 'Add specific products you plan to export',
          section: 'products',
        });
      }

      sections.push({
        key: 'products',
        label: 'Products',
        score,
        maxScore: 15,
        complete,
        missing,
      });
    }

    // --- Markets (15) -----------------------------------------------
    {
      const complete: string[] = [];
      const missing: string[] = [];
      let score = 0;

      if (targetCountries > 0) {
        score += 8;
        complete.push('Target countries added');
      } else {
        missing.push('No target countries added');
        missingActions.push({
          priority: 'IMPORTANT',
          message: 'Add at least one target country',
          section: 'markets',
        });
      }

      const hasGoals = (profile?.exportGoals.length ?? 0) > 0;
      if (hasGoals) {
        score += 7;
        complete.push('Export goals selected');
      } else {
        missing.push('No export goals selected');
        missingActions.push({
          priority: 'RECOMMENDED',
          message: 'Select your export goals',
          section: 'markets',
        });
      }

      sections.push({
        key: 'markets',
        label: 'Markets',
        score,
        maxScore: 15,
        complete,
        missing,
      });
    }

    // --- Commercial preferences (15) --------------------------------
    {
      const complete: string[] = [];
      const missing: string[] = [];
      let score = 0;

      if (profile?.investmentRange) {
        score += 5;
        complete.push('Investment range added');
      } else {
        missing.push('Investment range not added');
        missingActions.push({
          priority: 'RECOMMENDED',
          message: 'Add your investment range',
          section: 'commercial_preferences',
        });
      }

      if (profile?.shipmentPreference) {
        score += 5;
        complete.push('Shipment preference added');
      } else {
        missing.push('Shipment preference not added');
        missingActions.push({
          priority: 'RECOMMENDED',
          message: 'Add your shipment size preference',
          section: 'commercial_preferences',
        });
      }

      if (
        profile?.desiredMarginMin !== null &&
        profile?.desiredMarginMin !== undefined
      ) {
        score += 5;
        complete.push('Desired margin added');
      } else {
        missing.push('Desired margin not added');
        missingActions.push({
          priority: 'RECOMMENDED',
          message: 'Add your desired margin expectation',
          section: 'commercial_preferences',
        });
      }

      sections.push({
        key: 'commercial_preferences',
        label: 'Commercial Preferences',
        score,
        maxScore: 15,
        complete,
        missing,
      });
    }

    // --- Registrations (25): IEC 10 + GST 10 + FSSAI/APEDA 5 --------
    {
      const complete: string[] = [];
      const missing: string[] = [];
      let score = 0;

      const byType = Object.fromEntries(registrations.map((r) => [r.type, r]));

      const iec = byType.IEC;
      if (iec?.status === 'AVAILABLE') {
        score += 10;
        complete.push('IEC available');
        if (
          iec.verificationStatus === 'NOT_PROVIDED' ||
          iec.verificationStatus === 'USER_DECLARED'
        ) {
          missingActions.push({
            priority: 'RECOMMENDED',
            message: 'Upload your IEC document',
            section: 'registrations',
          });
        }
      } else if (iec?.status === 'APPLIED_PENDING') {
        score += 5;
        missing.push('IEC application pending');
        missingActions.push({
          priority: 'IMPORTANT',
          message: 'Update your IEC status once available',
          section: 'registrations',
        });
      } else {
        missing.push('IEC not provided');
        missingActions.push({
          priority: 'CRITICAL',
          message: 'Add your IEC details',
          section: 'registrations',
        });
      }

      const gst = byType.GST;
      if (gst?.status === 'AVAILABLE' || gst?.status === 'NOT_APPLICABLE') {
        score += 10;
        complete.push(
          gst.status === 'AVAILABLE'
            ? 'GST available'
            : 'GST marked not applicable',
        );
      } else if (gst?.status === 'APPLIED_PENDING') {
        score += 5;
        missing.push('GST application pending');
      } else {
        missing.push('GST not provided');
        missingActions.push({
          priority: 'IMPORTANT',
          message: 'Complete your GST information',
          section: 'registrations',
        });
      }

      // FSSAI/APEDA are only meaningful for food-related categories —
      // never penalize an unrelated business for not having them, and
      // treat "no categories chosen yet" as informational, not a fault.
      const categories = profile?.productCategories ?? [];
      const foodRelated = categories.some((c) =>
        FOOD_RELATED_CATEGORY_CODES.includes(c),
      );
      if (categories.length === 0 || !foodRelated) {
        score += 5;
        complete.push('FSSAI/APEDA not applicable for selected categories');
      } else {
        const fssai = byType.FSSAI;
        const apeda = byType.APEDA;
        const anyAvailable =
          fssai?.status === 'AVAILABLE' || apeda?.status === 'AVAILABLE';
        const anyPending =
          fssai?.status === 'APPLIED_PENDING' ||
          apeda?.status === 'APPLIED_PENDING';
        if (anyAvailable) {
          score += 5;
          complete.push('Food registration (FSSAI/APEDA) available');
        } else if (anyPending) {
          score += 2;
          missing.push('Food registration (FSSAI/APEDA) pending');
        } else {
          missing.push('Food registration (FSSAI/APEDA) not provided');
          missingActions.push({
            priority: 'IMPORTANT',
            message: 'Add relevant food registration details (FSSAI/APEDA)',
            section: 'registrations',
          });
        }
      }

      sections.push({
        key: 'registrations',
        label: 'Registrations',
        score,
        maxScore: 25,
        complete,
        missing,
      });
    }

    // --- Certifications (15) ----------------------------------------
    {
      const complete: string[] = [];
      const missing: string[] = [];

      const withDoc = certifications.filter(
        (c) => c.documents.length > 0,
      ).length;
      const withoutDoc = certifications.length - withDoc;
      const score = Math.min(15, withDoc * 8 + withoutDoc * 3);

      if (certifications.length > 0) {
        complete.push(`${certifications.length} certificate(s) added`);
      } else {
        missing.push('No certificates added');
        missingActions.push({
          priority: 'RECOMMENDED',
          message:
            'Add certification documents for a stronger readiness profile',
          section: 'certifications',
        });
      }
      if (certifications.some((c) => !c.expiryDate)) {
        missingActions.push({
          priority: 'RECOMMENDED',
          message: 'Add certificate expiry dates',
          section: 'certifications',
        });
      }

      sections.push({
        key: 'certifications',
        label: 'Certifications',
        score,
        maxScore: 15,
        complete,
        missing,
      });
    }

    const score = sections.reduce((sum, s) => sum + s.score, 0);
    const { level, levelLabel } = levelFor(score);

    return { score, level, levelLabel, sections, missingActions };
  }
}

function levelFor(score: number): {
  level: ReadinessResponse['level'];
  levelLabel: string;
} {
  if (score >= 80)
    return { level: 'STRONG_SETUP', levelLabel: 'Strong Export Setup' };
  if (score >= 60)
    return {
      level: 'EXPORT_READY',
      levelLabel: 'Export Ready — Some Actions Remaining',
    };
  if (score >= 40)
    return {
      level: 'FOUNDATION_IN_PROGRESS',
      levelLabel: 'Foundation In Progress',
    };
  return { level: 'GETTING_STARTED', levelLabel: 'Getting Started' };
}
