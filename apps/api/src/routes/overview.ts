import {
  accessibilityRules,
  crawledPages,
  findingComments,
  findingHistory,
  findings,
  manualVerificationTasks,
  projects,
  scans,
  users,
  withTenant,
} from '@accessaudit/db';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { compareRows, loadRows } from './compare.js';
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
      if (projectIds.length === 0)
        return {
          projects: [],
          totals: totalsOf([]),
          failedScans: [],
          topFindings: [],
          recentActivity: [],
        };

      const completed = await tx
        .selectDistinctOn([scans.projectId], {
          id: scans.id,
          projectId: scans.projectId,
          finishedAt: scans.finishedAt,
          wcagVersion: scans.wcagVersion,
          conformanceLevel: scans.conformanceLevel,
          maxPages: scans.maxPages,
          createdAt: scans.createdAt,
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
      const completedAt = new Map(completed.map((s) => [s.projectId, s.createdAt]));

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

      // Change since the previous completed scan of the same project. Uses the same comparison as
      // the scan compare view, so a page that was not scanned again never counts as resolved.
      const change = new Map<string, { added: number; regressed: number; resolved: number }>();
      for (const s of completed) {
        const [prev] = await tx
          .select({ id: scans.id })
          .from(scans)
          .where(
            and(
              eq(scans.projectId, s.projectId),
              eq(scans.status, 'completed'),
              lt(scans.createdAt, sql`(select created_at from scans where id = ${s.id})`),
            ),
          )
          .orderBy(desc(scans.createdAt))
          .limit(1);
        if (!prev) continue;
        const scannedRows = await tx
          .select({ url: crawledPages.url })
          .from(crawledPages)
          .where(and(eq(crawledPages.scanId, s.id), eq(crawledPages.status, 'scanned')));
        const diff = compareRows(
          await loadRows(tx, prev.id),
          await loadRows(tx, s.id),
          new Set(scannedRows.map((r) => r.url)),
        );
        change.set(s.id, {
          added: diff.added.filter(isReal).length,
          regressed: diff.regressed.filter(isReal).length,
          resolved: diff.resolved.filter(isReal).length,
        });
      }

      // Scans that failed after the project's latest completed scan (or with none): nothing
      // current exists for them, so they need a person.
      const failedRows = await tx
        .select({
          id: scans.id,
          projectId: scans.projectId,
          failureReason: scans.failureReason,
          createdAt: scans.createdAt,
        })
        .from(scans)
        .where(
          and(
            eq(scans.organizationId, a.orgId),
            eq(scans.status, 'failed'),
            inArray(scans.projectId, projectIds),
          ),
        )
        .orderBy(desc(scans.createdAt))
        .limit(50);
      const failedScans = failedRows
        .filter((f) => {
          const c = completedAt.get(f.projectId);
          return c === undefined || f.createdAt > c;
        })
        .slice(0, 5)
        .map((f) => ({
          id: f.id,
          projectId: f.projectId,
          projectName: projectRows.find((p) => p.id === f.projectId)?.name ?? '',
          failureReason: f.failureReason,
          createdAt: f.createdAt,
        }));

      const topFindings = scanIds.length
        ? (
            await tx
              .select({
                id: findings.id,
                scanId: findings.scanId,
                severity: findings.severity,
                ruleTitle: accessibilityRules.title,
                pageUrl: crawledPages.url,
                selector: findings.selector,
              })
              .from(findings)
              .innerJoin(accessibilityRules, eq(accessibilityRules.id, findings.ruleId))
              .innerJoin(crawledPages, eq(crawledPages.id, findings.pageId))
              .where(
                and(
                  inArray(findings.scanId, scanIds),
                  eq(findings.reviewStatus, 'open'),
                  eq(findings.classification, 'confirmed'),
                  inArray(findings.severity, ['critical', 'serious']),
                ),
              )
              .orderBy(
                sql`case ${findings.severity} when 'critical' then 0 else 1 end`,
                desc(findings.occurrences),
              )
              .limit(5)
          ).map((f) => ({
            ...f,
            projectName:
              projectRows.find((p) => p.id === completed.find((c) => c.id === f.scanId)?.projectId)
                ?.name ?? '',
          }))
        : [];

      const recentActivity = await loadActivity(tx, a.orgId, projectRows);

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
            // null when there is no earlier completed scan to compare with
            change: change.get(s.id) ?? null,
          },
        };
      });
      return {
        projects: out,
        totals: totalsOf(out),
        failedScans,
        topFindings,
        recentActivity,
      };
    });
  });
}

const isReal = (r: { classification: string }) =>
  r.classification === 'confirmed' || r.classification === 'strong_potential';

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

/** Newest team activity: finished scans, comments and status or assignee changes. */
async function loadActivity(
  tx: Tx,
  orgId: string,
  projectRows: { id: string; name: string }[],
): Promise<
  {
    kind: 'scan' | 'comment' | 'status' | 'assignee';
    at: Date;
    text: string;
    href: { scanId?: string; findingId?: string; projectId?: string };
  }[]
> {
  const items: Awaited<ReturnType<typeof loadActivity>> = [];
  const projectIds = projectRows.map((p) => p.id);
  const name = (id: string) => projectRows.find((p) => p.id === id)?.name ?? 'a project';

  const recentScans = await tx
    .select({
      id: scans.id,
      projectId: scans.projectId,
      status: scans.status,
      at: scans.finishedAt,
    })
    .from(scans)
    .where(
      and(
        eq(scans.organizationId, orgId),
        inArray(scans.status, ['completed', 'failed']),
        inArray(scans.projectId, projectIds),
        isNotNull(scans.finishedAt),
      ),
    )
    .orderBy(desc(scans.finishedAt))
    .limit(8);
  for (const s of recentScans) {
    if (!s.at) continue;
    items.push({
      kind: 'scan',
      at: s.at,
      text: `Scan ${s.status} for ${name(s.projectId)}`,
      href: { scanId: s.id },
    });
  }

  const comments = await tx
    .select({
      findingId: findingComments.findingId,
      at: findingComments.createdAt,
      author: users.name,
    })
    .from(findingComments)
    .leftJoin(users, eq(users.id, findingComments.authorId))
    .where(eq(findingComments.organizationId, orgId))
    .orderBy(desc(findingComments.createdAt))
    .limit(8);
  for (const c of comments)
    items.push({
      kind: 'comment',
      at: c.at,
      text: `${c.author ?? 'A former member'} commented on a finding`,
      href: { findingId: c.findingId },
    });

  const history = await tx
    .select({
      findingId: findingHistory.findingId,
      kind: findingHistory.kind,
      toValue: findingHistory.toValue,
      at: findingHistory.createdAt,
      actor: users.name,
    })
    .from(findingHistory)
    .leftJoin(users, eq(users.id, findingHistory.actorId))
    .where(eq(findingHistory.organizationId, orgId))
    .orderBy(desc(findingHistory.createdAt))
    .limit(8);
  for (const h of history) {
    const who = h.actor ?? 'A former member';
    const isStatus = h.kind === 'status';
    items.push({
      kind: isStatus ? 'status' : 'assignee',
      at: h.at,
      text: isStatus
        ? `${who} set a finding to ${(h.toValue ?? 'none').replaceAll('_', ' ')}`
        : `${who} changed a finding's assignee`,
      href: { findingId: h.findingId },
    });
  }
  return items.sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, 8);
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
