import { Module } from '@nestjs/common';
import { CountryIntelligenceModule } from '../country-intelligence/country-intelligence.module';
import { PersonalizationModule } from '../personalization/personalization.module';
import { ProductAnalysisModule } from '../product-analysis/product-analysis.module';
import { ProductIntelligenceModule } from '../product-intelligence/product-intelligence.module';
import { ComparisonsController } from './comparisons.controller';
import { ComparisonService } from './comparison.service';
import { RecommendationService } from './recommendation.service';

@Module({
  imports: [
    ProductAnalysisModule,
    ProductIntelligenceModule,
    CountryIntelligenceModule,
    PersonalizationModule,
  ],
  controllers: [ComparisonsController],
  providers: [ComparisonService, RecommendationService],
})
export class ComparisonsModule {}
