/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- in-page scripts are strings, so the result shape is asserted here */
import type { Page } from 'playwright-core';
import { ACTIVE_SCRIPT, BLURRED_SNAPSHOT_SCRIPT } from './focus-scripts.js';
import {
  MANUAL_SIGNALS_SCRIPT,
  REFLOW_PROBE_SCRIPT,
  STATIC_CHECKS_SCRIPT,
} from './page-scripts.js';
import { getRule } from './registry.js';
import type { Evidence, RawFinding } from './types.js';

interface Detection {
  rule: string;
  selector: string;
  snippet: string;
  data: Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const MESSAGES: Record<string, (d: Detection) => string> = {
  'custom:generic-link-text': (d) =>
    `Link text "${String(d.data['name'])}" does not say where the link goes.`,
  'custom:placeholder-only-label': (d) =>
    `Field has no label; its only name is the placeholder "${String(d.data['placeholder'])}".`,
  'custom:missing-autocomplete': (d) =>
    `Field "${String(d.data['name'] || d.data['type'])}" collects personal data but has no autocomplete attribute.`,
  'custom:group-no-legend': (d) =>
    `${String(d.data['count'])} radio buttons named "${String(d.data['name'])}" have no group label (fieldset with legend).`,
  'custom:required-not-programmatic': (d) =>
    `Label "${String(d.data['label'])}" shows a required marker but the field is not marked required.`,
  'interaction:form-error-association': () =>
    'Field is marked aria-invalid but no error text is associated with it (no aria-describedby or aria-errormessage).',
  'manual:media-alternatives': () =>
    'Audio or video found. A person must check captions and descriptions.',
  'manual:motion-control': (d) =>
    `Moving or auto-updating content found (${String(d.data['reason'])}). Check for a pause control.`,
  'manual:focus-not-obscured': () =>
    'Fixed or sticky content found. Check it never covers the focused element.',
  'manual:sensory-characteristics': (d) =>
    `Instruction may depend on shape, colour or position: "${String(d.data['phrase'])}".`,
};

function detectionToRaw(d: Detection): RawFinding | null {
  const rule = getRule(d.rule);
  if (rule === undefined) return null;
  const evidence: Evidence[] = [
    { kind: 'html_snippet', content: { html: d.snippet } },
    { kind: 'selector', content: { selector: d.selector } },
    { kind: 'check_data', content: d.data },
  ];
  if (rule.id === 'custom:placeholder-only-label' || rule.id === 'custom:generic-link-text') {
    evidence.push({
      kind: 'accessible_name',
      content: {
        name: str(d.data['name'] ?? d.data['placeholder']),
        source: str(d.data['source']),
      },
    });
  }
  const msg = MESSAGES[d.rule]?.(d) ?? rule.title;
  const classification =
    rule.reliability === 'manual'
      ? 'manual_verification'
      : rule.reliability === 'deterministic'
        ? 'confirmed'
        : 'strong_potential';
  return {
    ruleId: rule.id,
    message: msg,
    selector: d.selector,
    classification,
    severity: rule.defaultSeverity,
    evidence,
  };
}

/** Static custom rules plus manual-verification signals. No interaction, no state change. */
export async function runStaticChecks(page: Page): Promise<RawFinding[]> {
  const out: RawFinding[] = [];
  const staticHits = (await page.evaluate(STATIC_CHECKS_SCRIPT)) as Detection[];
  const manualHits = (await page.evaluate(MANUAL_SIGNALS_SCRIPT)) as Detection[];
  for (const d of [...staticHits, ...manualHits]) {
    const raw = detectionToRaw(d);
    if (raw !== null) out.push(raw);
  }
  return out;
}

/**
 * Reflow at 320 CSS px (WCAG 1.4.10). The viewport is restored afterwards. Heuristic: a wide table or
 * code block may be a legitimate exception, so this is never confirmed.
 */
export async function runReflowCheck(page: Page): Promise<RawFinding[]> {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  try {
    const hit = (await page.evaluate(REFLOW_PROBE_SCRIPT)) as {
      viewportWidth: number;
      scrollWidth: number;
      selector: string;
      snippet: string;
    } | null;
    if (hit === null) return [];
    const rule = getRule('custom:reflow');
    if (rule === undefined) return [];
    return [
      {
        ruleId: rule.id,
        message: `Page is ${String(hit.scrollWidth)} px wide in a ${String(hit.viewportWidth)} px viewport, so it scrolls horizontally.`,
        selector: hit.selector,
        classification: 'strong_potential',
        severity: rule.defaultSeverity,
        evidence: [
          {
            kind: 'check_data',
            content: { viewportWidth: hit.viewportWidth, scrollWidth: hit.scrollWidth },
          },
          { kind: 'selector', content: { selector: hit.selector } },
          ...(hit.snippet === ''
            ? []
            : [{ kind: 'html_snippet' as const, content: { html: hit.snippet } }]),
        ],
      },
    ];
  } finally {
    if (original !== null) await page.setViewportSize(original);
  }
}

/**
 * Focus indicator check (WCAG 2.4.7). Tab through focusable elements and compare each element's
 * computed visual state focused vs unfocused. No measurable change means no visible indicator.
 * Flags only elements that are both in the viewport and unchanged on two separate passes.
 */
export async function runFocusIndicatorCheck(page: Page, maxStops: number): Promise<RawFinding[]> {
  const rule = getRule('custom:focus-indicator');
  if (rule === undefined) return [];
  const before = (await page.evaluate(BLURRED_SNAPSHOT_SCRIPT)) as Record<string, string>;
  const missing = new Map<
    string,
    { snippet: string; outline: string; boxShadow: string; hits: number }
  >();
  const hidden = new Map<string, string>();

  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(
      'document.activeElement && document.activeElement.blur && document.activeElement.blur()',
    );
    await page.evaluate('window.scrollTo(0, 0)');
    const seen = new Set<string>();
    for (let i = 0; i < maxStops; i++) {
      await page.keyboard.press('Tab');
      const active = (await page.evaluate(ACTIVE_SCRIPT)) as {
        selector: string;
        snippet: string;
        snap: string;
        outline: string;
        boxShadow: string;
        hidden: boolean;
        tag: string;
      } | null;
      if (active === null || seen.has(active.selector)) break;
      seen.add(active.selector);
      if (active.hidden) {
        hidden.set(active.selector, active.snippet);
        continue;
      }
      const base = before[active.selector];
      if (base !== undefined && base === active.snap) {
        const prev = missing.get(active.selector);
        missing.set(active.selector, {
          snippet: active.snippet,
          outline: active.outline,
          boxShadow: active.boxShadow,
          hits: (prev?.hits ?? 0) + 1,
        });
      }
    }
  }

