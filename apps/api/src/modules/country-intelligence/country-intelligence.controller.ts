import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CountryIntelligenceService } from './country-intelligence.service';
import {
  CountryListQueryDto,
  PageQueryDto,
  ProductMarketsQueryDto,
} from './country-intelligence.dto';

/**
 * Read-only market intelligence. No refresh endpoint: the sample dataset
 * is static and versioned; a new version is scored automatically.
 */
@ApiTags('country-intelligence')
@UseGuards(PermissionGuard)
@Controller()
export class CountryIntelligenceController {
  constructor(private readonly countries: CountryIntelligenceService) {}

  @RequirePermission('country_intelligence.view')
  @Get('products/:id/markets')
  productMarkets(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() q: ProductMarketsQueryDto,
  ) {
    return this.countries.productMarkets(req.organizationId!, id, q);
  }

  @RequirePermission('country_intelligence.view')
  @Get('products/:id/markets/:countryCode')
  deepAnalysis(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('countryCode') countryCode: string,
  ) {
    return this.countries.deepAnalysis(
      req.organizationId!,
      req.user!.id,
      id,
      countryCode,
    );
  }

  @RequirePermission('country_intelligence.view')
  @Get('countries')
  list(@Req() req: Request, @Query() q: CountryListQueryDto) {
    return this.countries.countries(req.organizationId!, q);
  }

  @RequirePermission('country_intelligence.view')
  @Get('countries/:countryCode')
  detail(
    @Req() req: Request,
    @Param('countryCode') countryCode: string,
    @Query() q: PageQueryDto,
  ) {
    return this.countries.countryDetail(
      req.organizationId!,
      countryCode,
      q.page,
      q.pageSize,
    );
  }
}
