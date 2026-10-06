import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ExporterProfileService } from './exporter-profile.service';
import { ReadinessService } from './readiness.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';
import { UpdateProductsDto } from './dto/update-products.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';

@ApiTags('export-onboarding')
@UseGuards(PermissionGuard)
@Controller('export-onboarding')
export class ExportOnboardingController {
  constructor(
    private readonly profile: ExporterProfileService,
    private readonly readiness: ReadinessService,
  ) {}

  @RequirePermission('onboarding.view')
  @Get()
  get(@Req() req: Request) {
    return this.profile.get(req.organizationId!);
  }

  @RequirePermission('onboarding.update')
  @Patch('profile')
  updateProfile(@Req() req: Request, @Body() dto: UpdateBusinessProfileDto) {
    return this.profile.updateBusinessProfile(
      req.organizationId!,
      req.user!.id,
      dto,
    );
  }

  @RequirePermission('onboarding.update')
  @Patch('products')
  updateProducts(@Req() req: Request, @Body() dto: UpdateProductsDto) {
    return this.profile.updateProducts(req.organizationId!, req.user!.id, dto);
  }

  @RequirePermission('onboarding.update')
  @Patch('preferences')
  updatePreferences(@Req() req: Request, @Body() dto: UpdatePreferencesDto) {
    return this.profile.updatePreferences(
      req.organizationId!,
      req.user!.id,
      dto,
    );
  }

  @RequirePermission('onboarding.update')
  @Patch('progress')
  updateProgress(@Req() req: Request, @Body() dto: UpdateProgressDto) {
    return this.profile.updateProgress(req.organizationId!, req.user!.id, dto);
  }

  @RequirePermission('onboarding.update')
  @HttpCode(HttpStatus.OK)
  @Post('complete')
  complete(@Req() req: Request) {
    return this.profile.complete(req.organizationId!, req.user!.id);
  }

  @RequirePermission('readiness.view')
  @Get('readiness')
  getReadiness(@Req() req: Request) {
    return this.readiness.calculate(req.organizationId!);
  }
}
