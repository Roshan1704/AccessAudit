import { checkUrl, type UrlPolicyOptions } from '@accessaudit/security';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

export interface LaunchOptions {
  /** Egress proxy URL. All browser traffic is forced through it; there is no direct route. */
  proxyUrl: string;
  /** Use an installed browser channel such as `chrome`. Defaults to the bundled Chromium. */
  channel?: string;
  executablePath?: string;
  headless?: boolean;
  /** Test-only: `--no-sandbox` is for CI containers without user namespaces. Never in production (T-BRW-01). */
  noSandbox?: boolean;
}

export interface ScanLimits {
  /** Per-page navigation timeout. */
  pageTimeoutMs: number;
  /** Maximum DOM elements allowed on a page before it is rejected (T-BRW-03). */
  maxDomNodes: number;
  /** Maximum redirects followed for one navigation (T-SSRF-03). */
  maxRedirects: number;
  /** Maximum subresource requests per page load. */
  maxRequests: number;
}

export const DEFAULT_LIMITS: ScanLimits = {
  pageTimeoutMs: 30_000,
  maxDomNodes: 50_000,
  maxRedirects: 5,
  maxRequests: 500,
};

export interface BlockedRequest {
  url: string;
  reason: string;
}

export interface ScanContext {
  context: BrowserContext;
  /** Requests the guard refused, with reasons. */
  blocked: readonly BlockedRequest[];
  /** Downloads the page tried to start (always discarded). */
  downloadsAttempted: number;
  popupsBlocked: number;
  close: () => Promise<void>;
}

