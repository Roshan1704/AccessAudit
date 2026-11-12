import { buildExplainInput, defaultProvider } from '@accessaudit/ai';
import {
  AppError,
  findingCommentSchema,
  resolveTaskSchema,
  startScanSchema,
  updateFindingSchema,
} from '@accessaudit/shared';
import {
  accessibilityRules,
  crawledPages,
  findingComments,
  findingEvidence,
  findingHistory,
  findings,
  manualVerificationTasks,
  organizationMembers,
  scans,
  withTenant,
} from '@accessaudit/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { writeAudit } from '../audit.js';
import { parse } from '../errors.js';
import { requireOrg } from '../session.js';
import { param, uuidOr404 } from '../util.js';
import { insertScan } from '../scan-create.js';

const CLASSIFICATIONS = [
  'confirmed',
  'strong_potential',
  'manual_verification',
  'informational',
] as const;
const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'] as const;
const REVIEWS = ['open', 'false_positive', 'accepted_risk', 'fixed'] as const;

const scanColumns = {
  id: scans.id,
  projectId: scans.projectId,
  status: scans.status,
  startUrl: scans.startUrl,
  maxPages: scans.maxPages,
  wcagVersion: scans.wcagVersion,
  conformanceLevel: scans.conformanceLevel,
  interactionTests: scans.interactionTests,
  failureReason: scans.failureReason,
  engineVersions: scans.engineVersions,
  startedAt: scans.startedAt,
  finishedAt: scans.finishedAt,
  createdAt: scans.createdAt,
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function scanRoutes(app: FastifyInstance, deps: Deps): void {
  const ctx = (a: { orgId: string; userId: string }) => ({ orgId: a.orgId, userId: a.userId });

  app.post(
    '/orgs/:orgId/scans',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'member');
      const input = parse(startScanSchema, req.body);
      if (input.robotsOverride && a.role !== 'admin' && a.role !== 'owner')
        throw new AppError('FORBIDDEN', 'Only admins can override robots.txt.');

      const scanId = await withTenant(deps.db, ctx(a), async (tx) => {
        const created = await insertScan(deps, tx, {
          orgId: a.orgId,
          projectId: input.projectId,
          startUrl: input.startUrl,
          maxPages: input.maxPages,
          wcagVersion: input.wcagVersion,
          level: input.level,
          interactionTests: input.interactionTests,
          authProfileId: input.authProfileId,
          configSnapshot: input.robotsOverride
            ? { robotsOverride: { reason: input.robotsOverride.reason, by: a.userId } }
            : {},
          createdBy: a.userId,
        });
        await writeAudit(deps, tx, req, {
          orgId: a.orgId,
          actorId: a.userId,
          action: input.robotsOverride ? 'scan.created_robots_override' : 'scan.created',
          targetType: 'scan',
          targetId: created.scanId,
          metadata: {
            projectId: created.projectId,
            maxPages: input.maxPages,
            ...(input.robotsOverride ? { reason: input.robotsOverride.reason } : {}),
          },
        });
        return created.scanId;
      });

      try {
        await deps.scanQueue.enqueue({ orgId: a.orgId, scanId });
      } catch {
        await withTenant(deps.db, ctx(a), (tx) =>
          tx
            .update(scans)
            .set({ status: 'failed', failureReason: 'queue_unavailable', finishedAt: new Date() })
            .where(eq(scans.id, scanId)),
        );
        throw new AppError('INTERNAL', 'Scan could not be queued. Try again shortly.');
      }
      const [scan] = await withTenant(deps.db, ctx(a), (tx) =>
        tx.select(scanColumns).from(scans).where(eq(scans.id, scanId)),
      );
      return reply.status(202).send({ scan });
    },
  );

  app.get('/orgs/:orgId/scans', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    const q = req.query as Record<string, string | undefined>;
    const projectId = q['projectId'] === undefined ? undefined : uuidOr404(q['projectId']);
    return withTenant(deps.db, ctx(a), async (tx) => {
      const rows = await tx
        .select(scanColumns)
        .from(scans)
        .where(
          and(
            eq(scans.organizationId, a.orgId),
            ...(projectId ? [eq(scans.projectId, projectId)] : []),
          ),
        )
        .orderBy(desc(scans.createdAt))
        .limit(50);
      const counts =
        rows.length === 0
          ? []
          : await tx
              .select({
                scanId: findings.scanId,
                classification: findings.classification,
                n: sql<number>`count(*)::int`,
              })
              .from(findings)
              .where(
                and(
                  inArray(
                    findings.scanId,
                    rows.map((r) => r.id),
                  ),
                  eq(findings.reviewStatus, 'open'),
                  inArray(findings.classification, ['confirmed', 'strong_potential']),
                ),
              )
              .groupBy(findings.scanId, findings.classification);
      return {
        scans: rows.map((r) => ({
          ...r,
          openConfirmed:
            counts.find((c) => c.scanId === r.id && c.classification === 'confirmed')?.n ?? 0,
          openPotential:
            counts.find((c) => c.scanId === r.id && c.classification === 'strong_potential')?.n ??
            0,
        })),
      };
    });
  });

  app.get('/orgs/:orgId/scans/:scanId', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    const scanId = uuidOr404(param(req, 'scanId'));
    return withTenant(deps.db, ctx(a), async (tx) => {
      const [scan] = await tx.select(scanColumns).from(scans).where(eq(scans.id, scanId));
      if (!scan) throw new AppError('NOT_FOUND', 'Not found.');
      const byClass = await tx
        .select({ key: findings.classification, n: sql<number>`count(*)::int` })
        .from(findings)
        .where(and(eq(findings.scanId, scanId), eq(findings.reviewStatus, 'open')))
        .groupBy(findings.classification);
      const bySeverity = await tx
        .select({ key: findings.severity, n: sql<number>`count(*)::int` })
        .from(findings)
        .where(
          and(
            eq(findings.scanId, scanId),
            eq(findings.reviewStatus, 'open'),
            inArray(findings.classification, ['confirmed', 'strong_potential']),
          ),
        )
        .groupBy(findings.severity);
      const pages = await tx
        .select({
          id: crawledPages.id,
          url: crawledPages.url,
          title: crawledPages.title,
          status: crawledPages.status,
          failureReason: crawledPages.failureReason,
          httpStatus: crawledPages.httpStatus,
          domNodes: crawledPages.domNodes,
          depth: crawledPages.depth,
          confirmed: sql<number>`(select count(*)::int from findings f where f.page_id = crawled_pages.id and f.classification = 'confirmed')`,
          potential: sql<number>`(select count(*)::int from findings f where f.page_id = crawled_pages.id and f.classification = 'strong_potential')`,
          manual: sql<number>`(select count(*)::int from findings f where f.page_id = crawled_pages.id and f.classification = 'manual_verification')`,
        })
        .from(crawledPages)
        .where(eq(crawledPages.scanId, scanId))
        .orderBy(asc(crawledPages.depth), asc(crawledPages.url));
      const tasks = await tx
        .select({ key: manualVerificationTasks.status, n: sql<number>`count(*)::int` })
        .from(manualVerificationTasks)
        .where(eq(manualVerificationTasks.scanId, scanId))
        .groupBy(manualVerificationTasks.status);
      const count = (rows: { key: string; n: number }[]) =>
        Object.fromEntries(rows.map((r) => [r.key, r.n]));
      return {
        scan,
        summary: {
          // Counts stay separate on purpose: confirmed violations, likely issues and human checks differ in certainty.
          byClassification: count(byClass),
          bySeverity: count(bySeverity),
          manualTasks: count(tasks),
          pagesScanned: pages.filter((p) => p.status === 'scanned').length,
          pagesNotScanned: pages.filter((p) => p.status !== 'scanned').length,
        },
        pages,
      };
    });
  });

  app.post('/orgs/:orgId/scans/:scanId/cancel', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'member');
    const scanId = uuidOr404(param(req, 'scanId'));
    return withTenant(deps.db, ctx(a), async (tx) => {
      const [scan] = await tx
        .update(scans)
        .set({ status: 'cancelled', finishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(scans.id, scanId), inArray(scans.status, ['queued', 'running'])))
        .returning(scanColumns);
      if (!scan) {
        const [exists] = await tx.select({ id: scans.id }).from(scans).where(eq(scans.id, scanId));
        if (!exists) throw new AppError('NOT_FOUND', 'Not found.');
        throw new AppError('CONFLICT', 'This scan has already finished.');
      }
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'scan.cancelled',
        targetType: 'scan',
        targetId: scanId,
      });
      return { scan };
    });
  });

  app.get('/orgs/:orgId/scans/:scanId/findings', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    const scanId = uuidOr404(param(req, 'scanId'));
    const q = req.query as Record<string, string | undefined>;
    const classification = oneOf(q['classification'], CLASSIFICATIONS);
    const severity = oneOf(q['severity'], SEVERITIES);
    const review = oneOf(q['review'], REVIEWS);
    const pageId = q['pageId'] === undefined ? undefined : uuidOr404(q['pageId']);
    const rows = await withTenant(deps.db, ctx(a), async (tx) => {
      const [scan] = await tx.select({ id: scans.id }).from(scans).where(eq(scans.id, scanId));
      if (!scan) throw new AppError('NOT_FOUND', 'Not found.');
      return tx
        .select({
          id: findings.id,
          ruleId: findings.ruleId,
          ruleTitle: accessibilityRules.title,
          classification: findings.classification,
          confidence: findings.confidence,
          severity: findings.severity,
          wcagCriteria: findings.wcagCriteria,
          message: findings.message,
          selector: findings.selector,
          occurrences: findings.occurrences,
          reviewStatus: findings.reviewStatus,
          pageId: findings.pageId,
          pageUrl: crawledPages.url,
        })
        .from(findings)
        .innerJoin(accessibilityRules, eq(accessibilityRules.id, findings.ruleId))
        .innerJoin(crawledPages, eq(crawledPages.id, findings.pageId))
        .where(
          and(
            eq(findings.scanId, scanId),
            ...(classification ? [eq(findings.classification, classification)] : []),
            ...(severity ? [eq(findings.severity, severity)] : []),
            ...(review ? [eq(findings.reviewStatus, review)] : []),
            ...(pageId ? [eq(findings.pageId, pageId)] : []),
          ),
        )
        .orderBy(
          sql`array_position(array['critical','serious','moderate','minor']::text[], ${findings.severity}::text)`,
          desc(findings.confidence),
        )
        .limit(500);
    });
    return { findings: rows };
  });

  app.get('/orgs/:orgId/findings/:findingId', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    const findingId = uuidOr404(param(req, 'findingId'));
    return withTenant(deps.db, ctx(a), async (tx) => {
      const [finding] = await tx
        .select({
          id: findings.id,
          scanId: findings.scanId,
          ruleId: findings.ruleId,
          ruleTitle: accessibilityRules.title,
          ruleDescription: accessibilityRules.description,
          helpUrl: accessibilityRules.helpUrl,
          classification: findings.classification,
          confidence: findings.confidence,
          severity: findings.severity,
          wcagCriteria: findings.wcagCriteria,
          message: findings.message,
          selector: findings.selector,
          occurrences: findings.occurrences,
          reviewStatus: findings.reviewStatus,
          reviewedAt: findings.reviewedAt,
          assigneeId: findings.assigneeId,
          pageUrl: crawledPages.url,
        })
        .from(findings)
        .innerJoin(accessibilityRules, eq(accessibilityRules.id, findings.ruleId))
        .innerJoin(crawledPages, eq(crawledPages.id, findings.pageId))
        .where(eq(findings.id, findingId));
      if (!finding) throw new AppError('NOT_FOUND', 'Not found.');
      const evidence = await tx
        .select({
          id: findingEvidence.id,
          kind: findingEvidence.kind,
          content: findingEvidence.content,
          blobBase64: findingEvidence.blobBase64,
          contentType: findingEvidence.contentType,
        })
        .from(findingEvidence)
        .where(eq(findingEvidence.findingId, findingId))
        .orderBy(asc(findingEvidence.createdAt));
      const tasks = await tx
        .select({
          id: manualVerificationTasks.id,
          instructions: manualVerificationTasks.instructions,
          status: manualVerificationTasks.status,
          note: manualVerificationTasks.note,
        })
        .from(manualVerificationTasks)
        .where(eq(manualVerificationTasks.findingId, findingId));
      return { finding, evidence, tasks };
    });
  });

  /** Explanation and remediation. Only redacted rule metadata reaches the provider (no URLs, selectors or evidence). */
  app.get('/orgs/:orgId/findings/:findingId/explanation', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    const findingId = uuidOr404(param(req, 'findingId'));
    const input = await withTenant(deps.db, ctx(a), async (tx) => {
      const [f] = await tx
        .select({
          ruleId: findings.ruleId,
          ruleTitle: accessibilityRules.title,
          ruleDescription: accessibilityRules.description,
          wcagCriteria: findings.wcagCriteria,
          severity: findings.severity,
          classification: findings.classification,
          message: findings.message,
        })
        .from(findings)
        .innerJoin(accessibilityRules, eq(accessibilityRules.id, findings.ruleId))
        .where(eq(findings.id, findingId));
      if (!f) throw new AppError('NOT_FOUND', 'Not found.');
      return buildExplainInput(f);
    });
    return { explanation: await defaultProvider().explain(input) };
  });

  app.patch('/orgs/:orgId/findings/:findingId', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'member');
    const findingId = uuidOr404(param(req, 'findingId'));
    const input = parse(updateFindingSchema, req.body);
    return withTenant(deps.db, ctx(a), async (tx) => {
      const [current] = await tx
        .select({ reviewStatus: findings.reviewStatus, assigneeId: findings.assigneeId })
        .from(findings)
        .where(eq(findings.id, findingId));
      if (!current) throw new AppError('NOT_FOUND', 'Not found.');

      const set: Partial<typeof findings.$inferInsert> = {};
      const history: { kind: string; fromValue: string | null; toValue: string | null }[] = [];

      if (input.status !== undefined && input.status !== current.reviewStatus) {
        set.reviewStatus = input.status;
        set.reviewedBy = input.status === 'open' ? null : a.userId;
        set.reviewedAt = input.status === 'open' ? null : new Date();
        history.push({ kind: 'status', fromValue: current.reviewStatus, toValue: input.status });
      }
      if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
        if (input.assigneeId !== null) {
          const [member] = await tx
            .select({ userId: organizationMembers.userId })
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.organizationId, a.orgId),
                eq(organizationMembers.userId, input.assigneeId),
              ),
            );
          if (!member)
            throw new AppError('VALIDATION_FAILED', 'Assignee is not an organisation member.');
        }
        set.assigneeId = input.assigneeId;
        history.push({
          kind: 'assignee',
          fromValue: current.assigneeId,
          toValue: input.assigneeId,
        });
      }

      if (history.length > 0) {
        await tx.update(findings).set(set).where(eq(findings.id, findingId));
        await tx
          .insert(findingHistory)
          .values(
            history.map((h) => ({ ...h, organizationId: a.orgId, findingId, actorId: a.userId })),
          );
        await writeAudit(deps, tx, req, {
          orgId: a.orgId,
          actorId: a.userId,
          action: input.status !== undefined ? 'finding.reviewed' : 'finding.assigned',
          targetType: 'finding',
          targetId: findingId,
          metadata: { status: input.status ?? null, assigneeId: input.assigneeId ?? null },
        });
      }
      const [row] = await tx
        .select({
          id: findings.id,
          reviewStatus: findings.reviewStatus,
          assigneeId: findings.assigneeId,
        })
        .from(findings)
        .where(eq(findings.id, findingId));
      return { finding: row };
    });
  });

  app.get('/orgs/:orgId/findings/:findingId/activity', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    const findingId = uuidOr404(param(req, 'findingId'));
    return withTenant(deps.db, ctx(a), async (tx) => {
      const [f] = await tx
        .select({ id: findings.id })
        .from(findings)
        .where(eq(findings.id, findingId));
      if (!f) throw new AppError('NOT_FOUND', 'Not found.');
      const comments = await tx
        .select({
          id: findingComments.id,
          authorId: findingComments.authorId,
          body: findingComments.body,
          createdAt: findingComments.createdAt,
        })
        .from(findingComments)
        .where(eq(findingComments.findingId, findingId))
        .orderBy(asc(findingComments.createdAt))
        .limit(200);
      const history = await tx
        .select({
          id: findingHistory.id,
          actorId: findingHistory.actorId,
          kind: findingHistory.kind,
          fromValue: findingHistory.fromValue,
          toValue: findingHistory.toValue,
          createdAt: findingHistory.createdAt,
        })
        .from(findingHistory)
        .where(eq(findingHistory.findingId, findingId))
        .orderBy(asc(findingHistory.createdAt))
        .limit(200);
      return { comments, history };
    });
  });

  app.post('/orgs/:orgId/findings/:findingId/comments', async (req, reply) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'member');
    const findingId = uuidOr404(param(req, 'findingId'));
    const input = parse(findingCommentSchema, req.body);
    const comment = await withTenant(deps.db, ctx(a), async (tx) => {
      const [f] = await tx
        .select({ id: findings.id })
        .from(findings)
        .where(eq(findings.id, findingId));
      if (!f) throw new AppError('NOT_FOUND', 'Not found.');
      const [row] = await tx
        .insert(findingComments)
        .values({ organizationId: a.orgId, findingId, authorId: a.userId, body: input.body })
        .returning({
          id: findingComments.id,
          authorId: findingComments.authorId,
          body: findingComments.body,
          createdAt: findingComments.createdAt,
        });
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'finding.commented',
        targetType: 'finding',
        targetId: findingId,
        metadata: {},
      });
      return row;
    });
    return reply.code(201).send({ comment });
  });

  app.get('/orgs/:orgId/scans/:scanId/manual-tasks', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    const scanId = uuidOr404(param(req, 'scanId'));
    const rows = await withTenant(deps.db, ctx(a), (tx) =>
      tx
        .select({
          id: manualVerificationTasks.id,
          ruleId: manualVerificationTasks.ruleId,
          ruleTitle: accessibilityRules.title,
          wcagCriteria: accessibilityRules.wcagCriteria,
          findingId: manualVerificationTasks.findingId,
          instructions: manualVerificationTasks.instructions,
          status: manualVerificationTasks.status,
          note: manualVerificationTasks.note,
        })
        .from(manualVerificationTasks)
        .innerJoin(accessibilityRules, eq(accessibilityRules.id, manualVerificationTasks.ruleId))
        .where(eq(manualVerificationTasks.scanId, scanId))
        .orderBy(asc(manualVerificationTasks.status), asc(manualVerificationTasks.createdAt)),
    );
    return { tasks: rows };
  });

  app.patch('/orgs/:orgId/manual-tasks/:taskId', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'member');
    const taskId = uuidOr404(param(req, 'taskId'));
    const input = parse(resolveTaskSchema, req.body);
    return withTenant(deps.db, ctx(a), async (tx) => {
      const [row] = await tx
        .update(manualVerificationTasks)
        .set({
          status: input.status,
          note: input.note ?? null,
          resolvedBy: a.userId,
          resolvedAt: new Date(),
        })
        .where(eq(manualVerificationTasks.id, taskId))
        .returning({ id: manualVerificationTasks.id, status: manualVerificationTasks.status });
      if (!row) throw new AppError('NOT_FOUND', 'Not found.');
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'manual_task.resolved',
        targetType: 'manual_task',
        targetId: taskId,
        metadata: { status: input.status },
      });
      return { task: row };
    });
  });
}
