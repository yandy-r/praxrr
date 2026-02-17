# Code Analysis: lidarr-metadata-profiles

## Executive Summary

- Metadata profiles will plug into the same PCD→sync pipeline that already covers quality/delay/media-management entities by reusing `writeOperation`, the existing arr sync registry, and the Lidarr client. The feature-spec and shared research docs confirm that the new tables (`lidarr_metadata_profiles`, child allow/deny tables, and `arr_sync_metadata_profiles_config`) are first-class Lidarr-only entities with strict `arr_type` gating.
- Existing sync infrastructure (`src/lib/server/sync/**`, `arrSyncQueries`, `triggerSyncs`, `scheduleArrSyncForInstance`) already supports section registration, claim/complete semantics, and scheduled/manual triggers, so metadata profiles will mostly extend column-aware configs plus a dedicated handler/syncer.
- Portable import/export/clone flows (`src/lib/shared/pcd/portable.ts`, `src/routes/api/v1/pcd/{import,export}/+server.ts`, `serialize`/`deserialize` helpers) already gate Lidarr payloads via `LIDARR_MEDIA_MANAGEMENT_PORTABLE_MATRIX`, so new metadata profile payloads will need equivalent entries plus strongly typed portable interfaces.

## Existing Code Structure

### Related Components

- **PCD entity modules** (`src/lib/server/pcd/entities/<entity>/<operation>.ts`) centralize database operations, e.g., `delayProfiles/create.ts` and `qualityProfiles/*` expose create/update/list helpers that log against `writeOperation` and lookup via `pcdManager` caches.
- **Sync infrastructure** (`src/lib/server/sync/*`) exports a registry, section handlers (quality/delay/media-management), syncers, and the processor that batches instances, claims pending work, and logs through `logger`.
- **Routes and APIs** (`src/routes/arr/[id]/sync/+page.server.ts`, `src/routes/delay-profiles/[databaseId]/new/+page.server.ts`, `src/routes/api/v1/pcd/{import,export}/+server.ts`) bridge UI forms and API calls to `arrSyncQueries`, entity modules, and serialization helpers.

### File Organization Pattern

- PCD entities live under `src/lib/server/pcd/entities/<entity>` with operation-specific files (e.g., `create.ts`, `update.ts`, `read.ts`), plus shared `registry.ts` and `ops/writer.ts` that capture metadata and stable keys for conflict cancellation.
- Sync sections follow `src/lib/server/sync/<section>` with a `handler.ts` (registers the SectionHandler, ties into `arrSyncQueries`, and exposes `createSyncer`), and a `syncer.ts` that contains the actual arr communication logic.
- Shared types are grouped under `src/lib/shared/pcd/` (`types.ts`, `display.ts`, `portable.ts`) and `src/lib/shared/arr/` (capabilities, client contracts) so new metadata profiles will add new table typings, portable interfaces, and capability flags in the same directories.

## Implementation Patterns

### Entity write operations use `writeOperation` metadata

- **Description**: Entity mutations always go through `writeOperation` from `src/lib/server/pcd/index.ts` (see `delayProfiles/create.ts`). The function hashes SQL + metadata, assigns a stable key, and can cancel out conflicting create/delete operations (`ops/writer.ts`).
- **Example**: `src/lib/server/pcd/entities/delayProfiles/create.ts` builds the insert query, composes `desiredState`, and passes metadata (operation, entity, stableKey, summary, title) to `writeOperation`.
- **Apply to**: New `lidarr_metadata_profiles` create/update/delete helpers must follow the same wrapper so the PCD cache remains authoritative and conflict-safe.

### Value-guard updates and rename awareness

- **Description**: Updates compare the incoming payload to the current row before writing and add WHERE conditions to guard against concurrent changes; they also log rename metadata for auditing (see `delayProfiles/update.ts`).
- **Example**: `update.ts` collects `setValues`, applies `WHERE` clauses for every field that changed, tracks `changes` map, and sets `metadata.previousName` when renames happen.
- **Apply to**: Metadata profile updates (rename, allow/deny lists, release statuses) should mimic this pattern to avoid blind overwrites and to keep cross-instance sync renames deterministic.

### Sync section registry + handler wiring

- **Description**: Each sync section registers via `src/lib/server/sync/registry.ts`, exposes `SectionHandler` implementations that wrap `arrSyncQueries` (pending IDs, status, claim/complete), and provides a `createSyncer` factory.
- **Example**: `src/lib/server/sync/qualityProfiles/handler.ts` registers `qualityProfilesHandler` whose methods delegate to `arrSyncQueries` before returning a `QualityProfileSyncer`.
- **Apply to**: Metadata profiles get their own handler (`src/lib/server/sync/metadataProfiles/handler.ts`), updates `SUPPORTED_SYNC_SECTIONS` and registry, and adds a syncer that uses the Lidarr client to push metadata profile payloads.

### Config normalization + strict pairing in `arrSyncQueries`

