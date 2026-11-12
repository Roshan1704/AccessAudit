import { AppError, addDomainSchema, type VerificationMethod } from '@accessaudit/shared';
import {
  assertResolvedPublic,
  checkUrl,
  generateToken,
  hashToken,
  safeEqualHex,
} from '@accessaudit/security';
import { authorizedDomains, withTenant, type Tx } from '@accessaudit/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../deps.js';
import { writeAudit } from '../audit.js';
import { parse, pgCode } from '../errors.js';
import { requireOrg } from '../session.js';
import { param, uuidOr404 } from '../util.js';
import { loadProject } from './projects.js';

export const TXT_PREFIX = '_accessaudit-challenge.';
export const TXT_VALUE_PREFIX = 'accessaudit-verification=';
export const WELL_KNOWN_PATH = '/.well-known/accessaudit-verification.txt';
export const META_NAME = 'accessaudit-verification';
/** The tag must appear in the first 256 KB of the home page. */
export const META_MAX_BYTES = 256 * 1024;
const DAY_MS = 24 * 3600 * 1000;

type DomainRow = typeof authorizedDomains.$inferSelect;

export type CheckResult =
  | { ok: true }
  /** `definitive`: the proof is absent/wrong (vs. a transient lookup or network error). */
  | { ok: false; reason: string; definitive: boolean };

const DEFINITIVE_DNS = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN']);

/** Does `candidate` equal the stored hash? Constant-time on the hash. */
function matches(storedHash: string, candidate: string): boolean {
  return /^[0-9a-f]{64}$/.test(storedHash) && safeEqualHex(hashToken(candidate.trim()), storedHash);
}

export async function checkDnsTxt(
  deps: Deps,
  d: Pick<DomainRow, 'hostname' | 'tokenHash'>,
): Promise<CheckResult> {
  let records: string[];
  try {
    records = await deps.dns.resolveTxt(TXT_PREFIX + d.hostname);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    return DEFINITIVE_DNS.has(code)
      ? { ok: false, reason: 'txt_record_not_found', definitive: true }
      : { ok: false, reason: 'dns_lookup_error', definitive: false };
  }
  const found = records.some(
    (r) => r.startsWith(TXT_VALUE_PREFIX) && matches(d.tokenHash, r.slice(TXT_VALUE_PREFIX.length)),
  );
  return found ? { ok: true } : { ok: false, reason: 'txt_record_mismatch', definitive: true };
}

/** Reads the `content` of every `<meta name="accessaudit-verification">` tag in an HTML string. */
export function metaTokens(html: string): string[] {
  const attr = (tag: string, name: string): string | undefined => {
    const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return m?.[1] ?? m?.[2];
  };
  const out: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attr(tag, 'name')?.toLowerCase() === META_NAME) {
      const content = attr(tag, 'content');
      if (content !== undefined) out.push(content);
    }
  }
  return out;
}

type Fetched =
  | { ok: true; res: Awaited<ReturnType<Deps['fetcher']['get']>> }
  | { ok: false; result: CheckResult };

/** Validates the host again, pins the connection to a checked address and fetches one path. */
async function fetchFromHost(
  deps: Deps,
  d: Pick<DomainRow, 'hostname'>,
  path: string,
  opts?: { maxBytes: number },
): Promise<Fetched> {
  const fail = (reason: string, definitive: boolean): Fetched => ({
    ok: false,
    result: { ok: false, reason, definitive },
  });
  // Re-validate at check time: stored hostnames are not trusted to still be public.
  const allowPrivate = deps.config.ALLOW_PRIVATE_TARGETS;
  const policy = checkUrl(
    `https://${d.hostname}/`,
    allowPrivate ? { allowPrivateNetworks: true } : undefined,
  );
  if (!policy.ok) return fail(`url_${policy.reason}`, true);
  let addresses: string[];
  try {
    addresses = await deps.dns.resolveAddresses(d.hostname);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    return DEFINITIVE_DNS.has(code)
      ? fail('host_not_found', true)
      : fail('dns_lookup_error', false);
  }
  // Every answer must be public; then pin the connection to the first one (defeats rebinding).
  const first = addresses[0];
  if ((!allowPrivate && !assertResolvedPublic(addresses)) || first === undefined)
    return fail('resolves_to_non_public_address', true);
  try {
    return { ok: true, res: await deps.fetcher.get(d.hostname, path, first, opts) };
  } catch {
    return fail('fetch_error', false);
  }
}

