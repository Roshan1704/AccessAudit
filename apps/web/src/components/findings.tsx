import { CLASS_HELP, CLASS_LABEL, type Classification, type Severity } from '@/lib/api';

export function ClassPill({ value }: { value: Classification }) {
  return (
    <span className={`pill ${value}`} title={CLASS_HELP[value]}>
      {CLASS_LABEL[value]}
    </span>
  );
}

export function SeverityTag({ value }: { value: Severity }) {
  return <span className={`sev-tag ${value}`}>{value}</span>;
}

export const SEVERITY_ORDER: Severity[] = ['critical', 'serious', 'moderate', 'minor'];

export function SeverityBars({ counts }: { counts: Partial<Record<Severity, number>> }) {
  const max = Math.max(1, ...SEVERITY_ORDER.map((s) => counts[s] ?? 0));
  return (
    <ul className="bars" aria-label="Open confirmed and potential findings by severity">
      {SEVERITY_ORDER.map((s) => {
        const n = counts[s] ?? 0;
        return (
          <li key={s}>
            <span style={{ textTransform: 'capitalize' }}>{s}</span>
            <span className="track" aria-hidden="true">
              <span
                className={`fill ${s}`}
                style={{ width: `${String((n / max) * 100)}%`, display: 'block' }}
              />
            </span>
            <strong>{n}</strong>
          </li>
        );
      })}
    </ul>
  );
}

export interface ChartItem {
  key: string;
  label: string;
  value: number;
}

/** Donut chart drawn in SVG. The legend doubles as the text alternative. */
export function Donut({ items, label }: { items: ChartItem[]; label: string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 36 36" className="donut" role="img" aria-label={label}>
        <circle cx="18" cy="18" r="15.9155" className="donut-ring" />
        {total > 0
          ? items
              .filter((i) => i.value > 0)
              .map((i) => {
                const len = (i.value / total) * 100;
                const el = (
                  <circle
                    key={i.key}
                    cx="18"
                    cy="18"
                    r="15.9155"
                    className={`donut-seg ${i.key}`}
                    strokeDasharray={`${String(len)} ${String(100 - len)}`}
                    strokeDashoffset={String(25 - offset)}
                  />
                );
                offset += len;
                return el;
              })
          : null}
        <text x="18" y="18.5" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="18" y="23" textAnchor="middle" className="donut-sub">
          open
        </text>
      </svg>
      <ul className="legend">
        {items.map((i) => (
          <li key={i.key}>
            <span className={`swatch ${i.key}`} aria-hidden="true" />
            {i.label}
            <strong>{i.value}</strong>
            <span className="muted">
              {total > 0 ? `${String(Math.round((i.value / total) * 100))}%` : '0%'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface PageRow {
  id: string;
  title: string | null;
  url: string;
  status: string;
  confirmed: number;
  potential: number;
  manual: number;
}

/** Stacked horizontal bars: findings per page, worst pages first. */
export function PageBars({ pages }: { pages: PageRow[] }) {
  const rows = pages
    .filter((p) => p.status === 'scanned')
    .map((p) => ({ ...p, total: p.confirmed + p.potential + p.manual }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.total));
  if (rows.length === 0) return <p className="muted">No scanned pages.</p>;
  return (
    <ul className="page-bars" aria-label="Findings per page, most affected first">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="page-bars-name" title={r.url}>
            {r.title ?? r.url}
          </span>
          <span className="stack-track" aria-hidden="true">
            {(
              [
                ['confirmed', r.confirmed],
                ['strong_potential', r.potential],
                ['manual_verification', r.manual],
              ] as const
            ).map(([k, n]) =>
              n > 0 ? (
                <span
                  key={k}
                  className={`seg ${k}`}
                  style={{ width: `${String((n / max) * 100)}%` }}
                />
              ) : null,
            )}
          </span>
          <strong>{r.total}</strong>
          <span className="sr-only">
            {r.confirmed} confirmed, {r.potential} potential, {r.manual} manual
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ConfidenceText({ value }: { value: number }) {
  return <span>{Math.round(value)}% confidence</span>;
}

/** Evidence content is JSON from the engine; render it as readable text. */
function evidenceText(content: unknown): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'object') {
    const entries = Object.entries(content as Record<string, unknown>);
    if (entries.length === 1 && typeof entries[0]?.[1] === 'string') return entries[0][1];
    return JSON.stringify(content, null, 2);
  }
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);
  return '';
}

const MAX_EVIDENCE_CHARS = 1500;

/** Evidence block: text kinds as preformatted text, images inline. */
export function EvidenceView({
  kind,
  content,
  blobBase64,
  contentType,
}: {
  kind: string;
  content: unknown;
  blobBase64?: string | null;
  contentType?: string | null;
}) {
  const full = evidenceText(content);
  const text =
    full.length > MAX_EVIDENCE_CHARS
      ? `${full.slice(0, MAX_EVIDENCE_CHARS)}\n… (truncated, ${String(full.length - MAX_EVIDENCE_CHARS)} more characters)`
      : full;
  const mime = contentType ?? '';
  const isImage = Boolean(blobBase64) && mime.startsWith('image/');
  return (
    <div className="stack">
      <h4 style={{ margin: 0, textTransform: 'capitalize' }}>{kind.replaceAll('_', ' ')}</h4>
      {text ? <pre className="evidence">{text}</pre> : null}
      {isImage ? (
        <img
          className="shot"
          src={`data:${mime};base64,${blobBase64 ?? ''}`}
          alt={`Screenshot evidence for ${kind.replaceAll('_', ' ')}`}
        />
      ) : null}
    </div>
  );
}
