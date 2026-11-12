import { useRouter } from '@/lib/nav';
import { useState, type SyntheticEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  Button,
  EmptyState,
  ErrorAlert,
  Field,
  Loading,
  Notice,
  PageHeader,
  SelectField,
  fieldErrors,
} from '@/components/ui';
import { api, atLeast, type Invitation, type Member, type Role } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useOrg } from '@/lib/useOrg';

const ROLES: Role[] = ['owner', 'admin', 'member', 'viewer'];

export default function MembersPage() {
  const { orgId, org } = useOrg();
  const { user, refresh } = useAuth();
  const router = useRouter();
  const isAdmin = org ? atLeast(org.role, 'admin') : false;
  const members = useAsync(
    () => api<{ members: Member[] }>('GET', `/orgs/${orgId}/members`),
    orgId,
  );
  const invites = useAsync(
    () =>
      isAdmin
        ? api<{ invitations: Invitation[] }>('GET', `/orgs/${orgId}/invitations`)
        : Promise.resolve({ invitations: [] }),
    `${orgId}:${String(isAdmin)}`,
  );
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  const errs = fieldErrors(error);

  if (!org)
    return (
      <EmptyState title="Organization not found">
        You are not a member of this organization.
      </EmptyState>
    );

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    setSent(false);
    try {
      await fn();
      members.reload();
      invites.reload();
    } catch (err) {
      setError(err);
      members.reload();
    } finally {
      setBusy(null);
    }
  }

  function invite(e: SyntheticEvent) {
    e.preventDefault();
    void run('invite', async () => {
      await api('POST', `/orgs/${orgId}/invitations`, { email, role });
      setEmail('');
      setSent(true);
    });
  }

  async function leave() {
    if (!user || !window.confirm('Leave this organization?')) return;
    setBusy('leave');
    try {
      await api('DELETE', `/orgs/${orgId}/members/${user.id}`);
      await refresh();
      router.replace('/orgs');
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  const assignable = ROLES.filter((r) => r !== 'owner' || org.role === 'owner');

  return (
    <>
      <PageHeader title="Members" description="People who can access this organization." />
      <ErrorAlert
        error={Object.keys(errs).length ? new Error('Please fix the highlighted fields.') : error}
      />
      {members.loading && !members.data ? <Loading label="Loading members" /> : null}
      {members.error ? <ErrorAlert error={members.error} onRetry={members.reload} /> : null}
      {members.data ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Organization members</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                {isAdmin ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {members.data.members.map((m) => (
                <tr key={m.userId}>
                  <th scope="row">{m.name}</th>
                  <td className="muted">{m.email}</td>
                  <td>
                    {isAdmin ? (
                      <select
                        aria-label={`Role for ${m.name}`}
                        value={m.role}
                        disabled={busy !== null || (m.role === 'owner' && org.role !== 'owner')}
                        onChange={(e) =>
                          void run(`role${m.userId}`, () =>
                            api('PATCH', `/orgs/${orgId}/members/${m.userId}`, {
                              role: e.target.value,
                            }),
                          )
                        }
                      >
                        {assignable
                          .concat(
                            m.role === 'owner' && !assignable.includes('owner') ? ['owner'] : [],
                          )
                          .map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <span className="badge">{m.role}</span>
                    )}
                  </td>
                  {isAdmin ? (
                    <td>
                      {m.userId !== user?.id ? (
                        <Button
                          variant="secondary"
                          busy={busy === `rm${m.userId}`}
                          aria-label={`Remove ${m.name}`}
                          onClick={() =>
                            void run(`rm${m.userId}`, () =>
                              api('DELETE', `/orgs/${orgId}/members/${m.userId}`),
                            )
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p style={{ marginTop: '1rem' }}>
        <Button variant="secondary" busy={busy === 'leave'} onClick={() => void leave()}>
          Leave organization
        </Button>
      </p>

      {isAdmin ? (
        <>
          <h2>Invitations</h2>
          {invites.error ? <ErrorAlert error={invites.error} onRetry={invites.reload} /> : null}
          {invites.data && invites.data.invitations.length === 0 ? (
            <EmptyState title="No pending invitations" />
          ) : null}
          {invites.data && invites.data.invitations.length > 0 ? (
            <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
              {invites.data.invitations.map((i) => (
                <li key={i.id} className="card item-row" style={{ marginBottom: 0 }}>
                  <span className="grow">
                    <span className="title">{i.email}</span>
                    <span className="muted" style={{ fontSize: '0.85rem' }}>
                      Expires {new Date(i.expiresAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className="badge">{i.role}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <form className="card stack" onSubmit={invite} noValidate>
            <h3 style={{ margin: 0 }}>Invite someone</h3>
            <Field
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              {...(errs['email'] ? { error: errs['email'] } : {})}
            />
            <SelectField
              label="Role"
              value={role}
              onChange={setRole}
              options={['admin', 'member', 'viewer'].map((r) => ({ value: r, label: r }))}
            />
            {sent ? <Notice>Invitation sent.</Notice> : null}
            <Button type="submit" busy={busy === 'invite'}>
              Send invitation
            </Button>
          </form>
        </>
      ) : null}
    </>
  );
}
