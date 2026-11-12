import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crawledPages, findings, scans, withTenant } from '@accessaudit/db';
import { csvCell, renderCsv, renderHtml, type ReportData } from './report.js';
import { createOrg, makeHarness, registerUser, type Harness } from './test-harness.js';

const data = (over: Partial<ReportData['findings'][number]> = {}): ReportData => ({
  generatedAt: '2026-01-01T00:00:00Z',
  project: { name: 'My <b>Site</b>', baseUrl: 'https://a.example.com' },
  scan: {
    id: 's',
    startUrl: 'https://a.example.com/',
    wcagVersion: '2.2',
    conformanceLevel: 'AA',
    maxPages: 10,
    finishedAt: null,
  },
  pages: { scanned: 1, notScanned: 0 },
  manualTasks: { total: 2, pending: 1 },
  findings: [
    {
      ruleId: 'axe:image-alt',
      ruleTitle: 'Images need alt',
      classification: 'confirmed',
      severity: 'critical',
      confidence: 90,
      wcagCriteria: ['1.1.1'],
      message: 'm',
      selector: 'img',
      occurrences: 1,
      reviewStatus: 'open',
      pageUrl: 'https://a.example.com/',
      ...over,
    },
  ],
});

describe('report renderers', () => {
  it('neutralises CSV formula injection and quotes special cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(5)).toBe('5');
    expect(renderCsv(data({ message: '@evil' }))).toContain("'@evil");
  });

  it('escapes HTML and includes the disclaimer', () => {
    const html = renderHtml(data({ message: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('My &lt;b&gt;Site&lt;/b&gt;');
    expect(html).toContain('not a statement of conformance');
    expect(html).toContain('lang="en"');
  });
});

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('report API (integration)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(url as string);
  });
  afterAll(async () => {
    await h.close();
  });

  it('exports json/csv/html, rejects bad format, is tenant-scoped', async () => {
    const u = await registerUser(h.app, 'rep-a');
    const orgId = await createOrg(u.c, 'rep-a');
    const other = await registerUser(h.app, 'rep-b');
    const otherOrg = await createOrg(other.c, 'rep-b');
    const host = `rep-${Math.random().toString(36).slice(2, 8)}.example.com`;
    const p = await u.c.call('POST', `/orgs/${orgId}/projects`, {
      name: 'Site',
      baseUrl: `https://${host}`,
    });
    const projectId = p.body.project.id as string;
    const scanId = await withTenant(h.handle.db, { orgId }, async (tx) => {
      const [s] = await tx
        .insert(scans)
        .values({
          organizationId: orgId,
          projectId,
          status: 'completed',
          startUrl: `https://${host}/`,
        })
        .returning({ id: scans.id });
      const id = (s as { id: string }).id;
      const [pg] = await tx
        .insert(crawledPages)
        .values({
          organizationId: orgId,
          scanId: id,
          url: `https://${host}/`,
          status: 'scanned',
          depth: 0,
        })
        .returning({ id: crawledPages.id });
      await tx.insert(findings).values({
        organizationId: orgId,
        scanId: id,
        pageId: (pg as { id: string }).id,
        ruleId: 'axe:image-alt',
        fingerprint: 'fp1',
        classification: 'confirmed',
        confidence: 90,
        severity: 'critical',
        message: '=cmd()',
        selector: 'img',
      });
      return id;
    });

    const j = await u.c.call('GET', `/orgs/${orgId}/scans/${scanId}/report?format=json`);
    expect(j.status).toBe(200);
    expect(j.body.report.findings).toHaveLength(1);
    expect(j.body.disclaimer).toContain('not a statement of conformance');

    const csv = await u.c.call('GET', `/orgs/${orgId}/scans/${scanId}/report?format=csv`);
    expect(csv.status).toBe(200);
    expect(String(csv.body)).toContain("'=cmd()");
    const html = await u.c.call('GET', `/orgs/${orgId}/scans/${scanId}/report?format=html`);
    expect(html.status).toBe(200);
    expect(String(html.body)).toContain('Confirmed violations');

    expect((await u.c.call('GET', `/orgs/${orgId}/scans/${scanId}/report?format=xls`)).status).toBe(
      400,
    );
    expect(
      (await other.c.call('GET', `/orgs/${otherOrg}/scans/${scanId}/report?format=json`)).status,
    ).toBe(404);
  });
});
