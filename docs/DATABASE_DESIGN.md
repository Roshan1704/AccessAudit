# Database Design

PostgreSQL 16 · Drizzle ORM · Status: Draft v0.1 · Date: 2026-11-11

## 1. Conventions

- Primary keys: `uuid` (`gen_random_uuid()`; UUIDv7 considered later for index locality).
- Every table: `created_at timestamptz not null default now()`; mutable tables also `updated_at`.
- Soft delete (`deleted_at`) only where users expect restore/retention: `organizations`, `projects`, `authentication_profiles`, `navigation_journeys`, `reports`, `integrations`. Scan evidence tables are **never** soft-deleted; they are purged by retention jobs.
- Tenant tables carry `organization_id uuid not null`. Child tables carry it too (denormalized) and use **composite FKs** `(organization_id, parent_id) → parent(organization_id, id)` so cross-tenant references are structurally impossible. Parents therefore declare `unique (organization_id, id)`.
- Enums are Postgres enums or `text` + `check`, never free text.
- Secrets: columns named `*_ciphertext bytea` with `key_id`, `nonce`, `aad_hash`; never plaintext (ADR-010).
- Immutable tables (`scans` once finished, `finding_occurrences`, `finding_history`, `audit_logs`) are protected by triggers that reject UPDATE/DELETE (retention uses a dedicated role).

## 2. Entity overview

```
users ─< organization_members >─ organizations ─< projects ─< project_settings (1:1)
                                      │               │
                                      │               ├─< authentication_profiles ─< encrypted_credentials
                                      │               │            └─< browser_sessions
                                      │               ├─< navigation_journeys ─< journey_steps
                                      │               ├─< scheduled_scans
                                      │               └─< scans ─< scan_jobs
                                      │                     ├─< crawled_pages ─< application_states ─< page_snapshots
                                      │                     ├─< finding_occurrences >─ findings ─< finding_evidence
                                      │                     │                              ├─< finding_comments
                                      │                     │                              ├─< finding_assignments
                                      │                     │                              └─< finding_history
                                      │                     ├─< scan_coverage_items
                                      │                     └─< reports
                                      ├─< invitations, api_keys, integrations, notifications, audit_logs
accessibility_rules ─< rule_versions   (global, not tenant-owned)
```

Key modeling decision: **`findings` is the deduplicated issue (identity across scans, keyed by fingerprint); `finding_occurrences` is a per-scan, per-page, per-state sighting.** This gives stable issue management and regression detection while preserving per-page evidence and keeping scan records immutable.

## 3. Tables

Only non-obvious columns are listed; all have `id`, timestamps, and `organization_id` where tenant-owned.

### Identity and tenancy

| Table                  | Notes                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                | `email citext unique`, `password_hash` (argon2id), `email_verified_at`, `mfa_secret_ciphertext?`, `disabled_at`. Not tenant-owned.                      |
| `user_sessions`        | `session_hash unique`, `user_id`, `expires_at`, `revoked_at`, `ip_hash`, `ua_hash`.                                                                     |
| `organizations`        | `slug unique`, `name`, `settings jsonb` (ai_opt_in, retention_days, branding), `deleted_at`.                                                            |
| `organization_members` | PK `(organization_id, user_id)`; `role enum(owner,admin,member,viewer)`. Constraint: at least one owner (enforced in a transaction + deferred trigger). |
| `invitations`          | `email`, `role`, `token_hash unique`, `expires_at`, `accepted_at`.                                                                                      |
| `api_keys`             | `key_prefix`, `key_hash unique`, `scopes text[]`, `last_used_at`, `expires_at`, `revoked_at`. Full key shown once.                                      |
| `audit_logs`           | `actor_type(user                                                                                                                                        | api_key | system)`, `actor_id`, `action`, `target_type`, `target_id`, `metadata jsonb`(redacted),`request_id`, `ip_hash`. Append-only. |

### Projects and authorization

