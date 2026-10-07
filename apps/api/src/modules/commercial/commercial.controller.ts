import {
  Body,
  Controller,
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
import { MAX_INQUIRY_ATTACHMENT_BYTES } from '../storage/storage.service';
import {
  type Actor,
  CommercialCoreService,
  STARTER_TERMS,
} from './commercial-core.service';
import { QuotationsService } from './quotations.service';
import { ProformaInvoicesService } from './proforma-invoices.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  AcceptPoDto,
  AcceptQuotationDto,
  CreatePiDto,
  CreatePoDto,
  CreateQuotationDto,
  ListQueryDto,
  PoHeaderDto,
  ReasonDto,
  ResolveDiscrepancyDto,
  UpdatePiDto,
  UpdateQuotationDto,
  UpdateSettingsDto,
  UploadPoDto,
  VersionDto,
} from './commercial.dto';

const actor = (req: Request): Actor => ({
  organizationId: req.organizationId!,
  userId: req.user!.id,
  role: req.membershipRole!,
});

/** Private, permission-checked document download (no filesystem paths exposed). */
function sendFile(
  res: Response,
  f: { buffer: Buffer; filename: string; mimeType?: string },
) {
  res.setHeader('Content-Type', f.mimeType ?? 'application/pdf');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
  );
  res.send(f.buffer);
}

@ApiTags('commercial')
@UseGuards(PermissionGuard)
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly q: QuotationsService) {}

  @RequirePermission('quotations.view') @Get() list(
    @Req() req: Request,
    @Query() dto: ListQueryDto,
  ) {
    return this.q.list(actor(req), dto);
  }
  @RequirePermission('quotations.create') @Post() create(
    @Req() req: Request,
    @Body() dto: CreateQuotationDto,
  ) {
    return this.q.create(actor(req), dto);
  }
  @RequirePermission('quotations.view') @Get(':id') detail(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.q.detail(actor(req), id);
  }
  @RequirePermission('quotations.edit') @Patch(':id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.q.update(actor(req), id, dto);
  }
  @RequirePermission('quotations.issue')
  @HttpCode(HttpStatus.OK)
  @Post(':id/issue')
  issue(@Req() req: Request, @Param('id') id: string, @Body() dto: VersionDto) {
    return this.q.issue(actor(req), id, dto.expectedRowVersion);
  }
  @RequirePermission('quotations.revise') @Post(':id/revise') revise(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.q.revise(actor(req), id, dto.reason);
  }
  @RequirePermission('quotations.accept')
  @HttpCode(HttpStatus.OK)
  @Post(':id/accept')
  accept(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AcceptQuotationDto,
  ) {
    return this.q.accept(actor(req), id, dto);
  }
  @RequirePermission('quotations.accept')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  reject(@Req() req: Request, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.q.reject(actor(req), id, dto);
  }
  @RequirePermission('quotations.edit')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(@Req() req: Request, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.q.cancel(actor(req), id, dto);
  }
  @RequirePermission('quotations.view') @Get(':id/pdf') async pdf(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.q.pdf(actor(req), id));
  }
}

@ApiTags('commercial')
@UseGuards(PermissionGuard)
@Controller('proforma-invoices')
export class ProformaInvoicesController {
  constructor(private readonly p: ProformaInvoicesService) {}

  @RequirePermission('proforma_invoice.view') @Get() list(
    @Req() req: Request,
    @Query() dto: ListQueryDto,
  ) {
    return this.p.list(actor(req), dto);
  }
  @RequirePermission('proforma_invoice.create') @Post() create(
    @Req() req: Request,
    @Body() dto: CreatePiDto,
  ) {
    return this.p.create(actor(req), dto);
  }
  @RequirePermission('proforma_invoice.view') @Get(':id') detail(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.p.detail(actor(req), id);
  }
  @RequirePermission('proforma_invoice.edit') @Patch(':id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdatePiDto,
  ) {
    return this.p.update(actor(req), id, dto);
  }
  @RequirePermission('proforma_invoice.issue')
  @HttpCode(HttpStatus.OK)
  @Post(':id/issue')
  issue(@Req() req: Request, @Param('id') id: string, @Body() dto: VersionDto) {
    return this.p.issue(actor(req), id, dto.expectedRowVersion);
  }
  @RequirePermission('proforma_invoice.edit') @Post(':id/revise') revise(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.p.revise(actor(req), id, dto.reason);
  }
  @RequirePermission('proforma_invoice.edit')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(@Req() req: Request, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.p.cancel(actor(req), id, dto);
  }
  @RequirePermission('proforma_invoice.view') @Get(':id/pdf') async pdf(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.p.pdf(actor(req), id));
  }
}

