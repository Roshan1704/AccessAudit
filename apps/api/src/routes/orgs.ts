import { randomUUID } from 'node:crypto';
import {
  AppError,
  changeRoleSchema,
  createOrgSchema,
  inviteSchema,
  roleAtLeast,
  type Role,
} from '@accessaudit/shared';
import { generateToken, hashToken } from '@accessaudit/security';
import {
  invitations,
  organizationMembers,
  organizations,
  users,
  withTenant,
} from '@accessaudit/db';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { writeAudit } from '../audit.js';
import { parse } from '../errors.js';
import { requireOrg, requireUser } from '../session.js';
import { param, uuidOr404 } from '../util.js';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const acceptSchema = z.object({ token: z.string().min(20).max(200) }).strict();

export function orgRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/orgs', async (req, reply) => {
    const auth = await requireUser(deps, req);
    const input = parse(createOrgSchema, req.body);
    const orgId = randomUUID();
    const org = await withTenant(deps.db, { orgId, userId: auth.userId }, async (tx) => {
      const [o] = await tx
        .insert(organizations)
        .values({ id: orgId, name: input.name, slug: input.slug })
        .returning();
      await tx
        .insert(organizationMembers)
        .values({ organizationId: orgId, userId: auth.userId, role: 'owner' });
      await writeAudit(deps, tx, req, {
        orgId,
        actorId: auth.userId,
        action: 'org.created',
        targetType: 'organization',
        targetId: orgId,
      });
      return o;
    });
    if (!org) throw new Error('insert returned no row');
    return reply.status(201).send({
      organization: { id: org.id, name: org.name, slug: org.slug, role: 'owner' },
    });
  });

  app.get('/orgs', async (req) => {
    const auth = await requireUser(deps, req);
    const rows = await withTenant(deps.db, { userId: auth.userId }, (tx) =>
      tx
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          role: organizationMembers.role,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(and(eq(organizationMembers.userId, auth.userId), isNull(organizations.deletedAt))),
    );
    return { organizations: rows };
  });

  app.get('/orgs/:orgId', async (req) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'viewer');
    const [o] = await withTenant(deps.db, { orgId: a.orgId, userId: a.userId }, (tx) =>
      tx.select().from(organizations).where(eq(organizations.id, a.orgId)),
    );
    if (!o) throw new AppError('NOT_FOUND', 'Not found.');
    return {
      organization: { id: o.id, name: o.name, slug: o.slug, role: a.role, createdAt: o.createdAt },
    };
  });

  app.patch('/orgs/:orgId', async (req) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'admin');
    const input = parse(z.object({ name: createOrgSchema.shape.name }).strict(), req.body);
    const [o] = await withTenant(deps.db, { orgId: a.orgId, userId: a.userId }, async (tx) => {
      const r = await tx
        .update(organizations)
        .set({ name: input.name, updatedAt: deps.now() })
        .where(eq(organizations.id, a.orgId))
        .returning();
      await writeAudit(deps, tx, req, { orgId: a.orgId, actorId: a.userId, action: 'org.renamed' });
      return r;
    });
    if (!o) throw new AppError('NOT_FOUND', 'Not found.');
    return { organization: { id: o.id, name: o.name, slug: o.slug, role: a.role } };
  });

  // ------------------------------------------------------------ members
  app.get('/orgs/:orgId/members', async (req) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'viewer');
    const rows = await withTenant(deps.db, { orgId: a.orgId, userId: a.userId }, (tx) =>
      tx
        .select({
          userId: organizationMembers.userId,
          role: organizationMembers.role,
          email: users.email,
          name: users.name,
          joinedAt: organizationMembers.createdAt,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, a.orgId)),
    );
    return { members: rows };
  });

  /** Admins manage member/viewer/admin; only owners may grant, change or remove the owner role. */
  const assertCanManage = (actor: Role, targetCurrent: Role, targetNew: Role | null): void => {
    if (!roleAtLeast(actor, 'admin')) throw new AppError('FORBIDDEN', 'Insufficient permissions.');
    if ((targetCurrent === 'owner' || targetNew === 'owner') && actor !== 'owner') {
      throw new AppError('FORBIDDEN', 'Only owners can manage owners.');
    }
  };

  app.patch('/orgs/:orgId/members/:userId', async (req) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'admin');
    const targetId = uuidOr404(param(req, 'userId'));
    const { role } = parse(changeRoleSchema, req.body);
    await withTenant(deps.db, { orgId: a.orgId, userId: a.userId }, async (tx) => {
      const [m] = await tx
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, a.orgId),
            eq(organizationMembers.userId, targetId),
          ),
        );
      if (!m) throw new AppError('NOT_FOUND', 'Not found.');
      assertCanManage(a.role, m.role, role);
      // The DB's deferred last-owner trigger is the backstop; it surfaces as 409 CONFLICT at commit.
      await tx
        .update(organizationMembers)
        .set({ role, updatedAt: deps.now() })
        .where(
          and(
            eq(organizationMembers.organizationId, a.orgId),
            eq(organizationMembers.userId, targetId),
          ),
        );
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'member.role_changed',
        targetType: 'user',
        targetId,
        metadata: { from: m.role, to: role },
      });
    });
    return { member: { userId: targetId, role } };
  });

  app.delete('/orgs/:orgId/members/:userId', async (req, reply) => {
    // Any member may remove themselves; removing others needs admin.
    const targetId = uuidOr404(param(req, 'userId'));
    const self = (await requireUser(deps, req)).userId === targetId;
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', self ? 'viewer' : 'admin');
    await withTenant(deps.db, { orgId: a.orgId, userId: a.userId }, async (tx) => {
      const [m] = await tx
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, a.orgId),
            eq(organizationMembers.userId, targetId),
          ),
        );
      if (!m) throw new AppError('NOT_FOUND', 'Not found.');
      if (!self) assertCanManage(a.role, m.role, null);
      await tx
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, a.orgId),
            eq(organizationMembers.userId, targetId),
          ),
        );
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: self ? 'member.left' : 'member.removed',
        targetType: 'user',
        targetId,
      });
    });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------ invitations
  app.post('/orgs/:orgId/invitations', async (req, reply) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'admin');
    const input = parse(inviteSchema, req.body);
    // Token embeds the org id so acceptance can establish tenant context; only the hash is stored.
    const token = `${a.orgId}.${generateToken(32)}`;
    const inv = await withTenant(deps.db, { orgId: a.orgId, userId: a.userId }, async (tx) => {
      const [row] = await tx
        .insert(invitations)
        .values({
          organizationId: a.orgId,
          email: input.email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedBy: a.userId,
          expiresAt: new Date(deps.now().getTime() + INVITE_TTL_MS),
        })
        .returning({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
        });
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'invitation.created',
        targetType: 'invitation',
        targetId: row?.id,
        metadata: { role: input.role },
      });
      return row;
    });
    await deps.mailer.send({
      to: input.email,
      subject: 'You are invited to AccessAudit',
      text: `Accept within 7 days: ${deps.config.WEB_ORIGIN}/accept-invite?token=${token}`,
    });
    return reply.status(201).send({ invitation: inv });
  });

  app.get('/orgs/:orgId/invitations', async (req) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'admin');
    const rows = await withTenant(deps.db, { orgId: a.orgId, userId: a.userId }, (tx) =>
      tx
        .select({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
        })
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, a.orgId),
            isNull(invitations.acceptedAt),
            gt(invitations.expiresAt, deps.now()),
          ),
        )
        .orderBy(desc(invitations.createdAt)),
    );
    return { invitations: rows };
  });

  app.post('/invitations/accept', async (req) => {
    const auth = await requireUser(deps, req);
    const { token } = parse(acceptSchema, req.body);
    const orgId = token.split('.')[0] ?? '';
    // Malformed, unknown, expired, used or wrong-recipient tokens are indistinguishable.
    const fail = new AppError('NOT_FOUND', 'Invitation not found or expired.');
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw fail;
    const [me] = await deps.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, auth.userId));
    if (!me) throw fail;
    const joined = await withTenant(
      deps.db,
      { orgId: orgId.toLowerCase(), userId: auth.userId },
      async (tx) => {
        const now = deps.now();
        const [inv] = await tx
          .update(invitations)
          .set({ acceptedAt: now })
          .where(
            and(
              eq(invitations.tokenHash, hashToken(token)),
              isNull(invitations.acceptedAt),
              gt(invitations.expiresAt, now),
              eq(sql`lower(${invitations.email})`, me.email.toLowerCase()),
            ),
          )
          .returning({ role: invitations.role, orgId: invitations.organizationId });
        if (!inv) throw fail;
        await tx
          .insert(organizationMembers)
          .values({ organizationId: inv.orgId, userId: auth.userId, role: inv.role })
          .onConflictDoNothing();
        await writeAudit(deps, tx, req, {
          orgId: inv.orgId,
          actorId: auth.userId,
          action: 'invitation.accepted',
          targetType: 'user',
          targetId: auth.userId,
        });
        return { organizationId: inv.orgId, role: inv.role };
      },
    );
    return { membership: joined };
  });
}
