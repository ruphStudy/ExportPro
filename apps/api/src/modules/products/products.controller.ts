import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { ProductAnalysisService } from '../product-analysis/product-analysis.service';
import { ProductsService } from './products.service';
import {
  ChangeClassificationDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/product.dto';

/**
 * Saved organization products. There is deliberately no POST /products:
 * products are only created through an explicitly confirmed analysis.
 */
@ApiTags('products')
@UseGuards(PermissionGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly analysis: ProductAnalysisService,
  ) {}

  @RequirePermission('products.view')
  @Get()
  list(@Req() req: Request, @Query() dto: ListProductsQueryDto) {
    return this.products.list(
      req.organizationId!,
      dto.q,
      dto.page,
      dto.pageSize,
    );
  }

  @RequirePermission('products.view')
  @Get(':id')
  getById(@Req() req: Request, @Param('id') id: string) {
    return this.products.getById(req.organizationId!, id);
  }

  @RequirePermission('products.update')
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(req.organizationId!, req.user!.id, id, dto);
  }

  @RequirePermission('products.confirm_classification')
  @Patch(':id/classification')
  changeClassification(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ChangeClassificationDto,
  ) {
    return this.products.changeClassification(
      req.organizationId!,
      req.user!.id,
      id,
      dto,
    );
  }

  @RequirePermission('products.analyze')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/reanalyze')
  reanalyze(@Req() req: Request, @Param('id') id: string) {
    return this.analysis.analyzeForProduct(
      req.organizationId!,
      req.user!.id,
      id,
    );
  }
}
