# Practices Research: Live Events via SSE (`/api/v1/events`)

Scope: YAN-593 / GH #335. This doc covers reusable code, conventions, module boundaries, KISS
limits, and testability. Paths are relative to `packages/praxrr-app/` unless noted.

## Executive Summary

- **The server has no pub/sub today.** No `EventEmitter`, `EventTarget`, listener set, or
  `ReadableStream` response exists under `src/lib/server` or `src/routes/api` (the only
  `ReadableStream` is parser stdout piping in `src/lib/server/utils/parser/spawn.ts:81`). We
  write a small in-process bus. It is one process with one dispatcher, so we need no broker, no
  Redis, and no persistence.
- **One place emits all job lifecycle events.** Every job runs through
  `JobDispatcher.executeJob` (`src/lib/server/jobs/dispatcher.ts:70-153`), and every enqueue
  wakes the dispatcher through `jobDispatcher.notifyJobEnqueued(runAt)`. Publishing `running`
  and the terminal status (`success | failed | cancelled`, plus `queued` again on reschedule) in
  the dispatcher covers acceptance criteria 1 and 2 for every job type without touching any
  handler.
- **Reuse the singleton style the codebase already uses.** Server code uses a class plus an
  exported instance (`jobQueueRegistry`, `jobDispatcher`). Client code uses a
  `createXStore()` factory over `writable` with `browser` guards (`$stores/*`, `$alerts/store.ts`).
  `eventsStore` should follow the same shape.
- **Don't add a new auth path.** `GET /api/v1/events` already goes through `authHandle`
  (`src/hooks.server.ts:251-313`). A missing session returns a JSON 401 for `/api` paths, and
  `requiredScopeFor` maps any GET to `read` (`src/lib/server/utils/auth/scopePolicy.ts:47-61`).
  The browser `EventSource` sends the same-origin session cookie. Bypass modes (`AUTH=off`, or
  local requests under `AUTH=local`) pass through as they do for every other route.
- **Keep the three `setInterval` sites out of scope.** All three are local clock ticks for
  relative-time text ("next run in…", preview staleness). None of them polls the server. SSE
  replaces nothing there.
- **Scope the MVP to job lifecycle.** Pages react by calling `invalidate`/`invalidateAll`. The
  completion toast is wired once in the root layout. Sync, drift and Canary *domain* events are
  thin follow-ons: they map to job types `arr.sync*`, `drift.check` and `sync.canary.rollout`,
  so the job event already gives those pages a refresh trigger.

## Existing Reusable Code

### Server

| Concern | Existing code | How to reuse |
| --- | --- | --- |
| Singleton style | `src/lib/server/jobs/queueRegistry.ts` (class + `export const jobQueueRegistry`) | Mirror it: `class EventBus { … }` / `export const eventBus = new EventBus()` |
| Lifecycle hook point | `dispatcher.ts:60` `claimNextDue()` (→ running), `:79` / `:152` `markFinished`, `:139` `reschedule` | Call `publish` right after each DB state change, so the event never runs ahead of persisted state |
| Enqueue fan-in | `jobs/queueService.ts` (`enqueueJob`, `upsertScheduledJob`); `jobs/helpers/pcdSyncQueue.ts:71`; `jobs/helpers/trashGuideSyncQueue.ts:173`; `jobs/schedule.ts:17-20` | `queued` is optional. If wanted, emit it in `enqueueJob` only (manual triggers), not in scheduled upserts, to avoid noise |
| Display names | `jobs/display.ts` `buildJobDisplayName(jobType, payload)` (already computed at `dispatcher.ts:71`) | Put `displayName` in the event, so the toast text needs no client lookup |
| Safe failure info | `jobs/evidence.ts` `buildSafeJobEvidence` → `evidence.failure?.code` (`dispatcher.ts:134`) | Send only the typed `failureCode`, never raw errors. This keeps the existing "redaction by construction" rule (`dispatcher.ts:110-111`) |
| Job types / status | `jobs/queueTypes.ts:12-33` (`JobType`, `JobStatus`, `JobRunStatus`), `ArrSyncJobPayload.instanceId` (`:41-58`) | Reuse these types directly in the event union. Do not invent a parallel status model; a comment at `queueTypes.ts:221` asks for exactly this |
| Fire-and-forget idiom | `sync/syncHistory/record.ts:192-213` (`recordSyncHistory` never throws), `sync/canary/notify.ts` (void + swallow) | `publish()` must never throw into the dispatcher. Wrap each subscriber call in `try/catch` and log through `$logger` |
| Sync-history id for "View details" | `recordSyncHistory` returns the row id; `handlers/arrSync.ts:61,711` carries `syncHistoryId` | Not visible at the dispatcher today. Either thread it out through `JobHandlerResult` (an optional `syncHistoryId`) or publish a `sync.recorded` event from `recordSyncHistory`. See Open Questions |
| DI for testing | `handlers/arrSync.ts:100-118` `ReviewedSyncExecutionDependencies`; `sync/drift/persist.ts:95-98` `deps: Partial<…>` | The SSE handler factory takes `{ bus, heartbeatMs }` deps so tests can use a fake bus and a short heartbeat |
| Auth / scope | `hooks.server.ts:251-313`, `utils/auth/scopePolicy.ts`, `App.Locals` (`src/app.d.ts:11-16`) | Rely on the middleware. Inside the route, `locals.principal` is available if a per-principal filter is ever needed |

