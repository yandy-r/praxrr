# Canary Sync / Blast Radius Safety (Issue #19) — Design

Status: **Design approved (self)** · Scope: **Opt-in staged rollout orchestration over the existing per-instance sync engine, scoped to one `arr_type`, with a persisted human verification gate and a resumable batched rollout**
Parent: #6 · Depends on (shipped): #7 Sync Preview · #10 PCD Snapshots · #16 Rollback · #17 Sync History · #15 Drift
Related: #24 Adapter graceful degradation

## 1. Problem & Goals

Today a sync fans out to every eligible instance at once (`processPendingSyncs` fans out with concurrency 3; `triggerSyncs` enqueues one `arr.sync.<section>` job **per** instance). A bad configuration therefore lands on the entire fleet simultaneously. Canary Sync inserts a **staged rollout**: apply the change to a single low-risk "canary" instance first, let the user verify the result, and only then roll out to the rest — bounded by a user-chosen batch size.

Goals (from the issue):

1. **Canary selection** — user designates a canary instance, or the system auto-selects the least-critical one.
2. **Staged rollout** — sync canary → verify → sync remaining.
3. **Verification gate** — after the canary sync, surface results and **require explicit confirmation** before proceeding.
4. **Automatic abort** — if the canary sync fails, remaining instances are **never touched** (fail-closed).
5. **Blast-radius control** — user sets max **N** instances per batch.
6. **Opt-in** — single-instance (single eligible target) users skip the staged flow automatically.

