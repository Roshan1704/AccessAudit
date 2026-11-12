import { describe, expect, it } from 'vitest';
import { assertResolvedPublic, checkUrl } from './url-policy.js';

const rejected: [string, string][] = [
  ['loopback name', 'http://localhost/'],
  ['loopback name trailing dot', 'http://localhost./'],
  ['loopback upper', 'http://LOCALHOST/'],
  ['sub of localhost', 'http://foo.localhost/'],
  ['127.0.0.1', 'http://127.0.0.1/'],
  ['127.1 short', 'http://127.1/'],
  ['decimal loopback', 'http://2130706433/'],
  ['hex loopback', 'http://0x7f000001/'],
  ['hex dotted', 'http://0x7f.0x0.0x0.0x1/'],
  ['octal loopback', 'http://017700000001/'],
  ['octal dotted', 'http://0177.0.0.1/'],
  ['mixed radix', 'http://0x7f.0.0.1/'],
  ['zero addr', 'http://0.0.0.0/'],
  ['zero short', 'http://0/'],
  ['10/8', 'http://10.0.0.1/'],
  ['10 decimal', 'http://167772161/'],
  ['172.16', 'http://172.16.0.1/'],
  ['172.31', 'http://172.31.255.255/'],
  ['192.168', 'http://192.168.1.1/'],
  ['cgnat', 'http://100.64.0.1/'],
  ['link-local', 'http://169.254.1.1/'],
  ['aws metadata', 'http://169.254.169.254/latest/meta-data/'],
  ['metadata decimal', 'http://2852039166/'],
  ['metadata hex', 'http://0xa9fea9fe/'],
  ['metadata hostname gcp', 'http://metadata.google.internal/'],
  ['metadata short', 'http://metadata/'],
  ['multicast', 'http://224.0.0.1/'],
  ['reserved 240', 'http://240.0.0.1/'],
  ['broadcast', 'http://255.255.255.255/'],
  ['test-net-1', 'http://192.0.2.1/'],
  ['benchmark', 'http://198.18.0.1/'],
  ['ipv6 loopback', 'http://[::1]/'],
  ['ipv6 unspecified', 'http://[::]/'],
  ['ipv6 loopback long', 'http://[0:0:0:0:0:0:0:1]/'],
  ['ipv4-mapped loopback', 'http://[::ffff:127.0.0.1]/'],
  ['ipv4-mapped loopback hex', 'http://[::ffff:7f00:1]/'],
  ['ipv4-mapped private', 'http://[::ffff:10.0.0.1]/'],
  ['ipv4-mapped metadata', 'http://[::ffff:169.254.169.254]/'],
  ['ipv4-compatible loopback', 'http://[::127.0.0.1]/'],
  ['nat64 loopback', 'http://[64:ff9b::7f00:1]/'],
  ['6to4 loopback', 'http://[2002:7f00:1::]/'],
  ['unique local', 'http://[fc00::1]/'],
  ['unique local fd', 'http://[fd00:ec2::254]/'],
  ['link-local v6', 'http://[fe80::1]/'],
  ['site-local v6', 'http://[fec0::1]/'],
  ['multicast v6', 'http://[ff02::1]/'],
  ['doc v6', 'http://[2001:db8::1]/'],
  ['teredo', 'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/'],
  ['userinfo', 'http://user:pass@example.com/'],
  ['userinfo user only', 'http://user@example.com/'],
  ['userinfo host trick', 'http://example.com@127.0.0.1/'],
  ['userinfo host trick 2', 'http://example.com@localhost/'],
  ['file scheme', 'file:///etc/passwd'],
  ['ftp scheme', 'ftp://example.com/'],
  ['javascript scheme', 'javascript:alert(1)'],
  ['data scheme', 'data:text/html,hi'],
  ['gopher scheme', 'gopher://example.com/'],
  ['blob scheme', 'blob:http://example.com/x'],
  ['port 22', 'http://example.com:22/'],
  ['port 6379', 'http://example.com:6379/'],
  ['port 5432', 'https://example.com:5432/'],
  ['single label', 'http://intranet/'],
  ['dot local', 'http://printer.local/'],
  ['dot internal', 'http://svc.internal/'],
  ['dot lan', 'http://nas.lan/'],
  ['not a url', 'not a url'],
  ['empty', ''],
  ['numeric tld', 'http://example.123/'],
  ['unicode dot loopback', 'http://127。0。0。1/'],
  ['fullwidth digits', 'http://１２７.０.０.１/'],
  ['percent-encoded host loopback', 'http://%31%32%37.0.0.1/'],
];

const accepted: [string, string][] = [
  ['https basic', 'https://example.com/'],
  ['http basic', 'http://example.com/'],
  ['with path query', 'https://example.com/a/b?c=d#e'],
  ['subdomain', 'https://www.example.com/'],
  ['port 8443', 'https://example.com:8443/'],
  ['public ipv4', 'http://93.184.216.34/'],
  ['public ipv6', 'http://[2606:2800:220:1:248:1893:25c8:1946]/'],
  ['idn', 'https://bücher.example/'],
  ['trailing dot fqdn', 'https://example.com./'],
];

describe('UrlPolicy.checkUrl: rejection table', () => {
  it.each(rejected)('rejects %s (%s)', (_name, url) => {
    expect(checkUrl(url).ok).toBe(false);
  });

  it('has more than 60 rejection encodings', () => {
    expect(rejected.length).toBeGreaterThan(60);
  });
});

describe('UrlPolicy.checkUrl: accepted', () => {
  it.each(accepted)('accepts %s (%s)', (_name, url) => {
    expect(checkUrl(url).ok).toBe(true);
  });

  it('normalizes trailing dot hostname', () => {
    const r = checkUrl('https://example.com./');
    expect(r.ok && r.hostname).toBe('example.com');
  });
});

describe('UrlPolicy options', () => {
  it('allowPrivateNetworks only relaxes host checks, not scheme/userinfo/port', () => {
    expect(checkUrl('http://127.0.0.1/', { allowPrivateNetworks: true }).ok).toBe(true);
    expect(checkUrl('file:///x', { allowPrivateNetworks: true }).ok).toBe(false);
    expect(checkUrl('http://u:p@127.0.0.1/', { allowPrivateNetworks: true }).ok).toBe(false);
    expect(checkUrl('http://127.0.0.1:22/', { allowPrivateNetworks: true }).ok).toBe(false);
  });

  it('is off by default', () => {
    expect(checkUrl('http://127.0.0.1/').ok).toBe(false);
  });
});

describe('assertResolvedPublic', () => {
  it('requires every answer to be public', () => {
    expect(assertResolvedPublic(['93.184.216.34'])).toBe(true);
    expect(assertResolvedPublic(['93.184.216.34', '127.0.0.1'])).toBe(false);
    expect(assertResolvedPublic(['::ffff:10.0.0.1'])).toBe(false);
    expect(assertResolvedPublic([])).toBe(false);
    expect(assertResolvedPublic(['garbage'])).toBe(false);
  });
});
