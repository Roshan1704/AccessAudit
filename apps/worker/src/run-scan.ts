import { and, eq } from 'drizzle-orm';
import type { Browser, Page } from 'playwright-core';
import {
  ALLOW_ALL,
  crawlSite,
  loginWithForm,
  openScanContext,
  type StorageState,
  parseRobots,
  safeGoto,
  type RobotsPolicy,
} from '@accessaudit/crawler';
import {
  ENGINE_VERSION,
  AXE_VERSION,
  analyzePage,
  type AnalyzeResult,
} from '@accessaudit/a11y-engine';
import {
  authProfiles,
  authorizedDomains,
  crawledPages,
  findingEvidence,
  findings,
  manualVerificationTasks,
  scanJobs,
  scans,
  withTenant,
  type Db,
  type Tx,
} from '@accessaudit/db';
import { openSecret, type KeyProvider, type UrlPolicyOptions } from '@accessaudit/security';
import type { ScanJobPayload } from '@accessaudit/shared';

export interface RunDeps {
  db: Db;
  browser: Browser;
  /** Decrypts stored login credentials. Absent: scans that need a login profile fail with auth_failed. */
  credentialKeys?: KeyProvider;
  policy?: UrlPolicyOptions;
  userAgent?: string;
  sleep?: (ms: number) => Promise<void>;
}

export type RunOutcome =
  | { status: 'completed'; pages: number; findings: number }
  | { status: 'failed'; reason: string }
  | { status: 'cancelled' };

const LINKS_SCRIPT = 'Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)';

type ScanRow = typeof scans.$inferSelect;

async function setJob(
  tx: Tx,
  orgId: string,
  scanId: string,
  patch: Partial<typeof scanJobs.$inferInsert>,
): Promise<void> {
  const updated = await tx
    .update(scanJobs)
    .set(patch)
    .where(and(eq(scanJobs.scanId, scanId), eq(scanJobs.organizationId, orgId)))
    .returning({ id: scanJobs.id });
  if (updated.length === 0) {
    await tx.insert(scanJobs).values({ organizationId: orgId, scanId, ...patch });
  }
}

async function fail(db: Db, orgId: string, scanId: string, reason: string): Promise<RunOutcome> {
  await withTenant(db, { orgId }, async (tx) => {
    await tx
      .update(scans)
      .set({
        status: 'failed',
        failureReason: reason,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scans.id, scanId));
    await setJob(tx, orgId, scanId, {
      status: 'failed',
      lastError: reason,
      finishedAt: new Date(),
    });
  });
  return { status: 'failed', reason };
}

/** robots.txt is read through the same guarded browser path as every other request. */
async function loadRobots(page: Page, origin: string, deps: RunDeps): Promise<RobotsPolicy> {
  const r = await safeGoto(page, `${origin}/robots.txt`, undefined, deps.policy);
  if (!r.ok || r.status >= 500) return parseRobots('User-agent: *\nDisallow: /'); // unreachable: be conservative
  if (r.status >= 400) return ALLOW_ALL; // RFC 9309: 4xx means no restrictions
  const text = await page.evaluate<string>('document.body ? document.body.innerText : ""');
  return parseRobots(text);
}

