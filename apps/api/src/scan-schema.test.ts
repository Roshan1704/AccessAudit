import { sql } from 'drizzle-orm';
import { withTenant } from '@accessaudit/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, makeHarness, registerUser, type Harness } from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('scan tables: tenant isolation (integration)', () => {
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
      name: 'P',
      baseUrl: 'https://example.com',
    });
    return { userId: u.id, orgId, projectId: p.body.project.id as string };
  }

  const q = (a: { orgId: string; userId: string }, fn: Parameters<typeof withTenant>[2]) =>
    withTenant(h.handle.db, a, fn);

  it('a tenant sees only its own scans, pages and findings', async () => {
    const a = await setup('scan-a');
    const b = await setup('scan-b');
    const ids = await q(a, async (tx) => {
      const s = await tx.execute(
        sql`insert into scans (organization_id, project_id, start_url) values (${a.orgId}, ${a.projectId}, 'https://example.com/') returning id`,
      );
      return (s.rows[0] as { id: string }).id;
    });
    expect(ids).toBeTruthy();

    const seenByB = await q(b, (tx) => tx.execute(sql`select id from scans`));
    expect(seenByB.rows).toHaveLength(0);
    const seenByA = await q(a, (tx) => tx.execute(sql`select id from scans`));
    expect(seenByA.rows).toHaveLength(1);
  });

  it('a tenant cannot insert a scan for another tenant (RLS WITH CHECK)', async () => {
    const a = await setup('scan-c');
    const b = await setup('scan-d');
    await expect(
      q(b, (tx) =>
        tx.execute(
          sql`insert into scans (organization_id, project_id, start_url) values (${a.orgId}, ${a.projectId}, 'https://example.com/')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('composite foreign keys reject a page that points at another tenant scan', async () => {
    const a = await setup('scan-e');
    const b = await setup('scan-f');
    const scanA = await q(a, async (tx) => {
      const s = await tx.execute(
        sql`insert into scans (organization_id, project_id, start_url) values (${a.orgId}, ${a.projectId}, 'https://example.com/') returning id`,
      );
      return (s.rows[0] as { id: string }).id;
    });
    await expect(
      q(b, (tx) =>
        tx.execute(
          sql`insert into crawled_pages (organization_id, scan_id, url) values (${b.orgId}, ${scanA}, 'https://example.com/')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('aa_api cannot modify evidence or the rule catalogue', async () => {
    const a = await setup('scan-g');
    // Drizzle wraps the driver error; the Postgres message is on `cause`.
    const denied = async (run: Promise<unknown>): Promise<void> => {
      const err = await run.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      const cause = (err as Error).cause;
      expect(cause instanceof Error ? cause.message : '').toMatch(/permission denied/);
    };
    await denied(q(a, (tx) => tx.execute(sql`update finding_evidence set kind = 'selector'`)));
    await denied(
      q(a, (tx) =>
        tx.execute(
          sql`insert into accessibility_rules (id, source, title, description, default_severity, engine_version) values ('x','axe','t','d','minor','1')`,
        ),
      ),
    );
  });
});
