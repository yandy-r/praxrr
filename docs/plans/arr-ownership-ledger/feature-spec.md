# Feature Spec: Arr Ownership Ledger and Opt-in Pruning

Linear YAN-516 · GitHub #351 · Target release: next minor after app/v0.7.1 (trunk-only; `main`).

## Executive Summary

Praxrr never deletes Arr entities, and the manual cleanup tool treats every unexpected name as stale, including
hand-made custom formats. This feature adds an `arr_managed_entities` ledger recording the custom formats (CFs) and
quality profiles (QPs) that Praxrr **created** on each instance. It also adds a per-instance policy,
`prune_removed_managed` (default off), that deletes ledger-owned entities that are no longer desired. Deletes run
only inside the reviewed preview → apply path, so the user always sees them first. Cleanup is scoped to the ledger by
default, with an explicit "include unmanaged" mode. Confirmed `delete` outcomes flow into sync history. Planned
managed deletes appear in drift (new `prune` category) and in Canary preview evidence.

## External Dependencies

### APIs and Services

- Radarr v3, Sonarr v3, Lidarr v1: `DELETE /customformat/{id}` and `DELETE /qualityprofile/{id}`. These already exist
  as `BaseArrClient.deleteCustomFormat` / `deleteQualityProfile` (`utils/arr/base.ts:254,293`).
- Every Arr app refuses to delete a QP that is in use (Radarr HTTP 500; Sonarr and Lidarr typed 400). Blockers
  include media, import lists, Radarr collections and Lidarr root-folder defaults. See `research-external.md`.
- Media listing for the preview-time in-use check: `RadarrClient.getMovies`, `SonarrClient.getAllSeries`,
  `LidarrClient.getArtists`.

### Libraries

No new dependencies.

## Business Requirements

### User Stories

- As an operator, when I remove a CF/QP from my PCD (or deselect it), I want Praxrr to remove the copy it created in
  Arr, after showing me first.
- As an operator, I want my hand-made Arr entities to never be touched by pruning.
- As an operator, I want cleanup to show only Praxrr-managed leftovers by default, and everything else only when I ask.
- As an auditor, I want every delete recorded in sync history and visible in drift and Canary evidence.

### Business Rules

1. **Ownership comes only from a confirmed `create`.** An outcome with `status: 'success'`, `action: 'create'` and a
   positive `remoteId` inserts a ledger row. A successful `update` refreshes `last_synced_at` and `arr_name` on an
   existing row only, and never creates one. An update can come from name-matching an entity that Praxrr did not
   create (security C3), so it is not proof of ownership.
2. **No backfill.** Entities that predate the ledger are unmanaged. They stay reachable through cleanup
   "include unmanaged" (follow-up: an explicit "adopt" action).
3. **Prune candidate** = a ledger row for this instance whose suffixed `arr_name` is not in the expected set and not
   in a kept namespace (the fail-closed rules shared with cleanup). The live Arr entity must also have the same id and
   exactly the same name.
4. **Fail closed.** An unavailable PCD cache, a TRaSH `no_cache`/`transform_failed` status, an unassigned TRaSH
   namespace, a missing TRaSH profile, a ledger read error, policy off, or an unsupported `arr_type` all mean no
   prune.
5. **Preview first.** Deletes execute only from `executeReviewedSyncJob`, using the prepared context whose public
   result (and therefore `planHash`) lists them as `action: 'delete', managed: true`. Scheduled, on-pull, on-change,
   manual unreviewed and Canary runs never delete.
6. **QP in use**: a QP that media is assigned to (preview-time check) is not planned for deletion. It is reported in
   `blockedPrunes`. Arr's own refusal (import lists, collections, root folders) is the backstop: the outcome is
   `failed` and the row is kept.
7. **Order**: QPs are deleted before CFs. A CF still referenced by any desired profile is never pruned.
8. **Identity change**: when an instance's `url` or `type` changes, the ledger rows for that instance are cleared.
9. **Authorization**: applying a reviewed plan that contains managed deletes needs the `admin` scope for API tokens.
   `sync:apply` alone is not enough.

## Technical Specifications

### Architecture

- `db/migrations/20261025_create_arr_managed_entities.ts`: ledger table plus `arr_instances.prune_removed_managed`.
- `db/queries/arrManagedEntities.ts`: `recordCreated`, `touchUpdated`, `listForInstance`, `deleteConfirmed`,
  `clearInstance`.
- `sync/ownership/expectedConfig.ts`: the expected-set resolver extracted from `cleanup.ts` (shared, byte-identical
  logs).
