# AccessAudit

Accessibility intelligence platform. MVP: safe scanning of verified public sites with axe-core, validated findings with evidence, remediation guidance, and scan comparison/regression tracking. Authenticated crawling, journeys, custom rules, scheduling, integrations, public API/CLI and billing are deferred (see roadmap).

**Status: Phase 0 (foundation), PM decisions of 2026-11-11 incorporated; awaiting PM approval to start Phase 1. No application code, no installed dependencies, no executed tests.** Start with `docs/`.

## Docs
| Doc | Purpose |
|---|---|
| [PRODUCT_REQUIREMENTS](docs/PRODUCT_REQUIREMENTS.md) | Scope, REQ IDs, NFRs |
| [SYSTEM_ARCHITECTURE](docs/SYSTEM_ARCHITECTURE.md) | Containers, modules, pipeline |
| [ARCHITECTURAL_DECISIONS](docs/ARCHITECTURAL_DECISIONS.md) | ADR-001..020 |
| [DATABASE_DESIGN](docs/DATABASE_DESIGN.md) | Schema, RLS, fingerprints |
| [API_SPECIFICATION](docs/API_SPECIFICATION.md) | REST surface |
| [CRAWLER_ARCHITECTURE](docs/CRAWLER_ARCHITECTURE.md) | Discovery, states, coverage |
| [AUTHENTICATION_ARCHITECTURE](docs/AUTHENTICATION_ARCHITECTURE.md) | Platform + target-site auth |
| [ACCESSIBILITY_ENGINE](docs/ACCESSIBILITY_ENGINE.md) | Rules, validation, classification |
| [SECURITY_THREAT_MODEL](docs/SECURITY_THREAT_MODEL.md) | Threats and gates |
| [TESTING_STRATEGY](docs/TESTING_STRATEGY.md) | Test plan |
| [IMPLEMENTATION_ROADMAP](docs/IMPLEMENTATION_ROADMAP.md) | Phases 0–9 + deferred list |
| [TRACEABILITY_MATRIX](docs/TRACEABILITY_MATRIX.md) | REQ → test → result |
| [PROJECT_STATUS](docs/PROJECT_STATUS.md) | Decision log, caveats, risks |

## Layout
```
apps/      api (Fastify), worker (BullMQ + Playwright), web (Next.js, later)
packages/  shared, security, db, crawler, a11y-engine, ai
infra/     docker compose (Postgres 16, Redis 7, MinIO), env.template
fixtures/  test sites (later)
docs/
```

## Local setup (when code lands)
Node 22 (`.nvmrc`), npm workspaces. Copy `infra/env.template` to a local env file (git-ignored; the usual example filename was blocked by a tooling hook, hence the `.template` name). Never commit secrets. Dependency versions are unverified `^` ranges until first install.