async function persistPage(
  db: Db,
  orgId: string,
  scanId: string,
  url: string,
  depth: number,
  meta: { finalUrl: string; status: number; domNodes: number },
  result: AnalyzeResult,
): Promise<number> {
  return withTenant(db, { orgId }, async (tx) => {
    const [page] = await tx
      .insert(crawledPages)
      .values({
        organizationId: orgId,
        scanId,
        url,
        finalUrl: meta.finalUrl,
        httpStatus: meta.status,
        title: result.dom.title,
        status: 'scanned',
        domNodes: meta.domNodes,
        depth,
        scannedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [crawledPages.scanId, crawledPages.url],
        set: { status: 'scanned', finalUrl: meta.finalUrl, scannedAt: new Date() },
      })
      .returning({ id: crawledPages.id });
    if (page === undefined) throw new Error('page row missing');
    const idByFingerprint = new Map<string, string>();
    let stored = 0;
    for (const f of result.findings) {
      const [row] = await tx
        .insert(findings)
        .values({
          organizationId: orgId,
          scanId,
          pageId: page.id,
          ruleId: f.ruleId,
          fingerprint: f.fingerprint,
          classification: f.classification,
          confidence: f.confidence,
          severity: f.severity,
          wcagCriteria: f.wcagCriteria,
          message: f.message,
          selector: f.selector,
          occurrences: f.occurrences ?? 1,
        })
        .onConflictDoNothing({ target: [findings.scanId, findings.fingerprint] })
        .returning({ id: findings.id });
      if (row === undefined) continue;
      stored++;
      idByFingerprint.set(f.fingerprint, row.id);
      for (const e of f.evidence) {
        await tx.insert(findingEvidence).values({
          organizationId: orgId,
          findingId: row.id,
          kind: e.kind,
          content: e.content,
          blobBase64: e.blobBase64 ?? null,
          contentType: e.contentType ?? null,
        });
      }
    }
    for (const t of result.manualTasks) {
      await tx.insert(manualVerificationTasks).values({
        organizationId: orgId,
        scanId,
        findingId:
          t.findingFingerprint === undefined
            ? null
            : (idByFingerprint.get(t.findingFingerprint) ?? null),
        ruleId: t.ruleId,
        instructions: t.instructions,
      });
    }
    return stored;
  });
}

/**
 * Executes one scan. The scan is looked up inside the stated organization's RLS scope, so a payload
 * naming another tenant's scan finds nothing. Scope (URL, caps, options) comes from the stored row only.
 */
