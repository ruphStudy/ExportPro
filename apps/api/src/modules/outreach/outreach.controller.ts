import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { OutreachEventsService } from './outreach-events.service';
import { Actor, OutreachService } from './outreach.service';
import {
  CampaignListQueryDto,
  CreateCampaignDto,
  GenerateDto,
  InterestedDto,
  RepliedDto,
  LaunchDto,
  MessageQueryDto,
  PreviewDto,
  RecipientQueryDto,
  SetRecipientsDto,
  SettingsDto,
  SuppressionDto,
  TemplateDto,
  TemplateQueryDto,
  UpdateCampaignDto,
  UpdateTemplateDto,
  ValidateTemplateDto,
} from './outreach.dto';
import {
  OUTREACH_PROVIDER,
  type OutreachProvider,
} from './providers/outreach-provider';

/**
 * Sprint 12 buyer outreach. Every authenticated route is scoped to the
 * session's active organization; other organizations' IDs return 404.
 */
@ApiTags('outreach')
@UseGuards(PermissionGuard)
@Controller('outreach')
export class OutreachController {
  constructor(private readonly outreach: OutreachService) {}

  private actor(req: Request): Actor {
    return { organizationId: req.organizationId!, userId: req.user!.id };
  }

  // ------------------------------------------------------------ settings

  @RequirePermission('outreach.view')
  @Get('settings')
  settings(@Req() req: Request) {
    return this.outreach.getSettings(req.organizationId!);
  }

  @RequirePermission('outreach.settings')
  @Put('settings')
  updateSettings(@Req() req: Request, @Body() dto: SettingsDto) {
    return this.outreach.updateSettings(this.actor(req), dto);
  }

  @RequirePermission('outreach.settings')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('settings/verify-domain')
  verifyDomain(@Req() req: Request) {
    return this.outreach.verifyDomain(this.actor(req));
  }

  // ----------------------------------------------------------- templates

  @RequirePermission('outreach.view')
  @Get('templates')
  templates(@Req() req: Request, @Query() q: TemplateQueryDto) {
    return this.outreach.templates(req.organizationId!, q.includeArchived);
  }

  @RequirePermission('outreach.templates')
  @Post('templates')
  createTemplate(@Req() req: Request, @Body() dto: TemplateDto) {
    return this.outreach.createTemplate(this.actor(req), dto);
  }

