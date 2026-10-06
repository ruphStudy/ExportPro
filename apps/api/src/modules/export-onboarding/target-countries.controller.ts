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
import { TargetCountriesService } from './target-countries.service';
import { SetTargetCountryDto } from './dto/target-country.dto';

@ApiTags('export-onboarding')
@UseGuards(PermissionGuard)
@Controller('export-onboarding/countries')
export class TargetCountriesController {
  constructor(private readonly countries: TargetCountriesService) {}

  @RequirePermission('onboarding.view')
  @Get()
  list(@Req() req: Request) {
    return this.countries.list(req.organizationId!);
  }

  @RequirePermission('onboarding.update')
  @Post()
  upsert(@Req() req: Request, @Body() dto: SetTargetCountryDto) {
    return this.countries.upsert(req.organizationId!, req.user!.id, dto);
  }

  @RequirePermission('onboarding.update')
  @HttpCode(HttpStatus.OK)
  @Delete(':countryCode')
  remove(@Req() req: Request, @Param('countryCode') countryCode: string) {
    return this.countries.remove(
      req.organizationId!,
      req.user!.id,
      countryCode,
    );
  }
}
