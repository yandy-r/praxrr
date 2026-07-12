# Endpoint Reference (`/api/v1`)

This page is a reader-oriented companion to `docs/api/v1/openapi.yaml`.

## Conventions

- Base path: `/api/v1`
- Content type: JSON (`application/json`) unless noted
- Authentication: required for all endpoints except `GET /health`
- Error payloads: typically `{ "error": "..." }` (see `docs/api/errors.md`)

## Endpoint index

| Method | Path                                              | Purpose                               |
| ------ | ------------------------------------------------- | ------------------------------------- |
| GET    | `/health`                                         | Service/component health check        |
| GET    | `/openapi.json`                                   | Runtime OpenAPI JSON                  |
| GET    | `/ui-preferences`                                 | Read per-user section disclosure mode |
| PATCH  | `/ui-preferences`                                 | Save per-user section disclosure mode |
| GET    | `/complexity-tiers`                               | Read per-user section complexity tier |
| PATCH  | `/complexity-tiers`                               | Save per-user section complexity tier |
| GET    | `/plugins`                                        | List redacted durable plugin state    |
| POST   | `/plugins/reload`                                 | Reconcile the plugin registry         |
| GET    | `/plugins/{apiVersion}/{id}`                      | Read one durable plugin record        |
| POST   | `/plugins/{apiVersion}/{id}/enable`               | Save enabled plugin intent            |
| POST   | `/plugins/{apiVersion}/{id}/disable`              | Save disabled plugin intent           |
| POST   | `/entity-testing/evaluate`                        | Parse titles and evaluate CF matches  |
| GET    | `/arr/library`                                    | Paginated arr app library view        |
| DELETE | `/arr/library`                                    | Invalidate Arr library cache          |
| GET    | `/arr/library/episodes`                           | Sonarr-only series episode details    |
| GET    | `/arr/releases`                                   | Interactive release search            |
| POST   | `/arr/cleanup`                                    | Scan/execute stale config cleanup     |
| GET    | `/pcd/export`                                     | Export portable entity payload        |
| POST   | `/pcd/import`                                     | Import portable entity payload        |
| GET    | `/pcd/{databaseId}/lidarr-metadata-profiles`      | List metadata profiles                |
| POST   | `/pcd/{databaseId}/lidarr-metadata-profiles`      | Create metadata profile               |
| GET    | `/pcd/{databaseId}/lidarr-metadata-profiles/{id}` | Read metadata profile                 |
| PUT    | `/pcd/{databaseId}/lidarr-metadata-profiles/{id}` | Update metadata profile               |
| DELETE | `/pcd/{databaseId}/lidarr-metadata-profiles/{id}` | Delete metadata profile               |
| GET    | `/trash-guide/sources`                            | List all configured TRaSH sources     |
| POST   | `/trash-guide/sources`                            | Create a new TRaSH source             |
| GET    | `/trash-guide/sources/:id`                        | Get a specific TRaSH source           |
| PUT    | `/trash-guide/sources/:id`                        | Update a TRaSH source                 |
| DELETE | `/trash-guide/sources/:id`                        | Delete a TRaSH source                 |
| POST   | `/trash-guide/sources/:id/sync`                   | Trigger manual sync for a source      |
| GET    | `/trash-guide/sources/:id/entities`               | List cached entities for a source     |

## System

### `GET /health`

Parameters:

- `verbose` (query, optional boolean): include additional component details

Example:

```bash
curl -sS 'http://localhost:5173/api/v1/health?verbose=true' | jq
```

```json
{
  "status": "healthy",
  "timestamp": "2026-02-20T12:34:56.000Z",
  "version": "1.0.0",
  "uptime": 4212,
  "components": {
    "sqlite": { "status": "healthy", "responseTimeMs": 1.2, "migration": 63 },
    "repos": {
      "status": "healthy",
      "total": 1,
      "enabled": 1,
      "cached": 1,
      "disabled": 0
    },
    "jobs": { "status": "healthy" },
    "backups": { "status": "healthy", "enabled": true },
    "logs": { "status": "healthy" }
  }
}
```

Semantics:

- Returns `200` for `healthy` or `degraded`
- Returns `503` for `unhealthy`

### `GET /openapi.json`

Returns the parsed OpenAPI document served by the app.

```bash
curl -sS -H 'X-Api-Key: <api-key>' http://localhost:5173/api/v1/openapi.json | jq '.info'
```

