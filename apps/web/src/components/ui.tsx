import {
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  Inbox,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api';

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </p>
  );
}

export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const msg =
    error instanceof ApiError && error.code === 'INTERNAL'
      ? 'Something went wrong on our side. Please try again in a moment. If it keeps happening, contact support and quote the reference below.'
      : error instanceof Error
        ? error.message
        : 'Something went wrong.';
  const rid = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div className="alert error" role="alert">
      <CircleAlert size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="alert-body">
        <p style={{ margin: 0 }}>{msg}</p>
        {rid ? <p style={{ margin: 0, fontSize: '0.85rem' }}>Reference: {rid}</p> : null}
        {onRetry ? (
          <button
            type="button"
            className="btn secondary"
            style={{ marginTop: '0.5rem' }}
            onClick={onRetry}
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Notice({ kind = 'ok', children }: { kind?: 'ok' | 'warn'; children: ReactNode }) {
  const Icon = kind === 'ok' ? CircleCheck : TriangleAlert;
  return (
    <div className={`alert ${kind}`} role="status">
      <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="alert-body">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head row" style={{ justifyContent: 'space-between' }}>
      <div>
        <h1>{title}</h1>
        {description ? (
          <p className="muted" style={{ margin: 0 }}>
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <ShieldCheck size={18} />
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        <Inbox size={22} />
      </div>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children ? <p className="muted">{children}</p> : null}
      {action}
    </div>
  );
}

export function Button({
  variant = 'primary',
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
}) {
  const cls = variant === 'primary' ? 'btn' : `btn ${variant}`;
  return (
    <button
      {...rest}
      className={cls}
      disabled={rest.disabled === true || busy === true}
      aria-busy={busy === true}
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = input.type === 'password';
  const describedBy =
    [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  const control = (
    <input
      id={id}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      {...input}
      {...(isPassword ? { type: shown ? 'text' : 'password' } : {})}
    />
  );
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {isPassword ? (
        <div className="password-wrap">
          {control}
          <button
            type="button"
            className="password-toggle"
            aria-pressed={shown}
            aria-label={shown ? 'Hide password' : 'Show password'}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
      ) : (
        control
      )}
      {hint ? (
        <div className="hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="error-text" id={`${id}-err`}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

/** Field-level messages from a VALIDATION_FAILED response, if present. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || e.code !== 'VALIDATION_FAILED') return {};
  const out: Record<string, string> = {};
  if (Array.isArray(e.details)) {
    for (const i of e.details as { path?: string; message?: string }[]) {
      if (i.path && !(i.path in out)) out[i.path] = friendlyMessage(i.path, i.message);
    }
  }
  return out;
}

/** Turns raw schema messages ("Too small: expected string to have >=12 characters") into plain language. */
function friendlyMessage(path: string, raw: string | undefined): string {
  const min = /(?:>=|at least )\s*(\d+)\s*char/i.exec(raw ?? '')?.[1];
  if (min) return `Use at least ${min} characters.`;
  const max = /(?:<=|at most )\s*(\d+)\s*char/i.exec(raw ?? '')?.[1];
  if (max) return `Use no more than ${max} characters.`;
  if (/email/i.test(raw ?? '') || (path === 'email' && /invalid/i.test(raw ?? '')))
    return 'Enter a valid email address, like name@example.com.';
  if (/expected string|required/i.test(raw ?? '')) return 'This field is required.';
  return raw ?? 'Invalid value.';
}
