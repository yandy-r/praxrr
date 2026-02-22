# pull-on-startup Implementation Plan

`pull-on-startup` adds an opt-in startup bootstrap that reconstructs Arr sync selections from live Arr state without blocking app readiness. The implementation should enqueue a dedicated startup job after core initialization, then execute deterministic per-`arr_type` matching (exact name first, fingerprint second) with conservative default/ambiguity skips. Persistence must flow through existing query and writer boundaries (`arrSyncQueries`, typed Arr clients, job queue history) to preserve idempotency and observability. This plan prioritizes wide parallel work by isolating new pull modules first, then converging on startup hook and handler wiring in later tasks.

## Critically Relevant Files and Documentation

- `packages/praxrr-app/src/hooks.server.ts`: Startup lifecycle ordering and insertion point for non-blocking enqueue.
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`: Env parsing conventions and typed runtime config.
- `packages/praxrr-app/src/lib/server/jobs/init.ts`: Job bootstrap sequence and readiness timing.
- `packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`: Dispatcher run lifecycle and handler execution semantics.
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`: Canonical job type and handler result contracts.
- `packages/praxrr-app/src/lib/server/jobs/display.ts`: Job label/description mapping for operator visibility.
- `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`: Central handler registration map.
- `packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`: Dedupe/upsert behavior and run history coupling.
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Canonical selection save/read APIs and validation boundaries.
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: Existing pull-to-sync integration boundaries (`on_pull` fanout).
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: Credential-aware typed Arr client factory.
- `packages/praxrr-app/src/lib/server/utils/arr/base.ts`: Arr read endpoints by app API version.
- `packages/praxrr-app/src/lib/server/sync/processor.ts`: Sync queue fanout semantics and pending-status behavior.
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`: Arr section support guards and dispatch contracts.
- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: App capability matrix used for strict cross-Arr behavior.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: Existing manual sync-selection persistence flow to mirror.
- `docs/plans/pull-on-startup/shared.md`: Shared context and required integration boundaries.
- `docs/plans/pull-on-startup/feature-spec.md`: Business rules, deterministic matching policy, and acceptance criteria.
- `docs/plans/pull-on-startup/research-technical.md`: Technical trade-offs around startup insertion and retries.
- `docs/ARCHITECTURE.md`: Architecture constraints across startup, PCD, and sync/job systems.
- `docs/architecture/data-flow.md`: Event flow patterns for pull -> selection persistence -> sync execution.
- `docs/features/link-bridge-sync.md`: Pull-triggered sync behavior and user-facing expectations.
- `docs/api/v1/paths/system.yaml`: Optional support endpoint path definitions.
- `docs/api/v1/openapi.yaml`: OpenAPI source of truth if endpoint support is added.

## Implementation Plan

### Phase 1: Startup Contract and Queue Wiring

#### Task 1.1: Add startup pull env parsing and defaults Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/pull-on-startup/feature-spec.md`
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`
- `packages/praxrr-app/src/hooks.server.ts`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/lib/server/utils/config/config.ts`

- Parse `PULL_ON_START` (default `false`) and optional tuning vars (`PULL_ON_START_MAX_CONCURRENCY`, `PULL_ON_START_TIMEOUT_MS`) using existing bool/number config patterns.
- Add strict validation for invalid numeric values and keep disabled-mode behavior explicit (no writes when false).
- Keep this task limited to config contract only; do not enqueue jobs from config code.
- Expected outcome: typed config fields exist with deterministic defaults for later unit test coverage.

#### Task 1.2: Register `arr.pull.startup` job type and payload contract Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts`
- `docs/plans/pull-on-startup/feature-spec.md`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`

- Add a dedicated job type for startup pull and define a typed output contract with run-level status plus per-instance counters.
- Reuse existing `JobHandlerResult` semantics (`success|failure|skipped|cancelled`) and avoid introducing a parallel status model.
- Include fields needed for acceptance criteria (`imported`, `skipped_default`, `skipped_no_match`, `conflicted`, `failed`).
- Expected outcome: queue type system can represent startup pull jobs and their structured output safely.

#### Task 1.3: Add startup pull display metadata Depends on [1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/jobs/display.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/lib/server/jobs/display.ts`

