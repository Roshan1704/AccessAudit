import { checkUrl, type UrlPolicyOptions } from '@accessaudit/security';
import type { RobotsPolicy } from './robots.js';

export type CrawlOutcome =
  | { url: string; depth: number; status: 'scanned'; finalUrl?: string }
  | { url: string; depth: number; status: 'failed'; reason: string }
  | { url: string; depth: number; status: 'skipped'; reason: 'excluded_by_robots' | 'page_cap' };

export interface VisitResult {
  ok: boolean;
  /** Failure reason when `ok` is false. */
  reason?: string;
  /** URL after redirects; its origin must still match the start origin. */
  finalUrl?: string;
  /** Absolute or relative hrefs found on the page. */
  links: string[];
}

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  maxDepth?: number;
  robots: RobotsPolicy;
  /** Loads a page, runs the per-page work and returns its links. */
  visit: (url: string, depth: number) => Promise<VisitResult>;
  policy?: UrlPolicyOptions;
  /** Sleep hook, injectable for tests. Used to honour Crawl-delay. */
  sleep?: (ms: number) => Promise<void>;
  /** Stop early when this returns true (scan cancelled). */
  shouldStop?: () => boolean | Promise<boolean>;
}

const SKIP_EXT =
  /\.(?:pdf|zip|gz|tgz|rar|7z|exe|dmg|msi|iso|png|jpe?g|gif|webp|avif|svg|ico|mp[34]|webm|mov|avi|wav|woff2?|ttf|otf|css|js|json|xml|csv|docx?|xlsx?|pptx?)$/i;

/** Never followed: visiting a sign-out link would end an authenticated scan's session (ADR-031). */
const SKIP_PATH = /(?:log-?out|sign-?out|log-?off|sign-?off)/i;

/** Canonical form used for de-duplication: no fragment, no default port, no trailing-slash noise. */
export function normalizeUrl(href: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.username = '';
  u.password = '';
  if (u.pathname === '') u.pathname = '/';
  return u.toString();
}

/**
 * Bounded breadth-first crawl of a single origin. Links to other origins, non-page files and URLs
 * that fail the URL policy are never visited. robots.txt exclusions are recorded, never silently
 * dropped (ADR-018).
 */
export async function crawlSite(opts: CrawlOptions): Promise<CrawlOutcome[]> {
  const start = normalizeUrl(opts.startUrl, opts.startUrl);
  if (start === null) return [];
  const origin = new URL(start).origin;
  const maxDepth = opts.maxDepth ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const delayMs = Math.min(opts.robots.crawlDelaySeconds, 10) * 1000;

  const seen = new Set<string>([start]);
  const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
  const out: CrawlOutcome[] = [];
  let visited = 0;

  for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
    if (opts.shouldStop !== undefined && (await opts.shouldStop())) break;
    const { url, depth } = item;
    const parsed = new URL(url);
    if (!opts.robots.isAllowed(`${parsed.pathname}${parsed.search}`)) {
      out.push({ url, depth, status: 'skipped', reason: 'excluded_by_robots' });
      continue;
    }
    if (visited >= opts.maxPages) {
      out.push({ url, depth, status: 'skipped', reason: 'page_cap' });
      continue;
    }
    if (visited > 0 && delayMs > 0) await sleep(delayMs);
    visited++;

    let result: VisitResult;
    try {
      result = await opts.visit(url, depth);
    } catch {
      out.push({ url, depth, status: 'failed', reason: 'visit_error' });
      continue;
    }
    if (!result.ok) {
      out.push({ url, depth, status: 'failed', reason: result.reason ?? 'unknown' });
      continue;
    }
    const finalUrl = result.finalUrl ?? url;
    if (new URL(finalUrl).origin !== origin) {
      out.push({ url, depth, status: 'failed', reason: 'redirected_off_origin' });
      continue;
    }
    out.push({ url, depth, status: 'scanned', ...(finalUrl !== url ? { finalUrl } : {}) });
    if (depth >= maxDepth) continue;

    for (const href of result.links) {
      const next = normalizeUrl(href, finalUrl);
      if (next === null || seen.has(next)) continue;
      const nu = new URL(next);
      if (nu.origin !== origin || SKIP_EXT.test(nu.pathname) || SKIP_PATH.test(nu.pathname))
        continue;
      if (!checkUrl(next, opts.policy).ok) continue;
      seen.add(next);
      queue.push({ url: next, depth: depth + 1 });
    }
  }
  return out;
}
