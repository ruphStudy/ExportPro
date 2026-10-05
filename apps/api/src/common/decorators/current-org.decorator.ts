import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Pulls the active organization id off the request. Populated by
 * Sprint 2's tenant-resolution step (from the session, not from a
 * client-supplied header) — every org-scoped query should read this
 * rather than trusting an organizationId in the request body/query.
 */
export const CurrentOrgId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.organizationId;
  },
);
