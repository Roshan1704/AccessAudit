# Development Plan: Product Manager Review Response

Date: 2026-11-13
Status: Proposed. No implementation has started. Awaiting Product Manager approval of scope and order.

This plan responds to the PM review. It follows the PM's order: P0 (scan report, finding detail, evidence, coverage, remediation workflow, AI transparency, accurate classification), then P1 (dashboard, project structure, scan configuration, Quick Check, comparison), then P2 (polish and validation). The product journey every task supports is: Discover, Understand, Validate, Prioritize, Remediate, Verify, Report.

Principles for every task: smallest viable change, keep the organization, project, scan, finding structure, keep existing API and data compatible unless a change is justified, add no dependencies without a reason, no unrelated refactoring, no "complete" claim without test results.

## 1. Decisions taken

| Topic                | Decision                                                                                                                                                                                                                                        | Reason                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI layer for the MVP | Keep the offline `TemplateProvider`. Label all its output as generic template guidance. Do not build an LLM provider now.                                                                                                                       | `packages/ai/src/index.ts` has one provider, hand-written guidance for 9 axe rules plus a generic fallback. It never receives selectors or DOM. A real provider is a separate estimate and needs a data-handling decision. |
| Domain verification  | Follow ADR-031: DNS TXT is the primary method, well-known file the alternative. The meta tag stays, as the amendment in `ARCHITECTURAL_DECISIONS.md` (line 118) already records, but is presented as the option for owners who cannot edit DNS. | The UI currently calls the meta tag "easiest", lists it first and defaults to it. That contradicts the approved ordering. No ADR change is proposed.                                                                       |
| Scoring              | No single accessibility score anywhere.                                                                                                                                                                                                         | Already a product rule. The PM confirms it.                                                                                                                                                                                |

## 2. Feature inventory and verification status

Status here was refreshed on 2026-11-13 after T0 to T10, against `docs/PROJECT_STATUS.md` (Vitest 294/294, Playwright 17/17). That file is the authority; this table is a summary. "Unverified" means no current test result backs it, not that it is broken.

| Capability                                                 | Classification                     | Evidence on record                                            | Gap                                                                    |
| ---------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Organizations, projects, membership, roles                 | Implemented, partially verified    | Phase 1 and 5 Playwright runs, API tests                      | Rerun after latest changes                                             |
| Public scan (crawl, axe, evidence)                         | Implemented, partially verified    | Phase 2 scan chain passed; e2e 17/17 on 2026-11-13            | Rerun 2026-11-13 (see PROJECT_STATUS)                                  |
| Scan report page                                           | Implemented, verified (automated)  | Reworked in T1; Playwright axe and reflow 320 to 1280 px      | Manual keyboard and screen reader pass not done                        |
| Finding detail, review status, assignee, comments, history | Implemented, partially verified    | Reworked in T2; API tests; Playwright axe and reflow          | No browser test of the full finding workflow; manual checks not done   |
| Manual verification checklist                              | Implemented, partially verified    | Phase 2 notes                                                 | Reviewer assignment and re-verification are marked later phases        |
| Scan comparison                                            | Implemented, verified (API tests)  | T4; `compare.test.ts` covers the disjoint buckets             | Not exercised in a browser with two real scans                         |
| Exports (PDF, HTML, CSV, JSON)                             | Implemented, verified (API tests)  | T10; `reports.test.ts` checks comparison and reasons          | PDF not inspected by eye                                               |
| Quick Check                                                | Implemented, verified in part      | Live success and private-address refusal passed in Playwright | Result page content (T8)                                               |
| AI explanations                                            | Implemented as templates only      | `TemplateProvider`                                            | Needs honest labelling (T3). Not an LLM.                               |
| Scheduled scans, notifications                             | Implemented, unverified end to end | `notifier.test.ts`, `ops.test.ts`                             | Not required for the MVP core. Freeze, do not expand.                  |
| Authenticated scanning (login profiles)                    | Implemented, verified in part      | Migration 0010 applied; API/worker tests; `phase6.spec.ts`    | No scan of a real login-protected site. Keep labelled experimental.    |
| Domain verification                                        | Implemented, partially verified    | Meta tag, DNS TXT, well-known all coded                       | Local end-to-end blocked by port 80. Copy conflicts with ADR-031 (T0). |
| Billing, enterprise admin, agency multi-tenancy            | Not required for the MVP           | none                                                          | Do not start                                                           |

