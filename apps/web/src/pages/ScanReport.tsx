import { useEffect, useState } from 'react';
import { CompareCard, CoverageLimits, ExportCard } from '@/components/ScanInsights';
import {
  ClassPill,
  ConfidenceText,
  Donut,
  PageBars,
  SeverityBars,
  SeverityTag,
} from '@/components/findings';
import {
  EmptyState,
  ErrorAlert,
  Loading,
  Notice,
  PageHeader,
  SelectField,
  StatusBadge,
} from '@/components/ui';
import {
  CLASS_HELP,
  CLASS_LABEL,
  api,
  type Classification,
  type Coverage,
  type FindingRow,
  type ScanDetail,
} from '@/lib/api';
import { Link, useParams } from '@/lib/nav';
import { useAsync } from '@/lib/useAsync';
import { useOrg } from '@/lib/useOrg';

const CLASSES: Classification[] = [
  'confirmed',
  'strong_potential',
  'manual_verification',
  'informational',
];

function sortFindings(rows: FindingRow[], by: string): FindingRow[] {
  if (by === 'occurrences') return [...rows].sort((a, b) => b.occurrences - a.occurrences);
  if (by === 'confidence') return [...rows].sort((a, b) => b.confidence - a.confidence);
  if (by === 'page') return [...rows].sort((a, b) => a.pageUrl.localeCompare(b.pageUrl));
  return rows;
}

interface Preset {
  n: number;
  cls: string;
  sev: string;
}

const PAGE_SIZE = 25;

const REASON_LABEL: Record<string, string> = {
  excluded_by_robots: 'Excluded by robots.txt',
  page_cap: 'Not scanned: page limit reached',
};

function reasonOf(p: { status: string; failureReason: string | null }): string {
  const r = p.failureReason ?? '';
  return REASON_LABEL[r] ?? (r ? r.replaceAll('_', ' ') : p.status.replaceAll('_', ' '));
}

function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}

