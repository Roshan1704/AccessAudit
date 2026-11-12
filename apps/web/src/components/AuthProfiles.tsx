import { useState, type SyntheticEvent } from 'react';
import { Button, EmptyState, ErrorAlert, Field, Loading, Notice } from '@/components/ui';
import { ApiError, api, type AuthProfile } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';

const EMPTY = {
  name: '',
  loginUrl: '',
  usernameSelector: 'input[type=email], input[name=username], input[name=email]',
  passwordSelector: 'input[type=password]',
  submitSelector: 'button[type=submit]',
  successSelector: '',
  username: '',
  password: '',
};

function explain(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === 'DOMAIN_NOT_VERIFIED')
    return 'Verify the login page’s domain first. Login profiles only work on verified domains.';
  if (e.code === 'QUOTA_EXCEEDED')
    return 'This project already has the maximum of 5 login profiles.';
  if (e.code === 'URL_NOT_ALLOWED') return 'That login address cannot be used.';
  return null;
}

export function AuthProfiles({
  orgId,
  projectId,
  canManage,
  onChanged,
}: {
  orgId: string;
  projectId: string;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const list = useAsync(
    () =>
      api<{ authProfiles: AuthProfile[] }>(
        'GET',
        `/orgs/${orgId}/auth-profiles?projectId=${projectId}`,
      ),
    `${orgId}/${projectId}`,
  );
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  function set(key: keyof typeof EMPTY) {
    return (e: { target: { value: string } }) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
    };
  }

  async function run(key: string, fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(null);
      list.reload();
      onChanged?.();
    }
  }

  async function add(e: SyntheticEvent) {
    e.preventDefault();
    const ok = await run('add', () =>
      api('POST', `/orgs/${orgId}/auth-profiles`, { projectId, ...form }),
    );
    // Clear the password from memory and the form as soon as it is saved.
    if (ok) setForm(EMPTY);
  }

  const friendly = explain(error);

  return (
    <>
      <h2 id="login-profiles" tabIndex={-1}>
        Login profiles
      </h2>
      <p className="muted">
        A login profile lets a scan sign in once and check pages behind the login. Credentials are
        stored encrypted and can never be viewed again. Scans never follow sign-out links or submit
        other forms.
      </p>
      {list.loading && !list.data ? <Loading label="Loading login profiles" /> : null}
      {list.error ? <ErrorAlert error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.authProfiles.length === 0 ? (
        <EmptyState title="No login profiles">
          {canManage
            ? 'Add a profile to scan pages behind a login.'
            : 'An admin can add login profiles.'}
        </EmptyState>
      ) : null}
      {list.data && list.data.authProfiles.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Login profiles for this project</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Login page</th>
                <th scope="col">Added</th>
                {canManage ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.data.authProfiles.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.name}</th>
                  <td>{p.loginUrl}</td>
                  <td>{new Date(p.createdAt).toLocaleString()}</td>
                  {canManage ? (
                    <td>
                      <Button
                        variant="secondary"
                        busy={busy === `d${p.id}`}
                        aria-label={`Delete login profile ${p.name}`}
                        onClick={() =>
                          void run(`d${p.id}`, () =>
                            api('DELETE', `/orgs/${orgId}/auth-profiles/${p.id}`),
                          )
                        }
                      >
                        Delete
                      </Button>
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
          <summary>Add a login profile</summary>
          <form className="stack" onSubmit={(e) => void add(e)} noValidate autoComplete="off">
            <p className="muted" style={{ margin: 0 }}>
              Use a dedicated test account, not a real person&rsquo;s login.
            </p>
            <div className="form-grid">
              <Field
                label="Profile name"
                placeholder="Test customer account"
                value={form.name}
                onChange={set('name')}
              />
              <Field
                label="Login page address"
                placeholder="https://www.example.com/login"
                hint="Must be on a verified domain."
                value={form.loginUrl}
                onChange={set('loginUrl')}
              />
              <Field
                label="Username or email"
                autoComplete="off"
                placeholder="tester@example.com"
                value={form.username}
                onChange={set('username')}
              />
              <Field
                label="Password"
                type="password"
                autoComplete="new-password"
                hint="Stored encrypted. You cannot view it again."
                value={form.password}
                onChange={set('password')}
              />
              <div className="span-all">
                <Field
                  label="Signed-in marker"
                  placeholder="#account-menu"
                  hint="Appears only after signing in, such as an account menu or Log out link."
                  value={form.successSelector}
                  onChange={set('successSelector')}
                />
              </div>
            </div>
            <details className="advanced">
              <summary>Form field selectors (advanced)</summary>
              <p className="muted">
                Defaults suit most sites. Accepts CSS (<code>#email</code>), text (
                <code>text=Log in</code>) or XPath (
                <code>xpath=//input[@name=&quot;user&quot;]</code>
                ).
              </p>
              <div className="form-grid cols-3">
                <Field
                  label="Username field"
                  value={form.usernameSelector}
                  onChange={set('usernameSelector')}
                />
                <Field
                  label="Password field"
                  value={form.passwordSelector}
                  onChange={set('passwordSelector')}
                />
                <Field
                  label="Sign-in button"
                  value={form.submitSelector}
                  onChange={set('submitSelector')}
                />
              </div>
            </details>
            {friendly ? (
              <Notice kind="warn">
                <p style={{ margin: 0 }}>{friendly}</p>
              </Notice>
            ) : (
              <ErrorAlert error={error} />
            )}
            <div>
              <Button type="submit" busy={busy === 'add'}>
                Save login profile
              </Button>
            </div>
          </form>
        </details>
      ) : null}
    </>
  );
}