## 3. Task list

Order: T0, then T1 to T4 (P0), then T5 to T8 (P1), then T9 and T10 (P2). Estimates are development plus verification in working days, single developer, and are rough.

### T0. Baseline truth (P0, blocks release claims)

- **Current state:** `PROJECT_STATUS.md` says Phase 5 awaits acceptance and the verdict is NOT ready until migration 0010 and authenticated scanning are verified. Five other docs carry phase statements. Verification copy contradicts ADR-031.
- **Problem:** Nobody can state the real database and test state. Docs can disagree.
- **Customer impact:** Release decisions rest on stale evidence.
- **Proposed solution:**
  1. Query the dev database for the applied migration list and compare with the 11 files in `packages/db/migrations`. Apply 0010 only through the project migrator, and record the output.
  2. Run `tsc -b`, ESLint, Prettier check, Vitest (unit and integration) and Playwright (`phase1`, `phase2`, `phase5`, `phase7-ui-audit`). Record exact commands, totals, failures, skips, and what was not run, with environment (Node version, Postgres 16 in Docker on 5433, Redis 6379, Chrome channel).
  3. Make `docs/PROJECT_STATUS.md` the single authority. Add a one-line pointer to it at the top of the other docs that carry status.
  4. Change verification copy only: order DNS TXT, well-known file, meta tag; label DNS "Recommended", meta tag "If you cannot edit DNS or serve a file"; default method DNS TXT; remove "easiest".
- **Affected modules:** docs, `apps/web` ProjectDetail copy. No schema change.
- **Dependencies:** Docker Postgres and Redis running. Some commands are blocked in the agent sandbox, so you may need to run them and paste the output.
- **Acceptance criteria:** Applied migrations list equals the files on disk. Test table in `PROJECT_STATUS.md` has dated results from this run. Copy matches ADR-031.
- **Test plan:** The commands above.
- **Risk:** Migration 0010 may fail or expose problems. Outcome gets recorded either way.
- **Estimate:** 1 day, plus time for any failures it uncovers.

### T1. Scan report hierarchy (P0)

- **Current state:** `ScanReport.tsx` shows four KPI tiles (confirmed, strong potential, manual, informational), a notice, two charts, most affected pages, manual verification, coverage with a per-page table, compare, export, then the findings list. Findings rows show class, severity, confidence, title, message, WCAG, occurrences, page, review status when not open. Filters: type, severity, review status, page.
- **Problem:** The report opens with charts, not with what the scan was and what to do first. Page counts are split between a sentence and a table. Discovered, failed and skipped pages are not separated. No sorting. Workflow status appears only when not open.
- **Customer impact:** The report is the main deliverable. A consultant cannot hand it over, a developer cannot find the next action fast.
- **Proposed solution:**
  1. **Summary block:** project name, site, scan date and status, WCAG version and level. Counts for confirmed, potential, pending manual checks, each separate. Pages: discovered, scanned, failed, skipped. No combined total.
  2. **Priority strip:** critical confirmed, serious confirmed, new, regressed, resolved since the previous scan, outstanding manual checks. Each links to the findings list with the filter applied. New, regressed and resolved come from the comparison data (T4) and are hidden, not zero, when there is no previous scan.
  3. **Coverage section:** moved up, with counts and the reason for each failed or skipped page, grouped by reason. A completed scan with failed or skipped pages shows a plain warning that not every discovered page was tested.
  4. **Findings list:** single table on wide screens (title, type, severity, page, WCAG, confidence, workflow status), stacked rows below 768 px. Sort by severity, type, page. Quick filters for "Critical confirmed", "Potential", "Unresolved".
  5. Charts stay but move below the priority strip.
