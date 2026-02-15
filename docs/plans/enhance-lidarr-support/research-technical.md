# Research: Technical Specification

## Executive Summary

The technical pivot is replacing implicit Sonarr reuse with explicit Lidarr entity families across schema, entity operations, API contracts, and sync resolution. The current architecture already separates media-management surfaces, so the safest change is adding parallel `lidarr_*` tables and handlers while keeping shared validation and operation-layer controls. Migration and compatibility are the highest-risk areas and must be handled as a staged cutover.

## Architecture Approach

- Keep existing layering:
  - Routes/actions -> entity operations -> DB/cache/write operations -> sync/import/export.
- Add first-class Lidarr operations in existing media-management modules rather than introducing a new subsystem.
- Update sync resolver to consume dedicated Lidarr entities directly.
- Preserve operation-layer permission checks and deterministic write metadata.

## Data Model Implications

- Add tables:
  - `lidarr_naming`
  - `lidarr_media_settings`
  - `lidarr_quality_definitions`
- Add/seed `quality_api_mappings` support for `arr_type = 'lidarr'`.
- Register new entities in type maps, registry, and portable schemas.
- Migration considerations:
  - copy/transform existing legacy rows,
  - update sync references,
  - prevent duplicate-name conflicts,
  - guarantee idempotent reruns.

## API Design Considerations

- Update import/export contracts to include new Lidarr entity types.
- Ensure route actions dispatch create/update/delete/list/get to Lidarr-specific operations for `arr_type = 'lidarr'`.
- Maintain current error handling style (`400` for validation, `500` for unexpected failures).
- Keep rename/delete propagation to `arr_sync_media_management` stable.

## System Constraints

- Performance: table expansion should follow existing indexing/key conventions to avoid list/query regressions.
- Security: preserve write-layer checks (`canWriteToBase`) and avoid fallback paths that hide missing schema support.
- Compatibility: temporary read-compatibility may be required during migration, but write target should be first-class Lidarr.

## File-Level Impact Preview

- Likely schema/migrations:
  - `docs/pcdReference/0.schema.sql`
  - `src/lib/server/db/migrations/*`
- Likely entity operation changes:
  - `src/lib/server/pcd/entities/mediaManagement/naming/*`
  - `src/lib/server/pcd/entities/mediaManagement/media-settings/*`
  - `src/lib/server/pcd/entities/mediaManagement/quality-definitions/*`
  - `src/lib/server/pcd/entities/registry.ts`
  - `src/lib/server/pcd/conflicts/override.ts`
- Likely API/sync changes:
  - `src/routes/api/v1/pcd/export/+server.ts`
  - `src/routes/api/v1/pcd/import/+server.ts`
  - `src/lib/shared/pcd/portable.ts`
  - `docs/api/v1/schemas/pcd.yaml`
  - `src/lib/server/sync/mediaManagement/syncer.ts`
- Likely UI route wiring:
  - `src/routes/media-management/[databaseId]/**/+page.server.ts`

## Open Technical Decisions

- Copy-all migration vs referenced-only migration strategy.
- Strict schema parity with Sonarr tables vs introducing Lidarr-native fields now.
- Compatibility window length and enforcement gates.
