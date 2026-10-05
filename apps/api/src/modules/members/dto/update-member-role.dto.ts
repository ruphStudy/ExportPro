import { IsEnum } from 'class-validator';
import { MembershipRole } from '@exportpro/types';

const ASSIGNABLE_ROLES = Object.values(MembershipRole).filter(
  (role) => role !== 'OWNER',
);

export class UpdateMemberRoleDto {
  @IsEnum(ASSIGNABLE_ROLES, {
    message: 'Select a valid role (Owner cannot be assigned here).',
  })
  role: Exclude<MembershipRole, 'OWNER'>;
}
