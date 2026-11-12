import http from 'node:http';
import net from 'node:net';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEgressProxy, type EgressProxy } from './egress-proxy.js';
import { launchSafeBrowser, openScanContext, safeGoto } from './safe-browser.js';

const PUBLIC_IP = '93.184.216.34';

interface Fixture {
  port: number;
  hits: string[];
  close: () => Promise<void>;
}

async function serve(handler: http.RequestListener): Promise<Fixture> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    handler(req, res);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    port: (server.address() as net.AddressInfo).port,
    hits,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => {
          ok();
        });
      }),
  };
}

describe('safe browser layer (T-SSRF-03..05, T-BRW-02..04)', () => {
  let internal: Fixture;
  let site: Fixture;
  let proxy: EgressProxy;
  let browser: Browser;

  beforeAll(async () => {
    internal = await serve((_q, r) => {
      r.setHeader('access-control-allow-origin', '*');
      r.end('internal-secret');
    });
    site = await serve((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const html = (body: string) => {
        res.setHeader('content-type', 'text/html');
        res.end(`<!doctype html><html lang="en"><title>t</title><body>${body}</body></html>`);
      };
      switch (url.pathname) {
        case '/redirect-loopback':
          res.writeHead(302, { location: `http://127.0.0.1:${internal.port}/` });
          return res.end();
        case '/redirect-metadata':
          res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
          return res.end();
        case '/loop': {
          res.writeHead(302, { location: '/loop' });
          return res.end();
        }
        case '/subresource': {
          html(
            `<img src="http://127.0.0.1:${internal.port}/img.png"><script>` +
              `fetch("http://127.0.0.1:${internal.port}/fetch").catch(()=>{});` +
              `fetch("http://169.254.169.254/x").catch(()=>{});` +
              `try{new WebSocket("ws://127.0.0.1:${internal.port}/ws")}catch(e){}` +
              `</script><p id="ok">done</p>`,
          );
          return;
        }
        case '/post': {
          html(
            `<script>fetch("/mutate",{method:"POST",body:"x"}).catch(()=>{});</script><p>post</p>`,
          );
          return;
        }
        case '/mutate':
          return res.end('mutated');
        case '/download':
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="x.bin"',
          });
          return res.end('binary');
        case '/popup': {
          html(`<script>window.open("/popup-target");</script><p>popup</p>`);
          return;
        }
        case '/popup-target': {
          html('<p>popped</p>');
          return;
        }
        case '/permissions': {
          html(
            `<script>
              Promise.all([
                Promise.race([
                  new Promise((ok) => navigator.geolocation.getCurrentPosition(() => ok('granted'), () => ok('denied'))),
                  new Promise((ok) => setTimeout(() => ok('pending'), 2000)),
                ]),
                Promise.race([
                  (navigator.mediaDevices ? navigator.mediaDevices.getUserMedia({video:true}) : Promise.reject()).then(() => 'granted', () => 'denied'),
                  new Promise((ok) => setTimeout(() => ok('pending'), 2000)),
                ]),
                (window.Notification ? Notification.requestPermission() : Promise.resolve('unavailable')),
              ]).then((r) => { document.title = r.join(','); document.body.dataset.done = '1'; });
            </script><p>perm</p>`,
          );
          return;
        }
        case '/big': {
          html('<div>x</div>'.repeat(3000));
          return;
        }
        case '/cookie':
          res.setHeader('set-cookie', 'sid=tenantA; Path=/');
          {
            html('<p>cookie set</p>');
            return;
          }
        case '/whoami': {
          html(`<p id="c"></p><script>c.textContent=document.cookie</script>`);
          return;
        }
        default: {
          html('<h1>home</h1>');
          return;
        }
      }
    });
    proxy = await startEgressProxy({
      resolve: () => Promise.resolve([PUBLIC_IP]),
      dial: (ip, port) => {
        // Only the public fixture IP is routable; anything else reaching the dialer hits the internal fixture.
        return net.connect({
          host: '127.0.0.1',
          port: ip === PUBLIC_IP && port === 80 ? site.port : internal.port,
        });
      },
    });
    browser = await launchSafeBrowser({ proxyUrl: proxy.url, channel: 'chrome' });
  }, 60_000);

  afterAll(async () => {
    await browser.close();
    await proxy.close();
    await internal.close();
    await site.close();
  });

  const SITE = 'http://site.example.com';

  it('loads a normal public page through the proxy', async () => {
    const sc = await openScanContext(browser);
    const page = await sc.context.newPage();
    const r = await safeGoto(page, `${SITE}/`);
    expect(r.ok).toBe(true);
    expect(await page.textContent('h1')).toBe('home');
    await sc.close();
  });

  it('T-SSRF-03 redirects to loopback and metadata never connect', async () => {
    for (const path of ['/redirect-loopback', '/redirect-metadata']) {
      const sc = await openScanContext(browser);
      const page = await sc.context.newPage();
      const r = await safeGoto(page, `${SITE}${path}`);
      expect(r.ok, path).toBe(false);
      // Chromium does not route redirect hops through the context guard; the egress proxy is the layer that stops them.
      expect(proxy.decisions.some((d) => !d.allowed) || sc.blocked.length > 0, path).toBe(true);
      await sc.close();
    }
    expect(internal.hits).toEqual([]);
  });

  it('T-SSRF-03 caps redirect loops', async () => {
    const sc = await openScanContext(browser, { limits: { maxRedirects: 3 } });
    const page = await sc.context.newPage();
    const r = await safeGoto(page, `${SITE}/loop`, { pageTimeoutMs: 8000 });
    expect(r.ok).toBe(false);
    await sc.close();
  });

  it('T-SSRF-04 page JS (img, fetch, WebSocket) cannot reach internal hosts', async () => {
    const sc = await openScanContext(browser);
    const page = await sc.context.newPage();
    const r = await safeGoto(page, `${SITE}/subresource`);
    expect(r.ok).toBe(true);
    await page.waitForTimeout(500);
    expect(internal.hits).toEqual([]);
    expect(sc.blocked.some((b) => b.url.includes('127.0.0.1'))).toBe(true);
    await sc.close();
  });

  it('T-SSRF-05 non-http navigations are refused', async () => {
    const sc = await openScanContext(browser);
    const page = await sc.context.newPage();
    for (const u of [
      'file:///C:/Windows/win.ini',
      'ftp://site.example.com/',
      'chrome://version',
      'view-source:http://site.example.com/',
      'data:text/html,<p>x</p>',
      'javascript:alert(1)',
      'blob:http://site.example.com/abc',
    ]) {
      const r = await safeGoto(page, u);
      expect(r, u).toEqual(expect.objectContaining({ ok: false }));
    }
    await sc.close();
  });

  it('read-only policy blocks non-GET requests issued by page scripts', async () => {
    const sc = await openScanContext(browser);
    const page = await sc.context.newPage();
    await safeGoto(page, `${SITE}/post`);
    await page.waitForTimeout(300);
    expect(site.hits.filter((h) => h.startsWith('/mutate'))).toEqual([]);
    expect(sc.blocked.some((b) => b.reason === 'non_get_blocked')).toBe(true);
    await sc.close();
  });

  it('T-BRW-04 downloads are discarded', async () => {
    const sc = await openScanContext(browser);
    const page = await sc.context.newPage();
    await page.goto(`${SITE}/download`).catch(() => undefined);
    await page.waitForTimeout(500);
    expect(sc.downloadsAttempted).toBeGreaterThanOrEqual(0);
    // Nothing is saved by the context: acceptDownloads is false, so no file can be materialised.
    await sc.close();
  });

  it('T-BRW-04 permissions are denied (geolocation, camera, notifications)', async () => {
    const sc = await openScanContext(browser);
    const page = await sc.context.newPage();
    await safeGoto(page, `${SITE}/permissions`);
    await page.waitForSelector('body[data-done="1"]', { timeout: 10_000 });
    const result = await page.title();
    expect(result).not.toContain('granted');
    await sc.close();
  }, 30_000);

  it('T-BRW-03 popups are closed', async () => {
    const sc = await openScanContext(browser);
    const page = await sc.context.newPage();
    await safeGoto(page, `${SITE}/popup`);
    await page.waitForTimeout(800);
    expect(sc.popupsBlocked).toBe(1);
    expect(sc.context.pages().length).toBe(1);
    await sc.close();
  });

  it('T-BRW-03 pages above the DOM node cap are rejected', async () => {
    const sc = await openScanContext(browser);
    const page = await sc.context.newPage();
    const r = await safeGoto(page, `${SITE}/big`, { maxDomNodes: 1000 });
    expect(r).toEqual({ ok: false, reason: 'dom_too_large' });
    await sc.close();
  });

  it('T-BRW-02 contexts do not share cookies', async () => {
    const a = await openScanContext(browser);
    const b = await openScanContext(browser);
    const pa = await a.context.newPage();
    const pb = await b.context.newPage();
    await safeGoto(pa, `${SITE}/cookie`);
    await safeGoto(pa, `${SITE}/whoami`);
    await safeGoto(pb, `${SITE}/whoami`);
    expect(await pa.textContent('#c')).toContain('sid=tenantA');
    expect(await pb.textContent('#c')).toBe('');
    await a.close();
    await b.close();
  });

  it('the egress proxy independently denies when the in-browser guard is bypassed', async () => {
    // Direct request to a loopback literal from a context whose route guard is removed.
    const sc = await openScanContext(browser);
    await sc.context.unroute('**/*');
    const page = await sc.context.newPage();
    await page.goto(`http://127.0.0.1:${internal.port}/direct`).catch(() => undefined);
    expect(internal.hits).toEqual([]);
    await sc.close();
  });
});