### Client

| Concern | Existing code | How to reuse |
| --- | --- | --- |
| Store factory | `$alerts/store.ts` (`createAlertStore` → `{ subscribe, add, remove, clear }`), `$stores/libraryCache.ts:113,235`, `$stores/mobileNav.ts` | `createEventsStore()` returns `{ subscribe, connect, disconnect, on(type, fn) }` |
| Browser guard | `$stores/accent.ts:6,131,141`, `$stores/navScope.ts:1,53` (`import { browser } from '$app/environment'`) | Never construct `EventSource` during SSR. Guard `connect()` with `if (!browser) return` |
| Toasts | `alertStore.add(type, message, duration?)`; rendered by `AlertContainer` in `src/routes/+layout.svelte:7,27` | Completion and failure toasts. **Gap:** `Alert.svelte` renders only `message` (plain `<p>`), so it has no link support. "View details" needs an optional `href`/action on `Alert` and in `Alert.svelte` (a small additive change) |
| Refresh | `invalidateAll()` used widely (`routes/arr/[id]/sync/+page.svelte:364`, `canary/[id]/+page.svelte:145`, the sync components) | Pages call `invalidateAll()` (or a `depends('praxrr:jobs')` key with `invalidate('praxrr:jobs')`) when a relevant event arrives |
| Layout mount point | `src/routes/+layout.svelte` (already mounts `AlertContainer` and `SetupChecklist`) | Connect once in `onMount`, disconnect in the returned cleanup. One `EventSource` per tab |

Consumer pages:

- `routes/settings/jobs/+page.server.ts` (a pure `load` with no streaming): invalidate on any job
  event.
- `routes/arr/[id]/sync/+page.svelte`: invalidate when `payload.instanceId === data.instance.id`.
- `routes/sync-history/+page.svelte`: invalidate on terminal `arr.sync*` events.
- `routes/canary/[id]/+page.svelte`: invalidate on `sync.canary.rollout` events.

### Polling sites: migration verdict

| Site | What it does | Migrate? |
| --- | --- | --- |
| `routes/arr/[id]/sync/components/SyncPreviewPanel.svelte:147` | 15 s tick of `stalenessNow`, which feeds `evaluateStaleness(preview.createdAt, stalenessNow)` (`:621`) | **No.** A local clock that needs no server data. Optionally, a sync-finished event for this instance could mark the preview stale right away. That is nice to have, not MVP |
| `routes/arr/[id]/rename/components/RenameSettings.svelte:40` | 1 s tick of `now` for the "next run in" countdown from `lastRunAt` | **No** to replacing the tick. The prop `lastRunAt` does go stale after a run. An `arr.rename` terminal event plus `invalidateAll()` on the parent page fixes that for free |
| `routes/arr/[id]/upgrades/components/CoreSettings.svelte:38` | Same as above, for `arr.upgrade` | Same: keep the tick, refresh `lastRunAt` with an event-driven invalidate |

