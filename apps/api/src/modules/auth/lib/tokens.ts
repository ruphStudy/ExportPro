import { randomBytes, randomInt, createHash } from 'crypto';

/** Opaque bearer token for session cookies / password-reset links — 256 bits of entropy. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * One-way hash for tokens we need to look up by equality (session
 * tokens, reset tokens). SHA-256 — not bcrypt/argon2 — is correct here:
 * these tokens already have 256 bits of server-generated entropy, so
 * the hash only needs to avoid storing the bearer secret in plaintext,
 * not resist brute force on a guessable input the way a password hash does.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** 6-digit numeric OTP for email verification. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
