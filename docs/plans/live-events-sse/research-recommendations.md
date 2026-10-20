# Research: Recommendations — Live Events via SSE (`/api/v1/events`)

Linear YAN-593 / GitHub #335. Worktree base: `origin/main` @ `8417c992`.

## Executive Summary

Ship one PR containing a small in-process event bus, an auth-gated SSE endpoint, a shared client
`eventsStore`, and three consumers (Jobs page, instance Sync page, global completion toast). This
meets all three acceptance criteria without touching the job queue's persistence model.

The verified architecture makes this low-risk:

- **The job runner runs in the web server process.** `hooks.server.ts` calls `initializeJobs()`
  (`$jobs/init.ts`), which runs `jobDispatcher.start()`. `JobDispatcher`
  (`$jobs/dispatcher.ts`) is a module singleton driven by `setTimeout`, and it runs claimed jobs
  serially in `runDueJobs()`. `enqueueJob()` / `upsertScheduledJob()` (`$jobs/queueService.ts`)
  wake it directly. There is no worker process, no cluster, and no second replica. An in-memory
  `EventTarget`-style bus therefore reaches every subscriber, and we need no Redis, pub/sub, or
  DB polling.
- **The adapter can stream.** `sveltekit-adapter-deno@0.16.1` (`files/mod.ts`) is
  `Deno.serve(...)` → `server.respond(request)`. It returns the SvelteKit `Response` unchanged,
  so a `+server.ts` that returns `new Response(ReadableStream, {'content-type':
  'text/event-stream'})` streams natively, with no buffering and no compression middleware. The
  app has no SSE or EventSource code today, so this is the first streaming route.
- **The lifecycle hook points are few and central.**
  - `claimNextDue()` is where a job moves to running.
  - `dispatcher.executeJob()` covers success, failure, cancel, and reschedule, all through
    `markFinished` and `reschedule`.
  - `enqueueJob` and `upsertScheduledJob` cover queued.
  - `recordSyncHistory()` (`$sync/syncHistory/record.ts`) is the single sync-history writer, and
    it returns the row id.
  - The canary coordinator transitions are `startRollout`, `proceedRollout`, and `abortRollout`.

Treat events as **invalidation hints**, not as the source of truth. Pages keep their existing
`load()` data, and on an event they call `invalidate('praxrr:<key>')`. If the stream drops,
nothing breaks (AC3), and we never have to keep a second state model consistent.

## Implementation Recommendations

### Server

1. **`$lib/server/events/bus.ts`**: a typed singleton bus.
   - Shape: `publish(event: AppEvent)`, and `subscribe(fn) → unsubscribe`.
   - Fan-out is synchronous, and each listener runs inside try/catch. A broken client must never
     break a job, and `publish` must never throw into the dispatcher.
   - Each event gets a monotonically increasing `seq` for SSE `id:`.
   - Keep a bounded ring buffer of the last ~200 events. A reconnect sends `Last-Event-ID`, and
     the server replays the events after it. If the gap is too old, it sends a single `resync`
     event instead.
2. **`$shared/events/types.ts`**: a discriminated union shared by server and client.
   - `job.queued`, `job.running`, and `job.finished` (`status: success|failed|cancelled`,
     `runStatus`, `rescheduled: boolean`).
     - Payload: `jobId`, `jobType`, `source`, `displayName`, `instanceId?`, `arrType?`.
     - `arrType` must come from the instance row, never inferred from `jobType`.
   - `sync.recorded` (`syncHistoryId`, `jobId`, `instanceId`, `arrType`, `status`).
   - `canary.updated` (`rolloutId`, `status`).
   - Server-only: `hello` and `resync`.
   - Payloads carry ids and safe summaries only. Reuse the `buildSafeJobEvidence` redaction
     boundary. No raw errors, URLs, API keys, or payload blobs.
