# Feature Spec: PCD State Snapshots

## Executive Summary

PCD State Snapshots provide low-cost restore markers for Praxrr databases by recording metadata
boundaries in `pcd_ops` rather than copying full state. The feature introduces:

- `pcd_snapshots` storage in app DB
- auto-snapshot capture before risky operations (`pull`, `sync`)
- manual snapshot CRUD API under `/api/v1/pcd/{databaseId}/snapshots`

The output is the foundation for rollback work in Issue #16.

## Scope

### In Scope (MVP)

- Persist snapshot metadata per PCD database
- Auto-snapshot before pull and before Arr sync execution
- Manual create/list/detail/delete API endpoints
- Inline retention + deduplication for auto snapshots
- OpenAPI contract updates

### Out of Scope (MVP)

- Restore execution endpoint and workflow
- Diff/compare snapshot UI
- Snapshot retention settings UI
- Export/import snapshot bundles

## Business Requirements

1. Every pull-risk and Arr-sync-risk flow must attempt auto-snapshot creation before mutation.
2. Snapshot writes must not block sync/pull execution on failure.
3. Snapshot data must be per-database and cascade-delete with database unlink.
4. Manual snapshots must be user-creatable with optional description.
5. Auto-snapshot volume must stay bounded via default retention rules.

## Data Model

### `pcd_snapshots`

| Column                | Type     | Constraint                | Notes                                     |
| --------------------- | -------- | ------------------------- | ----------------------------------------- | ---------------- | ----------------------- |
| `id`                  | INTEGER  | PK AUTOINCREMENT          | Snapshot ID                               |
| `database_id`         | INTEGER  | NOT NULL FK CASCADE       | Ownership scope                           |
| `type`                | TEXT     | `auto                     | manual`                                   | High-level class |
| `trigger`             | TEXT     | `pull                     | sync                                      | manual`          | Pre-event trigger label |
| `description`         | TEXT     | nullable                  | Manual text or generated summary          |
| `ops_sequence_max_id` | INTEGER  | NOT NULL                  | Published-op boundary                     |
| `ops_count_base`      | INTEGER  | NOT NULL default 0        | Published base count                      |
| `ops_count_user`      | INTEGER  | NOT NULL default 0        | Published user count                      |
| `cache_state_hash`    | TEXT     | nullable                  | v1 deterministic published-op fingerprint |
| `target_instance_ids` | TEXT     | nullable                  | JSON array for sync-triggered snapshots   |
| `created_at`          | DATETIME | default current timestamp | Capture timestamp                         |

Indexes:

- `(database_id, created_at DESC)`
- `(database_id, type)`

## API Contract

### `POST /api/v1/pcd/{databaseId}/snapshots`

Create manual snapshot for `databaseId`.

Request body:

```json
{
  "description": "Before metadata profile cleanup"
}
```

Response `201`:

```json
{
  "id": 42,
  "databaseId": 1,
  "type": "manual",
  "trigger": "manual",
  "description": "Before metadata profile cleanup",
  "opsSequenceMaxId": 1847,
  "opsCountBase": 312,
  "opsCountUser": 15,
  "cacheStateHash": "...",
  "targetInstanceIds": null,
  "createdAt": "2026-02-28T12:00:00Z"
}
```

### `GET /api/v1/pcd/{databaseId}/snapshots`

List snapshots scoped to `databaseId`.

Query params:

- `type` optional (`auto|manual`)
- `limit` optional (default `50`, max `200`)
- `offset` optional (default `0`)

Response `200`:

```json
{
  "snapshots": [],
  "total": 0
}
```

### `GET /api/v1/pcd/{databaseId}/snapshots/{snapshotId}`

Fetch a single snapshot detail.

Response includes computed fields:

- `opsWrittenSince`
- `isRestorable`

### `DELETE /api/v1/pcd/{databaseId}/snapshots/{snapshotId}`

Delete snapshot; returns `204` on success.

### Future

- `POST /api/v1/pcd/{databaseId}/snapshots/{snapshotId}/restore` (Issue #16)

## Integration Design

### Pull Path Hook (`PCDManager.sync()`)

- Remote sources: snapshot after update check confirms updates, before `pull()`.
- Local-path sources: snapshot before local refresh/import sequence.
- Use trigger `pull`.

### Arr Sync Hook (`arrSyncHandler`)

- Snapshot after client validation, before section loop.
- Resolve all distinct database IDs from existing section config query APIs.
- Create one snapshot per distinct database ID with trigger `sync` and `targetInstanceIds=[instanceId]`.

### `pcdSyncHandler`

- No direct snapshot logic; keep `PCDManager.sync()` as pull snapshot source of truth.

## Fingerprinting Strategy

`cache_state_hash` stores `state_hash_v1`:

1. Select published ops ordered by `id`.
2. Canonicalize stable row fields + content hash fallback from SQL/metadata.
3. SHA-256 hash canonical bytes.

Reason: deterministic and independent of cache table key structure.

## Deduplication + Retention

### Deduplication

Auto snapshot is skipped only when all match:

- same `database_id`
- same `trigger`
- same `ops_sequence_max_id`
- same `cache_state_hash`
- created within a short window (recommended 60s)

Manual snapshots are never deduplicated.

### Retention Defaults (MVP)

- `maxAutoSnapshots = 50`
- `maxAutoAgeDays = 30`

Pruning occurs inline after auto snapshot creation.

## UX Requirements

- Snapshot list and detail pages are database-scoped.
- Clear trigger labeling: "Before Pull", "Before Sync", "Manual".
- Deletion uses confirmation modal.
- Snapshot creation failure must surface warning messaging while operation proceeds.

## Risks and Mitigations

| Risk                                            | Mitigation                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Duplicate snapshots from overlapping hooks      | Keep pull capture only in `PCDManager.sync()`; dedupe by trigger+boundary+hash+window |
| Invalid database extraction in `arrSyncHandler` | Use existing typed `arrSyncQueries` section APIs; no dynamic field-name indexing      |
| Non-deterministic fingerprinting                | Use canonical published-op stream hash, versioned (`state_hash_v1`)                   |
| Storage growth                                  | Inline retention pruning with bounded defaults                                        |

## Success Criteria

- [ ] Route and OpenAPI contracts match the per-database API scope.
- [ ] Snapshot hook placement is pre-risk and non-duplicative.
- [ ] Arr sync database resolution plan uses existing query methods and type-safe fields.
- [ ] No pseudocode references nonexistent methods or invalid property access.
- [ ] Fingerprint algorithm no longer depends on cache-table `id` assumptions.
- [ ] All plan docs agree on trigger semantics and endpoint shapes.
