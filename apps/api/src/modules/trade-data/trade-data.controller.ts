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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MAX_DATA_IMPORT_BYTES } from '../storage/storage.service';
import { Actor, TradeDataIngestionService } from './ingestion.service';
import { TradeDataQueryService } from './trade-data-query.service';
import {
  FactQueryDto,
  IngestDto,
  IssueQueryDto,
  RunQueryDto,
  UpdateSourceDto,
} from './trade-data.dto';

const actor = (req: Request): Actor => ({
  userId: req.user!.id,
  email: req.user!.email,
  organizationId: req.organizationId ?? null,
});
const upload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_DATA_IMPORT_BYTES, files: 1 },
});

/** Global trade-data platform. Reads need trade_data.view; mutations need manage/ingest plus platform-admin allowlisting. */
@ApiTags('trade-data')
@UseGuards(PermissionGuard)
@Controller('trade-data')
export class TradeDataController {
  constructor(
    private readonly query: TradeDataQueryService,
    private readonly ingestion: TradeDataIngestionService,
  ) {}

  @RequirePermission('trade_data.view')
  @Get('sources')
  sources() {
    return this.query.listSources();
  }

  @RequirePermission('trade_data.view')
  @Get('sources/:id')
  source(@Param('id') id: string) {
    return this.query.getSource(id);
  }

  @RequirePermission('trade_data.manage')
  @Patch('sources/:id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateSourceDto,
  ) {
    return this.ingestion
      .setEnabled(id, dto.enabled, actor(req))
      .then(() => this.query.getSource(id));
  }

  @RequirePermission('trade_data.ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('sources/:id/ingest')
  ingest(@Req() req: Request, @Param('id') id: string, @Body() dto: IngestDto) {
    return this.ingestion
      .startApiRun(id, dto.datasets, actor(req))
      .then((run) => this.query.getRun(run.id));
  }

  @RequirePermission('trade_data.ingest')
  @HttpCode(HttpStatus.OK)
  @Post('sources/:id/import/preview')
  @UseInterceptors(upload)
  preview(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.ingestion.preview(id, file, actor(req));
  }

  @RequirePermission('trade_data.ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('sources/:id/import')
  @UseInterceptors(upload)
  import(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.ingestion
      .importFile(id, file, actor(req))
      .then((run) => this.query.getRun(run.id));
  }

  @RequirePermission('trade_data.view')
  @Get('runs')
  runs(@Query() q: RunQueryDto) {
    return this.query.listRuns(q.sourceId, q.page, q.pageSize);
  }

  @RequirePermission('trade_data.view')
  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.query.getRun(id);
  }

  @RequirePermission('trade_data.view')
  @Get('facts')
  facts(@Query() q: FactQueryDto) {
    return this.query.listFacts(q);
  }

  @RequirePermission('trade_data.view')
  @Get('facts/:id/provenance')
  provenance(@Param('id') id: string) {
    return this.query.factProvenance(id);
  }

  @RequirePermission('trade_data.view')
  @Get('issues')
  issues(@Query() q: IssueQueryDto) {
    return this.query.listIssues(q);
  }

  @RequirePermission('trade_data.view')
  @Get('quality')
  quality() {
    return this.query.quality();
  }
}
