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

## ADR-002 Frontend: React + TypeScript + Tailwind + shadcn/ui (framework superseded by ADR-023: Vite + React Router, not Next.js)

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
**Option A (proposed default): remote isolated browser streamed to the UI.** A dedicated `session-capture` container runs Chromium; the web UI receives CDP screencast frames and sends input events over an authenticated WebSocket. Session state never leaves the server. _Cons:_ latency; clipboard/IME gaps; hardware-key passkeys/WebAuthn and some device-bound credentials will not work; keyboard-accessibility of the streamed canvas needs deliberate design (and is a genuine accessibility challenge for our own product).
**Option B: local capture helper.** A small CLI the user runs on their machine launching a local headed Chromium; on confirmation it uploads storage state encrypted client-side to a one-time server key. _Pros:_ passkeys, hardware tokens, corporate device posture work. _Cons:_ user installs software; session briefly lives on user machine; harder to secure the upload channel.
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

**Addendum (2026-11-12, implemented):**

- A third method, **meta tag** (`meta_tag`), was added for owners who cannot edit DNS or serve a well-known file. The token is placed in a `<meta>` element on the site root page and read through the same SSRF-safe fetcher. Same rules apply: exact host, same-host redirects only, token shown once, SHA-256 hash stored.
- Hostnames are normalised before storage (scheme, path, port and case removed) so one host cannot be registered in several spellings.
- Verification is a gate: a scan start is refused unless the domain is currently `verified`; the check is repeated at scan start.
- Development only: `ALLOW_PRIVATE_TARGETS=true` relaxes the SSRF policy so a local or intranet host can be verified and scanned over HTTP. Risk: with the flag on, the worker can reach private addresses. It must stay `false` in any shared or production environment, and the process logs a warning when it is on.
- Organisation input is validated by schema (name length, slug format) before any verification work.

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

## ADR-021 Password hashing: argon2id with scrypt fallback — IMPLEMENTED (Phase 1, 2026-11-11)

**Decision:** argon2id via the `argon2` package is the production hasher. A Node `scrypt` hasher exists as a fallback behind the same interface for environments where the native module cannot build. Both are unit tested.
**Cost:** a native dependency whose install script was run explicitly (`npm rebuild argon2`) because installs use `--ignore-scripts`.

## ADR-022 Browser sessions and CSRF — IMPLEMENTED (Phase 1, 2026-11-11)

**Decision:** server-side sessions stored hashed in PostgreSQL (revocable, 24h idle and 7d absolute limits, new session per login). Cookies `aa_session` (HttpOnly, SameSite=Lax) and `aa_csrf` (readable). Every mutation must carry an `Origin` equal to `WEB_ORIGIN`; authenticated mutations must also send `x-csrf-token`, compared by hash against the session. Unauthenticated auth routes check Origin only. CORS allows only `WEB_ORIGIN` with credentials.
**Consequence:** the web app and API must share a site for SameSite=Lax cookies; a different registrable domain needs a design change.

## ADR-023 Frontend framework: Vite + React with React Router — IMPLEMENTED (Phase 1 remediation, 2026-11-11)

**Context:** The Product Manager's remediation message states the approved frontend is Vite + React. ADR-002 and the master specification (Part 19) named Next.js (App Router), and Phase 1 was first built on Next.js 16. That app used only `next/link` and `next/navigation`, every page was a client component, and it talked to the Fastify API through `apps/web/src/lib/api.ts` with cookie credentials. No server rendering, route handlers, middleware, image optimisation or server actions were used, so Next.js added build weight without using its features.
**Decision:** `apps/web` is a Vite 8 + React 19 single-page application using React Router 7. This supersedes the Next.js choice in ADR-002; the rest of ADR-002 (TypeScript, accessibility rules, no business logic in the UI) stands. Tailwind, shadcn/ui, TanStack Query and Recharts from ADR-002 are not yet adopted; Phase 1 uses plain CSS.
**Implementation:** a thin `src/lib/nav.tsx` keeps the small navigation API pages already used. `Shell` is a layout route rendering `<Outlet />`. The API base URL comes from `VITE_API_URL` (was `NEXT_PUBLIC_API_URL`). The dev server and preview use port 3000 to match `WEB_ORIGIN`. Production output is static files in `apps/web/dist`.
**Consequences:** no server rendering (not needed for an authenticated dashboard); static hosting needs a fallback to `index.html` for deep links; marketing or public report pages that need SEO would need a separate decision in a later phase. Route protection stays client-side with server enforcement in the API.
**Status:** approved by the Product Manager's remediation message; migration completed and re-verified (see PROJECT_STATUS).

## ADR-024 Audit log retention and role model — IMPLEMENTED (migrations 0002 and 0003, 2026-11-11)

