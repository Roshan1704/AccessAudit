import { useRef } from 'react';
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

interface EvidenceItem {
  id: string;
  kind: string;
  content: unknown;
  blobBase64: string | null;
  contentType: string | null;
}

function isImage(e: EvidenceItem): boolean {
  return Boolean(e.blobBase64) && (e.contentType ?? '').startsWith('image/');
}

function ScreenshotPreview({ e }: { e: EvidenceItem }) {
  const ref = useRef<HTMLDialogElement>(null);
  const src = `data:${e.contentType ?? 'image/png'};base64,${e.blobBase64 ?? ''}`;
  const label = e.kind.replaceAll('_', ' ');
  const kind = screenshotKind(e.content);
  return (
    <figure className="shot-figure">
      <button
        type="button"
        className="shot-open"
        onClick={() => ref.current?.showModal()}
        aria-label={`Open larger view of ${label}. ${kind.badge}`}
        aria-haspopup="dialog"
      >
        <img className="shot" src={src} alt={`${kind.badge}: ${label}`} />
      </button>
      <figcaption className="muted">
        <strong>{kind.badge}.</strong> {kind.text}
      </figcaption>
      <dialog
        ref={ref}
        className="shot-dialog"
        aria-label={`Larger view of ${label}`}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) ref.current?.close();
        }}
      >
        <img src={src} alt={`Larger view. ${kind.badge}: ${label}`} />
        <form method="dialog">
          <button type="submit" className="btn" autoFocus>
            Close
          </button>
        </form>
      </dialog>
    </figure>
  );
}

/**
 * What the stored image actually is. Only evidence that explicitly says it carries an
 * AccessAudit annotation is described as annotated; nothing is inferred from pixels.
 */
function screenshotKind(content: unknown): { badge: string; text: string } {
  const c = (content ?? {}) as Record<string, unknown>;
  if (c.origin === 'demo_sample') {
    return {
      badge: 'Sample image (demo data)',
      text: 'This is an illustration, not a capture of a real page. The red box is part of the illustration and does not mark a measured element position.',
    };
  }
  if (c.annotated === true) {
    return {
      badge: 'Annotated by AccessAudit',
      text: 'The red box was drawn by AccessAudit around the affected element at scan time.',
    };
  }
  return {
    badge: 'Original scan screenshot',
    text: 'Captured during the scan and not annotated. The affected element is not outlined; use the selector to find it.',
  };
}

/**
 * Two levels of evidence. Visual evidence (screenshots, where it was found) comes first;
 * everything the engine stored (DOM, computed styles, raw check data) stays available inside a
 * clearly separated, collapsed technical section. Nothing is dropped.
 */
export function EvidenceSections({
  evidence,
  pageUrl,
  selector,
  message,
}: {
  evidence: EvidenceItem[];
  pageUrl: string;
  selector: string | null;
  message: string;
}) {
  const images = evidence.filter(isImage);
  const technical = evidence.filter((e) => !isImage(e));
  return (
    <>
      <section className="card stack" aria-labelledby="visual-evidence-h" id="visual-evidence">
        <h2 id="visual-evidence-h">Visual evidence</h2>
        <p>{message}</p>
        <dl className="kv">
          <dt>Page</dt>
          <dd className="break">{pageUrl}</dd>
          <dt>Element</dt>
          <dd className="break">{selector ? <code>{selector}</code> : 'Page level'}</dd>
        </dl>
        {images.length === 0 ? (
          <p className="muted">No screenshot was stored for this finding.</p>
        ) : (
          images.map((e) => <ScreenshotPreview key={e.id} e={e} />)
        )}
      </section>
      <section className="card" aria-labelledby="tech-evidence-h" id="technical-evidence">
        <h2 id="tech-evidence-h">Technical evidence</h2>
        {technical.length === 0 ? (
          <p className="muted">No technical evidence stored.</p>
        ) : (
          <>
            <p className="muted">
              Raw data from the scan: DOM, selectors, computed styles and check results.
            </p>
            {technical.map((e) => (
              <details key={e.id} className="tech-details">
                <summary>{e.kind.replaceAll('_', ' ')}</summary>
                <EvidenceView {...e} />
              </details>
            ))}
          </>
        )}
      </section>
    </>
  );
}

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
