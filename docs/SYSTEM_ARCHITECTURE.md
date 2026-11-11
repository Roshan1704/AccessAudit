# System Architecture

Status: Draft v0.1 · Date: 2026-11-11

## 1. Principles

1. **One pipeline, many access strategies.** Public, credentialed, guided-session, journey, sitemap and state-discovery are *producers* of "discovery items" feeding one shared queue and one scan pipeline. No strategy has a private scanning path.
2. **Authentication is a first-class dependency** of the crawler from day one: every crawl/scan job carries an `authProfileId` (the anonymous visitor is just the profile with no session).
3. **Isolation by default.** Browser workers are untrusted-content processors: separate containers, no inbound ports, egress only through a validating proxy.
4. **Deterministic core, optional AI.** The scanner and validator run without any LLM. AI is an enrichment stage that can fail independently.
5. **Honest outputs.** Every result carries coverage and confidence; nothing is fabricated or rounded up.
6. **Tenant isolation in depth.** Org scoping in code, composite FKs, and PostgreSQL RLS.

## 2. Container view

```
                 ┌──────────────┐        ┌────────────────────────┐
  Browser ─────▶ │  web (Next)  │ ─────▶ │  api (Fastify, REST)   │──┐
                 └──────────────┘  HTTP  └─────────┬──────────────┘  │
                                                   │ enqueue        │ SQL (RLS)
                                         ┌─────────▼────────┐  ┌─────▼──────┐
                                         │ Redis / BullMQ   │  │ PostgreSQL │
                                         └─────────┬────────┘  └─────▲──────┘
                                                   │ jobs            │ results
              ┌────────────────────────────────────▼─────────────────┴───┐
              │ worker pool (Node + Playwright/Chromium, one container    │
              │ per concurrent job class, non-root, read-only FS)         │
              └───────┬───────────────────────────────┬──────────────────┘
                      │ all HTTP(S) from browser      │ artifacts
              ┌───────▼────────┐               ┌──────▼───────────┐
              │ egress proxy   │               │ S3 / MinIO       │
              │ (SSRF enforcer)│               │ screenshots, DOM │
              └───────┬────────┘               └──────────────────┘
                      ▼ public internet only
```

Additional processes:

- **session-capture service** (Phase 3): a worker variant hosting an interactive Chromium whose frames are relayed to the web UI (ADR-009).
- **scheduler** (in worker image, singleton via BullMQ repeatable jobs): schedules monitoring scans.
- **ai-enricher** (queue consumer, separate queue): consumes validated findings, calls the LLM layer, writes explanations.

## 3. Module map (maps to master-spec Part 20)

| # | Module | Location | Runs in |
|---|---|---|---|
| 1 | Web application | `apps/web` | web |
| 2 | API service | `apps/api` | api |
| 3 | Authentication module (users/sessions/API keys) | `apps/api/src/modules/auth` | api |
| 4 | Organization module | `apps/api/src/modules/orgs` | api |
| 5 | Project module | `apps/api/src/modules/projects` | api |
| 6 | Authentication profile manager | `apps/api/src/modules/auth-profiles` + `packages/security` (crypto) | api |
| 7 | Browser session manager | `packages/crawler/src/sessions` | worker, session-capture |
| 8 | Navigation recorder | `packages/crawler/src/journeys` + web UI | worker, web |
| 9 | Crawl orchestration | `packages/crawler/src/orchestrator` | worker |
| 10 | URL discovery | `packages/crawler/src/discovery` | worker |
| 11 | Browser worker | `apps/worker` | worker |
| 12 | Accessibility engine | `packages/a11y-engine/src/scan` | worker |
| 13 | Interaction testing | `packages/a11y-engine/src/interaction` | worker |
| 14 | Finding validation | `packages/a11y-engine/src/validation` | worker |
| 15 | AI explanation | `packages/ai` | ai-enricher |
| 16 | Issue management | `apps/api/src/modules/issues` | api |
| 17 | Reporting | `apps/api/src/modules/reports` (render in worker) | api, worker |
| 18 | Notifications | `apps/api/src/modules/notifications` | api |
| 19 | Monitoring | `apps/worker/src/scheduler` | worker |
| — | Shared types/Zod schemas, error model | `packages/shared` | all |
| — | URL/SSRF/crypto/redaction primitives | `packages/security` | api, worker |
| — | Schema, migrations, repositories | `packages/db` | api, worker |

