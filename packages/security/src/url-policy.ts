import { isPublicIp, parseIPv6 } from './ip.js';

export type UrlRejection =
  | 'invalid_url'
  | 'scheme_not_allowed'
  | 'userinfo_not_allowed'
  | 'port_not_allowed'
  | 'host_not_allowed'
  | 'ip_not_public';

export type UrlCheck =
  { ok: true; url: URL; hostname: string; port: number } | { ok: false; reason: UrlRejection };

export interface UrlPolicyOptions {
  allowedPorts?: readonly number[];
  /** Test-only: permits loopback fixtures. Must never be enabled in production configuration. */
  allowPrivateNetworks?: boolean;
}

const DEFAULT_PORTS = [80, 443, 8080, 8443] as const;
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
  '.lan',
  '.intranet',
  '.corp',
];
const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/**
 * Static URL validation. Uses the WHATWG parser, which canonicalizes decimal/octal/hex IPv4 forms,
 * IPv4-mapped IPv6 and IDNA before checks run. Host names are NOT resolved here; callers that
 * connect must additionally validate resolved addresses with `assertResolvedPublic` and pin the IP.
 */
export function checkUrl(input: string, opts: UrlPolicyOptions = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'scheme_not_allowed' };
  }
  if (url.username !== '' || url.password !== '')
    return { ok: false, reason: 'userinfo_not_allowed' };

  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  const ports = opts.allowedPorts ?? DEFAULT_PORTS;
  if (!ports.includes(port)) return { ok: false, reason: 'port_not_allowed' };

  const hostname = url.hostname.replace(/\.+$/, '').toLowerCase();
  if (hostname === '') return { ok: false, reason: 'invalid_url' };

  if (opts.allowPrivateNetworks === true) return { ok: true, url, hostname, port };

  const isV6 = hostname.startsWith('[');
  const looksV4 = /^[\d.]+$/.test(hostname);
  if (isV6 || looksV4) {
    if (isV6 && parseIPv6(hostname.slice(1, -1)) === null)
      return { ok: false, reason: 'invalid_url' };
    if (!isPublicIp(hostname)) return { ok: false, reason: 'ip_not_public' };
    return { ok: true, url, hostname, port };
  }

  if (BLOCKED_HOSTS.has(hostname) || BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return { ok: false, reason: 'host_not_allowed' };
  }
  // Single-label names resolve via search domains / internal DNS; require a dotted name.
  if (!hostname.includes('.')) return { ok: false, reason: 'host_not_allowed' };
  // An all-numeric last label is treated as an IPv4 form by some resolvers.
  if (/^\d+$/.test(hostname.split('.').pop() as string))
    return { ok: false, reason: 'ip_not_public' };

  return { ok: true, url, hostname, port };
}

/** Validate addresses returned by DNS before connecting. All answers must be public (defeats mixed-answer rebinding). */
export function assertResolvedPublic(addresses: readonly string[]): boolean {
  return addresses.length > 0 && addresses.every((a) => isPublicIp(a));
}