## User Interface Preferences

The UI persistence endpoints store **end-user display state** for media app setup workflows.
They are intentionally scoped to section visibility (`basic` vs `advanced`) and are not part of
developer configuration or API auth token administration.

### `GET /ui-preferences`

Query params:

- `section_key` (required string): deterministic section key, e.g. `media-management:media-settings:naming`
  - must match `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$`
  - max length 96
- `strict` (optional boolean, default `false`): when `true`, missing saved state returns `404`

Response shape:

```json
{
  "section_key": "media-management:media-settings:naming",
  "mode": "basic",
  "updated_at": null,
  "persisted": false
}
```

Semantics:

- Missing row (default path) returns `mode: "basic"`, `persisted: false`, and
  `updated_at: null`.
- Unknown or malformed `section_key` returns `400`.
- `strict=true` and missing row returns `404`.

```bash
curl -sS \
  'http://localhost:5173/api/v1/ui-preferences?section_key=media-management%3Amedia-settings%3Anaming' |
  jq
```

### `PATCH /ui-preferences`

Request body:

- `section_key` (required): deterministic section key
  - must match `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$`
  - max length 96
- `mode` (required): `basic` or `advanced`
- `expected_updated_at` (optional): timestamp for optimistic concurrency

```json
{
  "section_key": "media-management:media-settings:naming",
  "mode": "advanced",
  "expected_updated_at": "2026-02-27T10:00:00.000Z"
}
```

```bash
curl -sS -X PATCH \
  -H 'X-Api-Key: <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{ "section_key": "media-management:media-settings:naming", "mode": "advanced" }' \
  http://localhost:5173/api/v1/ui-preferences | jq
```

Semantics:

- Only authenticated sessions can read/write (unauthenticated sessions receive `401`).
- Unknown/invalid keys return `400` before persistence.
- Persisted values are per-user and per-section.
- Unknown `mode` returns `400`.
- Stale `expected_updated_at` values return `409`.
- Rapid successive updates are rate-limited: more than 8 updates per section within 30s returns `429`.
- Returns the same payload shape as `GET`.

Response shape on success:

```json
{
  "section_key": "media-management:media-settings:naming",
  "mode": "advanced",
  "updated_at": "2026-02-27T10:00:00.000Z",
  "persisted": true
}
```

## Complexity Tiers

Complexity tier endpoints store a per-user, per-section tier used to choose the default
disclosure mode for progressive complexity. The saved disclosure mode from `/ui-preferences`
still wins after a user manually toggles a section.

### `GET /complexity-tiers`

Query params:

- `section_key` (required string): deterministic section key
  - must match `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$`
  - max length 96
- `strict` (optional boolean, default `false`): when `true`, missing saved state returns `404`

Response shape:

```json
{
  "section_key": "custom-formats:general:conditions",
  "tier": "beginner",
  "interaction_count": 0,
  "advanced_toggle_count": 0,
  "last_suggested_tier": null,
  "suggestion_dismissed_at": null,
  "updated_at": null,
  "persisted": false
}
```

### `PATCH /complexity-tiers`

Request body:

- `section_key` (required): deterministic section key
- `tier` (required): `beginner`, `intermediate`, or `advanced`
- `expected_updated_at` (optional): timestamp for optimistic concurrency
- `interaction_delta` (optional): bounded counter increment
- `advanced_toggle_delta` (optional): bounded counter increment
- `last_suggested_tier` (optional): `null` or a valid tier
- `suggestion_dismissed_at` (optional): `null` or datetime string

```json
{
  "section_key": "custom-formats:general:conditions",
  "tier": "advanced",
  "expected_updated_at": "2026-07-06T10:00:00.000Z"
}
```

Semantics:

- Only authenticated sessions can read/write (unauthenticated sessions receive `401`).
- API-key synthetic user id `0` returns default state and performs no DB write.
- Values are per-user and per-section.
- Unknown `tier` or malformed `section_key` returns `400`.
- Stale `expected_updated_at` values return `409`.
- Rapid successive updates are rate-limited: more than 8 updates per section within 30s returns `429`.
- Internal SQL/error details are not included in `500` responses.

## Plugin Management

The auth-gated plugin route family exposes validated, redacted durable registry state. It does not
expose local source directories, raw manifests, runtime availability, or execution telemetry.

