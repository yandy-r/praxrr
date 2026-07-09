# Praxrr MCP Server Interface — Final Design (issue #23)

> **Status:** Approved design for PR #1 (read-only tier). Winning approach per the judge panel:
> hand-rolled JSON-RPC 2.0 over a single **stateless Streamable HTTP** SvelteKit route, **zero new
> runtime dependencies**, read-only-by-default enforced structurally. This document is the
> authoritative build spec — an implementer should not need to make protocol decisions after reading it.

---

## 1. Summary & Goals

Praxrr will expose its read surface to AI assistants via a Model Context Protocol (MCP) server
mounted **inside the existing SvelteKit app** at a single route. The server speaks MCP
**Streamable HTTP** (single JSON-RPC request → single JSON response), is **stateless** (no
`Mcp-Session-Id`), and is gated for free by the app's existing auth hook.

### Ships in PR #1

- Route `packages/praxrr-app/src/routes/api/v1/mcp/+server.ts` (`POST`; `GET`/`DELETE` → 405).
- A hand-rolled, transport-agnostic JSON-RPC 2.0 codec + MCP method dispatcher (10 methods).
- **9 read-only tools**: `list_instances`, `get_config_health`, `get_security_posture`,
  `get_drift_status`, `list_databases`, `list_resolved_entities`, `get_resolved_entity`,
  `search_sync_history`, `preview_sync` (dry-run).
- **8 resources** (static + RFC 6570 templates) under the `praxrr://` scheme.
- **4 prompt templates**.
- Secret redaction: whitelist mappers **plus** a fail-fast deep-scan `redactSecrets()` gate.
- One net-new shared function: `buildDriftSummary()` (DRY extraction that also cleans up the
  existing inline drift-summary route).
- An env feature flag `MCP_ENABLED` via `$config` (no DB migration — see §4).
- `Deno.test` coverage for dispatch, negotiation, redaction, error codes, and HTTP semantics.
- A minimal OpenAPI path stub (`docs/api/v1/paths/mcp.yaml`) + a user-facing docs note.

### Non-goals / explicitly deferred (follow-up PRs)

- **All write/execute tools** (`trigger_sync`/`execute_sync`, `apply_preview`, `link_database`,
  PCD user-op mutations). Read-only-first is issue guidance; the write tier requires a full
  safety model (§8) that is out of scope for the first increment.
- **stdio transport** and a compiled `praxrr-mcp` binary. stdio bypasses the auth hook and needs a
  second runtime bootstrap + compile target; deferred to avoid splitting the trust model in PR #1.
- **SSE / `text/event-stream`**, server-initiated notifications, progress, cancellation,
  `resources/subscribe`, `listChanged`.
- **Sessions** (`Mcp-Session-Id`) and any session-scoped rate limiting.
- **OAuth 2.1 / Bearer** auth (Praxrr does not support it — see §8).
- The official `@modelcontextprotocol/sdk`. Rejected for PR #1 on dependency-hygiene grounds: its
  flagship `StreamableHTTPServerTransport` is Node `req`/`res`-coupled and unusable under
  `sveltekit-adapter-deno`, so we would pay the full dep + `deno compile` polyfill tax for only the
  dispatch layer. Revisit only if hand-owned spec-tracking becomes a burden.

---

## 2. Transport & Endpoint

**Route:** `packages/praxrr-app/src/routes/api/v1/mcp/+server.ts` → `POST /api/v1/mcp`.

### Design tenets

- **Streamable HTTP, non-streaming.** Every tool/resource is a synchronous request→response with
  **zero server-initiated messages**, so we never open `text/event-stream`. A `POST` carrying a
  request returns `Content-Type: application/json` with a single JSON-RPC response object.
- **Stateless.** No `Mcp-Session-Id` is ever issued; each `POST` is fully self-contained and maps
  1:1 onto SvelteKit's stateless `RequestHandler` — nothing to babysit inside
  `sveltekit-adapter-deno`.

### Method behavior on the route

| HTTP                                                   | Behavior                                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `POST` (body = one JSON-RPC **request**)               | `200` `application/json`, single JSON-RPC response object.                                                           |
| `POST` (body = one JSON-RPC **notification**, no `id`) | **`202 Accepted`, empty body**, no JSON-RPC response.                                                                |
| `POST` (body = JSON array / batch)                     | **`-32600` Invalid Request** — batching is removed in `2025-06-18`; we accept only a single request object (see §3). |
| `POST` (unparseable JSON)                              | JSON-RPC `-32700` response with `id: null`.                                                                          |
| `GET`                                                  | **`405 Method Not Allowed`, header `Allow: POST`** (no SSE listen stream offered).                                   |
| `DELETE`                                               | **`405`, `Allow: POST`** (no session lifecycle).                                                                     |

