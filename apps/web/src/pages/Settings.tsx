import { useState, type SyntheticEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  Button,
  EmptyState,
  ErrorAlert,
  Field,
  Notice,
  PageHeader,
  fieldErrors,
} from '@/components/ui';
import { api, atLeast } from '@/lib/api';
import { useOrg } from '@/lib/useOrg';

export default function OrgSettings() {
  const { orgId, org } = useOrg();
  const { refresh } = useAuth();
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const errs = fieldErrors(error);

  if (!org)
    return (
      <EmptyState title="Organization not found">
        You are not a member of this organization.
      </EmptyState>
    );
  const isAdmin = atLeast(org.role, 'admin');

  async function save(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('PATCH', `/orgs/${orgId}`, { name: name ?? org?.name });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Organization settings"
        description={
          <>
            URL slug: <code>{org.slug}</code>
          </>
        }
      />
      {isAdmin ? (
        <form className="card stack" onSubmit={(e) => void save(e)} noValidate>
          <Field
            label="Organization name"
            required
            value={name ?? org.name}
            onChange={(e) => setName(e.target.value)}
            {...(errs['name'] ? { error: errs['name'] } : {})}
          />
          <ErrorAlert error={Object.keys(errs).length ? null : error} />
          {saved ? <Notice>Saved.</Notice> : null}
          <Button type="submit" busy={busy}>
            Save
          </Button>
        </form>
      ) : (
        <Notice kind="warn">Only admins and owners can change organization settings.</Notice>
      )}
    </>
  );
}
