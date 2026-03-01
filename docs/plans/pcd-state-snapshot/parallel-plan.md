# Parallel Implementation Plan: PCD State Snapshots

## Overview

Implement per-database PCD snapshots as lightweight metadata markers with pre-risk capture hooks,
manual CRUD endpoints, and bounded retention.

Canonical constraints for this plan:

- API scope is path-based per database.
- Auto snapshots are pre-risk only.
- Pull snapshots are owned by `PCDManager.sync()` only.
- Arr sync snapshots resolve database IDs through existing typed `arrSyncQueries` APIs.

## Batch Order

```text
Batch 0 (foundation): 1, 2, 3, 4
Batch 1 (service): 5
Batch 2 (integration + API): 6, 7, 8
Batch 3 (verification): 9
```

## Batch 0 - Foundation

### Task 1: Migration

Create:

- `packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_create_pcd_snapshots.ts`

Modify:

- `packages/praxrr-app/src/lib/server/db/migrations.ts`

Requirements:

- Create `pcd_snapshots` table with columns in `shared.md`.
- Trigger enum: `pull|sync|manual`.
- Add indexes:
  - `idx_pcd_snapshots_database_created`
  - `idx_pcd_snapshots_database_type`

### Task 2: Types

Create:

- `packages/praxrr-app/src/lib/server/pcd/snapshots/types.ts`

Required exported types:

- `SnapshotType = 'auto' | 'manual'`
- `SnapshotTrigger = 'pull' | 'sync' | 'manual'`
- `CreateAutoSnapshotInput`
- `CreateManualSnapshotInput`
- `PcdSnapshotDetail`
- `PcdSnapshotFullDetail`
- `PcdSnapshotListResponse`

### Task 3: Query Module

Create:

- `packages/praxrr-app/src/lib/server/db/queries/pcdSnapshots.ts`

Required functions:

- `create(...)`
- `getById(id)`
- `listByDatabase(databaseId, options)`
- `countByDatabase(databaseId, options)`
- `getLatestByDatabase(databaseId)`
- `deleteById(id)`
- `pruneAutoSnapshots(databaseId, maxCount, maxAgeDays)`

Implementation notes:

- Keep DB row shape in snake_case.
- Service-facing inputs/outputs stay camelCase.

### Task 4: OpenAPI

Create or extend:

- `docs/api/v1/paths/pcd-snapshots.yaml` (or `paths/pcd.yaml`)
- `docs/api/v1/schemas/pcd-snapshots.yaml` (or `schemas/pcd.yaml`)
- `docs/api/v1/openapi.yaml`

Paths:

- `/pcd/{databaseId}/snapshots`
- `/pcd/{databaseId}/snapshots/{snapshotId}`

Route contract:

- POST body contains optional `description` only.
- `databaseId` and `snapshotId` are path params.

## Batch 1 - Service Layer

### Task 5: Snapshot Service

Create:

- `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts`

Modify:

- `packages/praxrr-app/src/lib/server/pcd/index.ts`

Service responsibilities:

- Create auto/manual snapshots.
- Compute deterministic `state_hash_v1` fingerprint.
- Dedupe auto snapshots by trigger + boundary + hash + short window.
- Prune old auto snapshots using defaults:
  - `MAX_AUTO_SNAPSHOTS = 50`
  - `MAX_AUTO_AGE_DAYS = 30`
- Expose list/detail/delete APIs.

Fingerprint rules:

- Hash canonical published-op stream from `pcd_ops`.
- Avoid cache-table `GROUP_CONCAT(id)` assumptions.

## Batch 2 - Integration and API

### Task 6: Scoped Snapshot Routes

Create:

- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/+server.ts`

Route behavior:

- Parse and validate path params as positive integers.
- `POST` validates body shape and optional description.
- `GET list` supports `type`, `limit`, `offset`.
- `GET detail` enforces snapshot ownership under provided `databaseId`.
- `DELETE` must also enforce ownership under provided `databaseId`.

### Task 7: `PCDManager.sync()` Pull Hook

Modify:

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`

