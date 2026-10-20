# Business Research: Live Job and Sync Events (`/api/v1/events`)

Linear YAN-593, GitHub #335. Paths are relative to `packages/praxrr-app/src/` unless stated
otherwise. Line numbers refer to `origin/main` at 8417c992.

## Executive Summary

Praxrr runs all background work through one serialized job dispatcher. That dispatcher
(`lib/server/jobs/dispatcher.ts:54-68`) processes one job at a time from the SQLite `job_queue`
table. Each job moves through a small state machine:
`queued → running → success|failed|cancelled`, or back to `queued` when it reschedules. Every
transition happens in exactly one of a few places:

- `queueService.enqueueJob` and `upsertScheduledJob` (`lib/server/jobs/queueService.ts:5-19`)
- `jobQueueQueries.claimNextDue` (`lib/server/db/queries/jobQueue.ts:194-207`)
- `markFinished` (`jobQueue.ts:220-228`) and `reschedule` (`jobQueue.ts:209-218`), both called from
  `dispatcher.executeJob` (`dispatcher.ts:70-153`)
- startup recovery (`jobQueue.ts:269-275`, `lib/server/jobs/init.ts:10`)

Because the transitions are this centralized, job lifecycle events can be published from about
five call sites.

The hard business problem is **correlation**, not transport:

- The "Sync queued" toast fires before the dispatcher has done anything. The only durable link
  from a run to Sync History is `sync_history.job_id`, written by `recordSyncHistory`
  (`lib/server/sync/syncHistory/record.ts:192-212`, populated at
  `lib/server/jobs/handlers/arrSync.ts:851`). That row can be missing (history disabled, failure
  before the insert), and inline syncs (preview apply, canary) record `job_id = NULL`.
- Toast policy, scoping and grouping must be decided per job type. The decision is driven by
  `job_queue.source` (`'schedule' | 'manual' | 'system'`, `lib/server/jobs/queueTypes.ts:35`).

Key decisions in this document:

1. Toast only for `source = 'manual'` jobs on completion. Also toast failures of `system`/`schedule`
   sync-family jobs, but debounce them.
2. Treat the Sync History id as optional enrichment, carried by a separate `sync.recorded` event
   keyed by `jobId`. Fall back to `/sync-history?instanceId=…` when it is absent.
3. Broadcast all events to every authenticated principal. Praxrr is a single-tenant admin app with
   no per-user job ownership, so "my toast" means "a toast for a job that some session triggered
   manually".
4. Treat the events as invalidation hints. The DB stays the source of truth, which is what makes
   the stream degrade gracefully (acceptance criterion 3).

## User Stories

| ID   | As a…                                                | I want…                                                                                                           | So that…                                  | AC  |
| ---- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --- |
| US-1 | Operator on `/arr/{id}/sync`                         | the section status to go from pending to running to idle/failed, and "Last synced" to update, without a reload    | I know the sync I clicked actually ran    | AC1 |
| US-2 | Operator on Settings → Jobs                          | the scheduled-jobs table status/next run and the Job History list to update live                                  | I can watch the queue drain               | AC1 |
| US-3 | Operator on any page                                 | a success or failure toast when a sync I triggered finishes, with a **View details** link to `/sync-history/{id}` | I don't have to go looking for the result | AC2 |
| US-4 | Operator on `/sync-history`                          | new rows to appear as runs are recorded                                                                           | the audit list is current                 | —   |
| US-5 | Operator on `/canary/{id}`                           | the rollout to move from `rolling_out` to `completed`/`failed`, and batch progress to advance live                | I can watch a staged rollout              | —   |
| US-6 | Operator with drift detection enabled                | drift badges and summary to refresh when a sweep chunk persists new status                                        | drift indicators aren't stale             | —   |
| US-7 | Operator on a flaky network or across an app restart | pages to keep working and catch up once the stream is back                                                        | a dropped stream never blocks work        | AC3 |
| US-8 | Operator with a busy schedule                        | _not_ to get a toast for every successful scheduled job                                                           | toasts stay meaningful                    | —   |
| US-9 | API-token user (scripts, MCP)                        | to optionally consume the same stream with a `read`-scoped token                                                  | automation can follow job outcomes        | —   |

