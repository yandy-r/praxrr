# Authentication

This document describes how API requests are authenticated by runtime middleware.

Source files:

- `packages/praxrr-app/src/hooks.server.ts`
- `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`
- `packages/praxrr-app/src/lib/server/utils/auth/scopePolicy.ts`
- `packages/praxrr-app/src/lib/shared/auth/apiTokenScopes.ts`

## Public vs protected endpoints

- Public (no auth required): `GET /api/v1/health`
- Protected: all other `/api/*` endpoints, including all remaining `/api/v1/*`

When an unauthenticated request hits a protected API route, middleware returns:

```json
{ "error": "Unauthorized" }
```

with status `401`.

## Accepted credentials

## 1. Session cookie

- Cookie name: `session`
- Created by interactive login flow (`/auth/login` or OIDC routes)
- Used across UI and API requests

Example:

```bash
curl -sS \
  -H 'Cookie: session=<session-id>' \
  http://localhost:5173/api/v1/openapi.json | jq '.info.version'
```

## 2. API token

Integrations authenticate with a named API token. Tokens look like `prx_…` and are sent in
either:

- Header: `X-Api-Key: <token>`
- Query parameter: `?apikey=<token>`

Recommended:

- Use the `X-Api-Key` header
- Avoid query-parameter auth in shared logs/history

Example:

```bash
curl -sS \
  -H 'X-Api-Key: prx_<token>' \
  http://localhost:5173/api/v1/arr/releases?instanceId=1\&itemId=10 | jq
```

Tokens only authenticate `/api/v1/*` requests. They never authenticate pages, form actions, or
the app-internal non-v1 `/api/*` routes (for example backup downloads), which require a session.

### Managing tokens

Create, list and revoke tokens in **Settings → Security**:

- Each token has a name (up to 64 characters), one or more scopes, and an expiry: never, 30,
  90 or 365 days.
- The token value is shown **once**, at creation. Praxrr stores only a SHA-256 hash and a short
  display prefix, so a lost token cannot be recovered. Create a new one instead.
- The token list shows each token's prefix, scopes, creation time, last use, expiry and status.
- Revoking a token takes effect on the next request. Expired and revoked tokens are rejected
  with `401`.

### Scopes

| Scope        | Grants                                                                         |
| ------------ | ------------------------------------------------------------------------------ |
| `read`       | Read-only access: every v1 `GET`/`HEAD`/`OPTIONS` request and dry-run previews |
| `mcp`        | The MCP server at `/api/v1/mcp`                                                |
| `sync:apply` | Applying reviewed changes and triggering syncs (see below)                     |
| `admin`      | Full API access. Implies every other scope                                     |

Each `/api/v1/*` request needs one scope (tokens are not accepted on other paths). The policy is
checked in this order, and an unmatched mutating request needs `admin`:

- `mcp`: any request to `/api/v1/mcp`.
- `read`: any `GET`, `HEAD` or `OPTIONS` request.
- `sync:apply`: these `POST` routes:
  - `/api/v1/sync/preview/{id}/apply`
  - `/api/v1/goals/apply`
  - `/api/v1/pcd/{id}/snapshots/{id}/rollback`
  - `/api/v1/trash-guide/sources/{id}/sync`
  - `/api/v1/canary/rollouts`, `/api/v1/canary/rollouts/{id}/proceed`,
    `/api/v1/canary/rollouts/{id}/abort`
- `read`: these dry-run `POST` routes, which change no Arr, PCD or settings state:
  - `/api/v1/sync/preview`
  - `/api/v1/goals/preview`
  - `/api/v1/simulate/score`, `/api/v1/simulate/impact`
  - `/api/v1/entity-testing/evaluate`
- `admin`: every other `POST`, `PUT`, `PATCH` or `DELETE`.

A token without the required scope gets status `403`:

```json
{ "error": "Forbidden", "requiredScope": "sync:apply" }
```

MCP tools also declare a required scope. Every current tool needs `mcp`.

### Legacy API key

Releases before scoped tokens had one global API key. On upgrade, that key becomes an `admin`
token named **Legacy API key**. It keeps working with the same value, but it is deprecated.
Settings → Security shows a warning while it is active, and the Security Posture page flags it.
Create scoped tokens for each integration, then revoke the legacy key.

## Auth modes and API behavior

Configured by server `AUTH` mode.

## `AUTH=on` (default)

- Full auth required
- Valid session cookie or valid API token required for protected `/api/v1/*` routes; other
  protected `/api/*` routes require a session

## `AUTH=local`

- Local-network IPs bypass auth checks
- Non-local IPs still require a session or API token

## `AUTH=off`

- Middleware bypasses auth checks entirely
- Use only behind trusted external auth/reverse proxy controls

## `AUTH=oidc`

- Uses OIDC-backed user sessions for the UI
- API tokens authenticate `/api/v1/*` requests, so headless clients (Prometheus, MCP clients,
  scripts) work without a browser session

## Setup flow interaction

- Before initial local-user setup is complete (except `AUTH=off`), app redirects to `/auth/setup`
- API integrations should be configured after setup is complete