const poUpload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INQUIRY_ATTACHMENT_BYTES + 1 },
    }),
  );

@ApiTags('commercial')
@UseGuards(PermissionGuard)
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly po: PurchaseOrdersService) {}

  @RequirePermission('purchase_orders.view') @Get() list(
    @Req() req: Request,
    @Query() dto: ListQueryDto,
  ) {
    return this.po.list(actor(req), dto);
  }
  @RequirePermission('purchase_orders.create') @Post() create(
    @Req() req: Request,
    @Body() dto: CreatePoDto,
  ) {
    return this.po.create(actor(req), dto);
  }
  @RequirePermission('purchase_orders.create')
  @poUpload()
  @Post('upload')
  upload(
    @Req() req: Request,
    @Body() dto: UploadPoDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.po.upload(actor(req), dto, file);
  }
  @RequirePermission('purchase_orders.view') @Get(':id') detail(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.po.detail(actor(req), id);
  }
  @RequirePermission('purchase_orders.create') @Patch(':id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: PoHeaderDto,
  ) {
    return this.po.update(actor(req), id, dto);
  }
  @RequirePermission('purchase_orders.review')
  @HttpCode(HttpStatus.OK)
  @Post(':id/compare')
  compare(@Req() req: Request, @Param('id') id: string) {
    return this.po.runCompare(actor(req), id);
  }
  @RequirePermission('purchase_orders.review')
  @HttpCode(HttpStatus.OK)
  @Post(':id/discrepancies/:discrepancyId/resolve')
  resolve(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('discrepancyId') did: string,
    @Body() dto: ResolveDiscrepancyDto,
  ) {
    return this.po.resolve(actor(req), id, did, dto);
  }
  @RequirePermission('purchase_orders.accept')
  @HttpCode(HttpStatus.OK)
  @Post(':id/accept')
  accept(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AcceptPoDto,
  ) {
    return this.po.accept(actor(req), id, dto);
  }
  @RequirePermission('purchase_orders.review')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  reject(@Req() req: Request, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.po.reject(actor(req), id, dto);
  }
  @RequirePermission('purchase_orders.review')
  @HttpCode(HttpStatus.OK)
  @Post(':id/request-clarification')
  clarify(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.po.requestClarification(actor(req), id, dto);
  }
  @RequirePermission('purchase_orders.review')
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(@Req() req: Request, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.po.cancel(actor(req), id, dto);
  }
  @RequirePermission('purchase_orders.create')
  @poUpload()
  @Post(':id/attachments')
  attach(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.po.addAttachment(actor(req), id, file);
  }
  @RequirePermission('purchase_orders.view')
  @Get(':id/attachments/:attachmentId/download')
  async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('attachmentId') aid: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.po.readAttachment(req.organizationId!, id, aid));
  }
}

@ApiTags('commercial')
@UseGuards(PermissionGuard)
@Controller('commercial')
export class CommercialSettingsController {
  constructor(
    private readonly core: CommercialCoreService,
    private readonly q: QuotationsService,
  ) {}

  @RequirePermission('quotations.view') @Get('settings') settings(
    @Req() req: Request,
  ) {
    return this.core.settings(actor(req));
  }
  @RequirePermission('commercial.settings') @Patch('settings') update(
    @Req() req: Request,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.core.updateSettings(actor(req), dto);
  }
  /** Editable starter text, never inserted automatically. */
  @RequirePermission('quotations.view') @Get('starter-terms') starter() {
    return {
      text: STARTER_TERMS,
      notice:
        'Starter template only — review and edit; this is not legal advice.',
    };
  }
  @RequirePermission('quotations.view') @Get('summary') summary(
    @Req() req: Request,
  ) {
    return this.q.actionSummary(req.organizationId!);
  }
}
