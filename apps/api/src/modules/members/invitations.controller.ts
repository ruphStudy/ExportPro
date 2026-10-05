import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { MembersService } from './members.service';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly members: MembersService) {}

  @Public()
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.members.previewInvitation(token);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':token/accept')
  accept(@Param('token') token: string, @Req() req: Request) {
    return this.members.accept(token, req.user!.id, req.user!.email);
  }
}
