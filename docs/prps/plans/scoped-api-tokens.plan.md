# Plan: Named, scoped, revocable API tokens

## Contents

- Summary
- User Story
- Problem → Solution
- Metadata
- UX Design
- Mandatory Reading
- Patterns to Mirror
- Shared Contract
- Files to Change
- NOT Building
- Step-by-Step Tasks
- Testing Strategy
- Validation Commands
- Acceptance Criteria
- Completion Checklist
- Risks
- Notes

## Summary

Replace the single plaintext `auth_settings.api_key` with an `api_tokens` table of named, hashed,
scoped, revocable, optionally expiring tokens. Middleware resolves a token to a principal with
scopes; a central route policy and per-MCP-tool declarations enforce them. The legacy key is
migrated to a hashed `admin` token flagged legacy, keeps working, and the UI warns about it.
Token auth runs before the auth-mode branch, so tokens also work under `AUTH=oidc`.

Issues: Linear YAN-534 (feature), YAN-441 (key ignored under oidc), YAN-439 (non-constant-time
compare), YAN-765 (metrics scraping under oidc). GitHub #326. Target release: v0.8.0.

## User Story

As a Praxrr operator, I want a separate token per integration with only the access it needs, so
that I can grant read-only or MCP-only access, see which integration is calling, and revoke one
without breaking the others.

## Problem → Solution

One full-access, revealable, plaintext key shared by every integration and ignored under oidc →
many hashed tokens with scopes, last-used tracking, revocation and expiry, accepted in every
auth mode that authenticates.

## Metadata

- **Complexity**: Large (≈25 files)
- **Source**: Linear YAN-534 (+ YAN-439, YAN-441, YAN-765)
- **Estimated Files**: 25

## UX Design

Before: Settings → Security has one "API Key" card: masked key, Show/Hide (reveals stored
plaintext), Regenerate.

After: the card becomes "API tokens".

- Warning banner when an active legacy token exists: "The legacy API key is deprecated. Create
  scoped tokens for your integrations, then revoke it."
- Create form: Name (required, ≤64 chars), scope checkboxes with descriptions (read, mcp,
  sync:apply, admin; `read` preselected), expiry select (Never, 30, 90, 365 days).
- After create: the secret is shown once in a copyable block with "You won't be able to see this
  token again." It disappears on reload/navigation. No reveal action exists.
- Table: Name (+ "Legacy" badge), Prefix (`prx_ab12…`), Scopes, Created, Last used ("Never"),
  Expires ("Never"), Status (Active/Expired/Revoked). Revoke action with confirmation modal.

## Mandatory Reading

| Priority | File                                                                                         | Why                                           |
| -------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| P0       | `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`                                | getAuthState to rewrite                       |
| P0       | `packages/praxrr-app/src/hooks.server.ts`                                                    | authHandle (lines ~245-306) enforcement point |
| P0       | `packages/praxrr-app/src/lib/server/db/queries/authSettings.ts`                              | legacy key functions to remove                |
| P0       | `packages/praxrr-app/src/lib/server/db/migrations.ts`                                        | migration registration                        |
| P0       | `packages/praxrr-app/src/lib/server/db/migrations/20260717_create_webauthn_tables.ts`        | table migration pattern                       |
| P0       | `packages/praxrr-app/src/routes/settings/security/+page.server.ts`                           | load/actions to change                        |
| P0       | `packages/praxrr-app/src/routes/settings/security/+page.svelte`                              | API key card to replace                       |
| P1       | `packages/praxrr-app/src/lib/server/mcp/context.ts`, `tools.ts`, `dispatch.ts`               | MCP scope enforcement                         |
| P1       | `packages/praxrr-app/src/lib/server/security/gather.ts`, `src/lib/shared/security/checks.ts` | `app_key_at_rest` check                       |
| P1       | `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`                               | token redaction                               |
| P1       | `packages/praxrr-app/src/tests/routes/securitySessions.test.ts`                              | page action test pattern                      |
| P2       | `packages/praxrr-app/src/tests/e2e/specs/2.40-api-key-masking.spec.ts`                       | e2e to update                                 |

## Patterns to Mirror

- Migration: `export const migration: Migration = { version, name, up, down, afterUp }`; register
  an import alias plus an entry in `loadMigrations()` in `migrations.ts`.