**Decision:** migration 0002 creates `aa_migrator` and `aa_retention` (NOLOGIN, no passwords; the environment bootstrap grants LOGIN and credentials). `aa_retention` may SELECT and DELETE `audit_logs` through dedicated row-level security policies. The immutability trigger permits row DELETE only for that role, and UPDATE and bulk removal stay blocked for everyone. Migration 0003 changes the `audit_logs` organization foreign key from CASCADE to RESTRICT so audit history cannot disappear with an organization. A composite foreign key is not applicable because `audit_logs` has a single parent.
**Ordering and rollback:** 0002 runs after 0001 (it replaces the trigger function created there) and before 0003. Migrations are forward-only. Manual reversal steps for 0002 are in its header; reversing 0003 means re-adding the constraint with ON DELETE CASCADE. Deleting an organization that has audit rows now fails by design until retention removes them.

## ADR-025 UI stack and design system — IMPLEMENTED (Phase 2, 2026-11-12)

**Decision:** the web app uses plain CSS with design tokens in `apps/web/src/globals.css` (no Tailwind or component library), `lucide-react` icons, and React Router. Findings are always shown with a classification pill (confirmed violation, potential violation, manual verification) and a severity tag; the UI never shows a single accessibility score. Underlined links inside body text, visible focus, and text labels on every status (colour is never the only signal) are part of the system.
**Why:** fewer dependencies for an app of this size; the product audits accessibility, so its own UI must pass axe with zero violations on the pages tested.
**Consequence:** the earlier reference to Tailwind and shadcn/ui in ADR-002 is not followed. Revisit if the component count grows enough to justify a library.

## ADR-026 Merged Phase 2 and anonymous quick check — ACCEPTED (PM decisions 2026-11-11)

**Scope decision:** roadmap phases 2 to 4 are merged into one phase: SSRF and browser isolation gate first, then scan pipeline, accessibility engine and findings UI. Interaction tests (keyboard, focus, dialog, form, menu, tabs and accordion, dynamic content) run under a read-only policy with no form submission. Their findings are potential or manual unless a reproducible trace confirms them.

**Quick check (supersedes the "no scan without verified domain" rule for one narrow case):** a visitor without an account may run a single-page check of a public URL. Constraints:

- one page only, no crawling, no interaction tests beyond a passive scan;
- the result is shown once and is not stored; nothing is linked to an identity;
- per-IP rate limit, a global concurrency cap, CAPTCHA or proof-of-work before the scan starts, robots.txt respected, identifiable user agent;
- the same SSRF gate (egress proxy, browser isolation, resource caps) applies;
- the page owner is not verified, so the scan is read-only and loads the page like an ordinary visitor.

Saving results, history, multi-page crawls, interaction tests, teams and scheduling still require an account and a verified domain.

**Risks:** abuse as a free crawling or load tool, and compute cost without revenue. Mitigations are the limits above, a kill switch (config flag) and per-day global caps.
**Consequence:** the PRD and threat model need an addendum for unauthenticated scan abuse. Domain verification remains mandatory for everything except the quick check.

**Implementation (2026-11-12):** the visitor requests a proof-of-work challenge (`GET /quick-check/challenge`), solves a SHA-256 puzzle in the browser, and posts the URL with the solution. Challenges are single use (Redis `SET NX` with expiry). Admission checks a global queue cap, a per-IP hourly counter and a per-day global counter, all in Redis. A kill switch config flag disables the feature. The job runs in the worker with the same egress proxy and browser isolation as authenticated scans. The result lives only in the BullMQ job record and is deleted on the first successful read (shown once); an unread result expires after ten minutes. The addendum is in PRODUCT_REQUIREMENTS §8 and SECURITY_THREAT_MODEL §4.10.

## ADR-027 Scheduled scans — IMPLEMENTED (Phase 4, migration 0008)

**Decision:** an admin can attach up to three schedules (daily or weekly) to a project. This supersedes the deferral of scheduled scanning in ADR-019. A schedule stores the scan settings (page cap, WCAG version, level, interaction tests) and `next_run_at`. A tick in the API process (every 60 seconds, disabled with `SCHEDULER=off`) finds due schedules and creates scans through the same `insertScan` function the manual route uses, so SSRF policy, verified-domain check and the active-scan quota apply identically. A schedule never carries a robots.txt override; scheduled scans always respect robots.txt.
**Cross-organization access:** the tick has no tenant context. Migration 0008 adds a `scheduler_select` SELECT-only policy that is true only when the transaction sets `app.scheduler = 'on'`. The tick uses it to list due schedule ids, then handles each schedule in its own `withTenant` transaction, so every write stays under the normal tenant policy.
**Concurrency and failure:** each schedule is claimed with a compare-and-set on `next_run_at`, so two ticking processes cannot start the same run. A failed run (unverified domain, quota, queue unavailable) is recorded in `last_error` and an audit entry, and `next_run_at` still advances, so a broken schedule cannot retry in a tight loop. Runs are audited with actor type `system`.
**Consequences:** the schedule is evaluated only while an API process is running; missed runs are executed once on the next tick (not replayed). Scheduled scans run unattended, so they only target domains whose verification is current. There is no per-schedule notification yet (see the notifications decision).

