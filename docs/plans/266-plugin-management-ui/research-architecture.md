# Architecture Research: 266 Plugin Management UI

## System Overview

Praxrr is a Deno/SvelteKit monorepo whose authenticated application shell, API
routes, server services, and Svelte pages live in `packages/praxrr-app`. The
plugin management backend is already present on this worktree: generated OpenAPI
types define the public contract, thin `/api/v1/plugins` route handlers call a
redacted service boundary, and `PluginHost` serializes durable enablement and
reload operations against the SQLite registry and live in-memory snapshot.

Issue #266 should remain a UI/integration layer over that backend. A new
client-owned Settings page should perform relative same-origin requests, keep
explicit server-authoritative state, and delegate record rendering to a
presentation-only card. The only server behavior added should be a scoped Origin
guard shared by the three unsafe plugin POST handlers; no database migration,
host runtime, new endpoint, or global CSRF configuration change is needed.

## Worktree Reality

- Worktree:
  `/home/yandy/Projects/github.com/yandy-r/praxrr/.claude/worktrees/266-plugin-management-ui`
- Branch: `feat/266-plugin-management-ui`
- Current HEAD: `04d736ad docs(roadmap): mark plugin registry shipped`
- The immediately preceding `a3ae20fb feat(plugins): add durable registry API`
  already supplies the management endpoints, generated types, durable
  query/service layer, and route tests that this UI consumes.
- There is no `settings/plugins` route or management UI yet. At research time,
  the only worktree changes are untracked planning artifacts under
  `docs/plans/266-plugin-management-ui/`; planners and implementors must not
  mistake those artifacts for shipped source.
- `graphify-out/` is absent in this feature worktree, so architecture findings
  were verified against the source tree directly. After implementation, the
  repository instruction to run `graphify update .` applies if graphify output
  is available in the implementation environment.

## Relevant Components

### Existing API and server flow

- `packages/praxrr-app/src/routes/api/v1/plugins/+server.ts`: authenticated,
  no-store list edge. Calls `listPlugins()` and exposes the feature-off response
  as `{ pluginsEnabled: false, items: [] }`.
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/+server.ts`:
  existing exact-detail edge. The proposed page does not need this endpoint
  because list records already contain the full public plugin representation;
  avoiding it prevents an N+1 flow.
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts`:
  validates both route segments and persists enabled intent through
  `setPluginEnabled()`.
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/disable/+server.ts`:
  symmetric durable disable-intent edge.
- `packages/praxrr-app/src/routes/api/v1/plugins/reload/+server.ts`: invokes the
  host's serialized scan/reconciliation and returns aggregate counters, not
  replacement records.
- `packages/praxrr-app/src/routes/api/v1/plugins/_errors.ts`: existing safe
  internal-error mapping. The Origin guard should likewise return a stable
  redacted response and never echo the submitted Origin.
- `packages/praxrr-app/src/lib/server/plugins/responses.ts`: the public
  service/projection boundary. It explicitly allow-lists manifest and durable
  fields, distinguishes disabled/not-found/error outcomes, and imports generated
  response types from `$api/v1.d.ts`.
- `packages/praxrr-app/src/lib/server/plugins/host.ts`: the mutation
  orchestrator. `reload()` is single-flight; reload and `setPluginEnabled()`
  share `operationTail`, so durable reconciliation, live snapshot publication,
  and intent changes are serialized. The page should not reproduce or
  second-guess this queue.
- `packages/praxrr-app/src/lib/server/db/queries/pluginRegistry.ts`: existing
  durable registry storage. Identity is API-version-qualified and plugin IDs are
  case-insensitive. No schema or query addition is required for #266.
- `packages/praxrr-app/src/hooks.server.ts`: initializes the plugin host when
  enabled and provides the central authentication boundary for the non-public
  `/api/v1/plugins` routes.
- `packages/praxrr-app/svelte.config.js`: currently configures
  `kit.csrf.trustedOrigins: ['*']`. That broad deployment-sensitive setting is
  why browser-facing, body-less plugin POST routes need their own same-origin
  check, but #266 should not alter the global setting without proxy/deployment
  validation.

### Shared and generated contracts

- `packages/praxrr-app/src/lib/api/v1.d.ts`: generated definitions for
  `PluginRecord`, `PluginListResponse`, `PluginMutationResponse`,
  `PluginReloadResponse`, lifecycle states, extension points, capabilities, and
  stable plugin errors. UI code should derive aliases directly from
  `components['schemas']` rather than recreate wire interfaces.
- `packages/praxrr-app/src/lib/shared/plugins/index.ts`: client-safe barrel for
  the pure plugin contract.
- `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts`: authoritative
  capability label, description, compatible-point, non-mutating, and no-secret
  metadata in `CAPABILITY_CATALOG`.
- `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts`: authoritative
  point kind, interface version, wiring, mutation, and required-capability
  metadata in `EXTENSION_POINTS`. Presentation must use this catalog rather than
  infer wiring from a record's declarations.

### New UI boundary

- `packages/praxrr-app/src/routes/settings/plugins/+page.svelte` (new): owns
  initial list loading, confirmed records, feature-off/empty/error/stale states,
  per-identity pending operations, reload status, request-generation protection,
  alerts, and live-region messages. It should use `onMount` and page-local
  variables; there is no need for `+page.server.ts`, a shared store, or the
  dirty navigation store.
- `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`
  (new): receives one already-typed record plus pending/action inputs and emits
  or invokes enable/disable intent. It is a presentation component, not an API
  client. Its disclosure presents identity, discovery, enablement intent,
  lifecycle, extension-point wiring, grants, timestamps, lifecycle error, and
  the explicit lack of execution telemetry as independent facts.
- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts` (new): pure
  helpers for composite identity, independently encoded mutation URLs, lifecycle
  labels, missing-record action wording, capability descriptors, and
  declared-point descriptors. Correctness-heavy mapping belongs here so it can
  be exhaustively unit tested without mounting Svelte.