| Table                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`           | `name`, `base_url`, `deleted_at`. Unique `(organization_id, lower(name)) where deleted_at is null`.                                                                                                                                                                                                                                                                                                                                                                                           |
| `project_settings`   | 1:1; `wcag_version`, `conformance_level`, `crawl_config jsonb` (validated by Zod at write), `interaction_policy` (`read_only` default / `approved_workflows`), `ai_enabled`.                                                                                                                                                                                                                                                                                                                  |
| `authorized_domains` | `project_id`, `hostname`, `verification_method enum(dns_txt,well_known)` (attestation removed, ADR-017), `status enum(pending,verified,failed,expired,revoked)`, `token_hash`, `verified_at`, `last_verified_at`, `next_revalidate_at`, `failed_checks int`, `verified_by`, `created_at`. Unique `(project_id, hostname)`. **Scans may only target rows with `status='verified'` and a successful revalidation immediately before scan start.** Tokens are never reused across projects/orgs. |

### Authentication — DEFERRED (not in MVP migrations; designed for the future auth phase)

| Table                     | Notes                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authentication_profiles` | `project_id`, `label` (e.g. "Administrator"), `strategy enum(anonymous,credentials,guided_session,saved_session)`, `login_config jsonb` (URLs and locator descriptors only — **no secrets**), `status enum(unconfigured,active,needs_reauth,locked,disabled)`, `last_verified_at`, `deleted_at`. Unique `(project_id, lower(label))`. Exactly one `anonymous` profile is auto-created per project. |
| `encrypted_credentials`   | `profile_id`, `kind(username                                                                                                                                                                                                                                                                                                                                                                       | password                                                                                                                                                                                             | totp_seed | api_token)`, `ciphertext`, `nonce`, `key_id`, `aad_hash`, `rotated_at`. Unique `(profile_id, kind)`. Never returned by any API. |
| `browser_sessions`        | `profile_id`, `domain` (bound), `state_ciphertext` (Playwright storage state), `nonce`, `key_id`, `aad_hash`, `captured_via(guided                                                                                                                                                                                                                                                                 | automated)`, `captured_at`, `expires_at`, `last_health_check_at`, `health enum(unknown,healthy,expired,invalid)`, `revoked_at`. Partial unique index: one active session per `(profile_id, domain)`. |

### Journeys — DEFERRED (not in MVP migrations)

| Table                 | Notes                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigation_journeys` | `project_id`, `profile_id?`, `name`, `version int`, `status(draft                                                                                                                                                                                                                                                   | active | archived)`, `deleted_at`. |
| `journey_steps`       | `journey_id`, `position int`, `action enum(navigate,click,fill_approved,select,expand,collapse,open_tab,wait_for,verify,screenshot)`, `locator jsonb` (role/name/label/testid/css), `value_ref` (reference to an approved test input, **not** raw sensitive text), `expect jsonb`. Unique `(journey_id, position)`. |

### Scanning

| Table                 | Notes                                                                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scans`               | `project_id`, `trigger(manual                                                                                                                                                                                                                        | schedule  | api     | ci)`, `status`(job state machine),`config_snapshot jsonb`(frozen copy of crawl/WCAG config, including`robotsOverride {enabled, enabledBy, enabledAt, reason}`per ADR-018; the override is also written to`audit_logs`), `engine_versions jsonb`(axe-core, playwright, chromium, custom ruleset),`started_at`, `finished_at`, `status_reason`, `previous_scan_id?`, `stats jsonb`(counters maintained transactionally),`immutable_at` (set at terminal state; trigger blocks further edits to everything except notes). |
| `scan_profiles`       | join `scan_id` ↔ `profile_id`, with per-profile status (so one role can wait for auth while others finish).                                                                                                                                          |
| `scan_jobs`           | `scan_id`, `queue`, `job_key unique`, `kind(discover                                                                                                                                                                                                 | scan_page | journey | state_probe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ai      | report)`, `status`, `attempts`, `error_class`, `error_message`(redacted),`started_at`, `finished_at`.                                                                                                                                                                                              |
| `crawled_pages`       | `scan_id`, `profile_id`, `normalized_url`, `url_hash`, `discovered_via(sitemap                                                                                                                                                                       | link      | dom     | user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | journey | redirect)`, `depth`, `http_status`, `final_url`, `coverage_status enum(audited,partial,not_audited,inaccessible,requires_auth,requires_manual,excluded,excluded_by_robots,failed)`, `status_reason`, `page_category?`, `template_hash?`, `error_class?`. Unique `(scan_id, profile_id, url_hash)`. |
| `application_states`  | `page_id`, `state_key` (hash of trigger path), `description`, `trigger jsonb` (e.g. click role=button name="Notifications"), `parent_state_id?`, `tested bool`, `coverage_status`. Unique `(page_id, state_key)`. Base state has `state_key='base'`. |
| `page_snapshots`      | `state_id`, `dom_object_key`, `screenshot_object_key`, `a11y_tree_object_key`, `content_hash`, `byte_size`, `captured_at`, `retain_until`. Objects live in S3; encrypted at rest.                                                                    |
| `scan_coverage_items` | Non-page coverage: journeys completed/failed, URLs excluded by pattern, URLs discovered-but-never-fetched. `scan_id`, `kind`, `ref`, `status`, `reason`. Feeds Coverage Intelligence.                                                                |

