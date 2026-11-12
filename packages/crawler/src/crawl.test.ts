import { describe, expect, it } from 'vitest';
import { crawlSite, normalizeUrl, type VisitResult } from './crawl.js';
import { ALLOW_ALL, parseRobots } from './robots.js';

const noSleep = (): Promise<void> => Promise.resolve();

function site(pages: Record<string, string[]>): (url: string) => Promise<VisitResult> {
  return (url) => {
    const links = pages[new URL(url).pathname];
    return Promise.resolve(
      links === undefined ? { ok: false, reason: 'http_404', links: [] } : { ok: true, links },
    );
  };
}

describe('robots.txt parsing (ADR-018)', () => {
  it('prefers our agent group over *, longest match wins, Allow wins ties', () => {
    const r = parseRobots(
      [
        'User-agent: *',
        'Disallow: /',
        '',
        'User-agent: AccessAuditBot',
        'Disallow: /private/',
        'Allow: /private/public/',
        'Disallow: /tie',
        'Allow: /tie',
        'Crawl-delay: 2',
      ].join('\n'),
    );
    expect(r.isAllowed('/')).toBe(true);
    expect(r.isAllowed('/private/x')).toBe(false);
    expect(r.isAllowed('/private/public/x')).toBe(true);
    expect(r.isAllowed('/tie')).toBe(true);
    expect(r.crawlDelaySeconds).toBe(2);
  });

  it('falls back to * and supports wildcards and $', () => {
    const r = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/cache\nDisallow:\n');
    expect(r.isAllowed('/a.pdf')).toBe(false);
    expect(r.isAllowed('/a.pdf?x=1')).toBe(true);
    expect(r.isAllowed('/tmp1/cache')).toBe(false);
    expect(r.isAllowed('/ok')).toBe(true);
  });

  it('an empty file or no matching group allows everything', () => {
    expect(parseRobots('').isAllowed('/anything')).toBe(true);
    expect(parseRobots('User-agent: otherbot\nDisallow: /').isAllowed('/x')).toBe(true);
  });
});

describe('same-origin crawl', () => {
  it('visits breadth-first, stays on origin, skips files, dedupes', async () => {
    const visited: string[] = [];
    const base = site({
      '/': [
        '/a',
        '/b',
        'https://other.example/x',
        '/file.pdf',
        '/a#frag',
        'mailto:x@y.z',
        'javascript:void(0)',
      ],
      '/a': ['/', '/c'],
      '/b': [],
      '/c': [],
    });
    const out = await crawlSite({
      startUrl: 'https://example.com',
      maxPages: 10,
      robots: ALLOW_ALL,
      sleep: noSleep,
      visit: (u, d) => {
        visited.push(`${new URL(u).pathname}@${String(d)}`);
        return base(u);
      },
    });
    expect(visited).toEqual(['/@0', '/a@1', '/b@1', '/c@2']);
    expect(out.every((o) => o.status === 'scanned')).toBe(true);
  });

  it('enforces the page cap and records the overflow', async () => {
    const out = await crawlSite({
      startUrl: 'https://example.com/',
      maxPages: 2,
      robots: ALLOW_ALL,
      sleep: noSleep,
      visit: site({ '/': ['/a', '/b', '/c'], '/a': [], '/b': [], '/c': [] }),
    });
    expect(out.filter((o) => o.status === 'scanned')).toHaveLength(2);
    expect(out.filter((o) => o.status === 'skipped' && o.reason === 'page_cap')).toHaveLength(2);
  });

  it('records robots exclusions instead of dropping them, and never visits them', async () => {
    const visited: string[] = [];
    const out = await crawlSite({
      startUrl: 'https://example.com/',
      maxPages: 10,
      robots: parseRobots('User-agent: *\nDisallow: /admin'),
      sleep: noSleep,
      visit: (u) => {
        visited.push(new URL(u).pathname);
        return site({ '/': ['/admin/x', '/ok'], '/ok': [] })(u);
      },
    });
    expect(visited).toEqual(['/', '/ok']);
    expect(out).toContainEqual(
      expect.objectContaining({ status: 'skipped', reason: 'excluded_by_robots' }),
    );
  });

  it('fails a page that redirects off origin and does not follow its links', async () => {
    const out = await crawlSite({
      startUrl: 'https://example.com/',
      maxPages: 5,
      robots: ALLOW_ALL,
      sleep: noSleep,
      visit: () => Promise.resolve({ ok: true, finalUrl: 'https://evil.example/', links: ['/a'] }),
    });
    expect(out).toEqual([
      { url: 'https://example.com/', depth: 0, status: 'failed', reason: 'redirected_off_origin' },
    ]);
  });

  it('honours Crawl-delay between pages and caps depth', async () => {
    const sleeps: number[] = [];
    const out = await crawlSite({
      startUrl: 'https://example.com/',
      maxPages: 10,
      maxDepth: 1,
      robots: parseRobots('User-agent: *\nCrawl-delay: 3'),
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      visit: site({ '/': ['/a'], '/a': ['/deep'], '/deep': [] }),
    });
    expect(out.map((o) => new URL(o.url).pathname)).toEqual(['/', '/a']);
    expect(sleeps).toEqual([3000]);
  });

  it('rejects private-network links via the URL policy and stops when cancelled', async () => {
    const visited: string[] = [];
    let stop = false;
    await crawlSite({
      startUrl: 'https://example.com/',
      maxPages: 10,
      robots: ALLOW_ALL,
      sleep: noSleep,
      shouldStop: () => stop,
      visit: (u) => {
        visited.push(new URL(u).pathname);
        stop = true;
        return Promise.resolve({ ok: true, links: ['/a', 'https://example.com@127.0.0.1/'] });
      },
    });
    expect(visited).toEqual(['/']);
  });

  it('normalizes fragments and credentials', () => {
    expect(normalizeUrl('/a#x', 'https://example.com/')).toBe('https://example.com/a');
    expect(normalizeUrl('https://u:p@example.com', 'https://example.com/')).toBe(
      'https://example.com/',
    );
    expect(normalizeUrl('ftp://example.com', 'https://example.com/')).toBeNull();
  });
});
