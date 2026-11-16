# Project Status Register

Date: 2026-11-16 · **Verdict: MVP feature set code-complete (T0 to T10); NOT production ready.** See `docs/PRODUCTION_READINESS.md`.

## Authoritative current status (read this first)

This section replaces every earlier "Phase N awaiting review" or "nothing is committed" statement. Older phase text below is historical.

| Category                | State                                                                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote (GitHub) state   | GitHub `main` HEAD is **26d87ed**, as reported by the PM, with the implementation committed. **Not verifiable from this checkout**: it has no remote configured and its local `git log` holds only 3cfd471. Owner to confirm the real remote HEAD before release.          |
| Local working tree      | Local `main` is at 3cfd471 (Phase 0 scaffold and design docs) with about 148 changed or new paths uncommitted. This tree may differ from 26d87ed. Tooling never commits or pushes; the owner does. Every test result below is for this working tree, not for 26d87ed.      |
| Locally verified        | 2026-11-16, after the latest UI round: Vitest 31 files / 295 tests passed; Playwright 26 passed (Chrome, 2.9 min, fresh review DB `accessaudit_review2`); screenshots regenerated (product 72, journey 10, widths 82). tsc, eslint, prettier clean.                        |
| Automated tests, latest | 2026-11-16: Vitest 295/295, Playwright 26/26 (Chrome, automated only), including `e2e/review-fixes.spec.ts` and the execution/coverage badge assertion in `e2e/demo-journey.spec.ts`. An earlier failure of 65 tests was only `ECONNREFUSED` with Docker down.             |
| Manually verified       | Visual review of screenshots only. No hands-on keyboard pass, no screen reader pass, no non-Chrome browser pass. Automated reflow checks at 320/768/1280 px exist.                                                                                                         |
| Outstanding defects     | None known open. The latest UI changes passed automated checks against live demo data in Chrome only; no human has used them. The old dev DB still holds the previous demo org (append-only `audit_logs` blocks deletion); use a fresh database to see the new demo story. |
| Production blockers     | Listed in `docs/PRODUCTION_READINESS.md` (still NOT ready). Includes: no manual accessibility testing, no non-Chrome testing, no load or security test of a deployed environment, LLM remediation text is templates (not AI) for the MVP.                                  |
| Deferred features       | Journeys, custom rules, scheduling, integrations, public API/CLI, billing, real AI remediation.                                                                                                                                                                            |

Still open: manual keyboard pass, screen reader pass, non-Chrome browsers.

## HISTORICAL: earlier baseline (2026-11-13). Superseded by the table above

Kept for the record only. For current test status use "Authoritative current status" above. Older figures here and in TESTING_STRATEGY and TRACEABILITY_MATRIX are historical; where they differ, the authoritative table wins. The earlier 20 files / 242 tests and 21 files / 246 tests figures came from different points in time and are not reconciled with a current run.

Environment: Windows 11, PowerShell, Node v24.22.2, Vitest 5.1.0, Vite 8.3.8. Dev PostgreSQL 16 in Docker on 127.0.0.1:5433, dev Redis on 6379. Historical run on a working tree based on 3cfd471.

| Check                                                                                                                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc -b`                                                                                                                                        | passed, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npx eslint . --max-warnings=0`                                                                                                                     | passed, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npx prettier --check .`                                                                                                                            | passed, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run db:migrate` against dev DB                                                                                                                 | applied; 11 migrations (0000 to 0010) recorded; table `auth_profiles` exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npx vitest run --maxWorkers=2` (PowerShell; `TEST_DATABASE_URL`, `TEST_WORKER_DATABASE_URL`, `TEST_REDIS_URL` set; dev PostgreSQL and Redis)       | 31 files passed; 295 tests passed, 0 failed, 0 skipped; 60.0 s (re-run 2026-11-13 after the PM refinement round)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npx playwright test` (PowerShell; Chrome; API on 4000, web on 3000, worker, Redis, PostgreSQL up): phase1, phase2, phase5, phase6, phase7-ui-audit | 22 passed, 0 failed (1.5 min) after the PM refinement round: the 17 above plus the 5-test `demo-journey` spec on the seeded demo org (needs `npm run db:seed:demo`, and `BROWSER_CHANNEL=chrome` plus `DATABASE_URL` in the API environment or PDF export is reported unavailable). Earlier run: 17 passed after T1 to T10. Reflow checked at 320/375/768/1024/1280 px. Needs the worker running; a stale API process gave HTTP 500 on register until restarted. Four specs needed selector fixes for new page content (strict-mode matches on repeated text). |
| Manual keyboard, 320 px reflow by hand, screen reader, non-Chrome browsers                                                                          | **not done** (320 px reflow is checked automatically on the report, finding and checklist pages)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Test repairs made while establishing this baseline: e2e password selectors now use exact label matching (the show-password toggle also matches "Password"); the register test checks the signed-in name; the login-profile test opens the collapsed form; the report chart grid no longer overflows at 320 px. No product behaviour was changed to make tests pass.

