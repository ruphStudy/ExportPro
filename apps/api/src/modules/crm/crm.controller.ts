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
import { MAX_LEAD_ATTACHMENT_BYTES } from '../storage/storage.service';
import { CrmActor, CrmService } from './crm.service';
import {
  ActivitiesQueryDto,
  AssignDto,
  AttentionQueryDto,
  CommentDto,
  CreateLeadDto,
  CreateReminderDto,
  CreateTagDto,
  CreateTaskDto,
  LeadListQueryDto,
  LogActivityDto,
  LostDto,
  PipelineQueryDto,
  ReopenDto,
  StageChangeDto,
  TasksQueryDto,
  UpdateLeadDto,
  UpdateReminderDto,
  UpdateTaskDto,
  WonDto,
} from './crm.dto';

/**
 * Sprint 11 CRM. Every route is organization-scoped through the session's
 * active organization; records from another organization resolve to 404.
 * Reads are not audited; meaningful mutations are (see CrmService).
 */
@ApiTags('crm')
@UseGuards(PermissionGuard)
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  private actor(req: Request): CrmActor {
    return {
      organizationId: req.organizationId!,
      userId: req.user!.id,
      role: req.membershipRole!,
    };
  }

  // ----------------------------------------------------------- leads

  @RequirePermission('crm.view')
  @Get('pipeline')
  pipeline(@Req() req: Request, @Query() q: PipelineQueryDto) {
    return this.crm.pipeline(this.actor(req), q);
  }

  @RequirePermission('crm.view')
  @Get('leads')
  list(@Req() req: Request, @Query() q: LeadListQueryDto) {
    return this.crm.list(this.actor(req), q);
  }

  @RequirePermission('crm.create')
  @Post('leads')
  async create(@Req() req: Request, @Body() dto: CreateLeadDto) {
    const r = await this.crm.createLead(this.actor(req), dto, {
      source: dto.source ?? 'MANUAL',
    });
    return { leadId: r.lead.id, alreadyExists: r.alreadyExists };
  }

  @RequirePermission('crm.view')
  @Get('leads/:id')
  detail(@Req() req: Request, @Param('id') id: string) {
    return this.crm.detail(this.actor(req), id);
  }

  @RequirePermission('crm.edit')
  @Patch('leads/:id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.crm.update(this.actor(req), id, dto);
  }

  @RequirePermission('crm.stage_change')
  @Patch('leads/:id/stage')
  stage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: StageChangeDto,
  ) {
    return this.crm.changeStage(this.actor(req), id, dto);
  }

  @RequirePermission('crm.assign')
  @Patch('leads/:id/assign')
  assign(@Req() req: Request, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.crm.assign(this.actor(req), id, dto);
  }

  @RequirePermission('crm.stage_change')
  @HttpCode(HttpStatus.OK)
  @Post('leads/:id/won')
  won(@Req() req: Request, @Param('id') id: string, @Body() dto: WonDto) {
    return this.crm.markWon(this.actor(req), id, dto);
  }

  @RequirePermission('crm.stage_change')
  @HttpCode(HttpStatus.OK)
  @Post('leads/:id/lost')
  lost(@Req() req: Request, @Param('id') id: string, @Body() dto: LostDto) {
    return this.crm.markLost(this.actor(req), id, dto);
  }

  @RequirePermission('crm.stage_change')
  @HttpCode(HttpStatus.OK)
  @Post('leads/:id/reopen')
  reopen(@Req() req: Request, @Param('id') id: string, @Body() dto: ReopenDto) {
    return this.crm.reopen(this.actor(req), id, dto);
  }

  // ------------------------------------------------------ activities

  @RequirePermission('crm.view')
  @Get('leads/:id/activities')
  activities(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() q: ActivitiesQueryDto,
  ) {
    return this.crm.activities(this.actor(req), id, q.page, q.pageSize);
  }

  @RequirePermission('crm.notes')
  @Post('leads/:id/activities')
  logActivity(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: LogActivityDto,
  ) {
    return this.crm.logActivity(this.actor(req), id, dto);
  }

  @RequirePermission('crm.notes')
  @Post('leads/:id/comments')
  comment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CommentDto,
  ) {
    return this.crm.addComment(this.actor(req), id, dto.body);
  }

  @RequirePermission('crm.notes')
  @Patch('leads/:id/comments/:commentId')
  editComment(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Body() dto: CommentDto,
  ) {
    return this.crm.editComment(this.actor(req), id, commentId, dto.body);
  }

  // ----------------------------------------------------------- tasks

  @RequirePermission('crm.view')
  @Get('tasks')
  tasks(@Req() req: Request, @Query() q: TasksQueryDto) {
    return this.crm.listTasks(this.actor(req), q);
  }

  @RequirePermission('crm.tasks')
  @Post('leads/:id/tasks')
  createTask(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.crm.createTask(this.actor(req), id, dto);
  }

  @RequirePermission('crm.tasks')
  @Patch('tasks/:taskId')
  updateTask(
    @Req() req: Request,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.crm.updateTask(this.actor(req), taskId, dto);
  }

  @RequirePermission('crm.tasks')
  @HttpCode(HttpStatus.OK)
  @Post('tasks/:taskId/complete')
  completeTask(@Req() req: Request, @Param('taskId') taskId: string) {
    return this.crm.updateTask(this.actor(req), taskId, { status: 'DONE' });
  }

  // ------------------------------------------------------- reminders

  @RequirePermission('crm.tasks')
  @Post('leads/:id/reminders')
  createReminder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateReminderDto,
  ) {
    return this.crm.createReminder(this.actor(req), id, dto);
  }

  @RequirePermission('crm.tasks')
  @Patch('reminders/:reminderId')
  updateReminder(
    @Req() req: Request,
    @Param('reminderId') reminderId: string,
    @Body() dto: UpdateReminderDto,
  ) {
    return this.crm.updateReminder(this.actor(req), reminderId, dto);
  }

  // ------------------------------------------------------------ misc

  @RequirePermission('crm.view')
  @Get('tags')
  tags(@Req() req: Request) {
    return this.crm.tags(req.organizationId!);
  }

  @RequirePermission('crm.edit')
  @Post('tags')
  createTag(@Req() req: Request, @Body() dto: CreateTagDto) {
    return this.crm.createTag(this.actor(req), dto.name, dto.color);
  }

  @RequirePermission('crm.view')
  @Get('members')
  members(@Req() req: Request) {
    return this.crm.members(req.organizationId!);
  }

  @RequirePermission('crm.view')
  @Get('attention')
  attention(@Req() req: Request, @Query() q: AttentionQueryDto) {
    return this.crm.attention(this.actor(req), q);
  }

  // ----------------------------------------------------- attachments

  @RequirePermission('crm.attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_LEAD_ATTACHMENT_BYTES + 1 },
    }),
  )
  @Post('leads/:id/attachments')
  upload(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.crm.uploadAttachment(this.actor(req), id, file);
  }

  /** Streams a private attachment after tenant checks; storage keys/paths are never exposed. */
  @RequirePermission('crm.view')
  @Get('leads/:id/attachments/:attachmentId/download')
  async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const f = await this.crm.readAttachment(this.actor(req), id, attachmentId);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    );
    res.send(f.buffer);
  }

  @RequirePermission('crm.attachments')
  @Delete('leads/:id/attachments/:attachmentId')
  deleteAttachment(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.crm.deleteAttachment(this.actor(req), id, attachmentId);
  }
}
