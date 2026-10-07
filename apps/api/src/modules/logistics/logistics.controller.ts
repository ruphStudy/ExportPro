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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { Actor } from '../commercial/commercial-core.service';
import { MAX_INQUIRY_ATTACHMENT_BYTES } from '../storage/storage.service';
import { FreightService } from './freight.service';
import {
  ClaimDto,
  CompareQuotesDto,
  ContainerDto,
  CostsDto,
  CreateShipmentDto,
  ExceptionDto,
  FreightQuoteDto,
  FreightRequestDto,
  GenerateUpdateDto,
  LegDto,
  ListQueryDto,
  MilestoneDto,
  ProviderDto,
  ReasonDto,
  RecordSentDto,
  ResolveExceptionDto,
  SelectQuoteDto,
  SettingsDto,
  ShipmentDto,
  StatusDto,
  TrackingEventDto,
} from './logistics.dto';
import { ShipmentsService } from './shipments.service';

const actor = (req: Request): Actor => ({
  organizationId: req.organizationId!,
  userId: req.user!.id,
  role: req.membershipRole!,
});
const upload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INQUIRY_ATTACHMENT_BYTES + 1, files: 1 },
    }),
  );

@ApiTags('logistics')
@UseGuards(PermissionGuard)
@Controller('freight-quotes')
export class FreightQuotesController {
  constructor(private readonly f: FreightService) {}

  @RequirePermission('logistics.view') @Get() list(
    @Req() req: Request,
    @Query() q: ListQueryDto,
  ) {
    return this.f.list(actor(req), q);
  }
  @RequirePermission('logistics.freight_quotes.create') @Post() create(
    @Req() req: Request,
    @Body() dto: FreightQuoteDto,
  ) {
    return this.f.create(actor(req), dto);
  }
  @RequirePermission('logistics.view')
  @HttpCode(HttpStatus.OK)
  @Post('compare')
  compare(@Req() req: Request, @Body() dto: CompareQuotesDto) {
    return this.f.compare(actor(req), dto);
  }
  @RequirePermission('logistics.view') @Get(':id') detail(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.f.detail(actor(req), id);
  }
  @RequirePermission('logistics.freight_quotes.create') @Patch(':id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: FreightQuoteDto,
  ) {
    return this.f.update(actor(req), id, dto);
  }
  @RequirePermission('logistics.freight_quotes.select')
  @HttpCode(HttpStatus.OK)
  @Post(':id/select')
  select(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SelectQuoteDto,
  ) {
    return this.f.select(actor(req), id, dto);
  }
  @RequirePermission('logistics.freight_quotes.create')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  reject(@Req() req: Request, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.f.close(actor(req), id, dto, 'REJECTED');
  }
  @RequirePermission('logistics.freight_quotes.create')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(@Req() req: Request, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.f.close(actor(req), id, dto, 'CANCELLED');
  }
  @RequirePermission('logistics.freight_quotes.create')
  @upload()
  @Post(':id/attachments')
  attach(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.f.attachToQuote(actor(req), id, file);
  }
}

@ApiTags('logistics')
@UseGuards(PermissionGuard)
@Controller('logistics')
export class LogisticsController {
  constructor(
    private readonly f: FreightService,
    private readonly s: ShipmentsService,
  ) {}

