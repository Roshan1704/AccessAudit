import {
  auditLogs,
  crawledPages,
  organizationMembers,
  projects,
  scans,
  users,
  withTenant,
} from '@accessaudit/db';
import { and, eq, inArray, isNull, desc, lt, ne, asc, sql } from 'drizzle-orm';
import type { Deps } from './deps.js';
import { compareRows, loadRows } from './routes/compare.js';

export interface NotifyResult {
  sent: number;
  skipped: number;
}

/**
 * Emails the people who care about a finished scan (ADR-028): the user who started it, or the
 * organization's owners and admins when a schedule started it. Each scan is claimed by setting
 * notified_at first, so it is mailed at most once, even with several API processes ticking.
 * A failed send is logged in the audit trail and not retried, to avoid repeat mails.
 */
export async function notifyFinishedScans(deps: Deps, limit = 20): Promise<NotifyResult> {
  const pending = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.scheduler', 'on', true)`);
    return tx
      .select({ id: scans.id, orgId: scans.organizationId })
      .from(scans)
      .where(and(isNull(scans.notifiedAt), inArray(scans.status, ['completed', 'failed'])))
      .orderBy(asc(scans.finishedAt))
      .limit(limit);
  });

  const result: NotifyResult = { sent: 0, skipped: 0 };
  for (const p of pending) {
    try {
      const mail = await withTenant(deps.db, { orgId: p.orgId }, async (tx) => {
        const [claimed] = await tx
          .update(scans)
          .set({ notifiedAt: deps.now() })
          .where(and(eq(scans.id, p.id), isNull(scans.notifiedAt)))
          .returning();
        if (!claimed) return null;

        const [proj] = await tx
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, claimed.projectId));

        // Recipients.
        let to: string[] = [];
        if (claimed.createdBy) {
          const rows = await tx
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, claimed.createdBy));
          to = rows.map((r) => r.email);
        } else {
          const rows = await tx
            .select({ email: users.email })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(
              and(
                eq(organizationMembers.organizationId, p.orgId),
                inArray(organizationMembers.role, ['owner', 'admin']),
              ),
            );
          to = rows.map((r) => r.email);
        }

        const name = proj?.name ?? 'your project';
        const link = `${deps.config.WEB_ORIGIN}/orgs/${p.orgId}/scans/${claimed.id}`;
        let subject: string;
        let text: string;
        if (claimed.status === 'failed') {
          subject = `Scan failed: ${name}`;
          text = `The accessibility scan of ${name} did not finish (${claimed.failureReason ?? 'unknown reason'}).\n\nDetails: ${link}`;
        } else {
          const cur = await loadRows(tx, claimed.id);
          const real = cur.filter(
            (r) => r.classification === 'confirmed' || r.classification === 'strong_potential',
          ).length;
          let regressionLine = '';
          const [base] = await tx
            .select({ id: scans.id })
            .from(scans)
            .where(
              and(
                eq(scans.projectId, claimed.projectId),
                eq(scans.status, 'completed'),
                lt(scans.createdAt, claimed.createdAt),
                ne(scans.id, claimed.id),
              ),
            )
            .orderBy(desc(scans.createdAt))
            .limit(1);
          let regressions = 0;
          if (base) {
            const scanned = await tx
              .select({ url: crawledPages.url })
              .from(crawledPages)
              .where(and(eq(crawledPages.scanId, claimed.id), eq(crawledPages.status, 'scanned')));
            const diff = compareRows(
              await loadRows(tx, base.id),
              cur,
              new Set(scanned.map((s) => s.url)),
            );
            regressions = diff.regressions.length;
            regressionLine = `\nCompared with the previous scan: ${String(regressions)} new or returned issue(s), ${String(diff.resolved.length)} resolved.`;
          }
          subject =
            regressions > 0
              ? `Accessibility regression: ${name} (${String(regressions)} new)`
              : `Scan complete: ${name}`;
          text = `The accessibility scan of ${name} finished with ${String(real)} confirmed or potential issue(s).${regressionLine}\n\nAutomated checks cover only part of WCAG; manual review is still required.\n\nResults: ${link}`;
        }

        await tx.insert(auditLogs).values({
          organizationId: p.orgId,
          actorType: 'system',
          actorId: null,
          action: 'scan.notified',
          targetType: 'scan',
          targetId: claimed.id,
          metadata: { recipients: to.length },
        });
        return { to, subject, text };
      });
      if (!mail) continue;
      if (mail.to.length === 0) {
        result.skipped += 1;
        continue;
      }
      for (const addr of mail.to) {
        await deps.mailer.send({ to: addr, subject: mail.subject, text: mail.text });
      }
      result.sent += 1;
    } catch {
      result.skipped += 1;
    }
  }
  return result;
}
