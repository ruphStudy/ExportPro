import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { Actor } from '../commercial/commercial-core.service';
import {
  CommentDto,
  ConfirmExtractionDto,
  ExtractDto,
  ManualExtractionDto,
  ResolveFindingDto,
  SignOffDto,
  ValidationReasonDto,
} from './document-validation.dto';
import { DocumentExtractionService } from './extraction.service';
import { DocumentValidationService } from './validation.service';

const actor = (req: Request): Actor => ({
  organizationId: req.organizationId!,
  userId: req.user!.id,
  role: req.membershipRole!,
});

/** Extraction + validation endpoints scoped to a trade document (Sprint 16 TradeDocument reused). */
@ApiTags('document-validation')
@UseGuards(PermissionGuard)
@Controller('documents')
export class DocumentExtractionController {
  constructor(
    private readonly ex: DocumentExtractionService,
    private readonly v: DocumentValidationService,
  ) {}

  @RequirePermission('document_validation.view')
  @Get(':id/extractions')
  extractions(@Req() req: Request, @Param('id') id: string) {
    return this.ex.overview(actor(req), id);
  }
  @RequirePermission('document_validation.view')
  @Get(':id/extractions/:extractionId')
  extraction(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('extractionId') eid: string,
  ) {
    return this.ex.one(actor(req), id, eid);
  }
  @RequirePermission('document_validation.extract')
  @HttpCode(HttpStatus.OK)
  @Post(':id/extract')
  extract(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ExtractDto,
  ) {
    return this.ex.extract(actor(req), id, dto);
  }
  @RequirePermission('document_validation.review')
  @HttpCode(HttpStatus.OK)
  @Post(':id/extract/manual')
  manual(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ManualExtractionDto,
  ) {
    return this.ex.manual(actor(req), id, dto);
  }
  @RequirePermission('document_validation.review')
  @HttpCode(HttpStatus.OK)
  @Post(':id/extractions/:extractionId/confirm')
  confirm(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('extractionId') eid: string,
    @Body() dto: ConfirmExtractionDto,
  ) {
    return this.ex.confirm(actor(req), id, eid, dto);
  }
  @RequirePermission('document_validation.review')
  @HttpCode(HttpStatus.OK)
  @Post(':id/validate')
  validate(@Req() req: Request, @Param('id') id: string) {
    return this.v.runForDocument(actor(req), id);
  }
  @RequirePermission('document_validation.view')
  @Get(':id/validations')
  validations(@Req() req: Request, @Param('id') id: string) {
    return this.v.runsForDocument(actor(req), id);
  }
  @RequirePermission('document_validation.view')
  @Get(':id/validations/:runId')
  async validation(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('runId') runId: string,
  ) {
    const runs = await this.v.runsForDocument(actor(req), id);
    const r = runs.find((x) => x.id === runId);
    return r ?? this.v.runView(actor(req), '__missing__');
  }
  @RequirePermission('document_validation.signoff')
  @HttpCode(HttpStatus.OK)
  @Post(':id/validations/:runId/sign-off')
  signOff(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('runId') runId: string,
    @Body() dto: SignOffDto,
  ) {
    return this.v.signOff(actor(req), runId, dto, id);
  }
  @RequirePermission('document_validation.review')
  @HttpCode(HttpStatus.OK)
  @Post(':id/validations/:runId/reject')
  reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('runId') runId: string,
    @Body() dto: ValidationReasonDto,
  ) {
    return this.v.reject(actor(req), runId, dto, id);
  }
}

@ApiTags('document-validation')
@UseGuards(PermissionGuard)
@Controller('document-validation')
export class DocumentValidationController {
  constructor(private readonly v: DocumentValidationService) {}

  @RequirePermission('document_validation.view') @Get('dashboard') dashboard(
    @Req() req: Request,
  ) {
    return this.v.dashboard(actor(req));
  }
  @RequirePermission('document_validation.view') @Get('missing') missing(
    @Req() req: Request,
  ) {
    return this.v.missingAll(actor(req));
  }
  @RequirePermission('document_validation.view') @Get('orders/:poId') order(
    @Req() req: Request,
    @Param('poId') poId: string,
  ) {
    return this.v.packageView(actor(req), poId);
  }
  @RequirePermission('document_validation.review')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:poId/run')
  run(@Req() req: Request, @Param('poId') poId: string) {
    return this.v.runForPackage(actor(req), poId);
  }
  @RequirePermission('document_validation.view')
  @Get('orders/:poId/history')
  history(@Req() req: Request, @Param('poId') poId: string) {
    return this.v.history(actor(req), poId);
  }
  @RequirePermission('document_validation.view') @Get('runs/:runId') runView(
    @Req() req: Request,
    @Param('runId') runId: string,
  ) {
    return this.v.runView(actor(req), runId);
  }
  @RequirePermission('document_validation.signoff')
  @HttpCode(HttpStatus.OK)
  @Post('runs/:runId/sign-off')
  signOff(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() dto: SignOffDto,
  ) {
    return this.v.signOff(actor(req), runId, dto);
  }
  @RequirePermission('document_validation.review')
  @HttpCode(HttpStatus.OK)
  @Post('runs/:runId/reject')
  reject(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() dto: ValidationReasonDto,
  ) {
    return this.v.reject(actor(req), runId, dto);
  }
  @RequirePermission('document_validation.review')
  @Post('runs/:runId/comments')
  runComment(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() dto: CommentDto,
  ) {
    return this.v.comment(actor(req), { runId }, dto);
  }
  @RequirePermission('document_validation.resolve')
  @HttpCode(HttpStatus.OK)
  @Post('findings/:id/resolve')
  resolve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ResolveFindingDto,
  ) {
    return this.v.resolve(actor(req), id, dto);
  }
  @RequirePermission('document_validation.review')
  @Post('findings/:id/comments')
  findingComment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CommentDto,
  ) {
    return this.v.comment(actor(req), { findingId: id }, dto);
  }
}
