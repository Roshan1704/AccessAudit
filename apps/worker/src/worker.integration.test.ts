import { randomUUID } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { eq } from 'drizzle-orm';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchSafeBrowser, startEgressProxy, type EgressProxy } from '@accessaudit/crawler';
import { EnvKeyProvider, sealSecret } from '@accessaudit/security';
import {
  authProfiles,
  authorizedDomains,
  createDb,
  crawledPages,
  findingEvidence,
  findings,
  organizations,
  projects,
  scans,
  withTenant,
  type DbHandle,
} from '@accessaudit/db';
import { runQuick } from './run-quick.js';
import { runScan } from './run-scan.js';

const PUBLIC_IP = '93.184.216.34';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const BAD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bad</title></head>
<body><main><h1>Bad page</h1><img src="${PIXEL}" width="40" height="40"><input type="text" name="q"></main></body></html>`;
const GOOD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Good</title></head>
<body><main><h1>Good page</h1><img src="${PIXEL}" alt="A single pixel" width="40" height="40">
<label for="q">Search</label><input id="q" type="text" name="q"></main></body></html>`;

const ACCOUNT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Account</title></head>
<body><main id="account"><h1>Account</h1><a href="/logout">Sign out</a> <a href="/secret">Secret</a></main></body></html>`;
const LOGIN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Login</title></head>
<body><main><h1>Login</h1><form method="post" action="/login"><label for="user">User</label><input id="user" name="user">
<label for="pass">Password</label><input id="pass" name="pass" type="password"><button id="go" type="submit">Go</button></form></main></body></html>`;
const TEST_KEY = Buffer.alloc(32, 9).toString('base64');
const hits: string[] = [];

const dbUrl = process.env['TEST_DATABASE_URL'];
const workerUrl = process.env['TEST_WORKER_DATABASE_URL'];

