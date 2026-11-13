# API Specification

REST · JSON · Base path `/api/v1` · Status: Draft v0.1 · Date: 2026-11-11
The authoritative machine-readable contract will be generated from the Fastify Zod schemas into OpenAPI 3.1 (served at `/api/v1/openapi.json`, UI at `/docs`). This document fixes the conventions and resource surface.

## 1. Conventions

- **Auth:** (a) browser session cookie + CSRF header `X-CSRF-Token` for state-changing requests; (b) `Authorization: Bearer aa_live_…` API keys with scopes. Both resolve to a _principal_ `{userId|apiKeyId, orgId, role|scopes}`.
- **Tenancy:** organization comes from the path (`/orgs/{orgId}/…`) and is verified against the principal's membership; never trusted from the body.
- **Versioning:** URL major version. Additive changes only within `v1`; breaking change → `v2`.
- **Validation:** every request body, query, and path param validated by Zod; unknown fields rejected.
- **IDs:** UUIDs.
- **Pagination:** cursor-based: `?limit=50&cursor=…` (max 200) → `{ "data": [...], "page": { "nextCursor": "…"|null } }`. Sorting via `sort=field:asc|desc` from a per-endpoint allow-list.
- **Idempotency:** `Idempotency-Key` header supported on `POST /scans` and report creation.
- **Rate limits:** per IP (unauthenticated), per user, per API key, plus stricter limits on login, session-capture, and scan creation. Headers: `RateLimit-Limit/Remaining/Reset`, `Retry-After` on 429.
- **Errors** (RFC 9457 problem details):
  ```json
  {
    "type": "https://accessaudit.dev/errors/validation",
    "title": "Validation failed",
    "status": 422,
    "code": "VALIDATION_ERROR",
    "requestId": "…",
    "errors": [{ "path": "crawl.maxPages", "message": "Must be ≤ 5000" }]
  }
  ```
  Codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` (also returned for cross-tenant IDs — no existence leak), `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED`, `DOMAIN_NOT_AUTHORIZED`, `TARGET_NOT_ALLOWED` (SSRF policy), `QUOTA_EXCEEDED` (`AUTH_PROFILE_REQUIRES_ACTION` reserved for the deferred auth phase), `INTERNAL`.
- **Secrets never returned:** credentials, session state, API key hashes, share tokens (except once at creation).
- **Timestamps:** RFC 3339 UTC.

## 2. RBAC

| Role   | Capabilities                                               |
| ------ | ---------------------------------------------------------- |
| owner  | everything incl. delete org, billing-related settings      |
| admin  | manage members, projects, profiles, integrations, API keys |
| member | create/run scans, manage findings, create reports          |
| viewer | read-only incl. reports                                    |

API-key scopes: `projects:read|write`, `scans:read|write`, `findings:read|write`, `reports:read|write`, `profiles:read` (never secrets), `ci:run`. A key cannot exceed the creating user's role.

## 3. Resource surface

### Auth and identity

```
POST   /auth/register                POST /auth/login          POST /auth/logout
POST   /auth/password/forgot|reset   GET  /auth/me             POST /auth/email/verify
GET    /orgs                         POST /orgs
GET    /orgs/{orgId}                 PATCH /orgs/{orgId}       DELETE /orgs/{orgId}
GET/POST/PATCH/DELETE /orgs/{orgId}/members[/{userId}]
POST   /orgs/{orgId}/invitations     POST /invitations/{token}/accept
GET/POST/DELETE /orgs/{orgId}/api-keys[/{keyId}]
GET    /orgs/{orgId}/audit-logs
```

### Projects and domain authorization

```
GET/POST /orgs/{orgId}/projects
GET/PATCH/DELETE /orgs/{orgId}/projects/{projectId}
GET/PUT  /…/projects/{projectId}/settings
GET/POST /…/projects/{projectId}/domains                 # create domain + token; method dns_txt | well_known only (no attestation, ADR-017)
POST     /…/projects/{projectId}/domains/{id}/verify    # also runs on schedule and before each scan; status pending|verified|failed|expired|revoked
```

### Authentication profiles and sessions — DEFERRED (not in MVP; ADR-009)

```
GET/POST /…/projects/{pid}/auth-profiles
GET/PATCH/DELETE /…/auth-profiles/{profileId}            # responses omit secrets
PUT      /…/auth-profiles/{profileId}/credentials        # write-only
POST     /…/auth-profiles/{profileId}/verify             # run login verification
POST     /…/auth-profiles/{profileId}/guided-sessions    # start remote browser → { captureId, wsUrl(short-lived) }
POST     /…/guided-sessions/{captureId}/confirm          # user says "I'm logged in" → server captures state
POST     /…/guided-sessions/{captureId}/cancel
GET      /…/auth-profiles/{profileId}/session            # health/expiry metadata only
DELETE   /…/auth-profiles/{profileId}/session            # revoke + purge
POST     /…/auth-profiles/{profileId}/resume             # after user re-auth, resume waiting scans
```

### Journeys — DEFERRED (not in MVP)

```
GET/POST /…/projects/{pid}/journeys
GET/PUT/DELETE /…/journeys/{jid}                         # steps validated; sensitive values rejected
POST     /…/journeys/{jid}/replay                        # dry-run replay, returns step results
POST     /…/journeys/record                              # start recorder session (uses guided-session transport)
```

### Scans

```
POST /…/projects/{pid}/scans            { profileIds[], strategies[], config overrides }
GET  /…/projects/{pid}/scans            filters: status, trigger, date
GET  /…/scans/{scanId}                  # status, progress, stats, engine versions
POST /…/scans/{scanId}/cancel
GET  /…/scans/{scanId}/events           # SSE progress stream
GET  /…/scans/{scanId}/coverage         # grouped by url|profile|role|category|journey|state
GET  /…/scans/{scanId}/pages            # crawled pages, filters
GET  /…/scans/{scanId}/pages/{pageId}   # includes states + snapshot URLs (signed)
GET  /…/scans/compare?base=…&head=…     # new/resolved/persistent/reappearing + deltas
```

**Implemented in Phase 2 (2026-11-12).** The routes actually served differ from the planned surface above. All are under `/orgs/{orgId}`, require a session and CSRF on mutations, and return 404 for another tenant's ids:

```
POST  /orgs/{orgId}/scans                          { projectId, startUrl?, maxPages?, robotsOverride?: { reason } }  -> 202
GET   /orgs/{orgId}/scans                          list (filter projectId); each row adds openConfirmed and openPotential (open findings only)
GET   /orgs/{orgId}/scans/{scanId}                 status, summary (byClassification, bySeverity), per-page counts
POST  /orgs/{orgId}/scans/{scanId}/cancel          409 if already finished
GET   /orgs/{orgId}/scans/{scanId}/findings        filter: classification
GET   /orgs/{orgId}/findings/{findingId}           finding with evidence
PATCH /orgs/{orgId}/findings/{findingId}           { status }  review status
GET   /orgs/{orgId}/scans/{scanId}/manual-tasks
PATCH /orgs/{orgId}/manual-tasks/{taskId}          { status, note }
GET   /orgs/{orgId}/overview                       read-only aggregates (Phase 5), viewer or above
```

`GET /orgs/{orgId}/overview` returns, per live project, the latest completed scan only: open confirmed and potential counts by severity, pending manual tasks, pages scanned versus not scanned, and the scan's WCAG version and level. A project without a completed scan has `latestScan: null`. `totals` sums those counts. There is deliberately no composite score. Another tenant's org id returns 404.

Rules: viewers cannot start scans (403); the domain must be verified (409 `DOMAIN_NOT_VERIFIED`); private or cross-host start URLs are refused; a third queued or running scan in the same project returns 429 `QUOTA_EXCEEDED` (limit is two active scans per project); `robotsOverride` needs admin or owner and a reason of at least 10 characters, and is audited as `scan.created_robots_override`; unknown fields and out-of-range caps return 400. Counts are reported per classification; manual items never count toward severity totals.

Anonymous quick check (ADR-026, no session, same-origin only):

```
GET  /quick-check/challenge     proof-of-work challenge (single use)
POST /quick-check               { url, challenge, nonce }  -> 202 { id }; 429 `RATE_LIMITED` on per-IP, global or busy limits; 403 `FORBIDDEN` when the kill switch is on; 422 `URL_NOT_ALLOWED` for refused targets
GET  /quick-check/:id           { state } ; a done result is returned once and then removed
```

### Findings and issues

```
GET   /…/projects/{pid}/findings        filters: status, severity, classification, wcag, rule, url pattern, profile, assignee, q
GET   /…/findings/{fid}                 # identity + latest occurrence + history
GET   /…/findings/{fid}/occurrences
GET   /…/findings/{fid}/explanation     # source template|ai, guidance rule-specific|generic; MVP is template only
POST  /…/findings/{fid}/explanation     # (re)generate, if AI enabled
PATCH /…/findings/{fid}                 # status, priority, dueDate, externalRefs
POST  /…/findings/{fid}/comments        POST /…/findings/{fid}/assignments
GET   /…/findings/{fid}/history
GET   /…/scans/{sid}/manual-tasks       PATCH /…/manual-tasks/{id}
```

### Reports, notifications, schedules, integrations

```
POST/GET /…/scans/{sid}/reports         { format, options }   GET /…/reports/{id}/download  (signed URL)
POST     /…/reports/{id}/share          { expiresAt, allowDownload }
GET/POST/PATCH/DELETE /…/projects/{pid}/schedules
GET /me/notifications   PATCH /me/notifications/{id}
GET/POST/PATCH/DELETE /orgs/{orgId}/integrations
POST /ci/v1/check                       # CI entrypoint: start scan, return check URL (scope ci:run)
```

### Operational (unversioned)

`GET /healthz`, `GET /readyz`, `GET /metrics` (internal network only).

## 4. Contracts of note

- **`POST /scans`** accepts `robotsOverride: {enabled, reason}` (admin+ only; recorded in config snapshot and audit log; default off, ADR-018). It returns `202 Accepted` with `{ scanId, status: "QUEUED" }`. It fails with `DOMAIN_NOT_AUTHORIZED` if any target host (including configured extra domains) lacks a verified authorization. Auth-profile selection and `allowPartial` are deferred (ADR-009); MVP scans use the anonymous profile only.
- **Finding payload** includes every field listed in spec Part 10, plus `classification`, `confidence`, `detectionMethod`, `validationStatus`, `ruleVersion`, `engineVersions`. AI content is returned in a separate `aiExplanation` object marked `generatedBy: "ai"` with provider/model.
- **Coverage payload** never contains a single "coverage %" without the accompanying counts and unresolved-gap list.
- **Compare payload** marks pages not covered in both scans as `unknown`, never `resolved`.
- **Guided session WebSocket** is not part of REST: a short-lived, single-use, org-bound token authorizes the frame/input channel; it carries no session material to the browser, only screen frames and input events.

## 5. Webhooks and CI — DEFERRED (public API/CLI and integrations are not in MVP)

Outbound signed webhooks (`HMAC-SHA256`, timestamped) for `scan.completed`, `scan.partial`, `scan.waiting_for_auth`, `finding.regression`. GitHub integration reports a check run summarizing new/resolved vs. baseline; failing thresholds configurable by severity and classification (default: fail only on _confirmed_ serious/critical new findings).

## 6. Deferred

GraphQL, bulk import APIs, per-field ETag caching — not required for initial release.
