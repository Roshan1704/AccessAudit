/** Product token matched against `User-agent` groups in robots.txt. */
export const ROBOTS_AGENT = 'AccessAuditBot';

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  /** True when the path (with query) may be fetched. */
  isAllowed: (pathAndQuery: string) => boolean;
  /** Crawl-delay in seconds, or 0. */
  crawlDelaySeconds: number;
}

/** A policy that allows everything (robots.txt missing or unreachable with a 404). */
export const ALLOW_ALL: RobotsPolicy = { isAllowed: () => true, crawlDelaySeconds: 0 };

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

/**
 * Parse robots.txt for our agent. The most specific matching group wins (our token, else `*`).
 * Within a group the longest matching rule wins; on a tie Allow beats Disallow (RFC 9309).
 */
export function parseRobots(text: string, agent: string = ROBOTS_AGENT): RobotsPolicy {
  const groups: { agents: string[]; rules: Rule[]; delay: number }[] = [];
  let current: { agents: string[]; rules: Rule[]; delay: number } | undefined;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!lastWasAgent || current === undefined) {
        current = { agents: [], rules: [], delay: 0 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current === undefined) continue;
    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value !== '') current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) current.delay = n;
    }
  }

  const token = agent.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = own.length > 0 ? own : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules).map((r) => ({ ...r, re: toRegExp(r.pattern) }));
  const crawlDelaySeconds = Math.max(0, ...chosen.map((g) => g.delay));

  return {
    crawlDelaySeconds,
    isAllowed(pathAndQuery: string): boolean {
      let best: { allow: boolean; len: number } | undefined;
      for (const r of rules) {
        if (!r.re.test(pathAndQuery)) continue;
        const len = r.pattern.length;
        if (best === undefined || len > best.len || (len === best.len && r.allow)) {
          best = { allow: r.allow, len };
        }
      }
      return best?.allow ?? true;
    },
  };
}
