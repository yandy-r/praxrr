# Canary Sync / Blast Radius Safety (#19) — Implementation Plan

Derived from `docs/plans/canary-sync-blast-radius/design.md` + an adversarial 3-lens design critique (correctness/integration · contract-fidelity/per-arr · scope/testability). The critique found three **substantiated blockers** in the design's cited call sites — a compile-breaking classification read, a `runAt`-less `enqueueJob`, and a resumability precedent that would silently stop the rollout after one batch — all folded in below. This is a thin-orchestration feature over the existing per-instance sync primitive `executeSyncJob` (`packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`), with a persisted verification gate and a resumable batched rollout job scoped to one `arr_type`.

## Validated adjustments (must-fixes)

1. **Classification read signature was wrong three ways** — design cited `syncHistoryQueries.search({ arrInstanceId: canaryId }, { page: 1, pageSize: 1 })`. The real filter key is `instanceId` (not `arrInstanceId`), pagination is `{ limit, offset }` (not `{ page, pageSize }`), and there is no `started_at >= now` predicate — the timestamp bound is the `from` filter (`db/queries/syncHistory.ts:76-90,169-172,235`). As written it fails `deno check`; if typed loosely the instance predicate drops and `search` returns the newest row across **all** instances/arr_types, letting a Sonarr sync classify a Radarr canary. **Fix:** `syncHistoryQueries.search({ instanceId: canaryId, from: now }, { limit: 1, offset: 0 })`, capturing `const now = new Date().toISOString()` **before** the canary `executeSyncJob` call, and assert `row.arrInstanceId === canaryId` before trusting it. When the bounded search returns no row (history disabled, or instance disabled mid-run returns `cancelled` with no audit row, `arrSync.ts:308-311`), **fall through to the JobRunStatus mapping** — never read an older row that could upgrade a fail to `success`.

2. **`enqueueJob` requires `runAt`** — the design's `enqueueJob({ jobType, payload, source, dedupeKey })` omits `runAt`, which is **non-optional** on `CreateJobQueueInput` (`db/queries/jobQueue.ts:48-55`, read directly into the INSERT at 58-73; `queueService.ts:5` passes input verbatim). An empty/undefined `run_at` also breaks `getNextDueQueued`'s `datetime(run_at)` due-check. **Fix:** enqueue with `runAt: new Date().toISOString()`, and add `CanaryRolloutJobPayload { rolloutId: number }` to `JobPayloadByType` so the payload type-checks against the union.

3. **Rollout must reschedule unconditionally, not `driftCheck`-style** — the design names `jobs/handlers/driftCheck.ts` as the resumable precedent, but `driftCheckHandler` only returns `rescheduleAt` when `job.source === 'schedule'` (`driftCheck.ts:52-70`). The rollout job is enqueued `source: 'manual'`, so copying that guard verbatim runs exactly **one batch** then terminates — remaining batches never execute. The dispatcher honors `rescheduleAt` for any source (`dispatcher.ts:142`). **Fix:** in `canaryRolloutHandler`, `return { status: 'success', rescheduleAt: new Date().toISOString() }` **while `batchCursor < remainingTargets.length`**, regardless of `job.source`. Do not port the `isScheduled` guard.

4. **`executeSyncJob` source is always `'manual'`** — for the canary call and every remaining-instance call. `source: 'schedule'` skips sections whose `config.trigger !== 'schedule'` (`arrSync.ts:483`), silently under-syncing peers. The default `'manual'` applies no schedule-gating.

5. **`CanaryStartResult` is a discriminated union on `skipped`** — the POST response is two-headed: `{ skipped: true, result: SyncRunResult }` on single-eligible-target auto-skip vs `{ skipped: false, rollout: CanaryRolloutDetail, remainingPreview: [...] }` at the gate. Contract-first is a hard repo rule; define it as a `oneOf` with `discriminator: skipped` in `canary.yaml` and assert both arms in a route test.