The issue lists these as "ad-hoc setIntervals". They are not data polling, so removing them
would break the countdowns. **Recommendation:** leave them untouched in this ticket. A shared
`$stores/now.ts` ticker would be a separate, unrelated DRY cleanup.

## Modularity Design

Minimal module set. Each module stays well under 500 lines, most under 120.

1. **`src/lib/shared/events/types.ts`**: the `PraxrrEvent` discriminated union, shared by the
   server and the client. MVP variant:
   `{ type: 'job'; jobId; jobType: JobType; status: JobStatus; displayName; instanceId?: number;
   failureCode?: JobFailureCode; syncHistoryId?: number | null; at: string }`.
   - `instanceId` comes from the payload, but only for job types whose payload defines it
     (`arr.*`). There is no inference.
   - Add `type: 'canary'` and `type: 'drift'` variants only if a page needs data the job event
     lacks.
   - This module must also match the OpenAPI schema (contract-first).
2. **`src/lib/server/events/bus.ts`**: `class EventBus { subscribe(fn): () => void;
   publish(e): void; get size(): number }` backed by a `Set`. It is synchronous and never throws
   (each listener is isolated). Export the singleton `eventBus`.
3. **`src/lib/server/events/sse.ts`**: pure helpers.
   - `formatSseMessage(event): string` returns `event: <type>\ndata: <json>\n\n`. Only
     `JSON.stringify` output goes into `data`, so no raw newlines can break framing.
   - `createEventStream({ bus, signal, heartbeatMs }): ReadableStream<Uint8Array>`. It subscribes
     on `start`, sends a `: ping` comment on an interval (proxy/idle keepalive), and unsubscribes
     and clears the timer on `signal` abort *and* on `cancel()`.
4. **`src/routes/api/v1/events/+server.ts`**: about 20 lines. Its `GET` returns
   `new Response(createEventStream({ bus: eventBus, signal: request.signal, heartbeatMs }), {
   headers })` with these headers:
   - `Content-Type: text/event-stream`
   - `Cache-Control: no-cache, no-transform`
   - `Connection: keep-alive`
   - `X-Accel-Buffering: no`
5. **`dispatcher.ts` edits**: three or four `eventBus.publish(...)` calls next to the existing
   `claimNextDue` / `markFinished` / `reschedule` calls. No handler changes.
6. **`src/lib/client/events/reconnect.ts`**: pure logic. `nextBackoffMs(attempt)` (exponential
   backoff with a cap and jitter) and `parseEvent(raw): PraxrrEvent | null` (validate at the
   boundary, drop unknown types).
7. **`src/lib/client/stores/events.ts`**: `eventsStore`. It wraps `EventSource` behind a
   `browser` guard, exposes connection state (`'connecting' | 'open' | 'closed'`) as a
   `writable`, plus `on(type, handler)` returning an unsubscribe.
   - **Reconnect:** native `EventSource` already auto-reconnects. Add manual backoff only for the
     case where it gives up (`readyState === CLOSED`, for example after a 401). After a 401 there
     must be no tight loop. Cap the retries or stop until the next navigation.
8. **`src/routes/+layout.svelte`**: connect/disconnect, plus a single listener that turns
   terminal events for `source: 'manual'` jobs into toasts. Uses `alertStore` with an optional
   link to `/sync-history/{id}`.
9. **`Alert` type + `Alert.svelte`**: an optional `href` / `linkLabel`.
10. **OpenAPI**: add the `/events` path and a `PraxrrEvent` schema to
    `packages/praxrr-api/openapi.json`, then run `deno task generate:api-types`. The spec cannot
    fully describe SSE framing, so document `text/event-stream` with the JSON `data` schema.

