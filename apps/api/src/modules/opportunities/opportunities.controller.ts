import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { OpportunitiesService } from './opportunities.service';
import { SearchOpportunitiesDto } from './dto/search-query.dto';

@ApiTags('opportunities')
@UseGuards(PermissionGuard)
@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  // Declared before ":id" — "discovery" would otherwise be captured as
  // an :id value (Nest matches routes in declaration order).
  @RequirePermission('opportunities.view')
  @Get('discovery')
  discovery(@Req() req: Request) {
    return this.opportunities.discovery(req.organizationId!);
  }

  @RequirePermission('opportunities.view')
  @Get()
  search(@Req() req: Request, @Query() dto: SearchOpportunitiesDto) {
    return this.opportunities.search(req.organizationId!, dto);
  }

  @RequirePermission('opportunities.view')
  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.opportunities.history(id);
  }

  @RequirePermission('opportunities.view')
  @Get(':id')
  getById(@Req() req: Request, @Param('id') id: string) {
    return this.opportunities.getById(req.organizationId!, id);
  }
}
