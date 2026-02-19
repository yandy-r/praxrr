# Context Analysis: enhance-lidarr-support

## Executive Summary

The feature replaces Sonarr-backed Lidarr media-management reuse with first-class `lidarr_naming`, `lidarr_media_settings`, and `lidarr_quality_definitions` entities. The architecture should remain route -> entity module -> writeOperation -> sync/import-export, but all Lidarr paths must switch to dedicated entities with deterministic migration from legacy reused rows. Implementation success depends on synchronizing schema, portable contracts, sync resolution, and docs while preserving clear operator diagnostics.

## Architecture Context

- **System Structure**: Thin route handlers under `packages/praxrr-app/src/routes/media-management/[databaseId]/**` dispatch to PCD media-management entity modules.
- **Data Flow**: UI/API actions validate inputs, run entity operations through `writeOperation`, update sync configs, then syncer applies settings to Arr clients.
- **Integration Points**: schema + entity operations + portable contracts + sync resolver + route wiring + migration tests/docs.

## Critical Files Reference

- `/docs/pcdReference/0.schema.sql`: media-management table reference and required `lidarr_*` additions.
- `/packages/praxrr-app/src/lib/server/db/schema.sql`: runtime DB schema alignment.
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`: current naming read behavior.
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts`: write path pattern.
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts`: quality-mapping dependent reads.
- `/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: sync source resolution and apply behavior.
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: sync config persistence and rename propagation.
- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`: portable entity types and validation matrix.
- `/packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: import validation/deserialize entry.
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: export serialize entry.

## Patterns to Follow

- **Thin Route + Helper Modules**: Keep route handlers validation-focused and push persistence logic into entity modules.
- **Entity Family Split**: Maintain `read/create/update/delete` files per media-management family.
- **Deterministic Writes**: Preserve `writeOperation` metadata and layer validation patterns.
- **Fail-Fast Validation**: Return explicit errors for invalid arr type, payload, and mapping gaps.

## Cross-Cutting Concerns

- Migration must be deterministic and idempotent.
- `quality_api_mappings` must include Lidarr coverage before enabling full cutover.
- Portable/OpenAPI/runtime contracts must be updated together.
- UX should expose legacy/native state and migration outcomes clearly.
- Regression coverage must include CRUD, sync, import/export, migration reruns.

## Parallelization Opportunities

- Phase 1 data work (schema + mappings + portable contracts) can proceed together.
- Phase 2 can split between entity modules, route/API wiring, and sync resolver changes.
- Phase 3 testing and docs can run in parallel once behavior is stable.

## Implementation Constraints

- Keep `canWriteToBase` and existing permission checks intact.
- Avoid fallback behavior that silently reuses Sonarr in default Lidarr paths.
- Preserve deterministic config-name behavior in `arr_sync_media_management` updates.

## Key Recommendations

- Execute in 3 phases: foundation, cutover, hardening.
- Prioritize migration safety and explicit conflict handling.
- Update schema/contracts/docs synchronously with runtime behavior.