6. **Gate preview must not 500 the rollout** — `generateSingleInstancePreview` **throws** if a target instance is missing/disabled (`processor.ts:64-79,91-101`). Building `remainingPreview` after a successful canary can 500 if a remaining instance was disabled/deleted between selection and preview, stranding the row in `awaiting_confirmation`. **Fix:** re-filter `getEnabled()` immediately before `generateInstancePreviews`, and wrap the build in `try/catch` degrading to an empty preview.

7. **Non-throwing per-instance processor** — `processBatches(slice, processor, maxBatchSize)` runs the processor inside `Promise.all` batch isolation; a throw rejects the whole batch. The processor MUST wrap `executeSyncJob(..., 'manual')` in `try/catch` and return `{ ..., status: 'failure', error }` on throw, and record a `skipped` result at the **exact `instanceId`** for missing/disabled targets (scoped-propagation guardrail).

8. **Single injectable token seam** — `state_token` is generated only via `sync/canary/token.ts#newStateToken()` (impl `crypto.randomUUID()`) so guard tests can stub it. Guard tests assert token **inequality / round-trip**, not a fixed value. Clock stays inline `new Date().toISOString()`; the `from: now` bound makes classification deterministic without a clock injection.

9. **`dedupeKey` is advisory only** — `jobQueueQueries.create` does **not** enforce dedupe uniqueness (only `upsertScheduled` does, `jobQueue.ts:79-84`). The `state_token` value-guard on `markRollingOut` is the real double-proceed guard.

10. **Rollback copy-template path corrected** — the design cites `routes/api/v1/databases/[databaseId]/snapshots/[snapshotId]/rollback/+server.ts`; the real guardrail file is at `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/rollback/+server.ts`. Copy `parsePositiveInteger`, Content-Length + `TextEncoder` byte cap, `JSON.parse` try/catch, typed-error→status, and `{ error: string }` contract from there.

11. **Migration version `20260714`** — latest merged date-based migration on this worktree's `main` is `20260713_create_pcd_rollbacks`; `20260714` is the minimal free version. Per the migration-version-collision memory, **re-run the collision check before merge**: if any migration `> 20260713` landed, rebump to the next free date-version and resolve the `db/migrations.ts` import+array conflict. Register in **both** the static import block and the `loadMigrations()` array. No `seedBuiltInBaseOps` change (app-DB tables, not PCD base ops).

12. **Diagnostics split (explicit)** — `syncHistoryQueries.search` returns `SyncHistorySummary` (`id` + `status`, sufficient for classification and to store `canary_sync_history_id`) but **not** `section_results`/`changes`. The detail UI fetches full canary diagnostics via `syncHistoryQueries.getById(canarySyncHistoryId)`.

## Locked contracts

### SQL — `db/migrations/20260714_create_canary_tables.ts`

Tabs; ISO-8601 UTC TEXT for `started_at`/`finished_at`; `created_at`/`updated_at` are `CURRENT_TIMESTAMP` bookkeeping. Copy the `20260710_create_sync_history_tables.ts` idiom. `up`:

