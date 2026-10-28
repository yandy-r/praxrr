# Portable Import/Export

## Overview

Portable import/export moves PCD entities between databases using a JSON contract
that is database-ID-free and timestamp-free. Compatibility remains constrained by
supported `entityType` contracts (including family-specific types such as
`radarr_media_settings` and `sonarr_media_settings`).

The same two endpoints carry two payload forms:

- **Single entity**: `{ entityType, data }`. One entity, without its dependencies.
- **Entity bundle**: `{ version: 1, entities: [{ entityType, data }, ...] }`. Several entities,
  optionally with the custom formats and regular expressions they reference. A bundle import
  has a dry run and collision policies, and is applied all-or-nothing.

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

## UI workflow

### List-page row actions

Each entity list page (custom formats, quality profiles, regular expressions, delay profiles,
naming, media settings, quality definitions, metadata profiles) has these row actions:

- **Download bundle**: saves the entity and its dependencies as `<entityType>-<name>.json`
  (an export with `includeDependencies=true&format=bundle`). The download is refused if the
  bundle would not fit within the 5 MiB import limit.
- **Copy to database…**: opens a dialog where you pick another enabled database. It then runs
  the same dry run and apply steps as the Import tab against that database, and closes after a
  successful apply.
- **Copy JSON to clipboard**: copies the single-entity export (`entityType`, `data`,
  `migration`) without dependencies.

**Clone** still copies an entity within the same database under a new name.

### Import tab

Open **Databases → {database} → Import**.

1. Paste the bundle JSON, or upload a `.json` file of up to 5 MiB. The page shows the bundle
   version and how many entities of each type it contains.
2. Choose the **Layer** and the **Default collision policy**. **Base** is offered only when the
   database has a personal access token and local ops disabled.
3. Select **Dry run**. The preview lists each entity's type, its name and final name, and the
   planned action. Each row has a select for overriding the collision policy.
4. Select **Apply bundle**. The button is enabled only when a dry run of the current settings
   reported no errors and no missing references. Changing any input requires a new dry run. If
   the database changed after the dry run, the page asks you to run another one.

## Single-entity API workflow

### 1) Export from source database

Call export with:

- `databaseId`
- `entityType`
- `name` (exactly one)

The response shape is:

- `entityType`
- `data` (portable payload)
- `migration` (`{ "source": "pcd-export", "format": "json", "version": 1 }`)

### 2) Review payload

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

### 3) Migration operator checks

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

### 4) Import into target database/layer

Send:

- `databaseId`
- `layer` (`user` or `base`)
- `entityType`
- `data`

If `layer=base`, write permission is required for that database context. An entity whose name
already exists (case-insensitive) is rejected with `400`; use a bundle import for collision
handling.

### 5) Validate in UI

Open the target entity page and sync configuration views to confirm the imported entity is
available for selection.

## Entity bundle API

### Bundle export

`GET /api/v1/pcd/export` parameters:

- `databaseId`, `entityType` (required).
- `name` (required, repeatable): `?name=A&name=B` exports several entities of one `entityType`.
  Repeated names (case-insensitive) are exported once.
- `includeDependencies` (`true` or `false`, default `false`): also exports the custom formats a
  quality profile scores and the regular expressions a custom format's pattern conditions use.
  The walk is transitive. Other entity types have no dependencies.
- `format` (`json` or `bundle`, default `json`): `bundle` forces the bundle shape.

The legacy `{ entityType, data, migration }` shape is returned only when there is exactly one
`name`, `includeDependencies` is not `true`, and `format` is `json`. Every other request returns
`{ bundle, missingReferences? }`:

- `bundle.entities` is ordered dependency-first: regular expressions, then custom formats, then
  quality profiles, then all other types.
- `missingReferences` lists dependencies that an exported entity references but the source
  database does not contain. Each entry has `fromType`, `fromName`, `toType` and `toName`. The
  field is omitted when the list is empty, and the bundle is returned either way.
- A bundle holds at most 1000 entities. A larger request returns `400`.
- If the dependency walk reaches 1000 entities, the request returns `400`
  (`Bundle export truncated: ...`) rather than a partial bundle.
- A named entity that does not exist returns `404`.

### Bundle import

When the `POST /api/v1/pcd/import` body has a `bundle` key, the request is a bundle import and
`entityType`/`data` are ignored.

| Field                | Required | Notes                                                                                       |
| -------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `databaseId`         | yes      | Integer target database                                                                     |
| `layer`              | yes      | `user` or `base`. Every entity is written to this one layer as a single undo unit           |
| `bundle`             | yes      | `version: 1`, 1–1000 entities, no duplicate `entityType` + name (case-insensitive)          |
| `dryRun`             | no       | Default `false`                                                                             |
| `collisions`         | no       | `{ "default": <policy>, "perEntity": { "<entityType>:<name>": <policy> } }`, default `skip` |
| `expectedPlanDigest` | no       | `planDigest` from the dry run. A mismatch returns `409`                                     |

Every entry's `data` must pass the same portable validation as a single-entity import. The
request body, bundle or single-entity, is limited to 5 MiB.

#### Collision policies

A collision is an entity of the same `entityType` in the target database whose name matches
case-insensitively. A `perEntity` key such as `"custom_format:x265"` (name matched
case-insensitively) takes precedence over `default`.

