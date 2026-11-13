# Accessibility Engine

Status: Draft v0.1 · Date: 2026-11-11 · Code lives in `packages/a11y-engine`, executed inside `PageRunner` (see CRAWLER_ARCHITECTURE).

## 1. Principles

1. **Honesty over volume.** Automated tooling covers only part of WCAG. Every result carries a classification and confidence; the product never claims "WCAG compliant".
2. **Evidence-grounded.** A finding without reproducible evidence (selector, DOM context, computed data) is not reported as confirmed.
3. **Deterministic core, AI on the side.** Detection, classification, severity and confidence are rule-based. AI only explains (see §9) and can never change them.
4. **Versioned.** Every result records engine, rule and ruleset versions so historical scans stay interpretable.

## 2. Components

| Component             | Responsibility                                                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AxeRunner`           | Injects pinned axe-core into the page (and same-origin/iframes it can reach); runs configured tags (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, `best-practice` per project settings); returns raw results (violations, incomplete, passes, inapplicable). |
| `CustomRuleRunner`    | Runs project-owned rules (§4) against a page state using Playwright + in-page evaluation.                                                                                                                                                                   |
| `InteractionTester`   | Keyboard and focus-driven tests (§5).                                                                                                                                                                                                                       |
| `RuleRegistry`        | Maps `rule_id` → metadata, WCAG mappings, known limitations, remediation reference. Backed by `accessibility_rules` / `rule_versions`.                                                                                                                      |
| `Normalizer`          | Converts raw engine output into `RawFinding` with a common shape (rule, target, snippet, evidence, engine).                                                                                                                                                 |
| `Validator`           | Validation pipeline (§6): re-checks, deduplicates, grades confidence, assigns classification.                                                                                                                                                               |
| `Fingerprinter`       | Produces the stable finding identity (see DATABASE_DESIGN §5).                                                                                                                                                                                              |
| `ManualTaskGenerator` | Emits manual verification tasks for criteria that cannot be decided automatically (§8).                                                                                                                                                                     |

Engines are pure functions of (page state, config) → results, so they are unit-testable against fixture HTML without a queue or DB.

## 3. axe-core integration

- Version pinned in lockfile; recorded in `scans.engine_versions`.
- axe `violations` → candidate findings; `incomplete` → `manual_verification` candidates (never `confirmed`); `passes` stored as counts and, optionally, as `passed` occurrences for coverage of what was checked.
- axe rule tags are mapped to WCAG criteria through `rule_versions.wcag_mappings` (criterion, version, level, W3C URL) — not by parsing tags at report time.
- Runs once per state (base state and each discovered application state).
- Page-level exclusions and iframe policy follow project settings; cross-origin frames that cannot be inspected are recorded as `partial` coverage with reason, not silently skipped.

## 4. Custom rules (beyond axe) — DEFERRED beyond the axe-core MVP (custom rule builder is a deferred item; MVP = axe-core + supported WCAG mappings)

Each custom rule is a module with: stable `rule_id`, WCAG mapping, detector, validator hooks, documented limitations and test fixtures (positive, negative, edge). Initial set, in priority order:

| Rule area                              | WCAG 2.2     | Detection approach                                                                                                                                 | Typical classification                                                                        |
| -------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Focus visible                          | 2.4.7        | Tab through focusable elements; compare computed outline/box-shadow/background contrast of focused vs. unfocused state; screenshot-region evidence | confirmed when no visual change; otherwise strong_potential                                   |
| Focus not obscured                     | 2.4.11       | Focused element rect vs. sticky/fixed overlay rects                                                                                                | strong_potential (overlay may be transient)                                                   |
| Target size (minimum)                  | 2.5.8        | Bounding boxes of pointer targets vs. 24×24 CSS px with spacing exception                                                                          | confirmed for clear violations; exceptions (inline, equivalent control) → manual_verification |
| Keyboard trap                          | 2.1.2        | Tab sequence bounded run; detect cycles that cannot leave a container without Escape                                                               | strong_potential; confirmed only with reproducible trace                                      |
| Reflow                                 | 1.4.10       | Re-render at 320 CSS px width (secondary viewport); detect horizontal scroll of main content                                                       | strong_potential                                                                              |
| Text spacing                           | 1.4.12       | Inject WCAG spacing overrides; detect clipping/overlap                                                                                             | strong_potential                                                                              |
| Consistent navigation / identification | 3.2.3, 3.2.4 | Compare nav landmarks across pages of the same scan                                                                                                | informational / manual_verification                                                           |
| Accessible authentication              | 3.3.8        | Login-form heuristics (paste blocked, cognitive tests)                                                                                             | manual_verification                                                                           |
| Dragging movements                     | 2.5.7        | Detect drag-only widgets without alternative                                                                                                       | manual_verification                                                                           |
| Redundant entry                        | 3.3.7        | Journey-based; requires recorded multi-step flow                                                                                                   | manual_verification                                                                           |

Rules that cannot be implemented reliably are not shipped as automated checks; they are manual tasks (§8).

## 5. Interaction tests — IMPLEMENTED in Phase 2 (read-only subset)

Implemented 2026-11-12: keyboard, focus, dialog, form, menu and dropdown, tabs and accordion, and dynamic content checks, run read-only (no form submission, no destructive clicks). Findings from these checks are potential or manual verification unless a reproducible trace confirms them. Verified on controlled accessible and inaccessible fixtures only; accuracy on real sites is unmeasured. The text below is the original design.

- Run only under the read-only interaction policy from CRAWLER_ARCHITECTURE §6.
- Keyboard traversal: ordered focus sequence recorded as `keyboard_trace` evidence (element identity, accessible name, focus-visible result).
- Widget patterns (tabs, menus, dialogs, accordions): verify ARIA state changes and focus management against APG expectations; deviations are `strong_potential` unless axe independently confirms.
- Dialog tests: focus moves in, is contained, returns on close, Escape closes (when not modal-blocking).
- Each interaction result is attached to the `application_state` it was run in.

## 6. Validation pipeline

```
RawFinding ─▶ dedupe(same rule+target+state) ─▶ re-evaluate in fresh context (flake check)
          ─▶ context checks (hidden/inert/aria-hidden ancestors, shadow DOM, iframes)
          ─▶ cross-engine corroboration (axe + custom)
          ─▶ confidence scoring ─▶ classification ─▶ severity mapping ─▶ Finding record
