import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Pulls the authenticated user off the request. Sprint 2's auth guard is
 * what actually populates `request.user` — until then it is always
 * undefined, which is why AuthGuard (see ../guards/auth.guard.ts) rejects
 * any non-@Public route rather than letting handlers silently see `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user;
  },
);