- Existing `$ui` primitives such as `Button.svelte`, `Badge.svelte`,
  `Card.svelte`, and optionally a disclosure primitive can provide visual
  consistency. The component must still follow the project rule of Svelte 5
  without runes and use native controls with `onclick` handlers for new code.
- `packages/praxrr-app/src/lib/client/alerts/store.ts`: existing transient
  success/error feedback. Alerts should supplement, not replace, persistent
  inline errors and `aria-live` status.

### Navigation and test surfaces

- `packages/praxrr-app/src/lib/server/navigation/registry.ts`:
  `settings.settings` is the globally visible Settings parent. Add a
  `settings.plugins` child with `/settings/plugins` and a stable order; it
  should not be hidden when `PLUGINS_ENABLED` is false because the destination
  explains that deployment state.
- `packages/praxrr-app/src/routes/settings/+page.svelte`: add the Plugins
  destination to the Settings hub list using the existing icon/description row
  structure.
- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts`: add
  `/settings/plugins` to the exact deep-link sequence. Top-level hrefs do not
  change.
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`: add a
  targeted assertion that the Settings parent resolves a globally visible
  Plugins child for all Arr scopes. Do not perturb unrelated top-level ordering
  snapshots merely to mention the route.
- `packages/praxrr-app/src/tests/routes/plugins.test.ts`: extend the existing
  migrated database-backed route suite for Origin behavior and no-mutation
  guarantees.
- `packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts`
  (new): unit-test pure identity, URL, wording, lifecycle, extension-point, and
  capability mapping.
- `packages/praxrr-app/src/tests/e2e/specs/` and root `playwright.config.ts`:
  add a focused mocked API browser spec alongside existing Playwright specs. The
  suite runs serially with the application at `BASE_URL`/port 6969 and supports
  intercepting API routes for deterministic UI states.

## Data Flow

### Initial read and rendering

```text
authenticated app shell
  -> /settings/plugins/+page.svelte mounts
  -> GET /api/v1/plugins (relative URL)
  -> routes/api/v1/plugins/+server.ts
  -> lib/server/plugins/responses.ts:listPlugins
  -> pluginRegistryQueries.list()
  -> explicit allow-listed PluginListResponse, Cache-Control: no-store
  -> page replaces its confirmed list state
  -> PluginCard renders each record using shared catalogs
```

The page should model at least these distinct states: initial loading, load
failure with retry, feature disabled, enabled but empty, populated, and
populated-but-stale after a failed refresh. A failed refresh must not discard
the last confirmed list. Authored manifest strings and `lastError` flow only
through ordinary Svelte text interpolation; no `{@html}` or browser persistence
belongs in this path.

### Enable/disable intent

```text
PluginCard action for {apiVersion, id}
  -> page derives a canonical case-insensitive composite pending key
  -> POST /api/v1/plugins/{encode(apiVersion)}/{encode(id)}/enable|disable
  -> scoped Origin guard (before any service call)
  -> route identity validation
  -> responses.ts:setPluginEnabled
  -> PluginHost operationTail
  -> pluginRegistryQueries.setEnabled + live registry update
  -> complete PluginMutationResponse record
  -> page replaces only the matching complete confirmed record
```

