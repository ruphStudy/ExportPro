import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommercialModule } from '../commercial/commercial.module';
import {
  ComplianceController,
  DocumentsController,
} from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { DocumentsService } from './documents.service';

/** Sprint 16: compliance checklists + trade document workspace. StorageModule is global. */
@Module({
  imports: [AuditModule, CommercialModule],
  controllers: [ComplianceController, DocumentsController],
  providers: [ComplianceService, DocumentsService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