/** Meta tag in the home page head. Redirects are never followed; only a 200 answer counts. */
export async function checkMetaTag(
  deps: Deps,
  d: Pick<DomainRow, 'hostname' | 'tokenHash'>,
): Promise<CheckResult> {
  const f = await fetchFromHost(deps, d, '/', { maxBytes: META_MAX_BYTES });
  if (!f.ok) return f.result;
  if (f.res.status !== 200)
    return { ok: false, reason: `http_${String(f.res.status)}`, definitive: true };
  if (metaTokens(f.res.body).some((t) => matches(d.tokenHash, t))) return { ok: true };
  return {
    ok: false,
    reason: metaTokens(f.res.body).length > 0 ? 'meta_tag_mismatch' : 'meta_tag_not_found',
    definitive: true,
  };
}

export async function checkWellKnown(
  deps: Deps,
  d: Pick<DomainRow, 'hostname' | 'tokenHash'>,
): Promise<CheckResult> {
  const f = await fetchFromHost(deps, d, WELL_KNOWN_PATH);
  if (!f.ok) return f.result;
  const res = f.res;
  // Redirects are never followed; any non-200 (including 3xx) fails.
  if (res.status !== 200)
    return { ok: false, reason: `http_${String(res.status)}`, definitive: true };
  if (res.truncated) return { ok: false, reason: 'file_too_large', definitive: true };
  return matches(d.tokenHash, res.body)
    ? { ok: true }
    : { ok: false, reason: 'file_content_mismatch', definitive: true };
}

export function runCheck(deps: Deps, d: DomainRow): Promise<CheckResult> {
  switch (d.verificationMethod) {
    case 'dns_txt':
      return checkDnsTxt(deps, d);
    case 'meta_tag':
      return checkMetaTag(deps, d);
    default:
      return checkWellKnown(deps, d);
  }
}

/**
 * Runs the check and persists the outcome.
 * - success: verified, timestamps set, next revalidation scheduled.
 * - definitive failure of a verified domain: expired (proof removed).
 * - definitive failure of an unverified domain: failed.
 * - transient failure: status kept, counter and reason recorded.
 */
export async function verifyDomain(
  deps: Deps,
  tx: Tx,
  d: DomainRow,
  actorId: string | null,
): Promise<DomainRow> {
  const result = await runCheck(deps, d);
  const now = deps.now();
  let patch: Partial<typeof authorizedDomains.$inferInsert>;
  if (result.ok) {
    patch = {
      status: 'verified',
      verifiedAt: d.status === 'verified' ? (d.verifiedAt ?? now) : now,
      lastVerifiedAt: now,
      nextRevalidateAt: new Date(now.getTime() + deps.config.DOMAIN_REVALIDATE_DAYS * DAY_MS),
      failedChecks: 0,
      lastFailureReason: null,
      ...(actorId ? { verifiedBy: actorId } : {}),
    };
  } else if (!result.definitive) {
    patch = { failedChecks: d.failedChecks + 1, lastFailureReason: result.reason };
  } else {
    patch = {
      status: d.status === 'verified' || d.status === 'expired' ? 'expired' : 'failed',
      failedChecks: d.failedChecks + 1,
      lastFailureReason: result.reason,
    };
  }
  const [row] = await tx
    .update(authorizedDomains)
    .set({ ...patch, updatedAt: now })
    .where(
      and(eq(authorizedDomains.organizationId, d.organizationId), eq(authorizedDomains.id, d.id)),
    )
    .returning();
  if (!row) throw new AppError('NOT_FOUND', 'Not found.');
  return row;
}

