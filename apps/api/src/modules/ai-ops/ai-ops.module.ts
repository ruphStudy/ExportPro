import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { BuyersModule } from '../buyers/buyers.module';
import { CommercialModule } from '../commercial/commercial.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { CountryIntelligenceModule } from '../country-intelligence/country-intelligence.module';
import { CrmModule } from '../crm/crm.module';
import { DocumentValidationModule } from '../document-validation/document-validation.module';
import { FinanceModule } from '../finance/finance.module';
import { InquiriesModule } from '../inquiries/inquiries.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { OutreachModule } from '../outreach/outreach.module';
import { ProductAnalysisModule } from '../product-analysis/product-analysis.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { ActionCenterService } from './action-center.service';
import {
  ActionCenterController,
  AiManagerController,
  AutomationController,
  ExecutiveAnalyticsController,
} from './ai-ops.controller';
import {
  AI_MANAGER_PROVIDER,
  createAiManagerProvider,
} from './ai-manager.provider';
import { AiManagerService } from './ai-manager.service';
import { AutomationService } from './automation.service';
import { ExecutiveAnalyticsService } from './executive-analytics.service';
import { SignalsService } from './signals.service';

/** Sprint 20: AI Export Manager, Action Center, automation and executive analytics — an orchestration layer over existing module services. */
@Module({
  imports: [
    AuditModule,
    BuyersModule,
    CommercialModule,
    ComplianceModule,
    CountryIntelligenceModule,
    CrmModule,
    DocumentValidationModule,
    FinanceModule,
    InquiriesModule,
    LogisticsModule,
    OpportunitiesModule,
    OutreachModule,
    ProductAnalysisModule,
    ProcurementModule,
  ],
  controllers: [
    AiManagerController,
    ActionCenterController,
    AutomationController,
    ExecutiveAnalyticsController,
  ],
  providers: [
    SignalsService,
    ActionCenterService,
    AutomationService,
    ExecutiveAnalyticsService,
    AiManagerService,
    {
      provide: AI_MANAGER_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createAiManagerProvider(
          config.get('ai', { infer: true }),
          config.get('app.nodeEnv', { infer: true }),
        ),
    },
  ],
})
export class AiOpsModule {}
