# Enhance Lidarr Support Implementation Plan

This initiative replaces Sonarr-backed Lidarr media-management reuse with first-class `lidarr_naming`, `lidarr_media_settings`, and `lidarr_quality_definitions` entities. The safest path is phased: establish schema/contracts first, then switch runtime CRUD/import-export/sync resolution, then remove compatibility branches with targeted regression coverage. Core integration points are PCD entity modules, route handlers, portable contracts, and the media-management syncer backed by `arr_sync_media_management`. Migration must be deterministic and idempotent, with explicit collision handling and operator-visible outcomes.

## Critically Relevant Files and Documentation

- /packages/praxrr-app/src/lib/server/pcd/index.ts: Cache/write orchestration and operation metadata.
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts: Current naming read behavior and arr-type shaping.
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts: Existing deterministic write pattern.
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts: Mapping-dependent quality-definition behavior.
- /packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts: Sync source resolution and Lidarr reuse behavior.
- /packages/praxrr-app/src/lib/server/db/queries/arrSync.ts: Sync config persistence and rename propagation.
- /packages/praxrr-app/src/lib/shared/pcd/portable.ts: Portable entity registration and Lidarr validation matrix.
- /packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts: Route action validation/dispatch pattern.
- /packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts: Import validation and deserialization path.
- /packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts: Export serialization path.
- /docs/pcdReference/0.schema.sql: PCD schema reference for media-management entities.
- /packages/praxrr-app/src/lib/server/db/schema.sql: Runtime schema context for instances and sync tables.
- /docs/api/v1/schemas/pcd.yaml: Public API schema for portable entity contracts.
- /docs/ARCHITECTURE.md: Architecture constraints and media-management layering.
- /docs/plans/enhance-lidarr-support/feature-spec.md: Accepted scope, risks, decisions, and criteria.

## Arr-Semantic Guardrails (Mandatory)

These guardrails are repository-wide policy and apply to all future enhancements, features, and bug fixes, not only this Lidarr initiative.

- Do not blindly mirror Sonarr fields into Lidarr. Any schema/API/model reuse must be justified against Lidarr API semantics first.
- Enforce Arr-specific semantics for schema columns, API payload contracts, code paths, and data model decisions (`sonarr`, `radarr`, `lidarr`, and future Arr apps).
- Treat sibling Arr implementations as references, not source-of-truth contracts.
- Reject fallback-first behavior: if Arr semantics diverge, implement explicit Arr-specific handling and fail fast on invalid cross-Arr assumptions.
- Keep schema and migration contracts identical for each Arr family (`docs/pcdReference/0.schema.sql` vs runtime migration SQL) after semantic validation.

### Semantic Validation Checkpoints (Required for Every Task in This Plan)

- Schema checkpoint: confirm each added/changed field is supported by the target Arr app semantics, not inferred from another Arr app.
- API checkpoint: confirm request/response contracts align with target Arr endpoints and validation rules before route/import/export wiring.
- Code-path checkpoint: confirm read/write/sync dispatch resolves by target `arr_type` without implicit sibling fallback.
- Data-model checkpoint: confirm entity/table shape and constraints represent target Arr behavior; document deliberate parity vs divergence decisions.
- Verification checkpoint: add or update focused tests that fail on cross-Arr semantic leakage and pass with Arr-specific behavior.

## Implementation Plan

### Phase 1: Data Foundation and Contracts

#### Task 1.1: Add first-class Lidarr schema and migration scaffolding Depends on [none]

**READ THESE BEFORE TASK**

- /docs/pcdReference/0.schema.sql
- /packages/praxrr-app/src/lib/server/db/schema.sql
- /docs/plans/enhance-lidarr-support/feature-spec.md

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/db/migrations/20260215_add_lidarr_media_management_entities.ts

Files to Modify

- /docs/pcdReference/0.schema.sql
- /packages/praxrr-app/src/lib/server/db/schema.sql

Implement dedicated `lidarr_naming`, `lidarr_media_settings`, and `lidarr_quality_definitions` table definitions with indexes/constraints aligned to validated Lidarr semantics; reuse family conventions only where explicit parity is proven. Include deterministic migration logic for legacy Sonarr-backed Lidarr rows and explicit conflict handling semantics. Add `quality_api_mappings` seed/upgrade coverage for `arr_type = 'lidarr'`. Ensure reruns are idempotent and produce stable outcomes.

#### Task 1.2: Expand portable and OpenAPI contracts for first-class Lidarr entities Depends on [none]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/shared/pcd/portable.ts
- /docs/api/v1/schemas/pcd.yaml
- /packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts

**Instructions**

Files to Create

- /docs/plans/enhance-lidarr-support/contract-mapping-notes.md

Files to Modify

- /packages/praxrr-app/src/lib/shared/pcd/portable.ts
- /docs/api/v1/schemas/pcd.yaml

Register `lidarr_*` entity families as first-class portable types, update validation matrices and type mappings, and align OpenAPI schema definitions accordingly. Keep import/export payload expectations deterministic and fail-fast for invalid cross-family payload mixes. Capture explicit legacy alias behavior (if retained temporarily) in mapping notes.

