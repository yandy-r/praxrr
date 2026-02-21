# Task Structure Analysis: pull-on-startup

## Executive Summary

The codebase is already split along clean seams for this feature: startup orchestration (`hooks.server.ts`), job infrastructure (`jobs/*`), Arr access (`utils/arr/*`), sync selection persistence (`db/queries/arrSync.ts`), and entity readers/writers (`pcd/entities/**`). The best parallel plan is to keep these seams intact and avoid large shared-file edits until late in the cycle.

The highest-risk merge bottlenecks are `hooks.server.ts`, `jobs/queueTypes.ts`, `jobs/display.ts`, `jobs/handlers/index.ts`, `db/migrations.ts`, and especially `db/queries/arrSync.ts` (large/high-churn file). Maximize parallelism by front-loading new files under a dedicated `pull/startup` module and merging narrow wiring changes last.

## Recommended Phase Structure

### Phase 0 - Decisions and contract lock (short)

- Resolve two plan conflicts up front: startup enqueue point (before vs after `initializeJobs()`), and run-state persistence mode (job history only vs new tables).
- Lock canonical env contract (`PULL_ON_START`, optional tuning vars) and deterministic matching policy order.

### Phase 1 - Foundation wiring (parallel-heavy)

- Add config parsing for startup pull flags/options.
- Add job type plumbing (type union, display label, handler registration import).
- Add startup enqueue decision path in startup hook with dedupe key and non-blocking logging.

### Phase 2 - Pull engine implementation (largest, split by module)

- Build orchestrator/contracts under `lib/server/pull/startup/`.
- Implement Arr-type adapters and default filters by explicit `arr_type`.
- Implement matching/fingerprint utilities and safe-apply bridge to `arrSyncQueries.save*` paths.

### Phase 3 - Persistence and observability

- Implement handler output shape and structured counters.
- Optional branch A: job-history-only reporting (faster, lower migration risk).
- Optional branch B: dedicated run tables + query layer + migration (better diagnostics, higher coupling).

### Phase 4 - Verification and API/docs polish

- Unit tests for matching/defaults/retries/config parsing.
- Integration tests for startup queueing, non-blocking behavior, and idempotency.
- Optional support endpoint + OpenAPI updates.

## Task Granularity Recommendations

- Keep each implementation task to 1-3 files; prefer 2-file tasks for fast review and low conflict.
- Use "new-file-first" tasks for core logic (`pull/startup/*`) to avoid contention.
- Treat shared-file edits as dedicated micro-tasks (single owner), especially `hooks.server.ts` and `arrSync.ts`.
- Split tests by layer (pure unit vs startup/job integration) so they can run in parallel once contracts stabilize.

## Dependency Analysis

Independent early tasks:

- Config parsing task and job-type plumbing task can run in parallel.
- Pull engine submodules (`defaultFilters`, `matching`, arr-specific adapters) can run in parallel after contracts are defined.
- Test scaffolding can start once the orchestrator interface is stable, even before final hook wiring.

Hard dependencies:

- Startup hook enqueue depends on config + job type existing.
- Job handler registration depends on handler file + job type union.
- Integration tests depend on startup hook wiring and handler registration.
- If using dedicated run tables, migration must land before persistence query tests.

Primary bottlenecks/shared-file conflicts:

- `packages/praxrr-app/src/hooks.server.ts` (startup ordering is single-threaded).
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts` (global job type union).
- `packages/praxrr-app/src/lib/server/jobs/display.ts` and `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts` (registration fan-in).
- `packages/praxrr-app/src/lib/server/db/migrations.ts` (central migration list).
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` (very large; avoid broad edits).
- `docs/api/v1/openapi.yaml` (large shared spec file; defer optional endpoint edits late).

## File-to-Task Mapping

Recommended task map (1-3 files each):

- T1 Config flags
  - `packages/praxrr-app/src/lib/server/utils/config/config.ts`
  - `packages/praxrr-app/src/tests/base/pullOnStartupConfig.test.ts`

- T2 Job type plumbing
  - `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`
  - `packages/praxrr-app/src/lib/server/jobs/display.ts`
  - `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`

- T3 Startup enqueue wiring (late merge)
  - `packages/praxrr-app/src/hooks.server.ts`
  - `packages/praxrr-app/src/lib/server/jobs/queueService.ts` (only if helper extension is needed)