  @RequirePermission('logistics.view') @Get('overview') overview(
    @Req() req: Request,
  ) {
    return this.s.overview(actor(req));
  }
  @RequirePermission('logistics.view') @Get('settings') settings(
    @Req() req: Request,
  ) {
    return this.s.settings(actor(req));
  }
  @RequirePermission('logistics.override') @Patch('settings') updateSettings(
    @Req() req: Request,
    @Body() dto: SettingsDto,
  ) {
    return this.s.updateSettings(actor(req), dto);
  }
  @RequirePermission('logistics.view') @Get('providers') providers(
    @Req() req: Request,
  ) {
    return this.f.providers(actor(req));
  }
  @RequirePermission('logistics.freight_quotes.create')
  @Post('providers')
  createProvider(@Req() req: Request, @Body() dto: ProviderDto) {
    return this.f.createProvider(actor(req), dto);
  }
  @RequirePermission('logistics.view') @Get('freight-requests') requests(
    @Req() req: Request,
    @Query('purchaseOrderId') po?: string,
  ) {
    return this.f.requests(actor(req), po);
  }
  @RequirePermission('logistics.view')
  @Get('freight-requests/prefill')
  requestPrefill(@Req() req: Request, @Query('purchaseOrderId') po: string) {
    return this.f.requestPrefill(actor(req), po);
  }
  @RequirePermission('logistics.freight_quotes.create')
  @Post('freight-requests')
  createRequest(@Req() req: Request, @Body() dto: FreightRequestDto) {
    return this.f.createRequest(actor(req), dto);
  }
  @RequirePermission('logistics.view') @Get('freight-requests/:id') request(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.f.request(actor(req), id);
  }
  @RequirePermission('logistics.view')
  @Get('attachments/:id/download')
  async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const f = await this.f.download(actor(req), id);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    );
    res.send(f.buffer);
  }
}

