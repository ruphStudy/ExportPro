import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { RegistrationType } from '@prisma/client';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RegistrationsService } from './registrations.service';
import { OnboardingDocumentsService } from './onboarding-documents.service';
import { UpsertRegistrationDto } from './dto/registration.dto';

@ApiTags('export-onboarding')
@UseGuards(PermissionGuard)
@Controller('export-onboarding/registrations')
export class RegistrationsController {
  constructor(
    private readonly registrations: RegistrationsService,
    private readonly documents: OnboardingDocumentsService,
  ) {}

  @RequirePermission('onboarding.view')
  @Get()
  list(@Req() req: Request) {
    return this.registrations.list(req.organizationId!);
  }

  @RequirePermission('onboarding.update')
  @Patch(':type')
  upsert(
    @Req() req: Request,
    @Param('type', new ParseEnumPipe(RegistrationType)) type: RegistrationType,
    @Body() dto: UpsertRegistrationDto,
  ) {
    return this.registrations.upsert(
      req.organizationId!,
      req.user!.id,
      type,
      dto,
    );
  }

  @RequirePermission('documents.upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @Post(':type/document')
  uploadDocument(
    @Req() req: Request,
    @Param('type', new ParseEnumPipe(RegistrationType)) type: RegistrationType,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.uploadForRegistration(
      req.organizationId!,
      req.user!.id,
      type,
      file,
    );
  }

  @RequirePermission('onboarding.update')
  @HttpCode(HttpStatus.OK)
  @Delete('documents/:documentId')
  removeDocument(@Req() req: Request, @Param('documentId') documentId: string) {
    return this.documents.remove(req.organizationId!, req.user!.id, documentId);
  }
}
