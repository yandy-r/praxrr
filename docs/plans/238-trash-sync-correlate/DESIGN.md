# Design — #238 TRaSH Sync: correlate manual runs (rev 2, post-critique)

Connect each **manual** TRaSH Guide sync request to complete, source-labeled terminal
run evidence + recovery on the initiating surface.

## Current state (understand phase)

- `POST /api/v1/trash-guide/sources/[id]/sync` → `enqueueManualTrashGuideSourceSync(sourceId)`.
  Queued (200): `{ success, queued, job:{ id,status,runAt,source,attempts } }` where `job.source` is
  the `JobSource` enum (`'manual'`), not the TRaSH source; `job.id` is the `job_queue` PK.
  Already-running (409): `{ error, run: TrashGuideSyncRunMetadata }`.
- Queue row is **upserted by dedupe key** `trashguide.sync:<sourceId>` — ONE slot per source, reused
  across runs, payload **blind-rewritten** every enqueue (`jobQueue.upsertScheduled`). The scheduler
  (`trashGuideSchedule.scheduleTrashGuideSyncSources`) writes the SAME slot.
- `job_run_history` rows are created **only at completion** (`dispatcher.ts`); `claimNextDue` just flips
  the queue row to `running` — so **no per-run id exists during queued/running**.
- Handler flattens counts to a free-text `output` string, returns the **raw** error message, surfaces no
  retry timing, persists no source name. `buildJobDisplayName` has no `trashguide.sync` case.

## Critique-driven corrections (why rev 2)

The rev-1 "queueId + latestRun.id" correlation was **broken**: `getByQueueId(queueId,1)` returns the
PRIOR terminal run for the reused slot, so a running job would link to a stale (possibly green) run
(ambiguous ack, AC4 fail), and the only discriminator was `requestedAt` — timestamp matching (AC1 fail),
which dedupe-coalescing destroys. Rev 2 introduces a **per-run correlation token**.

## Reuse precedents

- `sync/preview/failureReason.ts` + `types.ts`: typed closed **safe** `{ code, message, recoveryAction }`,
  classified by error **type/status only** (never substring).
- `goals/applyStatus.ts` + `GET /goals/apply/status`: one builder feeds every wire surface; status
  resolver keyed off a durable id.
- `ArrPullStartupRunResult` persisted via `output: JSON.stringify(...)` into `job_run_history.output`
  (structured evidence, **no new store**); `runId = crypto.randomUUID()` (`pull/startup/orchestrator.ts`).

## Decisions (rev 2)

### D1 — Per-run correlation TOKEN (fixes AC1/AC4 blockers)

- Mint `runToken = crypto.randomUUID()` at enqueue; thread it in `job_queue.payload`. The token exists
  during **queued and running** (payload is live before any history row) → the "current run" has a stable
  id, no dependence on `job_run_history`.
- **Coalescing preserves the token**: the shared enqueue builder reads the existing slot; if it is
  `queued`, it **reuses that slot's `runToken`** (so a rapid re-click / retry / scheduler tick coalesced
  onto the same slot converge on ONE token); if it is `running`, it dedupes and returns the running slot's
  token. This is synchronous read-then-upsert (no new race; matches existing enqueue flow).
- The handler stamps `runToken` into the terminal evidence written to `job_run_history.output`.
- Linking is **id-based**: the UI holds its `runToken` and matches `current.runToken` (in-flight) then
  `latestRun.evidence.runToken` (terminal). `requestedAt` is descriptive only, never the link key.

### D2 — Durable snapshot on BOTH enqueue paths via one shared builder (fixes AC5/AC2 blocker)

- Extend `TrashGuideSyncJobPayload` with `sourceName?: string`, `sourceArrType?: 'radarr'|'sonarr'`,
  `runToken?: string`.
- New shared `enqueueTrashGuideSourceSync({ sourceId, trigger })` used by BOTH the manual helper and the
  scheduler. It snapshots `name`+`arr_type` from `trashGuideSourcesQueries.getById` (scheduler already has
  them from `getAll()`), preserves/mints `runToken`, and builds the full payload. This removes the
  duplicated dedupe-key helper and guarantees a scheduled tick can never strip a pending manual snapshot.