/**
 * Gate for later phases (scans/crawls): a hostname is authorized only by an exact-match, verified,
 * unexpired record. Apex verification never covers subdomains. Due records are re-checked first.
 */
export async function requireVerifiedHostname(
  deps: Deps,
  tx: Tx,
  orgId: string,
  projectId: string,
  hostname: string,
): Promise<DomainRow> {
  const [d] = await tx
    .select()
    .from(authorizedDomains)
    .where(
      and(
        eq(authorizedDomains.organizationId, orgId),
        eq(authorizedDomains.projectId, projectId),
        eq(authorizedDomains.hostname, hostname.toLowerCase()),
      ),
    );
  if (d?.status !== 'verified')
    throw new AppError('DOMAIN_NOT_VERIFIED', 'Domain is not verified.');
  const due = d.nextRevalidateAt === null || d.nextRevalidateAt <= deps.now();
  // Re-check in its own transaction so a lapse is persisted even though this call then throws
  // (the caller's transaction rolls back on the error).
  const current = due
    ? await withTenant(deps.db, { orgId }, (tx2) => verifyDomain(deps, tx2, d, null))
    : d;
  if (current.status !== 'verified')
    throw new AppError('DOMAIN_NOT_VERIFIED', 'Domain verification has lapsed.');
  return current;
}

function present(d: DomainRow) {
  return {
    id: d.id,
    projectId: d.projectId,
    hostname: d.hostname,
    method: d.verificationMethod,
    status: d.status,
    verifiedAt: d.verifiedAt,
    lastVerifiedAt: d.lastVerifiedAt,
    nextRevalidateAt: d.nextRevalidateAt,
    failedChecks: d.failedChecks,
    lastFailureReason: d.lastFailureReason,
    createdAt: d.createdAt,
  };
}

function instructions(
  hostname: string,
  method: VerificationMethod,
  token: string,
  plainHttp: boolean,
) {
  const scheme = plainHttp ? 'http' : 'https';
  if (method === 'dns_txt')
    return {
      type: 'dns_txt',
      recordName: TXT_PREFIX + hostname,
      recordValue: TXT_VALUE_PREFIX + token,
    };
  if (method === 'meta_tag')
    return {
      type: 'meta_tag',
      url: `${scheme}://${hostname}/`,
      tag: `<meta name="${META_NAME}" content="${token}">`,
    };
  return {
    type: 'well_known',
    url: `${scheme}://${hostname}${WELL_KNOWN_PATH}`,
    fileContent: token,
  };
}

