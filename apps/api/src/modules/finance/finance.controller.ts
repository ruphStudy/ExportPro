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
import { AnalyticsService } from './analytics.service';
import { FinanceCoreService } from './finance-core.service';
import {
  AdjustmentDto,
  ConfirmNoneDto,
  CostDto,
  CreateReceivableDto,
  DismissDto,
  DisputeDto,
  FinalizeDto,
  InstallmentDateDto,
  LcDto,
  ListQueryDto,
  PaymentDto,
  ReasonDto,
  RecordSentDto,
  ReminderDto,
  ReopenDto,
  ReorderCreateDto,
  SettingsDto,
  SnoozeDto,
  UpdateCostDto,
  UpdateReceivableDto,
} from './finance.dto';
import { ProfitabilityService } from './profitability.service';
import { ReceivablesService } from './receivables.service';

const actor = (req: Request): Actor => ({
  organizationId: req.organizationId!,
  userId: req.user!.id,
  role: req.membershipRole!,
});

@ApiTags('finance')
@UseGuards(PermissionGuard)
@Controller()
export class FinanceController {
  constructor(
    private readonly r: ReceivablesService,
    private readonly p: ProfitabilityService,
    private readonly an: AnalyticsService,
    private readonly fin: FinanceCoreService,
  ) {}

  // ------------------------------------------------------------ settings / overview
  @RequirePermission('finance.view') @Get('finance/settings') settings(
    @Req() req: Request,
  ) {
    return this.fin.settings(actor(req).organizationId);
  }
  @RequirePermission('finance.settings')
  @Patch('finance/settings')
  updateSettings(@Req() req: Request, @Body() dto: SettingsDto) {
    return this.fin.updateSettings(actor(req), dto);
  }
  @RequirePermission('finance.view') @Get('finance/overview') async overview(
    @Req() req: Request,
    @Query() q: ListQueryDto,
  ) {
    const a = actor(req);
    return this.r.overview(a, q, await this.an.overviewExtras(a));
  }
  @RequirePermission('finance.view') @Get('finance/aging') aging(
    @Req() req: Request,
    @Query() q: ListQueryDto,
  ) {
    return this.r.aging(actor(req), (q.groupBy ?? 'buyer') as 'buyer');
  }
  @RequirePermission('finance.view') @Get('finance/payments') paymentsList(
    @Req() req: Request,
    @Query() q: ListQueryDto,
  ) {
    return this.r.paymentsList(actor(req), q);
  }
  @RequirePermission('finance.view')
  @Get('finance/buyers/:buyerId/summary')
  buyerSummary(@Req() req: Request, @Param('buyerId') id: string) {
    return this.an.buyerSummary(actor(req), id);
  }

