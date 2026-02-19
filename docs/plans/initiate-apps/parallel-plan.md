# initiate-apps Implementation Plan

`initiate-apps` provisions Arr instances from environment variables during server startup and reconciles them into `arr_instances` as provenance-tracked rows (`source='env'`). The implementation should reuse existing startup, query, and Arr-client patterns so reconciliation is idempotent, non-blocking, and compatible with existing jobs/sync flows. The highest-risk integration points are schema/query contract updates and the single startup insertion point in `hooks.server.ts`, so the plan splits those into parallel foundation tasks with explicit handoffs. UI and docs follow backend stabilization and consume the same `source` semantics to clearly distinguish env-managed instances from UI-managed instances.

## Critically Relevant Files and Documentation

- `docs/plans/initiate-apps/shared.md`: primary synthesis of architecture, constraints, and required references.
- `docs/plans/initiate-apps/feature-spec.md`: authoritative behavior, env variable contract, and phased intent.
- `packages/praxrr-app/src/hooks.server.ts`: startup sequence and insertion point before `initializeJobs()`.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: core Arr instance query contracts used by startup and UI loaders.
- `packages/praxrr-app/src/lib/server/db/migrations.ts`: migration registry ordering.
- `packages/praxrr-app/src/lib/server/db/schema.sql`: schema documentation that must reflect runtime DB shape.
- `packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts`: migration style template for adding new columns.
- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: Arr client construction used for validation/delay-profile integration.
- `packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`: default delay profile application constraints.
- `packages/praxrr-app/src/lib/shared/pcd/types.ts`: canonical Arr app type list for validation.
- `packages/praxrr-app/src/routes/arr/new/+page.server.ts`: reference create-flow validation and delay-profile patterns.
- `scripts/test.ts`: test alias wiring for scoped regression execution.

## Implementation Plan

### Phase 1: Foundation and Contracts

#### Task 1.1: Add `source` schema migration and registry wiring Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/initiate-apps/feature-spec.md`
- `packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts`
- `packages/praxrr-app/src/lib/server/db/migrations.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/db/migrations/20260220_add_arr_instance_source.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/db/migrations.ts`
- `packages/praxrr-app/src/lib/server/db/schema.sql`

Create the next migration that adds `arr_instances.source TEXT NOT NULL DEFAULT 'ui'`, register it in migration order, and update `schema.sql` docs to match exactly. Keep migration SQL minimal and SQLite-safe (single `ALTER TABLE` + deterministic defaults). Ensure default value semantics support existing rows immediately after migration.

#### Task 1.2: Extend Arr instance query contracts for source-aware reconciliation Depends on [1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- `docs/plans/initiate-apps/shared.md`
- `docs/plans/initiate-apps/research-patterns.md`

**Instructions**

Files to Create

- none

Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`

Add `source: 'ui' | 'env'` to the exported interfaces and SQL mappings, and define explicit reconciliation helpers with concrete signatures: `getByApiKey(apiKey: string)`, `getBySource(source: 'ui' | 'env')`, `updateEnvInstanceByApiKey(apiKey: string, patch)`, and `disableEnvInstancesMissingApiKeys(activeApiKeys: string[])` (must apply `WHERE source = 'env'`). Keep API-key matching deterministic and ensure disable logic never deletes rows. Preserve existing query conventions (typed return mapping, raw SQL params, no implicit fallback behaviors).

#### Task 1.3: Build env-instance parser module with strict Arr-app typing Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/initiate-apps/feature-spec.md`
- `packages/praxrr-app/src/lib/shared/pcd/types.ts`
- `packages/praxrr-app/src/lib/server/utils/validation/url.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`

Files to Modify

- none

Implement parser utilities that scan app-prefixed env groups (`RADARR|SONARR|LIDARR_INSTANCE_*_{N}`), validate required keys, coerce optional fields (enabled, tags, external URL), and return normalized descriptors for reconciliation. Reject unsupported app types early and keep parsing resilient to sparse indices/non-contiguous numbering. Do not perform DB writes yet in this task.

#### Task 1.4: Add env-instance unit test harness and task alias Depends on [1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/base/arrExternalUrlPersistence.test.ts`
- `packages/praxrr-app/src/tests/base/BaseTest.ts`
- `scripts/test.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/base/envInstances.test.ts`

Files to Modify

- `scripts/test.ts`

Add focused tests for parser behaviors (missing required vars, sparse indices, tag parsing, invalid URLs, type filtering), using existing test scaffolding/mocking patterns. Add a dedicated test alias for the new suite to support quick regressions. Keep test fixtures free of real API keys and verify error paths explicitly.

### Phase 2: Reconciliation and Startup Integration

