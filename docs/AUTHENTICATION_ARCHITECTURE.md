# Authentication Architecture

Status: Draft v0.1 · Date: 2026-11-11
Two distinct topics: **(A)** how AccessAudit users authenticate to AccessAudit; **(B)** how AccessAudit authenticates to _customer sites_ in order to scan them. B is the hard one and is designed first-class (REQ-AUTH-*).

---

## A. Platform user authentication (ADR-006)

- Registration/login: email + password, argon2id (memory-hard parameters tuned at deploy; stored with parameter string for rehash-on-login).
- Session: 256-bit random ID; only SHA-256 hash stored in `user_sessions`; cookie `HttpOnly; Secure; SameSite=Lax; Path=/`; idle timeout + absolute timeout; rotation on login and privilege change; revoke-all on password change.
- CSRF: double-submit token bound to session for browser requests; `Origin`/`Host` verification; API-key requests exempt (no cookie).
- Rate limits: per IP and per account on login/forgot/reset; uniform responses; delay on repeated failure.
- Email verification and password reset: single-use, 30-minute hashed tokens.
- Org context: membership resolved per request; role from `organization_members`.
- API keys: `aa_live_<prefix>_<secret>`; hash stored; scopes; org-bound; shown once.
- TOTP MFA and SSO/OIDC are **deferred** (ADR-019); not an MVP blocker. Extensibility: a separate `user_factors` table and a post-password challenge step can be added without changing `users` or `user_sessions`; session rotation already happens on privilege change, so adding a step-up flag is additive.
- MVP still requires: argon2id, revocable sessions, API-key hashing, rate limiting/lockout, single-use account recovery, CSRF.

---

## B. Target-site authentication — **FUTURE-PHASE DESIGN, NOT IN MVP** (ADR-009, ADR-019)

Nothing in Part B is implemented or migrated in the MVP. The remote isolated browser remains the planned approach; pixel streaming and the local capture helper are not built now.

**Passkey / hardware-key limitations (future consideration):** a remote streamed browser cannot use the user's hardware security keys or platform passkeys (WebAuthn bound to the user's device); device-bound credentials, token-binding, device-posture/managed-device checks and some SSO flows will fail or be unavailable; Playwright storage state does not capture every mechanism. Mitigations to evaluate later: local capture helper (Option B), customer-provided test accounts without passkey enrollment, or documenting the site as `requires_manual`. These must be stated plainly in product copy when the feature ships.

### B.1 Concepts

| Concept                    | Meaning                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Authentication profile** | A named identity/role on a project, e.g. "Anonymous", "Standard user", "Administrator". Strategy + non-secret config + status.                               |
| **Credential**             | Encrypted secret bound to a profile (username/password/TOTP seed/api token).                                                                                 |
| **Browser session**        | Encrypted Playwright storage state (cookies, localStorage, sessionStorage via init-script capture) bound to `(org, profile, domain)` with expiry and health. |
| **Auth state**             | `unconfigured → active → needs_reauth → active …`, or `locked`, `disabled`.                                                                                  |

The anonymous visitor is a built-in profile with no session; this keeps the pipeline uniform.

### B.2 Strategies

1. **Anonymous** — no auth.
2. **Credentials (automated)** — stored username/password driven through the login form.
3. **Guided manual session** — user logs in themselves (handles MFA/SSO/CAPTCHA); we capture state.
4. **Saved session** — reuse a previously captured session until expiry/health failure.
5. **Recorded journey as login** — journey steps (approved, non-sensitive recording) that reach an authenticated state; secrets are still referenced from `encrypted_credentials`, never recorded.

### B.3 Credential login flow

```
Profile.login_config:   loginUrl, usernameLocator, passwordLocator, submitLocator,
                        successIndicators[], failureIndicators[], mfaIndicators[], captchaIndicators[]
```

Locator priority: role+name → label → placeholder → test-id → user-provided CSS/XPath (stored as descriptor, validated, length-limited, never evaluated as script).

Steps: (1) acquire fresh context via proxy; (2) navigate to `loginUrl`; (3) detect pre-login blockers (CAPTCHA); (4) fill and submit **once**; (5) **verify** — a click is not success. Success requires at least one positive indicator (e.g. logout control, user menu, URL pattern, authenticated-only element) and absence of failure/MFA/CAPTCHA indicators; (6) save storage state, encrypted; (7) run a **protected-page probe** (a configured URL expected to require auth) to confirm authorization works; (8) record outcome.

Failure classification (stored on profile + scan): `invalid_credentials`, `session_expired`, `mfa_required`, `captcha_required`, `account_locked`, `unexpected_redirect`, `network_error`, `access_denied`, `state_mismatch`, `login_form_not_found`, `timeout`.