- Snapshot lives in `job_queue.payload` (survives while the slot exists) AND in the terminal evidence in
  `job_run_history.output` (no FK to source → survives hard-delete). Job display + evidence both resolve
  name from live source → payload snapshot → `#<id>`.

### D3 — Typed safe failure reason; retry semantics preserved; total handler (fixes leak + Cross-Arr)

- New `trashguide/syncFailure.ts` mirroring `failureReason.ts`: closed `TrashGuideSyncFailureCode`
  - `TrashGuideSyncFailureReason { code, message, recoveryAction }` with pre-authored safe copy.
    Codes: `source_missing`, `source_disabled`, `network`, `parser_failed`, `sync_failed`, `internal`.
- The existing transient git/network detection (`isTransientGitOrNetworkError`) stays an **internal
  boolean** driving ONLY the scheduled auto-reschedule decision → **retry semantics unchanged**. The raw
  message goes ONLY to the sanitized logger. Handler returns `error: reason.message` (safe).
- `retry.retryable` (transported) is derived from the **typed code** (network/sync_failed/parser_failed →
  retryable; source_missing/source_disabled → not retryable), NOT from the raw-message boolean.
- **Total handler**: wrap the whole body in try/catch so any unexpected throw (incl. new
  evidence/snapshot/JSON code, `getById`, `updateSyncMetadata`) returns typed `internal` evidence and never
  lets the dispatcher persist a raw `error.message`. A test forces a throw outside the guarded blocks and
  asserts the persisted error equals the safe copy.
- **Cross-Arr fail-fast**: `evidence.source.arrType` is `'radarr'|'sonarr'|null`; when neither live source
  nor snapshot yields an arrType (legacy in-flight payloads only), it is `null` + `source_missing`, never a
  guessed sibling. `parseTrashGuideSourceArrType` validates at the boundary.

### Evidence shape (versioned; status aligned to JobRunStatus — no spelling drift)

```ts
type TrashGuideSyncCounts = {
  commitsBehind: number;
  parsedFiles: number;
  failedFiles: number;
  activeOperations: number;
  removedEntities: number;
  renamedEntities: number;
};
interface TrashGuideSyncRunEvidence {
  schemaVersion: 1;
  runToken: string | null;
  source: {
    id: number;
    name: string | null;
    arrType: 'radarr' | 'sonarr' | null;
  };
  trigger: 'manual' | 'scheduled';
  requestedAt: string | null;
  status: 'success' | 'failure' | 'skipped' | 'cancelled'; // === job_run_history.status
  counts: TrashGuideSyncCounts | null; // null on failure/cancel-before-fetch
  failure: TrashGuideSyncFailureReason | null;
  retry: { rescheduleAt: string | null; retryable: boolean };
}
```

`fetched` ≈ `parsedFiles`/`commitsBehind`; `applied` ≈ `activeOperations`+`removedEntities`+`renamedEntities`.
No-updates / auto-pull-disabled nuance is visible via counts (e.g. `commitsBehind`, `activeOperations=0`),
so no separate `outcome` enum is needed. Per-branch mapping (all handler terminals):

| Handler branch          | status    | counts             | failure              | retry.retryable |
| ----------------------- | --------- | ------------------ | -------------------- | --------------- |
| invalid payload         | failure   | null               | internal             | false           |
| source not found        | cancelled | null               | source_missing       | false           |
| source disabled         | cancelled | null               | source_disabled      | false           |
| not-due (scheduled)     | skipped   | null               | null                 | —               |
| no updates (scheduled)  | skipped   | zeros              | null                 | —               |
| auto-pull disabled      | success   | commitsBehind only | null                 | —               |
| checkForUpdates throw   | failure   | null               | network\|sync_failed | true            |
| sync() throw / !success | failure   | null               | network\|sync_failed | true            |
| parseStatus==='failed'  | failure   | partial            | parser_failed        | true            |
| success                 | success   | full               | null                 | —               |

### Wire surfaces (single source of truth = `trashGuideSyncQueue.ts`)

