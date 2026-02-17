# Lidarr Metadata Profiles Implementation Plan

Lidarr metadata profiles should be added as a first-class Lidarr-only entity family in Profilarr, spanning PCD schema, entity CRUD, sync runtime, Arr client integration, and UI/API surfaces. The codebase already has the required primitives (PCD ops pipeline, section-based sync orchestration, arrSync config lifecycle, capability gating), so implementation is primarily additive if contracts remain aligned. This plan sequences schema and shared type contracts first, then composes core backend behavior (entity, sync, client, routes), and finally layers UI plus verification. The highest-risk areas are cross-file contract drift and accidental cross-Arr leakage, so each phase explicitly preserves strict `arr_type = 'lidarr'` semantics and validates portability/sync compatibility.

## Critically Relevant Files and Documentation

- /src/lib/server/db/migrations.ts: Registers migration files that must include new metadata-profile migration.
- /src/lib/server/db/schema.sql: App DB schema source for `arr_sync_*` config/status tables.
- /docs/pcdReference/0.schema.sql: PCD reference schema source for generated `types.ts` contracts.
- /src/lib/server/pcd/ops/seedBuiltInBaseOps.ts: Built-in base-op registration for newly initialized databases.
- /src/lib/shared/pcd/types.ts: Generated PCD table interfaces and DB type map.
- /src/lib/shared/pcd/portable.ts: Portable entity model catalog and import/export entity typing.
- /src/lib/shared/pcd/display.ts: Shared row/view display contracts consumed by routes/UI.
- /src/lib/server/pcd/entities/registry.ts: Auto-align entity registration with stable-key metadata.
- /src/lib/server/pcd/entities/serialize.ts: Portable export serialization dispatch.
- /src/lib/server/pcd/entities/deserialize.ts: Portable import deserialization dispatch.
- /src/lib/server/pcd/entities/clone.ts: Clone behavior for portable entities.
- /src/lib/server/pcd/entities/validate.ts: Shared validation rules for portable/entity payloads.
- /src/lib/server/db/queries/arrSync.ts: Per-section sync config persistence and lifecycle operations.
- /src/lib/server/sync/types.ts: Section type unions and per-instance sync result fields.
- /src/lib/server/sync/mappings.ts: Sync section order and Arr support matrix.
- /src/lib/server/sync/processor.ts: Trigger, pending claim, execution, and completion/failure orchestration.
- /src/lib/server/utils/arr/types.ts: Shared Arr API contracts used by clients/syncers.
- /src/lib/server/utils/arr/clients/lidarr.ts: Lidarr v1 client methods for metadata profile CRUD.
- /src/lib/shared/arr/capabilities.ts: Sync surface capabilities and Arr gating predicates.
- /src/routes/arr/[id]/sync/+page.server.ts: Instance sync configuration load/actions.
- /src/routes/api/v1/pcd/import/+server.ts: Portable import API flow.
- /src/routes/api/v1/pcd/export/+server.ts: Portable export API flow.
- /docs/plans/lidarr-metadata-profiles/feature-spec.md: Scope, acceptance criteria, and file targets.
- /docs/plans/lidarr-metadata-profiles/shared.md: Consolidated architectural context and required patterns.

## Implementation Plan

### Phase 1: Schema and Contract Foundation

#### Task 1.1: Add metadata profile database schema and migration wiring Depends on [none]

**READ THESE BEFORE TASK**

- /src/lib/server/db/schema.sql
- /docs/pcdReference/0.schema.sql
- /src/lib/server/db/migrations.ts
- /src/lib/server/pcd/ops/seedBuiltInBaseOps.ts
- /docs/plans/lidarr-metadata-profiles/feature-spec.md

**Instructions**

Files to Create

- /src/lib/server/db/migrations/YYYYMMDD_add_lidarr_metadata_profiles.ts

Files to Modify

- /src/lib/server/db/schema.sql
- /docs/pcdReference/0.schema.sql
- /src/lib/server/db/migrations.ts
- /src/lib/server/pcd/ops/seedBuiltInBaseOps.ts

- Create the migration that adds `arr_sync_metadata_profiles_config` with trigger/schedule/status fields mirroring existing section tables.
- Include built-in schema/base-op SQL for `lidarr_metadata_profiles` and its three child tables, then register that base op in seed logic.
- Keep table and column names identical across migration, schema references, and downstream type generation inputs.
- Preserve existing migration ordering/idempotency and ensure rollback behavior is safe for pre-production development flow.

