import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ProductAnalysisService } from './product-analysis.service';
import { TariffReferenceService } from './reference/tariff-reference.service';
import {
  ClarifyProductAnalysisDto,
  ConfirmClassificationDto,
  CreateProductAnalysisDto,
  SelectClassificationDto,
  TariffSearchQueryDto,
} from './dto/product-analysis.dto';

/** Provider-backed routes get a tighter per-client limit than the global default (AI cost control). */
const AI_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@ApiTags('product-analysis')
@UseGuards(PermissionGuard)
@Controller('product-analysis')
export class ProductAnalysisController {
  constructor(private readonly analysis: ProductAnalysisService) {}

  @RequirePermission('products.analyze')
  @Throttle(AI_THROTTLE)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateProductAnalysisDto) {
    return this.analysis.analyze(req.organizationId!, req.user!.id, dto);
  }

  // Declared before ":id" so "recent" isn't captured as an id.
  @RequirePermission('products.view')
  @Get('recent')
  recent(@Req() req: Request) {
    return this.analysis.recent(req.organizationId!);
  }

  @RequirePermission('products.view')
  @Get(':id')
  getById(@Req() req: Request, @Param('id') id: string) {
    return this.analysis.getById(req.organizationId!, id);
  }

  @RequirePermission('products.analyze')
  @Throttle(AI_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post(':id/clarify')
  clarify(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ClarifyProductAnalysisDto,
  ) {
    return this.analysis.clarify(req.organizationId!, req.user!.id, id, dto);
  }

  @RequirePermission('products.analyze')
  @Throttle(AI_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post(':id/reanalyze')
  reanalyze(@Req() req: Request, @Param('id') id: string) {
    return this.analysis.reanalyze(req.organizationId!, req.user!.id, id);
  }

  @RequirePermission('products.analyze')
  @HttpCode(HttpStatus.OK)
  @Post(':id/select')
  select(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SelectClassificationDto,
  ) {
    return this.analysis.select(req.organizationId!, req.user!.id, id, dto);
  }

  @RequirePermission('products.confirm_classification')
  @HttpCode(HttpStatus.OK)
  @Post(':id/confirm')
  confirm(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ConfirmClassificationDto,
  ) {
    return this.analysis.confirm(req.organizationId!, req.user!.id, id, dto);
  }
}

@ApiTags('product-analysis')
@UseGuards(PermissionGuard)
@Controller('product-classifications')
export class ProductClassificationsController {
  constructor(private readonly tariff: TariffReferenceService) {}

  /** Reference-data search only — never calls the AI provider. */
  @RequirePermission('products.view')
  @Get('search')
  search(@Query() dto: TariffSearchQueryDto) {
    return this.tariff.search(dto.q, dto.codeSystem, dto.page, dto.pageSize);
  }
}
