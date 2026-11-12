import { scans } from '@accessaudit/db';
import { count, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { Deps } from '../deps.js';

const startedAt = Date.now();

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function healthRoutes(app: FastifyInstance, deps: Deps): void {
  // Liveness: process is up. No dependencies touched.
  app.get('/healthz', () => ({ status: 'ok' }));

  // Readiness: database and queue back end (Redis) reachable.
  app.get('/readyz', async (req, reply) => {
    const checks = { database: 'ok', redis: 'ok' };
    try {
      await deps.db.execute(sql`select 1`);
    } catch (e) {
      req.log.error({ err: e }, 'readiness check failed: database');
      checks.database = 'fail';
    }
    try {
      await deps.scanQueue.ping();
    } catch (e) {
      req.log.error({ err: e }, 'readiness check failed: redis');
      checks.redis = 'fail';
    }
    if (checks.database === 'ok' && checks.redis === 'ok') return { status: 'ready', checks };
    return reply.status(503).send({ status: 'unavailable', checks });
  });

  // Prometheus text format. Disabled unless METRICS_TOKEN is set; requires a bearer token.
  app.get('/metrics', async (req, reply) => {
    const token = deps.config.METRICS_TOKEN;
    if (token === undefined) return reply.status(404).send({ error: 'not_found' });
    if (!tokenMatches(req.headers.authorization, token)) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
    const lines: string[] = [
      '# TYPE accessaudit_process_uptime_seconds gauge',
      `accessaudit_process_uptime_seconds ${String(Math.round((Date.now() - startedAt) / 1000))}`,
      '# TYPE accessaudit_process_resident_memory_bytes gauge',
      `accessaudit_process_resident_memory_bytes ${String(process.memoryUsage().rss)}`,
    ];
    try {
      // Cross-organization counts, allowed only by the scheduler_select policy.
      const rows = await deps.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.scheduler', 'on', true)`);
        return tx.select({ status: scans.status, n: count() }).from(scans).groupBy(scans.status);
      });
      lines.push('# TYPE accessaudit_scans gauge');
      for (const r of rows) lines.push(`accessaudit_scans{status="${r.status}"} ${String(r.n)}`);
    } catch (e) {
      req.log.error({ err: e }, 'metrics: scan counts failed');
    }
    return reply.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });
}