Notes: Vitest fails every suite when started from Git Bash in this environment and passes from PowerShell; cause not investigated. Without the `TEST_*` variables, 13 files (85 tests) skip; they are listed in TESTING_STRATEGY. The `docs/PRODUCTION_READINESS.md` verdict stays NOT ready.

> **HISTORICAL sections follow (Phase 5, 4, 3, 2).** They record what was true on the dates shown, with older test counts. They are not current status.

## Phase 5 progress (2026-11-12, HISTORICAL)

Built: read-only `GET /orgs/{orgId}/overview` (latest completed scan per project, open confirmed and potential counts by severity, pending manual tasks, pages scanned versus not scanned, no composite score, no migration); organization overview page now shows these counts with a coverage caveat and keeps the getting-started checklist.

| Check                                                                                       | Result                                                       |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `npx tsc -b`, `npx eslint . --max-warnings=0`, `npx prettier --check .`                     | passed                                                       |
| `npx vitest run` (PowerShell, dev PostgreSQL, dev Redis)                                    | 21 files, 246 tests passed (4 new overview)                  |
| Playwright `e2e/phase5.spec.ts`: axe (WCAG 2.x A/AA, 2.2 AA) on public and signed-in routes | 2 tests passed, zero violations                              |
| Overview with real completed-scan data in the browser                                       | **not done** (API test covers the numbers)                   |
| Scan list returns open confirmed and potential counts; project page table shows them        | built; API test passes; not viewed in browser with real data |
| Empty/error/loading review of every data route                                              | done by code review; every route has all three branches      |
| Playwright phase1, phase2, phase5 rerun after all Phase 5 edits                             | 15 passed (includes quick-check live success)                |
| Manual keyboard, reflow (320 px) and reduced-motion pass in Chrome                          | **not done**                                                 |
| Screen reader testing, browsers other than Chrome                                           | **not done**                                                 |

The axe e2e does not reach report, finding or manual-checklist routes with data; the Phase 2 scan chain covers the report route only.

## Phase 4 progress (2026-11-12, uncommitted)

Code complete: fingerprints, finding workflow, template-only AI provider, scan comparison and coverage, JSON/CSV/HTML/PDF reports, scheduled scans (ADR-027), email notifications (ADR-028). Migrations 0008 and 0009 are created but not applied. The full test suite has not been rerun since these slices; the last full run was 247/247 before them. See `docs/PHASE_4_REVIEW.md`.

## Phase 3 progress (2026-11-12, uncommitted)

Built: three new heuristic form rules (identify input purpose, radio group without legend, required state only visual), and nine more controlled fixtures (25 in total: 21 inaccessible, 4 accessible).

| Check                                   | Result                                                             |
| --------------------------------------- | ------------------------------------------------------------------ |
| Engine suite (real Chrome)              | 2 files, 15 tests passed                                           |
| Engine precision and recall on fixtures | tp=22, fp=0, fn=0; precision 1.000, recall 1.000 (own corpus only) |
| Full Vitest (`--maxWorkers=2`)          | 247 passed                                                         |
| Playwright phase1, phase2, phase5       | 15 passed, with API, worker (Chrome channel), Redis, PostgreSQL up |
| Form submit testing                     | not done by policy (read-only)                                     |
| Measurement on real sites               | not done                                                           |

The one e2e failure seen during this phase was caused by the worker and Redis not running, not by product code.

## Phase 2 verification evidence (2026-11-12, working tree on 3cfd471, uncommitted)

