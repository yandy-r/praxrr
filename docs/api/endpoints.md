# Endpoint Reference (`/api/v1`)

This page is a reader-oriented companion to `docs/api/v1/openapi.yaml`.

## Conventions

- Base path: `/api/v1`
- Content type: JSON (`application/json`) unless noted
- Authentication: required for all endpoints except `GET /health`
- Error payloads: typically `{ "error": "..." }` (see `docs/api/errors.md`)

## Endpoint index

| Method | Path                                              | Purpose                              |
| ------ | ------------------------------------------------- | ------------------------------------ |
| GET    | `/health`                                         | Service/component health check       |
| GET    | `/openapi.json`                                   | Runtime OpenAPI JSON                 |
| POST   | `/entity-testing/evaluate`                        | Parse titles and evaluate CF matches |
| GET    | `/arr/library`                                    | Paginated Arr library view           |
| DELETE | `/arr/library`                                    | Invalidate Arr library cache         |
| GET    | `/arr/library/episodes`                           | Sonarr series episode details        |
| GET    | `/arr/releases`                                   | Interactive release search           |
| POST   | `/arr/cleanup`                                    | Scan/execute stale config cleanup    |
| GET    | `/pcd/export`                                     | Export portable entity payload       |
| POST   | `/pcd/import`                                     | Import portable entity payload       |
| GET    | `/pcd/{databaseId}/lidarr-metadata-profiles`      | List metadata profiles               |
| POST   | `/pcd/{databaseId}/lidarr-metadata-profiles`      | Create metadata profile              |
| GET    | `/pcd/{databaseId}/lidarr-metadata-profiles/{id}` | Read metadata profile                |
| PUT    | `/pcd/{databaseId}/lidarr-metadata-profiles/{id}` | Update metadata profile              |
| DELETE | `/pcd/{databaseId}/lidarr-metadata-profiles/{id}` | Delete metadata profile              |

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
    "repos": { "status": "healthy", "total": 1, "enabled": 1, "cached": 1, "disabled": 0 },
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

## Entity Testing

### `POST /entity-testing/evaluate`

Request fields:

- `databaseId` (optional integer): required only for CF evaluation
- `releases` (required array): `{ id, title, type }`
- `type` is `movie` or `series`

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

Parameters:

- `instanceId` (required integer)
- `page` (optional integer, default `1`)
- `pageSize` (optional integer, default `100`, max `250`)
- `sortKey` (optional string, validated per Arr type)
- `sortDirection` (optional `asc` or `desc`, default `asc`)
- `query` (optional string, case-insensitive filter)

Sort keys by Arr type:

- `radarr`: `id`, `title`, `year`, `qualityProfileName`, `qualityName`, `qualityScore`, `customFormatScore`, `progress`, `popularity`, `dateAdded`
- `sonarr`: `id`, `title`, `year`, `qualityProfileName`, `status`, `percentOfEpisodes`, `episodeCount`, `seasonCount`, `dateAdded`
- `lidarr`: `id`, `title`, `artistName`, `year`, `qualityProfileName`, `status`, `percentOfTracks`, `trackCount`, `dateAdded`

```bash
curl -sS \
  -H 'X-Api-Key: <api-key>' \
  'http://localhost:5173/api/v1/arr/library?instanceId=1&page=1&pageSize=2&sortKey=title&sortDirection=asc' | jq
```

```json
{
  "type": "radarr",
  "items": [{ "id": 1, "title": "A Movie", "qualityProfileName": "Default" }],
  "profilesByDatabase": [{ "databaseId": 1, "databaseName": "Praxrr-DB", "profiles": ["Default"] }],
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
  "staleCustomFormats": [{ "id": 14, "name": "My CF [ns]", "strippedName": "My CF" }],
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

## Related

- Authentication details: `docs/api/authentication.md`
- Error semantics: `docs/api/errors.md`
