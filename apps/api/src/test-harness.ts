import { createDb, type DbHandle } from '@accessaudit/db';
import { EnvKeyProvider, ScryptPasswordHasher } from '@accessaudit/security';
import { loadConfig } from '@accessaudit/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type {
  Deps,
  DnsResolver,
  HttpsFetchResult,
  Mailer,
  PinnedFetcher,
  QuickChecks,
  QuickStatus,
  ScanQueue,
} from './deps.js';

export const ORIGIN = 'http://localhost:3000';
export const TEST_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString('base64');
export const PASSWORD = 'correct horse battery staple';

/** DNS + HTTPS fakes with controllable answers. */
export class FakeNet implements DnsResolver, PinnedFetcher {
  txt = new Map<string, string[]>();
  addresses = new Map<string, string[]>();
  files = new Map<string, HttpsFetchResult>();
  fetchCalls: { hostname: string; pinned: string }[] = [];

  resolveTxt(name: string): Promise<string[]> {
    const r = this.txt.get(name);
    if (!r) return Promise.reject(Object.assign(new Error('nodata'), { code: 'ENODATA' }));
    return Promise.resolve(r);
  }
  resolveAddresses(name: string): Promise<string[]> {
    const r = this.addresses.get(name);
    if (!r) return Promise.reject(Object.assign(new Error('notfound'), { code: 'ENOTFOUND' }));
    return Promise.resolve(r);
  }
  get(hostname: string, _path: string, pinnedAddress: string): Promise<HttpsFetchResult> {
    this.fetchCalls.push({ hostname, pinned: pinnedAddress });
    const r = this.files.get(hostname);
    if (!r) return Promise.reject(new Error('connection refused'));
    return Promise.resolve(r);
  }
}

export class FakeQuick implements QuickChecks {
  used = new Set<string>();
  submitted: string[] = [];
  perIp = new Map<string, number>();
  limit = 5;
  busy = false;
  statuses = new Map<string, QuickStatus>();
  admit(ip: string): ReturnType<QuickChecks['admit']> {
    if (this.busy) return Promise.resolve({ ok: false, reason: 'busy' });
    const n = (this.perIp.get(ip) ?? 0) + 1;
    this.perIp.set(ip, n);
    return Promise.resolve(n > this.limit ? { ok: false, reason: 'ip_limit' } : { ok: true });
  }
  consumeChallenge(c: string): Promise<boolean> {
    if (this.used.has(c)) return Promise.resolve(false);
    this.used.add(c);
    return Promise.resolve(true);
  }
  submit(url: string): Promise<string> {
    this.submitted.push(url);
    const id = crypto.randomUUID();
    this.statuses.set(id, { state: 'pending' });
    return Promise.resolve(id);
  }
  status(id: string): Promise<QuickStatus> {
    return Promise.resolve(this.statuses.get(id) ?? { state: 'unknown' });
  }
}

export interface Harness {
  deps: Deps;
  quick: FakeQuick;
  app: FastifyInstance;
  handle: DbHandle;
  net: FakeNet;
  mails: { to: string; subject: string; text: string }[];
  queued: { orgId: string; scanId: string }[];
  clock: { now: Date };
  close: () => Promise<void>;
}

export async function makeHarness(databaseUrl: string): Promise<Harness> {
  const handle = createDb(databaseUrl, { max: 6 });
  const net = new FakeNet();
  const mails: Harness['mails'] = [];
  const mailer: Mailer = {
    send: (m) => {
      mails.push(m);
      return Promise.resolve();
    },
  };
  const queued: Harness['queued'] = [];
  const scanQueue: ScanQueue = {
    enqueue: (p) => {
      queued.push(p);
      return Promise.resolve();
    },
    ping: () => Promise.resolve(),
  };
  const quick = new FakeQuick();
  const clock = { now: new Date() };
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    WEB_ORIGIN: ORIGIN,
    SESSION_COOKIE_SECRET: 'test-only-secret-test-only-secret-0123456789',
    DOMAIN_REVALIDATE_DAYS: '30',
    QUICK_CHECK_POW_BITS: '8',
    CREDENTIAL_ENCRYPTION_KEY: TEST_CREDENTIAL_KEY,
  });
  const deps: Deps = {
    config,
    db: handle.db,
    // Cheap parameters keep the suite fast; production uses Argon2PasswordHasher.
    hasher: new ScryptPasswordHasher({ N: 1024, r: 8, p: 1 }),
    mailer,
    credentialKeys: new EnvKeyProvider('k1', TEST_CREDENTIAL_KEY),
    dns: net,
    fetcher: net,
    scanQueue,
    quick,
    now: () => new Date(clock.now),
  };
  const app = await buildApp(deps, { logLevel: 'silent' });
  await app.ready();
  return {
    deps,
    app,
    handle,
    net,
    mails,
    queued,
    quick,
    clock,
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

export interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

let ipCounter = 10;

/** A browser-like client: keeps cookies, echoes the CSRF token, uses its own source IP (rate limits). */
export class Client {
  private session: string | undefined;
  csrf: string | undefined;
  readonly ip = `10.${String(Math.floor(ipCounter / 250))}.${String(ipCounter++ % 250)}.7`;

  constructor(private readonly app: FastifyInstance) {}

  get sessionCookie(): string | undefined {
    return this.session;
  }

  async call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    opts: { origin?: string | null; csrf?: string | null } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = {};
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin) headers['origin'] = origin;
    const csrf = opts.csrf === undefined ? this.csrf : opts.csrf;
    if (csrf) headers['x-csrf-token'] = csrf;
    const cookies: Record<string, string> = {};
    if (this.session) cookies['aa_session'] = this.session;
    const res = await this.app.inject({
      method,
      url,
      headers,
      cookies,
      remoteAddress: this.ip,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    for (const c of res.cookies) {
      if (c.name === 'aa_session') this.session = c.value === '' ? undefined : c.value;
      if (c.name === 'aa_csrf') this.csrf = c.value === '' ? undefined : c.value;
    }
    const text = res.body;
    const isJson = (res.headers['content-type'] ?? '').includes('json');
    return {
      status: res.statusCode,
      body: text ? (isJson ? (JSON.parse(text) as unknown) : text) : undefined,
    };
  }

  /** Sets the session cookie directly (to replay a stolen/old cookie). */
  setSession(value: string | undefined): void {
    this.session = value;
  }
}

export async function registerUser(
  app: FastifyInstance,
  tag: string,
): Promise<{ c: Client; email: string; id: string }> {
  const c = new Client(app);
  const email = `${tag}-${Math.random().toString(36).slice(2, 10)}@example.test`;
  const r = await c.call('POST', '/auth/register', { email, password: PASSWORD, name: tag });
  if (r.status !== 201)
    throw new Error(`register failed: ${String(r.status)} ${JSON.stringify(r.body)}`);
  return { c, email, id: (r.body as { user: { id: string } }).user.id };
}

export async function createOrg(c: Client, slugTag: string): Promise<string> {
  const slug = `${slugTag}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await c.call('POST', '/orgs', { name: `Org ${slugTag}`, slug });
  if (r.status !== 201)
    throw new Error(`org failed: ${String(r.status)} ${JSON.stringify(r.body)}`);
  return (r.body as { organization: { id: string } }).organization.id;
}
