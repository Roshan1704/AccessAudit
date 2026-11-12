# Implementation Roadmap

Status: Draft v0.2 (revised for PM decisions of 2026-11-11) · Date: 2026-11-11

Rules: no phase starts without explicit PM approval; a phase closes only when its acceptance-criteria tests are **executed and passing** (TESTING_STRATEGY §1); each phase ends with a Product and Engineering Review Report. Before each feature: state business objective, user problem, approach, dependencies, acceptance criteria, risks.

MVP scope: **public-site scanning on verified domains** (ADR-019). Authenticated scanning and the other deferred items are designed but not scheduled. Extensibility hooks that are cheap are kept (anonymous scan profile row, `profile_id` on pages/findings, `SessionManager` and `StateExplorer` extension points); auth-specific tables and endpoints are **not** created in MVP migrations.

The threat-model gate (SECURITY_THREAT_MODEL [Gate]) precedes any crawler/browser code. The UI starts early through a thin vertical slice (below) and is not left to the end.

Order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Phase 5 (UI) begins as a thin slice during Phase 1 and grows in step with each backend phase.

---

## Early vertical slice (plan only; nothing built yet)

A user can: (1) submit a verified public URL, (2) start a scan, (3) crawl supported pages, (4) run accessibility checks, (5) view findings with evidence, (6) see a recommended remediation, (7) rescan and compare.

| Slice step                                                  | Delivered in                                           | Minimal UI delivered with it                                   |
| ----------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Sign up, org, project, verify domain (DNS TXT / well-known) | Phase 1                                                | register/login, project + domain verification page             |
| Start scan, progress, coverage statuses                     | Phase 2                                                | scan start form, live progress (SSE), coverage list            |
| axe-core run, findings with evidence                        | Phase 3–4                                              | findings list + detail with evidence (screenshot, DOM snippet) |
| Recommended remediation                                     | Phase 4 (static rule guidance) → Phase 7 (AI-assisted) | remediation panel from rule registry guidance, no AI needed    |
| Rescan and compare                                          | Phase 6                                                | compare view: new/persistent/resolved/reappearing/unknown      |

Rule: each phase's UI increment ships in that phase against the real stack; no mock data, no fake screens. The slice is complete when an e2e test runs steps 1–7 against a fixture site (TESTING_STRATEGY §5a). Result: not executed.

---

## Phase 0 — Foundation (current; closes on PM approval of this revision)

- Scaffold + design docs + PM-decision reconciliation + clean initial commit on `main`.
- **Acceptance:** PM approves docs; no app code or dependencies exist.

## Phase 1 — Identity, tenancy, domain verification

- **Features:** register/login/logout, server-side sessions, CSRF, rate limiting/lockout, password security (argon2id), account recovery, orgs/members/RBAC/invitations, audit log, projects, **domain verification** (DNS TXT primary, well-known alternative; status + timestamps; revalidation), `UrlPolicy` in `packages/security`, `withTenant` + RLS, `KeyProvider` (env implementation), minimal web shell (auth + project + domain pages) to start the slice.
- **Deferred inside this phase:** TOTP MFA, SSO/OIDC, customer-facing API keys beyond what the app itself needs (extensible).
- **Files:** `packages/{shared,security,db}`, `apps/api`, `apps/web` shell, migrations.
- **DB:** identity/tenancy tables, `projects`, `project_settings`, `authorized_domains`, roles `aa_*`, RLS, immutability triggers.
- **Tests:** UrlPolicy encoding table, RLS cross-tenant matrix, RBAC matrix, session/CSRF/recovery suites, domain-verification suite (token reuse, DNS removal, revalidation, cross-tenant claim), e2e register → project → verify domain against fixture.
- **Acceptance:** cross-tenant matrix green; unverified/expired domain scans refused at API; CI running typecheck/lint/tests.

## Phases 2 to 4 — MERGED into one phase (ADR-026, PM decision 2026-11-11); built 2026-11-12, awaiting PM acceptance

Delivered together: SSRF and browser isolation gate, crawler, worker and queue, accessibility engine, normalization and classification, findings and manual verification, findings UI, and the anonymous quick check. Results and gaps are in TRACEABILITY_MATRIX (Phase 2 results) and PROJECT_STATUS. The three sections below are kept as the original scope definition.

## Phase 2 — Safe public crawler (SSRF and browser isolation first)

