# Technical Research: PCD State Snapshots

## Executive Summary

Second-pass technical review against current codebase found four correctness issues in prior drafts:

1. API shape was treated as global collection, but implementation is cleaner and safer per database.
2. Pull snapshot ownership was duplicated between `pcdSyncHandler` and `PCDManager.sync()`.
3. `arrSyncHandler` pseudocode referenced nonexistent API (`arrSyncQueries.getByInstanceId`) and invalid
   section access (`section.type`).
4. Cache hash algorithm relied on `GROUP_CONCAT(id)` assumptions that are not stable across cache tables.

This revision resolves all four with implementation-ready guidance.

## Codebase Reality Check

### Pull Flow

Relevant files:

- `packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts`
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`

Observed behavior:

- `pcdSync` delegates pull work to `pcdManager.sync(databaseId)`.
- `PCDManager.sync()` handles local-path refresh and remote `checkForUpdates` + `pull`.

Implication:

- Pull snapshots should live in `PCDManager.sync()` only.

### Arr Sync Flow

Relevant files:

- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`

Observed behavior:

- Section execution is driven by `SectionType` string union values.
- Database references are exposed via section-specific query methods:
  - `getQualityProfilesSync`
  - `getDelayProfilesSync`
  - `getMediaManagementSync`
  - `getMetadataProfilesSync`

Implication:

- Snapshot DB resolution must aggregate IDs from those methods, not dynamic property indexing.

### Current API Surface

Relevant files:

- `docs/api/v1/openapi.yaml`
- `docs/api/v1/paths/pcd.yaml`
- `packages/praxrr-app/src/routes/api/v1/pcd/**`

Observed behavior:

- Existing PCD APIs are mostly scoped with explicit path IDs.

Implication:

- Snapshot endpoints should follow the same explicit path scoping:
  `/api/v1/pcd/{databaseId}/snapshots...`

## Proposed Technical Design

## Data Model

`pcd_snapshots` table fields:

- `database_id`, `type`, `trigger`, `description`
- `ops_sequence_max_id`, `ops_count_base`, `ops_count_user`
- `cache_state_hash` (stores `state_hash_v1`)
- `target_instance_ids`, `created_at`

Trigger enum for MVP:

- `pull`
- `sync`
- `manual`

Semantics:

- `pull` and `sync` are always pre-event markers.

## Fingerprint (`state_hash_v1`)

Goal:

- deterministic state signal
- no dependency on cache-table primary key conventions

Algorithm:

1. Select published ops by database ordered by `id`.
2. For each row canonicalize:
   - `id|origin|sequence|state|source|contentFingerprint`
3. `contentFingerprint`:
   - use `content_hash` when present
   - else compute SHA-256 over `sql + '\n' + metadata`
4. SHA-256 over canonical newline stream.

Storage:

- write result to `cache_state_hash` column.

## Hook Placement

### `PCDManager.sync()`

- Local-path branch: create pull snapshot before local refresh/import.
- Remote branch: create pull snapshot only when updates are detected, before `pull()`.

### `arrSyncHandler`

- After client creation/validation.
- Before section loop.
- Resolve distinct DB IDs from section-specific `arrSyncQueries` APIs.
- Create one `sync` snapshot per DB.

### `pcdSyncHandler`

- No direct snapshot call.

## API Contract

Scoped endpoints:

- `POST /api/v1/pcd/{databaseId}/snapshots`
- `GET /api/v1/pcd/{databaseId}/snapshots`
- `GET /api/v1/pcd/{databaseId}/snapshots/{snapshotId}`
- `DELETE /api/v1/pcd/{databaseId}/snapshots/{snapshotId}`

Behavior:

- `databaseId` from path.
- `POST` body contains optional description only.
- Route handlers validate ownership on detail/delete.

## Failure Modes

1. Snapshot creation fails before sync/pull:
   - Log warning with `databaseId` + trigger.
   - Continue operation.
2. No database IDs resolved for a sync section set:
   - Skip snapshot creation for that job.
   - Continue sync.
3. Cache/fingerprint unavailable:
   - Persist snapshot with null `cache_state_hash`.
   - Snapshot remains usable for boundary restore planning.

## Verification Requirements

- Pull hook fires exactly once per pull operation path.
- Arr sync hook uses valid existing query APIs only.
- No references to nonexistent methods or dynamic section properties.
- Endpoint path, OpenAPI, and route files remain aligned.
- Dedupe does not hide distinct `pull` vs `sync` events.

## Residual Risks

- If a DB has very large published-op history, hash generation may add latency.
  - Mitigation: benchmark and, if needed, short-circuit to a reduced fingerprint for auto snapshots.
- Distinct Arr sync jobs against same DB in rapid succession may still generate dense history.
  - Mitigation: keep trigger-aware short-window dedupe and retention pruning.