3. **Publish points.** These are minimal edits:
   - `queueService.enqueueJob` / `upsertScheduledJob` → `job.queued`. Only publish for
     `source: 'manual'`, or for any job whose `runAt <= now`. Otherwise, recurring schedule
     upserts flood the stream at startup (`scheduleAllJobs`).
   - `dispatcher.runDueJobs` → after `claimNextDue()` → `job.running`.
   - `dispatcher.executeJob` → after `markFinished` / `reschedule`, including the
     handler-not-found branch → `job.finished`.
   - `recordSyncHistory` → after the insert → `sync.recorded`. This gives the toast a real
     `/sync-history/{id}` link.
     - `job_id` is persisted on the row (`SyncHistoryInput.jobId`), so the client correlates
       `job.finished` with `sync.recorded` by `jobId`.
     - If history recording is disabled, the id is `null`. The toast then links to
       `/settings/jobs`.
   - Canary coordinator `startRollout` / `proceedRollout` / `abortRollout`, plus the
     `sync.canary.rollout` handler's gate decision → `canary.updated`.
4. **`routes/api/v1/events/+server.ts`**: `GET` only.
   - Body: a `ReadableStream`.
   - Headers: `text/event-stream`, `cache-control: no-cache, no-transform`,
     `x-accel-buffering: no` (for reverse proxies), and `connection: keep-alive`.
   - Send a heartbeat comment (`: ping`) every 25s.
   - Unsubscribe on `cancel()` and on `request.signal` abort.
   - Send `retry: 5000` in the first frame.
   - Cap concurrent connections at about 50 per process. Beyond the cap, return 503 with
     `Retry-After`.
5. **Auth.** Use the existing `authHandle` in `hooks.server.ts`; GET requests pass the CSRF guard.
   - Sessions and `AUTH=off|local` bypass already work.
   - API tokens are accepted under `/api/v1/` only. Map the route in `$auth/scopePolicy.ts`
     explicitly to the read scope.
   - Re-validate the session on each heartbeat. If the session has expired or been revoked,
     close the stream. Without this, a logged-out tab keeps receiving events indefinitely.
6. **OpenAPI (contract-first).**
   - Add the `/events` path to `packages/praxrr-api` with a `text/event-stream` response, and
     document the event union as named schemas.
   - Run `deno task generate:api-types`.
   - Import the shared TS union from `$shared/events/types.ts`, and assert that it is
     structurally compatible with the generated types.

### Client

1. **`$stores/events.ts`**: a singleton `eventsStore` built on a `writable`, with no runes.
   - Exposes `status` (`connecting|open|closed`) and `on(type, fn) → unsubscribe`.
   - Lazy connect when the first subscriber arrives, and close after the last one leaves.
   - Use exponential backoff with jitter: 1s → 30s cap, reset on `open`. The browser's own
     `EventSource` retry is not enough on its own, because a 401 or 503 closes it permanently.
   - Pause while `document.hidden` for more than N minutes, and resume on `visibilitychange`.
     A resume triggers a full `invalidateAll()`, because events may have been missed.
2. **Root `+layout.svelte`.**
   - Start the store only when the user is authenticated. It must not run on `/auth/*`.
   - Mount a `jobToasts` listener that calls `alertStore.add('success'|'error', …)`.
   - `alertStore` currently only takes plain text, so the "View details" link needs a small
     extension. See Improvement Ideas, item 1.
3. **Consumers.** Use `depends('praxrr:jobs')` / `depends('praxrr:sync:<id>')` in the loads, then
   call `invalidate` on events. Debounce invalidation to about 250ms, because a multi-section
   sync emits bursts.
   - `routes/settings/jobs/+page.server.ts` reads `listScheduled` and `getRecent(50)`. Invalidate
     on any `job.*` event.
   - `routes/arr/[id]/sync/+page.svelte` reads `syncData.*.lastSyncedAt` and the pending status.
     Invalidate on `job.*`, filtered by `instanceId`, and on `sync.recorded`.
   - `routes/sync-history/+page.svelte`: invalidate on `sync.recorded`.
   - `routes/canary/[id]/+page.svelte`: invalidate on `canary.updated` with a matching
     `rolloutId`.
4. **The existing intervals stay.** Leave `SyncPreviewPanel.svelte:147`,
   `RenameSettings.svelte:40`, and `CoreSettings.svelte:38` alone in this PR. Replacing them is a
   follow-up once the stream has proven itself.

## Improvement Ideas

