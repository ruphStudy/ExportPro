import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProductAnalysisModule } from '../product-analysis/product-analysis.module';
import { ProductIntelligenceController } from './product-intelligence.controller';
import { ProductIntelligenceService } from './product-intelligence.service';
import { PRODUCT_TRADE_DATA_PROVIDER } from './providers/product-trade-data.provider';
import { SampleTradeDataProvider } from './providers/sample-trade-data.provider';
import { RealDataProductProvider } from './providers/real-data-product.provider';
import { TradeDataModule } from '../trade-data/trade-data.module';
import { TradeDataOverlayService } from '../trade-data/overlay/trade-data-overlay.service';

@Module({
  imports: [AuditModule, ProductAnalysisModule, TradeDataModule],
  controllers: [ProductIntelligenceController],
  providers: [
    ProductIntelligenceService,
    // Sprint 9: real normalized trade facts over the sample fallback (per-section provenance).
    {
      provide: PRODUCT_TRADE_DATA_PROVIDER,
      inject: [TradeDataOverlayService],
      useFactory: (overlay: TradeDataOverlayService) =>
        new RealDataProductProvider(new SampleTradeDataProvider(), overlay),
    },
  ],
  exports: [ProductIntelligenceService, PRODUCT_TRADE_DATA_PROVIDER],
})
export class ProductIntelligenceModule {}