- **Description**: Media management configs are normalized so `database_id` and `config_name` must both be set (see `normalizeMediaManagementSelection`), preventing partial selections and ensuring `arrSync` updates stay consistent.
- **Example**: `src/lib/server/db/queries/arrSync.ts` throws if one of the pair is null and normalizes config names to preserve exact persisted names (no trimming aside from empty-checks).
- **Apply to**: The new `arr_sync_metadata_profiles_config` table should follow the same normalization (database+name pair) and consider using helper methods that can bulk update config names on renames.

## Integration Points

### Files to Create

- `src/lib/server/pcd/entities/metadataProfiles/<create|update|delete|list>.ts`: create the new Lidarr metadata profile entity helpers that call `writeOperation`, enforce stable keys, and load rows/child tables (primary/secondary types, release statuses).
- `src/lib/server/sync/metadataProfiles/{handler.ts,syncer.ts}` and possibly `registry.ts` helpers: a SectionHandler for metadata profiles plus syncer logic that calls the Lidarr client.
- `src/lib/server/sync/metadataProfiles/transformer.ts` (if needed) to translate the Lidarr metadata profile payload and determine payload diffs, similar to quality profile transformer logic.
- Migration files under `src/lib/server/db/migrations/` (e.g., `202602XX_create_lidarr_metadata_profiles.ts`, `202602XX_arr_sync_metadata_profiles_config.ts`) and a built-in seed in `src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`.
- Portable serializer/deserializer modules (e.g., `src/lib/server/pcd/entities/serialize/metadataProfiles.ts`, `deserialize/metadataProfiles.ts`) or extend existing serializers to cover metadata profile exports/imports.

### Files to Modify

- `src/lib/server/db/queries/arrSync.ts`: add getters/updates for the new config table, normalize input the same way, set should_sync/sync_status, and expose rename/cleanup helpers.
- `src/lib/server/sync/mappings.ts`: include the new section in `SYNC_SECTION_ORDER`, `SUPPORTED_SYNC_SECTIONS`, and any capability or reason maps.
- `src/lib/server/sync/registry.ts` + `processor.ts`: ensure the metadata section registers and is processed by `processPendingSyncs`, `triggerSyncs`, scheduled jobs, and manual triggers.
- `src/lib/server/utils/arr/clients/lidarr.ts` + `src/lib/server/utils/arr/types.ts`: extend the client/types to expose metadata-profile-specific endpoints from the Lidarr API (metadata profile payloads, release statuses, etc.).
- `src/lib/shared/pcd/portable.ts`: define new portable interfaces for metadata profiles, add entity type constants, and extend the validation matrix to reject mixed payloads.
- `src/lib/shared/pcd/display.ts`: add display types for metadata profiles (rows plus child lists) so routes can consume them without duplicating raw DB types.
- `src/lib/shared/pcd/types.ts`: regenerate to include the new metadata profile tables and views (the file is auto-generated from `docs/pcdReference/0.schema.sql`).
- `src/routes/api/v1/pcd/{import,export}/+server.ts`: update the switch statements and type guards to handle the new entity type.
- `src/routes/arr/[id]/sync/+page.server.ts`: extend the load action to surface metadata profile configs per database and add media management-like actions to save/queue metadata profile sync configs.
- `src/routes/media-management/...` (if there will be UI edits for metadata profiles) to add new page/server endpoints and forms tied into the existing routing structure.
- `src/lib/shared/arr/capabilities.ts`: if metadata profiles represent a new sync surface, add the capability flag for Lidarr and gate UI surfaces accordingly.
- `src/lib/server/pcd/entities/registry.ts`: register the metadata profile entity for auto-align/export if needed.
- `src/lib/server/pcd/entities/serialize.ts` / `deserialize.ts`: add cases for metadata profiles, ensuring serialization respects the `portable` schema.

## Code Conventions

### Naming

- Entity modules and routes use descriptive PascalCase file names under their feature folders (e.g., `LidarrNamingForm.svelte`). Portable types use camelCase fields to match create/update inputs and avoid additional mapping layers (`shared/pcd/portable.ts`).
- Sync sections and queries reference Arr type strings (`arrType: 'lidarr'`) and `arr_type` columns explicitly; the new metadata profile tables must stick to the `arr_type` contract and stable key naming in `writeOperation` metadata.

### Error Handling

- Route handlers log via `logger` before failing or throwing (see `src/routes/delay-profiles/[databaseId]/new/+page.server.ts` and `src/routes/arr/[id]/sync/+page.server.ts`) and return `fail`/`json` with precise HTTP codes.
- `arrSyncQueries` throws early when invariants are violated (e.g., `normalizeMediaManagementSelection` demands both `database_id` and `config_name`). Imported/exported payloads also fail fast when forbidden fields or missing required fields are detected in `validateLidarrPayload`.

### Testing