@ApiTags('logistics')
@UseGuards(PermissionGuard)
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly s: ShipmentsService) {}

  @RequirePermission('logistics.view') @Get() list(
    @Req() req: Request,
    @Query() q: ListQueryDto,
  ) {
    return this.s.list(actor(req), q);
  }
  @RequirePermission('logistics.view') @Get('prefill') prefill(
    @Req() req: Request,
    @Query('purchaseOrderId') po: string,
    @Query('freightQuoteId') fq?: string,
  ) {
    return this.s.prefill(actor(req), po, fq || undefined);
  }
  @RequirePermission('logistics.shipments.create') @Post() create(
    @Req() req: Request,
    @Body() dto: CreateShipmentDto,
  ) {
    return this.s.create(actor(req), dto);
  }
  @RequirePermission('logistics.view') @Get(':id') detail(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.s.detail(actor(req), id);
  }
  @RequirePermission('logistics.shipments.edit') @Patch(':id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ShipmentDto,
  ) {
    return this.s.update(actor(req), id, dto);
  }
  @RequirePermission('logistics.shipments.edit')
  @HttpCode(HttpStatus.OK)
  @Post(':id/status')
  status(@Req() req: Request, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.s.changeStatus(actor(req), id, dto);
  }
  @RequirePermission('logistics.shipments.edit')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(@Req() req: Request, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.s.cancel(actor(req), id, dto);
  }
  @RequirePermission('logistics.view') @Get(':id/milestones') async milestones(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return (await this.s.detail(actor(req), id)).milestones;
  }
  @RequirePermission('logistics.shipments.edit')
  @Patch(':id/milestones/:milestoneId')
  milestone(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('milestoneId') mid: string,
    @Body() dto: MilestoneDto,
  ) {
    return this.s.updateMilestone(actor(req), id, mid, dto);
  }
  @RequirePermission('logistics.view') @Get(':id/tracking') tracking(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.s.trackingList(actor(req), id);
  }
  @RequirePermission('logistics.tracking.update')
  @Post(':id/tracking')
  addTracking(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: TrackingEventDto,
  ) {
    return this.s.manualTracking(actor(req), id, dto);
  }
  @RequirePermission('logistics.tracking.update')
  @HttpCode(HttpStatus.OK)
  @Post(':id/tracking/refresh')
  refresh(@Req() req: Request, @Param('id') id: string) {
    return this.s.refreshTracking(actor(req), id);
  }
  @RequirePermission('logistics.shipments.edit')
  @Post(':id/containers')
  addContainer(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ContainerDto,
  ) {
    return this.s.addContainer(actor(req), id, dto);
  }
  @RequirePermission('logistics.shipments.edit')
  @Patch(':id/containers/:cid')
  updateContainer(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('cid') cid: string,
    @Body() dto: ContainerDto,
  ) {
    return this.s.updateContainer(actor(req), id, cid, dto);
  }
  @RequirePermission('logistics.shipments.edit')
  @Delete(':id/containers/:cid')
  deleteContainer(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('cid') cid: string,
  ) {
    return this.s.deleteContainer(actor(req), id, cid);
  }
  @RequirePermission('logistics.shipments.edit') @Post(':id/legs') addLeg(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: LegDto,
  ) {
    return this.s.addLeg(actor(req), id, dto);
  }
  @RequirePermission('logistics.shipments.edit')
  @Patch(':id/legs/:legId')
  updateLeg(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('legId') legId: string,
    @Body() dto: LegDto,
  ) {
    return this.s.updateLeg(actor(req), id, legId, dto);
  }
  @RequirePermission('logistics.view') @Get(':id/exceptions') async exceptions(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return (await this.s.detail(actor(req), id)).exceptions;
  }
  @RequirePermission('logistics.exceptions.manage')
  @Post(':id/exceptions')
  createException(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ExceptionDto,
  ) {
    return this.s.createException(actor(req), id, dto);
  }
  @RequirePermission('logistics.exceptions.manage')
  @Post(':id/claims')
  createClaim(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ClaimDto,
  ) {
    return this.s.createClaim(actor(req), id, dto);
  }
  @RequirePermission('logistics.shipments.edit')
  @upload()
  @Post(':id/attachments')
  attach(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { exceptionId?: string; claimId?: string },
  ) {
    return this.s.attach(actor(req), id, file, {
      exceptionId: body?.exceptionId || undefined,
      claimId: body?.claimId || undefined,
    });
  }
  @RequirePermission('logistics.view') @Get(':id/buyer-updates') updates(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.s.updates(actor(req), id);
  }
  @RequirePermission('logistics.buyer_updates.manage')
  @Post(':id/buyer-updates/generate')
  generate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: GenerateUpdateDto,
  ) {
    return this.s.generateUpdate(actor(req), id, dto);
  }
  @RequirePermission('logistics.buyer_updates.manage')
  @HttpCode(HttpStatus.OK)
  @Post(':id/buyer-updates/:updateId/approve')
  approve(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('updateId') uid: string,
  ) {
    return this.s.approveUpdate(actor(req), id, uid);
  }
  @RequirePermission('logistics.buyer_updates.manage')
  @HttpCode(HttpStatus.OK)
  @Post(':id/buyer-updates/:updateId/record-sent')
  recordSent(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('updateId') uid: string,
    @Body() dto: RecordSentDto,
  ) {
    return this.s.recordSent(actor(req), id, uid, dto);
  }
  @RequirePermission('logistics.buyer_updates.manage')
  @HttpCode(HttpStatus.OK)
  @Post(':id/buyer-updates/:updateId/discard')
  discard(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('updateId') uid: string,
  ) {
    return this.s.discardUpdate(actor(req), id, uid);
  }
  @RequirePermission('logistics.costs.edit') @Patch(':id/costs') costs(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CostsDto,
  ) {
    return this.s.updateCosts(actor(req), id, dto);
  }
}

@ApiTags('logistics')
@UseGuards(PermissionGuard)
@Controller()
export class ShipmentExceptionsController {
  constructor(private readonly s: ShipmentsService) {}

  @RequirePermission('logistics.view') @Get('shipment-exceptions') list(
    @Req() req: Request,
    @Query() q: ListQueryDto,
  ) {
    return this.s.exceptions(actor(req), q);
  }
  @RequirePermission('logistics.exceptions.manage')
  @HttpCode(HttpStatus.OK)
  @Post('shipment-exceptions/:id/resolve')
  resolve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ResolveExceptionDto,
  ) {
    return this.s.resolveException(actor(req), id, dto);
  }
  @RequirePermission('logistics.exceptions.manage')
  @Patch('shipment-claims/:id')
  claim(@Req() req: Request, @Param('id') id: string, @Body() dto: ClaimDto) {
    return this.s.updateClaim(actor(req), id, dto);
  }
}
