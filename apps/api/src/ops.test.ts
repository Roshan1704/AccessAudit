import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { scans, withTenant } from '@accessaudit/db';
import { recoverStuckScans } from './scheduler.js';
import { createOrg, makeHarness, registerUser, type Harness } from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('operations: readiness, metrics, stuck-scan recovery (integration)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(url as string);
  });
  afterAll(async () => {
    await h.close();
  });

  it('/readyz reports database and redis, and fails when the queue is down', async () => {
    const ok = await h.app.inject({ url: '/readyz' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ checks: { database: 'ok', redis: 'ok' } });

    const original = h.deps.scanQueue.ping.bind(h.deps.scanQueue);
    h.deps.scanQueue.ping = () => Promise.reject(new Error('redis down'));
    try {
      const down = await h.app.inject({ url: '/readyz' });
      expect(down.statusCode).toBe(503);
      expect(down.json()).toMatchObject({ checks: { database: 'ok', redis: 'fail' } });
    } finally {
      h.deps.scanQueue.ping = original;
    }
  });

  it('/metrics is off without a token and needs the bearer token when set', async () => {
    expect((await h.app.inject({ url: '/metrics' })).statusCode).toBe(404);

    const config = h.deps.config as { METRICS_TOKEN?: string };
    config.METRICS_TOKEN = 'metrics-token-0123456789';
    try {
      expect((await h.app.inject({ url: '/metrics' })).statusCode).toBe(401);
      const bad = await h.app.inject({
        url: '/metrics',
        headers: { authorization: 'Bearer wrong-token-0123456789' },
      });
      expect(bad.statusCode).toBe(401);
      const good = await h.app.inject({
        url: '/metrics',
        headers: { authorization: 'Bearer metrics-token-0123456789' },
      });
      expect(good.statusCode).toBe(200);
      expect(good.body).toContain('accessaudit_process_uptime_seconds');
      expect(good.body).toContain('accessaudit_scans{status=');
    } finally {
      delete config.METRICS_TOKEN;
    }
  });

  it('fails only scans stuck in running past the limit', async () => {
    const u = await registerUser(h.app, 'rec');
    const orgId = await createOrg(u.c, 'rec');
    const p = await u.c.call('POST', `/orgs/${orgId}/projects`, {
      name: 'Recovery Site',
      baseUrl: `https://rec-${Math.random().toString(36).slice(2, 8)}.example.com`,
    });
    const projectId = p.body.project.id as string;
    const now = h.deps.now();
    const minutesAgo = (m: number): Date => new Date(now.getTime() - m * 60_000);

    const mk = (status: 'running' | 'queued', startedAt: Date | null) =>
      withTenant(h.handle.db, { orgId }, async (tx) => {
        const [s] = await tx
          .insert(scans)
          .values({
            organizationId: orgId,
            projectId,
            status,
            startUrl: 'https://example.com/',
            startedAt,
          })
          .returning({ id: scans.id });
        return (s as { id: string }).id;
      });

    const stuck = await mk('running', minutesAgo(h.deps.config.STUCK_SCAN_MINUTES + 5));
    const fresh = await mk('running', minutesAgo(2));
    const waiting = await mk('queued', null);

    expect(await recoverStuckScans(h.deps)).toBeGreaterThanOrEqual(1);

    const status = (id: string) =>
      withTenant(h.handle.db, { orgId }, async (tx) => {
        const [r] = await tx.select().from(scans).where(eq(scans.id, id));
        return r;
      });
    expect(await status(stuck)).toMatchObject({ status: 'failed', failureReason: 'worker_lost' });
    expect((await status(stuck))?.finishedAt).not.toBeNull();
    expect(await status(fresh)).toMatchObject({ status: 'running' });
    expect(await status(waiting)).toMatchObject({ status: 'queued' });

    // Running it again changes nothing for the already-failed scan.
    await recoverStuckScans(h.deps);
    expect(await status(stuck)).toMatchObject({ status: 'failed', failureReason: 'worker_lost' });
  });
});
