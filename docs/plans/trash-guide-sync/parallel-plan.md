# Trash Guide Sync Implementation Plan

Trash Guide Sync should be implemented as a TRaSH adapter that feeds Praxrr's existing PCD import,
cache compilation, and sync orchestration pipeline. The main architecture change is adding
`trashguide` services and persistence tables so TRaSH entities become stable, arr-scoped PCD
operations keyed by `trash_id`. The execution strategy is to establish schema and query primitives
first, then implement ingestion/transform/manager wiring, and finally connect scheduling and API
routes for manual and automated sync. This plan keeps task scope narrow (1-3 files each) and uses
explicit dependencies to maximize safe parallel work.

## Critically Relevant Files and Documentation

- /packages/praxrr-app/src/hooks.server.ts: Startup initialization order for manager wiring.
- /packages/praxrr-app/src/lib/server/pcd/core/manager.ts: Lifecycle pattern to mirror for TRaSH
  manager.
- /packages/praxrr-app/src/lib/server/pcd/database/cache.ts: Cache compilation and SQL replay
  behavior.
- /packages/praxrr-app/src/lib/server/sync/processor.ts: Event-driven sync entrypoint (`on_pull`).
- /packages/praxrr-app/src/lib/server/sync/registry.ts: Section registration/dispatch contract.
- /packages/praxrr-app/src/lib/server/jobs/schedule.ts: Scheduling and deduped job enqueue.
- /packages/praxrr-app/src/lib/server/jobs/queueTypes.ts: Job type union to extend.
- /packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts: Reference handler contract and error
  handling.
- /packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts: Query module style and
  transactional writes.
- /docs/plans/trash-guide-sync/shared.md: Consolidated architecture/files/patterns context.
- /docs/plans/trash-guide-sync/research-technical.md: New tables/endpoints/data flow details.
- /docs/plans/trash-guide-sync/feature-spec.md: Business rules and integration scope.

## Implementation Plan

### Phase 1: Persistence and Module Foundation

#### Task 1.1: Add TRaSH Guide schema migration and migration registration Depends on [none]

**READ THESE BEFORE TASK**

- /docs/plans/trash-guide-sync/research-technical.md
- /packages/praxrr-app/src/lib/server/db/migrations.ts
- /packages/praxrr-app/src/lib/server/db/schema.sql

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/db/migrations/20260225_create_trash_guide_tables.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/db/migrations.ts

Create tables for `trash_guide_sources`, `trash_guide_sync_config`, `trash_guide_sync_selections`,
`trash_guide_entity_cache`, and `trash_id_mappings` with indexes and arr-scoped constraints.

- Include explicit unique keys: `(name)` on sources and `(source_id, trash_id, entity_type)` on
  cache/mapping entities.
- Include explicit foreign keys with delete behavior: source/config/selection/cache rows cascade
  appropriately.
- Include explicit operational indexes for scheduler and lookup paths: `next_run_at`,
  `(source_id, instance_id)`, `(arr_type, trash_id)`.
- Include source taxonomy changes needed for `pcd_ops` provenance. Ensure migration idempotency
  patterns match existing migrations.

#### Task 1.2: Create source metadata query module Depends on [none]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts
- /docs/plans/trash-guide-sync/research-integration.md

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/db/queries/trashGuideSources.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts

Implement typed CRUD helpers for TRaSH sources (name, repo URL, branch, arr type, score profile,
sync strategy metadata). Reuse transaction/error style from existing query modules and align naming
conventions with camelCase input and snake_case storage.

#### Task 1.3: Add sync config and entity cache query modules Depends on [1.1]

**READ THESE BEFORE TASK**

- /docs/plans/trash-guide-sync/research-technical.md
- /packages/praxrr-app/src/lib/server/db/queries/arrSync.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts
- /packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/db/queries/arrSync.ts

Add typed query functions for per-instance TRaSH sync config/selections and parsed-entity cache
persistence. Keep APIs scoped to arr-type safe lookups and include helper methods needed by
scheduler, manual sync endpoint, and manager change detection.

#### Task 1.4: Scaffold trashguide module namespace and alias Depends on [none]

**READ THESE BEFORE TASK**

- /docs/plans/trash-guide-sync/shared.md
- /packages/praxrr-app/deno.json

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/trashguide/index.ts
- /packages/praxrr-app/src/lib/server/trashguide/types.ts

Files to Modify

- /packages/praxrr-app/deno.json

