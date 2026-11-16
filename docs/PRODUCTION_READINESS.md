# Production Readiness Report

> Test and verification status: the single authority is [PROJECT_STATUS](PROJECT_STATUS.md), section "Current verified baseline". Figures below are historical.

Date: 2026-11-16 · Current state: see the authoritative table in `docs/PROJECT_STATUS.md` · **Verdict: NOT ready for production release.** (Earlier text below is historical. Latest verified on the local working tree, 2026-11-16: Vitest 295/295 and Playwright 26/26 in Chrome. Manual accessibility testing is NOT done: see `docs/MANUAL_ACCESSIBILITY_VALIDATION.md`. GitHub `main` 26d87ed is PM-reported and not verified from this checkout.)

Critical requirements from the Phase 5 brief are unimplemented, and the newest code has not been through a full test run. Nothing below should be read as a readiness claim.

## Blocking gaps

1. **Authenticated scanning (acceptance steps 5 to 7) passes its integration tests but has had no end-to-end or real-site run.** ADR-031 (2026-11-12) covers form login with encrypted write-only credentials, an in-memory session in the worker, a login-only POST exception and sign-out link skipping. Migration 0010 applied and `auth-profiles.test.ts` (4) plus the two login tests in `worker.integration.test.ts` passed on 2026-11-12 against a local fixture site. Not covered: real sites, MFA, recorded journeys. A web UI now exists (login profile list, add and delete on the project page, and a "Sign in with" choice on the scan form); it passes typecheck and lint, and `e2e/phase6.spec.ts` (empty state, validation, axe) is written but has not been run. A rejected login now fails after 10 s.
2. **Credential encryption** is implemented (AES-256-GCM, per-secret context binding, key id for rotation) and covered by tests. The key comes from an environment variable; there is no KMS integration.
3. **Mail delivery is untested against a real provider.** `HttpMailer` posts JSON to `MAIL_API_URL` and is unit-tested with a fake fetch; the dev log mailer remains the default when it is unset.
4. **Container-level browser isolation only partly checked.** Chromium runs behind an egress proxy and a restricted context. On 2026-11-12 the user ran `scripts/sandbox-check.mjs` inside the worker image with `--read-only`, `--tmpfs /tmp`, `--cap-drop ALL` and `no-new-privileges`: Chromium launched with its own sandbox enabled and with `--no-sandbox`, so `BROWSER_NO_SANDBOX` is not needed in that configuration. This is one Docker Desktop host only; it was not run on the production host, and it shows that Chromium starts, not that the sandbox contains an escape.
5. ~~Migrations 0008 and 0009 unapplied~~ Resolved 2026-11-12: applied, full suite 262/262.
6. **Production Docker: api, web and worker images build; only the api image has been run.** The api image runs as a non-root user and answers `/healthz` and `/readyz` (2026-11-12, run by the user). On 2026-11-12 the compose file passed `docker compose config` with dummy values; the web image served `/` and a deep link with 200; the worker image, run read-only with all capabilities dropped and no-new-privileges, ran as uid 1000, had Chromium installed and printed `worker ready` (it then failed to reach the dummy database, as expected). Chromium also launched inside that hardened container (see item 4). Not done: a full `compose up` with real services.
7. **No AI explanations from a real model.** Only an offline template provider exists, by decision. The brief item "AI-powered explanations" is therefore met only in template form.

## Acceptance flow (13 steps)

