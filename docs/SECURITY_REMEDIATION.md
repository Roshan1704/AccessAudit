# Phase 1 Security Remediation Record

Date: 2026-11-11. Working tree on 3cfd471 (uncommitted).

## Dependency vulnerabilities (`npm audit`: 11 moderate, 0 high, 0 critical)

An earlier report listed 20 findings including high and critical. The current tree reports 11 moderate. The earlier count came from the dependency tree before the drizzle-kit and tooling updates. All 11 findings are in development tooling and none ships in a runtime image.

| Package                                                                                               | Installed    | Dependency path                                                                   | Severity                                                                          | Vulnerable functionality used?                                         | Fix                                                                                                        | Breaking change                                |
| ----------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| esbuild                                                                                               | 0.18.20      | drizzle-kit 0.31.11, @esbuild-kit/esm-loader 2.6.5, @esbuild-kit/core-utils 3.3.2 | moderate (GHSA-67mh-4wv8-2f99)                                                    | No. Applies to the esbuild development server, which is never started. | Upstream drizzle-kit must drop @esbuild-kit. npm suggests drizzle-kit 0.18.1, a major downgrade: rejected. | The downgrade would break the schema generator |
| @esbuild-kit/core-utils, @esbuild-kit/esm-loader                                                      | 3.3.2, 2.6.5 | drizzle-kit                                                                       | moderate (via esbuild)                                                            | No                                                                     | Same as above                                                                                              | Same                                           |
| drizzle-kit                                                                                           | 0.31.11      | direct devDependency of @accessaudit/db                                           | moderate (via @esbuild-kit)                                                       | Used only to generate migrations offline                               | Wait for an upstream release; no same-major fix is available                                               | Downgrade rejected                             |
| minimatch                                                                                             | 10.2.6       | typescript-eslint, @typescript-eslint/typescript-estree                           | moderate (GHSA-g3hv-75wg-m249, denial of service through glob part amplification) | Lint tooling only, on repository-controlled patterns                   | npm reports a non-breaking fix through a typescript-eslint update                                          | None expected                                  |
| @typescript-eslint/typescript-estree, utils, type-utils, parser, eslint-plugin, and typescript-eslint | 8.72.2       | direct (typescript-eslint)                                                        | moderate (via minimatch)                                                          | Same as minimatch                                                      | Normal (non-forced) update of typescript-eslint                                                            | None expected                                  |

Remediation plan: update typescript-eslint with a normal update and `--ignore-scripts`, then re-run lint and tests. Keep the drizzle-kit chain as an accepted development-only risk and re-check it on each drizzle-kit release. `npm audit fix --force` is never used.

## Install-script packages (not executed during the lockfile refresh)

| Package                           | Version | Script                        | Inspection                                                                                                                    | Verdict                                                                                    |
| --------------------------------- | ------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| esbuild (root, via tsx and vite)  | 0.28.2  | postinstall `node install.js` | Verifies that the platform binary package is present and may swap in the platform binary                                      | Needed by tsx and vitest. Run only after review, or rely on the optional platform package. |
| esbuild (drizzle-kit)             | 0.25.12 | postinstall `node install.js` | Same                                                                                                                          | Same                                                                                       |
| esbuild (@esbuild-kit/core-utils) | 0.18.20 | postinstall `node install.js` | Same                                                                                                                          | Same                                                                                       |
| argon2                            | 0.45.2  | install `node-gyp-build`      | Loads the bundled prebuild (win32-x64, linux-x64, darwin-arm64 and others ship in the package); compiles only if none matches | Required for password hashing. Run explicitly earlier (ADR-021).                           |
| fsevents                          | 2.3.3   | optional, macOS only          | Not installed on Windows or Linux                                                                                             | None                                                                                       |

## Secrets in logs

`LogMailer` no longer logs message bodies, so password-reset and invitation tokens are never written to logs in any environment. The `infra.test.ts` test asserts this. A real mail adapter must deliver reset and invitation links before production; tests read them from the injected mailer. The pino redaction list covers authorization, cookie, x-csrf-token, set-cookie, password and token fields.

## Session, CSRF, Origin and rate limiting review

- Session cookie `aa_session`: HttpOnly, SameSite=Lax, 24 hour idle and 7 day absolute expiry, stored hashed, new session per login.
- CSRF: every mutation requires an Origin equal to WEB_ORIGIN. Authenticated mutations also require `x-csrf-token`, compared by hash. CORS allows only WEB_ORIGIN with credentials.
- Rate limiting: 10 requests per minute per IP on authentication routes, plus per-account lockout stored in the database.

### Single-instance limitation of the rate limiter

The IP rate limiter uses the in-process memory store of @fastify/rate-limit. With more than one API instance, each keeps its own counters, so the effective limit is multiplied by the instance count, and counters reset on restart. The per-account lockout lives in PostgreSQL and is not affected.

Production mitigation: configure the plugin with a shared Redis store (Redis is already in the stack, `REDIS_URL`), set `trustProxy` to the real proxy hops so client IPs are correct, and add gateway or load-balancer limits as a second layer. Until then, run a single API instance.

## Database integrity

See ADR-024. Migrations 0002 and 0003 were generated through drizzle-kit and applied through the migration runner. No manual schema changes were made.