### Content-type & headers

- **Request:** clients send `Content-Type: application/json` and SHOULD send
  `Accept: application/json`. We do not require `Accept: text/event-stream` since we never stream.
- **`MCP-Protocol-Version` header** (post-`initialize` requests only): if **absent**, assume
  `2025-03-26` (backward compat). If **present and unsupported**, respond **HTTP `400 Bad Request`**
  (`json({ error }, { status: 400 })`) — _not_ a JSON-RPC `-32600` body. This is a corrected
  conformance point from the panel.
- **`Origin` header (DNS-rebinding defense):** validate `Origin` when present. A request whose
  `Origin` is a non-null, non-same-origin, non-allowlisted value is rejected with HTTP `403`.
  Absent `Origin` (non-browser client) is allowed. Same-origin and configured allowlist pass.
- **Body guard:** read with `request.text()` behind the repo's existing byte-size guard, then
  `JSON.parse`. Oversized body → HTTP `413`.

### Feature flag

The whole route no-ops (`404`) when `config.mcpEnabled === false` (default: **enabled** in dev,
see §4 for the toggle rationale).

### Auth

No per-route auth code. `/api/v1/mcp` is deliberately **not** added to `PUBLIC_PATHS`, so
`hooks.server.ts` → `getAuthState()` gates it exactly like every other `/api/*` route. Clients
authenticate with `X-Api-Key` (or `?apikey=`) under `AUTH=on`; under `AUTH=off`/`local` they are
admitted via bypass. Full detail in §8.

---

## 3. Protocol Conformance Spec

Target latest protocol version **`2025-06-18`**; advertise
`SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']`,
`LATEST_PROTOCOL_VERSION = '2025-06-18'`.

Every message carries `jsonrpc: '2.0'`. Every response echoes the request `id` (`string | number`);
`id: null` **only** when a parse error makes the id unrecoverable. A message with **no `id`** is a
notification and receives no JSON-RPC response.

### Methods handled

| Method                      | Kind         | Result                                                     |
| --------------------------- | ------------ | ---------------------------------------------------------- |
| `initialize`                | request      | InitializeResult (below)                                   |
| `notifications/initialized` | notification | no reply (HTTP 202)                                        |
| `notifications/cancelled`   | notification | accepted gracefully, no reply                              |
| `ping`                      | request      | `{}` (empty object); answerable pre- and post-`initialize` |
| `tools/list`                | request      | `{ tools: [...], nextCursor? }`                            |
| `tools/call`                | request      | `{ content: [...], isError?, structuredContent? }`         |
| `resources/list`            | request      | `{ resources: [...], nextCursor? }`                        |
| `resources/templates/list`  | request      | `{ resourceTemplates: [...] }`                             |
| `resources/read`            | request      | `{ contents: [...] }`                                      |
| `prompts/list`              | request      | `{ prompts: [...], nextCursor? }`                          |
| `prompts/get`               | request      | `{ description?, messages: [...] }`                        |

Any other method (`resources/subscribe`, `completion/complete`, `logging/setLevel`, sampling,
roots) → **`-32601` Method not found**. These are **not** advertised as capabilities.

### `initialize` result (exact shape)

```jsonc
{
  "protocolVersion": "<negotiated>",
  "capabilities": { "tools": {}, "resources": {}, "prompts": {} },
  "serverInfo": { "name": "praxrr", "version": "<app version>" },
  "instructions": "Read-only Praxrr config/observability surface. ...",
}
```

- **Capabilities are minimal and honest.** Empty objects mean "supported, no sub-features". Do
  **not** advertise `resources.subscribe`, `resources.listChanged`, `tools.listChanged`,
  `prompts.listChanged`, `logging`, `completions`, or `sampling`/`roots` — a stateless server sends
  no notifications.
- `serverInfo.name` and `serverInfo.version` are required (`version` = the app version constant).

**Protocol-version negotiation:** read `params.protocolVersion`. If it is in
`SUPPORTED_PROTOCOL_VERSIONS`, echo it back. Otherwise (unsupported, absent, or a _newer_ value like
`2025-11-25`) return `LATEST_PROTOCOL_VERSION` and let the client decide whether to continue.