- Queries module: object literal `xQueries = { ... }` over `db.query/queryFirst/execute` (see
  `queries/webauthnCredentials.ts`).
- Page actions: `fail(status, { xError })` on failure; success returns flags; client reacts with
  `$: if (form?.x)` and `alertStore.add(...)`. Svelte 5 legacy mode, no runes.
- Tables: `Table` with `columns: Column<T>[]` and `actions` slot with `TableActionButton` in a
  `<form method="POST" action="?/x" use:enhance>`.
- DB tests: per-file `dbTest` helper using a temp `config.setBasePath`, `db.initialize()`,
  `runMigrations()` (see `tests/routes/securitySessions.test.ts`).
- 401 JSON shape in hooks: `{ error: 'Unauthorized' }` with `Content-Type: application/json`.

## Shared Contract

All slices code against these exact signatures.

`packages/praxrr-app/src/lib/shared/auth/apiTokenScopes.ts` (client-safe):

```ts
export const API_TOKEN_SCOPES = ['read', 'mcp', 'sync:apply', 'admin'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];
export const API_TOKEN_SCOPE_INFO: Record<
  ApiTokenScope,
  { label: string; description: string }
>;
export function isApiTokenScope(value: unknown): value is ApiTokenScope;
/** `admin` implies every scope; otherwise exact membership. */
export function hasScope(
  granted: readonly ApiTokenScope[],
  required: ApiTokenScope
): boolean;
export const API_TOKEN_NAME_MAX_LENGTH = 64;
export const API_TOKEN_EXPIRY_OPTIONS = [null, 30, 90, 365] as const; // days; null = never
/** Client-safe view of a token; never contains the hash or secret. */
export interface ApiTokenSummary {
  id: number;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  isLegacy: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
}
```

`packages/praxrr-app/src/lib/server/db/queries/apiTokens.ts`:

```ts
export const apiTokensQueries = {
 list(): ApiTokenSummary[];                       // newest first, includes revoked/expired
 create(input: { name: string; tokenHash: string; prefix: string; scopes: ApiTokenScope[];
  expiresAt: string | null; isLegacy?: boolean }): ApiTokenSummary;
 findActiveByHash(tokenHash: string): ApiTokenSummary | undefined; // not revoked, not expired
 touchLastUsed(id: number): void;                 // writes only if NULL or older than 60s
 revoke(id: number): boolean;                     // false if missing or already revoked
 hasActiveLegacy(): boolean;
 countActive(): number;
};
```

`packages/praxrr-app/src/lib/server/utils/auth/apiTokens.ts` (sync; hashing via `node:crypto`
`createHash('sha256')`, hex):

```ts
export const API_TOKEN_SECRET_PREFIX = 'prx_';
export class ApiTokenValidationError extends Error {}
export function hashApiToken(secret: string): string;
export function generateApiTokenSecret(): string; // 'prx_' + 64 hex chars (32 random bytes)
export function createApiToken(input: {
  name: unknown;
  scopes: unknown;
  expiresInDays: unknown;
}): { token: ApiTokenSummary; secret: string }; // throws ApiTokenValidationError
export function resolveApiToken(secret: string): ApiTokenSummary | null; // lookup + touch
```

`packages/praxrr-app/src/lib/server/utils/auth/principal.ts`:

```ts
export type AuthPrincipal =
  | { kind: 'session'; scopes: readonly ApiTokenScope[] } // all scopes
  | { kind: 'bypass'; scopes: readonly ApiTokenScope[] } // all scopes
  | {
      kind: 'token';
      tokenId: number;
      tokenName: string;
      isLegacy: boolean;
      scopes: readonly ApiTokenScope[];
    };
```

`App.Locals` gains `principal: AuthPrincipal | null`; `AuthState` gains `principal`.

`packages/praxrr-app/src/lib/server/utils/auth/scopePolicy.ts`:

```ts
/** Scope a token needs for this request. Fail-closed: unknown mutating routes need `admin`. */
export function requiredScopeFor(
  method: string,
  pathname: string
): ApiTokenScope;
```

