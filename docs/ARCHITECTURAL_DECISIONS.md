# Architectural Decision Records

Status key: **Accepted** · **Accepted, deferred** (decision made, implementation postponed) · **Open**. ADR-009 and ADR-017..020 record PM decisions of 2026-11-11. ADR-010 (encryption) stays accepted: it protects integration/AI tokens and is the foundation for future session storage; in the MVP only a `KeyProvider` with an env-key implementation is built.
Dates: 2026-11-11. Versions in `package.json` are ranges; exact versions get pinned by the lockfile at first install. The registry lookup was blocked in this environment, so current-version claims here are not verified.

---

## ADR-001 Monorepo with npm workspaces
**Decision:** Single repo; `apps/*` (web, api, worker) and `packages/*` (shared, security, db, crawler, a11y-engine, ai). TypeScript project references for incremental builds.
**Why:** Shared Zod schemas/types between web, api and worker; atomic cross-cutting changes; one CI.
**Confirmed by PM 2026-11-11; no pnpm migration.**
**Alternatives:** pnpm workspaces (better disk use, stricter hoisting) — rejected. Nx/Turborepo — extra tooling not yet justified.
**Trade-off:** npm hoisting is looser; mitigated by lint import-boundary rules.

## ADR-002 Frontend: Next.js (App Router) + React + TypeScript + Tailwind + shadcn/ui
**Decision:** As specified, plus TanStack Query, React Hook Form + Zod, Recharts.
**Why:** Mandated stack; shadcn/ui builds on Radix primitives which have strong built-in accessibility — important because the app must itself meet WCAG 2.2 AA.
**Rules:** UI contains no business logic; all data via the API client generated from OpenAPI; Recharts charts must have text/table alternatives.
**Risk:** Radix defaults are not a guarantee; we self-audit with axe and AccessAudit itself in CI.

## ADR-003 Backend: Fastify (not NestJS)
**Decision:** Fastify + `fastify-type-provider-zod` + `@fastify/swagger`; modules as plain TS folders with explicit dependency injection.
**Why:** Schema-first validation from the same Zod schemas used by the web app; OpenAPI generated from those schemas (no drift); lower framework overhead; fewer decorators/magic.
**Alternative:** NestJS — more structure out of the box and DI, but heavier and its Zod/OpenAPI story is more fragmented.
**Trade-off:** We must hold module-boundary discipline ourselves (lint rules + code review).

## ADR-004 Database: PostgreSQL 16, Drizzle ORM
**Decision:** PostgreSQL; Drizzle ORM with SQL migrations via drizzle-kit, checked into the repo.
**Why:** Drizzle stays close to SQL, which matters for RLS (`SET LOCAL app.org_id` per transaction), partial/unique indexes, JSONB and CTE-based aggregates. Types are inferred from the schema.
**Alternative:** Prisma — good DX, but RLS and per-transaction settings are awkward, and raw SQL escapes are frequent in this domain.
**Trade-off:** Drizzle is younger; migration tooling has fewer guardrails. Mitigation: every migration is reviewed SQL and tested against a real Postgres in CI.

## ADR-005 Tenant isolation: org_id everywhere + RLS
**Decision:** Every tenant-owned table has `organization_id`. Child tables carry it too (denormalized) with composite FKs `(organization_id, parent_id)` so a row can never reference another tenant's parent. RLS policies use `current_setting('app.org_id')`, set per transaction by a repository wrapper. API and worker use non-superuser roles that cannot bypass RLS.
**Why:** App-level checks alone fail on a single missed `WHERE`. RLS gives a second, independent barrier.
**Trade-off:** Slight write overhead, more verbose schema, cross-tenant admin queries need a dedicated role.

## ADR-006 User authentication: first-party, server-side sessions
**Decision:** Email + password (argon2id), opaque random session ID in an `HttpOnly; Secure; SameSite=Lax` cookie, session rows in Postgres (hashed ID), CSRF token for state-changing browser requests. TOTP MFA and OIDC/SSO are deferred (ADR-019); the schema and login flow leave room for a second factor. API access uses hashed, scoped API keys (`aa_live_…`, shown once).
**Why:** Server-side sessions are revocable and avoid JWT pitfalls; minimal dependencies.
**Alternatives:** Auth.js / Clerk / Auth0 — faster, but add a vendor/data-flow dependency and complicate tenant-aware RBAC. Revisit if enterprise SSO demand appears.

## ADR-007 Queue: BullMQ on Redis
**Decision:** As specified. Separate queues per workload class; deterministic job IDs for idempotency; Redis is not a source of truth (DB is).
**Trade-off:** Redis persistence is configured (AOF) but scan state is always reconstructible from Postgres.

