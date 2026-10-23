## Executive Summary

Sync already has a reserved `delete` action and already shows unmatched Arr entities as preview deletes. Nothing executes those deletes, and the ledger needed to tell Praxrr-created rows from hand-made ones does not exist.

`SyncEntityOutcome` (`packages/praxrr-app/src/lib/server/sync/types.ts:19`, `:46-61`) is `create | update | delete`, and the comment says no syncer emits `delete`. Confirmed creates and updates are produced only after the Arr write returns, in `writeCustomFormatPayload` (`customFormats/syncer.ts:93-105`) and `writeQualityProfilePayload` (`qualityProfiles/syncer.ts:1370-1379`). Provenance is not on the outcome. It sits on the batch: `sourceKind`, `databaseId`, `suffix` (`qualityProfiles/syncer.ts:82-89` and the prepared copy at `:140-148`). TRaSH batches store `databaseId: -source.id` (`:1094-1098`). A ledger upsert has to run beside `outcomes.push` with the batch in scope. It must not be parsed back out of the outcome name, and it must not wait for sync history (history can be disabled; `recordSyncHistory` returns null when it is, `syncHistory/record.ts:193-196`).

The reviewed plan hash already covers the public section result, including every `action: 'delete'` row. `SectionReviewRecorder.snapshot` freezes `plan: { result, outcome }` (`preview/orchestrator.ts:124-138`), and `hashEvidence(..., 'plan', ...)` is what becomes `planHash` (`preview/reviewBinding.ts:302-318`, `:446-450`). `materialPlan` is not in that hash. Executable prunes therefore have to be visible on the public `EntityChange` list. Today `diffEntityCollection` marks every unmatched remote row as `delete` (`preview/sectionDiffs.ts:211-224`), and `syncPreparedQualityProfiles` never deletes anything (`qualityProfiles/syncer.ts:712-794`). Those deletes are display-only, and drift stores all of them as `unmanaged` (`drift/check.ts:146-164`). Starting to execute every preview delete would remove hand-made custom formats. Apply must execute only ledger-matched deletes, and `SYNC_PREVIEW_REVIEW_BINDING_VERSION` must move from 1 to 2 (`reviewBinding.ts:22`, checked at `:480` and `preview/store.ts:257`) so an in-flight approval of the old display-only deletes cannot authorize a real delete.

Two gates drop the “last selection removed” case before any plan exists. Unreviewed `sync()` returns success with zero items when `totalProfiles === 0` (`qualityProfiles/syncer.ts:372-378`). Preview does the same and returns empty change arrays (`:476-488`), so the diff never runs. `qualityProfilesHandler.hasConfig` is false when PCD and TRaSH selections are both empty (`qualityProfiles/handler.ts:52-60`), and the job then skips the section (`jobs/handlers/arrSync.ts:1063-1072`). Scheduled and manual unreviewed sync call `syncer.sync()` with no prepared plan (`arrSync.ts:1090-1091`, `processor.ts:376-380`). Prune deletes run only from the reviewed prepared context, after a preview whose `planHash` included them. Policy off, or an unreviewed run, never deletes.

Ownership starts at the first confirmed successful write after the migration. Do not backfill by namespace suffix: a suffixed name is not proof Praxrr created the row. Until a later successful create/update stamps the ledger, a deselected pre-migration entity is not pruned. That is fail-closed.

Quality-profile in-use checks are Arr-specific and incomplete in the client. Radarr delete guards are movie `qualityProfileId`, import list `qualityProfileId`, and collection `qualityProfileId` (in-use surfaces as HTTP 500 on current develop). Sonarr guards are series plus import list `qualityProfileId` (typed 400). Lidarr guards are artist `qualityProfileId`, import list wire field `qualityProfileId` (not the internal `ProfileId`), and root folder `defaultQualityProfileId` (typed 400). This tree only lists media: `RadarrClient.getMovies` (`utils/arr/clients/radarr.ts:22`), `SonarrClient.getAllSeries` (`clients/sonarr.ts:26`), `LidarrClient.getArtists` (`clients/lidarr.ts:32`). `cleanup.ts:338-339` treats any HTTP 500 as “assigned to media”; that heuristic is Radarr-shaped and is not a prune outcome builder. A quality-profile prune whose in-use preflight cannot be completed is skipped, not deleted.