Create the module entrypoint and strict TRaSH domain types (`trash_id`, arr type, entity variants).
Add the `$trashguide/` alias so new server modules can import consistently with existing alias
conventions.

### Phase 2: Ingestion Pipeline and Manager Wiring

#### Task 2.1: Implement fetcher and parser for TRaSH sources Depends on [1.4]

**READ THESE BEFORE TASK**

- /docs/plans/trash-guide-sync/research-external.md
- /packages/praxrr-app/src/lib/server/pcd/core/manager.ts
- /packages/praxrr-app/src/lib/server/pcd/database/cache.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/trashguide/fetcher.ts
- /packages/praxrr-app/src/lib/server/trashguide/parser.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/trashguide/types.ts

Implement repo pull/clone and metadata-driven JSON discovery, then parse TRaSH entities into typed
structures with fail-fast validation on required identifiers and arr compatibility.

- Handle branch/ref errors and missing metadata paths with typed non-retryable failures.
- Handle auth/network/git pull errors with retryable classification for job handler usage.
- Handle malformed JSON as non-retryable per-file errors while preserving partial-parse reporting.
  Ensure parser output is deterministic and shaped for transformer input.

#### Task 2.2: Implement transformer and `trash_id` mapping persistence Depends on [1.3, 2.1]

**READ THESE BEFORE TASK**

- /docs/plans/trash-guide-sync/research-technical.md
- /packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts
- /packages/praxrr-app/src/lib/server/pcd/core/manager.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/trashguide/transformer.ts
- /packages/praxrr-app/src/lib/server/db/queries/trashIdMappings.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/trashguide/parser.ts

Map parsed TRaSH entities to PCD-compatible operation payloads with stable identity via `trash_id` +
`arr_type`.

- Define upstream delete behavior: mark orphaned/removed entities explicitly and exclude them from
  active sync sets.
- Define rename behavior: treat name changes as updates to the same stable identity, not new
  entities.
- Define collision behavior: same `trash_id` with incompatible payload for same arr type must
  fail-fast and block write. Add mapping writes/read helpers so subsequent pulls can diff and update
  entities idempotently without name-based drift.

#### Task 2.3: Build TrashGuide manager and startup initialization Depends on [1.2, 2.2]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/hooks.server.ts
- /packages/praxrr-app/src/lib/server/pcd/core/manager.ts
- /packages/praxrr-app/src/lib/server/sync/processor.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/trashguide/manager.ts

Files to Modify

- /packages/praxrr-app/src/hooks.server.ts
- /packages/praxrr-app/src/lib/server/trashguide/index.ts

Implement lifecycle methods for link/unlink/sync/check-updates and wire initialization into startup
after core PCD initialization. Ensure manager triggers existing sync processor events instead of
creating parallel push logic.

#### Task 2.4: Create source CRUD API endpoints Depends on [1.2, 2.3]

**READ THESE BEFORE TASK**

- /docs/plans/trash-guide-sync/feature-spec.md
- /packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts
- /packages/praxrr-app/src/lib/server/db/queries/trashGuideSources.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts
- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/+server.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/trashguide/manager.ts

Add authenticated source list/create/get/update/delete endpoints with strict arr-type validation and
conflict-safe error semantics.

- Define request contracts for create/update: `name`, `repositoryUrl`, `branch`, `arrType`,
  `scoreProfile`, `enabled`, `syncStrategy`.
- Define response contracts for list/detail including sync metadata (`lastCommitHash`,
  `lastSyncedAt`, entity counts).
- Define status matrix: `400` malformed payload, `404` missing source ID, `409` name/repo conflict,
  `422` invalid arr type/semantic mismatch. Route handlers should delegate business logic to
  manager/query modules and expose fields needed by dashboard status views.

### Phase 3: Job Scheduling and Sync Endpoints

#### Task 3.1: Add TRaSH sync job type and handler registration Depends on [2.3]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/jobs/queueTypes.ts
- /packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts
- /packages/praxrr-app/src/lib/server/jobs/handlers/index.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/jobs/handlers/trashGuideSync.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/jobs/queueTypes.ts
- /packages/praxrr-app/src/lib/server/jobs/handlers/index.ts

Define `trashguide.sync` payload and implement handler flow for due-check, source sync execution,
result reporting, and reschedule behavior.

- Payload contract: `{ sourceId: number, trigger: 'manual' | 'scheduled', requestedAt?: string }`.
- Retry policy: retry only transient git/network failures with bounded attempts; parser/schema
  validation failures are terminal.