| #   | Step                             | Status                                                           |
| --- | -------------------------------- | ---------------------------------------------------------------- |
| 1   | Register                         | Works; covered by e2e (phase1)                                   |
| 2   | Create organization              | Works; e2e                                                       |
| 3   | Create project                   | Works; e2e                                                       |
| 4   | Scan a public website            | Works on verified domains; e2e (phase2).                         |
| 5   | Configure authenticated scanning | Built (API and web UI); API integration tests pass, UI e2e unrun |
| 6   | Guided authentication            | Selector-based form login in the worker; fixture test passes     |
| 7   | Scan protected pages             | Built; worker integration test passes on a local fixture         |
| 8   | Review genuine findings          | Works; classification separates confirmed, potential and manual  |
| 9   | Understand recommended fixes     | Template remediation text only                                   |
| 10  | Manage issues                    | Assignment, comments, status, history built                      |
| 11  | Run another scan                 | Works; manual and scheduled (0008 applied)                       |
| 12  | Review regressions               | Comparison built and tested alone; 0009 applied                  |
| 13  | Export report                    | JSON, CSV, HTML built; PDF not verified by eye                   |

## Completed

Identity, organizations, tenancy with row-level security, domain verification, SSRF-safe crawler and egress proxy, accessibility engine (axe-core, 124-rule registry, WCAG 2.2 mapping, interaction tests, three heuristic form rules, 25 fixtures), findings review UI, manual checklist, anonymous quick check, overview aggregates, fingerprints, issue workflow, comparison and coverage, reports, scheduled scans, notifications, CI workflow file, health endpoints, structured redacted logging.

## Security review summary

| Area                               | State                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication                     | argon2id, cookie sessions, in-memory auth rate limits (per process, lost on restart, not shared across replicas)                           |
| Authorization and tenant isolation | Roles checked per route; RLS enabled and forced on tenant tables with tests                                                                |
| SSRF and network isolation         | Verified-domain gate, DNS pinning, per-request revalidation, egress proxy. Proxy cannot inspect TLS. No host-level egress firewall shipped |
| Browser session                    | Isolated context per scan; Chromium sandbox launches in hardened worker container (one dev host, no escape test)                           |
| XSS and CSRF                       | helmet headers, SameSite=Lax cookies; assumes web and API share a site. No dedicated CSRF token. Not penetration tested                    |
| Secrets                            | Env-driven; dev passwords throwaway. Removed built-in database URLs from e2e files in this pass                                            |
| Dependencies                       | 11 moderate dev-tooling advisories unfixed                                                                                                 |
| Sensitive data                     | Screenshots may capture personal data that redaction misses                                                                                |

## Reliability and performance

- Queue: BullMQ with Redis. A sweep in the API scheduler fails scans stuck in `running` past `STUCK_SCAN_MINUTES` (reason `worker_lost`); it does not re-queue, and `queued` scans lost with Redis still need manual re-queue.
- Duplicate prevention: schedule claims and notification claims are compare-and-set; tested only once migrations are applied.
- Not measured: large-site crawls, concurrent scans, memory use, API latency. No load tests exist.
- `/readyz` checks the database and Redis.

## Operations

| Item                   | State                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured logging     | Done for API (pino JSON, redaction); worker uses console JSON lines                                                                                                              |
| Health checks          | `/healthz`, `/readyz`                                                                                                                                                            |
| Monitoring and metrics | Basic `/metrics` (token-protected); no alert rules or dashboards                                                                                                                 |
| Error tracking         | Webhook reporter for unhandled errors (`ERROR_WEBHOOK_URL`); no Sentry-style grouping or alerting                                                                                |
| Backup and recovery    | Documented in `docs/DEPLOYMENT.md`; restore drill run 2026-11-12 on the dev DB (pg_dump -Fc, pg_restore into a scratch DB, 1396 users in both). Not run on production-sized data |
| CI/CD                  | `.github/workflows/ci.yml` exists; never run on GitHub. No deploy pipeline                                                                                                       |
| Production Docker      | `Dockerfile`, `.dockerignore`, `infra/docker/docker-compose.prod.yml`; images built; compose config validated; web and worker started briefly; no full compose up yet            |

## Test results

