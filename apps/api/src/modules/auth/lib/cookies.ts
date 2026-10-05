import { Response } from 'express';
import { SESSION_COOKIE_NAME, SESSION_LIFETIME_MS } from './constants';

/**
 * SameSite=lax is sufficient here (not `none`) because the frontend
 * talks to this API through a same-origin Next.js rewrite proxy in
 * every environment — see ARCHITECTURE.md "Authentication
 * Architecture". `secure` is forced on in production; browsers also
 * accept it over plain http://localhost in development.
 */
export function setSessionCookie(
  res: Response,
  rawToken: string,
  rememberMe: boolean,
) {
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: rememberMe
      ? SESSION_LIFETIME_MS.rememberMe
      : SESSION_LIFETIME_MS.default,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}