```

- **Flake check:** a candidate that does not reproduce on an immediate re-evaluation is downgraded (confidence reduced; classification at most `manual_verification`).
- **Context checks:** known false-positive sources (off-screen but intentionally hidden content, third-party widgets) lower confidence and add `validation_trace` entries.
- **Corroboration:** independent engines or independent signals agreeing raise confidence.
- `validation_trace` records every step so a reviewer can see why a finding got its grade.

### Classification

| Class                 | Meaning                                      | Contributes to                                     |
| --------------------- | -------------------------------------------- | -------------------------------------------------- |
| `confirmed`           | Deterministic evidence of a failure          | Counts, CI gating (default: serious/critical only) |
| `strong_potential`    | Likely failure, context could change outcome | Counts, never auto-gates CI                        |
| `manual_verification` | Cannot be decided automatically              | Manual task list                                   |
| `informational`       | Best-practice or advisory                    | Reported separately                                |
| `passed`              | Check ran and passed                         | Coverage of what was tested                        |

### Confidence (0.00–1.00)

Starts from the rule's base reliability (per `accessibility_rules`), then adjusted by: reproducibility, corroboration, context penalties, evidence completeness. The formula and weights are versioned with the ruleset and exposed in `validation_trace`. Confidence is a ranking aid, not a probability claim, and the UI says so.

### Severity

Mapped from rule default and impact (axe impact where available), adjusted by page criticality hints only when configured. Severity never depends on AI.

## 7. Finding record

Every finding includes (see DATABASE_DESIGN `findings`, `finding_occurrences`, `finding_evidence`): rule id and version, WCAG criterion/version/level and W3C link, severity, confidence, classification, detection method, validation status and trace, URL, state key and trigger, auth profile, selector, truncated scrubbed HTML snippet, evidence artifacts, engine versions, first/last seen scan. Snippets and form values pass the redaction rules in SECURITY_THREAT_MODEL T-EVD-01 / T-CRED-08 before persistence.

## 8. Manual verification

- Criteria with no reliable automated test (e.g. meaningful alt text, caption accuracy, logical reading order, content on hover/focus) generate `manual_verification_tasks` with instructions, the exact URL/state/profile to test, and pass/fail/n-a outcomes.
- Completed manual results are stored with the verifier and feed coverage; they never retroactively change automated classification.

## 9. AI explanation layer boundaries

MVP status: no language model is used. The only provider is `TemplateProvider`, which returns fixed, hand-written guidance per rule (or a generic fallback) and works with no key or network. The finding page titles it "Standard guidance" and states whether the text is rule-specific or general and that it was not generated from the page. The response field `guidance` is `rule-specific` or `generic`. The rest of this section describes the boundaries for a future model-backed provider.

- Input: typed, allow-listed `RedactedFindingContext` only (rule id, WCAG text, sanitized snippet, role/name, no cookies/headers/URLs with queries/form values/credentials).
- Output: schema-validated explanation, impact narrative, suggested remediation, code-fix suggestion — labeled AI-generated, stored in `ai_explanations`, separate from findings.
- Prohibited: changing classification, severity, confidence or status; claiming compliance; asserting affected user groups without citing evidence fields.
- Off by default per org; provider-pluggable including self-hosted. Failures never block scans.

## 10. Health indicator (not a compliance score)

Reported as a set of counts and explicit gaps, never a single "% accessible":

- confirmed / strong-potential counts by severity and WCAG principle;
- coverage (pages/states/profiles/journeys audited vs. not);
- manual tasks open;
- trend vs. previous comparable scan, restricted to pages covered in both.

An optional composite index may be added later only if its formula is published, versioned and shown with its coverage caveat.

## 11. Rule governance

- Rules are code-reviewed modules with fixtures; adding or changing a rule bumps `rule_versions` (immutable rows) and the ruleset version.
- Each rule documents known limitations, which surface in the UI and reports.
- Accuracy tracking: user false-positive marks aggregate per rule/version; a rule above a configured false-positive rate is flagged for demotion (e.g. `confirmed` → `strong_potential`).
- axe-core upgrades run against the regression fixture corpus; diffs in findings are reviewed before the pin moves.

## 12. Performance and safety

- Engine runs inside the page job's wall-clock and DOM-node caps; oversized DOMs yield `partial` coverage with reason.
- Injected scripts are bundled from our repo (no remote script loading); evaluation results are size-capped.
- No engine step performs non-GET network actions or submits forms.

## 13. Testing hooks

Fixture corpus under `fixtures/a11y/`: known-bad and known-good pages per rule, third-party widget samples for false-positive control, SPA state fixtures, shadow DOM and iframe cases. Each rule requires positive, negative and edge fixtures before merge (see TESTING_STRATEGY).
