import { Check } from 'lucide-react';
import { Link } from '@/lib/nav';
import { useState, type SyntheticEvent, type ReactNode } from 'react';
import { BrandMark, ErrorAlert, Button, Notice, fieldErrors } from '@/components/ui';

/** Shared shell for the unauthenticated forms: heading, submit handling, error and success states. */
export function AuthForm({
  title,
  intro,
  submitLabel,
  onSubmit,
  success,
  children,
  footer,
}: {
  title: string;
  intro?: string;
  submitLabel: string;
  onSubmit: () => Promise<void>;
  success?: string;
  children: (errors: Record<string, string>) => ReactNode;
  footer?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-split">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <aside className="auth-aside" aria-label="About AccessAudit">
        <Link href="/" className="brand">
          <BrandMark />
          AccessAudit
        </Link>
        <h2>Find and fix website accessibility problems</h2>
        <ul>
          {[
            'Check your sites against WCAG 2.2 AA',
            'Prove you own a domain before it is audited',
            'Work with your team in a private workspace',
          ].map((t) => (
            <li key={t}>
              <Check size={18} aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
        <p>
          <Link href="/">What is AccessAudit?</Link>
        </p>
      </aside>
      <div className="auth-wrap">
        <main id="main" className="card auth-card" style={{ padding: '1.75rem' }}>
          <div className="auth-brand">
            <Link href="/" className="brand">
              <BrandMark />
              AccessAudit
            </Link>
          </div>
          <h1 style={{ textAlign: 'center' }}>{title}</h1>
          {intro ? (
            <p className="muted" style={{ textAlign: 'center' }}>
              {intro}
            </p>
          ) : null}
          {done && success ? <Notice>{success}</Notice> : null}
          <form
            onSubmit={(e) => void submit(e)}
            className="stack"
            noValidate
            style={{ marginTop: '1rem' }}
          >
            {children(fieldErrors(error))}
            <ErrorAlert
              error={
                Object.keys(fieldErrors(error)).length
                  ? new Error('Please fix the highlighted fields.')
                  : error
              }
            />
            <Button type="submit" busy={busy} style={{ width: '100%' }}>
              {submitLabel}
            </Button>
          </form>
          {footer ? <div className="auth-footer">{footer}</div> : null}
        </main>
      </div>
    </div>
  );
}
