import { IsEmail, IsEnum } from 'class-validator';
import { MembershipRole } from '@exportpro/types';

const INVITABLE_ROLES = Object.values(MembershipRole).filter(
  (role) => role !== 'OWNER',
);

export class InviteMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(INVITABLE_ROLES, {
    message: 'Select a valid role (Owner cannot be assigned via invitation).',
  })
  role: Exclude<MembershipRole, 'OWNER'>;
}
