# WebAuthn / Passkey Auth — Implementation Plan (issue #18)

> Produced by the ultracode planning workflow (verify design assumptions against code → signature-level
> ordered plan). Companion to `design.md`.

## Corrections from the Verify phase (do NOT follow the design blindly here)

1. **Dep placement**: server `@simplewebauthn/server@13.3.2` (+ `/helpers` subpath) → **root `/deno.json`** `imports`
   (where `@felix/bcrypt`, `marked`, `croner` live). Browser `@simplewebauthn/browser@13.3.0` → **root `/package.json`**
   `dependencies` (Vite bare-specifier from `node_modules`, like `lucide-svelte`). NOT `packages/praxrr-app/deno.json`.
2. **Handler typing**: `config-health` _does_ import generated `v1.d.ts` types → do NOT cite it. Mirror **`security-posture`
   only**: local wire types + `RegistrationResponseJSON`/`AuthenticationResponseJSON` imported directly from
   `@simplewebauthn/server`. **Do NOT run `generate:api-types`** (noisy, CI-ungated `v1.d.ts` regen).
3. **Bundle gate**: no PR job diffs bundled `openapi.json` vs yaml; the PR-blocking gate is `lint-docs` **prettier --check**
   over both yaml and json. Run `deno task bundle:api` (JSR-mirror convention) + prettier both.
4. **Real-user gate**: `user.id <= 0` (parity with `complexity-tiers/+server.ts:62`; API-key pseudo-user is `{id:0,'api'}`)
   **AND** `!user.username.startsWith('oidc:')`. Both required.
5. **skipAuth ordering**: under `AUTH=off|local` the handle returns before `isPublicPath`/401 → every handler must self-gate
   on `config.authMode==='on'` (409). PUBLIC_PATHS is not the only defense.
6. **Settings user source**: scope passkeys by `event.locals.user.id` (the registration write source), not
   `getByUsername('admin')`, to avoid user_id drift.
7. **Session cookie**: keep `secure:false` (login parity) so the cookie survives direct `http://host:6868` access that the
   `WEBAUTHN_ORIGIN` array supports.

## Build order

**Foundation (sequential, shared/central — authored by main loop):**

1. root `deno.json` — add server dep + `/helpers` subpath
2. root `package.json` — add browser dep, `npm install`
3. `config.ts` — 4 readonly `webauthn*` env fields
4. `middleware.ts` — `PUBLIC_PATHS` += `'/api/v1/auth/webauthn/authentication'`
5. `migrations/20260717_create_webauthn_tables.ts` (version `20260717`)
6. `migrations.ts` — import + array append
7. `db/queries/webauthnCredentials.ts`
8. `db/queries/webauthnChallenges.ts`
9. `lib/server/webauthn/rp.ts` (pure `deriveWebAuthnRp` + `resolveWebAuthnRp(event)`)
10. `lib/server/webauthn/ceremonies.ts` (`isCounterRegression`, `defaultCredentialName`, `toCredentialSummary`, local wire types)

**Core (main loop, after foundation):** 11. 4 API handlers under `routes/api/v1/auth/webauthn/{registration,authentication}/{options,verify}/+server.ts` 12. `lib/client/utils/webauthn.ts` (browser-only helper)

**Leaves (implementation workflow, parallel — disjoint files):**

- settings: `settings/security/+page.server.ts` (+`passkeys[]`, `renamePasskey`/`deletePasskey`) + `+page.svelte` (Passkeys card)
- login: `auth/login/+page.server.ts` (+`hasPasskeys`) + `+page.svelte` ("Sign in with passkey")
- spec: `docs/api/v1/paths/webauthn.yaml` + `schemas/webauthn.yaml` + `openapi.yaml` wiring → `bundle:api` + prettier
- tests: `tests/db/webauthn.test.ts` (migratedTest CRUD/challenge + pure units for `isCounterRegression`, `deriveWebAuthnRp`)

## Key signatures

- `webauthnCredentialsQueries`: `create(input): WebAuthnCredentialRow`, `getById(id)`, `listByUserId(userId)`,
  `countByUserId(userId)`, `count()`, `existsByNameForUser(userId,name)`, `rename(id,userId,name): number`,
  `updateCounter(id,newCounter): number` (sets `last_used_at`), `deleteById(id,userId): number`.
- `webauthnChallengesQueries`: `create(challenge,purpose,userId,ttlSeconds): string` (handle),
  `consume(handle,purpose): {challenge,userId}|undefined` (SELECT-valid then DELETE-always → single-use), `deleteExpired(): number`.
- `deriveWebAuthnRp(info, overrides): WebAuthnRp` (pure) + `resolveWebAuthnRp(event): WebAuthnRp`.
- `isCounterRegression(newCounter, storedCounter): boolean` = `newCounter <= storedCounter && storedCounter > 0`.

## Verify commands (prove green)

- `deno task bundle:api` then prettier over `docs/api/v1/**/*.yaml` + `packages/praxrr-api/openapi.json`
- `deno task format` (or narrow prettier) + `npx prettier --check '**/*.{md,json,yaml,yml}'` (lint-docs gate)
- `deno task check` (check:server for server modules + check:client svelte-check for routes/handlers/pages)
- `deno test packages/praxrr-app/src/tests/db/webauthn.test.ts` (targeted) then `deno task test` (full — catches nav-snapshot regressions)

## Residual risks

- Migration version `20260717` may collide with a concurrent PR — re-verify + rebump after syncing main pre-merge.
- Routes are excluded from `deno check`; the 4 handlers are type-checked only by `check:client` (svelte-check) — run `deno task check`.
- v13 field names (`credentialDeviceType`, `credentialBackedUp`, `aaguid` on `registrationInfo`) — confirm against the installed `.d.ts`.
- No app-level rate limiting on public challenge issuance (deferred to reverse proxy; `deleteExpired()` bounds table growth).
- Passkeys require a secure context (HTTPS or `http://localhost`); plain-HTTP LAN-IP can't use them — pin `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` for proxied HTTPS.
