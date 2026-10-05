import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ApiSuccessResponse, PaginationMeta } from '@exportpro/types';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

interface HandlerResult<T> {
  data: T;
  meta?: PaginationMeta | Record<string, unknown>;
}

function isHandlerResult<T>(value: unknown): value is HandlerResult<T> {
  return typeof value === 'object' && value !== null && 'data' in value;
}

/**
 * Wraps every controller return value in the shared ApiSuccessResponse
 * envelope (see packages/types/src/api.ts) so the frontend's api-client
 * only has to unwrap one shape. A handler may return a plain value, or
 * `{ data, meta }` when it needs to attach pagination metadata.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      map((result) => {
        const { data, meta } = isHandlerResult<T>(result)
          ? result
          : { data: result, meta: undefined };

        return {
          success: true,
          data,
          ...(meta ? { meta } : {}),
          requestId: request.requestId,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