#### Task 1.2: Extend shared PCD and Arr contracts for metadata profiles Depends on [1.1]

**READ THESE BEFORE TASK**

- /src/lib/shared/pcd/types.ts
- /src/lib/shared/pcd/portable.ts
- /src/lib/shared/pcd/display.ts
- /src/lib/shared/arr/capabilities.ts
- /src/lib/server/utils/arr/types.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/shared/pcd/types.ts
- /src/lib/shared/pcd/portable.ts
- /src/lib/shared/pcd/display.ts
- /src/lib/shared/arr/capabilities.ts
- /src/lib/server/utils/arr/types.ts

- Add strict types for metadata profile parent/child tables and register them in `PCDDatabase`.
- Define `PortableLidarrMetadataProfile` and include it in portable entity unions/catalogs.
- Add display row/view types for metadata profile list/detail usage.
- Extend Arr capability surfaces with `metadata_profiles` and set support to Lidarr-only.
- Add Lidarr metadata profile API payload/response interfaces in Arr types with no `any`.

#### Task 1.3: Add `arrSync` metadata profile config lifecycle queries Depends on [1.1]

**READ THESE BEFORE TASK**

- /src/lib/server/db/queries/arrSync.ts
- /src/lib/server/db/schema.sql
- /src/lib/server/sync/delayProfiles/handler.ts
- /src/tests/jobs/arrSyncLidarrConfigPropagation.test.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/server/db/queries/arrSync.ts
- /src/tests/jobs/arrSyncLidarrConfigPropagation.test.ts

- Add metadata-profile query helpers for config read/write, pending/scheduled lookups, status transitions, and claim/complete/fail lifecycle.
- Extend aggregate helpers (`getPendingSyncs`, `getScheduledConfigs`, `getSyncConfigStatus`, trigger selectors) to include metadata profiles.
- Enforce deterministic validation for paired `database_id` + `profile_name` selections.
- Enforce explicit `arr_type = 'lidarr'` semantics in selection/config helpers and related rename propagation paths.
- Keep query outputs aligned with `SUPPORTED_SYNC_SECTIONS` expectations so metadata profiles are never surfaced for Radarr/Sonarr.
- Add focused query tests for Lidarr-scoped propagation and fail-fast validation behavior.

### Phase 2: Core Backend Runtime

#### Task 2.1: Implement `metadataProfiles` PCD entity CRUD modules Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- /src/lib/server/pcd/entities/delayProfiles/create.ts
- /src/lib/server/pcd/entities/delayProfiles/update.ts
- /src/lib/server/pcd/entities/registry.ts
- /src/lib/server/pcd/ops/writer.ts
- /src/lib/server/pcd/database/cache.ts

**Instructions**

Files to Create

- /src/lib/server/pcd/entities/metadataProfiles/create.ts
- /src/lib/server/pcd/entities/metadataProfiles/read.ts
- /src/lib/server/pcd/entities/metadataProfiles/update.ts
- /src/lib/server/pcd/entities/metadataProfiles/delete.ts
- /src/lib/server/pcd/entities/metadataProfiles/index.ts

Files to Modify

- /src/lib/server/pcd/entities/registry.ts
- /src/lib/server/pcd/database/cache.ts

- Build metadata profile CRUD with stable-key write metadata, value-guard updates, and strict duplicate-name/reserved-name validation.
- Implement read/list utilities returning parent plus child toggles for primary/secondary/release status dimensions.
- Register the entity in auto-align registry with explicit table/key configuration.
- Add cache helpers required by sync/runtime consumers.

#### Task 2.2: Wire portable serialize/deserialize/clone/validate support Depends on [2.1]

**READ THESE BEFORE TASK**

- /src/lib/server/pcd/entities/serialize.ts
- /src/lib/server/pcd/entities/deserialize.ts
- /src/lib/server/pcd/entities/clone.ts
- /src/lib/server/pcd/entities/validate.ts
- /src/routes/api/v1/pcd/import/+server.ts
- /src/routes/api/v1/pcd/export/+server.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/server/pcd/entities/serialize.ts
- /src/lib/server/pcd/entities/deserialize.ts
- /src/lib/server/pcd/entities/clone.ts
- /src/lib/server/pcd/entities/validate.ts
- /src/routes/api/v1/pcd/import/+server.ts
- /src/routes/api/v1/pcd/export/+server.ts

