import { randomUUID } from 'node:crypto';
import { AppError, createProjectSchema, updateProjectSchema } from '@accessaudit/shared';
import { checkUrl } from '@accessaudit/security';
import { projectSettings, projects, withTenant, type Tx } from '@accessaudit/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { writeAudit } from '../audit.js';
import { parse } from '../errors.js';
import { requireOrg } from '../session.js';
import { param, uuidOr404 } from '../util.js';

const columns = {
  id: projects.id,
  name: projects.name,
  baseUrl: projects.baseUrl,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

/** Loads a live project in the active tenant context; cross-tenant or deleted ids are 404. */
export async function loadProject(tx: Tx, orgId: string, projectId: string) {
  const [p] = await tx
    .select(columns)
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, orgId),
        eq(projects.id, projectId),
        isNull(projects.deletedAt),
      ),
    );
  if (!p) throw new AppError('NOT_FOUND', 'Not found.');
  return p;
}

export function projectRoutes(app: FastifyInstance, deps: Deps): void {
  const ctx = (a: { orgId: string; userId: string }) => ({ orgId: a.orgId, userId: a.userId });

  app.post('/orgs/:orgId/projects', async (req, reply) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'member');
    const input = parse(createProjectSchema, req.body);
    // Saving a URL is not a fetch, but reject targets that could never be scanned.
    const chk = checkUrl(
      input.baseUrl,
      deps.config.ALLOW_PRIVATE_TARGETS ? { allowPrivateNetworks: true } : undefined,
    );
    if (!chk.ok)
      throw new AppError('URL_NOT_ALLOWED', 'This URL cannot be used.', { reason: chk.reason });
    const id = randomUUID();
    const project = await withTenant(deps.db, ctx(a), async (tx) => {
      const [p] = await tx
        .insert(projects)
        .values({
          id,
          organizationId: a.orgId,
          name: input.name,
          baseUrl: chk.url.origin,
          createdBy: a.userId,
        })
        .returning(columns);
      await tx.insert(projectSettings).values({ organizationId: a.orgId, projectId: id });
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'project.created',
        targetType: 'project',
        targetId: id,
      });
      return p;
    });
    return reply.status(201).send({ project });
  });

  app.get('/orgs/:orgId/projects', async (req) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'viewer');
    const rows = await withTenant(deps.db, ctx(a), (tx) =>
      tx
        .select(columns)
        .from(projects)
        .where(and(eq(projects.organizationId, a.orgId), isNull(projects.deletedAt)))
        .orderBy(asc(projects.name)),
    );
    return { projects: rows };
  });

  app.get('/orgs/:orgId/projects/:projectId', async (req) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'viewer');
    const pid = uuidOr404(param(req, 'projectId'));
    const project = await withTenant(deps.db, ctx(a), (tx) => loadProject(tx, a.orgId, pid));
    return { project };
  });

  app.patch('/orgs/:orgId/projects/:projectId', async (req) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'admin');
    const pid = uuidOr404(param(req, 'projectId'));
    const input = parse(updateProjectSchema, req.body);
    const project = await withTenant(deps.db, ctx(a), async (tx) => {
      await loadProject(tx, a.orgId, pid);
      const [p] = await tx
        .update(projects)
        .set({ name: input.name, updatedAt: deps.now() })
        .where(and(eq(projects.organizationId, a.orgId), eq(projects.id, pid)))
        .returning(columns);
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'project.updated',
        targetType: 'project',
        targetId: pid,
      });
      return p;
    });
    return { project };
  });

  // Soft delete: keeps history and audit trail intact; admins only.
  app.delete('/orgs/:orgId/projects/:projectId', async (req, reply) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'admin');
    const pid = uuidOr404(param(req, 'projectId'));
    await withTenant(deps.db, ctx(a), async (tx) => {
      await loadProject(tx, a.orgId, pid);
      await tx
        .update(projects)
        .set({ deletedAt: deps.now() })
        .where(and(eq(projects.organizationId, a.orgId), eq(projects.id, pid)));
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'project.deleted',
        targetType: 'project',
        targetId: pid,
      });
    });
    return reply.status(204).send();
  });
}
