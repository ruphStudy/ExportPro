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
import { MAX_INQUIRY_ATTACHMENT_BYTES } from '../storage/storage.service';
import { type Actor, InquiriesService } from './inquiries.service';
import {
  ApprovalDto,
  AssignDto,
  ClarifyDto,
  ConfirmRfqDto,
  CreateInquiryDto,
  InquiryListQueryDto,
  NoteDto,
  QualifyDto,
  RejectDto,
  SampleRequestDto,
  UpdateInquiryDto,
  UploadInquiryDto,
  VersionDto,
} from './inquiries.dto';

const fileUpload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INQUIRY_ATTACHMENT_BYTES + 1 },
    }),
  );

/** Reads are not audited (opening only updates the unread flag and timeline); every workflow mutation is. */
@ApiTags('inquiries')
@UseGuards(PermissionGuard)
@Controller('inquiries')
export class InquiriesController {
  constructor(private readonly inquiries: InquiriesService) {}

  private actor(req: Request): Actor {
    return {
      organizationId: req.organizationId!,
      userId: req.user!.id,
      role: req.membershipRole!,
    };
  }

  @RequirePermission('inquiries.view')
  @Get()
  list(@Req() req: Request, @Query() q: InquiryListQueryDto) {
    return this.inquiries.list(this.actor(req), q);
  }

  @RequirePermission('inquiries.view')
  @Get('assignees')
  assignees(@Req() req: Request) {
    return this.inquiries.assignees(req.organizationId!);
  }

  @RequirePermission('inquiries.create')
  @Post()
  create(@Req() req: Request, @Body() dto: CreateInquiryDto) {
    return this.inquiries.create(this.actor(req), dto);
  }

  @RequirePermission('inquiries.create')
  @fileUpload()
  @Post('upload')
  upload(
    @Req() req: Request,
    @Body() dto: UploadInquiryDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.inquiries.upload(this.actor(req), dto, file);
  }

  @RequirePermission('inquiries.view')
  @Get(':id')
  detail(@Req() req: Request, @Param('id') id: string) {
    return this.inquiries.detail(this.actor(req), id);
  }

  @RequirePermission('inquiries.edit')
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateInquiryDto,
  ) {
    return this.inquiries.update(this.actor(req), id, dto);
  }

  @RequirePermission('inquiries.view')
  @HttpCode(HttpStatus.OK)
  @Post(':id/read')
  read(@Req() req: Request, @Param('id') id: string) {
    return this.inquiries.setRead(this.actor(req), id, true);
  }

  @RequirePermission('inquiries.view')
  @HttpCode(HttpStatus.OK)
  @Post(':id/unread')
  unread(@Req() req: Request, @Param('id') id: string) {
    return this.inquiries.setRead(this.actor(req), id, false);
  }

  @RequirePermission('inquiries.assign')
  @Patch(':id/assign')
  assign(@Req() req: Request, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.inquiries.assign(
      this.actor(req),
      id,
      dto.userId,
      dto.expectedRowVersion,
    );
  }

  @RequirePermission('inquiries.edit')
  @Post(':id/notes')
  note(@Req() req: Request, @Param('id') id: string, @Body() dto: NoteDto) {
    return this.inquiries.addNote(this.actor(req), id, dto.text);
  }

  // --------------------------------------------------------- extraction
  @RequirePermission('inquiries.edit')
  @HttpCode(HttpStatus.OK)
  @Post(':id/extract')
  extract(@Req() req: Request, @Param('id') id: string) {
    return this.inquiries.extract(this.actor(req), id);
  }

  @RequirePermission('inquiries.view')
  @Get(':id/extractions')
  extractions(@Req() req: Request, @Param('id') id: string) {
    return this.inquiries.extractions(req.organizationId!, id);
  }

  @RequirePermission('inquiries.edit')
  @Patch(':id/extraction')
  saveDraft(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ConfirmRfqDto,
  ) {
    return this.inquiries.saveDraft(this.actor(req), id, dto);
  }

  @RequirePermission('inquiries.edit')
  @HttpCode(HttpStatus.OK)
  @Post(':id/extraction/confirm')
  confirm(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ConfirmRfqDto,
  ) {
    return this.inquiries.confirm(this.actor(req), id, dto);
  }

  // ------------------------------------------------------- qualification
  @RequirePermission('inquiries.qualify')
  @HttpCode(HttpStatus.OK)
  @Post(':id/qualify')
  qualify(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: QualifyDto,
  ) {
    return this.inquiries.qualify(this.actor(req), id, dto);
  }

  @RequirePermission('inquiries.qualify')
  @HttpCode(HttpStatus.OK)
  @Post(':id/request-clarification')
  clarify(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ClarifyDto,
  ) {
    return this.inquiries.requestClarification(this.actor(req), id, dto);
  }

  @RequirePermission('inquiries.qualify')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  reject(@Req() req: Request, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.inquiries.reject(this.actor(req), id, dto);
  }

  @RequirePermission('inquiries.archive')
  @HttpCode(HttpStatus.OK)
  @Post(':id/archive')
  archive(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ) {
    return this.inquiries.archive(this.actor(req), id, dto.expectedRowVersion);
  }

  @RequirePermission('inquiries.archive')
  @HttpCode(HttpStatus.OK)
  @Post(':id/restore')
  restore(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ) {
    return this.inquiries.restore(this.actor(req), id, dto.expectedRowVersion);
  }

  // ------------------------------------------------------------ approval
  @RequirePermission('inquiries.qualify')
  @HttpCode(HttpStatus.OK)
  @Post(':id/submit-approval')
  submitApproval(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ApprovalDto,
  ) {
    return this.inquiries.submitApproval(this.actor(req), id, dto);
  }

  @RequirePermission('inquiries.approve')
  @HttpCode(HttpStatus.OK)
  @Post(':id/approve')
  approve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ApprovalDto,
  ) {
    return this.inquiries.decideApproval(this.actor(req), id, true, dto);
  }

  @RequirePermission('inquiries.approve')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject-approval')
  rejectApproval(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ApprovalDto,
  ) {
    return this.inquiries.decideApproval(this.actor(req), id, false, dto);
  }

  // ------------------------------------------------------------ handoffs
  @RequirePermission('inquiries.create_handoff')
  @HttpCode(HttpStatus.OK)
  @Post(':id/create-quotation-request')
  quotation(@Req() req: Request, @Param('id') id: string) {
    return this.inquiries.createQuotationRequest(this.actor(req), id);
  }

  @RequirePermission('inquiries.create_handoff')
  @HttpCode(HttpStatus.OK)
  @Post(':id/create-sample-request')
  sample(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SampleRequestDto,
  ) {
    return this.inquiries.createSampleRequest(
      this.actor(req),
      id,
      dto.itemIndex,
    );
  }

  // --------------------------------------------------------- attachments
  @RequirePermission('inquiries.edit')
  @fileUpload()
  @Post(':id/attachments')
  addAttachment(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.inquiries.addAttachment(this.actor(req), id, file);
  }

  /** Streams a private attachment after tenant checks; storage keys are never exposed. */
  @RequirePermission('inquiries.view')
  @Get(':id/attachments/:attachmentId/download')
  async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const f = await this.inquiries.readAttachment(
      req.organizationId!,
      id,
      attachmentId,
    );
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    );
    res.send(f.buffer);
  }

  @RequirePermission('inquiries.edit')
  @HttpCode(HttpStatus.OK)
  @Delete(':id/attachments/:attachmentId')
  deleteAttachment(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.inquiries.deleteAttachment(this.actor(req), id, attachmentId);
  }
}
