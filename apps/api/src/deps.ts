import type { AppConfig, QuickResult } from '@accessaudit/shared';
import type { Db } from '@accessaudit/db';
import type { KeyProvider, PasswordHasher } from '@accessaudit/security';

export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

/** Receives unhandled server errors. Must never throw; failures to report are swallowed. */
export interface ErrorReporter {
  report(err: unknown, context: { requestId: string; method: string; url: string }): Promise<void>;
}

/** DNS access, injectable so verification can be tested against controlled records. */
export interface DnsResolver {
  /** TXT records, each as the concatenation of its chunks. Rejects with an error whose `code` is the DNS error code. */
  resolveTxt(name: string): Promise<string[]>;
  /** A and AAAA addresses. */
  resolveAddresses(name: string): Promise<string[]>;
}

export interface HttpsFetchResult {
  status: number;
  body: string;
  /** True when the response exceeded the size cap and was cut off. */
  truncated: boolean;
}

/** Fetches https://hostname/path from a pre-validated, pinned IP. Must not follow redirects. */
export interface PinnedFetcher {
  /** `opts.maxBytes` raises the body cap (default 1024) for pages such as the home page. */
  get(
    hostname: string,
    path: string,
    pinnedAddress: string,
    opts?: { maxBytes: number },
  ): Promise<HttpsFetchResult>;
}

/** Hands a scan to the worker. The payload carries ids only; scope is read from the database. */
export interface ScanQueue {
  enqueue(payload: { orgId: string; scanId: string }): Promise<void>;
  /** Rejects when the queue back end (Redis) is unreachable. */
  ping(): Promise<void>;
}

export type QuickAdmission =
  { ok: true } | { ok: false; reason: 'ip_limit' | 'daily_cap' | 'busy' };
export type QuickStatus =
  { state: 'unknown' | 'pending' | 'running' | 'failed' } | { state: 'done'; result: QuickResult };

/** Anonymous quick check back end: abuse counters, one-time challenges, job hand-off. Never touches PostgreSQL. */
export interface QuickChecks {
  admit(ip: string): Promise<QuickAdmission>;
  /** True the first time a challenge is seen, false on replay. */
  consumeChallenge(challenge: string, ttlSeconds: number): Promise<boolean>;
  submit(url: string): Promise<string>;
  status(id: string): Promise<QuickStatus>;
}

export interface Deps {
  config: AppConfig;
  quick: QuickChecks;
  db: Db;
  hasher: PasswordHasher;
  mailer: Mailer;
  /** Optional: forwards unhandled errors to an external tracker. */
  errorReporter?: ErrorReporter;
  /** Encrypts stored scan credentials. Absent when CREDENTIAL_ENCRYPTION_KEY is unset: authenticated scanning is then off. */
  credentialKeys?: KeyProvider;
  dns: DnsResolver;
  fetcher: PinnedFetcher;
  scanQueue: ScanQueue;
  now: () => Date;
}
