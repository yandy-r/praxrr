# API Researcher — Setup Wizard (#12)

Scope: no new external SaaS API. The wizard extends the existing Servarr connection-test
client (`getSystemStatus()`) and adds `/api/v1/setup/*` routes via the existing contract-first
OpenAPI flow. All citations are `file:line` with ≤5-line snippets.

## External Documentation

Servarr status endpoints reused via `createArrClient(type,url,apiKey).testConnection()` /
new `getSystemStatus()`. Uniform call across supported types; reject `chaptarr` and `all`.

| Arr type | Status endpoint | apiVersion | Auth header | Docs |
| --- | --- | --- | --- | --- |
| radarr | `GET /api/v3/system/status` | `v3` (default) | `X-Api-Key: <key>` | <https://radarr.video/docs/api/> |
| sonarr | `GET /api/v3/system/status` | `v3` (default) | `X-Api-Key: <key>` | <https://sonarr.tv/docs/api/> |
| lidarr | `GET /api/v1/system/status` | `v1` (override) | `X-Api-Key: <key>` | <https://lidarr.audio/docs/api/> |
| chaptarr / all | — reject (400) | — | — | not a valid test target |

- `apiVersion` is per-client: default `v3` (`base.ts:33`), Lidarr overrides to `v1`
  (`clients/lidarr.ts:23` — `protected override apiVersion: string = 'v1';`). `getSystemStatus()`
  must be defined on `BaseArrClient` so all three subclasses inherit the correct version.
- Response parse target: `ArrSystemStatus` interface, `arr/types.ts:956` — fields
  `appName`, `instanceName`, `version`, `osName`, ... `getSystemStatus()` returns
  `{ appName, version } | null` (spec §Files to Modify).

## Patterns to Mirror → REPOSITORY_PATTERN

### 1. Arr client: extend `BaseArrClient` with `getSystemStatus()`; reuse `createArrClient` factory

`testConnection()` today swallows the parsed status into a boolean — the new method must
return the parsed body. Current path (`arr/base.ts:68`):

```ts
async testConnection(): Promise<boolean> {
  try {
    const status = await this.get<ArrSystemStatus>(`/api/${this.apiVersion}/system/status`);
    await logger.info(`Connection successful to ${this.baseUrl}`, { source: 'BaseArrClient',
      meta: { appName: status.appName, version: status.version, osName: status.osName } });
    return true;
```

Mirror plan: add `async getSystemStatus(): Promise<{appName,version}|null>` that does the same
`this.get<ArrSystemStatus>(...)` GET and returns `{appName,version}` on success / `null` on
throw; refactor `testConnection()` to `return (await this.getSystemStatus()) !== null` (keeps
the boolean contract for existing callers). `this.get` is inherited from `BaseHttpClient`
(`base.ts:31` `extends BaseHttpClient`, header `X-Api-Key` set in ctor `base.ts:35-43`).

Factory to reuse verbatim (`arr/factory.ts:25`):

```ts
export function createArrClient(type: ArrType, url: string, apiKey: string, options?: ArrClientOptions): BaseArrClient {
  const constructor = arrClientConstructors[type];      // radarr|sonarr|lidarr|chaptarr map (factory.ts:10)
  if (!constructor) throw new Error(`Unknown arr type: ${type}`);
  return new constructor(url, apiKey, options);
}
```

Existing caller to mirror for shape + timeout/retries (legacy `routes/arr/test/+server.ts:36`):

```ts
if (!VALID_TYPES.includes(type)) return json({ success:false, error:'Invalid arr type' }, {status:400});
client = createArrClient(type as ArrType, url, apiKey, { timeout: 3000, retries: 0 });
const isConnected = await client.testConnection();
```

`VALID_TYPES = ['radarr','sonarr','lidarr']` (`arr/test/+server.ts:6`) — already excludes
`chaptarr`. New `POST /api/v1/setup/test-connection` mirrors this validate→create→call shape,
swapping `getSystemStatus()` in and adding `assertSafeArrUrl(url)` (see SSRF below).

### 2. v1 route handler + generated-type import (contract-first)

Canonical import pattern (`routes/api/v1/arr/library/+server.ts:3,20-22`):

```ts
import type { components } from '$api/v1.d.ts';
type LibraryResponse = components['schemas']['LibraryResponse'];
type ErrorResponse   = components['schemas']['ErrorResponse'];   // reuse this shared schema
```

