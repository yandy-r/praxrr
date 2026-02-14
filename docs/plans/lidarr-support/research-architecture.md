# Architecture Research: lidarr-support

## System Overview

Profilarr is a SvelteKit/Deno application whose front-end routes (e.g., `src/routes/media-management/…`) orchestrate requests and server-side `load` logic, while all data manipulation flows through the `pcdManager`/PCD cache layer (`src/lib/server/pcd/*`). The `pcdManager` is initialized in `src/hooks.server.ts` on every server start and exposes caches (`pcdCache` → `cache.kb`/Kysely) plus write helpers, so each media-management page can read/write against the compiled database schema without CSV/REST latencies. Above that, arr metadata (available apps, supported surfaces, arr types) lives in `src/lib/shared/arr/capabilities.ts` and `src/lib/shared/pcd/types.ts`, making lidarr a first-class arr type in the type system even though the media-management entities currently only query Radarr/Sonarr tables.

## Relevant Components

- `src/routes/media-management/+page.server.ts` and `src/routes/media-management/[databaseId]/+layout.server.ts`: entry points that gather all linked databases from `pcdManager`, detect the selected section (`naming`, `media-settings`, `quality-definitions`), and surface `canWriteToBase` for child actions, so every media-management tab starts from a consistent context.
- `src/lib/server/pcd/entities/mediaManagement/{naming,media-settings,quality-definitions}/*`: read/create/update/delete helpers that only query Radarr/Sonarr tables (e.g., `naming/read.ts`, `media-settings/read.ts`, `quality-definitions/read.ts`), enforcing arr-specific SQL paths even though the cache already knows about lidarr tables via `pcd` schema types; these helpers are the “business logic hot path” for CRUD operations invoked by the routes under `src/routes/media-management/[databaseId]/…`.
- `src/lib/server/pcd/index.ts` plus `src/lib/server/pcd/core/manager.ts`: the public API and lifecycle orchestrator that clones databases, compiles operations into the in-memory cache (`PCDCache` constructs a `Kysely<PCDDatabase>` in `cache.ts`), exposes `getCache`/`canWriteToBase`, and syncs via hooks (jobs, arr sync handlers, etc.), so every media-settings/quality-definition change ultimately walks this stack before hitting SQLite.
- `src/lib/shared/arr/capabilities.ts` and `src/lib/shared/pcd/types.ts`: shared metadata that enumerate `ArrAppType`/`ArrType` (`radarr`, `sonarr`, `lidarr`, `all`) and describe arr capabilities, meaning ule-level enums are ready for lidarr once the stack plugs into the radarr/sonarr-specific entity code.

## Data Flow

A media-management page request (e.g., `src/routes/media-management/[databaseId]/naming/+page.server.ts`) uses `pcdManager.getCache(databaseId)` to fetch the compiled cache from `PCDCache`. That cache exposes `cache.kb`, a `Kysely<PCDDatabase>` instance defined in `src/lib/shared/pcd/types.ts`, which the entity helpers call (`mediaManagement/naming/read.ts`, `mediaManagement/media-settings/read.ts`, `quality-definitions/read.ts`) to query the arr-specific tables (e.g., `radarr_naming`, `sonarr_media_settings`). Form submissions hit the `actions` endpoints under the same route tree, which validate arr type, enforce `canWriteToBase`, and call the entity create/update/delete helpers before redirecting; helper operations like `createRadarrNaming` ultimately log to arr operation history and can trigger `arrSyncQueries` (`src/lib/server/db/queries/arrSync.ts`) to keep sync metadata in sync after config renames.

## Integration Points

Lidarr support needs to be wired into every layer that currently splits Radarr/Sonarr:

- Extend the entity helpers in `src/lib/server/pcd/entities/mediaManagement/...` to support Lidarr tables (`lidarr_naming`, `lidarr_media_settings`, `lidarr_quality_definitions`) in the read/create/update/delete flows, alongside the existing Radarr/Sonarr branches.
- Update the media-management routes (`src/routes/media-management/[databaseId]/naming`, `media-settings`, `quality-definitions` plus their `[name]` subroutes) to allow `arrType = 'lidarr'` in forms, routing, and `arrSyncQueries` updates so lidarr config renames show up in sync settings.
- Ensure the shared schemas/types (`src/lib/shared/pcd/types.ts`, `src/lib/shared/pcd/display.ts`) describe any lidarr-specific rows you add and that UI selections (e.g., `ARR_APPS` in `src/lib/shared/arr/capabilities.ts`) expose lidarr in the section selectors/forms so users can pick it uniformly with Radarr/Sonarr.

## Key Dependencies

- **SvelteKit/Deno runtime** (`src/routes/**`, `src/hooks.server.ts`, `deno.json`): handles routing, server loads/actions, and startup sequence (hooks initialize DB and `pcdManager`).
- **PCD layer** (`src/lib/server/pcd/*`): `pcdManager`, `PCDCache`, operation writers, and manifest/dependency helpers manage cloning/syncing Profilarr-compliant DBs and expose caches used by media-management routes.
- **Kysely + SQLite** (`src/lib/server/pcd/database/cache.ts` uses `Kysely<PCDDatabase>` with `DenoSqlite3Dialect`): the in-memory cache that media-management entity helpers query for arr tables.
- **ARR metadata/types** (`src/lib/shared/arr/capabilities.ts`, `src/lib/shared/pcd/types.ts`, `src/lib/shared/pcd/display.ts`): define arr type enums, arr app capabilities (including Lidarr), and result shapes used by UI/logic.
- **Sync helpers** (`src/lib/server/db/queries/arrSync.ts` and job handlers under `src/lib/server/jobs/*`): consumed when arr config names change so `arr_sync_media_management` stays accurate for downstream sync pipelines.
