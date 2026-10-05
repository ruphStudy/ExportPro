import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

declare module 'express' {
  interface Request {
    requestId: string;
  }
}

/**
 * Attaches a correlation id to every request so it can be echoed back in
 * the response envelope and included in log lines — the same id a user
 * reports in a bug ticket should be greppable server-side.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id');
    req.requestId = incoming && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  }
}