- Reschedule policy: return explicit `rescheduleAt` only when source is enabled and schedule is
  valid. Keep contract compatibility with existing dispatcher expectations.

#### Task 3.2: Integrate TRaSH scheduling into shared scheduler Depends on [3.1]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/jobs/schedule.ts
- /packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts
- /packages/praxrr-app/src/lib/server/db/queries/trashGuideSources.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/jobs/helpers/trashGuideSchedule.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/jobs/schedule.ts

Add scheduling logic for source-driven syncs using dedupe keys and `nextRunAt` semantics consistent
with existing jobs.

- Disabled sources must not enqueue new jobs and should clear pending future schedule entries.
- Missed-run policy: enqueue immediate catch-up job once, then compute next interval from actual
  enqueue time.
- Dedupe key composition: `trashguide.sync:{sourceId}`.
- Time semantics: persist and compare `nextRunAt` in UTC to avoid local timezone drift. Keep
  schedule computation isolated in helper logic and invoked by `scheduleAllJobs()`.

#### Task 3.3: Add manual sync and entity listing routes Depends on [2.2, 3.1]

**READ THESE BEFORE TASK**

- /docs/plans/trash-guide-sync/feature-spec.md
- /packages/praxrr-app/src/lib/server/jobs/handlers/trashGuideSync.ts
- /packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts
- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts

Files to Modify

- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/+server.ts

Implement route-level trigger for immediate sync jobs and read-only entity listing for previews and
selection UX.

- Concurrency rule: if a sync is already running for source, return `409` with current run metadata.
- Listing contract: deterministic default sort (`entity_type`, then `name`), page size limit, and
  cursor/offset parameters.
- Filtering contract: explicit `type`, `search`, and `arrType` guard behavior. Enforce source
  ownership checks and deterministic filtering by entity type/search.

### Phase 4: Entity Expansion and Test Readiness

#### Task 4.1: Expand transformer coverage for profiles, quality sizes, and naming Depends on [2.2]

**READ THESE BEFORE TASK**

- /docs/plans/trash-guide-sync/research-technical.md
- /docs/plans/trash-guide-sync/research-external.md
- /packages/praxrr-app/src/lib/server/trashguide/transformer.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/trashguide/transformers/qualityProfiles.ts
- /packages/praxrr-app/src/lib/server/trashguide/transformers/mediaManagement.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/trashguide/transformer.ts

Split complex mapping logic by entity family and preserve consistent ordering where profile entities
depend on custom format identity resolution. Keep arr-type semantics explicit and reject ambiguous
mappings.

#### Task 4.2: Add parser/transformer contract tests Depends on [4.1]

**READ THESE BEFORE TASK**

- /docs/plans/trash-guide-sync/research-patterns.md
- /packages/praxrr-app/src/lib/server/trashguide/parser.ts
- /packages/praxrr-app/src/lib/server/trashguide/transformer.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/trashguide/parser.test.ts
- /packages/praxrr-app/src/tests/trashguide/transformer.test.ts

Files to Modify

- /packages/praxrr-app/src/tests/jobs/pullOnStartupJob.test.ts

Add focused tests for identity stability, arr-type guards, missing default scores, and idempotent
operation generation. Mirror existing test style for patch/restore and job-like execution
assertions.

#### Task 4.3: Add job scheduling and route integration tests Depends on [3.2, 3.3]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/jobs/schedule.ts
- /packages/praxrr-app/src/lib/server/jobs/handlers/trashGuideSync.ts
- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/jobs/trashGuideSyncJob.test.ts
- /packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts

Files to Modify

- none

Cover schedule dedupe behavior, manual sync triggering, and basic endpoint validation so regressions
in shared job/sync systems are caught early. Keep test fixtures small and arr-type explicit. If
helper refactoring is needed for testability, create a separate follow-up task rather than mixing
production refactor into this validation task.

## Advice

- Keep `trash_id` mapping as a first-class persistence concern from Phase 1; most downstream
  correctness depends on stable identity.
- Treat `/packages/praxrr-app/src/lib/server/jobs/schedule.ts` as a coordination hotspot and isolate
  new logic into helper files to reduce regression risk.
- Avoid adding any alternate sync path; the safest implementation is always "TRaSH -> PCD ops ->
  cache -> existing processor".
- Split transformer logic by entity family early to prevent one large mapper from becoming a
  bottleneck for parallel contributors.
- Ensure every route and query path carries explicit `arr_type` checks to satisfy cross-Arr semantic
  guardrails.
