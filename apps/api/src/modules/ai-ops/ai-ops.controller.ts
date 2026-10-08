import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import type { Actor } from '../commercial/commercial-core.service';
import { ActionCenterService } from './action-center.service';
import { AiManagerService } from './ai-manager.service';
import {
  ActionQueryDto,
  CloseActionDto,
  EvaluateDto,
  HistoryQueryDto,
  MessageDto,
  RangeQueryDto,
  RuleDto,
  RunsQueryDto,
  SnoozeDto,
  UpdateActionDto,
} from './ai-ops.dto';
import { AutomationService } from './automation.service';
import { ExecutiveAnalyticsService } from './executive-analytics.service';

const actor = (req: Request): Actor => ({
  organizationId: req.organizationId!,
  userId: req.user!.id,
  role: req.membershipRole!,
});

@ApiTags('ai-manager')
@UseGuards(PermissionGuard)
@Controller('ai-manager')
export class AiManagerController {
  constructor(private readonly ai: AiManagerService) {}
  @RequirePermission('ai_manager.use') @Get('catalog') catalog(
    @Req() req: Request,
  ) {
    return this.ai.catalog(actor(req));
  }
  @RequirePermission('ai_manager.use') @Post('message') @HttpCode(200) message(
    @Req() req: Request,
    @Body() dto: MessageDto,
  ) {
    return this.ai.message(actor(req), dto);
  }
  @RequirePermission('ai_manager.use') @Get('actions') actions(
    @Req() req: Request,
  ) {
    return this.ai.executions(actor(req));
  }
  @RequirePermission('ai_manager.execute')
  @Post('actions/:id/confirm')
  @HttpCode(200)
  confirm(@Req() req: Request, @Param('id') id: string) {
    return this.ai.confirm(actor(req), id);
  }
  @RequirePermission('ai_manager.use')
  @Post('actions/:id/cancel')
  @HttpCode(200)
  cancel(@Req() req: Request, @Param('id') id: string) {
    return this.ai.cancel(actor(req), id);
  }
  @RequirePermission('ai_manager.use') @Get('history') history(
    @Req() req: Request,
    @Query() q: HistoryQueryDto,
  ) {
    return this.ai.history(actor(req), q.conversationId);
  }
}

@ApiTags('action-center')
@UseGuards(PermissionGuard)
@Controller('action-center')
export class ActionCenterController {
  constructor(
    private readonly items: ActionCenterService,
    private readonly automation: AutomationService,
  ) {}
  /** Read-time evaluation (deduplicated, rate-limited to once a minute) keeps items fresh without a scheduler. */
  @RequirePermission('action_center.view') @Get() async list(
    @Req() req: Request,
    @Query() q: ActionQueryDto,
  ) {
    const a = actor(req);
    await this.automation
      .evaluate(a, q.refresh === 'true')
      .catch(() => undefined);
    return this.items.list(
      a,
      q,
      (await this.automation.settings(a.organizationId)).lastEvaluatedAt,
    );
  }
  @RequirePermission('action_center.view') @Get('summary') async summary(
    @Req() req: Request,
  ) {
    const a = actor(req);
    await this.automation.evaluate(a).catch(() => undefined);
    return this.items.summary(
      a,
      (await this.automation.settings(a.organizationId)).lastEvaluatedAt,
    );
  }
  @RequirePermission('action_center.manage') @Patch(':id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateActionDto,
  ) {
    return this.items.update(actor(req), id, dto);
  }
  @RequirePermission('action_center.manage')
  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CloseActionDto,
  ) {
    return this.items.complete(
      actor(req),
      id,
      dto.reason,
      dto.expectedRowVersion,
    );
  }
  @RequirePermission('action_center.manage')
  @Post(':id/snooze')
  @HttpCode(200)
  snooze(@Req() req: Request, @Param('id') id: string, @Body() dto: SnoozeDto) {
    return this.items.snooze(
      actor(req),
      id,
      dto.preset,
      dto.until,
      dto.expectedRowVersion,
    );
  }
  @RequirePermission('action_center.manage')
  @Post(':id/dismiss')
  @HttpCode(200)
  dismiss(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CloseActionDto,
  ) {
    return this.items.dismiss(
      actor(req),
      id,
      dto.reason,
      dto.expectedRowVersion,
    );
  }
}

@ApiTags('automation')
@UseGuards(PermissionGuard)
@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}
  @RequirePermission('automation.view') @Get('rules') rules(
    @Req() req: Request,
  ) {
    return this.automation.rules(actor(req));
  }
  @RequirePermission('automation.manage') @Post('rules') create(
    @Req() req: Request,
    @Body() dto: RuleDto,
  ) {
    return this.automation.create(actor(req), dto);
  }
  @RequirePermission('automation.view') @Get('rules/:id') rule(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.automation.rule(actor(req), id);
  }
  @RequirePermission('automation.manage') @Patch('rules/:id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RuleDto,
  ) {
    return this.automation.update(actor(req), id, dto);
  }
  @RequirePermission('automation.manage')
  @Post('rules/:id/enable')
  @HttpCode(200)
  enable(@Req() req: Request, @Param('id') id: string) {
    return this.automation.setEnabled(actor(req), id, true);
  }
  @RequirePermission('automation.manage')
  @Post('rules/:id/disable')
  @HttpCode(200)
  disable(@Req() req: Request, @Param('id') id: string) {
    return this.automation.setEnabled(actor(req), id, false);
  }
  @RequirePermission('automation.view') @Get('runs') runs(
    @Req() req: Request,
    @Query() q: RunsQueryDto,
  ) {
    return this.automation.runs(actor(req), q);
  }
  @RequirePermission('automation.manage')
  @Post('runs/:id/approve')
  @HttpCode(200)
  approve(@Req() req: Request, @Param('id') id: string) {
    return this.automation.approve(actor(req), id);
  }
  @RequirePermission('action_center.view')
  @Post('evaluate')
  @HttpCode(200)
  evaluate(@Req() req: Request, @Body() dto: EvaluateDto) {
    return this.automation.evaluate(actor(req), dto.force ?? true);
  }
}

@ApiTags('analytics')
@UseGuards(PermissionGuard)
@Controller('analytics')
export class ExecutiveAnalyticsController {
  constructor(private readonly x: ExecutiveAnalyticsService) {}
  @RequirePermission('analytics.view') @Get('overview') overview(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.overview(actor(req), q);
  }
  @RequirePermission('analytics.view') @Get('revenue') revenue(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.revenue(actor(req), q);
  }
  @RequirePermission('analytics.view') @Get('pipeline') pipeline(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.pipeline(actor(req), q);
  }
  @RequirePermission('analytics.view') @Get('markets') markets(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.markets(actor(req), q);
  }
  @RequirePermission('analytics.view') @Get('products') products(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.products(actor(req), q);
  }
  @RequirePermission('analytics.view') @Get('buyers') buyers(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.buyers(actor(req), q);
  }
  @RequirePermission('analytics.view') @Get('campaigns') campaigns(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.campaigns(actor(req), q);
  }
  @RequirePermission('analytics.view') @Get('shipments') shipments(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.shipmentsSection(actor(req), q);
  }
  @RequirePermission('analytics.view') @Get('receivables') receivables(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.receivablesSection(actor(req), q);
  }
  @RequirePermission('analytics.view') @Get('profitability') profitability(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.profitabilitySection(actor(req), q);
  }
  @RequirePermission('analytics.view') @Get('opportunities') opportunities(
    @Req() req: Request,
    @Query() q: RangeQueryDto,
  ) {
    return this.x.opportunities(actor(req), q);
  }
}
