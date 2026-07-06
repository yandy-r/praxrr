---
title: Job System
description: Background job queue persistence, dispatcher claim loop, handler registration, scheduling dedupe, and per-handler rescheduleAt retry behavior.
---

Praxrr runs background work through a SQLite-backed **job queue** and a timer-driven
**job dispatcher**. Handlers register via side-effect imports; scheduling lives in
`schedule.ts` and is separate from sync-module trigger logic in `$sync/processor.ts`.

## Persistence

Jobs are stored in the app database (`job_queue` table) via `jobQueueQueries`:

| Field           | Purpose                                                     |
| --------------- | ----------------------------------------------------------- |
| `jobType`       | Discriminator for handler lookup                            |
| `runAt`         | ISO timestamp when the job becomes due                      |
| `payload`       | Typed JSON per job type                                     |
| `source`        | `schedule`, `manual`, or `system`                           |
| `dedupeKey`     | Prevents duplicate scheduled jobs for the same logical work |
| `cooldownUntil` | Optional cooldown passed through on reschedule              |
| `status`        | `queued`, `running`, `success`, `failed`, `cancelled`       |

Run history is recorded in `job_run_history` for debugging and UI display.

## Job Types

Defined in `queueTypes.ts`:

| Type                               | Typical payload                               |
| ---------------------------------- | --------------------------------------------- |
| `arr.sync.qualityProfiles`         | `{ instanceId }`                              |
| `arr.sync.delayProfiles`           | `{ instanceId }`                              |
| `arr.sync.mediaManagement`         | `{ instanceId }`                              |
| `arr.sync.metadataProfiles`        | `{ instanceId }`                              |
| `arr.sync`                         | `{ instanceId, sections? }` (legacy combined) |
| `arr.pull.startup`                 | `{ enqueuedAt? }`                             |
| `arr.upgrade`                      | `{ instanceId }`                              |
| `arr.rename`                       | `{ instanceId }`                              |
| `pcd.sync`                         | `{ databaseId }`                              |
| `trashguide.sync`                  | `{ sourceId, trigger }`                       |
| `backup.create` / `backup.cleanup` | `{}`                                          |
| `logs.cleanup`                     | `{}`                                          |

## Dispatcher

`JobDispatcher` in `dispatcher.ts`:

1. Queries the next queued job and sets a timer for `runAt`
2. On wake, claims due jobs in a loop (`claimNextDue`)
3. Looks up the handler in `jobQueueRegistry`
4. Executes the handler and records run history
5. On `rescheduleAt` in the handler result, reschedules instead of marking finished

There is **no central retry policy** — handlers return `rescheduleAt` and optional
`cooldownUntil` when they want deferred retry.

## Handler Registration

Handlers self-register when imported. `dispatcher.ts` imports `./handlers/index.ts`,
which side-effect imports:

- `arrSync.ts`, `arrPullStartup.ts`, `arrUpgrade.ts`, `arrRename.ts`
- `pcdSync.ts`, `trashGuideSync.ts`
- `backupCreate.ts`, `backupCleanup.ts`, `logsCleanup.ts`

Adding a job type requires a handler file, registry entry, and queue type definition.

## Scheduling

`schedule.ts` functions upsert scheduled jobs with dedupe keys such as
`arr.sync.qualityProfiles:{instanceId}` or `pcd.sync:{databaseId}`. Cron-based Arr sync
schedules read sync config from `arrSyncQueries` and compute next run times.

`scheduleAllJobs()` runs during `initializeJobs()` after recovering interrupted
`running` jobs back to `queued`.

## Startup Recovery

`initializeJobs()` in `init.ts`:

1. `jobQueueQueries.recoverRunning()` — reset stuck running jobs
2. `scheduleAllJobs()` — refresh scheduled work for instances and databases
3. `jobDispatcher.start()` — begin the claim loop

## Relationship to Sync

Sync **execution** is triggered by `arr.sync.*` jobs and by direct calls from
`triggerSyncs()` after PCD pulls or changes. Sync **scheduling** in `$sync/` evaluates
cron triggers and enqueues jobs — do not conflate that module with `jobs/schedule.ts`
persistence mechanics.

## Source References

- `packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`
- `packages/praxrr-app/src/lib/server/jobs/init.ts`
- `packages/praxrr-app/src/lib/server/jobs/schedule.ts`
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/`

## Related

- [Sync Pipeline](/app/sync-pipeline/) — preview vs execution, `arr.sync.*` jobs
- [Startup Sequence](/app/startup/) — `initializeJobs()` during boot
- [Architecture Overview](/app/architecture/) — module map
- [Testing](/app/testing/) — `deno task test jobs` alias
