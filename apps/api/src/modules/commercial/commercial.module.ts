import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommercialCoreService } from './commercial-core.service';
import {
  CommercialSettingsController,
  ProformaInvoicesController,
  PurchaseOrdersController,
  QuotationsController,
} from './commercial.controller';
import { ProformaInvoicesService } from './proforma-invoices.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { QuotationsService } from './quotations.service';

/** Sprint 15 commercial documents: quotation → proforma invoice → buyer PO. StorageModule is global. */
@Module({
  imports: [AuditModule],
  controllers: [
    QuotationsController,
    ProformaInvoicesController,
    PurchaseOrdersController,
    CommercialSettingsController,
  ],
  providers: [
    CommercialCoreService,
    QuotationsService,
    ProformaInvoicesService,
    PurchaseOrdersService,
  ],
})
export class CommercialModule {}