MCP: `McpContext` gains `scopes: readonly ApiTokenScope[]`; `McpTool` gains
`requiredScope: ApiTokenScope` (all current tools `'mcp'`). `callTool` rejects a tool whose
`requiredScope` is not granted with JSON-RPC error code `-32003` ("Forbidden"), and the MCP route
answers HTTP 403 for that error.

## Files to Change

| File                                                                             | Action | Justification                |
| -------------------------------------------------------------------------------- | ------ | ---------------------------- |
| `packages/praxrr-app/src/lib/shared/auth/apiTokenScopes.ts`                      | CREATE | shared scopes/types          |
| `packages/praxrr-app/src/lib/server/db/migrations/20261021_create_api_tokens.ts` | CREATE | table + legacy migration     |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`                            | UPDATE | register migration           |
| `packages/praxrr-app/src/lib/server/db/schema.sql`                               | UPDATE | reference schema             |
| `packages/praxrr-app/src/lib/server/db/queries/apiTokens.ts`                     | CREATE | token queries                |
| `packages/praxrr-app/src/lib/server/db/queries/authSettings.ts`                  | UPDATE | remove legacy key API        |
| `packages/praxrr-app/src/lib/server/utils/auth/apiKey.ts`                        | DELETE | replaced by apiTokens.ts     |
| `packages/praxrr-app/src/lib/server/utils/auth/apiTokens.ts`                     | CREATE | generate/hash/create/resolve |
| `packages/praxrr-app/src/lib/server/utils/auth/principal.ts`                     | CREATE | principal type               |
| `packages/praxrr-app/src/lib/server/utils/auth/scopePolicy.ts`                   | CREATE | route → scope                |
| `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`                    | UPDATE | token-first auth             |
| `packages/praxrr-app/src/hooks.server.ts`                                        | UPDATE | principal + 403 enforcement  |
| `packages/praxrr-app/src/app.d.ts`                                               | UPDATE | Locals.principal             |
| `packages/praxrr-app/src/lib/server/mcp/context.ts`, `tools.ts`, `dispatch.ts`   | UPDATE | tool scopes                  |
| `packages/praxrr-app/src/routes/api/v1/mcp/+server.ts`                           | UPDATE | 403 mapping                  |
| `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`                   | UPDATE | redact `prx_` tokens         |
| `packages/praxrr-app/src/routes/settings/security/+page.server.ts`               | UPDATE | token actions                |
| `packages/praxrr-app/src/routes/settings/security/+page.svelte`                  | UPDATE | token UI                     |
| `packages/praxrr-app/src/lib/server/security/gather.ts`                          | UPDATE | token state                  |
| `packages/praxrr-app/src/lib/shared/security/checks.ts`                          | UPDATE | `app_key_at_rest`            |
| `packages/praxrr-app/src/tests/e2e/specs/2.40-api-key-masking.spec.ts`           | UPDATE | new UI flow                  |
| `docs/api/authentication.md`, `docs/api/endpoints.md`, `docs/ARCHITECTURE.md`    | UPDATE | docs                         |
| `docs/site/src/content/docs/guides/metrics.md`, `mcp-server.md`                  | UPDATE | oidc + scopes                |
| `packages/praxrr-app/src/lib/server/utils/auth/README.md`                        | UPDATE | docs                         |
| `docs/api/v1/paths/mcp.yaml`, `docs/api/v1/paths/system.yaml`                    | UPDATE | X-Api-Key descriptions       |

## NOT Building

- REST `/api/v1` endpoints for token management (UI form actions only).
- `Authorization: Bearer` header support (X-Api-Key and `?apikey=` stay the transports).
- Rate limiting of failed token attempts.
- Removal of the legacy token (follow-up after the deprecation window).
- RBAC / per-user tokens (YAN-536) and MCP write-tier tools (YAN-540).

## Step-by-Step Tasks

### Task 1.1: Core auth, storage and enforcement — Depends on [none]

- **ACTION**: Create the shared scopes module, migration, queries, token helpers, principal,
  scope policy; rewrite middleware/hooks/app.d.ts; MCP tool scopes; sanitizer; remove legacy key API.
- **IMPLEMENT**: Token check runs first for every mode except `off`/local-bypass, only for paths
  under `/api/v1/`; token principals never authenticate page routes or form actions. Migration
  `20261021` creates `api_tokens` (id, name, token_hash UNIQUE, prefix, scopes JSON, is_legacy,
  created_at, last_used_at, expires_at, revoked_at); `afterUp` converts a non-null
  `auth_settings.api_key` into a hashed legacy `admin` token named "Legacy API key" only when a local
  (non-`oidc:`) user exists (the key was ignored under oidc, so OIDC-only installs never used it), then sets `api_key = NULL` unconditionally.
- **MIRROR**: Migration and queries patterns above.
- **VALIDATE**: `deno task test` on new auth/migration/mcp/sanitizer tests; `deno task check:server`.

### Task 1.2: Settings → Security token UI — Depends on [none; codes against Shared Contract]

- **ACTION**: Replace the API key card and its actions with token create/list/revoke.
- **IMPLEMENT**: Actions `createApiToken` (returns `{ createdApiToken: { secret, token } }`) and
  `revokeApiToken`; allowed for session principals and bypass; load returns
  `apiTokens: ApiTokenSummary[]` and `hasLegacyApiToken`. Remove `regenerateApiKey`,
  `revealAuthKey`, `apiKeyMasked`, `hasApiKey`.
- **MIRROR**: Table/actions/alert patterns above.
- **VALIDATE**: page action tests; `deno task check:client`.

### Task 1.3: Security posture, docs and OpenAPI — Depends on [none; codes against Shared Contract]

- **ACTION**: Rework `app_key_at_rest` around token state; update docs and OpenAPI descriptions;
  regenerate API types.
- **IMPLEMENT**: Check passes when tokens exist and none is legacy; warns when an active legacy
  token exists (recommend revoking it); no longer n/a under oidc.
- **MIRROR**: existing check structure in `checks.ts`.
- **VALIDATE**: `deno task test security-posture`; `deno task generate:api-types` clean diff.

## Testing Strategy

- Migration: legacy key → hashed admin legacy token and `api_key` NULL; fresh install (no users)
  → no legacy token and `api_key` NULL; only OIDC users → no legacy token and `api_key` NULL.
- getAuthState: valid token authenticates under `on` and `oidc`; ignored on non-`/api/v1` paths;
  revoked and expired tokens rejected; `last_used_at` set on use.
- Scope policy: read token → 403 on POST/PUT/PATCH/DELETE `/api/v1/*`, 200-path on GET; `mcp`
  scope required for `/api/v1/mcp`; `sync:apply` routes; `admin` everything.
- MCP: tool with unmet `requiredScope` → `-32003`.
- Page actions: create returns secret once; load never contains secret or hash; revoke works.
- Sanitizer: `prx_` tokens redacted.

## Validation Commands

```bash
deno task test
deno task lint
deno task check
deno task build
```

## Acceptance Criteria

- A `read` token gets 403 on mutating `/api/v1` routes and on write-tier MCP tools.
- Tokens are stored hashed, and the UI never shows the secret again after creation.
- Revoking a token takes effect on the next request, and `last_used_at` is updated on use.
- The legacy key still authenticates, and the UI shows a deprecation warning.
- Under `AUTH=oidc`, a valid token gets 200 from `/api/v1/metrics`; missing/invalid gets 401.
- Token comparison never compares plaintext secrets.

## Completion Checklist

- All callers of removed `authSettingsQueries` key functions migrated.
- Docs and OpenAPI descriptions updated; API types regenerated.
- Tests, lint, check, build pass.

## Risks

- Tokens no longer authenticate page routes/form actions (legacy key did under `AUTH=on`). Intended
  hardening; called out in the PR.
- Fresh installs or installs without users lose the never-shown random key. Intended.
- Read-classified POST routes must be verified side-effect free; unknown mutating routes fail
  closed to `admin`. Only sync preview (in-memory store) and goals preview (sandbox cache) are
  `read`; simulate and entity-testing evaluate write persistent parser/pattern caches and need
  `admin`, as does `GET /api/v1/arr/releases` (live indexer search through Arr).

## Notes

Decisions: SHA-256 lookup by hash (tokens carry 256 bits of entropy, so a fast hash is
appropriate and avoids timing comparison of secrets); `last_used_at` writes throttled to 60s via a
conditional UPDATE to avoid a write per request; tokens scoped to `/api/v1/**` only
(legacy non-v1 `/api/*` routes such as backup downloads expose the app DB, so they require a
session).
