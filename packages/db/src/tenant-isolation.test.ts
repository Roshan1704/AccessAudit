import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withTenant, type DbHandle } from './client.js';
import {
  auditLogs,
  authorizedDomains,
  organizationMembers,
  organizations,
  projects,
  users,
} from './schema.js';

// Integration tests: connect as the least-privilege aa_api role (never a superuser).
const url = process.env['TEST_DATABASE_URL'];
function hasCause(re: RegExp) {
  return (e: unknown): boolean => {
    for (let x: unknown = e; x instanceof Error; x = x.cause) if (re.test(x.message)) return true;
    return false;
  };
}
const suite = url ? describe : describe.skip;

suite('tenant isolation (aa_api, RLS)', () => {
  let h: DbHandle;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projA = randomUUID();
  const projB = randomUUID();
  const run = randomUUID().slice(0, 8);

  beforeAll(async () => {
    h = createDb(url as string, { max: 4 });
    const who = await h.db.execute(sql`select current_user as u, rolbypassrls as b, rolsuper as s
      from pg_roles where rolname = current_user`);
    expect(who.rows[0]).toMatchObject({ u: 'aa_api', b: false, s: false });

    await h.db.insert(users).values([
      { id: userA, email: `a-${run}@example.test`, name: 'A', passwordHash: 'x' },
      { id: userB, email: `b-${run}@example.test`, name: 'B', passwordHash: 'x' },
    ]);
    for (const [org, user, proj, slug] of [
      [orgA, userA, projA, `org-a-${run}`],
      [orgB, userB, projB, `org-b-${run}`],
    ] as const) {
      await withTenant(h.db, { orgId: org, userId: user }, async (tx) => {
        await tx.insert(organizations).values({ id: org, slug, name: slug });
        await tx
          .insert(organizationMembers)
          .values({ organizationId: org, userId: user, role: 'owner' });
        await tx
          .insert(projects)
          .values({ id: proj, organizationId: org, name: 'Site', baseUrl: 'https://example.com' });
      });
    }
  });

  afterAll(async () => {
    await h.close();
  });

  it('no tenant context returns no rows', async () => {
    const rows = await withTenant(h.db, {}, (tx) => tx.select().from(projects));
    expect(rows).toHaveLength(0);
  });

  it('org A context sees only org A projects', async () => {
    const rows = await withTenant(h.db, { orgId: orgA }, (tx) => tx.select().from(projects));
    expect(rows.map((r) => r.id)).toEqual([projA]);
  });

  it('org A cannot read org B project by id', async () => {
    const rows = await withTenant(h.db, { orgId: orgA }, (tx) =>
      tx
        .select()
        .from(projects)
        .where(sql`${projects.id} = ${projB}`),
    );
    expect(rows).toHaveLength(0);
  });

  it('org A cannot update or delete org B rows (0 affected)', async () => {
    const upd = await withTenant(h.db, { orgId: orgA }, (tx) =>
      tx
        .update(projects)
        .set({ name: 'hijack' })
        .where(sql`${projects.id} = ${projB}`)
        .returning(),
    );
    expect(upd).toHaveLength(0);
    const del = await withTenant(h.db, { orgId: orgA }, (tx) =>
      tx
        .delete(organizationMembers)
        .where(sql`${organizationMembers.organizationId} = ${orgB}`)
        .returning(),
    );
    expect(del).toHaveLength(0);
  });

  it('org A cannot insert a row into org B (WITH CHECK)', async () => {
    await expect(
      withTenant(h.db, { orgId: orgA }, (tx) =>
        tx
          .insert(projects)
          .values({ organizationId: orgB, name: 'evil', baseUrl: 'https://evil.test' }),
      ),
    ).rejects.toThrow();
  });

  it('composite FK blocks a domain pointing at another org project', async () => {
    await expect(
      withTenant(h.db, { orgId: orgA }, (tx) =>
        tx.insert(authorizedDomains).values({
          organizationId: orgA,
          projectId: projB,
          hostname: 'example.com',
          verificationMethod: 'dns_txt',
          tokenHash: `h-${run}`,
        }),
      ),
    ).rejects.toThrow();
  });

  it('member listing: own memberships visible via user context, not others', async () => {
    const rows = await withTenant(h.db, { userId: userA }, (tx) =>
      tx.select().from(organizationMembers),
    );
    expect(rows.map((r) => r.organizationId)).toEqual([orgA]);
  });

  it('organizations are visible only to members', async () => {
    const rows = await withTenant(h.db, { userId: userA }, (tx) => tx.select().from(organizations));
    expect(rows.map((r) => r.id)).toEqual([orgA]);
  });

  it('audit_logs are append-only', async () => {
    await withTenant(h.db, { orgId: orgA }, (tx) =>
      tx
        .insert(auditLogs)
        .values({ organizationId: orgA, actorType: 'system', action: 'test.event' }),
    );
    await expect(
      withTenant(h.db, { orgId: orgA }, (tx) => tx.update(auditLogs).set({ action: 'tamper' })),
    ).rejects.toThrow();
    await expect(withTenant(h.db, { orgId: orgA }, (tx) => tx.delete(auditLogs))).rejects.toThrow();
  });

  it('last owner cannot be removed or demoted', async () => {
    await expect(
      withTenant(h.db, { orgId: orgA }, (tx) =>
        tx.delete(organizationMembers).where(sql`${organizationMembers.userId} = ${userA}`),
      ),
    ).rejects.toSatisfy(hasCause(/at least one owner/));
    await expect(
      withTenant(h.db, { orgId: orgB }, (tx) =>
        tx
          .update(organizationMembers)
          .set({ role: 'viewer' })
          .where(sql`${organizationMembers.userId} = ${userB}`),
      ),
    ).rejects.toSatisfy(hasCause(/at least one owner/));
  });

  it('withTenant rejects non-uuid scope (no SQL injection path)', async () => {
    await expect(
      withTenant(h.db, { orgId: "x'; drop table users;--" }, () => Promise.resolve(1)),
    ).rejects.toThrow(/invalid uuid/);
  });
});