Dependency direction: dispatcher → bus (server only); route → bus + sse helpers;
layout/pages → `eventsStore` → reconnect/parse helpers; both sides → `$shared/events/types.ts`.
Nothing in `$shared` imports server or client code.

## KISS

Build:

- One endpoint, one bus, one event family (job lifecycle), one `EventSource` per tab.
- Pages re-fetch through `invalidate` and do not patch rows client-side. The `load` functions
  are already the source of truth (for example `settings/jobs/+page.server.ts`). In-place row
  updates add a second state model for little gain.

Do **not** build:

- **Replay / `Last-Event-ID` / event persistence.** After a reconnect, the layout calls
  `invalidateAll()` once on `open`, which resyncs the page. A missed toast during a disconnect
  is acceptable. A ring buffer could come later, if ever.
- **Per-topic subscription query params or server-side filtering.** Clients filter by
  `type` / `jobType` / `instanceId`. Event volume is tiny (a handful per job).
- **Progress percentages / per-section streaming** from inside handlers. That would need handler
  changes across every job type. Lifecycle granularity is enough for the acceptance criteria.
- **WebSockets, a `BroadcastChannel` tab leader, `SharedWorker`, or any SSE library.**
- **A redesign of the three countdown intervals** (see above).
- **Heartbeat-driven presence or a connection registry.** `bus.size` is enough for a debug log
  or a test assertion.
- **A new auth or token mechanism for the stream.** Reuse the session cookie. Note that
  header-only API-token clients can still use `fetch` streaming. Browser `EventSource` cannot
  send headers, which is fine.

## Testability

The existing patterns to copy:

- **Route tests** import handlers directly and cast minimal events, for example
  `{ url } as unknown as Parameters<typeof GET>[0]` (`src/tests/routes/syncHistory.test.ts:19-23,
  125-147`).
- **Auth/locals:** tests never run `hooks.server.ts`. They build `App.Locals` by hand, for
  example `localsOf(principal)` with `{ user: null, session: null, authBypass, principal }`
  (`src/tests/routes/securityApiTokens.test.ts:43-56`). So the 401 / scope behaviour is
  covered by the existing middleware and `scopePolicy` tests. For the new route, assert only
  that `requiredScopeFor('GET', '/api/v1/events') === 'read'` (a one-liner in the existing
  scope-policy suite).
- **DB-backed tests** use the `migratedTest` wrapper: a temp `config.setBasePath`, then
  `db.initialize()` and `runMigrations()`, and in `finally` call `jobDispatcher.stop()`
  (`syncHistory.test.ts:37-61`). Dispatcher timers leak otherwise, which is why these tests set
  `sanitizeOps: false`.
- **Job tests** live in `src/tests/jobs/*` (for example `driftCheck.test.ts:140` asserts
  registry registration).
- **Aliases** come from `scripts/test.ts:11-58` (repo root). `jobs`, `sync`, `mcp`, `logger`,
  `upgrades` and others already exist. Adding an `events` alias for `src/tests/events` is
  optional, and the right call if the suite grows beyond two files.

Proposed tests (Deno, no browser):

1. `src/tests/events/bus.test.ts`:
   - subscribe/publish/unsubscribe;
   - a throwing listener does not block the other listeners or the publisher;
   - `size` returns to 0 after unsubscribe.
2. `src/tests/events/sse.test.ts`:
   - `formatSseMessage` framing;
   - read the `createEventStream` output through `getReader()`, then publish on a *fresh*
     `new EventBus()` (not the singleton) and assert the decoded chunk;
   - `AbortController.abort()` unsubscribes (`bus.size === 0`) and clears the heartbeat;
   - use `heartbeatMs: 10` to assert that a `: ping` comment appears.
3. `src/tests/routes/events.test.ts`: call `GET({ request: new Request(url, { signal }) } as
   unknown as …)`, then assert the status, the `text/event-stream` header, and that the body is a
   stream. Abort at the end so the test leaks no resources (keep `sanitizeOps: false` like the
   other route tests).