- Add job display metadata for startup pull so runs are recognizable in existing job surfaces.
- Keep this task focused on visibility only; handler registration is completed in Task 3.4 after orchestrator logic exists.
- Expected outcome: startup pull job names and status text are operator-readable from first execution.

#### Task 1.4: Insert startup enqueue gate after job initialization Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/hooks.server.ts`
- `packages/praxrr-app/src/lib/server/jobs/init.ts`
- `packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/hooks.server.ts`

- Add gated startup logic that enqueues exactly one startup pull job when `PULL_ON_START=true` and jobs are initialized.
- Use explicit dedupe key format `arr.pull.startup:boot` for one-run-per-process intent and keep all failures warn-and-continue.
- Log explicit disabled state when the feature flag is false.
- Expected outcome: startup remains non-blocking while reliably scheduling background pull work.

### Phase 2: Pull Engine Modules (Parallel First)

#### Task 2.1: Create startup pull contracts and module skeleton Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/pull-on-startup/shared.md`
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/types.ts`

Files to Modify

- None

- Define core interfaces for instance inputs, matching results, counters, and run summary payload.
- Add module-level type exports that downstream tasks can consume without circular imports.
- Keep contracts Arr-type explicit so adapters cannot accidentally cross-dispatch.
- Expected outcome: downstream tasks implement against stable typed contracts with low merge risk.

#### Task 2.2: Implement deterministic matching and fingerprint helpers Depends on [2.1]

**READ THESE BEFORE TASK**

- `docs/plans/pull-on-startup/feature-spec.md`
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/matching.ts`
- `packages/praxrr-app/src/lib/server/pull/startup/fingerprints.ts`

Files to Modify

- None

- Implement deterministic match order: exact name first, then metadata fingerprint for singleton-style configs.
- Return explicit classifications (`matched`, `no_match`, `conflicted`) with reason details for diagnostics.
- Do not trim persisted names; normalize only for comparison where required.
- Expected outcome: reusable matcher utilities produce deterministic, testable outcomes across handlers.

#### Task 2.3: Implement default exclusion catalogs and filters Depends on [2.1]

**READ THESE BEFORE TASK**

- `docs/plans/pull-on-startup/research-external.md`
- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/defaultCatalogs.ts`
- `packages/praxrr-app/src/lib/server/pull/startup/defaultFilters.ts`

Files to Modify

- None

- Encode explicit per-`arr_type` default detection rules for supported entity families.
- Mark uncertain default identification as `skip` rather than import.
- Keep policy data separate from filter logic to make audits and future updates safer.
- Expected outcome: startup pull consistently excludes defaults without cross-Arr assumptions.

#### Task 2.4: Add shared Arr adapter utilities and dispatch helpers Depends on [2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/arr/base.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/handlers/shared.ts`

Files to Modify

- None

- Implement shared helper functions for instance/client loading, capability checks, and standardized adapter result envelopes.
- Enforce explicit `arr_type` guards in shared helpers so adapters fail fast on unsupported families.
- Keep helper APIs narrow to reduce accidental coupling between adapters.
- Expected outcome: per-Arr adapter tasks can proceed independently on a common base.

#### Task 2.5: Implement Radarr startup pull adapter Depends on [2.2, 2.3, 2.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/base.ts`
- `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/handlers/radarr.ts`

Files to Modify

- None

- Fetch supported Radarr resources via `/api/v3` client surfaces and convert to matcher/filter inputs.
- Apply default filtering before matching and classify ambiguous outcomes explicitly.
- Export adapter shape compatible with shared handler contracts from Task 2.4 and include unreachable/auth failure classification for warn-and-continue handling.
- Keep Radarr-specific semantics local to this adapter (no shared fallback assumptions).
- Expected outcome: Radarr adapter returns deterministic selection candidates and counters.

