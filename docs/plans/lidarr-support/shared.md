# Lidarr Support

Lidarr support for media-management is partially wired: the shared arr types and sync stack already recognize `lidarr`, but the UI CRUD routes and entity readers/writers for naming, media settings, and quality definitions still branch only on `radarr` and `sonarr`. The media-management route tree under `/src/routes/media-management/[databaseId]/...` drives listing and form actions, while actual data access lives in `/src/lib/server/pcd/entities/mediaManagement/...` against PCD cache tables. Sync behavior in `/src/lib/server/sync/mediaManagement/syncer.ts` already applies Lidarr by reusing Sonarr-backed entities with capability gating, which creates a mismatch between sync capability and UI/config creation capability. Finalizing this feature means extending route/action validation, table/query selection, and portable entity handling so Lidarr presets can be viewed, created, edited, exported, and imported consistently.

## Relevant Files

- /src/routes/media-management/[databaseId]/naming/+page.server.ts: Naming list loader; currently reads only Radarr/Sonarr-backed entries.
- /src/routes/media-management/[databaseId]/quality-definitions/+page.server.ts: Quality definitions list loader; omits Lidarr rows.
- /src/routes/media-management/[databaseId]/media-settings/+page.server.ts: Media settings list loader; same arr-type limitation.
- /src/routes/media-management/[databaseId]/naming/new/+page.server.ts: Create action validates only `radarr`/`sonarr` arr types.
- /src/routes/media-management/[databaseId]/quality-definitions/new/+page.server.ts: New quality definition action excludes Lidarr creation.
- /src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts: New media settings action excludes Lidarr creation.
- /src/lib/server/pcd/entities/mediaManagement/naming/read.ts: Naming readers combine Radarr/Sonarr tables into list output.
- /src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts: Media settings readers currently branch by Radarr/Sonarr.
- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts: Quality definition list/read path missing Lidarr handling.
- /src/lib/server/pcd/entities/mediaManagement/naming/create.ts: Naming write path has no Lidarr create branch.
- /src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts: Media settings write path has no Lidarr branch.
- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts: Quality definition writes are limited to Radarr/Sonarr.
- /src/lib/server/sync/mediaManagement/syncer.ts: Lidarr sync reuse/capability-gating behavior to align with UI.
- /src/lib/server/db/queries/arrSync.ts: Sync config persistence impacted by config-name/arr-type updates.
- /src/lib/shared/pcd/types.ts: Arr type unions and PCD table typing context.
- /src/lib/shared/arr/capabilities.ts: Arr app capability metadata including Lidarr support signals.

## Relevant Tables

- radarr_naming: Existing naming presets used by current naming UI/actions.
- sonarr_naming: Existing naming presets currently reused for Lidarr sync behavior.
- radarr_media_settings: Current media settings source for Radarr configs.
- sonarr_media_settings: Current media settings source for Sonarr and Lidarr reuse path.
- radarr_quality_definitions: Current quality definition rows for Radarr.
- sonarr_quality_definitions: Current quality definition rows for Sonarr and Lidarr reuse path.
- quality_api_mappings: Quality name to API mapping by `arr_type`; missing Lidarr mappings blocks full support.
- arr_sync_media_management: Selected config names/databases for sync per instance.
- arr_instances: Arr instance type (`radarr`/`sonarr`/`lidarr`) and credentials.
- database_instances: Source PCD repositories backing media-management data.

## Relevant Patterns

**Arr-Type Validation in Route Actions**: Actions fail fast on unsupported `arrType` values before dispatching writes. See [/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts](/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts).

**Entity-Scoped CRUD Modules**: Each media-management surface keeps read/create/update/delete per entity folder and arr-specific branches inside operations. See [/src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts](/src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts).

**Lidarr Capability-Gated Reuse**: Lidarr sync currently reuses Sonarr entities and logs unsupported-field skips instead of separate tables. See [/src/lib/server/sync/mediaManagement/syncer.ts](/src/lib/server/sync/mediaManagement/syncer.ts).

**Portable Entity Type Gating**: Import/export accepts only declared entity types, so Lidarr support requires extending portable type sets. See [/docs/api/v1/schemas/pcd.yaml](/docs/api/v1/schemas/pcd.yaml).

## Relevant Docs

**/docs/ARCHITECTURE.md**: You _must_ read this when working on media-management route/entity boundaries.

**/docs/api/v1/schemas/pcd.yaml**: You _must_ read this when working on import/export and portable Lidarr entity strategy.

**/docs/api/v1/schemas/arr.yaml**: You _must_ read this when working on current Lidarr API payload expectations.

**/README.md**: You _must_ read this when working on project-level Lidarr branch context and constraints.
