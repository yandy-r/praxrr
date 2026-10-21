# Research: Technical Design — Live Events via SSE (`GET /api/v1/events`)

Linear YAN-593 / GitHub #335. Worktree base: `origin/main` @ `8417c992`. Unless noted, paths are
relative to `packages/praxrr-app/src/`.

## Executive Summary

- **Bus.** Add an in-process, synchronous, never-throwing event bus at
  `lib/server/events/bus.ts`. It is a module singleton, the same pattern as `jobDispatcher`
  (`lib/server/jobs/dispatcher.ts:156`). The event union lives in `lib/shared/events/types.ts`
  so the client store and the server share one source of truth.
- **Publish points.** Seven minimal publish sites cover every acceptance criterion:
  - job queued: `queueService.ts:5-19`, `helpers/pcdSyncQueue.ts:71`,
    `helpers/trashGuideSyncQueue.ts:173`
  - job running: `dispatcher.ts:60`
  - job finished: `dispatcher.ts:79`, `:139`, `:152`
  - sync recorded: `sync/syncHistory/record.ts:197`
  - canary updated: six transitions in `sync/canary/coordinator.ts` and
    `jobs/handlers/canaryRollout.ts`
  - drift updated: `sync/drift/persist.ts:111`
- **Endpoint.** `routes/api/v1/events/+server.ts` returns a `ReadableStream` with
  `text/event-stream`. It needs **no auth code of its own**. `authHandle`
  (`hooks.server.ts:251-313`) already gives 401 to unauthenticated `/api/*` requests. The token
  scope policy maps GET to `read` (`utils/auth/scopePolicy.ts:54`). The wizard gate exempts
  `/api` (`setup/progress.ts:125`). CSRF only checks mutating methods (`security/csrf.ts:83`).
  The route still adds a heartbeat with session/token revalidation, idempotent cleanup, and
  connection caps.
- **Contract.** The OpenAPI source of truth is `docs/api/v1/openapi.yaml` plus the
  `paths/`/`schemas/` split files. `packages/praxrr-api/openapi.json` is a _bundled artifact_
  produced by `scripts/bundle-api.ts:86`. `generate:api-types` reads the YAML (`deno.json:72`).
- **Client.** Add `lib/client/stores/events.ts`: a `writable`-based `eventsStore` (no runes)
  that owns one `EventSource`, its own exponential backoff, and a `status` store. It starts from
  `routes/+layout.svelte` only for authenticated, non-auth, non-setup pages. Pages use
  `depends('praxrr:…')` and a debounced `invalidate()`.
- **Two gaps the issue does not mention:**
  1. The Jobs page **never lists manual or one-off jobs**. Its load uses
     `jobQueueQueries.listScheduled()`, which filters on `dedupe_key IS NOT NULL AND source =
'schedule'` (`db/queries/jobQueue.ts:143-148`). So a "Sync now" job can't show "running"
     there today. AC1 needs a new "Active jobs" list (`listActive()`).
  2. The sync page has **no server-side running indicator**. `syncing` is local button state
     only (`components/DelayProfiles.svelte:31,103-120`). Its load doesn't return per-section
     `syncStatus` (`routes/arr/[id]/sync/+page.server.ts:395-403`), and
     `arrSyncQueries.getSyncConfigStatus` already exposes that field (`db/queries/arrSync.ts:1561`).
- **Toast links.** `alertStore.add(type, message, duration?)` handles plain text only
  (`lib/client/alerts/store.ts:7-12,19`). Add an optional `action: { label, href }`, and render
  it in `Alert.svelte` and `MobileNavAlert.svelte`.
- **Base path.** `APP_BASE_PATH` is the **filesystem data directory**
  (`utils/config/config.ts:62`), not a URL prefix. `svelte.config.js` sets no `kit.paths.base`,
  and about 75 client call sites hardcode `/api/v1/...`. Use `base` from `$app/paths` (currently
  `''`) for the stream URL and the toast href. That costs nothing and keeps us ready for a future
  `paths.base`.

## Architecture Design

```
 enqueue sites ─┐                                  ┌─> GET /api/v1/events (stream #1) ─> EventSource ─> eventsStore ─┬─> jobToasts (layout)
 dispatcher ────┼─> publishJob*/publish*  ─> bus ──┼─> GET /api/v1/events (stream #2)                               ├─> settings/jobs invalidate('praxrr:jobs')
 recordSync ────┤      (lib/server/events)          └─> …(≤ global cap)                                             ├─> arr/[id]/sync invalidate('praxrr:arr-sync:<id>')
 canary/drift ──┘                                                                                                    ├─> sync-history invalidate('praxrr:sync-history')
                                                                                                                     └─> canary/[id] invalidate('praxrr:canary:<id>')
```

### Server modules (new)

