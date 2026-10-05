import { MembershipRole, UserSummary } from '@exportpro/types';

/**
 * Populated by AuthGuard (see ../guards/auth.guard.ts) once a session
 * cookie resolves to a valid, non-revoked, non-expired Session row.
 */
declare module 'express' {
  interface Request {
    user?: UserSummary;
    /** The Session row backing this request's cookie. */
    sessionId?: string;
    /** Server-resolved current organization — never trust a client-supplied org id instead of this. */
    organizationId?: string;
    /** The caller's role within `organizationId`, when resolved. */
    membershipRole?: MembershipRole;
  }
}