## ADR-008 Browser automation: Playwright + Chromium + axe-core
**Decision:** `playwright` (Chromium only initially), `@axe-core/playwright`. Rule/engine versions captured per scan. One BrowserContext per (scan, auth profile) — never shared across orgs. Browser process is not shared between organizations.
**Why:** Mandated; storage-state support; robust semantic locators; route interception for SSRF revalidation.
**Limitation:** Single engine means Chromium-specific behavior; Firefox/WebKit are deferred.

## ADR-009 Guided manual authentication transport — ACCEPTED, DEFERRED (PM decision 2026-11-11)
**Decision:** Option A (remote isolated browser) remains the planned future approach. **Authenticated scanning is not part of the public-scanning MVP.** Remote-browser pixel streaming and the local capture helper (Option B) are **not implemented now**. The architecture stays extensible for future auth strategies (anonymous `scan_profiles` row, `profile_id` on pages/findings, `SessionManager` extension point); the auth-specific tables and endpoints are designed but **not created** until the auth phase is scheduled.
**Future-consideration limitations (must be repeated in any future auth-phase design):** hardware-key/passkey (WebAuthn) logins, device-bound credentials, token-binding, corporate device-posture checks and some SSO flows cannot be completed in a remote streamed browser and are not captured by Playwright storage state. Option B would address some of these but moves session material to the user machine. Keyboard accessibility of a streamed canvas is a genuine design challenge for our own product.
**Original analysis (retained for the future phase):**

**Problem:** The user must log in (possibly MFA/SSO) in a browser we control so we can capture the resulting state, and the spec forbids exposing session material to the frontend.
**Option A (proposed default): remote isolated browser streamed to the UI.** A dedicated `session-capture` container runs Chromium; the web UI receives CDP screencast frames and sends input events over an authenticated WebSocket. Session state never leaves the server. *Cons:* latency; clipboard/IME gaps; hardware-key passkeys/WebAuthn and some device-bound credentials will not work; keyboard-accessibility of the streamed canvas needs deliberate design (and is a genuine accessibility challenge for our own product).
**Option B: local capture helper.** A small CLI the user runs on their machine launching a local headed Chromium; on confirmation it uploads storage state encrypted client-side to a one-time server key. *Pros:* passkeys, hardware tokens, corporate device posture work. *Cons:* user installs software; session briefly lives on user machine; harder to secure the upload channel.
**Original recommendation (now deferred):** Build A in a future auth phase; design the session ingestion API so B can be added without schema changes.

## ADR-010 Secrets and session encryption
**Decision:** Envelope encryption: AES-256-GCM per-record data keys, wrapped by a master key identified by `key_id` (supports rotation). Master key from environment in dev, from a KMS/secret manager behind a `KeyProvider` interface in production. Ciphertext, IV, tag, `key_id` and AAD (`orgId|profileId|domain`) stored; AAD binding prevents moving a blob to another tenant/profile. Passwords and cookies are never in plaintext columns or logs.
**Worker access:** workers must be able to decrypt sessions for their job. Mitigation: worker DB role + RLS scoping to the job's org; short-lived decrypted material held only in worker memory; no disk writes (tmpfs for browser profile, wiped on exit).

## ADR-011 Network egress and SSRF enforcement
**Decision:** Defense in layers, with the **egress proxy as the authority**:
1. API-side URL validation (scheme, host, port allow-list, IP-literal rules).
2. Worker-side Playwright route interception: every request (including redirects, subresources, WebSocket) is re-validated.
3. Egress proxy (separate container) resolves DNS itself, rejects private/loopback/link-local/metadata/CGNAT/IPv6-ULA/mapped ranges, then **connects to the validated IP** (pinning, defeating DNS rebinding) and re-checks redirects.
4. Network policy: worker containers have no route except to the proxy, Redis, DB, and object storage.
**Why:** Browser-level checks alone are racy (TOCTOU with DNS). Network-level enforcement is non-bypassable by page content or user-supplied headers.
**Trade-off:** One more component to operate; HTTPS interception is **not** used — the proxy uses CONNECT with IP pinning and validates by destination IP, so it cannot inspect redirects inside TLS; redirect validation therefore stays in the browser layer (layer 2). Both layers are required.

## ADR-012 Object storage: S3-compatible (MinIO in dev)
**Decision:** AWS SDK v3 against any S3 API. Keys namespaced `org/{orgId}/scan/{scanId}/…`. Private buckets only; access through short-lived signed URLs issued after an authz check. Screenshots and DOM snapshots may contain sensitive data → encrypted at rest (SSE) and subject to retention.

## ADR-013 AI provider abstraction
**Decision:** `LlmProvider` interface (`generateStructured<T>(schema, prompt, opts)`), adapters for OpenAI, Anthropic, Gemini, OpenAI-compatible. Responses validated with Zod; invalid → one repair attempt → mark failed. Prompt inputs built from a typed `RedactedFindingContext` (no cookies, tokens, form values; text content truncated and scrubbed). AI output is stored separately from the finding's classification and can never modify classification/severity/confidence.
**Off by default per organization.**

