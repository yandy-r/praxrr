# pull-on-startup

`pull-on-startup` fits into Praxrr's existing startup pipeline in `hooks.server.ts`, where config, DB, PCD cache initialization, Arr instance reconciliation, and job initialization already run in strict order. The runtime already has a mature PCD pull-to-sync flow (`pcdManager.sync` -> `triggerSyncs`) and Arr sync persistence model (`arr_sync_*` tables), so this feature should integrate by reusing those boundaries instead of introducing parallel state paths. The core integration point is a gated startup phase (`PULL_ON_START`) that reads Arr state through typed clients, matches to local entities by explicit `arr_type`, then persists deterministic selections and outcomes. The feature must preserve existing non-blocking startup behavior, strict cross-Arr semantic guardrails, and operational visibility through queue/run status patterns.

## Relevant Files

- /packages/praxrr-app/src/hooks.server.ts: Startup sequence and safe insertion point for startup pull orchestration.
- /packages/praxrr-app/src/lib/server/utils/config/config.ts: Env parsing conventions and feature-flag configuration source.
- /packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts: Existing startup-time Arr reconciliation and non-blocking error posture.
- /packages/praxrr-app/src/lib/server/jobs/init.ts: Job system bootstrap ordering and recovery behavior.
- /packages/praxrr-app/src/lib/server/jobs/dispatcher.ts: Background execution model and structured run lifecycle.
- /packages/praxrr-app/src/lib/server/jobs/queueTypes.ts: Canonical job type registry for adding startup pull job type.
- /packages/praxrr-app/src/lib/server/jobs/handlers/index.ts: Handler registration entrypoint for new job handlers.
- /packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts: Queue persistence, dedupe keys, and job history coupling.
- /packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts: Pull-like job behavior and non-fatal failure handling pattern.
- /packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts: Arr section sync handler with Arr-type support checks.
- /packages/praxrr-app/src/lib/server/pcd/core/manager.ts: Existing PCD pull/compile flow and `on_pull` sync trigger integration.
- /packages/praxrr-app/src/lib/server/sync/processor.ts: Event-to-section fanout and pending-status queueing logic.
- /packages/praxrr-app/src/lib/server/db/queries/arrSync.ts: Selection persistence APIs and sync status transitions.
- /packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts: Encrypted credential resolution and typed Arr client creation.
- /packages/praxrr-app/src/lib/server/utils/arr/base.ts: Arr API read surface for quality/delay/config resources.
- /packages/praxrr-app/src/lib/server/sync/mappings.ts: Arr-specific section support and mapping constants.
- /packages/praxrr-app/src/lib/shared/arr/capabilities.ts: Arr capability matrix used for strict app-specific behavior.
- /packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts: Local quality profile discovery by Arr compatibility.
- /packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/read.ts: Local delay profile lookup for deterministic name matching.
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts: Local naming preset reads by Arr type.
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts: Local media settings reads by Arr type.
- /packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts: Quality definition lookup and mapping guards.
- /packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/read.ts: Lidarr-only metadata profile lookup.
- /packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts: Existing manual save path for sync selections and validations.

## Relevant Tables

- arr_instances: Arr instance registry with `type`, URL, enabled state, and source metadata.
- arr_instance_credentials: Encrypted API credentials keyed 1:1 to Arr instances.
- database_instances: Linked PCD repositories and sync strategy metadata.
- setup_state: Startup/setup singleton used by default DB auto-link flow.
- arr_sync_quality_profiles: Selected quality profile mappings for Arr/database scopes.
- arr_sync_quality_profiles_config: Trigger and sync status for quality profile section.
- arr_sync_delay_profiles_config: Selected delay profile plus section trigger/status.
- arr_sync_media_management: Naming/media settings/quality definitions selections and status.
- arr_sync_metadata_profiles_config: Lidarr metadata profile selections and section status.
- arr_database_namespaces: Namespace records connecting Arr instances to database scopes.
- job_queue: Scheduled and immediate background jobs with dedupe and retry metadata.
- job_run_history: Execution outcomes and output/error payloads for operational audit.

## Relevant Patterns

**Startup Orchestration**: Keep startup behavior explicit and ordered in one lifecycle entrypoint. See [/packages/praxrr-app/src/hooks.server.ts](/packages/praxrr-app/src/hooks.server.ts).

**Job-Backed Background Execution**: Represent long-running startup work as queue jobs with structured outcomes. See [/packages/praxrr-app/src/lib/server/jobs/dispatcher.ts](/packages/praxrr-app/src/lib/server/jobs/dispatcher.ts).

**Dedupe Queue Upsert**: Prevent duplicate runs using stable dedupe keys and queue upserts. See [/packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts](/packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts).

**Event-to-Section Sync Fanout**: Trigger section-specific Arr work from orchestrated events (`on_pull`, `on_change`, `schedule`). See [/packages/praxrr-app/src/lib/server/sync/processor.ts](/packages/praxrr-app/src/lib/server/sync/processor.ts).

**Arr-Type Explicit Dispatch**: Enforce per-app capabilities and reject sibling fallback logic. See [/packages/praxrr-app/src/lib/server/sync/mappings.ts](/packages/praxrr-app/src/lib/server/sync/mappings.ts).

**Selection Persistence via Query Layer**: Save sync scope through `arrSyncQueries` instead of ad-hoc writes. See [/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts](/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts).

## Relevant Docs

**/docs/plans/pull-on-startup/feature-spec.md**: You _must_ read this when working on feature scope, acceptance criteria, and pull-on-startup constraints.

**/docs/plans/pull-on-startup/research-technical.md**: You _must_ read this when working on startup insertion points, retries, and orchestration design.

**/docs/ARCHITECTURE.md**: You _must_ read this when working on startup lifecycle, PCD model, and sync/job subsystem boundaries.

**/docs/architecture/data-flow.md**: You _must_ read this when working on startup and sync event flow integration.

**/docs/features/link-bridge-sync.md**: You _must_ read this when working on pull-triggered Arr sync behavior and user expectations.

**/docs/api/v1/openapi.yaml**: You _must_ read this when working on any `/api/v1` startup-status endpoint additions.

**/docs/api/errors.md**: You _must_ read this when working on operational error responses and diagnostics output.