### `tools/call` result shape

```jsonc
{
  "content": [{ "type": "text", "text": "<JSON string>" }],
  "isError": false,
  "structuredContent": {},
}
```

- `content` always includes one `TextContent` block whose `text` is the JSON-serialized (redacted)
  result. `structuredContent` MAY carry the same object for clients that consume structured output.
- **`isError` vs protocol error (critical):**
  - A tool that **runs but fails** in the domain (Arr unreachable, instance/entity not found, bad
    domain state) returns a **normal result** with `isError: true` and the human-readable error in a
    `text` content block. This is **not** a JSON-RPC error.
  - JSON-RPC errors are reserved for **protocol faults**: unknown tool name or schema-invalid /
    missing `arguments` → **`-32602`**; unexpected handler throw → **`-32603`**.

### `resources/read` result shape

```jsonc
{
  "contents": [
    {
      "uri": "<same uri>",
      "mimeType": "application/json",
      "text": "<JSON string>",
    },
  ],
}
```

Each content element repeats its own `uri`. Everything here is text JSON; `blob` (base64) is unused.
Unknown/unmatched URI → `-32602`.

### `prompts/get` result shape

```jsonc
{
  "description": "…",
  "messages": [{ "role": "user", "content": { "type": "text", "text": "…" } }],
}
```

Each message has exactly **one** `content` object (not an array); `role` is `user` | `assistant`.

### JSON-RPC error codes

| Code     | Meaning          | When                                                                           |
| -------- | ---------------- | ------------------------------------------------------------------------------ |
| `-32700` | Parse error      | body is not valid JSON (respond `id: null`)                                    |
| `-32600` | Invalid Request  | not a valid JSON-RPC object (missing `jsonrpc`/`method`), or a **batch array** |
| `-32601` | Method not found | unimplemented / unadvertised method                                            |
| `-32602` | Invalid params   | schema-invalid args, unknown tool name, unmatched resource URI                 |
| `-32603` | Internal error   | uncaught handler throw                                                         |

App-specific errors, if ever needed, use the server range `-32000..-32099`. Error object shape:
`{ jsonrpc: '2.0', id, error: { code, message, data? } }`.

### Notifications → 202

A POST body that is **only** a notification (no `id`) is processed and answered with
**HTTP `202 Accepted`, empty body**, no JSON-RPC response. `notifications/initialized` is the
canonical case. The route edge MUST special-case the no-`id` path and never emit `json(result)` for
it.

### Batching stance

JSON-RPC batch arrays were **removed in `2025-06-18`**. We **do not** support batching: a JSON array
body is rejected with `-32600`. Only a single request (or single notification) object is accepted.
This is the cleanest and safest `2025-06-18` posture and sidesteps version-conditional batch logic.

---

## 4. Module Layout

All new server code lives under `packages/praxrr-app/src/lib/server/mcp/`, following the repo's
per-domain layout (`types.ts` + logic files + a redaction choke point). No `any`; every wire type is
hand-transcribed from the MCP + JSON-RPC schema so `deno task check` guards handler↔service drift.

