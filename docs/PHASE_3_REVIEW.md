# Phase 3 Product and Engineering Review Report

Date: 2026-11-12 · Tree: uncommitted changes on 3cfd471 · Status: **ready for Product Manager review; Phase 4 not started**

## Objective

Complete the accessibility engine so every finding carries evidence, is classified as confirmed, potential or manual, and is measured against controlled accessible and inaccessible fixtures. Connect the engine to the crawler and database, and review findings in the web UI.

## What was built

Most of Phase 3 was delivered in the merged Phase 2 (see PROJECT_STATUS). This pass added:

- Three heuristic form rules: `custom:missing-autocomplete` (WCAG 1.3.5), `custom:group-no-legend` (1.3.1, 3.3.2), `custom:required-not-programmatic` (3.3.2, 1.3.1), each with a registry entry, a message and a static check in the page script.
- Nine more controlled fixtures: 21 inaccessible and 4 accessible in total.
- Help URL slugs for success criteria 1.3.1 and 1.3.5.
- Documentation: traceability matrix (Phase 3 results), project status, ADR-017 addendum (meta tag method, hostname normalisation, verification gate, development flag and its SSRF risk).

## Acceptance against the Phase 3 list

| Item                                                                    | State                                                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| axe-core integration, WCAG 2.2 mapping, rule registry                   | done (124 rules seeded)                                                                   |
| DOM, CSS and accessible-name analysis                                   | done (evidence kinds html_snippet, selector, computed_style, accessible_name, check_data) |
| Keyboard, focus, dialog, menu, tabs, accordion, dynamic content testing | done, read-only                                                                           |
| Form testing                                                            | **partial by policy**: static checks only; forms are never submitted                      |
| Screenshot and DOM evidence                                             | done                                                                                      |
| Normalization, deduplication, confidence, validation                    | done; no finding is stored without evidence; `confirmed` only from deterministic evidence |
| Confirmed, potential and manual verification classes                    | done                                                                                      |
| Manual verification workflow                                            | done for tasks and checklist; assignment and history are later work                       |
| Controlled fixtures and false-positive measurement                      | done: tp=22, fp=0, fn=0                                                                   |
| Connection to crawler and database; findings review frontend            | done                                                                                      |
| Integration and end-to-end run before completion                        | done (below)                                                                              |

## Verification evidence

| Check                                                            | Result                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `npx tsc -b`, eslint (engine package), prettier on changed files | clean                                                              |
| Engine suite in real Chrome                                      | 2 files, 15 tests passed                                           |
| Engine precision and recall on fixtures                          | precision 1.000, recall 1.000                                      |
| Full Vitest, `--maxWorkers=2`                                    | 247 passed (before the slug-only change; engine suite rerun after) |
| Playwright phase1, phase2, phase5                                | 15 passed with API, worker, Redis and PostgreSQL running           |

## Honest limits

- Precision and recall of 1.000 come from a corpus written by the same team that wrote the rules. They show the rules do what we designed. They do not predict false-positive rates on real sites. A run against a set of real public pages with human review is needed before claiming a number.
- Heuristic rules produce `strong_potential`, never `confirmed`. That is intended.
- Form submission behaviour (error messages after invalid input, focus handling after submit) is not tested. Doing so means sending data to the target and needs an explicit decision and an ADR.
- Authenticated scanning is not built; it needs the same kind of decision.
- Chrome only. No screen reader testing. No container-level sandbox.
- The full suite needs `--maxWorkers=2`; default parallelism gives random timeouts.
- The phase2 quick-check e2e test waits up to 120 s but the Playwright default test timeout is 60 s, so the test would time out first on a slow check. It passed this time. Raising the per-test timeout is a small pending fix.
- The full Vitest suite was not rerun after the final slug-only edit; only the engine suite and static checks were.

## Risks

- Quick check and scans depend on a running worker and Redis; a stopped worker leaves jobs queued with a "checking" screen and no error. Consider a visible "worker unavailable" state in Phase 5 hardening.
- `ALLOW_PRIVATE_TARGETS=true` weakens SSRF protection. It is development-only and logs a warning, but `infra/env.template` should carry an explicit `false` default with a comment.
- Development-password fallbacks remain in `playwright.config.ts` and `e2e/phase2.spec.ts`.

## Decisions requested from the Product Manager

1. Accept Phase 3 as complete with the limits above, or require a real-site false-positive study first.
2. Form submit testing: stay read-only (recommended), or allow it for verified domains with an ADR.
3. Approve starting Phase 4. Phase 4 needs an AI provider decision and approval for any package installs before work begins.

No commit or push has been made. Work waits for explicit approval.
