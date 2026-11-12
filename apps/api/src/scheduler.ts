import { AppError } from '@accessaudit/shared';
import { auditLogs, scanSchedules, scans, withTenant } from '@accessaudit/db';
import { and, asc, eq, lt, lte, sql } from 'drizzle-orm';
import type { Deps } from './deps.js';
import { notifyFinishedScans } from './notifier.js';
import { insertScan } from './scan-create.js';
import { intervalMs } from './routes/schedules.js';

export interface TickResult {
  started: number;
  failed: number;
}

/**
 * Creates a scan for every enabled schedule that is due (ADR-027).
 * Each schedule is claimed with an optimistic update on next_run_at, so two API processes
 * ticking at once cannot start the same run twice. Failures (unverified domain, quota,
 * queue down) are recorded on the schedule and the next run is still advanced.
 */
export async function runDueSchedules(deps: Deps, limit = 20): Promise<TickResult> {
  const now = deps.now();
  // Cross-organization read, allowed only by the scheduler_select policy.
  const due = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.scheduler', 'on', true)`);
    return tx
      .select({
        id: scanSchedules.id,
        orgId: scanSchedules.organizationId,
        nextRunAt: scanSchedules.nextRunAt,
      })
      .from(scanSchedules)
      .where(and(eq(scanSchedules.enabled, true), lte(scanSchedules.nextRunAt, now)))
      .orderBy(asc(scanSchedules.nextRunAt))
      .limit(limit);
  });

  const result: TickResult = { started: 0, failed: 0 };
  for (const d of due) {
    const out: { scanId: string | null; error: string | null; claimed: boolean } = {
      scanId: null,
      error: null,
      claimed: false,
    };
    try {
      await withTenant(deps.db, { orgId: d.orgId }, async (tx) => {
        const [s] = await tx
          .update(scanSchedules)
          .set({ nextRunAt: sql`${scanSchedules.nextRunAt}`, updatedAt: now })
          .where(
            and(
              eq(scanSchedules.id, d.id),
              eq(scanSchedules.enabled, true),
              eq(scanSchedules.nextRunAt, d.nextRunAt),
            ),
          )
          .returning();
        if (!s) return;
        out.claimed = true;
        const next = new Date(now.getTime() + intervalMs(s.frequency));
        try {
          // Savepoint: a rejected scan must not abort the transaction that records the failure.
          await tx.transaction(async (sp) => {
            const created = await insertScan(deps, sp, {
              orgId: d.orgId,
              projectId: s.projectId,
              maxPages: s.maxPages,
              wcagVersion: s.wcagVersion,
              level: s.conformanceLevel,
              interactionTests: s.interactionTests,
              configSnapshot: { scheduleId: s.id },
              createdBy: s.createdBy,
            });
            out.scanId = created.scanId;
          });
        } catch (e) {
          out.error = e instanceof AppError ? e.code : 'INTERNAL';
        }
        await tx
          .update(scanSchedules)
          .set({
            nextRunAt: next,
            lastRunAt: now,
            lastScanId: out.scanId,
            lastError: out.error,
            updatedAt: now,
          })
          .where(eq(scanSchedules.id, s.id));
        await tx.insert(auditLogs).values({
          organizationId: d.orgId,
          actorType: 'system',
          actorId: null,
          action: out.error ? 'schedule.run_failed' : 'schedule.run_started',
          targetType: 'schedule',
          targetId: s.id,
          metadata: out.error ? { reason: out.error } : { scanId: out.scanId },
        });
      });
    } catch {
      result.failed += 1;
      continue;
    }
    if (!out.claimed) continue;
    const scanId = out.scanId;
    if (out.error || !scanId) {
      result.failed += 1;
      continue;
    }
    try {
      await deps.scanQueue.enqueue({ orgId: d.orgId, scanId });
      result.started += 1;
    } catch {
      await withTenant(deps.db, { orgId: d.orgId }, (tx) =>
        tx
          .update(scans)
          .set({ status: 'failed', failureReason: 'queue_unavailable', finishedAt: deps.now() })
          .where(eq(scans.id, scanId)),
      );
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Fails scans left in `running` longer than STUCK_SCAN_MINUTES (worker crashed or lost its job).
 * Marking them failed, not re-queuing, avoids running a scan twice if the worker is only slow;
 * the notifier then mails the failure and the user can start a new scan. Each scan is claimed
 * with a compare-and-set on status and started_at.
 */
export async function recoverStuckScans(deps: Deps, limit = 20): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - deps.config.STUCK_SCAN_MINUTES * 60_000);
  const stuck = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.scheduler', 'on', true)`);
    return tx
      .select({ id: scans.id, orgId: scans.organizationId, startedAt: scans.startedAt })
      .from(scans)
      .where(and(eq(scans.status, 'running'), lt(scans.startedAt, cutoff)))
      .limit(limit);
  });
  let recovered = 0;
  for (const s of stuck) {
    if (s.startedAt === null) continue;
    const startedAt = s.startedAt;
    const claimed = await withTenant(deps.db, { orgId: s.orgId }, (tx) =>
      tx
        .update(scans)
        .set({
          status: 'failed',
          failureReason: 'worker_lost',
          finishedAt: deps.now(),
          updatedAt: deps.now(),
        })
        .where(and(eq(scans.id, s.id), eq(scans.status, 'running'), eq(scans.startedAt, startedAt)))
        .returning({ id: scans.id }),
    );
    if (claimed.length > 0) recovered += 1;
  }
  return recovered;
}

/** Starts the in-process tick. Returns a stop function. */
export function startScheduler(
  deps: Deps,
  log: { error: (o: unknown, m: string) => void },
  everyMs = 60_000,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDueSchedules(deps)
      .then(() => recoverStuckScans(deps))
      .then(() => notifyFinishedScans(deps))
      .catch((e: unknown) => {
        log.error({ err: e }, 'scheduler tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, everyMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
