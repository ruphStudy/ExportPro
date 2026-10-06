import { Module } from '@nestjs/common';
import { PersonalizationModule } from '../personalization/personalization.module';
import { ProductAnalysisModule } from '../product-analysis/product-analysis.module';
import { ProductIntelligenceModule } from '../product-intelligence/product-intelligence.module';
import { CountryIntelligenceController } from './country-intelligence.controller';
import { CountryIntelligenceService } from './country-intelligence.service';
import { COUNTRY_TRADE_DATA_PROVIDER } from './providers/country-trade-data.provider';
import { SampleCountryDataProvider } from './providers/sample-country-data.provider';
import { RealDataCountryProvider } from './providers/real-data-country.provider';
import { TradeDataModule } from '../trade-data/trade-data.module';
import { TradeDataOverlayService } from '../trade-data/overlay/trade-data-overlay.service';

@Module({
  imports: [
    ProductAnalysisModule,
    ProductIntelligenceModule,
    PersonalizationModule,
    TradeDataModule,
  ],
  controllers: [CountryIntelligenceController],
  providers: [
    CountryIntelligenceService,
    // Sprint 9: real destination-import facts over the sample fallback.
    {
      provide: COUNTRY_TRADE_DATA_PROVIDER,
      inject: [TradeDataOverlayService],
      useFactory: (overlay: TradeDataOverlayService) =>
        new RealDataCountryProvider(new SampleCountryDataProvider(), overlay),
    },
  ],
  exports: [CountryIntelligenceService],
})
export class CountryIntelligenceModule {}