- Existing regression suites focus on Arr flows (e.g., `src/tests/jobs/arrSyncLidarrConfigPropagation.test.ts`, `src/tests/arr/lidarrFirstClassRouteAndSyncCutover.test.ts`). Expect new metadata profile tests to live under `src/tests/arr/` or `src/tests/jobs/` covering import/export, sync handler, and UI routes.
- Deno tests often run with `--allow-read --allow-write --allow-env --allow-ffi` for Arr interactions; mocks use real `pcd` caches and rely on `pcdManager` fixtures.

## Dependencies and Services

### Available Utilities

- `writeOperation` ( `$pcd/index.ts` and `ops/writer.ts` ) for recording PCD intent with metadata + stable keys.
- `pcdManager` for accessing database caches (`arr/[id]/sync`, delay profile routes, portable import/export).
- `arrSyncQueries` for persisting config/state in `arr_sync_*` tables and gating sync lifecycle operations.
- `logger`, `enqueueJob`, `scheduleArrSyncForInstance`, and `upsertScheduledJob` for logging and scheduling sync work.
- `createArrClient` plus `LidarrClient` for talking to the Arr APIs; metadata profile syncer will reuse these clients.

### Required Dependencies

- Lidarr-specific API contract updates in `src/lib/server/utils/arr/types.ts` to describe metadata profile payloads and release statuses.
- Schema/migration updates under `docs/pcdReference/0.schema.sql` and `src/lib/server/db/schema.sql` plus auto-generated `shared/pcd/types.ts` to add metadata profile tables and child allow/deny tables.
- Sync handler registration requires `src/lib/server/sync/registry.ts` to expose the new `SectionHandler` to `getAllSections()` so `processor.ts` and trigger helpers treat metadata profiles like other sections.
- API docs (`docs/api/v1/openapi.yaml`) must list the new portable entity type so import/export consumers know what payloads exist.

## Gotchas and Warnings

- `shared/pcd/types.ts` is generated; after adding new tables you must rerun `deno task generate:pcd-types` (per the file header) or the type imports will break.
- `arrSyncQueries.normalizeMediaManagementSelection` enforces that `database_id` and `config_name` come as a pair—if the metadata form only supplies one field, the query throws, so new UI/API layers must honor that invariant.
- `writeOperation` can cancel a local `create` if a `delete` follows for the same stable key (`ops/writer.ts`), so metadata profile deletes must set `stableKey` consistently to prevent ghost conflicts.
- The sync processor enqueues jobs with `dedupeKey` like `arr.sync.mediaManagement:event:<id>`; metadata profiles will need their own job type/queue entry to avoid clobbering other sections.

## Task-Specific Guidance

### database

- Add the new tables (`lidarr_metadata_profiles`, `lidarr_metadata_profile_primary_types`, `lidarr_metadata_profile_secondary_types`, `lidarr_metadata_profile_release_statuses`) and the config table (`arr_sync_metadata_profiles_config`) via migrations in `src/lib/server/db/migrations/`. Update `src/lib/server/db/schema.sql` and `docs/pcdReference/0.schema.sql`, then regenerate `shared/pcd/types.ts` for the new rows.
- Seed the migrations (`202602XX`) via `src/lib/server/pcd/ops/seedBuiltInBaseOps.ts` so fresh instances get the tables.
- Consider reusing `AUTO_ALIGN_ENTITIES` ( `src/lib/server/pcd/entities/registry.ts` ) if metadata profiles will participate in base alignment/clone operations.

### api

- Import/export routes (`src/routes/api/v1/pcd/import/+server.ts` and `export/+server.ts`) must switch on a new entity type and map to `serialize/deserialize` helpers. Extend `shared/pcd/portable.ts` to describe the allowed fields and add validation entries via `LIDARR_MEDIA_MANAGEMENT_PORTABLE_MATRIX`.
- Sync configuration is stored via `arrSyncQueries`; extend that module with metadata profile getters, setters (including `should_sync`, `sync_status`, `claim`, `complete`, `fail`, `setStatusPending`, `getPendingSyncs`, `markForSync`, `claim`), and scheduled-run metadata so `processPendingSyncs` can queue the right job.
- Lidarr API client (`src/lib/server/utils/arr/clients/lidarr.ts`) and types (`src/lib/server/utils/arr/types.ts`) must expose the metadata profile endpoints so the syncer can POST/PATCH metadata profile payloads.

### ui

- The sync page (`src/routes/arr/[id]/sync/+page.server.ts`) already loads per-database configs and filters by `arr_type`. Extend it to surface metadata profile configs (list per database, allow scheduling, rerun jobs) and add actions to save/queue metadata profile syncs as for media management.
- Existing forms (delay profile creation, etc.) validate required fields, enforce layer permissions, and call the entity modules; follow the same approach when building metadata profile forms (parse formData, validate, catch `writeOperation` errors, respond via `fail`, and `scheduleArrSyncForInstance`).
- Feature flags/capabilities are controlled by `shared/arr/capabilities.ts`; if metadata profiles should only show for certain surfaces, add an `ArrSyncSurface` entry and gate UI controls accordingly.