| File                           | One-line responsibility                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/api/v1/mcp/+server.ts` | Thin transport edge: `POST` reads `request.text()` (byte-guarded), validates `Origin` + `MCP-Protocol-Version` (→ 400), routes notifications → 202 and requests → `json(response)`; `GET`/`DELETE` → 405 `Allow: POST`; feature-flag gate. No protocol logic, no auth code.                                                                                                         |
| `mcp/types.ts`                 | Hand-written strict types transcribed from the MCP + JSON-RPC 2.0 schema: `JsonRpcRequest`/`Response`/`Error`/`Notification`, `InitializeResult`, `ServerCapabilities`, `Tool`, `ToolAnnotations`, `Resource`, `ResourceTemplate`, `Prompt`, `TextContent`; plus `SUPPORTED_PROTOCOL_VERSIONS`/`LATEST_PROTOCOL_VERSION` and the entity/arr-type enums.                             |
| `mcp/jsonrpc.ts`               | Transport-agnostic JSON-RPC 2.0 codec: parse/validate a single request or notification, reject arrays (`-32600`), build result/error envelopes, error-code constants. Zero MCP semantics.                                                                                                                                                                                           |
| `mcp/protocol.ts`              | `negotiateProtocolVersion(clientVersion)`, `buildServerCapabilities()`, and `buildInitializeResult()`.                                                                                                                                                                                                                                                                              |
| `mcp/dispatch.ts`              | Transport-agnostic MCP router `dispatch(message, ctx)`: `initialize`, `notifications/*`, `ping`, `tools/*`, `resources/*` (+ `templates/list`), `prompts/*`; unknown → `-32601`; wraps handler throws into `-32603` or `isError` tool results. Delegates to the registries. **Decoupled from the route** so stdio/SSE and a write tier can attach later without rewriting handlers. |
| `mcp/context.ts`               | `McpContext` type + `fromRequestEvent(event)` reading `event.locals.user`/`authBypass` for audit context (never re-authorization in PR #1).                                                                                                                                                                                                                                         |
| `mcp/tools.ts`                 | Read-only tool registry: `{ name, description, inputSchema (hand-written JSON Schema), annotations: { readOnlyHint: true }, handler }`. Handlers call named service fns **directly**. Includes a `validateArgs()` boundary check → `-32602`.                                                                                                                                        |
| `mcp/resources.ts`             | Resource registry: static resources + RFC 6570 URI-template matchers under `praxrr://`, each with a `read()` returning `ResourceContents`.                                                                                                                                                                                                                                          |
| `mcp/prompts.ts`               | Prompt registry: definitions + `get()` building `PromptMessage`s from argument bindings.                                                                                                                                                                                                                                                                                            |
| `mcp/redact.ts`                | Defense-in-depth `redactSecrets(value)`: deep-strips any key matching `/api[_-]?key$                                                                                                                                                                                                                                                                                                | token$ | secret$ | password$ | authorization$/i`while **preserving**`*_fingerprint`. Applied at the serialization boundary before every emitted result. |
| `mcp/serialize.ts`             | `toToolResult()` / `toResourceContents()`: wrap service results into MCP content (`{ type: 'text', text: JSON.stringify(...) }` + optional `structuredContent`), running `redactSecrets()` as the **last** step.                                                                                                                                                                    |
| `mcp/mappers.ts`               | `toMcpInstance()` — whitelist mapper exposing only `id, name, type, url, external_url, api_key_fingerprint, tags, enabled, source, detected_version, detected_at` (omits raw `api_key`). Re-exports existing already-redacting mappers.                                                                                                                                             |
| `sync/drift/summary.ts`        | **New `buildDriftSummary()` DRY extraction** (see below).                                                                                                                                                                                                                                                                                                                           |
| `mcp/tests/mcp.test.ts`        | `Deno.test` + `jsr:@std/assert` via `migratedTest`: initialize negotiation, `tools/list`, a `tools/call`, `resources/read` redaction, error codes, 405, 202, bad-header 400.                                                                                                                                                                                                        |

### Config / env toggle (env flag, **not** a DB migration)

Add a readonly `mcpEnabled` field to the `$config` singleton, parsed once in the `config.ts`
constructor via `parseBooleanEnv(Deno.env.get('MCP_ENABLED'))` (default **on**).

**Justification for PR #1:** a DB-backed toggle would require a singleton `id=1` row + `*Queries` +
a `/settings/mcp` route + a **migration**, and migration-version collisions across concurrent PRs
are a known, documented pain. An env flag is one readonly field, needs no migration, and matches how
the app already gates startup behavior (`authMode`, `pullOnStart`, `oidc`). A DB-backed per-instance
toggle can arrive with the write tier if operators need runtime control.

### `buildDriftSummary()` DRY extraction

`routes/api/v1/drift/summary/+server.ts` currently inlines the rollup
(`getEnabled().filter(isSyncPreviewArrType)` + `driftStatusQueries.getAllForSummary()` +
`toInstanceSummary(instance, row)` + hand-rolled totals). Extract this verbatim into
`sync/drift/summary.ts` as `buildDriftSummary(): DriftSummaryResponse`. Refactor the existing route
to call it, and have the MCP `get_drift_status` tool + `praxrr://drift/summary` resource call the
same function — one rollup, two consumers, no duplication.

---

## 5. Resource Surface

All resources are read-only, `mimeType: application/json`, and pass through the redaction gate.
Static URIs appear in `resources/list`; **templated (`{param}`) URIs appear only in
`resources/templates/list`** per spec.

### Static resources (`resources/list`)

| URI                         | Wraps (service fn)                                               | mimeType           |
| --------------------------- | ---------------------------------------------------------------- | ------------------ |
| `praxrr://arr-instances`    | `arrInstancesQueries.getAll()` → `toMcpInstance()`               | `application/json` |
| `praxrr://drift/summary`    | `buildDriftSummary()` (`$sync/drift/summary.ts`)                 | `application/json` |
| `praxrr://config-health`    | `scoreFleet()` → `toSummaryResponse` (`$lib/server/health`)      | `application/json` |
| `praxrr://security-posture` | `computeShield()` → `toSummaryResponse` (`$lib/server/security`) | `application/json` |
| `praxrr://databases`        | `databaseInstancesQueries.getAll()`                              | `application/json` |

### Resource templates (`resources/templates/list`, RFC 6570)

| URI Template                                                             | Wraps                                                                                                             | mimeType           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------ |
| `praxrr://arr-instances/{id}`                                            | `arrInstancesQueries.getById(id)` → `toMcpInstance()`                                                             | `application/json` |
| `praxrr://databases/{databaseId}/entities/{entityType}`                  | `pcdManager.getCache(databaseId)` + `listResolvedEntityNames(cache, entityType, arrType?)` (optional `?arrType=`) | `application/json` |
| `praxrr://databases/{databaseId}/entities/{entityType}/{arrType}/{name}` | `pcdManager.getCache(databaseId)` + `readResolvedEntity(cache, entityType, arrType, name)`                        | `application/json` |

Unmatched or malformed template URIs → `-32602`.

---

## 6. Tool Surface

All PR #1 tools carry `annotations.readOnlyHint: true`. **Read-only safety rests on the absence of
any registered write handler, not on the advisory hint** — a malicious/buggy client can ignore
annotations. Every handler calls a named service function **directly** (no internal HTTP hop) and
routes output through the redaction gate. Unbounded surfaces enforce `pageSize`/size caps in their
`inputSchema` because the endpoint is stateless with no session-scoped throttling.

| Tool                     | readOnly | Inputs (JSON Schema summary)                                                                                                                 | Wraps                                                                                                                | Output summary                        |
| ------------------------ | :------: | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `list_instances`         |    ✅    | `{ type?: 'radarr'                                                                                                                           | 'sonarr'                                                                                                             | 'lidarr', enabledOnly?: boolean }`    | `arrInstancesQueries.getAll()`/`getEnabled()`/`getByType(type)` → `toMcpInstance()`        | Redacted instance list (fingerprint only)                                                                                                  |
| `get_config_health`      |    ✅    | `{ instanceId?: number }`                                                                                                                    | `scoreInstance(id)` or `scoreFleet()` → `toSummaryResponse` (`$lib/server/health`)                                   | Health report(s)                      |
| `get_security_posture`   |    ✅    | `{}`                                                                                                                                         | `computeShield()` → `toSummaryResponse` (`$lib/server/security`)                                                     | Shield/posture report                 |
| `get_drift_status`       |    ✅    | `{ instanceId?: number }`                                                                                                                    | `buildDriftSummary()` when no id; else `driftStatusQueries.getById(instanceId)` + `toInstanceSummary(instance, row)` | Fleet rollup or single-instance drift |
| `list_databases`         |    ✅    | `{ enabledOnly?: boolean }`                                                                                                                  | `databaseInstancesQueries.getAll()`/`getEnabled()`                                                                   | PCD database list                     |
| `list_resolved_entities` |    ✅    | `{ databaseId: number, entityType: <enum>, arrType?: 'radarr'                                                                                | 'sonarr'                                                                                                             | 'lidarr' }`                           | `pcdManager.getCache(databaseId)` + `listResolvedEntityNames(cache, entityType, arrType?)` | Resolved entity **names**                                                                                                                  |
| `get_resolved_entity`    |    ✅    | `{ databaseId: number, entityType: <enum>, arrType?: 'radarr'                                                                                | 'sonarr'                                                                                                             | 'lidarr', name: string }`             | `pcdManager.getCache(databaseId)` + `readResolvedEntity(cache, entityType, arrType, name)` | One resolved entity payload                                                                                                                |
| `search_sync_history`    |    ✅    | `{ instanceId?, arrType?, status?, trigger?, section?, from?, to?, q?, page?: number (default 1), pageSize?: number (default 25, max 100) }` | `syncHistoryQueries.search(filters, page)` + `count(filters)` → `buildSyncHistoryListResponse`                       | Paged sync-history list               |
| `preview_sync`           |    ✅    | `{ instanceId: number, sections?: ('qualityProfiles'                                                                                         | 'delayProfiles'                                                                                                      | 'mediaManagement'                     | 'metadataProfiles')[], sectionConfigs?: object }`                                          | `arrInstancesQueries.getById(instanceId)` then `generatePreview({ instance, sections, sectionConfigs })` (`$sync/preview/orchestrator.ts`) | Dry-run diff (creates/updates/deletes per section) |

**`entityType` enum:** `delayProfile | regularExpression | customFormat | qualityProfile | naming |
mediaSettings | qualityDefinitions | lidarrMetadataProfile`.

### `preview_sync` is admissible read-only

`generatePreview` is a **verified dry-run** that performs **no local or remote writes** (it reads
the live Arr). It is action-shaped but write-free, so it is labeled `readOnlyHint: true` and needs
no confirmation. It proves the action-shaped path end-to-end and — crucially — its `previewId` +
digest is the natural confirmation-token seed for the deferred `execute_sync`. If a target Arr is
slow/unreachable, the handler returns an **`isError: true` result** (not a protocol error), bounded
by the HTTP timeout.

### Write/execute tools are DEFERRED

No mutating tool is registered or reachable in PR #1. The `ToolAnnotations` type
(`readOnlyHint`/`destructiveHint`) is already present on every entry, and `dispatch.ts` refuses to
register any tool whose `readOnlyHint !== true`. This keeps read-only an **invariant of the code**,
not of a hint. The write tier (`execute_sync`, `apply_preview`, `link_database`, PCD mutations) is
deferred because it needs the full safety model in §8; shipping half a mutation story would be
worse than shipping none.

---

## 7. Prompt Surface

Prompts are argument-substituted message templates (`role: 'user'`, `TextContent`) that steer an
assistant to call the read tools/resources in a safe order.

| Prompt                    | Arguments                                                                    | Purpose                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnose_drift`          | `{ instanceId?: string }`                                                    | Guide the assistant to call `get_drift_status` (or read `praxrr://drift/summary`), then `preview_sync`, to explain what has drifted and why — **without applying anything**.                                          |
| `review_security_posture` | _(none)_                                                                     | Guide reading `praxrr://security-posture` + `get_config_health`, then summarize top risks and remediations, highest severity first.                                                                                   |
| `plan_sync`               | `{ instanceId: string }`                                                     | Guide `preview_sync`, summarize planned create/update/delete changes grouped by section, and **explicitly ask the user to confirm before any (future) write tool** — seeds the deferred write tier's confirmation UX. |
| `explain_pcd_entity`      | `{ databaseId: string, entityType: string, name: string, arrType?: string }` | Guide `get_resolved_entity` and explain the resolved config entity (e.g. a custom format's scoring/matching) in plain language.                                                                                       |

---

## 8. Security & Safety

### Secret redaction (fingerprint only)

- **Never emit a raw `api_key`.** `ArrInstance` rows still carry `api_key: string` even where the
  default `SELECT` projects `'' AS api_key`, so `getById`/embedded-diff paths remain a live leak
  surface.
- **Two layers, defense-in-depth:**
  1. **Whitelist mapper** `toMcpInstance()` exposes only the safe fields (incl.
     `api_key_fingerprint`, never `api_key`). All other surfaces reuse existing already-redacting
     mappers (`toInstanceSummary`, `toSummaryResponse` ×2, `buildSyncHistoryListResponse`).
  2. **Fail-fast deep scrubber** `redactSecrets()` runs at the serialization boundary on **every**
     tool/resource result, deep-stripping any `api_key`/`token`/`secret`/`password`/`authorization`
     key while preserving `*_fingerprint`. A careless direct serialization of a raw `ArrInstance`
     cannot leak.
- **Backed by a test** that fails if `api_key` (or any raw-secret key) appears anywhere in any
  surface's output.

### Read-only posture

Structural, not advisory: no write handler is registered; `dispatch.ts` rejects registering any
non-`readOnlyHint` tool. `readOnlyHint`/`destructiveHint` are hints a client may ignore, so they are
**not** the safety control.

### Auth

- `/api/v1/mcp` is **not** in `PUBLIC_PATHS`, so `hooks.server.ts` + `$auth/middleware.ts` gate it
  with **zero per-route auth code**. Unauthenticated `/api/*` → `401` before dispatch runs.
- **`AUTH=on`:** client sends `X-Api-Key: <key>` (or `?apikey=`), validated against
  `auth_settings.api_key`; success synthesizes `event.locals.user = { id: 0, username: 'api' }`.
- **`AUTH=off` / `AUTH=local`:** admitted via `authBypass` (local-IP / trusted-proxy trust model).
- **Deviations documented for users (§10):** Praxrr supports **no** Bearer/`Authorization` / OAuth
  path — MCP clients MUST send the custom `X-Api-Key` header (or sit behind a trusted proxy).
  **`AUTH=oidc` has no api-key path at all** (session cookie only), so headless MCP clients cannot
  authenticate in `oidc` mode.
- The `{ id: 0, username: 'api' }` identity is read only for **audit context** in PR #1, never for
  re-authorization.

### Size / error handling

- Byte-size guard on the request body (`413` on overflow); pagination/size caps in tool schemas
  (`search_sync_history`, resolved-entity name lists, any future timeline surface).
- Domain failures → `isError: true` results; protocol faults → JSON-RPC error codes (§3). No
  error path leaks stack traces or secrets into `content`.
- `Origin` validation guards against DNS-rebinding from browser-based clients.

### How write tools will be gated later

When the write tier lands, each mutating tool MUST:

1. Be **off by default** behind a dedicated flag (`MCP_ALLOW_WRITES`, or a DB `write_enabled`
   toggle if runtime control is required).
2. Require **dry-run-first**: a prior `preview_sync` producing a `previewId` + digest.
3. Require an explicit **confirmation token** proving that preview is `READY`, not stale, and
   matches `instanceId` + `sections`.
4. Carry `readOnlyHint: false` + `destructiveHint: true`.
5. Write an **audit record** (reusing the `sync_history` row `executeSyncJob` already writes) keyed
   on the pseudo-user, and make a **write-scoped auth decision** at the `{ id: 0, username: 'api' }`
   gate point.
6. Remain **unreachable** (unregistered) until all of the above exist.

---

## 9. Test Plan

Tests use `Deno.test` + `jsr:@std/assert` via the `migratedTest` harness (temp `APP_BASE_PATH` +
`db.initialize` + `runMigrations`) and import the route handler directly. **CI does not run tests**
(gates are `lint-docs`, `lint-shell`, `app-check = deno task check`), so these are for local
regression catching and a future test gate — but they ship in PR #1.

### Protocol-handler unit tests (`mcp/tests/mcp.test.ts`, dispatch-level)

- `initialize`: supported version echoed; unsupported/absent/newer → `LATEST`; capabilities exactly
  `{ tools:{}, resources:{}, prompts:{} }`; `serverInfo.name/version` present.
- `notifications/initialized`: no JSON-RPC response; route returns `202` empty body.
- `ping`: returns `{}` pre- and post-initialize.
- `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`: shapes match §3;
  templates appear only in `templates/list`.
- `tools/call`: happy path returns `content` + `isError:false`; **domain failure returns
  `isError:true` result, not a JSON-RPC error**; schema-invalid args → `-32602`; unknown tool →
  `-32602`; handler throw → `-32603`.
- Error codes: `-32700` (bad JSON, `id:null`), `-32600` (batch array + malformed envelope),
  `-32601` (unknown method).

### HTTP-semantics tests (route-level, direct `+server.ts` import + mock `RequestEvent`)

- `GET`/`DELETE` → `405` with `Allow: POST`.
- Missing `MCP-Protocol-Version` → assume `2025-03-26`; present-and-unsupported → HTTP `400`.
- Feature flag off → `404`.
- Redaction: `resources/read` on `praxrr://arr-instances` and a `tools/call` on `list_instances`
  assert **no `api_key`** field anywhere in the serialized output (whitelist + scrubber).

### Per-tool / per-resource tests

Each tool/resource gets a focused test that imports `+server.ts` `POST` directly, builds a mock
`RequestEvent` (`{} as unknown as Event`, or `new Request` for bodies), seeds fixture data via the
migrated harness, and asserts `response.status`, `await response.json()`, and the redacted shape.
`preview_sync` is tested against a stubbed Arr for both success and unreachable (`isError:true`).

### Registering in `scripts/test.ts`

Add an `mcp` alias to the `scripts/test.ts` alias map pointing at
`packages/praxrr-app/src/lib/server/mcp/tests/` so `deno task test mcp` runs the suite in isolation;
plain `deno task test` continues to run everything.

---

## 10. Contract / Docs

### OpenAPI path (minimal)

Add `docs/api/v1/paths/mcp.yaml` describing **only** `POST /api/v1/mcp` and `$ref` it from
`docs/api/v1/openapi.yaml`. JSON-RPC does not map cleanly to OpenAPI, so keep it deliberately thin:

- `requestBody`: `application/json`, schema an **opaque object** (`type: object`,
  `additionalProperties: true`) documented as "a single JSON-RPC 2.0 request or notification".
- Responses: `200` (`application/json`, opaque JSON-RPC response object), `202` (empty — notification
  accepted), `400` (unsupported `MCP-Protocol-Version`), `401` (unauthenticated), `403` (bad
  `Origin`), `404` (feature disabled), `413` (body too large).
- Document the `X-Api-Key` header and the `MCP-Protocol-Version` header.

Do **not** try to model every method/tool in OpenAPI — the authoritative contract for tools /
resources / prompts is `tools/list`, `resources/list`, and `prompts/list` at runtime. Note:
`packages/praxrr-api/openapi.json` (bundled form) and the committed `$api/v1.d.ts` are
prettier-gated, so run `prettier --write` on any hand-graft and regenerate types only if needed
(watch for the known generator drift noise).

### User-facing docs note

Add a short section to the user docs covering:

- **Connecting a client (Streamable HTTP):** point the client at
  `https://<praxrr-host>/api/v1/mcp` and configure it to send the header `X-Api-Key: <your key>`
  (from Settings → auth). Requires `AUTH=on`. There is **no** OAuth/Bearer support; `AUTH=oidc` has
  no headless api-key path.
- **stdio bridging via `mcp-remote`:** for clients that only speak stdio (e.g. Claude Desktop),
  bridge with `npx mcp-remote https://<praxrr-host>/api/v1/mcp --header "X-Api-Key: <key>"` so the
  desktop client spawns a stdio proxy that forwards to the HTTP endpoint. (A native stdio transport
  is deferred — §1.)
- **What's exposed:** read-only config/observability (instances, drift, health, security posture,
  databases, resolved PCD entities, sync history) plus a `preview_sync` dry-run. No writes.

---

## 11. Open Questions / Risks

1. **Hand-rolled conformance debt.** We own MCP spec-tracking (versions, capabilities, error codes,
   handshake). Subtle non-conformance could make some clients reject us; there is no SDK test suite
   backing correctness. Mitigation: strict types + the conformance test suite; revisit the SDK if
   the spec churns.
2. **Auth-model mismatch with the client ecosystem.** Most Streamable-HTTP MCP clients default to
   OAuth `Authorization: Bearer`; Praxrr accepts only `X-Api-Key` and only under `AUTH=on`. Users
   need custom-header config or a fronting proxy; `AUTH=oidc` offers no headless path. Under
   `AUTH=off`/`local` the endpoint is effectively unauthenticated to any reachable/local caller,
   exposing full config read + `preview_sync` with no per-tool scoping.
3. **CI does not run `Deno.test`.** Only `deno task check` (type-checking) gates this code, so
   dispatch/redaction/conformance regressions won't block a merge until a test gate is added.
   Mitigation: strict types now, ship tests now, propose a test gate follow-up.
4. **Raw `api_key` footgun.** The `ArrInstance` object still carries `api_key`; one careless direct
   serialization is a leak. Mitigated by the whitelist mapper + `redactSecrets()` gate + a redaction
   test that must stay green.
5. **`preview_sync` calls a live Arr.** A slow/unreachable instance blocks the single stateless POST
   up to the HTTP timeout with no partial results (no SSE/progress). Returns `isError:true` on
   failure; acceptable for read-only, but a candidate for a future streaming transport.
6. **Contract-first friction.** Tool/resource/prompt schemas live outside the generated
   `$api/v1.d.ts` contract; divergence between a hand-written `inputSchema` and the wrapped service
   fn's real params is caught only by handler-level type checks and tests, not by type generation.
7. **Unbounded result sizes** (sync history, PCD entity name lists) over a session-less endpoint —
   mitigated by `pageSize` caps in tool schemas, but there is no session-scoped rate limiting beyond
   the app's global posture.
8. **When the write tier lands:** confirm whether the confirmation-token / preview state can live in
   the same process (it can, since PR #1 is HTTP-only and stateless per request but shares the
   server's in-memory `previewStore`) — this becomes a real concern only if a stdio transport (a
   separate process) is later added, at which point the token must be persisted or scoped
   same-process.
