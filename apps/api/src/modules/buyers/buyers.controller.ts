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
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BuyersService } from './buyers.service';
import {
  AddToCrmDto,
  BuyerContextDto,
  BuyerNotesDto,
  BuyerSearchDto,
  CreateManualBuyerDto,
  SaveBuyerDto,
  SavedBuyersQueryDto,
} from './buyers.dto';

/** Reads are not audited; save/unsave/notes/CRM handoff/manual entry are. */
@ApiTags('buyers')
@UseGuards(PermissionGuard)
@Controller('buyers')
export class BuyersController {
  constructor(private readonly buyers: BuyersService) {}

  private actor(req: Request) {
    return { organizationId: req.organizationId!, userId: req.user!.id };
  }

  @RequirePermission('buyers.view')
  @Get()
  search(@Req() req: Request, @Query() q: BuyerSearchDto) {
    return this.buyers.search(req.organizationId!, q);
  }

  @RequirePermission('buyers.view')
  @Get('saved')
  saved(@Req() req: Request, @Query() q: SavedBuyersQueryDto) {
    return this.buyers.saved(req.organizationId!, q.page, q.pageSize);
  }

  @RequirePermission('buyers.create')
  @Post()
  create(@Req() req: Request, @Body() dto: CreateManualBuyerDto) {
    return this.buyers.createManual(this.actor(req), dto);
  }

  @RequirePermission('buyers.view')
  @Get(':id')
  detail(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() q: BuyerContextDto,
  ) {
    return this.buyers.detail(req.organizationId!, id, q);
  }

  @RequirePermission('buyers.save')
  @HttpCode(HttpStatus.OK)
  @Post(':id/save')
  save(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SaveBuyerDto,
  ) {
    return this.buyers.save(this.actor(req), id, dto);
  }

  @RequirePermission('buyers.save')
  @HttpCode(HttpStatus.OK)
  @Delete(':id/save')
  unsave(@Req() req: Request, @Param('id') id: string) {
    return this.buyers.unsave(this.actor(req), id);
  }

  @RequirePermission('buyers.notes')
  @Patch(':id/notes')
  notes(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: BuyerNotesDto,
  ) {
    return this.buyers.updateNotes(this.actor(req), id, dto.notes);
  }

  @RequirePermission('buyers.crm_handoff')
  @HttpCode(HttpStatus.OK)
  @Post(':id/add-to-crm')
  addToCrm(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AddToCrmDto,
  ) {
    return this.buyers.addToCrm(this.actor(req), id, dto);
  }
}
