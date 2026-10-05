import { UserSummary } from '@exportpro/types';

/**
 * Fields Sprint 2's auth/tenant-resolution guards will populate. Declared
 * now so decorators and guards that read them compile today instead of
 * waiting for that guard to exist.
 */
declare module 'express' {
  interface Request {
    user?: UserSummary;
    organizationId?: string;
  }
}