## Business Rules

### Job lifecycle and status vocabulary

- **BR-1: queue status.** `JobStatus = queued | running | success | failed | cancelled`
  (`queueTypes.ts:33`). Run outcome is a separate type,
  `JobRunStatus = success | failure | skipped | cancelled` (`queueTypes.ts:37`). The dispatcher
  maps `skipped → success` and `failure → failed` on the queue row (`dispatcher.ts:143-152`).
  Events MUST carry both values: the queue `status` for the Jobs table and the `runStatus` for
  toasts. Otherwise a `skipped` run would toast as a success.
- **BR-2: reschedule is not completion.** If a handler returns `rescheduleAt`, the dispatcher
  writes a `job_run_history` row and then puts the queue row back to `queued`
  (`dispatcher.ts:123,138-141`). It never calls `markFinished`. This applies to:
  - scheduled `arr.sync*` (`arrSync.ts:1189-1199`)
  - chunked `drift.check` (`handlers/driftCheck.ts:52-67`)
  - batched `sync.canary.rollout` (`handlers/canaryRollout.ts:97-103`)
  - TRaSH retry backoff (`handlers/trashGuideSync.ts:132,196-200`)

  Rule: emit `job.finished` with `rescheduled: true` for each run, but **suppress terminal toasts**
  for intermediate chunks. Drift continuation and canary non-terminal batches are progress, not
  completion. Toast the canary only on the terminal batch (`canaryRollout.ts:111-132`).

- **BR-3: a run-history row exists for every executed run.** That includes handler-not-found
  (`dispatcher.ts:79-88`) and thrown handlers (`dispatcher.ts:107-117`). `job_run_history.id` is
  therefore the durable per-run identity. `job_queue.id` is not, because scheduled rows are reused
  through `dedupe_key` (`jobQueue.ts:79-118`). Events SHOULD carry `queueId` and the new `runId`.
- **BR-4: safe copy only.** Failure text in events MUST come from `SafeJobEvidence`
  (`lib/shared/jobs/evidence.ts:54-66`, built by `buildSafeJobEvidence` at `dispatcher.ts:121`).
  Raw exception text goes only to the sanitized logger (`dispatcher.ts:110-116`,
  `queueTypes.ts:256-262`). The same rule applies to sync-history `error`.

### Correlation to Sync History

- **BR-5: who writes sync history.** `sync_history` rows are written only by the `arr.sync*`
  handler family (`arrSync.ts:1197-1201` registers five job types onto one handler) and by the
  inline reviewed-apply path (`arrSync.ts:711-725`).
  - Queued runs record `jobId = job.id` (`arrSync.ts:851`).
  - Inline runs record `jobId: null`: reviewed apply at `arrSync.ts:715`, and `executeSyncJob`
    synthesizes `id: 0`, which maps to `null` (`arrSync.ts:200-214,851`).
  - The handler returns `syncHistoryId` on every path (`arrSync.ts:59-62`), but the dispatcher
    discards it because `JobHandlerResult` has no such field (`queueTypes.ts:263-284`).
- **BR-6: no history row in these cases.** The link MUST be optional because no row is written
  when:
  - history is disabled (`record.ts:194-196`)
  - the insert fails (`record.ts:200-211`)
  - the payload is invalid (`arrSync.ts:789-796`)
  - the instance is disabled or missing (`arrSync.ts:799-807`)
  - the arr_type is unsupported (`arrSync.ts:812-828`)
  - the dispatcher found no handler or the handler threw (`dispatcher.ts:73-90,107-117`)

  Fallback link: `/sync-history?instanceId={id}` (the filter exists at
  `routes/sync-history/+page.server.ts:47-51`). If there is no instance either, link to
  `/settings/jobs`.

- **BR-7: one manual click produces one job, one run and at most one history row.** All four section
  sync actions enqueue a single-section job type with `source: 'manual'`:
  - `routes/arr/[id]/sync/+page.server.ts:777-782` (delay profiles)
  - `+page.server.ts:818-823` (quality profiles)
  - `+page.server.ts:859-864` (media management)
  - `+page.server.ts:905-910` (metadata profiles)

  Each run calls `recordHistory` exactly once on its terminal path (`arrSync.ts:1155`).
  Correlating `jobId → syncHistoryId` is therefore 1:1 for queued manual syncs.