- **Affected modules:** `apps/web` ScanReport and findings components. Backend only if the summary lacks discovered or skipped counts and per-reason data; check first, add fields to `GET /scans/:id` if missing.
- **Dependencies:** T0 (a trusted baseline). T4 for new, regressed and resolved counts.
- **Acceptance criteria:** Matches section 8 "Scan Report" of the PM review. Confirmed, potential, manual never summed. Failed and skipped pages visible with reasons. Every row links to its finding.
- **Test plan:** Component tests for the counts and the "scan completed with unscanned pages" state. Playwright against a deterministic fixture site with known issues. Axe on the report route with data. Manual check at 320, 375, 768, 1024, 1280 px.
- **Risk:** Summary payload changes. Keep additions backward compatible.
- **Estimate:** 3 to 4 days.

### T2. Finding detail structure (P0)

- **Current state:** `FindingDetail.tsx` has cards in this order: what was found (message, rule, WCAG, element, occurrences, rule description), explanation and fix, evidence, manual checks, review (assignee, review status), comments, history.
- **Problem:** No separate "user impact" section. Explanation comes before evidence. WCAG appears as bare numbers with no version, level or reason. "Review status" mixes workflow with verification, and "Fixed" can be chosen by hand with no rescan link. No investigation notes. Page URL is only in the header.
- **Customer impact:** This is the page where users fix things. It should answer what, why, where, how, and has it been fixed.
- **Proposed solution:** Reorder into these sections with one heading level each:
  1. Identification: title, type, severity, confidence, workflow status, URL, WCAG criterion with level.
  2. Problem in plain language (from the rule text and message).
  3. User impact, taken from the guidance "why it matters", clearly worded as general impact for this kind of issue.
  4. Evidence: screenshot, selector, HTML snippet, page URL, relevant attributes, detection rule. Uses the existing evidence model, no second model.
  5. WCAG context: version, criterion, level, and the sentence "This rule indicates a possible failure of this criterion; one automated rule does not establish conformance."
  6. Remediation: steps, a verification step, and a visible "Generic guidance for this rule" label (see T3).
  7. Workflow: assignee, status, comments, notes, history.
  8. Verification: shows scan-based outcome ("Present in latest scan" / "Not found in latest scan" with scan link), separate from workflow status. Setting workflow status to Fixed never changes the verification outcome. A "Rescan" action links to the project scan panel.
- **Affected modules:** `apps/web` FindingDetail. Investigation notes may need a column or reuse the comments table with a kind field; decide after reading the finding schema. Verification outcome should be derived from comparison data, not stored by the UI.
- **Dependencies:** T4 for the verification outcome. T3 for the label.
- **Acceptance criteria:** Section 8 "Finding Detail". Workflow status and verification outcome are distinct fields in the UI and API. No claim of resolution from a status change alone.
- **Test plan:** Component tests per section. Playwright: open finding, change status, add comment, assign, confirm verification outcome unchanged until a rescan. Axe with data.
- **Risk:** Small schema change if notes are added. Ask before any migration.
- **Estimate:** 3 to 4 days.

### T3. AI capability transparency (P0)

- **Current state:** `Explanation.source` is `template` or `ai`. The finding page prints "Template guidance (template-v1). Generated from fixed templates for this rule, not from your page. Review before applying." in small muted text at the bottom of the card. (Before T3.) After T3 the card is titled "Standard guidance" and shows a rule-specific or general label.
- **Problem:** The disclosure is easy to miss and the heading reads like analysis of this element. Guidance covers 9 rules; everything else gets generic steps without saying so.
- **Customer impact:** Users may take rule-level text as an analysis of their page.
- **Proposed solution:**
  1. Rename the card "Guidance for this rule". Put a visible badge at the top: "Generic guidance, not specific to this element" when `source` is `template`.
  2. Distinguish rules with specific written guidance from the generic fallback. Add `coverage: 'rule' | 'generic'` to `Explanation` (additive). Show "No written guidance for this rule yet; these are general steps" for `generic`.
  3. Document the engine/intelligence split in `ACCESSIBILITY_ENGINE.md` or `SYSTEM_ARCHITECTURE.md`: the engine produces evidence; the provider only reads redacted rule metadata; it cannot invent selectors, DOM, WCAG mappings or outcomes. Keep scans working when the provider is absent (already true: the template provider is offline).
  4. Record the future real provider as a separate estimate, with its prerequisites: what evidence is sent, redaction, a key, cost, opt-in.
