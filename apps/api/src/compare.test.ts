import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crawledPages, findings, scans, withTenant } from '@accessaudit/db';
import { compareRows } from './routes/compare.js';
import { createOrg, makeHarness, registerUser, type Harness } from './test-harness.js';

const row = (fp: string, over: Partial<Parameters<typeof compareRows>[0][number]> = {}) => ({
  fingerprint: fp,
  id: fp,
  ruleId: 'axe:image-alt',
  ruleTitle: 't',
  classification: 'confirmed',
  severity: 'critical',
  reviewStatus: 'open',
  message: 'm',
  selector: 'img',
  pageUrl: 'https://a.example.com/',
  ...over,
});

describe('compareRows', () => {
  it('separates added, resolved, persisting and not-rechecked', () => {
    const base = [
      row('keep'),
      row('fixed-now'),
      row('page-skipped', { pageUrl: 'https://a.example.com/gone' }),
    ];
    const cur = [row('keep'), row('new')];
    const r = compareRows(base, cur, new Set(['https://a.example.com/']));
    expect(r.added.map((x) => x.fingerprint)).toEqual(['new']);
    expect(r.unchanged.map((x) => x.fingerprint)).toEqual(['keep']);
    expect(r.regressed).toEqual([]);
    expect(r.resolved.map((x) => x.fingerprint)).toEqual(['fixed-now']);
    expect(r.notRechecked.map((x) => x.fingerprint)).toEqual(['page-skipped']);
    expect(r.regressions.map((x) => x.fingerprint)).toEqual(['new']);
  });

  it('flags a finding marked fixed that came back; ignores manual items', () => {
    const r = compareRows(
      [row('a', { reviewStatus: 'fixed' })],
      [row('a'), row('m', { classification: 'manual_verification' })],
      new Set(),
    );
    expect(r.regressions.map((x) => x.fingerprint)).toEqual(['a']);
    expect(r.regressed.map((x) => x.fingerprint)).toEqual(['a']);
    expect(r.unchanged).toEqual([]);
  });

  it('never calls a finding resolved when its page was not scanned again', () => {
    const r = compareRows([row('x')], [], new Set());
    expect(r.resolved).toEqual([]);
    expect(r.notRechecked.map((x) => x.fingerprint)).toEqual(['x']);
  });

  it('keeps the buckets disjoint', () => {
    const base = [row('u'), row('r', { reviewStatus: 'fixed' }), row('g')];
    const cur = [row('u'), row('r'), row('n')];
    const r = compareRows(base, cur, new Set(['https://a.example.com/']));
    const all = [...r.added, ...r.resolved, ...r.regressed, ...r.unchanged, ...r.notRechecked];
    expect(all.map((x) => x.fingerprint).sort()).toEqual(['g', 'n', 'r', 'u']);
  });
});

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('compare API (integration)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(url as string);
  });
  afterAll(async () => {
    await h.close();
  });

  it('compares the latest two completed scans and is tenant-scoped', async () => {
    const u = await registerUser(h.app, 'cmp-a');
    const orgId = await createOrg(u.c, 'cmp-a');
    const other = await registerUser(h.app, 'cmp-b');
    const otherOrg = await createOrg(other.c, 'cmp-b');
    const host = `cmp-${Math.random().toString(36).slice(2, 8)}.example.com`;
    const p = await u.c.call('POST', `/orgs/${orgId}/projects`, {
      name: 'Site',
      baseUrl: `https://${host}`,
    });
    const projectId = p.body.project.id as string;

    const mkScan = (when: string) =>
      withTenant(h.handle.db, { orgId }, async (tx) => {
        const [s] = await tx
          .insert(scans)
          .values({
            organizationId: orgId,
            projectId,
            status: 'completed',
            startUrl: `https://${host}/`,
            createdAt: new Date(when),
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
        return { scanId, pageId: (pg as { id: string }).id };
      });
    const addFinding = (s: { scanId: string; pageId: string }, fp: string) =>
      withTenant(h.handle.db, { orgId }, (tx) =>
        tx.insert(findings).values({
          organizationId: orgId,
          scanId: s.scanId,
          pageId: s.pageId,
          ruleId: 'axe:image-alt',
          fingerprint: fp,
          classification: 'confirmed',
          confidence: 90,
          severity: 'critical',
          message: 'm',
          selector: 'img',
        }),
      );

    const old = await mkScan('2026-01-01T00:00:00Z');
    const neu = await mkScan('2026-02-01T00:00:00Z');
    await addFinding(old, 'same');
    await addFinding(old, 'fixed');
    await addFinding(neu, 'same');
    await addFinding(neu, 'fresh');

    const r = await u.c.call('GET', `/orgs/${orgId}/scans/${neu.scanId}/compare`);
    expect(r.status).toBe(200);
    expect(r.body.baseline.id).toBe(old.scanId);
    expect(r.body.comparison.counts).toEqual({
      added: 1,
      resolved: 1,
      regressed: 0,
      unchanged: 1,
      notRechecked: 0,
    });

    const first = await u.c.call('GET', `/orgs/${orgId}/scans/${old.scanId}/compare`);
    expect(first.body.baseline).toBeNull();

    const cov = await u.c.call('GET', `/orgs/${orgId}/scans/${neu.scanId}/coverage`);
    expect(cov.body.pages).toEqual({ discovered: 1, scanned: 1, notScanned: 0 });
    expect(cov.body.limits.length).toBeGreaterThan(0);

    expect(
      (await other.c.call('GET', `/orgs/${otherOrg}/scans/${neu.scanId}/compare`)).status,
    ).toBe(404);
    expect(
      (await other.c.call('GET', `/orgs/${otherOrg}/scans/${neu.scanId}/coverage`)).status,
    ).toBe(404);
  });
});
