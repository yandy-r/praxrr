# Integration Research: enhance-lidarr-support

## API Endpoints

### Existing Related Endpoints

- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/+page.server.ts`: naming list page loader.
- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts`: naming create action.
- `packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/+page.server.ts`: media settings list loader.
- `packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts`: media settings create action.
- `packages/praxrr-app/src/routes/media-management/[databaseId]/quality-definitions/+page.server.ts`: quality definitions list loader.
- `packages/praxrr-app/src/routes/media-management/[databaseId]/quality-definitions/new/+page.server.ts`: quality definitions create action.
- `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: portable import.
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: portable export.

### Route Organization

Media-management routes are organized by `[databaseId]` and section, with section-specific list/new/detail handlers. API routes under `/api/v1/pcd/*` provide import/export contracts and use shared serialize/deserialize + validation helpers.

## Database

### Relevant Tables

- `radarr_naming`, `sonarr_naming`: current naming storage families.
- `radarr_media_settings`, `sonarr_media_settings`: current media settings storage families.
- `radarr_quality_definitions`, `sonarr_quality_definitions`: current quality-definition storage families.
- `quality_api_mappings`: arr-type + quality mapping lookup used by UI and sync.
- `arr_instances`: Arr instance registry including `type` and credentials.
- `database_instances`: known PCD databases.
- `arr_sync_media_management`: selected config names, schedule, and sync status.

### Schema Details

Current schema and behavior indicate Lidarr media-management reuse of Sonarr-backed entities in operational paths. First-class Lidarr support requires adding dedicated `lidarr_*` families and ensuring `quality_api_mappings` coverage for `arr_type = 'lidarr'`.

## External Services

- `packages/praxrr-app/src/lib/server/utils/arr/base.ts`: common Arr API client operations.
- `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr-specific client behavior.
- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: instance-type-driven client selection.

## Internal Services

- `packages/praxrr-app/src/lib/server/pcd/index.ts`: cache manager and write operation execution.
- `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/*`: CRUD/read/list/get logic.
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: sync resolution and apply pipeline.
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: sync config CRUD + rename propagation.
- `packages/praxrr-app/src/lib/shared/pcd/portable.ts`: portable entity type matrix and metadata.

## Configuration

- Arr instance auth/config from `arr_instances` rows (`url`, `api_key`, `type`).
- PCD database/config from `database_instances` and repository settings.
- Sync scheduling/config from `arr_sync_media_management`.
- Environment secrets in `.env.local` (including Lidarr API key for local/dev workflows).
