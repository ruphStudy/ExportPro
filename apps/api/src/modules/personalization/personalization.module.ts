import { Module } from '@nestjs/common';
import { ExportOnboardingModule } from '../export-onboarding/export-onboarding.module';
import { PersonalizationService } from './personalization.service';

@Module({
  imports: [ExportOnboardingModule],
  providers: [PersonalizationService],
  exports: [PersonalizationService],
})
export class PersonalizationModule {}
