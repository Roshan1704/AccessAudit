/** Parse dotted-quad IPv4 into a 32-bit number, or null. Strict: exactly 4 decimal octets, no leading zeros. */
export function parseIPv4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const part = m[i] as string;
    if (part.length > 1 && part.startsWith('0')) return null; // ambiguous octal form
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const v4Blocks: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function inBlock(n: number, base: string, bits: number): boolean {
  const b = parseIPv4(base) as number;
  return n >= b && n < b + 2 ** (32 - bits);
}

export function isPublicIPv4(n: number): boolean {
  return !v4Blocks.some(([base, bits]) => inBlock(n, base, bits));
}

/** Expand an IPv6 literal (no brackets, no zone) to 8 16-bit groups, or null. */
export function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  if (s.includes('%')) return null;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  const last = s.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIPv4(last);
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    s = s.slice(0, lastColon + 1) + '0:0';
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h: string): number[] | null => {
    if (h === '') return [];
    const out: number[] = [];
    for (const g of h.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0] as string);
  if (!head) return null;
  let groups: number[];
  if (halves.length === 2) {
    const rest = toGroups(halves[1] as string);
    if (!rest) return null;
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length === 2) {
    groups[6] = tail[0] as number;
    groups[7] = tail[1] as number;
  }
  return groups;
}

export function isPublicIPv6(g: number[]): boolean {
  const [a, b, c, d, e, f, g6, h] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const embedded = g6 * 65536 + h;
  if (g.every((x) => x === 0)) return false; // ::
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && g6 === 0 && h === 1)
    return false; // ::1
  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0xffff || f === 0)) {
    return isPublicIPv4(embedded);
  }
  // NAT64 64:ff9b::/96
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0)
    return isPublicIPv4(embedded);
  // 6to4 2002::/16 embeds an IPv4 in groups 1..2
  if (a === 0x2002) return isPublicIPv4(b * 65536 + c);
  if ((a & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local
  if ((a & 0xff00) === 0xff00) return false; // multicast
  if (a === 0x2001 && b === 0x0db8) return false; // documentation
  if (a === 0x2001 && b === 0) return false; // Teredo
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return false; // discard 100::/64
  return true;
}

/** True only for a syntactically valid, globally routable IP literal. Anything unparsable is rejected. */
export function isPublicIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4 !== null) return isPublicIPv4(v4);
  const v6 = parseIPv6(ip.replace(/^\[|\]$/g, ''));
  if (v6) return isPublicIPv6(v6);
  return false;
}