  const out: RawFinding[] = [];
  for (const [selector, m] of missing) {
    if (m.hits < 2) continue;
    out.push({
      ruleId: rule.id,
      message:
        'Element gets keyboard focus but nothing visible changes (no outline, shadow, border or background change).',
      selector,
      classification: 'confirmed',
      severity: rule.defaultSeverity,
      reproduced: true,
      evidence: [
        { kind: 'html_snippet', content: { html: m.snippet } },
        { kind: 'selector', content: { selector } },
        {
          kind: 'computed_style',
          content: {
            focusedOutline: m.outline,
            focusedBoxShadow: m.boxShadow,
            unchangedFromBlurred: true,
          },
        },
        {
          kind: 'interaction_trace',
          content: {
            steps: [
              'Press Tab until the element is focused',
              'Compare computed style with unfocused state',
            ],
            passes: 2,
          },
        },
      ],
    });
  }
  const hiddenRule = getRule('custom:focus-hidden');
  if (hiddenRule !== undefined) {
    for (const [selector, snippet] of hidden) {
      out.push({
        ruleId: hiddenRule.id,
        message:
          'Keyboard focus lands on an element that is invisible, zero-sized or outside the viewport.',
        selector,
        classification: 'strong_potential',
        severity: hiddenRule.defaultSeverity,
        evidence: [
          { kind: 'html_snippet', content: { html: snippet } },
          { kind: 'selector', content: { selector } },
          {
            kind: 'interaction_trace',
            content: {
              steps: ['Press Tab until the element is focused', 'Measure its box and visibility'],
            },
          },
        ],
      });
    }
  }
  return out;
}