1. Add an optional `action?: { label: string; href: string }` to `Alert` in
   `$lib/client/alerts/store.ts`, and render it in `Alert.svelte`. This is a backward-compatible
   field that the "View details" toast needs.
2. Completion toasts default to manual jobs only, plus failures of any job. Successful scheduled
   jobs are noise.
3. Dedupe toasts across tabs: the same `jobId` may arrive in two tabs. Two tabs showing the same
   toast is acceptable for v1. A `BroadcastChannel` leader can follow later.
4. Add a small connection-state dot (or a "Live" badge) on the Jobs page, so users can see when
   the stream is degraded.
5. Use `event.seq` to drop stale or out-of-order updates on the client.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Restart drops in-memory bus and ring buffer | Certain on restart | Low | Client reconnects. `seq` resets, so the server sends `resync` (the new `bootId` differs, sent in `hello`). The client then calls `invalidateAll()`. `recoverRunning()` re-queues interrupted jobs, and the next claim emits `job.running` again. |
| Future multi-process or HA deploy | Low (single binary, `deno compile`) | High if it happens | Keep the bus behind an interface. Document the assumption in the module header. Polling fallback still works. |
| Reverse proxy buffering or idle timeout (nginx, Traefik, Cloudflare ~100s) | Medium | Medium | `x-accel-buffering: no`, 25s heartbeat, client backoff. Document this in the docs site. |
| Connection leak (cancel not firing, listeners accumulating) | Medium | Medium | Unsubscribe in both `cancel()` and on `request.signal` abort. Cap connections and expose the count in a debug log. Test that the listener count returns to 0. |
| Publishing inside the dispatcher throws and corrupts job state | Low | High | `publish` never throws, and listener errors are caught. Publish after the DB write so events never precede the persisted state. |
| Event floods (startup `scheduleAllJobs`, per-section syncs) | Medium | Low | Only emit `queued` for due or manual jobs. Debounce client invalidation. |
| Secret or PII leakage via payloads | Low | High | Allow-list payload fields, reuse the evidence redaction, and include a test that asserts the payload keys. |
| Session expiry not enforced on a long-lived stream | Medium | Medium | Re-check the session on heartbeat and close the stream if it is invalid. Include a test. |
| HTTP/1.1 limit of 6 connections per origin, across many tabs | Medium | Low | One stream per tab, lazily connected and paused when hidden. HTTP/2 behind a proxy removes the limit. `BroadcastChannel` sharing is a follow-up. |
| Cross-Arr conflation in payloads | Low | Medium | `arrType` comes from the instance row. Never derive it from `jobType` prefixes (`arr.sync.metadataProfiles` is Lidarr-only). |
| Vite dev server SSE behavior differs from the compiled binary | Low | Low | Smoke-test both `deno task dev` and `deno task preview`. |

### Testing strategy

There is no SSE prior art in `src/tests`.

- **Unit (`tests/server/events/`):**
  - Bus fan-out.
  - A throwing listener is isolated.
  - Unsubscribe.
  - Ring-buffer replay after `Last-Event-ID`.
  - The gap produces `resync`.
- **Dispatcher (`tests/jobs/`):** run a fake handler through `jobDispatcher` and assert the
  ordered sequence `queued → running → finished(success|failed)`.
  - Assert that `rescheduled: true` is set on reschedule.
  - Assert that handler-not-found emits `failed`.
- **Route (`tests/routes/events.test.ts`):** call the `GET` handler directly.
  - Read the `ReadableStream` with a reader, parse the `data:` frames, and assert the headers.
  - Publish an event and assert the frame.
  - Abort the request and assert the listener count is 0.
  - 401 without auth goes through the existing hook-test pattern. Also test token scope.
- **Client store:** a fake `EventSource` with backoff timing via fake timers. Test that it
  reconnects after an error and tolerates a 401.
- **E2E (Playwright, optional in this PR):**
  - Trigger a sync and assert that the Jobs row changes status without a reload.
  - Assert that the toast appears on a different page.

## Alternatives

