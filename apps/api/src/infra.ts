import { Resolver } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { QUICK_QUEUE, SCAN_QUEUE, type AppConfig, type QuickResult } from '@accessaudit/shared';
import type {
  DnsResolver,
  ErrorReporter,
  HttpsFetchResult,
  Mailer,
  PinnedFetcher,
  QuickAdmission,
  QuickChecks,
  QuickStatus,
  ScanQueue,
} from './deps.js';

export class NodeDnsResolver implements DnsResolver {
  private readonly resolver = new Resolver({ timeout: 4000, tries: 2 });

  constructor(server?: string) {
    if (server) this.resolver.setServers([server]);
  }

  async resolveTxt(name: string): Promise<string[]> {
    const records = await this.resolver.resolveTxt(name);
    return records.map((chunks) => chunks.join(''));
  }

  async resolveAddresses(name: string): Promise<string[]> {
    const [v4, v6] = await Promise.allSettled([
      this.resolver.resolve4(name),
      this.resolver.resolve6(name),
    ]);
    const out: string[] = [];
    if (v4.status === 'fulfilled') out.push(...v4.value);
    if (v6.status === 'fulfilled') out.push(...v6.value);
    if (out.length === 0) {
      throw (
        v4.status === 'rejected'
          ? v4.reason
          : v6.status === 'rejected'
            ? v6.reason
            : new Error('no addresses')
      ) as Error;
    }
    return out;
  }
}

const MAX_BODY = 1024;

/** HTTPS GET to a pre-validated address: TLS verified against `hostname`, redirects never followed, body capped. */
export class HttpsPinnedFetcher implements PinnedFetcher {
  /** `plainHttp` (development only): use HTTP on port 80 for hosts without TLS. */
  constructor(private readonly plainHttp = false) {}

  get(
    hostname: string,
    path: string,
    pinnedAddress: string,
    opts?: { maxBytes: number },
  ): Promise<HttpsFetchResult> {
    const maxBody = opts?.maxBytes ?? MAX_BODY;
    const transport = this.plainHttp ? http : https;
    const family = pinnedAddress.includes(':') ? 6 : 4;
    const lookup: LookupFunction = (_host, opts, cb) => {
      if (opts.all === true) cb(null, [{ address: pinnedAddress, family }]);
      else cb(null, pinnedAddress, family);
    };
    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          host: hostname,
          ...(this.plainHttp ? {} : { servername: hostname }),
          port: this.plainHttp ? 80 : 443,
          path,
          method: 'GET',
          timeout: 5000,
          lookup,
          headers: {
            host: hostname,
            accept: 'text/html,text/plain',
            'user-agent': 'AccessAudit-Verifier/1.0',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > maxBody) {
              res.destroy();
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
                truncated: true,
              });
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
              truncated: false,
            });
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error('timeout'));
      });
      req.on('error', reject);
      req.end();
    });
  }
}

/**
 * Development mailer: records that a message would have been sent. It never logs the body,
 * because bodies carry single-use reset and invitation tokens. Replace with a real adapter
 * before production.
 */
export class LogMailer implements Mailer {
  constructor(private readonly log: FastifyBaseLogger) {}

  send(msg: { to: string; subject: string; text: string }): Promise<void> {
    this.log.info(
      { mail: { to: msg.to, subject: msg.subject, bodyLength: msg.text.length } },
      'mail not delivered (dev log adapter; body intentionally not logged)',
    );
    return Promise.resolve();
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

/**
 * Production mailer: POSTs JSON to a transactional mail API (Resend/Postmark style bodies differ,
 * so this sends a neutral `{from,to,subject,text}` document with a bearer key; put a thin relay or
 * a provider that accepts this shape behind MAIL_API_URL). A non-2xx answer rejects, so callers
 * see the failure. Bodies are never logged: they carry single-use tokens.
 */
export class HttpMailer implements Mailer {
  constructor(
    private readonly cfg: { url: string; apiKey: string; from: string },
    private readonly doFetch: FetchLike = fetch,
  ) {}

  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    const res = await this.doFetch(this.cfg.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        from: this.cfg.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`mail provider answered ${String(res.status)}`);
  }
}

/** Sends a small JSON document to a webhook for each unhandled error. Never throws to its caller. */
export class WebhookErrorReporter implements ErrorReporter {
  constructor(
    private readonly url: string,
    private readonly service = 'accessaudit-api',
    private readonly doFetch: FetchLike = fetch,
  ) {}