- **BR-8: the enqueue response must return `jobId`.** The page receives the job id through the
  form action response, but today only `{ success, message }` is returned (`+page.server.ts:794`).
  The client then knows which job "it" started. That determines which job gets the
  originating-tab "View details" toast versus a passive cross-tab update. `queued.id` is already
  in scope at `+page.server.ts:787`.

### Toast policy

- **BR-9: success toasts are manual-only.** Toast success, partial or failure for `source = 'manual'`
  jobs on terminal (non-rescheduled) completion. `system` jobs (event-triggered on_pull/on_change
  syncs, `lib/server/sync/processor.ts:416-456`; startup pull, `hooks.server.ts:200-206`) and
  `schedule` jobs MUST NOT toast on success. This is the recommendation for the open question in
  the issue: scheduled successes are noise, since the schedule table already shows "last run".
- **BR-10: failure exception.** Toast `failure` for `system`/`schedule` jobs of the sync family
  (`arr.sync*`, `pcd.sync`, `trashguide.sync`, `sync.canary.rollout`). This mirrors the existing
  server-side policy: `fireNotification` only notifies on `failed`/`partial` (`record.ts:148-153`).
  Use a "warning" tone. Coalesce them: at most one toast per `jobType + instanceId` per 60 s. Never
  toast failures of maintenance jobs (`backup.cleanup`, `logs.cleanup`, `sync.history.cleanup`,
  `config-health.*`). Those surface on the Jobs page.
- **BR-11: partial results are not success.** A sync run whose history status is `partial`, or whose
  entities failed, is surfaced to the dispatcher as `failure` (`arrSync.ts:1103-1106,1192-1199`).
  The toast copy SHOULD use the sync-history status (`success | partial | failed | skipped`,
  `lib/server/sync/syncHistory/types.ts:31`) when `sync.recorded` is available, so "partial" is
  not shown as a hard failure.
- **BR-12: skipped and cancelled runs don't toast as success.** `runStatus = skipped` (no sections,
  or "already in progress", `arrSync.ts:874-882,1076-1086`) toasts as **info**.
  `runStatus = cancelled` (instance disabled, `arrSync.ts:799-807`; drift disabled,
  `driftCheck.ts:28-30`; canary not `rolling_out`, `canaryRollout.ts:77-82`) toasts as **warning**,
  but only for manual jobs.

### Scoping and auth

- **BR-13: no per-user job ownership.** `job_queue` has no user/session/principal column
  (`lib/server/db/schema.sql:169-183`). `users` is a flat table with no roles (`schema.sql:888-894`).
  Session and bypass principals hold every scope (`lib/server/utils/auth/principal.ts:1-19`).
  Rule: the stream is **global per install**. Every authenticated principal receives every event.
  The "originating tab" distinction is made client-side (BR-8), not by server filtering.
- **BR-14: auth gate.** The stream uses the existing middleware (`hooks.server.ts:248-256,319`).
  - API tokens need at least `read`, because it is a GET under `/api/v1`
    (`lib/shared/auth/apiTokenScopes.ts:6-14`; route policy in
    `lib/server/utils/auth/scopePolicy.ts`).
  - `AUTH=off` gives bypass access, which matches every other route.
  - Event payloads MUST NOT include secrets, URLs or API keys. Instance name and arr_type are
    already shown in the UI and safe (`queueTypes.ts:91`, `evidence.ts` target resolution at
    `lib/server/jobs/evidence.ts:130-139`).
- **BR-15: Arr types are not interchangeable.** Events carry the explicit `arrType`
  (`radarr | sonarr | lidarr`) taken from the instance or the history row, never inferred. Metadata
  profiles are Lidarr-only (`+page.server.ts:896-898`; recovery query at
  `lib/server/db/queries/arrSync.ts:1531-1534`). Clients filter by `instanceId`, never by arr_type
  alone.