Dependency rule (enforced by lint boundaries in Phase 1): `shared` ← `security` ← `db` ← `crawler`/`a11y-engine`/`ai` ← `apps/*`. Packages never import from apps. `web` imports only `shared` (types/schemas) and talks to the API over HTTP.

## 4. Unified scan pipeline

```
ScanRequest(project, authProfile[], config, strategies[])
   │
   ▼
[1 authorize]   domain proof + allow-list check            ──fail──▶ scan rejected
[2 auth init]   resolve profile: anonymous | credentials | stored session
                health-check session                        ──fail──▶ WAITING_FOR_AUTH
[3 discover]    producers emit DiscoveryItem{url, stateHint, source, depth}
                  sitemap · links · rendered DOM · user URLs · journeys · state discovery
                normalize → dedupe → policy filter (scope, patterns, depth, limits)
                                                             │ queue: scan-page
[4 render]      browser worker loads page via egress proxy; per-request revalidation
[5 evidence]    DOM snapshot, screenshot, a11y tree → object storage
[6 scan]        axe-core + custom rules (registry, pinned versions)
[7 interact]    keyboard/dialog/form/menu/dynamic tests (read-only policy)
[8 validate]    deterministic validation → classification + confidence
[9 persist]     findings, occurrences, evidence, coverage rows (transactional per page)
[10 dedupe]     fingerprint → upsert issue groups; compare to previous scan
[11 enrich]     enqueue AI jobs (independent queue)
[12 finalize]   coverage calc → scan status → notifications → report refresh
```

Design points:

- **Per-page transactional persistence (step 9)** gives progressive results and failure isolation: a crash on page N never discards pages 1..N-1.
- **Idempotency:** job key = `scanId + normalizedUrl + stateKey + authProfileId`. Re-delivery overwrites, never duplicates (unique constraint).
- **DiscoveryItem** is the single contract between producers and the scanner (defined in `packages/shared`).
- **State discovery (step 7/3 loop):** when interactions reveal a new state, a derived DiscoveryItem with a `stateKey` re-enters step 4 on the *same* browser page context, not as a new URL fetch.

### Scan job state machine

```
QUEUED ─▶ RUNNING ─┬─▶ COMPLETED
                   ├─▶ PARTIALLY_COMPLETED   (some pages failed / auth lost / limits hit)
                   ├─▶ WAITING_FOR_AUTH ─▶ RUNNING (user re-authenticates)
                   │                    └▶ PARTIALLY_COMPLETED (timeout / user declines)
                   ├─▶ FAILED               (nothing usable produced)
                   └─▶ CANCELLED
```

`COMPLETED` is set only when coverage rules allow it (REQ-COV-04). If undiscovered or inaccessible targets remain, the terminal state is `PARTIALLY_COMPLETED` with reasons.

## 5. Data flow and trust boundaries

| Boundary | Trust | Controls |
|---|---|---|
| Internet → web/api | Untrusted | TLS, CSRF, rate limits, validation |
| api → worker (queue payload) | Trusted internal, but payload contains **no secrets**, only IDs | Worker fetches what it needs under its own DB role |
| worker → target site (via proxy) | **Hostile content** | Egress proxy, container isolation, resource limits |
| worker → DB | Limited role | Worker DB role: no access to `users`, `api_keys`; can read encrypted blobs only for the job's org/profile |
| worker/api → LLM provider | External | Redaction, minimization, org opt-in, no session material |
| web → api | Session cookie / API key | Server-side authz on every call |

## 6. Scalability

