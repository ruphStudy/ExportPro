import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Extension point for org-scoped routes, added by a future sprint with
 * `@UseGuards(TenantGuard)`. Not registered globally: Sprint 1 has no
 * org-scoped business routes yet, and applying it ahead of real tenant
 * resolution would just reject everything.
 *
 * When wired up, pair it with a repository-layer convention of always
 * filtering by `organizationId` — this guard only stops a request with
 * no resolved tenant from reaching a handler, it does not by itself
 * prevent a handler from querying the wrong tenant's rows.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.organizationId) {
      throw new ForbiddenException(
        'No active organization resolved for this request.',
      );
    }
    return true;
  }
}
