import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crawledPages, findings, scans, withTenant } from '@accessaudit/db';
import { notifyFinishedScans } from './notifier.js';
import { createOrg, makeHarness, registerUser, type Harness } from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('scan notifications (integration)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(url as string);
  });
  afterAll(async () => {
    await h.close();
  });

  it('mails the starter once with regression counts; failed scans go to owners', async () => {
    const u = await registerUser(h.app, 'ntf');
    const orgId = await createOrg(u.c, 'ntf');
    const host = `ntf-${Math.random().toString(36).slice(2, 8)}.example.com`;
    const p = await u.c.call('POST', `/orgs/${orgId}/projects`, {
      name: 'Notify Site',
      baseUrl: `https://${host}`,
    });
    const projectId = p.body.project.id as string;

    const mk = (
      when: string,
      status: 'completed' | 'failed',
      createdBy: string | null,
      fps: string[],
    ) =>
      withTenant(h.handle.db, { orgId }, async (tx) => {
        const [s] = await tx
          .insert(scans)
          .values({
            organizationId: orgId,
            projectId,
            status,
            startUrl: `https://${host}/`,
            createdAt: new Date(when),
            finishedAt: new Date(when),
            failureReason: status === 'failed' ? 'crawl_error' : null,
            createdBy,
          })
          .returning({ id: scans.id });
        const scanId = (s as { id: string }).id;
        const [pg] = await tx
          .insert(crawledPages)
          .values({
            organizationId: orgId,
            scanId,
            url: `https://${host}/`,
            status: 'scanned',
            depth: 0,
          })
          .returning({ id: crawledPages.id });
        for (const fp of fps)
          await tx.insert(findings).values({
            organizationId: orgId,
            scanId,
            pageId: (pg as { id: string }).id,
            ruleId: 'axe:image-alt',
            fingerprint: fp,
            classification: 'confirmed',
            confidence: 90,
            severity: 'critical',
            message: 'm',
            selector: 'img',
          });
        return scanId;
      });

    await mk('2026-01-01T00:00:00Z', 'completed', u.id, ['same']);
    await mk('2026-02-01T00:00:00Z', 'completed', u.id, ['same', 'fresh']);
    await mk('2026-03-01T00:00:00Z', 'failed', null, []);

    await notifyFinishedScans(h.deps, 1000);
    const mine = h.mails.filter((m) => m.to === u.email);
    // Two completed scans started by the user, plus the failed scheduled scan mailed to the owner (also the user).
    expect(mine).toHaveLength(3);
    expect(mine.some((m) => m.subject.startsWith('Accessibility regression'))).toBe(true);
    expect(mine.some((m) => m.subject.startsWith('Scan failed'))).toBe(true);
    expect(
      mine.every((m) => m.text.includes('manual review') || m.subject.startsWith('Scan failed')),
    ).toBe(true);

    // Second tick: nothing is mailed again.
    await notifyFinishedScans(h.deps, 1000);
    expect(h.mails.filter((m) => m.to === u.email)).toHaveLength(3);
  });
});