### Findings

| Table                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accessibility_rules`       | Global registry: `rule_id` (stable), `source(axe                                                                                                                                                                                                                                                                                                                                                                                                         | custom)`, `name`, `description`, `severity_default`, `known_limitations`, `remediation_ref`. |
| `rule_versions`             | `rule_id`, `version`, `engine_version`, `wcag_mappings jsonb` (criterion, version, level, `w3c_url`), `deprecated_at`. Immutable → historical scans stay interpretable.                                                                                                                                                                                                                                                                                  |
| `findings`                  | **Issue identity.** `project_id`, `fingerprint` (text, see §5), `rule_id`, `wcag_primary`, `first_seen_scan_id`, `last_seen_scan_id`, `status enum(open,in_progress,resolved,accepted_risk,false_positive,ignored)`, `priority`, `due_date`, `external_refs jsonb`, `component_hint`, `selector_hint`, `url_pattern`. Unique `(project_id, fingerprint)`.                                                                                                |
| `finding_occurrences`       | **Per-scan sighting.** `finding_id`, `scan_id`, `page_id`, `state_id`, `profile_id`, `selector`, `html_snippet` (truncated, scrubbed), `severity`, `confidence numeric(3,2)`, `classification enum(confirmed,strong_potential,manual_verification,informational,passed)`, `detection_method`, `validation_status`, `validation_trace jsonb`, `rule_version_id`. Unique `(scan_id, finding_id, page_id, state_id, profile_id, selector_hash)`. Immutable. |
| `finding_evidence`          | `occurrence_id`, `kind(dom_context                                                                                                                                                                                                                                                                                                                                                                                                                       | computed_style                                                                               | aria_relation     | screenshot_region              | keyboard_trace | accessible_name_calc)`, `data jsonb`or`object_key`, `redacted bool`. |
| `ai_explanations`           | `finding_id`, `occurrence_id?`, `provider`, `model`, `prompt_version`, `status`, `content jsonb` (schema-validated), `generated_at`. Separate from findings; labeled AI-generated; cannot alter classification.                                                                                                                                                                                                                                          |
| `manual_verification_tasks` | `scan_id`, `occurrence_id?`, `instructions`, `status(pending                                                                                                                                                                                                                                                                                                                                                                                             | passed                                                                                       | failed            | na)`, `completed_by`, `notes`. |
| `finding_comments`          | `finding_id`, `author_id`, `body`, `internal bool`.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `finding_assignments`       | `finding_id`, `assignee_id`, `assigned_by`, `assigned_at`, `unassigned_at?`.                                                                                                                                                                                                                                                                                                                                                                             |
| `finding_history`           | Append-only log: `finding_id`, `scan_id?`, `event(status_change                                                                                                                                                                                                                                                                                                                                                                                          | severity_change                                                                              | confidence_change | reopened                       | assigned       | comment                                                              | detected | not_detected)`, `from jsonb`, `to jsonb`, `actor`. |

### Reporting, scheduling, notifications, integrations

| Table             | Notes                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reports`         | `scan_id`, `format(pdf                                                                                                                                                    | csv    | json | html)`, `options jsonb`(branding, title),`object_key`, `sha256`, `status`, `share_token_hash?`, `share_expires_at?`, `allow_download bool`, `deleted_at`. |
| `scheduled_scans` | `project_id`, `cron` or `preset`, `timezone`, `profile_ids uuid[]`, `enabled`, `next_run_at`, `last_scan_id`. Dedup: partial unique on active in-flight scan per project. |
| `notifications`   | `user_id`, `type`, `payload jsonb`, `read_at`.                                                                                                                            |
| `integrations`    | `kind(github                                                                                                                                                              | gitlab | jira | linear                                                                                                                                                    | slack | webhook)`, `config jsonb`, `secret_ciphertext`, `status`. |

