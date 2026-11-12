# Deployment, Backup and Recovery

Status: written, not exercised. The Dockerfile and `infra/docker/docker-compose.prod.yml` have not been built or run in this repository's verification. Treat this as a first draft to rehearse in a staging environment.

## Components

| Component              | Image target    | Needs                                                                                   |
| ---------------------- | --------------- | --------------------------------------------------------------------------------------- |
| API                    | `api`           | PostgreSQL (role `aa_api`), Redis, SMTP-capable mailer (today only a log mailer exists) |
| Worker                 | `worker`        | PostgreSQL (role `aa_worker`), Redis, Chromium, outbound internet                       |
| Web                    | `web`           | Static hosting; `VITE_API_URL` is baked in at build time                                |
| PostgreSQL 16, Redis 7 | upstream images | Persistent volumes                                                                      |

## First deployment

1. Create an environment file from `infra/env.template`. Generate `SESSION_COOKIE_SECRET` with `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. Keep `ALLOW_PRIVATE_TARGETS=false`.
2. Start `postgres` only. Run `npm run db:migrate` with `MIGRATION_DATABASE_URL` as the owner role. The migrations create the roles `aa_api`, `aa_worker`, `aa_migrator`, `aa_retention` as NOLOGIN.
3. As the database owner, give `aa_api` and `aa_worker` LOGIN and strong, distinct passwords. Use those in `DATABASE_URL` and `WORKER_DATABASE_URL`.
4. Seed the rule registry: `node apps/worker/dist/seed-rules.js` inside the worker image (the `tsx` dev tool is pruned from production images).
5. Start the full stack with the prod compose file. Terminate TLS at a reverse proxy in front of `api` and `web`, and set `WEB_ORIGIN` and `API_PUBLIC_URL` to the public https origins (cookies assume web and API share a site).
6. Check `GET /healthz` (liveness) and `GET /readyz` (database and Redis reachable; 503 if either fails).

## Upgrades

Take a database backup, run migrations as the owner role, then roll the API and worker. Migrations are forward-only; there are no down scripts. Run only one API replica with `SCHEDULER=on` unless you accept duplicate-safe but redundant ticks (claims prevent double scans and double emails).

## Backup

- PostgreSQL: nightly `pg_dump -Fc` from the owner connection, copied off the host, plus WAL archiving if a recovery point under 24 hours is needed. Retention is a business decision; screenshots and evidence live in the database today, so size grows with scans.
- Redis holds queue state only. Losing it loses queued jobs, not results. The API scheduler marks scans left `running` longer than `STUCK_SCAN_MINUTES` (default 60) as failed with reason `worker_lost`; start a new scan to retry.
- Login profiles (authenticated scanning, ADR-031): set the same `CREDENTIAL_ENCRYPTION_KEY` (32 random bytes, base64) on the api and the worker, plus `CREDENTIAL_KEY_ID`. Credentials are stored AES-256-GCM encrypted and are write-only. Losing the key makes stored profiles unusable; they must be re-entered. Rotating means adding a new key id and re-creating profiles.
- Secrets: store `SESSION_COOKIE_SECRET`, `CREDENTIAL_ENCRYPTION_KEY` and database passwords in the secret manager of your platform. Rotating the cookie secret signs all users out.

## Recovery

1. Restore the latest dump into a fresh PostgreSQL 16: `pg_restore -d accessaudit --clean --if-exists dump.pgdump`.
2. Re-run `npm run db:migrate` (idempotent) and re-set role passwords.
3. Start Redis empty, then API and worker. Scans stuck in `running` are failed automatically by the sweep after `STUCK_SCAN_MINUTES`; `queued` scans lost with Redis must be re-queued by hand (`select id from scans where status = 'queued'`).
4. Restore drill: not yet performed. Do one before relying on this section.

## Monitoring and logging (current state)

- API logs are structured JSON through pino with a request id header. Sensitive headers are redacted in the logger configuration.
- Health endpoints exist. `GET /metrics` (Prometheus text: uptime, memory, scan counts by status) is enabled by setting `METRICS_TOKEN` (16+ characters) and needs `Authorization: Bearer <token>`; keep it off the public proxy. Unhandled server errors are POSTed as JSON to `ERROR_WEBHOOK_URL` when set (no Sentry-style grouping). Mail goes through `MAIL_API_URL`, `MAIL_API_KEY` and `MAIL_FROM` (JSON POST with a bearer key; without them mail is only logged). There are no alert rules. Until those exist, alert on container restarts, `/readyz` failures and Redis or Postgres disk use.