| Method | Path                                 | Behavior                                    |
| ------ | ------------------------------------ | ------------------------------------------- |
| GET    | `/plugins`                           | List discovered and retained plugin records |
| POST   | `/plugins/reload`                    | Run serialized scan and reconciliation      |
| GET    | `/plugins/{apiVersion}/{id}`         | Read one namespace-qualified durable record |
| POST   | `/plugins/{apiVersion}/{id}/enable`  | Persist enabled administrator intent        |
| POST   | `/plugins/{apiVersion}/{id}/disable` | Persist disabled administrator intent       |

Feature-off behavior is explicit: list returns `200` with `pluginsEnabled:false` and no items;
reload returns a `200` no-op summary with zero counters; detail and enable/disable return `409`.
None of those paths scans or changes durable state while `PLUGINS_ENABLED` is off.

Browser enable, disable, and reload requests must be exact same-origin. Malformed, foreign, or
explicit cross-site browser requests receive an empty `403` before identity validation, scanning,
or mutation. Authenticated non-browser clients may omit `Origin`; this does not bypass
authentication or add CORS support. Read routes do not apply the mutation Origin guard.

See the [generated OpenAPI source](./v1/openapi.yaml) for response schemas, the
[Plugin Management guide](../features/plugin-management.md) for operator workflows, and the
[Plugin System Architecture](../architecture/plugins.md) for registry and security boundaries.

## Entity Testing

### `POST /entity-testing/evaluate`

Request fields:

- `databaseId` (optional integer): required only for CF evaluation
- `releases` (required array): `{ id, title, type }`
- `type` is `movie` (Radarr titles) or `series` (Sonarr titles)

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: <api-key>' \
  -d '{
    "databaseId": 1,
    "releases": [
      { "id": 101, "title": "Movie.Title.2024.2160p.WEB-DL", "type": "movie" }
    ]
  }' \
  http://localhost:5173/api/v1/entity-testing/evaluate | jq
```

```json
{
  "parserAvailable": true,
  "evaluations": [
    {
      "releaseId": 101,
      "title": "Movie.Title.2024.2160p.WEB-DL",
      "parsed": {
        "source": "webdl",
        "resolution": "2160p",
        "modifier": "none",
        "languages": ["english"],
        "year": 2024
      },
      "cfMatches": {
        "UHD": true,
        "WEB": true
      }
    }
  ]
}
```

Semantics:

- Missing/empty `releases` returns `400`
- If parser service is unavailable, returns `200` with `parserAvailable: false`
- If `databaseId` is omitted, endpoint does parse-only (empty `cfMatches`)

## Arr

### `GET /arr/library`

- Behavior applies to the selected arr app instance (`instanceId`), unless an endpoint/parameter
  explicitly notes Sonarr-only constraints.

Parameters:

- `instanceId` (required integer)
- `page` (optional integer, default `1`)
- `pageSize` (optional integer, default `100`, max `250`)
- `sortKey` (optional string, validated per Arr type)
- `sortDirection` (optional `asc` or `desc`, default `asc`)
- `query` (optional string, case-insensitive filter)

Sort keys by app type:

- `radarr`: `id`, `title`, `year`, `qualityProfileName`, `qualityName`, `qualityScore`,
  `customFormatScore`, `progress`, `popularity`, `dateAdded`
- `sonarr`: `id`, `title`, `year`, `qualityProfileName`, `status`, `percentOfEpisodes`,
  `episodeCount`, `seasonCount`, `dateAdded`
- `lidarr`: `id`, `title`, `artistName`, `year`, `qualityProfileName`, `status`, `percentOfTracks`,
  `trackCount`, `dateAdded`

```bash
curl -sS \
  -H 'X-Api-Key: <api-key>' \
  'http://localhost:5173/api/v1/arr/library?instanceId=1&page=1&pageSize=2&sortKey=title&sortDirection=asc' | jq
```

```json
{
  "type": "radarr",
  "items": [{ "id": 1, "title": "A Movie", "qualityProfileName": "Default" }],
  "profilesByDatabase": [
    { "databaseId": 1, "databaseName": "Praxrr-DB", "profiles": ["Default"] }
  ],
  "page": 1,
  "pageSize": 2,
  "totalRecords": 245,
  "totalPages": 123,
  "hasNext": true
}
```

### `DELETE /arr/library`

Parameters:

- `instanceId` (required integer)

```bash
curl -sS -X DELETE \
  -H 'X-Api-Key: <api-key>' \
  'http://localhost:5173/api/v1/arr/library?instanceId=1' | jq
