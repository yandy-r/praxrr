# Portable Import/Export

## Overview

Portable import/export moves PCD entities between databases using a JSON contract
that is database-ID-free and timestamp-free. Compatibility remains constrained by
supported `entityType` contracts (including family-specific types such as
`radarr_media_settings` and `sonarr_media_settings`).

Endpoints:

- `GET /api/v1/pcd/export`
- `POST /api/v1/pcd/import`

## Supported entity types

- `delay_profile`
- `regular_expression`
- `custom_format`
- `quality_profile`
- `radarr_naming`
- `sonarr_naming`
- `lidarr_naming`
- `radarr_media_settings`
- `sonarr_media_settings`
- `lidarr_media_settings`
- `radarr_quality_definitions`
- `sonarr_quality_definitions`
- `lidarr_quality_definitions`
- `lidarr_metadata_profile`

## User workflow

## 1) Export from source database

Call export with:

- `databaseId`
- `entityType`
- `name`

The response shape is:

- `entityType`
- `data` (portable payload)

## 2) Review payload

- Keep field names exactly as emitted.
- Do not mix cross-family fields (for example Radarr-namespaced fields inside `lidarr_naming`).
- Preserve `entityType` exactly.

Hybrid migration payloads may include `migration` metadata under the import request body:

```json
{
  "format": "json",
  "version": 1,
  "source": "pcd-export"
}
```

This metadata is validated by `validatePortableMigrationMetadata` and is optional for legacy compatibility.

## 3) Migration operator checks

Use these checks after any hybrid import/export operation:

```sql
SELECT h.id, h.op_id, h.status, h.rowcount, h.conflict_reason, h.error, h.details, h.applied_at
FROM pcd_op_history h
WHERE h.database_id = :databaseId
ORDER BY h.applied_at DESC, h.id DESC
LIMIT 200;
```

```sql
SELECT id, origin, state, source, filename, metadata
FROM pcd_ops
WHERE database_id = :databaseId
  AND source = 'import'
ORDER BY id DESC
LIMIT 200;
```

- `pcd_op_history` should show expected `applied` rows for the migration write and no unexpected `conflicted`/`error` rows.
- For import-driven sync changes, validate `job_queue` rows for evented sync dedupe keys:

```sql
SELECT id, job_type, status, dedupe_key, run_at
FROM job_queue
WHERE dedupe_key LIKE 'arr.sync.%:event:%'
  AND json_extract(payload, '$.instanceId') = :instanceId
ORDER BY run_at DESC;
```

## 4) Import into target database/layer

Send:

- `databaseId`
- `layer` (`user` or `base`)
- `entityType`
- `data`

If `layer=base`, write permission is required for that database context.

## 5) Validate in UI

Open the target entity page and sync configuration views to confirm the imported entity is
available for selection.

## Practical API examples

```bash
# Export one quality profile
curl -sS "http://localhost:6868/api/v1/pcd/export?databaseId=1&entityType=quality_profile&name=My%20Profile"

# Import that payload into another database
curl -sS -X POST "http://localhost:6868/api/v1/pcd/import" \
  -H "Content-Type: application/json" \
  -d '{
    "databaseId": 2,
    "layer": "user",
    "entityType": "quality_profile",
    "data": {
      "name": "My Profile",
      "description": null,
      "tags": [],
      "language": null,
      "orderedItems": [],
      "minimumScore": 0,
      "upgradeUntilScore": 0,
      "upgradeScoreIncrement": 0,
      "customFormatScores": []
    }
  }'
```

## Troubleshooting

- `Invalid entityType: ...`:
  Entity type is not in the runtime portable type enum.
- `Cannot write to base layer`:
  Use `layer: "user"` or switch to a writable base context.
- `Mixed payload for <entityType>: unsupported fields from another model: ...`:
  Payload contains fields from a different media-management app family.
- `Unsupported payload for <entityType>: missing required fields: ...`:
  Required keys for that portable app family type are missing.
- Export returns `not found`:
  `name` does not exist in the source database for that `entityType`.
- Import returns duplicate/validation errors:
  Entity with that name already exists, or payload fails portable validation.

Note:

- Runtime supports `lidarr_metadata_profile` in portable import/export. If generated OpenAPI clients
  reject it, update client schemas to match runtime contract.

## Related docs

- [Feature guides index](./README.md)
- [Link, Bridge, Sync](./link-bridge-sync.md)
- [Entity Testing](./entity-testing.md)
- [OpenAPI paths: PCD](../api/v1/paths/pcd.yaml)
- [OpenAPI schemas: PCD](../api/v1/schemas/pcd.yaml)
