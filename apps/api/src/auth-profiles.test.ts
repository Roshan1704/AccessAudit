import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenant } from '@accessaudit/db';
import { createOrg, makeHarness, registerUser, type Harness } from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('login profiles for authenticated scans (integration)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(url as string);
  });
  afterAll(async () => {
    await h.close();
  });

  async function setup(tag: string, verify = true) {
    const u = await registerUser(h.app, tag);
    const orgId = await createOrg(u.c, tag);
    const host = `${tag}-${Math.random().toString(36).slice(2, 8)}.example.com`;
    const p = await u.c.call('POST', `/orgs/${orgId}/projects`, {
      name: 'Site',
      baseUrl: `https://${host}`,
    });
    const projectId = p.body.project.id as string;
    const base = `/orgs/${orgId}/projects/${projectId}/domains`;
    const d = await u.c.call('POST', base, { hostname: host, method: 'dns_txt' });
    if (verify) {
      h.net.txt.set(`_accessaudit-challenge.${host}`, [d.body.verification.recordValue as string]);
      await u.c.call('POST', `${base}/${d.body.domain.id as string}/verify`);
    }
    const body = (name = 'Staff') => ({
      projectId,
      name,
      loginUrl: `https://${host}/login`,
      usernameSelector: '#user',
      passwordSelector: '#pass',
      submitSelector: '#go',
      successSelector: '#account',
      username: 'audit-bot@example.com',
      password: 'S3cret-Passw0rd!',
    });
    return { u, orgId, projectId, host, body };
  }

  it('stores credentials encrypted and never returns or audits them', async () => {
    const { u, orgId, body } = await setup('ap-secret');
    const r = await u.c.call('POST', `/orgs/${orgId}/auth-profiles`, body());
    expect(r.status).toBe(201);
    const list = await u.c.call('GET', `/orgs/${orgId}/auth-profiles`);
    for (const text of [JSON.stringify(r.body), JSON.stringify(list.body)]) {
      expect(text).not.toContain('S3cret');
      expect(text).not.toContain('audit-bot@');
      expect(text).not.toMatch(/passwordEnc|usernameEnc|password_enc/);
    }
    const raw = await withTenant(h.handle.db, { orgId }, (tx) =>
      tx.execute(sql`select username_enc, password_enc from auth_profiles`),
    );
    const row = raw.rows[0] as { username_enc: string; password_enc: string };
    expect(row.password_enc).toMatch(/^v1\.k1\./);
    expect(row.password_enc).not.toContain('S3cret');
    const audit = await withTenant(h.handle.db, { orgId }, (tx) =>
      tx.execute(sql`select metadata from audit_logs where action like 'auth_profile.%'`),
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows)).not.toContain('S3cret');
    expect(JSON.stringify(audit.rows)).not.toContain('audit-bot@');
  });

  it('rejects an unverified domain and a login URL on another host', async () => {
    const un = await setup('ap-unver', false);
    const r1 = await un.u.c.call('POST', `/orgs/${un.orgId}/auth-profiles`, un.body());
    expect(r1.status).toBe(409);
    const ok = await setup('ap-host');
    const r2 = await ok.u.c.call('POST', `/orgs/${ok.orgId}/auth-profiles`, {
      ...ok.body(),
      loginUrl: 'https://other.example.org/login',
    });
    expect(r2.status).toBe(409);
  });

  it('is isolated between organizations', async () => {
    const a = await setup('ap-iso-a');
    const b = await setup('ap-iso-b');
    const r = await a.u.c.call('POST', `/orgs/${a.orgId}/auth-profiles`, a.body());
    const id = r.body.authProfile.id as string;
    expect(
      (await b.u.c.call('GET', `/orgs/${a.orgId}/auth-profiles`)).status,
    ).toBeGreaterThanOrEqual(403);
    expect(
      (await b.u.c.call('DELETE', `/orgs/${a.orgId}/auth-profiles/${id}`)).status,
    ).toBeGreaterThanOrEqual(403);
    expect((await b.u.c.call('GET', `/orgs/${b.orgId}/auth-profiles`)).body.authProfiles).toEqual(
      [],
    );
  });

  it('a scan may only use a profile of its own project; delete works', async () => {
    const a = await setup('ap-scan-a');
    const b = await setup('ap-scan-b');
    const pa = await a.u.c.call('POST', `/orgs/${a.orgId}/auth-profiles`, a.body());
    const pb = await b.u.c.call('POST', `/orgs/${b.orgId}/auth-profiles`, b.body());
    const bad = await a.u.c.call('POST', `/orgs/${a.orgId}/scans`, {
      projectId: a.projectId,
      authProfileId: pb.body.authProfile.id,
    });
    expect(bad.status).toBe(400);
    const good = await a.u.c.call('POST', `/orgs/${a.orgId}/scans`, {
      projectId: a.projectId,
      authProfileId: pa.body.authProfile.id,
    });
    expect(good.status).toBeLessThan(300);
    const del = await a.u.c.call(
      'DELETE',
      `/orgs/${a.orgId}/auth-profiles/${pa.body.authProfile.id as string}`,
    );
    expect(del.status).toBe(204);
  });
});
