import { SetMetadata } from '@nestjs/common';
import { Permission } from '@exportpro/types';

export const PERMISSION_KEY = 'requiredPermission';

/** Marks a route as requiring the given permission within the caller's active organization — see PermissionGuard. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
