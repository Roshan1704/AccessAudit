import { useState } from 'react';
import { ClassPill, ConfidenceText, EvidenceView, SeverityTag } from '@/components/findings';
import { Button, ErrorAlert, Loading, Notice, PageHeader, SelectField } from '@/components/ui';
import {
  api,
  atLeast,
  type Explanation,
  type FindingActivity,
  type FindingDetail as Detail,
  type Member,
  type ReviewStatus,
} from '@/lib/api';
import { Link, useParams } from '@/lib/nav';
import { useAsync } from '@/lib/useAsync';
import { useOrg } from '@/lib/useOrg';

export default function FindingDetail() {
  const { orgId, org } = useOrg();
  const { findingId } = useParams<{ findingId: string }>();
  const d = useAsync(() => api<Detail>('GET', `/orgs/${orgId}/findings/${findingId}`), findingId);
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const members = useAsync(
    () => api<{ members: Member[] }>('GET', `/orgs/${orgId}/members`),
    orgId,
  );
  const explanation = useAsync(
    () =>
      api<{ explanation: Explanation }>('GET', `/orgs/${orgId}/findings/${findingId}/explanation`),
    findingId,
  );
  const activity = useAsync(
    () => api<FindingActivity>('GET', `/orgs/${orgId}/findings/${findingId}/activity`),
    findingId,
  );

  if (d.loading && !d.data) return <Loading label="Loading finding" />;
  if (d.error || !d.data)
    return <ErrorAlert error={d.error ?? new Error('Not found.')} onRetry={d.reload} />;
  const { finding: f, evidence, tasks } = d.data;
  const canReview = org ? atLeast(org.role, 'member') : false;
  const current = status ?? f.reviewStatus;
  const who = (id: string | null) =>
    id === null
      ? 'nobody'
      : (members.data?.members.find((m) => m.userId === id)?.name ?? 'a former member');

  async function postComment() {
    if (comment.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/orgs/${orgId}/findings/${f.id}/comments`, { body: comment });
      setComment('');
      activity.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: { status?: ReviewStatus; assigneeId?: string | null } = {};
      if (current !== f.reviewStatus) body.status = current;
      if (assignee !== null && assignee !== (f.assigneeId ?? ''))
        body.assigneeId = assignee === '' ? null : assignee;
      if (Object.keys(body).length > 0) await api('PATCH', `/orgs/${orgId}/findings/${f.id}`, body);
      setSaved(true);
      d.reload();
      activity.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p style={{ margin: '0 0 0.75rem' }}>
        <Link href={`/orgs/${orgId}/scans/${f.scanId}`}>&larr; Back to report</Link>
      </p>
      <PageHeader title={f.ruleTitle} description={f.pageUrl} />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <ClassPill value={f.classification} />
        <SeverityTag value={f.severity} />
        <span className="muted">
          <ConfidenceText value={f.confidence} />
        </span>
      </div>
      {f.classification !== 'confirmed' ? (
        <Notice kind="warn">
          {f.classification === 'strong_potential'
            ? 'This is a potential violation, not a confirmed one. Check it before acting.'
            : f.classification === 'manual_verification'
              ? 'Automation cannot decide this. A person must check it.'
              : 'Informational only.'}
        </Notice>
      ) : null}
      <div className="card">
        <h2>Where it was found</h2>
        <dl className="kv">
          <dt>Page</dt>
          <dd>{f.pageUrl}</dd>
          <dt>Element</dt>
          <dd>{f.selector ? <code>{f.selector}</code> : 'Page level'}</dd>
          <dt>Occurrences</dt>
          <dd>{f.occurrences}</dd>
          <dt>Rule</dt>
          <dd>{f.ruleId}</dd>
        </dl>
      </div>

      <div className="card">
        <h2>The problem</h2>
        <p>{f.message}</p>
        <p>{f.ruleDescription}</p>
      </div>

      <div className="card stack">
        <h2>Who it affects</h2>
        {explanation.loading && !explanation.data ? <Loading label="Loading guidance" /> : null}
        <ErrorAlert error={explanation.error} onRetry={explanation.reload} />
        {explanation.data ? (
          <>
            <p>{explanation.data.explanation.summary}</p>
            <p>{explanation.data.explanation.whyItMatters}</p>
          </>
        ) : null}
      </div>

      <div className="card stack">
        <h2>Evidence</h2>
        {evidence.length === 0 ? <p className="muted">No evidence stored.</p> : null}
        {evidence.map((e) => (
          <EvidenceView key={e.id} {...e} />
        ))}
      </div>

      <div className="card">
        <h2>WCAG context</h2>
        <p>
          {f.wcagCriteria.length > 0
            ? `Success criteria: ${f.wcagCriteria.join(', ')}.`
            : 'This rule is not mapped to a WCAG success criterion.'}
        </p>
        {f.helpUrl ? (
          <p>
            <a href={f.helpUrl} target="_blank" rel="noopener noreferrer">
              Rule documentation (opens in a new tab)
            </a>
          </p>
        ) : null}
      </div>

      <div className="card stack">
        <h2>Standard guidance</h2>
        {explanation.data ? (
          <>
            <h3>How to fix</h3>
            <ul>
              {explanation.data.explanation.howToFix.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p>
              <strong>How to check:</strong> {explanation.data.explanation.verify}
            </p>
            <p className="muted">
              {explanation.data.explanation.source === 'ai'
                ? 'AI-generated'
                : explanation.data.explanation.guidance === 'generic'
                  ? 'General guidance'
                  : 'Rule-specific guidance'}{' '}
              ({explanation.data.explanation.provider}). {explanation.data.explanation.disclaimer}
            </p>
          </>
        ) : (
          <p className="muted">Guidance is not available yet.</p>
        )}
      </div>

      {tasks.length > 0 ? (
        <div className="card">
          <h2>Manual checks</h2>
          <ul>
            {tasks.map((t) => (
              <li key={t.id}>
                {t.instructions} <em>({t.status.replaceAll('_', ' ')})</em>
              </li>
            ))}
          </ul>
          <Link href={`/orgs/${orgId}/scans/${f.scanId}/manual`}>Open the checklist</Link>
        </div>
      ) : null}

      <div className="card stack">
        <h2>Workflow</h2>
        <p className="muted">
          This status is your team&apos;s decision. It is separate from scan results: a later scan
          never changes it, and marking Fixed does not prove the issue is gone. Run a new scan to
          verify.
        </p>
        {canReview ? (
          <>
            <SelectField
              label="Assignee"
              value={assignee ?? f.assigneeId ?? ''}
              onChange={(v) => setAssignee(v)}
              options={[
                { value: '', label: 'Unassigned' },
                ...(members.data?.members ?? []).map((m) => ({
                  value: m.userId,
                  label: m.name,
                })),
              ]}
            />
            <SelectField
              label="Review status"
              value={current}
              onChange={(v) => setStatus(v as ReviewStatus)}
              options={[
                { value: 'open', label: 'Open' },
                { value: 'false_positive', label: 'False positive' },
                { value: 'accepted_risk', label: 'Accepted risk' },
                { value: 'fixed', label: 'Fixed' },
              ]}
            />
            <ErrorAlert error={error} />
            {saved ? <Notice>Saved.</Notice> : null}
            <div>
              <Button busy={busy} onClick={() => void save()}>
                Save review
              </Button>
            </div>
          </>
        ) : (
          <p>
            Status: {f.reviewStatus.replaceAll('_', ' ')}. Assignee: {who(f.assigneeId)}. Members
            can change these.
          </p>
        )}
      </div>

      <div className="card stack">
        <h2>Comments</h2>
        {(activity.data?.comments ?? []).length === 0 ? (
          <p className="muted">No comments yet.</p>
        ) : (
          <ul>
            {(activity.data?.comments ?? []).map((c) => (
              <li key={c.id}>
                <strong>{who(c.authorId)}</strong>{' '}
                <span className="muted">{new Date(c.createdAt).toLocaleString()}</span>
                <br />
                {c.body}
              </li>
            ))}
          </ul>
        )}
        {canReview ? (
          <>
            <div className="field">
              <label htmlFor="finding-comment">Add a comment</label>
              <textarea
                id="finding-comment"
                rows={3}
                maxLength={2000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
            <div>
              <Button busy={busy} onClick={() => void postComment()}>
                Post comment
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <h2>History</h2>
        {(activity.data?.history ?? []).length === 0 ? (
          <p className="muted">No changes yet.</p>
        ) : (
          <ul>
            {(activity.data?.history ?? []).map((h) => (
              <li key={h.id}>
                {new Date(h.createdAt).toLocaleString()}: {who(h.actorId)} changed {h.kind} from{' '}
                {h.kind === 'assignee' ? who(h.fromValue) : (h.fromValue ?? 'none')} to{' '}
                {h.kind === 'assignee' ? who(h.toValue) : (h.toValue ?? 'none')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
