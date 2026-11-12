import { useState, type SyntheticEvent } from 'react';
import { Button, EmptyState, ErrorAlert, Loading, SelectField } from '@/components/ui';
import { api, type Schedule } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';

const FREQ: Record<string, string> = { daily: 'Daily', weekly: 'Weekly' };

export function Schedules({
  orgId,
  projectId,
  canManage,
}: {
  orgId: string;
  projectId: string;
  canManage: boolean;
}) {
  const list = useAsync(
    () => api<{ schedules: Schedule[] }>('GET', `/orgs/${orgId}/schedules?projectId=${projectId}`),
    `${orgId}/${projectId}`,
  );
  const [frequency, setFrequency] = useState('weekly');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
      list.reload();
    }
  }

  function add(e: SyntheticEvent) {
    e.preventDefault();
    void run('add', () => api('POST', `/orgs/${orgId}/schedules`, { projectId, frequency }));
  }

  return (
    <>
      <h2 id="schedules" tabIndex={-1}>
        Scheduled scans
      </h2>
      <p className="muted">
        Recurring scans use the same safety checks as manual scans: the domain must be verified, and
        robots.txt is always respected.
      </p>
      <ErrorAlert error={error} />
      {list.loading && !list.data ? <Loading label="Loading schedules" /> : null}
      {list.error ? <ErrorAlert error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.schedules.length === 0 ? (
        <EmptyState title="No schedules">
          {canManage
            ? 'Add a schedule to scan this project automatically.'
            : 'An admin can add schedules.'}
        </EmptyState>
      ) : null}
      {list.data && list.data.schedules.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Scan schedules for this project</caption>
            <thead>
              <tr>
                <th scope="col">Frequency</th>
                <th scope="col">State</th>
                <th scope="col">Next run</th>
                <th scope="col">Last run</th>
                {canManage ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.data.schedules.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{FREQ[s.frequency] ?? s.frequency}</th>
                  <td>{s.enabled ? 'Enabled' : 'Paused'}</td>
                  <td>{s.enabled ? new Date(s.nextRunAt).toLocaleString() : 'Paused'}</td>
                  <td>
                    {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'Not run yet'}
                    {s.lastError ? (
                      <div className="error-text">Last run failed: {s.lastError}</div>
                    ) : null}
                  </td>
                  {canManage ? (
                    <td>
                      <div className="row">
                        <Button
                          variant="secondary"
                          busy={busy === `t${s.id}`}
                          onClick={() =>
                            void run(`t${s.id}`, () =>
                              api('PATCH', `/orgs/${orgId}/schedules/${s.id}`, {
                                enabled: !s.enabled,
                              }),
                            )
                          }
                        >
                          {s.enabled ? 'Pause' : 'Resume'}
                        </Button>
                        <Button
                          variant="secondary"
                          busy={busy === `d${s.id}`}
                          aria-label={`Delete ${FREQ[s.frequency] ?? s.frequency} schedule`}
                          onClick={() =>
                            void run(`d${s.id}`, () =>
                              api('DELETE', `/orgs/${orgId}/schedules/${s.id}`),
                            )
                          }
                        >
                          Delete
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
        <form className="card stack" style={{ marginTop: '1rem' }} onSubmit={add} noValidate>
          <h3 style={{ margin: 0 }}>Add a schedule</h3>
          <SelectField
            label="Frequency"
            value={frequency}
            onChange={setFrequency}
            options={[
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
            ]}
          />
          <Button type="submit" busy={busy === 'add'}>
            Add schedule
          </Button>
        </form>
      ) : null}
    </>
  );
}
