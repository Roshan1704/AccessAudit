import { AppError } from '@accessaudit/shared';
import { accessibilityRules, crawledPages, findings, scans, withTenant } from '@accessaudit/db';
import { and, desc, eq, lt, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { requireOrg } from '../session.js';
import { param, uuidOr404 } from '../util.js';

interface Row {
  fingerprint: string;
  id: string;
  ruleId: string;
  ruleTitle: string;
  classification: string;
  severity: string;
  reviewStatus: string;
  message: string;
  selector: string | null;
  pageUrl: string;
}

/**
 * Compare two scans of one project by finding fingerprint (rule + selector + page path).
 * A finding missing from the newer scan only counts as resolved when its page was actually
 * scanned again; otherwise it is "not rechecked", so a smaller crawl never fakes progress.
 */
export function compareRows(
  base: Row[],
  current: Row[],
  currentScannedUrls: Set<string>,
): {
  added: Row[];
  resolved: Row[];
  persisting: Row[];
  notRechecked: Row[];
  regressions: Row[];
} {
  const baseBy = new Map(base.map((r) => [r.fingerprint, r]));
  const curBy = new Map(current.map((r) => [r.fingerprint, r]));
  const added = current.filter((r) => !baseBy.has(r.fingerprint));
  const persisting = current.filter((r) => baseBy.has(r.fingerprint));
  const gone = base.filter((r) => !curBy.has(r.fingerprint));
  const resolved = gone.filter((r) => currentScannedUrls.has(r.pageUrl));
  const notRechecked = gone.filter((r) => !currentScannedUrls.has(r.pageUrl));
  // Regression: new confirmed/potential issue, or one a person had marked fixed that is back.
  const regressions = current.filter((r) => {
    const prev = baseBy.get(r.fingerprint);
    const real = r.classification === 'confirmed' || r.classification === 'strong_potential';
    if (!real) return false;
    if (!prev) return true;
    return prev.reviewStatus === 'fixed';
  });
  return { added, resolved, persisting, notRechecked, regressions };
}

export type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

export async function loadRows(tx: Tx, scanId: string): Promise<Row[]> {
  return tx
    .select({
      fingerprint: findings.fingerprint,
      id: findings.id,
      ruleId: findings.ruleId,
      ruleTitle: accessibilityRules.title,
      classification: findings.classification,
      severity: findings.severity,
      reviewStatus: findings.reviewStatus,
      message: findings.message,
      selector: findings.selector,
      pageUrl: crawledPages.url,
    })
    .from(findings)
    .innerJoin(accessibilityRules, eq(accessibilityRules.id, findings.ruleId))
    .innerJoin(crawledPages, eq(crawledPages.id, findings.pageId))
    .where(eq(findings.scanId, scanId));
}

export function compareRoutes(app: FastifyInstance, deps: Deps): void {
  const ctx = (a: { orgId: string; userId: string }) => ({ orgId: a.orgId, userId: a.userId });

  app.get('/orgs/:orgId/scans/:scanId/compare', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    const scanId = uuidOr404(param(req, 'scanId'));
    const q = req.query as Record<string, string | undefined>;
    const against = q['against'] === undefined ? undefined : uuidOr404(q['against']);
    return withTenant(deps.db, ctx(a), async (tx) => {
      const [cur] = await tx
        .select({
          id: scans.id,
          projectId: scans.projectId,
          status: scans.status,
          createdAt: scans.createdAt,
          finishedAt: scans.finishedAt,
        })
        .from(scans)
        .where(eq(scans.id, scanId));
      if (!cur) throw new AppError('NOT_FOUND', 'Not found.');
      if (cur.status !== 'completed')
        throw new AppError('CONFLICT', 'Only completed scans can be compared.');

      const [base] = against
        ? await tx
            .select({
              id: scans.id,
              projectId: scans.projectId,
              status: scans.status,
              createdAt: scans.createdAt,
            })
            .from(scans)
            .where(eq(scans.id, against))
        : await tx
            .select({
              id: scans.id,
              projectId: scans.projectId,
              status: scans.status,
              createdAt: scans.createdAt,
            })
            .from(scans)
            .where(
              and(
                eq(scans.projectId, cur.projectId),
                eq(scans.status, 'completed'),
                lt(scans.createdAt, cur.createdAt),
                ne(scans.id, cur.id),
              ),
            )
            .orderBy(desc(scans.createdAt))
            .limit(1);
      if (!base) return { baseline: null, current: { id: cur.id }, comparison: null };
      if (base.projectId !== cur.projectId)
        throw new AppError('VALIDATION_FAILED', 'Scans must belong to the same project.');
      if (base.status !== 'completed')
        throw new AppError('CONFLICT', 'Only completed scans can be compared.');

      const baseRows = await loadRows(tx, base.id);
      const curRows = await loadRows(tx, cur.id);
      const scanned = await tx
        .select({ url: crawledPages.url })
        .from(crawledPages)
        .where(and(eq(crawledPages.scanId, cur.id), eq(crawledPages.status, 'scanned')));
      const diff = compareRows(baseRows, curRows, new Set(scanned.map((p) => p.url)));
      const slim = (rows: Row[]) =>
        rows.slice(0, 200).map((r) => ({
          id: r.id,
          ruleId: r.ruleId,
          ruleTitle: r.ruleTitle,
          classification: r.classification,
          severity: r.severity,
          selector: r.selector,
          pageUrl: r.pageUrl,
        }));
      return {
        baseline: { id: base.id, createdAt: base.createdAt },
        current: { id: cur.id, createdAt: cur.createdAt },
        comparison: {
          counts: {
            added: diff.added.length,
            resolved: diff.resolved.length,
            persisting: diff.persisting.length,
            notRechecked: diff.notRechecked.length,
            regressions: diff.regressions.length,
          },
          added: slim(diff.added),
          resolved: slim(diff.resolved),
          notRechecked: slim(diff.notRechecked),
          regressions: slim(diff.regressions),
        },
      };
    });
  });

  app.get('/orgs/:orgId/scans/:scanId/coverage', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    const scanId = uuidOr404(param(req, 'scanId'));
    return withTenant(deps.db, ctx(a), async (tx) => {
      const [scan] = await tx
        .select({
          id: scans.id,
          maxPages: scans.maxPages,
          wcagVersion: scans.wcagVersion,
          conformanceLevel: scans.conformanceLevel,
          interactionTests: scans.interactionTests,
          status: scans.status,
        })
        .from(scans)
        .where(eq(scans.id, scanId));
      if (!scan) throw new AppError('NOT_FOUND', 'Not found.');
      const pages = await tx
        .select({
          url: crawledPages.url,
          status: crawledPages.status,
          failureReason: crawledPages.failureReason,
        })
        .from(crawledPages)
        .where(eq(crawledPages.scanId, scanId));
      const scanned = pages.filter((p) => p.status === 'scanned').length;
      const notScanned = pages.filter((p) => p.status !== 'scanned');
      return {
        scan,
        pages: { discovered: pages.length, scanned, notScanned: notScanned.length },
        notScannedPages: notScanned.slice(0, 100),
        reachedPageLimit: pages.length >= scan.maxPages,
        // Plain statement of what automation cannot cover, shown beside the numbers.
        limits: [
          'Automated checks find only a share of WCAG issues; manual review is still required.',
          'Only pages reachable from the start URL without logging in are covered.',
          scan.interactionTests
            ? 'Basic keyboard and interaction checks ran; complex widgets need manual testing.'
            : 'Interaction checks were turned off for this scan.',
        ],
      };
    });
  });
}
