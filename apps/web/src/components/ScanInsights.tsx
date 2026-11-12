import { useState } from 'react';
import { Button, ErrorAlert, Loading, Notice } from '@/components/ui';
import {
  api,
  downloadReport,
  type CompareItem,
  type CompareResult,
  type Coverage,
  type ReportFormat,
} from '@/lib/api';
import { Link } from '@/lib/nav';
import { useAsync } from '@/lib/useAsync';

const FORMATS: { id: ReportFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF' },
  { id: 'html', label: 'HTML' },
  { id: 'csv', label: 'CSV' },
  { id: 'json', label: 'JSON' },
];

export function ExportCard({ orgId, scanId }: { orgId: string; scanId: string }) {
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const run = async (f: ReportFormat) => {
    setBusy(f);
    setError(null);
    try {
      await downloadReport(orgId, scanId, f);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Export failed.'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="card">
      <h2>Export report</h2>
      <p className="muted">
        Every export carries the same note: automated testing is partial and this is not a
        conformance statement.
      </p>
      <div className="row" role="group" aria-label="Export format">
        {FORMATS.map((f) => (
          <Button
            key={f.id}
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void run(f.id)}
          >
            {busy === f.id ? `Preparing ${f.label}…` : `Download ${f.label}`}
          </Button>
        ))}
      </div>
      <div aria-live="polite">{error ? <ErrorAlert error={error} /> : null}</div>
    </div>
  );
}

function ItemList({ title, items, total }: { title: string; items: CompareItem[]; total: number }) {
  if (total === 0) return null;
  return (
    <details>
      <summary>
        {title} ({total})
      </summary>
      <ul className="finding-list">
        {items.map((i) => (
          <li key={i.id} className="finding-item">
            <strong>{i.ruleTitle}</strong>
            <p className="muted">
              {i.severity} · {i.pageUrl}
              {i.selector ? ` · ${i.selector}` : ''}
            </p>
          </li>
        ))}
      </ul>
      {total > items.length ? <p className="muted">Showing first {items.length}.</p> : null}
    </details>
  );
}

export function CompareCard({ orgId, scanId }: { orgId: string; scanId: string }) {
  const r = useAsync(
    () => api<CompareResult>('GET', `/orgs/${orgId}/scans/${scanId}/compare`),
    `cmp-${scanId}`,
  );
  const c = r.data?.comparison;
  return (
    <div className="card">
      <h2>Change since previous scan</h2>
      {r.loading && !r.data ? <Loading label="Comparing scans" /> : null}
      {r.error ? <ErrorAlert error={r.error} onRetry={r.reload} /> : null}
      {r.data && !c ? <p>No earlier completed scan of this project to compare with.</p> : null}
      {r.data && c ? (
        <>
          <p className="muted">
            Compared with the{' '}
            <Link href={`/orgs/${orgId}/scans/${r.data.baseline?.id ?? ''}`}>previous scan</Link>.
            Findings are matched by rule, element and page path.
          </p>
          <ul>
            <li>New: {c.counts.added}</li>
            <li>Resolved: {c.counts.resolved}</li>
            <li>Still present: {c.counts.persisting}</li>
            <li>Regressions (new or reopened real issues): {c.counts.regressions}</li>
            <li>Not rechecked (page not scanned this time): {c.counts.notRechecked}</li>
          </ul>
          <ItemList title="Regressions" items={c.regressions} total={c.counts.regressions} />
          <ItemList title="New findings" items={c.added} total={c.counts.added} />
          <ItemList title="Resolved findings" items={c.resolved} total={c.counts.resolved} />
          <ItemList title="Not rechecked" items={c.notRechecked} total={c.counts.notRechecked} />
        </>
      ) : null}
    </div>
  );
}

export function CoverageLimits({ orgId, scanId }: { orgId: string; scanId: string }) {
  const r = useAsync(
    () => api<Coverage>('GET', `/orgs/${orgId}/scans/${scanId}/coverage`),
    `cov-${scanId}`,
  );
  if (!r.data) return null;
  return (
    <>
      {r.data.reachedPageLimit ? (
        <Notice kind="warn">
          The page limit was reached, so some pages of the site may not have been scanned.
        </Notice>
      ) : null}
      <h3>What this scan does not cover</h3>
      <ul>
        {r.data.limits.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </>
  );
}