## ADR-028 Scan notifications — IMPLEMENTED (Phase 4, migration 0009)

**Decision:** the API process emails people when a scan finishes or fails. A tick (run with the schedule tick, every minute) finds scans in `completed` or `failed` with `notified_at IS NULL`, claims each with a compare-and-set update of `notified_at`, then sends mail through the existing `deps.mailer`. The worker stays unchanged and has no access to user email addresses.
**Recipients:** the user who started the scan; for scheduled scans (no creator), the organization's owners and admins. Completed-scan mail states issue counts and, when a previous completed scan exists, the regression and resolved counts from the same comparison used by the compare view. The text repeats that automated checks need manual review.
**Cross-organization access:** same pattern as ADR-027: migration 0009 adds a SELECT-only `scheduler_select` policy on `scans`, true only when `app.scheduler = 'on'`; all writes run in per-scan `withTenant` transactions. Migration 0009 marks existing finished scans as notified so deployment sends no backlog.
**Trade-offs:** delivery is at most once: the claim happens before sending, so a mailer outage loses that mail rather than sending duplicates (an audit row `scan.notified` records the attempt). There are no per-user preferences or digests yet; those need a preferences table and are listed as future work.

## ADR-029 AI provider abstraction (template provider only) — IMPLEMENTED (Phase 4)

**Decision (PM, Phase 4):** `packages/ai` defines a provider interface for finding explanations. Only the offline template provider ships. No network call to any model provider exists, no finding data leaves the system, and no API key is read.
**Rules for a future provider:** output must be labelled as AI-generated (`source: 'ai'`), carry the standing disclaimer, and never change a finding's classification or severity; sending page content to a third party requires a new ADR, an organization-level opt-in, and redaction review.

## ADR-030 Reports rendered as HTML, converted to PDF with the installed Chrome — IMPLEMENTED (Phase 4)

**Decision (PM, Phase 4):** JSON, CSV and HTML reports are generated by the API from stored findings; PDF is produced by loading the same escaped HTML into headless Chrome (the engine already used for scanning) and printing it. No new dependency was added.
**Safety:** all dynamic text is HTML-escaped; the PDF render page has JavaScript and network disabled, so report content cannot trigger requests.
**Limits:** the PDF path has no automated test and has not been verified manually; it needs Chrome on the API host.

## ADR-031 Authenticated scanning with stored form-login profiles — IMPLEMENTED (Phase 5, migration 0010)

**Decision (PM, Phase 5):** this supersedes the deferral in ADR-019. An admin can store up to five login profiles per project (login URL, four CSS selectors, username, password). A scan may reference one profile. The worker signs in once through the login form, keeps the resulting session in memory, and gives it to each page context. The session is never written to disk or the database.
**Credential storage:** username and password are sealed with AES-256-GCM (`sealSecret`), using the `KeyProvider` from ADR-010 (`CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_KEY_ID`). The associated data is the key id plus `<profileId>:username` or `<profileId>:password`, so a ciphertext cannot be moved to another row or field. Credentials are write-only: no API response, audit entry or log contains them, and the select lists used by the API omit the credential columns. The worker role has SELECT only on the table. If the key is not configured, creating a profile is refused and scans that reference one fail.
**Safety rules:** the login URL must pass the SSRF policy and its hostname must be a verified domain of the project. The read-only rule (ADR-008) stays in force with one narrow exception: during the login call only, state-changing requests to the login origin are allowed so the form can post. Page contexts used for crawling never get this exception. The crawler does not follow links whose path looks like sign-out, so a scan does not end its own session. Login is verified only when the success selector appears; otherwise the scan fails with the fixed reason `auth_failed`, with no page content or credentials in the error.
**Limits:** only single-page form logins are supported (no MFA, CAPTCHA, SSO redirects or multi-step forms). Key rotation needs a re-entry of credentials until a re-seal tool exists. A scan covers one profile; per-role comparison is future work.
**Risks:** the scanned site sees a logged-in bot, and a mis-scoped account could change data through page scripts that the read-only rule does not catch on the login origin. Use a dedicated low-privilege test account.