function Findings({
  orgId,
  scanId,
  pages,
  preset,
}: {
  orgId: string;
  scanId: string;
  pages: ScanDetail['pages'];
  preset: Preset;
}) {
  const [cls, setCls] = useState('');
  const [sev, setSev] = useState('');
  const [review, setReview] = useState('open');
  const [pageId, setPageId] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => {
    if (preset.n === 0) return;
    setCls(preset.cls);
    setSev(preset.sev);
    setReview('open');
    setPageId('');
  }, [preset]);
  useEffect(() => {
    setShown(PAGE_SIZE);
  }, [cls, sev, review, pageId]);
  const qs = new URLSearchParams();
  if (cls) qs.set('classification', cls);
  if (sev) qs.set('severity', sev);
  if (review) qs.set('review', review);
  if (pageId) qs.set('pageId', pageId);
  const [sort, setSort] = useState('severity');
  const q = qs.toString();
  const list = useAsync(
    () => api<{ findings: FindingRow[] }>('GET', `/orgs/${orgId}/scans/${scanId}/findings?${q}`),
    `${scanId}?${q}`,
  );
  // The API returns severity order already; other orders are applied here on the loaded rows.
  const rows = list.data ? sortFindings(list.data.findings, sort) : [];
  return (
    <section aria-labelledby="findings-h">
      <h2 id="findings-h">Findings</h2>
      <div className="filters" role="group" aria-label="Filter findings">
        <SelectField
          label="Type"
          value={cls}
          onChange={setCls}
          options={[
            { value: '', label: 'All types' },
            ...CLASSES.map((c) => ({ value: c, label: CLASS_LABEL[c] })),
          ]}
        />
        <SelectField
          label="Severity"
          value={sev}
          onChange={setSev}
          options={[
            { value: '', label: 'All severities' },
            { value: 'critical', label: 'Critical' },
            { value: 'serious', label: 'Serious' },
            { value: 'moderate', label: 'Moderate' },
            { value: 'minor', label: 'Minor' },
          ]}
        />
        <SelectField
          label="Review status"
          value={review}
          onChange={setReview}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'false_positive', label: 'False positive' },
            { value: 'accepted_risk', label: 'Accepted risk' },
            { value: 'fixed', label: 'Fixed' },
            { value: '', label: 'Any' },
          ]}
        />
        <SelectField
          label="Sort by"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'severity', label: 'Severity (highest first)' },
            { value: 'occurrences', label: 'Most occurrences' },
            { value: 'confidence', label: 'Highest confidence' },
            { value: 'page', label: 'Page address' },
          ]}
        />
        <SelectField
          label="Page"
          value={pageId}
          onChange={setPageId}
          options={[
            { value: '', label: 'All pages' },
            ...pages
              .filter((p) => p.status === 'scanned')
              .map((p) => ({ value: p.id, label: p.url })),
          ]}
        />
      </div>
      <div aria-live="polite">
        {list.loading && !list.data ? <Loading label="Loading findings" /> : null}
        {list.error ? <ErrorAlert error={list.error} onRetry={list.reload} /> : null}
        {list.data && list.data.findings.length === 0 ? (
          <EmptyState title="No findings match">Try different filters.</EmptyState>
        ) : null}
      </div>
      {list.data && rows.length > 0 ? (
        <>
          <p className="muted" data-testid="finding-counts">
            {rows.length} unique finding{rows.length === 1 ? '' : 's'} ·{' '}
            {rows.reduce((n, f) => n + f.occurrences, 0)} affected element
            {rows.reduce((n, f) => n + f.occurrences, 0) === 1 ? '' : 's'} ·{' '}
            {new Set(rows.map((f) => f.pageId)).size} affected page
            {new Set(rows.map((f) => f.pageId)).size === 1 ? '' : 's'}. A unique finding is one rule
            failing on one page; it can affect several elements.
          </p>
          <ul className="finding-list">
            {rows.slice(0, shown).map((f) => (
              <li key={f.id} className="finding-item">
                <div className="row">
                  <ClassPill value={f.classification} />
                  <SeverityTag value={f.severity} />
                  <span className="muted">
                    <ConfidenceText value={f.confidence} />
                  </span>
                </div>
                <h3>
                  <Link href={`/orgs/${orgId}/findings/${f.id}`}>{f.ruleTitle}</Link>
                </h3>
                <p>{f.message}</p>
                <p className="muted break">
                  Page: <span title={f.pageUrl}>{pagePath(f.pageUrl)}</span>
                  {f.selector ? (
                    <>
                      {' '}
                      · Element: <code className="break">{f.selector}</code>
                    </>
                  ) : null}
                </p>
                <p className="muted">
                  {f.wcagCriteria.length > 0 ? `WCAG ${f.wcagCriteria.join(', ')} · ` : ''}
                  {f.occurrences} affected element{f.occurrences === 1 ? '' : 's'}
                  {f.reviewStatus !== 'open' ? ` · ${f.reviewStatus.replaceAll('_', ' ')}` : ''}
                  {' · '}
                  <Link href={`/orgs/${orgId}/findings/${f.id}#visual-evidence`}>
                    Open evidence
                  </Link>
                </p>
              </li>
            ))}
          </ul>
          {rows.length > shown ? (
            <p>
              Showing {shown} of {rows.length}.{' '}
              <button
                type="button"
                className="btn secondary"
                onClick={() => setShown((s) => s + PAGE_SIZE)}
              >
                Show more findings
              </button>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default function ScanReport() {
  const { orgId } = useOrg();
  const { scanId } = useParams<{ scanId: string }>();
  const d = useAsync(() => api<ScanDetail>('GET', `/orgs/${orgId}/scans/${scanId}`), scanId);
  const cov = useAsync(
    () => api<Coverage>('GET', `/orgs/${orgId}/scans/${scanId}/coverage`),
    `cov-${scanId}-${d.data?.scan.status ?? ''}`,
  );
  const active = d.data?.scan.status === 'queued' || d.data?.scan.status === 'running';
  const { reload } = d;
  const [preset, setPreset] = useState<Preset>({ n: 0, cls: '', sev: '' });
  const jumpTo = (cls: string, sev: string) => {
    setPreset((p) => ({ n: p.n + 1, cls, sev }));
    document.getElementById('findings-h')?.scrollIntoView({ block: 'start' });
  };
  useEffect(() => {
    if (!active) return;
    const t = setInterval(reload, 3000);
    return () => {
      clearInterval(t);
    };
  }, [active, reload]);

  if (d.loading && !d.data) return <Loading label="Loading report" />;
  if (d.error || !d.data)
    return <ErrorAlert error={d.error ?? new Error('Not found.')} onRetry={d.reload} />;
  const { scan, summary, pages } = d.data;
  const bc = summary.byClassification;
  const done = scan.status === 'completed';
  const pending = summary.manualTasks['pending'] ?? 0;
  const urgentSev = (summary.bySeverity['critical'] ?? 0) + (summary.bySeverity['serious'] ?? 0);
  const potentialCount = bc['strong_potential'] ?? 0;
  const confirmedCount = bc['confirmed'] ?? 0;
  const scannedPages = pages.filter((p) => p.status === 'scanned');
  const failedPages = pages.filter((p) => p.status === 'failed');
  const skippedPages = pages.filter((p) => p.status === 'skipped');
  const excludedPages = skippedPages.filter((p) => p.failureReason === 'excluded_by_robots');
  const notScanned = pages.filter((p) => p.status !== 'scanned');
  const otherSkipped = skippedPages.length - excludedPages.length;
  const incompleteReasons = [
    failedPages.length > 0 ? `${String(failedPages.length)} failed` : '',
    otherSkipped > 0 ? `${String(otherSkipped)} skipped` : '',
    excludedPages.length > 0 ? `${String(excludedPages.length)} excluded by robots.txt` : '',
    cov.data?.reachedPageLimit ? 'page limit reached' : '',
  ].filter(Boolean);
  const coverageComplete = incompleteReasons.length === 0;

  return (
    <>
      <p style={{ margin: '0 0 0.75rem' }}>
        <Link href={`/orgs/${orgId}/projects/${scan.projectId}`}>&larr; Back to project</Link>
      </p>
      <PageHeader
        title="Scan report"
        description={`${scan.startUrl} · WCAG ${scan.wcagVersion} ${scan.conformanceLevel}`}
        actions={
          <span className="row" style={{ gap: '0.4rem' }}>
            <span className="muted">Execution:</span>
            <StatusBadge status={scan.status} />
            {done ? (
              <>
                <span className="muted">Coverage:</span>
                <span className={`badge ${coverageComplete ? 'complete' : 'incomplete'}`}>
                  {coverageComplete ? 'complete' : 'incomplete'}
                </span>
              </>
            ) : null}
          </span>
        }
      />
      {done && !coverageComplete ? (
        <Notice kind="warn">
          The scan job finished, but coverage is incomplete ({incompleteReasons.join(', ')}).
          Results describe only the {scannedPages.length} of {pages.length} discovered pages that
          were scanned. See Coverage below.
        </Notice>
      ) : null}
      {active ? (
        <Notice kind="warn">Scan in progress. This page updates automatically.</Notice>
      ) : null}
      {scan.status === 'failed' ? (
        <Notice kind="warn">
          Scan failed: {(scan.failureReason ?? 'unknown').replaceAll('_', ' ')}.
        </Notice>
      ) : null}

      {done || scan.status === 'cancelled' ? (
        <>
          <div className="card" aria-labelledby="priority-h" role="region">
            <h2 id="priority-h">Fix first</h2>
            <p>
              {(summary.bySeverity['critical'] ?? 0) + (summary.bySeverity['serious'] ?? 0) > 0
                ? `${String((summary.bySeverity['critical'] ?? 0) + (summary.bySeverity['serious'] ?? 0))} open finding${(summary.bySeverity['critical'] ?? 0) + (summary.bySeverity['serious'] ?? 0) === 1 ? ' is' : 's are'} critical or serious (${String(summary.bySeverity['critical'] ?? 0)} critical, ${String(summary.bySeverity['serious'] ?? 0)} serious). Start with confirmed issues.`
                : 'No open critical or serious issues were found in the pages scanned.'}{' '}
              {pending > 0
                ? `${String(pending)} manual check${pending === 1 ? '' : 's'} still need a person.`
                : ''}
            </p>
            {urgentSev > 0 || potentialCount > 0 || pending > 0 ? (
              <div className="row" data-testid="next-actions">
                {confirmedCount > 0 && urgentSev > 0 ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => jumpTo('confirmed', 'critical')}
                  >
                    Review critical findings
                  </button>
                ) : null}
                {potentialCount > 0 ? (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => jumpTo('strong_potential', '')}
                  >
                    Review potential findings
                  </button>
                ) : null}
                {pending > 0 ? (
                  <Link className="btn secondary" href={`/orgs/${orgId}/scans/${scan.id}/manual`}>
                    Complete manual verification
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="kpis">
            {CLASSES.map((c) => (
              <div key={c} className={`kpi ${c}`}>
                <strong>{bc[c] ?? 0}</strong>
                <span>{CLASS_LABEL[c]}</span>
                <p>{CLASS_HELP[c]}</p>
              </div>
            ))}
          </div>
          <Notice>
            There is deliberately no single accessibility score. Automated testing finds only part
            of WCAG issues, so a clean result does not prove conformance. Counts show open findings
            only.
          </Notice>

          <div className="chart-grid" style={{ marginTop: '1rem' }}>
            <div className="card">
              <h2>Findings by type</h2>
              <Donut
                label="Open findings by type"
                items={CLASSES.map((c) => ({ key: c, label: CLASS_LABEL[c], value: bc[c] ?? 0 }))}
              />
            </div>
            <div className="card">
              <h2>Severity</h2>
              <SeverityBars counts={summary.bySeverity} />
            </div>
          </div>

          <div className="card">
            <h2>Most affected pages</h2>
            <PageBars pages={pages} />
            <ul className="legend inline">
              {CLASSES.slice(0, 3).map((c) => (
                <li key={c}>
                  <span className={`swatch ${c}`} aria-hidden="true" />
                  {CLASS_LABEL[c]}
                </li>
              ))}
            </ul>
          </div>

          <Findings orgId={orgId} scanId={scan.id} pages={pages} preset={preset} />

          <div className="card">
            <h2>Manual verification</h2>
            <p>
              {pending > 0
                ? `${String(pending)} check${pending === 1 ? '' : 's'} still need a person.`
                : 'No manual checks pending.'}{' '}
              <Link href={`/orgs/${orgId}/scans/${scan.id}/manual`}>Open the checklist</Link>
            </p>
          </div>

          <div className="card">
            <h2>Coverage</h2>
            <p>
              <strong>Execution:</strong> scan {scan.status}. <strong>Coverage:</strong>{' '}
              {coverageComplete
                ? 'complete, every discovered page was scanned.'
                : `incomplete (${incompleteReasons.join(', ')}).`}
            </p>
            <p data-testid="coverage-counts">
              {pages.length} discovered · {scannedPages.length} scanned · {failedPages.length}{' '}
              failed · {skippedPages.length - excludedPages.length} skipped · {excludedPages.length}{' '}
              excluded by configuration (robots.txt). Interaction tests{' '}
              {scan.interactionTests ? 'were run' : 'were not run'}.
            </p>
            {notScanned.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <caption>Pages not scanned, with the reason</caption>
                  <thead>
                    <tr>
                      <th scope="col">Page</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notScanned.map((p) => (
                      <tr key={p.id}>
                        <th scope="row" className="break">
                          {p.url}
                        </th>
                        <td style={{ textTransform: 'capitalize' }}>{p.status}</td>
                        <td>{reasonOf(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <CoverageLimits coverage={cov.data} />
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Pages in this scan</caption>
                <thead>
                  <tr>
                    <th scope="col">Page</th>
                    <th scope="col">Status</th>
                    <th scope="col">Confirmed</th>
                    <th scope="col">Potential</th>
                    <th scope="col">Manual</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => (
                    <tr key={p.id}>
                      <th scope="row">
                        {p.title ?? p.url}
                        <div className="muted" style={{ fontWeight: 400 }}>
                          {p.url}
                        </div>
                      </th>
                      <td>
                        <span style={{ textTransform: 'capitalize' }}>
                          {p.status.replaceAll('_', ' ')}
                        </span>
                        {p.failureReason ? ` (${p.failureReason.replaceAll('_', ' ')})` : ''}
                      </td>
                      <td>{p.confirmed}</td>
                      <td>{p.potential}</td>
                      <td>{p.manual}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {done ? <CompareCard orgId={orgId} scanId={scan.id} /> : null}
          {done ? <ExportCard orgId={orgId} scanId={scan.id} /> : null}
        </>
      ) : null}
    </>
  );
}
