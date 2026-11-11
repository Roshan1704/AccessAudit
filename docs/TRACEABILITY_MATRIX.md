# Traceability Matrix

Status: Draft v0.2 · Date: 2026-11-11 · Phase numbers follow IMPLEMENTATION_ROADMAP v0.2 (PM order). `Deferred` = kept in vision, not scheduled.

Maps requirement → design → planned phase → planned tests → result. **Result is `not executed` until a test has actually run**; then record command, date and commit. No application code exists yet, so every result is `not executed`.

## Functional requirements

| Requirement | Design doc | Phase | Planned tests (TESTING_STRATEGY) | Result |
|---|---|---|---|---|
| REQ-PLAT-01 login/session | AUTHENTICATION_ARCHITECTURE §A | 1 | unit (password/session), integration, e2e, CSRF/session suite | not executed |
| REQ-PLAT-02 orgs/roles/invites | API_SPEC §2–3, DATABASE §3 | 1 | RBAC matrix, integration | not executed |
| REQ-PLAT-03 tenant isolation | DATABASE §4, THREAT T-TEN-* | 1 | cross-tenant matrix | not executed |
| REQ-PLAT-04 projects/settings | DATABASE §3 | 1 | integration, e2e | not executed |
| REQ-PLAT-05 audit log | DATABASE §3 | 1 | integration (append-only trigger) | not executed |
| REQ-PLAT-06 real dashboard aggregates | DATABASE §6 | 5 | e2e on real stack | not executed |
| REQ-AUTHZ-01 domain proof (DNS TXT / well-known, ADR-017) | THREAT T-API-09 | 1 | unit, integration, domain-verification suite (TESTING §11), e2e vs fixture | not executed |
| REQ-ROBOTS-01 robots policy + auditable override (ADR-018) | CRAWLER §5, THREAT T-API-10 | 2 | robots suite (TESTING §11) | not executed |
| REQ-SLICE-01 vertical-slice e2e (verify → scan → findings → rescan → compare) | ROADMAP, TESTING §11 | 5 (closes 6) | Playwright against real stack + fixture site | not executed |
| REQ-AUTHZ-02 authorized-domain allow-list | CRAWLER §3 UrlPolicy | 1–2 | unit, SSRF/scope suite | not executed |
| REQ-CRAWL-01..04 | CRAWLER §3–5, §8 | 2 | fixture sites, integration | not executed |
| REQ-CRAWL-05 single pipeline | CRAWLER §2 | 2 | integration | not executed |
| REQ-CRAWL-06/07 SPA, infinite scroll | CRAWLER §5 | 2 | fixture sites | not executed |
| REQ-AUTH-01 credential login | AUTH §B.3 | Deferred | login fixtures | Deferred — not executed |
| REQ-AUTH-02 guided session | AUTH §B.4 | Deferred | e2e, T-GS-* | Deferred — not executed |
| REQ-AUTH-03 encrypted sessions | AUTH §B.6–7 | Deferred | T-CRED-01/02/09 | Deferred — not executed |
| REQ-AUTH-04 journeys/recorder | AUTH §B.5 | Deferred | recorder + sensitive-value tests | Deferred — not executed |
| REQ-AUTH-05 multi-profile | AUTH §B.8 | Deferred | integration, e2e | Deferred — not executed |
| REQ-AUTH-06 pause/resume, no bypass | AUTH §B.3, B.9 | Deferred | state-machine tests, T-CRED-07 | Deferred — not executed |
| REQ-AUTH-07 failure classification | AUTH §B.3 | Deferred | login fixtures | Deferred — not executed |
| REQ-AUTH-08 no secret leakage | THREAT T-CRED-03/04 | Deferred | canary e2e | Deferred — not executed |
| REQ-STATE-01/02 safe state discovery | CRAWLER §6 | Deferred | destructive fixtures | Deferred — not executed |
| REQ-STATE-03 approved workflows | CRAWLER §6 tier 2 | Deferred | integration | Deferred — not executed |
| REQ-COV-01..04 coverage | CRAWLER §9 | 2 | integration, UI e2e | not executed |
| REQ-A11Y-01/02 axe + registry | ACCESSIBILITY_ENGINE §2–3, §11 | 3 | a11y corpus | not executed |
| REQ-A11Y-03 custom rules | ACCESSIBILITY_ENGINE §4 | Deferred (custom rules) | per-rule fixtures | Deferred — not executed |
| REQ-A11Y-04 interaction tests | ACCESSIBILITY_ENGINE §5 | Deferred (interaction tests) | fixtures | Deferred — not executed |
| REQ-A11Y-05 validation/classification | ACCESSIBILITY_ENGINE §6 | 4 | unit, corpus | not executed |
| REQ-A11Y-06 finding record | ACCESSIBILITY_ENGINE §7 | 4 | contract test | not executed |
| REQ-A11Y-07 manual verification | ACCESSIBILITY_ENGINE §8 | 4, 6 | integration, e2e | not executed |
| REQ-AI-01/02 AI layer | ACCESSIBILITY_ENGINE §9 | 7 | adapter contract tests | not executed |
| REQ-AI-03 AI safety | THREAT §4.7 | 7 | LLM canary/injection | not executed |
| REQ-ISS-01 issue lifecycle | DATABASE §3 | 6 | integration, e2e | not executed |
| REQ-ISS-02 fingerprint/dedup | DATABASE §5 | 4 | unit (stability) | not executed |
| REQ-HIST-01 immutable history/compare | DATABASE §1, §5 | 6 | integration | not executed |
| REQ-RPT-01/02 reports | API_SPEC, DATABASE | 8 | report escaping, share-link suite | not executed |
| REQ-MON-01 schedules | DATABASE `scheduled_scans` | Deferred | scheduler dedup | Deferred — not executed |
| REQ-API-01 REST API (internal in MVP; public API/CLI deferred) | API_SPECIFICATION | 1+ | contract, authz | not executed |
| REQ-INT-01 GitHub/CI | API_SPEC §5 | Deferred | integration | Deferred — not executed |
| REQ-UI-01..04 UI | — | 5 | Playwright, axe, manual | not executed |

