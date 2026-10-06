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
import { ProductInterestsService } from './product-interests.service';
import {
  CreateProductInterestDto,
  UpdateProductInterestDto,
} from './dto/product-interest.dto';

@ApiTags('export-onboarding')
@UseGuards(PermissionGuard)
@Controller('export-onboarding/products')
export class ProductInterestsController {
  constructor(private readonly products: ProductInterestsService) {}

  @RequirePermission('onboarding.view')
  @Get()
  list(@Req() req: Request) {
    return this.products.list(req.organizationId!);
  }

  @RequirePermission('onboarding.update')
  @Post()
  create(@Req() req: Request, @Body() dto: CreateProductInterestDto) {
    return this.products.create(req.organizationId!, req.user!.id, dto);
  }

  @RequirePermission('onboarding.update')
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateProductInterestDto,
  ) {
    return this.products.update(req.organizationId!, req.user!.id, id, dto);
  }

  @RequirePermission('onboarding.update')
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.products.remove(req.organizationId!, req.user!.id, id);
  }
}