```

```json
{ "success": true }
```

### `GET /arr/library/episodes`

Parameters:

- `instanceId` (required integer, must be a Sonarr instance)
- `seriesId` (required integer, Sonarr series ID)

```bash
curl -sS \
  -H 'X-Api-Key: <api-key>' \
  'http://localhost:5173/api/v1/arr/library/episodes?instanceId=2&seriesId=123' | jq
```

```json
{
  "episodes": [
    {
      "id": 1001,
      "seasonNumber": 1,
      "episodeNumber": 1,
      "title": "Pilot",
      "hasFile": true,
      "customFormatScore": 1200,
      "cutoffMet": true
    }
  ]
}
```

### `GET /arr/releases`

Parameters:

- `instanceId` (required integer)
- `itemId` (required integer)
- `season` (optional integer, Sonarr only, defaults to `1`; invalid values fall back to `1`)

```bash
curl -sS \
  -H 'X-Api-Key: <api-key>' \
  'http://localhost:5173/api/v1/arr/releases?instanceId=1&itemId=12345' | jq
```

```json
{
  "type": "radarr",
  "rawCount": 18,
  "releases": [
    {
      "title": "Movie.Title.2024.2160p.WEB-DL",
      "size": 12934823984,
      "languages": ["english"],
      "indexers": ["IndexerA", "IndexerB"],
      "flags": ["freeleech"]
    }
  ]
}
```

### `POST /arr/cleanup`

Request variants:

- Scan: `{ "instanceId": 1, "action": "scan" }`
- Execute: `{ "instanceId": 1, "action": "execute", "scanResult": { ... } }`

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: <api-key>' \
  -d '{ "instanceId": 1, "action": "scan" }' \
  http://localhost:5173/api/v1/arr/cleanup | jq
```

```json
{
  "staleCustomFormats": [
    { "id": 14, "name": "My CF [ns]", "strippedName": "My CF" }
  ],
  "staleQualityProfiles": []
}
```

## PCD Portable Import/Export

### `GET /pcd/export`

Parameters:

- `databaseId` (required integer)
- `entityType` (required enum from OpenAPI `EntityType`)
- `name` (required string)

```bash
curl -sS \
  -H 'X-Api-Key: <api-key>' \
  'http://localhost:5173/api/v1/pcd/export?databaseId=1&entityType=quality_profile&name=Default' | jq
```

```json
{
  "entityType": "quality_profile",
  "data": {
    "name": "Default",
    "description": null
  }
}
```

### `POST /pcd/import`

Request fields:

- `databaseId` (required integer)
- `layer` (required: `user` or `base`)
- `entityType` (required enum from OpenAPI `EntityType`)
- `data` (required object matching the portable schema for `entityType`)

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: <api-key>' \
  -d '{
    "databaseId": 1,
    "layer": "user",
    "entityType": "regular_expression",
    "data": {
      "name": "x265",
      "pattern": "x265",
      "tags": [],
      "description": null,
      "regex101Id": null
    }
  }' \
  http://localhost:5173/api/v1/pcd/import | jq
```

```json
{ "success": true }
```

## PCD Lidarr Metadata Profiles

### `GET /pcd/{databaseId}/lidarr-metadata-profiles`

Path params:

- `databaseId` (required integer)

Returns list items with counts and `updated_at`.

### `POST /pcd/{databaseId}/lidarr-metadata-profiles`

Path params:

- `databaseId` (required integer)

Request fields:

- `layer` (optional `user` or `base`, defaults to `user`)
- `name` (required, non-empty, case-insensitive unique, cannot be `None`)
- `description` (optional string or `null`)
- `primaryTypes`, `secondaryTypes`, `releaseStatuses` (required arrays of `{ id, name, allowed }`)
- Each section must contain at least one `allowed: true`

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: <api-key>' \
  -d '{
    "layer": "user",
    "name": "Albums + EPs",
    "description": "Preferred profile",
    "primaryTypes": [{ "id": 1, "name": "Album", "allowed": true }],
    "secondaryTypes": [{ "id": 2, "name": "EP", "allowed": true }],
    "releaseStatuses": [{ "id": 1, "name": "Official", "allowed": true }]
  }' \
  http://localhost:5173/api/v1/pcd/1/lidarr-metadata-profiles | jq
```

```json
{ "success": true }
```