## 4. Isolation model

1. Every request/job opens a transaction via `withTenant(orgId, fn)` which runs `SET LOCAL app.org_id = '<uuid>'`.
2. RLS: `ENABLE` + `FORCE ROW LEVEL SECURITY` on each tenant table; policy `USING (organization_id = current_setting('app.org_id')::uuid)` for SELECT/UPDATE/DELETE and `WITH CHECK` for INSERT/UPDATE.
3. Roles: `aa_migrator` (owner, DDL), `aa_api`, `aa_worker`, `aa_retention`. `aa_api`/`aa_worker` are `NOBYPASSRLS`. `aa_worker` has no grants on `users`, `user_sessions`, `api_keys`, `invitations`.
4. Composite FKs prevent cross-tenant parent references.
5. Object storage keys are prefixed by `org/{orgId}`; signed URLs are issued only after an application-level check **and** are scoped to a single key.
6. Tests: an automated suite attempts cross-tenant reads/writes through repositories, raw SQL under the app role, and via the API; all must fail (see `TESTING_STRATEGY.md`).

## 5. Finding fingerprint

Goal: stable across scans despite cosmetic DOM/selector change; different for genuinely different problems.

```
fingerprint = sha256(
  ruleId
  | normalizedUrlTemplate         // path with ids/uuids/numbers collapsed, query params filtered per config
  | profileScopeKey               // role matters: admin-only issue != visitor issue
  | stateKey                      // base or hash of trigger path
  | elementIdentity               // see below
)
elementIdentity = first available of:
  1. stable attribute: data-testid | id (not matching generated patterns) | name
  2. role + normalized accessible name + landmark path (nearest landmark/heading ancestors)
  3. tag + normalized text prefix + position among same-role siblings under nearest stable ancestor
```

Raw CSS selector is stored for developer convenience but is **not** the identity. Fuzzy matching (Jaccard over identity tokens ≥ threshold) is used only to flag "probable move/rename" for human review, never to silently merge. Same fingerprint at multiple URLs of one template becomes one `findings` row with many occurrences (template grouping), and the per-page evidence stays in occurrences.

Regression states, computed by comparing fingerprint sets of two scans: `new`, `persistent`, `resolved`, `reappearing` (resolved earlier, seen again), plus severity/confidence/coverage deltas. Comparison is only meaningful for pages covered in both scans; pages not covered in one are reported as "unknown", never "resolved".

## 6. Indexing (initial set; revisit with `EXPLAIN` in Phase 9)

- `crawled_pages (scan_id, coverage_status)`, `(scan_id, profile_id, url_hash)` unique.
- `finding_occurrences (scan_id, severity)`, `(finding_id, scan_id)`, `(scan_id, page_id)`.
- `findings (project_id, status)`, `(project_id, last_seen_scan_id)`, unique `(project_id, fingerprint)`.
- `scans (project_id, started_at desc)`; partial index on non-terminal statuses.
- `scan_jobs (scan_id, status)`, unique `job_key`.
- `audit_logs (organization_id, created_at desc)`.
- `browser_sessions (profile_id) where revoked_at is null` unique-partial.
- Dashboard aggregates read `scans.stats` (maintained incrementally) rather than counting occurrences.

## 7. Transactions

- One transaction per scanned page: insert page snapshot refs, occurrences, evidence, upsert findings, update `scans.stats` and coverage. All-or-nothing; idempotent on retry via unique keys.
- Status transitions use `UPDATE … WHERE status = <expected>` (compare-and-set) to avoid races between cancel/complete.
- Issue status change + history row + audit log in one transaction.

## 8. Retention and deletion

Per-org `retention_days` for snapshots and raw occurrences (summaries/fingerprints retained longer for trends). Snapshot rows record `retain_until`; a retention job deletes objects first, then rows. Session blobs are deleted on revoke/expiry and on profile deletion (hard delete, not soft). Org deletion cascades via a documented, audited purge job.

## 9. Migrations

SQL migration files generated by drizzle-kit, reviewed, and applied by `aa_migrator` in CI against a real Postgres. Rules: forward-only, backward-compatible within a release (expand → migrate → contract), no destructive migration without a documented rollback/backup step.

## 10. Known open items

- Whether to partition `finding_occurrences` by `scan_id` / time (decide with real volume numbers in Phase 9).
- UUIDv7 adoption for index locality.
