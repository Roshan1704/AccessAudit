import { Link } from '@/lib/nav';
import { useParams, useRouter } from '@/lib/nav';
import { useState, type SyntheticEvent } from 'react';
import {
  Button,
  EmptyState,
  ErrorAlert,
  Field,
  Loading,
  Notice,
  PageHeader,
  SelectField,
  StatusBadge,
  fieldErrors,
} from '@/components/ui';
import { AuthProfiles } from '@/components/AuthProfiles';
import { ScanPanel } from '@/components/ScanPanel';
import { Schedules } from '@/components/Schedules';
import { api, atLeast, type Domain, type Project, type VerificationInstructions } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useOrg } from '@/lib/useOrg';

function Instructions({ v }: { v: VerificationInstructions }) {
  return (
    <Notice kind="warn">
      <p style={{ marginTop: 0 }}>
        <strong>Save these instructions now.</strong> The verification token is shown only once.
      </p>
      {v.type === 'dns_txt' ? (
        <dl className="kv">
          <dt>Create a TXT record named</dt>
          <dd>
            <code>{v.recordName}</code>
          </dd>
          <dt>with the value</dt>
          <dd>
            <code>{v.recordValue}</code>
          </dd>
        </dl>
      ) : v.type === 'meta_tag' ? (
        <>
          <ol>
            <li>Copy the line below.</li>
            <li>
              Paste it inside the <code>&lt;head&gt;</code> section of your home page (
              <code>{v.url}</code>).
            </li>
            <li>Publish the page.</li>
          </ol>
          <pre>
            <code>{v.tag}</code>
          </pre>
        </>
      ) : (
        <dl className="kv">
          <dt>Serve a plain-text file at</dt>
          <dd>
            <code>{v.url}</code>
          </dd>
          <dt>containing exactly</dt>
          <dd>
            <code>{v.fileContent}</code>
          </dd>
        </dl>
      )}
      <p style={{ marginBottom: 0 }}>Then choose &ldquo;Verify now&rdquo; on the domain below.</p>
    </Notice>
  );
}

/** Accepts a pasted URL and keeps only the hostname, so "https://www.example.com/path" works. */
function cleanHostname(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '');
}

const METHOD_LABELS: Record<Domain['method'], string> = {
  meta_tag: 'Meta tag',
  dns_txt: 'DNS TXT',
  well_known: 'Well-known file',
};

/** Plain-language explanation of a stored failure code. */
function failureText(reason: string): string {
  const known: Record<string, string> = {
    meta_tag_not_found:
      'The meta tag was not found on your home page. Add it inside <head>, publish, and try again.',
    meta_tag_mismatch:
      'A verification meta tag was found, but its code is different. Copy the code again.',
    http_404: 'The page or file was not found (404).',
    txt_record_not_found:
      'The DNS TXT record was not found yet. DNS changes can take a while (up to a few hours).',
    txt_record_mismatch:
      'A TXT record exists, but its value is different. Copy the value again, or remove the domain and add it again for a new code.',
    file_content_mismatch: 'The file was found, but its content is not the verification code.',
    file_too_large: 'The file is too large. It should contain only the verification code.',
    fetch_error: 'Could not reach the site. Check that it is online and try again.',
    host_not_found: 'This hostname does not exist in DNS. Check the spelling.',
    dns_lookup_error: 'DNS lookup failed for now. Try again in a minute.',
    resolves_to_non_public_address:
      'This hostname points to a private address, so it cannot be audited.',
    http_301:
      'The page redirects. Verify the exact hostname that serves the page without redirecting.',
    http_302:
      'The page redirects. Verify the exact hostname that serves the page without redirecting.',
    http_403: 'The site refused the request (403). It may block automated requests.',
  };
  return known[reason] ?? reason;
}