#### Task 2.6: Implement Sonarr startup pull adapter Depends on [2.2, 2.3, 2.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/base.ts`
- `packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/read.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/handlers/sonarr.ts`

Files to Modify

- None

- Implement Sonarr-specific reads and candidate shaping using `/api/v3` semantics.
- Reuse shared helpers but keep Sonarr policy boundaries explicit and isolated.
- Export adapter shape compatible with shared handler contracts from Task 2.4 and include unreachable/auth failure classification for warn-and-continue handling.
- Ensure unsupported sections are reported as skipped with reason metadata.
- Expected outcome: Sonarr adapter parity with deterministic classification and skip behavior.

#### Task 2.7: Implement Lidarr startup pull adapters including metadata profiles Depends on [2.2, 2.3, 2.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/base.ts`
- `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/read.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/handlers/lidarr.ts`
- `packages/praxrr-app/src/lib/server/pull/startup/handlers/lidarrMetadata.ts`

Files to Modify

- None

- Implement Lidarr-specific fetch/match flow using `/api/v1` semantics and metadata-profile support.
- Keep metadata profile handling isolated so Radarr/Sonarr paths never import Lidarr-only logic.
- Export adapter shape compatible with shared handler contracts from Task 2.4 and include unreachable/auth failure classification for warn-and-continue handling.
- Emit explicit skip reasons when Lidarr capabilities are unavailable or ambiguous.
- Expected outcome: complete Lidarr adapter coverage with strict app-specific behavior.

#### Task 2.8: Implement media-management selection extraction utilities Depends on [2.2, 2.3, 2.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`
- `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts`
- `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/mediaManagement.ts`

Files to Modify

- None

- Build Arr-type-aware helpers that gather and normalize local media-management candidates for naming, media settings, and quality definitions.
- Reuse deterministic matching and default exclusion policies from Tasks 2.2 and 2.3 while keeping explicit per-`arr_type` rules.
- Emit structured classification results compatible with adapter/orchestrator result contracts.
- Expected outcome: media-management families are first-class in startup pull coverage with reusable helper APIs.

### Phase 3: Persistence Bridge and Execution Assembly

#### Task 3.1: Add run-result aggregation and status classification helpers Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- `docs/plans/pull-on-startup/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/results.ts`

Files to Modify

- None

- Add helper functions that roll per-instance counters into run-level status (`success|partial|failed|skipped|disabled`).
- Keep status mapping deterministic and easy to assert in tests.
- Do not couple these helpers to DB or queue code.
- Expected outcome: all execution paths share one consistent result-shaping module.

#### Task 3.2: Implement idempotent selection-apply bridge through query layer Depends on [2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/applySelections.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`

- Build compare-before-save helpers that call existing `arrSyncQueries.save*` APIs only when selection state changes.
- Preserve exact persisted names and existing trigger/scheduling fields unless explicitly updated by this feature.
- Consume startup contract types introduced in Task 2.1 to keep apply payloads consistent.
- Keep `arrSync.ts` changes minimal and scoped to reusable query helpers needed by apply logic.
- Expected outcome: startup pull writes are idempotent, validated, and routed through canonical persistence APIs.

#### Task 3.3: Implement orchestrator execution flow and bounded concurrency Depends on [1.1, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`
- `packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`
- `packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`
- `docs/plans/pull-on-startup/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/orchestrator.ts`
- `packages/praxrr-app/src/lib/server/pull/startup/index.ts`

Files to Modify

- None

- Implement end-to-end orchestration: enumerate enabled instances, run adapter by `arr_type`, apply selections, aggregate results.
- Enforce bounded concurrency/timeouts from config and keep per-instance failures isolated (warn/record/continue).
- Ensure ambiguity/default/no-match outcomes are surfaced as counters, not hidden logs.
- Expected outcome: one orchestrator call executes deterministic startup pull behavior with structured output.