Guiding principle: **canary is orchestration, not an engine.** The per-instance sync primitive (`executeSyncJob`) already snapshots (#10), captures a pre-sync diff (#7), records `sync_history` (#17), and fires `SYNC_FAILED`/`SYNC_PARTIAL` notifications. Canary sequences that primitive across instances and adds the smallest possible new surface: two tables, one coordinator, one resumable job, thin API/UI. **No changes to the section syncers or to `arrSyncHandler` internals.**

## 2. Non-Goals

| Issue idea                                                             | This PR         | Rationale                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canary **groups** (test → staging → prod)                              | ⏭️ follow-up    | v1 is single-canary + remaining. Groups need a per-instance group/rank attribute; deferred to avoid touching `arr_instances` schema now.                                                                                  |
| Real **criticality signal** on instances                               | ⏭️ follow-up    | Auto-select uses a fewest-configured-sections heuristic; a first-class `priority`/`is_critical` column is a separate change.                                                                                              |
| **Auto-revert of the canary's own Arr writes** on bad-config discovery | ❌ out of scope | The canary's writes are already applied to its Arr instance. Abort only spares _remaining_ instances. Canary recovery is a manual #10 snapshot + #16 PCD rollback action (UI links to it). This is disclosed, not hidden. |
| Atomic PCD+sync rollback                                               | ❌              | Same posture as #16: canary operates on live sync, PCD rollback is a separate, already-preview-gated step.                                                                                                                |
| Cross-`arr_type` rollouts                                              | ❌              | A rollout is scoped to exactly one `arr_type` (see §10).                                                                                                                                                                  |

## 3. Background — verified reuse points

Every load-bearing dependency below was verified against source:

- **`executeSyncJob(instanceId, sections, source)`** — `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:96`. Signature: `(instanceId: number, sections: readonly SectionType[], source: 'manual' | 'system' | 'schedule' = 'manual') => Promise<{ status: JobRunStatus; output?: string; error?: string; rescheduleAt?: string | null }>`. Runs **one** instance through the full flow (snapshot → capture → section loop → record). This is the single-instance primitive the coordinator calls — once for the canary, then per remaining instance.
- **`processBatches<T, R>(items, processor, concurrency)`** — `sync/processor.ts:251`. Bounded-concurrency batcher for max-N-per-batch. **Each batch is `Promise.all`, so a throwing processor aborts the whole batch** — our processor must be non-throwing (catch → return a failed result).
- **`generateInstancePreviews(requests)`** — `sync/processor.ts:91`, returns `GeneratePreviewResult[]`. Read-only per-instance diff; this is the "live preview for remaining" (#7 tie-in).
- **`deriveSyncHistoryStatus(ranSections, failures, sectionResults)`** — `sync/syncHistory/record.ts:38`, returns `'success' | 'partial' | 'failed' | 'skipped'`. Already invoked inside `arrSyncHandler`; the resulting classification is stored in the `sync_history.status` column.
- **`syncHistoryQueries`** — `db/queries/syncHistory.ts:189` (`insert`, `getById`, `search`, `count`, …). Used to read the canary's just-recorded row for **precise** partial detection (see §5.1).
- **`arrInstancesQueries.getEnabled()/getById()/getByType()`** — `db/queries/arrInstances.ts`. Eligible-target enumeration and per-instance dispatch.
- **`getConfiguredSections(instanceId)`** — `sync/registry.ts:56`. Input to the least-critical auto-select heuristic.
- **`isSyncPreviewArrType(value)`** — `sync/preview/types.ts:28` (**exported**). Per-Arr eligibility gate (`radarr | sonarr | lidarr`; excludes `all`/`chaptarr`). Used for selection and audit gating in place of `toSyncArrType`, which is a **non-exported** local in `arrSync.ts:186` — a new tiny exported helper `resolveSyncArrType(type)` (thin wrapper over `isSyncPreviewArrType`) lives in `sync/canary/selection.ts` so we do not export `arrSync.ts` internals.
- **`snapshotService.createAutoSnapshot({databaseId, trigger:'sync', targetInstanceIds:[canaryId]})`** — already fired **inside** `executeSyncJob`, so snapshot-before-canary (#10) comes for free; PCD rollback via the existing #16 route.
- **Resumable-job idiom** — `jobs/handlers/driftCheck.ts` self-reschedules (`rescheduleAt=now`) and persists cursor state in `drift_check_settings`, because `reschedule()` (`db/queries/jobQueue.ts:209`) **reuses the original payload**. `dispatcher.ts:142` honors `rescheduleAt`. `recoverRunning()` (`jobQueue.ts:269`) re-queues interrupted jobs at startup. This is the precedent the batched-rollout job follows.
- **Notification/UI templates** — `notifications/builder.ts` `notify()`, `notifications/types.ts` `NotificationTypes`, `record.ts` `fireNotification()`; `client/ui/modal/Modal.svelte`, `client/ui/sync-history/syncHistoryStatus.ts`; DB query/migration templates `db/queries/pcdRollbacks.ts`, `db/migrations/20260710_create_sync_history_tables.ts`.

## 4. Data Model

Two new app-DB tables (raw SQL via `DatabaseManager`, **not** Kysely), mirroring `sync_history` + `sync_history_settings`. Nullable FKs `ON DELETE SET NULL` with **denormalized names** so audit rows survive instance deletion; enums via `CHECK(... IN (...))`.

### 4.1 `canary_rollouts` (append-only audit + live state machine)

| Column                      | Type                           | Notes                                                                                                                                                    |
| --------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | INTEGER PK AUTOINCREMENT       |                                                                                                                                                          |
| `arr_type`                  | TEXT NOT NULL                  | `CHECK(arr_type IN ('radarr','sonarr','lidarr'))` — rollout is scoped to exactly one type                                                                |
| `status`                    | TEXT NOT NULL                  | `CHECK(status IN ('canary_running','awaiting_confirmation','rolling_out','completed','aborted','failed'))`                                               |
| `canary_instance_id`        | INTEGER                        | `REFERENCES arr_instances(id) ON DELETE SET NULL`                                                                                                        |
| `canary_instance_name`      | TEXT NOT NULL                  | denormalized                                                                                                                                             |
| `canary_status`             | TEXT                           | `CHECK(canary_status IN ('success','partial','failed','skipped'))` — from the recorded `sync_history.status`, fallback from `JobRunStatus`               |
| `canary_sync_history_id`    | INTEGER                        | `REFERENCES sync_history(id) ON DELETE SET NULL` — the canary's audit row (diagnostics source)                                                           |
| `sections`                  | TEXT                           | JSON array of requested `SectionType`, or NULL = all configured                                                                                          |
| `max_batch_size`            | INTEGER NOT NULL DEFAULT 1     | `CHECK(max_batch_size >= 1)`                                                                                                                             |
| `partial_policy`            | TEXT NOT NULL DEFAULT 'gate'   | `CHECK(partial_policy IN ('gate','abort'))` — how a `partial` canary is treated (see §9)                                                                 |
| `canary_output`             | TEXT                           | `executeSyncJob.output` human string                                                                                                                     |
| `canary_error`              | TEXT                           | diagnostics on failure                                                                                                                                   |
| `remaining_targets`         | TEXT NOT NULL                  | JSON `[{instanceId, instanceName}]` captured at start                                                                                                    |
| `batch_cursor`              | INTEGER NOT NULL DEFAULT 0     | index into `remaining_targets` the rollout job has reached (resumable)                                                                                   |
| `rollout_results`           | TEXT                           | JSON `[{instanceId, instanceName, status, output, error}]`, appended per instance                                                                        |
| `trigger`                   | TEXT NOT NULL DEFAULT 'manual' | `CHECK(trigger IN ('manual','system','schedule'))`                                                                                                       |
| `started_at`                | TEXT NOT NULL                  | ISO                                                                                                                                                      |
| `finished_at`               | TEXT                           | ISO; set on completed/aborted/failed                                                                                                                     |
| `state_token`               | TEXT NOT NULL                  | random token re-issued on every status transition; the value-guard for `/proceed` and `/abort` (mirrors the rollback route's `expectedCurrentStateHash`) |
| `created_at` / `updated_at` | TEXT NOT NULL                  |                                                                                                                                                          |

Indexes: `(status)`, `(arr_type, started_at DESC)`.

### 4.2 `canary_settings` (opt-in singleton)

| Column                       | Type                         | Notes                                                                            |
| ---------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `id`                         | INTEGER PK                   | `CHECK(id = 1)`, seeded `INSERT` in migration `up`                               |
| `enabled`                    | INTEGER NOT NULL DEFAULT 0   | opt-in; when 0 the staged flow is hidden and start falls through to a plain sync |
| `default_max_batch_size`     | INTEGER NOT NULL DEFAULT 1   | `CHECK(default_max_batch_size >= 1)`                                             |
| `auto_select`                | INTEGER NOT NULL DEFAULT 1   | allow least-critical auto-pick when no explicit/default canary                   |
| `default_canary_instance_id` | INTEGER                      | `REFERENCES arr_instances(id) ON DELETE SET NULL`                                |
| `default_partial_policy`     | TEXT NOT NULL DEFAULT 'gate' | `CHECK(default_partial_policy IN ('gate','abort'))`                              |
| `created_at` / `updated_at`  | TEXT NOT NULL                |                                                                                  |

Migration: `db/migrations/20260715_create_canary_rollouts.ts` (version `20260715`; **rebump past every merged date-based migration after syncing `main` and resolve the `migrations.ts` import + array conflict** per the repo's migration-version-collision memory). Register in **both** the static import block and the `loadMigrations()` array of `db/migrations.ts`. `down` drops both tables in reverse order. No `seedBuiltInBaseOps` touch — these are ordinary app-DB tables, not PCD base ops.

## 5. Architecture / Control Flow

Three phases. The **human gate is persisted state, not a paused job** — the queue has no `awaiting_confirmation` status (`JobStatus` is `queued|running|success|failed|cancelled`), and the dispatcher is single-flight, so a job cannot block on user input. The canary phase runs inline in the start request; the batched rollout is a **resumable one-shot job** so a large fleet never blocks an HTTP handler.

```
POST /rollouts ──► [Phase A: Canary, inline] ──► gate?
                                                   │ fail/abort-on-partial ─► status=aborted  (remaining untouched)
                                                   │ success (or partial+gate) ─► status=awaiting_confirmation
                                                   ▼
                          user reviews canary result + live preview of remaining
                                                   ▼
POST /rollouts/{id}/proceed ──► enqueue sync.canary.rollout job ──► [Phase B: resumable batches]
POST /rollouts/{id}/abort   ──► status=aborted (remaining untouched)
```

### 5.1 Phase A — Canary (inline in `POST /rollouts`)

`coordinator.startRollout(input)`:

1. Load `canary_settings`. Resolve the canary via `selection.resolveCanary` precedence: **explicit `canaryInstanceId` param > `default_canary_instance_id` > (if `auto_select`) least-critical heuristic > fail-closed 422** ("no canary resolvable").
2. Derive `arr_type` from the canary instance via `resolveSyncArrType(instance.type)`; **422** if it is not `radarr|sonarr|lidarr`.
3. `eligible = arrInstancesQueries.getEnabled()` filtered to the **same `arr_type`**. `remaining = eligible − canary`.
4. **Single-instance auto-skip:** if `eligible.length <= 1`, do **not** create a rollout row — call `executeSyncJob(canaryId, sections, 'manual')` once and return `{ skipped: true, result }` (a normal sync). Matches "single-instance users skip automatically."
5. Insert a `canary_rollouts` row `status='canary_running'`, `remaining_targets=remaining`, `state_token=<random>`.
6. Record `now = new Date().toISOString()` **before** dispatch (the canary window). Call `executeSyncJob(canaryId, sections, 'manual')` inline. It fires `createAutoSnapshot`, `capturePreSyncChanges`, the section loop, and `recordSyncHistory` unchanged.
7. **Classify the canary outcome (precise):** read the just-recorded row via `syncHistoryQueries.search({ arrInstanceId: canaryId }, { page: 1, pageSize: 1 })` (most recent, `started_at >= now`), taking its `status` column — already `success|partial|failed|skipped` from `deriveSyncHistoryStatus`. **Fallback** when sync-history is disabled (row absent): map the returned `JobRunStatus` (`success→success`, `skipped→skipped`, `failure/cancelled→failed`; `partial` is unrepresentable there, so the fallback is conservative — never silently upgrades to success). Persist `canary_status` + `canary_sync_history_id` + `canary_output`.
8. **Gate decision:**
   - `failed` → `status='aborted'`, `canary_error` = diagnostics, `finished_at=now`, emit `CANARY_FAILED`, **return without touching remaining**.
   - `skipped` (all sections gated/unsupported) → `status='aborted'` with a needs-attention reason; do **not** proceed on a non-result.
   - `partial` → honor `partial_policy`: `abort` → same as `failed`; `gate` (default) → treat as pass-with-warning and continue to the gate, diagnostics surfaced.
   - `success` (or `partial`+`gate`) → `status='awaiting_confirmation'`, re-issue `state_token`, build `remainingPreview = generateInstancePreviews(remaining.map(i => ({ instanceId: i.instanceId, sections })))`. **The request ends here** — nothing else runs until the user acts.

### 5.2 Phase B — Verification gate → resumable batched rollout

The gate is the persisted `awaiting_confirmation` row. The user confirms via `POST /rollouts/{id}/proceed` carrying the `state_token` they were shown:

1. Value-guard: reject **409** if `status !== 'awaiting_confirmation'` or **422** if `state_token` mismatches (concurrent/double-proceed protection, mirroring the rollback route's stale-state 422).
2. Set `status='rolling_out'`, re-issue `state_token`, then **enqueue a one-shot `sync.canary.rollout` job** (`enqueueJob({ jobType: 'sync.canary.rollout', payload: { rolloutId }, source: 'manual', dedupeKey: 'canary.rollout:' + rolloutId })`). Return immediately.
3. The `canaryRolloutHandler` (resumable, drift-style): load the rollout row, slice `remaining_targets[batch_cursor : batch_cursor + max_batch_size]`, run that slice through `processBatches(slice, nonThrowingProcessor, max_batch_size)` where the processor is `executeSyncJob` wrapped in `try/catch` returning a failed result (never throws → batch isolation preserved). Append per-instance outcomes to `rollout_results`, advance `batch_cursor`, then:
   - more targets remain → return `{ status: 'success', rescheduleAt: now }` (yield the dispatcher, resume next batch on the next wake — bounded wall-clock, no HTTP timeout, survives restart via `recoverRunning()` + the persisted `batch_cursor`).
   - none remain → set `status='completed'` (all instances ok) or `status='failed'` (any instance failed), `finished_at`, emit `CANARY_PROMOTED` or `CANARY_FAILED`, return terminal.

### 5.3 Abort

`POST /rollouts/{id}/abort`: value-guard `status === 'awaiting_confirmation'` (+ `state_token`); set `status='aborted'`, `finished_at`. Pure control flow — remaining instances are simply never dispatched. (A rollout already in `rolling_out` is not abortable in v1; see Open Questions.)

New job-type wiring (exact points): add `'sync.canary.rollout'` to the `JobType` union + a payload entry in `JobPayloadByType` (`jobs/queueTypes.ts`); create `jobs/handlers/canaryRollout.ts` calling `jobQueueRegistry.register('sync.canary.rollout', canaryRolloutHandler)`; add `import './canaryRollout.ts';` to `jobs/handlers/index.ts`; add a label case in `jobs/display.ts`.

## 6. API Surface (contract-first)

Add `docs/api/v1/schemas/canary.yaml` (component schemas: `CanaryRolloutStatus`, `CanaryStartRequest`, `CanaryStartResult`, `CanaryRolloutDetail`, `CanaryRolloutListResponse`, `CanarySettings`) and `docs/api/v1/paths/canary.yaml`; wire each URL under `paths:` in `docs/api/v1/openapi.yaml`; regenerate `v1.d.ts` (not CI-gated — avoid committing tool-version noise) and re-bundle `packages/praxrr-api/openapi.json` (`prettier --write`). Errors always `{ error: string }` via `schemas/arr.yaml#/ErrorResponse`.

| Method  | Path                                   | Purpose                                                                                                                                                                                                   |
| ------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`  | `/api/v1/canary/rollouts`              | Start: run canary inline, persist rollout, return canary result + `remainingPreview` (or a normal-sync result when auto-skipped). Body `{ canaryInstanceId?, sections?, maxBatchSize?, partialPolicy? }`. |
| `GET`   | `/api/v1/canary/rollouts`              | Paginated recent rollouts for the history table.                                                                                                                                                          |
| `GET`   | `/api/v1/canary/rollouts/{id}`         | One rollout: status, canary diagnostics, `remaining_targets`, `rollout_results`, `state_token`.                                                                                                           |
| `POST`  | `/api/v1/canary/rollouts/{id}/proceed` | Verification-gate confirm: value-guarded on `state_token`; enqueues the batched rollout job.                                                                                                              |
| `POST`  | `/api/v1/canary/rollouts/{id}/abort`   | Abort an `awaiting_confirmation` rollout; remaining untouched.                                                                                                                                            |
| `GET`   | `/api/v1/canary/settings`              | Read the settings singleton.                                                                                                                                                                              |
| `PATCH` | `/api/v1/canary/settings`              | Update opt-in enable, default batch size, `auto_select`, default canary, default partial policy.                                                                                                          |

Routes at `packages/praxrr-app/src/routes/api/v1/canary/**/+server.ts`. Reuse the rollback route's guardrails verbatim: `parsePositiveInteger` param guards; `Content-Length` + re-checked `TextEncoder` byte cap on bodies; `JSON.parse` in `try/catch`; typed-error → status discrimination (`400` bad body, `404` missing rollout, `409` wrong-state, `422` stale `state_token`, `500` wrapped with `logger.error(..., { source: 'CanaryRolloutsRoute' })`).

## 7. UI Surface (Svelte 5, no runes — `export let`, plain `let/const`, `onclick`)

- **`routes/canary/+page.server.ts`** — `load` exposes eligible instances (**id/name/type only**, gated by `isSyncPreviewArrType`, never credentials), recent rollouts via `canaryRolloutQueries.listRecent`, and `canary_settings`.
- **`routes/canary/+page.svelte`** — canary picker `DropdownSelect`, max-batch-size input, partial-policy toggle, **Start** button; rollouts `Table` with status badges from `client/ui/canary/canaryStatus.ts` (mirrors `syncHistoryStatus.ts`); `EmptyState` when none / when `canary_settings.enabled=0`.
- **`routes/canary/[id]/+page.{server.ts,svelte}`** — rollout detail: canary outcome + diagnostics (failed sections/`failedProfiles`), the `remainingPreview` rendered with a `SyncHistoryDiff`-style component, and the gate: `Modal.svelte` (`confirmDanger`, `loading`) for **"Proceed to remaining N instances"** (POST `/proceed`) and **"Abort rollout"** (POST `/abort`), disabled while requests run. A prominent note states the canary's own writes are **already applied** and links to snapshot #10 / rollback #16 for canary recovery.
- **`routes/settings/**`** — canary opt-in, default canary, default batch size, default partial policy (`PATCH /api/v1/canary/settings`).

Reuse `$ui` `Card/Table/Button/DropdownSelect/EmptyState/Badge`; navigate via `goto()` / `$app/stores`.

## 8. Reuse Map

| Existing surface                                                                                                                                                                    | How canary uses it                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `executeSyncJob` (`jobs/handlers/arrSync.ts:96`)                                                                                                                                    | Sync primitive — one call for canary, one per remaining instance. Unchanged.                                               |
| `processBatches` (`sync/processor.ts:251`)                                                                                                                                          | Max-N batch runner in the rollout job; **non-throwing** processor.                                                         |
| `generateInstancePreviews` (`sync/processor.ts:91`)                                                                                                                                 | Live preview of remaining instances for the gate (#7).                                                                     |
| `deriveSyncHistoryStatus` + `syncHistoryQueries.search`                                                                                                                             | Precise `success\|partial\|failed\|skipped` canary classification from the recorded row.                                   |
| `snapshotService.createAutoSnapshot` (inside `executeSyncJob`)                                                                                                                      | Snapshot-before-canary (#10), free. Recovery via `snapshotService.restore` / rollback route (#16).                         |
| `arrInstancesQueries.getEnabled/getById`                                                                                                                                            | Eligible-target enumeration + per-instance dispatch.                                                                       |
| `getConfiguredSections` (`sync/registry.ts:56`)                                                                                                                                     | Least-critical auto-select heuristic input.                                                                                |
| `isSyncPreviewArrType` (`sync/preview/types.ts:28`)                                                                                                                                 | Per-Arr eligibility gate (selection + audit).                                                                              |
| driftCheck resumable idiom + `dispatcher.ts:142` `rescheduleAt` + `recoverRunning()`                                                                                                | Resumable batched rollout job with persisted `batch_cursor`.                                                               |
| `notify()` + `NotificationTypes` + `record.ts` `fireNotification`                                                                                                                   | Emit `CANARY_FAILED` / `CANARY_PROMOTED` fire-and-forget.                                                                  |
| `db/queries/pcdRollbacks.ts`, `20260710_create_sync_history_tables.ts`, `Modal.svelte`, `syncHistoryStatus.ts`, `schemas/arr.yaml#/ErrorResponse` + rollback route body/value-guard | Copy-templates for `canaryRollouts.ts`, the migration, the confirm modal, status helper, error contract, and route guards. |

New modules: `sync/canary/{types.ts, selection.ts, coordinator.ts, notify.ts}`, `db/queries/{canaryRollouts.ts, canarySettings.ts}`, `jobs/handlers/canaryRollout.ts`, `client/ui/canary/canaryStatus.ts`, plus the two `NotificationTypes` keys (`CANARY_FAILED='canary.failed'`, `CANARY_PROMOTED='canary.promoted'`). Each file stays under the ~500-line soft cap.

## 9. Edge Cases

- **Single eligible target / only the canary enabled** → auto-skip, no rollout row, one `executeSyncJob` as a normal sync.
- **Canary is the only same-`arr_type` instance** (other types exist) → still auto-skip: per-Arr scope means no same-type remaining.
- **No canary resolvable** (`auto_select` off, no explicit param, no default) → fail-closed **422**, never a guess.
- **Canary returns `skipped`** (all sections gated/unsupported) → abort with a needs-attention reason; do **not** advance to remaining on a non-result.
- **Canary `partial`** → `partial_policy`: `gate` (default) surfaces `failedProfiles`/section diagnostics and lets the user decide; `abort` treats it as failure. Default is conservative-but-usable; policy is per-rollout (overridable from the settings default).
- **Throwing processor** → forbidden; `processBatches` uses `Promise.all`, so the processor wraps `executeSyncJob` in `try/catch` returning a failed result. Sibling instances in the batch still sync.
- **Double-proceed / concurrent proceed+abort** → `state_token` value-guard + status check reject the loser (**409/422**).
- **Instance deleted mid-rollout** → FK `ON DELETE SET NULL` + denormalized names keep the audit readable; the rollout job skips a now-missing/disabled target and records a skipped result (asserted by **exact `instance_id`**, not just counts, per the repo's scoped-propagation guardrail).
- **Server restart mid-rollout** → `recoverRunning()` re-queues the `sync.canary.rollout` job; it resumes from the persisted `batch_cursor` (idempotent slice).
- **`maxBatchSize` omitted** → falls back to `canary_settings.default_max_batch_size` (≥ 1).
- **Batch with an in-batch failure** → later batches still run (blast-radius isolation); final `status='failed'` with per-instance diagnostics in `rollout_results`.
- **Canary races a scheduled `arr.sync` for the same instance** → the existing atomic `claimSync/completeSync` serializes writes; overlapping runs are discouraged but safe (see Open Questions).

## 10. Per-Arr Semantics

- A rollout is scoped to **exactly one `arr_type`**, derived from the canary via `resolveSyncArrType`. `remaining` are enabled instances of the **same type only** — a bad Radarr config can never gate or abort a Sonarr rollout, and vice versa. This is the core blast-radius guardrail and satisfies the Cross-Arr policy.
- `canary_rollouts.arr_type` carries `CHECK IN ('radarr','sonarr','lidarr')`, matching `sync_history`. Selection rejects `all`/`chaptarr` via `isSyncPreviewArrType` before any sync runs.
- **Sections are resolved per instance** inside `executeSyncJob` (`resolveSectionsForInstance` / `getUnsupportedSyncSectionReason`); the coordinator never assumes the canary and its same-type peers share configured/supported sections.
- Least-critical auto-select is computed **within the `arr_type` cohort only** (fewest `getConfiguredSections`, tie-break lowest id) — never across types.
- No implicit sibling fallback anywhere: selection, eligibility, dispatch, and audit all resolve by explicit `arr_type`. Note the schema mismatch: `arr_instances.type` vs the audit tables' `arr_type`.

## 11. Failure & Diagnostics

- **Fail-closed core:** on `failed` (or `partial`+`abort`, or `skipped`) canary, `status='aborted'` and remaining instances are **never dispatched** — abort is simply not calling them. No auto-revert of the canary's writes is attempted or implied.
- **Diagnostics source:** the canary's `sync_history` row (linked via `canary_sync_history_id`) carries `section_results`, `failure_count`, `failedProfiles`, and the captured pre-sync `changes` — surfaced in the detail UI and in the notification embed.
- **Notifications** (add two `NotificationTypes` keys; emit via `record.ts`-style `fireNotification`): `CANARY_FAILED` on canary abort or any failed rollout instance; `CANARY_PROMOTED` on a clean completed rollout. Strictly `void notify(...).send().catch(()=>{})` — a webhook failure never affects the gate or rollout outcome.
- **Canary recovery** (documented, manual): the pre-canary snapshot (#10) plus PCD rollback (#16) restore the config source; the UI links directly to the snapshot/rollback surfaces. This is a known safety boundary of a live-sync canary, disclosed rather than papered over.

## 12. Test Strategy (unit + route, in-memory SQLite; e2e Playwright)

- **selection** — `resolveCanary` precedence (explicit > default > least-critical > fail-closed 422); per-`arr_type` cohort filter (Radarr canary never pulls Sonarr into `remaining`); `resolveSyncArrType` rejects `all`/`chaptarr`.
- **coordinator auto-skip** — `eligible <= 1` → no row created, `executeSyncJob` called exactly once (mock).
- **gate logic** — canary `failed` → `status='aborted'` and `executeSyncJob` **not** called for remaining (assert call count == 1); `success` → `awaiting_confirmation` + `remainingPreview` built; `partial`+`gate` → gated; `partial`+`abort` → aborted; `skipped` → aborted with reason.
- **classification** — precise `partial` read from the recorded `sync_history` row; fallback to `JobRunStatus` when history disabled never upgrades to success.
- **rollout job** — non-throwing processor: one target throws/fails, siblings still sync, final `status='failed'`, `rollout_results` captures per-instance error at the **exact `instance_id`**; `batch_cursor` advances and resumes; `max_batch_size` honored for N=1 and N=3; `recoverRunning` re-runs from cursor.
- **routes** — value-guard/error contracts (`400` bad body, `404` missing, `409`/`422` wrong-state/stale token, `500` wrapped) mirroring the rollback route; run under `deno task test <dir>` so routes type-check.
- **queries/migration** — `canaryRolloutQueries`/`canarySettings` `rowToDetail` round-trip + status/token guard; migration `up` creates tables + indexes + seeded settings row; `down` drops in reverse.
- **regression** — a canary run still produces the snapshot + `sync_history` row (no behavior change to `executeSyncJob`).
- **e2e** — start → gate modal shows canary result + remaining preview → proceed → completed; and canary-fail path → aborted with diagnostics, remaining untouched.

## 13. Open Questions

1. **Abort during `rolling_out`** — v1 only aborts at the gate. Cancelling an in-flight batched rollout would require a cooperative cancel flag checked between batches; deferred.
2. **`partial` default policy** — shipped as `gate` (pass-with-warning). Should the product default to `abort` for stricter safety? Configurable either way via `default_partial_policy`.
3. **Least-critical proxy** — fewest-configured-sections is a heuristic. Does the product want a real `priority`/`is_critical` signal on `arr_instances`? (New column, out of scope here.)
4. **Canary groups** (test → staging → prod) — a per-instance group/rank vs a mapping table; deferred to a follow-up that also carries the criticality signal.
5. **Overlap with scheduled syncs** — do we want a rollout to suppress/dedupe scheduled `arr.sync` for its `arr_type` while active, beyond the existing `claimSync` atomicity?
