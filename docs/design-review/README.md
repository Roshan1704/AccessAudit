# Design review screenshots

Captured 2026-11-16 from the running app (real API, database and seeded demo data) by Playwright. Demo data is labelled sample data on reserved `.example` hosts ("Demo Org (sample data)": Northwind Shop, Contoso Help Center, Fabrikam Docs). No aggregate accessibility score is shown anywhere in the product.

## Folders

| Folder     | What                                                                                                                                                        | Spec                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `product/` | Whole product. Every page full-length (`NN-page.png`), plus one image per section of that page (`NN-page--MM-section.png`) and mobile versions. 72 images.  | `e2e/product-tour.spec.ts`                          |
| `journey/` | The 10-step review journey: dashboard, project, report, compare, filter, finding, workflow, manual checklist, mobile.                                       | `e2e/demo-journey.spec.ts`                          |
| `widths/`  | Responsive checks: each page at 320, 375, 768, 1024 and 1280 px (320/768/1280 for report, finding-detail, manual-checklist, quick-check-result). 82 images. | `e2e/phase7-ui-audit.spec.ts`, `e2e/phase2.spec.ts` |

## `product/` page index

| Prefix   | Page                                             | Route                                                        |
| -------- | ------------------------------------------------ | ------------------------------------------------------------ |
| 01       | Home (and `01-home-mobile`)                      | `/`                                                          |
| 02       | Quick Check                                      | `/quick-check`                                               |
| 03 to 06 | Login, Register, Forgot password, Reset password | `/login`, `/register`, `/forgot-password`, `/reset-password` |
| 07       | Not found                                        | unknown route                                                |
| 10       | Organizations                                    | `/orgs`                                                      |
| 11       | Org dashboard (and `11-org-dashboard-mobile`)    | `/orgs/:orgId`                                               |
| 12 to 14 | Projects, Members, Org settings                  | `/orgs/:orgId/projects`, `/members`, `/settings`             |
| 15       | Account                                          | `/account`                                                   |
| 20, 21   | Project: Scans tab, Settings tab                 | `/orgs/:orgId/projects/:projectId`                           |
| 30       | Scan report (and `30-scan-report-mobile`)        | `/orgs/:orgId/scans/:scanId`                                 |
| 31       | Finding detail, technical evidence expanded      | `/orgs/:orgId/findings/:findingId`                           |
| 32       | Manual verification checklist                    | `/orgs/:orgId/scans/:scanId/manual`                          |

Not captured: accept-invite (needs a mailed token) and error states other than not-found.

## `journey/` files

| File                          | Shows                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| `journey-01-dashboard`        | Org dashboard, five "Needs attention" sections                            |
| `journey-02-project`          | Project with scan history                                                 |
| `journey-03-report`           | Report: finding counts, coverage counts, next actions                     |
| `journey-04-compare`          | Change since previous scan                                                |
| `journey-05-report-filtered`  | Severity filter applied                                                   |
| `journey-06-finding`          | Evidence first, remediation labelled "template, not AI"                   |
| `journey-07-finding-workflow` | Workflow section (assignee, status, comments, history); viewed, not saved |
| `journey-08-manual`           | Manual verification checklist                                             |
| `journey-09-home-mobile`      | Homepage at 375 px                                                        |
| `journey-10-dashboard-mobile` | Dashboard at 375 px                                                       |

The live Start Scan and Rescan steps are not in the demo spec because `.example` hosts cannot be scanned. `e2e/phase2.spec.ts` covers them against example.com (needs the worker and internet).

Compare honesty: a finding is "resolved" only if its page was scanned in the current scan; otherwise it is "not re-checked". "Regressed" means it persists where the previous status was fixed.

## Latest review round (2026-11-16)

- Dashboard: onboarding collapses to one line after a completed scan; Recent activity shows 4 items with "View all activity (N)" to `/orgs/:orgId/activity`.
- Finding Detail: workflow summary (status, owner, comments) near the top; evidence captions honest. Demo screenshots say "Sample image (demo data)" and that the red box is not a measured position. Real scans say "Original scan screenshot".
- Evidence dialog: opens by Enter or Space, focus moves to Close, Escape returns focus to the opener.
- Demo data: staged story (assignee, reviewer comment, fixed-then-regressed history). Not saved by the journey test, so the seed stays idempotent.
- Covered by `e2e/review-fixes.spec.ts` (2 tests).

## PM follow-up round (2026-11-16)

- Scan report: **Execution** (queued, running, completed, failed) and **Coverage** (complete or incomplete) are separate badges. A completed scan with failed pages, skipped pages, pages excluded by robots.txt or the page limit reached shows "Coverage: incomplete" and a warning; it is never a plain green Completed. Wording follows the crawler states.
- Dashboard: attention cards no longer stretch to the tallest card (less empty space under Pending manual verification). Empty-org mobile: shorter welcome panel; Getting started keeps every step but no longer repeats the welcome text.
- Demo data: events are staggered across hours (assignment, review, status change, merge comment, resolved manual checks), so activity no longer shows several items at one timestamp. Still idempotent, labelled sample data, local development only.
- Manual accessibility validation: protocol and results sheet in [MANUAL_ACCESSIBILITY_VALIDATION](../MANUAL_ACCESSIBILITY_VALIDATION.md). Every row is NOT DONE, pending a human. Firefox and WebKit automated runs: NOT RUN (browser install needs approval).

## Verification summary (2026-11-16)

| PM item                                          | How verified                                    | Outcome                                                           |
| ------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------- |
| Filters, finding navigation, evidence expansion  | `demo-journey` test 3                           | passed                                                            |
| Status change, comment, history                  | `demo-journey` test 3                           | passed                                                            |
| Manual verification checklist                    | `demo-journey` test 4                           | passed                                                            |
| Compare card                                     | `demo-journey` test 3                           | passed                                                            |
| PDF, HTML, CSV, JSON export                      | `demo-journey` test 3 downloads each            | passed; PDF needs `BROWSER_CHANNEL=chrome` in the API environment |
| Dashboard navigation                             | `demo-journey` tests 1 and 2                    | passed                                                            |
| Responsive, no horizontal scroll at 320/768/1280 | `demo-journey`, `phase7-ui-audit` (320 to 1280) | passed                                                            |
| Whole-product screenshot tour                    | `product-tour`                                  | passed, 72 images                                                 |

Commands run: `npx vitest run --maxWorkers=2` from PowerShell with `TEST_*` variables (31 files, 295 tests passed); `npx playwright test` in Chrome with API, worker, web, Redis and PostgreSQL up (26 passed, 2.9 min, re-run after the PM follow-up round); `npx tsc -b`, `npx eslint . --max-warnings=0`, `npx prettier --check .` (re-run at the end of this round, see PROJECT_STATUS).

Screenshots come from a fresh database `accessaudit_review2` (migrated, `db:seed`, rules seed, `db:seed:demo`). The older dev DB keeps the previous demo org because `audit_logs` is append-only and blocks deleting it. Folder counts: `product/` 72, `journey/` 10, `widths/` 82.

Not done: manual keyboard pass, screen reader testing, non-Chrome browsers.

## Regenerate

1. `npm run db:seed:demo -w @accessaudit/db`
2. Start the API (with `DATABASE_URL`, `BROWSER_CHANNEL=chrome`), web app and worker.
3. `npx playwright test product-tour demo-journey phase7-ui-audit phase2`
4. `product-tour` writes straight into `product/`. Copy `e2e-screenshots/journey-*.png` to `journey/` and the other `e2e-screenshots/*.png` to `widths/`.