export function domainRoutes(app: FastifyInstance, deps: Deps): void {
  const base = '/orgs/:orgId/projects/:projectId/domains';
  const scope = (a: { orgId: string; userId: string }) => ({ orgId: a.orgId, userId: a.userId });

  app.post(base, async (req, reply) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'admin');
    const pid = uuidOr404(param(req, 'projectId'));
    const input = parse(addDomainSchema, req.body);
    // Hostname only: no scheme, port, path, wildcard, userinfo; must be a public-style DNS name.
    const chk = /^[a-z0-9.-]+$/.test(input.hostname)
      ? checkUrl(
          `https://${input.hostname}/`,
          deps.config.ALLOW_PRIVATE_TARGETS ? { allowPrivateNetworks: true } : undefined,
        )
      : null;
    if (!chk?.ok || chk.hostname !== input.hostname) {
      throw new AppError('URL_NOT_ALLOWED', 'Enter a public hostname such as example.com.', {
        reason: chk && !chk.ok ? chk.reason : 'invalid_hostname',
      });
    }
    const token = generateToken(24);
    try {
      const row = await withTenant(deps.db, scope(a), async (tx) => {
        await loadProject(tx, a.orgId, pid);
        const [d] = await tx
          .insert(authorizedDomains)
          .values({
            organizationId: a.orgId,
            projectId: pid,
            hostname: input.hostname,
            verificationMethod: input.method,
            tokenHash: hashToken(token),
          })
          .returning();
        await writeAudit(deps, tx, req, {
          orgId: a.orgId,
          actorId: a.userId,
          action: 'domain.added',
          targetType: 'domain',
          targetId: d?.id,
          metadata: { hostname: input.hostname, method: input.method },
        });
        return d;
      });
      if (!row) throw new Error('insert returned no row');
      // The token is shown exactly once; only its hash is stored.
      return await reply.status(201).send({
        domain: present(row),
        verification: instructions(
          row.hostname,
          input.method,
          token,
          deps.config.ALLOW_PRIVATE_TARGETS,
        ),
      });
    } catch (e) {
      if (pgCode(e) === '23505')
        throw new AppError('CONFLICT', 'This hostname is already added to the project.');
      throw e;
    }
  });

  app.get(base, async (req) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'viewer');
    const pid = uuidOr404(param(req, 'projectId'));
    const rows = await withTenant(deps.db, scope(a), async (tx) => {
      await loadProject(tx, a.orgId, pid);
      return tx
        .select()
        .from(authorizedDomains)
        .where(
          and(eq(authorizedDomains.organizationId, a.orgId), eq(authorizedDomains.projectId, pid)),
        )
        .orderBy(asc(authorizedDomains.hostname));
    });
    return { domains: rows.map(present) };
  });

  const findDomain = async (
    tx: Tx,
    orgId: string,
    pid: string,
    did: string,
  ): Promise<DomainRow> => {
    const [d] = await tx
      .select()
      .from(authorizedDomains)
      .where(
        and(
          eq(authorizedDomains.organizationId, orgId),
          eq(authorizedDomains.projectId, pid),
          eq(authorizedDomains.id, did),
        ),
      );
    if (!d) throw new AppError('NOT_FOUND', 'Not found.');
    return d;
  };

  // Verify (first time) and revalidate (later) are the same operation: re-run the check and persist.
  const verifyHandler = (action: string) => async (req: FastifyRequest) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'admin');
    const pid = uuidOr404(param(req, 'projectId'));
    const did = uuidOr404(param(req, 'domainId'));
    const row = await withTenant(deps.db, scope(a), async (tx) => {
      await loadProject(tx, a.orgId, pid);
      const d = await findDomain(tx, a.orgId, pid, did);
      if (d.status === 'revoked')
        throw new AppError('CONFLICT', 'Domain was revoked. Add it again.');
      const updated = await verifyDomain(deps, tx, d, a.userId);
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action,
        targetType: 'domain',
        targetId: did,
        metadata: { status: updated.status, reason: updated.lastFailureReason },
      });
      return updated;
    });
    return { domain: present(row) };
  };
  app.post(`${base}/:domainId/verify`, verifyHandler('domain.verify_attempted'));
  app.post(`${base}/:domainId/revalidate`, verifyHandler('domain.revalidated'));

  app.delete(`${base}/:domainId`, async (req, reply) => {
    const a = await requireOrg(deps, req, param(req, 'orgId') ?? '', 'admin');
    const pid = uuidOr404(param(req, 'projectId'));
    const did = uuidOr404(param(req, 'domainId'));
    await withTenant(deps.db, scope(a), async (tx) => {
      await loadProject(tx, a.orgId, pid);
      await findDomain(tx, a.orgId, pid, did);
      await tx
        .delete(authorizedDomains)
        .where(and(eq(authorizedDomains.organizationId, a.orgId), eq(authorizedDomains.id, did)));
      await writeAudit(deps, tx, req, {
        orgId: a.orgId,
        actorId: a.userId,
        action: 'domain.removed',
        targetType: 'domain',
        targetId: did,
      });
    });
    return reply.status(204).send();
  });
}
