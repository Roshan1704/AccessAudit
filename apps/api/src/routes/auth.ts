import {
  AppError,
  loginSchema,
  recoveryConfirmSchema,
  recoveryRequestSchema,
  registerSchema,
} from '@accessaudit/shared';
import { generateToken, hashToken } from '@accessaudit/security';
import {
  organizationMembers,
  organizations,
  passwordResetTokens,
  userSessions,
  users,
  withTenant,
} from '@accessaudit/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { parse, pgCode } from '../errors.js';
import {
  SESSION_COOKIE,
  authenticate,
  clearSessionCookies,
  createSession,
  enforceCsrf,
  requireUser,
} from '../session.js';

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export function authRoutes(app: FastifyInstance, deps: Deps): void {
  // Verified against when the account does not exist, so response time does not reveal account existence.
  let dummyHash: Promise<string> | undefined;
  const getDummy = (): Promise<string> =>
    (dummyHash ??= deps.hasher.hash('not-a-real-password-for-timing'));

  const invalidLogin = (): AppError =>
    new AppError('UNAUTHENTICATED', 'Invalid email or password.');

  app.post('/auth/register', strict, async (req, reply) => {
    enforceCsrf(deps, req, undefined);
    const input = parse(registerSchema, req.body);
    const passwordHash = await deps.hasher.hash(input.password);
    let user: { id: string; email: string; name: string } | undefined;
    try {
      [user] = await deps.db
        .insert(users)
        .values({ email: input.email, name: input.name, passwordHash })
        .returning({ id: users.id, email: users.email, name: users.name });
    } catch (e) {
      if (pgCode(e) === '23505')
        throw new AppError('CONFLICT', 'Unable to register with these details.');
      throw e;
    }
    if (!user) throw new Error('insert returned no row');
    await createSession(deps, req, reply, user.id);
    return reply.status(201).send({ user });
  });

  app.post('/auth/login', strict, async (req, reply) => {
    enforceCsrf(deps, req, undefined);
    const input = parse(loginSchema, req.body);
    const now = deps.now();
    const [u] = await deps.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email));

    if (!u || u.disabledAt !== null) {
      await deps.hasher.verify(await getDummy(), input.password);
      throw invalidLogin();
    }
    // Locked accounts answer exactly like a wrong password.
    if (u.lockedUntil !== null && u.lockedUntil > now) {
      await deps.hasher.verify(await getDummy(), input.password);
      throw invalidLogin();
    }
    if (!(await deps.hasher.verify(u.passwordHash, input.password))) {
      const [upd] = await deps.db
        .update(users)
        .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
        .where(eq(users.id, u.id))
        .returning({ n: users.failedLoginCount });
      if (upd && upd.n >= MAX_FAILED) {
        await deps.db
          .update(users)
          .set({ lockedUntil: new Date(now.getTime() + LOCK_MS), failedLoginCount: 0 })
          .where(eq(users.id, u.id));
        req.log.warn({ userId: u.id }, 'account locked after repeated failed logins');
      }
      throw invalidLogin();
    }

    await deps.db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, u.id));
    // Rotate: a new session id on every login; revoke the one presented, if any.
    const old = req.cookies[SESSION_COOKIE];
    if (old) {
      await deps.db
        .update(userSessions)
        .set({ revokedAt: now })
        .where(and(eq(userSessions.sessionHash, hashToken(old)), isNull(userSessions.revokedAt)));
    }
    await createSession(deps, req, reply, u.id);
    return { user: { id: u.id, email: u.email, name: u.name } };
  });

  app.post('/auth/logout', async (req, reply) => {
    const auth = await requireUser(deps, req);
    await deps.db
      .update(userSessions)
      .set({ revokedAt: deps.now() })
      .where(eq(userSessions.id, auth.sessionId));
    clearSessionCookies(reply);
    return reply.status(204).send();
  });

  app.get('/auth/me', async (req) => {
    const auth = await authenticate(deps, req);
    const [u] = await deps.db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, auth.userId));
    if (!u) throw new AppError('UNAUTHENTICATED', 'Authentication required.');
    const orgs = await withTenant(deps.db, { userId: auth.userId }, (tx) =>
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
    return { user: u, organizations: orgs };
  });

  // Always 202: never reveals whether the address has an account.
  app.post('/auth/recovery/request', strict, async (req, reply) => {
    enforceCsrf(deps, req, undefined);
    const input = parse(recoveryRequestSchema, req.body);
    const [u] = await deps.db
      .select({ id: users.id, disabledAt: users.disabledAt })
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email));
    if (u && u.disabledAt === null) {
      const token = generateToken(32);
      await deps.db.insert(passwordResetTokens).values({
        userId: u.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(deps.now().getTime() + RESET_TTL_MS),
      });
      await deps.mailer.send({
        to: input.email,
        subject: 'Reset your AccessAudit password',
        text: `Use this link within 1 hour: ${deps.config.WEB_ORIGIN}/reset-password?token=${token}`,
      });
    }
    return reply.status(202).send({ status: 'accepted' });
  });

  app.post('/auth/recovery/confirm', strict, async (req) => {
    enforceCsrf(deps, req, undefined);
    const input = parse(recoveryConfirmSchema, req.body);
    const passwordHash = await deps.hasher.hash(input.password);
    const now = deps.now();
    await deps.db.transaction(async (tx) => {
      // Single use: the UPDATE only matches an unused, unexpired token, atomically.
      const [t] = await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hashToken(input.token)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now),
          ),
        )
        .returning({ userId: passwordResetTokens.userId });
      if (!t) throw new AppError('VALIDATION_FAILED', 'Invalid or expired token.');
      await tx
        .update(users)
        .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: now })
        .where(eq(users.id, t.userId));
      await tx
        .update(userSessions)
        .set({ revokedAt: now })
        .where(and(eq(userSessions.userId, t.userId), isNull(userSessions.revokedAt)));
    });
    return { status: 'password_updated' };
  });
}
