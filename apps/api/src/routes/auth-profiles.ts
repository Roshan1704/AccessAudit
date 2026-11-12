import { AppError, createAuthProfileSchema } from '@accessaudit/shared';
import { authProfiles, authorizedDomains, withTenant } from '@accessaudit/db';
import { checkUrl, sealSecret } from '@accessaudit/security';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { writeAudit } from '../audit.js';
import { parse } from '../errors.js';
import { requireOrg } from '../session.js';
import { param, uuidOr404 } from '../util.js';
import { loadProject } from './projects.js';

/** Credentials are deliberately absent: they are write-only (ADR-031). */
const columns = {
  id: authProfiles.id,
  projectId: authProfiles.projectId,
  name: authProfiles.name,
  loginUrl: authProfiles.loginUrl,
  usernameSelector: authProfiles.usernameSelector,
  passwordSelector: authProfiles.passwordSelector,
  submitSelector: authProfiles.submitSelector,
  successSelector: authProfiles.successSelector,
  createdAt: authProfiles.createdAt,
};

const MAX_PER_PROJECT = 5;

export function authProfileRoutes(app: FastifyInstance, deps: Deps): void {
  const ctx = (a: { orgId: string; userId: string }) => ({ orgId: a.orgId, userId: a.userId });

  app.get('/orgs/:orgId/auth-profiles', async (req) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'member');
    const q = req.query as Record<string, string | undefined>;
    const projectId = q['projectId'] === undefined ? undefined : uuidOr404(q['projectId']);
    return withTenant(deps.db, ctx(a), async (tx) => {
      const rows = await tx
        .select(columns)
        .from(authProfiles)
        .where(
          and(
            eq(authProfiles.organizationId, a.orgId),
            ...(projectId ? [eq(authProfiles.projectId, projectId)] : []),
          ),
        )
        .orderBy(desc(authProfiles.createdAt))
        .limit(100);
      return { authProfiles: rows };
    });
  });

  app.post(
    '/orgs/:orgId/auth-profiles',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'admin');
      const keys = deps.credentialKeys;
      if (!keys)
        throw new AppError('VALIDATION_FAILED', 'Authenticated scanning is not configured.');
      const input = parse(createAuthProfileSchema, req.body);
      const chk = checkUrl(
        input.loginUrl,
        deps.config.ALLOW_PRIVATE_TARGETS ? { allowPrivateNetworks: true } : undefined,
      );
      if (!chk.ok)
        throw new AppError('URL_NOT_ALLOWED', 'This URL cannot be used.', { reason: chk.reason });

      const profile = await withTenant(deps.db, ctx(a), async (tx) => {
        const project = await loadProject(tx, a.orgId, input.projectId);
        const [domain] = await tx
          .select({ id: authorizedDomains.id })
          .from(authorizedDomains)
          .where(
            and(
              eq(authorizedDomains.projectId, project.id),
              eq(authorizedDomains.hostname, chk.url.hostname),
              eq(authorizedDomains.status, 'verified'),
            ),
          );
        if (!domain)
          throw new AppError('DOMAIN_NOT_VERIFIED', 'Verify ownership of the login domain first.');
        const existing = await tx
          .select({ id: authProfiles.id })
          .from(authProfiles)
          .where(eq(authProfiles.projectId, project.id));
        if (existing.length >= MAX_PER_PROJECT)
          throw new AppError('QUOTA_EXCEEDED', 'This project has too many login profiles.');
        const id = crypto.randomUUID();
        const [row] = await tx
          .insert(authProfiles)
          .values({
            id,
            organizationId: a.orgId,
            projectId: project.id,
            name: input.name,
            loginUrl: chk.url.href,
            usernameSelector: input.usernameSelector,
            passwordSelector: input.passwordSelector,
            submitSelector: input.submitSelector,
            successSelector: input.successSelector,
            usernameEnc: sealSecret(keys, input.username, `${id}:username`),
            passwordEnc: sealSecret(keys, input.password, `${id}:password`),
            keyId: keys.keyId,
            createdBy: a.userId,
          })
          .returning(columns);
        await writeAudit(deps, tx, req, {
          orgId: a.orgId,
          actorId: a.userId,
          action: 'auth_profile.created',
          targetType: 'auth_profile',
          targetId: id,
          metadata: { projectId: project.id, name: input.name },
        });
        return row;
      });
      return reply.status(201).send({ authProfile: profile });
    },
  );

  app.delete('/orgs/:orgId/auth-profiles/:profileId', async (req, reply) => {
    const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'admin');
    const pid = uuidOr404(param(req, 'profileId'));
    await withTenant(deps.db, ctx(a), async (tx) => {
      const gone = await tx
        .delete(authProfiles)
        .where(and(eq(authProfiles.organizationId, a.orgId), eq(authProfiles.id, pid)))
        .returning({ id: authProfiles.id });
      if (gone.length === 0) throw new AppError('NOT_FOUND', 'Not found.');
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'auth_profile.deleted',
        targetType: 'auth_profile',
        targetId: pid,
      });
    });
    return reply.status(204).send();
  });
}
