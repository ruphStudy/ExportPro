import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CostingController, FxController } from './costing.controller';
import { CostingService } from './costing.service';

@Module({
  imports: [AuditModule],
  controllers: [CostingController, FxController],
  providers: [CostingService],
})
export class CostingModule {}
