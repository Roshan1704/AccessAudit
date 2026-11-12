import { randomUUID } from 'node:crypto';
import { AppError } from '@accessaudit/shared';
import { checkUrl } from '@accessaudit/security';
import { authProfiles, authorizedDomains, scanJobs, scans, type Tx } from '@accessaudit/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Deps } from './deps.js';
import { loadProject } from './routes/projects.js';

export interface NewScan {
  orgId: string;
  projectId: string;
  startUrl?: string | undefined;
  maxPages: number;
  wcagVersion: string;
  level: string;
  interactionTests: boolean;
  authProfileId?: string | undefined;
  configSnapshot: Record<string, unknown>;
  createdBy: string | null;
}

/**
 * Validates and inserts a scan plus its job row inside the caller's tenant transaction.
 * Shared by the scan route and the scheduler so both apply the same gates: SSRF policy,
 * verified domain and the per-project active-scan quota. The caller enqueues after commit.
 */
export async function insertScan(
  deps: Deps,
  tx: Tx,
  input: NewScan,
): Promise<{ scanId: string; projectId: string }> {
  const project = await loadProject(tx, input.orgId, input.projectId);
  const chk = checkUrl(
    input.startUrl ?? project.baseUrl,
    deps.config.ALLOW_PRIVATE_TARGETS ? { allowPrivateNetworks: true } : undefined,
  );
  if (!chk.ok)
    throw new AppError('URL_NOT_ALLOWED', 'This URL cannot be scanned.', { reason: chk.reason });
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
    throw new AppError('DOMAIN_NOT_VERIFIED', 'Verify ownership of this domain before scanning.');
  if (input.authProfileId) {
    const [profile] = await tx
      .select({ id: authProfiles.id })
      .from(authProfiles)
      .where(
        and(
          eq(authProfiles.id, input.authProfileId),
          eq(authProfiles.organizationId, input.orgId),
          eq(authProfiles.projectId, project.id),
        ),
      );
    if (!profile)
      throw new AppError('VALIDATION_FAILED', 'Unknown login profile for this project.');
  }
  const [active] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(scans)
    .where(and(eq(scans.projectId, project.id), inArray(scans.status, ['queued', 'running'])));
  if ((active?.n ?? 0) >= 2)
    throw new AppError('QUOTA_EXCEEDED', 'This project already has scans in progress.');

  const scanId = randomUUID();
  await tx.insert(scans).values({
    id: scanId,
    organizationId: input.orgId,
    projectId: project.id,
    startUrl: chk.url.href,
    maxPages: input.maxPages,
    wcagVersion: input.wcagVersion,
    conformanceLevel: input.level,
    interactionTests: input.interactionTests,
    configSnapshot: input.authProfileId
      ? { ...input.configSnapshot, authProfileId: input.authProfileId }
      : input.configSnapshot,
    createdBy: input.createdBy,
  });
  await tx.insert(scanJobs).values({ organizationId: input.orgId, scanId });
  return { scanId, projectId: project.id };
}
