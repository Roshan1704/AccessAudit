import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  /** Worker connection: must use the aa_worker role (the API role cannot write finding evidence). */
  WORKER_DATABASE_URL: z.string().min(1).optional(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PUBLIC_URL: z.url().default('http://localhost:4000'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  SESSION_COOKIE_SECRET: z.string().min(32, 'must be at least 32 characters'),
  DOMAIN_REVALIDATE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  DNS_RESOLVER: z.string().optional(),
  /**
   * DEVELOPMENT ONLY. Lets authorized-domain checks and scans target private-network hosts
   * (for example an in-house test server). Weakens SSRF protection; never enable in production.
   * Does not affect the anonymous quick check.
   */
  ALLOW_PRIVATE_TARGETS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Kill switch for the anonymous quick check (ADR-026). */
  QUICK_CHECK_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  QUICK_CHECK_PER_IP_HOURLY: z.coerce.number().int().min(1).max(1000).default(5),
  QUICK_CHECK_DAILY_CAP: z.coerce.number().int().min(1).max(1_000_000).default(500),
  QUICK_CHECK_MAX_ACTIVE: z.coerce.number().int().min(1).max(100).default(4),
  /** Leading zero bits the client must find in sha256(challenge salt + nonce). */
  QUICK_CHECK_POW_BITS: z.coerce.number().int().min(8).max(28).default(18),
  /** Bearer token for GET /metrics. When unset the endpoint is disabled. */
  METRICS_TOKEN: z.string().min(16).optional(),
  /** A scan left in `running` longer than this is marked failed by the recovery sweep. */
  STUCK_SCAN_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  /** HTTPS endpoint of a transactional mail API. When unset, mail is only logged (development). */
  MAIL_API_URL: z.url().optional(),
  MAIL_API_KEY: z.string().min(8).optional(),
  MAIL_FROM: z.string().min(3).default('AccessAudit <no-reply@localhost>'),
  /** Receives a JSON POST for each unhandled server error. When unset, errors are only logged. */
  ERROR_WEBHOOK_URL: z.url().optional(),
  /** Base64 32-byte key that encrypts stored scan credentials (ADR-031). Authenticated scanning is off when unset. */
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(40).optional(),
  CREDENTIAL_KEY_ID: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/)
    .default('k1'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  return parsed.data;
}
