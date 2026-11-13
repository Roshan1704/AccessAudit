import { AppError } from '@accessaudit/shared';
import {
  accessibilityRules,
  crawledPages,
  findings,
  manualVerificationTasks,
  projects,
  scans,
  withTenant,
} from '@accessaudit/db';
import { and, asc, desc, eq, lt, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { writeAudit } from '../audit.js';
import { htmlToPdf } from '../pdf.js';
import { renderCsv, renderHtml, REPORT_DISCLAIMER, type ReportData } from '../report.js';
import { requireOrg } from '../session.js';
import { compareRows, loadRows } from './compare.js';
import { param, uuidOr404 } from '../util.js';

const FORMATS = ['json', 'csv', 'html', 'pdf'] as const;
type Format = (typeof FORMATS)[number];

export function reportRoutes(app: FastifyInstance, deps: Deps): void {
  app.get(
    '/orgs/:orgId/scans/:scanId/report',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const a = await requireOrg(deps, req, uuidOr404(param(req, 'orgId')), 'viewer');
      const scanId = uuidOr404(param(req, 'scanId'));
      const fmt = (req.query as Record<string, string | undefined>)['format'] ?? 'json';
      if (!(FORMATS as readonly string[]).includes(fmt))
        throw new AppError('VALIDATION_FAILED', 'format must be json, csv, html or pdf.');
      const format = fmt as Format;

      const data = await withTenant(
        deps.db,
        { orgId: a.orgId, userId: a.userId },
        async (tx): Promise<ReportData> => {
          const [scan] = await tx
            .select({
              id: scans.id,
              projectId: scans.projectId,
              startUrl: scans.startUrl,
              status: scans.status,
              createdAt: scans.createdAt,
              wcagVersion: scans.wcagVersion,
              conformanceLevel: scans.conformanceLevel,
              maxPages: scans.maxPages,
              finishedAt: scans.finishedAt,
            })
            .from(scans)
            .where(eq(scans.id, scanId));
          if (!scan) throw new AppError('NOT_FOUND', 'Not found.');
          if (scan.status !== 'completed')
            throw new AppError('CONFLICT', 'Reports are available once a scan has completed.');
          const [project] = await tx
            .select({ name: projects.name, baseUrl: projects.baseUrl })
            .from(projects)
            .where(eq(projects.id, scan.projectId));
          const rows = await tx
            .select({
              fingerprint: findings.fingerprint,
              ruleId: findings.ruleId,
              ruleTitle: accessibilityRules.title,
              classification: findings.classification,
              severity: findings.severity,
              confidence: findings.confidence,
              wcagCriteria: findings.wcagCriteria,
              message: findings.message,
              selector: findings.selector,
              occurrences: findings.occurrences,
              reviewStatus: findings.reviewStatus,
              pageUrl: crawledPages.url,
            })
            .from(findings)
            .innerJoin(accessibilityRules, eq(accessibilityRules.id, findings.ruleId))
            .innerJoin(crawledPages, eq(crawledPages.id, findings.pageId))
            .where(eq(findings.scanId, scanId))
            .orderBy(
              sql`array_position(array['critical','serious','moderate','minor','none']::text[], ${findings.severity}::text)`,
              asc(crawledPages.url),
            )
            .limit(5000);
          const pages = await tx
            .select({
              url: crawledPages.url,
              status: crawledPages.status,
              failureReason: crawledPages.failureReason,
            })
            .from(crawledPages)
            .where(eq(crawledPages.scanId, scanId));
          const tasks = await tx
            .select({ status: manualVerificationTasks.status })
            .from(manualVerificationTasks)
            .where(eq(manualVerificationTasks.scanId, scanId));
          const [base] = await tx
            .select({ id: scans.id })
            .from(scans)
            .where(
              and(
                eq(scans.projectId, scan.projectId),
                eq(scans.status, 'completed'),
                lt(scans.createdAt, scan.createdAt),
                ne(scans.id, scan.id),
              ),
            )
            .orderBy(desc(scans.createdAt))
            .limit(1);
          let comparison: ReportData['comparison'] = null;
          const change = new Map<string, 'new' | 'regressed' | 'unchanged'>();
          if (base) {
            const diff = compareRows(
              await loadRows(tx, base.id),
              await loadRows(tx, scanId),
              new Set(pages.filter((p) => p.status === 'scanned').map((p) => p.url)),
            );
            const slim = (rs: typeof diff.resolved) =>
              rs.slice(0, 200).map((g) => ({
                ruleId: g.ruleId,
                ruleTitle: g.ruleTitle,
                classification: g.classification,
                severity: g.severity,
                selector: g.selector,
                pageUrl: g.pageUrl,
              }));
            comparison = {
              baselineScanId: base.id,
              counts: {
                added: diff.added.length,
                resolved: diff.resolved.length,
                regressed: diff.regressed.length,
                unchanged: diff.unchanged.length,
                notRechecked: diff.notRechecked.length,
              },
              resolved: slim(diff.resolved),
              notRechecked: slim(diff.notRechecked),
            };
            for (const x of diff.added) change.set(x.fingerprint, 'new');
            for (const x of diff.regressed) change.set(x.fingerprint, 'regressed');
            for (const x of diff.unchanged) change.set(x.fingerprint, 'unchanged');
          }
          await writeAudit(deps, tx, req, {
            orgId: a.orgId,
            actorId: a.userId,
            action: 'report.exported',
            targetType: 'scan',
            targetId: scanId,
            metadata: { format },
          });
          return {
            generatedAt: deps.now().toISOString(),
            project: project ?? { name: 'Project', baseUrl: scan.startUrl },
            scan: {
              id: scan.id,
              startUrl: scan.startUrl,
              wcagVersion: scan.wcagVersion,
              conformanceLevel: scan.conformanceLevel,
              maxPages: scan.maxPages,
              finishedAt: scan.finishedAt?.toISOString() ?? null,
            },
            pages: {
              scanned: pages.filter((p) => p.status === 'scanned').length,
              notScanned: pages.filter((p) => p.status !== 'scanned').length,
            },
            manualTasks: {
              total: tasks.length,
              pending: tasks.filter((t) => t.status === 'pending').length,
            },
            notScannedPages: pages
              .filter((p) => p.status !== 'scanned')
              .slice(0, 100)
              .map((p) => ({ url: p.url, status: p.status, failureReason: p.failureReason })),
            comparison,
            findings: rows.map(({ fingerprint, ...f }) => {
              const c = change.get(fingerprint);
              return c ? { ...f, change: c } : f;
            }),
          };
        },
      );

      const name = `accessibility-report-${scanId.slice(0, 8)}`;
      void reply.header('cache-control', 'no-store');
      if (format === 'json') return { disclaimer: REPORT_DISCLAIMER, report: data };
      if (format === 'csv') {
        void reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${name}.csv"`);
        return renderCsv(data);
      }
      const html = renderHtml(data);
      if (format === 'html') {
        void reply
          .header('content-type', 'text/html; charset=utf-8')
          .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
          .header('content-disposition', `attachment; filename="${name}.html"`);
        return html;
      }
      let pdf: Buffer;
      try {
        pdf = await htmlToPdf(html);
      } catch (err) {
        req.log.error({ err }, 'pdf render failed');
        throw new AppError('INTERNAL', 'PDF export is unavailable. Use the HTML export instead.');
      }
      void reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${name}.pdf"`);
      return pdf;
    },
  );
}