- Add metadata profile portable import/export paths using the new shared portable type.
- Ensure clone behavior duplicates all child toggle rows and maintains deterministic naming conventions.
- Validate payload requirements and reject malformed mixed-family payloads early.
- Keep runtime portable contract aligned with documented OpenAPI/schema updates.

#### Task 2.3: Extend Lidarr client with metadata profile API methods Depends on [1.2]

**READ THESE BEFORE TASK**

- /src/lib/server/utils/arr/clients/lidarr.ts
- /src/lib/server/utils/arr/types.ts
- /docs/plans/lidarr-metadata-profiles/research-external.md

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/server/utils/arr/clients/lidarr.ts
- /src/lib/server/utils/arr/types.ts

- Add typed methods for list/get/schema/create/update/delete metadata profiles using /api/v1/metadataprofile endpoints.
- Keep method signatures and payload contracts explicit and Lidarr-scoped only.
- Ensure no BaseArrClient cross-app abstraction is introduced for this Lidarr-exclusive surface.

#### Task 2.4: Implement metadata profile sync section and runtime registration Depends on [1.3, 2.1, 2.3]

**READ THESE BEFORE TASK**

- /src/lib/server/sync/types.ts
- /src/lib/server/sync/mappings.ts
- /src/lib/server/sync/processor.ts
- /src/lib/server/sync/qualityProfiles/handler.ts
- /src/lib/server/sync/qualityProfiles/syncer.ts
- /src/lib/server/sync/delayProfiles/handler.ts

**Instructions**

Files to Create

- /src/lib/server/sync/metadataProfiles/handler.ts
- /src/lib/server/sync/metadataProfiles/syncer.ts
- /src/lib/server/sync/metadataProfiles/index.ts

Files to Modify

- /src/lib/server/sync/types.ts
- /src/lib/server/sync/mappings.ts
- /src/lib/server/sync/processor.ts

- Add `metadataProfiles` to section unions/result types and register its handler.
- Extend support matrix/order so metadata profiles are available only for Lidarr instances.
- Implement syncer flow: read configured profile from cache, transform to Lidarr payload, reconcile remote profiles by name, and update sync status lifecycle.
- Preserve existing processor semantics for pending claim, failure handling, and total-synced accounting.

#### Task 2.5: Add PCD API routes for metadata profile CRUD Depends on [2.1]

**READ THESE BEFORE TASK**

- /src/routes/api/v1/pcd/export/+server.ts
- /src/routes/api/v1/pcd/import/+server.ts
- /src/routes/delay-profiles/[databaseId]/new/+page.server.ts
- /src/lib/server/pcd/entities/metadataProfiles/index.ts

**Instructions**

Files to Create

- /src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/+server.ts
- /src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/[id]/+server.ts

Files to Modify

- None

- Implement list/create and get/update/delete handlers with strict database-id validation and robust 400/404/500 error mapping.
- Enforce Lidarr-only semantics and validation rules (name constraints, required selections).
- Return payloads aligned with shared display/portable metadata profile contracts.

### Phase 3: UI Integration and Verification

#### Task 3.1: Integrate metadata profiles into Arr instance sync settings Depends on [1.3, 2.4, 2.5]

**READ THESE BEFORE TASK**

- /src/routes/arr/[id]/sync/+page.server.ts
- /src/lib/server/db/queries/arrSync.ts
- /src/lib/shared/arr/capabilities.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/routes/arr/[id]/sync/+page.server.ts
- /src/routes/arr/[id]/sync/+page.svelte

- Load metadata profile options per database for Lidarr instances.
- Add save/sync actions for metadata profile config and manual trigger enqueueing.
- Enforce capability/surface gating in load and action paths (`ArrSyncSurface`, `SUPPORTED_SYNC_SECTIONS`) so non-Lidarr instances fail fast.
- Keep non-Lidarr instances gated out from metadata profile configuration UI/actions.
- Reuse existing trigger/cron/status UX semantics used by other sync sections.

#### Task 3.2: Build metadata profile management UI routes and forms Depends on [2.5]

**READ THESE BEFORE TASK**

- /src/routes/delay-profiles/[databaseId]/+page.server.ts
- /src/routes/delay-profiles/[databaseId]/+page.svelte
- /src/routes/quality-profiles/[databaseId]/+page.svelte
- /src/lib/client/ui/card/StickyCard.svelte

**Instructions**

Files to Create

