# YAN-593 decisions (orchestrator)

Resolved open questions from the seven research files. Each favors security, UX, data integrity,
performance and stability.

1. **Transport**: native SSE (`ReadableStream` in `+server.ts`) + browser `EventSource`. No new deps,
   hand-written encoder. WebSocket rejected (no upgrade hook in sveltekit-adapter-deno).
2. **Events are invalidation hints**: pages keep `load()` data and call debounced `invalidate('praxrr:<key>')`.
   No in-place row patching. Payloads are an allow-list of safe fields: ids, `jobType`, `source`,
   `status` (queue status) + `runStatus` (success|failure|skipped|cancelled), `failureCode`,
   `displayName`, explicit `arrType`/`instanceId` when known, `syncHistoryId`, timestamps. NEVER raw
   error text, `last_error`, `canaryError`, canary `stateToken`/`nextToken`, URLs, keys.
3. **Event types**: `hello` (bootId), `resync`, `job.queued`, `job.running`, `job.finished`
   (with `rescheduled: boolean`), `sync.recorded`, `canary.updated`, `drift.updated`,
   `session.expired`. Status names reuse existing `JobStatus` values (`success`, not `succeeded`).
4. **Replay**: in-memory ring buffer (256 events). Event `id` = `<bootId>-<seq>`. On reconnect with
   `Last-Event-ID` from the same boot and within the buffer → replay missed events; otherwise send
   `resync` → client `invalidateAll()`. Keeps AC2 (toast) for short drops.
5. **Toast policy** (shown in every open tab): manual (`source === 'manual'`) jobs toast on terminal
   finish — success (success), partial → warning, failure (error, sticky until dismissed), skipped (info).
   Non-manual jobs toast only on failure of sync-family jobs (`arr.sync*`, `pcd.sync`, `trashguide.sync`,
   canary), coalesced per jobType+instance per 60 s. Rescheduled intermediate runs never toast.
   Toast "View details" → `/sync-history/{syncHistoryId}` when known (client keeps a
   `jobId → syncHistoryId` map fed by `sync.recorded`, which precedes `job.finished`); else
   `/settings/jobs`. "Sync queued" toast becomes `info`, not `success`.
6. **Auth**: existing `authHandle` gate (no PUBLIC_PATHS entry). Route also requires a principal.
   API tokens with `read` scope allowed (add explicit `scopePolicy` entry if needed). Heartbeat every
   20 s (`: ping`) re-checks the session/token validity; on invalid → send `session.expired` and close.
   Max stream lifetime 60 min (client reconnects transparently). Client stops reconnecting on
   401/403 and on `session.expired`.
7. **Caps**: 8 streams per principal, 100 global. Over cap → 429 (per-principal) / 503 (global) with
   `Retry-After`. Client backs off (1 s → 30 s, jitter) on transient failures incl. 429/503.
   Slow-consumer guard: drop the stream when its queue (desiredSize) is exhausted.
8. **Robustness**: `publish()` never throws (listener errors isolated + logged). Publish only after DB
   writes. One idempotent `close()` for cancel/abort/enqueue-error/lifetime/heartbeat-fail. Bus is a
   module singleton stored on `globalThis` to survive dev HMR. Headers:
   `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`,
   `X-Accel-Buffering: no`. `retry: 5000` on connect.
9. **Page integrations (AC1)**:
   - Settings → Jobs: add `jobQueueQueries.listActive()` and an "Active jobs" table (queued/running,
     incl. manual), `depends('praxrr:jobs')`.
   - `arr/[id]/sync`: load returns sync status (`arrSyncQueries.getSyncConfigStatus`) so sections show
     queued/running → result; `depends('praxrr:sync')`.
   - sync-history list: `depends('praxrr:sync-history')`.
   - Canary detail + list: `depends('praxrr:canary')`.
   - Drift list/detail: `depends('praxrr:drift')`.
   - Sync form actions return `jobId` (no client-side "mine" logic required by policy, but useful).
10. **Client**: `lib/client/stores/events.ts` (`createEventsStore()` over `writable`, browser-guarded),
    pure helpers (backoff, parse/validate) in a `$app`-free module for Deno unit tests. Started once from
    `routes/+layout.svelte` when authenticated (navShell present, not auth/setup pages). Connection
    indicator: none while healthy; subtle "Live updates paused" indicator only after >10 s down.
    Reconnect with tab visibility. Svelte 5 no runes.
11. **Alerts**: `alertStore.add(type, message, duration?, action?)` with optional
    `action: { label, href }`; `Alert.svelte`/`MobileNavAlert.svelte` render a real link + separate
    dismiss button; add `aria-live` regions (polite/assertive by type). Existing calls unchanged.
12. **Contract-first**: OpenAPI `GET /api/v1/events` (`text/event-stream`, string schema) + `LiveEvent`
    oneOf schemas; regenerate types; shared TS union in `lib/shared/events/types.ts` checked against them.
13. **Feature switch**: none — additive, fully user-reachable and finished in this PR.
14. **Out of scope (follow-ups)**: replacing the three clock-tick `setInterval`s (they are not polling),
    cross-tab single connection (BroadcastChannel), per-section progress %, multi-process bus,
    stream metrics, dashboard badges (YAN-589), leak of raw `error` text in existing sync-history API.