#### Task 3.4: Implement `arr.pull.startup` job handler execution path Depends on [1.2, 3.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts`
- `packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/jobs/handlers/arrPullStartup.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`

- Replace placeholder handler with orchestrator execution and map results to `JobHandlerResult` status/output.
- Keep error handling consistent with existing handlers: throw only for truly fatal setup issues, otherwise return structured failure/skipped results.
- Include source-tagged logs and avoid sensitive payload output.
- Expected outcome: queued startup pull jobs execute through the standard dispatcher lifecycle.

#### Task 3.5: Align startup pull with existing pull-to-sync boundaries Depends on [3.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- `packages/praxrr-app/src/lib/server/sync/processor.ts`
- `docs/features/link-bridge-sync.md`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- `packages/praxrr-app/src/lib/server/sync/processor.ts`

- Ensure startup pull selection writes and existing `on_pull` fanout do not queue duplicate sync work for the same instance/section.
- Keep trigger semantics explicit (`on_pull` vs startup bootstrap) and preserve pending-status transitions expected by processor logic.
- Add guardrails so startup pull integrates with current fanout flow instead of bypassing it.
- Expected outcome: startup pull and existing sync pipeline coexist without double-execution or status drift.

#### Task 3.6: Finalize startup enqueue payload and dedupe semantics Depends on [1.4, 3.4, 3.5]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/hooks.server.ts`
- `packages/praxrr-app/src/lib/server/jobs/queueService.ts`
- `packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/hooks.server.ts`
- `packages/praxrr-app/src/lib/server/jobs/queueService.ts`

- Align startup enqueue call with final job payload and dedupe key contract.
- Keep dedupe key composition stable as `arr.pull.startup:boot` and place run-specific timestamps in payload, not key.
- Ensure enqueue failures do not block startup completion and are logged with actionable context.
- Avoid duplicate runs from repeated startup hooks in the same process lifecycle.
- Expected outcome: startup reliably enqueues one actionable job with durable traceability.

#### Task 3.7 (Optional): Add dedicated startup pull run persistence tables Depends on [3.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/migrations.ts`
- `packages/praxrr-app/src/lib/server/db/migrations/049_create_job_queue.ts`
- `docs/plans/pull-on-startup/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/db/migrations/20260223_create_startup_pull_runs.ts`
- `packages/praxrr-app/src/lib/server/db/queries/startupPull.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/db/migrations.ts`

- Add dedicated run and per-instance outcome tables only if job-history payload is insufficient for required visibility.
- Keep migration additive and avoid changing existing job history schema in this task.
- Ensure query APIs expose latest run summary and simple historical lookup.
- Expected outcome: optional persistence path exists without disturbing MVP behavior.

### Phase 4: Verification and Optional API Surface

#### Task 4.1: Create shared startup-pull test fixtures Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/base/BaseTest.ts`
- `packages/praxrr-app/src/tests/jobs/lidarrSync.test.ts`
- `docs/plans/pull-on-startup/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/base/pullOnStartupFixtures.ts`

Files to Modify

- None

- Add deterministic fixture builders for Arr payloads, local entities, and expected counter outcomes.
- Keep fixtures Arr-type explicit to avoid cross-app test leakage.
- Include ambiguous/default/no-match variants for reuse across unit and integration suites.
- Expected outcome: later tests share stable inputs and reduce duplicated setup code.

#### Task 4.2: Add unit tests for config, matching, and default filtering Depends on [1.1, 2.2, 2.3, 4.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/base/BaseTest.ts`
- `packages/praxrr-app/src/tests/base/envInstances.test.ts`
- `docs/plans/pull-on-startup/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/base/pullOnStartupConfig.test.ts`
- `packages/praxrr-app/src/tests/base/pullOnStartupMatching.test.ts`
- `packages/praxrr-app/src/tests/base/pullOnStartupDefaults.test.ts`

