import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AuthGuard } from './common/guards/auth.guard';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { StorageModule } from './modules/storage/storage.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { MembersModule } from './modules/members/members.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ReferenceModule } from './modules/reference/reference.module';
import { ExportOnboardingModule } from './modules/export-onboarding/export-onboarding.module';
import { OpportunitiesModule } from './modules/opportunities/opportunities.module';
import { ProductAnalysisModule } from './modules/product-analysis/product-analysis.module';
import { ProductIntelligenceModule } from './modules/product-intelligence/product-intelligence.module';
import { CountryIntelligenceModule } from './modules/country-intelligence/country-intelligence.module';
import { ComparisonsModule } from './modules/comparisons/comparisons.module';
import { TradeDataModule } from './modules/trade-data/trade-data.module';
import { BuyersModule } from './modules/buyers/buyers.module';
import { CostingModule } from './modules/costing/costing.module';
import { InquiriesModule } from './modules/inquiries/inquiries.module';
import { CommercialModule } from './modules/commercial/commercial.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { DocumentValidationModule } from './modules/document-validation/document-validation.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { FinanceModule } from './modules/finance/finance.module';
import { AiOpsModule } from './modules/ai-ops/ai-ops.module';
import { CrmModule } from './modules/crm/crm.module';
import { OutreachModule } from './modules/outreach/outreach.module';
import { DevModule } from './modules/dev/dev.module';

/**
 * Composition root. Domain modules are registered here, each importing
 * only what it needs from PrismaModule/AuditModule/AuthModule —
 * nothing in this file should contain business logic itself.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PrismaModule,
    MailModule,
    StorageModule,
    AuditModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    MembersModule,
    ProfileModule,
    ReferenceModule,
    ExportOnboardingModule,
    OpportunitiesModule,
    ProductAnalysisModule,
    ProductIntelligenceModule,
    CountryIntelligenceModule,
    ComparisonsModule,
    TradeDataModule,
    BuyersModule,
    CostingModule,
    InquiriesModule,
    CommercialModule,
    ComplianceModule,
    DocumentValidationModule,
    LogisticsModule,
    FinanceModule,
    AiOpsModule,
    CrmModule,
    OutreachModule,
    // Dev-only mailbox for reading OTP/reset emails without a real mail provider.
    ...(process.env.NODE_ENV === 'production' ? [] : [DevModule]),
  ],
  providers: [
    // Order matters: rate-limit first (even unauthenticated requests like
    // login attempts), then authenticate.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
