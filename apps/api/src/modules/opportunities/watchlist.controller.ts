import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { WatchlistService } from './watchlist.service';
import { SaveOpportunityDto } from './dto/save-opportunity.dto';

@ApiTags('opportunities')
@UseGuards(PermissionGuard)
@Controller('opportunities')
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @RequirePermission('opportunities.view')
  @Get('watchlist')
  list(@Req() req: Request) {
    return this.watchlist.list(req.organizationId!);
  }

  @RequirePermission('opportunities.save')
  @Post(':id/save')
  save(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SaveOpportunityDto,
  ) {
    return this.watchlist.save(
      req.organizationId!,
      req.user!.id,
      id,
      dto.notes,
    );
  }

  @RequirePermission('opportunities.save')
  @HttpCode(HttpStatus.OK)
  @Delete(':id/save')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.watchlist.remove(req.organizationId!, req.user!.id, id);
  }
}
