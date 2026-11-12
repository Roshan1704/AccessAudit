/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- in-page scripts are strings, so the result shape is asserted here */
import axe from 'axe-core';
import type { Page } from 'playwright-core';
import { HELPERS_SCRIPT, ENRICH_FN, callFn } from './page-scripts.js';
import { axeRuleIdsFor, getRule } from './registry.js';
import { severityFromImpact } from './severity.js';
import type { AnalyzeOptions, Evidence, RawFinding } from './types.js';

interface EnrichEntry {
  style: Record<string, unknown>;
  accessibleName: { name: string; source: string };
  role: string | null;
  tag: string;
}

export interface AxeOutcome {
  raws: RawFinding[];
  passedRules: number;
  ruleCount: number;
}

function targetToSelector(target: unknown): string | null {
  if (!Array.isArray(target) || target.length === 0) return null;
  const parts = target.map((t) =>
    typeof t === 'string' ? t : Array.isArray(t) ? t.join(' ') : '',
  );
  const joined = parts.filter((p) => p !== '').join(' >>> ');
  return joined === '' ? null : joined;
}

/**
 * Run axe-core inside the page. Mapping rules:
 * - violation of a deterministic rule  -> confirmed
 * - violation of a heuristic rule      -> strong_potential
 * - incomplete ("needs review")        -> manual_verification (never confirmed)
 * - passes                             -> counted only
 */
export async function runAxe(page: Page, opts: AnalyzeOptions): Promise<AxeOutcome> {
  const ids = axeRuleIdsFor(opts);
  await page.evaluate(HELPERS_SCRIPT);
  await page.evaluate(axe.source);
  const results = await page.evaluate(async (values: string[]) => {
    const w = globalThis as unknown as {
      axe: { run: (ctx: unknown, o: unknown) => Promise<unknown> };
      document: unknown;
    };
    return await w.axe.run(w.document, {
      runOnly: { type: 'rule', values },
      resultTypes: ['violations', 'incomplete'],
      elementRef: false,
      selectors: true,
    });
  }, ids);
  const r = results as {
    violations: axe.Result[];
    incomplete: axe.Result[];
    passes?: axe.Result[];
  };

  const raws: RawFinding[] = [];
  const selectors: string[] = [];
  const pending: { raw: RawFinding; selector: string | null }[] = [];

  const add = (res: axe.Result, kind: 'violation' | 'incomplete'): void => {
    const rule = getRule(`axe:${res.id}`);
    if (rule === undefined) return;
    for (const node of res.nodes) {
      const selector = targetToSelector(node.target);
      const checks = [...node.any, ...node.all, ...node.none];
      const evidence: Evidence[] = [
        { kind: 'html_snippet', content: { html: node.html } },
        {
          kind: 'check_data',
          content: {
            axeRule: res.id,
            impact: node.impact ?? res.impact ?? null,
            failureSummary: node.failureSummary ?? null,
            checks: checks.map((c) => ({ id: c.id, message: c.message, data: c.data as unknown })),
          },
        },
      ];
      if (selector !== null) {
        evidence.push({ kind: 'selector', content: { selector } });
        if (!selector.includes('>>>')) selectors.push(selector);
      }
      const raw: RawFinding = {
        ruleId: rule.id,
        message: res.help,
        selector,
        classification:
          kind === 'incomplete'
            ? 'manual_verification'
            : rule.reliability === 'deterministic'
              ? 'confirmed'
              : 'strong_potential',
        severity: severityFromImpact(node.impact ?? res.impact),
        evidence,
      };
      pending.push({ raw, selector });
      raws.push(raw);
    }
  };
  for (const v of r.violations) add(v, 'violation');
  for (const v of r.incomplete) add(v, 'incomplete');

  // Computed style and accessible name evidence for the elements axe flagged.
  const unique = [...new Set(selectors)].slice(0, 200);
  if (unique.length > 0) {
    let enrich: Record<string, EnrichEntry> = {};
    try {
      enrich = (await page.evaluate(callFn(ENRICH_FN, unique))) as Record<string, EnrichEntry>;
    } catch {
      enrich = {};
    }
    for (const p of pending) {
      const e = p.selector === null ? undefined : enrich[p.selector];
      if (e === undefined) continue;
      p.raw.evidence.push({ kind: 'computed_style', content: e.style });
      p.raw.evidence.push({
        kind: 'accessible_name',
        content: {
          name: e.accessibleName.name,
          source: e.accessibleName.source,
          role: e.role,
          tag: e.tag,
        },
      });
    }
  }

  const passedRules = Math.max(
    0,
    ids.length - new Set([...r.violations, ...r.incomplete].map((x) => x.id)).size,
  );
  return { raws, passedRules, ruleCount: ids.length };
}