The action is pessimistic: keep the confirmed `enabled` value visible while
pending and disable only the affected identity. The identity helper must include
exact `apiVersion` and lower-case only `id` for matching; each raw segment is
encoded separately for the URL. A 404 means the record changed or was pruned and
should trigger an authoritative list refetch. A 409 means the deployment flag
changed and should refetch into the feature-off view. Other failures retain the
record and expose retryable inline status plus an alert.

### Reload and authoritative refresh

```text
page Reload action
  -> POST /api/v1/plugins/reload
  -> scoped Origin guard
  -> responses.ts:reloadPlugins
  -> PluginHost single-flight reload + serialized reconciliation
  -> PluginReloadResponse counters
  -> page reports committed reconciliation summary
  -> GET /api/v1/plugins
  -> page replaces records only after successful refetch
```

Reload is deliberately two-stage because its response has counters but no
records. If reconciliation succeeds and the list refetch fails, the page must
retain the old rows, mark them stale, and state that reload committed but
refresh failed; it must not relabel the reload itself as failed. A monotonically
increasing request generation (and optionally an `AbortController`) should
prevent an older list response from overwriting a newer post-mutation/reload
response. A global reload pending flag and per-identity mutation keys prevent
duplicate UI submissions while the server remains the ultimate serialization
authority.

### Scoped mutation-origin guard

Create a feature-local pure helper, preferably adjacent to the route family (for
example `packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts`), with the
spec-defined boundary:

```ts
rejectCrossOriginPluginMutation(request: Request, url: URL): Response | null
```

Apply it as the first branch in enable, disable, and reload `POST` handlers,
before identity checks, feature checks, host calls, filesystem scanning, or
durable writes:

1. No `Origin` header: return `null` so authenticated CLI/API-key clients
   continue to work.
2. Present but malformed `Origin`: return a stable redacted 403 response.
3. Parsed `new URL(origin).origin !== url.origin`: return the same 403 response.
4. Exact same origin: return `null` and continue through the existing handler.
5. `Sec-Fetch-Site: cross-site` may be rejected as defense in depth, but it must
   not replace Origin parsing or reject legitimate non-browser clients solely
   because fetch metadata is absent.

This is a route-family defense, not CORS. GET handlers remain unchanged,
authentication remains in `hooks.server.ts`, and `trustedOrigins: ['*']` remains
unchanged. The existing MCP route has a similar inline
absent/same/foreign-Origin policy at
`packages/praxrr-app/src/routes/api/v1/mcp/+server.ts`; its behavior is useful
precedent, but plugin routes should share one helper to prevent drift across
three mutation edges.

## Component Relationships and State Ownership

| Owner               | Owns                                                                                                    | Must not own                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `+page.svelte`      | Fetch orchestration, confirmed list, request generations, pending keys, stale/error/live status, alerts | Plugin host logic, durable optimistic state, global stores |
| `PluginCard.svelte` | Accessible disclosure and independent fact/action presentation                                          | Fetch calls, record persistence, catalog policy            |
| `presentation.ts`   | Pure identity/URL/label/catalog mapping                                                                 | Mutable state, network access, Svelte lifecycle            |
| plugin API routes   | HTTP validation, Origin rejection, status/response mapping                                              | UI wording or state                                        |
| `responses.ts`      | Generated public projection and domain outcomes                                                         | Browser concerns                                           |
| `PluginHost`        | Serialized scan, durable enablement, live snapshot publication                                          | UI state or inferred execution telemetry                   |
| shared catalogs     | Capability safety and extension-point wiring facts                                                      | Per-plugin durable state                                   |

The card should receive catalog-backed view data or call pure presentation
helpers; it should never reclassify `enabled`, `discovered`, `state`, or
`lastError`. In particular, `enabled` is durable intent, `discovered` is latest
reconciliation presence, `state`/`lastError` are lifecycle evidence, and none of
them supplies a run count, last-run timestamp, or runtime-ready proof. The fixed
statement “Execution telemetry unavailable in this build” is therefore an
architectural contract, not merely empty-state copy.

## Integration Points

1. **Generated contract consumption**: type the page and helpers from
   `$api/v1.d.ts`. Do not edit the OpenAPI schema or regenerate types unless
   implementation discovers an actual contract mismatch; #266 is designed around
   the already generated fields.
