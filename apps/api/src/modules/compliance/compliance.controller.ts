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
  AddRequirementDto,
  ApproveDocumentDto,
  ChecklistQueryDto,
  DocReasonDto,
  DocumentListQueryDto,
  DocumentMetadataDto,
  GenerateDocumentDto,
  MarkReadyDto,
  OverrideDto,
  TemplateDto,
  UpdateDocumentDto,
  UpdateRequirementDto,
  VersionDto,
} from './compliance.dto';
import { ComplianceService } from './compliance.service';
import { DocumentsService } from './documents.service';

const actor = (req: Request): Actor => ({
  organizationId: req.organizationId!,
  userId: req.user!.id,
  role: req.membershipRole!,
});

/** Private, permission-checked file response (no storage paths exposed). */
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

@ApiTags('compliance')
@UseGuards(PermissionGuard)
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly c: ComplianceService) {}

  @RequirePermission('compliance.view') @Get('overview') overview(
    @Req() req: Request,
  ) {
    return this.c.overview(actor(req));
  }
  @RequirePermission('compliance.view') @Get('checklists') checklists(
    @Req() req: Request,
    @Query() q: ChecklistQueryDto,
  ) {
    return this.c.list(actor(req), q);
  }
  @RequirePermission('compliance.view') @Get('checklists/:id') checklist(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.c.byId(actor(req), id);
  }
  @RequirePermission('compliance.manage')
  @Post('checklists/:id/requirements')
  addRequirement(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AddRequirementDto,
  ) {
    return this.c.addRequirement(actor(req), id, dto);
  }
  @RequirePermission('compliance.view') @Get('orders/:purchaseOrderId') order(
    @Req() req: Request,
    @Param('purchaseOrderId') id: string,
  ) {
    return this.c.forPo(actor(req), id);
  }
  @RequirePermission('compliance.manage')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:purchaseOrderId/evaluate')
  evaluate(@Req() req: Request, @Param('purchaseOrderId') id: string) {
    return this.c.evaluate(actor(req), { purchaseOrderId: id });
  }
  @RequirePermission('compliance.ready')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:purchaseOrderId/mark-ready')
  markReady(
    @Req() req: Request,
    @Param('purchaseOrderId') id: string,
    @Body() dto: MarkReadyDto,
  ) {
    return this.c.markReady(actor(req), id, dto);
  }
  @RequirePermission('compliance.view')
  @Get('quotations/:quotationId')
  quotation(@Req() req: Request, @Param('quotationId') id: string) {
    return this.c.forQuotation(actor(req), id);
  }
  @RequirePermission('compliance.manage')
  @HttpCode(HttpStatus.OK)
  @Post('quotations/:quotationId/evaluate')
  evaluateQuotation(@Req() req: Request, @Param('quotationId') id: string) {
    return this.c.evaluate(actor(req), { quotationId: id });
  }
  @RequirePermission('compliance.manage') @Patch('requirements/:id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.c.updateRequirement(actor(req), id, dto);
  }
  @RequirePermission('compliance.override')
  @HttpCode(HttpStatus.OK)
  @Post('requirements/:id/override')
  override(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: OverrideDto,
  ) {
    return this.c.override(actor(req), id, dto);
  }
  @RequirePermission('compliance.override')
  @Delete('requirements/:id/override')
  clearOverride(@Req() req: Request, @Param('id') id: string) {
    return this.c.clearOverride(actor(req), id);
  }
  @RequirePermission('compliance.view') @Get('rules') rules(
    @Req() req: Request,
  ) {
    return this.c.rules(actor(req));
  }
}

const docUpload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INQUIRY_ATTACHMENT_BYTES + 1, files: 1 },
    }),
  );

@ApiTags('documents')
@UseGuards(PermissionGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly d: DocumentsService) {}

  @RequirePermission('documents.view') @Get() list(
    @Req() req: Request,
    @Query() q: DocumentListQueryDto,
  ) {
    return this.d.list(actor(req), q);
  }
  /** Record an external document by reference (number/issuer/dates) without a file. */
  @RequirePermission('documents.upload') @Post() create(
    @Req() req: Request,
    @Body() dto: DocumentMetadataDto,
  ) {
    return this.d.createExternal(actor(req), dto);
  }
  @RequirePermission('documents.upload') @docUpload() @Post('upload') upload(
    @Req() req: Request,
    @Body() dto: DocumentMetadataDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.d.createExternal(actor(req), dto, file ?? undefined);
  }
  /** Exporter-prepared documents only (commercial invoice, packing list, shipping instruction). */
  @RequirePermission('documents.view') @Post('generate') generate(
    @Req() req: Request,
    @Body() dto: GenerateDocumentDto,
  ) {
    return this.d.generate(actor(req), dto);
  }
  @RequirePermission('documents.view') @Get('templates') templates(
    @Req() req: Request,
  ) {
    return this.d.templates(actor(req));
  }
  @RequirePermission('documents.approve') @Patch('templates') updateTemplate(
    @Req() req: Request,
    @Body() dto: TemplateDto,
  ) {
    return this.d.updateTemplate(actor(req), dto);
  }
  @RequirePermission('documents.view') @Get(':id') detail(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.d.detail(actor(req), id);
  }
  @RequirePermission('documents.view') @Patch(':id') update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.d.update(actor(req), id, dto);
  }
  @RequirePermission('documents.view')
  @HttpCode(HttpStatus.OK)
  @Post(':id/review')
  review(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ) {
    return this.d.submitReview(actor(req), id, dto.expectedRowVersion);
  }
  @RequirePermission('documents.approve')
  @HttpCode(HttpStatus.OK)
  @Post(':id/approve')
  approve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ApproveDocumentDto,
  ) {
    return this.d.approve(actor(req), id, dto);
  }
  @RequirePermission('documents.view')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: DocReasonDto,
  ) {
    return this.d.reject(actor(req), id, dto);
  }
  @RequirePermission('documents.view') @Post(':id/revise') revise(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: DocReasonDto,
  ) {
    return this.d.revise(actor(req), id, dto);
  }
  @RequirePermission('documents.view')
  @HttpCode(HttpStatus.OK)
  @Post(':id/archive')
  archive(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: DocReasonDto,
  ) {
    return this.d.archive(actor(req), id, dto);
  }
  @RequirePermission('documents.view') @Get(':id/download') async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.d.download(actor(req), id));
  }
  @RequirePermission('documents.view') @Get(':id/pdf') async pdf(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.d.pdf(actor(req), id));
  }
}
