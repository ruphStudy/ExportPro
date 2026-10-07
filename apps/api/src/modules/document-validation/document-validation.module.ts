import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { CommercialModule } from '../commercial/commercial.module';
import {
  DocumentExtractionController,
  DocumentValidationController,
} from './document-validation.controller';
import { DocumentExtractionService } from './extraction.service';
import {
  createDocumentExtractionProvider,
  DOCUMENT_EXTRACTION_PROVIDER,
} from './extraction/providers';
import { DocumentValidationService } from './validation.service';

/** Sprint 17: document extraction (advisory) + deterministic cross-document validation. StorageModule is global. */
@Module({
  imports: [AuditModule, CommercialModule],
  controllers: [DocumentExtractionController, DocumentValidationController],
  providers: [
    DocumentExtractionService,
    DocumentValidationService,
    {
      provide: DOCUMENT_EXTRACTION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createDocumentExtractionProvider(
          config.get('ai', { infer: true }),
          config.get('app.nodeEnv', { infer: true }),
        ),
    },
  ],
  exports: [DocumentValidationService],
})
export class DocumentValidationModule {}
