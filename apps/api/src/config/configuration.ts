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
      frontendUrl: env.FRONTEND_URL,
    },
    database: {
      url: env.DATABASE_URL,
    },
    ai: {
      provider: env.AI_PROVIDER,
      apiKey: env.AI_PROVIDER_API_KEY,
      model: env.AI_MODEL,
      timeoutMs: env.AI_TIMEOUT_MS,
      enabled: env.AI_ENABLED,
    },
    tradeDataPlatform: {
      comtradeBaseUrl: env.COMTRADE_BASE_URL,
      comtradeRequestGapMs: env.COMTRADE_REQUEST_GAP_MS,
      comtradeHsCodes: env.COMTRADE_HS_CODES,
      comtradeExportYears: env.COMTRADE_EXPORT_YEARS,
      comtradeImportYears: env.COMTRADE_IMPORT_YEARS,
      comtradeImportReporters: env.COMTRADE_IMPORT_REPORTERS,
      hsReferenceUrl: env.COMTRADE_HS_REFERENCE_URL,
      adminEmails: env.TRADE_DATA_ADMIN_EMAILS,
      gleifBaseUrl: env.GLEIF_BASE_URL,
    },
    email: {
      apiKey: env.EMAIL_PROVIDER_API_KEY,
      fromAddress: env.EMAIL_FROM_ADDRESS,
    },
    outreach: {
      provider: env.OUTREACH_EMAIL_PROVIDER,
      apiKey: env.EMAIL_PROVIDER_API_KEY,
      webhookSecret: env.OUTREACH_WEBHOOK_SECRET,
      processorEnabled: env.OUTREACH_PROCESSOR_ENABLED,
      processorIntervalMs: env.OUTREACH_PROCESSOR_INTERVAL_MS,
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