function Domains({
  orgId,
  projectId,
  canManage,
  onChanged,
}: {
  orgId: string;
  projectId: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const base = `/orgs/${orgId}/projects/${projectId}/domains`;
  const list = useAsync(() => api<{ domains: Domain[] }>('GET', base), base);
  const [hostname, setHostname] = useState('');
  const [method, setMethod] = useState('dns_txt');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [instr, setInstr] = useState<VerificationInstructions | null>(null);
  const errs = fieldErrors(error);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      list.reload();
      onChanged();
    } catch (err) {
      setError(err);
      list.reload();
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  function add(e: SyntheticEvent) {
    e.preventDefault();
    void run('add', async () => {
      const r = await api<{ domain: Domain; verification: VerificationInstructions }>(
        'POST',
        base,
        { hostname: cleanHostname(hostname), method },
      );
      setInstr(r.verification);
      setHostname('');
    });
  }

  return (
    <>
      <h2 id="domains" tabIndex={-1}>
        Domains
      </h2>
      <p className="muted">
        Only verified domains can be audited. Verification proves you control the domain, so you
        need access to its DNS settings or its website files.
      </p>
      <p className="muted">
        Do not own the site? You can still run a one-page check without verification with{' '}
        <Link href="/quick-check">Quick check</Link>.
      </p>
      {instr ? <Instructions v={instr} /> : null}
      <ErrorAlert error={error} />
      {list.loading && !list.data ? <Loading label="Loading domains" /> : null}
      {list.error ? <ErrorAlert error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.domains.length === 0 ? (
        <EmptyState title="No domains yet">
          {canManage
            ? 'Add a domain to start verification.'
            : 'An admin can add and verify domains.'}
        </EmptyState>
      ) : null}
      {list.data && list.data.domains.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Domains for this project</caption>
            <thead>
              <tr>
                <th scope="col">Hostname</th>
                <th scope="col">Method</th>
                <th scope="col">Status</th>
                <th scope="col">Details</th>
                {canManage ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.data.domains.map((d) => (
                <tr key={d.id}>
                  <th scope="row">{d.hostname}</th>
                  <td className="nowrap">{METHOD_LABELS[d.method]}</td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td>
                    {d.verifiedAt ? (
                      <div>Verified {new Date(d.verifiedAt).toLocaleString()}</div>
                    ) : null}
                    {d.nextRevalidateAt ? (
                      <div>Next check {new Date(d.nextRevalidateAt).toLocaleDateString()}</div>
                    ) : null}
                    {d.lastFailureReason ? (
                      <div className="error-text">{failureText(d.lastFailureReason)}</div>
                    ) : null}
                  </td>
                  {canManage ? (
                    <td>
                      <div className="row">
                        {d.status === 'verified' ? (
                          <Button
                            variant="secondary"
                            busy={busy === `r${d.id}`}
                            onClick={() =>
                              void run(`r${d.id}`, () => api('POST', `${base}/${d.id}/revalidate`))
                            }
                          >
                            Revalidate
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            busy={busy === `v${d.id}`}
                            onClick={() =>
                              void run(`v${d.id}`, () => api('POST', `${base}/${d.id}/verify`))
                            }
                          >
                            Verify now
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          busy={busy === `d${d.id}`}
                          aria-label={`Remove ${d.hostname}`}
                          onClick={() =>
                            void run(`d${d.id}`, () => api('DELETE', `${base}/${d.id}`))
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {canManage ? (
        <details className="card add-panel">
          <summary>Add a domain</summary>
          <form className="stack" onSubmit={add} noValidate>
            <Field
              label="Hostname"
              required
              placeholder="www.example.com"
              autoComplete="off"
              spellCheck={false}
              hint="Hostname only, for example www.example.com. A pasted full address is trimmed."
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              {...(errs['hostname'] ? { error: errs['hostname'] } : {})}
            />
            <SelectField
              label="Verification method"
              value={method}
              onChange={setMethod}
              options={[
                { value: 'dns_txt', label: 'Add a DNS TXT record (recommended)' },
                { value: 'well_known', label: 'Upload a small text file' },
                {
                  value: 'meta_tag',
                  label: 'Add a meta tag (if you cannot edit DNS or serve a file)',
                },
              ]}
            />
            <Button type="submit" busy={busy === 'add'}>
              Add domain
            </Button>
          </form>
        </details>
      ) : null}
    </>
  );
}

const TABS = [
  { id: 'scans', label: 'Scans' },
  { id: 'settings', label: 'Settings' },
] as const;

export default function ProjectDetail() {
  const { orgId, org } = useOrg();
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const p = useAsync(
    () => api<{ project: Project }>('GET', `/orgs/${orgId}/projects/${projectId}`),
    projectId,
  );
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [domainsVersion, setDomainsVersion] = useState(0);
  const [profilesVersion, setProfilesVersion] = useState(0);
  const [tab, setTab] = useState<'scans' | 'settings'>('scans');

  if (!org)
    return (
      <EmptyState title="Organization not found">
        You are not a member of this organization.
      </EmptyState>
    );
  const isAdmin = atLeast(org.role, 'admin');

  if (p.loading && !p.data) return <Loading label="Loading project" />;
  if (p.error || !p.data)
    return <ErrorAlert error={p.error ?? new Error('Project not found.')} onRetry={p.reload} />;
  const project = p.data.project;

  async function save(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('PATCH', `/orgs/${orgId}/projects/${projectId}`, { name: name ?? project.name });
      setSaved(true);
      p.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete project "${project.name}"?`)) return;
    setBusy(true);
    try {
      await api('DELETE', `/orgs/${orgId}/projects/${projectId}`);
      router.replace(`/orgs/${orgId}/projects`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <p style={{ margin: '0 0 0.75rem' }}>
        <Link href={`/orgs/${orgId}/projects`}>&larr; All projects</Link>
      </p>
      <PageHeader title={project.name} description={project.baseUrl} />
      <div
        role="tablist"
        aria-label="Project sections"
        className="row"
        style={{ marginBottom: '1rem' }}
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'btn' : 'btn secondary'}
            onClick={() => {
              setTab(t.id);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
              if (!next) return;
              setTab(next.id);
              document.getElementById(`tab-${next.id}`)?.focus();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="panel-scans" aria-labelledby="tab-scans" hidden={tab !== 'scans'}>
        <ScanPanel
          orgId={orgId}
          projectId={projectId}
          baseUrl={project.baseUrl}
          role={org.role}
          domainsVersion={domainsVersion + profilesVersion}
          onNeedDomains={() => {
            setTab('settings');
            setTimeout(() => {
              const el = document.getElementById('domains');
              el?.scrollIntoView({ block: 'start' });
              el?.focus();
            }, 0);
          }}
        />
      </div>
      <div
        role="tabpanel"
        id="panel-settings"
        aria-labelledby="tab-settings"
        hidden={tab !== 'settings'}
      >
        {isAdmin ? (
          <form className="card stack" onSubmit={(e) => void save(e)} noValidate>
            <Field
              label="Project name"
              required
              value={name ?? project.name}
              onChange={(e) => setName(e.target.value)}
            />
            <ErrorAlert error={error} />
            {saved ? <Notice>Saved.</Notice> : null}
            <div className="row">
              <Button type="submit" busy={busy}>
                Save
              </Button>
              <Button type="button" variant="danger" disabled={busy} onClick={() => void remove()}>
                Delete project
              </Button>
            </div>
          </form>
        ) : null}
        <Schedules orgId={orgId} projectId={projectId} canManage={isAdmin} />
        <AuthProfiles
          orgId={orgId}
          projectId={projectId}
          canManage={isAdmin}
          onChanged={() => {
            setProfilesVersion((v) => v + 1);
          }}
        />
        <Domains
          orgId={orgId}
          projectId={projectId}
          canManage={isAdmin}
          onChanged={() => {
            setDomainsVersion((v) => v + 1);
          }}
        />
      </div>
    </>
  );
}
