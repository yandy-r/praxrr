# Shared Context: PCD State Snapshots

## Feature Overview

PCD State Snapshots add lightweight, per-database restore markers for Praxrr's append-only
`pcd_ops` model. A snapshot records the published-op boundary and metadata needed for
future rollback tooling (Issue #16) without copying full entity state.

This second-pass update locks three implementation decisions:

1. API scope is per-database path-based.
2. Auto-snapshots are pre-risk markers (before pull, before Arr sync execution).
3. Snapshot fingerprinting is deterministic from published ops, not cache-table `id` scans.

## Decision Log (Locked)

| Decision                    | Choice                                             | Why                                                                 |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| API route scope             | `/api/v1/pcd/{databaseId}/snapshots`               | Removes global ambiguity and makes ownership explicit.              |
| Trigger timing              | Pre-risk only                                      | Snapshot must represent state before a mutating operation.          |
| Trigger labels              | `pull`, `sync`, `manual`                           | Keep schema simple; labels are explicitly pre-event in docs.        |
| Pull snapshot placement     | `PCDManager.sync()` only                           | Single pull entrypoint avoids duplicate captures from job wrappers. |
| Arr sync snapshot placement | `arrSyncHandler` before section loop               | Captures push-risk boundary right before Arr writes.                |
| Fingerprint algorithm       | `state_hash_v1` over canonical published-op stream | Deterministic and independent of cache table shape.                 |
| Retention policy            | Inline auto-pruning (`50` max, `30` days)          | Low complexity MVP, bounded storage.                                |

## Files to Create

| File                                                                                       | Purpose                                   |
| ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_create_pcd_snapshots.ts`        | Creates `pcd_snapshots` table and indexes |
| `packages/praxrr-app/src/lib/server/db/queries/pcdSnapshots.ts`                            | Snapshot CRUD query helpers               |
| `packages/praxrr-app/src/lib/server/pcd/snapshots/types.ts`                                | Snapshot interfaces and input types       |
| `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts`                              | Snapshot orchestration + pruning + dedupe |
| `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/+server.ts`              | List + create manual snapshots            |
| `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/+server.ts` | Detail + delete snapshot                  |
| `docs/api/v1/paths/pcd-snapshots.yaml` (or extension of `pcd.yaml`)                        | OpenAPI paths                             |
| `docs/api/v1/schemas/pcd-snapshots.yaml` (or extension of `pcd.yaml`)                      | OpenAPI schemas                           |

## Files to Modify

| File                                                          | Change                                      |
| ------------------------------------------------------------- | ------------------------------------------- |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`         | Register migration                          |
| `packages/praxrr-app/src/lib/server/pcd/index.ts`             | Re-export snapshot service/types            |
| `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`      | Add pre-pull auto-snapshot hook in `sync()` |
| `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` | Add pre-sync auto-snapshot hook             |
| `docs/api/v1/openapi.yaml`                                    | Add snapshot path + schema refs             |

## Schema Design

```sql
CREATE TABLE pcd_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  database_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('auto', 'manual')),
  trigger TEXT CHECK (trigger IN ('pull', 'sync', 'manual')),
  description TEXT,
  ops_sequence_max_id INTEGER NOT NULL,
  ops_count_base INTEGER NOT NULL DEFAULT 0,
  ops_count_user INTEGER NOT NULL DEFAULT 0,
  cache_state_hash TEXT,
  target_instance_ids TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE CASCADE
);

CREATE INDEX idx_pcd_snapshots_database_created
  ON pcd_snapshots(database_id, created_at DESC);

CREATE INDEX idx_pcd_snapshots_database_type
  ON pcd_snapshots(database_id, type);
```

Notes:

- `cache_state_hash` column name is retained for compatibility, but v1 stores a deterministic
  state fingerprint from published ops (`state_hash_v1`).
- `target_instance_ids` is JSON metadata (not relational join state).

## API Endpoints

- `POST /api/v1/pcd/{databaseId}/snapshots`
- `GET /api/v1/pcd/{databaseId}/snapshots`
- `GET /api/v1/pcd/{databaseId}/snapshots/{snapshotId}`
- `DELETE /api/v1/pcd/{databaseId}/snapshots/{snapshotId}`
- Future: `POST /api/v1/pcd/{databaseId}/snapshots/{snapshotId}/restore`

API notes:

- `databaseId` comes from path, not body/query for create.
- List endpoint filters by `type`, `limit`, `offset` within the scoped database.

## Integration Points

### 1) `PCDManager.sync()` pre-pull hook

Placement policy:

- Remote repo sources: after `checkForUpdates()` confirms updates, before `pull()`.
- Local-path sources: before `refreshLocalRepositoryClone()`.

Behavior:

- Call `snapshotService.createAutoSnapshot({ databaseId: id, trigger: 'pull', targetInstanceIds: null })`.
- Snapshot failures are logged and do not block sync.

### 2) `arrSyncHandler` pre-sync hook

Placement policy:

- After instance/client validation.
- Before section processing loop.

Database resolution (using existing query APIs):

- `arrSyncQueries.getQualityProfilesSync(instanceId).selections[].databaseId`
- `arrSyncQueries.getDelayProfilesSync(instanceId).databaseId`
- `arrSyncQueries.getMediaManagementSync(instanceId)` section database IDs
- `arrSyncQueries.getMetadataProfilesSync(instanceId).databaseId`

Create one pre-sync snapshot per distinct database ID targeted by this job.

### 3) `pcdSyncHandler`

No snapshot call here. It delegates to `pcdManager.sync()`, which is the canonical pull snapshot hook.

## Fingerprint Strategy (`state_hash_v1`)

Canonical stream:

1. Read published ops for database ordered by `id`.
2. For each row include deterministic fields:
   - `id`, `origin`, `sequence`, `state`, `source`
   - `content_hash` if present
   - fallback hash of `sql + '\n' + metadata` when `content_hash` is null
3. Serialize as newline-delimited canonical records.
4. `SHA-256` the bytes.

This avoids assumptions about cache table primary keys while preserving strong change detection.

## Guardrails

- Auto snapshots are best-effort and non-blocking.
- Deduplication must be bounded to avoid hiding separate risk events:
  - same `database_id`
  - same `trigger`
  - same `ops_sequence_max_id`
  - same `cache_state_hash`
  - within a short window (for example, 60s)
- Manual snapshots are never deduplicated.

## Non-Goals (MVP)

- Restore execution workflow
- Snapshot diff UI
- Retention settings UI
- Per-user ownership/audit authoring metadata

## References

- `docs/plans/pcd-state-snapshot/feature-spec.md`
- `docs/plans/pcd-state-snapshot/parallel-plan.md`
- `docs/plans/pcd-state-snapshot/research-technical.md`