| File                              | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/shared/events/types.ts`      | `LIVE_EVENT_TYPES` tuple and the `LiveEvent` discriminated union. Type-only imports of `JobType`/`JobStatus`/`JobRunStatus`/`JobSource` (`lib/server/jobs/queueTypes.ts:31-37`), `SyncOperationStatus`/`SyncTrigger` (`sync/syncHistory/types.ts:22,31`), `CanaryRolloutStatus` (`sync/canary/types.ts:21`), and `JobFailureCode` (`shared/jobs/evidence.ts:25`). Type-only server imports from client code already exist: `routes/arr/[id]/sync/+page.svelte:17-18`.                                                                                                                               |
| `lib/server/events/bus.ts`        | `eventBus.publish(event)`, `subscribe(fn): () => void`, `subscriberCount()`, `bootId`, and a monotonic `seq`. Fan-out is synchronous, and each listener runs in try/catch. `publish` **never throws**, because it is called inside the dispatcher and the sync handlers.                                                                                                                                                                                                                                                                                                                            |
| `lib/server/events/publish.ts`    | Typed builders that keep the redaction and arr_type rules in one place: `publishJobQueued(record)`, `publishJobRunning(record)`, `publishJobFinished(record, result, evidence, outcome)`, `publishSyncRecorded(id, input)`, `publishCanaryUpdated(rolloutId)`, `publishDriftUpdated(row)`. `arrType` comes from `arrInstancesQueries.getById(payload.instanceId)?.type`, narrowed with `isSyncPreviewArrType` (`sync/preview/types.ts:68`), and is otherwise `null`. It is **never inferred from `jobType`** (cross-Arr policy). `displayName` reuses `buildJobDisplayName` (`jobs/display.ts:84`). |
| `lib/server/events/stream.ts`     | `createEventStream({ signal, principalKey, revalidate })` returns a `ReadableStream<Uint8Array>`. It handles SSE framing, heartbeat, caps, and the single idempotent `close()`. This keeps `+server.ts` thin and unit-testable.                                                                                                                                                                                                                                                                                                                                                                     |
| `routes/api/v1/events/+server.ts` | `GET` only: builds the principal key and revalidator from `locals`, then returns `new Response(stream, headers)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Publish points (exact)

