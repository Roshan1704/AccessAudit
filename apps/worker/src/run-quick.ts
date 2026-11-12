import type { Browser, Page } from 'playwright-core';
import {
  ALLOW_ALL,
  openScanContext,
  parseRobots,
  safeGoto,
  type RobotsPolicy,
} from '@accessaudit/crawler';
import { AXE_VERSION, ENGINE_VERSION, analyzePage, getRule } from '@accessaudit/a11y-engine';
import { checkUrl, type UrlPolicyOptions } from '@accessaudit/security';
import type { QuickFinding, QuickJobPayload, QuickResult } from '@accessaudit/shared';

export interface QuickDeps {
  browser: Browser;
  policy?: UrlPolicyOptions;
  userAgent?: string;
}

const NOTE =
  'Passive check of one page. Keyboard, focus, dialog, form, menu and dynamic-content tests need an account and a verified domain.';

async function loadRobots(
  page: Page,
  origin: string,
  policy?: UrlPolicyOptions,
): Promise<RobotsPolicy> {
  const r = await safeGoto(page, `${origin}/robots.txt`, undefined, policy);
  if (!r.ok || r.status >= 500) return parseRobots('User-agent: *\nDisallow: /');
  if (r.status >= 400) return ALLOW_ALL;
  const text = await page.evaluate<string>('document.body ? document.body.innerText : ""');
  return parseRobots(text);
}

/**
 * Anonymous one-page check. Nothing is written to PostgreSQL. The URL goes through the same SSRF gate
 * again here (the API check is not trusted), robots.txt is honoured, interaction tests never run,
 * and screenshots/blobs are dropped from the result.
 */
export async function runQuick(deps: QuickDeps, payload: QuickJobPayload): Promise<QuickResult> {
  const chk = checkUrl(payload.url, deps.policy);
  if (!chk.ok) return { status: 'blocked', reason: 'url_not_allowed' };
  const url = chk.url;
  const ctxOpts = {
    ...(deps.policy ? { policy: deps.policy } : {}),
    ...(deps.userAgent ? { userAgent: deps.userAgent } : {}),
  };

  const rc = await openScanContext(deps.browser, ctxOpts);
  try {
    const robots = await loadRobots(await rc.context.newPage(), url.origin, deps.policy);
    if (!robots.isAllowed(url.pathname + url.search))
      return { status: 'blocked', reason: 'robots_disallowed' };
  } catch {
    return { status: 'blocked', reason: 'robots_unreadable' };
  } finally {
    await rc.close();
  }

  const sc = await openScanContext(deps.browser, ctxOpts);
  try {
    const page = await sc.context.newPage();
    const nav = await safeGoto(page, url.href, undefined, deps.policy);
    if (!nav.ok) return { status: 'blocked', reason: nav.reason };
    const result = await analyzePage(page, url.href, {
      wcagVersion: '2.2',
      level: 'AA',
      interactionTests: false,
      maxScreenshots: 0,
    });
    const findings: QuickFinding[] = result.findings.map((f) => ({
      ruleId: f.ruleId,
      ruleTitle: getRule(f.ruleId)?.title ?? f.ruleId,
      classification: f.classification,
      confidence: f.confidence,
      severity: f.severity,
      wcagCriteria: f.wcagCriteria,
      message: f.message,
      selector: f.selector,
      occurrences: f.occurrences ?? 1,
      evidence: f.evidence
        .filter((e) => e.blobBase64 === undefined)
        .map((e) => ({ kind: e.kind, content: e.content })),
    }));
    return {
      status: 'done',
      url: url.href,
      finalUrl: nav.finalUrl,
      title: result.dom.title,
      findings,
      manualTasks: result.manualTasks.map((t) => ({
        ruleId: t.ruleId,
        instructions: t.instructions,
      })),
      coverage: { interaction: false, note: NOTE },
      engine: { engine: ENGINE_VERSION, axe: AXE_VERSION },
    };
  } catch {
    return { status: 'blocked', reason: 'analysis_error' };
  } finally {
    await sc.close();
  }
}