### Deduplication, retries and restarts

- **BR-16: dedupe collapses triggers.** `upsertScheduled` re-arms an existing `dedupe_key` row in
  place and leaves running rows alone (`jobQueue.ts:97-100`). The unique index is at
  `lib/server/db/migrations/049_create_job_queue.ts:42`.
  - A second manual `pcd.sync` or `trashguide.sync` while one is running returns `already_running`
    (`lib/server/jobs/helpers/pcdSyncQueue.ts:42-48`,
    `lib/server/jobs/helpers/trashGuideSyncQueue.ts:117-124,153-158`).
  - Manual `arr.upgrade` uses `arr.upgrade.manual:{id}` (`routes/arr/[id]/upgrades/+page.server.ts:210-216`).
  - Rule: a coalesced trigger MUST NOT emit a second `job.queued` as a new job. Emit `job.queued`
    with the same `queueId`. Two clicks then share one completion toast.
  - Manual section syncs (`enqueueJob`, no dedupe key) can legitimately queue duplicates. The
    second run will report `skipped (sync already in progress)` only if they overlap, which the
    serial dispatcher makes unlikely, so both run.
- **BR-17: `attempts` counts claims, not retries.** `attempts` is incremented on every claim
  (`jobQueue.ts:200`), including after restart recovery. There is no generic retry policy. Retries
  exist only as handler-driven `rescheduleAt`: TRaSH exponential backoff
  (`trashGuideSync.ts:132-134`) and drift backoff (`driftCheck.ts:72-86`). The UI SHOULD show
  "retrying at …" for a rescheduled failure rather than a final failure toast.
- **BR-18: restart.**
  - `recoverRunning()` resets `running` rows to `queued` (`jobQueue.ts:269-275`).
  - `recoverInterruptedSyncs()` resets section `sync_status in_progress → pending`
    (`lib/server/sync/utils.ts:37-46`, `arrSync.ts:1518-1537` in queries), before the dispatcher
    starts (`init.ts:10-21`).
  - Any in-memory bus is lost, and clients must resync from the DB on reconnect. A job interrupted
    mid-run produces **no** `job_run_history` row and **no** `sync_history` row for the lost
    attempt. The re-run emits a fresh `job.running` → `job.finished` with the same `queueId`.
  - Arr writes may have partially applied. That is accepted today, and the canary/drift features
    exist to detect it.

## Workflows

### W1: Manual section sync (primary, AC1 and AC2)

1. The user clicks Sync in a section component, for example
   `routes/arr/[id]/sync/components/QualityProfiles.svelte:460`, which runs
   `fetch('?/syncQualityProfiles')`.
2. The action sets the section to `pending` (`+page.server.ts:817`; the guarded SQL at
   `arrSync.ts:1441-1446` keeps `in_progress`). It then calls `enqueueJob(..., source: 'manual')`
   (`+page.server.ts:818-823`), which notifies the dispatcher (`queueService.ts:11`).
   - Publish `job.queued{queueId, jobType, source:'manual', instanceId, arrType}`.
   - Return `jobId` (BR-8).
3. The dispatcher calls `claimNextDue()`, which sets `running` (`jobQueue.ts:194-207`).
   - Publish `job.running`.
4. The handler claims the section, `pending → in_progress` (`arrSync.ts:1076`; SQL at
   `lib/server/db/queries/arrSync.ts:1293-1299`), and runs it.
   - Optional `sync.section` progress event (out of scope v1).
5. The handler completes or fails the section, which sets `idle` + `last_synced_at`, or `failed`
   - `last_error` (`arrSync.ts:1116,1129`; SQL `arrSync.ts:1357-1405`). It then records history
     (`arrSync.ts:1155`).
   * Publish `sync.recorded{syncHistoryId, jobId, instanceId, arrType, status}` from inside
     `recordSyncHistory` after the insert (`record.ts:197`).
6. The dispatcher writes `job_run_history` (`dispatcher.ts:123`), then calls `markFinished`
   (`dispatcher.ts:152`).
   - Publish `job.finished{queueId, runId, status, runStatus, rescheduled:false, failure?}`.
