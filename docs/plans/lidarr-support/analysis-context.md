### Executive Summary

Lidarr support for media-management naming, media settings, and quality definitions requires extending existing Radarr/Sonarr route actions, entity helpers, and portable import/export metadata so `arr_type = 'lidarr'` can be listed, created, edited, and synced. The UI routes under `/src/routes/media-management/[databaseId]/{naming,quality-definitions,media-settings}` and backend PCD entity modules currently branch only on Radarr/Sonarr. The plan should add Lidarr across those layers while preserving the existing Lidarr syncer strategy that reuses Sonarr-backed entities with capability gating.

### Architecture Context

- System Structure: Media-management UI routes delegate to `src/lib/server/pcd/entities/mediaManagement/{...}` helpers that wrap `writeOperation` and PCD cache access; those helpers currently have explicit Radarr/Sonarr branches.
- Data Flow: Route loaders call `pcdManager.getCache(databaseId)` and read `radarr_*`/`sonarr_*` tables; form actions validate `arrType`, dispatch to `createRadarr*`/`createSonarr*`, then update sync metadata via `arrSyncQueries`.
- Integration Points: Extend route loaders/actions, entity `read/create/update/delete` paths, shared arr types/capabilities, portable entity types/schema, `quality_api_mappings`, and sync metadata integration.

### Critical Files Reference

- `/docs/plans/lidarr-support/shared.md`: baseline feature scope and affected files/tables.
- `/src/routes/media-management/[databaseId]/naming/+page.server.ts`: naming list/load integration point.
- `/src/routes/media-management/[databaseId]/naming/new/+page.server.ts`: naming create action arr-type validation point.
- `/src/routes/media-management/[databaseId]/quality-definitions/+page.server.ts`: quality definitions list integration point.
- `/src/routes/media-management/[databaseId]/quality-definitions/new/+page.server.ts`: quality definitions create action arr-type validation point.
- `/src/routes/media-management/[databaseId]/media-settings/+page.server.ts`: media settings list integration point.
- `/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts`: media settings create action arr-type validation point.
- `/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`: naming read/list logic.
- `/src/lib/server/pcd/entities/mediaManagement/naming/create.ts`: naming create logic.
- `/src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts`: media settings read/list logic.
- `/src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts`: media settings create logic.
- `/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts`: quality definitions read/list logic.
- `/src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts`: quality definitions create logic.
- `/src/lib/server/sync/mediaManagement/syncer.ts`: existing Lidarr capability-gated reuse behavior.
- `/src/lib/server/db/queries/arrSync.ts`: sync metadata updates impacted by config changes.
- `/src/lib/shared/pcd/types.ts`: arr type unions and PCD typing.
- `/src/lib/shared/arr/capabilities.ts`: arr capabilities metadata.
- `/src/lib/shared/pcd/portable.ts`: portable entity type gates for import/export.
- `/docs/api/v1/schemas/pcd.yaml`: portable entity schema documentation.

### Patterns to Follow

- Pattern: Arr-type validation in actions; allow `lidarr` while preserving existing fail-fast checks and dispatch style. Example: `/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts`.
- Pattern: Per-entity CRUD modules under `mediaManagement/<entity>/{read,create,update,delete}.ts` with explicit arr branches. Example: `/src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts`.
- Pattern: Lidarr capability-gated reuse in sync path; UI and writes must stay consistent with what syncer can apply. Example: `/src/lib/server/sync/mediaManagement/syncer.ts`.
- Pattern: Portable entity type gating in import/export contract; extend types in lockstep with route/entity support. Example: `/src/lib/shared/pcd/portable.ts`.

### Cross-Cutting Concerns

- Security: Preserve `canWriteToBase`, strict arr-type validation, and explicit error responses in route actions.
- Performance: Keep reads/writes on shared PCD cache/Kysely paths; avoid redundant queries.
- Testing: Add Lidarr coverage for loaders/actions, entity helpers, portable import/export, and sync interactions.

### Parallelization Opportunities

- Independent area: route action/list changes for `naming`, `quality-definitions`, and `media-settings` can proceed in parallel once helper contracts are clear.
- Independent area: portable type/schema updates and clone/export adjustments can run in parallel with route work.
- Coordination hotspot: `quality_api_mappings` and sync behavior must align with UI options to avoid silent sync skips.

### Implementation Constraints

- Use exact arr type string `lidarr` everywhere.
- Maintain current v1 strategy: Lidarr reuses existing Sonarr/Radarr media-management shapes until dedicated tables are introduced.
- Ensure import/export entity-type validation supports Lidarr strategy without breaking existing Radarr/Sonarr flows.
- Seed/confirm `quality_api_mappings` for `arr_type = 'lidarr'` so quality definitions are usable.

### Planning Recommendations

- Organize work in phased order: foundation (types/schema/mappings) -> feature flows (routes/entities) -> integration verification (sync/import/export/tests).
- Keep tasks narrow (1-3 files each) to maximize safe parallel execution.
- Explicitly annotate each task dependency to avoid sequencing ambiguity across naming/media-settings/quality-definitions workstreams.
