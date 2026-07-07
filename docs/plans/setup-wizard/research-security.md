# Setup Wizard — Security Research

Scope: `/setup/` guided first-run flow (connect Arr instance, link PCD database via optional
git clone + `PRAXRR_DEFAULT_DB_TOKEN`-style token, select profiles, preview & sync), running
before the app has any local user/admin account. Findings are grounded in the current codebase
(`hooks.server.ts`, `$auth/middleware.ts`, `arr/test/+server.ts`, `$http/client.ts`,
`pcd/core/manager.ts`, `$utils/git/write.ts`, `$server/utils/encryption/*`) as of this session —
not a generic checklist. This is advocacy, not gatekeeping: every finding below ships with a
mitigation that fits the existing architecture rather than a blanket "don't do this."

## Executive Summary

The wizard concept is sound and the codebase already has the right primitives to build it
safely: solid AES-GCM credential encryption with key versioning
(`$server/utils/encryption/arr-credentials.ts`, `keys.ts`), a working first-run gate
(`needsSetup` in `$auth/middleware.ts`), a hardened git-exec wrapper (`GIT_TERMINAL_PROMPT=0`,
disabled credential helper), and an existing in-memory rate-limit pattern
(`checkWriteRateLimit()` in `routes/api/v1/section-preferences/_helpers.ts`) that the wizard
should simply reuse.

However, four CRITICAL issues need to be resolved *before* wiring the wizard's API surface, two
of which are pre-existing vulnerabilities in code the wizard is expected to reuse or extend:

1. The current auth middleware's `needsSetup` redirect is a blanket catch-all that will either
   break the wizard's own API calls or, if naively bypassed, leave new `/api/v1/setup/*`
   endpoints permanently unauthenticated.
2. First-run setup has no anti-hijack binding (no setup token, CSRF checks disabled app-wide,
   default bind is `0.0.0.0`) — a race-to-setup attack is realistic on networks where the fresh
   instance is reachable before the real admin finishes onboarding.
3. The existing Arr "test connection" endpoint (`routes/arr/test/+server.ts` →
   `BaseHttpClient.request()`) performs a raw `fetch()` on a user-supplied URL with **no**
   host/scheme validation — a live SSRF primitive that becomes pre-auth-reachable once the
   wizard needs it.
4. PCD "local path" linking (`resolveLocalRepositoryPath()` in `$utils/git/write.ts`) accepts
   any absolute/relative filesystem path with **no** root-confinement check and recursively
   copies it into the app's data directory — an arbitrary local file/directory read primitive,
   also pre-auth-reachable if the wizard exposes local-path linking.

None of these require an architecture rewrite — each has a scoped, additive fix described below.

## Findings by Severity

### CRITICAL (hard stop — must be resolved before shipping the wizard)

