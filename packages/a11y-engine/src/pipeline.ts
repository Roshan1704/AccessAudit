import { createHash } from 'node:crypto';
import { getRule } from './registry.js';
import type {
  Classification,
  Finding,
  ManualTask,
  RawFinding,
  Rejection,
  Severity,
} from './types.js';

const CLASS_RANK: Record<Classification, number> = {
  confirmed: 3,
  strong_potential: 2,
  manual_verification: 1,
  informational: 0,
};
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  serious: 3,
  moderate: 2,
  minor: 1,
  none: 0,
};

export const MAX_EVIDENCE_PER_FINDING = 6;
export const MAX_SNIPPET_CHARS = 1000;

/** Selector text with volatile parts removed so the same element hashes the same across scans. */
export function normalizeSelector(selector: string | null): string {
  if (selector === null) return '';
  return selector
    .replace(/\s+/g, ' ')
    .replace(/#[\w-]*\d{3,}[\w-]*/g, '#*')
    .replace(/\[(?:id|data-[\w-]+)=["'][^"']*\d{3,}[^"']*["']\]/g, '[*]')
    .trim();
}

export function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** Stable identity of a problem: rule + element + page. Used to dedupe and to track a finding across scans. */
export function fingerprint(ruleId: string, selector: string | null, url: string): string {
  return createHash('sha256')
    .update(`${ruleId}\n${normalizeSelector(selector)}\n${pagePath(url)}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Confidence is a ranking aid, not a probability. Documented inputs: classification, rule reliability,
 * reproducibility and the amount of evidence.
 */
export function scoreConfidence(
  f: RawFinding,
  reliability: 'deterministic' | 'heuristic' | 'manual',
): number {
  const base: Record<Classification, number> = {
    confirmed: 88,
    strong_potential: 62,
    manual_verification: 35,
    informational: 20,
  };
  let score = base[f.classification];
  if (reliability === 'heuristic') score -= 8;
  if (f.reproduced === true) score += 6;
  if (f.evidence.some((e) => e.kind === 'screenshot')) score += 2;
  if (f.evidence.some((e) => e.kind === 'interaction_trace')) score += 2;
  return Math.max(0, Math.min(100, score));
}

export interface ValidationResult {
  finding?: RawFinding;
  rejection?: Rejection;
  notes: string[];
}

function truncate(v: unknown): unknown {
  if (typeof v === 'string' && v.length > MAX_SNIPPET_CHARS)
    return `${v.slice(0, MAX_SNIPPET_CHARS)}…`;
  return v;
}

/**
 * Validation gate (engine step 19). A finding survives only with real evidence and a legitimate
 * classification. Heuristic rules are capped below "confirmed" unless reproduced with an interaction
 * trace. Nothing is upgraded here, only downgraded or rejected.
 */
export function validate(raw: RawFinding): ValidationResult {
  const notes: string[] = [];
  const rule = getRule(raw.ruleId);
  if (rule === undefined) {
    return { rejection: { ruleId: raw.ruleId, reason: 'unknown_rule' }, notes };
  }
  if (raw.message.trim() === '') {
    return { rejection: { ruleId: raw.ruleId, reason: 'empty_message' }, notes };
  }
  const evidence = raw.evidence
    .filter((e) => Object.keys(e.content).length > 0 || e.blobBase64 !== undefined)
    .map((e) => ({
      ...e,
      content: Object.fromEntries(Object.entries(e.content).map(([k, v]) => [k, truncate(v)])),
    }));
  if (evidence.length === 0) {
    return { rejection: { ruleId: raw.ruleId, reason: 'no_evidence' }, notes };
  }

  let classification = raw.classification;
  if (classification === 'confirmed') {
    const reproducedTrace =
      raw.reproduced === true && evidence.some((e) => e.kind === 'interaction_trace');
    if (rule.reliability === 'manual') {
      classification = 'manual_verification';
      notes.push('manual rule cannot be confirmed');
    } else if (
      rule.reliability === 'heuristic' &&
      !(rule.source === 'interaction' && reproducedTrace)
    ) {
      classification = 'strong_potential';
      notes.push('heuristic rule capped below confirmed');
    }
    if (classification === 'confirmed' && raw.selector === null && rule.source !== 'custom') {
      classification = 'strong_potential';
      notes.push('no element locator');
    }
  }
  if (rule.wcagCriteria.length === 0 && classification !== 'informational') {
    classification = 'informational';
    notes.push('best practice, no WCAG criterion');
  }

  return {
    finding: { ...raw, classification, evidence: evidence.slice(0, MAX_EVIDENCE_PER_FINDING) },
    notes,
  };
}

/** Normalise → validate → score → dedupe a page's raw findings. */
export function processFindings(
  raws: RawFinding[],
  pageUrl: string,
): { findings: Finding[]; rejected: Rejection[] } {
  const rejected: Rejection[] = [];
  const merged = new Map<string, Finding>();

  for (const raw of raws) {
    const v = validate(raw);
    if (v.finding === undefined) {
      if (v.rejection !== undefined) rejected.push(v.rejection);
      continue;
    }
    const rule = getRule(raw.ruleId);
    if (rule === undefined) continue;
    const fp = fingerprint(raw.ruleId, raw.selector, pageUrl);
    const next: Finding = {
      ...v.finding,
      fingerprint: fp,
      occurrences: v.finding.occurrences ?? 1,
      wcagCriteria: rule.wcagCriteria,
      confidence: scoreConfidence(v.finding, rule.reliability),
      validationNotes: v.notes,
    };
    const prev = merged.get(fp);
    if (prev === undefined) {
      merged.set(fp, next);
      continue;
    }
    // Duplicate: keep the strongest classification, sum occurrences, union distinct evidence.
    const stronger =
      CLASS_RANK[next.classification] > CLASS_RANK[prev.classification] ? next : prev;
    const seen = new Set(prev.evidence.map((e) => `${e.kind}:${JSON.stringify(e.content)}`));
    const extra = next.evidence.filter((e) => !seen.has(`${e.kind}:${JSON.stringify(e.content)}`));
    merged.set(fp, {
      ...stronger,
      occurrences: (prev.occurrences ?? 1) + (next.occurrences ?? 1),
      evidence: [...prev.evidence, ...extra].slice(0, MAX_EVIDENCE_PER_FINDING),
      severity:
        SEVERITY_RANK[next.severity] > SEVERITY_RANK[prev.severity] ? next.severity : prev.severity,
      confidence: Math.max(prev.confidence, next.confidence),
      validationNotes: [...new Set([...prev.validationNotes, ...next.validationNotes])],
    });
  }

  const findings = [...merged.values()].sort(
    (a, b) =>
      CLASS_RANK[b.classification] - CLASS_RANK[a.classification] ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.confidence - a.confidence,
  );
  return { findings, rejected };
}

const HOW_TO: Record<string, string> = {
  'manual:media-alternatives':
    'Play each audio or video item. Check captions exist, match the speech, and name speakers or sounds that matter. If video carries information not in the audio, check audio description or a text alternative exists.',
  'manual:motion-control':
    'Watch the page for 10 seconds. If anything moves, blinks or updates automatically for more than 5 seconds, confirm there is a visible pause, stop or hide control that works with the keyboard.',
  'manual:focus-not-obscured':
    'Tab through the page with the keyboard. Confirm no focused element is fully hidden behind a sticky header, footer or banner.',
  'manual:sensory-characteristics':
    'Read the highlighted instruction. Confirm it can be followed without seeing colour, shape or position, for example by also naming the control.',
};

/** Turn findings that need a human into tasks (engine step 20). Each task says exactly what to check. */
export function manualTasksFor(findings: Finding[]): ManualTask[] {
  const out: ManualTask[] = [];
  for (const f of findings) {
    if (f.classification !== 'manual_verification') continue;
    const rule = getRule(f.ruleId);
    const instructions =
      HOW_TO[f.ruleId] ??
      `${rule?.title ?? f.ruleId}. The automated check could not decide. Inspect ${f.selector ?? 'the page'} with a keyboard and a screen reader, then record whether it meets WCAG ${f.wcagCriteria.join(', ') || 'best practice'}. ${f.message}`;
    out.push({ ruleId: f.ruleId, instructions, findingFingerprint: f.fingerprint });
  }
  return out;
}
