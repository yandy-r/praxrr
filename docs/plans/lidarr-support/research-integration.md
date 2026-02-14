# Integration Research: lidarr-support

## API Endpoints

### Existing Related Endpoints

- `GET /api/v1/pcd/export`: serializes named entities from the PCD cache using `src/routes/api/v1/pcd/export/+server.ts`, but only understands the `EntityType` values listed in `src/lib/shared/pcd/portable.ts`/`docs/api/v1/schemas/pcd.yaml` (radarr/sonarr naming, media settings, and quality definition entities) so there’s no `lidarr_*` option to export yet.
- `POST /api/v1/pcd/import`: mirrors the export shape via `src/routes/api/v1/pcd/import/+server.ts` and delegates to the same portable deserializers; validation rejects any `entityType` outside the radarr/sonarr set, meaning you cannot import a Lidarr-specific naming/media/quality config by name.
- `GET /media-management/{databaseId}/naming`, `/quality-definitions`, `/media-settings`: each page server (`src/routes/media-management/[databaseId]/{section}/+page.server.ts`) uses `pcdManager.getCache()` plus the respective `list` helper in `src/lib/server/pcd/entities/mediaManagement/{section}/read.ts` to read `radarr_*` and `sonarr_*` presets only, so the rendered lists never surface `lidarr` rows.
- `POST /media-management/{databaseId}/(naming|quality-definitions|media-settings)/new`: every action handler (`+page.server.ts` under each `new` directory) reads an `arrType` form field, validates it against only `'radarr'` and `'sonarr'`, and calls the corresponding `createRadarr*`/`createSonarr*` helper in `src/lib/server/pcd/entities/mediaManagement/{section}/create.ts`, preventing creation of any Lidarr-configured preset.
- `POST`/`PATCH` actions inside `radarr/` and `sonarr/` subroutes (e.g., `src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts`) are wired to the same entity tables; there is no analogue under a `lidarr` path, so editing/deleting also can’t target a `lidarr` entry.

### Route Organization

The UI routes live under `src/routes/media-management/**` as documented in `docs/ARCHITECTURE.md → 12) Media Management`. The top-level `[databaseId]` layout (`src/routes/media-management/[databaseId]/+layout.svelte`) renders database tabs and funnels every database into three section tabs (`naming`, `quality-definitions`, `media-settings`). Each section has its own `+page.server.ts` for listing configs, `new/+page.server.ts` for creation, and nested `[arr_type]/[name]` pages for editing (`arr_type` is currently either `radarr` or `sonarr`). Client-side components (list cards, clone modal, export handlers) read the `arr_type` from records and build URLs or API payloads using strings like `${arr_type}_naming`/`${arr_type}_media_settings`, so any config whose `arr_type` is not `radarr` or `sonarr` is never routed or cloned.

## Database

### Relevant Tables

- `radarr_naming` / `sonarr_naming`: store named movie/episode naming templates (formats, rename flags, colon replacement, multi-episode styles) referenced by `list`/`get*ByName` readers in `src/lib/server/pcd/entities/mediaManagement/naming/read.ts` and created via the `createRadarrNaming`/`createSonarrNaming` helpers in `create.ts`.
- `radarr_media_settings` / `sonarr_media_settings`: contain media settings (`propers_repacks`, `enable_media_info`) surfaced in `media-settings` readers (`media-settings/read.ts`) and writers (`create.ts`, `update.ts`).
- `radarr_quality_definitions` / `sonarr_quality_definitions`: map config `name` + `quality_name` → size limits; `quality-definitions/read.ts` lists distinct configs and `create.ts`/`update.ts` insert/delete the per-quality rows.
- `quality_api_mappings`: ties canonical `quality_name` → `api_name` per `arr_type` (schema in `docs/pcdReference/0.schema.sql`); `mediaManagement/syncer.ts` and `quality-definitions/read.ts` filter this table by `arr_type` to know which qualities are available or how to map to the Arr API. Currently the schema documents only `arr_type = 'radarr' | 'sonarr'`, so there’s no seeded data for `lidarr`.
- `arr_sync_media_management`: keeps the chosen database/config per media-management surface and sync trigger details (`src/lib/server/db/schema.sql` and `arrSync.ts`); the syncer reads the trio of `naming`, `quality_definitions`, and `media_settings` (`*_database_id`, `*_config_name`) per instance to know which preset to push.
- `arr_instances`: catalogs every Arr application instance, including `type` (`radarr`, `sonarr`, `lidarr`, `readarr`, `prowlarr`), base URL, and API key. Syncs stage behavior based on `instance.type` (`src/lib/server/db/schema.sql` and `src/lib/shared/arr/capabilities.ts`).
- `database_instances`: stores each PCD repo (UUID, repository URL, PAT/local path, conflict strategy) that backs the UI screens listing media-management presets.

