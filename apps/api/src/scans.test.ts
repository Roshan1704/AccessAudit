import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crawledPages, findings, manualVerificationTasks, withTenant } from '@accessaudit/db';
import { createOrg, makeHarness, registerUser, type Harness } from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('scan API (integration)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(url as string);
  });
  afterAll(async () => {
    await h.close();
  });

  const uniq = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}.example.com`;

  async function setup(tag: string, verify = true) {
    const u = await registerUser(h.app, tag);
    const orgId = await createOrg(u.c, tag);
    const host = uniq(tag);
    const p = await u.c.call('POST', `/orgs/${orgId}/projects`, {
      name: 'Site',
      baseUrl: `https://${host}`,
    });
    const projectId = p.body.project.id as string;
    const base = `/orgs/${orgId}/projects/${projectId}/domains`;
    const d = await u.c.call('POST', base, { hostname: host, method: 'dns_txt' });
    if (verify) {
      h.net.txt.set(`_accessaudit-challenge.${host}`, [d.body.verification.recordValue as string]);
      const v = await u.c.call('POST', `${base}/${d.body.domain.id as string}/verify`);
      expect(v.body.domain.status).toBe('verified');
    }
    return { u, orgId, projectId, host };
  }

  it('refuses to scan an unverified domain', async () => {
    const { u, orgId, projectId } = await setup('scan-unv', false);
    const r = await u.c.call('POST', `/orgs/${orgId}/scans`, { projectId });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DOMAIN_NOT_VERIFIED');
    expect(h.queued.filter((q) => q.orgId === orgId)).toHaveLength(0);
  });

  it('refuses private targets and cross-host start URLs', async () => {
    const { u, orgId, projectId } = await setup('scan-ssrf');
    for (const startUrl of [
      'http://127.0.0.1/',
      'https://169.254.169.254/',
      'https://other.example.org/',
    ]) {
      const r = await u.c.call('POST', `/orgs/${orgId}/scans`, { projectId, startUrl });
      expect([409, 422], startUrl).toContain(r.status);
    }
    expect(h.queued.filter((q) => q.orgId === orgId)).toHaveLength(0);
  });

  it('queues a scan for a verified domain, stores server-side scope, limits concurrency', async () => {
    const { u, orgId, projectId } = await setup('scan-ok');
    const r = await u.c.call('POST', `/orgs/${orgId}/scans`, { projectId, maxPages: 3 });
    expect(r.status).toBe(202);
    expect(r.body.scan).toMatchObject({ status: 'queued', maxPages: 3, wcagVersion: '2.2' });
    expect(h.queued).toContainEqual({ orgId, scanId: r.body.scan.id });
    const r2 = await u.c.call('POST', `/orgs/${orgId}/scans`, { projectId });
    expect(r2.status).toBe(202);
    const r3 = await u.c.call('POST', `/orgs/${orgId}/scans`, { projectId });
    expect(r3.status).toBe(429);
    expect(r3.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('rejects unknown fields and out-of-range caps', async () => {
    const { u, orgId, projectId } = await setup('scan-val');
    for (const body of [
      { projectId, maxPages: 5000 },
      { projectId, organizationId: orgId },
    ]) {
      const r = await u.c.call('POST', `/orgs/${orgId}/scans`, body);
      expect(r.status).toBe(400);
    }
  });

  async function addMember(
    owner: { call: (m: string, p: string, b?: unknown) => Promise<{ status: number }> },
    orgId: string,
    role: 'admin' | 'member' | 'viewer',
    tag: string,
  ) {
    const m = await registerUser(h.app, tag);
    const inv = await owner.call('POST', `/orgs/${orgId}/invitations`, { email: m.email, role });
    expect(inv.status).toBe(201);
    const token = /token=([\w.-]+)/.exec(h.mails[h.mails.length - 1]?.text ?? '')?.[1] ?? '';
    expect((await m.c.call('POST', '/invitations/accept', { token })).status).toBe(200);
    return m;
  }

  it('viewers cannot start scans; robots override needs admin and is audited', async () => {
    const { u, orgId, projectId } = await setup('scan-role');
    const viewer = await addMember(u.c, orgId, 'viewer', 'scan-role-v');
    const member = await addMember(u.c, orgId, 'member', 'scan-role-m');
    expect((await viewer.c.call('POST', `/orgs/${orgId}/scans`, { projectId })).status).toBe(403);

    const robotsOverride = {
      robotsOverride: { reason: 'Owner asked us to test the blocked area' },
    };
    const denied = await member.c.call('POST', `/orgs/${orgId}/scans`, {
      projectId,
      ...robotsOverride,
    });
    expect(denied.status).toBe(403);
    const short = await u.c.call('POST', `/orgs/${orgId}/scans`, {
      projectId,
      robotsOverride: { reason: 'short' },
    });
    expect(short.status).toBe(400);

    const ok = await u.c.call('POST', `/orgs/${orgId}/scans`, { projectId, ...robotsOverride });
    expect(ok.status).toBe(202);
    const { sql } = await import('drizzle-orm');
    const rows = await withTenant(h.handle.db, { orgId, userId: u.id }, (tx) =>
      tx.execute(
        sql`select action, metadata from audit_logs where organization_id = ${orgId} and action = 'scan.created_robots_override'`,
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(JSON.stringify(rows.rows[0])).toContain('Owner asked us');
  });

  it('cancels a queued scan once', async () => {
    const { u, orgId, projectId } = await setup('scan-cancel');
    const s = await u.c.call('POST', `/orgs/${orgId}/scans`, { projectId });
    const id = s.body.scan.id as string;
    const c1 = await u.c.call('POST', `/orgs/${orgId}/scans/${id}/cancel`);
    expect(c1.body.scan.status).toBe('cancelled');
    const c2 = await u.c.call('POST', `/orgs/${orgId}/scans/${id}/cancel`);
    expect(c2.status).toBe(409);
  });

  it('serves findings with honest separate counts, supports review, hides them from other tenants', async () => {
    const a = await setup('scan-find');
    const b = await setup('scan-other');
    const s = await a.u.c.call('POST', `/orgs/${a.orgId}/scans`, { projectId: a.projectId });
    const scanId = s.body.scan.id as string;

    const ids = await withTenant(h.handle.db, { orgId: a.orgId }, async (tx) => {
      const [page] = await tx
        .insert(crawledPages)
        .values({
          organizationId: a.orgId,
          scanId,
          url: `https://${a.host}/`,
          status: 'scanned',
          depth: 0,
        })
        .returning({ id: crawledPages.id });
      const pageId = (page as { id: string }).id;
      const mk = (fp: string, classification: 'confirmed' | 'manual_verification') =>
        tx
          .insert(findings)
          .values({
            organizationId: a.orgId,
            scanId,
            pageId,
            ruleId: 'axe:image-alt',
            fingerprint: fp,
            classification,
            confidence: 90,
            severity: 'critical',
            wcagCriteria: ['1.1.1'],
            message: 'Image has no text alternative',
            selector: 'img',
          })
          .returning({ id: findings.id });
      const [f1] = await mk('fp-1', 'confirmed');
      await mk('fp-2', 'manual_verification');
      await tx.insert(manualVerificationTasks).values({
        organizationId: a.orgId,
        scanId,
        ruleId: 'axe:image-alt',
        instructions: 'Check the alt text describes the image.',
      });
      return { findingId: (f1 as { id: string }).id };
    });

    const detail = await a.u.c.call('GET', `/orgs/${a.orgId}/scans/${scanId}`);
    expect(detail.body.summary.byClassification).toEqual({ confirmed: 1, manual_verification: 1 });
    expect(detail.body.summary.bySeverity).toEqual({ critical: 1 }); // manual items never inflate severity
    expect(detail.body.pages[0]).toMatchObject({ confirmed: 1, manual: 1 });

    const list = await a.u.c.call(
      'GET',
      `/orgs/${a.orgId}/scans/${scanId}/findings?classification=confirmed`,
    );
    expect(list.body.findings).toHaveLength(1);
    expect(list.body.findings[0].ruleTitle).toBeTruthy();

    const rv = await a.u.c.call('PATCH', `/orgs/${a.orgId}/findings/${ids.findingId}`, {
      status: 'false_positive',
    });
    expect(rv.body.finding.reviewStatus).toBe('false_positive');

    // Lifecycle: assignment (members only), comments, append-only history.
    const fpath = `/orgs/${a.orgId}/findings/${ids.findingId}`;
    expect((await a.u.c.call('PATCH', fpath, {})).status).toBe(400);
    const outsider = await b.u.c.call('PATCH', fpath, { assigneeId: b.u.id });
    expect(outsider.status).toBe(404);
    const notMember = await a.u.c.call('PATCH', fpath, { assigneeId: b.u.id });
    expect(notMember.status).toBe(400);
    const asg = await a.u.c.call('PATCH', fpath, { assigneeId: a.u.id });
    expect(asg.body.finding.assigneeId).toBe(a.u.id);
    const cm = await a.u.c.call('POST', `${fpath}/comments`, { body: ' Fix in header template ' });
    expect(cm.status).toBe(201);
    expect(cm.body.comment.body).toBe('Fix in header template');
    expect((await a.u.c.call('POST', `${fpath}/comments`, { body: '   ' })).status).toBe(400);
    const act = await a.u.c.call('GET', `${fpath}/activity`);
    expect(act.body.comments).toHaveLength(1);
    expect(act.body.history.map((x: { kind: string }) => x.kind)).toEqual(['status', 'assignee']);
    expect((await a.u.c.call('GET', fpath)).body.finding.assigneeId).toBe(a.u.id);
    expect(
      (await b.u.c.call('GET', `/orgs/${b.orgId}/findings/${ids.findingId}/activity`)).status,
    ).toBe(404);

    // Explanation: deterministic template, labelled, tenant-scoped.
    const ex1 = await a.u.c.call('GET', `${fpath}/explanation`);
    expect(ex1.status).toBe(200);
    expect(ex1.body.explanation).toMatchObject({ source: 'template', provider: 'template-v1' });
    expect(ex1.body.explanation.howToFix.length).toBeGreaterThan(0);
    expect(ex1.body.explanation.disclaimer).toBeTruthy();
    expect((await a.u.c.call('GET', `${fpath}/explanation`)).body).toEqual(ex1.body);
    expect(JSON.stringify(ex1.body)).not.toContain(a.host);
    expect(
      (await b.u.c.call('GET', `/orgs/${b.orgId}/findings/${ids.findingId}/explanation`)).status,
    ).toBe(404);

    const tasks = await a.u.c.call('GET', `/orgs/${a.orgId}/scans/${scanId}/manual-tasks`);
    expect(tasks.body.tasks).toHaveLength(1);
    const done = await a.u.c.call(
      'PATCH',
      `/orgs/${a.orgId}/manual-tasks/${tasks.body.tasks[0].id as string}`,
      {
        status: 'passed',
        note: 'Alt text is accurate.',
      },
    );
    expect(done.body.task.status).toBe('passed');

    // Cross-tenant: another org's user cannot read via either org path.
    expect((await b.u.c.call('GET', `/orgs/${a.orgId}/scans/${scanId}`)).status).toBe(404);
    expect((await b.u.c.call('GET', `/orgs/${b.orgId}/scans/${scanId}`)).status).toBe(404);
    expect((await b.u.c.call('GET', `/orgs/${b.orgId}/findings/${ids.findingId}`)).status).toBe(
      404,
    );
    expect(
      (await b.u.c.call('PATCH', `/orgs/${b.orgId}/findings/${ids.findingId}`, { status: 'fixed' }))
        .status,
    ).toBe(404);
    expect((await b.u.c.call('POST', `/orgs/${b.orgId}/scans/${scanId}/cancel`)).status).toBe(404);
  });
});
