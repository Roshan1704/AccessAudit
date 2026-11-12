import { useState } from 'react';
import { Button, EmptyState, ErrorAlert, Loading, Notice, PageHeader } from '@/components/ui';
import { api, atLeast, type ManualTask, type TaskStatus } from '@/lib/api';
import { Link, useParams } from '@/lib/nav';
import { useAsync } from '@/lib/useAsync';
import { useOrg } from '@/lib/useOrg';

function Task({
  t,
  orgId,
  canEdit,
  onSaved,
}: {
  t: ManualTask;
  orgId: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [note, setNote] = useState(t.note ?? '');
  const [busy, setBusy] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function set(status: Exclude<TaskStatus, 'pending'>) {
    setBusy(status);
    setError(null);
    try {
      await api('PATCH', `/orgs/${orgId}/manual-tasks/${t.id}`, {
        status,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const noteId = `note-${t.id}`;
  return (
    <li className="finding-item">
      <div className="row">
        <span className="pill manual_verification">{t.status.replaceAll('_', ' ')}</span>
        <span className="muted">
          {t.wcagCriteria.length > 0 ? `WCAG ${t.wcagCriteria.join(', ')}` : t.ruleId}
        </span>
      </div>
      <h3>{t.ruleTitle}</h3>
      <p>{t.instructions}</p>
      {t.findingId ? (
        <Link href={`/orgs/${orgId}/findings/${t.findingId}`}>View related finding</Link>
      ) : null}
      {canEdit ? (
        <div className="stack" style={{ marginTop: '0.6rem' }}>
          <div className="field">
            <label htmlFor={noteId}>Note (optional)</label>
            <input
              id={noteId}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <ErrorAlert error={error} />
          <div className="row">
            <Button busy={busy === 'passed'} onClick={() => void set('passed')}>
              Passed
            </Button>
            <Button variant="danger" busy={busy === 'failed'} onClick={() => void set('failed')}>
              Failed
            </Button>
            <Button
              variant="secondary"
              busy={busy === 'not_applicable'}
              onClick={() => void set('not_applicable')}
            >
              Not applicable
            </Button>
          </div>
        </div>
      ) : t.note ? (
        <p className="muted">Note: {t.note}</p>
      ) : null}
    </li>
  );
}

export default function ManualTasks() {
  const { orgId, org } = useOrg();
  const { scanId } = useParams<{ scanId: string }>();
  const d = useAsync(
    () => api<{ tasks: ManualTask[] }>('GET', `/orgs/${orgId}/scans/${scanId}/manual-tasks`),
    scanId,
  );
  const canEdit = org ? atLeast(org.role, 'member') : false;

  return (
    <>
      <p style={{ margin: '0 0 0.75rem' }}>
        <Link href={`/orgs/${orgId}/scans/${scanId}`}>&larr; Back to report</Link>
      </p>
      <PageHeader
        title="Manual verification"
        description="Checks that automation cannot decide. Record what you find."
      />
      <Notice kind="warn">
        Marking a check as passed or failed records your judgement. It does not change automated
        results.
      </Notice>
      {d.loading && !d.data ? <Loading label="Loading checklist" /> : null}
      {d.error ? <ErrorAlert error={d.error} onRetry={d.reload} /> : null}
      {d.data && d.data.tasks.length === 0 ? (
        <EmptyState title="No manual checks">This scan produced none.</EmptyState>
      ) : null}
      {d.data && d.data.tasks.length > 0 ? (
        <ul className="finding-list" style={{ marginTop: '1rem' }}>
          {d.data.tasks.map((t) => (
            <Task key={t.id} t={t} orgId={orgId} canEdit={canEdit} onSaved={d.reload} />
          ))}
        </ul>
      ) : null}
    </>
  );
}
