import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Registered globally in AppModule so every new route is protected by
 * default — a route becomes public by opting in with `@Public()`, not
 * the other way round.
 *
 * Sprint 2 replaces the body of this guard with real session/JWT
 * verification (and sets `request.user`); until then it has nothing to
 * verify, so any non-public route correctly fails closed instead of
 * pretending to be authenticated.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) {
      throw new UnauthorizedException(
        'Authentication is not yet available on this route.',
      );
    }
    return true;
  }
}
