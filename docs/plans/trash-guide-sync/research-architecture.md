# Architecture Research: trash-guide-sync

## System Overview

The Deno/SvelteKit app boots via `src/hooks.server.ts`, which initializes config, the SQLite-backed
DB, migrations, then starts the `pcdManager` (cloning/compiling PCD repositories) before spinning up
the job queue and scheduling system-wide pulls for Arr instances and databases
(`packages/praxrr-app/src/hooks.server.ts:1`). Syncing to Arr instances is handled by a shared
`sync/processor`, which pulls `arrSync` configs, enqueues jobs through the queue service, and runs
section handlers (`packages/praxrr-app/src/lib/server/sync/processor.ts:1`), so any TRaSH-derived
source simply needs to inject its data into the existing cache/sync pipeline.

## Relevant Components

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:1`: orchestrates cloning/cloning
  validation, dependency handling, `importBaseOps`, seeding built-ins, and calling
  `compile`/`triggerSyncs`; TRaSH sync will model its lifecycle after this manager so TRaSH data
  feeds the same cache flow.
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts:1`: builds the in-memory Kysely/SQLite
  cache by replaying SQL ops and applying value guards before swapping it into the registry
  (`registry.ts`), so the TRaSH cache can either wrap `PCDCache` or reuse its schema to stay
  compatible with syncers.
- `packages/praxrr-app/src/lib/server/sync/processor.ts:1`: loads registered section handlers
  (`qualityProfiles`, `delayProfiles`, `mediaManagement`, `metadataProfiles`), evaluates schedules,
  claims pending syncs, and runs previews/syncers; TRaSH-triggered pulls simply call `triggerSyncs`
  with `event='on_pull'`.
- `packages/praxrr-app/src/lib/server/jobs/schedule.ts:1`: central scheduler that reads
  `arrSync`/`databaseInstances` rows to enqueue `arr.sync.*` and `pcd.sync` jobs via
  `jobQueueQueries` and `notify`; TRaSH sync adds `scheduleTrashGuideSyncForSource()` here and
  shares the same clock/notify mechanism.
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts:1`: union of job types consumed by the
  dispatcher and handlers, so adding `trashguide.sync` here wires the new job through the queue.
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts:1`: stores/cash resolves per-instance
  sections (triggers, `should_sync`, `sync_status`, selections) referenced by every section handler;
  the TRaSH job will push `should_sync` flags just like the existing handlers do.
- `docs/plans/trash-guide-sync/feature-spec.md:446` (and supporting technical doc): lists the
  planned `packages/praxrr-app/src/lib/server/trashguide/*` modules (`manager`, `fetcher`, `parser`,
  `transformer`, `cache`, `types`, plus `db/queries/trashGuide*`), so implementation can mirror the
  current PCD lifecycle while keeping TRaSH-specific logic isolated.

## Data Flow

A `trashguide.sync` job (per the spec’s job diagram) clones/pulls the TRaSH Git repo via shared
`$utils/git` helpers, diffs changed JSON files, parses them, maps TRaSH entities (`trash_id`, score
profiles, Arr type) into PCD ops, and rebuilds an in-memory cache
(`docs/plans/trash-guide-sync/research-technical.md:26`, feature spec). Once the cache is up, the
TRaSH manager triggers `triggerSyncs` with `event: 'on_pull'`, and the existing section handlers
query the cache through `pcd/database/registry.ts`/`PCDCache` exactly as they would for any regular
database (`packages/praxrr-app/src/lib/server/pcd/database/cache.ts:1`). Preview generation and the
Arr syncer classes then issue HTTP calls via `arrInstanceClients` to Radarr/Sonarr, so the TRaSH
data enters the Arr ecosystem without new sync code.

## Integration Points

- The TRaSH manager hooks into startup after `pcdManager.initialize()` (per the spec) so it can
  reuse `jobs/init.ts` and `jobQueue` infrastructure from day one
  (`packages/praxrr-app/src/hooks.server.ts:1`).
- The job module plugs a `trashguide.sync` handler into `jobs/dispatcher.ts`/`handlers/index.ts`,
  reusing the existing queue/handler pattern
  (`packages/praxrr-app/src/lib/server/jobs/queueTypes.ts:1` and
  `packages/praxrr-app/src/lib/server/jobs/schedule.ts:1`) and aligns dedupe keys with
  `trashguide.sync:{sourceId}`.
- Newly introduced `trashGuideSources`, `trashGuideSync`, and `trashGuideEntityCache` query modules
  sit beside other `$db/queries` files so the UI and job handlers can persist settings (per feature
  spec) and so the scheduler can mark `nextRunAt`/`enabled` states alongside `arrSync` rows.
- Sync sections (`qualityProfiles`, `delayProfiles`, `mediaManagement`, `metadataProfiles`) already
  operate on cached data fetched via `getCache` and `arrSyncQueries`; no new sections are needed if
  TRaSH data populates the same cache and triggers `setShouldSync`.
- Arr sync scheduling (`jobs/schedule.ts`) already uses `calculateNextRun` and
  `jobQueueQueries.upsertScheduled`/`notify`, so TRaSH sources just need their own scheduling helper
  to follow the same cadence.

## Key Dependencies

- `@jsr/db__sqlite` + `Kysely` (with `@soapbox/kysely-deno-sqlite` in the cache) for in-memory
  caches and typed DB access (`packages/praxrr-app/src/lib/server/pcd/database/cache.ts:1` imports
  all three).
- Existing `$utils/git/*` helpers (clone/pull/status) for safely managing the TRaSH repository
  before transformation (`packages/praxrr-app/src/lib/server/pcd/core/manager.ts:1` reuses these
  helpers already).
- Job queue primitives (`jobQueueQueries`, `jobDispatcher`, `queueTypes`) and `cron` support via
  `calculateNextRun`/`calculateNextRunFromMinutes` so TRaSH sync can reuse the scheduler
  (`packages/praxrr-app/src/lib/server/jobs/schedule.ts:1`).
- Arr HTTP clients and wrappers in `packages/praxrr-app/src/lib/server/utils/arr` so quality
  profiles/media settings syncers can keep using the same API layer once the TRaSH cache feeds them.