#### Task 2.1: Implement source-aware reconcile flow in envInstances Depends on [1.2, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- `packages/praxrr-app/src/lib/server/db/db.ts`

**Instructions**

Files to Create

- none

Files to Modify

- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`

Implement `reconcileEnvInstances()` with deterministic create/update/disable behavior keyed by `api_key`: create missing env rows, update existing env rows, never overwrite UI-managed rows, and disable previously env-managed rows absent from current env config. Define conflict policy explicitly: duplicate env API keys in one startup cycle resolve as first-seen wins with `skippedDuplicateEnvKey` metric increment; collision with a UI-managed row is no-write with `skippedConflictUi` increment. Use per-instance transaction boundaries (or savepoints) so one failure does not roll back other instance outcomes. Include structured return metrics (`created`, `updated`, `disabled`, `skippedConflictUi`, `skippedDuplicateEnvKey`, `errors`) for startup summaries and tests.

#### Task 2.2: Integrate reconciliation into startup sequence Depends on [1.1, 2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/hooks.server.ts`
- `docs/plans/initiate-apps/shared.md`
- `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`

**Instructions**

Files to Create

- none

Files to Modify

- `packages/praxrr-app/src/hooks.server.ts`

Import and run `reconcileEnvInstances()` after migrations/default setup work and before job initialization. Keep failure handling non-blocking: isolate reconciliation errors, log with `source: 'Setup'`, and continue startup. Emit concise summary logs without leaking API keys.

#### Task 2.3: Add optional connection validation and delay-profile application in reconcile flow Depends on [2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`
- `packages/praxrr-app/src/lib/server/db/queries/generalSettings.ts`

**Instructions**

Files to Create

- none

Files to Modify

- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`

Add explicit config gating with `PRAXRR_VALIDATE_INSTANCES` (default `false`) in `config.ts`, then run connection validation only when true and only after parsing but before create/update writes for that instance (reuse `/arr/test` style timeout/retry defaults). Apply default delay profiles only after successful creation of new `radarr` or `sonarr` env rows, guarded by general settings. Ensure each instance failure is isolated and reported in reconciliation metrics, with no startup abort. Keep Arr-specific behavior explicit by `arr_type` and avoid cross-app semantic assumptions.

### Phase 3: UX, Route Wiring, and Documentation

#### Task 3.1: Expose `source` through Arr route loaders Depends on [2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/+page.server.ts`
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`

**Instructions**

Files to Create

- none

Files to Modify

- `packages/praxrr-app/src/routes/arr/+page.server.ts`
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`

Ensure loader payloads include explicit source contract fields for both list and settings pages: list rows must expose `source` and `isEnvManaged`; settings loader must expose `instance.source` and `canEditCoreConnectionFields`. Add server-side guard computation from source so UI behavior is derived from typed loader data, not duplicated client logic.

#### Task 3.2: Implement env-managed UI indicators and edit restrictions Depends on [3.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/+page.svelte`
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.svelte`
- `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`

**Instructions**

Files to Create

- none

Files to Modify

- `packages/praxrr-app/src/routes/arr/+page.svelte`
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.svelte`
- `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`

Add a clear `ENV` provenance indicator on list views and a read-only explanation in settings for env-managed instances. For `source='env'`, lock `name`, `type`, `url`, `externalUrl`, and `apiKey` controls; keep `enabled` and `tags` editable. Mirror this same policy in both form-state logic and server-provided guard flags so UI and backend constraints stay aligned. Keep messaging consistent with startup behavior (changes come from env + restart).

#### Task 3.3: Document env-instance operational model and verification steps Depends on [2.2, 2.3]

**READ THESE BEFORE TASK**

- `docs/plans/initiate-apps/feature-spec.md`
- `docs/DEVELOPMENT.md`
- `scripts/test.ts`

**Instructions**

Files to Create

- none

Files to Modify

- `docs/plans/initiate-apps/feature-spec.md`
- `docs/DEVELOPMENT.md`

Update documentation with final env variable contract, reconciliation behavior (`source` semantics, orphan disable policy), and operator verification steps (startup logs + targeted test command). Ensure wording is explicit about Arr app scope (radarr/sonarr/lidarr only) and security expectations for secrets.

## Advice

- Keep `arrInstances` query helpers narrowly scoped and reusable; reconciliation correctness depends more on clear query contracts than on complex startup logic.
- Treat `hooks.server.ts` as a merge hotspot and integrate reconciliation in one focused change after foundation tasks land.
- Preserve strict non-blocking startup semantics: the service should always boot even if one or more env instances fail validation or connectivity checks.
- Reuse Arr-specific guards from shared capabilities/types to avoid accidental support of non-target apps (`chaptarr` should never leak into this flow).
- Verify all logging output for secret safety before release, because this feature increases startup-time handling of API-key-backed configuration.
