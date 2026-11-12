/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- in-page scripts are strings, so the result shape is asserted here */
import type { Page } from 'playwright-core';
import { runAxe } from './axe-runner.js';
import { runFocusIndicatorCheck, runReflowCheck, runStaticChecks } from './custom-checks.js';
import { runInteractionTests } from './interaction.js';
import { DOM_FACTS_SCRIPT, HELPERS_SCRIPT } from './page-scripts.js';
import { getRule, ruleApplies } from './registry.js';
import { manualTasksFor, processFindings } from './pipeline.js';
import type { AnalyzeOptions, Evidence, Finding, PageAnalysis, RawFinding } from './types.js';

const MAX_SCREENSHOT_BYTES = 200_000;

export interface DomFacts {
  title: string;
  lang: string | null;
  elements: number;
  headings: number;
  landmarks: number;
  links: number;
  forms: number;
  formControls: number;
  images: number;
  focusable: number;
  [k: string]: unknown;
}

export interface AnalyzeResult extends PageAnalysis {
  dom: DomFacts;
}

async function screenshotFor(page: Page, selector: string): Promise<Evidence | null> {
  if (selector.includes('>>>')) return null;
  try {
    const loc = page.locator(selector).first();
    await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
    const buf = await loc.screenshot({ timeout: 2500, type: 'png' });
    if (buf.length > MAX_SCREENSHOT_BYTES) return null;
    return {
      kind: 'screenshot',
      content: { selector, bytes: buf.length },
      blobBase64: buf.toString('base64'),
      contentType: 'image/png',
    };
  } catch {
    return null;
  }
}

/**
 * Analyse one already-loaded page. The caller owns navigation and the safe browser context; this
 * function only observes the page. Order matters: passive checks first, interactions last, because
 * interactions can change page state.
 */
export async function analyzePage(
  page: Page,
  url: string,
  opts: AnalyzeOptions,
): Promise<AnalyzeResult> {
  await page.evaluate(HELPERS_SCRIPT);
  const dom = (await page.evaluate(DOM_FACTS_SCRIPT)) as DomFacts;

  const raws: RawFinding[] = [];
  const axeOut = await runAxe(page, opts);
  raws.push(...axeOut.raws);
  raws.push(...(await runStaticChecks(page)));
  raws.push(...(await runReflowCheck(page)));

  let interactionsAttempted = 0;
  let interactionsSkipped: string[] = [];
  const maxInteractions = opts.maxInteractions ?? 12;
  if (opts.interactionTests) {
    raws.push(...(await runFocusIndicatorCheck(page, 80)));
    const r = await runInteractionTests(page, maxInteractions);
    raws.push(...r.raws);
    interactionsAttempted = r.attempted;
    interactionsSkipped = r.skipped;
  } else {
    interactionsSkipped = ['interaction tests are off for this scan'];
  }

  // Keep only findings whose rule applies to the chosen WCAG version and level.
  const { findings, rejected } = processFindings(raws, url);
  const applicable = findings.filter((f) => {
    const rule = getRule(f.ruleId);
    if (rule === undefined) return false;
    if (rule.reliability === 'manual') return true;
    return ruleApplies(rule, opts);
  });

  // Screenshots for the strongest findings only, bounded.
  const budget = opts.maxScreenshots ?? 10;
  let shots = 0;
  const withShots: Finding[] = [];
  for (const f of applicable) {
    if (shots < budget && f.selector !== null && f.classification !== 'informational') {
      const s = await screenshotFor(page, f.selector);
      if (s !== null) {
        shots++;
        withShots.push({
          ...f,
          evidence: [...f.evidence, s].slice(0, 7),
          confidence: Math.min(100, f.confidence + 2),
        });
        continue;
      }
    }
    withShots.push(f);
  }

  return {
    findings: withShots,
    manualTasks: manualTasksFor(withShots),
    rejected,
    passedRules: axeOut.passedRules,
    coverage: {
      axe: true,
      custom: true,
      interaction: opts.interactionTests,
      interactionsAttempted,
      interactionsSkipped,
    },
    dom,
  };
}
