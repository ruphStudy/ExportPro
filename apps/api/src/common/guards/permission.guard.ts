import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Permission, roleHasPermission } from '@exportpro/types';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * Runs after AuthGuard (which resolves `request.organizationId` /
 * `request.membershipRole`). Looks up the required permission via
 * `@RequirePermission(...)` metadata and checks it against the single
 * ROLE_PERMISSIONS map shared with the frontend (@exportpro/types) —
 * there is exactly one place role→permission logic is defined.
 *
 * A route with no `@RequirePermission` and no organization resolved
 * (the user has no active membership) is rejected rather than silently
 * allowed, so a future route can't forget to opt into a check.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.organizationId || !request.membershipRole) {
      throw new ForbiddenException(
        'No active organization membership for this request.',
      );
    }
    if (required && !roleHasPermission(request.membershipRole, required)) {
      throw new ForbiddenException(`Missing required permission: ${required}.`);
    }
    return true;
  }
}