| Event            | Location                                                                                                                                                                                                                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job.queued`     | `lib/server/jobs/queueService.ts:11` (`enqueueJob`) and `:17` (`upsertScheduledJob`)                                                                                                                                                   | Fires after `notifyJobEnqueued`. Covers sync page actions (`routes/arr/[id]/sync/+page.server.ts:777,818,859,905`), rename/upgrade/backup/logs actions, canary `proceedRollout` (`sync/canary/coordinator.ts:368`), and on-change syncs (`sync/processor.ts:419-452`, `source: 'system'`).                                                                                                                                                          |
| `job.queued`     | `lib/server/jobs/helpers/pcdSyncQueue.ts:71`, `lib/server/jobs/helpers/trashGuideSyncQueue.ts:173`                                                                                                                                     | These call `jobQueueQueries.upsertScheduled` directly, which bypasses `queueService`. Publish next to their `notifyJobEnqueued`.                                                                                                                                                                                                                                                                                                                    |
| _(none)_         | `lib/server/jobs/schedule.ts:17-20,52,74,…`                                                                                                                                                                                            | Recurring schedule upserts set future `runAt`s. **Don't publish**, or `scheduleAllJobs()` at boot (`jobs/init.ts:20`) floods the stream. The Jobs page shows `next_run_at` statically anyway.                                                                                                                                                                                                                                                       |
| `job.running`    | `lib/server/jobs/dispatcher.ts:60-61`                                                                                                                                                                                                  | Fires after `claimNextDue()` returns a record (its status is already `running`; see `db/queries/jobQueue.ts:194-207`) and before `executeJob`.                                                                                                                                                                                                                                                                                                      |
| `job.finished`   | `dispatcher.ts:79` (handler not found, `status: 'failed'`, `failureCode: 'handlerNotFound'`)                                                                                                                                           | Fires after `markFinished` and `jobRunHistoryQueries.create` (which returns the run id, `db/queries/jobRunHistory.ts:42-70`).                                                                                                                                                                                                                                                                                                                       |
| `job.finished`   | `dispatcher.ts:139` (`reschedule`)                                                                                                                                                                                                     | Sends `status: 'queued'`, `rescheduled: true`, and `nextRunAt`. Canary batches reschedule to "now" (`jobs/handlers/canaryRollout.ts:98-102`), so they emit one event per batch. That is acceptable, and it doubles as progress.                                                                                                                                                                                                                     |
| `job.finished`   | `dispatcher.ts:152` (`markFinished`)                                                                                                                                                                                                   | Maps `status` with the existing ternary (`dispatcher.ts:143-150`). Includes `runStatus` (`result.status`), `failureCode`, and the safe `message` from `evidence.failure?.message` (`buildSafeJobEvidence`, `dispatcher.ts:121`). It never includes raw errors.                                                                                                                                                                                      |
| `sync.recorded`  | `lib/server/sync/syncHistory/record.ts:197-198` (after `syncHistoryQueries.insert`, next to `fireNotification`)                                                                                                                        | One choke point for all three sync paths: the queued handler (`jobs/handlers/arrSync.ts:847`, `jobId` = queue id), reviewed apply on the request thread (`arrSync.ts:711`, `jobId: null`, from `routes/api/v1/sync/preview/[previewId]/apply/+server.ts:269`), and the canary/inline `executeSyncJob` (`arrSync.ts:190-216`, `id: 0`, so `jobId: null` per `arrSync.ts:851`). It doesn't fire when history recording is disabled (`record.ts:194`). |
| `canary.updated` | `sync/canary/coordinator.ts:278` (after insert, `canary_running`), `:302-307` (after `recordCanaryOutcome`, `awaiting_confirmation`/`aborted`), `:363-376` (`proceedRollout` → `rolling_out`), `:393-398` (`abortRollout` → `aborted`) | Each fires via `publishCanaryUpdated(id)`, which reads `canaryRolloutQueries.getById` (`db/queries/canaryRollouts.ts:606`) and projects summary fields only, never `stateToken`.                                                                                                                                                                                                                                                                    |
| `canary.updated` | `jobs/handlers/canaryRollout.ts:92` (`recordBatchProgress`), `:112` (`finishRollout` → `completed`/`failed`)                                                                                                                           | Batch progress plus the terminal state.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `drift.updated`  | `sync/drift/persist.ts:111-125` (after `driftStatusQueries.upsert`)                                                                                                                                                                    | Covers the scheduled `drift.check` job (`jobs/handlers/driftCheck.ts:90`) and the on-demand `POST /api/v1/drift/{id}` (`routes/api/v1/drift/[instanceId]/+server.ts:84`).                                                                                                                                                                                                                                                                           |

**Ordering guarantee used by the toast.** In the queued sync handler, `recordHistory(...)`
(`arrSync.ts:1155`) runs **before** the handler returns. The dispatcher publishes `job.finished`
only after `markFinished` (`dispatcher.ts:152`). Fan-out is synchronous and each stream is FIFO,
so `sync.recorded{jobId}` always reaches the client before `job.finished{jobId}`. The client keeps
a small `jobId → syncHistoryId` map, which means the dispatcher needs no knowledge of
`SyncJobResult.syncHistoryId` (`arrSync.ts:59-62`).

**Not covered (out of scope, see Open Questions).** User cancellation via `setStatus`/
`cancelByDedupeKey` (`jobs/renameHelpers.ts:4-8`, `routes/arr/[id]/upgrades/+page.server.ts:33`)
and `recoverRunning()` at boot (`jobQueue.ts:269`). The boot case is harmless because no streams
exist yet.

## Data Models / Event Schema

Event names follow the issue. **Status values reuse the existing vocabularies**
(`JobStatus = 'queued'|'running'|'success'|'failed'|'cancelled'`, `queueTypes.ts:33`). Don't
introduce `succeeded`, which would be a second convention.

```ts
// lib/shared/events/types.ts
export const LIVE_EVENT_TYPES = [
  'hello',
  'job.queued',
  'job.running',
  'job.finished',
  'sync.recorded',
  'canary.updated',
  'drift.updated',
  'session.expired',
] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];
export type LiveArrType = 'radarr' | 'sonarr' | 'lidarr';

interface JobEventBase {
  jobId: number;
  jobType: JobType;
  source: JobSource; // 'schedule' | 'manual' | 'system'
  displayName: string; // buildJobDisplayName (no secrets)
  instanceId: number | null; // payload.instanceId when numeric
  arrType: LiveArrType | null; // from arr_instances row, never inferred
  databaseId: number | null; // pcd.sync
  sections: ArrSyncSection[] | null; // arr.sync.* (resolved like resolveSections, arrSync.ts:871)
}
export type LiveEvent =
  | { type: 'hello'; bootId: string; serverTime: string; heartbeatMs: number }
  | ({ type: 'job.queued'; runAt: string } & JobEventBase)
  | ({ type: 'job.running'; startedAt: string } & JobEventBase)
  | ({
      type: 'job.finished';
      status: 'success' | 'failed' | 'cancelled' | 'queued'; // 'queued' only when rescheduled
      rescheduled: boolean;
      nextRunAt: string | null;
      runId: number; // job_run_history.id
      runStatus: JobRunStatus; // success|failure|skipped|cancelled
      failureCode: JobFailureCode | null;
      message: string | null; // FAILURE_COPY message only
      durationMs: number;
    } & JobEventBase)
  | {
      type: 'sync.recorded';
      syncHistoryId: number;
      jobId: number | null;
      instanceId: number;
      instanceName: string;
      arrType: LiveArrType;
      status: SyncOperationStatus;
      trigger: SyncTrigger;
      finishedAt: string;
    }
  | {
      type: 'canary.updated';
      rolloutId: number;
      arrType: LiveArrType;
      status: CanaryRolloutStatus;
      canaryStatus: CanaryOutcomeStatus | null;
      completedCount: number;
      remainingCount: number;
    }
  | {
      type: 'drift.updated';
      instanceId: number;
      arrType: LiveArrType;
      status: DriftStatus;
      drifted: number;
      missing: number;
      unmanaged: number;
      checkedAt: string;
    }
  | { type: 'session.expired' };
