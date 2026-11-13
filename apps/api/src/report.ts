/** Pure report renderers (JSON/CSV/HTML). No I/O so they are easy to test. */

export interface ReportFinding {
  ruleId: string;
  ruleTitle: string;
  classification: string;
  severity: string;
  confidence: number;
  wcagCriteria: string[];
  message: string;
  selector: string | null;
  occurrences: number;
  reviewStatus: string;
  pageUrl: string;
  /** Versus the previous completed scan. Absent when there is nothing to compare with. */
  change?: 'new' | 'regressed' | 'unchanged';
}

export interface ReportGone {
  ruleId: string;
  ruleTitle: string;
  classification: string;
  severity: string;
  selector: string | null;
  pageUrl: string;
}

export interface ReportComparison {
  baselineScanId: string;
  counts: {
    added: number;
    resolved: number;
    regressed: number;
    unchanged: number;
    notRechecked: number;
  };
  /** Page rescanned and the issue is gone. */
  resolved: ReportGone[];
  /** Page was not scanned this time, so the issue's state is unknown. */
  notRechecked: ReportGone[];
}

export interface ReportData {
  generatedAt: string;
  project: { name: string; baseUrl: string };
  scan: {
    id: string;
    startUrl: string;
    wcagVersion: string;
    conformanceLevel: string;
    maxPages: number;
    finishedAt: string | null;
  };
  pages: { scanned: number; notScanned: number };
  /** Pages that were not scanned, with the reason. */
  notScannedPages?: { url: string; status: string; failureReason: string | null }[];
  /** Null when the project has no earlier completed scan. */
  comparison?: ReportComparison | null;
  manualTasks: { total: number; pending: number };
  findings: ReportFinding[];
}

export const REPORT_DISCLAIMER =
  'Automated testing finds only part of the WCAG issues on a site. Confirmed violations are reproducible failures. Potential violations and manual checks need a person to decide. This report is not a statement of conformance.';

