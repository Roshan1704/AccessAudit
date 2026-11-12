import { Link } from '@/lib/nav';
import { useRouter } from '@/lib/nav';
import { useState, type SyntheticEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Button, EmptyState, ErrorAlert, Field, PageHeader, fieldErrors } from '@/components/ui';
import { api, type OrgSummary } from '@/lib/api';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Client-side checks with specific messages; the server remains the authority. */
function validate(name: string, slug: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (name.trim().length === 0) out['name'] = 'Enter a name, for example "Acme Corp".';
  if (slug.length === 0) {
    out['slug'] = 'Enter a short web address, for example "acme-corp".';
  } else if (slug.length < 3 || slug.length > 40) {
    out['slug'] = `Use 3 to 40 characters. You entered ${String(slug.length)}.`;
  } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    const bad = [...new Set(slug.replace(/[a-z0-9-]/g, '').split(''))];
    out['slug'] = bad.length
      ? `Remove ${bad.map((c) => (c === ' ' ? 'spaces' : `"${c}"`)).join(', ')}. Only lowercase letters, numbers and hyphens are allowed, for example "acme-corp".`
      : 'Do not start or end with a hyphen, or use two hyphens in a row, for example "acme-corp".';
  }
  return out;
}

export default function OrgsPage() {
  const { organizations, refresh } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrs, setLocalErrs] = useState<Record<string, string>>({});
  const errs = { ...fieldErrors(error), ...localErrs };

  async function create(e: SyntheticEvent) {
    e.preventDefault();
    const found = validate(name, slug);
    setLocalErrs(found);
    if (Object.keys(found).length > 0) {
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ organization: OrgSummary }>('POST', '/orgs', { name, slug });
      await refresh();
      router.push(`/orgs/${r.organization.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Organizations"
        description="Workspaces that own your projects and members."
      />
      {organizations.length === 0 ? (
        <EmptyState title="No organizations yet">
          Create your first organization below to start adding projects.
        </EmptyState>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            display: 'grid',
            gap: '0.75rem',
            gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
          }}
        >
          {organizations.map((o) => (
            <li key={o.id} className="card row" style={{ margin: 0, flexWrap: 'nowrap' }}>
              <span
                className="org-chip"
                aria-hidden="true"
                style={{ width: '2.5rem', height: '2.5rem', fontSize: '1rem' }}
              >
                {o.name.charAt(0).toUpperCase()}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <Link href={`/orgs/${o.id}`}>
                  <strong>{o.name}</strong>
                </Link>
                <br />
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  {o.slug}
                </span>
              </span>
              <span className="badge">{o.role}</span>
            </li>
          ))}
        </ul>
      )}
      <h2>Create an organization</h2>
      <p className="muted">
        An organization is your company or team workspace. It holds your projects (the websites you
        audit) and the people who can see the results.
      </p>
      <form className="card stack" onSubmit={(e) => void create(e)} noValidate>
        <Field
          label="Name"
          required
          placeholder="Acme Corp"
          autoComplete="organization"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setLocalErrs({});
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          {...(errs['name'] ? { error: errs['name'] } : {})}
        />
        <Field
          label="URL slug (short web address)"
          required
          placeholder="acme-corp"
          autoComplete="off"
          spellCheck={false}
          hint="Lowercase letters, numbers and hyphens only (no dots, spaces or underscores), 3 to 40 characters. Not a domain name. Filled in from the name; you can change it."
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setLocalErrs({});
            setSlug(e.target.value);
          }}
          {...(errs['slug'] ? { error: errs['slug'] } : {})}
        />
        <ErrorAlert
          error={Object.keys(errs).length ? new Error('Please fix the highlighted fields.') : error}
        />
        <Button type="submit" busy={busy}>
          Create organization
        </Button>
      </form>
    </>
  );
}