```

### Wire framing

```
retry: 5000\n\n                                 (first frame)
id: <seq>\ndata: {"type":"hello",...}\n\n
id: <seq>\ndata: {"type":"job.running",...}\n\n
: ping\n\n                                      (heartbeat comment every 25 s)
```

- **One unnamed `message` channel.** `type` lives inside the JSON, so the client needs one
  `onmessage` handler and narrows on the union. `JSON.stringify` escapes `\n`, which prevents
  frame injection.
- **Size.** Payloads hold ids, names, and safe summaries only: under 1 KB, no blobs, no
  `stateToken`, no URLs.
- **`id:`.** Carries `seq` so a future `Last-Event-ID` replay stays possible. v1 does **not**
  replay (see the Client reconnect strategy).

## API Design

### `routes/api/v1/events/+server.ts`

```ts
export const GET: RequestHandler = ({ request, locals }) => {
  const key = principalKey(locals); // 'session:<id>' | 'token:<id>' | 'bypass'
  const slot = eventStreams.acquire(key); // evicts oldest for same key; null => global cap hit
  if (!slot)
    return json(
      { error: 'Too many event streams' },
      { status: 503, headers: { 'Retry-After': '30' } }
    );
  const stream = createEventStream({
    signal: request.signal,
    slot,
    revalidate: revalidator(locals),
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
};
```

- **Auth: no code needed.**
  - `authHandle` populates `locals.user/session/authBypass/principal` (`hooks.server.ts:252-256`;
    the types are in `app.d.ts:11-16`).
  - It returns a 401 JSON for `/api*` when `!auth.user` and the request isn't bypassed
    (`hooks.server.ts:285-296`).
  - API tokens authenticate only `/api/v1/` paths, via the `X-Api-Key` header or the `?apikey=`
    query (`utils/auth/middleware.ts:57-94`). The token user is synthetic (`id: 0`,
    `middleware.ts:83`).
  - `enforceTokenScope` (`hooks.server.ts:300`) requires `read` for GET
    (`utils/auth/scopePolicy.ts:22,54`). No policy edit is needed. Add one assertion to the
    existing scope-policy tests.
  - `AUTH=off` and `AUTH=local` from a local IP give `locals.user = null`,
    `authBypass = true`, and `principal.kind = 'bypass'` (`middleware.ts:103-130`). Don't test
    `locals.user`; use `locals.principal`.
- **Revalidation on each heartbeat (25 s).**
  - For `principal.kind === 'session'`: run `sessionsQueries.getValidById(locals.session.id)`
    (`db/queries/sessions.ts:88-94`).
  - For `'token'`: `db/queries/apiTokens.ts` has only `findActiveByHash` (`:102`), so add
    `isActiveById(id)` that reuses `ACTIVE_PREDICATE` (`:35`).
  - On failure, send `{"type":"session.expired"}` and close.
  - For `bypass`: no revalidation.
  - Max stream lifetime is 60 min, which forces a reconnect through the full `authHandle`
    pipeline.
- **Cleanup: one idempotent `close()`.** It does three things: unsubscribe from the bus, clear
  the heartbeat, and release the slot. It runs on:
  - `ReadableStream.cancel()` (client disconnect under Deno.serve, which backs
    `sveltekit-adapter-deno`)
  - `request.signal` `abort`
  - a throw from `controller.enqueue`
  - `controller.desiredSize <= 0` (a slow consumer; drop it rather than buffer without bound)
  - revalidation failure
  - lifetime expiry
- **Caps.** Global 50 per process: return 503 with `Retry-After`. Per principal key 5: evict the
  oldest stream, so a new tab always connects and stale tabs drop. `eventStreams.count()` exists
  for tests (the subscriber count must return to 0).
- **Heartbeat.** `: ping` comments keep proxies and idle timeouts from closing the socket.
- **Methods.** Only `GET` is exported, so SvelteKit returns 405 for the others. The MCP route
  explicitly has "no SSE stream" (`routes/api/v1/mcp/+server.ts:13`), so this is the first
  streaming route. The only existing non-JSON precedent is `routes/api/v1/metrics/+server.ts`
  (text/plain).

### OpenAPI (contract-first)

The source is `docs/api/v1/`, and the root file is `openapi.yaml`. Its `paths:` section starts at
line 66 and `components.schemas` at line 802. It refers to split files such as
`paths/sync-history.yaml` and `schemas/sync-history.yaml`. `deno task generate:api-types`
generates `lib/api/v1.d.ts` from it (`deno.json:72`), and `deno task bundle:api` regenerates
`packages/praxrr-api/openapi.json` and `types.ts` (`scripts/bundle-api.ts:86,155-162`).

1. Add a `- name: Events` tag to `openapi.yaml:13-62`.
2. Add `paths/events.yaml#/stream`, registered as `/events: $ref: './paths/events.yaml#/stream'`.
   - `operationId: streamEvents`, `tags: [Events]`.
   - Optional `X-Api-Key` header parameter, copying the precedent at `paths/system.yaml:81-89`.
     Describe the header as preferred over `?apikey`, which leaks into logs.
   - Responses:
     - `200`: `content: text/event-stream: schema: { type: string }`. The description states the
       framing and points to `#/components/schemas/LiveEvent`. OpenAPI 3.1 has no `itemSchema`
       for SSE; `text/csv`/`text/plain` use the same pattern at `paths/sync-history.yaml:190`
       and `paths/system.yaml:94`.
     - `401`: `ErrorResponse`.
     - `403`: `ScopeForbiddenResponse` (`schemas/common.yaml`).
     - `503`: `ErrorResponse` plus a `Retry-After` header.
3. Add `schemas/events.yaml`:
   - `LiveEvent` (`oneOf` + `discriminator.propertyName: type`)
   - one schema per variant (`LiveHelloEvent`, `LiveJobQueuedEvent`, `LiveJobRunningEvent`,
     `LiveJobFinishedEvent`, `LiveSyncRecordedEvent`, `LiveCanaryUpdatedEvent`,
     `LiveDriftUpdatedEvent`, `LiveSessionExpiredEvent`)
   - `LiveJobType` as an enum mirroring `JOB_TYPES` (`queueTypes.ts:10-29`)
   - Reuse `SyncOperationStatus`/`SyncTrigger` (`schemas/sync-history.yaml`), the canary status
     schemas (`schemas/canary.yaml`), and `DriftStatus` (`schemas/drift.yaml`) via `$ref`.
   - Register every schema in `components.schemas` (bundle-api imports every top-level key,
     `scripts/bundle-api.ts:88-92`).
4. Add a contract test, `tests/routes/eventsContract.test.ts`. Follow
   `tests/base/bundleApiContract.test.ts:3`: assert type-level compatibility
   `LiveEvent` (shared) ⟷ `components['schemas']['LiveEvent']`. Also assert that
   `LiveJobType` enum values equal `JOB_TYPES`.
5. Add an `/events` row and section to `docs/api/endpoints.md`.

## Client Design

### `lib/client/stores/events.ts`

```ts
import { browser } from '$app/environment';
import { base } from '$app/paths';
import { writable, type Readable } from 'svelte/store';

export type EventsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped';
const status = writable<EventsStatus>('idle');
const handlers = new Map<LiveEventType | '*' | 'resync', Set<(e: any) => void>>();
let source: EventSource | null = null, attempt = 0, timer: ReturnType<typeof setTimeout> | null = null;
let hasOpenedOnce = false;

export const eventsStore = {
 status: { subscribe: status.subscribe } as Readable<EventsStatus>,
 start, stop,
 on<T extends LiveEventType>(type: T | '*', fn: (e: Extract<LiveEvent, { type: T }>) => void): () => void,
 onResync(fn: () => void): () => void
};
```

- **Browser only.** Every entry point returns early when `!browser`. This follows the guard
  pattern in `lib/client/stores/dataPage.ts:7` and `lib/client/alerts/settings.ts:2`.
- **Connect.** `new EventSource(`${base}/api/v1/events`)` is same-origin, so it sends cookies
  automatically.
- **On `hello`.**
  1. Set `status = 'open'` and `attempt = 0`.
  2. If `hasOpenedOnce`, emit `resync` so subscribers re-run their loads. Events may have been
     missed during the gap, and a changed `bootId` means the server restarted.
  3. Set `hasOpenedOnce = true`.
- **On `error`.** Always `source.close()` and schedule our own reconnect:
  `min(30s, 1s·2^attempt) ± 20%` jitter, with `status = 'reconnecting'`. We handle reconnects
  ourselves because the browser's built-in retry stops for good on a non-200 response (401/503),
  and EventSource can't read the status code.
- **On `session.expired`.** Call `stop()`; don't reconnect. The next navigation sends the user to
  login through `authHandle`.
- **`visibilitychange`.** When the page becomes visible and `status !== 'open'`, reconnect right
  away.
- **Handlers.** Each handler runs in try/catch, so a broken page handler can't kill the stream.
- **Testable core.** Export `createEventsClient(factory: (url) => EventSource)` for unit tests,
  plus the `eventsStore` singleton.

### Mount point: `routes/+layout.svelte`

The layout has no `onMount` today (`routes/+layout.svelte:1-15`). Add:

```svelte
import { onMount } from 'svelte';
import { eventsStore } from '$stores/events';
import { startJobToasts } from '$lib/client/events/jobToasts';
onMount(() => {
 if (isAuthPage || !data.navShell) return; // navShell only present for user or bypass (navigation/layoutData.ts:44-52)
 eventsStore.start();
 const stopToasts = startJobToasts();
 return () => { stopToasts(); eventsStore.stop(); };
});
```

`isAuthPage` already excludes `/auth/*` and `/setup` (`+layout.svelte:14`).

### `lib/client/events/jobToasts.ts`

- **Correlation.** Keep `Map<jobId, syncHistoryId>` with a cap of 100 entries, filled from
  `sync.recorded` where `jobId !== null`.
- **On `job.finished`** with `!rescheduled && source === 'manual'`. Scheduled and system jobs
  never toast:
  - `success` → `alertStore.add('success',`${displayName} finished`, 8000, { label: 'View details', href })`
  - `failed` → `alertStore.add('error',`${displayName} failed: ${message ?? 'see details'}`, 0 /* sticky */, …)`
  - `cancelled` → `info`
  - `href` is `${base}/sync-history/${id}` when a mapped id exists. Otherwise it is
    `${base}/settings/jobs`, which covers history recording disabled and non-sync jobs.
- **Dedupe.** Track a `Set<jobId>` of toasts already shown, so a reconnect can't duplicate one.

### Toast with link (alertStore extension)

| File                                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/client/alerts/store.ts:7-12`                   | Add `export interface AlertAction { label: string; href: string }` and `action?: AlertAction` to `Alert`.                                                                                                                                                                                                                                                                                                                               |
| `lib/client/alerts/store.ts:19`                     | Change the signature to `add(type, message, duration?, action?)`. It stays positional and backward compatible: 10 existing three-argument callers keep working.                                                                                                                                                                                                                                                                         |
| `lib/client/alerts/Alert.svelte:7-9,42-59`          | Add `export let action: AlertAction \| undefined`. Today the whole toast is a `div role="button"` with `on:click={dismiss}` (`:42-53`), and putting an `<a>` inside it would nest interactive elements. When `action` is set, render the toast as a plain `div`: the message, an `<a href={action.href}>` that calls `dismiss()` on click, and a small dismiss `<button>`. When `action` is not set, keep the current markup unchanged. |
| `lib/client/alerts/AlertContainer.svelte:29`        | Pass `action={alert.action}`.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `lib/client/alerts/MobileNavAlert.svelte:7-9,41-57` | Add an `action` prop. On the small bar, make the whole pill an `<a>` when `action` is set.                                                                                                                                                                                                                                                                                                                                              |
| `lib/client/ui/navigation/navbar/navbar.svelte:34`  | Pass `action={latestAlert.action}`.                                                                                                                                                                                                                                                                                                                                                                                                     |

These components use legacy `on:click`. Svelte 5 won't compile a component that mixes `on:click`
and `onclick`. Either migrate both alert components to `onclick` as part of this change
(preferred by the repo rule), or keep `on:` syntax for the new link and button.

### Page integrations

| Page                                                                        | How it loads today                                                                                                                                                                                                                                                                                                                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/settings/jobs/+page.server.ts:9-58` + `+page.svelte`                | Server `load`. Scheduled jobs come from `listScheduled()` (`jobQueue.ts:143`), and the 50 most recent runs from `jobRunHistoryQueries.getRecent(50)`. There is no refresh at all.                                                                                                                                                                                                                  | (1) `load({ depends })` calls `depends('praxrr:jobs')`. (2) Add `activeJobs` from a new `jobQueueQueries.listActive(limit=50)` (`status IN ('queued','running') AND (dedupe_key IS NULL OR source != 'schedule' OR run_at <= now)`) and render an "Active" table above the scheduled table, reusing `ExpandableTable` and the `Badge` running/queued variants (`+page.svelte:102-105`). (3) In `onMount`: `eventsStore.on('*')` filtered to `job.*` → a 250 ms debounced `invalidate('praxrr:jobs')`, plus `onResync` → `invalidate`. AC1 needs the new list, because the existing tables never show manual jobs. |
| `routes/arr/[id]/sync/+page.server.ts:247-404` + `+page.svelte`             | Server `load`. Returns `syncData` from `getFullSyncData` (`arrSync.ts:955-962`), with `lastSyncedAt` only and no status. `syncing` is local button state. The page already calls `invalidateAll()` after a trigger (`+page.svelte:364`; `DelayProfiles.svelte:113`), so re-running the load is proven safe for local edit state, because the `let` values initialize once (`+page.svelte:78-104`). | (1) `depends(`praxrr:arr-sync:${id}`)`. (2) Add `sectionStatus: arrSyncQueries.getSyncConfigStatus(id)` (`arrSync.ts:1561`; `syncStatus` is `idle                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | pending | in_progress | failed`,`:120`) to the return value. (3) Pass a`running`prop (`sectionStatus.X.syncStatus`is`pending`/`in_progress`, OR a live`job.running`exists for this instanceId whose`sections`include X) into`SyncFooter`as`syncing`(`components/SyncFooter.svelte:14,39`). This gives the authoritative "running" state, and the button spinner shows it. (4) Subscribe to`job.queued/running/finished`and`sync.recorded`where`instanceId === data.instance.id`→ debounced`invalidate`.`lastSyncedAt`props (`+page.svelte:405,422,436`) then update. Removing the per-component`invalidateAll` after the trigger is optional. |
| `routes/sync-history/+page.server.ts:41-76`                                 | Server `load` driven by URL filters (`search` + `count`). Navigation uses `goto(..., { invalidateAll: true })` (`+page.svelte:189,201`).                                                                                                                                                                                                                                                           | `depends('praxrr:sync-history')`. On `sync.recorded` (any instance) or resync → debounced `invalidate`. The queries are cheap. The detail page `sync-history/[id]` fetches immutable rows client-side (`[id]/+page.svelte:47`), so it needs no change.                                                                                                                                                                                                                                                                                                                                                            |
| `routes/canary/[id]/+page.server.ts:16-33` + `+page.svelte`                 | Server `load` (`getById` + diagnostics). Already calls `invalidateAll()` after proceed/abort (`[id]/+page.svelte:145,158`).                                                                                                                                                                                                                                                                        | `depends(`praxrr:canary:${id}`)`. On `canary.updated` with `rolloutId === rollout.id` → `invalidate`. The refreshed load also refreshes `stateToken`, so the proceed/abort value guards stay valid.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `routes/canary/+page.server.ts` (list)                                      | Server `load`.                                                                                                                                                                                                                                                                                                                                                                                     | `depends('praxrr:canary')`, invalidated on any `canary.updated`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `routes/drift/+page.svelte:59`, `routes/drift/[instanceId]/+page.svelte:40` | Client `fetch` in a local loader.                                                                                                                                                                                                                                                                                                                                                                  | On `drift.updated` (matching `instanceId` on the detail page) → call the existing local loader again. This is optional for the ACs, but it's cheap.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Leave the existing intervals alone: `SyncPreviewPanel.svelte:147` (a staleness clock),
`RenameSettings.svelte:40`, and `CoreSettings.svelte:38` (countdown clocks). They are wall-clock
ticks, not data polling, so SSE doesn't replace them.

**Degradation (AC3).** Every page stays server-loaded and fully works with no stream. Events only
trigger refreshes. A dropped stream reconnects with backoff, and `onResync` re-runs loads after
reconnect, so missed transitions are healed. An optional `$eventsStore.status` dot in the navbar
is a UX choice (see the UX research). It isn't required.

## Files to Create/Modify

### Create

- `lib/shared/events/types.ts`: the union, `LIVE_EVENT_TYPES`, and `isLiveEvent` (a narrowing
  guard for the client parse)
- `lib/server/events/bus.ts`, `lib/server/events/publish.ts`, `lib/server/events/stream.ts`
- `routes/api/v1/events/+server.ts`
- `lib/client/stores/events.ts`, `lib/client/events/jobToasts.ts`
- `docs/api/v1/paths/events.yaml`, `docs/api/v1/schemas/events.yaml`
- Tests:
  - `tests/events/bus.test.ts`: fan-out, a throwing listener is isolated, unsubscribe
  - `tests/events/stream.test.ts`: framing, heartbeat, abort, count returns to 0, caps,
    revalidation close
  - `tests/jobs/dispatcherEvents.test.ts`: queued → running → finished order, the
    handler-not-found path, reschedule
  - `tests/routes/eventsContract.test.ts`
  - client store backoff with a fake EventSource
  - Add a `events` alias in `scripts/test.ts`.

### Modify

- `lib/server/jobs/queueService.ts:11,17`, `lib/server/jobs/dispatcher.ts:60,79,139,152`
- `lib/server/jobs/helpers/pcdSyncQueue.ts:71`, `lib/server/jobs/helpers/trashGuideSyncQueue.ts:173`
- `lib/server/sync/syncHistory/record.ts:197`
- `lib/server/sync/canary/coordinator.ts:278,307,376,398`, `lib/server/jobs/handlers/canaryRollout.ts:92,112`
- `lib/server/sync/drift/persist.ts:125`
- `lib/server/db/queries/jobQueue.ts` (add `listActive`), `lib/server/db/queries/apiTokens.ts`
  (add `isActiveById`)
- `routes/+layout.svelte`
- `routes/settings/jobs/+page.server.ts`, `routes/settings/jobs/+page.svelte`
- `routes/arr/[id]/sync/+page.server.ts`, `routes/arr/[id]/sync/+page.svelte`. The page is
  already 616 lines, so put the subscription in a small `routes/arr/[id]/sync/liveSync.ts` helper
  rather than growing the page.
- `routes/sync-history/+page.server.ts`, `routes/sync-history/+page.svelte`
- `routes/canary/[id]/+page.server.ts`, `routes/canary/[id]/+page.svelte`,
  `routes/canary/+page.server.ts`, `routes/canary/+page.svelte`
- (optional) `routes/drift/+page.svelte`, `routes/drift/[instanceId]/+page.svelte`
- `lib/client/alerts/store.ts`, `Alert.svelte`, `AlertContainer.svelte`, `MobileNavAlert.svelte`,
  `lib/client/ui/navigation/navbar/navbar.svelte`
- `docs/api/v1/openapi.yaml` (tag, path, components) and `docs/api/endpoints.md`. Then run
  `deno task generate:api-types` (→ `lib/api/v1.d.ts`) and `deno task bundle:api`
  (→ `packages/praxrr-api/openapi.json`, `types.ts`).
- `tests/…scopePolicy` test: assert that `GET /api/v1/events` requires `read`.

## Constraints

- **Svelte 5 without runes.** Use `writable`/`Readable`, `$store` auto-subscriptions, `onMount`
  cleanup, and `onclick`.
- **Formatting.** Tabs, single quotes, no trailing commas, 100 columns. Keep files around 500
  lines. `arrSync.ts` is already 1206 lines, so put **no** event logic in it: the
  `sync.recorded` publish lives in `record.ts`.
- **`publish` must never throw or await** inside `dispatcher.executeJob` or the sync handlers.
  The bus uses no I/O beyond the `arrInstancesQueries.getById` PK lookup inside the builders.
- **Redaction.** Events carry only `SafeJobEvidence`-derived text (`FAILURE_COPY` messages).
  Never raw exception strings, payload blobs, Arr URLs, API keys, or canary `stateToken`.
- **Cross-Arr.** `arrType` comes from the instance row (or the rollout or drift row). Don't
  derive it from `jobType`. Metadata profiles are Lidarr-only (`arrSync.ts:1579-1584`), and the
  `sections` field must reflect that.
- **Single process.** The bus is in memory. That fits the single Deno binary and SQLite. A restart
  drops streams; clients reconnect and resync.
- **Dev HMR.** Vite may re-evaluate the bus module. The dispatcher re-imports it in the same
  graph, so that's fine. Don't stash the bus on `globalThis`, because no existing singleton does.
- **Proxy buffering.** `X-Accel-Buffering: no` plus the heartbeat. Don't gzip `text/event-stream`.

## Open Questions

1. **Replay vs resync.** A `Last-Event-ID` ring buffer (the recommendations doc proposes about
   200 events) adds a second state path. Our client manages reconnects itself with a fresh
   `EventSource`, so it would also need `?lastEventId=`. Proposal: v1 resyncs by `invalidate`
   only; terminal toasts for jobs that finish _during_ a gap are lost. Is that acceptable?
2. **Over-cap policy.** The security doc says 429; the recommendations doc says 503 global. This
   doc proposes evict-oldest per principal plus 503 global. Confirm which.
3. **Toast audience.** Only `source: 'manual'` jobs, shown in every tab of every session? Should
   a failed scheduled job also toast?
4. **Reviewed apply and canary inline syncs** (`jobId: null`) never produce `job.*` events. The
   initiating tab already shows the HTTP result. Should other tabs toast on `sync.recorded` with
   `jobId === null`?
5. **Cancellation events.** `renameHelpers.ts:4-8` and the upgrades page cancel queued jobs
   through `setStatus`/`cancelByDedupeKey` without going through the dispatcher. Should we emit
   `job.finished{status:'cancelled'}` there, or accept a stale "queued" row until the next
   refresh?
6. **Graceful shutdown.** Do open streams delay Deno.serve shutdown on SIGTERM? We may need a
   `globalThis.addEventListener('unload', () => eventStreams.closeAll())`, following
   `utils/parser/spawn.ts:174`.
7. **Logout push.** Should logout and session-revoke actions call `eventStreams.closeByKey()`
   right away, or is heartbeat revalidation (worst case 25 s) enough?