Custom formats and quality profiles are not their own sections. Both use section `qualityProfiles` (`types.ts:110`, outcome `section: 'qualityProfiles'` in both writers). Radarr, Sonarr, and Lidarr all support that section (`mappings.ts:23-27`). `metadataProfiles` is Lidarr-only. `chaptarr` is in `ArrType` (`utils/arr/types.ts:5`) and in `SyncArrType` (`mappings.ts:13`) but is absent from `SUPPORTED_SYNC_SECTIONS` and from `SyncPreviewArrType` (`preview/types.ts:61`). The ledger does not accept it.

## Architecture Design

### Where a confirmed write becomes a ledger row

Upsert only when the Arr call has returned and the outcome is `status: 'success'` with a positive integer `remoteId`. Creates and updates only. Skipped and failed outcomes do not insert and do not refresh `last_synced_at`. A failed update keeps the previous row, so a later prune can still see the last confirmed id.

Call sites, all inside the quality-profile syncer (custom formats are written from there):

| Path                       | After this success                                                | Provenance in scope                                                                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewed custom format     | `outcomes.push(write.outcome)` at `qualityProfiles/syncer.ts:727` | `batch.sourceKind`, `batch.databaseId` (`:712`)                                                                                                                                                                                               |
| Reviewed quality profile   | `outcomes.push(write.outcome)` at `:780`                          | same batch (`:734`)                                                                                                                                                                                                                           |
| Unreviewed quality profile | `outcomes.push(write.outcome)` at `:1305`                         | the `DatabaseSyncBatch` in `sync()` `:407-417` is not passed into `syncQualityProfiles` (`:1268`). Thread `sourceKind` and `databaseId` through, or upsert in `sync()` where `batch` is in scope. Do not recover them from `pcdProfile.name`. |
| Unreviewed custom format   | `outcomes.push(write.outcome)` at `customFormats/syncer.ts:286`   | `syncCustomFormats` (`:241`) is called with suffix only (`qualityProfiles/syncer.ts:382-389`). Pass `sourceKind` and `databaseId` in. The writer at `customFormats/syncer.ts:66` stays provenance-free.                                       |

`section` on the row is the outcome section (`qualityProfiles`). `entity_type` is `customFormat` or `qualityProfile`. `pcd_name` is `outcome.name` (unsuffixed, `types.ts:52-53`). `database_id` is the batch value, including negative TRaSH ids. `source_kind` is `'pcd' | 'trash'`.

Ledger I/O lives in `packages/praxrr-app/src/lib/server/db/queries/arrManagedEntities.ts`, same style as `arrInstances.ts` (`db.query` / `db.execute`, not a new Kysely layer). The syncer calls it. It does not grow `qualityProfiles/syncer.ts` (already ~1458 lines) with SQL.

A ledger upsert failure after a successful Arr write is logged and does not flip the outcome to failed and does not roll back the Arr create. The entity is then unmanaged until a later successful write stamps it. That can orphan a Praxrr-created row. It cannot delete a hand-made one. A delete drops the ledger row only after the Arr DELETE returns success. Arr 404 on that id means “already gone”: drop the row, outcome `success`, do not use the cleanup 500 text.

### How a delete gets into the reviewed plan

Preview must keep emitting a `delete` `EntityChange` for remote rows that are not in the desired set (`sectionDiffs.ts:211-224`). That list is not an execution list. Add optional `managed: boolean` on `EntityChange` (`preview/types.ts:83-89`), default false. Set `managed: true` only when `(entityType, remoteId)` is in the ledger for this `instance_id`. Hand-made rows stay `managed: false` and are never deleted by pruning.

