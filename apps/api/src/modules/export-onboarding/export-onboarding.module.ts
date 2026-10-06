import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ExportOnboardingController } from './export-onboarding.controller';
import { ProductInterestsController } from './product-interests.controller';
import { TargetCountriesController } from './target-countries.controller';
import { RegistrationsController } from './registrations.controller';
import { CertificationsController } from './certifications.controller';
import { ExporterProfileService } from './exporter-profile.service';
import { ProductInterestsService } from './product-interests.service';
import { TargetCountriesService } from './target-countries.service';
import { RegistrationsService } from './registrations.service';
import { CertificationsService } from './certifications.service';
import { OnboardingDocumentsService } from './onboarding-documents.service';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [AuditModule],
  controllers: [
    ExportOnboardingController,
    ProductInterestsController,
    TargetCountriesController,
    RegistrationsController,
    CertificationsController,
  ],
  providers: [
    ExporterProfileService,
    ProductInterestsService,
    TargetCountriesService,
    RegistrationsService,
    CertificationsService,
    OnboardingDocumentsService,
    ReadinessService,
  ],
})
export class ExportOnboardingModule {}