#### Task 1.3: Prepare sync-config query helpers for Lidarr-native rename and selection updates Depends on [1.1]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/db/queries/arrSync.ts
- /packages/praxrr-app/src/lib/server/db/schema.sql
- /docs/plans/enhance-lidarr-support/analysis-code.md

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/jobs/arrSyncLidarrConfigPropagation.test.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/db/queries/arrSync.ts
- /packages/praxrr-app/src/lib/server/db/schema.sql

Extend `arrSync` helper behavior to ensure Lidarr config names and migration outcomes remain deterministic after first-class table cutover. Validate rename/update helper coverage for naming, media settings, and quality definitions. Add focused query-level test coverage for Lidarr config propagation semantics.

### Phase 2: Runtime Cutover

#### Task 2.1: Implement first-class Lidarr naming entity operations Depends on [1.1]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/create.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/update.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/arr/lidarrNamingEntityOperations.test.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/create.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/update.ts

Replace default Sonarr-backed Lidarr naming reuse with dedicated `lidarr_naming` reads/writes while preserving deterministic duplicate handling and write metadata. Ensure list/get behavior no longer duplicates Sonarr rows as Lidarr stand-ins. Add direct tests for create/list/update semantics and error behavior.

#### Task 2.2: Implement first-class Lidarr media-settings entity operations Depends on [1.1]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/update.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/arr/lidarrMediaSettingsEntityOperations.test.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/update.ts

Move Lidarr media-settings operations to dedicated `lidarr_media_settings` storage and remove default Sonarr table reuse branches for create/read/update flows. Preserve existing validation and `writeOperation` metadata structure. Add entity-level tests for success and deterministic validation failures.

#### Task 2.3: Implement first-class Lidarr quality-definition entity operations Depends on [1.1]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/update.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/arr/lidarrQualityDefinitionsEntityOperations.test.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/update.ts

Switch Lidarr quality-definition operations to dedicated storage while enforcing mapping-aware validation against Lidarr mappings. Keep explicit errors for unmapped entries and maintain deterministic ordering/normalization behavior. Add tests covering mapped/unmapped scenarios and duplicate collision behavior.

#### Task 2.4: Wire routes, import/export, and syncer to dedicated Lidarr entities Depends on [1.2, 1.3, 2.1, 2.2, 2.3]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts
- /packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts
- /packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts
- /packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/arr/lidarrFirstClassRouteAndSyncCutover.test.ts

Files to Modify

- /packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts
- /packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts
- /packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts
- /packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts

Update route dispatch and API entity resolution so `arr_type = 'lidarr'` uses first-class entities end-to-end. Update sync source resolution and logs to remove default reuse-path dependencies. Keep import/export behavior consistent with new portable contracts and verify route + sync integration through focused tests.

### Phase 3: Hardening, Cleanup, and Documentation

#### Task 3.1: Remove legacy reuse branches and finalize migration semantics Depends on [2.4]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts
- /docs/plans/enhance-lidarr-support/feature-spec.md

**Instructions**

Files to Create

- /docs/plans/enhance-lidarr-support/migration-runbook.md

Files to Modify

- /packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts

Remove compatibility-only reuse branches once cutover tests pass and migration checks are green. Replace reuse-specific logs/messages with first-class Lidarr diagnostics and document operator migration/rollback steps. Ensure migration semantics remain explicit and deterministic.

#### Task 3.2: Add regression suite for CRUD, import/export, sync, and migration reruns Depends on [3.1]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/tests/arr/lidarrMediaManagement.test.ts
- /packages/praxrr-app/src/tests/arr/lidarrQualityMappingPrereqs.test.ts
- /docs/plans/enhance-lidarr-support/feature-spec.md

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/arr/lidarrFirstClassMigration.test.ts

Files to Modify

- /packages/praxrr-app/src/tests/arr/lidarrMediaManagement.test.ts
- /packages/praxrr-app/src/tests/arr/lidarrQualityMappingPrereqs.test.ts
- /packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts

Build regression coverage for first-class Lidarr CRUD/list/edit behavior, import/export contract parity, sync source correctness, and migration idempotency reruns. Assert explicit error codes/messages for mapping and conflict paths. Ensure tests fail against legacy-reuse behavior and pass after cutover.

#### Task 3.3: Update architecture/API/operator docs to reflect first-class Lidarr behavior Depends on [3.1, 3.2]

**READ THESE BEFORE TASK**

- /docs/ARCHITECTURE.md
- /docs/api/v1/schemas/pcd.yaml
- /README.md

**Instructions**

Files to Create

- /docs/plans/enhance-lidarr-support/post-cutover-checklist.md

Files to Modify

- /docs/ARCHITECTURE.md
- /docs/api/v1/schemas/pcd.yaml
- /README.md

Update documentation to remove v1 reuse messaging and describe first-class Lidarr media-management behavior, migration expectations, and operator validation checks. Keep docs aligned with implemented contracts and test evidence. Include explicit post-cutover verification checklist for maintainers.

## Advice

- Keep schema and portable contracts in lockstep; partial updates create confusing import/export failures.
- Semantic validation checkpoints above are mandatory exit criteria for each task; do not mark a task complete without passing them.
- Prioritize deterministic migration reporting early, because route/sync behavior depends on stable config-name mappings.
- Split entity cutover by family (`naming`, `media-settings`, `quality-definitions`) to maximize safe parallel work.
- Do not remove reuse branches until route+sync+migration regression tests are green together.
- Use `arrSync` rename helpers as the single source of truth for config-name propagation to avoid drift.
