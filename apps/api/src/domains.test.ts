import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@accessaudit/db';
import { requireVerifiedHostname } from './routes/domains.js';
import { createOrg, makeHarness, registerUser, type Client, type Harness } from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('domain verification (integration, controlled DNS/HTTP)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(url as string);
  });
  afterAll(async () => {
    await h.close();
  });

  async function setup(tag: string) {
    const u = await registerUser(h.app, tag);
    const orgId = await createOrg(u.c, tag);
    const p = await u.c.call('POST', `/orgs/${orgId}/projects`, {
      name: 'Site',
      baseUrl: 'https://example.com',
    });
    const pid = p.body.project.id as string;
    return { u, orgId, pid, base: `/orgs/${orgId}/projects/${pid}/domains` };
  }
  async function add(
    c: Client,
    base: string,
    hostname: string,
    method: 'dns_txt' | 'well_known' | 'meta_tag',
  ) {
    const r = await c.call('POST', base, { hostname, method });
    expect(r.status).toBe(201);
    return { id: r.body.domain.id as string, v: r.body.verification as Record<string, string> };
  }
  const uniq = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}.example.com`;

  it('add returns instructions once, stores only a hash, starts pending', async () => {
    const { u, base, orgId } = await setup('dom-add');
    const host = uniq('add');
    const { v } = await add(u.c, base, host, 'dns_txt');
    expect(v).toMatchObject({ type: 'dns_txt', recordName: `_accessaudit-challenge.${host}` });
    expect(v['recordValue']).toMatch(/^accessaudit-verification=.{20,}/);
    const list = await u.c.call('GET', base);
    expect(list.body.domains[0].status).toBe('pending');
    expect(JSON.stringify(list.body)).not.toContain(
      v['recordValue']?.split('=')[1] ?? 'unreachable',
    );
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|token_hash/);
    const { sql } = await import('drizzle-orm');
    const raw = await withTenant(h.handle.db, { orgId }, (tx) =>
      tx.execute(sql`select token_hash from authorized_domains`),
    );
    expect((raw.rows[0] as { token_hash: string }).token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects unsafe or malformed hostnames (never trusts user claims)', async () => {
    const { u, base } = await setup('dom-bad');
    for (const hostname of [
      'localhost',
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '[::1]',
      'http://example.com',
      'example.com/path',
      'example.com:8443',
      '*.example.com',
      'user@example.com',
      'intranet',
      'foo.internal',
      'foo.local',
    ]) {
      const r = await u.c.call('POST', base, { hostname, method: 'dns_txt' });
      // 400 = schema rejection, 422 = URL_NOT_ALLOWED policy rejection; never 2xx.
      expect([400, 422], hostname).toContain(r.status);
    }
  });

  it('duplicate hostname in a project conflicts', async () => {
    const { u, base } = await setup('dom-dup');
    const host = uniq('dup');
    await add(u.c, base, host, 'dns_txt');
    expect(
      (await u.c.call('POST', base, { hostname: host.toUpperCase(), method: 'well_known' })).status,
    ).toBe(409);
  });

  it('DNS TXT: pending -> failed on missing/wrong record -> verified on correct record', async () => {
    const { u, base } = await setup('dom-dns');
    const host = uniq('dns');
    const { id, v } = await add(u.c, base, host, 'dns_txt');
    const verify = () => u.c.call('POST', `${base}/${id}/verify`);

    let r = await verify();
    expect(r.status).toBe(200);
    expect(r.body.domain).toMatchObject({
      status: 'failed',
      lastFailureReason: 'txt_record_not_found',
    });

    h.net.txt.set(`_accessaudit-challenge.${host}`, [
      'accessaudit-verification=wrong-token-value-xxxxxxxx',
    ]);
    r = await verify();
    expect(r.body.domain).toMatchObject({
      status: 'failed',
      lastFailureReason: 'txt_record_mismatch',
    });
    expect(r.body.domain.verifiedAt).toBeNull();

    h.net.txt.set(`_accessaudit-challenge.${host}`, ['unrelated', v['recordValue'] ?? '']);
    r = await verify();
    expect(r.body.domain.status).toBe('verified');
    expect(r.body.domain.method).toBe('dns_txt');
    expect(r.body.domain.verifiedAt).toBeTruthy();
    expect(r.body.domain.failedChecks).toBe(0);
    const next =
      new Date(r.body.domain.nextRevalidateAt as string).getTime() -
      new Date(r.body.domain.verifiedAt as string).getTime();
    expect(Math.round(next / 86400000)).toBe(30);
  });

  it('well-known: verifies when file body equals token, pins to a public address, no redirects', async () => {
    const { u, base } = await setup('dom-wk');
    const host = uniq('wk');
    const { id, v } = await add(u.c, base, host, 'well_known');
    expect(v).toMatchObject({
      type: 'well_known',
      url: `https://${host}/.well-known/accessaudit-verification.txt`,
    });
    const verify = () => u.c.call('POST', `${base}/${id}/verify`);

    // host does not resolve
    expect((await verify()).body.domain).toMatchObject({
      status: 'failed',
      lastFailureReason: 'host_not_found',
    });

    // resolves to private address -> refused, no fetch made
    h.net.addresses.set(host, ['10.1.2.3']);
    h.net.files.set(host, { status: 200, body: v['fileContent'] ?? '', truncated: false });
    const callsBefore = h.net.fetchCalls.length;
    expect((await verify()).body.domain).toMatchObject({
      status: 'failed',
      lastFailureReason: 'resolves_to_non_public_address',
    });
    expect(h.net.fetchCalls.length).toBe(callsBefore);

    // mixed public + private answers -> refused (rebinding defence)
    h.net.addresses.set(host, ['93.184.216.34', '127.0.0.1']);
    expect((await verify()).body.domain.lastFailureReason).toBe('resolves_to_non_public_address');
    expect(h.net.fetchCalls.length).toBe(callsBefore);

    // redirect / non-200 -> refused
    h.net.addresses.set(host, ['93.184.216.34']);
    h.net.files.set(host, { status: 302, body: v['fileContent'] ?? '', truncated: false });
    expect((await verify()).body.domain.lastFailureReason).toBe('http_302');

    // wrong body
    h.net.files.set(host, { status: 200, body: 'not-the-token', truncated: false });
    expect((await verify()).body.domain.lastFailureReason).toBe('file_content_mismatch');

    // correct (trailing newline tolerated); connection pinned to the validated address
    // oversize body -> refused even when the retained prefix is the token
    h.net.files.set(host, { status: 200, body: v['fileContent'] ?? '', truncated: true });
    expect((await verify()).body.domain.lastFailureReason).toBe('file_too_large');

    h.net.files.set(host, {
      status: 200,
      body: `${v['fileContent'] ?? ''}\n`,
      truncated: false,
    });
    const ok = await verify();
    expect(ok.body.domain.status).toBe('verified');
    expect(h.net.fetchCalls.at(-1)).toEqual({ hostname: host, pinned: '93.184.216.34' });
  });

  it('meta tag: verifies when the home page head carries the token', async () => {
    const { u, base } = await setup('dom-meta');
    const host = uniq('meta');
    const { id, v } = await add(u.c, base, host, 'meta_tag');
    expect(v).toMatchObject({ type: 'meta_tag', url: `https://${host}/` });
    expect(v['tag']).toMatch(/^<meta name="accessaudit-verification" content=".{20,}">$/);
    const token = /content="([^"]+)"/.exec(v['tag'] ?? '')?.[1] ?? '';
    const verify = () => u.c.call('POST', `${base}/${id}/verify`);
    h.net.addresses.set(host, ['93.184.216.34']);
    const page = (head: string, truncated = false) => ({
      status: 200,
      body: `<html><head>${head}</head><body>hi</body></html>`,
      truncated,
    });

    h.net.files.set(host, page('<title>x</title>'));
    expect((await verify()).body.domain.lastFailureReason).toBe('meta_tag_not_found');

    h.net.files.set(host, page('<meta name="accessaudit-verification" content="wrong-value">'));
    expect((await verify()).body.domain.lastFailureReason).toBe('meta_tag_mismatch');

    h.net.files.set(host, { status: 404, body: '', truncated: false });
    expect((await verify()).body.domain.lastFailureReason).toBe('http_404');

    // single quotes, reversed attribute order and upper-case name are accepted
    h.net.files.set(host, page(`<META CONTENT='${token}' NAME='Accessaudit-Verification'>`));
    const ok = await verify();
    expect(ok.body.domain.status).toBe('verified');
    expect(ok.body.domain.method).toBe('meta_tag');
    expect(h.net.fetchCalls.at(-1)).toEqual({ hostname: host, pinned: '93.184.216.34' });
  });

  it('revalidation: expires when proof is removed; recovers when restored; transient errors keep status', async () => {
    const { u, base } = await setup('dom-reval');
    const host = uniq('reval');
    const { id, v } = await add(u.c, base, host, 'dns_txt');
    const name = `_accessaudit-challenge.${host}`;
    h.net.txt.set(name, [v['recordValue'] ?? '']);
    expect((await u.c.call('POST', `${base}/${id}/verify`)).body.domain.status).toBe('verified');

    // transient DNS failure: status unchanged, counter bumps
    const orig = h.net.resolveTxt.bind(h.net);
    h.net.resolveTxt = () =>
      Promise.reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }));
    let r = await u.c.call('POST', `${base}/${id}/revalidate`);
    expect(r.body.domain).toMatchObject({
      status: 'verified',
      failedChecks: 1,
      lastFailureReason: 'dns_lookup_error',
    });
    h.net.resolveTxt = orig;

    // proof removed: verified -> expired
    h.net.txt.delete(name);
    r = await u.c.call('POST', `${base}/${id}/revalidate`);
    expect(r.body.domain.status).toBe('expired');
    expect(r.body.domain.lastFailureReason).toBe('txt_record_not_found');

    // proof restored: expired -> verified, counters reset
    h.net.txt.set(name, [v['recordValue'] ?? '']);
    r = await u.c.call('POST', `${base}/${id}/revalidate`);
    expect(r.body.domain).toMatchObject({
      status: 'verified',
      failedChecks: 0,
      lastFailureReason: null,
    });
  });

  it('requireVerifiedHostname: exact match only, honours revalidation due date', async () => {
    const { u, orgId, pid, base } = await setup('dom-gate');
    const host = uniq('gate');
    const { id, v } = await add(u.c, base, host, 'dns_txt');
    const name = `_accessaudit-challenge.${host}`;
    const gate = (hostname: string) =>
      withTenant(h.handle.db, { orgId, userId: u.id }, (tx) =>
        requireVerifiedHostname(
          {
            config: { DOMAIN_REVALIDATE_DAYS: 30 },
            db: h.handle.db,
            dns: h.net,
            fetcher: h.net,
            now: () => new Date(h.clock.now),
          } as never,
          tx,
          orgId,
          pid,
          hostname,
        ),
      );

    await expect(gate(host)).rejects.toMatchObject({ code: 'DOMAIN_NOT_VERIFIED' }); // pending
    h.net.txt.set(name, [v['recordValue'] ?? '']);
    await u.c.call('POST', `${base}/${id}/verify`);
    await expect(gate(host)).resolves.toMatchObject({ status: 'verified' });
    // subdomain / sibling / apex are NOT covered
    await expect(gate(`sub.${host}`)).rejects.toMatchObject({ code: 'DOMAIN_NOT_VERIFIED' });
    await expect(gate('example.com')).rejects.toMatchObject({ code: 'DOMAIN_NOT_VERIFIED' });

    // past the due date with the proof removed -> re-check fails the gate
    h.net.txt.delete(name);
    h.clock.now = new Date(Date.now() + 31 * 86400000);
    try {
      await expect(gate(host)).rejects.toMatchObject({ code: 'DOMAIN_NOT_VERIFIED' });
    } finally {
      h.clock.now = new Date();
    }
    expect((await u.c.call('GET', base)).body.domains[0].status).toBe('expired');
  });

  it('a token from one tenant cannot verify the same hostname in another tenant', async () => {
    const a = await setup('dom-ta');
    const b = await setup('dom-tb');
    const host = uniq('shared');
    const da = await add(a.u.c, a.base, host, 'dns_txt');
    const db = await add(b.u.c, b.base, host, 'dns_txt');
    expect(da.v['recordValue']).not.toBe(db.v['recordValue']);
    // only A's token is published
    h.net.txt.set(`_accessaudit-challenge.${host}`, [da.v['recordValue'] ?? '']);
    expect((await a.u.c.call('POST', `${a.base}/${da.id}/verify`)).body.domain.status).toBe(
      'verified',
    );
    expect((await b.u.c.call('POST', `${b.base}/${db.id}/verify`)).body.domain.status).toBe(
      'failed',
    );
  });

  it('delete removes the domain', async () => {
    const { u, base } = await setup('dom-del');
    const { id } = await add(u.c, base, uniq('del'), 'dns_txt');
    expect((await u.c.call('DELETE', `${base}/${id}`)).status).toBe(204);
    expect((await u.c.call('GET', base)).body.domains).toHaveLength(0);
    expect((await u.c.call('POST', `${base}/${id}/verify`)).status).toBe(404);
  });
});