- **Affected modules:** `packages/ai`, API explanation response, `apps/web` FindingDetail, docs.
- **Dependencies:** none.
- **Acceptance criteria:** Section 4 of the PM review. A user cannot read template text as contextual AI analysis.
- **Test plan:** Update `ai.test.ts` for the new field. Component test for both labels.
- **Risk:** Low.
- **Estimate:** 1 day.

### T4. Comparison and regression semantics (P1, but T1 and T2 depend on it)

- **Current state:** `compare.test.ts` and a `CompareCard` exist. Matching rules and the handling of unscanned pages have not been reviewed in this plan.
- **Problem:** Unknown. The PM requires identity matching and that a page missing from the latest scan is never reported as resolved.
- **Customer impact:** A wrong "resolved" count destroys trust.
- **Proposed solution:** Read the comparison code. Write the matching rule down (finding identity = rule + page + selector, or what the code uses). Ensure the result has: new, resolved, regressed, unchanged, and "not comparable" for pages not scanned in one of the runs. Show page coverage changes. Add fixtures: page removed, page failed, issue fixed, issue returned.
- **Affected modules:** API compare, `CompareCard`, tests.
- **Dependencies:** T0.
- **Acceptance criteria:** Section 3.1 E. Unscanned pages never count as resolved.
- **Test plan:** Unit tests on fixtures; one Playwright path with two scans of a controlled site.
- **Risk:** Medium; changing identity rules can alter historical results. Do not change stored identity without approval.
- **Estimate:** 2 days.

### T5. Organization dashboard as a work queue (P1)

- **Current state:** `OrgOverview.tsx` shows a getting-started checklist (including steps that are never marked done, "Invite your team" and "Run your first scan") and one card per project with the latest completed scan counts.
- **Problem:** The checklist stays after setup. No ordering by urgency. Failed or incomplete scans, projects not scanned recently, and recent activity are invisible. A project with no scan and a project with zero findings read similarly.
- **Customer impact:** The user cannot tell where to spend time.
- **Proposed solution:** Replace the checklist with it only when the org has no completed scan. Add a "Needs attention" list, ordered: failed or incomplete latest scans, projects with critical or serious confirmed findings, new and regressed findings, pending manual checks, projects with no scan in 30 days. Each row links to the project, scan, or filtered findings. Project cards show "No scan yet" separately from "0 confirmed findings", and mark a scan with unscanned pages. Recent activity: last scans and finding changes. Extend `GET /orgs/:id/overview` additively.
- **Affected modules:** overview endpoint, `OrgOverview.tsx`.
- **Dependencies:** T4 for new and regressed.
- **Acceptance criteria:** Section 8 "Dashboard".
- **Test plan:** API test of ordering. Component tests for empty states. Playwright smoke.
- **Risk:** Low to medium.
- **Estimate:** 3 days.

### T6. Project detail structure (P1)

- **Current state:** `ProjectDetail.tsx` is one long page: name/delete form, scan panel, schedules, login profiles, domains.
- **Problem:** Advanced setup (schedules, login profiles) sits at the same level as scanning. No project overview or scan history on the page.
- **Proposed solution:** Tabs (route-based, so links work): Overview (site, latest scan, coverage, confirmed and pending counts, recent activity, next action), Scans (start a scan, history), Findings (project-level list, reuses the report filters), Settings (name, delete, domains, schedules, login profiles). Authenticated scanning and schedules stay in Settings under "Advanced". Nothing is removed. Next action rules: no verified domain: "Verify your domain"; verified and no scan: "Run first scan"; latest scan with critical confirmed: "Review critical findings".
- **Affected modules:** `apps/web` routing and ProjectDetail split into pages/components.
- **Dependencies:** T1 (shared summary component).
- **Acceptance criteria:** Section 3.4.
- **Test plan:** Playwright through each tab. Keyboard test of tab navigation.
- **Risk:** Medium; links to `#domains` and `#login-profiles` anchors must be kept or redirected.
- **Estimate:** 3 days.

### T7. Scan configuration (P1)

