import { createHmac } from 'node:crypto';
import { AppError, roleAtLeast, type Role } from '@accessaudit/shared';
import { generateToken, hashToken, safeEqualHex } from '@accessaudit/security';
import {
  organizationMembers,
  organizations,
  userSessions,
  users,
  withTenant,
} from '@accessaudit/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from './deps.js';

export const SESSION_COOKIE = 'aa_session';
export const CSRF_COOKIE = 'aa_csrf';
const ABSOLUTE_TTL_MS = 7 * 24 * 3600 * 1000;
const IDLE_TTL_MS = 24 * 3600 * 1000;

export interface AuthContext {
  userId: string;
  sessionId: string;
  csrfHash: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function keyedHash(deps: Deps, value: string | undefined): string | null {
  if (!value) return null;
  return createHmac('sha256', deps.config.SESSION_COOKIE_SECRET).update(value).digest('hex');
}

export async function createSession(
  deps: Deps,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<void> {
  const sessionToken = generateToken(32);
  const csrfToken = generateToken(24);
  const now = deps.now();
  await deps.db.insert(userSessions).values({
    sessionHash: hashToken(sessionToken),
    csrfHash: hashToken(csrfToken),
    userId,
    expiresAt: new Date(now.getTime() + ABSOLUTE_TTL_MS),
    lastSeenAt: now,
    ipHash: keyedHash(deps, req.ip),
    uaHash: keyedHash(deps, req.headers['user-agent']),
  });
  const secure = deps.config.NODE_ENV === 'production';
  const maxAge = ABSOLUTE_TTL_MS / 1000;
  void reply.setCookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  // Readable by the SPA so it can echo it in the x-csrf-token header (double submit + server-side hash).
  void reply.setCookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { path: '/' });
  void reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

/** Resolves the session cookie to an authenticated user, or throws UNAUTHENTICATED. */
export async function authenticate(deps: Deps, req: FastifyRequest): Promise<AuthContext> {
  if (req.auth) return req.auth;
  const token = req.cookies[SESSION_COOKIE];
  if (!token) throw new AppError('UNAUTHENTICATED', 'Authentication required.');
  const now = deps.now();
  const [row] = await deps.db
    .select({
      id: userSessions.id,
      userId: userSessions.userId,
      csrfHash: userSessions.csrfHash,
      expiresAt: userSessions.expiresAt,
      lastSeenAt: userSessions.lastSeenAt,
      revokedAt: userSessions.revokedAt,
      disabledAt: users.disabledAt,
    })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(eq(userSessions.sessionHash, hashToken(token)));
  if (
    !row ||
    row.revokedAt !== null ||
    row.disabledAt !== null ||
    row.expiresAt <= now ||
    now.getTime() - row.lastSeenAt.getTime() > IDLE_TTL_MS
  ) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required.');
  }
  await deps.db.update(userSessions).set({ lastSeenAt: now }).where(eq(userSessions.id, row.id));
  req.auth = { userId: row.userId, sessionId: row.id, csrfHash: row.csrfHash };
  return req.auth;
}

/** Origin check for every mutating request; CSRF token check when a session is in play. */
export function enforceCsrf(deps: Deps, req: FastifyRequest, auth: AuthContext | undefined): void {
  const origin = req.headers.origin;
  if (origin !== deps.config.WEB_ORIGIN) {
    throw new AppError('CSRF_FAILED', 'Origin not allowed.');
  }
  if (auth) {
    const header = req.headers['x-csrf-token'];
    if (typeof header !== 'string' || !safeEqualHex(hashToken(header), auth.csrfHash)) {
      throw new AppError('CSRF_FAILED', 'Missing or invalid CSRF token.');
    }
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Authenticates and, for state-changing methods, enforces origin + CSRF token. */
export async function requireUser(deps: Deps, req: FastifyRequest): Promise<AuthContext> {
  const auth = await authenticate(deps, req);
  if (!SAFE_METHODS.has(req.method)) enforceCsrf(deps, req, auth);
  return auth;
}

export interface OrgAccess {
  orgId: string;
  userId: string;
  role: Role;
}

const uuid = z.uuid();

/**
 * Authenticates, then proves the caller is a member of the org with at least `min` role.
 * Non-members get 404 (never confirm another tenant's existence); members lacking the role get 403.
 */
export async function requireOrg(
  deps: Deps,
  req: FastifyRequest,
  orgIdParam: string,
  min: Role,
): Promise<OrgAccess> {
  const auth = await requireUser(deps, req);
  if (!uuid.safeParse(orgIdParam).success) throw new AppError('NOT_FOUND', 'Not found.');
  const orgId = orgIdParam.toLowerCase();
  const role = await withTenant(deps.db, { orgId, userId: auth.userId }, async (tx) => {
    const [m] = await tx
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, auth.userId),
          isNull(organizations.deletedAt),
        ),
      );
    return m?.role;
  });
  if (!role) throw new AppError('NOT_FOUND', 'Not found.');
  if (!roleAtLeast(role, min)) throw new AppError('FORBIDDEN', 'Insufficient permissions.');
  return { orgId, userId: auth.userId, role };
}
