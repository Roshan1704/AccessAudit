import http from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEgressProxy, type EgressProxy } from './egress-proxy.js';

/** A loopback server that counts connections. It stands in for an internal service. */
async function listen(
  handler: http.RequestListener,
): Promise<{ port: number; hits: () => number; close: () => Promise<void> }> {
  let connections = 0;
  const server = http.createServer(handler);
  server.on('connection', () => connections++);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    hits: () => connections,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => {
          ok();
        });
      }),
  };
}

/** Send a plain proxied GET (absolute-form request line) and return the status line. */
function proxiedGet(proxy: EgressProxy, target: string): Promise<{ status: number; body: string }> {
  const p = new URL(proxy.url);
  return new Promise((ok, fail) => {
    const req = http.request(
      { host: p.hostname, port: Number(p.port), method: 'GET', path: target },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => {
          ok({ status: res.statusCode ?? 0, body });
        });
        // A response cut off by the proxy closes without 'end'.
        res.on('error', () => {
          ok({ status: res.statusCode ?? 0, body });
        });
        res.on('close', () => {
          ok({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', fail);
    req.end();
  });
}

function connectVia(proxy: EgressProxy, hostPort: string): Promise<string> {
  const p = new URL(proxy.url);
  return new Promise((ok, fail) => {
    const s = net.connect({ host: p.hostname, port: Number(p.port) });
    let data = '';
    s.on('connect', () => s.write(`CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n\r\n`));
    s.on('data', (c: Buffer) => {
      data += c.toString();
      if (data.includes('\r\n\r\n')) {
        s.destroy();
        ok(data.split('\r\n')[0] ?? '');
      }
    });
    s.on('error', fail);
  });
}

describe('egress proxy', () => {
  let internal: Awaited<ReturnType<typeof listen>>;
  let site: Awaited<ReturnType<typeof listen>>;
  let proxy: EgressProxy;
  const PUBLIC_IP = '93.184.216.34';
  const dialled: string[] = [];
  const resolveCalls: string[] = [];
  let answers: string[] = [PUBLIC_IP];

  beforeAll(async () => {
    internal = await listen((_q, r) => r.end('internal-secret'));
    site = await listen((_q, r) => r.end('public-site'));
    proxy = await startEgressProxy({
      resolve: (host) => {
        resolveCalls.push(host);
        return Promise.resolve(answers);
      },
      // Test dialer: the public IP is routed to the "site" fixture. Any other IP that reaches the dialer is
      // connected to the internal fixture, so a guard failure shows up as a recorded connection.
      dial: (ip, port) => {
        dialled.push(`${ip}:${port}`);
        return net.connect({
          host: '127.0.0.1',
          port: ip === PUBLIC_IP ? site.port : internal.port,
        });
      },
    });
  });
  afterAll(async () => {
    await proxy.close();
    await internal.close();
    await site.close();
  });

  it('forwards an allowed public destination to the pinned IP', async () => {
    answers = [PUBLIC_IP];
    const r = await proxiedGet(proxy, 'http://site.example.com/');
    expect(r).toEqual({ status: 200, body: 'public-site' });
    expect(dialled).toContain(`${PUBLIC_IP}:80`);
  });

  // T-SSRF-01: encodings of internal addresses; zero connections may reach the internal fixture.
  const internalTargets = [
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://localhost/',
    'http://localhost./',
    'http://LOCALHOST/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://0.0.0.0/',
    'http://user:pw@127.0.0.1/',
    'http://x.localhost/',
    'http://service.internal/',
    'http://intranet/',
  ];
  it.each(internalTargets)('T-SSRF-01 denies %s', async (t) => {
    const before = dialled.length;
    const r = await proxiedGet(proxy, t);
    expect(r.status).toBe(403);
    expect(r.body).not.toContain('internal-secret');
    expect(dialled.length).toBe(before);
    expect(internal.hits()).toBe(0);
  });

  it('T-SSRF-02 rejects a host whose DNS flips to a private address, and resolves once per request', async () => {
    answers = [PUBLIC_IP];
    const dialsBefore = dialled.length;
    const resolvesBefore = resolveCalls.length;
    const ok = await proxiedGet(proxy, 'http://rebind.example.com/');
    expect(ok.status).toBe(200);
    expect(resolveCalls.length - resolvesBefore).toBe(1);
    expect(dialled.length - dialsBefore).toBe(1);

    answers = ['127.0.0.1'];
    const flipped = await proxiedGet(proxy, 'http://rebind.example.com/');
    expect(flipped.status).toBe(403);
    expect(flipped.body).toContain('resolved_not_public');

    // Mixed answers (one public, one private) are refused as a whole.
    answers = [PUBLIC_IP, '10.0.0.5'];
    const mixed = await proxiedGet(proxy, 'http://rebind.example.com/');
    expect(mixed.status).toBe(403);
    expect(internal.hits()).toBe(0);
  });

  it('T-SSRF-06 denies cloud metadata addresses and names', async () => {
    for (const t of [
      'http://169.254.169.254/latest/meta-data/',
      'http://[fd00:ec2::254]/',
      'http://metadata.google.internal/',
      'http://instance-data/',
    ]) {
      const r = await proxiedGet(proxy, t);
      expect(r.status, t).toBe(403);
    }
    answers = ['169.254.169.254'];
    const viaDns = await proxiedGet(proxy, 'http://innocent.example.com/');
    expect(viaDns.status).toBe(403);
    expect(internal.hits()).toBe(0);
  });

  it('CONNECT tunnels are vetted too (HTTPS targets)', async () => {
    answers = [PUBLIC_IP];
    expect(await connectVia(proxy, '127.0.0.1:443')).toContain('403');
    expect(await connectVia(proxy, '169.254.169.254:443')).toContain('403');
    expect(await connectVia(proxy, 'localhost:443')).toContain('403');
    answers = ['10.1.2.3'];
    expect(await connectVia(proxy, 'rebind.example.com:443')).toContain('403');
    expect(internal.hits()).toBe(0);
  });

  it('refuses ports outside the allow-list', async () => {
    answers = [PUBLIC_IP];
    const r = await proxiedGet(proxy, 'http://site.example.com:22/');
    expect(r.status).toBe(403);
    expect(r.body).toContain('port_not_allowed');
  });

  it('T-SSRF-05 refuses non-http schemes sent to the proxy', async () => {
    for (const t of ['ftp://site.example.com/', 'file:///etc/passwd', 'gopher://x.example.com/']) {
      const r = await proxiedGet(proxy, t);
      expect(r.status, t).toBe(403);
    }
  });
});

describe('egress proxy response cap', () => {
  it('T-BRW-03 cuts off responses above the size cap', async () => {
    const big = await listen((_q, r) => {
      r.writeHead(200, { 'content-type': 'text/plain' });
      r.write(Buffer.alloc(200_000, 97));
      setTimeout(() => r.end(Buffer.alloc(200_000, 97)), 20);
    });
    const proxy = await startEgressProxy({
      resolve: () => Promise.resolve(['93.184.216.34']),
      dial: () => net.connect({ host: '127.0.0.1', port: big.port }),
      maxResponseBytes: 100_000,
    });
    let received = 0;
    await proxiedGet(proxy, 'http://big.example.com/').then(
      (r) => (received = r.body.length),
      () => (received = -1),
    );
    expect(received).toBeLessThan(400_000);
    await proxy.close();
    await big.close();
  });
});