## ADR-014 Observability
**Decision:** Pino logs with central redaction, OpenTelemetry SDK for traces/metrics, `/healthz` (liveness) and `/readyz` (dependencies). Exporters configurable; no vendor lock-in.

## ADR-015 Testing stack
**Decision:** Vitest (unit/integration), Testcontainers for Postgres/Redis in integration tests, Playwright Test for E2E and fixtures, axe-core on our own UI. Fixture sites in `fixtures/` are served locally on loopback with an explicit test-only SSRF allow-list override that is compiled out/disabled in production builds.

## ADR-016 Deployment
**Decision:** Docker + Compose for dev and small installs; GitHub Actions for CI; production runs the same images on a container orchestrator with workers on an isolated network segment. No Kubernetes-specific lock-in in the first release; manifests documented in Phase 10.

## ADR-017 Domain verification — ACCEPTED (PM decision 2026-11-11)
**Decision:** Scans may only target hostnames with a currently valid verification. Methods: **DNS TXT (primary)** and **well-known file (alternative)**. Audited admin attestation is **removed as a standalone proof method** (it is not proof). Internal/staging hosts that cannot publish DNS or a well-known file cannot be scanned in the MVP.
**Persisted per domain:** `verification_method`, `status` (`pending|verified|failed|expired|revoked`), `token_hash`, `verified_at`, `last_verified_at`, `next_revalidate_at`, `failed_checks`, `verified_by`.
**Revalidation:** re-check on a schedule (default every 30 days) and immediately before every scan start; a failed re-check moves status to `expired`, blocks new scans, and is audit-logged. DNS TXT removal, domain transfer, and token reuse are handled per `SECURITY_THREAT_MODEL` T-API-09.
**Security considerations:** token is random, high-entropy, per (project, hostname), stored hashed, never reused across projects/orgs (prevents one tenant claiming another's verified host); the verification fetch itself goes through the SSRF-safe egress path; well-known file must be served over HTTPS at the exact host, with redirects restricted to the same host; apex vs. subdomain scope is explicit (verifying an apex does not verify subdomains unless the user verifies them separately); wildcard/IP-literal hosts are refused.
**Cost:** small (one table, one scheduled job, one fetcher); the gating check is on the critical path of every scan.

## ADR-018 robots.txt policy — ACCEPTED (PM decision 2026-11-11; supersedes CRAWLER_ARCHITECTURE §5 draft)
**Decision:** Default: **respect `Disallow` and honor `Crawl-delay`**. Domain verification **never** implies ignoring crawler restrictions. A verified-domain owner (role admin+) may enable an **explicit per-scan override**; it is recorded in the scan `config_snapshot` (`robotsOverride: {enabled, enabledBy, enabledAt, reason}`) and in the audit log, shown in scan detail and in reports, and requires a free-text reason. Rate limits and crawl-delay still apply under override unless separately changed. Disallowed URLs are recorded with coverage status `excluded_by_robots` (never silently dropped).
**Cost:** small; robots parser + per-scan config field + audit event.

## ADR-019 MVP scope, billing and MFA — ACCEPTED (PM decision 2026-11-11)
**Decision:** MVP = public-site scanning on verified domains (see roadmap vertical slice). **Deferred, not deleted:** authenticated crawling, guided authentication, session recording/replay, advanced state discovery, custom rule builder, scheduled scanning, GitHub/Jira integrations, public API and CLI, billing/subscriptions, enterprise administration. **Billing deferred**; per-org quotas only. **TOTP MFA is not an MVP blocker**; auth is kept extensible (credential/factor tables can be added without changing `users`/`sessions`). Still required in MVP: argon2id passwords, revocable server-side sessions, hashed scoped API keys for the app's own use, rate limiting/lockout, account recovery (email reset token, single-use, short-lived), CSRF.
**Package manager:** npm workspaces confirmed (ADR-001); no pnpm migration.

## ADR-020 SaaS proportionality — ACCEPTED (PM decision 2026-11-11)
See `SYSTEM_ARCHITECTURE.md` §Proportionality for the essential-vs-later table with implementation cost. Summary: modular monolith (two deployables, shared packages); Postgres + Redis + S3-compatible only; keep tenant isolation (RLS), SSRF defenses, encrypted secrets library and evidence integrity; defer KMS, partitioning, fair queueing, k6 perf suite, multi-region, enterprise admin.

## Technologies deliberately not adopted
- GraphQL, microservice meshes, Kafka, separate search engine, serverless workers: no requirement justifies them.
- Prisma, NestJS: see ADR-004 / ADR-003.