| ID | Finding | Mitigation |
|----|---------|------------|
| C1 | `hooks.server.ts:213-219` redirects (303) **any** path other than the literal string `/auth/setup` whenever `needsSetup` is true. New `/api/v1/setup/*` endpoints the wizard needs to call (connection test, PCD link, profile fetch) will either be unreachable, or — if simply added to `PUBLIC_PATHS` (`$auth/middleware.ts:27`) to work around it — become permanently unauthenticated endpoints once setup completes, because `PUBLIC_PATHS` is a static prefix list with no "setup in progress" condition. | Add every setup API handler behind its own server-side guard (e.g. `assertSetupInProgress()` that throws 403 once `usersQueries.existsLocal()` — or the AUTH-mode-appropriate equivalent, see C2/W6 — is true), mirroring the double-check already used in `routes/auth/setup/+page.server.ts` (`load` and the form `action` both call `usersQueries.existsLocal()`). Do **not** rely on `PUBLIC_PATHS` alone; treat it as routing convenience, not authorization. |
| C2 | First-run setup has no binding to a specific requester. `needsSetup` is purely "no local user exists yet" (`middleware.ts:40-123`); there's no setup nonce/token, and `svelte.config.js:16-18` sets `csrf: { trustedOrigins: ['*'] }`, which disables SvelteKit's built-in Origin-header CSRF check **app-wide**. Combined with the default bind `HOST=0.0.0.0` (`config.ts:53`), any party that can reach the fresh instance before the legitimate admin — a LAN neighbor, a malicious redirect, a cross-origin auto-submitting form — can complete the entire wizard: create the admin account, point Praxrr at an attacker-controlled Arr instance URL, or link a malicious PCD repo whose ops later get synced to the real Arr instances. Because `needsSetup` flips to false after the first user is created, the real admin is then locked out of the wizard (not out of the app, but the attacker's config is now live). | (a) Render a per-boot, single-use setup token into the `/auth/setup` page and require it on every wizard POST (WordPress/Ghost/Nextcloud-style pattern) so a blind cross-origin request can't complete setup. (b) Default-restrict `/auth/setup` and `/api/v1/setup/*` to private/loopback IPs while `needsSetup` is true, reusing the existing `isLocalAddress()` helper from `$auth/network.ts` (same helper `AUTH=local` already uses) — make it opt-out via env var for legitimate remote-first-run cases. (c) Narrow `csrf.trustedOrigins` away from `'*'` (see W3). |
| C3 | `routes/arr/test/+server.ts:41-42` builds an Arr client from a fully user-supplied `url` and calls `client.testConnection()`, which hits `BaseHttpClient.request()` (`$http/client.ts:38-57`) → plain `fetch(url, ...)`. There is **no** hostname/IP/scheme validation anywhere in `$arr/` or `$http/` (confirmed by reading `base.ts` and `client.ts` in full — no `validation.ts` module exists). This is the endpoint the wizard's "connect Arr instance" step needs, and per C1 it must become reachable pre-auth. Result: an anonymous caller on a fresh install can make the server probe `127.0.0.1`, `169.254.169.254` (AWS/GCP/Azure IMDS), and RFC1918 ranges, and get a differentiated signal back — the boolean `success`, plus the raw `error.message` on failure (connect-refused vs. timeout vs. HTTP status all read differently) — enabling internal port scanning and limited metadata reconnaissance. | Add a shared `assertSafeArrUrl(url)` check (new small module, e.g. `$arr/urlSafety.ts`) called before `createArrClient(...)` in both the existing `/arr/test` route and any new wizard connection-test endpoint: enforce `http`/`https` only, resolve the hostname, and block the cloud metadata IP (`169.254.169.254`, `fd00:ec2::254`) and `0.0.0.0`/link-local ranges unconditionally. **Do not** blanket-block RFC1918/loopback — self-hosted Arr apps legitimately live there, and `config.validateInstances`/`PRAXRR_VALIDATE_INSTANCES` already signals this is an opt-in concern; the fix should be a narrow deny-list (metadata + link-local), not a broad allow-list that breaks the primary use case. Also pin `redirect: 'manual'` (or re-validate on each hop) in `BaseHttpClient.request()` to stop redirect-based SSRF bypass. |
| C4 | `resolveLocalRepositoryPath()` (`$utils/git/write.ts:19-39`) accepts any string starting with `file://`, `/`, `./`, `../`, or a Windows drive letter as a "local PCD source" with **zero** root-confinement check, then `clone()` → `copyPathRecursive()` (`write.ts:55-72`) recursively reads and copies that path's contents into the app's managed data directory, after which `loadManifest`/`importBaseOps` parse it. This is an arbitrary local file/directory read primitive (e.g. `../../../../etc`, or any path the Deno process's user can read) gated only by "is it a directory." CLAUDE.md's own "Local-Path Source Guardrails" section acknowledges local-path sources are intentional but only discusses the Git-dependent-API 500 case, not path traversal — confirming this gap isn't an accepted trade-off, just unaddressed. Combined with C1/C2, a pre-auth wizard step that lets a caller supply a PCD source string turns this into a pre-auth arbitrary-directory-read/exfiltration bug (contents become readable via the app's own DB/CF/profile UI or its export flow once imported). | Do not expose local-path PCD linking as a wizard option at all — restrict the guided flow to `https://` git URLs only (this also sidesteps needing `PRAXRR_DEFAULT_DB_TOKEN`-style secrets in the pre-auth flow, see W5). Keep local-path linking available only from the already-authenticated Databases settings UI, and even there, confine `resolveLocalRepositoryPath()`'s result to a configured allow-root (e.g. must resolve under `config.paths.data` or an explicit `PRAXRR_LOCAL_PCD_ROOT`) before `Deno.stat`/`copyPathRecursive` ever touch it. |

### WARNING (must be addressed before/alongside launch)

| ID | Finding | Mitigation |
|----|---------|------------|
| W1 | `routes/arr/test/+server.ts` lives outside `/api/v1/*` (violates the repo's own API-namespace convention) and its catch-all (`+server.ts:49-56`) returns the raw `error.message` to the client on a 500 — potentially leaking internal error/stack detail. This is the pattern the wizard's own connection-test endpoint must not repeat. | Build the wizard's test-connection endpoint under `/api/v1/setup/arr/test`, reusing `createArrClient`, but return a small enum of sanitized reasons (`unreachable`, `unauthorized`, `invalid_response`, `timeout`) to the client while logging the full `error` server-side — mirroring the discipline the codebase already applies to API keys via `maskApiKey()`/`arrCredentialRedactionRoutes.test.ts`. |
| W2 | No rate limiting exists on connection-test-style endpoints. The codebase already has a working precedent: `checkWriteRateLimit()` (in-memory per-process token bucket, `routes/api/v1/section-preferences/_helpers.ts:58-83`), keyed by `userId`. Without it, the wizard's test-connection and PCD-link endpoints can be used as a port-scanning oracle against internal hosts (see C3) or a git-clone DoS vector (repeated clones of attacker-controlled/oversized repos). | Reuse the same rate-limit helper (or extract it to a shared `$utils/rateLimit.ts` — it's currently local to one route), keyed by client IP (via `getClientIp()` from `$auth/network.ts`) since there's no user id pre-auth. Cap both connection-test and PCD-link calls per IP per window. |
| W3 | `svelte.config.js:16-18`: `csrf.trustedOrigins: ['*']` disables SvelteKit's Origin-header check app-wide. Authenticated flows are partially cushioned by `sameSite: 'lax'` session cookies (`routes/auth/setup/+page.server.ts:87-93`), but the pre-auth setup flow has no cookie to protect at all, which is what makes C2 exploitable. | Narrow `trustedOrigins` to the instance's own configured origin(s) (derived from `config.serverUrl`/a new `PRAXRR_PUBLIC_ORIGIN` env var) rather than `'*'`. If `'*'` was chosen for reverse-proxy compatibility, document that reasoning and layer the setup-token mitigation from C2 on top rather than leaving the gap app-wide. |
| W4 | `clone()` (`$utils/git/write.ts:269-341`) embeds the PAT directly into the git URL (`https://${personalAccessToken}@github.com`) passed as a `git` CLI argument, then on non-zero exit throws `Error(\`Git clone failed: ${stderr}\`)` (`write.ts:338-339`). Git's own clone error output frequently echoes the remote URL. If that thrown error ever bubbles up to an API response (the same pattern as C3's `error.message` leak), the token could be disclosed to the client. Today `logger.warn`/`logger.info` calls around clone correctly log only `repositoryUrl`/`hasPersonalAccessToken` (boolean) — good practice already followed — but the thrown `Error` itself is not scrubbed. | Wrap the `code !== 0` branch to strip any `https://<token>@` prefix from `stderr` before constructing the `Error`, and ensure the wizard's PCD-link handler never forwards raw caught-error text to the client (same sanitized-reason-enum approach as W1). |
| W5 | Nothing rejects credentials embedded directly in `repositoryUrl` (e.g. `https://user:token@github.com/...`) instead of the separate `personalAccessToken` field. If a user pastes a token this way during the wizard, it would be stored in the `repositoryUrl` column in plaintext (displayed in UI, used as git remote) rather than through the existing `encryptDatabasePersonalAccessToken` path (`pcd/core/manager.ts:29-32,67-70`), and would also flow into the `logger.debug` call at `manager.ts:43-50` which logs `repositoryUrl` verbatim. | Validate at input time: reject any `repositoryUrl` whose authority component contains `@` before the host, with a clear wizard-side error directing the user to the dedicated token field. |
| W6 | `AUTH=off` makes `getAuthState()` return `needsSetup: false` unconditionally (`middleware.ts:44-51`) since it skips all auth by design (trusting an external reverse proxy). If the wizard's "needs setup" signal stays keyed to `usersQueries.existsLocal()`, the wizard will never trigger under `AUTH=off` even on a genuinely unconfigured instance (no Arr instance, no PCD DB linked) — or, if re-keyed naively to "no Arr instance and no PCD DB", it could re-trigger unexpectedly for legitimate `AUTH=off` users who intentionally run without any Arr instance yet. | Decide explicitly (open question, see below) whether the wizard's gating condition should be `usersQueries.existsLocal()` (current, auth-account-centric) or a new `setupStateQueries`-tracked "wizard completed" flag independent of auth mode — then gate consistently across `AUTH=on/local/off/oidc`, not just the two modes exercised by the existing single-page setup. |

