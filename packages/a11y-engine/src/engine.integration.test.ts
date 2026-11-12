import http from 'node:http';
import net from 'node:net';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  launchSafeBrowser,
  openScanContext,
  safeGoto,
  startEgressProxy,
  type EgressProxy,
} from '@accessaudit/crawler';
import { analyzePage, type AnalyzeResult } from './index.js';
import { ACCESSIBLE, INACCESSIBLE, type Fixture } from './fixtures.js';

const PUBLIC_IP = '93.184.216.34';
const ALL = [...INACCESSIBLE, ...ACCESSIBLE];

describe('engine against controlled fixtures (real Chrome, safe browser layer)', () => {
  let server: http.Server;
  let proxy: EgressProxy;
  let browser: Browser;
  const results = new Map<string, AnalyzeResult>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const name = (req.url ?? '/').replace(/^\//, '').split('?')[0] ?? '';
      const f = ALL.find((x) => x.name === name);
      if (f === undefined) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(f.html);
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as net.AddressInfo).port;
    proxy = await startEgressProxy({
      resolve: () => Promise.resolve([PUBLIC_IP]),
      dial: () => net.connect({ host: '127.0.0.1', port }),
    });
    browser = await launchSafeBrowser({ proxyUrl: proxy.url, channel: 'chrome' });
    for (const f of ALL) {
      const sc = await openScanContext(browser);
      try {
        const p = await sc.context.newPage();
        const url = `http://fx.example.com/${f.name}`;
        const r = await safeGoto(p, url);
        if (!r.ok) throw new Error(`${f.name}: ${r.reason}`);
        results.set(
          f.name,
          await analyzePage(p, url, { wcagVersion: '2.2', level: 'AA', interactionTests: true }),
        );
      } finally {
        await sc.close();
      }
    }
  }, 300_000);

  afterAll(async () => {
    server.closeAllConnections();
    await browser.close();
    await proxy.close();
    await new Promise<void>((ok) => {
      server.close(() => {
        ok();
      });
    });
  }, 60_000);

  const reported = (f: Fixture) =>
    (results.get(f.name)?.findings ?? []).filter(
      (x) =>
        x.classification === 'confirmed' ||
        x.classification === 'strong_potential' ||
        x.ruleId.startsWith('manual:'),
    );

  it('detects planted defects; precision and recall are measured and printed', () => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const misses: string[] = [];
    const extras: string[] = [];
    for (const f of ALL) {
      const found = new Set(reported(f).map((x) => x.ruleId));
      for (const r of f.expect) {
        if (found.has(r)) tp++;
        else {
          fn++;
          misses.push(`${f.name}: missing ${r} (got ${[...found].join(',') || 'nothing'})`);
        }
      }
      for (const id of found) {
        if (!f.expect.includes(id) && !f.allow.includes(id)) {
          fp++;
          extras.push(`${f.name}: unexpected ${id}`);
        }
      }
    }
    // eslint-disable-next-line no-console -- measured precision/recall is reported on purpose
    console.log(
      `ENGINE METRICS tp=${String(tp)} fp=${String(fp)} fn=${String(fn)} precision=${(tp / (tp + fp)).toFixed(3)} recall=${(tp / (tp + fn)).toFixed(3)}\n${misses.join('\n')}\n${extras.join('\n')}`,
    );
    expect(misses).toEqual([]);
    expect(extras).toEqual([]);
  });

  it('accessible pages produce no confirmed or potential findings', () => {
    for (const f of ACCESSIBLE) {
      const bad = (results.get(f.name)?.findings ?? []).filter(
        (x) => x.classification === 'confirmed' || x.classification === 'strong_potential',
      );
      expect(
        bad.map((b) => `${b.ruleId} ${b.selector ?? ''}`),
        f.name,
      ).toEqual([]);
    }
  });

  it('every finding carries real evidence and a fingerprint', () => {
    for (const r of results.values()) {
      for (const f of r.findings) {
        expect(f.evidence.length).toBeGreaterThan(0);
        expect(f.fingerprint).toMatch(/^[0-9a-f]{32}$/);
      }
    }
  });

  it('confirmed findings are deterministic axe results or reproduced interactions', () => {
    for (const r of results.values()) {
      for (const f of r.findings.filter((x) => x.classification === 'confirmed')) {
        const ok =
          f.ruleId.startsWith('axe:') ||
          f.evidence.some((e) => e.kind === 'interaction_trace') ||
          f.ruleId.startsWith('custom:');
        expect(ok, f.ruleId).toBe(true);
      }
    }
  });
});