```sql
CREATE TABLE canary_rollouts (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  arr_type               TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr', 'lidarr')),
  status                 TEXT NOT NULL CHECK (status IN ('canary_running', 'awaiting_confirmation', 'rolling_out', 'completed', 'aborted', 'failed')),
  canary_instance_id     INTEGER REFERENCES arr_instances(id) ON DELETE SET NULL,
  canary_instance_name   TEXT NOT NULL,
  canary_status          TEXT CHECK (canary_status IN ('success', 'partial', 'failed', 'skipped') OR canary_status IS NULL),
  canary_sync_history_id INTEGER REFERENCES sync_history(id) ON DELETE SET NULL,
  sections               TEXT,
  max_batch_size         INTEGER NOT NULL DEFAULT 1 CHECK (max_batch_size >= 1),
  partial_policy         TEXT NOT NULL DEFAULT 'gate' CHECK (partial_policy IN ('gate', 'abort')),
  canary_output          TEXT,
  canary_error           TEXT,
  remaining_targets      TEXT NOT NULL DEFAULT '[]',
  batch_cursor           INTEGER NOT NULL DEFAULT 0,
  rollout_results        TEXT NOT NULL DEFAULT '[]',
  trigger                TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'system', 'schedule')),
  started_at             TEXT NOT NULL,
  finished_at            TEXT,
  state_token            TEXT NOT NULL,
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_canary_rollouts_status ON canary_rollouts(status);
CREATE INDEX idx_canary_rollouts_arr_type_started ON canary_rollouts(arr_type, started_at DESC);

CREATE TABLE canary_settings (
  id                         INTEGER PRIMARY KEY CHECK (id = 1),
  enabled                    INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  default_max_batch_size     INTEGER NOT NULL DEFAULT 1 CHECK (default_max_batch_size >= 1),
  auto_select                INTEGER NOT NULL DEFAULT 1 CHECK (auto_select IN (0, 1)),
  default_canary_instance_id INTEGER REFERENCES arr_instances(id) ON DELETE SET NULL,
  default_partial_policy     TEXT NOT NULL DEFAULT 'gate' CHECK (default_partial_policy IN ('gate', 'abort')),
  created_at                 TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO canary_settings (id) VALUES (1);
```

`down` (indexes first, reverse order): `DROP INDEX idx_canary_rollouts_arr_type_started`, `DROP INDEX idx_canary_rollouts_status`, `DROP TABLE canary_rollouts`, `DROP TABLE canary_settings`.

### TypeScript — `sync/canary/types.ts`

```ts
export type CanaryArrType = SyncPreviewArrType; // 'radarr' | 'sonarr' | 'lidarr'
export type CanaryRolloutStatus =
  | 'canary_running'
  | 'awaiting_confirmation'
  | 'rolling_out'
  | 'completed'
  | 'aborted'
  | 'failed';
export type CanaryOutcomeStatus = 'success' | 'partial' | 'failed' | 'skipped';
export type CanaryPartialPolicy = 'gate' | 'abort';
export type CanaryTrigger = 'manual' | 'system' | 'schedule';

export interface CanaryTarget {
  instanceId: number;
  instanceName: string;
}
export interface CanaryInstanceResult {
  instanceId: number;
  instanceName: string;
  status: JobRunStatus;
  output?: string;
  error?: string;
}
export interface SyncRunResult {
  status: JobRunStatus;
  output?: string;
  error?: string;
  rescheduleAt?: string | null;
} // verbatim executeSyncJob return (arrSync.ts:96)
```

DTOs (camelCase): `CanaryRolloutSummary` (list-row: derives `remainingCount`/`completedCount` from array lengths; **omits** `stateToken`, `sections`, `canaryOutput`, `canaryError`, `remainingTargets`, `rolloutResults`, `canarySyncHistoryId`, `batchCursor`), `CanaryRolloutDetail` (all fields incl. decoded blobs + `stateToken`), `CanarySettings` (`enabled`/`autoSelect` as booleans). Row types `CanaryRolloutRow` / `CanarySettingsRow` mirror the DDL columns.

Coordinator surface (`sync/canary/coordinator.ts`):

```ts
export type CanaryStartResult =
  | { skipped: true; result: SyncRunResult }
  | {
      skipped: false;
      rollout: CanaryRolloutDetail;
      remainingPreview: GeneratePreviewResult[];
    };
export function startRollout(
  input: CanaryStartInput
): Promise<CanaryStartResult>;
```