7. On the client:
   - The sync page calls `invalidate()` for its load, which reads `arrSyncQueries.getFullSyncData`
     (`+page.server.ts:319`). This refreshes the status and "Last synced".
   - The layout toast listener matches `jobId` and shows the toast, with "View details" pointing to
     `/sync-history/{syncHistoryId}`.

   Ordering guarantee: `sync.recorded` (step 5) is emitted before `job.finished` (step 6) in the
   same handler turn. A client can therefore hold the id when the terminal event arrives. For
   robustness, the dispatcher SHOULD also lift `syncHistoryId` into `job.finished` (BR-5).

### W2: Event and scheduled syncs (BR-9, BR-10)

`triggerSyncs` calls `upsertScheduledJob(source:'system', dedupeKey:'arr.sync.X:event:{id}')`
(`processor.ts:394-457`). The scheduler uses `source:'schedule'` and `dedupeKey:'{jobType}:{id}'`
(`lib/server/jobs/schedule.ts:36-58`).

- Same events as W1.
- Toasts: none on success. A debounced warning on failure.
- Jobs page: `listScheduled()` shows only `dedupe_key NOT NULL AND source='schedule'` rows
  (`jobQueue.ts:143-148`; used at `routes/settings/jobs/+page.server.ts:17`). Event and manual jobs
  appear only in Job History (`+page.server.ts:38-50`, `getRecent(50)`).

### W3: Reviewed preview apply (inline, no queue)

`POST /api/v1/sync/preview/{previewId}/apply` runs `executeReviewedSyncJob` on the request
(`routes/api/v1/sync/preview/[previewId]/apply/+server.ts:269-275`). It returns
`syncHistoryId` directly in the response (`+server.ts:322,353`), and the panel already links it
(`routes/arr/[id]/sync/components/SyncPreviewPanel.svelte:492,931`).

- No job events are produced.
- `sync.recorded` still fires through `recordHistory` (`arrSync.ts:711`), with `jobId: null`.
- Other tabs and pages update through `sync.recorded`. The initiating tab already has its result,
  so it MUST NOT toast twice. Suppress toasts for `sync.recorded` with `jobId = null` and
  `trigger = manual`.

### W4: Canary rollout

States: `canary_running → awaiting_confirmation → rolling_out → completed|failed`, plus `aborted`
(`lib/server/sync/canary/types.ts:21-22`).

1. Start: `POST /api/v1/canary/rollouts` calls `startRollout` (`coordinator.ts:247-344`). The
   canary sync runs inline through `executeSyncJob(..., 'manual')`, so there is no queue job and
   history is recorded with `jobId null` (`coordinator.ts:61`).
   - Status `canary_running` is inserted, then moves to `awaiting_confirmation` or `aborted`
     through `recordCanaryOutcome` (`lib/server/db/queries/canaryRollouts.ts:627`).
2. Proceed: `proceedRollout` moves `awaiting_confirmation → rolling_out` (value-guarded by token,
   `canaryRollouts.ts:667`). It then enqueues `sync.canary.rollout` with `source:'manual'` and
   `dedupeKey:'canary.rollout:{id}'` (`coordinator.ts:347-379`).
3. Each batch syncs inline per target (`canaryRollout.ts:50`), with no per-target jobs, and calls
   `recordBatchProgress` (`canaryRollouts.ts:681`). It reschedules while targets remain
   (`canaryRollout.ts:97-103`).
4. Terminal batch: `finishRollout(completed|failed)` (`canaryRollouts.ts:695`), plus a
   notification (`canaryRollout.ts:111-119`).
5. Abort: `abortRollout` moves `awaiting_confirmation → aborted` (`coordinator.ts:384-401`;
   `canaryRollouts.ts:713`).

Events: `canary.updated{rolloutId, arrType, status, batchCursor, total}` from each of the five
query mutations, or from their coordinator/handler callers.

Toast: only on terminal `completed`/`failed`, and only for `sync.canary.rollout` (manual). Intermediate
`job.finished{rescheduled:true}` events are silent. Per-target syncs emit `sync.recorded`
(trigger `manual`, `jobId null`) and MUST NOT toast individually. Group them under the rollout,
because N toasts for N instances would be noise.

