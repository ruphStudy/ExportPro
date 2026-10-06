import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { TradeDataModule } from '../trade-data/trade-data.module';
import { BuyerEnrichmentService } from './buyer-enrichment.service';
import { BuyerSyncService } from './buyer-sync.service';
import { BuyersController } from './buyers.controller';
import { BuyersService } from './buyers.service';
import {
  BUYER_DATA_PROVIDERS,
  BUYER_IDENTITY_PROVIDER,
} from './providers/buyer-provider';
import { GleifIdentityProvider } from './providers/gleif.provider';
import {
  SampleBuyerDirectoryProvider,
  SampleImportRecordsProvider,
} from './providers/sample-buyer.providers';

@Module({
  // TradeDataModule registers the buyer sources in the Sprint 9 source registry.
  imports: [AuditModule, TradeDataModule],
  controllers: [BuyersController],
  providers: [
    BuyersService,
    BuyerEnrichmentService,
    BuyerSyncService,
    // Order = sync order; the directory (identity) provider runs before import records.
    {
      provide: BUYER_DATA_PROVIDERS,
      useFactory: () => [
        new SampleBuyerDirectoryProvider(),
        new SampleImportRecordsProvider(),
      ],
    },
    {
      provide: BUYER_IDENTITY_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        new GleifIdentityProvider(
          config.get('tradeDataPlatform', { infer: true }).gleifBaseUrl,
        ),
    },
  ],
})
export class BuyersModule {}
