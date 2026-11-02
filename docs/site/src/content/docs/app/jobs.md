---
title: Job System
description: Background job queue persistence, dispatcher claim loop, handler registration, Config Health jobs, scheduling dedupe, and per-handler rescheduleAt behavior.
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
| `config-health.snapshot`           | `{}`                                          |
| `config-health.cleanup`            | `{}`                                          |

## Backups

`backup.create` archives `config.paths.data`. The `praxrr.db` entry in the archive is a
`VACUUM INTO` snapshot. The live database and its `-wal`, `-shm`, and `-journal` files are
not copied. Restore from **Settings → Backups** validates and stages the archive. The swap
runs at the next startup, before the database opens. The previous `data/` directory is kept
as `data.pre-restore-*`.

Accepted `backup_settings.schedule` values are `hourly`, `daily`, `weekly`, `monthly`,
`0 */6 * * *`, and `0 */12 * * *`. `weekly` is the next Sunday at 00:00 in the process
local timezone. A restart keeps an earlier queued `backup.create` when that row is still
`queued`, `source` is `schedule`, and its payload schedule matches the current setting
(a missing payload schedule counts as a match). Migration `20261029` rewrites stored
`*/6 hours` and `*/12 hours` to the two cron values. Any other stored schedule is logged
and treated as one hour ahead.

## Config Health Jobs

`config-health.snapshot` runs a chunked, instance-ordered sweep of enabled sync-capable Arr
instances. It scores each instance and appends the report to `config_health_snapshots`. Scheduled
sweeps persist their cursor between chunks and schedule the next interval after the terminal chunk;
a manual run does not make itself recurring.

Snapshot insertion is the primary-operation boundary. Only after the insert succeeds does the
handler read the adjacent persisted predecessor and evaluate a possible `health.degraded` event.
Assessment, state claim or re-arm, rendering, notification manager, provider, history, and secondary
logging failures are contained by that post-insert boundary. They do not undo the snapshot, fail
sibling instances, change sweep progress, or activate the snapshot handler's failure backoff.

`config-health.cleanup` prunes snapshots by retention age and then caps the rows that remain. The
scheduled job recurs daily; a manual run performs one cleanup only. Both Config Health jobs cancel
when Config Health scoring is disabled.

## Dispatcher

`JobDispatcher` in `dispatcher.ts`:

1. Queries the next queued job and sets a timer for `runAt`
2. On wake, claims due jobs in a loop (`claimNextDue`)
3. Looks up the handler in `jobQueueRegistry`
4. Executes the handler and records run history
5. On `rescheduleAt` in the handler result, reschedules instead of marking finished

There is **no central retry policy** — handlers return `rescheduleAt` and optional
`cooldownUntil` when they want another run.

Bookkeeping after the handler returns is independent. A failed history insert or finish
log does not drop `rescheduleAt`. `job.finished` is still published. `handedBack` is true
only when that reschedule changes `source` (a manual PCD or TRaSH sync handing the slot
back to `schedule`). A database error while claiming a job or looking up the wake time
waits 60 seconds and tries again.

A failed scheduled run of `backup.create`, `backup.cleanup`, `logs.cleanup`, `arr.upgrade`,
or `arr.rename` returns the next normal slot. A scheduled `pcd.sync` or `trashguide.sync`
failure does the same when that database or source still has a schedule. A scheduled
`arr.sync*` run does too, including a failure while creating the Arr client. A credential
failure disables the instance and does not reschedule. A manual `pcd.sync` or
`trashguide.sync` hands the slot back when auto-sync is still enabled (`sync_strategy` /
`syncStrategy` greater than 0). Other manual runs, and runs whose target was deleted or
disabled, do not recur. A scheduled TRaSH git/network failure can use a short retry (up to
3 attempts) before that next interval; a total parse failure (`parser_failed`) does not.

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
- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthCleanup.ts`

## Related

- [Sync Pipeline](/app/sync-pipeline/) — preview vs execution, `arr.sync.*` jobs
- [Startup Sequence](/app/startup/) — `initializeJobs()` during boot
- [Architecture Overview](/app/architecture/) — module map
- [Testing](/app/testing/) — `deno task test jobs` alias
