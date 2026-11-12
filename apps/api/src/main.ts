import { Argon2PasswordHasher, EnvKeyProvider } from '@accessaudit/security';
import { loadConfig } from '@accessaudit/shared';
import { createDb } from '@accessaudit/db';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { Deps, Mailer } from './deps.js';
import { startScheduler } from './scheduler.js';
import {
  BullScanQueue,
  HttpMailer,
  HttpsPinnedFetcher,
  LogMailer,
  NodeDnsResolver,
  RedisQuickChecks,
  WebhookErrorReporter,
} from './infra.js';

const config = loadConfig(process.env);
const handle = createDb(config.DATABASE_URL);
const scanQueue = new BullScanQueue(config.REDIS_URL);
const quick = new RedisQuickChecks(config.REDIS_URL, config);

const holder: { app?: FastifyInstance } = {};
// The mailer logs through the app logger, which exists only after the app is built.
const mailer: Mailer =
  config.MAIL_API_URL && config.MAIL_API_KEY
    ? new HttpMailer({
        url: config.MAIL_API_URL,
        apiKey: config.MAIL_API_KEY,
        from: config.MAIL_FROM,
      })
    : {
        send: (msg) => {
          if (!holder.app) return Promise.reject(new Error('app not ready'));
          return new LogMailer(holder.app.log).send(msg);
        },
      };

const deps: Deps = {
  config,
  db: handle.db,
  hasher: new Argon2PasswordHasher(),
  mailer,
  ...(config.ERROR_WEBHOOK_URL
    ? { errorReporter: new WebhookErrorReporter(config.ERROR_WEBHOOK_URL) }
    : {}),
  ...(config.CREDENTIAL_ENCRYPTION_KEY
    ? {
        credentialKeys: new EnvKeyProvider(
          config.CREDENTIAL_KEY_ID,
          config.CREDENTIAL_ENCRYPTION_KEY,
        ),
      }
    : {}),
  dns: new NodeDnsResolver(config.DNS_RESOLVER),
  // Development only: with ALLOW_PRIVATE_TARGETS, verify over plain HTTP on port 80.
  fetcher: new HttpsPinnedFetcher(config.ALLOW_PRIVATE_TARGETS),
  scanQueue,
  quick,
  now: () => new Date(),
};
const app = await buildApp(deps);
holder.app = app;

// Recurring scans (ADR-027). Disabled with SCHEDULER=off, e.g. on extra API replicas.
const stopScheduler =
  process.env['SCHEDULER'] === 'off' ? () => undefined : startScheduler(deps, app.log);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  stopScheduler();
  await app.close();
  await scanQueue.close();
  await quick.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
