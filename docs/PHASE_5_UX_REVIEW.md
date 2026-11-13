# Phase review: PM feedback increment (T0 to T10)

Status: ready for your review. Nothing is committed. `PRODUCTION_READINESS.md` stays NOT ready.

## What was done

| Item                                                                                                                            | Result                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| T1 Scan report: summary, priority overview, coverage with reasons, filters and sorting                                          | Done                                                                                                       |
| T2 Finding detail: problem, user impact, evidence, WCAG context, remediation, workflow kept separate from scan verification     | Done                                                                                                       |
| T3 AI transparency: guidance labelled as template, rule-specific or general; engine works without a provider                    | Done                                                                                                       |
| T4 Compare: new, resolved, regressed, unchanged, not rechecked (disjoint). A page that was not scanned never counts as resolved | Done                                                                                                       |
| T5 Org overview as a work queue                                                                                                 | Done                                                                                                       |
| T6 Project tabs                                                                                                                 | **Partial.** Only Scans and Settings tabs. Overview, Findings and History tabs from the plan are not built |
| T7 Scan config with progressive disclosure                                                                                      | Done                                                                                                       |
| T8 Quick Check explanation and conversion path                                                                                  | Done                                                                                                       |
| T9 Responsive and accessibility checks                                                                                          | Automated at 320/375/768/1024/1280 px with axe on the audited routes. Manual checks not done               |
| T10 Export parity                                                                                                               | JSON, CSV, HTML and PDF carry the comparison, per-finding change and not-scanned reasons                   |

## Verified results (2026-11-13, Windows 11, PowerShell, dev PostgreSQL 16 and Redis in Docker)

- `npx tsc -b`, `npx eslint . --max-warnings=0`, `npx prettier --check .`: clean.
- `npx vitest run --maxWorkers=2` with DB env set: 31 files, 294 tests passed, 0 failed (includes the new route-guard and key-rotation tests added after the security review).
- `npx playwright test`: 17 passed, 0 failed (1.3 min). Needs API, web, worker, Redis and PostgreSQL running. A stale API process returned HTTP 500 on register until it was restarted.
- Four e2e specs needed selector fixes because new page text matched twice (strict mode). No product code was changed for that.

## Not done or not proven

- Manual keyboard pass, screen reader pass, non-Chrome browsers.
- T6 tabs beyond Scans and Settings.
- No new web unit tests. Web behaviour is covered only by Playwright.
- The E2E journey uses the existing specs, not a separate deterministic fixture site.
- Local domain verification test is still blocked by the port 80 conflict.
- PDF export was not re-rendered by hand in this phase.

## Security review (from the implementation, limited scope)

Checked:

- Every org-scoped route under `apps/api/src/routes` calls `requireOrg` with a role. The three routes without it are `auth`, `health` and `quick`, which are public by design. `quick` has proof-of-work and rate limits.
- Report export is rate limited (30 per minute), tenant scoped (another org gets 404, tested), CSV neutralises formula injection (tested), HTML escapes output and is served with a restrictive CSP.
- No `innerHTML` or `dangerouslySetInnerHTML` in `apps/web/src`.
- New compare and report code reads through `withTenant`, so row-level security applies.

Not checked: dependency audit, full pen test, secret handling beyond what the earlier phase covered, and the deployment configuration. This is not a substitute for an independent review.

## Decision for you

Approve, or ask for T6 to be extended to the full five tabs. No commit or push until you say so.