`generatePreview` (`qualityProfiles/syncer.ts:460`) currently returns before the diff when there is nothing selected (`:476-488`). When `prune_removed_managed` is on, that return is wrong: load the ledger, and if any row is absent from the desired remote-id set, those rows are `managed: true` deletes on `customFormats` / `qualityProfiles` in the section result. Still record Arr evidence (`:491-495`) so `arrHash` covers the live ids. When the policy is off and nothing is selected, keep today’s empty result so drift and preview do not change.

The prepared context (`:604-618`) gains an executable list that is a subset of those public managed deletes:

```ts
materialPlan: {
  arrType: SyncArrType;
  batchOrder: readonly string[];
  prunes: readonly {
    entityType: 'customFormat' | 'qualityProfile';
    remoteId: number;
    pcdName: string;
    sourceKind: 'pcd' | 'trash';
    databaseId: number;
  }[];
}
```

`prunes` is empty when the policy is off. A quality profile that fails the in-use preflight is not in `prunes` and is not `action: 'delete'`. Surface it as a non-delete on the result (a `blockedPrunes` array on `QualityProfilesPreview`, `preview/types.ts:91-95`) so the UI can say why it stayed. If that array is added, it is part of `result` and therefore part of `planHash`. Do not put blocked ids only in `materialPlan`.

Apply path: `executeReviewedSyncJob` re-materializes, rebuilds the binding, and compares (`jobs/handlers/arrSync.ts:571-588`) before any write. `syncPreparedQualityProfiles` (`qualityProfiles/syncer.ts:647`) then runs the fresh context. After the existing custom-format and profile writes (`:712-784`), execute `materialPlan.prunes` and only those. Re-check each id against `currentGuards` and the public result: `action === 'delete'` and `managed === true` and the same `remoteId`. Any mismatch throws before the DELETE, same as the existing guard throws at `:718-719` and `:738-742`. Order is quality profiles first, then custom formats. `cleanup.ts:316-331` deletes custom formats first; doing that while a removed profile still references the format makes the format delete fail. A custom format still referenced by a desired profile, or by a profile whose prune was blocked, is not put in `prunes`.

Each executed DELETE appends a `SyncEntityOutcome` with `action: 'delete'` and `status` from the Arr result (`success` / `failed`), `remoteId` set, `reason` from `sanitizeArrWriteError` (already used at `qualityProfiles/syncer.ts:1382` and `customFormats/syncer.ts:107`). In-use skips that never called DELETE use `status: 'skipped'` and a sanitized reason. No raw Arr body. Unreviewed `sync()` (`:334-378`, `:1300-1305`) does not read `prunes` and does not call DELETE.

`hasConfig` (`qualityProfiles/handler.ts:52-60`) must be true when the policy is on and the ledger has at least one row for the instance, even if selections are empty. Otherwise the job skip at `arrSync.ts:1063-1072` and `syncInstance` (`processor.ts:376-380`) never open the section, and the reviewed UI never asks for a preview of the last removal. Opening the section is not permission to delete on the unreviewed path; the syncer still no-ops deletes unless a prepared context is attached (`:335-354`).

Binding: bump `SYNC_PREVIEW_REVIEW_BINDING_VERSION` to 2. The hash payload already includes the section result (`orchestrator.ts:131-138`, `reviewBinding.ts:450`). The bump is what invalidates stored bindings (`reviewBinding.ts:480`, `store.ts:257`) whose `delete` rows meant “not in the desired set” rather than “will be removed if managed”. Adding `managed` also changes canonical JSON, so a re-materialized v1 binding would not match even without the bump; the bump makes the semantic cut explicit. In-flight v1 previews fail closed as unverifiable and must be generated again. `totalDeletes` already counts `action: 'delete'` (`orchestrator.ts:222-223`); managed and unmanaged both count. That is acceptable. Do not count unmanaged rows as executable.

### Policy