- /src/routes/metadata-profiles/+page.server.ts
- /src/routes/metadata-profiles/+page.svelte
- /src/routes/metadata-profiles/[databaseId]/+page.server.ts
- /src/routes/metadata-profiles/[databaseId]/+page.svelte
- /src/routes/metadata-profiles/[databaseId]/new/+page.server.ts
- /src/routes/metadata-profiles/[databaseId]/new/+page.svelte
- /src/routes/metadata-profiles/[databaseId]/[name]/+page.server.ts
- /src/routes/metadata-profiles/[databaseId]/[name]/+page.svelte

Files to Modify

- /src/routes/+layout.svelte

- Implement list/create/edit flows with grouped toggles for primary/secondary/release statuses.
- Reuse existing card/form patterns and dirty-state/error alert behavior from current entity pages.
- Keep route semantics and naming consistent with existing entity navigation model.
- Ensure create/edit pages call new PCD API endpoints and display validation failures clearly.

#### Task 3.3: Add regression tests for metadata profile contracts, sync, and routes Depends on [2.4, 2.5]

**READ THESE BEFORE TASK**

- /src/tests/arr/lidarrQualityDefinitionsEntityOperations.test.ts
- /src/tests/jobs/lidarrSync.test.ts
- /src/tests/jobs/arrSyncLidarrConfigPropagation.test.ts
- /src/tests/upgrades/lidarrCapabilityGates.test.ts

**Instructions**

Files to Create

- /src/tests/arr/lidarrMetadataProfilesEntityOperations.test.ts
- /src/tests/jobs/lidarrMetadataProfilesSync.test.ts

Files to Modify

- /src/tests/jobs/lidarrSync.test.ts
- /src/tests/upgrades/lidarrCapabilityGates.test.ts

- Add entity operation tests for create/read/update/delete behavior and reserved-name/selection validation rules.
- Add sync section tests for supported-section gating, pending lifecycle behavior, and successful/failed sync reporting.
- Extend capability gate tests to assert `metadata_profiles` surface is enabled only for Lidarr.
- Preserve existing Radarr/Sonarr behavior as non-regression assertions.

#### Task 3.4: Add OpenAPI/docs scaffolding for new metadata profile contract Depends on [none]

**READ THESE BEFORE TASK**

- /docs/api/v1/openapi.yaml
- /docs/plans/lidarr-metadata-profiles/feature-spec.md
- /docs/ARCHITECTURE.md

**Instructions**

Files to Create

- None

Files to Modify

- /docs/api/v1/openapi.yaml
- /docs/ARCHITECTURE.md

- Add draft OpenAPI path/schema documentation for metadata profile PCD endpoints and payload shapes.
- Document Lidarr-only behavior and cross-arr guardrails in architecture docs.
- Keep docs aligned with runtime contracts and avoid introducing unsupported fields.

#### Task 3.5: Execute end-to-end validation sweep and readiness review Depends on [3.1, 3.2, 3.3, 3.4]

**READ THESE BEFORE TASK**

- /tasks/todo.md
- /docs/plans/lidarr-metadata-profiles/parallel-plan.md
- /docs/plans/lidarr-metadata-profiles/feature-spec.md

**Instructions**

Files to Create

- None

Files to Modify

- /tasks/todo.md
- /docs/plans/lidarr-metadata-profiles/parallel-plan.md

- Run targeted type/test checks for changed areas and capture pass/fail details.
- Validate sync section support matrix, route contracts, and portable import/export behavior.
- Run explicit suites at minimum: `deno task check`, targeted arr tests (`src/tests/arr/lidarrMetadataProfilesEntityOperations.test.ts`), targeted sync tests (`src/tests/jobs/lidarrMetadataProfilesSync.test.ts`), and capability gate tests (`src/tests/upgrades/lidarrCapabilityGates.test.ts`).
- Record unresolved risks/gaps and finalize readiness notes in the workflow tracking section.
- Mark plan tasks complete only after evidence-backed verification is captured.

## Advice

- Keep migration SQL, `0.schema.sql`, and generated/shared type contracts synchronized in the same change set to avoid silent runtime drift.
- Treat `arrSyncQueries` changes as high-risk and cover aggregate helpers (`pending`, `scheduled`, `status`) with explicit tests.
- Maintain strict Lidarr-only gating in both capabilities and sync support matrix; do not rely on UI gating alone.
- Prefer name-based reconciliation in syncer logic and preserve namespace suffix behavior for multi-database coexistence.
- Validate portable import/export and route payload contracts early; contract drift at this layer causes cascading failures across UI and sync.
