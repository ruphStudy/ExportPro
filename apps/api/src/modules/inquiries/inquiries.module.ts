import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { INQUIRY_EXTRACTION_PROVIDER } from './extraction/extraction-provider';
import { createExtractionProvider } from './extraction/provider.factory';
import { InquiriesController } from './inquiries.controller';
import { InquiriesService } from './inquiries.service';
import { InquiryIntakeService } from './inquiry-intake.service';

/** Sprint 13 buyer inquiry / RFQ management. StorageModule is global. */
@Module({
  imports: [AuditModule],
  controllers: [InquiriesController],
  providers: [
    InquiriesService,
    InquiryIntakeService,
    {
      provide: INQUIRY_EXTRACTION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createExtractionProvider(
          config.get('ai', { infer: true }),
          config.get('app.nodeEnv', { infer: true }),
        ),
    },
  ],
  exports: [InquiryIntakeService, InquiriesService],
})
export class InquiriesModule {}
