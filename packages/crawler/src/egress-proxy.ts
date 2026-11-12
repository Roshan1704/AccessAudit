import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { assertResolvedPublic, checkUrl, type UrlPolicyOptions } from '@accessaudit/security';

/** Resolves a host name to IP addresses. The proxy calls it exactly once per outbound request. */
export type Resolver = (host: string) => Promise<string[]>;
/** Opens a TCP connection to an already validated IP. */
export type Dialer = (ip: string, port: number) => net.Socket;

export interface EgressDecision {
  host: string;
  port: number;
  allowed: boolean;
  /** Rejection reason when denied. */
  reason?: string;
  /** The pinned IP the connection was made to, when allowed. */
  ip?: string;
}

export interface EgressProxyOptions {
  resolve?: Resolver;
  dial?: Dialer;
  /** URL policy overrides (ports). `allowPrivateNetworks` must stay off outside unit tests. */
  policy?: UrlPolicyOptions;
  /** Per-connection cap on bytes returned to the browser (T-BRW-03). Default 25 MiB. */
  maxResponseBytes?: number;
  /** Connect and idle timeout. Default 15 s. */
  timeoutMs?: number;
  onDecision?: (d: EgressDecision) => void;
}

export interface EgressProxy {
  /** `http://127.0.0.1:<port>` */
  url: string;
  decisions: readonly EgressDecision[];
  close: () => Promise<void>;
}

const defaultResolve: Resolver = async (host) => {
  const rows = await dns.lookup(host, { all: true, order: 'verbatim' });
  return rows.map((r) => r.address);
};
const defaultDial: Dialer = (ip, port) => net.connect({ host: ip, port });

const HOP_BY_HOP = new Set([
  'proxy-connection',
  'proxy-authorization',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
]);

type Verdict = { ok: true; ip: string; port: number } | { ok: false; reason: string };

/**
 * Egress proxy (SSRF layered defence, T-SSRF-01..06). Every browser connection passes through it.
 * It validates the destination with the URL policy, resolves the name once, requires every answer to be
 * public, and then connects to that exact IP (pinning), so a DNS answer that changes later is never used.
 */
export async function startEgressProxy(opts: EgressProxyOptions = {}): Promise<EgressProxy> {
  const resolve = opts.resolve ?? defaultResolve;
  const dial = opts.dial ?? defaultDial;
  const maxBytes = opts.maxResponseBytes ?? 25 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const decisions: EgressDecision[] = [];

  function record(d: EgressDecision): void {
    decisions.push(d);
    opts.onDecision?.(d);
  }

  async function vet(scheme: 'http' | 'https', hostPort: string): Promise<Verdict> {
    const check = checkUrl(`${scheme}://${hostPort}/`, opts.policy);
    if (!check.ok) {
      record({ host: hostPort, port: 0, allowed: false, reason: check.reason });
      return { ok: false, reason: check.reason };
    }
    const { hostname, port } = check;
    const literal = hostname.startsWith('[') || /^[\d.]+$/.test(hostname);
    let addresses: string[];
    if (literal) {
      addresses = [hostname.startsWith('[') ? hostname.slice(1, -1) : hostname];
    } else {
      try {
        addresses = await resolve(hostname);
      } catch {
        record({ host: hostname, port, allowed: false, reason: 'dns_failure' });
        return { ok: false, reason: 'dns_failure' };
      }
      if (opts.policy?.allowPrivateNetworks !== true && !assertResolvedPublic(addresses)) {
        record({ host: hostname, port, allowed: false, reason: 'resolved_not_public' });
        return { ok: false, reason: 'resolved_not_public' };
      }
    }
    const ip = addresses[0];
    if (ip === undefined) {
      record({ host: hostname, port, allowed: false, reason: 'dns_failure' });
      return { ok: false, reason: 'dns_failure' };
    }
    record({ host: hostname, port, allowed: true, ip });
    return { ok: true, ip, port };
  }

  function deny(target: Duplex | http.ServerResponse, reason: string): void {
    const body = `egress denied: ${reason}`;
    if (target instanceof http.ServerResponse) {
      target.writeHead(403, { 'content-type': 'text/plain', 'x-egress-denied': reason });
      target.end(body);
    } else {
      target.end(
        `HTTP/1.1 403 Forbidden\r\nx-egress-denied: ${reason}\r\ncontent-length: ${String(body.length)}\r\nconnection: close\r\n\r\n${body}`,
      );
    }
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      let target: URL;
      try {
        target = new URL(req.url ?? '');
      } catch {
        deny(res, 'invalid_url');
        return;
      }
      if (target.protocol !== 'http:') {
        deny(res, 'scheme_not_allowed');
        return;
      }
      const v = await vet('http', target.host);
      if (!v.ok) {
        deny(res, v.reason);
        return;
      }
      const headers: http.OutgoingHttpHeaders = {};
      for (const [k, val] of Object.entries(req.headers)) {
        if (!HOP_BY_HOP.has(k)) headers[k] = val;
      }
      const upstream = http.request(
        {
          method: req.method,
          path: `${target.pathname}${target.search}`,
          headers,
          createConnection: () => dial(v.ip, v.port),
          timeout: timeoutMs,
        },
        (up) => {
          const out: http.OutgoingHttpHeaders = {};
          for (const [k, val] of Object.entries(up.headers)) {
            if (!HOP_BY_HOP.has(k)) out[k] = val;
          }
          res.writeHead(up.statusCode ?? 502, out);
          let seen = 0;
          up.on('data', (chunk: Buffer) => {
            seen += chunk.length;
            if (seen > maxBytes) {
              up.destroy();
              res.destroy();
            }
          });
          up.pipe(res);
        },
      );
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        if (!res.headersSent) deny(res, 'upstream_error');
        else res.destroy();
      });
      req.pipe(upstream);
    })();
  });

  server.on('connect', (req, clientSocket: Duplex, head: Buffer) => {
    void (async () => {
      clientSocket.on('error', () => undefined);
      const v = await vet('https', req.url ?? '');
      if (!v.ok) {
        deny(clientSocket, v.reason);
        return;
      }
      const upstream = dial(v.ip, v.port);
      upstream.setTimeout(timeoutMs, () => upstream.destroy());
      upstream.on('error', () => {
        deny(clientSocket, 'upstream_error');
      });
      upstream.on('connect', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        let seen = 0;
        upstream.on('data', (chunk: Buffer) => {
          seen += chunk.length;
          if (seen > maxBytes) {
            upstream.destroy();
            clientSocket.destroy();
          }
        });
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
        clientSocket.on('close', () => upstream.destroy());
      });
    })();
  });

  // CONNECT tunnels are upgraded sockets that closeAllConnections() does not cover.
  const sockets = new Set<net.Socket>();
  server.on('connection', (s: net.Socket) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${String(addr.port)}`,
    decisions,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        for (const s of sockets) s.destroy();
        server.close(() => {
          ok();
        });
      }),
  };
}
