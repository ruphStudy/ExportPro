import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommercialModule } from '../commercial/commercial.module';
import { AnalyticsService } from './analytics.service';
import { FinanceController } from './finance.controller';
import { FinanceCoreService } from './finance-core.service';
import { ProfitabilityService } from './profitability.service';
import { ReceivablesService } from './receivables.service';

/** Sprint 19: receivables, payments, shipment profitability and repeat business (operational finance, not accounting). StorageModule is global. */
@Module({
  imports: [AuditModule, CommercialModule],
  controllers: [FinanceController],
  providers: [
    FinanceCoreService,
    ReceivablesService,
    ProfitabilityService,
    AnalyticsService,
  ],
  exports: [
    FinanceCoreService,
    ReceivablesService,
    ProfitabilityService,
    AnalyticsService,
  ],
})
export class FinanceModule {}
