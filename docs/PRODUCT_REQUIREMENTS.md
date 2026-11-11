# AccessAudit — Product Requirements Document

Status: Draft v0.1 for approval · Date: 2026-11-11
Source of truth: the approved master specification (Parts 1–32). Requirement IDs below (`REQ-*`) are referenced by `TRACEABILITY_MATRIX.md`.

## 1. Product statement

AccessAudit is a SaaS platform that finds genuine accessibility barriers on public and authenticated websites, collects DOM/screenshot evidence, explains real-world impact, recommends fixes, and verifies improvements through later scans.

Promise: **discover → evidence → explain → fix → verify.**

Non-promises (must be reflected in UI copy, reports and marketing):

- AccessAudit is **not** a WCAG certification or legal-compliance tool.
- Automated testing cannot establish full conformance; manual-verification items are first-class output.
- Universal compatibility is not guaranteed. Sites needing special configuration or human action must say so explicitly.
- An aggregate health indicator is **not** an official WCAG conformance percentage.

## 2. Users and problems

| Persona | Problem | What they need |
|---|---|---|
| Developer | Scanner output is noisy, unactionable | Evidence, stable selectors, code-level fixes, verification steps |
| QA engineer | Cannot reach authenticated/stateful UI | Guided login, journeys, state discovery, regression diffing |
| Accessibility consultant | Must defend findings to clients | Confidence levels, classification, WCAG mapping, branded reports, honest limits |
| Agency / enterprise lead | Multi-site, multi-role oversight | Orgs, projects, roles comparison, trends, scheduled scans, API/CI |

## 3. Scope

### In scope (MVP — PM decision 2026-11-11)
Public-site scanning on verified domains: identity/tenancy, domain verification, safe crawler, axe-core engine with supported WCAG mappings, finding normalization/classification/evidence, essential UI (thin vertical slice early), finding management and scan comparison, AI-assisted explanations, HTML/PDF reports, release validation. Order in `IMPLEMENTATION_ROADMAP.md`.

### Deferred (kept in long-term vision, not scheduled)
Authenticated crawling; guided authentication; session recording/replay (journeys); advanced state discovery; custom rule builder (REQ-A11Y-03/04 custom parts); scheduled scanning (REQ-MON-01); GitHub/Jira integrations (REQ-INT-01); public API and CLI (REQ-API-01 external surface; an internal API exists); billing and subscriptions; enterprise administration; TOTP MFA (not an MVP blocker).

### Explicitly out of scope
- CAPTCHA, MFA, or identity-provider bypass (user-assisted only).
- Automatic WCAG certification or VPAT generation.
- Destructive/state-changing interactions outside an approved isolated test workflow.
- Scanning any domain the organization has not proven it is authorized to scan.
- Billing (marked "if implemented" in spec) — **deferred**; see `PROJECT_STATUS.md`.

## 4. Functional requirements

IDs are grouped by master-spec part. Priority: P0 = release blocker, P1 = release target, P2 = may defer with documentation.

### 4.1 Platform foundation
- REQ-PLAT-01 (P0) Registration, login, logout, session management.
- REQ-PLAT-02 (P0) Organizations with membership and roles (owner, admin, member, viewer); invitations.
- REQ-PLAT-03 (P0) Strict tenant isolation (app-layer checks + database RLS).
- REQ-PLAT-04 (P0) Multiple projects per organization; project settings.
- REQ-PLAT-05 (P0) Audit log of security-relevant actions.
- REQ-PLAT-06 (P1) Dashboard with real aggregates only (never fabricated).

### 4.2 Domain authorization
- REQ-AUTHZ-01 (P0) A project must prove control of a scan domain by DNS TXT (primary) or well-known file (alternative) before any scan. Audited attestation alone is not proof and is not offered. Method, status and timestamps are persisted; domains are revalidated periodically and before each scan (ADR-017).
- REQ-AUTHZ-02 (P0) Scans limited to explicitly verified domains (allow-list per project).
- REQ-ROBOTS-01 (P0) Respect robots.txt `Disallow` and `Crawl-delay` by default; verified owners may enable an explicit, reasoned, auditable per-scan override recorded in scan config and audit history; verification never implies override (ADR-018).

