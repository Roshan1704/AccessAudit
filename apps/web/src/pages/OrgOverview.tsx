import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '@/lib/nav';
import { EmptyState, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import {
  api,
  atLeast,
  type Overview,
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
            AccessAudit checks your websites against WCAG 2.2 AA. Start by adding the site you want
            to audit as a project.
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
        <section className="card" aria-labelledby="steps-heading">
          <h2 id="steps-heading">Getting started</h2>
          <ol className="steps">
            <Step n={1} done title="Create your organization">
              {org.name} is ready.
            </Step>
            <Step n={2} done={hasProject} title="Add a project">
              A project is the website you audit.{' '}
              {!hasProject && canCreate ? (
                <Link href={`/orgs/${orgId}/projects`}>Add one</Link>
              ) : null}
            </Step>
            <Step n={3} done={false} title="Invite your team (optional)">
              Give colleagues access to results.{' '}
              {canInvite ? <Link href={`/orgs/${orgId}/members`}>Invite someone</Link> : null}
            </Step>
            <Step n={4} done={false} title="Run your first scan">
              Open a project, verify its domain, then choose Scan now. Results appear in the scan
              report with evidence for every finding.
            </Step>
          </ol>
        </section>
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