### `GET /pcd/{databaseId}/lidarr-metadata-profiles/{id}`

Path params:

- `databaseId` (required integer)
- `id` (required integer)

Returns detail payload including `primaryTypes`, `secondaryTypes`, and `releaseStatuses`.

### `PUT /pcd/{databaseId}/lidarr-metadata-profiles/{id}`

Path params:

- `databaseId` (required integer)
- `id` (required integer)

Request fields:

- `layer` (optional `user` or `base`, defaults to `user`)
- Any mutable subset of `name`, `description`, `primaryTypes`, `secondaryTypes`, `releaseStatuses`
- At least one mutable field must be provided
- Final merged profile must still have at least one allowed entry per section

```bash
curl -sS -X PUT \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: <api-key>' \
  -d '{ "description": "Updated description" }' \
  http://localhost:5173/api/v1/pcd/1/lidarr-metadata-profiles/12 | jq
```

```json
{ "success": true }
```

### `DELETE /pcd/{databaseId}/lidarr-metadata-profiles/{id}`

Path params:

- `databaseId` (required integer)
- `id` (required integer)

Request fields:

- `layer` (optional `user` or `base`, defaults to `user`)
- `name` (required, must match current row name for value-guard safety)

```bash
curl -sS -X DELETE \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: <api-key>' \
  -d '{ "name": "Albums + EPs" }' \
  http://localhost:5173/api/v1/pcd/1/lidarr-metadata-profiles/12 | jq
```

```json
{ "success": true }
```

## TRaSH Guide Sources

### `GET /trash-guide/sources`

Returns all configured TRaSH guide sources.

```bash
curl -sS \
  -H 'X-Api-Key: <api-key>' \
  http://localhost:5173/api/v1/trash-guide/sources | jq
```

```json
{
  "sources": [
    {
      "id": 1,
      "name": "TRaSH Radarr",
      "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
      "branch": "master",
      "arrType": "radarr",
      "scoreProfile": "default",
      "autoPull": true,
      "enabled": true,
      "syncStrategy": 360,
      "lastSyncedAt": "2026-02-27T10:00:00Z",
      "lastCommitHash": "abc123def456",
      "entityCounts": {
        "customFormats": 150,
        "qualityProfiles": 12,
        "qualitySizes": 3,
        "naming": 2
      }
    }
  ]
}
```

### `POST /trash-guide/sources`

Create a new TRaSH guide source.

Request fields:

- `name` (required string, case-insensitive unique)
- `repositoryUrl` (required string)
- `arrType` (required string: `radarr` or `sonarr`)
- `branch` (optional string, default `master`)
- `scoreProfile` (optional string)
- `autoPull` (optional boolean)
- `enabled` (optional boolean)
- `syncStrategy` (optional integer, sync interval in minutes)

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: <api-key>' \
  -d '{
    "name": "TRaSH Radarr",
    "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
    "arrType": "radarr",
    "branch": "master",
    "scoreProfile": "default",
    "autoPull": true,
    "enabled": true,
    "syncStrategy": 360
  }' \
  http://localhost:5173/api/v1/trash-guide/sources | jq
```

```json
{
  "source": {
    "id": 1,
    "name": "TRaSH Radarr",
    "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
    "branch": "master",
    "arrType": "radarr",
    "scoreProfile": "default",
    "autoPull": true,
    "enabled": true,
    "syncStrategy": 360,
    "lastSyncedAt": null,
    "lastCommitHash": null,
    "entityCounts": {
      "customFormats": 0,
      "qualityProfiles": 0,
      "qualitySizes": 0,
      "naming": 0
    }
  }
}
```

Semantics:

- Returns `201` on success
- Returns `409` if a source with the same name or repository URL already exists
- Returns `422` for validation errors (invalid `arrType`, malformed URL)
- Returns `502` for retryable git/network errors during initial clone

### `GET /trash-guide/sources/:id`

Path params:

- `id` (required integer)

Returns the full source object.

```bash
curl -sS \
  -H 'X-Api-Key: <api-key>' \
  http://localhost:5173/api/v1/trash-guide/sources/1 | jq
