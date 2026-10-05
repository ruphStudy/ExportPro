import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Patch()
  update(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    return this.profile.update(req.user!.id, dto);
  }

  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @Post('avatar')
  uploadAvatar(@Req() req: Request, @UploadedFile() file: Express.Multer.File) {
    return this.profile.updateAvatar(req.user!.id, file);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('avatar')
  removeAvatar(@Req() req: Request) {
    return this.profile.removeAvatar(req.user!.id);
  }
}
