import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CostingService, type Actor } from './costing.service';
import {
  CompareDto,
  CostingListQueryDto,
  CreateCostingDto,
  CreateLineDto,
  CreateScenarioDto,
  FxQueryDto,
  LineDto,
  ManualFxDto,
  ScenarioDto,
  SensitivityQueryDto,
  UpdateCostingDto,
  VersionDto,
} from './costing.dto';

const actor = (req: Request): Actor => ({
  organizationId: req.organizationId!,
  userId: req.user!.id,
  role: req.membershipRole!,
});

/** Calculations are deterministic backend logic; reads and recalculations are not audited, mutations are. */
@ApiTags('costing')
@UseGuards(PermissionGuard)
@Controller('costings')
export class CostingController {
  constructor(private readonly costing: CostingService) {}

  @RequirePermission('costing.view')
  @Get()
  list(@Req() req: Request, @Query() q: CostingListQueryDto) {
    return this.costing.list(req.organizationId!, q);
  }

  @RequirePermission('costing.create')
  @Post()
  create(@Req() req: Request, @Body() dto: CreateCostingDto) {
    return this.costing.create(actor(req), dto);
  }

  @RequirePermission('costing.view')
  @Get(':id')
  detail(@Req() req: Request, @Param('id') id: string) {
    return this.costing.detail(req.organizationId!, id);
  }

  @RequirePermission('costing.edit')
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCostingDto,
  ) {
    return this.costing.update(actor(req), id, dto);
  }

  @RequirePermission('costing.calculate')
  @HttpCode(HttpStatus.OK)
  @Post(':id/calculate')
  calculateAll(@Req() req: Request, @Param('id') id: string) {
    return this.costing.calculateAll(req.organizationId!, id);
  }

  @RequirePermission('costing.ready')
  @HttpCode(HttpStatus.OK)
  @Post(':id/ready')
  ready(@Req() req: Request, @Param('id') id: string, @Body() dto: VersionDto) {
    return this.costing.markReady(actor(req), id, dto.expectedRowVersion);
  }

  @RequirePermission('costing.lock')
  @HttpCode(HttpStatus.OK)
  @Post(':id/lock')
  lock(@Req() req: Request, @Param('id') id: string, @Body() dto: VersionDto) {
    return this.costing.lock(actor(req), id, dto.expectedRowVersion);
  }

  @RequirePermission('costing.create')
  @Post(':id/revise')
  revise(@Req() req: Request, @Param('id') id: string) {
    return this.costing.revise(actor(req), id);
  }

  @RequirePermission('costing.edit')
  @HttpCode(HttpStatus.OK)
  @Post(':id/archive')
  archive(@Req() req: Request, @Param('id') id: string) {
    return this.costing.archive(actor(req), id);
  }

  @RequirePermission('costing.edit')
  @HttpCode(HttpStatus.OK)
  @Post(':id/restore')
  restore(@Req() req: Request, @Param('id') id: string) {
    return this.costing.restore(actor(req), id);
  }

  @RequirePermission('costing.view')
  @Get(':id/snapshots/:snapshotId')
  snapshot(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('snapshotId') snapshotId: string,
  ) {
    return this.costing.snapshot(req.organizationId!, id, snapshotId);
  }

  // Lines: costing.edit, or costing.edit_logistics for logistics categories (checked in the service).
  @RequirePermission('costing.view')
  @Post(':id/lines')
  addLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateLineDto,
  ) {
    return this.costing.addLine(actor(req), id, dto);
  }

  @RequirePermission('costing.view')
  @Patch(':id/lines/:lineId')
  updateLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: LineDto,
  ) {
    return this.costing.updateLine(actor(req), id, lineId, dto);
  }

  @RequirePermission('costing.view')
  @HttpCode(HttpStatus.OK)
  @Delete(':id/lines/:lineId')
  deleteLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Query() q: VersionDto,
  ) {
    return this.costing.deleteLine(
      actor(req),
      id,
      lineId,
      q.expectedRowVersion,
    );
  }

  @RequirePermission('costing.view')
  @Get(':id/scenarios')
  async scenarios(@Req() req: Request, @Param('id') id: string) {
    return (await this.costing.detail(req.organizationId!, id)).scenarios;
  }

  @RequirePermission('costing.edit')
  @Post(':id/scenarios')
  createScenario(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateScenarioDto,
  ) {
    return this.costing.createScenario(actor(req), id, dto);
  }

  // costing.edit, or logistics fields only with costing.edit_logistics (checked in the service).
  @RequirePermission('costing.view')
  @Patch(':id/scenarios/:scenarioId')
  updateScenario(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
    @Body() dto: ScenarioDto,
  ) {
    return this.costing.updateScenario(actor(req), id, scenarioId, dto);
  }

  @RequirePermission('costing.edit')
  @HttpCode(HttpStatus.OK)
  @Delete(':id/scenarios/:scenarioId')
  deleteScenario(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
    @Query() q: VersionDto,
  ) {
    return this.costing.deleteScenario(
      actor(req),
      id,
      scenarioId,
      q.expectedRowVersion,
    );
  }

  @RequirePermission('costing.calculate')
  @HttpCode(HttpStatus.OK)
  @Post(':id/scenarios/:scenarioId/calculate')
  calculate(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
  ) {
    return this.costing.calculateScenario(req.organizationId!, id, scenarioId);
  }

  @RequirePermission('costing.view')
  @Get(':id/scenarios/:scenarioId/analysis')
  analysis(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
    @Query() q: SensitivityQueryDto,
  ) {
    return this.costing.analysis(req.organizationId!, id, scenarioId, q.shifts);
  }

  @RequirePermission('costing.view')
  @HttpCode(HttpStatus.OK)
  @Post(':id/compare')
  compare(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CompareDto,
  ) {
    return this.costing.compare(req.organizationId!, id, dto);
  }
}

@ApiTags('costing')
@UseGuards(PermissionGuard)
@Controller('fx')
export class FxController {
  constructor(private readonly costing: CostingService) {}

  @RequirePermission('costing.view')
  @Get('rates')
  rates(@Req() req: Request, @Query() q: FxQueryDto) {
    return this.costing.listFx(
      req.organizationId!,
      q.baseCurrency,
      q.quoteCurrency,
    );
  }

  @RequirePermission('costing.edit')
  @Post('manual-rate')
  manual(@Req() req: Request, @Body() dto: ManualFxDto) {
    return this.costing.createManualFx(actor(req), dto);
  }
}