```

```json
{
  "source": {
    "id": 1,
    "name": "TRaSH Radarr",
    "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
    "branch": "master",
    "arrType": "radarr",
    "scoreProfile": "default",
    "autoPull": true,
    "enabled": true,
    "syncStrategy": 360,
    "lastSyncedAt": "2026-02-27T10:00:00Z",
    "lastCommitHash": "abc123def456",
    "entityCounts": {
      "customFormats": 150,
      "qualityProfiles": 12,
      "qualitySizes": 3,
      "naming": 2
    }
  }
}
```

Semantics:

- Returns `404` if the source does not exist

### `PUT /trash-guide/sources/:id`

Update a TRaSH guide source. At least one mutable field must be provided.

Path params:

- `id` (required integer)

Request fields (all optional, at least one required):

- `name` (string, case-insensitive unique)
- `repositoryUrl` (string)
- `branch` (string)
- `scoreProfile` (string)
- `autoPull` (boolean)
- `enabled` (boolean)
- `syncStrategy` (integer, sync interval in minutes)

Note: `arrType` cannot be changed after creation.

```bash
curl -sS -X PUT \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: <api-key>' \
  -d '{
    "scoreProfile": "anime",
    "syncStrategy": 720
  }' \
  http://localhost:5173/api/v1/trash-guide/sources/1 | jq
```

```json
{
  "source": {
    "id": 1,
    "name": "TRaSH Radarr",
    "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
    "branch": "master",
    "arrType": "radarr",
    "scoreProfile": "anime",
    "autoPull": true,
    "enabled": true,
    "syncStrategy": 720,
    "lastSyncedAt": "2026-02-27T10:00:00Z",
    "lastCommitHash": "abc123def456",
    "entityCounts": {
      "customFormats": 150,
      "qualityProfiles": 12,
      "qualitySizes": 3,
      "naming": 2
    }
  }
}
```

Semantics:

- Returns `200` on success
- Returns `400` if no mutable fields are provided or `arrType` change is attempted
- Returns `404` if the source does not exist
- Returns `409` if updated name or repository URL conflicts with another source
- Returns `422` for validation errors

### `DELETE /trash-guide/sources/:id`

Path params:

- `id` (required integer)

```bash
curl -sS -X DELETE \
  -H 'X-Api-Key: <api-key>' \
  http://localhost:5173/api/v1/trash-guide/sources/1
```

Semantics:

- Returns `204` with no body on success
- Returns `404` if the source does not exist

### `POST /trash-guide/sources/:id/sync`

Trigger a manual sync for a TRaSH guide source. No request body required.

Path params:

- `id` (required integer)

```bash
curl -sS -X POST \
  -H 'X-Api-Key: <api-key>' \
  http://localhost:5173/api/v1/trash-guide/sources/1/sync | jq
```

```json
{
  "success": true,
  "queued": true,
  "job": {
    "id": "trash-sync-1-1709035200",
    "type": "trash-guide-sync",
    "sourceId": 1,
    "status": "queued"
  }
}
```

Semantics:

- Returns `200` when sync job is queued
- Returns `404` if the source does not exist
- Returns `409` if a sync is already running for this source

### `GET /trash-guide/sources/:id/entities`

List cached entities imported from a TRaSH guide source.

Path params:

- `id` (required integer)

```bash
curl -sS \
  -H 'X-Api-Key: <api-key>' \
  http://localhost:5173/api/v1/trash-guide/sources/1/entities | jq
```

```json
{
  "sourceId": 1,
  "entities": {
    "customFormats": [
      { "name": "Repack/Proper", "trashId": "eb725d39...", "score": 5 },
      { "name": "x265 (HD)", "trashId": "dc98083d...", "score": -10000 }
    ],
    "qualityProfiles": [{ "name": "SQP-1 (2160p)", "trashId": "a3d12b45..." }],
    "qualitySizes": [{ "name": "Movie", "trashId": "c7e8f901..." }],
    "naming": [{ "name": "Radarr Recommended", "trashId": "f1a2b3c4..." }]
  }
}
```

Semantics:

- Returns `404` if the source does not exist

### TRaSH Guide Sources Error Reference

| Code | Cause                                                          |
| ---- | -------------------------------------------------------------- |
| 400  | Invalid request body, missing required fields, bad JSON        |
| 404  | Source ID does not exist                                       |
| 409  | Name or repository URL conflicts with existing source          |
| 409  | Sync already running for the requested source (on `/sync`)     |
| 422  | Validation error (invalid `arrType`, transform/schema failure) |
| 502  | Retryable git clone/pull or network error                      |

## Related

- Authentication details: `docs/api/authentication.md`
- Error semantics: `docs/api/errors.md`