### ADVISORY (best practice, not blocking)

| ID | Finding | Mitigation |
|----|---------|------------|
| A1 | No CORS headers are set anywhere (`config.ts`, `hooks.server.ts`) — the current same-origin-only default is correct and should be preserved for `/api/v1/setup/*` specifically, since a wildcard CORS response header would compound directly with the CSRF gap in W3. | Add an explicit test asserting no `Access-Control-Allow-Origin` header is emitted by the new setup endpoints, so a future "let our onboarding landing page call this" convenience change doesn't silently reopen the CSRF gap. |
| A2 | `loginAnalysis.ts` only classifies/logs failed login attempts (typo detection, common-attack-username heuristics) — there is no functional lockout/backoff on `/auth/login`, unlike the token-bucket precedent already used for section-preference writes. Not new to this feature, but the wizard's account-creation action is adjacent, pre-auth surface reachable during the same race window as C2. | Apply the same `checkWriteRateLimit`-style guard (keyed by IP) to both `/auth/login` and the wizard's account-creation action, independent of the C2 setup-token fix — defense in depth for the first-run race window. |
| A3 | No raw/string-interpolated SQL was found in the paths read (`setupState.ts`, `arrInstances.ts`, `databaseInstances.ts`) — `setupStateQueries` uses static parameterless SQL, and Kysely's query builder is used consistently elsewhere, which parameterizes by construction. No new SQLi surface identified. | Keep new setup-wizard queries on the Kysely query builder / existing `queries/*.ts` module pattern; do not introduce raw template-string SQL for wizard-specific tables. |
| A4 | Arr API key and PCD PAT encryption at rest is solid: AES-GCM with versioned keys and key rotation support (`ARR_CREDENTIAL_MASTER_KEY`/`_VERSION`/`_PREVIOUS_KEYS`), plus a separate HMAC fingerprint for lookup without decrypting (`arr-credentials.ts`, `keys.ts`). | Reuse `encryptArrInstanceApiKey()` / `encryptDatabasePersonalAccessToken()` for every secret the wizard collects — do not introduce a new, wizard-specific storage path for credentials. |

