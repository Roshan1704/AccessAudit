import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanSchedules, withTenant } from '@accessaudit/db';
import { eq } from 'drizzle-orm';
import { runDueSchedules } from './scheduler.js';
import { createOrg, makeHarness, registerUser, type Harness } from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('scheduled scans (integration)', () => {
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
    return { u, orgId, projectId };
  }

  const makeDue = (orgId: string, id: string) =>
    withTenant(h.handle.db, { orgId }, (tx) =>
      tx
        .update(scanSchedules)
        .set({ nextRunAt: new Date(Date.now() - 60_000) })
        .where(eq(scanSchedules.id, id)),
    );

  const readSchedule = (orgId: string, id: string) =>
    withTenant(h.handle.db, { orgId }, async (tx) => {
      const [r] = await tx.select().from(scanSchedules).where(eq(scanSchedules.id, id));
      return r;
    });

  it('manages schedules: admin only, validated, tenant scoped', async () => {
    const { u, orgId, projectId } = await setup('sch-crud');
    const other = await registerUser(h.app, 'sch-crud-b');
    const otherOrg = await createOrg(other.c, 'sch-crud-b');

    const bad = await u.c.call('POST', `/orgs/${orgId}/schedules`, {
      projectId,
      frequency: 'hourly',
    });
    expect(bad.status).toBe(400);

    const c = await u.c.call('POST', `/orgs/${orgId}/schedules`, { projectId, frequency: 'daily' });
    expect(c.status).toBe(201);
    const id = c.body.schedule.id as string;
    expect(c.body.schedule.enabled).toBe(true);

    const list = await u.c.call('GET', `/orgs/${orgId}/schedules?projectId=${projectId}`);
    expect(list.body.schedules).toHaveLength(1);

    const upd = await u.c.call('PATCH', `/orgs/${orgId}/schedules/${id}`, { enabled: false });
    expect(upd.body.schedule.enabled).toBe(false);

    expect(
      (await other.c.call('PATCH', `/orgs/${otherOrg}/schedules/${id}`, { enabled: true })).status,
    ).toBe(404);
    expect((await other.c.call('GET', `/orgs/${otherOrg}/schedules`)).body.schedules).toHaveLength(
      0,
    );
    expect((await other.c.call('GET', `/orgs/${orgId}/schedules`)).status).toBeGreaterThan(399);

    expect((await u.c.call('DELETE', `/orgs/${orgId}/schedules/${id}`)).status).toBe(204);
    expect((await u.c.call('DELETE', `/orgs/${orgId}/schedules/${id}`)).status).toBe(404);
  });

  it('runs a due schedule: creates and enqueues a scan, advances next run', async () => {
    const { u, orgId, projectId } = await setup('sch-run');
    const c = await u.c.call('POST', `/orgs/${orgId}/schedules`, {
      projectId,
      frequency: 'weekly',
      maxPages: 4,
    });
    const id = c.body.schedule.id as string;
    await makeDue(orgId, id);

    await runDueSchedules(h.deps);
    const s = await readSchedule(orgId, id);
    expect(s?.lastError).toBeNull();
    expect(s?.lastScanId).toBeTruthy();
    expect(h.queued).toContainEqual({ orgId, scanId: s?.lastScanId });
    expect((s?.nextRunAt.getTime() ?? 0) > Date.now() + 6 * 86_400_000).toBe(true);

    // Not due any more: a second tick must not start another scan.
    const before = h.queued.filter((q) => q.orgId === orgId).length;
    await runDueSchedules(h.deps);
    expect(h.queued.filter((q) => q.orgId === orgId)).toHaveLength(before);
  });

  it('records the failure and still advances when the domain is unverified; skips disabled', async () => {
    const { u, orgId, projectId } = await setup('sch-fail', false);
    const c = await u.c.call('POST', `/orgs/${orgId}/schedules`, { projectId, frequency: 'daily' });
    const id = c.body.schedule.id as string;
    await makeDue(orgId, id);
    await runDueSchedules(h.deps);
    const s = await readSchedule(orgId, id);
    expect(s?.lastError).toBe('DOMAIN_NOT_VERIFIED');
    expect(s?.lastScanId).toBeNull();
    expect((s?.nextRunAt.getTime() ?? 0) > Date.now()).toBe(true);
    expect(h.queued.filter((q) => q.orgId === orgId)).toHaveLength(0);

    await u.c.call('PATCH', `/orgs/${orgId}/schedules/${id}`, { enabled: false });
    await makeDue(orgId, id);
    await runDueSchedules(h.deps);
    expect((await readSchedule(orgId, id))?.lastError).toBe('DOMAIN_NOT_VERIFIED');
  });
});
