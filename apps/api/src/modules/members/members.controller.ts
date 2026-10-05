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
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { MembersService } from './members.service';

@ApiTags('members')
@UseGuards(PermissionGuard)
@Controller('organizations/current')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @RequirePermission('team.view')
  @Get('members')
  list(@Req() req: Request) {
    return this.members.list(req.organizationId!);
  }

  @RequirePermission('team.invite')
  @Post('invitations')
  invite(@Req() req: Request, @Body() dto: InviteMemberDto) {
    return this.members.invite(
      req.organizationId!,
      req.user!.id,
      dto.email,
      dto.role,
    );
  }

  @RequirePermission('team.update')
  @Patch('members/:membershipId')
  updateRole(
    @Req() req: Request,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.members.updateRole(
      req.organizationId!,
      membershipId,
      req.user!.id,
      dto.role,
    );
  }

  @RequirePermission('team.remove')
  @HttpCode(HttpStatus.OK)
  @Delete('members/:membershipId')
  remove(@Req() req: Request, @Param('membershipId') membershipId: string) {
    return this.members.remove(req.organizationId!, membershipId, req.user!.id);
  }
}
