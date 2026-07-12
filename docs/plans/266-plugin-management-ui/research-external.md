# External API Research: 266 Plugin Management UI

## Executive Summary

Issue [#266](https://github.com/yandy-r/praxrr/issues/266) is primarily an
integration with Praxrr's existing, same-origin `/api/v1/plugins*` API. It does
not need an external service, SDK, API key, pricing plan, or new client
dependency. The strongest implementation is the browser `fetch` API plus the
already-generated OpenAPI types and the client-safe plugin
capability/extension-point catalogs.

The current API completely supports discovery, durable enable/disable intent,
reload, feature-off behavior, identity, declared extension points, capability
grants, and durable lifecycle state. It does **not** expose runtime availability
or recent execution evidence. In particular, `enabled` is administrator intent,
`registered` is a discovery/registry state, and `lastError` is explicitly a
**lifecycle** error. The current production executor remains intentionally
unavailable after issue [#262](https://github.com/yandy-r/praxrr/issues/262)
ended in a Deno/Extism NO-GO. Therefore the UI cannot truthfully claim that a
plugin is active, recently ran, succeeded, or failed from the existing contract
alone. Satisfying #266's recent-run/runtime-unavailable acceptance criteria
requires either a contract-first backend child issue or an explicitly limited UI
that says execution telemetry is unavailable.

## Primary APIs

### Contract sources

- OpenAPI root:
  [`docs/api/v1/openapi.yaml`](https://github.com/yandy-r/praxrr/blob/main/docs/api/v1/openapi.yaml)
  declares the relative server base `/api/v1` and mounts the plugin paths.
- Plugin paths:
  [`docs/api/v1/paths/plugins.yaml`](https://github.com/yandy-r/praxrr/blob/main/docs/api/v1/paths/plugins.yaml)
  is the endpoint-level source of truth.
- Plugin schemas:
  [`docs/api/v1/schemas/plugins.yaml`](https://github.com/yandy-r/praxrr/blob/main/docs/api/v1/schemas/plugins.yaml)
  defines the closed lifecycle, extension-point, capability, response, and error
  unions.
- Generated client types: `packages/praxrr-app/src/lib/api/v1.d.ts` provides
  `components['schemas'][...]` types and must remain generated from the OpenAPI
  source.
- The running app also serves its bundled contract at
  `GET /api/v1/openapi.json`.

All plugin routes are protected by Praxrr's existing authentication hook. A
same-origin browser request uses the current session; no plugin-specific token
or authorization header exists. Every response currently carries
`Cache-Control: no-store`, so the UI should treat each successful response as
authoritative and should not add a client cache layer.

### Endpoint matrix

| Operation | Request                                          | Success                          | Important failure/disabled behavior                                                                                                                |
| --------- | ------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| List      | `GET /api/v1/plugins`                            | `PluginListResponse`             | Feature off is **200**, `{ pluginsEnabled: false, items: [] }`; read failure is 500 `internal_error`                                               |
| Detail    | `GET /api/v1/plugins/{apiVersion}/{id}`          | `PluginDetailResponse`           | 400 invalid identity, 404 wrong/missing namespace identity, 409 feature off, 500 internal                                                          |
| Enable    | `POST /api/v1/plugins/{apiVersion}/{id}/enable`  | Updated `PluginMutationResponse` | Persists intent only; 400, 404, 409 feature off, or 500                                                                                            |
| Disable   | `POST /api/v1/plugins/{apiVersion}/{id}/disable` | Updated `PluginMutationResponse` | Missing-but-durable plugins can retain the decision; 400, 404, 409 feature off, or 500                                                             |
| Reload    | `POST /api/v1/plugins/reload`                    | `PluginReloadResponse` counters  | Feature off is a **200 no-op** with `reloaded: false` and zero counters; unexpected failure is 500 and the prior in-memory snapshot remains usable |

The UI should encode both dynamic path segments with `encodeURIComponent`.
Plugin lookup is case-insensitive within one exact `apiVersion`, but the display
should preserve the authored values returned in `manifest`. The client must not
infer a default API version.

### Data contract and truthful interpretation

`PluginRecord` contains:

| Field        | What it proves                                     | What it does not prove                                                                                |
| ------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `manifest`   | Validated, redacted identity and declarations      | Local source directory, raw manifest data, trust, signing, or install provenance                      |
| `enabled`    | Persisted administrator enablement intent          | Runtime activation or successful execution                                                            |
| `discovered` | Present in the latest successfully reconciled scan | Executable or healthy                                                                                 |
| `state`      | Last durable discovery/lifecycle state             | Recent run outcome; `activated` and `failed` are reserved future states in the current implementation |
| `lastError`  | Safe last lifecycle error, when recorded           | Last execution error or runtime availability                                                          |
| timestamps   | Registration and durable-row creation/update times | Last execution time or duration                                                                       |

The list includes both currently discovered records and bounded
missing/tombstone records. A missing plugin is represented by
`discovered: false` and normally `state: 'unloaded'`; it should remain
inspectable, and its prior enablement intent may be preserved if it reappears.

The reload response is only a summary:

```ts
interface PluginReloadResponse {
  pluginsEnabled: boolean;
  reloaded: boolean;
  discovered: number;
  registered: number;
  rejected: number;
  missing: number;
}
```

It does not contain refreshed records or rejected-manifest details. After a
successful reload, the client must refetch `GET /api/v1/plugins`. Rejected
manifests are logged server-side and counted, but are not available for per-item
display.

### Authentication, rate limits, and pricing

- **Authentication:** existing same-origin Praxrr session/auth middleware; no
  new auth flow.
- **Authorization:** no finer plugin role/permission is documented; the routes
  use the application's existing authenticated boundary.
- **Rate limits:** no endpoint-specific HTTP rate limit is documented. Reload is
  serialized and concurrent callers share one in-flight operation, but the UI
  should still disable the reload button while its own request is pending rather
  than generate redundant traffic.
- **Pagination:** none. Discovery reads at most 256 candidate directories, and
  persistence retains at most 256 missing tombstones in addition to current
  records, so the present list is intentionally bounded.
- **Pricing:** none; this is a local application API.

## Libraries and SDKs

### Recommended: existing platform and repository surfaces

1. **Browser `fetch`** — no wrapper is required for five small same-origin
   endpoints. Fetch resolves normally for HTTP 4xx/5xx, so code must check
   `response.ok` before accepting a body. See MDN's official
   [Using the Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
   guidance.
2. **Generated OpenAPI types** — import type aliases from `$api/v1.d.ts`; do not
   hand-maintain a second copy of `PluginRecord` or the error-code union.
3. **`$shared/plugins` catalogs** — these modules are explicitly pure and
   client-safe. `CAPABILITY_CATALOG` already provides human-readable capability
   labels/descriptions and pinned `mutates: false` / `touchesSecrets: false`
   facts. `EXTENSION_POINTS` provides `kind`, `wired`, `mutates`, and
   `requiredCapability`, allowing the UI to distinguish declared-but-unwired
   points from the currently wired observe points without guessing.
4. **Repository UI surfaces** — use the existing alert store and UI components.
   No external toast, query-cache, switch, or data-grid dependency is justified
   by this bounded management page.

The worktree currently resolves Svelte 5.56.4 and SvelteKit 2.69.2. Praxrr's
repository convention is Svelte 5 without runes and uses `onclick` event
attributes. Official Svelte documentation confirms event attributes such as
`onclick={handler}`:
[Svelte basic markup — Events](https://svelte.dev/docs/svelte/basic-markup#Events).
SvelteKit's official [Loading data](https://svelte.dev/docs/kit/load)
documentation supports route load functions, but the repository already has
management panels that load authoritative API data client-side. Either placement
can work; consistency with the selected route pattern matters more than adding a
library.

### Not recommended

- An OpenAPI runtime client generator: the repository already generates
  compile-time types, and five endpoints do not justify another
  generated/runtime layer.
- TanStack Query/SWR: there is no pagination, background synchronization, or
  shared cross-route cache requirement. Explicit loading/mutation state is
  smaller and easier to audit.
- WebSocket/SSE libraries: the API has no event stream. Recent-run data cannot
  be manufactured by adding a transport library.
- Extism or another WASM SDK in the UI: execution is server-owned and currently
  unavailable; no runtime implementation belongs in the browser management
  surface.

## Integration Patterns

### 1. Load as a feature-aware state machine

Treat the first list response as one of four distinct states:

1. request pending;
2. successful feature-off response (`pluginsEnabled === false`);
3. successful feature-on response, possibly with an empty `items` array;
4. request/HTTP failure (management API unavailable).

Do not collapse feature-off, empty registry, and fetch failure into the same
empty state. Feature-off is normal and should explain `PLUGINS_ENABLED`; an
empty enabled registry should offer reload/discovery guidance; an HTTP/network
failure should offer retry.

### 2. Hydrate mutations from returned server state

Enable and disable return the updated `PluginRecord`. Replace the matching item
using the composite identity `(manifest.apiVersion, manifest.id.toLowerCase())`;
do not optimistically flip `enabled` before success. This avoids rollback UI and
preserves any server-updated timestamps/state. Disable only the affected row's
actions while its mutation is pending.

Reload returns counters rather than records. On a feature-on successful reload:

1. show a concise success alert using its counters;
2. refetch the list;
3. replace the entire list from the authoritative response.

If the refetch fails, retain the prior list but show it as stale and offer
retry; do not claim the reload failed after the server already committed it.

### 3. Render capabilities and extension points from closed catalogs

For each manifest capability, resolve `getCapability(id)` and display its
repository-defined label and description. The catalog supports the accurate
global statement that current grants are observe-only, non-mutating, and do not
touch secrets. Separately state that no capability exists for
credentials/auth/session, network, filesystem, database, environment, or writes.

For each declared extension point, resolve `getExtensionPoint(id)` and display
at least:

- declared identifier;
- kind (`observe`, `transform`, or `provider`);
- wired versus declared-but-unwired;
- mutating versus non-mutating;
- required/granted capability where one exists.

Do not derive wiring or safety from suffixes such as `.observe`; use the catalog
facts.

### 4. Keep runtime state separate from registry state

The UI needs separate conceptual rows for:

- feature flag (`pluginsEnabled`);
- discovery (`discovered`);
- administrator intent (`enabled`);
- durable registry lifecycle (`state` / `lastError`);
- runtime availability;
- execution evidence.

Only the first four are currently returned. The last two must be rendered as
unavailable/unknown, not inferred. The current repository-level fact is
stronger—production uses `UnavailablePluginExecutor`—but hard-coding that in the
page would become stale when a compliant runtime ships.

### 5. Accessible asynchronous feedback

Buttons should use native `disabled` and `aria-busy` during requests, with
visible text that does not depend on color alone. Page-local load/retry state
should remain visible in addition to transient alerts. If the page introduces a
live status region, use `aria-live="polite"` for non-urgent updates; see MDN's
[ARIA `aria-live` reference](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live).

## Constraints and Gotchas

### Contract gap: recent runs and runtime availability

This is the blocking integration finding.

- No current schema field reports whether a production `PluginExecutor` is
  available.
- No field reports `lastRunAt`, extension point, result (`success`, `failure`,
  `timeout`, `runtime_unavailable`), duration, or safe execution error.
- `PluginHost.dispatchOne` catches runtime-unavailable and execution failures
  and only logs them.
- `plugin_registry.last_error` is reset/reconciled as lifecycle data and is not
  written by dispatch.
- The management API cannot distinguish “not run,” “runtime unavailable,” and
  “ran successfully.”

A contract-first child issue should add an explicit closed runtime/execution
evidence shape before the UI claims these states. A minimal direction for design
discussion is:

```yaml
PluginRuntimeStatus:
  enum: [available, unavailable]

PluginLastRunStatus:
  enum: [success, failure, timeout, runtime_unavailable]

# Added to an API response only after runtime-owned, safe persistence exists:
runtimeStatus: PluginRuntimeStatus
lastRun:
  oneOf:
    - type: 'null'
    - type: object
      required: [at, extensionPoint, status]
      properties:
        at: { type: string, format: date-time }
        extensionPoint: { $ref: '#/PluginExtensionPointId' }
        status: { $ref: '#/PluginLastRunStatus' }
        durationMs: { type: integer, minimum: 0 }
        error: { type: [string, 'null'] }
```

The exact location (list-level host status plus per-plugin evidence, or a
dedicated status endpoint) is a design choice. The non-negotiable property is
that it be authoritative and safe, not inferred from enablement or logs. If
backend scope is not expanded, the honest UI fallback is “Runtime not available
in this build; no execution history is available,” with lifecycle errors labeled
exactly as lifecycle errors.

### Error handling

The stable error body is `{ code, error }`, with closed codes
`invalid_identity`, `plugins_disabled`, `plugin_not_found`, and
`internal_error`. Parse JSON defensively because a proxy, auth redirect, or
unexpected server failure may not return that body. Use the server's safe
message when present; otherwise include only the HTTP status and a local generic
message.

A 409 `plugins_disabled` during a mutation means the feature changed after the
page loaded. Refetch the list and transition to the normal disabled state. A 404
means the durable identity no longer exists (for example, after pruning);
refetch rather than leaving a stale toggle. A 500 reload error does not imply
the prior snapshot is unusable.

### Reload and rejected entries

Reload counters can report `rejected > 0`, but the API intentionally does not
expose rejected raw manifests or their field errors. The page can report the
count and direct operators to server logs; it cannot display a rejected plugin
card from this response.

### No dirty form semantics

Enable, disable, and reload are immediate server mutations with authoritative
responses, not an editable draft. Traditional dirty tracking does not apply
unless the design introduces a staged multi-plugin edit, which the API does not
require and this research does not recommend.

## Code Examples

### Typed response aliases and defensive request helper

```ts
import type { components } from '$api/v1.d.ts';

type PluginRecord = components['schemas']['PluginRecord'];
type PluginListResponse = components['schemas']['PluginListResponse'];
type PluginMutationResponse = components['schemas']['PluginMutationResponse'];
type PluginReloadResponse = components['schemas']['PluginReloadResponse'];
type PluginErrorResponse = components['schemas']['PluginErrorResponse'];

class PluginApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: PluginErrorResponse['code']
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as PluginErrorResponse | null;
    throw new PluginApiError(
      body?.error ??
        `Plugin management request failed (HTTP ${response.status})`,
      response.status,
      body?.code
    );
  }
  return (await response.json()) as T;
}
```

### List, mutate, and reload

```ts
export function listPlugins(): Promise<PluginListResponse> {
  return requestJson('/api/v1/plugins');
}

function pluginUrl(record: PluginRecord): string {
  const version = encodeURIComponent(record.manifest.apiVersion);
  const id = encodeURIComponent(record.manifest.id);
  return `/api/v1/plugins/${version}/${id}`;
}

export function setPluginEnabled(
  record: PluginRecord,
  enabled: boolean
): Promise<PluginMutationResponse> {
  const operation = enabled ? 'enable' : 'disable';
  return requestJson(`${pluginUrl(record)}/${operation}`, { method: 'POST' });
}

export function reloadPlugins(): Promise<PluginReloadResponse> {
  return requestJson('/api/v1/plugins/reload', { method: 'POST' });
}
```

### Correct Svelte event semantics without runes

```svelte
<script lang="ts">
  let mutating = false;

  async function togglePlugin(record: PluginRecord) {
    if (mutating) return;
    mutating = true;
    try {
      const result = await setPluginEnabled(record, !record.enabled);
      // Replace this record from result.plugin, then send the repository alert.
    } finally {
      mutating = false;
    }
  }
</script>

<button
  type="button"
  disabled={mutating}
  aria-busy={mutating}
  onclick={() => togglePlugin(plugin)}
>
  {plugin.enabled ? 'Disable' : 'Enable'}
</button>
```

## Open Questions

1. Will #266 create a backend/API child issue for runtime availability and
   per-plugin execution evidence, or will the acceptance criterion be narrowed
   to an explicit “telemetry unavailable” state?
2. If telemetry is added, what is the retention model: one last run per plugin,
   one per extension point, or a bounded recent history?
3. Should `runtimeStatus` be host-wide (the executor is selected process-wide
   today), while `lastRun` remains per plugin?
4. What safe error taxonomy should execution evidence expose? Raw runtime
   messages should not bypass the API's existing redaction policy.
5. Should missing (`discovered: false`) durable records permit enable as well as
   disable in the UI, or should operators only preserve/alter their intent after
   the plugin reappears?
6. Reload can report rejected entries without details. Is a count plus
   server-log guidance sufficient for #266, or is a future safe
   rejection-evidence API desired?
