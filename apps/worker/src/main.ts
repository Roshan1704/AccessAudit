/* eslint-disable no-console -- process entry point */
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { launchSafeBrowser, startEgressProxy } from '@accessaudit/crawler';
import { createDb } from '@accessaudit/db';
import { EnvKeyProvider } from '@accessaudit/security';
import {
  QUICK_QUEUE,
  SCAN_QUEUE,
  loadConfig,
  quickJobPayload,
  scanJobPayload,
} from '@accessaudit/shared';
import { runQuick } from './run-quick.js';
import { runScan } from './run-scan.js';

const config = loadConfig(process.env);
const concurrency = Number(process.env['WORKER_CONCURRENCY'] ?? '2');
if (config.WORKER_DATABASE_URL === undefined) {
  console.error('WORKER_DATABASE_URL is required (aa_worker role)');
  process.exit(1);
}
const handle = createDb(config.WORKER_DATABASE_URL, { max: concurrency + 2 });
const { db } = handle;
// Dev only: private targets for authorized scans. The quick check always stays strict.
const scanPolicy = config.ALLOW_PRIVATE_TARGETS ? { allowPrivateNetworks: true } : undefined;
if (scanPolicy) console.warn('ALLOW_PRIVATE_TARGETS is on: SSRF protection relaxed (dev only)');
const proxy = await startEgressProxy(scanPolicy ? { policy: scanPolicy } : {});
const channel = process.env['BROWSER_CHANNEL'];
const browser = await launchSafeBrowser({
  proxyUrl: proxy.url,
  ...(channel ? { channel } : {}),
  noSandbox: process.env['BROWSER_NO_SANDBOX'] === '1',
});
const credentialKeys = config.CREDENTIAL_ENCRYPTION_KEY
  ? new EnvKeyProvider(config.CREDENTIAL_KEY_ID, config.CREDENTIAL_ENCRYPTION_KEY)
  : undefined;
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
  SCAN_QUEUE,
  async (job) => {
    const payload = scanJobPayload.parse(job.data);
    const outcome = await runScan(
      {
        db,
        browser,
        userAgent: 'AccessAuditBot/0.1 (+https://accessaudit.example/bot)',
        ...(credentialKeys ? { credentialKeys } : {}),
        ...(scanPolicy ? { policy: scanPolicy } : {}),
      },
      payload,
    );
    console.log(JSON.stringify({ msg: 'scan finished', scanId: payload.scanId, outcome }));
    return outcome;
  },
  { connection, concurrency },
);

const quickWorker = new Worker(
  QUICK_QUEUE,
  async (job) => {
    const payload = quickJobPayload.parse(job.data);
    return runQuick(
      { browser, userAgent: 'AccessAuditBot/0.1 (+https://accessaudit.example/bot)' },
      payload,
    );
  },
  { connection, concurrency: config.QUICK_CHECK_MAX_ACTIVE },
);

async function shutdown(): Promise<void> {
  await worker.close();
  await quickWorker.close();
  await browser.close();
  await proxy.close();
  await handle.close();
  connection.disconnect();
}
process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
console.log('worker ready');
