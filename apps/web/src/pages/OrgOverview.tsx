import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '@/lib/nav';
import { EmptyState, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import {
  api,
  atLeast,
  type Overview,
  type OverviewActivity,
  type OverviewProject,
  type Severity,
  type SeverityCounts,
} from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useOrg } from '@/lib/useOrg';

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className={`step${done ? ' done' : ''}`}>
      <span className="step-num" aria-hidden="true">
        {done ? <Check size={14} /> : n}
      </span>
      <div>
        <p>
          <strong>{title}</strong>
          {done ? <span className="sr-only"> (completed)</span> : null}
        </p>
        <p className="muted">{children}</p>
      </div>
    </li>
  );
}

/**
 * Adaptive onboarding. No project: full list. Project but no completed scan: only the remaining
 * steps. A completed scan exists: collapsed, still reachable.
 */
function Onboarding({
  orgId,
  orgName,
  hasProject,
  hasScan,
  canCreate,
  canInvite,
}: {
  orgId: string;
  orgName: string;
  hasProject: boolean;
  hasScan: boolean;
  canCreate: boolean;
  canInvite: boolean;
}) {
  const steps = [
    {
      key: 'org',
      done: true,
      title: 'Create your organization',
      body: <>{orgName} is ready.</>,
    },
    {
      key: 'project',
      done: hasProject,
      title: 'Add a project',
      body: (
        <>
          A project is the website you audit.{' '}
          {canCreate ? (
            <Link href={`/orgs/${orgId}/projects`}>Add a project</Link>
          ) : (
            'Ask a member or admin to add one.'
          )}
        </>
      ),
    },
    {
      key: 'invite',
      done: false,
      title: 'Invite your team (optional)',
      body: (
        <>
          Give colleagues access to results.{' '}
          {canInvite ? <Link href={`/orgs/${orgId}/members`}>Invite someone</Link> : null}
        </>
      ),
    },
    {
      key: 'scan',
      done: hasScan,
      title: 'Run your first scan',
      body: (
        <>
          Open a project, verify its domain, then choose Scan now. Results appear in the scan report
          with evidence for every finding.
        </>
      ),
    },
  ];
  const visible = hasProject ? steps.filter((s) => !s.done) : steps;
  const list = (
    <ol className="steps">
      {visible.map((s) => (
        <Step key={s.key} n={steps.indexOf(s) + 1} done={s.done} title={s.title}>
          {s.body}
        </Step>
      ))}
    </ol>
  );
  if (hasScan) {
    return (
      <details className="card onboarding-collapsed" data-testid="onboarding-collapsed">
        <summary>Getting started (setup complete, optional steps remain)</summary>
        {list}
      </details>
    );
  }
  return (
    <section className="card" aria-labelledby="steps-heading" data-testid="onboarding-full">
      <h2 id="steps-heading">Getting started</h2>
      {hasProject ? <p className="muted">Remaining steps to your first report.</p> : null}
      {list}
    </section>
  );
}

const SEVERITIES: Severity[] = ['critical', 'serious', 'moderate', 'minor'];

function countText(m: SeverityCounts): string {
  const parts = SEVERITIES.filter((s) => (m[s] ?? 0) > 0).map((s) => `${String(m[s] ?? 0)} ${s}`);
  return parts.length ? parts.join(', ') : 'none';
}

interface QueueItem {
  project: OverviewProject;
  weight: number;
  reasons: string[];
  href: string;
}

/** Work queue: projects ranked by what needs a person next. Quiet projects are left out. */
function buildQueue(orgId: string, projects: OverviewProject[]): QueueItem[] {
  const items: QueueItem[] = [];
  for (const project of projects) {
    const s = project.latestScan;
    if (!s) {
      items.push({
        project,
        weight: 1,
        reasons: ['No completed scan yet. Run the first scan.'],
        href: `/orgs/${orgId}/projects/${project.id}`,
      });
      continue;
    }
    const reasons: string[] = [];
    const urgent = (s.confirmed.critical ?? 0) + (s.confirmed.serious ?? 0);
    const urgentPotential = (s.potential.critical ?? 0) + (s.potential.serious ?? 0);
    if (urgent > 0) reasons.push(`${String(urgent)} critical or serious confirmed`);
    if (urgentPotential > 0)
      reasons.push(`${String(urgentPotential)} critical or serious potential`);
    if (s.manualTasksOpen > 0) reasons.push(`${String(s.manualTasksOpen)} manual checks pending`);
    if (s.pagesNotScanned > 0) reasons.push(`${String(s.pagesNotScanned)} pages not scanned`);
    if (reasons.length === 0) continue;
    items.push({
      project,
      weight: urgent > 0 ? 4 : urgentPotential > 0 ? 3 : s.manualTasksOpen > 0 ? 2 : 1,
      reasons,
      href: `/orgs/${orgId}/scans/${s.id}`,
    });
  }
  return items.sort((a, b) => b.weight - a.weight);
}

