/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- in-page scripts are strings, so the result shape is asserted here */
import type { Page } from 'playwright-core';
import {
  ACTIVE_SCRIPT,
  ATTRS_FN,
  DIALOG_STATE_SCRIPT,
  DIALOG_TRIGGERS_SCRIPT,
  DISCLOSURE_TRIGGERS_SCRIPT,
  MENU_TRIGGERS_SCRIPT,
  OBSERVER_READ_SCRIPT,
  OBSERVER_SETUP_SCRIPT,
  PANEL_VISIBLE_FN,
  TABS_SCRIPT,
} from './focus-scripts.js';
import { callFn, UNREACHABLE_CANDIDATES_SCRIPT } from './page-scripts.js';
import { getRule } from './registry.js';
import type { Evidence, RawFinding } from './types.js';

/**
 * Read-only interaction tests. Policy: GET navigation only (enforced by the browser context), no form
 * submission, no typing into fields, no clicks on links or submit buttons. A test that changes the page
 * is run on a disposable load and the result is reported as "strong_potential". Only a failure seen twice
 * with an interaction trace may be "confirmed" (see the validator).
 */
export interface InteractionResult {
  raws: RawFinding[];
  attempted: number;
  skipped: string[];
}

interface Candidate {
  selector: string;
  snippet: string;
  role?: string | null;
  expanded?: string | null;
  targetSelector?: string | null;
}

const KEY_BUDGET = 120;

function trace(steps: string[], extra: Record<string, unknown> = {}): Evidence {
  return { kind: 'interaction_trace', content: { steps, ...extra } };
}

function raw(
  ruleId: string,
  message: string,
  selector: string | null,
  snippet: string,
  evidence: Evidence[],
  reproduced: boolean,
): RawFinding | null {
  const rule = getRule(ruleId);
  if (rule === undefined) return null;
  return {
    ruleId,
    message,
    selector,
    classification: reproduced ? 'confirmed' : 'strong_potential',
    severity: rule.defaultSeverity,
    reproduced,
    evidence: [
      ...(snippet === '' ? [] : [{ kind: 'html_snippet' as const, content: { html: snippet } }]),
      ...(selector === null ? [] : [{ kind: 'selector' as const, content: { selector } }]),
      ...evidence,
    ],
  };
}

async function activeSelector(page: Page): Promise<string | null> {
  const a = (await page.evaluate(ACTIVE_SCRIPT)) as { selector: string } | null;
  return a === null ? null : a.selector;
}

/** Tab through the page collecting the focus order. Detects traps and unreachable controls. */
async function keyboardTraversal(page: Page, out: RawFinding[]): Promise<void> {
  const candidates = (await page.evaluate(UNREACHABLE_CANDIDATES_SCRIPT)) as Candidate[];
  const order: string[] = [];
  await page.evaluate(
    'document.activeElement && document.activeElement.blur && document.activeElement.blur()',
  );
  let trapped: string[] | null = null;
  for (let i = 0; i < KEY_BUDGET; i++) {
    await page.keyboard.press('Tab');
    const s = await activeSelector(page);
    if (s === null) break; // focus left the document (browser chrome): not trapped
    order.push(s);
    // A cycle of <= 4 distinct elements repeated while the page has more focusable elements = trap suspicion.
    if (order.length >= 12) {
      const tail = order.slice(-12);
      const distinct = new Set(tail);
      if (distinct.size <= 4) {
        trapped = [...distinct];
        break;
      }
    }
  }
  const total = (await page.evaluate('window.__aa.focusables().length')) as number;
  if (trapped !== null && total > trapped.length + 2) {
    // Reproduce from a fresh start with shift-tab to avoid a one-off.
    const back: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab');
      const s = await activeSelector(page);
      if (s !== null) back.push(s);
    }
    const reproduced = new Set(back).size <= 4;
    const r = raw(
      'interaction:keyboard-trap',
      `Tab cycled between ${String(trapped.length)} elements while ${String(total)} are focusable on the page.`,
      trapped[0] ?? null,
      '',
      [
        trace(['Press Tab 12+ times from the top of the page'], {
          cycle: trapped,
          focusableOnPage: total,
          reverseAlsoCycles: reproduced,
        }),
      ],
      reproduced,
    );
    if (r !== null) out.push(r);
  }
  const reached = new Set(order);
  for (const c of candidates) {
    if (reached.has(c.selector)) continue;
    const r = raw(
      'interaction:keyboard-unreachable',
      `Element with ${c.role === null || c.role === undefined ? 'a click handler' : `role "${c.role}"`} cannot be focused, so keyboard users cannot activate it.`,
      c.selector,
      c.snippet,
      [
        trace(['Press Tab through the whole page', 'Element never received focus'], {
          tabStops: order.length,
        }),
      ],
      // Static tabindex test is deterministic for the DOM, but intent is unknown: not reproduced via trace.
      true,
    );
    if (r !== null) out.push(r);
  }
}