  async report(
    err: unknown,
    context: { requestId: string; method: string; url: string },
  ): Promise<void> {
    const e = err instanceof Error ? err : new Error(String(err));
    try {
      await this.doFetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          service: this.service,
          time: new Date().toISOString(),
          name: e.name,
          message: e.message,
          stack: e.stack,
          ...context,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Reporting must never break request handling.
    }
  }
}

/** Quick check on Redis: counters expire on their own; results live ten minutes inside the job record. */
export class RedisQuickChecks implements QuickChecks {
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(
    redisUrl: string,
    private readonly cfg: Pick<
      AppConfig,
      'QUICK_CHECK_PER_IP_HOURLY' | 'QUICK_CHECK_DAILY_CAP' | 'QUICK_CHECK_MAX_ACTIVE'
    >,
  ) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUICK_QUEUE, { connection: this.connection });
  }

  async admit(ip: string): Promise<QuickAdmission> {
    const counts = await this.queue.getJobCounts('waiting', 'active');
    if ((counts['waiting'] ?? 0) + (counts['active'] ?? 0) >= this.cfg.QUICK_CHECK_MAX_ACTIVE * 2)
      return { ok: false, reason: 'busy' };
    const iso = new Date().toISOString();
    const hourKey = `qc:ip:${ip}:${iso.slice(0, 13)}`;
    const dayKey = `qc:day:${iso.slice(0, 10)}`;
    const perIp = await this.connection.incr(hourKey);
    if (perIp === 1) await this.connection.expire(hourKey, 3600);
    if (perIp > this.cfg.QUICK_CHECK_PER_IP_HOURLY) return { ok: false, reason: 'ip_limit' };
    const day = await this.connection.incr(dayKey);
    if (day === 1) await this.connection.expire(dayKey, 86400);
    if (day > this.cfg.QUICK_CHECK_DAILY_CAP) return { ok: false, reason: 'daily_cap' };
    return { ok: true };
  }

  async consumeChallenge(challenge: string, ttlSeconds: number): Promise<boolean> {
    const r = await this.connection.set(`qc:ch:${challenge}`, '1', 'EX', ttlSeconds, 'NX');
    return r === 'OK';
  }

  async submit(url: string): Promise<string> {
    const id = randomUUID();
    await this.queue.add(
      'quick',
      { url },
      {
        jobId: id,
        attempts: 1,
        removeOnComplete: { age: 600 },
        removeOnFail: { age: 600 },
      },
    );
    return id;
  }

  async status(id: string): Promise<QuickStatus> {
    const job = await this.queue.getJob(id);
    if (!job) return { state: 'unknown' };
    const state = await job.getState();
    if (state === 'completed') {
      // Shown once: the result is deleted as soon as it has been delivered.
      const result = job.returnvalue as QuickResult;
      await job.remove().catch(() => undefined);
      return { state: 'done', result };
    }
    if (state === 'failed') return { state: 'failed' };
    if (state === 'active') return { state: 'running' };
    return { state: 'pending' };
  }

  async close(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}

/** BullMQ producer. Job ids equal scan ids, so a repeated enqueue of one scan is a no-op. */
export class BullScanQueue implements ScanQueue {
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(SCAN_QUEUE, { connection: this.connection });
  }

  async enqueue(payload: { orgId: string; scanId: string }): Promise<void> {
    await this.queue.add('scan', payload, {
      jobId: payload.scanId,
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  async ping(): Promise<void> {
    await this.connection.ping();
  }

  async close(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
