import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { OrgContextService } from '../auth/org-context.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { SwitchOrganizationDto } from './dto/switch-organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly orgContext: OrgContextService,
  ) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(req.user!.id, req.sessionId!, dto);
  }

  @Get('mine')
  async mine(@Req() req: Request) {
    const { memberships } = await this.orgContext.resolveForUser(req.user!.id);
    return memberships.map((m) => this.orgContext.toMembershipSummary(m));
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('organization.view')
  @Get('current')
  getCurrent(@Req() req: Request) {
    return this.organizations.getCurrent(req.organizationId!);
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('organization.update')
  @Patch('current')
  update(@Req() req: Request, @Body() dto: UpdateOrganizationDto) {
    return this.organizations.update(req.organizationId!, req.user!.id, dto);
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('organization.update')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @Post('current/logo')
  uploadLogo(@Req() req: Request, @UploadedFile() file: Express.Multer.File) {
    return this.organizations.updateLogo(
      req.organizationId!,
      req.user!.id,
      file,
    );
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('organization.update')
  @HttpCode(HttpStatus.OK)
  @Delete('current/logo')
  removeLogo(@Req() req: Request) {
    return this.organizations.removeLogo(req.organizationId!, req.user!.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('switch')
  switch(@Req() req: Request, @Body() dto: SwitchOrganizationDto) {
    return this.organizations.switch(
      req.user!.id,
      req.sessionId!,
      dto.organizationId,
    );
  }
}
