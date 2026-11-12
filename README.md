# AccessAudit

Accessibility intelligence platform. MVP goal: safe scanning of verified public sites with axe-core, validated findings with evidence, remediation guidance, and scan comparison. Authenticated crawling, journeys, custom rules, scheduling, integrations, public API/CLI and billing are deferred (see the roadmap).

**Status: Phase 2 (merged phases 2 to 4: scanning engine, findings and review UI, anonymous quick check) built and awaiting Product Manager review.** See [PROJECT_STATUS](docs/PROJECT_STATUS.md) for what is and is not verified.

## What works in Phase 2

- Scans of verified domains: safe crawler (SSRF gate, egress proxy, isolated Chrome), axe-core plus read-only interaction checks, WCAG 2.2 mapping, rule registry.
- Findings are classified as confirmed violation, potential violation or manual verification, each with evidence. There is no single accessibility score.
- Scan report, finding detail with evidence, and a manual verification checklist in the web app.
- Anonymous quick check at `/quick-check`: one public page, proof-of-work, rate limited, result shown once and not stored.
- The worker (`apps/worker`) needs `WORKER_DATABASE_URL` (the `aa_worker` role) and Redis (`REDIS_URL`); the API needs Redis too. Run it with `npx tsx apps/worker/src/main.ts`. Browser: set `BROWSER_CHANNEL=chrome` to use installed Chrome.
- Extra test variables: `TEST_WORKER_DATABASE_URL` (worker DB tests) and `TEST_REDIS_URL` (quick-check Redis test). Playwright end to end: `npx playwright test` with the stack running.

## What works in Phase 1

- Registration, login, logout, password recovery (tokens are logged by a development mailer, not emailed).
- Organizations, memberships, roles (owner, admin, member, viewer), invitations.
- Projects, and domain registration with DNS TXT or well-known file verification and periodic revalidation.
- Tenant isolation enforced in the API and in PostgreSQL (row-level security).
- Vite + React web app: sign in/up, organizations, projects, domains, members, settings, responsive navigation, loading/error/empty states.

## Layout

```
apps/      api (Fastify), web (Vite + React), worker (BullMQ, scans and quick checks)
packages/  shared (config, schemas, errors), security (hashing, tokens, URL policy), db (Drizzle schema, migrations)
infra/     docker compose (Postgres 16, Redis 7, MinIO) and env.template
docs/      design docs, traceability matrix, status register
```

## Prerequisites

Node 22 (see `.nvmrc`), npm, Docker.

## Setup

1. Install dependencies: `npm install` (run `npm rebuild argon2` if the native module did not build; installs here used `--ignore-scripts`).
2. Choose local passwords and export them in your shell. `infra/env.template` lists every variable; copy it to an untracked file if you prefer a file, but never commit real values.
   ```powershell
   $env:POSTGRES_PASSWORD = '<choose>'
   $env:POSTGRES_HOST_PORT = '5433'          # optional, default 5432
   $env:S3_ACCESS_KEY_ID = '<choose>'
   $env:S3_SECRET_ACCESS_KEY = '<choose>'
   docker compose -f infra/docker/docker-compose.yml up -d postgres
   ```
3. Create the database login role passwords (the migration creates `aa_api` and `aa_worker` as NOLOGIN; passwords are never stored in migrations):
   ```sql
   ALTER ROLE aa_api LOGIN PASSWORD '<choose>';
   ```
4. Build and migrate (migrations run as the database owner, not as `aa_api`):
   ```powershell
   npm run typecheck
   $env:MIGRATION_DATABASE_URL = 'postgresql://accessaudit:<postgres password>@localhost:5433/accessaudit'
   npm run db:migrate
   $env:DATABASE_URL = 'postgresql://aa_api:<aa_api password>@localhost:5433/accessaudit'
   npm run db:seed        # verifies bootstrap prerequisites; creates no data
   ```
   The seed script intentionally inserts no users, organizations or projects. This product does not fabricate data.
