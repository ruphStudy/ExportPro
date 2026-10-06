import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { ComtradeAdapter } from './adapters/comtrade.adapter';
import { ComtradeHsReferenceAdapter } from './adapters/comtrade-hs.adapter';
import { TradeStatManualAdapter } from './adapters/tradestat-manual.adapter';
import { TradeDataIngestionService } from './ingestion.service';
import { TradeDataOverlayService } from './overlay/trade-data-overlay.service';
import { TradeDataController } from './trade-data.controller';
import { TradeDataQueryService } from './trade-data-query.service';
import { TRADE_DATA_ADAPTERS } from './trade-data.tokens';

const range = (spec: string) => {
  const m = /^(\d{4})-(\d{4})$/.exec(spec.trim());
  if (m)
    return Array.from(
      { length: Number(m[2]) - Number(m[1]) + 1 },
      (_, i) => Number(m[1]) + i,
    );
  return spec
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
};
const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

@Module({
  imports: [AuditModule],
  controllers: [TradeDataController],
  providers: [
    TradeDataOverlayService,
    TradeDataIngestionService,
    TradeDataQueryService,
    {
      provide: TRADE_DATA_ADAPTERS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const c = config.get('tradeDataPlatform', { infer: true });
        return [
          new ComtradeAdapter({
            baseUrl: c.comtradeBaseUrl,
            requestGapMs: c.comtradeRequestGapMs,
            hsCodes: list(c.comtradeHsCodes),
            exportYears: range(c.comtradeExportYears),
            importYears: range(c.comtradeImportYears),
            importReporters: list(c.comtradeImportReporters),
          }),
          new ComtradeHsReferenceAdapter(c.hsReferenceUrl),
          new TradeStatManualAdapter(),
        ];
      },
    },
  ],
  exports: [TradeDataOverlayService],
})
export class TradeDataModule {}
