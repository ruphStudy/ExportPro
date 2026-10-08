import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommercialModule } from '../commercial/commercial.module';
import { CostingModule } from '../costing/costing.module';
import { FinanceModule } from '../finance/finance.module';
import { ProcurementController } from './procurement.controller';
import { SupplierPoService } from './supplier-po.service';
import { SupplierRfqsService } from './supplier-rfqs.service';
import { SuppliersService } from './suppliers.service';

/** Sprint 21: suppliers, supplier RFQs/quotes, supplier POs, goods receipt, quality and supplier payables (operational, not accounting). */
@Module({
  imports: [AuditModule, CommercialModule, FinanceModule, CostingModule],
  controllers: [ProcurementController],
  providers: [SuppliersService, SupplierRfqsService, SupplierPoService],
  exports: [SuppliersService, SupplierRfqsService, SupplierPoService],
})
export class ProcurementModule {}
