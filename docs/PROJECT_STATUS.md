# Project Status Register

Date: 2026-11-11 · Current phase: **0 — Foundation (PM decisions incorporated; awaiting explicit approval to start Phase 1)**

## Completed
- Repo/tooling scaffold (npm workspaces, TS project references, ESLint, Prettier, Vitest config, compose file for Postgres/Redis/MinIO).
- Design docs, TRACEABILITY_MATRIX, PROJECT_STATUS, README.
- PM decisions of 2026-11-11 reconciled across docs (see decision log).

## Not done (by instruction)
- No application code, no frontend, no seed/dummy data.
- `npm install` not run; no dependency installed; no lockfile; **no test executed**; no CI workflow yet.
- All requirements: incomplete (see TRACEABILITY_MATRIX).

## Decision log (PM-approved 2026-11-11)
| # | Decision | Where recorded |
|---|---|---|
| 1 | ADR-009: remote isolated browser stays the future approach; authenticated scanning not in MVP; no pixel streaming or local helper now; extensible; passkey limits documented | ADR-009, AUTH Part B |
| 2 | Domain verification: DNS TXT primary, well-known alternative; attestation removed; method/status/timestamps persisted; revalidation | ADR-017, DATABASE, THREAT T-API-09 |
| 3 | robots.txt: respect Disallow + crawl-delay by default; auditable owner override; verification never implies override (reverses earlier draft) | ADR-018, CRAWLER §5, THREAT T-API-10 |
| 4 | npm workspaces, no pnpm | ADR-001 |
| 5 | Billing deferred; TOTP MFA not MVP blocker; secure auth baseline kept | ADR-019, AUTH Part A |
| 6 | Roadmap reordered; deferred list | IMPLEMENTATION_ROADMAP |
| 7 | Early vertical slice (plan) | IMPLEMENTATION_ROADMAP, TESTING §11 |
| 8 | SaaS proportionality review | ADR-020, SYSTEM_ARCHITECTURE §10 |
| 9 | Repo housekeeping: branch `main`, clean initial commit | git |

## Open items / caveats
- Dependency versions in package files are `^` ranges and **unverified** (registry lookup was denied); verify at first authorized install and generate the lockfile then.
- Original reference document (master spec) is not present as a file in the repo; it exists only in the conversation. **Needs PM to supply the file to preserve under `docs/reference/`.** Docs cite it by Part number.
- `infra/env.template` reviewed: placeholders only (`change_me`, empty keys); no real secrets.
- Design docs are drafts pending PM review.
- Domain-verification revalidation interval (30 days) and the DNS resolver used for verification are proposals.
- Internal/staging hosts cannot be verified without DNS/well-known access; accepted MVP limitation.

## Tech debt
None in code. Doc-level: UUIDv7 undecided; partitioning deferred to measured volume.

## Security risks (residual, from threat model)
Chromium sandbox escape; proxy cannot inspect TLS; screenshot PII redaction best-effort; LLM provider sees redacted content (opt-in); robots override is an owner-accountable control, not a technical barrier.

## Deferred features (kept, not deleted)
Authenticated crawling; guided authentication; session recording/replay; advanced state discovery; custom rule builder; scheduled scanning; GitHub/Jira integrations; public API and CLI; billing/subscriptions; enterprise administration; TOTP MFA; customer SSO/OIDC; Firefox/WebKit; PDF accessibility; native mobile.
