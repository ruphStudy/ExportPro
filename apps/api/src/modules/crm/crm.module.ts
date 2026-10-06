import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

/** Sprint 11 CRM & lead management. StorageModule is global. */
@Module({
  imports: [AuditModule],
  controllers: [CrmController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
