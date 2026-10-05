import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiErrorCode, ApiErrorResponse } from '@exportpro/types';
import { Request, Response } from 'express';

const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
};

/**
 * Catches everything (HttpException and unexpected errors alike) and
 * normalizes it into ApiErrorResponse. Non-HttpExceptions are logged
 * with full detail server-side but only ever return a generic message
 * to the client — never leak a stack trace or internal error text.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const code: ApiErrorCode = STATUS_TO_CODE[status] ?? 'INTERNAL_ERROR';

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code,
        message: isHttpException
          ? extractMessage(exception)
          : 'An unexpected error occurred.',
        details: isHttpException ? extractDetails(exception) : undefined,
      },
      requestId: request.requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    if (!isHttpException) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.originalUrl} [${request.requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }
}

function extractMessage(exception: HttpException): string {
  const payload = exception.getResponse();
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = (payload as { message: unknown }).message;
    return Array.isArray(message) ? message.join(', ') : String(message);
  }
  return exception.message;
}

function extractDetails(exception: HttpException): unknown {
  const payload = exception.getResponse();
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = (payload as { message: unknown }).message;
    return Array.isArray(message) ? message : undefined;
  }
  return undefined;
}
