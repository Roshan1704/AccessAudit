# Crawler Architecture

Status: Draft v0.1 · Date: 2026-11-11 · Code lives in `packages/crawler`, executed by `apps/worker`.
Prerequisite: `SECURITY_THREAT_MODEL.md` controls T-SSRF-*, T-BRW-*, T-CRED-06.

## 1. Design goals
1. One pipeline: every strategy emits `DiscoveryItem`s; nothing scans outside the pipeline.
2. Auth profile is part of every item from day one.
3. Honest coverage: every discovered URL ends in an explicit status; nothing disappears.
4. Safe by default: SSRF-hardened, read-only interactions, bounded resource use.
5. Resumable and idempotent.

## 2. Core contract

```ts
// packages/shared
interface DiscoveryItem {
  scanId: string;
  authProfileId: string;      // anonymous profile is a real row
  url: string;                // normalized
  stateKey: string;           // 'base' or hash of interaction path
  stateTrigger?: StateTrigger;// how to reach the state from base
  source: 'seed'|'sitemap'|'link'|'dom'|'user'|'journey'|'redirect'|'state';
  depth: number;
  parentUrl?: string;
  journeyId?: string;
}
```
Job id = `sha256(scanId|url|stateKey|authProfileId)`; duplicates are dropped by BullMQ and by the `crawled_pages`/`application_states` unique keys.

## 3. Components

| Component | Responsibility |
|---|---|
| `UrlPolicy` (packages/security) | Parse, canonicalize, reject unsafe forms, scope check (authorized domains), pattern include/exclude. Pure and heavily tested. |
| `Normalizer` | Lowercase host, strip fragments, default ports, resolve dot-segments, sort/filter query params per config (ignore tracking params; param allow-list), trailing-slash policy, `url_hash`. |
| `Frontier` | Per-scan dedupe set (DB-backed, `crawled_pages` unique key) and priority: seeds/user URLs > sitemap > links by depth. Enforces max pages, depth, per-host crawl delay. |
| Producers | `SeedProducer`, `SitemapProducer` (robots-declared + `/sitemap.xml`, index recursion, gzip, size caps, XML bomb guard), `LinkProducer` (rendered anchors incl. SPA `history` routes), `UserUrlProducer`, `JourneyProducer`, `StateProducer`. |
| `SessionManager` | Provides an authenticated `BrowserContext` for `(scan, profile)`; health checks; detects expiry mid-scan (see AUTHENTICATION_ARCHITECTURE). |
| `PageRunner` | Load page via proxy, wait strategy, capture evidence, invoke a11y engine, emit new items. |
| `StateExplorer` | Safe interaction discovery on the loaded page (see §6). |
| `CoverageTracker` | Writes coverage statuses and reasons; computes scan terminal state. |
| `Orchestrator` | Scan lifecycle, per-org quotas, cancel, WAITING_FOR_AUTH handling, finalize. |

## 4. Flow

1. `POST /scans` → authorize (verified domains) → create scan + `scan_profiles` → enqueue `discover` job.
2. Orchestrator resolves each profile → `SessionManager.prepare(profile)`. Failure classification decides: profile → `WAITING_FOR_AUTH`; other profiles continue.
3. Producers run (configured strategies), emitting items through `Frontier` (normalize → policy → dedupe → persist `crawled_pages` row with `coverage_status=not_audited` + reason pending → enqueue `scan-page`).
4. `PageRunner` job:
   - Acquire context for `(scan, profile)`; verify session still valid (cheap check: expected-auth indicator).
   - Navigate (timeout, `waitUntil` configurable; post-load settle: network idle bounded + DOM mutation quiet period).
   - Detect login redirect / 401 / 403 / CAPTCHA / block pages → classify and update coverage (never audit a login wall as if it were the target page).
   - Capture DOM snapshot, screenshot, accessibility tree → object store.
   - Run a11y engine (base state).
   - Run `StateExplorer` (if enabled) → each new state tested in place, persisted as `application_states`.
   - Extract links → producers → frontier.
   - Persist atomically (one transaction), update stats.
5. `CoverageTracker` finalizes when frontier is empty and no jobs are in flight (or limits hit / cancel).

## 5. Discovery strategies detail

- **Sitemap:** parse with entity expansion disabled; cap decompressed size and URL count; sitemap URLs pass the same `UrlPolicy` (cross-domain entries rejected unless authorized).
- **Links:** collect `a[href]`, `area`, `link[rel=next]`, router links (rendered), `form[method=get]` actions only if configured; ignore `javascript:`/`mailto:`/`tel:`.
- **SPA:** after load, observe `history.pushState`/`replaceState`, hash routes; click-through of navigation landmarks only under the read-only policy; each distinct route is a URL item. Virtual URLs not addressable by URL are states.
- **Infinite scroll:** bounded: max scroll steps, max height growth, stop when no new content between steps; remainder recorded as partial coverage ("scroll budget exhausted").
- **Redirects:** recorded with chain; final URL scope-checked; loops capped (max 10).
- **Query params:** modes `ignore-all | allow-list | keep-all-capped`; faceted-navigation explosion guard (max variants per path).
- **Pagination/traps:** calendar-like infinite URL families detected via path-pattern growth heuristics (same template, rapidly growing distinct URLs) → cap per template (`template_hash`).
- **Robots/crawl delay (ADR-018, PM-approved; reverses the earlier draft):** respect `Disallow` by default and honor `Crawl-delay`. Domain verification never implies ignoring crawler restrictions. A verified-domain owner (admin+) may enable an explicit per-scan override with a reason; it is stored in the scan `config_snapshot` (`robotsOverride`) and the audit log, and disclosed in scan detail and reports. Disallowed URLs get coverage status `excluded_by_robots`. Rate limits still apply under override.
- **User URLs / journeys:** treated as high-priority seeds with explicit `source`.

