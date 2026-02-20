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
| Arr library/releases/cleanup | `500`  | Upstream Arr or runtime failure                                                        |
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

## Health endpoint special case

`GET /api/v1/health` does not use the common `{ "error": ... }` format for unhealthy state.
Instead, it returns a full health payload with HTTP `503`.