async function dialogTests(page: Page, out: RawFinding[]): Promise<number> {
  const triggers = (await page.evaluate(DIALOG_TRIGGERS_SCRIPT)) as Candidate[];
  let attempted = 0;
  for (const t of triggers) {
    attempted++;
    await page.locator(t.selector).first().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const state = (await page.evaluate(DIALOG_STATE_SCRIPT)) as {
      selector: string;
      snippet: string;
      modal: boolean;
      focusInside: boolean;
      focusables: number;
    } | null;
    if (state === null) continue; // did not open; nothing to judge
    const steps = [`Focus ${t.selector}`, 'Press Enter to open the dialog'];
    if (!state.focusInside) {
      const r = raw(
        'interaction:dialog-focus',
        'Focus stayed outside the dialog after it opened.',
        state.selector,
        state.snippet,
        [trace([...steps, 'Check document.activeElement'], { focusInside: false })],
        true,
      );
      if (r !== null) out.push(r);
    } else if (state.modal) {
      for (let i = 0; i < Math.min(state.focusables + 2, 12); i++) await page.keyboard.press('Tab');
      const after = (await page.evaluate(DIALOG_STATE_SCRIPT)) as { focusInside: boolean } | null;
      if (after !== null && !after.focusInside) {
        const r = raw(
          'interaction:dialog-focus',
          'Modal dialog does not keep Tab focus inside it.',
          state.selector,
          state.snippet,
          [trace([...steps, 'Tab past the last control'], { focusEscaped: true })],
          true,
        );
        if (r !== null) out.push(r);
      }
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const still = (await page.evaluate(DIALOG_STATE_SCRIPT)) as {
      selector: string;
      snippet: string;
    } | null;
    if (still !== null) {
      const r = raw(
        'interaction:dialog-escape',
        'Dialog is still open after pressing Escape.',
        still.selector,
        still.snippet,
        [trace([...steps, 'Press Escape'], { stillOpen: true })],
        true,
      );
      if (r !== null) out.push(r);
    } else {
      const back = await activeSelector(page);
      if (back !== t.selector) {
        const r = raw(
          'interaction:dialog-focus-return',
          'Focus did not return to the control that opened the dialog.',
          t.selector,
          t.snippet,
          [trace([...steps, 'Press Escape'], { expected: t.selector, actual: back })],
          true,
        );
        if (r !== null) out.push(r);
      }
    }
  }
  return attempted;
}

async function disclosureTests(page: Page, out: RawFinding[]): Promise<number> {
  const triggers = (await page.evaluate(DISCLOSURE_TRIGGERS_SCRIPT)) as Candidate[];
  let attempted = 0;
  for (const t of triggers) {
    attempted++;
    const arg = { selector: t.selector, targetSelector: t.targetSelector ?? null };
    const before = (await page.evaluate(callFn(ATTRS_FN, arg))) as {
      expanded: string | null;
      targetVisible: boolean | null;
    } | null;
    await page.locator(t.selector).first().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const after = (await page.evaluate(callFn(ATTRS_FN, arg))) as {
      expanded: string | null;
      targetVisible: boolean | null;
    } | null;
    if (before === null || after === null) continue;
    const contentChanged =
      before.targetVisible !== null && before.targetVisible !== after.targetVisible;
    const stateChanged = before.expanded !== after.expanded;
    if (contentChanged && !stateChanged) {
      const r = raw(
        'interaction:disclosure-state',
        'Activating the control changed the content but aria-expanded stayed the same.',
        t.selector,
        t.snippet,
        [trace([`Focus ${t.selector}`, 'Press Enter'], { before, after })],
        true,
      );
      if (r !== null) out.push(r);
    }
  }
  return attempted;
}

async function menuTests(page: Page, out: RawFinding[]): Promise<number> {
  const triggers = (await page.evaluate(MENU_TRIGGERS_SCRIPT)) as Candidate[];
  let attempted = 0;
  for (const t of triggers) {
    attempted++;
    const arg = { selector: t.selector, targetSelector: null };
    await page.locator(t.selector).first().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const after = (await page.evaluate(callFn(ATTRS_FN, arg))) as {
      expanded: string | null;
    } | null;
    if (after !== null && after.expanded === null) {
      const r = raw(
        'interaction:menu-keyboard',
        'Control with aria-haspopup does not expose aria-expanded.',
        t.selector,
        t.snippet,
        [trace([`Focus ${t.selector}`, 'Press Enter'], { expanded: null })],
        true,
      );
      if (r !== null) out.push(r);
    }
    await page.keyboard.press('Escape');
  }
  return attempted;
}

async function tabTests(page: Page, out: RawFinding[]): Promise<number> {
  const groups = (await page.evaluate(TABS_SCRIPT)) as {
    list: string;
    tab: string;
    snippet: string;
    panelId: string | null;
  }[];
  let attempted = 0;
  for (const g of groups) {
    attempted++;
    await page.locator(g.tab).first().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const after = (await page.evaluate(
      callFn(ATTRS_FN, { selector: g.tab, targetSelector: null }),
    )) as {
      selected: string | null;
    } | null;
    const panel = (await page.evaluate(callFn(PANEL_VISIBLE_FN, g.panelId))) as boolean | null;
    if (after !== null && after.selected !== 'true') {
      const r = raw(
        'interaction:tab-pattern',
        'Activating a tab with the keyboard did not set aria-selected="true".',
        g.tab,
        g.snippet,
        [
          trace([`Focus ${g.tab}`, 'Press Enter'], {
            ariaSelected: after.selected,
            panelVisible: panel,
          }),
        ],
        true,
      );
      if (r !== null) out.push(r);
    }
  }
  return attempted;
}

/** Dynamic content: do on-page text changes after a keyboard activation land in a live region? */
async function dynamicTests(page: Page, out: RawFinding[]): Promise<number> {
  const buttons = (await page.evaluate(`(() => {
    const a = window.__aa; const out = [];
    for (const el of document.querySelectorAll('button:not([type=submit]),[role=button]')) {
      if (!a.visible(el) || el.disabled || el.closest('form') || el.hasAttribute('aria-expanded') || el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-controls')) continue;
      out.push({ selector: a.cssPath(el), snippet: a.snippet(el) });
    }
    return out.slice(0, 3);
  })()`)) as Candidate[];
  let attempted = 0;
  await page.evaluate(OBSERVER_SETUP_SCRIPT);
  for (const b of buttons) {
    attempted++;
    await page.evaluate(OBSERVER_READ_SCRIPT);
    await page.locator(b.selector).first().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const muts = (await page.evaluate(OBSERVER_READ_SCRIPT)) as {
      selector: string;
      snippet: string;
      live: boolean;
      text: string;
    }[];
    const silent = muts.filter((m) => !m.live && m.text.length > 2);
    const hasLive = muts.some((m) => m.live);
    const first = silent[0];
    if (first !== undefined && !hasLive) {
      const r = raw(
        'interaction:dynamic-status',
        `Text appeared after activating the button but no live region announces it: "${first.text}".`,
        first.selector,
        first.snippet,
        [
          trace([`Focus ${b.selector}`, 'Press Enter', 'Observe DOM changes'], {
            changes: silent.slice(0, 3),
          }),
        ],
        false,
      );
      if (r !== null) out.push(r);
    }
  }
  return attempted;
}

/**
 * Required fields: the page is never submitted. We only check that errors the page already shows
 * (aria-invalid) are associated. See STATIC_CHECKS_SCRIPT for that detection; no action is taken here.
 */
export async function runInteractionTests(
  page: Page,
  maxInteractions: number,
): Promise<InteractionResult> {
  const raws: RawFinding[] = [];
  const skipped: string[] = [];
  let attempted = 0;
  await page.evaluate('window.scrollTo(0, 0)');
  const steps: [string, () => Promise<number>][] = [
    [
      'keyboard',
      async () => {
        await keyboardTraversal(page, raws);
        return 1;
      },
    ],
    ['dialog', () => dialogTests(page, raws)],
    ['disclosure', () => disclosureTests(page, raws)],
    ['menu', () => menuTests(page, raws)],
    ['tabs', () => tabTests(page, raws)],
    ['dynamic', () => dynamicTests(page, raws)],
  ];
  for (const [name, fn] of steps) {
    if (attempted >= maxInteractions) {
      skipped.push(`${name}: interaction budget reached`);
      continue;
    }
    try {
      const n = await fn();
      attempted += n;
    } catch (err) {
      skipped.push(
        `${name}: ${err instanceof Error ? (err.message.split('\n')[0] ?? 'error') : 'error'}`,
      );
    }
  }
  return { raws, attempted, skipped };
}