| Check                                                                                                                                               | Result                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npx tsc -b`                                                                                                                                        | passed, no output                                                                                 |
| `npx eslint . --max-warnings=0`                                                                                                                     | passed, no output                                                                                 |
| `npx vitest run` (PowerShell, dev PostgreSQL on 5433, dev Redis; `TEST_DATABASE_URL`, `TEST_WORKER_DATABASE_URL`, `TEST_REDIS_URL` set)             | 20 files, 242 tests passed, 0 failed                                                              |
| Playwright (Chrome, real API, worker, Redis, PostgreSQL): authenticated scan chain, quick-check private-address refusal, quick-check page axe check | passed earlier in the phase (scan chain 6.1 s). Not rerun after the last formatting-only edits    |
| Playwright: quick-check live success against example.com                                                                                            | **not rerun** after the shown-once change; the per-IP limit blocked the rerun (see known defects) |
| Migrations applied to dev Postgres; 124 rules seeded                                                                                                | applied by the user, confirmed                                                                    |
| `npm audit --omit=dev`                                                                                                                              | 0 vulnerabilities                                                                                 |
| `npm audit` (full)                                                                                                                                  | 11 moderate, dev tooling only                                                                     |
| Screen reader testing                                                                                                                               | **not done**                                                                                      |
| Browsers other than Chrome                                                                                                                          | **not done**                                                                                      |
| Real DNS and real-site robots.txt tests                                                                                                             | **not done** (injected fakes and local fixtures)                                                  |
| Container-level browser sandbox                                                                                                                     | **not done** (apps run on the host)                                                               |
| CI workflow `.github/workflows/ci.yml`                                                                                                              | **not executed** on GitHub                                                                        |

Requirement-level results are in [TRACEABILITY_MATRIX](TRACEABILITY_MATRIX.md), "Phase 2 results".

## Completed (Phase 2)

- Domain-verified scans: SSRF gate, egress proxy with DNS pinning, per-request revalidation, isolated Chrome context, robots.txt policy with an admin-only audited override.
- Crawler: frontier, sitemap and link discovery, coverage statuses, failed navigations recorded.
- Engine: axe-core, versioned rule registry (124 rules), WCAG 2.2 mapping, DOM, computed CSS and accessible-name evidence, screenshots.
- Read-only interaction tests: keyboard, focus, dialog, form, menu, tabs and accordion, dynamic content.
- Normalization, deduplication by stable fingerprint, confidence, classification (confirmed, potential, manual verification), validation (no finding without evidence).
- Manual verification tasks and checklist.
- Scan API (start, cancel, list, detail, findings, review status, manual tasks), BullMQ worker, tenant isolation with RLS.
- Web UI: scan start, report, finding detail with evidence, manual checklist, quick check. Design system in ADR-025.
- Anonymous quick check (ADR-026): proof-of-work, per-IP and global limits, kill switch, shown-once result.

## Incomplete requirements

- Manual verification: task completion exists (status and note); reviewer assignment, history and re-verification are Phase 6.
- Custom rules (REQ-A11Y-03) beyond the interaction checks: deferred.
- Dashboard aggregates (REQ-PLAT-06), issue lifecycle (REQ-ISS-01), scan comparison (REQ-HIST-01), AI layer, reports, API keys: later phases.
- Authenticated scanning: built under ADR-031 (API, worker and web UI); migration 0010 applied and API/worker tests pass; the UI e2e (`e2e/phase6.spec.ts`) is written but not yet run. Billing, enterprise RBAC, advanced MFA: deferred by decision.

## Known defects

- Quick-check live success e2e passed on rerun 2026-11-12 (Phase 5). The per-IP limit can still block repeated runs until `qc:*` keys expire.
- Older rows in the first TRACEABILITY_MATRIX table still say "not executed" for items that the Phase 2 table now records.
- No other confirmed open defects in tested code.

## Technical debt

- Rate limits for authentication remain in memory per process.
- Mailer: `HttpMailer` exists (unit-tested with a fake fetch) but has not been used against a real provider; the log mailer is the default.
- Web client types are hand-duplicated from API schemas; no frontend unit tests.
- Two slice A tests are weak and could assert more.
- Interaction-test precision and recall are measured only on controlled fixtures.
- 11 moderate dev-tooling advisories; fixes need a typescript-eslint update or a drizzle-kit major, not applied.
- Install scripts of argon2 and esbuild were not run (`--ignore-scripts`); native rebuilds are manual.

## Security risks (residual)

- Chromium escape; no container-level sandbox yet.
- Egress proxy cannot inspect TLS; redirect policy is enforced in the browser layer.
- Quick check from many addresses: bounded by global caps and the kill switch only (T-QC-05).
- Per-IP limit depends on the trusted-proxy setting behind a proxy.
- Screenshots may capture PII that redaction misses.
- SameSite=Lax cookies assume web and API share a site.
- Dev passwords are throwaway and must be rotated before shared use.

## Deferred features

Recorded-journey and MFA logins, custom rule builder, GitHub and Jira integrations, public API and CLI, billing, enterprise administration, TOTP MFA, AI explanations from a real model (interface and offline stub exist). Scheduling, scan comparison and PDF reports are built.

## Decision log

Decisions 1 to 9 (PM-approved 2026-11-11) unchanged. ADR-023 Vite + React. Added in Phase 2: ADR-025 UI stack and design system (plain CSS tokens, lucide-react, React Router, no score, text labels not colour alone); ADR-026 anonymous quick check. Merged scope for phases 2 to 4 approved by the PM. Installed with approval: playwright-core, axe-core, bullmq, ioredis. `@axe-core/playwright` is not installed.

## Open items

- Original master spec is not in the repo as a file; docs cite it by Part number.
- Internal or staging hosts cannot be verified; accepted MVP limitation.
- Vitest failed from Git Bash in this environment but passes from PowerShell. Use PowerShell.
- Commit state: see "Remote (GitHub) state" and "Local working tree" at the top. Tooling never commits or pushes.
- Manual accessibility validation: protocol and results sheet in `docs/MANUAL_ACCESSIBILITY_VALIDATION.md`, every row NOT DONE, pending a human.
