# MCP Server — Implementation Plan (PR #1, read-only tier)

> Companion to `docs/plans/mcp-server/design.md` (issue #23). This plan is discovery-complete: every service call below is pinned to a **verified** signature. Where the design's assumed signature differed from reality, the correction is applied inline and catalogued in §8. Save as `docs/plans/mcp-server/implementation-plan.md`.

---

## 1. Build order & what `deno task check` catches

Build leaf-first so each file only imports things that already type-check.

| #   | File                                                 | Depends on                                                                                                        | New/Edit |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `mcp/types.ts`                                       | (none — hand-written wire types + constants)                                                                      | new      |
| 2   | `mcp/redact.ts`                                      | (none)                                                                                                            | new      |
| 3   | `mcp/jsonrpc.ts`                                     | `types.ts`                                                                                                        | new      |
| 4   | `mcp/serialize.ts`                                   | `types.ts`, `redact.ts`                                                                                           | new      |
| 5   | `mcp/mappers.ts`                                     | `$db/queries/arrInstances.ts`, `$db/queries/databaseInstances.ts`                                                 | new      |
| 6   | `mcp/context.ts`                                     | `@sveltejs/kit` (RequestEvent), `$db/queries/users.ts` (type only)                                                | new      |
| 7   | `sync/drift/summary.ts`                              | `$db/queries/arrInstances.ts`, `$db/queries/driftStatus.ts`, `$sync/preview/types.ts`, `$sync/drift/responses.ts` | new      |
| 8   | `mcp/protocol.ts`                                    | `types.ts`, `$db/queries/appInfo.ts`                                                                              | new      |
| 9   | `mcp/tools.ts`                                       | `types.ts`, `serialize.ts`, `mappers.ts`, `summary.ts`, all wrapped services                                      | new      |
| 10  | `mcp/resources.ts`                                   | `types.ts`, `serialize.ts`, `mappers.ts`, `summary.ts`, wrapped services                                          | new      |
| 11  | `mcp/prompts.ts`                                     | `types.ts`                                                                                                        | new      |
| 12  | `mcp/dispatch.ts`                                    | `types.ts`, `jsonrpc.ts`, `protocol.ts`, `tools.ts`, `resources.ts`, `prompts.ts`, `context.ts`                   | new      |
| 13  | `config.ts` (edit)                                   | (none new)                                                                                                        | edit     |
| 14  | `routes/api/v1/drift/summary/+server.ts` (edit)      | `sync/drift/summary.ts`                                                                                           | edit     |
| 15  | `routes/api/v1/mcp/+server.ts`                       | `@sveltejs/kit`, `$config`, `mcp/dispatch.ts`, `mcp/jsonrpc.ts`, `mcp/context.ts`, `mcp/types.ts`                 | new      |
| 16  | `docs/api/v1/paths/mcp.yaml` + `openapi.yaml` `$ref` | (none)                                                                                                            | new/edit |
| 17  | `mcp/tests/mcp.test.ts`                              | route `+server.ts`, `migratedTest` harness                                                                        | new      |
| 18  | `scripts/test.ts` (edit) — `mcp` alias               | (none new)                                                                                                        | edit     |
| 19  | User docs note                                       | (none)                                                                                                            | new/edit |

**What `deno task check` catches** (`check:server` = `deno check --quiet packages/praxrr-app/src/lib/server/**/*.ts`; `check:client` = svelte-check):

- ✅ Every `mcp/**` module file, `sync/drift/summary.ts`, and `config.ts` are inside `check:server`'s glob → handler↔service drift, wrong arg arity, and enum mismatches are caught at type-check.
- ❌ `routes/api/v1/mcp/+server.ts` and the drift route are **outside** the glob (routes are excluded from `deno check`). Route type errors surface **only** when a test imports the route directly (`deno test mcp`), which CI does not run. → Ship `mcp.test.ts` importing `+server.ts` to get local route type coverage.
- ❌ `__APP_VERSION__` does **not** resolve inside `src/lib/server/**` (ambient decl in `src/deno.d.ts` is outside the check glob → `TS2304`). Use `appInfoQueries.getVersion()` for `serverInfo.version`.
- CI gates are `lint-docs`, `lint-shell`, `app-check = deno task check`. `openapi.json`/`v1.d.ts` and docs are prettier-gated — run `prettier --write` on any hand-graft.

---

## 2. Per-file contracts

### 2.1 `mcp/types.ts`

Hand-transcribed wire types (no `any`). Exports:

```
// JSON-RPC 2.0
export type JsonRpcId = string | number;
export interface JsonRpcRequest { jsonrpc: '2.0'; id: JsonRpcId; method: string; params?: unknown }
export interface JsonRpcNotification { jsonrpc: '2.0'; method: string; params?: unknown }
export interface JsonRpcSuccess { jsonrpc: '2.0'; id: JsonRpcId | null; result: unknown }
export interface JsonRpcErrorObject { code: number; message: string; data?: unknown }
export interface JsonRpcErrorResponse { jsonrpc: '2.0'; id: JsonRpcId | null; error: JsonRpcErrorObject }
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcErrorResponse;

// MCP content + entities
export interface TextContent { type: 'text'; text: string }
export interface ToolAnnotations { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
export interface JsonSchema { type: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; [k: string]: unknown }
export interface Tool { name: string; description: string; inputSchema: JsonSchema; annotations?: ToolAnnotations }
export interface ToolCallResult { content: TextContent[]; isError?: boolean; structuredContent?: unknown }
export interface Resource { uri: string; name: string; description?: string; mimeType: string }
export interface ResourceTemplate { uriTemplate: string; name: string; description?: string; mimeType: string }
export interface ResourceContents { uri: string; mimeType: string; text: string }
export interface ResourceReadResult { contents: ResourceContents[] }
export interface PromptArgument { name: string; description?: string; required?: boolean }
export interface Prompt { name: string; description?: string; arguments?: PromptArgument[] }
export interface PromptMessage { role: 'user' | 'assistant'; content: TextContent }
export interface PromptGetResult { description?: string; messages: PromptMessage[] }
export interface ServerCapabilities { tools: Record<never, never>; resources: Record<never, never>; prompts: Record<never, never> }
export interface ServerInfo { name: string; version: string }
export interface InitializeResult { protocolVersion: string; capabilities: ServerCapabilities; serverInfo: ServerInfo; instructions: string }

// Protocol constants
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const LATEST_PROTOCOL_VERSION = '2025-06-18';
export const DEFAULT_PROTOCOL_VERSION = '2025-03-26'; // assumed when MCP-Protocol-Version header absent post-initialize

// Domain enums (single source of truth re-derived from $pcd dispatch tables — see 2.9/§8)
export type McpArrType = 'radarr' | 'sonarr' | 'lidarr';
```

Logic: pure declarations only; no runtime beyond the three `const` arrays/strings.

### 2.2 `mcp/redact.ts`

Exports:

```
export const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization)$/i;
export function redactSecrets<T>(value: T): T;
```

Logic: deep structural clone; for every object key, **preserve** the value if `key.endsWith('_fingerprint')` (belt-and-suspenders — the `$` anchor already spares `api_key_fingerprint`), otherwise if `SECRET_KEY_PATTERN.test(key)` replace the value with `'[REDACTED]'`; recurse into arrays and plain objects; leave primitives untouched. Exact rule: **key-regex** = `/(api[_-]?key|token|secret|password|authorization)$/i` applied to each own-enumerable key; **fingerprint-preservation** = keys matching `/_fingerprint$/i` are never redacted. (Note: `password_hash` is intentionally _not_ matched — it ends in `_hash`; we defend that path by never placing a `User` object into results, see 2.6.)

### 2.3 `mcp/jsonrpc.ts`

Exports:

```
export const ERROR_CODES = { PARSE_ERROR: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL_ERROR: -32603 } as const;
export type ParseResult =
  | { ok: true; message: JsonRpcRequest | JsonRpcNotification }
  | { ok: false; id: JsonRpcId | null; code: number; message: string };
export function parseJsonRpc(raw: string): ParseResult;
export function isNotification(m: JsonRpcRequest | JsonRpcNotification): m is JsonRpcNotification;
export function makeResult(id: JsonRpcId | null, result: unknown): JsonRpcSuccess;
export function makeError(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcErrorResponse;
```

Logic: `parseJsonRpc` runs `JSON.parse` (catch → `PARSE_ERROR`, `id:null`); rejects arrays → `INVALID_REQUEST` `id:null` (batching removed in 2025-06-18); rejects non-object / `jsonrpc !== '2.0'` / missing string `method` → `INVALID_REQUEST`; classifies as request when `id` is `string|number`, else notification. Zero MCP semantics.

### 2.4 `mcp/serialize.ts`

Exports:

```
export function toToolResult(value: unknown): ToolCallResult;
export function toToolError(message: string): ToolCallResult;
export function toResourceContents(uri: string, value: unknown): ResourceReadResult;
```

Shapes:

- `toToolResult(value)` → `{ content: [{ type: 'text', text: JSON.stringify(redactSecrets(value)) }], isError: false, structuredContent: redactSecrets(value) }`. `redactSecrets` is the **last** transform; compute once, reuse for both `text` and `structuredContent`.
- `toToolError(message)` → `{ content: [{ type: 'text', text: message }], isError: true }` (message is a caller-sanitized domain string — never a raw stack/secret).
- `toResourceContents(uri, value)` → `{ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(redactSecrets(value)) }] }`.

### 2.5 `mcp/mappers.ts`

Imports (verified): `ArrInstance` from `$db/queries/arrInstances.ts`; `DatabaseInstance` from `$db/queries/databaseInstances.ts`; `isSyncPreviewArrType` from `$sync/preview/types.ts`.
Exports:

```
export interface McpInstance { id: number; name: string; type: string; url: string; external_url: string | null; api_key_fingerprint: string | null; tags: string | null; enabled: boolean; source?: 'ui' | 'env'; detected_version?: string | null; detected_at?: string | null; created_at: string; updated_at: string }
export function toMcpInstance(instance: ArrInstance): McpInstance;
export interface McpDatabase { id: number; uuid: string; name: string; repository_url: string; local_path: string; sync_strategy: number; auto_pull: boolean; enabled: boolean; has_personal_access_token: boolean; is_private: boolean; local_ops_enabled: boolean; git_user_name: string | null; git_user_email: string | null; conflict_strategy: 'override' | 'align' | 'ask'; last_synced_at: string | null; created_at: string; updated_at: string }
export function toMcpDatabase(db: DatabaseInstance): McpDatabase;
```

Logic:

- `toMcpInstance`: whitelist-copy only the fields above; **omit `api_key` entirely** (never trust the `'' AS api_key` projection); map `enabled` (0|1) → boolean; keep `api_key_fingerprint` verbatim.
- `toMcpDatabase`: whitelist-copy; **drop `personal_access_token` unconditionally** (legacy DBs can return a real git PAT even when modern DBs project `''`); surface only `has_personal_access_token` (0|1 → boolean); map all 0|1 integer flags → boolean.
- Both outputs still transit `redactSecrets()` at serialize time (defense-in-depth).

### 2.6 `mcp/context.ts`

Imports: `RequestEvent` from `@sveltejs/kit` (type); `App.Locals` is ambient (no import).
Exports:

```
export interface McpContext { user: { id: number; username: string } | null; authBypass: boolean }
export function fromRequestEvent(event: RequestEvent): McpContext;
```

Logic: project **only** `{ id, username }` off `event.locals.user` (mirror `timeline/annotations/[id]/+server.ts:11-12`) plus `event.locals.authBypass`. Never copy the raw `User` (it carries `password_hash`, which `redactSecrets` does **not** strip). Audit context only — no re-authorization.

### 2.7 `sync/drift/summary.ts` — see §3.

### 2.8 `mcp/protocol.ts`

Imports (verified): constants from `./types.ts`; `appInfoQueries` from `$db/queries/appInfo.ts`.
Exports:

```
export function negotiateProtocolVersion(clientVersion: unknown): string;
export function buildServerCapabilities(): ServerCapabilities;
export function buildInitializeResult(clientVersion: unknown): InitializeResult;
```

Logic:

- `negotiateProtocolVersion`: if `typeof clientVersion === 'string'` and it is in `SUPPORTED_PROTOCOL_VERSIONS`, echo it; otherwise (absent, unsupported, or newer) return `LATEST_PROTOCOL_VERSION`.
- `buildServerCapabilities`: `{ tools: {}, resources: {}, prompts: {} }` — no sub-features advertised.
- `buildInitializeResult`: `{ protocolVersion: negotiate(...), capabilities: buildServerCapabilities(), serverInfo: { name: 'praxrr', version: appInfoQueries.getVersion() }, instructions: '<read-only surface note>' }`. **`getVersion()`** (not `__APP_VERSION__`) — TS2304 in server glob.

### 2.9 `mcp/tools.ts`

Imports (VERIFIED — corrected paths & aliases):

- `arrInstancesQueries` from `$db/queries/arrInstances.ts` (`getAll`/`getEnabled`/`getByType`/`getById`, all **sync**).
- `scoreInstance`, `scoreFleet` from `$lib/server/health/service.ts` (**async**; no `$health` alias).
- `toSummaryResponse as toHealthSummary` from `$lib/server/health/responses.ts`.
- `configHealthSettingsQueries` from `$db/queries/configHealthSettings.ts` (`.get()` — required 2nd arg to health mapper).
- `computeShield` from `$lib/server/security/service.ts` (**sync**); `toSummaryResponse as toSecuritySummary` from `$lib/server/security/responses.ts` (**name collision — alias both**).
- `buildDriftSummary` from `$sync/drift/summary.ts`; `toInstanceSummary` from `$sync/drift/responses.ts`; `driftStatusQueries` from `$db/queries/driftStatus.ts`.
- `databaseInstancesQueries` from `$db/queries/databaseInstances.ts`.
- `pcdManager` from `$pcd/core/manager.ts` (`getCache` **sync**, returns `undefined` on miss); `listResolvedEntityNames`, `readResolvedEntity`, `isResolvedConfigValidationError`, `isResolvedEntityNotFoundError`, `ARR_AGNOSTIC_READERS`, `PER_ARR_READERS`, type `ResolvedEntityType` from `$pcd/index.ts` (readers **async**).
- `syncHistoryQueries` from `$db/queries/syncHistory.ts`; `buildSyncHistoryListResponse` from `$sync/syncHistory/responses.ts`.
- `generatePreview` from `$sync/preview/orchestrator.ts` (**async**); `isSyncPreviewArrType` from `$sync/preview/types.ts`.
- `toMcpInstance`, `toMcpDatabase` from `./mappers.ts`; `toToolResult`, `toToolError` from `./serialize.ts`.

Exports:

```
export interface McpTool { name: string; description: string; inputSchema: JsonSchema; annotations: { readOnlyHint: true }; handler(args: unknown, ctx: McpContext): Promise<unknown> }
export const TOOLS: readonly McpTool[];
export function listTools(): Tool[];                       // strips handler
export function getTool(name: string): McpTool | undefined;
export async function callTool(name, args, ctx): Promise<ToolCallResult>;
```

`callTool` logic: `getTool(name)` miss → **throw** a tagged `-32602` (unknown tool, dispatch converts); run `validateArgs(tool.inputSchema, args)` (minimal boundary: required keys present, primitive types match, enum membership, `pageSize`/cap bounds) → on failure throw `-32602`; then `try { return toToolResult(await tool.handler(args, ctx)) } catch (e) { return toToolError(sanitize(e)) }` — i.e. **domain throw → `isError:true`**, never a protocol error. `dispatch.ts` refuses to register any tool with `readOnlyHint !== true` (checked once at module load).

Registry entries (name · inputSchema summary · service call · output mapping):

1. **`list_instances`** · `{ type?: 'radarr'|'sonarr'|'lidarr', enabledOnly?: boolean }` · if `type` → `getByType(type)`; else if `enabledOnly` → `getEnabled()`; else `getAll()` · `.filter(i => isSyncPreviewArrType(i.type)).map(toMcpInstance)`.
2. **`get_config_health`** · `{ instanceId?: number }` · if `instanceId`: `report = await scoreInstance(instanceId)`; `report === null` → `toToolError('instance not found or not sync-capable')`; else `toHealthSummary([report], configHealthSettingsQueries.get(), new Date().toISOString())`. No id: `toHealthSummary(await scoreFleet(), configHealthSettingsQueries.get(), new Date().toISOString())`. **(Correction: health mapper needs `settings` + `generatedAt`; single-instance path wraps the report in an array — §8.)**
3. **`get_security_posture`** · `{}` · `toSecuritySummary(computeShield())` (both sync).
4. **`get_drift_status`** · `{ instanceId?: number }` · no id → `buildDriftSummary()`. With id: `instance = arrInstancesQueries.getById(instanceId)`; `undefined` or `!isSyncPreviewArrType(instance.type)` → `toToolError`; else `toInstanceSummary(instance, driftStatusQueries.getById(instanceId))`. **(Correction: design omitted the `arrInstancesQueries.getById` fetch and the arr-type gate — §8.)**
5. **`list_databases`** · `{ enabledOnly?: boolean }` · `getEnabled()` or `getAll()` · `.map(toMcpDatabase)`.
6. **`list_resolved_entities`** · `{ databaseId: number, entityType: <enum>, arrType?: 'radarr'|'sonarr'|'lidarr' }` · resolve: `pcdManager.getById(databaseId)` undefined → `toToolError('database not found')`; `cache = pcdManager.getCache(databaseId)` undefined → `toToolError('database cache not ready')`; `!isKnownResolvedEntityType(entityType)` → `-32602` (validateArgs enum); `await listResolvedEntityNames(cache, entityType, arrType)` in `try/catch` mapping `isResolvedConfigValidationError` → `-32602`, `isResolvedEntityNotFoundError` → `toToolError`, else rethrow → `-32603`. Output: `string[]`.
7. **`get_resolved_entity`** · `{ databaseId: number, entityType: <enum>, arrType?: 'radarr'|'sonarr'|'lidarr', name: string }` · same cache-resolution precedence, then `await readResolvedEntity(cache, entityType, arrType ?? undefined, name)` with the same error classification (validation → `-32602`; not-found → `isError:true`; other → `-32603`). Output: resolved payload.
8. **`search_sync_history`** · `{ instanceId?, arrType?, status?, trigger?, section?, from?, to?, q?, page?=1, pageSize?=25 (max 100) }` · clamp `pageSize` to `[1,100]`, `page` to `>=1`; `filters` = the provided fields (validate `arrType` via `isSyncPreviewArrType`); `rows = syncHistoryQueries.search(filters, { limit: pageSize, offset: (page-1)*pageSize })`; `total = syncHistoryQueries.count(filters)`; `buildSyncHistoryListResponse(rows, { page, pageSize, total })`. **(Correction: `search` takes `Pagination {limit,offset}`, not a page; list builder takes an opts object; design's cap 25/100 kept — §8.)**
9. **`preview_sync`** · `{ instanceId: number, sections?: SectionType[], sectionConfigs?: object }` · `instance = arrInstancesQueries.getById(instanceId)`; `undefined` → `toToolError`; `!isSyncPreviewArrType(instance.type)` → `toToolError('unsupported arr type')` (pre-guard the orchestrator's throw); `result = await generatePreview({ instance, sections, sectionConfigs })`; if `result.errors.length > 0` return `toToolError(result.error ?? 'preview completed with section errors')` **else** `toToolResult(result)`. Output = `GeneratePreviewResult` (`createdAtMs`, section previews, `summary`, `errors`) — **not** a stored preview; there is **no `previewId`/`expiresAt`** (§8).

`entityType` enum (validateArgs + inputSchema): `delayProfile | regularExpression | customFormat | qualityProfile | naming | mediaSettings | qualityDefinitions | lidarrMetadataProfile`. Derive the runtime guard **inside this module** from the readers dispatch tables (do not import the route-scoped `isKnownResolvedEntityType`): `const RESOLVED_ENTITY_TYPES = new Set([...Object.keys(ARR_AGNOSTIC_READERS), ...Object.keys(PER_ARR_READERS)]); const isKnownResolvedEntityType = (v: string): v is ResolvedEntityType => RESOLVED_ENTITY_TYPES.has(v);` (§8).

### 2.10 `mcp/resources.ts`

Imports: same service set as tools + `toResourceContents` from `./serialize.ts`.
Exports:

```
export function listResources(): Resource[];              // static only
export function listResourceTemplates(): ResourceTemplate[];
export async function readResource(uri: string, ctx: McpContext): Promise<ResourceReadResult>; // unmatched → throw -32602
```

Static registry (each `{ uri, name, description, mimeType:'application/json', read }`):

- `praxrr://arr-instances` → `arrInstancesQueries.getAll().filter(isSyncPreviewArrType).map(toMcpInstance)`.
- `praxrr://drift/summary` → `buildDriftSummary()`.
- `praxrr://config-health` → `toHealthSummary(await scoreFleet(), configHealthSettingsQueries.get(), new Date().toISOString())`.
- `praxrr://security-posture` → `toSecuritySummary(computeShield())`.
- `praxrr://databases` → `databaseInstancesQueries.getAll().map(toMcpDatabase)`.

Templated registry (RFC 6570; appear only in `resources/templates/list`; matched by ordered regex):

- `praxrr://arr-instances/{id}` → `getById(Number(id))`; undefined/`!isSyncPreviewArrType` → `-32602`; else `toMcpInstance`.
- `praxrr://databases/{databaseId}/entities/{entityType}` (optional `?arrType=`) → cache-resolution precedence (as tool #6) → `listResolvedEntityNames(cache, entityType, arrType)`.
- `praxrr://databases/{databaseId}/entities/{entityType}/{arrType}/{name}` → cache-resolution → `readResolvedEntity(cache, entityType, arrType, name)`.

`read()` result always via `toResourceContents(uri, value)`; unmatched/malformed URI → throw `-32602` (dispatch converts). Numeric params parsed with `Number()` and NaN-guarded → `-32602`.

### 2.11 `mcp/prompts.ts`

Exports:

```
export function listPrompts(): Prompt[];
export function getPrompt(name: string, args: Record<string, string>): PromptGetResult; // unknown → -32602
```

Registry (`{ name, description, arguments, build(args) }`), each `build` returns one `PromptMessage` (`role:'user'`, single `TextContent`, not an array):

- `diagnose_drift` · `[{ name:'instanceId', required:false }]` · steer `get_drift_status`/`praxrr://drift/summary` then `preview_sync`; explain drift, apply nothing.
- `review_security_posture` · `[]` · read `praxrr://security-posture` + `get_config_health`; summarize top risks, severity-first.
- `plan_sync` · `[{ name:'instanceId', required:true }]` · `preview_sync`, group create/update/delete by section, ask user to confirm before any future write.
- `explain_pcd_entity` · `[{ name:'databaseId', required:true }, { name:'entityType', required:true }, { name:'name', required:true }, { name:'arrType', required:false }]` · `get_resolved_entity` then plain-language explanation.

Missing required argument → `-32602`.

### 2.12 `mcp/dispatch.ts`

Exports:

```
export async function dispatch(message: JsonRpcRequest | JsonRpcNotification, ctx: McpContext): Promise<JsonRpcResponse | null>;
```

Logic: switch on `message.method`.

- Notifications (`notifications/initialized`, `notifications/cancelled`): return `null` (route → 202). Any other notification: also `null` (accepted gracefully).
- Requests: `initialize` → `makeResult(id, buildInitializeResult(params.protocolVersion))`; `ping` → `makeResult(id, {})`; `tools/list` → `{ tools: listTools() }`; `tools/call` → `makeResult(id, await callTool(params.name, params.arguments, ctx))` (callTool's `-32602` throws become `makeError`); `resources/list` → `{ resources: listResources() }`; `resources/templates/list` → `{ resourceTemplates: listResourceTemplates() }`; `resources/read` → `{ contents: (await readResource(params.uri, ctx)).contents }`; `prompts/list` → `{ prompts: listPrompts() }`; `prompts/get` → `makeResult(id, getPrompt(params.name, params.arguments ?? {}))`.
- Unknown method → `makeError(id, METHOD_NOT_FOUND)`.
- Wrap the whole request path in `try/catch`: a tagged `-32602` error → `makeError(-32602)`; any other throw → `makeError(id, INTERNAL_ERROR)` (message generic, no stack). Enforce at module load: throw if any `TOOLS` entry has `annotations.readOnlyHint !== true`.

Uses a small tagged-error class (e.g. `class JsonRpcDispatchError extends Error { code: number }`) so registries can signal `-32602` without importing the route.

---

## 3. `sync/drift/summary.ts` — `buildDriftSummary()`

**New file contents contract.** Reconciliation of the design question (settings/nextRunAt): they **stay in the route**. `buildDriftSummary()` returns the **settings-free core** because the settings block requires `driftSettingsQueries.get()` + `jobQueueQueries.getByDedupeKey('drift.check')` (a job-queue/scheduler coupling irrelevant to the per-instance rollup, and unwanted by MCP consumers).

Imports (verified): `arrInstancesQueries` (`$db/queries/arrInstances.ts`), `driftStatusQueries` (`$db/queries/driftStatus.ts`), `isSyncPreviewArrType` (`$sync/preview/types.ts`), `toInstanceSummary` + `type DriftInstanceSummary` (`$sync/drift/responses.ts`).

```
export interface DriftSummaryTotals { instances: number; inSync: number; drifted: number; unreachable: number; unauthorized: number; error: number; neverChecked: number }
export interface DriftSummaryCore { generatedAt: string; totals: DriftSummaryTotals; instances: DriftInstanceSummary[] }
export function buildDriftSummary(): DriftSummaryCore;
```

Logic (verbatim lift of route lines 22–38): `instances = getEnabled().filter(i => isSyncPreviewArrType(i.type))`; `rowsById = new Map(driftStatusQueries.getAllForSummary().map(r => [r.arrInstanceId, r]))`; `summaries = instances.map(i => toInstanceSummary(i, rowsById.get(i.id)))`; `totals` = the 7 `.filter(s => s.status === X).length` fields; `generatedAt = new Date().toISOString()`. Sync, no new throw beyond the underlying queries. Secret-free (`toInstanceSummary` reads only name/type/detected_version), but still transits `redactSecrets()` at the MCP boundary.

**Exact edit to `routes/api/v1/drift/summary/+server.ts`** (byte-identical response preserved). Replace imports of `driftStatusQueries`/`toInstanceSummary`/`DriftInstanceSummary` usage and lines 22–48 body with:

```ts
import { buildDriftSummary } from '$sync/drift/summary.ts';
// keep: arrInstancesQueries? NO — remove; driftSettingsQueries, jobQueueQueries, toDriftSettingsResponse stay.
// remove now-unused: arrInstancesQueries, driftStatusQueries, isSyncPreviewArrType, toInstanceSummary, DriftInstanceSummary imports.
...
export const GET: RequestHandler = async () => {
  try {
    const core = buildDriftSummary();
    const settings = driftSettingsQueries.get();
    const nextRunAt = settings.enabled === 1 ? (jobQueueQueries.getByDedupeKey('drift.check')?.runAt ?? null) : null;
    return json({
      generatedAt: core.generatedAt,
      settings: toDriftSettingsResponse(settings, nextRunAt),
      totals: core.totals,
      instances: core.instances,
    });
  } catch (error) {
    await logger.error('Failed to build drift summary', { source: 'DriftSummaryRoute', meta: { error: error instanceof Error ? error.message : String(error) } });
    return json({ error: 'Failed to build drift summary' } satisfies ErrorResponse, { status: 500 });
  }
};
```

Remaining imports after edit: `json`, `RequestHandler`, `driftSettingsQueries`, `jobQueueQueries`, `toDriftSettingsResponse`, `logger`, `buildDriftSummary`. (Drop `arrInstancesQueries`, `driftStatusQueries`, `isSyncPreviewArrType`, `toInstanceSummary`, `DriftInstanceSummary`.)

---

## 4. `config.ts` edit — `mcpEnabled` (default ON)

Three edits (verified line anchors):

1. **Field** (after `public readonly pullOnStart: boolean;`, ~line 15):
   `public readonly mcpEnabled: boolean;`
2. **New private static helper** (immediately after existing `parseBooleanEnv`, ~line 89):
   ```ts
   private static parseBooleanEnvWithDefault(value: string | null | undefined, defaultValue: boolean): boolean {
     const normalized = value?.trim().toLowerCase();
     if (normalized === undefined || normalized === '') return defaultValue;
     return ['1', 'true', 'yes', 'on'].includes(normalized);
   }
   ```
3. **Constructor assignment** (after `this.pullOnStart = ...`, ~line 61):
   `this.mcpEnabled = Config.parseBooleanEnvWithDefault(Deno.env.get('MCP_ENABLED'), true);`

Rationale: the existing `parseBooleanEnv` defaults **OFF** (`PULL_ON_START` depends on that) so it cannot be reused for a default-ON flag. The new helper keeps the design's `MCP_ENABLED` env var, treats unset/empty as ON, and honors explicit `0|false|no|off`. **(Correction — design §4 says "via `parseBooleanEnv(...)` default on"; that function returns `false` for undefined. §8.)** Consume via `import { config } from '$config'` → `config.mcpEnabled`.

---

## 5. Route edge — `routes/api/v1/mcp/+server.ts`

Imports: `json` + `type RequestHandler` from `@sveltejs/kit`; `config` from `$config`; `dispatch` from `$lib/server/mcp/dispatch.ts`; `parseJsonRpc`, `isNotification`, `makeError`, `ERROR_CODES` from `$lib/server/mcp/jsonrpc.ts`; `fromRequestEvent` from `$lib/server/mcp/context.ts`; `SUPPORTED_PROTOCOL_VERSIONS` from `$lib/server/mcp/types.ts`.

Module constant: `const MCP_REQUEST_BODY_LIMIT_BYTES = 64 * 1024;` and `const textEncoder = new TextEncoder();`.

**`POST` handler** ordered edges:

1. **Feature flag:** `if (!config.mcpEnabled) return new Response(null, { status: 404 });`
2. **Origin check:** read `request.headers.get('origin')`. If non-null and not same-origin (`new URL(origin).origin !== url.origin`) and not allowlisted → `return new Response(null, { status: 403 });`. Absent Origin passes (non-browser client).
3. **`MCP-Protocol-Version` header:** read `request.headers.get('mcp-protocol-version')`. If **present** and not in `SUPPORTED_PROTOCOL_VERSIONS` → `return json({ error: 'Unsupported MCP-Protocol-Version' }, { status: 400 })` (HTTP 400, **not** a JSON-RPC body). Absent → proceed (dispatch assumes `2025-03-26` for negotiation defaults).
4. **Body byte-guard** (reimplement the verified two-stage `parseRequestBody` pattern from `sync/preview/+server.ts`, but MCP-specific): fast-path on `content-length` header int > limit → `413`; then `rawBody = await request.text()`; if `textEncoder.encode(rawBody).length > MCP_REQUEST_BODY_LIMIT_BYTES` → `return new Response(null, { status: 413 });`.
5. **Parse:** `const parsed = parseJsonRpc(rawBody);` if `!parsed.ok` → `return json(makeError(parsed.id, parsed.code, parsed.message));` (a **200** JSON-RPC error body, e.g. `-32700` with `id:null`, `-32600` for batch arrays).
6. **Dispatch:** `const ctx = fromRequestEvent(event);` then:
   - `if (isNotification(parsed.message)) { await dispatch(parsed.message, ctx); return new Response(null, { status: 202 }); }` — always 202 empty for the no-`id` path; never emit `json(result)`.
   - else `const response = await dispatch(parsed.message, ctx); return json(response);`

**`GET`** = `export const GET: RequestHandler = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });`
**`DELETE`** = same as GET (405, `Allow: POST`).

No auth code (hook-gated; `/api/v1/mcp` deliberately absent from `PUBLIC_PATHS`).

---

## 6. Test matrix — `mcp/tests/mcp.test.ts` (+ `scripts/test.ts`)

Harness: `migratedTest` (temp `APP_BASE_PATH` + `db.initialize` + `runMigrations`); import route `POST`/`GET`/`DELETE` directly; build mock `RequestEvent` (`{ request, url, locals } as unknown as RequestEvent`); `jsr:@std/assert`.

| Test name                                     | Asserts                                                                                                          | Fixtures                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `initialize/supported-version`                | echoes client version when in `SUPPORTED_PROTOCOL_VERSIONS`                                                      | none                              |
| `initialize/unsupported→latest`               | absent/unsupported/newer (`2025-11-25`) → `LATEST_PROTOCOL_VERSION`                                              | none                              |
| `initialize/capabilities-exact`               | `capabilities === {tools:{},resources:{},prompts:{}}`; `serverInfo.name==='praxrr'`, `version` present           | migrated (appInfo row)            |
| `notifications/initialized→202`               | no JSON-RPC body; route status 202, empty body                                                                   | none                              |
| `ping/pre+post-initialize`                    | returns `{}` both before and after initialize                                                                    | none                              |
| `tools/list-shape`                            | array of `{name,description,inputSchema,annotations.readOnlyHint===true}`; all 9 present                         | none                              |
| `resources/list-static-only`                  | 5 static URIs; templated URIs absent                                                                             | none                              |
| `resources/templates/list`                    | 3 templates present; only here                                                                                   | none                              |
| `prompts/list-shape`                          | 4 prompts w/ arguments                                                                                           | none                              |
| `tools/call/happy`                            | `list_instances` → `content[0].type==='text'`, `isError:false`, parseable JSON                                   | seed 1 radarr instance            |
| `tools/call/domain-failure`                   | `get_drift_status {instanceId: <missing>}` → `isError:true` result (NOT JSON-RPC error)                          | none                              |
| `tools/call/unknown-tool`                     | `-32602`                                                                                                         | none                              |
| `tools/call/schema-invalid-args`              | missing/typed-wrong required arg → `-32602`                                                                      | none                              |
| `tools/call/handler-throw→-32603`             | forced internal throw → `-32603`, no stack leak                                                                  | stub throwing service             |
| `error/-32700-bad-json`                       | non-JSON body → `-32700`, `id:null`, HTTP 200                                                                    | none                              |
| `error/-32600-batch-array`                    | `[...]` body → `-32600`                                                                                          | none                              |
| `error/-32600-malformed-envelope`             | missing `jsonrpc`/`method` → `-32600`                                                                            | none                              |
| `error/-32601-unknown-method`                 | `resources/subscribe` → `-32601`                                                                                 | none                              |
| `http/GET+DELETE→405`                         | 405 with `Allow: POST`                                                                                           | none                              |
| `http/protocol-header-unsupported→400`        | present unsupported `MCP-Protocol-Version` → HTTP 400 (not JSON-RPC)                                             | none                              |
| `http/protocol-header-absent→ok`              | absent header → dispatch proceeds                                                                                | none                              |
| `http/feature-flag-off→404`                   | `config.mcpEnabled=false` → 404                                                                                  | env `MCP_ENABLED=0`               |
| `http/body-too-large→413`                     | oversized body → 413                                                                                             | large payload                     |
| `redaction/list_instances-no-api_key`         | serialized `list_instances` output contains no `api_key` key anywhere                                            | seed instance w/ fingerprint      |
| `redaction/resource-arr-instances-no-api_key` | `resources/read praxrr://arr-instances` → no `api_key`; fingerprint preserved                                    | seed instance                     |
| `redaction/list_databases-no-PAT`             | `list_databases` output has no `personal_access_token`                                                           | seed DB instance                  |
| `resolved/list+get`                           | `list_resolved_entities` names; `get_resolved_entity` payload; validation → `-32602`, not-found → `isError:true` | seed enabled DB w/ compiled cache |
| `search_sync_history/paging`                  | pageSize clamp to 100; `page`/`pageSize`/`totalRecords` correct                                                  | seed >1 history row               |
| `preview_sync/success`                        | dry-run diff returned, `isError:false`                                                                           | stubbed reachable Arr             |
| `preview_sync/unreachable→isError`            | slow/unreachable Arr → `isError:true` result                                                                     | stubbed unreachable Arr           |

**`scripts/test.ts` edit:** add to the alias map `mcp: 'packages/praxrr-app/src/lib/server/mcp/tests/'` so `deno task test mcp` runs the suite in isolation; plain `deno task test` still runs everything.

---

## 7. OpenAPI + docs

**`docs/api/v1/paths/mcp.yaml`** (thin — JSON-RPC is opaque to OpenAPI):

- `post`: `summary: MCP Streamable HTTP endpoint`; `requestBody` `application/json` schema `{ type: object, additionalProperties: true }` described "a single JSON-RPC 2.0 request or notification"; headers documented: `X-Api-Key` (auth) and `MCP-Protocol-Version`.
- Responses: `200` (`application/json`, opaque JSON-RPC response), `202` (empty — notification accepted), `400` (unsupported `MCP-Protocol-Version`), `401` (unauthenticated), `403` (bad `Origin`), `404` (feature disabled), `413` (body too large).
- `get`/`delete`: `405` with `Allow: POST`.

**`docs/api/v1/openapi.yaml`** `$ref` line under `paths`:

```yaml
/api/v1/mcp:
  $ref: './paths/mcp.yaml'
```

Run `prettier --write` on both files. `packages/praxrr-api/openapi.json` and `$api/v1.d.ts` are prettier-gated — only regenerate types if the bundle is rebuilt (watch known generator drift; do not commit a noisy local regen).

**User-facing docs note** (add a "Connect an MCP client" section to the user docs, e.g. under the docs-site pages): connect a Streamable-HTTP client to `https://<praxrr-host>/api/v1/mcp` with header `X-Api-Key: <key>` (requires `AUTH=on`; **no** OAuth/Bearer; `AUTH=oidc` has no headless path); stdio clients bridge via `npx mcp-remote https://<praxrr-host>/api/v1/mcp --header "X-Api-Key: <key>"`; exposed surface = read-only instances/drift/health/security-posture/databases/resolved-PCD-entities/sync-history plus `preview_sync` dry-run, no writes.

---

## 8. Signature corrections (design assumption → verified reality → adopted correction)

1. **`buildDriftSummary` return type** — design §4 says `DriftSummaryResponse` (settings-included). Reality: settings block needs `driftSettingsQueries.get()` + `jobQueueQueries.getByDedupeKey('drift.check')`. → **Return `DriftSummaryCore { generatedAt, totals, instances }`; settings/`nextRunAt` stay in the route.** Route re-composes the byte-identical response.
2. **`preview_sync` output** — design §6/§6-note reference a `previewId` digest as the confirmation seed. Reality: `generatePreview` returns `GeneratePreviewResult` with `createdAtMs` and **no `id`/`createdAt`/`expiresAt`** (that's the stored `SyncPreviewResult`, which this path never touches). → Tool returns the settings-free `GeneratePreviewResult`; the future `execute_sync` confirmation-token seed must be derived elsewhere (deferred).
3. **`search_sync_history` pagination** — design implies `search(filters, page)`. Reality: `search(filters, { limit, offset })` (offset-based `Pagination`) and `buildSyncHistoryListResponse(rows, { page, pageSize, total })` (opts object; `total` from `count(filters)`, not `rows.length`). → Compute `offset=(page-1)*pageSize`; pass `count(filters)` as `total`. Design's caps (default 25, max 100) kept, overriding the route's 100/250.
4. **`get_config_health` mapper arity** — design table shows `scoreFleet() → toSummaryResponse`. Reality: health `toSummaryResponse(reports, settings, generatedAt)` needs a `ConfigHealthSettings` row and an ISO timestamp; single-instance `scoreInstance` returns `HealthReport | null` (a single report, not an array). → Fetch `configHealthSettingsQueries.get()` + `new Date().toISOString()`; wrap single report as `[report]`; `null` → `isError:true`.
5. **`toSummaryResponse` name collision** — health and security both export `toSummaryResponse` with different signatures. → Alias on import: `toHealthSummary` / `toSecuritySummary`.
6. **No `$health`/`$security` aliases** — design cites `$lib/server/health`/`$lib/server/security` loosely. Reality: no path alias exists. → Import via `$lib/server/health/service.ts`, `$lib/server/health/responses.ts`, `$lib/server/security/service.ts`, `$lib/server/security/responses.ts`.
7. **`serverInfo.version` source** — design §3 says "the app version constant" (`__APP_VERSION__`). Reality: `__APP_VERSION__` fails `deno check` inside `src/lib/server/**` (`TS2304`; ambient decl outside the glob). → Use `appInfoQueries.getVersion()` (`$db/queries/appInfo.ts`), which mirrors the build's `__APP_VERSION__`.
8. **Config default-ON parsing** — design §4 says "`parseBooleanEnv(Deno.env.get('MCP_ENABLED'))` (default on)". Reality: `parseBooleanEnv(undefined) === false`. → Add `parseBooleanEnvWithDefault(value, true)`; do not mutate `parseBooleanEnv`.
9. **`get_drift_status` single-instance** — design §6 lists only `driftStatusQueries.getById(instanceId) + toInstanceSummary(instance, row)` but omits fetching `instance`. Reality: `toInstanceSummary(instance, row)` needs an `ArrInstance` and casts `instance.type` to `SyncPreviewArrType` unchecked. → Also call `arrInstancesQueries.getById(instanceId)` (undefined → `isError:true`) and gate `isSyncPreviewArrType(instance.type)`.
10. **`entityType` guard location** — design implies reusing the resolved-entity type guard. Reality: `isKnownResolvedEntityType`/`RESOLVED_ENTITY_TYPES` live in a SvelteKit **route** file (`routes/api/v1/pcd/[databaseId]/resolved/shared.ts`). → Re-derive the guard inside `mcp/tools.ts` from `ARR_AGNOSTIC_READERS`/`PER_ARR_READERS` re-exported from `$pcd/index.ts`; do not import across the route boundary.
11. **`list_databases` PAT projection** — design's whitelist focuses on `api_key`. Reality: `DatabaseInstance.personal_access_token` can be a **raw git PAT** on legacy DBs (only blanked to `''` when the credentials table exists). → `toMcpDatabase` must **unconditionally drop** `personal_access_token`, exposing only `has_personal_access_token`.
12. **`pcdManager.getCache` re-export** — design references `pcdManager.getCache`. Reality: `pcdManager` is the singleton in `$pcd/core/manager.ts` (not re-exported from `$pcd/index.ts`); `getCache` is **sync**, returns `undefined` on miss/uncompiled/disabled DB (distinct from `getById` not-found). → Import `pcdManager` from `$pcd/core/manager.ts`; check `getById` (exists?) then `getCache` (cache ready?) before calling readers.

---

## 9. Applied critic corrections (AUTHORITATIVE — override anything above)

The planning critic returned `readyToImplement: false` with a blocker + majors. These corrections are the binding contract; where they conflict with §1–§8, THEY win.

### 9.1 (BLOCKER) Tool error model — new `mcp/errors.ts`

Add `mcp/errors.ts` (build step 1.5, before jsonrpc/tools):

```
export class JsonRpcError extends Error { constructor(public readonly code: number, message: string) { super(message) } }
export class McpDomainError extends Error {}   // tool ran, failed in-domain → isError:true result (NOT a protocol error)
```

- **Tool handlers return raw success payloads only.** They NEVER return a `ToolCallResult`.
- Expected in-domain failure (instance/db/entity not found, unreachable Arr, not sync-capable) → `throw new McpDomainError('<safe message>')`.
- Bad params discovered inside a handler (schema-invalid, unknown enum, resolved-config validation) → `throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, '...')`.
- `callTool(name, args, ctx)`:
  ```
  const tool = getTool(name); if (!tool) throw new JsonRpcError(INVALID_PARAMS, `Unknown tool: ${name}`);
  validateArgs(tool.inputSchema, args);            // throws JsonRpcError(INVALID_PARAMS) on failure
  try { return toToolResult(await tool.handler(args, ctx)); }
  catch (e) { if (e instanceof McpDomainError) return toToolError(e.message); throw e; }   // JsonRpcError + unknown throws propagate
  ```
- `dispatch` request path wraps everything: `catch (e) { if (e instanceof JsonRpcError) return makeError(id, e.code, e.message); return makeError(id, INTERNAL_ERROR, 'Internal error'); }` — so an **unexpected** handler throw becomes `-32603` (satisfies the `handler-throw→-32603` test), while a `McpDomainError` became an `isError:true` result inside `callTool` (satisfies `domain-failure→isError:true`). Every registry entry in §2.9 that said "→ `toToolError(...)`" now means "→ `throw new McpDomainError(...)`".

### 9.2 (MAJOR) Narrow `params: unknown` before access

`dispatch.ts` is inside the `check:server` glob, so `message.params.name` on `unknown` fails `deno task check`. Add to `jsonrpc.ts`:
`export function asRecord(v: unknown): Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }`
Dispatch reads `const p = asRecord(message.params);` then `p.protocolVersion`, `p.name`, `p.arguments`, `p.uri`. A `tools/call`/`resources/read`/`prompts/get` missing its required string field (`name`/`uri`) → `throw new JsonRpcError(INVALID_PARAMS, ...)` (→ `-32602`), never a TypeError→`-32603`.

### 9.3 (MAJOR) Arr-agnostic resolved-entity resource template

`readResolvedEntity` THROWS `ResolvedConfigValidationError` for arr-agnostic types (`customFormat`/`qualityProfile`/`delayProfile`/`regularExpression`) when `arrType !== undefined`. So add a SECOND single-entity template WITHOUT an arrType segment:

- Templates now: `praxrr://arr-instances/{id}`, `praxrr://databases/{databaseId}/entities/{entityType}`, `praxrr://databases/{databaseId}/entities/{entityType}/{name}` (arr-agnostic; `arrType=undefined`), `praxrr://databases/{databaseId}/entities/{entityType}/{arrType}/{name}` (per-arr).
- Read matcher branches on segment count after `entities/`: 1 → names list; 2 → single arr-agnostic (`readResolvedEntity(cache, entityType, undefined, name)`); 3 → single per-arr (`readResolvedEntity(cache, entityType, arrType, name)`). A mismatch (arr-agnostic with arrType, or per-arr without) surfaces as the reader's validation throw → mapped to `-32602`.
- Add a resource test: read a `customFormat` by name via the 2-segment template.

### 9.4 (MAJOR) Origin: strict same-origin, no allowlist

Drop the unimplemented "allowlist" branch (no config field for it). Route Origin check:
`const origin = request.headers.get('origin'); if (origin !== null) { let ok = false; try { ok = new URL(origin).origin === url.origin; } catch { ok = false; } if (!ok) return new Response(null, { status: 403 }); }` — absent Origin passes (non-browser MCP clients send none).

### 9.5 (MINORs)

- **`DEFAULT_PROTOCOL_VERSION` is dead — REMOVE it** from `types.ts`. Negotiation is driven only by the `initialize` body's `protocolVersion`; the post-`initialize` header is only validated-if-present (→ 400) / ignored-if-absent. Route comment must not reference a default version.
- **`toMcpDatabase`**: `has_personal_access_token: Boolean(db.has_personal_access_token)` (coerce `undefined`/`0` → `false`).
- **`search_sync_history`**: validate `status`/`trigger`/`section` against their real enums when guards exist (fail-fast `-32602`); if no cheap guard, document the pass-through (parameterized query → empty results on bad values). Always validate `arrType` via `isSyncPreviewArrType`.
- **`preview_sync` partial failure**: wrap `generatePreview` in try/catch — a THROW (e.g. unreachable Arr) → `throw new McpDomainError(...)` (isError). A resolved result is returned WHOLE (per-section `errors` surfaced in the payload, `isError:false`) so partial diffs are not discarded. Verify the orchestrator's unreachable behavior and align the `preview_sync/unreachable→isError` test stub so unreachable actually throws.
- **Route type gate**: after editing the drift route (step 14) and adding the mcp route (step 15), run `deno task test mcp` AND the existing `packages/praxrr-app/src/tests/routes/drift.test.ts` locally — routes are outside `deno check`, so these tests are the only type coverage for them. The drift route response must stay byte-identical (existing drift.test.ts must pass).