- `TrashGuideSyncStatusView`:
  `{ sourceId, sourceName:string|null, arrType, queueId:number|null,
 current:{ status, runAt, startedAt, attempts, runToken:string|null }|null,
 latestRun:{ id,status,startedAt,finishedAt,durationMs, evidence:Evidence|null }|null }`
  Built by one `getTrashGuideSyncStatus(sourceId)`, reused by the POST response and the GET resolver.
- `EnqueueManualTrashGuideSyncResult`:
  `{ status:'queued', runToken, view }` | `{ status:'already_running', runToken, view }`.
- `POST /sources/{id}/sync` 200: `{ success, queued, runToken, statusUrl, view }`;
  409: `{ error, deduped:true, runToken, statusUrl, view }` (links to the existing/running run).
- New `GET /sources/{id}/sync` → `TrashGuideSyncStatusView` (mirror `GET /goals/apply/status`) for polling.

### Initiating UI

- **`databases/trash/[id]/+page.svelte`** (canonical per-source surface): full inline run panel — status
  badge, source name, fetched/applied counts, safe `failure.message` + `recoveryAction`, and a **Retry**
  (re-POST) action when `retry.retryable`. Client remembers `runToken`, polls `statusUrl` while
  `current.status ∈ {queued,running}` until the terminal run matches the token. `rescheduleAt` is shown
  only when non-null (scheduled evidence); manual failures show recoveryAction + Retry, not an auto-retry
  time (manual runs never auto-reschedule).
- **`arr/[id]/sync/components/TrashGuideSources.svelte`** (second surface, per-instance list): its
  `syncTrashGuideSource` action returns the same `view`; surface the **source-labeled** run status + a link
  to the source overview (which polls). Lighter than the full panel — justified because it lists many
  sources; identity + link satisfy AC2/AC1 there without duplicating the polling panel.

## Contract lockstep (complete set)

- New `docs/api/v1/paths/trash-guide.yaml` (POST + GET) + `docs/api/v1/schemas/trash-guide.yaml`
  (`TrashGuideSyncRunEvidence`, `TrashGuideSyncCounts`, `TrashGuideSyncFailureReason`,
  `TrashGuideSyncFailureCode`, `TrashGuideSyncStatusView`, enqueue/POST responses). Add **both**
  insertion points in root `openapi.yaml` (`paths:` $ref + `components/schemas:` $refs).
- Regenerate `packages/praxrr-api/openapi.json` (prettier-gated → `prettier --write`) and
  `packages/praxrr-api/types.ts` via `bundle:api`. For `v1.d.ts`: revert a noisy full regen and hand-graft
  ONLY the new schemas (v1.d.ts regen is not CI-gated but noisy). Server + route consume generated
  `components['schemas']`.

## Consumers to update (complete)

- `routes/api/v1/trash-guide/sources/[id]/sync/+server.ts` (POST rewrite + new GET).
- `lib/server/jobs/helpers/trashGuideSyncQueue.ts` (builder, status view, evidence-aware run ref).
- `lib/server/jobs/helpers/trashGuideSchedule.ts` (use shared builder, snapshot).
- `lib/server/jobs/handlers/trashGuideSync.ts` (evidence, total handler, safe error).
- `lib/server/jobs/queueTypes.ts` (payload + evidence/view types) & `lib/shared/trashguide/types.ts` if shared.
- `lib/server/jobs/display.ts` (`buildJobDisplayName` trash case).
- `routes/arr/[id]/sync/+page.server.ts` (`syncTrashGuideSource` returns view) & `TrashGuideSources.svelte`.
- `routes/databases/trash/[id]/+page.svelte` (run panel + polling).
- Tests: `tests/jobs/trashGuideSyncQueue.test.ts`, `tests/jobs/trashGuideSyncJob.test.ts`,
  `tests/jobs/trashGuideSyncHandler.test.ts` (raw-error assert → typed), `tests/routes/trashGuideSources.test.ts`
  (run/job shape), `tests/base/trashGuideSyncUxFlows.test.ts`; NEW `tests/jobs/trashGuideSyncFailure.test.ts`
  and a `buildJobDisplayName` trash case in the existing display test.

## Out of scope (per issue)

No change to TRaSH parse/apply semantics; no per-entity outcomes beyond #232; no second scheduler/store;
no shared-dispatcher change (token lives in trashguide payload only).
