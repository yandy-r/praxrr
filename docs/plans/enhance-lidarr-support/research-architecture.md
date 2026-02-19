# Architecture Research: enhance-lidarr-support

## System Overview

Media-management is structured as thin SvelteKit route handlers that delegate to server-side PCD entity modules for CRUD and list behavior. The data path runs through `pcdManager` caches and `writeOperation`, with sync handled separately by the media-management syncer that currently maps Lidarr to Sonarr-backed storage. The implementation target is to keep the same layering but introduce first-class `lidarr_*` entities so Lidarr no longer relies on Sonarr reuse defaults.

## Relevant Components

- `packages/praxrr-app/src/routes/media-management/[databaseId]/**/+page.server.ts`: load/action entry points for naming, media settings, quality definitions.
- `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/*`: naming list/get/create/update/delete operations.
- `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/*`: media settings operations.
- `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/*`: quality definitions operations and mapping-aware reads.
- `packages/praxrr-app/src/lib/server/pcd/index.ts`: `pcdManager`, cache access, and write operation orchestration.
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: downstream sync to Arr instances with current Lidarr reuse logic.
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: sync config persistence and rename propagation.
- `packages/praxrr-app/src/lib/shared/pcd/portable.ts`: portable entity typing and Lidarr matrix rules.
- `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: import validation + deserialization path.
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: export serialization path.

## Data Flow

1. Route load/action resolves `databaseId` and obtains a PCD cache via `pcdManager`.
2. Entity modules read/write media-management tables through typed helpers and `writeOperation`.
3. Import/export routes validate portable payloads and serialize/deserialize via shared entity utilities.
4. Sync reads `arr_sync_media_management`, resolves selected config names, and applies values to target Arr clients.
5. Quality-definition behavior depends on `quality_api_mappings` to map config entries to Arr API names.

## Integration Points

- Add first-class Lidarr CRUD/read/list/get operations in each media-management entity module.
- Update route action dispatch to call dedicated Lidarr handlers instead of Sonarr-backed fallbacks.
- Update sync resolution maps to point Lidarr to `lidarr_*` entities and remove reuse-default behavior.
- Expand import/export/portable contracts and validation for first-class `lidarr_*` entity types.
- Keep `arr_sync_media_management` name updates aligned during create/rename/delete flows.

## Key Dependencies

- `packages/praxrr-app/src/lib/server/pcd/index.ts` (`pcdManager`, write orchestration)
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts` (sync orchestration)
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` (sync config storage)
- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts` (capability gating)
- `docs/pcdReference/0.schema.sql` and `packages/praxrr-app/src/lib/server/db/schema.sql` (table foundations)