One column on `arr_instances`, default off: `prune_removed_managed INTEGER NOT NULL DEFAULT 0` with a 0/1 check. `ALTER TABLE` is safe; `arr_instances` is an FK target and must not be rebuilt (same constraint called out in `migrations/20261024_bound_schedule_intervals.ts:14-16`).

Wire it through `ArrInstance` (`db/queries/arrInstances.ts:7-24`), `UpdateArrInstanceInput` (`:40-50`), `arrInstanceSelect` (`:52-68`), and `collectArrInstanceUpdates` (`:89-136`). No other settings table. The syncer reads the flag from the instance row it already holds. Missing or non-0/1 is off.

There is no `/api/v1` instance-update operation in `packages/praxrr-api/openapi.json` (instance edits go through the settings page action). Contract-first still applies to the cleanup request and to any new field on a v1 schema. The column is the source of truth either way. Do not invent a second flag on the sync-section config tables.

### Cleanup scan

`scanForStaleItems` (`cleanup.ts:57-230`) treats “not in the expected name set and not in a kept namespace” as stale, including names with no namespace suffix (`:200-212`). That is the hand-made-entity bug. Default scan intersects that stale set with ledger `(instance_id, entity_type, remote_id)` for `customFormat` and `qualityProfile`. A stale name whose id is not in the ledger is dropped. Ledger read failure returns an empty stale list and a logged error, not the wide list.

`includeUnmanaged: true` on the scan request restores today’s name-based set. It is not the default and it is not pruning. `parseCleanupRequest` (`cleanupRequest.ts:8-9`, `:35-65`) accepts only `scan` | `execute`. Add optional `includeUnmanaged` (boolean, default false) to both arms. `executeCleanup` (`cleanup.ts:244`) re-scans server-side; it must use the same flag from the request and ignore client ids that the fresh scan did not return (YAN-471 behavior stays). A client cannot scan ledger-only and then execute unmanaged.

`POST /api/v1/arr/cleanup` (`routes/api/v1/arr/cleanup/+server.ts:11-16`, `:46-50`) passes the flag through. OpenAPI `CleanupScanRequest` / `CleanupExecuteRequest` (`openapi.json:1826-1832`, result shape at `:8680`) gain the boolean. `deleteStaleItems` (`cleanup.ts:307-341`) stays the cleanup executor. Prune does not call it and does not reuse the HTTP 500 → “assigned” mapping (`:338-339`).

Kept-namespace fail-safe (`cleanup.ts:5-7`, `:117-150`) stays in both modes. An undeterminable namespace is not deleted just because a ledger row shares the suffix.

### History, drift, canary

Sync history needs no new column. `entity_outcomes` is already a JSON blob of `SyncEntityOutcome` (`migrations/20260720_add_sync_history_entity_outcomes.ts:6-24`). Reviewed runs store `allOutcomes` at `arrSync.ts:711-726`. Unreviewed runs store them at `:1155-1163`. `flattenSyncPreviewChanges` (`syncHistory/record.ts:86-123`) keeps every non-`unchanged` action (`:83`), so a managed `delete` in the preview also lands in the planned `changes` blob. Confirmed deletes land in `entityOutcomes` once the syncer pushes them. `deriveSyncHistoryStatus` (`record.ts:48-58`) already treats a failed outcome as not-success, so a failed DELETE makes the run partial/failed. Do not add deletes to `itemsSynced`; that counter is profile/write counts. `entity_outcome_count` is `entityOutcomes.length` (`db/queries/syncHistory.ts:228-231`) and will include them.

OpenAPI already allows the action: `SyncEntityOutcomeAction` enum is `create | update | delete` with the text “`delete` is reserved; no syncer emits it yet” (`packages/praxrr-api/openapi.json:9286-9289`). Update that description when a syncer emits it. No new required outcome fields. Do not put `sourceKind` or `databaseId` on the public outcome.

