import { z } from 'zod';

/**
 * Startup contract for environment variables. Grouped to match the
 * provider groups in .env.example so a new integration (AI, email,
 * WhatsApp, ...) adds one line here and one line there, nothing else.
 * `main.ts` calls `validateEnv(process.env)` before the Nest app is
 * created — an invalid/missing required var fails fast with a clear
 * message instead of surfacing as a confusing runtime error later.
 */
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_GLOBAL_PREFIX: z.string().default('api/v1'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Base URL of the frontend — used to build links in emails (verification,
  // password reset, team invitations). Must not have a trailing slash.
  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // AI provider (Sprint 5 product classification). Unset AI_PROVIDER picks
  // "anthropic" when a key is present, else "development" outside
  // production. Production never falls back to the development provider.
  AI_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(['anthropic', 'development', 'none']).optional(),
  ),
  AI_PROVIDER_API_KEY: z.string().optional(),
  AI_MODEL: z.preprocess(
    emptyToUndefined,
    z.string().default('claude-opus-5-5'),
  ),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Sprint 9 trade-data platform (UN Comtrade public preview needs no key).
  COMTRADE_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().default('https://comtradeapi.un.org/public/v1/preview'),
  ),
  COMTRADE_REQUEST_GAP_MS: z.coerce.number().int().min(1000).default(3500),
  COMTRADE_HS_CODES: z.preprocess(
    emptyToUndefined,
    z.string().default('090931,610910,140490,392410,850440'),
  ),
  COMTRADE_EXPORT_YEARS: z.preprocess(
    emptyToUndefined,
    z.string().default('2019-2024'),
  ),
  COMTRADE_IMPORT_YEARS: z.preprocess(
    emptyToUndefined,
    z.string().default('2021-2023'),
  ),
  COMTRADE_IMPORT_REPORTERS: z.preprocess(
    emptyToUndefined,
    z.string().default('AE,SA,US,DE,GB,CN,BD,NG'),
  ),
  COMTRADE_HS_REFERENCE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default('https://comtradeapi.un.org/files/v1/app/reference/HS.json'),
  ),
  /** Comma-separated emails allowed to administer GLOBAL trade-data sources (in addition to the role permission). Required in production. */
  TRADE_DATA_ADMIN_EMAILS: z.string().optional(),

  // Email provider (future sprint)
  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().optional(),

  // WhatsApp provider (future sprint)
  WHATSAPP_PROVIDER_API_KEY: z.string().optional(),

  // External trade-data sources (future sprint)
  TRADE_DATA_API_KEY: z.string().optional(),

  // Object storage (future sprint)
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),

  // Payment provider (future sprint)
  PAYMENT_PROVIDER_API_KEY: z.string().optional(),

  // Analytics (future sprint)
  ANALYTICS_WRITE_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  return result.data;
}