Files to Modify

- None

- Cover deterministic match order, ambiguity classification, and conservative default skips by `arr_type`.
- Assert invalid env parsing and disabled-mode behavior clearly.
- Keep tests table-driven and isolated from live network calls.
- Expected outcome: core policy logic is locked down before full integration runs.

#### Task 4.3: Add startup/job integration tests for non-blocking behavior Depends on [3.6, 4.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/base/envInstances.test.ts`
- `packages/praxrr-app/src/tests/jobs/lidarrSync.test.ts`
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/jobs/pullOnStartupJob.test.ts`
- `packages/praxrr-app/src/tests/base/startupPullBootstrap.test.ts`

Files to Modify

- None

- Verify startup enqueue executes after job initialization and readiness is preserved when instances fail.
- Assert partial-success semantics and per-instance error isolation.
- Validate dedupe behavior prevents duplicate startup runs for the same boot intent.
- Expected outcome: runtime safety contract (non-blocking + best effort) is proven.

#### Task 4.4: Add idempotency and counter accuracy coverage Depends on [4.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/jobs/lidarrSync.test.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`
- `docs/plans/pull-on-startup/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/jobs/pullOnStartupIdempotency.test.ts`

Files to Modify

- None

- Add repeated-run tests to verify unchanged inputs produce no additional writes.
- Assert run-level and per-instance counters align with underlying classification events.
- Include explicit assertions for `skipped_default`, `skipped_no_match`, and `conflicted` totals.
- Expected outcome: acceptance criteria for idempotency and diagnostics become regression-protected.

#### Task 4.5 (Optional): Add support endpoint and OpenAPI updates for latest startup run Depends on [3.4, 3.7]

**READ THESE BEFORE TASK**

- `docs/api/v1/paths/system.yaml`
- `docs/api/v1/openapi.yaml`
- `docs/api/errors.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/api/v1/system/startup-pull/latest/+server.ts`

Files to Modify

- `docs/api/v1/paths/system.yaml`
- `docs/api/v1/openapi.yaml`

- Add `GET /api/v1/system/startup-pull/latest` only if product surfaces require API-level status retrieval.
- Source the endpoint from dedicated startup pull run tables created in Task 3.7 (if 3.7 is skipped, defer this task).
- Keep response schema aligned with runtime output contracts and standardized error responses.
- Do not add endpoint fields that runtime cannot populate for each `arr_type`.
- Expected outcome: optional API path provides consistent latest-run visibility for UI/support use.

## Advice

- Preserve one canonical startup sequence: initialize jobs first, then enqueue startup pull; this keeps readiness non-blocking and avoids dispatcher race conditions.
- Treat `arr_type` as a hard boundary in every adapter/filter/matcher path; cross-app fallback shortcuts will create silent contract drift.
- Keep `arrSync.ts` edits minimal by isolating new compare-before-save behavior in `applySelections.ts`; large edits there will create avoidable merge and regression risk.
- Use job history output as MVP observability and gate dedicated DB tables behind a clear operational need to reduce migration overhead.
- Merge high-conflict files (`hooks.server.ts`, `queueTypes.ts`, `jobs/handlers/index.ts`, `db/migrations.ts`, `docs/api/v1/openapi.yaml`) late and via narrow tasks to preserve parallel throughput.

## Phase Completion Checklist

- [ ] Phase 1 complete: config contract, queue type, display mapping, startup enqueue gate all merged.
- [ ] Phase 2 complete: adapters plus media-management helper cover all in-scope entity families by explicit `arr_type`.
- [ ] Phase 3 complete: apply bridge, orchestrator, handler, pull-to-sync boundary guardrails, and dedupe semantics validated.
- [ ] Phase 4 complete: unit/integration/idempotency suites pass and optional endpoint branch (if chosen) is contract-aligned.