  // ------------------------------------------------------------ receivables
  @RequirePermission('finance.view') @Get('receivables') list(
    @Req() req: Request,
    @Query() q: ListQueryDto,
  ) {
    return this.r.list(actor(req), q);
  }
  @RequirePermission('receivables.manage') @Get('receivables/prefill') prefill(
    @Req() req: Request,
    @Query('purchaseOrderId') po: string,
    @Query('shipmentId') sh?: string,
  ) {
    return this.r.prefill(actor(req), po, sh || undefined);
  }
  @RequirePermission('finance.view') @Get('receivables/reminders') reminders(
    @Req() req: Request,
  ) {
    return this.r.reminders(actor(req));
  }
  @RequirePermission('receivables.manage') @Post('receivables') create(
    @Req() req: Request,
    @Body() dto: CreateReceivableDto,
  ) {
    return this.r.create(actor(req), dto);
  }
  @RequirePermission('finance.view') @Get('receivables/:id') detail(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.r.detail(actor(req), id);
  }
  @RequirePermission('receivables.manage') @Patch('receivables/:id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateReceivableDto,
  ) {
    return this.r.update(actor(req), id, dto);
  }
  @RequirePermission('receivables.manage')
  @Patch('receivables/:id/installments/:installmentId')
  installment(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('installmentId') iid: string,
    @Body() dto: InstallmentDateDto,
  ) {
    return this.r.setInstallmentDate(actor(req), id, iid, dto);
  }
  @RequirePermission('receivables.manage')
  @Post('receivables/:id/dispute')
  @HttpCode(200)
  dispute(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: DisputeDto,
  ) {
    return this.r.dispute(actor(req), id, dto);
  }
  @RequirePermission('payments.record') @Post('receivables/:id/payments') pay(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: PaymentDto,
  ) {
    return this.r.recordPayment(actor(req), id, dto);
  }
  @RequirePermission('finance.view') @Get('receivables/:id/payments') payments(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.r.payments(actor(req), id);
  }
  @RequirePermission('payments.reverse')
  @Post('payments/:id/reverse')
  @HttpCode(200)
  reverse(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.r.reversePayment(actor(req), id, dto.reason);
  }
  @RequirePermission('receivables.manage')
  @Post('receivables/:id/letter-of-credit')
  lc(@Req() req: Request, @Param('id') id: string, @Body() dto: LcDto) {
    return this.r.createLc(actor(req), id, dto);
  }
  @RequirePermission('receivables.manage')
  @Patch('letters-of-credit/:id')
  updateLc(@Req() req: Request, @Param('id') id: string, @Body() dto: LcDto) {
    return this.r.updateLc(actor(req), id, dto);
  }
  @RequirePermission('finance.view') @Get('letters-of-credit/:id') getLc(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.r.getLc(actor(req), id);
  }
  @RequirePermission('receivables.manage')
  @Post('receivables/:id/reminders')
  reminder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ReminderDto,
  ) {
    return this.r.createReminder(actor(req), id, dto);
  }
  @RequirePermission('receivables.manage')
  @Post('receivable-reminders/:id/dismiss')
  @HttpCode(200)
  dismissReminder(@Req() req: Request, @Param('id') id: string) {
    return this.r.dismissReminder(actor(req), id);
  }
  @RequirePermission('receivables.manage')
  @Post('receivable-reminders/:id/record-sent')
  @HttpCode(200)
  reminderSent(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RecordSentDto,
  ) {
    return this.r.recordReminderSent(actor(req), id, dto.channel);
  }

  // ------------------------------------------------------------ profitability
  @RequirePermission('profitability.view')
  @Get('profitability/shipments')
  profitList(@Req() req: Request, @Query() q: ListQueryDto) {
    return this.p.list(actor(req), q);
  }
  @RequirePermission('profitability.view')
  @Get('profitability/shipments/:shipmentId')
  profitDetail(@Req() req: Request, @Param('shipmentId') id: string) {
    return this.p.detail(actor(req), id);
  }
  @RequirePermission('profitability.view')
  @Get('profitability/shipments/:shipmentId/status')
  profitStatus(@Req() req: Request, @Param('shipmentId') id: string) {
    return this.p.shipmentStatus(actor(req), id);
  }
  @RequirePermission('profitability.edit_costs')
  @Post('profitability/shipments/:shipmentId/costs')
  addCost(
    @Req() req: Request,
    @Param('shipmentId') id: string,
    @Body() dto: CostDto,
  ) {
    return this.p.addCost(actor(req), id, dto);
  }
  @RequirePermission('profitability.edit_costs')
  @Patch('profitability/costs/:costId')
  updateCost(
    @Req() req: Request,
    @Param('costId') id: string,
    @Body() dto: UpdateCostDto,
  ) {
    return this.p.updateCost(actor(req), id, dto);
  }
  @RequirePermission('profitability.edit_costs')
  @Post('profitability/costs/:costId/attachment')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INQUIRY_ATTACHMENT_BYTES + 1, files: 1 },
    }),
  )
  attach(
    @Req() req: Request,
    @Param('costId') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.p.attachCost(actor(req), id, file);
  }
  @RequirePermission('profitability.view')
  @Get('profitability/costs/:costId/attachment')
  async download(
    @Req() req: Request,
    @Param('costId') id: string,
    @Res() res: Response,
  ) {
    const f = await this.p.downloadCost(actor(req), id);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    );
    res.send(f.buffer);
  }
  @RequirePermission('profitability.edit_costs')
  @Post('profitability/shipments/:shipmentId/adjustments')
  adjust(
    @Req() req: Request,
    @Param('shipmentId') id: string,
    @Body() dto: AdjustmentDto,
  ) {
    return this.p.addAdjustment(actor(req), id, dto);
  }
  @RequirePermission('profitability.edit_costs')
  @Post('profitability/shipments/:shipmentId/confirm-none')
  @HttpCode(200)
  confirmNone(
    @Req() req: Request,
    @Param('shipmentId') id: string,
    @Body() dto: ConfirmNoneDto,
  ) {
    return this.p.confirmNone(actor(req), id, dto);
  }
  @RequirePermission('profitability.finalize')
  @Post('profitability/shipments/:shipmentId/finalize')
  @HttpCode(200)
  finalize(
    @Req() req: Request,
    @Param('shipmentId') id: string,
    @Body() dto: FinalizeDto,
  ) {
    return this.p.finalize(actor(req), id, dto.expectedRowVersion);
  }
  @RequirePermission('profitability.reopen')
  @Post('profitability/shipments/:shipmentId/reopen')
  @HttpCode(200)
  reopen(
    @Req() req: Request,
    @Param('shipmentId') id: string,
    @Body() dto: ReopenDto,
  ) {
    return this.p.reopen(actor(req), id, dto);
  }

  // ------------------------------------------------------------ analytics
  @RequirePermission('profitability.view') @Get('profitability/buyers') buyers(
    @Req() req: Request,
    @Query() q: ListQueryDto,
  ) {
    return this.an.buyers(actor(req), q);
  }
  @RequirePermission('profitability.view')
  @Get('profitability/products')
  products(@Req() req: Request, @Query() q: ListQueryDto) {
    return this.an.products(actor(req), q);
  }
  @RequirePermission('profitability.view')
  @Get('profitability/countries')
  countries(@Req() req: Request, @Query() q: ListQueryDto) {
    return this.an.countries(actor(req), q);
  }

  // ------------------------------------------------------------ repeat business
  @RequirePermission('repeat_business.view') @Get('repeat-business') repeat(
    @Req() req: Request,
  ) {
    return this.an.repeatBusiness(actor(req));
  }
  @RequirePermission('repeat_business.view')
  @Get('repeat-business/buyers/:buyerId')
  repeatBuyer(@Req() req: Request, @Param('buyerId') id: string) {
    return this.an.buyerSignal(actor(req), id);
  }
  @RequirePermission('repeat_business.manage')
  @Post('repeat-business/reminders')
  createReorder(@Req() req: Request, @Body() dto: ReorderCreateDto) {
    return this.an.createReorderReminders(actor(req), dto);
  }
  @RequirePermission('repeat_business.manage')
  @Post('reorder-reminders/:id/dismiss')
  @HttpCode(200)
  dismissReorder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: DismissDto,
  ) {
    return this.an.updateReminder(actor(req), id, 'dismiss', {
      expectedRowVersion: dto.expectedRowVersion,
      reason: dto.reason,
    });
  }
  @RequirePermission('repeat_business.manage')
  @Post('reorder-reminders/:id/snooze')
  @HttpCode(200)
  snoozeReorder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SnoozeDto,
  ) {
    return this.an.updateReminder(actor(req), id, 'snooze', {
      until: dto.until,
      expectedRowVersion: dto.expectedRowVersion,
    });
  }
  @RequirePermission('repeat_business.manage')
  @Post('reorder-reminders/:id/draft')
  @HttpCode(200)
  draftReorder(@Req() req: Request, @Param('id') id: string) {
    return this.an.updateReminder(actor(req), id, 'draft', {});
  }
}
