import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  crawledPages,
  findings,
  manualVerificationTasks,
  scans,
  withTenant,
} from '@accessaudit/db';
import { createOrg, makeHarness, registerUser, type Harness } from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('org overview (integration)', () => {
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
    const host = `${tag}-${Math.random().toString(36).slice(2, 8)}.example.com`;
    const p = await u.c.call('POST', `/orgs/${orgId}/projects`, {
      name: 'Site',
      baseUrl: `https://${host}`,
    });
    const projectId = p.body.project.id as string;
    const base = `/orgs/${orgId}/projects/${projectId}/domains`;
    const d = await u.c.call('POST', base, { hostname: host, method: 'dns_txt' });
    h.net.txt.set(`_accessaudit-challenge.${host}`, [d.body.verification.recordValue as string]);
    await u.c.call('POST', `${base}/${d.body.domain.id as string}/verify`);
    return { u, orgId, projectId, host };
  }

  it('empty org returns no projects and zero totals', async () => {
    const u = await registerUser(h.app, 'ov-empty');
    const orgId = await createOrg(u.c, 'ov-empty');
    const r = await u.c.call('GET', `/orgs/${orgId}/overview`);
    expect(r.status).toBe(200);
    expect(r.body.projects).toEqual([]);
    expect(r.body.totals).toMatchObject({ projects: 0, confirmed: 0, potential: 0 });
  });

  it('project without a completed scan has no latestScan', async () => {
    const a = await setup('ov-none');
    await a.u.c.call('POST', `/orgs/${a.orgId}/scans`, { projectId: a.projectId });
    const r = await a.u.c.call('GET', `/orgs/${a.orgId}/overview`);
    expect(r.body.projects).toHaveLength(1);
    expect(r.body.projects[0].latestScan).toBeNull();
    expect(r.body.totals.projectsScanned).toBe(0);
  });

  it('reports real counts from the latest completed scan only, and hides them from other tenants', async () => {
    const a = await setup('ov-counts');
    const b = await setup('ov-other');
    const s = await a.u.c.call('POST', `/orgs/${a.orgId}/scans`, { projectId: a.projectId });
    const scanId = s.body.scan.id as string;

    await withTenant(h.handle.db, { orgId: a.orgId }, async (tx) => {
      const mkPage = async (status: 'scanned' | 'failed', path: string) => {
        const [row] = await tx
          .insert(crawledPages)
          .values({
            organizationId: a.orgId,
            scanId,
            url: `https://${a.host}/${path}`,
            status,
            depth: 0,
          })
          .returning({ id: crawledPages.id });
        return (row as { id: string }).id;
      };
      const pageId = await mkPage('scanned', 'a');
      await mkPage('failed', 'b');
      const mk = (
        fp: string,
        classification: 'confirmed' | 'strong_potential' | 'manual_verification',
        severity: 'critical' | 'serious' | 'minor',
        reviewStatus: 'open' | 'false_positive' = 'open',
      ) =>
        tx.insert(findings).values({
          organizationId: a.orgId,
          scanId,
          pageId,
          ruleId: 'axe:image-alt',
          fingerprint: fp,
          classification,
          confidence: 90,
          severity,
          wcagCriteria: ['1.1.1'],
          message: 'm',
          selector: 'img',
          reviewStatus,
        });
      await mk('1', 'confirmed', 'critical');
      await mk('2', 'confirmed', 'critical');
      await mk('3', 'confirmed', 'serious');
      await mk('4', 'strong_potential', 'minor');
      await mk('5', 'confirmed', 'critical', 'false_positive'); // reviewed, not counted
      await mk('6', 'manual_verification', 'critical'); // never counts toward severity
      await tx.insert(manualVerificationTasks).values({
        organizationId: a.orgId,
        scanId,
        ruleId: 'axe:image-alt',
        instructions: 'Check it.',
      });
      await tx.update(scans).set({ status: 'completed' }).where(eq(scans.id, scanId));
    });

    const r = await a.u.c.call('GET', `/orgs/${a.orgId}/overview`);
    expect(r.status).toBe(200);
    expect(r.body.projects[0].latestScan).toMatchObject({
      id: scanId,
      confirmed: { critical: 2, serious: 1 },
      potential: { minor: 1 },
      manualTasksOpen: 1,
      pagesScanned: 1,
      pagesNotScanned: 1,
    });
    expect(r.body.totals).toMatchObject({
      projects: 1,
      projectsScanned: 1,
      confirmed: 3,
      potential: 1,
      manualTasksOpen: 1,
      pagesScanned: 1,
      pagesNotScanned: 1,
    });

    // scan list carries the same open counts (confirmed 3 of which 1 reviewed away is excluded)
    const list = await a.u.c.call('GET', `/orgs/${a.orgId}/scans?projectId=${a.projectId}`);
    expect(list.status).toBe(200);
    expect(list.body.scans[0]).toMatchObject({ id: scanId, openConfirmed: 3, openPotential: 1 });

    // other tenant sees nothing of it, and cannot address this org
    const other = await b.u.c.call('GET', `/orgs/${b.orgId}/overview`);
    expect(other.body.totals.confirmed).toBe(0);
    const cross = await b.u.c.call('GET', `/orgs/${a.orgId}/overview`);
    expect(cross.status).toBe(404);
  });

  it('requires a session', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/orgs/00000000-0000-4000-8000-000000000000/overview',
    });
    expect(r.statusCode).toBe(401);
  });
});
