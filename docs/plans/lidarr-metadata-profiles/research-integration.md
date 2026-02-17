# Integration Research: lidarr-metadata-profiles

## API Endpoints

### Existing Related Endpoints

- `GET /api/v1/pcd/export`: Existing PCD API surface example (`src/routes/api/v1/pcd/export/+server.ts`).
- `POST /api/v1/pcd/import`: Existing PCD API surface example (`src/routes/api/v1/pcd/import/+server.ts`).
- `GET/POST/PUT/DELETE /api/v1/metadataprofile`: Lidarr metadata profile lifecycle endpoints (external).
- `GET /api/v1/metadataprofile/schema`: Lidarr schema endpoint for complete type/status enumeration.

### Route Organization

- Current PCD API folder only includes import/export handlers: `src/routes/api/v1/pcd/`.
- New metadata profile endpoints should be added under:
- `src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/+server.ts`
- `src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/[id]/+server.ts`
- Existing UI sync configuration action hub is `src/routes/arr/[id]/sync/+page.server.ts`; metadata profile config action should follow this action pattern.

## Database

### Relevant Tables

- `arr_sync_quality_profiles`: Existing many-selection table for quality profile sync selections.
- `arr_sync_quality_profiles_config`: Existing per-instance trigger/status table for quality profile sync.
- `arr_sync_delay_profiles_config`: Existing per-instance single-selection config table (closest model).
- `arr_sync_media_management`: Existing per-instance multi-section config/status table.
- Planned: `arr_sync_metadata_profiles_config` (single metadata profile selection + trigger/status fields).
- Planned PCD cache tables: `lidarr_metadata_profiles`, `lidarr_metadata_profile_primary_types`, `lidarr_metadata_profile_secondary_types`, `lidarr_metadata_profile_release_statuses`.

### Schema Details

- App DB sync tables are defined in `src/lib/server/db/schema.sql` and managed by numbered migrations in `src/lib/server/db/migrations/`.
- PCD base schema reference is `docs/pcdReference/0.schema.sql`; new PCD tables must be added by built-in schema op and seeded in `src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`.
- `arrSyncQueries` already exposes section lifecycle APIs (`set*StatusPending`, `claim*Sync`, `complete*Sync`, `fail*Sync`) and aggregate lookups (`getPendingSyncs`, `getScheduledConfigs`, `getSyncConfigStatus`) that metadata profiles must extend.

## External Services

- Lidarr API v1 is the only external dependency for this feature family.
- Client integration point: `src/lib/server/utils/arr/clients/lidarr.ts` (already uses `apiVersion = 'v1'`).
- Required client additions:
- `getMetadataProfiles()`
- `getMetadataProfile(id)`
- `getMetadataProfileSchema()`
- `createMetadataProfile(profile)`
- `updateMetadataProfile(id, profile)`
- `deleteMetadataProfile(id)`

## Internal Services

- PCD entities: `src/lib/server/pcd/entities/*` modules for CRUD + serialization/clone/registry.
- Sync section runtime: `src/lib/server/sync/types.ts`, `src/lib/server/sync/mappings.ts`, `src/lib/server/sync/registry.ts`, `src/lib/server/sync/processor.ts`.
- Query persistence: `src/lib/server/db/queries/arrSync.ts`.
- Arr capability surface: `src/lib/shared/arr/capabilities.ts`.
- Shared contracts: `src/lib/shared/pcd/types.ts`, `src/lib/shared/pcd/portable.ts`, `src/lib/shared/pcd/display.ts`, `src/lib/server/utils/arr/types.ts`.

## Configuration

- Sync config sources are per-instance rows in `arr_sync_*` tables with trigger/cron/next_run_at/sync_status controls.
- Metadata profile config should mirror delay-profile UX semantics (single profile selection bound to one database per instance).
- `SUPPORTED_SYNC_SECTIONS` and `ArrSyncSurface` must be extended consistently and gated to Lidarr only.
- Existing trigger scheduling behavior (`on_pull`, `on_change`, `schedule`, `manual`) is already centralized in `sync/processor.ts` + `arrSyncQueries` and should remain unchanged.
