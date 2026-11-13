import { useRef, useState, type SyntheticEvent } from 'react';
import { ClassPill, ConfidenceText, EvidenceView, SeverityTag } from '@/components/findings';
import { BrandMark, Button, ErrorAlert, Field, Notice } from '@/components/ui';
import {
  ApiError,
  CLASS_LABEL,
  api,
  type Classification,
  type QuickFinding,
  type QuickResult,
} from '@/lib/api';
import { Link } from '@/lib/nav';

type Phase = 'idle' | 'proof' | 'submitting' | 'scanning' | 'done';

const CLASSES: Classification[] = [
  'confirmed',
  'strong_potential',
  'manual_verification',
  'informational',
];

function leadingZeroBits(buf: ArrayBuffer): number {
  let bits = 0;
  for (const byte of new Uint8Array(buf)) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

async function solve(challenge: string, bits: number, signal: AbortSignal): Promise<string> {
  const enc = new TextEncoder();
  for (let n = 0; ; n++) {
    if (signal.aborted) throw new Error('aborted');
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${String(n)}`));
    if (leadingZeroBits(digest) >= bits) return String(n);
    if (n % 5000 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

function explain(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const reason = (e.details as { reason?: string } | undefined)?.reason;
  if (e.code === 'RATE_LIMITED') {
    if (reason === 'daily_cap')
      return 'The free check has reached its daily limit. Try again tomorrow, or create an account.';
    if (reason === 'busy') return 'Many checks are running right now. Try again in a minute.';
    return 'You have run too many checks recently. Wait a while, or create an account.';
  }
  if (e.code === 'URL_NOT_ALLOWED')
    return 'That address cannot be checked. Use a public http or https page.';
  return null;
}

function Result({ r }: { r: QuickResult }) {
  if (r.status === 'blocked')
    return <Notice kind="warn">This page was not checked: {r.reason.replaceAll('_', ' ')}.</Notice>;
  const counts = Object.fromEntries(
    CLASSES.map((c) => [c, r.findings.filter((f) => f.classification === c).length]),
  ) as Record<Classification, number>;
  const byKey = new Map<string, { f: QuickFinding; total: number; selectors: string[] }>();
  for (const f of r.findings) {
    const key = `${f.ruleId}|${f.classification}`;
    const g = byKey.get(key) ?? { f, total: 0, selectors: [] };
    g.total += f.occurrences;
    if (f.selector && !g.selectors.includes(f.selector)) g.selectors.push(f.selector);
    byKey.set(key, g);
  }
  const groups = [...byKey.values()];
  return (
    <section aria-labelledby="qc-result" className="stack">
      <h2 id="qc-result">Result for {r.title ?? r.finalUrl}</h2>
      <p className="muted">
        Checked page: <a href={r.finalUrl}>{r.finalUrl}</a>
      </p>
      <Notice kind="warn">This result is shown once and is not saved. {r.coverage.note}</Notice>
      <div className="kpis">
        {CLASSES.map((c) => (
          <div key={c} className={`kpi ${c}`}>
            <strong>{counts[c]}</strong>
            <span>{CLASS_LABEL[c]}</span>
          </div>
        ))}
      </div>
      <p className="muted">
        One page, passive checks only. Automated testing finds only part of WCAG issues, so a clean
        result does not prove conformance.
      </p>
      {r.findings.length === 0 ? <p>No automated findings on this page.</p> : null}
      <ul className="finding-list">
        {groups.map(({ f, total, selectors }) => (
          <li key={`${f.ruleId}-${f.classification}`} className="finding-item">
            <div className="row">
              <ClassPill value={f.classification} />
              <SeverityTag value={f.severity} />
              <span className="muted">
                <ConfidenceText value={f.confidence} />
              </span>
            </div>
            <h3>{f.ruleTitle}</h3>
            <p>{f.message}</p>
            <p className="muted">
              {f.wcagCriteria.length > 0 ? `WCAG ${f.wcagCriteria.join(', ')} · ` : ''}
              {total} element{total === 1 ? '' : 's'} affected
            </p>
            {selectors.length > 1 ? (
              <details>
                <summary>Show all {selectors.length} locations</summary>
                <ul>
                  {selectors.map((s) => (
                    <li key={s}>
                      <code>{s}</code>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {f.evidence.slice(0, 2).map((ev, j) => (
              <EvidenceView key={j} kind={ev.kind} content={ev.content} />
            ))}
          </li>
        ))}
      </ul>
      {r.manualTasks.length > 0 ? (
        <div className="card">
          <h3>Needs a person</h3>
          <ul>
            {r.manualTasks.map((t, i) => (
              <li key={`${t.ruleId}-${String(i)}`}>{t.instructions}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="cta-card">
        <h3>Want the whole site?</h3>
        <p>This check covered one page and was not saved. In a project you can:</p>
        <ul>
          <li>Scan many pages, with interaction tests, after verifying your domain.</li>
          <li>Keep a scan history and compare scans: new, regressed and resolved findings.</li>
          <li>Assign findings, change their status and discuss them with your team.</li>
          <li>Track remediation and export PDF, HTML, CSV or JSON reports.</li>
        </ul>
        <p>
          <Link href="/register">Create a free account</Link>
          {' · '}
          <Link href="/login">Sign in</Link>
          {' · '}
          You can also run another quick check without an account.
        </p>
      </div>
    </section>
  );
}

export default function QuickCheck() {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<QuickResult | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function run(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      setPhase('proof');
      const { challenge, bits } = await api<{ challenge: string; bits: number }>(
        'GET',
        '/quick-check/challenge',
      );
      const nonce = await solve(challenge, bits, ctl.signal);
      setPhase('submitting');
      const { id } = await api<{ id: string }>('POST', '/quick-check', {
        url: /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`,
        challenge,
        nonce,
      });
      setPhase('scanning');
      for (let i = 0; i < 90; i++) {
        if (ctl.signal.aborted) throw new Error('aborted');
        await new Promise((r) => setTimeout(r, 2000));
        const s = await api<{ state: string; result?: QuickResult }>('GET', `/quick-check/${id}`);
        if (s.state === 'done' && s.result) {
          setResult(s.result);
          setPhase('done');
          return;
        }
        if (s.state === 'failed') throw new Error('The check failed. Try again.');
      }
      throw new Error('The check took too long. Try again.');
    } catch (err) {
      if (!ctl.signal.aborted) setError(err);
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle' && phase !== 'done';
  const friendly = explain(error);
  const status: Record<Phase, string> = {
    idle: '',
    proof: 'Preparing request…',
    submitting: 'Submitting…',
    scanning: 'Checking the page. This takes up to a minute.',
    done: '',
  };

  return (
    <main className="quick-wrap">
      <p style={{ margin: 0 }}>
        <Link href="/" className="brand">
          <BrandMark />
          AccessAudit
        </Link>
      </p>
      <h1>Quick accessibility check</h1>
      <p>
        Check one public page without an account. Nothing is saved. Only passive checks run: the
        page is loaded and analysed, nothing is clicked or submitted.
      </p>
      <section className="card" aria-labelledby="qc-what">
        <h2 id="qc-what">What this check does and does not do</h2>
        <ul>
          <li>It tests a single page, as a visitor who is not signed in would see it.</li>
          <li>
            Results are shown once. Nothing is stored, so there is no history or comparison here.
          </li>
          <li>
            Automated checks find only part of WCAG issues. A clean result does not prove the page
            is accessible.
          </li>
          <li>For several pages, saved reports and fix tracking, create an account.</li>
        </ul>
      </section>
      <form className="card stack" onSubmit={(e) => void run(e)} noValidate>
        <Field
          label="Page address"
          type="url"
          required
          hint="For example https://www.example.com/"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {friendly ? <Notice kind="warn">{friendly}</Notice> : <ErrorAlert error={error} />}
        <div className="row">
          <Button type="submit" busy={busy} disabled={!url.trim()}>
            Run check
          </Button>
          {busy ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                abort.current?.abort();
                setPhase('idle');
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
        <p role="status" className="muted" style={{ margin: 0 }}>
          {status[phase]}
        </p>
      </form>
      {result ? <Result r={result} /> : null}
    </main>
  );
}