### Schema Details

`arr_sync_media_management` uses nullable foreign keys to `database_instances(id)` for each surface plus a `trigger/cron/next_run_at` stack, so enabling Lidarr support requires wiring the Lidarr instance’s record in `arr_instances` to these columns exactly like Radarr/Sonarr. The PCD tables enforce stable keys on `name` (e.g., `radarr_naming.name` is `PRIMARY KEY`), and `quality_api_mappings` enforces `(quality_name, arr_type)` uniqueness while referencing `qualities(name)` for canonical lists (`docs/pcdReference/0.schema.sql`). Since the media-management readers each do `SELECT` from both `radarr_*` and `sonarr_*` tables and tag rows with `arr_type: 'radarr' | 'sonarr'`, no row ever carries `lidarr` in the UI, even though `src/lib/shared/pcd/types.ts` defines `ArrType = 'radarr' | 'sonarr' | 'lidarr' | 'all'`. The syncer (`src/lib/server/sync/mediaManagement/syncer.ts`) then pulls the right config via `arrSyncQueries.getMediaManagementSync()` and conditionally reuses the Sonarr naming/media settings/quality definitions for `instanceType === 'lidarr'`, capability-gating unsupported fields via `LIDARR_UNSUPPORTED_*` constants.

## External Services

`Media management` sync pushes configs to the third-party Arr APIs (Radarr, Sonarr, Lidarr) through the same `BaseSyncer` subclass in `src/lib/server/sync/mediaManagement/syncer.ts`. For Lidarr, the syncer deliberately reuses the Sonarr tables/templates and logs reasons such as `Lidarr v1 reuses Sonarr media-management entities` or `Lidarr quality definition sync applies only entries with Lidarr mappings` to explain skipped fields. The only external credentials shown in the repo are stored per Arr instance (`arr_instances.url`/`api_key`) and in `.env.local` for CLI secrets (e.g., `LIDARR_API_KEY` gets decrypted via `dotenvx`’s `DOTENV_PUBLIC_KEY_LOCAL`). Unlike Radarr/Sonarr, no `lidarr_*` entity routes or portable types exist, so the Git-based import/export path (`/api/v1/pcd/import` and `/api/v1/pcd/export`) cannot emit or consume Lidarr-specific media-management presets today.

## Internal Services

PCD operations are centralized in the `pcdManager` (re-exported by `src/lib/server/pcd/index.ts`), which caches each `database_instances` repo and exposes `writeOperation` helpers. `Media-management` CRUD lives in `src/lib/server/pcd/entities/mediaManagement/{naming,media-settings,quality-definitions}/`—each folder has `read.ts`, `create.ts`, `update.ts`, `delete.ts`, and `override.ts` modules that wrap `writeOperation` and guard against case-insensitive duplicates. The UI forms call these through their `actions` providers (e.g., `naming/new/+page.server.ts`), but the handlers explicitly require `arrType === 'radarr' | 'sonarr'` before choosing which entity table to touch. The sync pipeline relies on `src/lib/server/db/queries/arrSync.ts` to fetch the configured database/config names, then uses `MediaManagementSyncer` to pull data via the same `get*ByName` readers and to push it through the Arr API client (`this.client.getNamingConfig()`/`update*`). Quality definitions also call `getQualityApiMappings(cache)` to translate PCD `quality_name` strings into Arr API names per `arr_type`, so any missing `lidarr` mappings mean `updatedCount` stays zero and the syncer skips that surface.

## Configuration

Secrets are encrypted with `dotenvx` (see `DOTENV_PUBLIC_KEY_LOCAL` in `.env.local`) and include at least `OPENAI_API_KEY`, `GITHUB_API_TOKEN`, and `LIDARR_API_KEY`. Arr connections (Radarr/Sonarr/Lidarr) store their URL and API key per row in `arr_instances`, and each PCD repo under `database_instances` includes the Git repo URL, PAT, and local path used by `pcdManager`. Media-management sync configuration references those repos via `arr_sync_media_management`’s `_database_id`/`_config_name` columns, so enabling Lidarr in the UI also implies wiring the Lidarr `arr_instances.id` into those sync rows once a preset is selected.

1. Allow the media-management screens (list, clone/export, and the `new`/`edit` actions) to accept `arr_type = 'lidarr'`, reusing the Sonarr tables/listers so Lidarr presets appear alongside Radarr/Sonarr entries.
2. Seed `quality_api_mappings` with `arr_type = 'lidarr'` mappings and expand `getAvailableQualities` plus the forms’ `arrType` validation to request those mappings so Lidarr quality definitions can be defined and selected.
3. Extend portable entity handling (portable schema, `ENTITY_TYPES`, import/export, and clone modals) to expose `lidarr` naming/media/quality entries so those presets can be serialized/deserialized for repo sync and API backups.
