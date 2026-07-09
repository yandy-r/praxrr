# WebAuthn / Passkey Auth — Design (issue #18)

> Status: approved design. Produced by the ultracode design workflow (understand + empirical
> feasibility + judge-panel synthesis). See `plan.md` for the file-level implementation plan.

## Summary

Add passkeys as a **supplement** to the existing password login under `AUTH=on`. Named credentials
with register/list/rename/delete management in **Settings › Security**, plus one-tap passwordless
login via **discoverable (resident) credentials** on `/auth/login`. Password stays the always-available
primary + recovery path, so account lockout is impossible.

- **No new `AUTH` mode**, no enforcement/`passkey_only` toggle (lockout footgun — dropped by design).
- Passkeys are inert under `AUTH=off|local|oidc`; only active under `AUTH=on`.
- **PRF / E2E encryption is out of scope** (future issue #9).

## Feasibility (empirically proven)

Ran under Deno 2.5.6 via native `npm:` specifiers, **no compat shims**:

- Server `npm:@simplewebauthn/server@13.3.2` — `generateRegistrationOptions`,
  `verifyRegistrationResponse`, `generateAuthenticationOptions`, `verifyAuthenticationResponse`
  (all async). Encoding helpers: `isoBase64URL` from `@simplewebauthn/server@13.3.2/helpers`.
- Browser `npm:@simplewebauthn/browser@13.3.0` — `startRegistration`, `startAuthentication`,
  `browserSupportsWebAuthn`, `WebAuthnError`.
- Pin exact versions in `packages/praxrr-app/deno.json` (not the floating `^13` range).

### v13 API facts (differ from v10 — get these right)

- Options `.challenge` and `.user.id` are **base64url strings**.
- `verifyRegistrationResponse` returns `registrationInfo.credential.{id, publicKey:Uint8Array, counter, transports}`
  (NOT flat `credentialID`/`credentialPublicKey`).
- `verifyAuthenticationResponse` takes `credential:{id, publicKey, counter, transports}` (NOT `authenticator`),
  returns `authenticationInfo.newCounter` — **persist it back** onto the credential.
- `excludeCredentials`/`allowCredentials` entry `.id` is a **base64url string**.
- Browser `startRegistration`/`startAuthentication` take a `{ optionsJSON }` wrapper (v11+).
- `userID` input must be `new TextEncoder().encode(String(user.id))`.

## Data model (app DB, migration `20260717`)

Not a PCD base-op → `seedBuiltInBaseOps.ts` untouched.

```sql
CREATE TABLE webauthn_credentials (
  id               TEXT PRIMARY KEY,                       -- credential.id (Base64URLString); lookup key; store verbatim
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key       TEXT NOT NULL,                          -- isoBase64URL.fromBuffer(credential.publicKey); decode before verify
  counter          INTEGER NOT NULL DEFAULT 0,             -- UPDATE to authenticationInfo.newCounter after each verified auth
  transports       TEXT,                                   -- JSON array e.g. '["internal","hybrid"]'
  device_type      TEXT NOT NULL DEFAULT 'singleDevice' CHECK (device_type IN ('singleDevice','multiDevice')),
  backed_up        INTEGER NOT NULL DEFAULT 0,             -- credentialBackedUp 0/1
  webauthn_user_id TEXT NOT NULL,                          -- base64url user handle (encoded users.id)
  aaguid           TEXT,
  name             TEXT NOT NULL CHECK (LENGTH(TRIM(name)) > 0 AND LENGTH(name) <= 100),
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at     TEXT
);
CREATE INDEX idx_webauthn_credentials_user ON webauthn_credentials(user_id);
CREATE UNIQUE INDEX idx_webauthn_credentials_name ON webauthn_credentials(user_id, name COLLATE NOCASE);

CREATE TABLE webauthn_challenges (
  id         TEXT PRIMARY KEY,                             -- crypto.randomUUID(); opaque handle carried in short-lived cookie
  challenge  TEXT NOT NULL,                                -- base64url challenge from generate*Options()
  purpose    TEXT NOT NULL CHECK (purpose IN ('register','authenticate')),
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE, -- set for register (authed); NULL for pre-login authenticate
  expires_at TEXT NOT NULL,                                -- now + WEBAUTHN_CHALLENGE_TTL_SECONDS
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
```

## Challenge handling

Transient, server-side, **single-use**, TTL-bounded. `*options` handler generates options, INSERTs a
challenge row, and sets a short-lived httpOnly cookie `webauthn_challenge` = the uuid handle. `*verify`
handler reads the cookie handle, calls `consume(handle, purpose)` (SELECT valid+non-expired, then DELETE
in the same call), passes `row.challenge` as `expectedChallenge`, and clears the cookie regardless of
outcome. Missing/expired/wrong-purpose/consumed → `400 {error:'Challenge expired or not found'}`.
Never skip the `expectedChallenge` check. TTL default 300s (> the 60s WebAuthn options timeout).
`deleteExpired()` runs lazily at the top of each `*options` call and at startup next to session cleanup.

## RP ID / origin config (reverse-proxy aware)

Single helper `resolveWebAuthnRp(event)` → `{ rpID, rpName, allowedOrigins }`, called **identically** by
every `*options` AND `*verify` handler (any drift silently fails verification).

- `rpID` = `WEBAUTHN_RP_ID` (host only, no scheme/port) else host of `X-Forwarded-Host`/`Host`/`event.url.hostname` (port stripped). → `expectedRPID`.
- `allowedOrigins` = `WEBAUTHN_ORIGIN` (comma-separated full origins, passed to verify as an **array** so proxied HTTPS domain + direct `http://host:6868` both work) else a single derived `${X-Forwarded-Proto ?? url.protocol}//${X-Forwarded-Host ?? Host}`. → `expectedOrigin`.
- `rpName` = `WEBAUTHN_RP_NAME` || `'Praxrr'`.
- Fail-fast throw when no host resolves → handler returns 500.
- Constraints: WebAuthn needs a **secure context** (HTTPS or `http://localhost`); plain-HTTP LAN-IP origins
  can't use passkeys. **RP ID is immutable once credentials enroll** — pin `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGIN`
  for proxied deployments.

## API endpoints (`/api/v1/auth/webauthn/*`, all POST, `{error}` envelope)

| Endpoint                 | Auth                                  | Purpose                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registration/options`   | Session + `AUTH=on` + real local user | `generateRegistrationOptions` with `excludeCredentials`; INSERT challenge (purpose=register, user_id); set cookie; return `{options}`                                                                                |
| `registration/verify`    | Session + real local user             | body `{response, name?}`; consume challenge; `verifyRegistrationResponse`; INSERT credential (name default from UA, 409 on dup name); return `{verified, credential}`                                                |
| `authentication/options` | **Public** + `AUTH=on`                | `generateAuthenticationOptions` (allowCredentials omitted — discoverable); INSERT challenge (user_id NULL); set cookie; return `{options}`                                                                           |
| `authentication/verify`  | **Public** + `AUTH=on`                | body `{response}`; consume challenge; look up credential by `response.id`; `verifyAuthenticationResponse`; counter guard; UPDATE counter+last_used_at; mint `session` cookie via login contract; return `{verified}` |

**Runtime auth gating** (defense in depth beyond `PUBLIC_PATHS`):

1. All 4 endpoints require `config.authMode==='on'` else `409 {error:'Passkeys require AUTH=on'}`.
2. Registration endpoints + settings form actions require a **real** `event.locals.user` (id ≠ 0, username not `oidc:*`) — rejects the id=0 API-key pseudo-user, the `off`/`local` skipAuth null user, and OIDC users.
3. `PUBLIC_PATHS` gains exactly one prefix: `'/api/v1/auth/webauthn/authentication'` (registration stays 401-gated).

Credential **list/rename/delete** are SvelteKit form actions on `settings/security` (mirroring `revokeSession`),
NOT REST endpoints.

## OpenAPI / types (CORRECTED — source of truth)

> The synthesis agent guessed `packages/praxrr-api/openapi.json` was the source; **it is not**. Verified:

- **Source of truth**: `docs/api/v1/openapi.yaml` (root) with split `docs/api/v1/paths/*.yaml` +
  `docs/api/v1/schemas/*.yaml` (referenced via `$ref './paths/x.yaml#/...'`).
- Add `docs/api/v1/paths/webauthn.yaml` + `docs/api/v1/schemas/webauthn.yaml`; wire tag + path `$ref`s +
  `components/schemas` into `docs/api/v1/openapi.yaml`.
- `deno task bundle:api` regenerates `packages/praxrr-api/openapi.json` (prettier-gated mirror) — run + `prettier --write`.
- **Do NOT run `generate:api-types`** for a full `v1.d.ts` regen — per project memory it emits ~3300 lines of
  tool-version noise and CI does not gate it. Instead follow the `security-posture`/`config-health` pattern:
  **local runtime types** in the handlers, importing request/response types directly from `@simplewebauthn/*`.

## Env vars

- `WEBAUTHN_RP_ID` — registrable domain (host only). Stable/immutable once enrolled. Optional (derived).
- `WEBAUTHN_ORIGIN` — comma-separated full origins for `expectedOrigin` (array). Optional (derived).
- `WEBAUTHN_RP_NAME` — authenticator display name. Default `'Praxrr'`.
- `WEBAUTHN_CHALLENGE_TTL_SECONDS` — challenge lifetime. Default `300`.

No enable/disable flag — passkeys are implicitly available under `AUTH=on`, gated at runtime by credential existence.

## UI surfaces

- **`settings/security/+page.svelte`** — new PLAIN bordered "Passkeys" card (NOT CollapsibleCard, so the register
  slot never unmounts mid-ceremony) between the API Key card and Active Sessions. Register button (fetch flow) +
  optional name input; `<Table>` (name, created, last used, device type, backed-up badge) with per-row rename/delete
  form actions + `invalidateAll()`.
- **`settings/security/+page.server.ts`** — `load()` adds `passkeys[]` (AUTH=on + real user only); form actions
  `renamePasskey`, `deletePasskey` scoped by `user_id`. NO `registerPasskey` action (registration is the /api/v1 fetch flow).
- **`auth/login/+page.svelte`** — gated "Sign in with passkey" button in the non-OIDC branch; renders only when
  `authMode==='on' && hasPasskeys && browserSupportsWebAuthn()`. Handler: options → `startAuthentication({optionsJSON})`
  → verify → `goto('/')`; `WebAuthnError` → `alertStore.add('error', ...)`.
- **`auth/login/+page.server.ts`** — `load()` exposes `authMode` + `hasPasskeys` (countByUserId>0 under AUTH=on);
  OIDC early return unchanged.
- **`src/lib/client/utils/webauthn.ts`** — NEW browser-only helper wrapping `startRegistration`/`startAuthentication`
  - `browserSupportsWebAuthn`, browser-guarded (`$app/environment`), surfaces `WebAuthnError`.
- **`auth/setup`** stays password-only — passkeys enrolled post-login (sidesteps the `needsSetup` redirect).

## Security considerations

- Challenge single-use + TTL; fail-fast on missing/expired; never skip `expectedChallenge` (replay defense).
- **Counter-regression clone guard**: reject only when `newCounter <= stored && stored > 0` (platform/iCloud passkeys
  frequently stay at 0 and never increment — rejecting those breaks valid logins). Otherwise UPDATE to newCounter.
- Origin/RP-ID binding via the shared `resolveWebAuthnRp` (no drift between options/verify).
- Session mint on passkey login reuses the exact login contract → no session-fixation window (fresh id on verified assertion).
- Untrusted browser input passed straight to the verify functions which validate it; name length/trim-checked.
- Rate limiting: authentication assertions are cryptographically infeasible to brute-force and challenges are single-use;
  add a lightweight per-IP throttle on challenge issuance as defense-in-depth (or rely on reverse proxy). Failed verifies mint no session.
- Supply chain: `@simplewebauthn/server` pulls `@peculiar/asn1-*`, `asn1js`, `tsyringe`, `reflect-metadata`, `tiny-cbor`;
  `attestationType:'none'` leaves most attestation code unused. Pin exact versions.
- `excludeCredentials` prevents double-registering the same authenticator.

## Explicitly out of scope

PRF/E2E encryption (#9); `passkey_only` enforcement; first-run passkey enrollment / `needsSetup` changes; passkeys under
`off`/`local`/`oidc`; conditional-UI autofill; REST credential GET/PATCH/DELETE; attestation verification beyond `none`;
multi-user / cross-device recovery; scheduled challenge-cleanup job.