- Full Vitest run 2026-11-12 after migrations 0008 and 0009: 26 files, 262/262 passed. After adding ops.test.ts (readiness, metrics, stuck-scan sweep) the full suite was rerun with all four test environment variables set: 27 files, 265/265 passed, 0 skipped. Run by the user; includes the schedule, notification, compare and report slices. The mailer and error-reporter tests (`mail-errors.test.ts`, 4 tests) were added afterwards and passed on their own run; the full suite has not been rerun since.
- 2026-11-12 after applying migration 0010 and capping the login verification wait at 10 s: full Vitest run, 30 files, 278/278 passed, 0 skipped (run by the user). The rejected-login worker test now takes about 10.6 s instead of 30.6 s. Playwright has not been rerun since the authenticated-scanning changes.
- Playwright (phase1, phase2, phase5): 15/15 passed on 2026-11-12 (40s), run by the user with the worker running against installed Chrome (BROWSER_CHANNEL=chrome). An earlier run failed the quick-check test because no worker was running.
- Engine fixture corpus: tp 22, fp 0, fn 0 on controlled fixtures only; does not predict real-site behaviour.
- 2026-11-12 UI hardening and audit, run by the user: `e2e/phase6.spec.ts` (login profiles) and `e2e/phase7-ui-audit.spec.ts` passed. The audit covers home, login, register, organizations (empty), organization overview, projects, members, settings, account, project detail and the 404 page. Per page it checks no horizontal scroll at 320, 768 and 1280 px, zero axe violations (WCAG 2.0/2.1/2.2 A and AA tags), a page title, a skip link as first Tab stop, and that the mobile menu closes on Escape. Fixes made from it: per-route page titles, an error boundary, a stronger focus ring, global reduced-motion handling, Escape to close the mobile menu, a skip link on the login and register pages, and a narrow-screen fix for the landing header. Screenshots go to `e2e-screenshots/` (git-ignored) for a human to review.
- Screenshot review (2026-11-12, by the developer from the saved images): found the "Menu" button showing on desktop widths, because `.btn` set `display: inline-flex` after `.menu-toggle { display: none }`; fixed by raising specificity. Also stopped the top-bar buttons wrapping on narrow screens and darkened the moderate-severity bar fill to meet 3:1 against its track. A code read of the report, finding-list and export components found proper table captions and scopes, labelled filter groups, live regions for loading and errors, and colour-independent severity text. These fixes have not been re-run through Playwright yet.
- 2026-11-12 `e2e/phase2.spec.ts` was extended to run axe and a 320/768/1280 px reflow check on the scan report, finding detail and manual checklist pages using real scan data. The first run found a 3 px horizontal overflow on the report at 320 px, traced by a probe to a long export button label with no max width; fixed with `max-width: 100%` and wrapping on `.btn`. The rerun passed (user, 2026-11-12). Screenshot review of that run then found the report's pages table squeezing its columns to one letter per line at 320 px; fixed with a minimum table width so it scrolls inside its wrapper. That second fix has not been re-run or re-viewed.
- UI not covered: exported PDF appearance and further visual polish. These need a person.
- Not done: manual keyboard, reflow and reduced-motion pass of our own UI (automated checks above are not a substitute); screen reader testing; non-Chrome browsers; real DNS and robots.txt tests; security tests beyond unit and integration coverage; load tests.

## Deployment requirements

PostgreSQL 16 with owner and role passwords set, Redis 7, Chromium in the worker image, TLS reverse proxy, a real mail transport (to be built), secret storage, host egress firewall for the worker, and `ALLOW_PRIVATE_TARGETS=false`. See `docs/DEPLOYMENT.md`.

## What is needed to reach a release decision

1. Authenticated scanning: `e2e/phase6.spec.ts` passes; a real-site trial is still needed.
2. Apply migrations, run the full suite and e2e, fix what fails.
3. Build and run the Docker images; run a staging deploy and a restore drill.
4. Point the mailer and error webhook at real services, and add alert rules on top of `/metrics`.
5. Run the manual accessibility pass on our own UI and an external security review.