Drift reads preview `EntityChange`s, not outcomes. `toDriftChange` maps every delete to `unmanaged` (`drift/check.ts:146-164`, type at `drift/types.ts:37-40`). Split that: `managed === true` becomes category `prune`; other deletes stay `unmanaged`. `driftSignature` (`check.ts:263-270`) stays update+create only, so a prune does not change the notification dedup key. The detail payload still returns the prune rows, which is what “appear in drift” requires. OpenAPI category enum is `drift | missing | unmanaged` (`openapi.json:9748-9749`; detail copy at `:3940` and `:9981-9983`). Add `prune` there, in `DriftCounts`, in `toDriftDetail` grouping (`drift/responses.ts` filters by category; unmanaged filter is at `:123`), and in `resolveDriftCategoryPhrase` (`shared/narration/templates.ts:153`). Narration tone map `DRIFT_CATEGORY_TONE` (`shared/narration/narrate.ts:36-39`) needs the new key or the switch fails closed.

Canary stores the whole `GeneratePreviewResult` on `remaining_preview_evidence` (`canary/types.ts:64-77`, written from `buildRemainingPreviewEvidence` at `canary/coordinator.ts:141` and `:289-301`). Managed deletes on the quality-profile result therefore show up in the gate evidence with no canary table change. The canary instance’s confirmed deletes show up through `canary_sync_history_id` → `sync_history.entity_outcomes`. `decodeRemainingPreview` (`db/queries/canaryRollouts.ts:460-515`) accepts the preview JSON; `decodePreviews` (called at `:479`) must keep `managed` if it rebuilds `EntityChange` field-by-field. If it only checks `action` and `remoteId`, the flag is still carried when the object is passed through. Confirm before implementation; stripping `managed` would let a later apply treat the id as unmanaged and skip a prune, which is fail-closed, but it would also drop the evidence the gate is supposed to show.

### Arr types and the quality-profile preflight

Ledger `arr_type` is not stored. The instance row is the type. Checks use `instance.type` via the existing `SyncPreviewArrType` guard (`preview/types.ts:68-70`): `radarr` | `sonarr` | `lidarr`. `chaptarr` never reaches preview. `isSyncSectionSupported` (`mappings.ts:45-46`) is the section gate; custom formats are not a section.

In-use preflight is a new module, `sync/ownership/qualityProfileInUse.ts`, switched on `arrType` with no fall-through to another app:

- `radarr`: `getMovies` plus import-list `qualityProfileId` plus collection `qualityProfileId`. Movie-only is not enough.
- `sonarr`: `getAllSeries` plus import-list `qualityProfileId`. Series-only is not enough.
- `lidarr`: `getArtists` (`qualityProfileId`) plus import-list wire `qualityProfileId` plus root-folder `defaultQualityProfileId`.
- any other type, or any list call that throws or returns an unreadable body: the profile is blocked. No DELETE.

Import-list, collection, and root-folder list methods are not on `BaseArrClient` (deletes that do exist: `deleteCustomFormat` at `utils/arr/base.ts:254-255`, `deleteQualityProfile` at `:293-294`). Those GETs are a prerequisite for quality-profile prune, added per concrete client, not on a shared “maybe Sonarr has collections” helper. Custom-format prune has no media-assignment check. A format delete that Arr rejects because a profile still scores it is `failed`, and the ledger row stays.

Before DELETE, re-read the live entity by id. If it is gone, drop the ledger row and do not call DELETE. If the live name is not the suffixed name recomputed from `pcd_name` + namespace (`getNamespaceSuffix` at `sync/namespace.ts:28`, `getTrashGuideNamespaceSuffix` at `:38`), skip the delete. If the namespace row is gone and the suffix cannot be recomputed, skip. Do not delete by id alone when the name cannot be checked. Arr id reuse is rare; the name check is the fail-closed guard.

### Modules

