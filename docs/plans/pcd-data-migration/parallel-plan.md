# pcd-data-migration Implementation Plan

`pcd-data-migration` introduces a hybrid JSON/YAML authoring and exchange layer while preserving
Praxrr’s SQL-first runtime semantics for compilation, value guards, and sync fan-out. The safest
approach is to extend existing orchestration (`PCDManager`), ingestion (`importBaseOps` + writer),
and portable translation (`serialize`/`deserialize`) rather than creating an alternate execution
path. The implementation should be phased to lock contract shape first, then wire runtime
ingestion/export, and finally prove parity and guard behavior through targeted tests and runbook
updates. Success is defined as hybrid inputs producing deterministic `pcd_ops` and `pcd_op_history`
outcomes equivalent to legacy SQL import flows.

## Critically Relevant Files and Documentation

- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: lifecycle orchestration for
  link/sync/import/compile/sync triggering.
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: base operation import flow and
  metadata sequencing.
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`: validated operation persistence and
  recompilation.
- `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`: schema/base/tweaks/user operation
  ordering.
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: value-guard/conflict handling and
  op-history recording.
- `/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: portable export mapping.
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: portable import mapping.
- `/packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: portable import API validation and
  dispatch.
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: portable export API route.
- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`: portable contract types/schemas.
- `/docs/api/v1/schemas/pcd.yaml`: OpenAPI portable schema contract.
- `/docs/api/v1/paths/pcd.yaml`: import/export route contract definitions.
- `/docs/features/portable-import-export.md`: operator/developer flow expectations.
- `/research/data-schema/report.md`: phased strategy and value-guard gate rationale.
- `/research/data-schema/synthesis/risk-assessment.md`: migration risks and mitigations.

## Implementation Plan

### Phase 1: Contract and Guard Foundations

#### Task 1.1: Align portable migration contract across runtime and OpenAPI Depends on [none]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`
- `/docs/api/v1/schemas/pcd.yaml`
- `/docs/api/v1/paths/pcd.yaml`

**Instructions**

Files to Create

- none

Files to Modify

- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`
- `/docs/api/v1/schemas/pcd.yaml`
- `/docs/api/v1/paths/pcd.yaml`

Define the minimum migration metadata needed for hybrid JSON/YAML ingestion (for example
format/version/source markers) and apply it consistently across runtime portable types and OpenAPI
contracts. Keep backwards-compatible validation rules for existing payloads where applicable, but
fail fast on ambiguous migration fields. The outcome should be a single authoritative contract with
no runtime/docs drift.

#### Task 1.2: Add migration reader scaffold for entity source ingestion Depends on [none]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`
- `/research/data-schema/synthesis/technical-design.md`

**Instructions**

Files to Create

- `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`

Files to Modify

- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`

Create a focused reader that loads hybrid entity documents and routes them into existing
deserialization pathways. Keep the reader side-effect free except for returning parsed/validated
operation candidates; persistence must still occur via existing writer/integration tasks. The
outcome should be a deterministic parser boundary ready for importer integration.

#### Task 1.3: Isolate value-guard verification utility for migration gates Depends on [none]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`
- `/research/data-schema/synthesis/risk-assessment.md`

**Instructions**

Files to Create

- `/packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`

Files to Modify

- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`

Extract reusable guard-check helpers that can evaluate whether migration-produced operations
preserve current conflict semantics and history recording. Keep gate utilities composable so
importer, tests, and runbook checks can share the same logic. The outcome should be an explicit
guard gate that can block unsafe migration batches.

### Phase 2: Runtime Pipeline Integration

#### Task 2.1: Wire hybrid source detection into base importer and op loader Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`
- `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`
- `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`

**Instructions**

Files to Create

- none

Files to Modify

- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`
- `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`
- `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`

Extend import discovery so repositories can contribute hybrid entity sources in addition to SQL ops.
Preserve existing ordering, metadata hashing, and orphan handling semantics so hybrid and SQL paths
converge to the same operation model before compilation. The outcome should be unified import
behavior with deterministic layering. Define explicit precedence and fail-fast rules for conflicts
(for example duplicate stable keys across SQL and hybrid files in the same layer) so ambiguous
inputs are rejected deterministically. Include implementation notes for conflict-path regression
coverage that validates each precedence rule.

#### Task 2.2: Add manager/config orchestration switches for hybrid migration flow Depends on [none]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- `/packages/praxrr-app/src/lib/server/utils/config/config.ts`
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`

**Instructions**

Files to Create

- none

Files to Modify

- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- `/packages/praxrr-app/src/lib/server/utils/config/config.ts`

Introduce explicit orchestration flags and runtime branching that enable hybrid ingestion while
preserving the default SQL-only behavior. Keep link/sync paths centralized in manager and avoid
duplicating compile/sync trigger logic. The outcome should be controlled rollout toggles and
predictable lifecycle behavior.