Selection (`sync/canary/selection.ts`): `resolveSyncArrType(type)` (thin wrapper over `isSyncPreviewArrType`, rejects `all`/`chaptarr`), `resolveCanary(input, settings)` → `CanaryResolution | { error }` with precedence **explicit `canaryInstanceId` > `default_canary_instance_id` > (auto_select ? least-critical : none) > fail-closed**. Least-critical = **fewest `getConfiguredSections(instanceId).length`** within the `arr_type` cohort (counts configured, not enabled-only), tie-break lowest instance id.

### JobType — `jobs/queueTypes.ts`

Add `| 'sync.canary.rollout'` to the `JobType` union; add `CanaryRolloutJobPayload { rolloutId: number }` and its `JobPayloadByType['sync.canary.rollout']` entry.

### NotificationTypes — `notifications/types.ts`

Add `CANARY_FAILED: 'canary.failed'` and `CANARY_PROMOTED: 'canary.promoted'`.

### Query modules

`canaryRolloutQueries` (`db/queries/canaryRollouts.ts`): `insert`, `getById`, `listRecent`, `recordCanaryOutcome` (guard `WHERE id=? AND status='canary_running'`, re-issues token), `markRollingOut(id, expectedToken, nextToken)` (guard `WHERE id=? AND status='awaiting_confirmation' AND state_token=?`), `recordBatchProgress(id, batchCursor, rolloutResults)` (guard `status='rolling_out'`), `finishRollout(id, 'completed'|'failed', finishedAt)`, `abort(id, expectedToken, finishedAt)`. All guarded mutators return `db.execute(...) > 0`; every write bumps `updated_at = CURRENT_TIMESTAMP`; `rowToDetail` decodes JSON via a safe `parseJsonArray<T>` (mirror `syncHistory.ts:96`). `canarySettingsQueries` (`db/queries/canarySettings.ts`): `get()` (id=1 singleton, non-optional), `update(patch)` returning the fresh row.

### OpenAPI — `docs/api/v1/schemas/canary.yaml`

Full camelCase field lists for `CanaryRolloutStatus`, `CanaryTarget`, `CanaryInstanceResult`, `CanaryStartRequest`, `CanaryRolloutDetail`, `CanaryRolloutSummary`, `CanaryStartResult` (`oneOf` + `discriminator: skipped`), `CanarySyncRunResult`, `CanaryRolloutListResponse`, `CanarySettings`, `CanarySettingsUpdate`, `CanaryProceedRequest`/`CanaryAbortRequest`. `state_token` is **detail-only** (omitted from summary). `maxBatchSize` `minimum: 1`, non-integer or `<1` → **400** (do not clamp). Errors via `schemas/arr.yaml#/ErrorResponse`.

## Batches (dependency-ordered)

