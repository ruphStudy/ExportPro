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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SavedSearchesService } from './saved-searches.service';
import {
  CreateSavedSearchDto,
  UpdateSavedSearchDto,
} from './dto/saved-search.dto';

@ApiTags('opportunities')
@UseGuards(PermissionGuard)
@Controller('opportunities/saved-searches')
export class SavedSearchesController {
  constructor(private readonly savedSearches: SavedSearchesService) {}

  @RequirePermission('opportunities.view')
  @Get()
  list(@Req() req: Request) {
    return this.savedSearches.list(req.organizationId!);
  }

  @RequirePermission('opportunities.manage_saved_searches')
  @Post()
  create(@Req() req: Request, @Body() dto: CreateSavedSearchDto) {
    return this.savedSearches.create(req.organizationId!, req.user!.id, dto);
  }

  @RequirePermission('opportunities.manage_saved_searches')
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateSavedSearchDto,
  ) {
    return this.savedSearches.update(
      req.organizationId!,
      req.user!.id,
      id,
      dto,
    );
  }

  @RequirePermission('opportunities.manage_saved_searches')
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.savedSearches.remove(req.organizationId!, req.user!.id, id);
  }
}