- `skip`: the existing entity is left untouched. Bundle references to it resolve to the existing
  entity.
- `rename`: the entity is imported as `<name> (2)`, `<name> (3)`, and so on, using the first name
  that is not taken in the target database or by another renamed bundle entry. References to it
  from other bundle entries (quality profile scores, custom format patterns) are rewritten to the
  new name.
- `overwrite`: the existing entity is updated in place with value-guarded update ops, never
  deleted and recreated. It keeps its stored name.

#### References

Each quality profile score must name a custom format, and each custom format pattern condition
must name a regular expression. The name must be found either in the bundle (under its final
name) or in the target database, where it is matched case-insensitively and rewritten to the
stored casing. References from entries that are skipped are not checked.

#### Report

A bundle import returns `{ planDigest, dryRun, applied, outcomes, missingReferences, errors }`,
plus `rolledBack` after a failed apply. Each outcome has `entityType`, `name`, `finalName`,
`action` (`create`, `skip`, `rename`, `overwrite` or `error`) and, for failures, `error`.

- **Dry run** (`dryRun: true`): the whole plan runs against a throwaway cache, and the response
  is `200` with the report, including any errors or missing references. Nothing is written to
  `pcd_ops` or `pcd_op_history`.
- **Apply**: the plan is dry-run again first. If there are missing references or entity errors,
  the response is `400` with `{ error, report, missingReferences }` and nothing is written. A
  successful apply returns `200` with `applied: true`.
- **Plan digest**: `planDigest` is computed from the planned outcomes and the database's current
  ops. Send it back as `expectedPlanDigest` together with the same bundle and `collisions`. If
  any op changed in the meantime, the response is `409` with `{ error, report }`, and you need to
  run a new dry run.
- **Rollback**: if the apply fails partway, every op the import created is deleted, any user ops
  it superseded are restored, and the cache is rebuilt. The response is `500` with
  `{ error, report, rolledBack }`. `rolledBack` is `true` only when the ops were restored and the
  cache was rebuilt. Otherwise the error contains `rollback was incomplete` and `rolledBack` is
  `false`. If the ops could not be restored or the cache could not be rebuilt, the database is also
  disabled.
- **Base layer**: `layer: "base"` returns `403` when the database has no personal access token or
  has local ops enabled.

Bundle imports into the same database run one at a time.

## Practical API examples

```bash
# Export one quality profile (legacy single-entity shape)
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

Bundle export, dry run, and apply (requires `jq`):

```bash
# 1. Export a quality profile with its custom formats and regular expressions
curl -sS -G "http://localhost:6868/api/v1/pcd/export" \
  --data-urlencode "databaseId=1" \
  --data-urlencode "entityType=quality_profile" \
  --data-urlencode "name=My Profile" \
  --data-urlencode "includeDependencies=true" \
  -o export.json

# 2. Dry run into database 2: skip existing entities, but rename the colliding custom format
jq '{databaseId: 2, layer: "user", dryRun: true,
     collisions: {default: "skip", perEntity: {"custom_format:x265": "rename"}},
     bundle: .bundle}' export.json |
  curl -sS -X POST "http://localhost:6868/api/v1/pcd/import" \
    -H "Content-Type: application/json" --data-binary @- |
  tee plan.json | jq '{planDigest, outcomes, missingReferences, errors}'

# 3. Apply the same plan; returns 409 if database 2 changed since the dry run
jq --slurpfile plan plan.json '{databaseId: 2, layer: "user",
     collisions: {default: "skip", perEntity: {"custom_format:x265": "rename"}},
     expectedPlanDigest: $plan[0].planDigest, bundle: .bundle}' export.json |
  curl -sS -X POST "http://localhost:6868/api/v1/pcd/import" \
    -H "Content-Type: application/json" --data-binary @- | jq
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
- `Bundle would contain N entities; the maximum is 1000` or `Bundle export truncated: ...`:
  Export fewer names per request, or export without `includeDependencies`.
- `Bundle request exceeds the 5242880 byte limit`:
  The import body is larger than 5 MiB. Split the bundle.
- `bundle.entities[i] duplicates <entityType> "<name>"`:
  The bundle lists the same entity twice. Names are compared case-insensitively.
- `Bundle references entities that exist neither in the bundle nor in the target database`:
  Re-export with `includeDependencies=true`, or import the listed `missingReferences` first.
- `Bundle import failed validation; nothing was written`:
  See `report.errors` and the outcome rows with `action: "error"`.
- `409` `The import plan no longer matches the database; run a new dry run`:
  The target database changed after the dry run, or `collisions` differ from the dry run.
- `500` with `rolledBack: true`:
  The apply failed and was undone. If `rolledBack` is `false`, check the database state (and
  whether it was disabled) before retrying.

Note:

- Runtime supports `lidarr_metadata_profile` in portable import/export. If generated OpenAPI clients
  reject it, update client schemas to match runtime contract.

## Related docs

- [Feature guides index](./README.md)
- [Link, Bridge, Sync](./link-bridge-sync.md)
- [Local Overrides](./local-overrides.md)
- [Entity Testing](./entity-testing.md)
- [Endpoint reference](../api/endpoints.md)
- [OpenAPI paths: PCD](../api/v1/paths/pcd.yaml)
- [OpenAPI schemas: PCD](../api/v1/schemas/pcd.yaml)