- T4 Core startup pull contracts
  - `packages/praxrr-app/src/lib/server/pull/startup/types.ts`
  - `packages/praxrr-app/src/lib/server/pull/startup/orchestrator.ts`
  - `packages/praxrr-app/src/lib/server/pull/startup/index.ts`

- T5 Matching utilities
  - `packages/praxrr-app/src/lib/server/pull/startup/matching.ts`
  - `packages/praxrr-app/src/lib/server/pull/startup/fingerprints.ts`

- T6 Default exclusion policy
  - `packages/praxrr-app/src/lib/server/pull/startup/defaultFilters.ts`
  - `packages/praxrr-app/src/lib/server/pull/startup/defaultCatalogs.ts`

- T7 Radarr adapter
  - `packages/praxrr-app/src/lib/server/pull/startup/handlers/radarr.ts`
  - `packages/praxrr-app/src/lib/server/pull/startup/handlers/shared.ts`

- T8 Sonarr adapter
  - `packages/praxrr-app/src/lib/server/pull/startup/handlers/sonarr.ts`
  - `packages/praxrr-app/src/lib/server/pull/startup/handlers/shared.ts`

- T9 Lidarr adapter (metadata-specific)
  - `packages/praxrr-app/src/lib/server/pull/startup/handlers/lidarr.ts`
  - `packages/praxrr-app/src/lib/server/pull/startup/handlers/lidarrMetadata.ts`

- T10 Selection apply bridge (idempotent save path)
  - `packages/praxrr-app/src/lib/server/pull/startup/applySelections.ts`
  - `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` (minimal surface changes only)

- T11 Job handler implementation
  - `packages/praxrr-app/src/lib/server/jobs/handlers/arrPullStartup.ts`
  - `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts` (import line)

- T12 Optional run-state persistence (only if chosen)
  - `packages/praxrr-app/src/lib/server/db/migrations/20260223_create_startup_pull_runs.ts`
  - `packages/praxrr-app/src/lib/server/db/migrations.ts`
  - `packages/praxrr-app/src/lib/server/db/queries/startupPull.ts`

- T13 Unit tests: policy/matching
  - `packages/praxrr-app/src/tests/base/pullOnStartupMatching.test.ts`
  - `packages/praxrr-app/src/tests/base/pullOnStartupDefaults.test.ts`
  - `packages/praxrr-app/src/tests/base/pullOnStartupConfig.test.ts` (if not added in T1)

- T14 Integration tests: startup/job behavior
  - `packages/praxrr-app/src/tests/jobs/pullOnStartupJob.test.ts`
  - `packages/praxrr-app/src/tests/base/startupPullBootstrap.test.ts`

- T15 Optional support endpoint
  - `packages/praxrr-app/src/routes/api/v1/system/startup-pull/latest/+server.ts`
  - `docs/api/v1/paths/system.yaml`
  - `docs/api/v1/openapi.yaml`

## Optimization Opportunities

- Decide early whether to use job-history-only vs dedicated tables; this removes a major branch of uncertainty and migration conflicts.
- Keep `arrSync.ts` changes minimal by implementing compare-before-save logic in a new `applySelections.ts` module and calling existing `get*`/`save*` methods.
- Merge high-conflict files last (`hooks.server.ts`, `queueTypes.ts`, `migrations.ts`, `openapi.yaml`).
- Reuse existing job patterns (`dedupeKey`, `JobHandlerResult`, `job_run_history`) to avoid introducing parallel operational state.
- Build per-Arr adapters as isolated files with explicit dispatch; this aligns with cross-Arr guardrails and enables true parallel ownership.

## Implementation Strategy Recommendations

- Use a two-track execution model:
  - Track A (wiring): T1, T2, T3, T11.
  - Track B (engine): T4-T10.
  - Join point: handler invokes orchestrator, then startup hook enqueues job.
- Sequence parallel batches as:
  - Batch 1: T1 + T2 + T4.
  - Batch 2: T5 + T6 + T7 + T8 + T9.
  - Batch 3: T10 + T11.
  - Batch 4: T3 + T13 + T14.
  - Batch 5 (optional): T12 + T15.
- Keep startup non-blocking invariant explicit in acceptance tests: enqueue failure logs warning and server still reaches "ready".
- Prefer feature-flag dark launch (`PULL_ON_START=false`) until tests prove idempotency and conflict handling.
