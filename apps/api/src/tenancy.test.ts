import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createOrg,
  makeHarness,
  PASSWORD,
  registerUser,
  type Harness,
} from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('orgs, members, projects, tenant isolation (integration)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(url as string);
  });
  afterAll(async () => {
    await h.close();
  });

  /** Invites `email` into `orgId` and has them accept. Returns their client. */
  async function addMember(
    owner: Client,
    orgId: string,
    role: 'admin' | 'member' | 'viewer',
    tag: string,
  ) {
    const u = await registerUser(h.app, tag);
    const inv = await owner.call('POST', `/orgs/${orgId}/invitations`, { email: u.email, role });
    expect(inv.status).toBe(201);
    const token = /token=([\w.-]+)/.exec(h.mails[h.mails.length - 1]?.text ?? '')?.[1] ?? '';
    const acc = await u.c.call('POST', '/invitations/accept', { token });
    expect(acc.status).toBe(200);
    return u;
  }

  it('creates an org with the creator as owner, listed and fetchable', async () => {
    const u = await registerUser(h.app, 'org');
    const orgId = await createOrg(u.c, 'acme');
    const list = await u.c.call('GET', '/orgs');
    expect(list.body.organizations).toHaveLength(1);
    expect(list.body.organizations[0]).toMatchObject({ id: orgId, role: 'owner' });
    expect((await u.c.call('GET', `/orgs/${orgId}`)).body.organization.role).toBe('owner');
    const me = await u.c.call('GET', '/auth/me');
    expect(me.body.organizations).toHaveLength(1);
  });

  it('duplicate org slug conflicts; invalid slug is rejected', async () => {
    const u = await registerUser(h.app, 'slug');
    const slug = `slug-${Math.random().toString(36).slice(2, 8)}`;
    expect((await u.c.call('POST', '/orgs', { name: 'One', slug })).status).toBe(201);
    const dup = await u.c.call('POST', '/orgs', { name: 'Two', slug });
    expect(dup.status).toBe(409);
    expect((await u.c.call('POST', '/orgs', { name: 'Bad', slug: 'Bad Slug!' })).status).toBe(400);
  });

  it('project CRUD persists; duplicate name conflicts; private URLs rejected', async () => {
    const u = await registerUser(h.app, 'proj');
    const orgId = await createOrg(u.c, 'proj');
    const base = `/orgs/${orgId}/projects`;
    const created = await u.c.call('POST', base, {
      name: 'Marketing site',
      baseUrl: 'https://example.com/some/path?x=1',
    });
    expect(created.status).toBe(201);
    expect(created.body.project.baseUrl).toBe('https://example.com');
    const pid = created.body.project.id as string;

    expect(
      (await u.c.call('POST', base, { name: 'Marketing site', baseUrl: 'https://example.org' }))
        .status,
    ).toBe(409);
    for (const bad of [
      'http://localhost:3000',
      'https://127.0.0.1',
      'https://10.0.0.5',
      'https://169.254.169.254',
      'ftp://example.com',
      'https://user:pw@example.com',
    ]) {
      const r = await u.c.call('POST', base, { name: `bad-${bad}`.slice(0, 50), baseUrl: bad });
      expect([400, 422]).toContain(r.status);
      expect(['URL_NOT_ALLOWED', 'VALIDATION_FAILED']).toContain(r.body.error.code);
    }

    expect((await u.c.call('GET', base)).body.projects).toHaveLength(1);
    expect((await u.c.call('GET', `${base}/${pid}`)).body.project.name).toBe('Marketing site');
    const renamed = await u.c.call('PATCH', `${base}/${pid}`, { name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.project.name).toBe('Renamed');
    expect((await u.c.call('DELETE', `${base}/${pid}`)).status).toBe(204);
    expect((await u.c.call('GET', `${base}/${pid}`)).status).toBe(404);
    expect((await u.c.call('GET', base)).body.projects).toHaveLength(0);
  });

  it('CROSS-TENANT: org A user cannot see or touch org B (all 404)', async () => {
    const a = await registerUser(h.app, 'tenA');
    const b = await registerUser(h.app, 'tenB');
    const orgA = await createOrg(a.c, 'ta');
    const orgB = await createOrg(b.c, 'tb');
    const pB = (
      await b.c.call('POST', `/orgs/${orgB}/projects`, {
        name: 'B site',
        baseUrl: 'https://b.example.com',
      })
    ).body.project.id as string;
    const dB = (
      await b.c.call('POST', `/orgs/${orgB}/projects/${pB}/domains`, {
        hostname: 'b.example.com',
        method: 'dns_txt',
      })
    ).body.domain.id as string;

    const probes: [Parameters<Client['call']>[0], string, unknown?][] = [
      ['GET', `/orgs/${orgB}`],
      ['PATCH', `/orgs/${orgB}`, { name: 'Pwned' }],
      ['GET', `/orgs/${orgB}/members`],
      ['PATCH', `/orgs/${orgB}/members/${b.id}`, { role: 'viewer' }],
      ['DELETE', `/orgs/${orgB}/members/${b.id}`],
      ['GET', `/orgs/${orgB}/invitations`],
      ['POST', `/orgs/${orgB}/invitations`, { email: 'x@example.test', role: 'admin' }],
      ['GET', `/orgs/${orgB}/projects`],
      ['POST', `/orgs/${orgB}/projects`, { name: 'Injected', baseUrl: 'https://example.com' }],
      ['GET', `/orgs/${orgB}/projects/${pB}`],
      ['PATCH', `/orgs/${orgB}/projects/${pB}`, { name: 'Pwned' }],
      ['DELETE', `/orgs/${orgB}/projects/${pB}`],
      ['GET', `/orgs/${orgB}/projects/${pB}/domains`],
      [
        'POST',
        `/orgs/${orgB}/projects/${pB}/domains`,
        { hostname: 'evil.example.com', method: 'dns_txt' },
      ],
      ['POST', `/orgs/${orgB}/projects/${pB}/domains/${dB}/verify`],
      ['DELETE', `/orgs/${orgB}/projects/${pB}/domains/${dB}`],
    ];
    for (const [method, path, body] of probes) {
      const r = await a.c.call(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    // B's project id through A's own org is also 404
    expect((await a.c.call('GET', `/orgs/${orgA}/projects/${pB}`)).status).toBe(404);
    expect((await a.c.call('PATCH', `/orgs/${orgA}/projects/${pB}`, { name: 'x' })).status).toBe(
      404,
    );
    expect((await a.c.call('GET', `/orgs/${orgA}/projects/${pB}/domains`)).status).toBe(404);
    // malformed ids are the same 404
    expect((await a.c.call('GET', '/orgs/not-a-uuid')).status).toBe(404);
    expect((await a.c.call('GET', `/orgs/${randomUUID()}`)).status).toBe(404);

    // B's data is intact
    expect((await b.c.call('GET', `/orgs/${orgB}`)).body.organization.name).toBe('Org tb');
    expect((await b.c.call('GET', `/orgs/${orgB}/projects/${pB}`)).body.project.name).toBe(
      'B site',
    );
    expect((await b.c.call('GET', `/orgs/${orgB}/members`)).body.members).toHaveLength(1);
    // A sees only its own org
    expect(
      (await a.c.call('GET', '/orgs')).body.organizations.map((o: { id: string }) => o.id),
    ).toEqual([orgA]);
  });

  it('RBAC matrix: viewer / member / admin / owner', async () => {
    const owner = await registerUser(h.app, 'rbac-owner');
    const orgId = await createOrg(owner.c, 'rbac');
    const admin = await addMember(owner.c, orgId, 'admin', 'rbac-admin');
    const member = await addMember(owner.c, orgId, 'member', 'rbac-member');
    const viewer = await addMember(owner.c, orgId, 'viewer', 'rbac-viewer');
    const base = `/orgs/${orgId}`;

    // everyone can read
    for (const u of [owner, admin, member, viewer]) {
      expect((await u.c.call('GET', base)).status).toBe(200);
      expect((await u.c.call('GET', `${base}/projects`)).status).toBe(200);
      expect((await u.c.call('GET', `${base}/members`)).status).toBe(200);
    }
    // project create: member and up
    expect(
      (
        await viewer.c.call('POST', `${base}/projects`, {
          name: 'v',
          baseUrl: 'https://example.com',
        })
      ).status,
    ).toBe(403);
    const pm = await member.c.call('POST', `${base}/projects`, {
      name: 'by member',
      baseUrl: 'https://example.com',
    });
    expect(pm.status).toBe(201);
    const pid = pm.body.project.id as string;
    // project delete / rename: admin and up
    expect((await member.c.call('PATCH', `${base}/projects/${pid}`, { name: 'm' })).status).toBe(
      403,
    );
    expect((await member.c.call('DELETE', `${base}/projects/${pid}`)).status).toBe(403);
    // org rename + invitations: admin and up
    expect((await member.c.call('PATCH', base, { name: 'Nope' })).status).toBe(403);
    expect((await viewer.c.call('GET', `${base}/invitations`)).status).toBe(403);
    expect(
      (
        await member.c.call('POST', `${base}/invitations`, {
          email: 'z@example.test',
          role: 'viewer',
        })
      ).status,
    ).toBe(403);
    expect((await admin.c.call('PATCH', base, { name: 'Admin Renamed' })).status).toBe(200);
    // domains: admin to add, viewer to list
    expect(
      (
        await member.c.call('POST', `${base}/projects/${pid}/domains`, {
          hostname: 'example.com',
          method: 'dns_txt',
        })
      ).status,
    ).toBe(403);
    expect((await viewer.c.call('GET', `${base}/projects/${pid}/domains`)).status).toBe(200);
    expect(
      (
        await admin.c.call('POST', `${base}/projects/${pid}/domains`, {
          hostname: 'example.com',
          method: 'dns_txt',
        })
      ).status,
    ).toBe(201);

    // role changes: non-admins refused; admins cannot touch owners or grant owner
    expect(
      (await member.c.call('PATCH', `${base}/members/${viewer.id}`, { role: 'admin' })).status,
    ).toBe(403);
    expect(
      (await admin.c.call('PATCH', `${base}/members/${owner.id}`, { role: 'viewer' })).status,
    ).toBe(403);
    expect(
      (await admin.c.call('PATCH', `${base}/members/${member.id}`, { role: 'owner' })).status,
    ).toBe(403);
    expect((await admin.c.call('DELETE', `${base}/members/${owner.id}`)).status).toBe(403);
    expect(
      (await admin.c.call('PATCH', `${base}/members/${member.id}`, { role: 'viewer' })).status,
    ).toBe(200);
    // member may leave; cannot remove others
    expect((await viewer.c.call('DELETE', `${base}/members/${admin.id}`)).status).toBe(403);
    expect((await viewer.c.call('DELETE', `${base}/members/${viewer.id}`)).status).toBe(204);
    expect((await viewer.c.call('GET', base)).status).toBe(404);
  });

  it('last owner cannot be demoted, removed or leave; a second owner unlocks it', async () => {
    const owner = await registerUser(h.app, 'last-owner');
    const orgId = await createOrg(owner.c, 'lo');
    const base = `/orgs/${orgId}`;
    const demote = await owner.c.call('PATCH', `${base}/members/${owner.id}`, { role: 'admin' });
    expect(demote.status).toBe(409);
    const leave = await owner.c.call('DELETE', `${base}/members/${owner.id}`);
    expect(leave.status).toBe(409);
    expect((await owner.c.call('GET', base)).body.organization.role).toBe('owner');

    const second = await addMember(owner.c, orgId, 'member', 'second-owner');
    expect(
      (await owner.c.call('PATCH', `${base}/members/${second.id}`, { role: 'owner' })).status,
    ).toBe(200);
    expect(
      (await owner.c.call('PATCH', `${base}/members/${owner.id}`, { role: 'admin' })).status,
    ).toBe(200);
  });

  it('invitations: wrong recipient, reuse, expiry and garbage tokens all fail identically', async () => {
    const owner = await registerUser(h.app, 'inv-owner');
    const orgId = await createOrg(owner.c, 'inv');
    const invited = await registerUser(h.app, 'inv-target');
    const other = await registerUser(h.app, 'inv-other');
    await owner.c.call('POST', `/orgs/${orgId}/invitations`, {
      email: invited.email,
      role: 'member',
    });
    const token = /token=([\w.-]+)/.exec(h.mails[h.mails.length - 1]?.text ?? '')?.[1] ?? '';

    const wrong = await other.c.call('POST', '/invitations/accept', { token });
    expect(wrong.status).toBe(404);
    expect((await other.c.call('GET', `/orgs/${orgId}`)).status).toBe(404);
    const garbage = await other.c.call('POST', '/invitations/accept', {
      token: `${orgId}.${'z'.repeat(40)}`,
    });
    expect(garbage.status).toBe(404);
    expect(garbage.body.error.message).toBe(wrong.body.error.message);

    expect((await invited.c.call('POST', '/invitations/accept', { token })).status).toBe(200);
    expect((await invited.c.call('POST', '/invitations/accept', { token })).status).toBe(404);

    await owner.c.call('POST', `/orgs/${orgId}/invitations`, {
      email: other.email,
      role: 'viewer',
    });
    const t2 = /token=([\w.-]+)/.exec(h.mails[h.mails.length - 1]?.text ?? '')?.[1] ?? '';
    h.clock.now = new Date(Date.now() + 8 * 24 * 3600 * 1000);
    try {
      // session also lapses by then; log in fresh at the shifted time
      const fresh = new Client(h.app);
      expect(
        (await fresh.call('POST', '/auth/login', { email: other.email, password: PASSWORD }))
          .status,
      ).toBe(200);
      expect((await fresh.call('POST', '/invitations/accept', { token: t2 })).status).toBe(404);
    } finally {
      h.clock.now = new Date();
    }
  });

  it('writes audit entries without secrets', async () => {
    const u = await registerUser(h.app, 'audit');
    const orgId = await createOrg(u.c, 'audit');
    const p = await u.c.call('POST', `/orgs/${orgId}/projects`, {
      name: 'A',
      baseUrl: 'https://example.com',
    });
    await u.c.call('POST', `/orgs/${orgId}/projects/${p.body.project.id}/domains`, {
      hostname: 'example.com',
      method: 'well_known',
    });
    const { sql } = await import('drizzle-orm');
    const { withTenant } = await import('@accessaudit/db');
    const rows = await withTenant(h.handle.db, { orgId, userId: u.id }, (tx) =>
      tx.execute(
        sql`select action, metadata from audit_logs where organization_id = ${orgId} order by created_at`,
      ),
    );
    const actions = rows.rows.map((r) => (r as { action: string }).action);
    expect(actions).toEqual(
      expect.arrayContaining(['org.created', 'project.created', 'domain.added']),
    );
    expect(JSON.stringify(rows.rows)).not.toMatch(/token|hash|password/i);
  });
});
