import { EnvConfig, validateEnv } from './env.validation';

/**
 * Typed, grouped config object injected via ConfigService. Controllers/
 * services should depend on `ConfigService<AppConfig>` and read a group
 * (e.g. `configService.get('database', { infer: true })`) rather than
 * reaching into `process.env` directly.
 */
export function buildConfiguration(env: EnvConfig) {
  return {
    app: {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      globalPrefix: env.API_GLOBAL_PREFIX,
      corsOrigin: env.CORS_ORIGIN,
    },
    database: {
      url: env.DATABASE_URL,
    },
    auth: {
      jwtSecret: env.JWT_SECRET,
      jwtExpiresIn: env.JWT_EXPIRES_IN,
    },
    ai: {
      apiKey: env.AI_PROVIDER_API_KEY,
    },
    email: {
      apiKey: env.EMAIL_PROVIDER_API_KEY,
      fromAddress: env.EMAIL_FROM_ADDRESS,
    },
    whatsapp: {
      apiKey: env.WHATSAPP_PROVIDER_API_KEY,
    },
    tradeData: {
      apiKey: env.TRADE_DATA_API_KEY,
    },
    storage: {
      bucket: env.STORAGE_BUCKET,
      accessKey: env.STORAGE_ACCESS_KEY,
      secretKey: env.STORAGE_SECRET_KEY,
    },
    payment: {
      apiKey: env.PAYMENT_PROVIDER_API_KEY,
    },
    analytics: {
      writeKey: env.ANALYTICS_WRITE_KEY,
    },
  };
}

export type AppConfig = ReturnType<typeof buildConfiguration>;

export default function configuration(): AppConfig {
  return buildConfiguration(validateEnv(process.env));
}
