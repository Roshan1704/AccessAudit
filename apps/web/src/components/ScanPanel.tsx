import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  Button,
  EmptyState,
  ErrorAlert,
  Field,
  Loading,
  Notice,
  SelectField,
  StatusBadge,
} from '@/components/ui';
import {
  ApiError,
  api,
  atLeast,
  type AuthProfile,
  type Domain,
  type Role,
  type ScanListItem,
} from '@/lib/api';
import { Link } from '@/lib/nav';
import { useAsync } from '@/lib/useAsync';

const ACTIVE = new Set(['queued', 'running']);

function explain(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === 'DOMAIN_NOT_VERIFIED')
    return 'Verify this site’s domain first. Scans only run against verified domains.';
  if (e.code === 'QUOTA_EXCEEDED')
    return 'Two scans are already waiting or running for this project. Wait for one to finish.';
  if (e.code === 'URL_NOT_ALLOWED') return 'That address cannot be scanned.';
  return null;
}

export function ScanPanel({
  orgId,
  projectId,
  baseUrl,
  role,
  domainsVersion,
  onNeedDomains,
}: {
  orgId: string;
  projectId: string;
  baseUrl: string;
  role: Role;
  /** Changes whenever domains change, so the verification gate refreshes. */
  domainsVersion: number;
  /** Lets a tabbed parent reveal the domains section before it is focused. */
  onNeedDomains?: () => void;
}) {
  const canScan = atLeast(role, 'member');
  const isAdmin = atLeast(role, 'admin');
  const domains = useAsync(
    () => api<{ domains: Domain[] }>('GET', `/orgs/${orgId}/projects/${projectId}/domains`),
    `${projectId}:${String(domainsVersion)}`,
  );
  // Unknown (still loading or failed) is treated as "do not block"; the server stays the authority.
  const domainsKnown = domains.data !== null;
  const hasVerified = domains.data?.domains.some((d) => d.status === 'verified') ?? false;
  const blocked = domainsKnown && !hasVerified;
  const hasAny = (domains.data?.domains.length ?? 0) > 0;

  function goToDomains() {
    if (onNeedDomains) {
      onNeedDomains();
      return;
    }
    const el = document.getElementById('domains');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.focus();
    }
  }
  const list = useAsync(
    () => api<{ scans: ScanListItem[] }>('GET', `/orgs/${orgId}/scans?projectId=${projectId}`),
    projectId,
  );
  // Reuses domainsVersion: the parent bumps it whenever domains or login profiles change.
  const profiles = useAsync(
    () =>
      api<{ authProfiles: AuthProfile[] }>(
        'GET',
        `/orgs/${orgId}/auth-profiles?projectId=${projectId}`,
      ),
    `${projectId}:p${String(domainsVersion)}`,
  );
  const [profileId, setProfileId] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [maxPages, setMaxPages] = useState('10');
  const [wcag, setWcag] = useState('2.2');
  const [level, setLevel] = useState('AA');
  const [interaction, setInteraction] = useState(true);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const anyActive = list.data?.scans.some((s) => ACTIVE.has(s.status)) ?? false;
  const { reload } = list;
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(reload, 4000);
    return () => {
      clearInterval(t);
    };
  }, [anyActive, reload]);

  async function start(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/orgs/${orgId}/scans`, {
        projectId,
        ...(startUrl.trim() ? { startUrl: startUrl.trim() } : {}),
        maxPages: Number(maxPages),
        wcagVersion: wcag,
        level,
        interactionTests: interaction,
        ...(override ? { robotsOverride: { reason } } : {}),
        ...(profileId && profiles.data?.authProfiles.some((p) => p.id === profileId)
          ? { authProfileId: profileId }
          : {}),
      });
      list.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setError(null);
    try {
      await api('POST', `/orgs/${orgId}/scans/${id}/cancel`);
      list.reload();
    } catch (err) {
      setError(err);
    }
  }

  const friendly = explain(error);

  return (
    <>
      <h2>Scans</h2>
      <p className="muted">
        Automated checks cover only part of WCAG. Results are split into confirmed violations,
        potential violations and items that need a person to check.
      </p>
      {canScan ? (
        <form className="card stack" onSubmit={(e) => void start(e)} noValidate>
          <h3>Start a scan</h3>
          {blocked ? (
            <Notice kind="warn">
              <p style={{ marginTop: 0 }}>
                <strong>Step 1: verify your domain.</strong>{' '}
                {hasAny
                  ? 'None of this project’s domains is verified yet.'
                  : 'This project has no domain yet.'}{' '}
                Scans only run against sites you have proven you control.
              </p>
              <p style={{ marginBottom: '0.5rem' }}>
                {isAdmin
                  ? hasAny
                    ? 'Follow the steps shown for your domain (DNS TXT record or well-known file), then choose “Verify now”.'
                    : 'Add your site’s hostname under Domains, follow the verification steps, then choose “Verify now”.'
                  : 'Ask an admin of this organization to add and verify the domain.'}
              </p>
              <Button type="button" variant="secondary" onClick={goToDomains}>
                Go to Domains
              </Button>
            </Notice>
          ) : null}
          <div className="form-grid">
            <Field
              label="Max pages (1 to 50)"
              type="number"
              min={1}
              max={50}
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
            />
          </div>
          {profiles.data && profiles.data.authProfiles.length > 0 ? (
            <SelectField
              label="Sign in with"
              value={profileId}
              onChange={setProfileId}
              options={[
                { value: '', label: 'No login (public pages only)' },
                ...profiles.data.authProfiles.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          ) : null}
          <details className="add-panel">
            <summary>Advanced options</summary>
            <div className="stack">
              <Field
                label="Start URL (optional)"
                placeholder={baseUrl}
                hint={`Leave empty to start from ${baseUrl}. Must be on a verified domain.`}
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
              />
              <div className="form-grid">
                <SelectField
                  label="WCAG version"
                  value={wcag}
                  onChange={setWcag}
                  options={[
                    { value: '2.2', label: 'WCAG 2.2' },
                    { value: '2.1', label: 'WCAG 2.1' },
                    { value: '2.0', label: 'WCAG 2.0' },
                  ]}
                />
                <SelectField
                  label="Level"
                  value={level}
                  onChange={setLevel}
                  options={[
                    { value: 'A', label: 'A' },
                    { value: 'AA', label: 'AA' },
                    { value: 'AAA', label: 'AAA' },
                  ]}
                />
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={interaction}
                  onChange={(e) => setInteraction(e.target.checked)}
                />
                <span>
                  Run interaction tests (keyboard, dialogs, menus, tabs). Read-only: forms are never
                  submitted.
                </span>
              </label>
              {isAdmin ? (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={override}
                      onChange={(e) => setOverride(e.target.checked)}
                    />
                    <span>Ignore robots.txt (admin only, recorded in the audit log)</span>
                  </label>
                  {override ? (
                    <Field
                      label="Reason for ignoring robots.txt"
                      hint="10 to 500 characters."
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          </details>
          {friendly ? (
            <Notice kind="warn">
              <p style={{ margin: 0 }}>{friendly}</p>
              {error instanceof ApiError && error.code === 'DOMAIN_NOT_VERIFIED' ? (
                <Button type="button" variant="secondary" onClick={goToDomains}>
                  Go to Domains
                </Button>
              ) : null}
            </Notice>
          ) : (
            <ErrorAlert error={error} />
          )}
          <div>
            <Button type="submit" busy={busy} disabled={blocked}>
              Scan now
            </Button>
            {blocked ? (
              <span className="muted" style={{ marginLeft: '0.75rem' }}>
                Available once a domain is verified.
              </span>
            ) : null}
          </div>
        </form>
      ) : null}

      {list.loading && !list.data ? <Loading label="Loading scans" /> : null}
      {list.error ? <ErrorAlert error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.scans.length === 0 ? (
        <EmptyState title="No scans yet">
          {canScan ? 'Start a scan above.' : 'A member can start the first scan.'}
        </EmptyState>
      ) : null}
      {list.data && list.data.scans.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Recent scans</caption>
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Status</th>
                <th scope="col">Scope</th>
                <th scope="col">Open issues</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.scans.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{new Date(s.createdAt).toLocaleString()}</th>
                  <td>
                    <StatusBadge status={s.status} />
                    {s.failureReason ? (
                      <div className="error-text">{s.failureReason.replaceAll('_', ' ')}</div>
                    ) : null}
                  </td>
                  <td>
                    WCAG {s.wcagVersion} {s.conformanceLevel}, up to {s.maxPages} pages
                  </td>
                  <td>
                    {s.status === 'completed'
                      ? `${String(s.openConfirmed)} confirmed, ${String(s.openPotential)} potential`
                      : 'Not available'}
                  </td>
                  <td>
                    <div className="row">
                      <Link className="btn secondary" href={`/orgs/${orgId}/scans/${s.id}`}>
                        View report
                      </Link>
                      {canScan && ACTIVE.has(s.status) ? (
                        <Button variant="secondary" onClick={() => void cancel(s.id)}>
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
