# Testing Strategy

> **Note (2026-11-16):** dated results and counts in this document are historical. Current test status is only in [PROJECT_STATUS](PROJECT_STATUS.md), section "Authoritative current status".

> Test and verification status: the single authority is [PROJECT_STATUS](PROJECT_STATUS.md), section "Current verified baseline". Figures below are historical.

Status: Draft v0.1 · Date: 2026-11-11

## 1. Rules of engagement

1. **No claim without execution.** A test is "passed" in `TRACEABILITY_MATRIX.md` only when it was run and the result recorded (command, date, commit). Unrun = `not executed`.
2. **Every feature ships with unit, integration and e2e coverage** appropriate to its layer; gaps are recorded in the matrix, not hidden.
3. **No dummy data in product code.** Test data lives in `fixtures/` and test factories only; never in seeds shipped to environments.
4. **Security gates first.** Controls marked [Gate] in SECURITY_THREAT_MODEL need an executed passing test before crawler/browser code merges.
5. **Phase gate.** A phase cannot close until its acceptance criteria tests are executed and green.

## 2. Test pyramid

| Level              | Tooling                                             | Scope                                                                                                       | Runs                                      |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Unit               | Vitest                                              | Pure logic: UrlPolicy, Normalizer, fingerprinting, classifier, crypto envelope, state machines, Zod schemas | every commit                              |
| Integration        | Vitest + Testcontainers (Postgres 16, Redis, MinIO) | Repositories under app DB roles, RLS, queues, API routes via Fastify `inject`, storage                      | every PR                                  |
| Contract           | OpenAPI-derived checks                              | Response shapes, error codes, secret-free responses                                                         | every PR                                  |
| E2E                | Playwright Test                                     | Web UI ↔ API ↔ worker ↔ DB against fixture sites                                                            | PR (smoke) / nightly (full)               |
| Security           | Dedicated suites (§4)                               | SSRF, tenancy, secrets, LLM canaries                                                                        | every PR (gates)                          |
| Self-accessibility | axe + manual checklist                              | Our own UI                                                                                                  | every PR (automated) / per phase (manual) |
| Performance        | k6 (deferred; sanity check only)                    | Queue throughput, API latency, large scans                                                                  | roadmap Phase 9                           |

## 3. Per-layer expectations

- **packages/shared, security, crawler (pure parts), a11y-engine:** unit-heavy, property-based tests where inputs are adversarial (URL parsing, normalization).
- **packages/db:** migrations applied to a real Postgres in CI; repository tests run as `aa_api`/`aa_worker` roles (never superuser) so RLS is exercised.
- **apps/api:** each route has success, validation-failure, authz-failure and cross-tenant (404) tests.
- **apps/worker:** job handlers tested with fixture sites; idempotency (duplicate job id), cancel, crash-restart tests.
- **apps/web (later phases):** component tests plus Playwright flows; no mocked scan data in e2e—flows run against the real stack and fixture sites.

## 4. Mandatory security suites

| Suite                    | Threat IDs         | Method                                                                                                                                                                                            |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSRF encodings           | T-SSRF-01          | Table-driven >60 forms (decimal/octal/hex IPs, IPv4-mapped IPv6, userinfo tricks, trailing dots, mixed case, unicode) against UrlPolicy; plus loopback fixture asserting zero inbound connections |
| DNS rebinding            | T-SSRF-02          | Fixture DNS server flipping answers; scan must not reach the internal fixture service                                                                                                             |
| Redirect / subresource   | T-SSRF-03/04/05    | Fixture 302 to loopback/metadata IP; page JS fetch/WebSocket to internal; disallowed schemes                                                                                                      |
| Metadata endpoint        | T-SSRF-06          | Fixture on metadata-range address must receive nothing                                                                                                                                            |
| Credential storage       | T-CRED-01/02       | DB dump grep for plaintext canaries; AAD tamper and row-swap decryption must fail                                                                                                                 |
| Secret leakage           | T-CRED-03/04/08    | Canary secrets run through full e2e; scan logs, queue payloads, API responses, screenshots/DOM for canaries — must find none                                                                      |
| Auth state machine       | T-CRED-07          | One attempt per verification; locked state halts; no auto-retry                                                                                                                                   |
| Domain binding           | T-CRED-09, T-GS-03 | Session replay against non-authorized domain refused; storage state filtered                                                                                                                      |
| Browser isolation        | T-BRW-*            | Downloads/permissions denied; contexts not shared across (scan, profile); tmpfs profile removed                                                                                                   |
| Cross-tenant matrix      | T-TEN-01..04       | For every repository method and API route: tenant A attempts to read/write tenant B resources via repository, raw SQL under app role, and HTTP → must fail; job payload tamper rejected           |
| Authz / RBAC             | T-API-05/06        | Role × endpoint matrix; API key scope ceilings                                                                                                                                                    |
| CSRF / session / CORS    | T-API-02           | Missing/forged token, cross-origin, fixation tests                                                                                                                                                |
| XSS from scanned content | T-API-04           | Fixture page with script/HTML payloads in titles, snippets, selectors; UI and report output escape them                                                                                           |
| LLM minimization         | T-LLM-01/02        | Canary data absent from constructed prompt; injection fixture cannot alter classification                                                                                                         |
| Guided-session channel   | T-GS-01/04         | Token single-use, expiry, wrong-user, idle timeout                                                                                                                                                |

