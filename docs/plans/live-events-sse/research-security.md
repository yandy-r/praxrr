# Security Research: Live Events SSE (`GET /api/v1/events`)

Linear YAN-593 / GitHub #335. Scope: security posture of a long-lived, auth-gated Server-Sent
Events stream that pushes job lifecycle, sync, drift, and Canary state changes to the browser.

All file references are relative to `packages/praxrr-app/src/` at `origin/main` (8417c992).

## Executive Summary

The existing request pipeline already gates `/api/v1/events` correctly: it is not in
`PUBLIC_PATHS`, so unauthenticated requests get a JSON `401` from `authHandle`. The
`EventSource` request sends the `session` cookie on its own (same-origin, `SameSite=Lax`,
`HttpOnly`). It cannot set `X-Api-Key`. That is fine, because browsers don't need tokens. The
real risks are in three new places:

1. **Data exposure (WARNING).** Job evidence is safe by construction
   (`jobs/evidence.ts` → `SafeJobEvidence`). Sync-history and section `last_error` strings are
   **not**: they carry raw `HttpError.message`, and that includes the Arr response body
   (`utils/http/client.ts:91-95`). Events must send only closed codes, ids, and status enums.
   Never send free-text `error` fields.
2. **Revocation gap (WARNING).** Auth is checked once, when the connection opens. Logout, "sign out
   other sessions", session expiry, and API token revocation will not end a stream that is
   already open. The stream needs a periodic re-validation and a max lifetime.
3. **Resource exhaustion (WARNING).** A held-open `ReadableStream` per tab with no cap, no
   heartbeat, and no cleanup on cancel leaks subscribers and timers. That breaks the
   long-running single process.

Nothing reaches CRITICAL, as long as the guidelines below are followed. Two cases would become
CRITICAL: adding the route to `PUBLIC_PATHS`, or forwarding raw sync error text or job payloads
in events.

## Findings by Severity

