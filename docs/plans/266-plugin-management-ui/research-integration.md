# Integration Research: 266 Plugin Management UI

## Integration Summary

Issue #266 is a browser integration over the existing Phase-4 plugin management
contract; it is not a new plugin data model, runtime, or persistence phase. The
`/settings/plugins` page should call the authenticated `/api/v1/plugins*`
routes, consume their already-redacted `PluginRecord` database projection, and
enrich only presentation facts from the client-safe capability and
extension-point catalogs. No database migration, external service, remote plugin
source, new dependency, or telemetry pipeline is required.

The one server-side integration gap is request-origin enforcement for the
body-less mutation `POST`s. The repository configures SvelteKit with
`csrf.trustedOrigins: ['*']`, so the implementation should add the scoped
same-origin guard resolved by the feature spec before exposing those mutations
through the UI.

## API Endpoints

### Existing Contract

Authoritative path documentation is in `docs/api/v1/paths/plugins.yaml`; schemas
are in `docs/api/v1/schemas/plugins.yaml`, generated into
`packages/praxrr-app/src/lib/api/v1.d.ts` and mirrored in `packages/praxrr-api`.
The UI must consume this contract unchanged.

| Method and path                                  | Route implementation                                                         | Success contract                                                | Feature-off behavior                                        | Error contract             | UI integration                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/plugins`                            | `packages/praxrr-app/src/routes/api/v1/plugins/+server.ts`                   | `PluginListResponse { pluginsEnabled, items }`                  | `200`, `{ pluginsEnabled:false, items:[] }`                 | `500 PluginErrorResponse`  | Initial load and every authoritative refresh; no per-row detail N+1                                     |
| `GET /api/v1/plugins/{apiVersion}/{id}`          | `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/+server.ts` | `PluginDetailResponse`                                          | `409 plugins_disabled`                                      | `400`, `404`, `409`, `500` | Available but unnecessary for the list/card design because list records are complete                    |
| `POST /api/v1/plugins/{apiVersion}/{id}/enable`  | `.../[apiVersion]/[id]/enable/+server.ts`                                    | `PluginMutationResponse` containing the complete updated record | `409 plugins_disabled` with no mutation                     | `400`, `404`, `409`, `500` | Replace the matching confirmed row only after success; encode both path segments independently          |
| `POST /api/v1/plugins/{apiVersion}/{id}/disable` | `.../[apiVersion]/[id]/disable/+server.ts`                                   | `PluginMutationResponse` containing the complete updated record | `409 plugins_disabled` with no mutation                     | `400`, `404`, `409`, `500` | Same as enable; disabling also updates live dispatch state before returning                             |
| `POST /api/v1/plugins/reload`                    | `packages/praxrr-app/src/routes/api/v1/plugins/reload/+server.ts`            | `PluginReloadResponse` counters                                 | `200` no-op summary with `reloaded:false` and zero counters | `500 PluginErrorResponse`  | Treat reconciliation and subsequent list refresh as two distinct steps; counters do not contain records |

Every route sets `Cache-Control: no-store`. `PluginErrorResponse` is the stable
redacted shape `{ code, error }`, where codes are `invalid_identity`,
`plugins_disabled`, `plugin_not_found`, and `internal_error`.
`packages/praxrr-app/src/lib/server/plugins/responses.ts` maps only explicit
portable fields; `packages/praxrr-app/src/routes/api/v1/plugins/_errors.ts` logs
diagnostics server-side and returns the generic `internal_error`. Browser code
should parse only the contract error or use fixed fallback copy, not display an
unexpected raw response body.

### Identity and Request Construction

Plugin identity is composite: exact `apiVersion` plus case-insensitive `id`
within that namespace. The server does not infer an API version and does not
trim valid persisted identity. Client paths therefore must use:

```ts
const identityPath = `${encodeURIComponent(plugin.manifest.apiVersion)}/${encodeURIComponent(
  plugin.manifest.id
)}`;
```

The UI should use relative URLs and native `fetch`; no API client package is
needed. Same-origin session credentials are automatically included. There is no
request body for enable, disable, or reload, and no OpenAPI regeneration is
needed unless the contract itself changes.

### Mutation-Origin Integration

`packages/praxrr-app/svelte.config.js` sets `kit.csrf.trustedOrigins: ['*']`,
which permits cross-origin form submissions that the framework normally rejects.
Because plugin mutations are body-less `POST`s, they are cross-origin
form-submit-able. The feature spec resolves this with a scoped guard before the
mutation reaches `setPluginEnabled` or `reloadPlugins`:

```ts
function rejectCrossOriginPluginMutation(
  request: Request,
  url: URL
): Response | null;
```

Required behavior:

- no `Origin`: allow, preserving authenticated CLI/API clients;
- parseable `Origin` whose normalized `.origin` exactly equals `url.origin`:
  allow;
- malformed or different `Origin`: return a redacted `403` before any database
  or filesystem work;
- optionally reject `Sec-Fetch-Site: cross-site` as defense in depth;
- do not add CORS response headers or weaken the existing auth hook.

`packages/praxrr-app/src/routes/api/v1/mcp/+server.ts` is the nearest exact
precedent: it compares `new URL(origin).origin` to `url.origin`, rejects
malformed/different origins, and permits absent origins. Extracting a tiny
plugin-local helper avoids duplicating the guard across enable, disable, and
reload while keeping #266 scoped.
`packages/praxrr-app/src/tests/mcp/mcp.test.ts` shows the corresponding
fake-event test shape for same-origin, cross-origin, and absent headers.

## Database Schema and Projection

### Existing `plugin_registry` Table

The table was created by
`packages/praxrr-app/src/lib/server/db/migrations/20260724_create_plugin_registry.ts`.
This feature requires no migration and must not introduce a browser-specific
persisted model.

| Column                 | Constraint/index role                              | Public projection and UI meaning                                                       |
| ---------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `api_version TEXT`     | Non-empty; first part of unique identity           | `manifest.apiVersion`; exact namespace                                                 |
| `plugin_id TEXT`       | Non-empty; `COLLATE NOCASE` in unique identity     | `manifest.id`; case-insensitive lookup, exact authored value returned                  |
| `manifest_json TEXT`   | Validated again when read                          | Projected to allow-listed `manifest` metadata; raw JSON is never returned              |
| `enabled INTEGER`      | `0/1`, default `1`; availability index             | Persisted administrator intent, never proof of activation or execution                 |
| `discovered INTEGER`   | `0/1`, default `1`; availability/tombstone indexes | Present in latest successful reconciliation; false rows remain visible/history-bearing |
| `lifecycle_state TEXT` | Closed seven-state check; lifecycle index          | `state`; lifecycle evidence, not run telemetry                                         |
| `last_error TEXT`      | Nullable                                           | `lastError`; safe lifecycle error, not a run error                                     |
| `registered_at TEXT`   | Default current timestamp                          | RFC 3339 `registeredAt`; not a last-run timestamp                                      |
| `created_at TEXT`      | Default current timestamp                          | RFC 3339 `createdAt`                                                                   |
| `updated_at TEXT`      | Default current timestamp                          | RFC 3339 `updatedAt`; not a last-run timestamp                                         |

Indexes are `idx_plugin_registry_identity` (unique API version plus
case-insensitive plugin ID), `idx_plugin_registry_availability`,
`idx_plugin_registry_lifecycle`, and `idx_plugin_registry_tombstone_retention`.
Missing rows are bounded to 256 newest tombstones.

### Query and Projection Flow

`packages/praxrr-app/src/lib/server/db/queries/pluginRegistry.ts` is the only
database repository needed:

- `list()` returns all durable records, ordered by API version and
  case-insensitive plugin ID;
- `get(apiVersion, pluginId)` performs namespace-qualified parameterized lookup;
- `setEnabled(...)` performs a parameterized update and returns the fresh
  record;
- `reconcile(...)` validates inputs, uses one transaction, preserves existing
  enablement on upsert, marks absent plugins `discovered=0`/`state='unloaded'`,
  and prunes old tombstones.

`packages/praxrr-app/src/lib/server/plugins/responses.ts` then converts
`PluginRegistryRecord` to the generated `PluginRecord` allow-list. It omits
source directories, raw `manifest_json`, database-only names, and arbitrary
properties. The UI consumes this existing database projection exactly; it must
not query SQLite, add a `+page.server.ts` database bypass, or reconstruct
records from the in-memory registry.

## Internal Services

### Plugin Host and Registry

The mutation routes call response/service functions, not database queries
directly:

```text
browser route
  -> SvelteKit auth hook
  -> scoped mutation-origin guard (POST only)
  -> route handler
  -> responses.ts service
  -> PluginHost operation queue
  -> pluginRegistryQueries transaction/update
  -> live PluginRegistry publication
  -> redacted generated response