- Workers are stateless; scale by replica count. Concurrency is per worker (`WORKER_CONCURRENCY`) and per scan (config), with per-org quotas enforced in the orchestrator.
- BullMQ queues: `discover`, `scan-page`, `session-health`, `ai-enrich`, `report`, `scheduler`. Separate queues stop AI/report backlogs from starving scanning.
- Large artifacts go to object storage; DB holds references + hashes.
- Hot read paths (dashboard aggregates) use indexed counters per scan (`scan_stats`) updated transactionally, not table scans.

## 7. Failure handling

| Failure | Behavior |
|---|---|
| Worker crash mid-page | BullMQ stall detection → retry; idempotent upsert prevents duplicates |
| Page navigation failure | Recorded in `crawled_pages` with reason; counted in coverage |
| Session expired | Protected jobs for that profile pause (`WAITING_FOR_AUTH`); public results kept |
| LLM outage | Findings remain; explanation status `pending/failed`, retried with backoff |
| Redis down | API rejects new scans with 503; no silent drops |
| DB down | Workers retry with backoff; no result loss for completed in-memory page until retry budget ends, then page marked failed |

## 8. Observability

Pino JSON logs with `requestId`, `scanId`, `jobId`, `orgId` (never PII/secrets; redaction list centralized in `packages/security`). OpenTelemetry traces across api → queue → worker. Prometheus metrics: queue depth, job duration, page failure rate, browser memory. Details in Phase 9.

## 9. Deployment

Docker images per app (`web`, `api`, `worker`, `egress-proxy`). Compose for local/small installs; container orchestrator manifests documented for production. Workers run on a dedicated network segment whose only route out is the egress proxy. See ADR-011.

## 10. Proportionality review (PM decision 2026-11-11; ADR-020)

Shape: **modular monolith** — two deployables (`api`, `worker`) plus `web`, sharing packages. Data stores: Postgres, Redis, S3-compatible storage only. No microservices, no service mesh, no separate search engine.

| Item | Initial SaaS readiness | Later commercial scaling | Implementation cost / note |
|---|---|---|---|
| Tenant isolation (`organization_id`, composite FKs, forced RLS, `withTenant`) | **Essential** | — | Medium, front-loaded in Phase 1; retrofitting later is far costlier. Every repository test must run under non-superuser roles. |
| SSRF defenses (UrlPolicy, browser route revalidation, egress proxy with IP pinning, network policy) | **Essential** | — | High: one extra container plus an adversarial test suite. Non-negotiable because the product fetches arbitrary customer-supplied URLs. |
| Domain verification + revalidation | **Essential** | — | Low–medium. |
| Encrypted secrets (`KeyProvider`, AES-256-GCM envelope) | **Essential** (integration/AI tokens; foundation for future sessions) | KMS-backed provider, rotation drills | Low for env-key provider; KMS later is an adapter swap. |
| Evidence integrity (immutable occurrences, hashes, redaction) | **Essential** | — | Medium. |
| Platform auth: argon2id, sessions, CSRF, rate limits, recovery | **Essential** | TOTP MFA, SSO/OIDC | Medium; MFA later is additive. |
| Audit log | **Essential** (domain/robots override accountability) | export, SIEM streaming | Low. |
| Per-org quotas | **Essential** (abuse control) | fair queueing, billing metering | Low for hard caps; fair queueing is high and deferred. |
| BullMQ workers, horizontal scale by adding worker containers | Essential | autoscaling, regional workers | Low. |
| Egress proxy | Essential | HA proxy fleet | Medium. |
| OpenTelemetry/metrics | Logs + health checks essential | full tracing/dashboards, SLOs | Low now, medium later. |
| `finding_occurrences` partitioning, k6 perf suite, multi-region, read replicas | Not needed | When volume data justifies | Decide on measured numbers. |
| Enterprise admin (SCIM, SSO, custom roles, audit export) | Not needed | On customer demand | High; no MVP justification. |
| Authenticated scanning stack (session-capture service, remote browser, vault of sessions) | Not needed | Future phase (ADR-009) | Very high; largest avoided cost. |
| Billing/subscriptions | Not needed | Before paid launch | Medium; quotas hooks only. |

Rule: any new infrastructure component requires an ADR stating the MVP justification and cost.