2. **Catalog consumption**: import `CAPABILITY_CATALOG` and `EXTENSION_POINTS`
   through `$shared/plugins`. Preserve their stable order when showing declared
   grants/points, and fail visibly rather than inventing metadata if a
   supposedly closed ID is absent.
3. **Authentication**: rely on the existing non-public route policy in
   `$auth/middleware.ts` and `hooks.server.ts`. The page uses relative URLs and
   adds no CORS or token mechanism.
4. **Settings discovery**: update both the server navigation registry and the
   Settings landing page. The route remains discoverable while plugins are
   disabled.
5. **Feedback**: use `alertStore` for transient success/error notification and
   page-local inline state for recovery. Use `aria-busy` on the affected
   page/card region and a polite, atomic live status for routine completion.
6. **Roadmap**: update `ROADMAP.md` only during implementation to say management
   UI shipped while keeping runtime execution and telemetry deferred. Current
   HEAD already marks the registry API; wording must not conflate it with this
   UI.

## Test Integration

- **Presentation unit tests**: cover composite identity collision resistance,
  independent URL segment encoding, case-insensitive ID matching with
  API-version separation, every lifecycle state, missing record/future-intent
  wording, and exhaustive mappings for every shared capability and extension
  point. Assert wired and declared are separate facts and that telemetry remains
  unavailable.
- **Route security tests**: evolve route event builders in
  `src/tests/routes/plugins.test.ts` to supply real `Request` and `URL` inputs.
  For enable, disable, and reload, cover same-origin pass, absent-Origin CLI
  pass, foreign-Origin 403, malformed-Origin 403, and (if implemented) explicit
  cross-site fetch metadata. Negative cases must assert the durable enabled
  value, scan/reconcile call count, and/or registry snapshot did not change.
- **Existing API regression tests**: retain feature-off semantics, no-store
  headers, exact namespace, case-insensitive ID lookup, allow-listed redaction,
  serialized live updates, and reload retention.
- **Navigation tests**: update the exact deep-link snapshot in
  `navigationShellLayout.test.ts`; add a meaningful `settings.plugins` child
  assertion in `navigationScopeFiltering.test.ts` across `all`, `radarr`,
  `sonarr`, and `lidarr`. Leave top-level and bottom-nav arrays unchanged.
- **Playwright UI spec**: intercept list/mutation/reload APIs to cover loading,
  feature-off, empty, populated, mutation success/failure, 404/409 refetch,
  committed-reload/failed-refetch stale state, and request ordering. Include
  keyboard disclosure/action use, a 320 CSS-pixel viewport reflow check, stable
  accessible names, live-status behavior, and hostile manifest/error strings
  proving escaped text rather than injected DOM.
- **Validation**: run the focused Deno presentation, plugin route, and
  navigation tests first, then repository `deno task check`, `deno task lint`,
  and `deno task test`. Run the focused Playwright spec against the repository's
  E2E launcher/server setup; do not require a live plugin directory when API
  interception is sufficient for deterministic UI coverage.

## Key Dependencies

- SvelteKit/Svelte 5 for routing, `onMount`, relative `fetch`, and escaped text
  rendering.
- Deno 2.x and the existing Deno test harness for pure and route tests.
- Generated OpenAPI types at `$api/v1.d.ts` for wire-contract fidelity.
- `$shared/plugins` catalogs for authoritative capability and extension-point
  semantics.
- Existing `$ui` primitives, `lucide-svelte`, and `$alerts/store`; no new
  UI/state/fetch dependency.
- Existing SQLite/Kysely plugin registry and `PluginHost` serialized operation
  queue; no migration.
- Playwright through the root `playwright.config.ts` for browser-level
  integration and accessibility behavior.

## Architectural Constraints and Risks

- Do not infer active/running/recent execution from durable intent or lifecycle
  fields; the contract has no invocation telemetry.
- Do not hide retained `discovered: false` rows or disable their intent action.
  Their action wording must say the intent applies when rediscovered.
- Do not optimistically flip `enabled`; only a successful mutation response
  replaces confirmed state.
- Do not discard confirmed rows during pending work or on recoverable errors.
- Do not derive point wiring or grant safety from names; shared catalogs are the
  source of truth.
- Do not place API calls inside each card, which would fragment concurrency and
  stale-response control.
- Do not broaden the Origin guard to unrelated routes or change global
  proxy-sensitive CSRF policy in this feature.
- Do not add `{@html}`, local/session storage, polling, detail N+1 calls,
  pagination, query caching, or the dirty store for this bounded
  immediate-persistence workflow.
