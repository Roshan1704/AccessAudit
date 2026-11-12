import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { QUICK_QUEUE, type QuickResult } from '@accessaudit/shared';
import { RedisQuickChecks } from './infra.js';

const redisUrl = process.env['TEST_REDIS_URL'];
const suite = redisUrl ? describe : describe.skip;

suite('quick check results on Redis (integration)', () => {
  const checks = redisUrl
    ? new RedisQuickChecks(redisUrl, {
        QUICK_CHECK_PER_IP_HOURLY: 5,
        QUICK_CHECK_DAILY_CAP: 1000,
        QUICK_CHECK_MAX_ACTIVE: 2,
      })
    : null;
  const workerConnection = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: null }) : null;
  let worker: Worker | null = null;

  afterAll(async () => {
    await worker?.close();
    workerConnection?.disconnect();
    await checks?.close();
  });

  it('delivers a finished result once, then reports it as unknown', async () => {
    if (!checks || !workerConnection) throw new Error('redis not configured');
    const result = { url: 'https://example.com/', findings: [] } as unknown as QuickResult;
    worker = new Worker(QUICK_QUEUE, () => Promise.resolve(result), {
      connection: workerConnection,
    });
    const id = await checks.submit('https://example.com/');
    let first = await checks.status(id);
    for (let i = 0; i < 50 && first.state !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      first = await checks.status(id);
    }
    expect(first.state).toBe('done');
    expect(await checks.status(id)).toEqual({ state: 'unknown' });
  });
});