```

`packages/praxrr-app/src/lib/server/plugins/host.ts` provides the important
concurrency contracts:

- enable/disable and reload are serialized through `operationTail`;
- concurrent reload callers share `reloadInFlight`;
- reload scans and validates before durable reconciliation, then atomically
  replaces the live snapshot;
- enable/disable publishes the committed decision to the live registry before
  returning success;
- a failed reload leaves the previous live registry usable.

The UI should complement, not replace, this authority: one global reload pending
guard, a per-composite-identity mutation guard, server-confirmed row
replacement, and a fresh list after reload. It should not optimistically flip
`enabled`, because a `409`, `404`, or stale response would misrepresent
persisted intent.

### Shared Plugin Catalogs

`packages/praxrr-app/src/lib/shared/plugins/index.ts` is pure and client-safe.
The UI should use:

- `CAPABILITY_CATALOG`/`getCapability` for exact labels, descriptions,
  compatible points, `mutates:false`, and `touchesSecrets:false`;
- `EXTENSION_POINTS`/`getExtensionPoint` for exact `kind`, `wired`, `mutates`,
  API version, interface version, and required capability.

This is presentation enrichment, not API or database enrichment. Manifest arrays
say what was declared/granted; catalogs say what that identifier means and
whether a point is wired. Do not infer facts from ID substrings or duplicate the
catalog in a UI-only constant.

### Execution Telemetry Does Not Exist

There is no run-status, last-run-at, execution-count, per-point outcome,
duration, or runtime-availability field in `PluginRecord`, `plugin_registry`, or
the management endpoints. The executor seam and host dispatch log
runtime-unavailable/failure behavior, but those logs are not a telemetry API and
are not joined into the database projection. `lastError` is lifecycle error
state; `registeredAt` and `updatedAt` are durable-record timestamps.
Consequently, the page must explicitly say execution telemetry is unavailable in
this build and must not infer a run status from lifecycle, enablement,
discovery, timestamps, or logs. Adding telemetry is a separate contract-first
backend feature, outside #266.

### Alerts, Navigation, and Route Shell

- Use the existing `alertStore.add(type, message)` pattern for transient
  success/error feedback, plus persistent inline recovery/status for
  accessibility. No new notification service is needed.
- Add `/settings/plugins` as a child of the Settings entry in
  `packages/praxrr-app/src/lib/server/navigation/registry.ts` and add the
  destination card/link to
  `packages/praxrr-app/src/routes/settings/+page.svelte`.
- Update both identified regression surfaces:
  `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts` for the
  deep link and
  `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts` with a
  meaningful Settings-child assertion.
- Immediate `POST` actions are already durable and leave no unsaved client
  draft, so the dirty store does not integrate with this page.

## Authentication and Session Integration

Plugin routes are not included in `PUBLIC_PATHS` in
`packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`.
`packages/praxrr-app/src/hooks.server.ts` therefore returns `401` for
unauthenticated `/api/*` access, or accepts the existing
session/API-key/auth-bypass modes. The browser page should rely on the
same-origin `HttpOnly`, `SameSite=Lax` session cookie and treat `401` as session
loss, not a plugin-domain error.

There is no role/permission distinction in the current auth model. #266 must not
simulate authorization in the client. `AUTH=off` and local-IP bypass remain
intentional deployment choices; the page and API inherit them. The origin guard
is additive to authentication and must execute before mutation logic, not
instead of auth.

The UI must never read, store, or append the Praxrr API key. Although the auth
middleware supports an `X-Api-Key` header or `apikey` query parameter for
programmatic clients, browser calls need neither.

## Configuration

| Configuration              | Existing source                                                     | Integration behavior                                                                                           |
| -------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PLUGINS_ENABLED`          | `config.pluginsEnabled`, parsed at startup, default off             | Read indirectly through API `pluginsEnabled`; UI explains how to change deployment config but cannot mutate it |
| `PLUGINS_DIR`              | Lazy `config.paths.plugins` getter, default under app base path     | Used only by server reload; never returned to or accepted from browser                                         |
| Auth mode/session settings | Existing auth middleware and session cookie policy                  | Unchanged; page and API remain globally protected according to deployment mode                                 |
| `kit.csrf.trustedOrigins`  | `packages/praxrr-app/svelte.config.js`, currently `['*']`           | Do not rely on framework protection for plugin mutation routes; apply the scoped origin guard                  |
| API/OpenAPI generation     | `docs/api/v1/*`, `generate:api-types`, `packages/praxrr-api` mirror | No generation required if implementation consumes existing contracts unchanged                                 |

There is no plugin marketplace URL, cloud service, analytics endpoint, runtime
download, or remote credential to configure.

## External Services and Dependencies

No external service participates in this feature. Discovery is local filesystem
scanning initiated by the server; persistence is local SQLite; browser
operations are same-origin HTTP. The page must not fetch author links, remote
manifests, marketplace data, runtime packages, or plugin assets.

No new dependency is justified. Native `fetch`, `URL`, `encodeURIComponent`,
generated API types, the shared catalogs, Svelte page-local state, and existing
UI/alert components cover the complete integration. In particular, do not add a
query cache, HTTP SDK, sanitizer/markdown renderer, telemetry client, global
store, or WASM runtime to satisfy #266.

## Integration Failure Semantics

| Failure/state                       | Authoritative signal                               | Required UI response                                                       |
| ----------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| Feature off                         | List `200` with `pluginsEnabled:false`             | Normal disabled guidance; no error and no mutation controls                |
| Enabled but empty                   | `pluginsEnabled:true`, `items:[]`                  | Empty discovery state with Reload                                          |
| Session expired                     | HTTP `401` from global hook                        | Explain authentication/session loss; do not parse as `PluginErrorResponse` |
| Record changed/pruned               | Mutation `404 plugin_not_found`                    | Keep confirmed row, refetch list, explain concurrent change                |
| Flag changed during session         | Mutation `409 plugins_disabled`                    | Refetch and transition to disabled state                                   |
| Internal service failure            | `500 internal_error`                               | Show only redacted contract message/fallback; keep prior confirmed list    |
| Reload succeeds, list refresh fails | Successful counter response followed by failed GET | Report reload committed, retain/stale-mark prior list, offer refresh retry |
| Rejected manifests                  | Reload `rejected` aggregate                        | Show count only; no rejected identities exist in the response              |
| Missing plugin                      | `discovered:false`, usually `state:'unloaded'`     | Retain inspection/intent with “when rediscovered” wording                  |
| Runtime unavailable/no runs         | Absence of telemetry fields                        | State “Execution telemetry unavailable”; do not infer                      |

## Testing and Verification Integration

### Existing Tests to Extend

`packages/praxrr-app/src/tests/routes/plugins.test.ts` already verifies
feature-off semantics, allow-list redaction, RFC 3339 normalization, namespace
isolation, invalid identities, durable mutations, live dispatch disablement,
reload/tombstone intent preservation, redacted failures, `no-store`, and auth
classification. Extend this file or a tightly scoped sibling for the origin
guard with request events containing `request`, `url`, and `params`.

Required server cases:

1. same-origin `Origin` permits enable, disable, and reload;
2. absent `Origin` permits authenticated CLI-style calls;
3. foreign and malformed origins return `403` for all three mutations;
4. rejected requests cause no durable enablement update, scan, or
   reconciliation;
5. GET list/detail behavior remains unchanged and no route adds CORS headers;
6. all responses preserve redacted/no-store behavior as defined.

Required client/presentation cases:

- independently encoded API version and ID path segments;
- exact catalog mapping, including declared vs wired and observe/mutating facts;
- authored HTML-like manifest strings and `lastError` render as text;
- no telemetry inference from `enabled`, `state`, or timestamps;
- per-identity/global pending behavior and stale response suppression;
- list/feature-off/empty/401/404/409/500/reload-success-refresh-failure states;
- navigation registry, Settings hub, and both named navigation regressions.

Run focused route/plugin/navigation/presentation tests first, then
`deno task check`, the full relevant plugin alias, `deno task lint`, and an
applicable Playwright management flow. The current `plugins` alias covers shared
and server plugin suites; confirm explicitly that any new route/presentation
test path is included rather than assuming the alias reaches it.

## Files and Ownership Boundaries

### Create

- `packages/praxrr-app/src/routes/settings/plugins/+page.svelte` — page-local
  I/O and state machine.
- `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`
  — presentation-only card.
- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts` — pure
  URL/catalog/status helpers.
- A plugin-local mutation-origin helper near the API route boundary plus focused
  tests.
- Focused presentation and end-to-end tests using existing test
  locations/conventions.

### Modify

- The three existing mutation routes to call the origin guard before
  service/database work.
- `packages/praxrr-app/src/lib/server/navigation/registry.ts` and
  `packages/praxrr-app/src/routes/settings/+page.svelte`.
- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts` and
  `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`.
- `ROADMAP.md`, using wording that ships management UI but leaves execution
  telemetry/runtime truthfully deferred.

### Do Not Modify for This Feature

- `plugin_registry` migration/schema or database query shape;
- OpenAPI/plugin response schemas solely to invent telemetry;
- executor/runtime or plugin SDK;
- auth modes/session storage/API-key behavior;
- global CSRF configuration without separate deployment/proxy evidence;
- external mirrors or generated API types when the existing contract is
  unchanged.

## Planning Conclusions

1. Implement the page as a consumer of the current generated
   list/mutation/reload contract, not as a new server-rendered database route.
2. Preserve the established boundary: SQLite row -> validated repository record
   -> explicit redacted API projection -> browser. The UI consumes that existing
   database projection and never accesses persistence directly.
3. Add the scoped origin guard to the three mutation routes before any side
   effect, mirroring the MCP same-origin/absent-origin behavior and keeping CLI
   compatibility.
4. Use the server response as authoritative state and refetch after reload; keep
   client concurrency guards to prevent stale rendering while relying on the
   host queue for durable ordering.
5. Display only facts the current integration supplies. No telemetry exists, so
   execution status must be explicitly unavailable rather than inferred or added
   within #266.
6. Keep the feature local and dependency-free: no database migration, external
   service, runtime, global store, or API contract expansion is necessary.
