import { z } from 'zod';

/**
 * Startup contract for environment variables. Grouped to match the
 * provider groups in .env.example so a new integration (AI, email,
 * WhatsApp, ...) adds one line here and one line there, nothing else.
 * `main.ts` calls `validateEnv(process.env)` before the Nest app is
 * created — an invalid/missing required var fails fast with a clear
 * message instead of surfacing as a confusing runtime error later.
 */
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

  // AI provider (future sprint)
  AI_PROVIDER_API_KEY: z.string().optional(),

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