| ID  | Severity               | Finding                                                                                                                                                                                    | Mitigation                                                                                                                                                                                                                  |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | CRITICAL (if violated) | Making `/api/v1/events` public, or skipping `authHandle`, would broadcast instance names and sync outcomes to anyone.                                                                      | Keep it out of `PUBLIC_PATHS`. Add a regression test that asserts an unauthenticated request gets `401` under `AUTH=on` and `oidc`.                                                                                         |
| S2  | CRITICAL (if violated) | Raw sync error text (`sync_history.error`, `sectionResults[].error`, `*_sync.last_error`, `canaryError`) embeds upstream Arr response bodies and transport messages.                       | Event payloads use an allow-listed DTO: ids, enums, counts, `failureCode`. Fetch details through the existing endpoints.                                                                                                    |
| W1  | WARNING                | The open stream outlives logout, session revocation (`settings/security` actions), session expiry, and token revocation.                                                                   | Re-validate every 30–60 s with `sessionsQueries.getValidById` or `resolveApiToken`. Close when invalid. Hard max lifetime (for example 1 h) so the client reconnects through `authHandle`.                                  |
| W2  | WARNING                | No cap on concurrent streams per principal or globally. Each stream holds a socket, a subscriber closure, and a timer.                                                                     | Per-principal cap (for example 5) and a global cap (for example 50). Reply `429` with `Retry-After` when exceeded. Evict the oldest stream for the same session.                                                            |
| W3  | WARNING                | Subscriber leak if `cancel()`, `request.signal` abort, or write errors don't unsubscribe.                                                                                                  | One `close()` path, idempotent. It runs on `cancel`, on `signal` abort, on an `enqueue` throw, and on revalidation failure. It clears timers and removes the subscriber. Add a test that the subscriber count returns to 0. |
| W4  | WARNING                | Slow consumers: an unbounded `enqueue` buffers without limit.                                                                                                                              | Check `controller.desiredSize`. When it is ≤ 0 for N events, drop the client. The client then refetches state on reconnect, because events are hints, not state.                                                            |
| W5  | WARNING                | `sync.canary` events could include `stateToken` / `nextToken`. These are value guards for `proceed`/`abort` (`routes/api/v1/canary/rollouts/[id]/proceed`).                                | Never send tokens. The Canary page refetches the rollout over the authenticated GET.                                                                                                                                        |
| A1  | ADVISORY               | `AUTH=off` and `AUTH=local` (local IP) bypass grant the stream to anyone who can reach the port. This matches every other route.                                                           | Document it. No special handling.                                                                                                                                                                                           |
| A2  | ADVISORY               | `?apikey=` query auth works for `/api/v1/*`, so it would also work for the stream. Tokens in URLs leak into proxy and access logs.                                                         | Allow it with the `read` scope (`scopePolicy.ts` already maps GET → `read`). Don't use it from the app UI. Note in OpenAPI that the header is preferred.                                                                    |
| A3  | ADVISORY               | CSRF: this is a GET with no side effects, and `csrfGuard` only gates mutating methods. A cross-site page can't read the stream, because there is no CORS.                                  | Keep the handler free of side effects. Never let it enqueue or ack jobs.                                                                                                                                                    |
| A4  | ADVISORY               | CORS: no `Access-Control-Allow-*` headers exist in the app. `EventSource` from another origin fails, and `withCredentials` needs ACAO.                                                     | Don't add CORS headers.                                                                                                                                                                                                     |
| A5  | ADVISORY               | Log noise: `authHandle` logs `Unauthorized API access` at warn on every 401. A logged-out tab reconnecting with backoff would flood logs. `Session extended` debug fires on every connect. | On 401 the client stops reconnecting and redirects to login (no retry loop). Log stream open and close at debug only. Never log per event.                                                                                  |
| A6  | ADVISORY               | Sliding expiry: `maybeExtendSession` runs only on the connect request. A long stream doesn't keep the session alive, which is the correct behavior.                                        | Don't extend sessions from heartbeats.                                                                                                                                                                                      |
| A7  | ADVISORY               | Proxy buffering and compression can stall the stream, which can look like an outage.                                                                                                       | Send `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. Send a heartbeat comment every 15–25 s.                                                                                                           |

## Auth Analysis

How the pipeline treats the route (`hooks.server.ts:251-319`, `utils/auth/middleware.ts`):

`handle = sequence(csrfGuard, authHandle)`. `csrfGuard` ignores GET. `getAuthState` checks, in
order:

| Mode                             | Resolution for `GET /api/v1/events`                                                        | Outcome                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `AUTH=off`                       | `BYPASS_PRINCIPAL`, `skipAuth`                                                             | Stream allowed. Trust is delegated to the upstream proxy (A1).                                     |
| `AUTH=local`, local IP           | `BYPASS_PRINCIPAL` (unless `needsSetup` → 303 to `/auth/setup`)                            | Allowed. `EventSource` treats a redirect to HTML as an error, so the client must handle `onerror`. |
| `AUTH=local`, remote / `AUTH=on` | API token (header or `?apikey`) **then** `session` cookie → `sessionsQueries.getValidById` | 401 JSON when neither is present.                                                                  |
| `AUTH=oidc`                      | Token, then session cookie (OIDC users have local sessions)                                | Same as `on`.                                                                                      |
| Token principal                  | `enforceTokenScope`: GET → `read`                                                          | A token with `read` can subscribe.                                                                 |

Notes:

- `EventSource` cannot set custom headers. The browser client uses the `session` cookie, which
  is attached automatically on same-origin requests (`SameSite=Lax`, `HttpOnly`,
  `sessionCookieOptions`). Don't pass the token in the URL from the UI. Non-browser consumers
  (scripts, MCP) can use `X-Api-Key` with `fetch`-based SSE clients.
- The app is single-admin (`usersQueries`: "Single admin user - no multi-user support"). Every
  authenticated principal can see every job, so no per-user event filtering is needed today.
  Still, design the bus with a `principal` hook: if multi-user or scoped tokens (for example
  `mcp`-only) arrive, filtering must happen server-side before enqueue.
- A `401` on the stream URL must be terminal for the client. `EventSource` auto-retries on
  network errors but stops after a non-200 response (`readyState=CLOSED`). The store should then
  fall back to polling or redirect to `/auth/login` on the next navigation. It must not loop.
- Revocation (W1): sessions are deleted at `routes/auth/logout/+server.ts:26` and
  `routes/settings/security/+page.server.ts:234,259`. They expire through `expires_at` and
  `deleteExpired`. None of these can reach an open stream. Recommended approach:
  - Capture `{ kind, sessionId | tokenId }` from `event.locals` at connect.
  - On each heartbeat tick, re-check `sessionsQueries.getValidById(sessionId)` (a cheap PK
    lookup) or the token row. If it is gone or expired, send `event: auth-expired` and close.
  - Optionally, have logout and session-revoke actions call `eventBus.closeSessions(ids)` to
    close streams right away. The heartbeat check alone keeps the worst case at one interval.
  - Max stream lifetime (for example 60 min) forces a reconnect through the full `authHandle`
    pipeline (scope check, setup and wizard redirect).
  - Bypass principals (`off`/`local`) have nothing to revalidate. Apply only the lifetime cap.

## Data Exposure

What is already safe:

- `SafeJobEvidence` (`shared/jobs/evidence.ts`, `server/jobs/evidence.ts`) is safe by
  construction. It has a closed `failureCode`, pre-authored `message`/`recovery` from
  `FAILURE_COPY`, a bounded `target`/`decision`/`output`, and it never reads exception text. The
  dispatcher logs raw errors only through the sanitized logger (`dispatcher.ts:109-117`).
- `sanitizeArrWriteError` gives a closed-vocabulary `reason`, and `protectedDetails` stays in
  logs.

What is NOT safe to forward:

- `HttpError.message` = `HTTP <status>: <statusText> | <JSON body>` (`utils/http/client.ts:91-98`).
  Network failures wrap the raw `fetch` message (`:131`), which can include hostnames and ports.
- `BaseSyncer.sync()` returns `error: error.message` (`sync/base.ts:92-99`). The same pattern
  appears in the qualityProfiles, metadataProfiles, mediaManagement, and delayProfiles syncers.
  `jobs/handlers/arrSync.ts` copies this into `sectionResults[].error`
  (`:1123,1135`), into `handler.failSync(...)` → `*_sync.last_error`, and, for client-creation
  failures, into the sync-history `error` (`:944`).
- `CanaryRolloutRecord.canaryError` / `canaryOutput` are free text. `stateToken` / `nextToken` are
  value guards (W5).
- Job `payload` (`JobQueueRecord.payload`) is typed per job but should not be broadcast. Only
  ids are needed.
- Arr API keys never appear in these structures (they are sent as the `X-Api-Key` request header
  in `utils/arr/base.ts:39`, and are not echoed). However, an Arr or proxy error body _could_
  echo request details, which is why the raw body is excluded.

Recommended event payload allow-list (contract to define in OpenAPI):

| Event                          | Fields (only)                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `job.queued` / `job.running`   | `jobId`, `jobType`, `source`, `instanceId?`, `arrType?`, `at`                                                   |
| `job.finished`                 | the above + `status` (`success`/`failed`/`cancelled`/`skipped`), `failureCode?`, `durationMs`, `syncHistoryId?` |
| `sync.updated`                 | `instanceId`, `arrType`, `section`, `syncStatus`, `lastSyncedAt?`, `syncHistoryId?`                             |
| `drift.updated`                | `instanceId`, `arrType`, `status`, `checkedAt`                                                                  |
| `canary.updated`               | `rolloutId`, `arrType`, `status`, `canaryStatus`                                                                |
| `heartbeat` (comment `: ping`) | none                                                                                                            |

Rules:

- Display strings (toast text) come from `FAILURE_COPY[failureCode]` on the server, or from a
  client-side mapping. Never from handler text.
- Instance _names_ are user-authored and already shown on every page. Including `instanceName`
  is acceptable, but use ids and let the client resolve names from loaded data. That keeps the
  payload minimal and avoids stale names after a rename.
- Encode with `JSON.stringify` per `data:` line. Never interpolate raw strings into the SSE
  frame: a `\n` in a value could inject a forged `event:`/`data:` line. `JSON.stringify` escapes
  newlines. Validate `event:` names against a closed enum.
- `jobType` and `arrType` stay distinct per Arr (`radarr`/`sonarr`/`lidarr`). Don't collapse
  them to a generic "arr" label.

## DoS

Resource model: there is one Deno process. The dispatcher, the HTTP server, and SQLite share
the same event loop. Each SSE connection holds one socket, one `ReadableStream`
controller, one subscriber closure, and one heartbeat interval.

Controls:

1. **Caps.** Keep an in-memory `Map<principalKey, Set<Subscriber>>`. The key is
   `session:<id>` / `token:<id>` / `bypass:<ip>`. Set a per-key cap (for example 5, enough for
   several tabs) and a global cap (for example 50). Over the cap, respond `429` with JSON and
   `Retry-After`. Choose either "reject new" or "evict oldest for the same key". Eviction is
   friendlier for tab refreshes. Bypass mode keys by `getClientIp` (proxy-aware).
2. **Heartbeat.** Send a comment frame (`: ping\n\n`) every 20 s. It keeps proxies from timing
   out the stream, it surfaces dead sockets as `enqueue` errors, and it drives the W1
   revalidation tick. Use one shared interval for all subscribers (one timer, not N).
3. **Cleanup.** Put every exit through one idempotent `close(reason)`:
   `ReadableStream.cancel`, `request.signal` `abort`, `enqueue` throws, backpressure drop,
   revalidation failure, lifetime cap, and server shutdown. Each exit removes the subscriber,
   clears per-stream state, and calls `controller.close()` inside a try block.
4. **Backpressure.** Check `controller.desiredSize` before each enqueue. Drop subscribers whose
   queue keeps growing. Events are hints, and clients refetch after reconnect, so dropping is
   safe.
5. **Publisher isolation.** `publish()` must be synchronous, non-throwing, and O(subscribers).
   A failing subscriber must never break `jobDispatcher.executeJob` or `recordSyncHistory`.
   Wrap each delivery in try/catch, the same fire-and-forget style as `fireNotification`.
6. **Coalescing.** Drift sweeps and section-level sync updates can burst. Debounce per
   `(type, instanceId, section)` (for example 250 ms) to cap event rate.
7. **Client reconnect.** Use exponential backoff with jitter (1 s → 30 s cap). Stop on 401/403/429
   (honor `Retry-After`). Close the `EventSource` on `pagehide` and when the tab is hidden for
   a long time, so it doesn't count against caps.
8. **Dev/HMR.** Keep the bus a module singleton that survives HMR, or close all streams on
   dispose. Otherwise orphaned subscribers pile up in `deno task dev`.

## Secure Coding Guidelines

- Do not add `/api/v1/events` to `PUBLIC_PATHS`. Don't special-case it in `authHandle`.
- In the handler, read `event.locals.principal` / `session` and assert non-null. Fail closed if
  the route is ever reached unauthenticated (defense in depth).
- Response headers: `Content-Type: text/event-stream; charset=utf-8`,
  `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`,
  `X-Accel-Buffering: no`. No `Access-Control-Allow-*`.
- Event DTOs go through one serializer that builds each object from an explicit field list
  (`pick`, never spread the source record). Define them in OpenAPI as a `oneOf` keyed by `type`,
  then generate types. Unit-test that no serialized event contains keys like `error`, `payload`,
  `token`, or `apiKey`.
- Never put `HttpError.message`, `error.message`, `last_error`, `sync_history.error`,
  `canaryError`, or `stateToken`/`nextToken` into an event.
- Events trigger refetches through existing authenticated endpoints (`invalidate()`). They are
  not a second source of truth. That keeps authorization and redaction in one place.
- Revalidate the principal on each heartbeat tick. Enforce a maximum stream lifetime. Send a
  terminal `event: auth-expired` before closing, so the client stops retrying.
- Use the `id:` field only as a monotonic sequence number for ordering. Don't implement
  `Last-Event-ID` replay unless replay goes through the same allow-list and is bounded in size.
- Log at debug: connect, disconnect (with reason), cap rejects (warn, rate-limited). Never log
  per event, and never log payloads. Log meta goes through `sanitizeLogMeta`.
- The handler must not mutate state: no job enqueue, no session extension from heartbeats.
- Tests: a 401 when unauthenticated, a token without `read` → 403, the cap → 429, subscriber
  count returns to 0 after abort, a closed stream after session deletion within one interval,
  and allow-list serialization.

## Dependency Security

No new runtime or client dependency is needed. The server uses the native Web `ReadableStream`
and `Response`, and the client uses the native browser `EventSource`. The research rejected
`sveltekit-sse`, `@lok/kit-sse`, and `@microsoft/fetch-event-source` (see
`research-external.md`), so this feature adds no supply-chain exposure. `deno.json` imports stay
unchanged.

## Open Questions

1. **Revocation latency.** Is closing within one heartbeat interval (~20–30 s) acceptable, or
   should logout and session-revoke actions call into the bus to close streams immediately?
   (Recommendation: both. The hook is cheap.)
2. **API-token subscribers.** Should tokens be able to subscribe at all, given the `read` scope?
   If yes, should `?apikey=` be rejected for this route specifically, to keep tokens out of URLs?
3. **Caps.** Per-session 5 and global 50: are those OK for a home-lab single-admin app, and
   should they be configurable through env?
4. **`instanceName` in payloads.** Allow it for toast text, or only ids with client-side
   resolution? Ids are the stricter, preferred choice.
5. **Replay.** Is `Last-Event-ID` replay in scope? If not, the client must refetch everything
   on reconnect. That is simpler and safer.
6. **Separate sanitization gap.** `sync_history.error` and `last_error` store raw upstream text
   that the existing sync-history API already returns. That is a pre-existing exposure outside
   the SSE scope and may deserve its own issue (route those through `sanitizeArrWriteError`).