export async function launchSafeBrowser(opts: LaunchOptions): Promise<Browser> {
  const args = [
    `--proxy-server=${opts.proxyUrl}`,
    // Chromium bypasses the proxy for loopback by default; remove that bypass so loopback goes through the guard too.
    '--proxy-bypass-list=<-loopback>',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-first-run',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  ];
  if (opts.noSandbox === true) args.push('--no-sandbox');
  return chromium.launch({
    headless: opts.headless ?? true,
    ...(opts.channel !== undefined ? { channel: opts.channel } : {}),
    ...(opts.executablePath !== undefined ? { executablePath: opts.executablePath } : {}),
    // Proxy is set via args only: Playwright's own `proxy` option adds a loopback bypass.
    args,
  });
}

export interface ScanContextOptions {
  limits?: Partial<ScanLimits>;
  policy?: UrlPolicyOptions;
  userAgent?: string;
  viewport?: { width: number; height: number };
  /** Session obtained by a form login; held in memory only, never persisted (ADR-031). */
  storageState?: StorageState;
  /** Login phase only: permits state-changing requests to this origin so the login form can post. */
  allowMutationsToOrigin?: string;
}

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export interface FormLogin {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  /** Present only when the user is signed in; its appearance verifies the login. */
  successSelector: string;
  username: string;
  password: string;
}

export type LoginResult = { ok: true; storageState: StorageState } | { ok: false; reason: string };

/**
 * Signs in through a form in its own isolated context and returns the resulting session. The only
 * relaxation of the read-only policy is a POST to the login origin during this call (ADR-031).
 * Failure reasons are fixed strings; they never include page content or the credentials.
 */
export async function loginWithForm(
  browser: Browser,
  login: FormLogin,
  opts: Pick<ScanContextOptions, 'limits' | 'policy' | 'userAgent'> = {},
): Promise<LoginResult> {
  const pre = checkUrl(login.loginUrl, opts.policy);
  if (!pre.ok) return { ok: false, reason: pre.reason };
  const sc = await openScanContext(browser, { ...opts, allowMutationsToOrigin: pre.url.origin });
  try {
    const page = await sc.context.newPage();
    const nav = await safeGoto(page, login.loginUrl, opts.limits, opts.policy);
    if (!nav.ok) return { ok: false, reason: 'login_page_unreachable' };
    await page.fill(login.usernameSelector, login.username);
    await page.fill(login.passwordSelector, login.password);
    await page.click(login.submitSelector);
    // A rejected login never shows the success element; fail after 10 s, not the full page timeout.
    const verifyMs = Math.min({ ...DEFAULT_LIMITS, ...opts.limits }.pageTimeoutMs, 10_000);
    await page.waitForSelector(login.successSelector, { state: 'attached', timeout: verifyMs });
    return { ok: true, storageState: await sc.context.storageState() };
  } catch {
    return { ok: false, reason: 'login_not_verified' };
  } finally {
    await sc.close().catch(() => undefined);
  }
}

/**
 * One isolated BrowserContext per (scan, profile) (T-BRW-02). Downloads and permissions are denied
 * (T-BRW-04), service workers blocked, popups closed, and every request (navigation, redirect hop and
 * subresource) is revalidated against the URL policy before it leaves the browser (T-SSRF-03..05).
 * The egress proxy is the independent second layer.
 */
export async function openScanContext(
  browser: Browser,
  opts: ScanContextOptions = {},
): Promise<ScanContext> {
  const limits: ScanLimits = { ...DEFAULT_LIMITS, ...opts.limits };
  const blocked: BlockedRequest[] = [];
  const state = { downloadsAttempted: 0, popupsBlocked: 0, requests: 0 };

  const context = await browser.newContext({
    acceptDownloads: false,
    permissions: [],
    serviceWorkers: 'block',
    bypassCSP: false,
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
    viewport: opts.viewport ?? { width: 1280, height: 800 },
    ...(opts.storageState !== undefined ? { storageState: opts.storageState } : {}),
    ...(opts.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
  });
  context.setDefaultNavigationTimeout(limits.pageTimeoutMs);
  context.setDefaultTimeout(limits.pageTimeoutMs);

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const deny = async (reason: string): Promise<void> => {
      blocked.push({ url, reason });
      await route.abort('blockedbyclient');
    };

    let hops = 0;
    for (let r = request.redirectedFrom(); r !== null; r = r.redirectedFrom()) hops++;
    if (hops > limits.maxRedirects) return deny('too_many_redirects');

    if (++state.requests > limits.maxRequests) return deny('too_many_requests');

    const check = checkUrl(url, opts.policy);
    if (!check.ok) return deny(check.reason);

    const method = request.method();
    if (
      method !== 'GET' &&
      method !== 'HEAD' &&
      method !== 'OPTIONS' &&
      new URL(url).origin !== opts.allowMutationsToOrigin
    ) {
      // Read-only policy: page scripts may not mutate remote state during a scan.
      return deny('non_get_blocked');
    }
    await route.continue();
  });

  context.on('page', (page) => {
    page.on('download', (d) => {
      state.downloadsAttempted++;
      void d.cancel().catch(() => undefined);
    });
    page.on('filechooser', () => undefined);
    page.on('dialog', (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });
    void page.opener().then((opener) => {
      if (opener !== null) {
        state.popupsBlocked++;
        void page.close().catch(() => undefined);
      }
    });
  });

  return {
    context,
    blocked,
    get downloadsAttempted() {
      return state.downloadsAttempted;
    },
    get popupsBlocked() {
      return state.popupsBlocked;
    },
    close: () => context.close(),
  };
}

export type GotoResult =
  { ok: true; status: number; finalUrl: string; domNodes: number } | { ok: false; reason: string };

/** Navigate with pre-validation, a DOM size cap and a final-URL recheck. */
export async function safeGoto(
  page: Page,
  url: string,
  limits: Partial<ScanLimits> = {},
  policy?: UrlPolicyOptions,
): Promise<GotoResult> {
  const l: ScanLimits = { ...DEFAULT_LIMITS, ...limits };
  const pre = checkUrl(url, policy);
  if (!pre.ok) return { ok: false, reason: pre.reason };
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'load', timeout: l.pageTimeoutMs });
  } catch {
    return { ok: false, reason: 'navigation_failed' };
  }
  const finalUrl = page.url();
  const post = checkUrl(finalUrl, policy);
  if (!post.ok) return { ok: false, reason: post.reason };
  const domNodes = await page.evaluate<number>('document.getElementsByTagName("*").length');
  if (domNodes > l.maxDomNodes) return { ok: false, reason: 'dom_too_large' };
  return { ok: true, status: response?.status() ?? 0, finalUrl, domNodes };
}