### W5: Drift check

- Scheduled sweep: `drift.check` (`dedupeKey:'drift.check'`, `schedule.ts:202-203`), chunked 5 at
  a time, rescheduling with `now` between chunks (`driftCheck.ts:21-59`).
- Per instance, `checkAndPersistInstance` upserts `drift_status` (`lib/server/sync/drift/persist.ts:95-127`).
  Statuses are `in-sync | drifted | unreachable | unauthorized | error`
  (`lib/server/sync/drift/types.ts:18`).
- The on-demand check (`routes/api/v1/drift/[instanceId]/+server.ts:56-91`) runs on the request
  thread, not the queue.

Event: `drift.updated{instanceId, arrType, status, driftedCount, missingCount, checkedAt}`, emitted
after the upsert, from both paths.

Toast: never for scheduled sweeps. Drift already has a server-side `drift.detected` notification
with signature dedupe (`persist.ts:28-46,133-147`). An optional future toast could reuse
`shouldNotify`.

### W6: Reconnect and restart (AC3)

The client keeps `lastEventId`. On reconnect:

- If the server can replay from its buffer, it replays.
- Otherwise (unknown id, or a new boot after restart, BR-18), it sends `resync`. The client then
  calls `invalidateAll()` once.

Pages never depend on the stream for correctness. Their loads read the DB. Toasts for jobs that
finished while disconnected are **not** replayed after a resync, because a stale toast is worse
than none. Instead, the originating tab may poll `jobRunHistoryQueries.getByQueueId`
(`lib/server/db/queries/jobRunHistory.ts:78`) for its pending `jobId` once on resync, and toast
if the job is terminal.

## Domain Model

| Entity             | Table / source                                                                           | Identity                                         | States                                                                           | Event relevance                    |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------- |
| Job (queue slot)   | `job_queue` (`schema.sql:169-183`)                                                       | `id`; reused via `dedupe_key` (unique, partial)  | `queued, running, success, failed, cancelled`                                    | `job.queued/running/finished`      |
| Job run            | `job_run_history` (`schema.sql:191-203`)                                                 | `id` (durable per run), `queue_id` FK `SET NULL` | `success, failure, skipped, cancelled` + `SafeJobEvidence`                       | `runId`, `runStatus`, safe failure |
| Sync run (audit)   | `sync_history` (`migrations/20260710_create_sync_history_tables.ts:31`)                  | `id`; `job_id` nullable, no FK                   | `success, partial, failed, skipped`                                              | `sync.recorded`, toast link        |
| Section sync state | `arr_sync_*_config.sync_status`, `last_synced_at` (`schema.sql:485-487,505-507,526-528`) | `instance_id` × section                          | `idle, pending, in_progress, failed`                                             | sync page live status              |
| Canary rollout     | `canary_rollouts`                                                                        | `id`, `state_token`                              | `canary_running, awaiting_confirmation, rolling_out, completed, aborted, failed` | `canary.updated`                   |
| Drift status       | `drift_status`                                                                           | `arr_instance_id`                                | `in-sync, drifted, unreachable, unauthorized, error`                             | `drift.updated`                    |
| TRaSH sync run     | queue payload `runToken` (`queueTypes.ts:65-81`) + `job_run_history.output` evidence     | `runToken` → `job_run_history.id`                | as Job                                                                           | already-correlated manual surface  |
| Principal          | `locals.principal` (`principal.ts:10-19`)                                                | session / bypass / token                         | —                                                                                | stream auth only; no ownership     |

Job types and toast class are listed below. The inventory is
`JOB_TYPES` (`queueTypes.ts:10-29`). Trigger sources were verified by grepping for
`enqueueJob` and `upsertScheduledJob`.

