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
import {
  AttachmentMetaDto,
  CertificationDto,
  CompareDto,
  GrnDto,
  InspectionDto,
  ListDto,
  ProcurementSourceDto,
  QuoteDto,
  ReasonDto,
  RecordRequestedDto,
  RecordSentDto,
  ReviewQuoteDto,
  ReviseDto,
  RfqDto,
  SelectQuoteDto,
  ShortlistDto,
  SpoDto,
  SpoStatusDto,
  SupplierDto,
  SupplierPaymentDto,
  SupplierSearchDto,
  UseInCostingDto,
  VersionDto,
} from './procurement.dto';
import { SupplierPoService } from './supplier-po.service';
import { SupplierRfqsService } from './supplier-rfqs.service';
import { SuppliersService } from './suppliers.service';

const actor = (req: Request): Actor => ({
  organizationId: req.organizationId!,
  userId: req.user!.id,
  role: req.membershipRole!,
});

function sendFile(
  res: Response,
  f: { buffer: Buffer; filename: string; mimeType?: string | null },
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
const upload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INQUIRY_ATTACHMENT_BYTES + 1 },
    }),
  );

/** Sprint 21 — supplier & procurement management. */
@ApiTags('procurement')
@UseGuards(PermissionGuard)
@Controller('procurement')
export class ProcurementController {
  constructor(
    private readonly s: SuppliersService,
    private readonly r: SupplierRfqsService,
    private readonly po: SupplierPoService,
  ) {}

  @RequirePermission('procurement.view') @Get('overview') overview(
    @Req() req: Request,
  ) {
    return this.po.overview(actor(req));
  }

