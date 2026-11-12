import { Link } from '@/lib/nav';
import { useState, type SyntheticEvent } from 'react';
import {
  Button,
  EmptyState,
  ErrorAlert,
  Field,
  Loading,
  PageHeader,
  fieldErrors,
} from '@/components/ui';
import { api, atLeast, type Project } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useOrg } from '@/lib/useOrg';

export default function ProjectsPage() {
  const { orgId, org } = useOrg();
  const list = useAsync(
    () => api<{ projects: Project[] }>('GET', `/orgs/${orgId}/projects`),
    orgId,
  );
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errs = fieldErrors(error);

  if (!org)
    return (
      <EmptyState title="Organization not found">
        You are not a member of this organization.
      </EmptyState>
    );
  const canCreate = atLeast(org.role, 'member');

  async function create(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/orgs/${orgId}/projects`, { name, baseUrl });
      setName('');
      setBaseUrl('https://');
      list.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project is a website you audit for accessibility."
      />
      {list.loading && !list.data ? <Loading label="Loading projects" /> : null}
      <ErrorAlert error={list.error} onRetry={list.reload} />
      {list.data && list.data.projects.length === 0 ? (
        <EmptyState title="No projects yet">
          {canCreate
            ? 'Create your first project below.'
            : 'Ask a member or admin to create a project.'}
        </EmptyState>
      ) : null}
      {list.data && list.data.projects.length > 0 ? (
        <ul className="grid-cards">
          {list.data.projects.map((p) => (
            <li key={p.id} className="card item-row">
              <span className="avatar" aria-hidden="true">
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span className="grow">
                <Link className="title" href={`/orgs/${orgId}/projects/${p.id}`}>
                  {p.name}
                </Link>
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  {p.baseUrl}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {canCreate ? (
        <>
          <h2>Create a project</h2>
          <form className="card stack" onSubmit={(e) => void create(e)} noValidate>
            <Field
              label="Name"
              required
              placeholder="Marketing website"
              hint="A label for you, for example the site or product name."
              value={name}
              onChange={(e) => setName(e.target.value)}
              {...(errs['name'] ? { error: errs['name'] } : {})}
            />
            <Field
              label="Base URL"
              required
              type="url"
              hint="The site this project audits, for example https://www.example.com."
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              {...(errs['baseUrl'] ? { error: errs['baseUrl'] } : {})}
            />
            <ErrorAlert
              error={
                Object.keys(errs).length ? new Error('Please fix the highlighted fields.') : error
              }
            />
            <Button type="submit" busy={busy}>
              Create project
            </Button>
          </form>
        </>
      ) : null}
    </>
  );
}
