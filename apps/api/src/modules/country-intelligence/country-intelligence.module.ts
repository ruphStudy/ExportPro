import { Module } from '@nestjs/common';
import { ProductAnalysisModule } from '../product-analysis/product-analysis.module';
import { ProductIntelligenceModule } from '../product-intelligence/product-intelligence.module';
import { CountryIntelligenceController } from './country-intelligence.controller';
import { CountryIntelligenceService } from './country-intelligence.service';
import { COUNTRY_TRADE_DATA_PROVIDER } from './providers/country-trade-data.provider';
import { SampleCountryDataProvider } from './providers/sample-country-data.provider';

@Module({
  imports: [ProductAnalysisModule, ProductIntelligenceModule],
  controllers: [CountryIntelligenceController],
  providers: [
    CountryIntelligenceService,
    // Swap for Sprint 9 trade/tariff/risk providers; nothing else changes.
    {
      provide: COUNTRY_TRADE_DATA_PROVIDER,
      useClass: SampleCountryDataProvider,
    },
  ],
})
export class CountryIntelligenceModule {}
