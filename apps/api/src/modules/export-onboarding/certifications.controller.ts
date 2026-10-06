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
import { CertificationsService } from './certifications.service';
import { OnboardingDocumentsService } from './onboarding-documents.service';
import {
  CreateCertificationDto,
  UpdateCertificationDto,
} from './dto/certification.dto';

@ApiTags('export-onboarding')
@UseGuards(PermissionGuard)
@Controller('export-onboarding/certifications')
export class CertificationsController {
  constructor(
    private readonly certifications: CertificationsService,
    private readonly documents: OnboardingDocumentsService,
  ) {}

  @RequirePermission('onboarding.view')
  @Get()
  list(@Req() req: Request) {
    return this.certifications.list(req.organizationId!);
  }

  @RequirePermission('onboarding.update')
  @Post()
  create(@Req() req: Request, @Body() dto: CreateCertificationDto) {
    return this.certifications.create(req.organizationId!, req.user!.id, dto);
  }

  // Declared before ":id" routes below — "documents" would otherwise be
  // captured as an :id value, since Nest matches routes in declaration order.
  @RequirePermission('onboarding.update')
  @HttpCode(HttpStatus.OK)
  @Delete('documents/:documentId')
  removeDocument(@Req() req: Request, @Param('documentId') documentId: string) {
    return this.documents.remove(req.organizationId!, req.user!.id, documentId);
  }

  @RequirePermission('onboarding.update')
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCertificationDto,
  ) {
    return this.certifications.update(
      req.organizationId!,
      req.user!.id,
      id,
      dto,
    );
  }

  @RequirePermission('onboarding.update')
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.certifications.remove(req.organizationId!, req.user!.id, id);
  }

  @RequirePermission('documents.upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @Post(':id/document')
  uploadDocument(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.uploadForCertification(
      req.organizationId!,
      req.user!.id,
      id,
      file,
    );
  }
}
