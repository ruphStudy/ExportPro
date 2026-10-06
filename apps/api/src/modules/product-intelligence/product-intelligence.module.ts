import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProductAnalysisModule } from '../product-analysis/product-analysis.module';
import { ProductIntelligenceController } from './product-intelligence.controller';
import { ProductIntelligenceService } from './product-intelligence.service';
import { PRODUCT_TRADE_DATA_PROVIDER } from './providers/product-trade-data.provider';
import { SampleTradeDataProvider } from './providers/sample-trade-data.provider';

@Module({
  imports: [AuditModule, ProductAnalysisModule],
  controllers: [ProductIntelligenceController],
  providers: [
    ProductIntelligenceService,
    // Swap for a Sprint 9 official/public trade-data provider; nothing else changes.
    { provide: PRODUCT_TRADE_DATA_PROVIDER, useClass: SampleTradeDataProvider },
  ],
  exports: [ProductIntelligenceService, PRODUCT_TRADE_DATA_PROVIDER],
})
export class ProductIntelligenceModule {}
