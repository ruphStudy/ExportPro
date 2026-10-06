import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ProductIntelligenceService } from './product-intelligence.service';

/**
 * Read-only. There is intentionally no refresh endpoint: the current
 * provider is a static, versioned sample dataset, so "refresh" would only
 * regenerate identical numbers. A new dataset version is picked up
 * automatically on the next view.
 */
@ApiTags('product-intelligence')
@UseGuards(PermissionGuard)
@Controller()
export class ProductIntelligenceController {
  constructor(private readonly intelligence: ProductIntelligenceService) {}

  @RequirePermission('product_intelligence.view')
  @Get('products/:id/intelligence')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.intelligence.getForProduct(
      req.organizationId!,
      req.user!.id,
      id,
    );
  }

  @RequirePermission('product_intelligence.view')
  @Get('product-intelligence/summary')
  summary(@Req() req: Request, @Query('productIds') productIds?: string) {
    const ids = (productIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length > 100)
      throw new BadRequestException('At most 100 product ids.');
    return this.intelligence.summary(req.organizationId!, ids);
  }
}