| Job type                                                                                    | Manual trigger                                                      | Scheduled / system                                          | Toast on success    | Toast on failure                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------- | ------------------------------------------------- |
| `arr.sync.{qualityProfiles,delayProfiles,mediaManagement,metadataProfiles}`                 | `routes/arr/[id]/sync/+page.server.ts:777-910`                      | schedule `schedule.ts:52-58`; system `processor.ts:416-456` | manual only         | manual: error; system/schedule: debounced warning |
| `arr.sync` (aggregate, legacy)                                                              | — (inline `executeSyncJob` uses id 0)                               | legacy scheduled, unscheduled at `schedule.ts:33`           | manual only         | as above                                          |
| `arr.upgrade`                                                                               | `routes/arr/[id]/upgrades/+page.server.ts:210-216` (upsert, manual) | `schedule.ts:78-79`                                         | manual only         | manual only                                       |
| `arr.rename`                                                                                | `routes/arr/[id]/rename/+page.server.ts:212-217`                    | `schedule.ts:99-100`                                        | manual only         | manual only                                       |
| `pcd.sync`                                                                                  | `lib/server/jobs/helpers/pcdSyncQueue.ts:54-62`                     | `schedule.ts:117-121`                                       | manual only         | all sources (debounced)                           |
| `trashguide.sync`                                                                           | `trashGuideSyncQueue.ts:145-151`, from `+page.server.ts:700-760`    | scheduled via same helper                                   | manual only         | all sources, unless rescheduled for retry         |
| `sync.canary.rollout`                                                                       | `coordinator.ts:368-374`                                            | —                                                           | terminal batch only | terminal batch only                               |
| `backup.create`                                                                             | `routes/settings/backups/+page.server.ts:63-64`                     | `schedule.ts:142-143`                                       | manual only         | manual only                                       |
| `logs.cleanup`                                                                              | `routes/settings/logs/+page.server.ts:28-29`                        | `schedule.ts:170-171`                                       | manual only         | never                                             |
| `drift.check`                                                                               | —                                                                   | `schedule.ts:202-203`                                       | never               | never (use `drift.updated`)                       |
| `arr.pull.startup`                                                                          | —                                                                   | system at boot, `hooks.server.ts:200-206`                   | never               | debounced warning                                 |
| `backup.cleanup`, `sync.history.cleanup`, `config-health.snapshot`, `config-health.cleanup` | —                                                                   | `schedule.ts:150,221,248,268`                               | never               | never                                             |

## Existing Codebase Integration

The publish points below are the minimum set needed to cover AC1–AC3.

- **Queued:**
  - `queueService.enqueueJob` and `upsertScheduledJob` (`queueService.ts:5-19`).
  - Direct `jobQueueQueries.upsertScheduled` callers also need to publish:
    - `schedule.ts:52`
    - `pcdSyncQueue.ts:54`
    - `trashGuideSyncQueue.ts:144`

    These bypass `queueService`, so publishing at the query layer or in a thin wrapper is safer.

  - `setRunNow` (`jobQueue.ts:230`).
- **Running:** after `claimNextDue()` returns, in `dispatcher.runDueJobs` (`dispatcher.ts:60-62`).
- **Finished:** in `dispatcher.executeJob`, after the history insert, on three branches:
  handler-missing (`:79-89`), reschedule (`:138-141`) and markFinished (`:152`). Extend the result
  plumbing so `SyncJobResult.syncHistoryId` (`arrSync.ts:59-62`) reaches the event.
- **Cancelled out-of-band:** these mutate state without the dispatcher, so the Jobs page needs a
  `job.updated` event (or plain invalidation) from them:
  - `cancelByDedupeKey` and `unscheduleByDedupeKey` (`jobQueue.ts:244-267`), with callers at
    `schedule.ts:38-130`, `renameHelpers.ts:4-8` and `trashGuideSchedule.ts:28`
  - `deleteByIds` (`lib/server/jobs/cleanup.ts:17-37`)
- **Sync recorded:** `recordSyncHistory` after insert (`record.ts:197`). This covers queued,
  inline-apply and canary syncs.
- **Section status:** `claim/complete/fail*Sync` in `lib/server/db/queries/arrSync.ts:1293-1405`.
  Optional for v1: `job.running` and `job.finished` with `instanceId` are enough to trigger
  `invalidate` on the sync page.
