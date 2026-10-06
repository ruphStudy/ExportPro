import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ComparisonService } from './comparison.service';
import { RecommendationService } from './recommendation.service';
import {
  MarketComparisonDto,
  ProductComparisonDto,
  RecommendationQueryDto,
} from './comparisons.dto';

/** Read-only, computed on demand (POST only to carry the selection body). No audit — nothing is mutated. */
@ApiTags('comparisons')
@UseGuards(PermissionGuard)
@Controller()
export class ComparisonsController {
  constructor(
    private readonly comparisons: ComparisonService,
    private readonly recommendations: RecommendationService,
  ) {}

  @RequirePermission('comparisons.view')
  @HttpCode(HttpStatus.OK)
  @Post('comparisons/products')
  products(@Req() req: Request, @Body() dto: ProductComparisonDto) {
    return this.comparisons.compareProducts(
      req.organizationId!,
      dto.productIds,
    );
  }

  @RequirePermission('comparisons.view')
  @HttpCode(HttpStatus.OK)
  @Post('comparisons/markets')
  markets(@Req() req: Request, @Body() dto: MarketComparisonDto) {
    return this.comparisons.compareMarkets(
      req.organizationId!,
      dto.productId,
      dto.countryCodes,
    );
  }

  @RequirePermission('recommendations.view')
  @Get('recommendations')
  list(@Req() req: Request, @Query() q: RecommendationQueryDto) {
    return this.recommendations.recommendations(req.organizationId!, q);
  }
}
