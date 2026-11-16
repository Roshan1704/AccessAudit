# Manual Accessibility Validation Protocol and Results

Status: **NOT DONE. Pending a human tester.** No row below has been performed. Automated Playwright and axe runs do not replace any of it and must not be cited as manual results.

Tooling cannot operate a screen reader, use a physical keyboard the way a person does, or touch a phone. This document is the protocol and the results sheet. A person fills in the Result, Tester, Date and Notes columns.

## Setup

- Seed a fresh demo database (see `docs/design-review/README.md`, "Regenerate"). Sign in as `demo.owner@accessaudit.example`.
- Record: tester name, date, OS, browser and version, assistive technology and version.
- A result is Pass, Fail (with a defect note) or N/A. Leave "NOT DONE" until a person has run it.

## Pages and flows in scope

Quick check, login, register, org dashboard (including an empty org), projects, scan report, finding detail, evidence dialog, workflow form (status, assignee, comment), manual verification checklist, members and invite form, account settings.

## 1. Keyboard only (no mouse)

| ID   | Check                                                                                                                           | Result   | Tester | Date | Notes |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ---- | ----- |
| K-01 | Every interactive control on each in-scope page is reachable with Tab and Shift+Tab                                             | NOT DONE |        |      |       |
| K-02 | Tab order matches visual and reading order on report, finding detail and checklist                                              | NOT DONE |        |      |       |
| K-03 | Focus indicator is visible on every control, including links in cards and the filter selects                                    | NOT DONE |        |      |       |
| K-04 | Skip link or equivalent lets keyboard users bypass the navigation                                                               | NOT DONE |        |      |       |
| K-05 | Evidence dialog opens with Enter and Space, focus moves inside, Tab stays inside, Escape closes and focus returns to the opener | NOT DONE |        |      |       |
| K-06 | Forms (login, register, workflow, manual task, invite) can be completed and submitted by keyboard; errors are reachable         | NOT DONE |        |      |       |
| K-07 | "Show more findings", Details/summary and the activity "View all" link work with Enter or Space                                 | NOT DONE |        |      |       |
| K-08 | No keyboard trap anywhere                                                                                                       | NOT DONE |        |      |       |

## 2. Screen reader

Run at least NVDA with Firefox or Chrome on Windows, and VoiceOver with Safari on macOS or iOS.

| ID    | Check                                                                                                                                | NVDA     | VoiceOver | Notes |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------- | ----- |
| SR-01 | Scan report: page title, headings outline, and the "Execution" and "Coverage" badges are announced meaningfully (not colour only)    | NOT DONE | NOT DONE  |       |
| SR-02 | Scan report: coverage warning notice is announced and its text matches the Coverage card                                             | NOT DONE | NOT DONE  |       |
| SR-03 | Findings list: each finding reads type, severity, rule, page; filters announce label and state, live region announces result changes | NOT DONE | NOT DONE  |       |
| SR-04 | Finding detail: evidence, selector, screenshot alt text and "Sample image (demo data)" caption are understandable                    | NOT DONE | NOT DONE  |       |
| SR-05 | Evidence dialog: announced as a dialog with a name; content read; closing restores context                                           | NOT DONE | NOT DONE  |       |
| SR-06 | Forms: labels, required state, hints and error messages are announced and tied to the right field                                    | NOT DONE | NOT DONE  |       |
| SR-07 | Tables (pages in scan, not scanned): captions and row headers are announced                                                          | NOT DONE | NOT DONE  |       |
| SR-08 | Dashboard: "Needs attention" sections, empty-state text and onboarding steps read in a sensible order                                | NOT DONE | NOT DONE  |       |

## 3. Mobile touch and reflow

Real device or device emulator driven by a person. Test at 320 and 375 px wide, portrait and landscape.

| ID   | Check                                                                                                | Result   | Tester | Date | Notes |
| ---- | ---------------------------------------------------------------------------------------------------- | -------- | ------ | ---- | ----- |
| M-01 | Touch targets are at least 24 by 24 CSS px (WCAG 2.5.8), preferably 44 by 44                         | NOT DONE |        |      |       |
| M-02 | No horizontal scroll, no clipped content at 320 px (zoom to 200 percent too)                         | NOT DONE |        |      |       |
| M-03 | Nav, filters, dialog and forms usable one-handed; on-screen keyboard does not hide the focused field | NOT DONE |        |      |       |
| M-04 | Empty-org dashboard on mobile: welcome panel and Getting started do not repeat the same information  | NOT DONE |        |      |       |

## 4. Browsers other than Chrome

Manual pass on Firefox, Safari (or WebKit-based) and Edge: layout, focus rings, dialog behaviour, form controls, PDF/HTML/CSV/JSON download.

| ID   | Browser | Result   | Tester | Date | Notes |
| ---- | ------- | -------- | ------ | ---- | ----- |
| B-01 | Firefox | NOT DONE |        |      |       |
| B-02 | Safari  | NOT DONE |        |      |       |
| B-03 | Edge    | NOT DONE |        |      |       |

Automated Playwright runs on Firefox or WebKit, if run, are logged separately below and are **automated, not manual**.

| Run                                      | Result                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Automated Playwright, Firefox and WebKit | NOT RUN. Needs `npx playwright install firefox webkit`, which requires the owner's approval. |

## Sign-off

Manual validation complete: **NO**. Production readiness stays NOT ready while any section above is NOT DONE (see `docs/PRODUCTION_READINESS.md`).
