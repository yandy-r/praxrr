# Lidarr Technical Specification Research

## Executive Summary

The codebase already contains a `LidarrClient` stub and factory wiring, but most functional entry points branch only for Radarr/Sonarr. The cleanest path is to preserve existing architectural seams (instance CRUD, client factory, section-based syncers, API routes, and typed schemas) and add Lidarr as a first-class branch at each seam. Main technical risk is type-system fragmentation: multiple layers currently define arr-type unions independently and are inconsistent.

## Architecture Approach

- Keep current layering and extend by branch:
  - instance persistence: `src/lib/server/db/queries/arrInstances.ts`
  - client creation: `src/lib/server/utils/arr/factory.ts`
  - API aggregation: `src/routes/api/v1/arr/library/+server.ts`, `src/routes/api/v1/arr/releases/+server.ts`
  - sync orchestration: `src/lib/server/jobs/handlers/arrSync.ts`, `src/lib/server/sync/**`
- Avoid introducing a parallel Lidarr-only pipeline. Reuse current queue/registry/cache/logging patterns.
- Prefer capability-gated route/UI behavior for features not available in phase 1 (rename/upgrades) to avoid false parity claims.

## Data Model Implications

- Internal app DB (`arr_instances`) already accepts arbitrary `type` text and comments include `lidarr` (`src/lib/server/db/schema.sql`).
- PCD typings are currently dual-app:
  - `src/lib/shared/pcd/types.ts` defines only `radarr_*` and `sonarr_*` media-management tables.
  - `ArrType` union there is `'radarr' | 'sonarr' | 'all'` (no Lidarr).
- OpenAPI schema enums are dual-app:
  - `docs/api/v1/schemas/arr.yaml` -> `ArrType` is Radarr/Sonarr only.
  - `docs/api/v1/schemas/pcd.yaml` `EntityType` excludes Lidarr media-management entities.
- Sync mapping layer is dual-app:
  - `SyncArrType` only includes Radarr/Sonarr in `src/lib/server/sync/mappings.ts`.

## API Design Considerations

- Onboarding and connection tests block Lidarr today:
  - `VALID_TYPES` in `src/routes/arr/new/+page.server.ts` and `src/routes/arr/test/+server.ts`.
- Library and release endpoints reject unsupported types via explicit fallback branches:
  - `src/routes/api/v1/arr/library/+server.ts`
  - `src/routes/api/v1/arr/releases/+server.ts`
- API contracts must be extended end-to-end:
  - source schemas in `docs/api/v1/schemas/arr.yaml` + `docs/api/v1/schemas/pcd.yaml`
  - generated typings in `src/lib/api/v1.d.ts`
- Existing error envelope behavior should be preserved (`{ error: string }`) for 4xx/5xx responses.

## System Constraints

- Current operational model relies on:
  - library caching TTL = 300s in `src/routes/api/v1/arr/library/+server.ts`
  - section-based sync status/claiming in `arrSyncQueries` + handlers
  - strict route-level type checks in several pages
- Rename and upgrades are intentionally constrained:
  - rename allows only Radarr/Sonarr (`src/lib/server/jobs/handlers/arrRename.ts`)
  - upgrades allow only Radarr (`src/routes/arr/[id]/upgrades/+page.server.ts`)
- Frontend assumptions are heavily dual-app:
  - hardcoded type dropdown/options and logos in Arr pages
  - custom-format condition toggles are Radarr/Sonarr-only (`ConditionCard.svelte`)

## File-Level Impact Preview

- Likely files to modify (high-confidence)
  - `src/routes/arr/test/+server.ts`
  - `src/routes/arr/new/+page.server.ts`
  - `src/routes/arr/components/InstanceForm.svelte`
  - `src/routes/api/v1/arr/library/+server.ts`
  - `src/routes/api/v1/arr/releases/+server.ts`
  - `src/lib/server/utils/arr/clients/lidarr.ts`
  - `src/lib/server/utils/arr/types.ts`
  - `src/lib/shared/pcd/types.ts`
  - `src/lib/shared/pcd/display.ts`
  - `src/lib/server/sync/mappings.ts`
  - `docs/api/v1/schemas/arr.yaml`
  - `docs/api/v1/schemas/pcd.yaml`
  - `src/lib/api/v1.d.ts` (regenerated)
- Potentially affected files (phase dependent)
  - `src/routes/arr/[id]/library/+page.svelte`
  - `src/routes/custom-formats/[databaseId]/[id]/conditions/components/ConditionCard.svelte`
  - `src/lib/server/jobs/handlers/arrRename.ts`
  - `src/routes/arr/[id]/rename/+page.server.ts`
  - `src/routes/arr/[id]/upgrades/+page.server.ts`
  - media-management CRUD modules under `src/lib/server/pcd/entities/mediaManagement/**`