const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Neutralise spreadsheet formula injection: cells starting with = + - @ tab or CR run as formulas. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function renderCsv(d: ReportData): string {
  const head = [
    'classification',
    'severity',
    'rule',
    'title',
    'wcag',
    'page',
    'selector',
    'occurrences',
    'confidence',
    'review_status',
    'message',
    'change',
  ];
  const lines = [head.join(',')];
  for (const f of d.findings)
    lines.push(
      [
        f.classification,
        f.severity,
        f.ruleId,
        f.ruleTitle,
        f.wcagCriteria.join(' '),
        f.pageUrl,
        f.selector ?? '',
        f.occurrences,
        f.confidence,
        f.reviewStatus,
        f.message,
        f.change ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  // Findings absent from this scan stay visible so CSV matches the other formats.
  const gone = (rows: ReportGone[], change: string) =>
    rows.map((g) =>
      [
        g.classification,
        g.severity,
        g.ruleId,
        g.ruleTitle,
        '',
        g.pageUrl,
        g.selector ?? '',
        '',
        '',
        '',
        '',
        change,
      ]
        .map(csvCell)
        .join(','),
    );
  if (d.comparison) {
    lines.push(...gone(d.comparison.resolved, 'resolved'));
    lines.push(...gone(d.comparison.notRechecked, 'not_rechecked'));
  }
  return `${lines.join('\r\n')}\r\n`;
}

const GROUPS: { key: string; title: string; note: string }[] = [
  { key: 'confirmed', title: 'Confirmed violations', note: 'Reproducible failures.' },
  {
    key: 'strong_potential',
    title: 'Potential violations',
    note: 'Likely problems that a person should confirm.',
  },
  {
    key: 'manual_verification',
    title: 'Needs manual check',
    note: 'Automation cannot decide these.',
  },
  { key: 'informational', title: 'Informational', note: 'Context only. Not failures.' },
];

function goneList(title: string, note: string, rows: ReportGone[], total: number): string {
  if (total === 0) return '';
  const items = rows
    .map(
      (g) =>
        `<li>${esc(g.ruleTitle)} (${esc(g.severity)}) on ${esc(g.pageUrl)}${g.selector ? ` <code>${esc(g.selector)}</code>` : ''}</li>`,
    )
    .join('');
  return `<h3>${esc(title)} (${String(total)})</h3><p>${esc(note)}</p><ul>${items}</ul>`;
}

function renderChange(d: ReportData): string {
  const c = d.comparison;
  if (!c)
    return '<section><h2>Change since previous scan</h2><p>No earlier completed scan of this project to compare with.</p></section>';
  return `<section><h2>Change since previous scan</h2>
<p>Findings are matched by rule, element and page path.</p>
<ul>
<li>New: ${String(c.counts.added)}</li>
<li>Resolved (page rescanned, issue gone): ${String(c.counts.resolved)}</li>
<li>Regressed (marked fixed, found again): ${String(c.counts.regressed)}</li>
<li>Unchanged: ${String(c.counts.unchanged)}</li>
<li>Not rechecked (page not scanned this time, status unknown): ${String(c.counts.notRechecked)}</li>
</ul>
${goneList('Resolved findings', 'The page was scanned again and the issue was not found.', c.resolved, c.counts.resolved)}
${goneList('Not rechecked', 'These are not resolved. Their pages were not scanned this time.', c.notRechecked, c.counts.notRechecked)}
</section>`;
}

function renderCoverage(d: ReportData): string {
  const pages = d.notScannedPages ?? [];
  const list =
    pages.length === 0
      ? ''
      : `<h3>Pages not scanned</h3><ul>${pages
          .map(
            (p) =>
              `<li>${esc(p.url)}: ${esc((p.failureReason ?? p.status).replaceAll('_', ' '))}</li>`,
          )
          .join('')}</ul>`;
  return `<section><h2>Coverage</h2>
<p>${String(d.pages.scanned)} scanned, ${String(d.pages.notScanned)} not scanned (limit ${String(d.scan.maxPages)}). Only pages reachable without logging in are covered unless a login profile was used. Complex widgets need manual testing.</p>
${list}</section>`;
}

export function renderHtml(d: ReportData): string {
  const count = (k: string) => d.findings.filter((f) => f.classification === k).length;
  const sections = GROUPS.map((g) => {
    const rows = d.findings.filter((f) => f.classification === g.key);
    const body =
      rows.length === 0
        ? '<p>None found.</p>'
        : `<table><thead><tr><th scope="col">Severity</th><th scope="col">Rule</th><th scope="col">WCAG</th><th scope="col">Page</th><th scope="col">Element</th><th scope="col">Status</th></tr></thead><tbody>${rows
            .map(
              (f) =>
                `<tr><td>${esc(f.severity)}</td><td>${esc(f.ruleTitle)}<br><small>${esc(f.message)}</small></td><td>${esc(f.wcagCriteria.join(', ') || 'n/a')}</td><td>${esc(f.pageUrl)}</td><td>${f.selector ? `<code>${esc(f.selector)}</code>` : 'Page level'}</td><td>${esc(f.reviewStatus.replaceAll('_', ' '))}</td></tr>`,
            )
            .join('')}</tbody></table>`;
    return `<section><h2>${esc(g.title)} (${String(rows.length)})</h2><p>${esc(g.note)}</p>${body}</section>`;
  }).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accessibility report: ${esc(d.project.name)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;color:#111;margin:2rem auto;max-width:60rem;padding:0 1rem}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}
th,td{border:1px solid #767676;padding:.4rem;text-align:left;vertical-align:top;word-break:break-word}
th{background:#eee}code{font-size:12px}
.note{border:2px solid #111;padding:.75rem;margin:1rem 0}
@media print{body{margin:0}section{break-inside:auto}tr{break-inside:avoid}}
</style></head><body>
<h1>Accessibility report: ${esc(d.project.name)}</h1>
<p>${esc(d.project.baseUrl)} &middot; WCAG ${esc(d.scan.wcagVersion)} level ${esc(d.scan.conformanceLevel)} &middot; scan finished ${esc(d.scan.finishedAt ?? 'unknown')} &middot; generated ${esc(d.generatedAt)}</p>
<div class="note"><strong>Read this first.</strong> ${esc(REPORT_DISCLAIMER)}</div>
<h2>Summary</h2>
<ul>
<li>Confirmed violations: ${String(count('confirmed'))}</li>
<li>Potential violations: ${String(count('strong_potential'))}</li>
<li>Manual checks: ${String(count('manual_verification'))} findings, ${String(d.manualTasks.pending)} of ${String(d.manualTasks.total)} tasks still pending</li>
<li>Pages scanned: ${String(d.pages.scanned)}; pages not scanned: ${String(d.pages.notScanned)} (limit ${String(d.scan.maxPages)})</li>
</ul>
${renderChange(d)}
${renderCoverage(d)}
${sections}
</body></html>`;
}
