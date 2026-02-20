# Authentication

This document describes how API requests are authenticated by runtime middleware.

Source files:

- `packages/praxrr-app/src/hooks.server.ts`
- `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`

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

## 2. API key (AUTH=on mode)

Middleware accepts API key in either:

- Header: `X-Api-Key: <key>`
- Query parameter: `?apikey=<key>`

Recommended:

- Use `X-Api-Key` header
- Avoid query-parameter auth in shared logs/history

Example:

```bash
curl -sS \
  -H 'X-Api-Key: <api-key>' \
  http://localhost:5173/api/v1/arr/releases?instanceId=1\&itemId=10 | jq
```

## Auth modes and API behavior

Configured by server `AUTH` mode.

## `AUTH=on` (default)

- Full auth required
- Valid session cookie or valid API key required for protected `/api/*` routes

## `AUTH=local`

- Local-network IPs bypass auth checks
- Non-local IPs still require session/API key

## `AUTH=off`

- Middleware bypasses auth checks entirely
- Use only behind trusted external auth/reverse proxy controls

## `AUTH=oidc`

- Uses OIDC-backed user sessions
- API key shortcut is not used in this mode
- Protected routes require valid session cookie

## Setup flow interaction

- Before initial local-user setup is complete (except `AUTH=off`), app redirects to `/auth/setup`
- API integrations should be configured after setup is complete