### 4.3 Crawling (Parts 3–4, 7)
- REQ-CRAWL-01 (P0) Public crawl from a URL: normalize, validate, render in browser, discover links, sitemap, redirects, dedupe.
- REQ-CRAWL-02 (P0) Configurable: max pages, depth, timeouts, concurrency, retries, include/exclude patterns, query-parameter handling, crawl delay.
- REQ-CRAWL-03 (P0) Queue-based discovery; loop prevention; no external domains unless authorized.
- REQ-CRAWL-04 (P0) Failed navigation recorded, not dropped.
- REQ-CRAWL-05 (P0) All strategies (public, authenticated, journeys, state discovery, user URLs, sitemap) feed one shared discovery → scan pipeline.
- REQ-CRAWL-06 (P1) JS-rendered/SPA discovery (route changes, history API, rendered anchors).
- REQ-CRAWL-07 (P1) Infinite-scroll handling with bounded scroll budget.

### 4.4 Authentication strategies (Part 4.2–4.4) — **DEFERRED, not in MVP** (ADR-009, ADR-019). Requirement text retained; priorities below apply to the future auth phase.
- REQ-AUTH-01 (P0) Credential login profile (semantic Playwright locators, custom selectors, success/failure indicators, verification — a click is not proof of login).
- REQ-AUTH-02 (P0) Guided manual browser authentication (isolated remote browser, user logs in, MFA, confirms; storage state captured and encrypted).
- REQ-AUTH-03 (P0) Encrypted session storage with domain, project, and organization binding; expiry; health checks; re-authentication; secure cleanup.
- REQ-AUTH-04 (P1) Navigation journeys: record, review, edit, save, replay; semantic actions; sensitive values never recorded.
- REQ-AUTH-05 (P0) Multiple authentication profiles per project, isolated; cross-role comparison.
- REQ-AUTH-06 (P0) MFA/OTP/SSO/CAPTCHA handled only via pause → request user → resume. No bypass; no repeated retries (lockout protection).
- REQ-AUTH-07 (P0) Classified auth failures (invalid creds, expired session, MFA, CAPTCHA, lockout, redirect, network, denied, state mismatch); public results preserved; protected scanning halted; scan marked partial.
- REQ-AUTH-08 (P0) Session material never reaches the frontend, logs, or LLM.

### 4.5 Application state discovery (Part 5) — **DEFERRED, not in MVP**
- REQ-STATE-01 (P1) Safe interaction with dropdowns, tabs, accordions, modals, menus, expandable panels, search overlays.
- REQ-STATE-02 (P0) Read-only default policy; destructive heuristics block clicks (purchase, delete, publish, pay, submit on non-approved forms).
- REQ-STATE-03 (P1) Approved test workflows for state-changing paths in dedicated test environments only.

### 4.6 Coverage intelligence (Part 6)
- REQ-COV-01 (P0) Track discovered/scanned/skipped/inaccessible/auth-required/failed/excluded URLs, states discovered/tested, journeys completed/failed.
- REQ-COV-02 (P0) Show coverage by URL, profile, role, category, journey, state.
- REQ-COV-03 (P0) Status taxonomy: audited, partially audited, not audited, inaccessible, requires authentication, requires manual testing.
- REQ-COV-04 (P0) Never display "complete coverage" while pages remain undiscovered/inaccessible; coverage review before an audit is treated as complete.

### 4.7 Accessibility engine (Parts 8, 9, 10, 27)
- REQ-A11Y-01 (P0) axe-core + Playwright scanning, WCAG 2.0/2.1/2.2 A/AA (+applicable AAA).
- REQ-A11Y-02 (P0) Versioned rule registry with W3C-sourced criterion mappings; axe-core and custom-rule versions recorded per scan.
- REQ-A11Y-03 (P1) Custom rules: focus visibility/obscured, target size, reflow, text spacing, keyboard traps, consistent navigation, accessible authentication.
- REQ-A11Y-04 (P1) Interaction tests: keyboard, dialog, form, menu, tabs/accordion, dynamic content.
- REQ-A11Y-05 (P0) Validation pipeline producing classification (confirmed / strong potential / manual verification / informational / passed) and confidence; deterministic first; an LLM can never upgrade a classification.
- REQ-A11Y-06 (P0) Finding record contains all fields listed in spec Part 10.
- REQ-A11Y-07 (P1) Manual verification workflow (tasks with instructions, result capture).