1. **Polling only:** a `setInterval` that invalidates the Jobs and Sync pages every 3–5s.
   - Pros: trivial and proxy-proof.
   - Cons: adds latency and wasted load, the toast-on-any-page is awkward, and it duplicates the
     ad-hoc intervals the issue wants gone.
   - **Verdict:** keep it only as the degraded mode. When `eventsStore.status` has been `closed`
     for more than 30s, the Jobs page falls back to a 10s invalidate interval (AC3).
2. **WebSocket:** bidirectional, but we don't need client→server messages.
   - It needs an upgrade path that bypasses `server.respond` in the adapter's `mod.ts`, which we
     don't own. It also needs its own auth handling.
   - **Rejected.**
3. **Long-poll endpoint (`GET /api/v1/events?since=seq`):** works through any proxy, but it adds
   more request churn and reimplements what SSE gives for free. Revisit only if proxy issues are
   widespread.
4. **DB-backed event table:** survives restarts and multiple processes, but adds a migration,
   write amplification, and pruning. Unnecessary while the runner is in-process.
5. **Pushing full row state instead of hints:** fewer reloads, but it duplicates every load's
   shape into the event contract and risks drift. Defer; hints plus `invalidate` are enough for
   the acceptance criteria.

## Task Breakdown Preview

These are ordered to keep trunk releasable. The stream is additive: if it is never connected,
the app behaves exactly as it does today.

1. **Contract:**
   - Add the `/events` path and event schemas to `packages/praxrr-api`.
   - Run `generate:api-types`.
   - Write `$shared/events/types.ts`.
2. **Bus:** `$lib/server/events/bus.ts`, with ring buffer, `bootId`, and seq, plus unit tests.
3. **Publishers** (depend on 2):
   - `queueService` and the `dispatcher` lifecycle.
   - `recordSyncHistory`.
   - The canary coordinator and handler.
   - Dispatcher sequence tests.
4. **Endpoint** (depends on 2):
   - `routes/api/v1/events/+server.ts`.
   - The `scopePolicy` rule.
   - Heartbeat, session re-check, connection cap.
   - Route tests.
5. **Client store** (depends on 1): `$stores/events.ts`, with backoff, visibility handling, and
   lazy lifecycle, plus tests.
6. **Alert action link** (independent): the `Alert.action` field and its rendering in
   `Alert.svelte`.
7. **Layout wiring and toasts** (depend on 5 and 6): start the store when authenticated, plus the
   job→toast correlation with `sync.recorded`.
8. **Page consumers** (depend on 5):
   - Jobs page (`depends`, invalidate, and the polling fallback).
   - Sync page.
   - Sync-history list.
   - Canary detail.
9. **Docs:** a docs-site note on reverse-proxy settings (buffering off, idle timeout), and a
   CHANGELOG entry.

Tasks 2, 5, and 6 can run in parallel. Tasks 3 and 4 run in parallel after 2. Tasks 7 and 8 run
in parallel after 5.

## Follow-ups (separate issues)

- **YAN-589, dashboard badges:** subscribe to `job.*`, `sync.recorded`, and a new
  `drift.updated` event in `eventsStore`, so we don't add another poll. The event union should be
  open for extension; the stream itself should not change.
- **`drift.updated` events:** emitted from the `drift.check` handler and from the `driftStatus`
  query writes. They are not needed for AC1–3, so they are deferred unless a peer finds the
  Canary or drift pages to be in AC scope.
- **Replace the ad-hoc intervals:** `SyncPreviewPanel.svelte:147`, `RenameSettings.svelte:40`,
  and `CoreSettings.svelte:38` should become event-driven.
- **In-flight progress events:** per-section `job.progress` for multi-section `arr.sync`. This
  needs handler instrumentation.
- **Cross-tab sharing:** a `BroadcastChannel` leader-tab election, so all tabs share one
  connection.
- **Other event families:** PCD sync, TRaSH guide sync, and backup completion events for their
  respective pages. Rename and upgrade runs are covered by `job.*` once those pages subscribe.
- **Multi-process or HA:** only if the deployment model changes. Swap the bus implementation for
  a DB- or broker-backed one.
- **Event-stream metrics:** connection count and dropped clients, surfaced at `/api/v1/metrics`.