## 6. Application state discovery

Policy tiers (default tier 1):
1. **Read-only:** interact only with elements classified safe: `button[aria-expanded]`, `[role=tab]`, `summary`, `[aria-haspopup]` menus, accordion headers, search-overlay triggers, dialog openers *whose classifier score says non-destructive*.
2. **Approved workflows:** project-level opt-in with named journeys in a test environment.

Destructive classifier: blocks by accessible name/text/attributes/URL patterns (delete, remove, pay, buy, purchase, order, publish, submit, confirm, logout, sign out, unsubscribe, send, transfer, approve…, localized list configurable), by `form` submit buttons, by `type=submit`, by links leading to out-of-scope or non-GET targets. Also request-level guard during exploration: any non-GET/HEAD request issued as a result of an exploratory click is aborted and the state marked `requires_manual`.

Exploration algorithm (bounded BFS per page):
```
base state → candidates = enumerate interactive elements (by role, visible, enabled)
for c in candidates ordered by stability/priority (cap N per page):
   if blocked(c): record as requires_manual (reason) ; continue
   snapshotBefore = domHash
   perform(c) with timeout ; wait settle
   if domHash changed OR new dialog/menu/aria-expanded change:
        stateKey = hash(path of triggers) ; if seen: skip
        persist state ; run a11y engine on current DOM
        recurse (depth ≤ maxStateDepth)
   restore: Escape / toggle back / reload+replay trigger path (state replay)
```
Each state stores its `trigger` so it can be replayed and so findings can say exactly how to reach it. Failed restore → reload page and replay path; if impossible, mark remaining candidates `not_audited` with reason.

## 7. Resource and safety limits (defaults, all configurable within hard caps)

| Limit | Default | Hard cap |
|---|---|---|
| Max pages / scan | 200 | 5000 |
| Max depth | 4 | 10 |
| Nav timeout | 30 s | 120 s |
| Page wall-clock | 120 s | 300 s |
| Concurrency / scan | 3 | 10 |
| Per-host delay | 250 ms | n/a |
| Response body cap | 25 MB | 100 MB |
| DOM nodes | 50,000 | 200,000 |
| States / page | 25 | 100 |
| Retries (network/5xx only) | 2 with backoff | 5 |
| Redirects | 10 | 10 |
Auth failures are **never** retried automatically (T-CRED-07).

## 8. Failure classification (written to `crawled_pages.error_class`)

`dns_failure`, `tls_error`, `timeout`, `http_4xx`, `http_5xx`, `blocked_by_policy` (SSRF/scope), `redirect_loop`, `requires_auth`, `forbidden_for_role`, `captcha`, `bot_block`, `content_too_large`, `crash` (page/browser), `cancelled`. Each maps to a coverage status and user-facing explanation.

## 9. Coverage computation

Per scan, per profile: counts of discovered / audited / partial / inaccessible / requires-auth / requires-manual / excluded / failed pages; states discovered vs tested; journeys completed vs failed.
- `COMPLETED` only if: frontier exhausted without limit hit, no `requires_auth`/`inaccessible`/`failed` beyond a configured tolerance of 0 for pages that were *discovered as in-scope*, and all requested profiles ran.
- Otherwise `PARTIALLY_COMPLETED` with a machine-readable reasons list (e.g. `max_pages_reached`, `profile_X_session_expired`, `12_pages_timeout`).
- UI shows counts and gap list, never a bare percentage, and always includes "undiscovered pages are unknown" note.

## 10. Cancellation, resume, idempotency
- Cancel sets scan flag; in-flight jobs check at safe points; queue jobs for the scan are removed; completed pages retained.
- Resume after `WAITING_FOR_AUTH`: orchestrator re-enqueues only items for that profile whose status is `requires_auth`.
- Worker restart: stalled jobs retried; persistence idempotent via unique keys.

## 11. Browser/process model
Worker process pool; each job uses a fresh BrowserContext from a per-org-isolated browser process (never shared across orgs). Browser launched with proxy flags, disabled extensions, no persistent profile on disk (tmpfs), downloads denied, permissions denied, `service workers` blocked unless needed, fixed viewport (+ secondary viewports for reflow tests in Phase 5).

## 12. Testing hooks
Fixture sites under `fixtures/` (static pages, SPA, infinite scroll, sitemap variants, redirect loops, login flows incl. failure modes, MFA stub page, CAPTCHA stub, trap calendars, destructive buttons, rebinding DNS server). Loopback allowed only through the test-only SSRF override (compile-time flag; asserted off in production builds).

## 13. Out of scope for Phase 2–3
Firefox/WebKit, PDF accessibility, native mobile apps, CAPTCHA solving, bypassing bot protection.

## 14. MVP scope note (PM decision 2026-11-11)
The MVP crawler covers **public, anonymous** scanning of verified domains only. Sections describing authenticated crawling (§2 profile handling beyond the anonymous profile, SessionManager implementations), navigation journeys, and state exploration (§6, `StateProducer`, `JourneyProducer`) are **DEFERRED**: the interfaces (`SessionManager`, `StateExplorer`, producer contract, `DiscoveryItem.authProfileId`) are kept as extension points, but no implementation, tables or endpoints are built in the MVP. Robots policy is governed by ADR-018 (§5).