### 4.8 AI assistant (Part 11)
- REQ-AI-01 (P1) Provider-independent LLM layer (OpenAI, Anthropic, Gemini, OpenAI-compatible self-hosted) with structured, schema-validated outputs, timeouts, retries.
- REQ-AI-02 (P1) Per-finding explanation, impact, affected groups (evidence-supported only), WCAG explanation, remediation, code examples, verification steps; labeled AI-generated.
- REQ-AI-03 (P0) AI failures never block scanning; AI never sees credentials/sessions; data minimization and redaction before send; per-org opt-in.

### 4.9 Issues, history, regression (Parts 12, 15)
- REQ-ISS-01 (P1) Lifecycle statuses, assignment, comments, internal notes, priority, due dates, history, external ticket refs, reopen.
- REQ-ISS-02 (P0) Stable finding fingerprints; dedup; grouping by rule/component/URL pattern/selector/template/page; per-page evidence preserved.
- REQ-HIST-01 (P0) Immutable scan records; new/resolved/persistent/reappearing; severity/confidence/coverage changes; compare any two scans.

### 4.10 Reporting (Part 16)
- REQ-RPT-01 (P1) PDF, CSV, JSON, HTML with mandatory content and limitation statement.
- REQ-RPT-02 (P2) Branding, expiring public links, download permissions.

### 4.11 Monitoring, API, integrations (Parts 17–18)
- REQ-MON-01 (P1) Scheduled scans; retries, cancel, progress, duplicate prevention; pause on re-auth; notifications.
- REQ-API-01 (P0) Versioned REST API `/api/v1` with API keys, RBAC, rate limiting, validation, pagination, consistent errors, OpenAPI.
- REQ-INT-01 (P1) GitHub + CI check integration. (P2) GitLab, Jira, Linear, Slack — planned only; never stubbed as working.

### 4.12 Dashboard & UI (Parts 13, 14, 23)
- REQ-UI-01 (P0) All required pages (Part 23) with loading/empty/error states; real data only.
- REQ-UI-02 (P0) The application itself meets WCAG 2.2 AA (self-audited by AccessAudit and axe in CI).
- REQ-UI-03 (P0) Health indicator: documented method, never labeled as conformance, critical findings always surfaced regardless of aggregate.
- REQ-UI-04 (P1) Finding detail view with all 18 elements from Part 14.

## 5. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-SEC-01 | SSRF-safe crawling (see `SECURITY_THREAT_MODEL.md`); security controls designed and tested before crawler code. |
| NFR-SEC-02 | Credentials/sessions encrypted at rest (AES-256-GCM, versioned keys); never logged. |
| NFR-PRIV-01 | Retain private page content only as long as needed; configurable retention. |
| NFR-PERF-01 | Progressive results: first findings visible before the scan finishes. |
| NFR-SCALE-01 | Horizontally scalable stateless workers; per-org quotas. |
| NFR-REL-01 | Completed page results survive later failures; jobs resumable and idempotent. |
| NFR-OBS-01 | Structured logs with request/scan IDs, metrics, tracing (OpenTelemetry). |
| NFR-OPS-01 | Fresh clone → running stack with documented steps. |

## 6. Release definition of done
Mirrors master-spec Part 31. Tracked item by item in `TRACEABILITY_MATRIX.md`; nothing is "done" until a test was **executed** and the result recorded.

## 7. Decisions resolved by PM (2026-11-11)

1. Guided login: remote isolated browser remains the future approach; deferred (ADR-009).
2. Domain proof: DNS TXT primary, well-known alternative; no attestation (ADR-017).
3. robots.txt: respect by default; auditable override (ADR-018).
4. Package manager: npm workspaces (ADR-001).
5. Billing deferred; TOTP MFA not an MVP blocker (ADR-019).