- **Canary:** the five mutators in `canaryRollouts.ts:627-713`.
- **Drift:** `driftStatusQueries.upsert` in `persist.ts:112`.
- **Restart:** `initializeJobs` (`init.ts:7-24`). A new boot id invalidates client cursors.

Client consumers:

- **Layout:** `routes/+layout.svelte:27` already mounts `<AlertContainer />`. That is the place to
  start `eventsStore` and the toast listener.
- **`alertStore.add`:** takes only a plain string (`lib/client/alerts/store.ts:19-35`). The
  "View details" link needs an optional action/href field on `Alert`, a contract change to
  `Alert.svelte`.
- **Pages to subscribe:**
  - `routes/settings/jobs/+page.server.ts:9-59`, which has no refresh today.
  - `routes/arr/[id]/sync/+page.svelte`, which currently toasts "Sync queued" then calls
    `invalidateAll` (`:363-364`).
  - `routes/sync-history/+page.server.ts:41`.
  - `routes/canary/[id]/+page.svelte`.
- **Ad-hoc intervals:** these are clock ticks for relative times, not data polling. They stay and
  are out of scope:
  - `SyncPreviewPanel.svelte:147` (15 s staleness)
  - `RenameSettings.svelte:40` (1 s countdown)
  - `CoreSettings.svelte:38` (1 s countdown)

## Success Criteria

1. Manual QP, DP, MM or MP sync on `/arr/{id}/sync`: the section goes `pending → in_progress →
idle|failed` and "Last synced" updates with no reload. The new run appears in Settings → Jobs →
   Job History within about 1 s of `markFinished`.
2. The originating tab shows exactly one terminal toast per manual job. It links to
   `/sync-history/{id}` when a history row exists, and otherwise to the filtered list. Another tab
   on a different page shows the same toast (global broadcast). Scheduled successes never toast.
3. Partial syncs toast as "partial" (warning), not success. Skipped runs toast as info.
4. Drift continuation chunks and non-terminal canary batches produce no toasts. A terminal canary
   produces one toast.
5. Kill the stream (network drop or server restart): every page still loads and acts normally.
   On reconnect the client resyncs with one `invalidateAll` and resumes live updates.
6. Payloads contain only safe, bounded fields: ids, `jobType`, `source`, `arrType`, instance name,
   statuses and `SafeJobEvidence` failure copy. No raw errors, URLs or keys.
7. API-token principals without the `read` scope get 403. Session, bypass and OIDC sessions are
   accepted.

## Open Questions

1. **Toast across tabs:** should the toast show in all tabs/sessions (simple, global) or only in
   the originating tab (needs `jobId` from BR-8)? Recommendation: the originating tab gets the rich
   toast, other tabs get the same toast, and `BroadcastChannel` dedupe is deferred.
2. **Lift `syncHistoryId` in the dispatcher:** should it be added to `JobHandlerResult` (cleaner),
   or should we rely only on `sync.recorded`? Recommendation: add an optional `syncHistoryId` to
   the success and failure arms, so `job.finished` is self-sufficient.
3. **Manual jobs on the Jobs table:** should manual and system jobs appear in the Jobs page table,
   not only in history? Today `listScheduled` hides them (`jobQueue.ts:143-148`), so AC1's "jobs
   page moves to running" is only visible for scheduled jobs or in Job History after completion.
   Recommendation: add a small "Active jobs" list (`status IN ('queued','running')`) fed by events.
4. **`upsertScheduled` changing source:** a manual `pcd.sync` upsert flips `source` to `manual`
   on the reused scheduled row (`pcdSyncQueue.ts:54-62`; `jobQueue.ts:106-115`). It also drops
   the row from `listScheduled` until it is rescheduled. Is that pre-existing bug in scope? This
   document only notes it.
5. **Toasts for system-triggered syncs:** should failures of on_pull/on_change syncs toast, or is
   the Notifications channel enough? Recommendation: one debounced warning.
6. **Drift toasts:** recommendation is no for v1. Badges and the dashboard (YAN-589) consume
   `drift.updated`.
7. **Multi-process deployment:** the in-memory bus assumes a single Deno process. That holds for
   the compiled binary and Docker today. Confirm it is not a goal to support more.