| File                                                    | Responsibility                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `db/migrations/20261025_create_arr_managed_entities.ts` | Table + instance column                                                                  |
| `db/queries/arrManagedEntities.ts`                      | Upsert, list by instance, delete by identity                                             |
| `sync/ownership/record.ts`                              | Map a successful write + batch provenance → upsert; map a successful delete → delete row |
| `sync/ownership/planPrunes.ts`                          | Ledger minus desired remote ids, minus in-use blocks, minus formats still referenced     |
| `sync/ownership/qualityProfileInUse.ts`                 | Per-`arrType` preflight                                                                  |
| `sync/ownership/executePrunes.ts`                       | DELETE calls, outcomes, ledger drop                                                      |

`qualityProfiles/syncer.ts` only calls `planPrunes` from `generatePreview` and `executePrunes` from `syncPreparedQualityProfiles`. No prune code in delay, metadata, or media-management syncers.

## Data Models

### Migration

Next version is `20261025`. Latest applied shape is `migrations/20261024_bound_schedule_intervals.ts:21` (`version: 20261024`). Register it in `db/migrations.ts` next to the import at `:95` and the array entry at `:421-422`. Follow `20261023_create_arr_trash_guide_namespaces.ts:19-36` (named migration object, `up` / `down` SQL strings, `IF NOT EXISTS`). Ignore `_template.ts` numeric `001` guidance; the tree uses `YYYYMMDD` version integers.

`packages/praxrr-app/src/lib/server/db/schema.sql` is a stale reference (header `:1-4`, “Last updated: 2026-02-20”). `arr_instances` there (`:24-45`) does not even list `detected_version`. Append the new table and column anyway so the reference matches the migration. Do not execute `schema.sql`. No PCD base op and no `seedBuiltInBaseOps.ts` change (same note as the history-outcomes migration, `20260720_add_sync_history_entity_outcomes.ts:13`).

No backfill `INSERT`. Existing instances get `prune_removed_managed = 0`. The ledger stays empty until confirmed writes.

### SQL

```sql
ALTER TABLE arr_instances
  ADD COLUMN prune_removed_managed INTEGER NOT NULL DEFAULT 0
  CHECK (prune_removed_managed IN (0, 1));

CREATE TABLE IF NOT EXISTS arr_managed_entities (
  instance_id     INTEGER NOT NULL,
  section         TEXT NOT NULL CHECK (section = 'qualityProfiles'),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('customFormat', 'qualityProfile')),
  remote_id       INTEGER NOT NULL CHECK (remote_id > 0),
  pcd_name        TEXT NOT NULL,
  database_id     INTEGER NOT NULL,
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('pcd', 'trash')),
  first_synced_at TEXT NOT NULL,
  last_synced_at  TEXT NOT NULL,
  PRIMARY KEY (instance_id, entity_type, remote_id),
  FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE,
  CHECK (
    (source_kind = 'pcd' AND database_id > 0)
    OR (source_kind = 'trash' AND database_id < 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_arr_managed_entities_instance
  ON arr_managed_entities(instance_id, entity_type);
```

`down` drops the index and the table, then rebuilds nothing on `arr_instances`: SQLite cannot `DROP COLUMN` reliably on this codebase’s older path, so `down` may leave the flag column (same “clamped values stay” honesty as `20261024`’s `down`, which does not restore clamped numbers). If the project’s SQLite supports `ALTER TABLE DROP COLUMN`, drop only `prune_removed_managed`. Do not rebuild `arr_instances` to remove it.

No FK from `database_id` to `database_instances`. TRaSH ids are negative and are not database rows (`qualityProfiles/syncer.ts:1098`). `pcd_name` is not unique and is not part of the key. A recreate that gets a new Arr id is a new row; the old id is pruned only if it is no longer desired and still passes the name check.

Upsert:

```sql
INSERT INTO arr_managed_entities (
  instance_id, section, entity_type, remote_id, pcd_name,
  database_id, source_kind, first_synced_at, last_synced_at
) VALUES (?, 'qualityProfiles', ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(instance_id, entity_type, remote_id) DO UPDATE SET
  pcd_name = excluded.pcd_name,
  database_id = excluded.database_id,
  source_kind = excluded.source_kind,
  section = excluded.section,
  last_synced_at = excluded.last_synced_at;
```

