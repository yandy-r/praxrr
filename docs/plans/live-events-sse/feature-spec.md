# Feature Spec: Live Job & Sync Progress via SSE (`GET /api/v1/events`)

Linear YAN-593 / GitHub #335. Paths are relative to `packages/praxrr-app/src/` unless they start
with `docs/`, `scripts/` or `packages/`. Where the research files disagree,
[decisions.md](./decisions.md) is authoritative.

## Executive Summary

Praxrr gives no feedback after "Sync now" beyond a misleading "queued" toast, and no page refreshes
on its own. This feature adds an auth-gated SSE stream, `GET /api/v1/events`. An in-process bus
feeds it job lifecycle, `sync.recorded`, `canary.updated` and `drift.updated` events, with a
256-event replay ring and `resync` as the fallback. Events are allow-listed invalidation hints:
pages re-run `load()` and the layout shows toasts that link to sync history. The main risks are
leaked error text, streams outliving logout, and subscriber leaks. Allow-list DTOs, heartbeat
re-validation, caps, and one idempotent close mitigate them [[1]](./decisions.md).

## External Dependencies

### APIs and Services

#### Server-Sent Events (WHATWG HTML Living Standard)

- **Documentation**: [HTML SSE spec](https://html.spec.whatwg.org/multipage/server-sent-events.html),
  [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- **Authentication**: same-origin `session` cookie, sent automatically by `EventSource`.
  `EventSource` cannot set headers. Non-browser clients use `X-Api-Key` (or `?apikey=`) with a
  `read`-scoped token.
- **Key Endpoints**:
  - `GET /api/v1/events`: the `text/event-stream` stream (new)
  - `HEAD /api/v1/events`: a status-only probe the client uses to classify connect failures as
    401/403 (stop) or 429/503 (back off) (new)
- **Rate Limits**: 8 concurrent streams per principal and 100 per process. Over the cap the server
  returns 429 or 503 with `Retry-After`. Browsers allow 6 HTTP/1.1 connections per origin
  ([crbug 275955](https://crbug.com/275955)).
- **Pricing**: none (native platform feature)

#### Deno HTTP server / SvelteKit `+server.ts`

- **Documentation**: [Deno HTTP server](https://docs.deno.com/runtime/fundamentals/http_server/),
  [Deno SSE example](https://docs.deno.com/examples/http_server_sse/),
  [SvelteKit server routes](https://svelte.dev/docs/kit/routing#server)
- **Authentication**: the existing `authHandle` in `hooks.server.ts`
- **Key Endpoints**: `+server.ts` returns `new Response(ReadableStream, { headers })`.
  `sveltekit-adapter-deno` passes it through unchanged.
- **Rate Limits**: none. `cancel()` MUST be implemented, otherwise Deno keeps queuing chunks.
- **Pricing**: n/a

### Libraries and SDKs

| Library | Version | Purpose | Installation |
| --- | --- | --- | --- |
| Web `ReadableStream` / `TextEncoder` | Deno 2.x built-in | Server stream body and frame encoding | none |
| Browser `EventSource` | Web platform | Client transport with `Last-Event-ID` | none |
| `svelte/store` `writable` | Svelte 5.39 (existing) | `eventsStore` (no runes) | none (already in `package.json`) |
| `openapi-typescript` | existing (`npx`) | Regenerate `lib/api/v1.d.ts` | `deno task generate:api-types` |

No new dependency. `sveltekit-sse`, `@lok/kit-sse` and `@microsoft/fetch-event-source` were
rejected (see [research-external.md](./research-external.md)).

### External Documentation

- [MDN Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events):
  framing, `retry:`, `id:`, and the `Last-Event-ID` header.
- [Deno legacy request abort](https://docs.deno.com/runtime/reference/deno_serve_legacy_abort/):
  `request.signal` semantics under `Deno.serve`.
- [nginx proxy_read_timeout](http://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout):
  why a 20 s heartbeat is needed behind proxies.
- [Caddy reverse_proxy flush_interval](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#flush_interval):
  Caddy streams `text/event-stream` without extra configuration.

## Business Requirements

### User Stories

**Primary User: Praxrr operator (single admin)**

- As an operator on `/arr/{id}/sync`, I want each section to show Queued → Syncing → updated "Last
  synced" without reloading, so that I know the sync I clicked actually ran (AC1).
- As an operator on Settings → Jobs, I want an "Active jobs" table that includes manual jobs and
  updates live, so that I can watch the queue drain (AC1).
- As an operator on any page, I want a success, warning or error toast when my manual sync
  finishes, with a "View details" link to `/sync-history/{id}`, so that I don't have to hunt for
  the result (AC2).
- As an operator on a flaky network or across a restart, I want pages to keep working and catch up
  when the stream returns, so that a dropped stream never blocks work (AC3).
- As an operator with busy schedules, I want no toast for successful scheduled jobs, so that toasts
  stay meaningful.

**Secondary User: API-token automation (scripts, MCP)**

- As a script holding a `read`-scoped token, I want to consume the same stream with `X-Api-Key`,
  so that automation can follow job outcomes.

### Business Rules

1. **Events are hints, not state**: the DB is authoritative. Pages re-run `load()` on events.
   - Validation: no page patches rows from event payloads.
   - Exception: the drift pages re-call their existing client-side loaders.
2. **Allow-listed payloads**: events carry only ids, `jobType`, `source`, queue `status`,
   `runStatus`, `failureCode`, `displayName`, explicit `arrType`/`instanceId`, `syncHistoryId`,
   counts and timestamps.
   - Validation: a unit test asserts that no serialized event contains raw error text, `error`,
     `payload`, `stateToken`, `nextToken`, URLs or keys.
   - Exception: none.
3. **Status vocabulary reuse**: `status` uses `JobStatus` (`queued|running|success|failed|cancelled`).
   `runStatus` uses `JobRunStatus` (`success|failure|skipped|cancelled`). Never introduce `succeeded`.
4. **Reschedule is not completion**: a handler `rescheduleAt` emits `job.finished` with
   `rescheduled: true` and `status: 'queued'`. It never toasts.
5. **Cross-Arr**: `arrType` comes from the `arr_instances` row (or the rollout or drift row),
   narrowed with `isSyncPreviewArrType`. It is never inferred from `jobType`, and is `null` when
   unknown.
6. **Publish after persistence**: every publish follows the DB write it describes. `publish()` never
   throws into callers.
7. **Toast policy** (every open tab):
   - Manual jobs toast on terminal finish:
     - `success` → success
     - partial (the correlated `sync.recorded.status === 'partial'`) → warning
     - `failure` → error, sticky
     - `skipped` or `cancelled` → info
   - Non-manual jobs toast only on `failure` of sync-family jobs (`arr.sync*`, `pcd.sync`,
     `trashguide.sync`, `sync.canary.rollout`). These are coalesced per `jobType` + `instanceId`
     per 60 s.
   - Exception: rescheduled runs never toast.
8. **Session validity**: the stream re-checks the session or token every 20 s heartbeat. When it is
   invalid, the server sends `session.expired` and closes. The maximum lifetime is 60 min.
9. **Caps**: 8 streams per principal → 429; 100 globally → 503. Both include `Retry-After: 30`.

### Edge Cases

| Scenario | Expected Behavior | Notes |
| --- | --- | --- |
| Reconnect within buffer, same boot | Missed events replay in order; toasts fire once | Toast dedupe keyed by `jobId:runId` |
| Reconnect after restart or eviction | Server sends `resync`; client invalidates every live page | `Last-Event-ID` boot prefix mismatch |
| Session revoked while streaming | `session.expired` within 20 s; client stops reconnecting | Next navigation redirects to login |
| 401/403 on reconnect | HEAD probe classifies it; client stops; indicator "Live updates paused" | No retry storm or log flood |
| 429/503 | Client backs off, honoring `Retry-After` | Capped at 5 min |
| History recording disabled | No `sync.recorded`; toast links to `/settings/jobs` | `recordSyncHistory` returns null |
| Reviewed apply / canary inline sync | `sync.recorded` with `jobId: null`; no job toast | Initiating tab already shows the HTTP result |
| Unknown or new event type | Ignored by the client parser | Forward compatible |
| Slow consumer (queue full) | Server drops the stream; client reconnects and replays or resyncs | `desiredSize <= 0` |
| Handler not found | `job.finished` `status: failed`, `failureCode: handlerNotFound` | Run history row exists |
| Dev HMR re-evaluates modules | Bus and connection registry survive on `globalThis` | `Symbol.for` keys |

### Success Criteria

- [ ] AC1: Jobs "Active jobs" table and `/arr/{id}/sync` sections move queued → running → result
      without a reload.
- [ ] AC2: a manual sync shows a terminal toast with "View details" → `/sync-history/{id}` when a
      row exists.
- [ ] AC3: with the stream blocked, every page still loads and works. After reconnect, missed
      events replay or pages resync.
- [ ] The subscriber count returns to 0 after abort, cancel, lifetime expiry, revalidation failure
      and the slow-consumer drop (unit-tested).
- [ ] No event contains raw error text (unit-tested in the dispatcher path).
- [ ] `requiredScopeFor('GET' | 'HEAD', '/api/v1/events') === 'read'` (unit-tested).
- [ ] `deno task test`, `deno task lint`, `deno task check` and `deno task build` pass.

## Technical Specifications

### Architecture Overview

```text
 enqueueJob / upsertScheduledJob ─┐
 pcdSyncQueue / trashGuideSyncQueue┤
 dispatcher (running, finished) ───┤  publish*()        ┌─ ring buffer (256, id=<bootId>-<seq>)
 recordSyncHistory (sync.recorded) ┼──────────────▶ eventBus ─┤
 canary coordinator + handler ─────┤ (lib/server/events)│      └─ subscribers (one per open stream)
 drift persist (drift.updated) ────┘                    ▼
                                    GET /api/v1/events (+server.ts → stream.ts, caps, heartbeat)
                                                        │ text/event-stream (cookie or X-Api-Key)
                                                        ▼
                         EventSource ─▶ eventsStore (lib/client/stores/events.ts, backoff, replay id)
                                          ├─▶ jobToasts (root layout) ─▶ alertStore (+ action link)
                                          ├─▶ liveInvalidate('praxrr:jobs' | 'praxrr:sync' | …)
                                          └─▶ LiveStatusIndicator (shown only after >10 s down)
```

### Data Models

There are no DB schema changes and no migrations. Two query additions and one in-memory structure
are needed.

#### `job_queue` (existing): new query `jobQueueQueries.listActive(limit = 50)`

| Field | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | INTEGER | PK | Queue row id (`jobId` in events) |
| status | TEXT | `queued` / `running` filter | Active states only |
| source | TEXT | `schedule` / `manual` / `system` | Future scheduled rows are excluded |
| run_at | TEXT | ISO | Queued rows with `source='schedule'` and `run_at > now` are excluded |

**Indexes:**

- No new index. The table holds tens of rows, and the existing scan pattern (`listQueued`) is used.

**Relationships:**

- `job_run_history.queue_id → job_queue.id`. `runId` in `job.finished` is `job_run_history.id`.

#### `api_tokens` (existing): new query `apiTokensQueries.isActiveById(id)`

| Field | Type | Constraints | Description |
| --- | --- | --- | --- |
| id | INTEGER | PK | Token principal id (`locals.principal.tokenId`) |
| revoked_at / expires_at | TEXT | `ACTIVE_PREDICATE` | Reuse the predicate at `apiTokens.ts:35` |

#### In-memory replay ring (`lib/server/events/bus.ts`)

| Field | Type | Constraints | Description |
| --- | --- | --- | --- |
| bootId | string | `[a-z0-9]{8}`, random per process | Id prefix; a mismatch means restart, so the server sends `resync` |
| seq | number | monotonic, starts at 1 | Per-boot sequence |
| buffer | `LiveEventEnvelope[]` | ≤ 256, FIFO eviction | `{ id, seq, event }` |

#### Event union (`lib/shared/events/types.ts`)

```ts
type JobEventBase = {
  jobId: number; jobType: JobType; source: JobSource; displayName: string;
  instanceId: number | null; arrType: LiveArrType | null; databaseId: number | null;
};
type LiveEvent =
  | { type: 'hello'; bootId: string; headId: string; serverTime: string; heartbeatMs: number }
  | { type: 'resync'; reason: 'boot' | 'gap' }
  | ({ type: 'job.queued'; runAt: string } & JobEventBase)
  | ({ type: 'job.running'; startedAt: string } & JobEventBase)
  | ({ type: 'job.finished'; status: JobStatus; runStatus: JobRunStatus; rescheduled: boolean;
       nextRunAt: string | null; runId: number; failureCode: JobFailureCode | null;
       durationMs: number; finishedAt: string } & JobEventBase)
  | { type: 'sync.recorded'; syncHistoryId: number; jobId: number | null; instanceId: number;
      arrType: LiveArrType; status: SyncOperationStatus; trigger: SyncTrigger; finishedAt: string }
  | { type: 'canary.updated'; rolloutId: number; arrType: LiveArrType; status: CanaryRolloutStatus;
      canaryStatus: CanaryOutcomeStatus | null; completedCount: number; remainingCount: number }
  | { type: 'drift.updated'; instanceId: number; arrType: LiveArrType; status: DriftStatus;
      driftedCount: number; missingCount: number; unmanagedCount: number; checkedAt: string }
  | { type: 'session.expired' };
```

`hello`, `resync` and `session.expired` are per-connection control frames. They carry no `id:` and
are never buffered.

### API Design

#### `GET /api/v1/events`

**Purpose**: a long-lived `text/event-stream` of allow-listed live events.
**Authentication**: required. The session cookie or an API token with the `read` scope, enforced by
`authHandle` and `enforceTokenScope`. The route also fails closed when `locals.principal` is null.

**Request:**

```json
{
  "header Last-Event-ID": "string - optional, '<bootId>-<seq>' (native EventSource reconnect)",
  "query lastEventId": "string - optional, same format (client-managed reconnect)",
  "header X-Api-Key": "string - optional, non-browser clients only"
}
```

**Response (200):** `Content-Type: text/event-stream; charset=utf-8`,
`Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

```text
retry: 5000

data: {"type":"hello","bootId":"k3x9a1qz","serverTime":"2026-10-20T10:00:00.000Z","heartbeatMs":20000}

id: k3x9a1qz-42
data: {"type":"job.running","jobId":7,"jobType":"arr.sync.delayProfiles","source":"manual",...}

: ping
```

**Errors:**

| Status | Condition | Response |
| --- | --- | --- |
| 401 | No session or token (`authHandle`), or `locals.principal` null | `{ "error": "Unauthorized" }` |
| 403 | Token without the `read` scope | `{ "error": "Forbidden", "requiredScope": "read" }` |
| 429 | 8 streams already open for this principal | `{ "error": "Too many event streams" }`, `Retry-After: 30` |
| 503 | 100 streams open in the process | `{ "error": "Event stream capacity reached" }`, `Retry-After: 30` |

#### `HEAD /api/v1/events`

**Purpose**: a body-less status probe. It returns 204, or the same 401/403/429/503 without opening a
stream or taking a slot. The client uses it to classify an `EventSource` error.
**Authentication**: same as GET.

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/shared/events/types.ts`: the union, `LIVE_EVENT_TYPES`,
  `LIVE_DEPENDENCY_KEYS`, and stream constants
- `packages/praxrr-app/src/lib/server/events/bus.ts`: the `EventBus` class, the ring buffer, and
  the `globalThis` singleton
- `packages/praxrr-app/src/lib/server/events/publish.ts`: allow-list builders that never throw
- `packages/praxrr-app/src/lib/server/events/sse.ts`: the frame encoder and `Last-Event-ID` parser
- `packages/praxrr-app/src/lib/server/events/connections.ts`: the per-principal and global cap
  registry (`globalThis`)
- `packages/praxrr-app/src/lib/server/events/stream.ts`: `createEventStream()` (heartbeat,
  revalidation, lifetime, slow-consumer guard, idempotent close)
- `packages/praxrr-app/src/lib/server/events/streamAuth.ts`: the principal key plus a revalidator
  built from `locals`
- `packages/praxrr-app/src/routes/api/v1/events/+server.ts`: thin `GET`/`HEAD`
- `packages/praxrr-app/src/lib/client/events/reconnect.ts`: the pure backoff, `parseLiveEvent` and
  failure classifier
- `packages/praxrr-app/src/lib/client/events/toastPolicy.ts`: the pure toast decision and coalescing
- `packages/praxrr-app/src/lib/client/stores/events.ts`: `eventsStore`
- `packages/praxrr-app/src/lib/client/events/liveInvalidate.ts`: debounced `invalidate` and
  `subscribeLive`
- `packages/praxrr-app/src/lib/client/events/jobToasts.ts`: connects events to `alertStore`
- `packages/praxrr-app/src/lib/client/events/LiveStatusIndicator.svelte`: the connection indicator
- `packages/praxrr-app/src/lib/client/alerts/AlertLiveRegion.svelte`: persistent polite and
  assertive regions
- `packages/praxrr-app/src/routes/settings/jobs/components/ActiveJobs.svelte`: the Active jobs table
- `packages/praxrr-app/src/routes/arr/[id]/sync/liveSync.ts`: the sync page subscription helper
- `docs/api/v1/paths/events.yaml`, `docs/api/v1/schemas/events.yaml`: the contract
- Tests: `tests/events/bus.test.ts`, `tests/events/stream.test.ts`,
  `tests/events/clientHelpers.test.ts`, `tests/events/contract.test.ts`,
  `tests/jobs/dispatcherEvents.test.ts`

#### Files to Modify

- `lib/server/jobs/dispatcher.ts`: `job.running`, and `job.finished` (handler-not-found,
  reschedule, finish)
- `lib/server/jobs/queueService.ts`, `lib/server/jobs/helpers/pcdSyncQueue.ts`,
  `lib/server/jobs/helpers/trashGuideSyncQueue.ts`: `job.queued`
- `lib/server/sync/syncHistory/record.ts`: `sync.recorded`
- `lib/server/sync/canary/coordinator.ts`, `lib/server/jobs/handlers/canaryRollout.ts`:
  `canary.updated`
- `lib/server/sync/drift/persist.ts`: `drift.updated`
- `lib/server/db/queries/jobQueue.ts` (`listActive`), `lib/server/db/queries/apiTokens.ts`
  (`isActiveById`)
- `lib/server/utils/auth/scopePolicy.ts`: an explicit read entry for the events route
- `lib/client/alerts/store.ts`, `Alert.svelte`, `AlertContainer.svelte`, `MobileNavAlert.svelte`,
  `lib/client/ui/navigation/navbar/navbar.svelte`: the action link
- `routes/+layout.svelte`, `lib/client/ui/navigation/pageNav/version.svelte`: wiring and the
  indicator
- Jobs, sync, sync-history, canary and drift routes (see the plan), plus the
  `databases/[id]/changes` and `databases/trash/[id]` queued toasts
- `docs/api/v1/openapi.yaml`; the generated `lib/api/v1.d.ts`, `packages/praxrr-api/openapi.json`
  and `packages/praxrr-api/types.ts`
- `docs/api/endpoints.md`, `docs/site/src/content/docs/guides/syncing-profiles.md`,
  `docs/site/src/content/docs/guides/troubleshooting.md`
- `scripts/test.ts`: the `events` alias

#### Configuration

- No env vars. Constants live in `lib/shared/events/types.ts`:
  - `LIVE_HEARTBEAT_MS = 20_000`
  - `LIVE_MAX_STREAM_MS = 3_600_000`
  - `LIVE_RETRY_MS = 5_000`
  - `LIVE_REPLAY_BUFFER = 256`
  - `LIVE_MAX_STREAMS_PER_PRINCIPAL = 8`
  - `LIVE_MAX_STREAMS_GLOBAL = 100`
  - `LIVE_STREAM_QUEUE_HWM = 64`

## UX Considerations

### User Workflows

#### Primary Workflow: Manual section sync

1. **Trigger**
   - User: clicks **Sync Now** on Delay Profiles at `/arr/3/sync`.
   - System: an `info` toast says "Delay profiles sync queued". The section footer shows a
     **Queued** chip and disables Sync Now.
2. **Run**
   - User: stays on the page or navigates anywhere.
   - System: `job.running` refreshes the page load, and the chip becomes **Syncing…**.
3. **Success State**
   - The `sync.recorded` and `job.finished` events refresh the page. "Last synced" updates and the
     chip clears.
   - A success toast reads "Arr Sync (Delay Profiles) - Radarr 4K finished" with a **View details**
     link to `/sync-history/{id}`. Partial results raise a warning; failures raise a sticky error.

#### Error Recovery Workflow

1. **Error Occurs**: the stream drops (restart, proxy, Wi-Fi).
2. **User Sees**: nothing for 10 s. After that, the sidebar version card shows an amber
   "Reconnecting…" pill, or a neutral "Live updates paused" when signed out.
3. **Recovery**: the client backs off automatically and reconnects with `lastEventId`. The server
   replays missed events (their toasts still fire once) or sends `resync`, and pages re-run their
   loads. When signed out, the next navigation goes to login.

### UI Patterns

| Component | Pattern | Notes |
| --- | --- | --- |
| Toast with action | `<div>` + `<a>` "View details" + dismiss `<button>` | No whole-toast `role="button"` when `action` is set |
| Mobile toast | Whole pill is an `<a>` when `action` is set | `MobileNavAlert.svelte` |
| Active jobs table | `Table` + `Badge` running (accent) / queued (neutral) | Above the scheduled jobs table |
| Section live chip | `SyncFooter` `liveStatus` → Queued / Syncing… badge | Sync Now disabled while active |
| Connection indicator | Small pill in `version.svelte` | Hidden while healthy; colour plus text |

### Accessibility Requirements

- WCAG 4.1.3 Status Messages: `AlertLiveRegion.svelte` mounts `role="status" aria-live="polite"`
  and `role="alert"` regions once in the root layout, outside the breakpoint-hidden containers.
- WCAG 2.2.1 Timing Adjustable: error toasts are sticky (`duration 0`). Others use the user's
  alert duration setting.
- WCAG 2.1.1 Keyboard: the link and the dismiss button are real focusable elements. Incoming
  events never move focus.
- WCAG 1.4.1 Use of Color: badges and the indicator always pair colour with text.

### Performance UX

- **Loading States**: none added. Pages keep SSR data. A refresh is a debounced (250 ms)
  `invalidate`.
- **Optimistic Updates**: none. Events only trigger authoritative reloads.
- **Error Feedback**: the indicator appears after 10 s down. Toasts never announce connection
  state.

## Recommendations

### Implementation Approach

**Recommended Strategy**: build from the contract outward:

1. shared types and OpenAPI;
2. the bus and the never-throwing publishers at existing persistence points;
3. the stream route with auth re-check and caps;
4. the client store and pure helpers;
5. page invalidation and toasts.

**Phasing:**

1. **Phase 1 - Foundation**: shared types, OpenAPI, query additions, the alert action and live
   region, and the scope policy entry.
2. **Phase 2 - Core Features**: the bus, publish builders, SSE encoder and caps, publishers, the
   stream route, the client store and helpers.
3. **Phase 3 - Polish**: layout wiring, page integrations, the indicator, docs, and full
   validation.

### Technology Decisions

| Decision | Recommendation | Rationale |
| --- | --- | --- |
| Transport | Native SSE + `EventSource` | No upgrade hook for WebSocket in the adapter; zero deps |
| Missed events | 256-event ring + `resync` fallback | Keeps AC2 toasts across short drops; always correct |
| Reconnect | Client-managed, `?lastEventId=`, HEAD probe | Native retry stops for good on 401/503, and the status code is unreadable |
| Singleton | `globalThis[Symbol.for(...)]` | Survives Vite HMR (decision 8) |
| Framing | Unnamed `message` events, `type` in the JSON | One handler; `JSON.stringify` blocks frame injection |

### Quick Wins

- "Sync queued" toast `success` → `info`: a single-word change in each sync component.
- `sync` actions return `jobId`: `queued.id` is already in scope.

### Future Enhancements

- BroadcastChannel single connection across tabs: relieves the HTTP/1.1 6-connection limit.
- Stream metrics on `/api/v1/metrics`, and cancellation events from `setStatus` /
  `cancelByDedupeKey`.
- Dashboard badges (YAN-589) and per-section progress percentages.

## Risk Assessment

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Subscriber or timer leak in the long-running process | Med | High | One idempotent `close()`; test that the count returns to 0 |
| A listener throws inside the dispatcher | Low | High | `publish()` isolates each listener with try/catch and never throws |
| Event floods at boot from schedule upserts | Med | Med | Never publish from `schedule.ts`; queued events only from service paths |
| Six-tab HTTP/1.1 limit stalls page loads | Med | Med | Documented; client closes on `pagehide`; BroadcastChannel is a follow-up |
| Proxy buffering hides events | Med | Low | `X-Accel-Buffering: no`, `no-transform`, 20 s heartbeat; troubleshooting doc |

### Integration Challenges

- The Svelte 5 legacy `on:click` and `onclick` attributes cannot be mixed in one component.
  Migrate `Alert.svelte` and `MobileNavAlert.svelte` to `onclick` / `onkeydown` entirely.
- `$app/*` modules cannot be imported in Deno tests. Keep `reconnect.ts` and `toastPolicy.ts` free
  of `$app` imports.
- SvelteKit runs `GET` for `HEAD` when `HEAD` is missing, which would open a stream. Export an
  explicit `HEAD`.

### Security Considerations

#### Critical — Hard Stops

| Finding | Risk | Required Mitigation |
| --- | --- | --- |
| Adding `/api/v1/events` to `PUBLIC_PATHS` | Broadcasts instance names and outcomes to anyone | Never add it; the route also fails closed on a null principal |
| Forwarding raw error text, `last_error`, `canaryError`, `stateToken` | Leaks Arr response bodies and proceed/abort value guards | Allow-list builders in `publish.ts`; dispatcher test asserts the absence |

#### Warnings — Must Address

| Finding | Risk | Mitigation | Alternatives |
| --- | --- | --- | --- |
| Stream outlives logout or revocation | Signed-out tab keeps receiving events | 20 s heartbeat revalidation; `session.expired`; 60 min lifetime | Close streams from logout actions (follow-up) |
| Unbounded connections | Memory and socket exhaustion | 8 per principal (429) and 100 global (503) | Evict oldest (rejected: hides runaway clients) |
| Slow consumer buffering | Unbounded queue growth | Close when `desiredSize <= 0` (high-water mark 64) | Drop events (rejected: silent loss) |

#### Advisories — Best Practices

- `?apikey=` leaks tokens into logs: document the header as preferred (deferral justification:
  existing global behavior for every v1 route).
- `AUTH=off`/`local` bypass grants the stream like any route: documented only (deferral
  justification: matches the app-wide trust model).
- Log stream open and close at debug only, never per event (deferral justification: none; do it now).

## Task Breakdown Preview

### Phase 1: Contracts and building blocks

**Focus**: shared types, OpenAPI, query additions, alert action and live region, scope policy, and
the queued-toast copy.
**Tasks**:

- Shared event union and constants; OpenAPI paths and schemas plus regenerated types
- `listActive` and `isActiveById`; alert `action` support and `AlertLiveRegion`; scope entry
  **Parallelization**: all six tasks are independent (disjoint files).

### Phase 2: Server core and client helpers

**Focus**: the bus, ring buffer, publishers, encoder, caps, stream route, pure client helpers, and
the page server loads.
**Dependencies**: Phase 1 types (and queries for the Jobs load and stream auth).
**Tasks**:

- Bus and publish builders → dispatcher, enqueue and domain publishers in parallel
- Encoder and caps → stream and route; pure client helpers → `eventsStore`, `jobToasts`, indicator

### Phase 3: Page integration and polish

**Focus**: layout wiring, Jobs, Sync, Sync History, Canary and Drift pages, docs, and full
validation.
**Tasks**:

- Root layout and indicator; Jobs Active table; Sync page live status
- History, canary and drift pages; docs; and `test`, `lint`, `check`, `build`

## Decisions Needed

The orchestrator's [decisions.md](./decisions.md) resolved every blocking question. These remain
implementation-level notes, not blockers:

1. **Drift dependency key**
   - Options: A) `depends('praxrr:drift')` on the drift server loads; B) re-call the existing
     client loaders on `drift.updated`.
   - Impact: drift data is fetched client-side (`routes/drift/+page.svelte:59`), so A only
     re-runs the instance-picker load.
   - Recommendation: B. It honors decision 9's intent (a live drift refresh) with no wasted load.
2. **Logout push-close**
   - Options: A) heartbeat only (≤ 20 s); B) also close from logout actions.
   - Impact: B touches the auth routes.
   - Recommendation: A for this PR (decision 6). B is a follow-up.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): SSE, Deno and SvelteKit streaming behavior
- [research-business.md](./research-business.md): lifecycle rules, correlation, toast policy
- [research-technical.md](./research-technical.md): publish points, event schema, client design
- [research-ux.md](./research-ux.md): toasts, accessibility, connection indicator
- [research-security.md](./research-security.md): severity-leveled findings
- [research-practices.md](./research-practices.md): reuse, modularity, testability
- [research-recommendations.md](./research-recommendations.md): phasing and risks
- [decisions.md](./decisions.md): authoritative resolutions