4. **Dispatcher emission** (`src/tests/jobs/jobEvents.test.ts`):
   - inside `migratedTest`, register a stub handler through `jobQueueRegistry.register`, enqueue
     through `enqueueJob`, and subscribe to `eventBus`;
   - await the terminal event with a promise and a timeout;
   - assert the sequence `running` → `success`, and `failed` for a throwing handler. Assert that
     `failureCode` is present and that no raw error text is included;
   - call `jobDispatcher.stop()` in `finally`.
5. **Client pure logic** (`src/tests/events/reconnect.test.ts`): backoff bounds with jitter, and
   `parseEvent` rejecting malformed or unknown payloads.
   - `$app/environment` is not resolvable in Deno tests: no test imports `$app/*` modules (the
     one hit, `src/tests/base/trashGuideSyncUxFlows.test.ts:698`, only string-matches source).
   - This is why `reconnect.ts` / `parse` must not import `$app/*`. Keep the
     `EventSource` + `browser` glue in `events.ts` thin and cover it by e2e (`deno task test:e2e`)
     or by manual verification.

Implement the bus as a class rather than a module-level `Set`, so tests can create isolated
instances. The singleton is only the production wiring.

## Build vs Depend

- **SSE server:** build it. Web `ReadableStream` + `Response` is native in Deno and passes through
  `sveltekit-adapter-deno` unchanged. `request.signal` gives disconnect detection. A library
  (for example `sveltekit-sse`) would add a dependency for about 40 lines of code and would bring
  its own client.
- **Client:** use native `EventSource` (auto-reconnect, `retry:` field support). Libraries like
  `@microsoft/fetch-event-source` only matter for custom headers or POST, which we don't need.
- **Emitter:** build it (a `Set` of listeners). Node's `EventEmitter` (`node:events`) works in
  Deno but adds untyped string events and `maxListeners` warnings. `EventTarget` would force a
  `CustomEvent` wrapper. A typed `Set` is simpler and matches the codebase's preference for small
  classes.
- **Validation:** use a hand-written type guard in `parseEvent`. The repo has no zod-style
  runtime-validator dependency in `deno.json` imports, so don't add one for this.

## Open Questions

1. **"View details" target.** The dispatcher sees `JobHandlerResult`, not the sync-history row
   id. There are two options:
   - (a) add optional `syncHistoryId` to `JobHandlerResult`. Only `arr.sync*` sets it; this is an
     additive change to the types at `queueTypes.ts:263-284`.
   - (b) publish from `recordSyncHistory` (`record.ts:192`).

   Recommendation: (a), so there is one event per job. If the history id is null (recording is
   disabled), link to `/sync-history` or the jobs page instead.
2. **Toast scope.** Toast only `source: 'manual'` jobs (the user triggered them), or every job?
   Recommendation: manual only. Scheduled jobs (backups, cleanups, drift sweeps) would spam the
   user. Failures of scheduled sync jobs are an open UX question for `UxResearcher`.
3. **Multi-user visibility.** Every authenticated principal sees every job event. That matches
   today's jobs page, which shows all jobs to any session. Confirm with `SecurityResearcher` that
   job metadata (display names, instance ids) carries no per-user secret. Failure codes are
   already the safe, typed set.
4. **`queued` event source.** Should `queued` come from `enqueueJob` only (manual triggers) or
   from every enqueue path (`schedule.ts` notify, `pcdSyncQueue`, `trashGuideSyncQueue`)? The
   acceptance criteria only need running → result, so emitting `queued` is optional.
5. **Reverse-proxy buffering** (nginx, Traefik) for users behind proxies. The `X-Accel-Buffering:
   no` header plus a heartbeat of 15–25 s should cover it. Document this in the deployment docs.
6. **Arr-specific semantics.** Events carry `jobType` (which is already per-Arr where it matters,
   for example `arr.sync.metadataProfiles` is Lidarr-only) and `instanceId`. Pages must filter by
   the explicit instance id, not by the Arr type. Do not add a generic "arr" bucket.