`first_synced_at` stays on conflict. Timestamps are ISO text, matching drift’s `checked_at` rather than a second clock format.

### TypeScript

```ts
export type ManagedEntityType = 'customFormat' | 'qualityProfile';
export type ManagedSourceKind = 'pcd' | 'trash';

export interface ArrManagedEntity {
  instanceId: number;
  section: 'qualityProfiles';
  entityType: ManagedEntityType;
  remoteId: number;
  pcdName: string;
  databaseId: number;
  sourceKind: ManagedSourceKind;
  firstSyncedAt: string;
  lastSyncedAt: string;
}

export interface ManagedWriteProvenance {
  sourceKind: ManagedSourceKind;
  databaseId: number;
}
```

Query surface on `arrManagedEntitiesQueries`:

- `upsertConfirmed(instanceId, outcome, provenance, syncedAt)` — no-op unless `outcome.status === 'success'`, `outcome.action` is `create` or `update`, and `remoteId` parses as a positive integer. Rejects provenance that disagrees with the CHECK (pcd with `databaseId <= 0`, trash with `databaseId >= 0`).
- `listForInstance(instanceId)` — prune planning.
- `deleteConfirmed(instanceId, entityType, remoteId)` — after Arr DELETE success or confirmed 404.

`EntityChange` (`preview/types.ts:83-89`) gains `readonly managed?: boolean`. Absence means false. `QualityProfilesPreview` gains `readonly blockedPrunes: readonly { entityType: ManagedEntityType; remoteId: number; name: string; reason: string }[]`. `SyncPreviewAction` already includes `delete` (`preview/types.ts:10`). OpenAPI preview action enum already matches (`openapi.json:9183-9184`).

`ArrInstance.prune_removed_managed: number` and `UpdateArrInstanceInput.pruneRemovedManaged?: boolean`.

### OpenAPI lockstep

- `SyncEntityOutcomeAction` description (`openapi.json:9286-9289`): delete is emitted for ledger prunes only.
- Preview entity schema next to that action: optional `managed`, default false.
- Drift category enum (`:9748-9749`) and the unmanaged descriptions (`:3940`, `:9672-9675`, `:9981-9983`): add `prune`.
- `CleanupScanRequest` and `CleanupExecuteRequest` (`:1826-1832`): optional `includeUnmanaged`, default false.
- Regenerate `packages/praxrr-api` types with `deno task generate:api-types` after the spec edit. Do not hand-edit the generated `v1.d.ts` only.

`SyncEntityOutcome` required fields stay as they are (`openapi.json:9312` region). History detail already requires `entityOutcomes`.

### What this does not change

Delay profiles, metadata profiles, and media management do not write the ledger and do not grow a delete path. Their outcomes stay `create` / `update`. Drift unmanaged deletes for those sections stay unmanaged (`managed` absent).

Unreviewed sync, startup scheduling, and `processor.ts` `syncInstance` keep calling `sync()` with no prepared context. They stamp the ledger on successful create/update. They do not prune.

### Uncertainties

- `decodePreviews` in `canaryRollouts.ts` (called from `decodeRemainingPreview` at `:479`) was not line-read. If it rebuilds entities without copying unknown fields, `managed` disappears from stored canary evidence until that decoder is updated. Apply still uses the re-materialized plan, not the stored blob.
- Import-list, collection, and root-folder response shapes were not re-read from Arr clients in this tree because those methods are absent. Wire names above are from the API research note (Lidarr import list JSON is `qualityProfileId`). Implementation has to add the GETs per client and fail closed until each arr type’s full guard set returns readable ids.
- `getNamespaceSuffix` / `getTrashGuideNamespaceSuffix` line numbers are graphify locations (`sync/namespace.ts:28` and `:38`), not a full read of that file.
- Whether the settings form is the only writer of `arr_instances` was not exhaustively searched past `arrInstancesQueries.update`. Every caller of `collectArrInstanceUpdates` must tolerate the new optional field; omitting it leaves the column unchanged.
