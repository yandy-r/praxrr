# Context Analysis: lidarr-metadata-profiles

## Executive Summary

Lidarr metadata profiles should be implemented as a dedicated Lidarr-only entity family in PCD plus a new sync section, reusing existing quality/delay/media-management architecture patterns. The feature spans schema, shared types, entity CRUD, Arr sync config/state, Lidarr client methods, and UI/API integration, but no new platform primitives are required. The main success factor is contract fidelity across schema, runtime validators, and sync transformations while strictly enforcing `arr_type = 'lidarr'` and avoiding sibling-app fallbacks.

## Architecture Context

- **System Structure**: PCD entity modules write operations through `writeOperation`; sync handlers register by section and are orchestrated by `sync/processor.ts`; Arr clients encapsulate remote API calls.
- **Data Flow**: UI/API submits metadata profile changes -> PCD operations compile to cache tables -> arr sync section reads selected profile config -> syncer reconciles to Lidarr `/api/v1/metadataprofile` payloads -> sync status persists in `arr_sync_*` config rows.
- **Integration Points**: New metadata profile tables + migration, new entity module under `pcd/entities`, new sync section under `sync/metadataProfiles`, new Arr client methods in `LidarrClient`, new PCD API routes, and Lidarr-only sync config UI extensions.

## Critical Files Reference

- `packages/praxrr-app/src/lib/server/db/migrations.ts`: Registers new migration files into runtime migrator.
- `packages/praxrr-app/src/lib/server/db/schema.sql`: App DB schema source for `arr_sync_*` config/status tables.
- `docs/pcdReference/0.schema.sql`: PCD base schema reference used by generated PCD types.
- `packages/praxrr-app/src/lib/shared/pcd/types.ts`: Generated table interfaces and DB typing for PCD cache access.
- `packages/praxrr-app/src/lib/shared/pcd/portable.ts`: Portable entity definitions and import/export type catalog.
- `packages/praxrr-app/src/lib/server/pcd/entities/registry.ts`: Auto-align entity registry and stable key metadata mapping.
- `packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`: Built-in schema/base-op seeding for new databases.
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Sync config read/write and lifecycle operations.
- `packages/praxrr-app/src/lib/server/sync/types.ts`: Section contracts and per-instance sync result typing.
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`: Section order and per-Arr supported section matrix.
- `packages/praxrr-app/src/lib/server/sync/processor.ts`: Schedules, claims, executes, and finalizes section sync runs.
- `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr v1 API surface and extension point for metadata profile methods.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: Sync configuration load/actions for Arr instance settings.
- `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: Portable import flow and entity-type routing.
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: Portable export flow and entity-type routing.

## Patterns to Follow

- **PCD Write Operation Pattern**: Keep CRUD changes funneled through `writeOperation` metadata for audit/conflict consistency (`packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/create.ts`).
- **Value Guard Pattern**: Apply guarded updates to prevent blind writes and improve conflict detection (`packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/update.ts`).
- **Sync Section Handler Pattern**: Implement `SectionHandler` methods in handler files and register by import side-effect (`packages/praxrr-app/src/lib/server/sync/delayProfiles/handler.ts`).
- **Arr-Specific Capability Pattern**: Add sync surface capability and gate it explicitly by Arr app in shared capabilities (`packages/praxrr-app/src/lib/shared/arr/capabilities.ts`).
- **Arr-Specific Support Matrix Pattern**: Keep section support explicit by app in `SUPPORTED_SYNC_SECTIONS` with Lidarr-only addition for metadata profiles (`packages/praxrr-app/src/lib/server/sync/mappings.ts`).

## Cross-Cutting Concerns

- Cross-Arr policy: metadata profiles must never dispatch to Radarr/Sonarr semantics.
- Contract fidelity: schema/table names, portable payload fields, and runtime validators must align exactly.
- Sync safety: use deterministic name-based reconciliation and preserve namespace suffix behavior.
- Validation: enforce reserved-name and minimum-selection rules before sync attempts.
- Test coverage: combine entity, sync/query, and capability gating tests to avoid regressions.

## Parallelization Opportunities

- Migration/schema updates can run in parallel with capability/portable type scaffolding once naming is agreed.
- Entity CRUD implementation can run in parallel with Lidarr client method additions.
- Sync section handler/syncer can run in parallel with route creation after arrSync query contracts are in place.
- UI page scaffolding can start once API contracts are defined, while tests are authored alongside backend tasks.

## Implementation Constraints

- **Technical constraints**: `packages/praxrr-app/src/lib/shared/pcd/types.ts` is generated and must be regenerated after schema updates; sync sections require complete `SectionType` and status/query integration.
- **Business constraints**: Feature is Lidarr-only; sync should not implicitly delete in-use metadata profiles; profile payloads must include complete type/status structures compatible with Lidarr expectations.

## Key Recommendations

- Land schema + shared type contract changes first to stabilize downstream tasks.
- Reuse delay-profile config model for per-instance metadata profile selection and sync scheduling.
- Implement sync section wiring and arrSync query extensions as one cohesive batch to avoid partial runtime registration.
- Add focused regression tests at each layer (capabilities, arrSync queries, entity CRUD, sync section, route contracts) before UI integration.
- Keep plan phases wide (parallel-friendly) but preserve strict ordering for foundational contract tasks.