const ACTIVITY_INITIAL = 4;

export function ActivityPage() {
  const { orgId, org } = useOrg();
  const overview = useAsync(() => api<Overview>('GET', `/orgs/${orgId}/overview`), orgId);
  if (!org) return <EmptyState title="Organization not found">No access.</EmptyState>;
  return (
    <>
      <p style={{ margin: '0 0 0.75rem' }}>
        <Link href={`/orgs/${orgId}`}>&larr; Back to overview</Link>
      </p>
      <PageHeader title="Recent activity" description={org.name} />
      {overview.loading && !overview.data ? <Loading label="Loading activity" /> : null}
      <ErrorAlert error={overview.error} onRetry={overview.reload} />
      {overview.data ? (
        <section className="card" aria-label="All recent activity">
          {overview.data.recentActivity.length === 0 ? (
            <p className="muted">No activity yet.</p>
          ) : (
            <ul className="compact-list">
              {overview.data.recentActivity.map((a, i) => (
                <li key={`${a.at}-${String(i)}`}>
                  <Link href={activityHref(orgId, a.href)}>{a.text}</Link>{' '}
                  <span className="muted">{new Date(a.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}

function activityHref(orgId: string, h: OverviewActivity['href']): string {
  if (h.findingId) return `/orgs/${orgId}/findings/${h.findingId}`;
  if (h.scanId) return `/orgs/${orgId}/scans/${h.scanId}`;
  return `/orgs/${orgId}`;
}

/** Record-level sections. Counts and links only; there is deliberately no overall score. */
function Attention({ orgId, data }: { orgId: string; data: Overview }) {
  const changed = data.projects.filter(
    (p) =>
      p.latestScan?.change && (p.latestScan.change.added > 0 || p.latestScan.change.regressed > 0),
  );
  const manual = data.projects.filter((p) => (p.latestScan?.manualTasksOpen ?? 0) > 0);
  return (
    <div className="grid-cards attention-grid" style={{ marginBottom: '1rem' }}>
      <section className="card" aria-labelledby="ov-critical">
        <h2 id="ov-critical">Confirmed critical and serious</h2>
        {data.topFindings.length === 0 ? (
          <p className="muted">
            No open confirmed critical or serious findings in the latest scans.
          </p>
        ) : (
          <ul>
            {data.topFindings.map((f) => (
              <li key={f.id}>
                <Link href={`/orgs/${orgId}/findings/${f.id}`}>{f.ruleTitle}</Link>{' '}
                <span className={`sev-tag ${f.severity}`}>{f.severity}</span>
                <br />
                <span className="muted break">
                  {f.projectName} · {f.pageUrl}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="ov-change">
        <h2 id="ov-change">New and regressed</h2>
        {changed.length === 0 ? (
          <p className="muted">
            Nothing new or regressed since the previous scan, or no earlier scan to compare with.
          </p>
        ) : (
          <ul>
            {changed.map((p) => (
              <li key={p.id}>
                <Link href={`/orgs/${orgId}/scans/${p.latestScan?.id ?? ''}`}>{p.name}</Link>:{' '}
                {p.latestScan?.change?.added ?? 0} new, {p.latestScan?.change?.regressed ?? 0}{' '}
                regressed
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="ov-manual">
        <h2 id="ov-manual">Pending manual verification</h2>
        {manual.length === 0 ? (
          <p className="muted">No manual checks waiting.</p>
        ) : (
          <ul>
            {manual.map((p) => (
              <li key={p.id}>
                <Link href={`/orgs/${orgId}/scans/${p.latestScan?.id ?? ''}/manual`}>{p.name}</Link>
                : {p.latestScan?.manualTasksOpen ?? 0} pending
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="ov-failed">
        <h2 id="ov-failed">Failed scans</h2>
        {data.failedScans.length === 0 ? (
          <p className="muted">No failed scans since the latest completed one.</p>
        ) : (
          <ul>
            {data.failedScans.map((f) => (
              <li key={f.id}>
                <Link href={`/orgs/${orgId}/scans/${f.id}`}>{f.projectName}</Link>:{' '}
                {f.failureReason ?? 'failed'} ({new Date(f.createdAt).toLocaleDateString()})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="ov-activity">
        <h2 id="ov-activity">Recent activity</h2>
        {data.recentActivity.length === 0 ? (
          <p className="muted">No activity yet.</p>
        ) : (
          <>
            <ul className="compact-list">
              {data.recentActivity.slice(0, ACTIVITY_INITIAL).map((a, i) => (
                <li key={`${a.at}-${String(i)}`}>
                  <Link href={activityHref(orgId, a.href)}>{a.text}</Link>{' '}
                  <span className="muted">{new Date(a.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p>
              <Link href={`/orgs/${orgId}/activity`}>
                View all activity ({data.recentActivity.length})
              </Link>
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function ProjectSummary({ orgId, p }: { orgId: string; p: OverviewProject }) {
  const s = p.latestScan;
  return (
    <li className="card">
      <h3>
        <Link href={`/orgs/${orgId}/projects/${p.id}`}>{p.name}</Link>
      </h3>
      <p className="muted">{p.baseUrl}</p>
      {s ? (
        <>
          <dl>
            <dt>Confirmed issues (open)</dt>
            <dd>{countText(s.confirmed)}</dd>
            <dt>Potential issues (open)</dt>
            <dd>{countText(s.potential)}</dd>
            <dt>Manual checks pending</dt>
            <dd>{s.manualTasksOpen}</dd>
            <dt>Coverage</dt>
            <dd>
              {s.pagesScanned} scanned, {s.pagesNotScanned} not scanned (limit {String(s.maxPages)})
            </dd>
          </dl>
          <p className="muted">
            Latest completed scan
            {s.finishedAt ? ` on ${new Date(s.finishedAt).toLocaleString()}` : ''}, WCAG{' '}
            {s.wcagVersion} level {s.conformanceLevel}.{' '}
            <Link href={`/orgs/${orgId}/scans/${s.id}`}>View report</Link>
          </p>
        </>
      ) : (
        <p className="muted">No completed scan yet.</p>
      )}
    </li>
  );
}

export default function OrgOverview() {
  const { orgId, org } = useOrg();
  const overview = useAsync(() => api<Overview>('GET', `/orgs/${orgId}/overview`), orgId);

  if (!org)
    return (
      <EmptyState title="Organization not found">
        You are not a member of this organization, or it does not exist.
      </EmptyState>
    );

  const list = overview.data?.projects ?? null;
  const hasProject = (list?.length ?? 0) > 0;
  const canCreate = atLeast(org.role, 'member');
  const canInvite = atLeast(org.role, 'admin');

  return (
    <>
      <PageHeader
        title={org.name}
        description={
          <>
            Your role: <span className="badge">{org.role}</span>
          </>
        }
      />
      {overview.loading && !overview.data ? <Loading label="Loading overview" /> : null}
      <ErrorAlert error={overview.error} onRetry={overview.reload} />

      {list && !hasProject ? (
        <section className="hero" aria-labelledby="start-heading">
          <h2 id="start-heading">Welcome to {org.name}</h2>
          <p className="muted">
            AccessAudit checks your websites against WCAG 2.2 AA and shows evidence for every
            finding.
          </p>
          {canCreate ? (
            <Link href={`/orgs/${orgId}/projects`} className="btn">
              Add your first project
            </Link>
          ) : (
            <p>Ask a member or admin to add a project.</p>
          )}
        </section>
      ) : null}

      {list ? (
        <Onboarding
          orgId={orgId}
          orgName={org.name}
          hasProject={hasProject}
          hasScan={list.some((p) => p.latestScan !== null)}
          canCreate={canCreate}
          canInvite={canInvite}
        />
      ) : null}

      {hasProject && list ? (
        <section className="card" aria-labelledby="queue-heading">
          <h2 id="queue-heading">Needs attention</h2>
          {buildQueue(orgId, list).length === 0 ? (
            <p>
              Nothing waiting. This is based on the latest scans only and does not mean the sites
              are accessible.
            </p>
          ) : (
            <ul>
              {buildQueue(orgId, list).map((i) => (
                <li key={i.project.id}>
                  <Link href={i.href}>{i.project.name}</Link>: {i.reasons.join(', ')}.
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {hasProject && list && overview.data ? (
        <Attention orgId={orgId} data={overview.data} />
      ) : null}

      {hasProject && list ? (
        <>
          <div className="section-title">
            <h2>Projects</h2>
            <Link href={`/orgs/${orgId}/projects`}>View all ({list.length})</Link>
          </div>
          <p className="muted">
            Counts come from each project&apos;s latest completed scan. Automated checks cover only
            part of WCAG, so zero findings does not mean a site is accessible.
          </p>
          <ul className="grid-cards">
            {list.map((p) => (
              <ProjectSummary key={p.id} orgId={orgId} p={p} />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