5. Run the API and web app in two terminals:
   ```powershell
   $env:SESSION_COOKIE_SECRET = '<at least 32 random characters>'
   $env:WEB_ORIGIN = 'http://localhost:3000'
   npm run dev:api        # http://localhost:4000, /healthz, /readyz
   npm run dev:web        # http://localhost:3000
   ```

## Configuration

| Variable                 | Used by    | Notes                                                           |
| ------------------------ | ---------- | --------------------------------------------------------------- |
| DATABASE_URL             | api        | Required. Connect as `aa_api` (subject to RLS).                 |
| MIGRATION_DATABASE_URL   | db migrate | Owner role; never used by the running API.                      |
| SESSION_COOKIE_SECRET    | api        | Required, at least 32 characters.                               |
| WEB_ORIGIN               | api        | Allowed CORS and Origin value. Default `http://localhost:3000`. |
| API_PORT, API_PUBLIC_URL | api        | Default 4000.                                                   |
| DOMAIN_REVALIDATE_DAYS   | api        | Default 30.                                                     |
| DNS_RESOLVER             | api        | Optional resolver override for TXT verification.                |
| VITE_API_URL             | web        | Default `http://localhost:4000`.                                |
| TEST_DATABASE_URL        | tests      | `aa_api` connection to a dev database.                          |

## Quality gates

```powershell
npx tsc -b --force
npx eslint apps packages --max-warnings=0
$env:TEST_DATABASE_URL = 'postgresql://aa_api:<password>@localhost:5433/accessaudit'
npx vitest run
npm run build -w @accessaudit/web
```

Integration tests need the migrated dev database. Always use `tsc -b --force` before lint, because packages resolve each other through `dist`.

## Security notes

- Sessions: hashed tokens in the database, HttpOnly cookie, SameSite=Lax; mutations require an allowed `Origin` and the `x-csrf-token` header.
- Domain verification never authorizes private or internal targets. Verification is not permission to ignore crawler restrictions.
- Rate limits are in memory and per process. Not suitable for multi-instance deployment.

## Docs

| Doc                                                                | Purpose                           |
| ------------------------------------------------------------------ | --------------------------------- |
| [PRODUCT_REQUIREMENTS](docs/PRODUCT_REQUIREMENTS.md)               | Scope, REQ IDs, NFRs              |
| [SYSTEM_ARCHITECTURE](docs/SYSTEM_ARCHITECTURE.md)                 | Containers, modules, pipeline     |
| [ARCHITECTURAL_DECISIONS](docs/ARCHITECTURAL_DECISIONS.md)         | ADR-001..020                      |
| [DATABASE_DESIGN](docs/DATABASE_DESIGN.md)                         | Schema, RLS, fingerprints         |
| [API_SPECIFICATION](docs/API_SPECIFICATION.md)                     | REST surface                      |
| [CRAWLER_ARCHITECTURE](docs/CRAWLER_ARCHITECTURE.md)               | Discovery, states, coverage       |
| [AUTHENTICATION_ARCHITECTURE](docs/AUTHENTICATION_ARCHITECTURE.md) | Platform and target-site auth     |
| [ACCESSIBILITY_ENGINE](docs/ACCESSIBILITY_ENGINE.md)               | Rules, validation, classification |
| [SECURITY_THREAT_MODEL](docs/SECURITY_THREAT_MODEL.md)             | Threats and gates                 |
| [TESTING_STRATEGY](docs/TESTING_STRATEGY.md)                       | Test plan                         |
| [IMPLEMENTATION_ROADMAP](docs/IMPLEMENTATION_ROADMAP.md)           | Phases 0 to 9 and deferred list   |
| [TRACEABILITY_MATRIX](docs/TRACEABILITY_MATRIX.md)                 | Requirement, test, result         |
| [PROJECT_STATUS](docs/PROJECT_STATUS.md)                           | Decision log, caveats, risks      |
