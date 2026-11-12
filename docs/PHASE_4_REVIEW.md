# Phase 4 Review: Intelligence and Operations

Date: 2026-11-12 · State: code complete, uncommitted on 3cfd471 · Awaiting Product Manager acceptance. No further phase starts without approval.

## Delivered

| Capability                            | Summary                                                                                                                                                                              | ADR     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Finding fingerprints                  | Stable hash of rule, selector and page path; used for lifecycle, comparison and notifications                                                                                        | earlier |
| Assignment, comments, status, history | Per-finding workflow with audit trail                                                                                                                                                | earlier |
| AI provider abstraction               | Interface plus an offline template provider only. No external model is called                                                                                                        | ADR-029 |
| Scan comparison and regression        | Backend and UI. A finding missing from a newer scan counts as resolved only if its page was scanned again; otherwise "not rechecked"                                                 | earlier |
| Coverage dashboard                    | Pages discovered, scanned, not scanned, page-limit hit, plain list of automation limits                                                                                              | earlier |
| Reports                               | JSON, CSV, HTML and PDF. PDF renders the HTML with the installed Chrome; JavaScript and network are disabled in the render context                                                   | ADR-030 |
| Scheduled scans                       | Daily/weekly/monthly schedules, optimistic claim on `next_run_at`, in-process tick, failures recorded on the schedule                                                                | ADR-027 |
| Notifications                         | Email to the scan starter (or org owners and admins for scheduled scans) when a scan finishes or fails, with regression counts. Claimed through `scans.notified_at`, so at most once | ADR-028 |

## Migrations

- 0007: lifecycle and AI tables (applied).
- 0008 `scan_schedules` and 0009 `scan_notifications`: created, **not yet applied**. Run `npm run db:migrate` with `MIGRATION_DATABASE_URL` as the owner role. 0009 backfills `notified_at` for existing finished scans so no backlog is mailed.

## Verification status

| Check                                                      | Result                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `tsc -b`, `eslint`                                         | clean after the last code change                                                           |
| Last full Vitest run                                       | 247/247, taken before the AI, compare, report, schedule and notification slices. Not rerun |
| `schedules.test.ts` (3 tests), `notifier.test.ts` (1 test) | written, cannot pass until 0008 and 0009 are applied                                       |
| Compare, report and AI tests                               | written; run individually during development, not part of a fresh full run                 |
| PDF export                                                 | not verified manually; Chrome rendering path untested                                      |

## Known limits and risks

- The scheduler and notifier run inside the API process. `SCHEDULER=off` disables both. With several API processes the claims prevent duplicates, but ticks are not leader-elected.
- Email delivery is at most once. A failed send is not retried.
- No AI-written explanations from a real model; template text only, by decision.
- Scheduled scans of domains that lose verification fail and are recorded on the schedule; the user sees `lastError`.
- Automated checks cover only part of WCAG; every report and email says manual review is still required.

## Needed to close the phase

1. Apply migrations 0008 and 0009.
2. Run the full Vitest suite (PowerShell, with the dev database and Redis) and Playwright e2e.
3. Open one generated PDF and check it by eye.
4. Product Manager acceptance.