  // ------------------------------------------------------------ suppliers
  @RequirePermission('suppliers.view') @Get('suppliers') list(
    @Req() req: Request,
    @Query() q: SupplierSearchDto,
  ) {
    return this.s.search(actor(req), q);
  }
  @RequirePermission('suppliers.manage')
  @HttpCode(HttpStatus.OK)
  @Post('suppliers/duplicates')
  dup(@Req() req: Request, @Body() dto: SupplierDto) {
    return this.s.duplicates(actor(req).organizationId, dto);
  }
  @RequirePermission('suppliers.manage') @Post('suppliers') create(
    @Req() req: Request,
    @Body() dto: SupplierDto,
  ) {
    return this.s.create(actor(req), dto);
  }
  @RequirePermission('suppliers.view') @Get('suppliers/:id') detail(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.s.detail(actor(req), id);
  }
  @RequirePermission('suppliers.manage') @Patch('suppliers/:id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SupplierDto,
  ) {
    return this.s.update(actor(req), id, dto);
  }
  @RequirePermission('suppliers.manage')
  @Post('suppliers/:id/certifications')
  addCert(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CertificationDto,
  ) {
    return this.s.addCertification(actor(req), id, dto);
  }
  @RequirePermission('suppliers.manage') @Patch('certifications/:id') updCert(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CertificationDto,
  ) {
    return this.s.updateCertification(actor(req), id, dto);
  }
  @RequirePermission('suppliers.manage')
  @Post('suppliers/:id/attachments')
  @upload()
  attach(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: AttachmentMetaDto,
  ) {
    return this.s.attach(actor(req), id, file, meta);
  }
  @RequirePermission('suppliers.view') @Get('attachments/:id') async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.s.download(actor(req), id));
  }
  @RequirePermission('suppliers.manage')
  @HttpCode(HttpStatus.OK)
  @Post('suppliers/:id/shortlist')
  shortlist(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ShortlistDto,
  ) {
    return this.s.shortlist(actor(req), id, dto);
  }

  // ------------------------------------------------------------ RFQs / quotes
  @RequirePermission('supplier_rfq.view') @Get('rfqs') rfqs(
    @Req() req: Request,
    @Query() q: ListDto,
  ) {
    return this.r.list(actor(req), q);
  }
  @RequirePermission('supplier_rfq.manage') @Post('rfqs') createRfq(
    @Req() req: Request,
    @Body() dto: RfqDto,
  ) {
    return this.r.create(actor(req), dto);
  }
  @RequirePermission('supplier_rfq.view') @Get('rfqs/:id') rfq(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.r.detail(actor(req), id);
  }
  @RequirePermission('supplier_rfq.manage') @Patch('rfqs/:id') updRfq(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RfqDto,
  ) {
    return this.r.update(actor(req), id, dto);
  }
  @RequirePermission('supplier_rfq.manage')
  @HttpCode(HttpStatus.OK)
  @Post('rfqs/:id/record-requested')
  requested(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RecordRequestedDto,
  ) {
    return this.r.recordRequested(actor(req), id, dto);
  }
  @RequirePermission('supplier_rfq.manage')
  @HttpCode(HttpStatus.OK)
  @Post('rfqs/:id/close')
  close(@Req() req: Request, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.r.close(actor(req), id, dto.reason);
  }
  @RequirePermission('supplier_rfq.manage')
  @HttpCode(HttpStatus.OK)
  @Post('rfqs/:id/cancel')
  cancel(@Req() req: Request, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.r.close(actor(req), id, dto.reason, true);
  }
  @RequirePermission('supplier_quotes.manage')
  @Post('rfqs/:id/quotes')
  addQuote(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: QuoteDto,
  ) {
    return this.r.addQuote(actor(req), id, dto);
  }
  @RequirePermission('supplier_quotes.manage')
  @HttpCode(HttpStatus.OK)
  @Post('quotes/:id/review')
  review(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ReviewQuoteDto,
  ) {
    return this.r.reviewQuote(actor(req), id, dto);
  }
  @RequirePermission('supplier_quotes.manage')
  @Post('quotes/:id/attachments')
  @upload()
  attachQuote(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.r.attachQuote(actor(req), id, file);
  }
  @RequirePermission('supplier_rfq.view') @Get('rfqs/:id/comparison') compare(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() dto: CompareDto,
  ) {
    return this.r.compare(actor(req), id, dto);
  }
  @RequirePermission('supplier_quotes.manage')
  @HttpCode(HttpStatus.OK)
  @Post('quotes/:id/select')
  select(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SelectQuoteDto,
  ) {
    return this.r.select(actor(req), id, dto);
  }
  @RequirePermission('supplier_quotes.manage')
  @HttpCode(HttpStatus.OK)
  @Post('quotes/:id/use-in-costing')
  useInCosting(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UseInCostingDto,
  ) {
    return this.r.useInCosting(actor(req), id, dto);
  }

  // ------------------------------------------------------------ supplier POs
  @RequirePermission('procurement.view') @Get('orders') orders(
    @Req() req: Request,
    @Query() q: ListDto,
  ) {
    return this.po.list(actor(req), q);
  }
  @RequirePermission('procurement.manage') @Post('orders') createPo(
    @Req() req: Request,
    @Body() dto: SpoDto,
  ) {
    return this.po.create(actor(req), dto);
  }
  @RequirePermission('procurement.view') @Get('orders/:id') order(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.po.detail(actor(req), id);
  }
  @RequirePermission('procurement.manage') @Patch('orders/:id') updPo(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SpoDto,
  ) {
    return this.po.update(actor(req), id, dto);
  }
  @RequirePermission('supplier_po.issue')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:id/issue')
  issue(@Req() req: Request, @Param('id') id: string, @Body() dto: VersionDto) {
    return this.po.issue(actor(req), id, dto.expectedRowVersion);
  }
  @RequirePermission('supplier_po.issue')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:id/revise')
  revise(@Req() req: Request, @Param('id') id: string, @Body() dto: ReviseDto) {
    return this.po.revise(actor(req), id, dto);
  }
  @RequirePermission('procurement.manage')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:id/status')
  status(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SpoStatusDto,
  ) {
    return this.po.changeStatus(actor(req), id, dto);
  }
  @RequirePermission('procurement.manage')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:id/record-sent')
  sent(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RecordSentDto,
  ) {
    return this.po.recordSent(actor(req), id, dto.via);
  }
  @RequirePermission('procurement.view') @Get('orders/:id/pdf') async pdf(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.po.pdf(actor(req), id));
  }

  // ------------------------------------------------------------ goods receipt / quality
  @RequirePermission('goods_receipt.manage')
  @Post('orders/:id/receipts')
  receive(@Req() req: Request, @Param('id') id: string, @Body() dto: GrnDto) {
    return this.po.receive(actor(req), id, dto);
  }
  @RequirePermission('procurement.view') @Get('receipts') receipts(
    @Req() req: Request,
    @Query() q: ListDto,
  ) {
    return this.po.grnList(actor(req), q);
  }
  @RequirePermission('procurement.view') @Get('receipts/:id') receipt(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.po.grnDetail(actor(req), id);
  }
  @RequirePermission('quality.manage')
  @Post('receipts/:id/inspections')
  inspect(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: InspectionDto,
  ) {
    return this.po.inspect(actor(req), id, dto);
  }
  @RequirePermission('quality.manage')
  @Patch('receipts/:id/inspections/:inspectionId')
  reinspect(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('inspectionId') iid: string,
    @Body() dto: InspectionDto,
  ) {
    return this.po.inspect(actor(req), id, dto, iid);
  }
  @RequirePermission('quality.manage')
  @Post('inspections/:id/attachments')
  @upload()
  attachInspection(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: AttachmentMetaDto,
  ) {
    return this.po.attachInspection(
      actor(req),
      id,
      file,
      meta.category ?? 'INSPECTION_IMAGE',
    );
  }

  // ------------------------------------------------------------ payables
  @RequirePermission('supplier_payments.view') @Get('payables') payables(
    @Req() req: Request,
    @Query() q: ListDto,
  ) {
    return this.po.payables(actor(req), q);
  }
  @RequirePermission('supplier_payments.view') @Get('payables/:id') payable(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.po.payable(actor(req), id);
  }
  @RequirePermission('supplier_payments.manage')
  @Post('payables/:id/payments')
  pay(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SupplierPaymentDto,
  ) {
    return this.po.pay(actor(req), id, dto);
  }
  @RequirePermission('supplier_payments.manage')
  @HttpCode(HttpStatus.OK)
  @Post('payments/:id/reverse')
  reverse(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.po.reversePayment(actor(req), id, dto.reason);
  }

  // ------------------------------------------------------------ integrations
  @RequirePermission('procurement.view')
  @Get('requirements/:buyerPoId')
  requirement(@Req() req: Request, @Param('buyerPoId') id: string) {
    return this.po.requirement(actor(req), id);
  }
  @RequirePermission('procurement.view') @Get('shipments/:shipmentId') shipment(
    @Req() req: Request,
    @Param('shipmentId') id: string,
  ) {
    return this.po.shipmentProcurement(actor(req), id);
  }
  @RequirePermission('procurement.manage')
  @HttpCode(HttpStatus.OK)
  @Post('shipments/:shipmentId/cost-source')
  costSource(
    @Req() req: Request,
    @Param('shipmentId') id: string,
    @Body() dto: ProcurementSourceDto,
  ) {
    return this.po.setCostSource(
      actor(req),
      id,
      dto.source as 'LINKED' | 'MANUAL',
    );
  }
  @RequirePermission('suppliers.manage')
  @Delete('suppliers/:id/shortlist')
  unshortlist(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('product') product?: string,
  ) {
    return this.s.shortlist(actor(req), id, {
      remove: true,
      product,
    } as ShortlistDto);
  }
}
