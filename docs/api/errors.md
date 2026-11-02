# Error Semantics

This page consolidates API error behavior from:

- `docs/api/v1/openapi.yaml`
- `packages/praxrr-app/src/routes/api/v1/**`
- global API auth middleware in `packages/praxrr-app/src/hooks.server.ts`

## Common error shape

Most `/api/v1` handlers return:

```json
{ "error": "Human-readable message" }
```

## Authentication error

Protected endpoints return middleware-level `401` when auth is missing/invalid:

```json
{ "error": "Unauthorized" }
```

Notes:

- `GET /api/v1/health` is public
- Other `/api/v1/*` endpoints are protected unless auth is bypassed by mode (`AUTH=off`, or `AUTH=local` for local IPs)

## Status code semantics by area

| Area                         | Status | Semantics                                                                              |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Auth middleware              | `401`  | Missing or invalid auth for protected API route                                        |
| Health                       | `200`  | Overall status is `healthy` or `degraded`                                              |
| Health                       | `503`  | Overall status is `unhealthy`                                                          |
| Entity testing               | `400`  | Invalid request body (for example missing/empty `releases`)                            |
| Entity testing               | `404`  | `databaseId` cache not found                                                           |
| Arr library/releases/cleanup | `400`  | Invalid query/body values or unsupported instance/type-specific input                  |
| Arr library/releases/cleanup | `404`  | Arr instance not found                                                                 |
| Arr library/releases/cleanup | `500`  | Fixed message plus `code`; raw Arr text is logged server-side only                     |
| PCD export                   | `400`  | Missing/invalid query params or unsupported `entityType`                               |
| PCD export                   | `404`  | Requested entity not found                                                             |
| PCD export                   | `500`  | Database cache unavailable                                                             |
| PCD import                   | `400`  | Validation failure, invalid JSON/body, invalid data shape                              |
| PCD import                   | `403`  | Attempt to write base layer without required base-write authorization                  |
| PCD import                   | `500`  | Database cache unavailable                                                             |
| Lidarr metadata profiles     | `400`  | Validation failure, invalid path/body params, unsupported schema, value guard mismatch |
| Lidarr metadata profiles     | `403`  | Base-layer write requested without authorization                                       |
| Lidarr metadata profiles     | `404`  | Database/profile not found                                                             |
| Lidarr metadata profiles     | `500`  | Unexpected runtime/storage failure                                                     |
| Startup pull                 | `404`  | No startup pull runs exist                                                             |
| Startup pull                 | `500`  | Unexpected runtime/storage failure                                                     |

## Example errors

Invalid query parameter:

```json
{ "error": "Invalid instanceId" }
```

Missing required field:

```json
{ "error": "Missing required fields: databaseId, layer, entityType, data" }
```

Forbidden base-layer write:

```json
{ "error": "Cannot write to base layer" }
```

Metadata profile guard failure:

```json
{ "error": "Profile name does not match the selected profile" }
```

## Arr failures

Library, episode, release, and cleanup `500` responses use a fixed `error` string and a
`code`. They do not include the Arr response body.

| Route                              | `code`                  | `error`                                                               |
| ---------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| `GET /api/v1/arr/library`          | `library_fetch_failed`  | `Failed to fetch library. Check the server logs for details.`         |
| `GET /api/v1/arr/library/episodes` | `episodes_fetch_failed` | `Failed to fetch episode details. Check the server logs for details.` |
| `GET /api/v1/arr/releases`         | `releases_fetch_failed` | `Failed to fetch releases. Check the server logs for details.`        |
| `POST /api/v1/arr/cleanup`         | `cleanup_failed`        | `Cleanup failed. Check the server logs for details.`                  |

Cleanup item reasons are a closed set. Examples: `Profile is assigned to media`,
`No longer stale; not deleted`, `The Arr instance rejected the request (HTTP 400).`,
`The delete failed unexpectedly.`

Sync history `error` (and per-section `error`) is a closed reason or a static writer
label. Text outside that set, including rows stored before this change, is rewritten to
`Sync failed. Check the server logs for details.` HTTP failures use
`Could not reach the Arr instance.`, `The Arr instance timed out.`,
`The Arr instance rejected the request (HTTP <status>).`, or
`The Arr instance returned an error (HTTP <status>).` `errorCode` is `unreachable`,
`timeout`, `rejected`, `serverError`, or `internal`. Arr authorization and not-found
writes are both `rejected`. Migration `20261028` scrubs `sync_history.error`,
`sync_history.section_results`, and `last_error` on the Arr sync config tables and
`trash_guide_sync_config`. Reads apply the same filter.

Arr sync page actions that fail unexpectedly return a fixed message such as
`Failed to queue the sync. Check the server logs for details.` The exception text
stays in the server log.

## Health endpoint special case

`GET /api/v1/health` does not use the common `{ "error": ... }` format for unhealthy state.
Instead, it returns a full health payload with HTTP `503`.