Handler shape to mirror (`routes/api/v1/sync/preview/+server.ts:211`) — `RequestHandler`,
manual JSON body parse, per-branch `json({error}, {status})`, existing IP/instance rate-limit:

```ts
export const POST: RequestHandler = async ({ request }) => {
  const requestBody = await parseRequestBody(request);           // preview/+server.ts:155 body-size guard
  if (!requestBody.ok) return requestBody.response;
  ... parseCreateRequest → 400 on invalid; getById → 404; !isSyncPreviewArrType → 400 ...
  return json(storedPreview);                                    // 200
};
```

- Type-narrowing helper to copy for `arr_type` allow-listing (`preview/+server.ts:41`):
  `function isSyncPreviewArrType(v: string): v is SyncPreviewArrType { return v==='radarr'||v==='sonarr'||v==='lidarr'; }`
- Rate-limit precedent already in this file (`preview/+server.ts:249` `registerPreviewCreateAttempt`);
  spec W2 wants an IP-keyed variant extracted to `$utils/rateLimit.ts`.

Contract-first flow (mechanical, per CLAUDE.md "Contract-first API"):
1. Edit spec: `docs/api/v1/openapi.yaml` (41k; sibling `paths/` + `schemas/` dirs exist) — add
   a `Setup` tag + the `/api/v1/setup/*` paths and their request/response schemas.
2. Generate: `deno task generate:api-types` → `deno.json:69`
   `npx openapi-typescript docs/api/v1/openapi.yaml -o packages/praxrr-app/src/lib/api/v1.d.ts`.
3. Consume: `import type { components } from '$api/v1.d.ts'` in each new `+server.ts`.
4. `deno task check`.
(Note: `scripts/generate-pcd-types.ts` is the PCD/schema generator — a different flow; api-types
is the plain `npx openapi-typescript` invocation above, no wrapper script.)

### 3. HTTP client wrapper — redirect/SSRF gap (`$http/client.ts`)

`BaseArrClient` → `BaseHttpClient.request()` is the single outbound `fetch`. The current call
sets no `redirect` option, so it defaults to `redirect:'follow'` — an open redirect from a
user-supplied Arr URL defeats a pre-flight host check (spec C3). Current call
(`utils/http/client.ts:57`):

```ts
const response = await fetch(url, {
  method, headers,
  body: options?.body ? JSON.stringify(options.body) : undefined,
  signal: options?.signal ?? controller.signal,
});                                                   // no `redirect:'manual'` → follows 3xx
```

- `RequestOptions` (`utils/http/types.ts:19`) exposes `responseType` only — no `redirect` knob
  today; SSRF hardening adds `assertSafeArrUrl(url)` (new `$arr/urlSafety.ts`) called BEFORE
  `createArrClient`, and `redirect:'manual'` on this fetch (deny-list: cloud-metadata
  `169.254.169.254`/`fd00:ec2::254`, link-local, `0.0.0.0`; `http`/`https` only). Wire the guard
  into BOTH the new `/api/v1/setup/test-connection` route and legacy `arr/test/+server.ts:41`.
- `baseUrl` trailing slash already normalized (`client.ts:17`); timeout via `AbortController`
  (`client.ts:48-49`), retries/backoff loop (`client.ts:42-135`) — pass `{timeout:3000,retries:0}`
  for fast wizard feedback (matches legacy test route).

## Files to Change (new/edit — API surface only)

| File | Action | Why |
| --- | --- | --- |
| `lib/server/utils/arr/base.ts` | edit | add `getSystemStatus()`; `testConnection()` delegates to it |
| `lib/server/utils/arr/urlSafety.ts` | new | `assertSafeArrUrl()` deny-list (C3) |
| `lib/server/utils/http/client.ts` | edit | add `redirect:'manual'` on `fetch` (C3) |
| `routes/api/v1/setup/test-connection/+server.ts` | new | wraps `createArrClient().getSystemStatus()`, guarded+rate-limited |
| `routes/arr/test/+server.ts` | edit | call `assertSafeArrUrl()` too (shared SSRF fix) |
| `docs/api/v1/openapi.yaml` → `$api/v1.d.ts` | edit+gen | add `Setup` paths/schemas; `deno task generate:api-types` |

## Key Files (absolute)

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/base.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/factory.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/types.ts (ArrSystemStatus L956)
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/http/client.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/test/+server.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts (generated-type import)
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml  (+ deno.json:69 generate:api-types)
