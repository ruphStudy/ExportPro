import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommercialModule } from '../commercial/commercial.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { DocumentValidationModule } from '../document-validation/document-validation.module';
import { FreightService } from './freight.service';
import {
  FreightQuotesController,
  LogisticsController,
  ShipmentExceptionsController,
  ShipmentsController,
} from './logistics.controller';
import { LogisticsContextService } from './logistics-context.service';
import { ShipmentsService } from './shipments.service';
import {
  SHIPMENT_TRACKING_PROVIDER,
  UnconfiguredTrackingProvider,
} from './tracking-provider';

/** Sprint 18: freight quotes, shipments, tracking, exceptions, claims and buyer-update drafts. StorageModule is global. */
@Module({
  imports: [
    AuditModule,
    CommercialModule,
    ComplianceModule,
    DocumentValidationModule,
  ],
  controllers: [
    FreightQuotesController,
    LogisticsController,
    ShipmentsController,
    ShipmentExceptionsController,
  ],
  providers: [
    FreightService,
    ShipmentsService,
    LogisticsContextService,
    {
      provide: SHIPMENT_TRACKING_PROVIDER,
      useClass: UnconfiguredTrackingProvider,
    },
  ],
})
export class LogisticsModule {}
