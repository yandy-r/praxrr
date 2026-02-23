# Architecture Research: pull-on-startup

## System Overview

Praxrr startup is centralized in `hooks.server.ts`, where core services initialize in sequence: config, DB/migrations, logging, PCD cache, env Arr instance reconciliation, then job system startup. Current "pull" behavior in runtime primarily means PCD repository pull/compile, while Arr synchronization remains a push pipeline driven by persisted sync selections. A new pull-on-startup feature fits best as a startup orchestration step that reuses existing Arr clients, sync selection persistence, and PCD entity readers. The architecture already enforces Arr-specific behavior by `arr_type`, which is required for this feature.

## Relevant Components

- `/packages/praxrr-app/src/hooks.server.ts`: Startup lifecycle and insertion point for startup pull orchestration.
- `/packages/praxrr-app/src/lib/server/utils/config/config.ts`: Env parsing patterns; where `PULL_ON_START` would be read.
- `/packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`: Existing startup-time Arr reconciliation pattern and non-blocking failure posture.
- `/packages/praxrr-app/src/lib/server/jobs/init.ts`: Job bootstrap order and recovery/scheduler startup.
- `/packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`: Execution model for queued background work.
- `/packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`: Job type registry union (startup pull type would be added here if job-backed).
- `/packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`: Queue persistence, dedupe keys, and run-history coupling.
- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: PCD initialize/sync behavior and on-pull trigger integration.
- `/packages/praxrr-app/src/lib/server/sync/processor.ts`: Event fan-out to section-specific Arr sync jobs.
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Persistent sync selections and section status transitions.
- `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: Encrypted credential resolution and Arr client creation.
- `/packages/praxrr-app/src/lib/server/utils/arr/base.ts`: Arr API read/write primitives used by sync/pull flows.
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts`: Arr-type-aware local quality profile discovery.
- `/packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/read.ts`: Local delay profile lookup for deterministic name matching.
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`: Local naming preset lookup by Arr type.
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts`: Local media settings lookup by Arr type.
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts`: Quality definition mapping and compatibility checks.
- `/packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/read.ts`: Lidarr metadata profile lookup.
- `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: Capability matrix and Arr-specific feature support.
- `/packages/praxrr-app/src/lib/server/sync/mappings.ts`: Arr-specific sync section mapping constants and support constraints.

## Data Flow

1. Startup enters `hooks.server.ts` and initializes config, DB, migrations, logging, and PCD cache.
2. Env-managed Arr instances are reconciled into `arr_instances` via `reconcileEnvInstances()`.
3. Jobs subsystem is initialized and dispatcher starts processing queued work.
4. Existing pull flow (`pcdManager.sync`) performs git pull + compile and triggers Arr sync sections via `triggerSyncs({ event: 'on_pull' })`.
5. Arr sync jobs resolve per-section selections from `arr_sync_*` tables and push selected local PCD entities to Arr.
6. Pull-on-startup would add a pre-sync bootstrap stage that pulls Arr resources and reconstructs local section selections deterministically.

## Integration Points

- Startup insertion in `/packages/praxrr-app/src/hooks.server.ts` after PCD initialization and env instance reconciliation.
- Feature flag parsing in `/packages/praxrr-app/src/lib/server/utils/config/config.ts`.
- Optional job execution path using `/packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`, `/packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`, and `/packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`.
- Selection writes through `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` (`saveQualityProfilesSync`, `saveDelayProfilesSync`, `saveMediaManagementSync`, `saveMetadataProfilesSync`).
- Arr data reads via `/packages/praxrr-app/src/lib/server/utils/arr/base.ts` and typed clients in `/packages/praxrr-app/src/lib/server/utils/arr/clients/`.
- Matching against local entities through `/packages/praxrr-app/src/lib/server/pcd/entities/**` and Arr capability guards.

## Key Dependencies

- SvelteKit server startup (`hooks.server.ts`) for one-time process bootstrap.
- SQLite app DB (`arr_instances`, `arr_sync_*`, `job_queue`, `job_run_history`) for persisted state and observability.
- Arr clients and encrypted credential subsystem for authenticated remote reads.
- PCD cache/entity readers for deterministic local matching by name and Arr semantics.
- Jobs/dispatcher infrastructure for non-blocking background execution and retry/reporting.
