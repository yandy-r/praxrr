# Enhance Lidarr Support

Media-management in this codebase flows from SvelteKit route handlers into PCD entity modules, then through `writeOperation` into cache-backed tables and sync pipelines. Lidarr currently rides Sonarr-backed storage defaults in key CRUD/sync/import paths, so architectural fit is strongest when we add dedicated `lidarr_*` entities while preserving existing route and operation patterns. Sync configuration and rename propagation are controlled centrally through `arr_sync_media_management` query helpers, making deterministic migration and config-name continuity critical. Implementation should align runtime entities, portable contracts, and sync resolvers in one coordinated cutover to eliminate reuse behavior without breaking existing configs.

## Relevant Files

- /src/lib/server/pcd/index.ts: Cache manager and write orchestration entrypoint.
- /src/lib/server/pcd/entities/mediaManagement/naming/read.ts: Naming reads and arr-type shaping.
- /src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts: Media settings write path pattern.
- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts: Quality mapping-aware reads.
- /src/lib/server/sync/mediaManagement/syncer.ts: Arr sync resolution and apply pipeline.
- /src/lib/server/db/queries/arrSync.ts: Sync config storage and rename propagation.
- /src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts: Route action validation and dispatch.
- /src/routes/api/v1/pcd/import/+server.ts: Import validation and deserialization entrypoint.
- /src/routes/api/v1/pcd/export/+server.ts: Export serialization and response contract.
- /src/lib/shared/pcd/portable.ts: Portable entity types and Lidarr matrix rules.
- /src/lib/shared/arr/capabilities.ts: Feature gating and arr-type capability definitions.
- /docs/pcdReference/0.schema.sql: PCD schema reference for media-management entities.
- /src/lib/server/db/schema.sql: Runtime DB schema for instances and sync config.

## Relevant Tables

- `radarr_naming`: Existing Radarr naming configurations.
- `sonarr_naming`: Existing Sonarr naming configurations.
- `radarr_media_settings`: Existing Radarr media settings.
- `sonarr_media_settings`: Existing Sonarr media settings.
- `radarr_quality_definitions`: Existing Radarr quality definition sets.
- `sonarr_quality_definitions`: Existing Sonarr quality definition sets.
- `quality_api_mappings`: Arr-type quality mapping lookup used in UI/sync.
- `arr_instances`: Arr instance metadata and credentials.
- `database_instances`: PCD database registry and repo metadata.
- `arr_sync_media_management`: Per-instance selected configs, schedule, and sync status.

## Relevant Patterns

**Thin Route + Entity Helper**: Route handlers validate/dispatch while entity modules own persistence logic. Example: [`src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts`](src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts).

**Entity Family Module Split**: Each media-management family uses `read/create/update/delete` module separation. Example: [`src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts`](src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts).

**Deterministic Write Metadata**: Mutations flow through operation-layer-aware `writeOperation` metadata for traceability. Example: [`src/lib/server/pcd/index.ts`](src/lib/server/pcd/index.ts).

**Sync Resolver Mapping**: Sync logic resolves config source by arr type and applies mapped updates. Example: [`src/lib/server/sync/mediaManagement/syncer.ts`](src/lib/server/sync/mediaManagement/syncer.ts).

## Relevant Docs

**`docs/ARCHITECTURE.md`**: You _must_ read this when working on media-management architecture and data flow.

**`docs/api/v1/schemas/pcd.yaml`**: You _must_ read this when changing import/export entity contracts.

**`docs/plans/enhance-lidarr-support/feature-spec.md`**: You _must_ read this when implementing scope, risks, and acceptance criteria.

**`docs/plans/lidarr-support/shared.md`**: You _must_ read this when reusing prior Lidarr integration research and known gaps.

**`docs/DEVELOPMENT.md`**: You _must_ read this when aligning workflow, testing, and contribution conventions.

**`README.md`**: You _must_ read this when aligning with current project direction and constraints.