- **Current state:** `ScanPanel.tsx` has max pages, WCAG version, level, and options, all visible.
- **Proposed solution:** Default view: site (prefilled from the project), scope "Start page and linked pages" with a plain default, "Start scan". An "Advanced options" disclosure holds max pages, depth, include/exclude patterns, WCAG version and level, interaction tests and login profile, each with one line of in-context help. Error messages say what to do next. Check which of depth and include/exclude patterns exist in the API before promising them in the UI; do not add UI for unsupported options.
- **Dependencies:** T6.
- **Acceptance criteria:** Section 8 "Scan Configuration". A first scan needs one click after domain verification.
- **Test plan:** Component test of defaults. Playwright first-scan path.
- **Risk:** Low.
- **Estimate:** 1 to 2 days.

### T8. Quick Check result and conversion (P1)

- **Current state:** Public page, one URL, verified in Playwright for success and private-address refusal. Result content not reviewed in this plan.
- **Proposed solution:** After the result, show: what was tested (one page, axe rules, WCAG 2.2 AA), what was not (other pages, manual checks, signed-in areas, interactions), limitations, and a comparison with a full project scan. Offer "Save this result and track fixes" leading to registration or sign-in then project creation, without blocking the result. Do not require an account before results.
- **Affected modules:** `QuickCheck.tsx`; possibly a "claim result" step later (separate estimate, only if wanted).
- **Dependencies:** none.
- **Test plan:** Component test; keep the existing live-success Playwright test green.
- **Risk:** Low.
- **Estimate:** 1 to 2 days.

### T9. Responsive and application accessibility validation (P2)

- **Scope:** Check report tables, evidence panels, navigation, finding detail at 320, 375, 768, 1024, 1280 px. Keyboard-only pass, focus order, form errors, dynamic status announcements (scan progress), zoom and reflow, reduced motion, dialogs. Automated axe on all routes with data. Manual screen-reader pass (Narrator/NVDA).
- **Output:** `docs/ACCESSIBILITY_VALIDATION.md` with dated results, screenshots, defects. Known unchecked items: sticky top bar overlap, 320 px pages table, chart rendering.
- **Dependencies:** T1 to T8 substantially done.
- **Estimate:** 3 days.

### T10. Export parity and presentation (P2)

- **Scope:** Compare PDF, HTML, CSV, JSON output with the on-screen report for the same scan on a fixture. Add project and scan metadata, coverage limitations, WCAG references, evidence and page-level data to the PDF and HTML. Fix any classification or severity mismatch found.
- **Dependencies:** T1.
- **Test plan:** Snapshot-style tests of HTML export fields; manual review of the PDF.
- **Estimate:** 2 to 3 days.

## 4. Cross-cutting engineering work

| Item                        | Plan                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| End-to-end journey (PM 7.3) | One deterministic fixture site with planted issues and a way to "fix" one. Playwright script: create project, start scan, open report, open finding, set status, comment, assign, fix fixture, rescan, compare, export. Added after T1, T2, T4. Domain verification on the fixture needs the port 80 issue resolved or a non-80 test hook; this needs your approval before any elevated step. |
| Security review (PM 7.6)    | Written review of SSRF protection, redirects, limits, credential handling, session storage, access control, report access, log content, retries, based on code reading plus existing tests. Output: update `SECURITY_REMEDIATION.md`. Not started.                                                                                                                                            |
| Status authority (PM 7.5)   | Done in T0.                                                                                                                                                                                                                                                                                                                                                                                   |
| Production readiness        | The verdict in `PRODUCTION_READINESS.md` stays NOT ready until T0 passes, authenticated scanning is verified, and the end-to-end journey passes.                                                                                                                                                                                                                                              |

## 5. Order and totals

T0 (1 d), T3 (1 d), T4 (2 d), T1 (3-4 d), T2 (3-4 d), then T5 (3 d), T6 (3 d), T7 (1-2 d), T8 (1-2 d), then T9 (3 d), T10 (2-3 d), plus the end-to-end journey and security review. About 25 to 30 working days of development and verification in total. The first review point is after T0 and T3, then after T1 and T2.

## 6. Open questions for the Product Manager

1. Is the verification copy change in T0 (DNS first, meta tag as the fallback) acceptable, or should the ADR be amended to make the meta tag the first choice?
2. Is the "Generic guidance" labelling enough for the MVP, with a real LLM provider scoped separately later?
3. Should scheduled scans and login profiles stay in the product, hidden under Settings, or be switched off for the MVP release?
4. Quick Check "save result" (T8): link to sign-up only, or also carry the result into the new project?