## Authentication and Authorization

- **Is `/setup/` (and `/api/v1/setup/*`) reachable pre-auth?** Yes, by design under `AUTH=on`/`AUTH=local`/`AUTH=oidc-adjacent` local-user paths — that's the whole point of `needsSetup`. The gap is that today only the SPA page itself (`/auth/setup`) is properly double-gated (`load` + `action` both check `usersQueries.existsLocal()`); any *new* API endpoints the wizard needs must replicate that same double-check per C1, not just live under a route that happens to match `PUBLIC_PATHS`.
- **Can an unauthenticated attacker add a malicious Arr instance or exfiltrate stored API keys?** Adding a malicious instance: yes, under the C2 race-condition scenario, until the setup-token/local-IP mitigation lands. Exfiltrating *already-stored* keys: no route found that returns decrypted keys to the client; `maskApiKey()`/redaction tests suggest this is already a first-class concern elsewhere in the codebase — the wizard should hold that same bar (never echo a key back after submission, only a masked confirmation).
- **Must the wizard only run when no users/instances exist, and lock once complete?** Yes — and it must be enforced server-side per request (C1), not just via the client router. Recommend a single source of truth: extend `setupStateQueries` (already the pattern used for "default database linked") with a `wizard_completed` flag set atomically once the flow finishes, rather than inferring completion from `usersQueries.existsLocal()` alone (which doesn't cover `AUTH=off`, see W6).

## Data Protection

- Arr API keys: encrypted at rest via AES-GCM, versioned keys, HMAC fingerprint for dedupe/lookup — reuse as-is (A4).
- PCD personal access tokens: same encryption utility family (`database-credentials.ts`, referenced from `pcd/core/manager.ts:29-32`) — reuse as-is.
- Token-in-URL risk: block credentials embedded in `repositoryUrl` (W5); scrub tokens from any error text surfaced to the client (W4).
- Logging discipline is already good where checked (`manager.ts` logs `repositoryUrl`/`hasPersonalAccessToken`, never the token) — hold new wizard logging to the same standard.

## Dependency Security

- Git operations shell out to the system `git` binary via `Deno.Command` with an **array** of args (not a shell string) — not vulnerable to shell injection, and already hardened against credential-prompt hangs and credential-helper leakage (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=echo`, `credential.helper` disabled, `GIT_SSH_COMMAND=... BatchMode=yes`). No new dependency is needed for the wizard's git-clone step; reuse `$utils/git/index.ts`'s existing `clone()`.
- No new third-party HTTP/SSRF-guard library is strictly required — C3's fix is a small, self-contained validation helper, not a new dependency, consistent with the repo's "check existing deps before adding new ones" convention.

## Input Validation

- Arr URL: currently validated for non-empty string + known type enum only (`arr/test/+server.ts:28-38`) — no scheme/host validation (C3).
- PCD repository URL: local-path detection is permissive by design but unbounded (C4); git URL validation exists on the GitHub-API side (`validateRepository()` in `write.ts`) but that's reachability/privacy detection, not a security boundary.
- No SQL injection surface identified in the queries reviewed (A3); continue using Kysely's builder for all new setup tables/queries.
- Recommend explicit allow-listing of `arr_type` values in any wizard endpoint the same way `arr/test/+server.ts:6` does (`VALID_TYPES`), and equivalent validation for whatever "profile selection" payload shape the preview/sync step introduces — reject unknown fields rather than passing objects through untyped.

## Infrastructure Security

- No CORS headers are set anywhere in the app (A1) — preserve this for the wizard's endpoints specifically.
- No rate limiting exists on connection-test-style endpoints today; a working in-process pattern already exists and should be extended (W2).
- `csrf.trustedOrigins: ['*']` is an app-wide setting that most acutely endangers the pre-auth setup flow (W3/C2) because there's no session cookie to fall back on.
- Default bind is `0.0.0.0` (`config.ts:53`) — combined with C2, this means a fresh container/VM exposed on a network (even a "trusted" LAN) is completing-setup-race-able the moment it starts, before the operator has clicked anything. This is the single highest-leverage mitigation: local-IP restriction (or a setup token) closes most of the real-world exposure window even if nothing else changes.

## Secure Coding Guidelines (for implementers of this feature)

1. Every new `/api/v1/setup/*` handler must call an explicit "is setup still open" guard as its first statement — never infer this from routing/`PUBLIC_PATHS` placement alone (C1).
2. Any handler that performs a server-side outbound request based on user input (`arr/test`, and its wizard equivalent) must pass through the shared `assertSafeArrUrl()` validator before constructing a client (C3).
3. Any handler that accepts a PCD "source" string must not accept local filesystem paths unless it's confined to an authenticated, non-wizard settings surface with root-confinement enforced (C4).
4. Never return `error.message`/raw `stderr` from git or HTTP failures directly to the client; map to a small sanitized reason enum and log full detail server-side (W1/W4).
5. Any new secret (API key, PAT) must go through the existing `$server/utils/encryption/*` helpers — no ad-hoc storage.
6. Any new pre-auth POST endpoint must be covered by the shared rate-limit helper, keyed by client IP (W2).

## Trade-off Recommendations

- **Setup token vs. local-IP restriction (C2):** prefer implementing both if feasible, but if forced to pick one, the local-IP restriction is lower engineering cost (reuses `isLocalAddress()`) and closes the most common real-world exposure (instance briefly reachable on a home/office LAN or via port-forwarding misconfiguration) — the setup token is the stronger fix for the "already on the same LAN" attacker model and is worth the extra work if the wizard is expected to support remote-first-run (e.g., cloud VM setup via a temporary public IP).
- **SSRF deny-list vs. allow-list (C3):** an allow-list (only permit RFC1918 + loopback, block everything else) would be simpler to reason about but breaks the legitimate case of an Arr instance reachable only via a public/VPN hostname; a narrow deny-list (block only cloud metadata + link-local) is the right trade-off for this product's actual usage pattern.
- **Local-path PCD linking in the wizard (C4):** the recommended trade-off is to simply not expose it in the guided flow at all — git-URL-only setup covers the primary use case (auto-linking a public/private GitHub PCD, matching the existing `PRAXRR_DEFAULT_DB_URL` startup behavior) and sidesteps the traversal risk entirely rather than trying to bound it correctly under time pressure.

## Open Questions

1. Should the wizard's "needs setup" condition remain `usersQueries.existsLocal()`, or should it become an independent `setupStateQueries.wizard_completed` flag that also covers `AUTH=off` deployments (W6)? This affects both C1's guard implementation and whether the wizard ever runs for `AUTH=off` users.
2. Is remote (non-LAN) first-run setup a supported scenario (e.g., a freshly provisioned cloud VM configured over the public internet before DNS/TLS is set up)? This determines whether the C2 mitigation should be local-IP restriction, a setup token, or both.
3. Will the wizard's "select profiles" and "preview & sync" steps introduce any new outbound request to the Arr instance beyond `testConnection()` (e.g., pulling quality profiles for the picker) — if so, those calls need the same `assertSafeArrUrl()` treatment as the connection test, not just the initial test step.
4. Does `PRAXRR_DEFAULT_DB_TOKEN` (or an equivalent wizard-collected token) ever need to support non-GitHub git hosts? The current `clone()` token-embedding logic (`write.ts:317-319`) is GitHub-specific (`https://github.com` string match) — a generic wizard exposing "any git URL + token" would need that broadened, with the same token-scrubbing discipline applied per host.
5. Confirm with the tech-design/UX research whether local-path PCD linking is a hard product requirement for the wizard (some self-hosted users may want to point at a bind-mounted config repo) — if yes, C4's root-confinement fix becomes mandatory rather than "just disable it," and needs its own design pass (e.g., a `PRAXRR_LOCAL_PCD_ROOT` allow-root env var).