  @RequirePermission('outreach.templates')
  @Patch('templates/:id')
  updateTemplate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.outreach.updateTemplate(this.actor(req), id, dto);
  }

  @RequirePermission('outreach.templates')
  @Post('templates/:id/duplicate')
  duplicateTemplate(@Req() req: Request, @Param('id') id: string) {
    return this.outreach.duplicateTemplate(this.actor(req), id);
  }

  @RequirePermission('outreach.view')
  @HttpCode(HttpStatus.OK)
  @Post('templates/validate')
  validate(@Body() dto: ValidateTemplateDto) {
    return this.outreach.validate(dto.subject, dto.body);
  }

  @RequirePermission('outreach.edit')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('generate')
  generate(@Req() req: Request, @Body() dto: GenerateDto) {
    return this.outreach.generate(this.actor(req), dto);
  }

  // ----------------------------------------------------------- campaigns

  @RequirePermission('outreach.view')
  @Get('campaigns')
  list(@Req() req: Request, @Query() q: CampaignListQueryDto) {
    return this.outreach.list(req.organizationId!, q);
  }

  @RequirePermission('outreach.create')
  @Post('campaigns')
  create(@Req() req: Request, @Body() dto: CreateCampaignDto) {
    return this.outreach.createCampaign(this.actor(req), dto);
  }

  @RequirePermission('outreach.view')
  @Get('campaigns/:id')
  detail(@Req() req: Request, @Param('id') id: string) {
    return this.outreach.detail(req.organizationId!, id);
  }

  @RequirePermission('outreach.edit')
  @Patch('campaigns/:id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.outreach.updateCampaign(this.actor(req), id, dto);
  }

  @RequirePermission('outreach.edit')
  @Put('campaigns/:id/recipients')
  setRecipients(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SetRecipientsDto,
  ) {
    return this.outreach.setRecipients(this.actor(req), id, dto.buyerIds);
  }

  @RequirePermission('outreach.view')
  @Get('campaigns/:id/recipients')
  recipients(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() q: RecipientQueryDto,
  ) {
    return this.outreach.recipients(req.organizationId!, id, q);
  }

  @RequirePermission('outreach.view')
  @HttpCode(HttpStatus.OK)
  @Post('campaigns/:id/preview')
  preview(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: PreviewDto,
  ) {
    return this.outreach.preview(req.organizationId!, id, dto);
  }

  @RequirePermission('outreach.launch')
  @Get('campaigns/:id/launch-check')
  launchCheck(@Req() req: Request, @Param('id') id: string) {
    return this.outreach.launchCheck(this.actor(req), id);
  }

  @RequirePermission('outreach.launch')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('campaigns/:id/launch')
  launch(@Req() req: Request, @Param('id') id: string, @Body() dto: LaunchDto) {
    return this.outreach.launch(this.actor(req), id, dto.confirm);
  }

  @RequirePermission('outreach.edit')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('campaigns/:id/test-send')
  testSend(@Req() req: Request, @Param('id') id: string) {
    return this.outreach.testSend(this.actor(req), id);
  }

  @RequirePermission('outreach.pause')
  @HttpCode(HttpStatus.OK)
  @Post('campaigns/:id/pause')
  pause(@Req() req: Request, @Param('id') id: string) {
    return this.outreach.pause(this.actor(req), id);
  }

  @RequirePermission('outreach.pause')
  @HttpCode(HttpStatus.OK)
  @Post('campaigns/:id/resume')
  resume(@Req() req: Request, @Param('id') id: string) {
    return this.outreach.resume(this.actor(req), id);
  }

  @RequirePermission('outreach.pause')
  @HttpCode(HttpStatus.OK)
  @Post('campaigns/:id/cancel')
  cancel(@Req() req: Request, @Param('id') id: string) {
    return this.outreach.cancel(this.actor(req), id);
  }

  // ---------------------------------------------------------- recipients

  @RequirePermission('outreach.edit')
  @HttpCode(HttpStatus.OK)
  @Post('recipients/:id/replied')
  replied(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RepliedDto,
  ) {
    return this.outreach.markReplied(this.actor(req), id, dto.replyText);
  }

  @RequirePermission('outreach.edit')
  @HttpCode(HttpStatus.OK)
  @Post('recipients/:id/interested')
  interested(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: InterestedDto,
  ) {
    return this.outreach.markInterested(this.actor(req), id, dto.interested);
  }

  @RequirePermission('outreach.pause')
  @HttpCode(HttpStatus.OK)
  @Post('recipients/:id/cancel')
  cancelRecipient(@Req() req: Request, @Param('id') id: string) {
    return this.outreach.cancelRecipient(this.actor(req), id);
  }

  // ------------------------------------------------------------- history

  @RequirePermission('outreach.view')
  @Get('messages')
  messages(@Req() req: Request, @Query() q: MessageQueryDto) {
    return this.outreach.messages(req.organizationId!, q);
  }

  @RequirePermission('outreach.view')
  @Get('messages/:id')
  message(@Req() req: Request, @Param('id') id: string) {
    return this.outreach.message(req.organizationId!, id);
  }

  @RequirePermission('outreach.view')
  @Get('buyers/:buyerId/history')
  buyerHistory(@Req() req: Request, @Param('buyerId') buyerId: string) {
    return this.outreach.buyerHistory(req.organizationId!, buyerId);
  }

  @RequirePermission('outreach.view')
  @Get('suppressions')
  suppressions(@Req() req: Request) {
    return this.outreach.suppressions(req.organizationId!);
  }

  @RequirePermission('outreach.settings')
  @Post('suppressions')
  addSuppression(@Req() req: Request, @Body() dto: SuppressionDto) {
    return this.outreach.addSuppression(this.actor(req), dto.address);
  }
}

/** Unauthenticated endpoints: unsubscribe links and provider webhooks. */
@ApiTags('outreach-public')
@Public()
@Controller('outreach/public')
export class OutreachPublicController {
  constructor(
    private readonly outreach: OutreachService,
    private readonly events: OutreachEventsService,
    @Inject(OUTREACH_PROVIDER) private readonly provider: OutreachProvider,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('unsubscribe/:token')
  status(@Param('token') token: string) {
    return this.outreach.unsubscribeStatus(token);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('unsubscribe/:token')
  unsubscribe(@Param('token') token: string) {
    return this.outreach.unsubscribe(token);
  }

  /** Signature-verified provider events; anything unverified is rejected. */
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('webhooks/:provider')
  async webhook(
    @Param('provider') name: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    if (
      name !== this.provider.name ||
      !req.rawBody ||
      !this.provider.verifyWebhook(req.rawBody, headers)
    )
      throw new UnauthorizedException('Webhook signature verification failed.');
    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid webhook payload.');
    }
    const results = [];
    for (const e of this.provider.parseWebhook(payload))
      results.push(await this.events.applyProviderEvent(this.provider.name, e));
    return { received: results.length, results };
  }
}