#### Task 2.3: Route migration-generated operations through validated writer metadata path Depends on [1.2, 1.3]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`
- `/packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts`
- `/packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`

**Instructions**

Files to Create

- none

Files to Modify

- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`
- `/packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts`
- `/packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`

Ensure all migration-generated SQL is persisted via the same writer/query path used by existing
operations, including metadata serialization, hashes, supersede handling, and compile triggers.
Integrate guard-gate checks at the write boundary so rejected batches never silently alter op state.
The outcome should be identical persistence semantics across legacy and hybrid inputs.

#### Task 2.4: Extend import/export API behavior for migration metadata and strict validation Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`
- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`

**Instructions**

Files to Create

- none

Files to Modify

- `/packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`
- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`

Update route-level validation and response shaping to recognize migration metadata while maintaining
strict entity-level validation and layer restrictions. Preserve existing error envelope conventions
and fail-fast behavior for invalid payloads. The outcome should be API-level contract support for
hybrid exchange with clear validation behavior.

### Phase 3: Verification and Operational Readiness

#### Task 3.1: Add cache parity and value-guard regression test coverage Depends on [2.1, 2.3]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/tests/base/BaseTest.ts`
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- `/research/data-schema/synthesis/risk-assessment.md`

**Instructions**

Files to Create

- `/packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts`

Files to Modify

- `/packages/praxrr-app/src/tests/base/BaseTest.ts`

Build focused tests that replay equivalent legacy SQL and hybrid inputs and assert compiled cache
parity plus expected `pcd_op_history` outcomes. Include negative cases where guard mismatches must
fail deterministically. The outcome should be a hard correctness gate for migration rollout
decisions.

#### Task 3.2: Verify sync/job behavior remains correct after hybrid operation writes Depends on [2.2, 2.3]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/lib/server/sync/processor.ts`
- `/packages/praxrr-app/src/lib/server/jobs/queueService.ts`
- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`

**Instructions**

Files to Create

- `/packages/praxrr-app/src/tests/jobs/hybridSyncTrigger.test.ts`

Files to Modify

- `/packages/praxrr-app/src/lib/server/sync/processor.ts`
- `/packages/praxrr-app/src/lib/server/jobs/queueService.ts`

Confirm hybrid-sourced writes trigger the same sync pending state and queue scheduling behavior as
legacy SQL flows. Tighten event/source handling only where necessary to avoid duplicate enqueue or
missed sync events. The outcome should be migration-transparent sync operations. Add explicit
acceptance criteria in test assertions: exactly one enqueue per affected sync config, no duplicate
queue rows for the same trigger window, and expected sync-pending transitions after successful
hybrid writes.

#### Task 3.3: Draft migration runbook updates and operator checks Depends on [none]

**READ THESE BEFORE TASK**

- `/docs/plans/enhance-lidarr-support/migration-runbook.md`
- `/docs/features/portable-import-export.md`
- `/research/data-schema/report.md`

**Instructions**

Files to Create

- none

Files to Modify

- `/docs/plans/enhance-lidarr-support/migration-runbook.md`
- `/docs/features/portable-import-export.md`

Document phased rollout steps, preflight checks, guard verification checkpoints, and rollback
criteria for hybrid migration usage. Keep instructions tied to observable signals in existing
logs/history tables and avoid introducing undocumented operator assumptions. The outcome should be
an actionable runbook that can be used before final rollout.

#### Task 3.4: Finalize rollout criteria and schema-contract verification checklist Depends on [2.4, 3.1, 3.2, 3.3]

**READ THESE BEFORE TASK**

- `/docs/api/v1/schemas/pcd.yaml`
- `/docs/api/v1/paths/pcd.yaml`
- `/docs/plans/enhance-lidarr-support/migration-runbook.md`

**Instructions**

Files to Create

- `/docs/plans/pcd-data-migration/rollout-checklist.md`

Files to Modify

- `/docs/plans/enhance-lidarr-support/migration-runbook.md`

Capture the explicit go/no-go checklist that combines contract consistency, guard/parity test pass
conditions, and sync regression outcomes. Include required command checks and evidence artifacts
expected for sign-off. The outcome should be a deterministic launch checklist that prevents partial
or unsafe rollouts.

## Advice

- Keep SQL execution as the canonical runtime; hybrid formats should translate into the same SQL
  operations and validation path before compile.
- The main hidden dependency is between contract changes and importer behavior: schema updates that
  ship without importer alignment will create silent drift.
- Value-guard behavior is the highest-risk cross-cutting concern; prioritize negative-path tests and
  history inspection early.
- Avoid broad refactors in manager/import/writer simultaneously; stage by boundaries to reduce merge
  and regression risk.
- Use docs and runbook updates as part of phased delivery, not post-hoc cleanup, so operational
  safety is continuously validated.