export async function runScan(deps: RunDeps, payload: ScanJobPayload): Promise<RunOutcome> {
  const { db, browser } = deps;
  const { orgId, scanId } = payload;
  const ctxOpts = {
    ...(deps.policy ? { policy: deps.policy } : {}),
    ...(deps.userAgent ? { userAgent: deps.userAgent } : {}),
  };

  const scan = await withTenant(db, { orgId }, async (tx): Promise<ScanRow | undefined> => {
    const [row] = await tx.select().from(scans).where(eq(scans.id, scanId)).limit(1);
    if (row === undefined || row.status !== 'queued') return undefined;
    await tx
      .update(scans)
      .set({
        status: 'running',
        startedAt: new Date(),
        updatedAt: new Date(),
        engineVersions: { engine: ENGINE_VERSION, axe: AXE_VERSION },
      })
      .where(eq(scans.id, scanId));
    const [job] = await tx.select().from(scanJobs).where(eq(scanJobs.scanId, scanId)).limit(1);
    await setJob(tx, orgId, scanId, {
      status: 'running',
      attempts: (job?.attempts ?? 0) + 1,
      startedAt: new Date(),
    });
    return row;
  });
  if (scan === undefined) return { status: 'failed', reason: 'scan_not_runnable' };

  const start = new URL(scan.startUrl);

  // The domain must still be verified at run time, not only when the scan was queued.
  const verified = await withTenant(db, { orgId }, async (tx) => {
    const rows = await tx
      .select({ id: authorizedDomains.id })
      .from(authorizedDomains)
      .where(
        and(
          eq(authorizedDomains.projectId, scan.projectId),
          eq(authorizedDomains.hostname, start.hostname),
          eq(authorizedDomains.status, 'verified'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
  if (!verified) return fail(db, orgId, scanId, 'domain_not_verified');

  const snapshot = scan.configSnapshot as {
    robotsOverride?: { reason?: string };
    authProfileId?: string;
  } | null;
  const overrideRobots = typeof snapshot?.robotsOverride?.reason === 'string';

  // Authenticated scan (ADR-031): log in once; the session lives in memory for this run only.
  let storageState: StorageState | undefined;
  if (typeof snapshot?.authProfileId === 'string') {
    const profileId = snapshot.authProfileId;
    const profile = await withTenant(db, { orgId }, async (tx) => {
      const [p] = await tx
        .select()
        .from(authProfiles)
        .where(and(eq(authProfiles.id, profileId), eq(authProfiles.projectId, scan.projectId)));
      return p;
    });
    if (profile === undefined || deps.credentialKeys === undefined)
      return fail(db, orgId, scanId, 'auth_failed');
    let username: string;
    let password: string;
    try {
      username = openSecret(deps.credentialKeys, profile.usernameEnc, `${profile.id}:username`);
      password = openSecret(deps.credentialKeys, profile.passwordEnc, `${profile.id}:password`);
    } catch {
      return fail(db, orgId, scanId, 'auth_failed');
    }
    const login = await loginWithForm(
      browser,
      {
        loginUrl: profile.loginUrl,
        usernameSelector: profile.usernameSelector,
        passwordSelector: profile.passwordSelector,
        submitSelector: profile.submitSelector,
        successSelector: profile.successSelector,
        username,
        password,
      },
      ctxOpts,
    );
    if (!login.ok) return fail(db, orgId, scanId, 'auth_failed');
    storageState = login.storageState;
  }
  const visitCtxOpts = { ...ctxOpts, ...(storageState ? { storageState } : {}) };

  let pagesScanned = 0;
  let findingsStored = 0;
  let cancelled = false as boolean; // set inside the shouldStop closure
  try {
    let robots: RobotsPolicy = ALLOW_ALL;
    if (!overrideRobots) {
      const sc = await openScanContext(browser, ctxOpts);
      try {
        robots = await loadRobots(await sc.context.newPage(), start.origin, deps);
      } finally {
        await sc.close();
      }
    }

    const outcomes = await crawlSite({
      startUrl: scan.startUrl,
      maxPages: scan.maxPages,
      robots,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      shouldStop: async () => {
        const status = await withTenant(db, { orgId }, async (tx) => {
          const [r] = await tx
            .select({ status: scans.status })
            .from(scans)
            .where(eq(scans.id, scanId));
          return r?.status;
        });
        cancelled = status === 'cancelled';
        return cancelled;
      },
      visit: async (url, depth) => {
        const sc = await openScanContext(browser, visitCtxOpts);
        try {
          const page = await sc.context.newPage();
          const nav = await safeGoto(page, url, undefined, deps.policy);
          if (!nav.ok) return { ok: false, reason: nav.reason, links: [] };
          const result = await analyzePage(page, url, {
            wcagVersion: scan.wcagVersion as '2.0' | '2.1' | '2.2',
            level: scan.conformanceLevel as 'A' | 'AA' | 'AAA',
            interactionTests: scan.interactionTests,
          });
          findingsStored += await persistPage(db, orgId, scanId, url, depth, nav, result);
          pagesScanned++;
          const links = (await page.evaluate<string[]>(LINKS_SCRIPT)).slice(0, 500);
          return { ok: true, finalUrl: nav.finalUrl, links };
        } catch {
          return { ok: false, reason: 'analysis_error', links: [] };
        } finally {
          await sc.close();
        }
      },
    });

    // Record pages that were not scanned so coverage is explicit (robots exclusions are never silent).
    await withTenant(db, { orgId }, async (tx) => {
      for (const o of outcomes) {
        if (o.status === 'scanned') continue;
        await tx
          .insert(crawledPages)
          .values({
            organizationId: orgId,
            scanId,
            url: o.url,
            status: o.status === 'failed' ? 'failed' : 'skipped',
            failureReason: o.reason,
            depth: o.depth,
          })
          .onConflictDoNothing({ target: [crawledPages.scanId, crawledPages.url] });
      }
    });
  } catch {
    return fail(db, orgId, scanId, 'scan_error');
  }

  if (cancelled) {
    await withTenant(db, { orgId }, async (tx) => {
      await setJob(tx, orgId, scanId, { status: 'cancelled', finishedAt: new Date() });
    });
    return { status: 'cancelled' };
  }
  if (pagesScanned === 0) return fail(db, orgId, scanId, 'no_pages_scanned');

  await withTenant(db, { orgId }, async (tx) => {
    await tx
      .update(scans)
      .set({ status: 'completed', finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(scans.id, scanId));
    await setJob(tx, orgId, scanId, { status: 'succeeded', finishedAt: new Date() });
  });
  return { status: 'completed', pages: pagesScanned, findings: findingsStored };
}