Behavior per class:

- `mfa_required`, `captcha_required`, `session_expired`, `unexpected_redirect`(to IdP) → profile `needs_reauth`; offer guided session; protected scanning for that profile pauses (`WAITING_FOR_AUTH`).
- `invalid_credentials`, `account_locked` → profile `locked`; **no retry**; notify; require user to fix credentials.
- Public/other-profile results are always preserved; scan ends `PARTIALLY_COMPLETED` if the profile never recovers.

### B.4 Guided manual session (ADR-009 default: remote isolated browser)

```
User clicks "Capture session" ─▶ API creates capture {id, orgId, profileId, userId, expiresAt}
   │                                   ─▶ worker `session-capture` launches isolated Chromium
   │                                       (proxy-bound, domain-restricted, tmpfs)
   ▼
Web UI opens WS (single-use token) ◀── frames (CDP screencast) ── remote browser
User types / clicks (input events) ──▶ remote browser     (user completes login + MFA)
User presses "I'm logged in" ─▶ server verifies success indicators / probe URL
                                 ─▶ extract storage state ─▶ filter to allowed domains
                                 ─▶ encrypt ─▶ store ─▶ destroy browser + profile dir
```

Properties:

- Session material never leaves the server (REQ-AUTH-08); UI only receives pixels.
- Browser chrome (URL bar, lock state) is drawn by our UI from server-reported data, not trusted page content.
- Hard TTL (default 10 min), idle timeout (2 min), one active capture per profile, cancel button.
- Keyboard accessibility of the viewer: viewer is a focusable region forwarding keystrokes, with an escape sequence documented; text-entry fallback mode is a known challenge to prototype in Phase 3 (the product must itself be accessible).
- Limitations (documented to users): WebAuthn/passkeys/hardware keys and device-bound sessions will not work in the remote browser; Option B (local helper) is the planned extension.

### B.5 Navigation journeys (recorder)

- Recording happens inside the same remote-browser transport as guided login.
- Recorder emits semantic steps (action + role/name locator + expectation), not coordinates.
- **Sensitive-value guard:** inputs of type password, fields matching `autocomplete` tokens for credentials/cc, and anything flagged by the user are _not recorded_; steps store `value_ref` pointing to an approved test input or encrypted credential.
- Review UI: user edits/removes steps, sets expectations, then saves a versioned journey. Replay is available as a dry run with per-step results and screenshots.
- Journey execution uses the profile's session; step failure marks journey coverage failed and the pipeline continues.

### B.6 Session lifecycle and health

| Phase                  | Behavior                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Capture                | Domain binding; cookie filter; `expires_at` = min(cookie max-age expiry, org-configured TTL)                                      |
| Pre-scan check         | Load probe URL; success indicator present → `healthy`; else `expired`                                                             |
| Mid-scan monitoring    | Each page job checks for login redirects/indicator loss; two consecutive hits flips profile to `needs_reauth` and pauses its jobs |
| Scheduled health check | `session-health` queue periodically verifies sessions (low frequency, probe only) and notifies before expiry                      |
| Re-auth                | User refreshes via guided session; `POST /resume` re-enqueues waiting items                                                       |
| Cleanup                | Hard-delete session blobs on revoke, profile delete, project delete, expiry+grace, org delete                                     |

### B.7 Storage and crypto

Envelope encryption per ADR-010. Stored: `ciphertext`, `nonce`, `key_id`, `aad_hash`. AAD = `orgId|profileId|domain`. Decryption only inside a job whose tenant context matches. Master key never in DB; rotation re-wraps data keys without re-prompting users.

### B.8 Multi-role isolation and comparison

- Each profile has its own BrowserContext; nothing shared across profiles or orgs.
- Findings carry `profile_id` and the fingerprint includes a profile scope key, so role-specific issues are distinct and comparable.
- Cross-role comparison view: same URL/state audited under multiple profiles; reports "visible to role X only", "access denied for role Y" (recorded as `forbidden_for_role`, informational — not an accessibility defect).

### B.9 Hard limits (explicit non-goals)

No CAPTCHA solving, no OTP interception, no SSO bypass, no credential guessing, no automatic retries after auth failure, no scanning of domains without verified authorization. MFA codes may be supplied via TOTP seed only if the customer opts in and the target permits automation; otherwise guided session is required.

### B.10 Audit events

`auth_profile.created|updated|deleted`, `credentials.set|rotated|deleted`, `session.captured|revoked|expired|health_failed`, `guided_session.started|confirmed|cancelled|timed_out`, `login.failed(class)`, `scan.waiting_for_auth|resumed`. Metadata is redacted; no secrets.