## Security requirements

| ID | Threat IDs | Gate | Phase | Result |
|---|---|---|---|---|
| SEC-01 SSRF layered | T-SSRF-01,03..07 | Gate | 1–2 | not executed |
| SEC-02 DNS pinning | T-SSRF-02 | Gate | 2 | not executed |
| SEC-03 redirect revalidation | T-SSRF-03 | | 2 | not executed |
| SEC-04 credential encryption | T-CRED-01,02,05 | Gate | 1 | not executed |
| SEC-05 secret redaction | T-CRED-03, T-LLM-01 | | 1–2 | not executed |
| SEC-06 browser isolation | T-BRW-01..06 | | 2 | not executed |
| SEC-07 RLS/composite FKs | T-TEN-01..04 | Gate | 1 | not executed |
| SEC-08 domain authorization + robots policy | T-API-09, T-API-10 | Gate | 1 | not executed |
| SEC-09 CSRF/session/CORS/CSP | T-API-02,04 | | 1 | not executed |
| SEC-10 evidence redaction/retention | T-EVD-01..03, T-CRED-08 | | 4 | not executed |
| SEC-11 LLM minimization | T-LLM-01..04 | Gate | 7 | not executed |
| SEC-12 guided-session channel | T-GS-01..04 | | Deferred | Deferred — not executed |
| SEC-13 supply chain | T-API-08 | | 1 | not executed |
| SEC-14 rate limits/quotas | T-API-01,07, T-TEN-05 | | 1, 9 | not executed |

Non-functional requirements (performance, availability, accessibility of the product) are tracked in PRODUCT_REQUIREMENTS §5 and verified in Phases 5 and 9.

## Update protocol
After each test run: set Result to `passed`/`failed` with `(command, date, commit)`; add defects to PROJECT_STATUS. Requirements without a planned test are a defect in this matrix. Deferred rows are not release-blocking until scheduled.