- `sync/ownership/record.ts`: maps outcome + batch provenance → ledger writes. Never throws into the sync.
- `sync/ownership/planPrunes.ts`: pure planner over ledger rows, expected set, live entities and in-use QP ids.
- `sync/ownership/executePrunes.ts`: guarded DELETEs → `SyncEntityOutcome{action:'delete'}` → drops ledger rows.
- `qualityProfiles/syncer.ts`: thin calls only. `generatePreview` marks managed deletes and fills
  `materialPlan.prunes` / `blockedPrunes`. `syncPreparedQualityProfiles` runs `executePrunes` after writes.
- Review binding version 1 → 2.
- Drift: `managed` deletes map to the `prune` category (excluded from the signature).
- Canary decoder keeps `managed`.
- Cleanup: `includeUnmanaged` flag; the default scan is intersected with the ledger.

### Data Models

```sql
ALTER TABLE arr_instances ADD COLUMN prune_removed_managed INTEGER NOT NULL DEFAULT 0
  CHECK (prune_removed_managed IN (0, 1));
CREATE TABLE arr_managed_entities (
  instance_id INTEGER NOT NULL REFERENCES arr_instances(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section = 'qualityProfiles'),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('customFormat','qualityProfile')),
  remote_id INTEGER NOT NULL CHECK (remote_id > 0),
  arr_name TEXT NOT NULL,          -- exact suffixed live name (delete-time guard)
  pcd_name TEXT NOT NULL,          -- unsuffixed
  database_id INTEGER NOT NULL CHECK (database_id > 0), -- PCD database id or TRaSH source id
  source_kind TEXT NOT NULL CHECK (source_kind IN ('pcd','trash')),
  first_synced_at TEXT NOT NULL, last_synced_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, entity_type, remote_id)
);
```

`EntityChange.managed?: boolean`; `QualityProfilesPreview.blockedPrunes?`. Drift category `prune`.

### API Design

OpenAPI first (`packages/praxrr-api/openapi.json`), then `deno task generate:api-types`:

- the preview `EntityChange` gains optional `managed`;
- `SyncEntityOutcomeAction` description is updated;
- the drift category enum gains `prune`;
- `CleanupScanRequest` / `CleanupExecuteRequest` gain optional `includeUnmanaged` (default false).

The instance policy is edited through the settings page form action. No v1 instance-update operation exists.

## UX Considerations

### User Workflows

1. Settings → instance → "Prune removed managed entities" toggle (default off, with a help text warning).
2. Sync page → Preview: managed deletes appear as "Will delete (managed by Praxrr)" and unmanaged ones as
   "Not managed — left untouched". Applying them uses the existing typed-name destructive confirmation.
3. Sync history shows `Deleted` outcomes. Drift shows "Pending removal". Canary evidence includes the planned
   deletes.
4. The cleanup modal defaults to managed scope. An "Include unmanaged items" toggle restores the legacy scan.

### UI Patterns

Existing `Toggle`, `SyncOutcomeList`, `SyncPreviewPanel` badges, and `CleanupModal`. Svelte 5 without runes, using
`onclick` handlers.

## Recommendations

### Implementation

Build in this order: the shared resolver refactor; migration and queries; ledger writes; planner and executor plus
the binding bump; drift, Canary and history surfacing; cleanup scope; UI. All new logic goes in new modules, because
`qualityProfiles/syncer.ts` is already over 1,400 lines.

### Technology

Raw `db.query`/`db.execute` query modules matching `arrInstances.ts`, and the YYYYMMDD migration pattern.

## Risk Assessment

### Security Considerations

- C1 unreviewed prune → deletes exist only in the reviewed prepared context and are hashed into `planHash`.
- C2 id reuse → live id + exact `arr_name` check at plan and execute time; the ledger is cleared on url/type change.
- C3 adoption → ownership is create-only.
- C4 empty desired state → shared keep-namespace resolver.
- C5 audit → outcomes are recorded in history; a warning is logged when history is disabled. Follow-up: an audit log.
- W1 → `admin` is required for token apply when the plan has managed deletes.

### Technical Risks

- Binding version bump invalidates in-flight previews (they must be regenerated; fail closed).
- Default cleanup scope change: existing users see fewer items until ledger rows accrue. The UI explains this and
  offers "include unmanaged".

## Decisions Needed

None blocking. The defaults that were taken are the safety-favoring options above: create-only ownership, no
backfill, Canary never prunes, and admin scope for prune applies.

## Task Breakdown Preview

1. Resolver extraction
2. Migration, queries and policy field
3. Ledger writes
4. Planner, executor and binding
5. Drift, Canary and history surfacing
6. Cleanup scope plus OpenAPI
7. UI: toggle, preview badges, cleanup modal, drift category
8. Tests per acceptance criterion

## Research References

`research-external.md`, `research-business.md`, `research-technical.md`, `research-ux.md`, `research-security.md`,
`research-practices.md`, `research-recommendations.md`.
