import { AppError, createScheduleSchema, updateScheduleSchema } from '@accessaudit/shared';
import { scanSchedules, withTenant } from '@accessaudit/db';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { writeAudit } from '../audit.js';
import { parse } from '../errors.js';
import { requireOrg } from '../session.js';
import { param, uuidOr404 } from '../util.js';
import { loadProject } from './projects.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const intervalMs = (f: string): number => (f === 'weekly' ? 7 * DAY_MS : DAY_MS);

const columns = {
  id: scanSchedules.id,
  projectId: scanSchedules.projectId,
  frequency: scanSchedules.frequency,
  maxPages: scanSchedules.maxPages,
  wcagVersion: scanSchedules.wcagVersion,
  conformanceLevel: scanSchedules.conformanceLevel,
  interactionTests: scanSchedules.interactionTests,
  enabled: scanSchedules.enabled,
  nextRunAt: scanSchedules.nextRunAt,
  lastRunAt: scanSchedules.lastRunAt,
  lastScanId: scanSchedules.lastScanId,
  lastError: scanSchedules.lastError,
  createdAt: scanSchedules.createdAt,
};

const MAX_PER_PROJECT = 3;

export function scheduleRoutes(app: FastifyInstance, deps: Deps): void {
  const ctx = (a: { orgId: string; userId: string }) => ({ orgId: a.orgId, userId: a.userId });

  app.get('/orgs/:orgId/schedules', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
    const q = req.query as Record<string, string | undefined>;
    const projectId = q['projectId'] === undefined ? undefined : uuidOr404(q['projectId']);
    return withTenant(deps.db, ctx(a), async (tx) => {
      const rows = await tx
        .select(columns)
        .from(scanSchedules)
        .where(
          and(
            eq(scanSchedules.organizationId, a.orgId),
            ...(projectId ? [eq(scanSchedules.projectId, projectId)] : []),
          ),
        )
        .orderBy(desc(scanSchedules.createdAt))
        .limit(100);
      return { schedules: rows };
    });
  });

  app.post(
    '/orgs/:orgId/schedules',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'admin');
      const input = parse(createScheduleSchema, req.body);
      const schedule = await withTenant(deps.db, ctx(a), async (tx) => {
        const project = await loadProject(tx, a.orgId, input.projectId);
        const existing = await tx
          .select({ id: scanSchedules.id })
          .from(scanSchedules)
          .where(eq(scanSchedules.projectId, project.id));
        if (existing.length >= MAX_PER_PROJECT)
          throw new AppError('QUOTA_EXCEEDED', 'This project has too many schedules.');
        const [row] = await tx
          .insert(scanSchedules)
          .values({
            organizationId: a.orgId,
            projectId: project.id,
            frequency: input.frequency,
            maxPages: input.maxPages,
            wcagVersion: input.wcagVersion,
            conformanceLevel: input.level,
            interactionTests: input.interactionTests,
            nextRunAt: new Date(deps.now().getTime() + intervalMs(input.frequency)),
            createdBy: a.userId,
          })
          .returning(columns);
        await writeAudit(deps, tx, req, {
          orgId: a.orgId,
          actorId: a.userId,
          action: 'schedule.created',
          targetType: 'schedule',
          targetId: row?.id,
          metadata: { projectId: project.id, frequency: input.frequency },
        });
        return row;
      });
      return reply.status(201).send({ schedule });
    },
  );

  app.patch('/orgs/:orgId/schedules/:scheduleId', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'admin');
    const sid = uuidOr404(param(req, 'scheduleId'));
    const input = parse(updateScheduleSchema, req.body);
    const schedule = await withTenant(deps.db, ctx(a), async (tx) => {
      const [row] = await tx
        .update(scanSchedules)
        .set({
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.frequency !== undefined
            ? {
                frequency: input.frequency,
                nextRunAt: new Date(deps.now().getTime() + intervalMs(input.frequency)),
              }
            : {}),
          updatedAt: deps.now(),
        })
        .where(and(eq(scanSchedules.organizationId, a.orgId), eq(scanSchedules.id, sid)))
        .returning(columns);
      if (!row) throw new AppError('NOT_FOUND', 'Not found.');
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'schedule.updated',
        targetType: 'schedule',
        targetId: sid,
        metadata: { ...input },
      });
      return row;
    });
    return { schedule };
  });

  app.delete('/orgs/:orgId/schedules/:scheduleId', async (req, reply) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'admin');
    const sid = uuidOr404(param(req, 'scheduleId'));
    await withTenant(deps.db, ctx(a), async (tx) => {
      const gone = await tx
        .delete(scanSchedules)
        .where(and(eq(scanSchedules.organizationId, a.orgId), eq(scanSchedules.id, sid)))
        .returning({ id: scanSchedules.id });
      if (gone.length === 0) throw new AppError('NOT_FOUND', 'Not found.');
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'schedule.deleted',
        targetType: 'schedule',
        targetId: sid,
      });
    });
    return reply.status(204).send();
  });
}