Failures in these suites block merge. Suites are listed by ID in the traceability matrix.

## 5. Fixture sites (`fixtures/`)

Static multi-page site; SPA with `pushState` routes; infinite scroll; sitemap variants (index, gzip, bomb, cross-domain); redirect loops and chains; login flows (success, invalid credentials, lockout, MFA stub, CAPTCHA stub, session expiry mid-scan, role-gated pages with 403); trap calendars; destructive-button pages (to verify read-only policy and non-GET abort); rebinding DNS server; hostile pages (huge DOM, popups, downloads); accessibility corpus (`fixtures/a11y/`). Fixtures bind to loopback only; the crawler reaches them solely through the compile-time test-only SSRF override, which a production-build test asserts is absent.

## 6. Data and environments

- Testcontainers provision ephemeral Postgres/Redis/MinIO per suite; migrations applied from the real SQL files.
- Factories create minimal valid entities; no shared mutable global fixtures.
- Time and randomness are injectable for deterministic state-machine and token tests.
- Third-party services (LLM, email, GitHub) are faked at the adapter boundary in tests; adapters have contract tests against recorded schemas, and are clearly labeled as fakes.

## 7. Self-accessibility (the product must itself be accessible)

- Automated axe checks on every UI route in e2e (zero serious/critical allowed).
- Manual checklist per UI phase: keyboard-only flows, screen reader pass (NVDA + VoiceOver), zoom/reflow, reduced motion, high contrast.
- Guided-session viewer keyboard/text-entry fallback is a test objective of the deferred auth phase.

## 8. CI gates

Order: install (`npm ci`) → typecheck → lint → unit → integration (Testcontainers) → security suites → e2e smoke → build. Additional: dependency audit and secret scan; coverage thresholds on security-critical packages (`security`, `db` tenancy layer) set when those packages exist. A gate is only "enforced" once the workflow file exists and has run; until then the matrix says so.

## 9. Reporting

- `TRACEABILITY_MATRIX.md`: REQ/SEC → feature → test IDs → last run result/date/commit.
- Each phase closes with a Product and Engineering Review Report listing executed vs. not-executed tests, defects, tech debt, security risks and deferred items.
- Flaky tests are quarantined with an issue and owner; they do not count as passing.

## 10. Current status

Updated 2026-11-12. Phase 1, Phase 2 and the Phase 5 aggregates and UI work are implemented. Playwright ran 15 tests (phase1, phase2, phase5), all passed; phase5 runs axe-core on every UI route that does not need scan data. `npx vitest run` ran 21 files, 246 tests, all passed (needs `TEST_DATABASE_URL`, `TEST_WORKER_DATABASE_URL`, `TEST_REDIS_URL`; DB and Redis tests skip without them). Playwright e2e covers register to authenticated scan to findings and the quick check. Results per requirement are in TRACEABILITY_MATRIX. Not covered: screen readers, browsers other than Chrome, real DNS and real-site robots, container sandbox, GitHub CI run, accuracy on real sites.

## 11. Vertical-slice e2e and deferred suites (PM decision 2026-11-11)

**Vertical-slice e2e (partly executed; see [PROJECT_STATUS](PROJECT_STATUS.md) for current results; no separate fixture-site journey exists yet):** Playwright test against the real stack and a fixture site: register → org → project → verify domain (DNS TXT stub resolver in test env / well-known file served by fixture) → start scan (robots respected) → crawl → axe findings with evidence → remediation shown → modify fixture → rescan → compare shows resolved/persistent/new. Owner: Phase 6 closes it; partial steps are exercised from Phase 1.

**Additional planned suites:** domain verification (token reuse across tenants, DNS TXT removal → expiry, revalidation before scan, apex vs. subdomain); robots policy (Disallow honored, crawl-delay honored, override recorded in config snapshot and audit log, verification alone does not bypass robots); account recovery (single-use, expiry, enumeration resistance).

**Deferred suites (not scheduled):** login fixtures, guided-session channel (T-GS-*), session-credential canary e2e, journey recorder, state-exploration destructive fixtures, custom-rule fixtures, scheduler dedup, public API/CLI contract, k6 performance (moved to pre-launch sanity check in roadmap Phase 9 only).