describe('worker (real Chrome, safe browser layer)', () => {
  let server: http.Server;
  let proxy: EgressProxy;
  let browser: Browser;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const host = (req.headers.host ?? '').split(':')[0];
      const path = (req.url ?? '/').split('?')[0];
      if (path === '/robots.txt') {
        if (host === 'robots.example.com') {
          res.setHeader('content-type', 'text/plain');
          res.end('User-agent: *\nDisallow: /private');
          return;
        }
        res.statusCode = 404;
        res.end('none');
        return;
      }
      if (host === 'auth.example.com') {
        hits.push(`${req.method ?? ''} ${path}`);
        res.setHeader('content-type', 'text/html');
        if (path === '/login' && req.method === 'POST') {
          let body = '';
          req.on('data', (c: Buffer) => (body += c.toString()));
          req.on('end', () => {
            if (body.includes('pass=right-pass')) res.setHeader('set-cookie', 'sid=ok; Path=/');
            res.statusCode = 302;
            res.setHeader('location', '/account');
            res.end();
          });
          return;
        }
        if (path === '/login') {
          res.end(LOGIN);
          return;
        }
        if (!(req.headers.cookie ?? '').includes('sid=ok')) {
          res.statusCode = 403;
          res.end('denied');
          return;
        }
        res.end(ACCOUNT);
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(path === '/good' ? GOOD : BAD);
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as net.AddressInfo).port;
    proxy = await startEgressProxy({
      resolve: () => Promise.resolve([PUBLIC_IP]),
      dial: () => net.connect({ host: '127.0.0.1', port }),
    });
    browser = await launchSafeBrowser({ proxyUrl: proxy.url, channel: 'chrome' });
  }, 120_000);

  afterAll(async () => {
    server.closeAllConnections();
    await browser.close();
    await proxy.close();
    await new Promise<void>((ok) => {
      server.close(() => {
        ok();
      });
    });
  }, 60_000);

  describe('runQuick', () => {
    it('reports real findings for a defective page, without blobs or interaction tests', async () => {
      const r = await runQuick({ browser }, { url: 'http://fx.example.com/bad' });
      expect(r.status).toBe('done');
      if (r.status !== 'done') return;
      const ids = r.findings.map((f) => f.ruleId);
      expect(ids).toContain('axe:image-alt');
      expect(r.coverage.interaction).toBe(false);
      for (const f of r.findings) {
        expect(f.evidence.length).toBeGreaterThan(0);
        expect(JSON.stringify(f.evidence)).not.toContain('blobBase64');
      }
    }, 120_000);

    it('does not report confirmed violations on a clean page', async () => {
      const r = await runQuick({ browser }, { url: 'http://fx.example.com/good' });
      expect(r.status).toBe('done');
      if (r.status !== 'done') return;
      expect(
        r.findings.filter(
          (f) => f.classification === 'confirmed' || f.classification === 'strong_potential',
        ),
      ).toEqual([]);
    }, 120_000);

    it('blocks private targets even if the API check were bypassed', async () => {
      for (const url of [
        'http://127.0.0.1/',
        'http://169.254.169.254/latest',
        'file:///etc/passwd',
      ]) {
        const r = await runQuick({ browser }, { url });
        expect(r, url).toEqual({ status: 'blocked', reason: 'url_not_allowed' });
      }
    });

    it('honours robots.txt', async () => {
      const r = await runQuick({ browser }, { url: 'http://robots.example.com/private/page' });
      expect(r).toEqual({ status: 'blocked', reason: 'robots_disallowed' });
      const ok = await runQuick({ browser }, { url: 'http://robots.example.com/open' });
      expect(ok.status).toBe('done');
    }, 120_000);
  });

  const suite = dbUrl && workerUrl ? describe : describe.skip;
  suite('runScan (PostgreSQL)', () => {
    let handle: DbHandle; // aa_worker: what the worker really runs as
    let seedHandle: DbHandle; // aa_api: creates the tenant fixtures
    beforeAll(() => {
      handle = createDb(workerUrl as string, { max: 4 });
      seedHandle = createDb(dbUrl as string, { max: 2 });
    });
    afterAll(async () => {
      await handle.close();
      await seedHandle.close();
    });

    async function seed(
      host: string,
      startPath: string,
      verified = true,
      configSnapshot: Record<string, unknown> = {},
    ) {
      const orgId = randomUUID();
      const projectId = randomUUID();
      const scanId = randomUUID();
      await withTenant(seedHandle.db, { orgId }, async (tx) => {
        await tx
          .insert(organizations)
          .values({ id: orgId, name: 'Worker test', slug: `wk-${orgId.slice(0, 8)}` });
        await tx.insert(projects).values({
          id: projectId,
          organizationId: orgId,
          name: 'Site',
          baseUrl: `http://${host}`,
        });
        await tx.insert(authorizedDomains).values({
          organizationId: orgId,
          projectId,
          hostname: host,
          verificationMethod: 'dns_txt',
          status: verified ? 'verified' : 'pending',
          tokenHash: randomUUID(),
        });
        await tx.insert(scans).values({
          id: scanId,
          organizationId: orgId,
          projectId,
          startUrl: `http://${host}${startPath}`,
          maxPages: 1,
          interactionTests: false,
          configSnapshot,
        });
      });
      return { orgId, projectId, scanId };
    }

    it('scans a queued scan, stores findings with evidence, completes', async () => {
      const { orgId, scanId } = await seed('fx.example.com', '/bad');
      const out = await runScan({ db: handle.db, browser }, { orgId, scanId });
      expect(out).toMatchObject({ status: 'completed' });
      await withTenant(handle.db, { orgId }, async (tx) => {
        const [s] = await tx.select().from(scans).where(eq(scans.id, scanId));
        expect(s?.status).toBe('completed');
        expect(s?.engineVersions).toMatchObject({ engine: expect.any(String) as string });
        const pages = await tx.select().from(crawledPages).where(eq(crawledPages.scanId, scanId));
        expect(pages.filter((p) => p.status === 'scanned')).toHaveLength(1);
        const fs = await tx.select().from(findings).where(eq(findings.scanId, scanId));
        expect(fs.map((f) => f.ruleId)).toContain('axe:image-alt');
        for (const f of fs) {
          const ev = await tx
            .select()
            .from(findingEvidence)
            .where(eq(findingEvidence.findingId, f.id));
          expect(ev.length, f.ruleId).toBeGreaterThan(0);
        }
      });
    }, 180_000);

    it('a payload naming another tenant cannot run or read the scan', async () => {
      const a = await seed('fx.example.com', '/bad');
      const other = randomUUID();
      const out = await runScan({ db: handle.db, browser }, { orgId: other, scanId: a.scanId });
      expect(out).toEqual({ status: 'failed', reason: 'scan_not_runnable' });
      await withTenant(handle.db, { orgId: a.orgId }, async (tx) => {
        const [s] = await tx.select().from(scans).where(eq(scans.id, a.scanId));
        expect(s?.status).toBe('queued');
      });
    });

    it('fails the scan when the domain is not verified at run time', async () => {
      const { orgId, scanId } = await seed('fx.example.com', '/bad', false);
      const out = await runScan({ db: handle.db, browser }, { orgId, scanId });
      expect(out).toEqual({ status: 'failed', reason: 'domain_not_verified' });
      await withTenant(handle.db, { orgId }, async (tx) => {
        const fs = await tx.select().from(findings).where(eq(findings.scanId, scanId));
        expect(fs).toHaveLength(0);
      });
    });

    it('records a robots-excluded start page as skipped, not silently dropped', async () => {
      const { orgId, scanId } = await seed('robots.example.com', '/private/x');
      const out = await runScan({ db: handle.db, browser }, { orgId, scanId });
      expect(out).toMatchObject({ status: 'failed', reason: 'no_pages_scanned' });
      await withTenant(handle.db, { orgId }, async (tx) => {
        const pages = await tx.select().from(crawledPages).where(eq(crawledPages.scanId, scanId));
        expect(pages.some((p) => p.status === 'skipped')).toBe(true);
      });
    }, 120_000);

    const keys = () => new EnvKeyProvider('k1', TEST_KEY);

    async function addProfile(orgId: string, projectId: string, password: string) {
      const id = randomUUID();
      await withTenant(seedHandle.db, { orgId }, (tx) =>
        tx.insert(authProfiles).values({
          id,
          organizationId: orgId,
          projectId,
          name: 'Staff',
          loginUrl: 'http://auth.example.com/login',
          usernameSelector: '#user',
          passwordSelector: '#pass',
          submitSelector: '#go',
          successSelector: '#account',
          usernameEnc: sealSecret(keys(), 'bot', `${id}:username`),
          passwordEnc: sealSecret(keys(), password, `${id}:password`),
          keyId: 'k1',
        }),
      );
      return id;
    }

    it('scans a login-protected page after signing in, never following sign-out links', async () => {
      hits.length = 0;
      const s = await seed('auth.example.com', '/account');
      const profileId = await addProfile(s.orgId, s.projectId, 'right-pass');
      await withTenant(seedHandle.db, { orgId: s.orgId }, (tx) =>
        tx
          .update(scans)
          .set({ configSnapshot: { authProfileId: profileId }, maxPages: 3 })
          .where(eq(scans.id, s.scanId)),
      );
      const out = await runScan(
        { db: handle.db, browser, credentialKeys: keys() },
        { orgId: s.orgId, scanId: s.scanId },
      );
      expect(out).toMatchObject({ status: 'completed' });
      await withTenant(handle.db, { orgId: s.orgId }, async (tx) => {
        const pages = await tx.select().from(crawledPages).where(eq(crawledPages.scanId, s.scanId));
        expect(pages.filter((p) => p.status === 'scanned').length).toBeGreaterThan(0);
      });
      expect(hits).toContain('POST /login');
      expect(hits.some((h) => h.endsWith('/logout'))).toBe(false);
    }, 180_000);

    it('fails with a fixed reason and leaks no credentials when login is rejected', async () => {
      const s = await seed('auth.example.com', '/account');
      const profileId = await addProfile(s.orgId, s.projectId, 'wrong-pass');
      await withTenant(seedHandle.db, { orgId: s.orgId }, (tx) =>
        tx
          .update(scans)
          .set({ configSnapshot: { authProfileId: profileId } })
          .where(eq(scans.id, s.scanId)),
      );
      const out = await runScan(
        { db: handle.db, browser, credentialKeys: keys() },
        { orgId: s.orgId, scanId: s.scanId },
      );
      expect(out).toEqual({ status: 'failed', reason: 'auth_failed' });
      await withTenant(handle.db, { orgId: s.orgId }, async (tx) => {
        const [row] = await tx.select().from(scans).where(eq(scans.id, s.scanId));
        expect(row?.status).toBe('failed');
        expect(JSON.stringify(row)).not.toContain('wrong-pass');
      });
    }, 180_000);

    it('does not run a scan twice', async () => {
      const { orgId, scanId } = await seed('fx.example.com', '/good');
      expect((await runScan({ db: handle.db, browser }, { orgId, scanId })).status).toBe(
        'completed',
      );
      expect(await runScan({ db: handle.db, browser }, { orgId, scanId })).toEqual({
        status: 'failed',
        reason: 'scan_not_runnable',
      });
    }, 180_000);
  });
});