- **Gate:** egress proxy + SSRF/rebinding/redirect suites (T-SSRF-01..07) and browser-isolation tests (T-BRW-01..04) executed and passing **before** crawler code merges.
- **Features:** egress proxy, worker + BullMQ, scan state machine, Frontier, Normalizer, sitemap/link/seed/user-URL producers, **robots.txt policy (ADR-018) with auditable override**, PageRunner, coverage tracker, failure classification, cancel/resume, anonymous profile row, scan events (SSE); UI: scan start, progress, coverage.
- **DB:** `scans`, `scan_profiles` (anonymous only), `scan_jobs`, `crawled_pages`, `page_snapshots`, `scan_coverage_items`.
- **Acceptance:** fixture scans reach correct terminal states; every discovered URL has an explicit coverage status (including `excluded_by_robots`); zero connections reach internal fixtures; override recorded in config snapshot and audit log.

## Phase 3 — Accessibility engine

- **Features:** AxeRunner, versioned rule registry, supported WCAG mappings, per-scan engine versions.
- **DB:** `accessibility_rules`, `rule_versions`.
- **Acceptance:** documented precision/recall on the a11y fixture corpus (no claim beyond measured).

## Phase 4 — Finding normalization, classification, evidence, validation

- **Features:** normalization, validation pipeline, classification/confidence, fingerprinting, `findings` + immutable `finding_occurrences` + evidence with redaction, manual-verification tasks, static remediation guidance per rule; UI: findings list/detail with evidence and remediation.
- **DB:** `findings`, `finding_occurrences`, `finding_evidence`, `manual_verification_tasks`.
- **Acceptance:** no finding without evidence; `confirmed` only with deterministic evidence; fingerprint stability tests; XSS-from-scanned-content suite.

## Phase 5 — Essential UI hardening (WCAG 2.2 AA self-compliance)

- Grows from the slice; this phase consolidates: dashboards with real aggregates only, empty/error/loading states, keyboard/screen-reader pass, axe on every route.
- **Acceptance:** zero serious/critical self-audit findings; no mock data.

## Phase 6 — Finding management, scan comparison, regression verification

- **Features:** finding lifecycle, comments, assignment, history, comparison (new/persistent/resolved/reappearing/unknown), probable-move review, template grouping; rescan-and-compare UI.
- **DB:** `finding_comments`, `finding_assignments`, `finding_history`.
- **Acceptance:** compare never reports `resolved` for uncovered pages; status change + history + audit atomic.

## Phase 7 — AI-assisted explanations and remediation

- **Gate:** T-LLM-01/02 canary and injection tests executed and passing.
- **Features:** opt-in per org, provider adapters, redacted context, explanations/remediation labeled AI-generated; AI never alters classification/severity/confidence.
- **DB:** `ai_explanations`.

## Phase 8 — HTML/PDF reports

- **Features:** HTML and PDF (plus CSV/JSON) reports with coverage caveats, limitation statement, robots-override disclosure; expiring share links.
- **DB:** `reports`.
- **Tests:** report HTML escaping; share-link suite (T-TEN-06).

## Phase 9 — MVP release validation, security review, hardening

- **Features:** full e2e vertical slice on real stack, dependency audit, secret scan, backup/restore drill, retention jobs, org-delete purge, security review (internal; independent pen-test recommended before paid launch), performance sanity check on representative scans, operational runbook.
- **Acceptance:** all [Gate] controls executed and passing; defects triaged; restore drill documented.

---

## DEFERRED (kept in long-term vision; not scheduled; not deleted)

| Item                                                | Docs holding the design                        | MVP extensibility kept                                                          |
| --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Authenticated crawling                              | AUTHENTICATION_ARCHITECTURE Part B, CRAWLER §4 | anonymous `scan_profiles` row, `profile_id` columns, `SessionManager` interface |
| Guided authentication (ADR-009)                     | AUTH Part B.4                                  | none beyond the above; passkey limits documented                                |
| Session recording and replay (journeys)             | AUTH B.5                                       | journey producer interface                                                      |
| Advanced state discovery                            | CRAWLER §6                                     | `StateExplorer` interface                                                       |
| Custom rule builder / custom rules                  | ACCESSIBILITY_ENGINE §4–5                      | rule registry accepts rule source field                                         |
| Scheduled scanning                                  | DATABASE `scheduled_scans`                     | scans created via one service function                                          |
| GitHub/Jira integrations                            | API §5                                         | none needed                                                                     |
| Public API and CLI                                  | API §5                                         | OpenAPI generated; internal API only                                            |
| Billing and subscriptions                           | —                                              | per-org quotas                                                                  |
| Enterprise administration (SSO, SCIM, audit export) | —                                              | RBAC + audit log                                                                |
| TOTP MFA (not an MVP blocker)                       | AUTH Part A                                    | factor table can be added without touching `users`/`sessions`                   |

## Open decisions

None blocking Phase 1 in the docs. Unverified items are listed in PROJECT_STATUS (dependency versions, reference-document location).
