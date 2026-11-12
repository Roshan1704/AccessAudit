import {
  crawledPages,
  findings,
  manualVerificationTasks,
  projects,
  scans,
  withTenant,
} from '@accessaudit/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { requireOrg } from '../session.js';
import { param, uuidOr404 } from '../util.js';

/**
 * Read-only organization overview. Counts only, taken from each project's latest completed scan.
 * No composite score: a single number would hide how little of a site a scan covered.
 */
export function overviewRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/orgs/:orgId/overview', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    return withTenant(deps.db, { orgId: a.orgId, userId: a.userId }, async (tx) => {
      const projectRows = await tx
        .select({ id: projects.id, name: projects.name, baseUrl: projects.baseUrl })
        .from(projects)
        .where(and(eq(projects.organizationId, a.orgId), isNull(projects.deletedAt)))
        .orderBy(asc(projects.name));
      const projectIds = projectRows.map((p) => p.id);
      if (projectIds.length === 0) return { projects: [], totals: totalsOf([]) };

      const completed = await tx
        .selectDistinctOn([scans.projectId], {
          id: scans.id,
          projectId: scans.projectId,
          finishedAt: scans.finishedAt,
          wcagVersion: scans.wcagVersion,
          conformanceLevel: scans.conformanceLevel,
          maxPages: scans.maxPages,
        })
        .from(scans)
        .where(
          and(
            eq(scans.organizationId, a.orgId),
            eq(scans.status, 'completed'),
            inArray(scans.projectId, projectIds),
          ),
        )
        .orderBy(scans.projectId, desc(scans.createdAt));
      const scanIds = completed.map((s) => s.id);

      const sev = scanIds.length
        ? await tx
            .select({
              scanId: findings.scanId,
              classification: findings.classification,
              severity: findings.severity,
              n: sql<number>`count(*)::int`,
            })
            .from(findings)
            .where(
              and(
                inArray(findings.scanId, scanIds),
                eq(findings.reviewStatus, 'open'),
                inArray(findings.classification, ['confirmed', 'strong_potential']),
              ),
            )
            .groupBy(findings.scanId, findings.classification, findings.severity)
        : [];
      const tasks = scanIds.length
        ? await tx
            .select({ scanId: manualVerificationTasks.scanId, n: sql<number>`count(*)::int` })
            .from(manualVerificationTasks)
            .where(
              and(
                inArray(manualVerificationTasks.scanId, scanIds),
                eq(manualVerificationTasks.status, 'pending'),
              ),
            )
            .groupBy(manualVerificationTasks.scanId)
        : [];
      const pages = scanIds.length
        ? await tx
            .select({
              scanId: crawledPages.scanId,
              scanned: sql<number>`count(*) filter (where ${crawledPages.status} = 'scanned')::int`,
              notScanned: sql<number>`count(*) filter (where ${crawledPages.status} <> 'scanned')::int`,
            })
            .from(crawledPages)
            .where(inArray(crawledPages.scanId, scanIds))
            .groupBy(crawledPages.scanId)
        : [];

      const out = projectRows.map((p) => {
        const s = completed.find((c) => c.projectId === p.id);
        if (!s) return { ...p, latestScan: null };
        const mine = sev.filter((r) => r.scanId === s.id);
        const sum = (cls: string) =>
          mine
            .filter((r) => r.classification === cls)
            .reduce<Record<string, number>>((acc, r) => {
              acc[r.severity] = (acc[r.severity] ?? 0) + r.n;
              return acc;
            }, {});
        const pg = pages.find((x) => x.scanId === s.id);
        return {
          ...p,
          latestScan: {
            id: s.id,
            finishedAt: s.finishedAt,
            wcagVersion: s.wcagVersion,
            conformanceLevel: s.conformanceLevel,
            maxPages: s.maxPages,
            confirmed: sum('confirmed'),
            potential: sum('strong_potential'),
            manualTasksOpen: tasks.find((t) => t.scanId === s.id)?.n ?? 0,
            pagesScanned: pg?.scanned ?? 0,
            pagesNotScanned: pg?.notScanned ?? 0,
          },
        };
      });
      return { projects: out, totals: totalsOf(out) };
    });
  });
}

interface Row {
  latestScan: null | {
    confirmed: Record<string, number>;
    potential: Record<string, number>;
    manualTasksOpen: number;
    pagesScanned: number;
    pagesNotScanned: number;
  };
}

function totalsOf(rows: Row[]) {
  const total = (m: Record<string, number>) => Object.values(m).reduce((x, y) => x + y, 0);
  let confirmed = 0;
  let potential = 0;
  let manualTasksOpen = 0;
  let pagesScanned = 0;
  let pagesNotScanned = 0;
  let projectsScanned = 0;
  for (const r of rows) {
    if (!r.latestScan) continue;
    projectsScanned += 1;
    confirmed += total(r.latestScan.confirmed);
    potential += total(r.latestScan.potential);
    manualTasksOpen += r.latestScan.manualTasksOpen;
    pagesScanned += r.latestScan.pagesScanned;
    pagesNotScanned += r.latestScan.pagesNotScanned;
  }
  return {
    projects: rows.length,
    projectsScanned,
    confirmed,
    potential,
    manualTasksOpen,
    pagesScanned,
    pagesNotScanned,
  };
}
