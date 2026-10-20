# External Research: Live Job & Sync Events over SSE (YAN-593 / #335)

Scope: the outside technology behind `GET /api/v1/events`. That covers the SSE wire format, how the
browser `EventSource` behaves, SvelteKit streaming endpoints on `sveltekit-adapter-deno`, Deno
`Deno.serve` behavior, and reverse-proxy and compression interference. It also compares SSE briefly
with WebSocket and polling.

Pinned stack (checked in the worktree):

| Component   | Version / config                                                                                                                          | Source                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Deno        | 2.9.7 (local CLI and `Dockerfile` `FROM denoland/deno:2.9.7`)                                                                             | `deno --version`, `Dockerfile:12`                                                 |
| SvelteKit   | `@sveltejs/kit` 2.69.2 (lockfile)                                                                                                         | `deno.lock:946`                                                                   |
| Svelte      | 5.56.4 (no runes, per project rule)                                                                                                       | `deno.lock`                                                                       |
| Adapter     | `sveltekit-adapter-deno` ^0.16.1, `usage: 'deno-compile'`                                                                                 | `package.json:19`, `packages/praxrr-app/svelte.config.js:25-33`                   |
| Prod server | adapter `files/mod.ts`: plain `Deno.serve({ port, hostname }, handler)` → `serveDir` static → `server.respond(request, …)`                | `~/.cache/deno/npm/registry.npmjs.org/sveltekit-adapter-deno/0.16.1/files/mod.ts` |
| Dev server  | `deno run -A npm:vite dev` (Node `http` compat; SvelteKit's `getRequest`/`setResponse` bridge)                                            | `deno.json:41`, `@sveltejs/kit/src/exports/node/index.js`                         |
| Auth        | `handle = sequence(csrfGuard, authHandle)`; session cookie `session`; API token via `X-Api-Key` **or** `?apikey=` (only under `/api/v1/`) | `hooks.server.ts:319`, `lib/server/utils/auth/middleware.ts:60,138`               |

---

## Executive Summary

- **Use SSE (`text/event-stream`) with the native browser `EventSource`. Add no dependencies.** The
  feature only pushes data from server to client. The browser sends the `session` cookie
  automatically because the stream is same-origin. `EventSource` reconnects on its own, and Deno and
  SvelteKit already stream a `ReadableStream` body correctly. WebSocket would need an upgrade path
  that SvelteKit `+server.ts` does not expose on this adapter. Polling is what the issue asks us to
  remove.
- **The adapter adds no wrapper of its own.** `sveltekit-adapter-deno` 0.16.1 calls
  `Deno.serve` with only `port`/`hostname`. It sets no compression, no timeouts, and passes no
  `signal`, and it hands the native Deno `Request` to `server.respond`. So `event.request.signal`
  in `+server.ts` is Deno's own signal in production, and Kit's Node-bridge `AbortController` in
  `vite dev`.
- **Disconnect detection works on Deno 2.9.7.** I tested it locally. When the client aborted, Deno
  fired `request.signal` `abort`, called `ReadableStream.cancel()` with reason
  `"resource closed"` about 1–2 ms later, and resolved `info.completed`. Cleanup should be
  idempotent and should hang off **both** `cancel()` and `request.signal` (see Gotcha G1 about Deno's
  legacy abort semantics).
- **No idle timeout in Deno.serve.** I tested this locally too: a stream that sent nothing for 70 s
  stayed open and delivered the late event. Idle cut-offs come from **proxies** instead: nginx
  `proxy_read_timeout` defaults to 60 s, and Cloudflare and others also cut idle streams. That is
  why the spec recommends a comment heartbeat **about every 15 s**.
- **Compression did not affect the stream in my test.** With `DENO_SERVE_AUTOMATIC_COMPRESSION=1`
  and `Accept-Encoding: gzip`, a `text/event-stream` response came back without `Content-Encoding`
  whether or not `no-transform` was set. Still send `Cache-Control: no-cache, no-transform`. It
  also tells downstream proxies and CDNs to leave the stream alone, and it is the documented
  opt-out in Deno.
- **Proxies:** send `X-Accel-Buffering: no`, which nginx honors per response. Caddy flushes
  `text/event-stream` immediately on its own. Without HTTP/2 the browser allows only **6**
  connections per origin, so use **one shared `EventSource` per tab**, created in the layout
  store and never per page.
- **The spec already defines replay.** If `id:` carries a monotonic sequence number, the browser
  sends `Last-Event-ID` when it reconnects. The server can then replay a small ring buffer, or
  send a `resync` event that tells the client to run `invalidate()`.

---

## Primary APIs

### 1. Server-Sent Events wire format (WHATWG HTML §9.2)

Spec: <https://html.spec.whatwg.org/multipage/server-sent-events.html> · MDN guide:
<https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events>

- MIME type: `text/event-stream`. Always UTF-8. Lines end with LF, CR, or CRLF, and a **blank line
  dispatches** the event.
- Fields:
  - `event: <type>`: the name used for `addEventListener(type)`. Without it the event type is
    `message`.
  - `data: <text>`: may repeat. Multiple lines are joined with `\n`. JSON should go on a single line.
  - `id: <string>`: sets the source's _last event ID_. The value **persists** until the server sets
    another `id`. An `id` containing U+0000 is ignored. An empty `id:` resets the ID, and then no
    `Last-Event-ID` is sent.
  - `retry: <ms>`: ASCII digits only. Sets the reconnection delay.
  - `: comment`: a line starting with `:` is ignored by the client. Use it for heartbeats.
- Reconnect rules (§9.2.3 "reestablish the connection"):
  - A network error, or the server ending the body, causes a reconnect after the reconnection
    time. User agents **may** add exponential backoff.
  - **Fail the connection** happens on a non-200 status, a `Content-Type` other than
    `text/event-stream`, or an aborted fetch. That means `readyState = CLOSED` and **no automatic
    reconnect**. So a 401 JSON from the auth hook kills the source permanently, and the client store
    must handle that itself.
  - HTTP **204** is the documented "stop reconnecting" signal.
  - 301/307 redirects are followed.
- `Last-Event-ID` request header (§9.2.4) is sent on reconnect when the last event ID is not empty.
- Heartbeat guidance (§9.2.7): _"Legacy proxy servers are known to … drop HTTP connections after a
  short timeout. To protect against such proxy servers, authors can include a comment line … every
  15 seconds or so."_
- Connection limit guidance (§9.2.7): multiple pages each opening an `EventSource` can hit the
  per-server connection limit. The suggested mitigations are a SharedWorker or a per-page toggle.

### 2. `EventSource` (browser)

MDN: <https://developer.mozilla.org/en-US/docs/Web/API/EventSource>

- `new EventSource(url, { withCredentials })`. Same-origin requests **always** send cookies.
  `withCredentials` only matters for CORS.
- **No custom request headers.** `X-Api-Key` cannot be sent from a browser `EventSource`. Browser
  users authenticate with the `session` cookie. Non-browser clients can use `X-Api-Key` with
  `fetch`/curl, or `?apikey=` (already supported for `/api/v1/*`, see
  `auth/middleware.ts:60`).
- `readyState` is `CONNECTING` (0), `OPEN` (1) or `CLOSED` (2). `onopen`, `onerror` and
  `onmessage` are available, plus `addEventListener('<event-name>')` for named events.
  `MessageEvent.lastEventId` exposes the ID.
- `error` fires on **every** reconnect attempt, with `readyState` back at `CONNECTING`. When the
  source has permanently failed, `readyState === CLOSED` inside `onerror`.
- **6-connection limit** per browser per origin over HTTP/1.1, across all tabs. Chrome and Firefox
  marked this "Won't fix" (<https://crbug.com/275955>, <https://bugzil.la/906896>). HTTP/2 raises it
  to the negotiated stream limit, about 100. Praxrr is usually served over plain HTTP/1.1 on a LAN
  port such as 6868, so **7 open tabs = page loads stall**. Mitigations are discussed under
  Integration Patterns.
- Browser auto-reconnect waits a fixed, implementation-defined delay of a few seconds (or `retry:`).
  It is **not** exponential backoff in every engine. If the issue's "reconnects with backoff"
  requirement is to hold, the store must close the source and reopen it itself.

### 3. SvelteKit endpoint returning a stream

Docs: <https://svelte.dev/docs/kit/routing#server> and
<https://svelte.dev/docs/kit/web-standards>

- `+server.ts` exports `GET: RequestHandler` and returns any `Response`, including
  `new Response(readableStream, { headers })`. Kit passes the body through unchanged. It only
  rewrites `cache-control` while prerendering, and only uses ETag/304 when an `etag` header is
  present (`kit/src/runtime/server/respond.js:204,503`).
- `event.request` in production is the Deno `Request` object passed to `server.respond`
  (adapter `mod.ts:73`), so `request.signal` is Deno's. In `vite dev`, Kit builds the `Request` with
  its own `AbortController`. That controller aborts on the Node `req` `close` event when the request
  was destroyed before `end` (`kit/src/exports/node/index.js:138-154`), and `setResponse` calls
  `reader.cancel()` on `res` `close`/`error` (`index.js:202-213`). Both paths therefore propagate a
  disconnect to the stream.
- Historical issues: <https://github.com/sveltejs/kit/issues/11751> (cancel not firing; closed,
  later shown to be Bun- and port-forward-specific) and
  <https://github.com/sveltejs/kit/issues/14146> / #12823 (signal not aborting under Node adapter,
  fixed by #13895). Neither applies to the Deno production path.
- The `handle` hook runs first. `authHandle` returns a JSON 401 for unauthenticated `/api/*`
  requests, and per the spec that **fails** the `EventSource` without retry.

### 4. Deno HTTP server

Docs: <https://docs.deno.com/runtime/fundamentals/http_server/> · SSE example:
<https://docs.deno.com/examples/http_server_sse/> · API:
<https://docs.deno.com/api/deno/~/Deno.serve>

- Streaming bodies: return `new Response(readableStream)`. The docs warn that **you must implement
  `cancel()`**, otherwise _"the server will keep queuing up messages forever, and eventually run out
  of memory."_ A disconnect can also show up as a `write()` error on a `TransformStream` writer.
- `ServeHandlerInfo.completed` (<https://docs.deno.com/api/deno/~/Deno.ServeHandlerInfo>) resolves
  once the response is fully sent and rejects if delivery fails. It is not reachable from
  `+server.ts`, because the adapter only forwards `getClientAddress`.
- Request abort semantics: <https://docs.deno.com/runtime/reference/deno_serve_legacy_abort/>. By
  default ("legacy"), `request.signal` aborts **on every finished request, including successful
  ones**. `--unstable-no-legacy-abort` or `deno.json` `"unstable": ["no-legacy-abort"]` restricts
  it to real disconnects. Deno 2.9.7 prints a deprecation warning when code relies on the legacy
  behavior. The legacy default will flip "in an upcoming release".
- Automatic compression is **off by default** and enabled with `automaticCompression: true` or
  `DENO_SERVE_AUTOMATIC_COMPRESSION=1`. It is skipped when the response carries
  `Cache-Control: no-transform` or `Content-Encoding`, or the body is under 64 bytes, or the
  content type is not in `ext/http/compressible.rs`.
- `HttpServer.shutdown()` waits for in-flight requests. An open SSE stream is an in-flight request,
  so graceful shutdown hangs unless the stream is closed. The adapter does not call `shutdown()`.
  Today the process exits on SIGINT/SIGTERM through `parser/spawn.ts:176-186` → `Deno.exit(0)`,
  which drops sockets.

---

## Libraries and SDKs

| Option                                                                                                                                                                  | What it is                                                                                                                                                | Fit for Praxrr                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Native `ReadableStream` + hand-written encoder**                                                                                                                      | about 20 lines (see Code Examples)                                                                                                                        | **Recommended.** No dependency, works under `deno compile`, fully under our control.                                                                                 |
| `@std/http` `ServerSentEventStream` (JSR, `jsr:@std/http@1/server-sent-event-stream`) — <https://jsr.io/@std/http/doc/server-sent-event-stream/~/ServerSentEventStream> | `TransformStream<ServerSentEventMessage, Uint8Array>` with `{ event, data, id, retry, comment }` that validates fields (rejects newlines in `event`/`id`) | Good optional choice. The adapter already pulls `jsr:@std/http@1` for `serveDir`. Adds a JSR import to app code. Either option is acceptable.                        |
| `sveltekit-sse` (razshare) — <https://github.com/razshare/sveltekit-sse>                                                                                                | Kit helper with its own client. Uses **POST** + `fetch` streaming and a 30 s ping                                                                         | Not recommended. POST passes through `csrfGuard`, and it replaces native `EventSource` reconnect with its own protocol, tying the code to a third-party wire format. |
| `@lok/kit-sse` (JSR) — <https://jsr.io/@lok/kit-sse>                                                                                                                    | Schema-validated typed SSE for Kit                                                                                                                        | Small and young. Contract-first OpenAPI already covers payload typing. Skip.                                                                                         |
| `@microsoft/fetch-event-source` — <https://github.com/Azure/fetch-event-source>                                                                                         | `fetch`-based client that allows custom headers, POST, and a retry callback, and closes when the page is hidden                                           | Only needed if browser clients had to send `X-Api-Key`. They don't, because the cookie works. Last release 2.0.1 (2021). Skip.                                       |
| `eventsource` (npm) — <https://github.com/EventSource/eventsource>                                                                                                      | Spec-compliant `EventSource` for Node/Deno with custom `fetch`                                                                                            | Useful **only in tests** to consume the endpoint the way a browser would. Deno tests can also just parse a `fetch` body.                                             |

---

## Integration Patterns

1. **Single in-process event bus → per-connection stream.** The jobs dispatcher and the
   sync/drift/canary code call `publish(event)` on a module-level bus, a `Set` of subscriber
   callbacks or an `EventTarget`. Each `GET /api/v1/events` call registers a subscriber that
   enqueues encoded frames into its own `ReadableStream`. Praxrr is a single process (SQLite,
   `deno compile` binary), so Redis or `LISTEN/NOTIFY` fan-out is unnecessary.
2. **Monotonic `id:` + bounded replay buffer.** Keep a ring buffer of the last N events, around
   200–500, keyed by an increasing integer. On connect, read the `Last-Event-ID` header. If the ID
   falls inside the buffer, replay the newer events. If it is older, or the server restarted
   (track this with a boot epoch, e.g. `id: <epoch>-<seq>`), send one `event: resync` so the client
   runs `invalidateAll()` or a targeted `invalidate()`. The browser handles `Last-Event-ID` with no
   client code.
3. **Notify-then-refetch rather than full-state push.** Events should carry IDs plus status (for
   example `{ jobId, status, instanceId, arrType, syncHistoryId }`), not whole rows. Pages either
   patch one row or call `invalidate('praxrr:jobs')` using `depends()` keys. This keeps the event
   contract small, keeps authorization in the existing load functions, and keeps the page correct
   after missed events.
4. **One `EventSource` per tab, owned by a layout-level store.** Create it in the root
   `+layout.svelte` `onMount` (browser only) and close it in `onDestroy`. Pages subscribe to a
   derived store or register handlers. This rules out per-page connections and the 6-connection
   trap. For many tabs over HTTP/1.1, the spec suggests a SharedWorker, but Safari only added
   SharedWorker in 16, and it complicates the code. A simpler option is **BroadcastChannel leader
   election**, where one tab holds the connection and rebroadcasts. **Recommendation:** start with
   one source per tab and document the 6-tab limit. Treat leader election as an open question.
5. **Backoff owned by the client store.** Inside `onerror`, if `readyState === CLOSED` (a fatal
   status such as 401/403/500, or a wrong content type), schedule a manual reopen with exponential
   backoff and jitter (1 s → 30 s cap). If it is `CONNECTING`, let the browser retry, and optionally
   close and take over once N consecutive errors pile up. Reset the backoff in `onopen`. On
   `visibilitychange` → visible, or the `online` event, reconnect immediately when closed.
   Optionally send `retry: 5000` from the server to set the browser's built-in delay.
6. **Graceful degradation.** Pages must not depend on the stream for correctness. They keep their
   existing `load` data. The store exposes a `connected` boolean, so the UI can show a subtle "live
   updates paused" hint and keep or enable the existing manual refresh. After a reconnect, call
   `invalidate()` once, or rely on `resync`, because events may have been missed.
7. **Heartbeat and liveness.** The server writes `: ping\n\n` every 15 s (spec guidance, under
   nginx's 60 s default). The client can watch for silence: no bytes for more than 45 s means a
   stale half-open connection, so close and reopen. A comment does not fire any `EventSource`
   event, though, so client-side liveness needs a **named** `event: ping` (or `heartbeat`) if it is
   wanted. Trade-off: named pings wake JS every 15 s per tab, which is cheap.
8. **Shutdown.** Keep a set of active stream controllers. On process termination, close them
   (optionally sending `retry:` first) so clients reconnect promptly to the restarted process.

### SSE vs WebSocket vs polling

| Criterion                                      | SSE (`EventSource`)                                               | WebSocket                                                                                                                                                              | Polling (`setInterval` + `invalidate`)   |
| ---------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Direction                                      | Server → client (all we need)                                     | Bidirectional                                                                                                                                                          | Client pull                              |
| SvelteKit `+server.ts` support on this adapter | Native (return a stream)                                          | **No.** Kit has no upgrade hook; would need `Deno.upgradeWebSocket` in a custom `Deno.serve` wrapper replacing the adapter's `mod.ts`, plus separate Vite dev handling | Native                                   |
| Auth                                           | Session cookie automatic; same hooks/CSRF path (GET is CSRF-safe) | Cookie on handshake; must re-implement auth outside `handle`                                                                                                           | Existing                                 |
| Reconnect / resume                             | Built-in; `Last-Event-ID`                                         | Hand-written                                                                                                                                                           | N/A                                      |
| Proxies                                        | Plain HTTP; needs buffering off + heartbeat                       | Needs `Upgrade`/`Connection` headers configured in nginx                                                                                                               | Trivial                                  |
| Connection cost                                | 1 long-lived HTTP/1.1 connection per tab (6-per-origin limit)     | 1 socket per tab (not subject to the 6 limit)                                                                                                                          | N requests/interval; stale between ticks |
| Verdict                                        | **Chosen**                                                        | Overkill and needs adapter surgery                                                                                                                                     | Current state; what the issue removes    |

---

## Constraints and Gotchas

- **G1 — Deno legacy abort.** Under the default flags, Deno 2.9.7 aborts `request.signal` after
  _every_ request finishes and warns about relying on it (seen in my local test, warning text:
  _"Deno.serve: request.signal aborts on successful responses (legacy behavior)…"_). For a stream
  that never ends this is harmless, because the abort only happens at disconnect. In my test, the
  signal aborted about 1 ms before `cancel()` under both modes. Use `cancel()` as the primary
  cleanup hook and `request.signal` as a backstop, and make `cleanup()` idempotent. Do not add
  `no-legacy-abort` to `deno.json` just for this. That is a global behavior change and a separate
  decision.
- **G2 — Always implement `cancel()`.** If it is missing, subscribers leak, and `controller.enqueue`
  on a closed stream throws `TypeError` (“The stream controller cannot close or enqueue”). Wrap
  `enqueue` in try/catch, or guard it with a `closed` flag.
- **G3 — Idle timeouts live in proxies, not Deno.** Measured locally: no data for 70 s and the
  connection survived. The defaults that do apply are nginx `proxy_read_timeout 60s`
  (<http://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout>), Cloudflare
  about 100 s (HTTP 524), and some load balancers at 60 s. A 15 s heartbeat covers all of them.
- **G4 — nginx buffering.** `proxy_buffering on` is the default. Per the nginx docs, buffering
  "can also be enabled or disabled by passing 'yes' or 'no' in the 'X-Accel-Buffering' response
  header field". So send `X-Accel-Buffering: no` from the endpoint. Users who also gzip at nginx
  should exclude `text/event-stream` from `gzip_types`. Document this for self-hosters.
- **G5 — Caddy:** `flush_interval` is ignored and data flushes immediately when the response is
  `Content-Type: text/event-stream`
  (<https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#flush_interval>). No config
  needed. Traefik streams by default, though its compress middleware should exclude
  `text/event-stream`. _[INFERENCE: Traefik default excludes event-stream in v3; not verified
  here.]_
- **G6 — Compression.** Deno's automatic compression is off by default and the adapter does not
  enable it. Even with `DENO_SERVE_AUTOMATIC_COMPRESSION=1`, my local test returned no
  `Content-Encoding` for `text/event-stream`. Send `Cache-Control: no-cache, no-transform` anyway,
  since it is Deno's documented opt-out and covers intermediaries. Compression that buffers until a
  block fills **delays events indefinitely**, which is the usual reason "SSE works locally but not
  behind X".
- **G7 — Fail vs retry semantics.** A 401/403/500 JSON response, or a wrong content type, **fails**
  the source permanently (`CLOSED`). Only network drops and a server-ended body auto-retry. The
  client store must handle `CLOSED`, which covers the "degrade gracefully" acceptance criterion.
  An expired session should not cause a tight loop: on `CLOSED` with a session problem, back off
  and stop after the cap, or check `/api/v1/...` auth once. **Do not** answer 204 for
  unauthenticated requests, because that hides auth errors from API clients.
- **G8 — 6-connection limit (HTTP/1.1).** The SSE connection counts against the same 6 sockets
  used by page navigations, `fetch`, and `__data.json` loads. One tab uses 1 socket. Opening 6 tabs
  saturates the pool, and every other request on the origin queues. HTTP/2 needs TLS in browsers,
  and Deno serves h2 only over TLS or prior-knowledge h2c, so a TLS-terminating proxy speaking h2
  to the browser removes the limit. _[INFERENCE: common Praxrr deployments are plain HTTP on a
  LAN port.]_
- **G9 — No custom headers from `EventSource`.** Browser auth must be cookie-based. The `?apikey=`
  query fallback works for scripts but leaks into proxy access logs. Prefer `X-Api-Key` for
  non-browser consumers that use `fetch` streaming.
- **G10 — CSRF.** `csrfGuard` (`lib/server/security/csrf.ts:127`) rejects only cross-origin
  _mutations_. Its own test `csrfGuard: GET with a foreign Origin is never blocked` confirms GET
  passes. Keep the endpoint GET and side-effect-free. Since GET skips the guard, a cross-site page
  could open `EventSource` to it, but with `SameSite` session cookies and no CORS headers it cannot
  read the stream. Do not add `Access-Control-Allow-*` to this route.
- **G11 — Graceful shutdown.** Open streams keep `HttpServer.shutdown()` from finishing if it is
  ever adopted. Currently `Deno.exit(0)` drops them, the browser sees a network error and
  reconnects after `retry`, and with `Last-Event-ID` across a restart the client gets `resync`
  because of the epoch.
- **G12 — Vite dev.** Under `vite dev` the response goes through Kit's Node bridge (`setResponse`),
  which writes each chunk with `res.write`. Vite's own compression middleware is not enabled in dev
  for SSR responses. _[INFERENCE: not measured.]_ Vite HMR uses a separate WebSocket, so one SSE
  connection plus HMR is fine.
- **G13 — `deno compile`.** Native streams and `TextEncoder` work unchanged in the compiled binary.
  A JSR import such as `@std/http` must be resolvable at build time. The adapter already bundles
  `jsr:@std/http@1`.
- **G14 — Multiple tabs and duplicate toasts.** Each tab receives every event, so a "sync
  finished" toast appears in **every open tab**. Acceptance criterion 2 wants it on "whichever page
  the user is on", so this is arguably fine. Leader election (Integration Pattern 4) or a
  `document.visibilityState` check could reduce the noise.
- **G15 — Event payload hygiene.** Payloads go to any authenticated session. Never include Arr API
  keys, URLs with credentials, or raw error bodies. Reuse the existing credential redaction
  helpers. _[INFERENCE: `arrCredentialRedactionRoutes.test.ts` indicates such helpers exist.]_
- **G16 — `id` and newlines.** `event`/`id` values must not contain CR/LF, and `data` must be
  single-line JSON (JSON.stringify output contains no raw newlines). Validate in the encoder.

---

## Code Examples

### Server: `packages/praxrr-app/src/routes/api/v1/events/+server.ts` (sketch)

```ts
import type { RequestHandler } from './$types';
import { eventBus, type PraxrrEvent } from '$server/events/bus';

const HEARTBEAT_MS = 15_000;
const encoder = new TextEncoder();

function frame(e: PraxrrEvent): Uint8Array {
  // e.id is `${bootEpoch}-${seq}`; e.type is a fixed enum (no CR/LF)
  return encoder.encode(
    `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`
  );
}

export const GET: RequestHandler = ({ request }) => {
  const lastEventId = request.headers.get('last-event-id');
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          cleanup();
        }
      };

      send(encoder.encode('retry: 5000\n\n'));
      for (const e of eventBus.replaySince(lastEventId)) send(frame(e)); // or a single `resync`

      const unsubscribe = eventBus.subscribe((e) => send(frame(e)));
      const heartbeat = setInterval(
        () => send(encoder.encode(': ping\n\n')),
        HEARTBEAT_MS
      );

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener('abort', cleanup);
      };
      request.signal.addEventListener('abort', cleanup, { once: true });
    },
    cancel() {
      cleanup(); // primary path: Deno calls this on client disconnect ("resource closed")
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
};
```

Do not set `Connection: keep-alive`. It is a hop-by-hop header, forbidden in HTTP/2, and Deno
manages it.

### Alternative encoder with `@std/http`

```ts
import { ServerSentEventStream } from 'jsr:@std/http@1/server-sent-event-stream';

const body = messages /* ReadableStream<ServerSentEventMessage> */
  .pipeThrough(new ServerSentEventStream()); // { event, data, id, retry, comment }
return new Response(body, {
  headers: { 'content-type': 'text/event-stream' /* … */ },
});
```

### Client store sketch (`$stores/events.ts`, no runes)

```ts
import { writable } from 'svelte/store';

export const eventsConnected = writable(false);
type Handler = (data: unknown, e: MessageEvent) => void;
const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function attach(type: string) {
  source?.addEventListener(type, (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    for (const h of handlers.get(type) ?? []) h(data, e as MessageEvent);
  });
}

export function connect(url = '/api/v1/events') {
  if (source) return;
  source = new EventSource(url); // same-origin → session cookie sent automatically
  for (const type of handlers.keys()) attach(type);
  source.onopen = () => {
    attempt = 0;
    eventsConnected.set(true);
  };
  source.onerror = () => {
    eventsConnected.set(false);
    if (source?.readyState === EventSource.CLOSED) {
      // fatal (401/500/wrong content-type): browser will NOT retry — we do, with backoff
      source = null;
      const delay =
        Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
      timer = setTimeout(connect, delay, url);
    }
    // readyState CONNECTING → browser auto-retries using `retry:` delay
  };
}

export function disconnect() {
  clearTimeout(timer);
  source?.close();
  source = null;
  eventsConnected.set(false);
}

export function on(type: string, h: Handler): () => void {
  if (!handlers.has(type)) {
    handlers.set(type, new Set());
    attach(type);
  }
  handlers.get(type)!.add(h);
  return () => handlers.get(type)?.delete(h);
}
```

Page usage: `onMount(() => on('job.finished', () => invalidate('praxrr:jobs')))`, where the
returned unsubscribe function is also what `onMount` returns.

### Reverse proxy snippets (for docs)

```nginx
location /api/v1/events {
 proxy_pass http://praxrr:6868;
 proxy_http_version 1.1;
 proxy_set_header Connection '';
 proxy_buffering off;        # or rely on X-Accel-Buffering: no from the app
 proxy_read_timeout 1h;      # heartbeat keeps it alive anyway
 gzip off;
}
```

Caddy: no extra configuration; `text/event-stream` is flushed immediately.

### Quick manual check

```sh
curl -N -H 'Cookie: session=…' http://localhost:6969/api/v1/events
curl -N -H 'X-Api-Key: prx_…' -H 'Last-Event-ID: 1729-42' http://localhost:6969/api/v1/events
```

### Local behavior tests run for this research (Deno 2.9.7)

| Test                                                                                                            | Result                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Client aborts `fetch` of SSE stream (default flags)                                                             | `request.signal` abort → `cancel("resource closed")` +1 ms → `info.completed` resolved; legacy-abort deprecation warning printed |
| Same with `--unstable-no-legacy-abort`                                                                          | Same order and timing; no warning                                                                                                |
| Server sends nothing for 70 s, then one event                                                                   | Connection stayed open; event delivered; no Deno idle timeout                                                                    |
| `DENO_SERVE_AUTOMATIC_COMPRESSION=1`, `Accept-Encoding: gzip`, `text/event-stream`, with/without `no-transform` | `Content-Encoding` absent in all cases                                                                                           |

These tests used bare `Deno.serve`, not the full SvelteKit stack. The adapter passes the native
request and response through unchanged (`mod.ts:73`), so the same behavior is expected end to end.
_[INFERENCE]_

---

## Open Questions

1. **Replay depth vs `resync`-only:** is a ring buffer with `Last-Event-ID` replay worth having, or
   is "on reconnect, send `resync` → `invalidate()`" enough? The second is simpler and always
   correct because events are notify-then-refetch.
2. **Multi-tab strategy:** accept one connection per tab and document the 6-tab HTTP/1.1 limit, or
   add BroadcastChannel leader election now? Same question for dedupe of completion toasts across
   tabs (show only in the visible or focused tab?).
3. **Authorization scope of events:** Praxrr has a single admin user. Does any event need
   per-user filtering, for example if multi-user arrives later? This affects whether the bus filters
   per subscriber.
4. **Token consumers:** should `/api/v1/events` be documented for API-token clients
   (`X-Api-Key`)? If so, OpenAPI needs a `text/event-stream` response with documented event schemas,
   since OpenAPI 3.1 has no first-class SSE and needs per-event `components/schemas` plus a
   description of the framing.
5. **Session expiry while streaming:** an open stream outlives session revocation or expiry, because
   auth runs only at connect. Should the server re-validate the session periodically, for example on
   each heartbeat, and close the stream when it is invalid?
6. **Graceful shutdown:** should termination close all streams explicitly, and should the app move
   to `server.shutdown()`, which the adapter does not expose?
7. **`no-legacy-abort`:** should the project opt into `"unstable": ["no-legacy-abort"]` ahead of
   Deno's default flip? The SSE design here works either way, but other code that uses
   `request.signal` might not.
8. **Connection cap:** should the server enforce a per-session or global maximum number of
   concurrent streams to bound memory, e.g. 20?