Hook rules:

- Local-path source branch: snapshot before local refresh/import operations.
- Remote source branch: snapshot only if updates exist, before `pull()`.
- Trigger label is `pull`.
- Snapshot failures log warning and do not abort sync.

Important:

- Do not add snapshot logic to `pcdSyncHandler`; it delegates to `pcdManager.sync()`.

### Task 8: `arrSyncHandler` Pre-Sync Hook

Modify:

- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`

Add helper to resolve distinct DB IDs from existing APIs:

```ts
function collectSnapshotDatabaseIds(
  instanceId: number,
  sections: readonly SectionType[]
): number[] {
  const ids = new Set<number>();

  if (sections.includes('qualityProfiles')) {
    const quality = arrSyncQueries.getQualityProfilesSync(instanceId);
    for (const sel of quality.selections) {
      if (sel.databaseId > 0) ids.add(sel.databaseId);
    }
  }

  if (sections.includes('delayProfiles')) {
    const delay = arrSyncQueries.getDelayProfilesSync(instanceId);
    if (delay.databaseId && delay.databaseId > 0) ids.add(delay.databaseId);
  }

  if (sections.includes('mediaManagement')) {
    const media = arrSyncQueries.getMediaManagementSync(instanceId);
    for (const id of [
      media.namingDatabaseId,
      media.qualityDefinitionsDatabaseId,
      media.mediaSettingsDatabaseId,
    ]) {
      if (id && id > 0) ids.add(id);
    }
  }

  if (sections.includes('metadataProfiles')) {
    const metadata = arrSyncQueries.getMetadataProfilesSync(instanceId);
    if (metadata.databaseId && metadata.databaseId > 0)
      ids.add(metadata.databaseId);
  }

  return [...ids];
}
```

Before section loop, call:

```ts
for (const databaseId of collectSnapshotDatabaseIds(
  instanceId,
  sectionsToRun
)) {
  await snapshotService.createAutoSnapshot({
    databaseId,
    trigger: 'sync',
    targetInstanceIds: [instanceId],
  });
}
```

## Batch 3 - Verification

### Task 9: Validation and Consistency

Required checks:

- `deno task check`
- `deno task lint`
- `deno task test` (or targeted suites if full run is too slow)

Required scenario coverage:

1. Manual snapshot create/list/detail/delete under scoped routes.
2. Pull snapshot creation from both local-path and remote-update sync branches.
3. No duplicate pull snapshots from `pcdSyncHandler` wrapper.
4. Arr sync pre-snapshot for single and multi-database section configs.
5. Dedupe skips equivalent auto snapshots in short interval.
6. Retention pruning removes old/overflow auto snapshots.
7. Snapshot creation failures do not block sync execution.

## File Summary

| File                                                                                       | Action        |
| ------------------------------------------------------------------------------------------ | ------------- |
| `packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_create_pcd_snapshots.ts`        | Create        |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`                                      | Modify        |
| `packages/praxrr-app/src/lib/server/db/queries/pcdSnapshots.ts`                            | Create        |
| `packages/praxrr-app/src/lib/server/pcd/snapshots/types.ts`                                | Create        |
| `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts`                              | Create        |
| `packages/praxrr-app/src/lib/server/pcd/index.ts`                                          | Modify        |
| `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`                                   | Modify        |
| `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`                              | Modify        |
| `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/+server.ts`              | Create        |
| `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/+server.ts` | Create        |
| `docs/api/v1/openapi.yaml`                                                                 | Modify        |
| `docs/api/v1/paths/pcd-snapshots.yaml` (or `pcd.yaml`)                                     | Create/Modify |
| `docs/api/v1/schemas/pcd-snapshots.yaml` (or `pcd.yaml`)                                   | Create/Modify |
