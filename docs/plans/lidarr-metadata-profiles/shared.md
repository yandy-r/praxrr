# Lidarr Metadata Profiles

Lidarr metadata profiles should be implemented as a new Lidarr-only PCD entity family plus a dedicated sync section, reusing the same operational backbone already used by quality profiles, delay profiles, and media management. The end-to-end flow is already established in this codebase: route actions write PCD ops, cache compiles entity state, sync handlers claim pending work, and Arr clients push transformed payloads. The core work is extending that flow with metadata-profile-specific tables/contracts, section registration, and Lidarr client methods while preserving strict `arr_type` gating and existing conflict/value-guard behavior. Existing `arrSyncQueries`, sync processor orchestration, and capability predicates provide the integration surface, so this feature is mostly additive if contracts stay aligned across shared types, schema, and runtime validators.

## Relevant Files

- /packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/create.ts: Canonical small-entity create pattern with `writeOperation` metadata.
- /packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/update.ts: Value-guard update and rename-safe operation metadata pattern.
- /packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts: Pattern for multi-module entity composition and exports.
- /packages/praxrr-app/src/lib/server/pcd/entities/registry.ts: Auto-align registration and stable-key/table metadata map.
- /packages/praxrr-app/src/lib/server/pcd/ops/writer.ts: Shared PCD operation writer used by all entity writes.
- /packages/praxrr-app/src/lib/server/db/queries/arrSync.ts: Section config persistence + pending/claim/complete/fail lifecycle helpers.
- /packages/praxrr-app/src/lib/server/sync/types.ts: `SectionType`/`SectionHandler` contracts and instance sync result shape.
- /packages/praxrr-app/src/lib/server/sync/mappings.ts: Section order and Arr support matrix (`SUPPORTED_SYNC_SECTIONS`).
- /packages/praxrr-app/src/lib/server/sync/processor.ts: Trigger/schedule execution and per-instance section orchestration.
- /packages/praxrr-app/src/lib/server/sync/qualityProfiles/handler.ts: Reference section handler wiring to `arrSyncQueries`.
- /packages/praxrr-app/src/lib/server/sync/delayProfiles/handler.ts: Closest single-selection sync section pattern.
- /packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts: Reference for name-based reconciliation and remote updates.
- /packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts: Lidarr v1 client that should own metadata-profile API methods.
- /packages/praxrr-app/src/lib/server/utils/arr/types.ts: Arr payload/response type contracts to extend.
- /packages/praxrr-app/src/lib/shared/arr/capabilities.ts: Arr sync surface declarations and predicate gates.
- /packages/praxrr-app/src/lib/shared/pcd/types.ts: PCD table typing and Arr-type unions.
- /packages/praxrr-app/src/lib/shared/pcd/portable.ts: Portable entity contracts for import/export/clone.
- /packages/praxrr-app/src/lib/shared/pcd/display.ts: Shared display row types used in UI/server contracts.
- /packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts: Existing sync settings load/actions integration point.
- /packages/praxrr-app/src/routes/delay-profiles/[databaseId]/new/+page.server.ts: Route action validation + error mapping pattern.
- /packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts: Existing PCD API route structure reference.
- /packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts: Existing PCD API route structure reference.

## Relevant Tables

- arr_sync_quality_profiles: Existing many-selection profile sync rows used for quality profiles.
- arr_sync_quality_profiles_config: Existing trigger/status table for quality profile sync execution.
- arr_sync_delay_profiles_config: Existing single-selection sync config model closest to metadata profile needs.
- arr_sync_media_management: Existing multi-config section table and status lifecycle model.
- arr_instances: Instance metadata including `type` gating for sync section support.
- database_instances: Source PCD databases referenced by sync selections.
- pcd_ops: Source-of-truth operation log that compiles PCD cache state.
- Planned `arr_sync_metadata_profiles_config`: Per-instance metadata profile sync config/status row.
- Planned `lidarr_metadata_profiles`: Parent metadata profile entity table in PCD cache.
- Planned `lidarr_metadata_profile_primary_types`: Primary type allow/deny child rows.
- Planned `lidarr_metadata_profile_secondary_types`: Secondary type allow/deny child rows.
- Planned `lidarr_metadata_profile_release_statuses`: Release status allow/deny child rows.

## Relevant Patterns

**Entity WriteOperation Metadata Pattern**: All entity writes include deterministic operation metadata and stable keys for conflict handling. See [/packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/create.ts](/packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/create.ts).

**Value-Guard Update Pattern**: Updates include current-value predicates to detect drift and prevent blind overwrites. See [/packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/update.ts](/packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/update.ts).

**Section Handler Registry Pattern**: Sync sections implement `SectionHandler` and self-register through the registry for processor discovery. See [/packages/praxrr-app/src/lib/server/sync/delayProfiles/handler.ts](/packages/praxrr-app/src/lib/server/sync/delayProfiles/handler.ts).

**Arr Support Matrix Pattern**: Section support is explicit in `SUPPORTED_SYNC_SECTIONS` and must remain Arr-specific. See [/packages/praxrr-app/src/lib/server/sync/mappings.ts](/packages/praxrr-app/src/lib/server/sync/mappings.ts).

**Capability Surface Gate Pattern**: UI/server feature access is controlled via `ArrSyncSurface` and helper predicates. See [/packages/praxrr-app/src/lib/shared/arr/capabilities.ts](/packages/praxrr-app/src/lib/shared/arr/capabilities.ts).

## Relevant Docs

**/docs/plans/lidarr-metadata-profiles/feature-spec.md**: You _must_ read this when working on scope, requirements, and acceptance criteria.

**/docs/plans/lidarr-metadata-profiles/research-technical.md**: You _must_ read this when working on schema/entity/sync file mapping.

**/docs/plans/lidarr-metadata-profiles/research-external.md**: You _must_ read this when working on Lidarr endpoint contracts and payload shapes.

**/docs/ARCHITECTURE.md**: You _must_ read this when working on Arr-specific semantics and cutover guardrails.

**/docs/api/v1/openapi.yaml**: You _must_ read this when working on API contract updates for new endpoints.
