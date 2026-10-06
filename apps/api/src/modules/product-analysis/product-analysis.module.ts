import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { ProductsController } from '../products/products.controller';
import { ProductsService } from '../products/products.service';
import {
  ProductAnalysisController,
  ProductClassificationsController,
} from './product-analysis.controller';
import { ProductAnalysisService } from './product-analysis.service';
import { CLASSIFICATION_PROVIDER } from './providers/classification-provider';
import { createClassificationProvider } from './providers/provider.factory';
import { TariffReferenceService } from './reference/tariff-reference.service';

@Module({
  imports: [AuditModule],
  controllers: [
    ProductAnalysisController,
    ProductClassificationsController,
    ProductsController,
  ],
  providers: [
    TariffReferenceService,
    ProductsService,
    ProductAnalysisService,
    {
      provide: CLASSIFICATION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createClassificationProvider(
          config.get('ai', { infer: true }),
          config.get('app.nodeEnv', { infer: true }),
        ),
    },
  ],
})
export class ProductAnalysisModule {}
