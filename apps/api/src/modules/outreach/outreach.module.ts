import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { InquiriesModule } from '../inquiries/inquiries.module';
import { OutreachEventsService } from './outreach-events.service';
import { OutreachProcessorService } from './outreach-processor.service';
import {
  OutreachController,
  OutreachPublicController,
} from './outreach.controller';
import { OutreachService } from './outreach.service';
import {
  createContentProvider,
  OUTREACH_CONTENT_PROVIDER,
} from './providers/content-provider';
import { OUTREACH_PROVIDER } from './providers/outreach-provider';
import { createOutreachProvider } from './providers/provider.factory';

/** Sprint 12 buyer outreach & campaign automation (campaign-local, not a global automation engine). */
@Module({
  // InquiriesModule: recorded buyer replies become inquiries (Sprint 13).
  imports: [AuditModule, InquiriesModule],
  controllers: [OutreachController, OutreachPublicController],
  providers: [
    OutreachService,
    OutreachEventsService,
    OutreachProcessorService,
    {
      provide: OUTREACH_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createOutreachProvider(
          config.get('outreach', { infer: true }),
          config.get('app.nodeEnv', { infer: true }),
        ),
    },
    {
      provide: OUTREACH_CONTENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createContentProvider(
          config.get('ai', { infer: true }),
          config.get('app.nodeEnv', { infer: true }),
        ),
    },
  ],
})
export class OutreachModule {}
