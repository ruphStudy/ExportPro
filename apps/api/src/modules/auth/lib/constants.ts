export const SESSION_COOKIE_NAME = 'exportpro_session';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const SESSION_LIFETIME_MS = {
  default: 1 * DAY_MS,
  rememberMe: 30 * DAY_MS,
} as const;

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