- **B1 — Foundation** (parallel within batch): migration `db/migrations/20260714_create_canary_tables.ts`; shared types `sync/canary/types.ts`; token seam `sync/canary/token.ts`; OpenAPI trio — `docs/api/v1/schemas/canary.yaml`, `docs/api/v1/paths/canary.yaml` (7 endpoints), wire URLs into `docs/api/v1/openapi.yaml`.
- **B2 — Queries + type-gen** (parallel; depend on B1 schema shape + types): `db/queries/canaryRollouts.ts`; `db/queries/canarySettings.ts`; regenerate `src/lib/api/v1.d.ts` (`deno task generate:api-types`) and re-bundle `packages/praxrr-api/openapi.json` (`prettier --write` — it **is** gated), committing only the canary delta.
- **B3 — Notifications + selection** (parallel; depend on B1.2, B2): `sync/canary/notify.ts` + the two `NotificationTypes` keys (fire-and-forget, copy `record.ts` `fireNotification` idiom); `sync/canary/selection.ts` (`resolveSyncArrType`, `resolveCanary`, `computeRemaining` filtered to same `arr_type`).
- **B4 — Job engine** (internally ordered B4.1 first): **B4.1** `jobs/queueTypes.ts` union + `CanaryRolloutJobPayload`; **B4.2** `sync/canary/coordinator.ts` (`startRollout` with auto-skip, inline canary `executeSyncJob(canaryId, sections, 'manual')`, corrected classification read, gate decision, re-filtered + `try/catch` preview build; `proceedRollout`/`abortRollout` value-guards); **B4.3** `jobs/handlers/canaryRollout.ts` (non-throwing processor, `processBatches`, unconditional reschedule while cursor<length, terminal `finishRollout` + notify, `jobQueueRegistry.register`); **B4.4** wiring edits — `jobs/handlers/index.ts` import, `jobs/display.ts` label case, `db/migrations.ts` import block + `loadMigrations()` array.
- **B5 — API routes** (parallel; depend on B4.2 + B2; copy guardrails from `routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/rollback/+server.ts`, `enqueueJob` calls include `runAt`): `routes/api/v1/canary/rollouts/+server.ts` (POST start / GET list), `.../rollouts/[id]/+server.ts` (GET detail with current token), `.../rollouts/[id]/proceed/+server.ts` (guarded → `enqueueJob`), `.../rollouts/[id]/abort/+server.ts` (guarded), `routes/api/v1/canary/settings/+server.ts` (GET + PATCH, `maxBatchSize>=1` integer → 400).
- **B6 — UI** (parallel; B6.1 can start with B3): `client/ui/canary/canaryStatus.ts` (badge helper mirroring `syncHistoryStatus.ts`); `routes/canary/+page.server.ts`+`+page.svelte` (eligible instances id/name/type only, picker + batch-size + partial-policy + Start, rollouts table + `EmptyState` for `enabled=0`); `routes/canary/[id]/+page.server.ts`+`+page.svelte` (canary diagnostics, `remainingPreview` SyncHistoryDiff-style, gate `Modal.svelte` proceed/abort disabled-while-loading, note that canary writes are already applied + links to snapshot #10 / rollback #16); `routes/settings/**` (opt-in, default canary, default batch size, default partial policy).
- **B7 — Tests** (parallel per surface): see test plan.

## Test plan

- **Selection unit** — precedence chain; per-`arr_type` cohort (Radarr canary never pulls Sonarr); `resolveSyncArrType` rejects `all`/`chaptarr`; least-critical tie-break; configured-section counting.
- **Coordinator unit** — auto-skip (`executeSyncJob` called exactly once, no rollout row); gate matrix (failed→aborted; success→awaiting + preview built; partial+gate→gated; partial+abort→aborted; skipped→aborted); classification (precise `partial` from recorded row; `from`-bounded read; **no-row fallback never upgrades to success**; asserts `row.arrInstanceId === canaryId`); disabled-instance-mid-gate degrades preview (no 500).
- **Rollout-handler unit** — non-throwing processor (one target fails, siblings sync, final `failed`, per-instance error at **exact `instanceId`**); deleted/disabled target → `skipped` at exact `instanceId`; `max_batch_size` N=1 and N=3; cursor advance + resume; **unconditional reschedule for `source:'manual'`**; `recoverRunning` re-runs from cursor; crash-mid-batch at-least-once re-sync idempotency.
- **Query/migration unit** — `canaryRolloutQueries`/`canarySettingsQueries` round-trip + token/status guard rejection; migration `up` creates tables + indexes + seeded id=1 row; `down` reverse-drops.
- **Route tests** (under `deno task test <dir>` so routes type-check) — `400`/`404`/`409`/`422`/`500` contract discrimination; both `CanaryStartResult` union arms asserted against documented fields.
- **e2e (Playwright)** — start→gate modal (canary result + remaining preview)→proceed→completed; and canary-fail→aborted with diagnostics, remaining instances untouched.

## Deferred follow-ups

Per-rollout scheduling/cron of canary rollouts; multi-arr fan-out in one rollout; live-Arr drift overlay on the remaining-preview ("Arr changed since canary"); auto-promotion policy beyond the fixed gate; richer least-critical heuristics (weighting by managed entity count rather than configured-section count).
