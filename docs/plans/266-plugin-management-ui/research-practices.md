# Practices Research: 266 Plugin Management UI

## Executive Summary

The smallest maintainable implementation is a `/settings/plugins` route with
page-local request state, one presentation-only plugin component, the generated
OpenAPI response types, and the existing client-safe capability and
extension-point catalogs. The feature does not justify a client store, an API
wrapper framework, a detail request per row, a modal, optimistic state, polling,
or a new dependency.

The main engineering risk is not complexity but truthfulness. The current
contract exposes durable enablement intent, discovery/lifecycle state, and a
lifecycle `lastError`; it exposes no runtime availability, invocation timestamp,
run outcome, duration, or execution error. The shipped executor is still
`UnavailablePluginExecutor`, and dispatch failures are logged rather than
persisted. The UI must therefore label execution telemetry as unavailable and
must not derive a “recent run” from `enabled`, `state`, `registeredAt`,
`updatedAt`, or `lastError`. Completing the recent-run acceptance criterion
requires contract-first backend work, not a presentation heuristic.

## Existing Reusable Code

| Module/Utility                          | Location                                                                                                                                     | Purpose                                                                                                                           | How to Reuse for This Feature                                                                                                                                                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generated plugin schemas                | `packages/praxrr-app/src/lib/api/v1.d.ts`                                                                                                    | Generated `PluginRecord`, `PluginListResponse`, `PluginMutationResponse`, `PluginReloadResponse`, and `PluginErrorResponse` types | Import type aliases from `components['schemas']`; do not copy handwritten wire interfaces into the page.                                                                                                                                                                                    |
| Capability catalog                      | `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts`                                                                                 | Stable ids, human labels, descriptions, compatible points, and the pinned `mutates:false` / `touchesSecrets:false` policy         | Resolve every returned capability with `getCapability()`. Render its existing label and description and use catalog facts for the deny-by-construction explanation.                                                                                                                         |
| Extension-point catalog                 | `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts`                                                                              | Stable ids plus authoritative `kind`, `wired`, `mutates`, and `requiredCapability` metadata                                       | Resolve declarations with `getExtensionPoint()`. This is the only truthful source for “wired” versus “declared, not wired.”                                                                                                                                                                 |
| Plugin response boundary                | `packages/praxrr-app/src/lib/server/plugins/responses.ts`                                                                                    | Explicit allow-list projection and stable error mapping shared by HTTP and MCP                                                    | Consume its public HTTP shapes unchanged. Do not request or reconstruct `sourceDir`, raw manifest JSON, internal diagnostics, or executor state.                                                                                                                                            |
| Plugin management routes                | `packages/praxrr-app/src/routes/api/v1/plugins/**/+server.ts`                                                                                | Authenticated list/get/enable/disable/reload operations, all returned with `Cache-Control: no-store`                              | Use one list request, exact namespace-qualified mutation paths, and reload followed by a list refetch. Detail adds no fields beyond the list and should not be called per card.                                                                                                             |
| Settings hub pattern                    | `packages/praxrr-app/src/routes/settings/+page.svelte`                                                                                       | Data-driven list of Settings destinations with Lucide icons                                                                       | Add a Plugins entry to `settingsItems`; do not create a second settings index component.                                                                                                                                                                                                    |
| Navigation registry                     | `packages/praxrr-app/src/lib/server/navigation/registry.ts`                                                                                  | Canonical sidebar/bottom-navigation model and ordered Settings children                                                           | Add a globally visible `settings.plugins` child under `settings.settings`, because the feature-off explanation must remain reachable.                                                                                                                                                       |
| Navigation regression tests             | `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts` and `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts` | Exact navigation traversal and top-level/scope ordering checks                                                                    | Add `/settings/plugins` to the exact deep-link list. The scope test currently snapshots top-level items only, so a child entry does not change its arrays; add a Settings-child assertion there only if the acceptance requirement intentionally expects a second nav regression assertion. |
| `Card` / `CardGrid` / `CollapsibleCard` | `packages/praxrr-app/src/lib/client/ui/card/`                                                                                                | Existing bordered responsive surfaces and optional in-page disclosure                                                             | Use `Card` or `CollapsibleCard` for plugin details. Keep expansion as presentation state; do not introduce a route-global disclosure store.                                                                                                                                                 |
| `Badge`                                 | `packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`                                                                                   | Existing semantic status variants                                                                                                 | Reuse for independent discovery, enablement-intent, lifecycle, point-wiring, and capability labels. Do not collapse those facts into one badge.                                                                                                                                             |
| `Button`                                | `packages/praxrr-app/src/lib/client/ui/button/Button.svelte`                                                                                 | Existing accessible action styling and disabled state                                                                             | Reuse for reload/retry and, if clearer than a switch, enable/disable actions. Give every action a plugin-specific accessible label.                                                                                                                                                         |
| `Toggle`                                | `packages/praxrr-app/src/lib/client/ui/toggle/Toggle.svelte`                                                                                 | Existing keyboard-operable switch with disabled semantics                                                                         | Reuse only if its immediate `change` event is wired to a server mutation and the value is restored/replaced from the response. It is not a staged form field here.                                                                                                                          |
| Alert store                             | `packages/praxrr-app/src/lib/client/alerts/store.ts` via `$alerts/store`                                                                     | Standard transient success/error/warning feedback                                                                                 | Report mutation and reload outcomes with `alertStore.add`; retain an inline state for initial load failures so retry remains visible.                                                                                                                                                       |
| Job status presentation                 | `packages/praxrr-app/src/routes/settings/jobs/+page.svelte`                                                                                  | Existing badge, timestamp, and last-error presentation language                                                                   | Reuse the visual vocabulary only. Do not reuse its `last_run_*` labels because `PluginRecord` has no equivalent run fields.                                                                                                                                                                 |
| Plugin route tests and alias            | `packages/praxrr-app/src/tests/routes/plugins.test.ts` and `scripts/test.ts`                                                                 | Exhaustive backend behavior and the `deno task test plugins` target                                                               | Keep these as the API regression base. Add UI-focused tests without duplicating the already-covered database and route semantics.                                                                                                                                                           |

`EmptyState.svelte` is not a good direct reuse candidate. It requires a
navigation button and uses a near-full-viewport layout, while both “feature
disabled” and “enabled but no plugins” need compact, distinct, in-page states
and the latter needs an action callback. A route-local inline `Card` is simpler
than widening the shared component for one consumer.

## Modularity Design

### Recommended Module Boundaries

```text
packages/praxrr-app/src/routes/settings/plugins/
├── +page.svelte
├── components/
│   └── PluginCard.svelte
└── presentation.ts          # only if the mappings below are unit-tested

packages/praxrr-app/src/tests/
├── base/navigationShellLayout.test.ts
├── base/navigationScopeFiltering.test.ts   # assertion only if required
└── routes/pluginManagementPresentation.test.ts
```

- `+page.svelte` owns all I/O and route-level state because list, reload,
  feature-off, empty, and request-error states interact. Keeping requests
  together prevents per-card races and makes it easy to disable operations
  during a reload. It should import the generated wire types and pass records
  plus pending flags to the card.
- `PluginCard.svelte` renders one record and emits an enablement request. It
  performs no fetch and holds no authoritative copy of the plugin. This boundary
  is useful because identity, grants, declarations, lifecycle details,
  timestamps, and actions make the markup substantial; it is not an attempt to
  create a generic entity card.
- `presentation.ts` is warranted only for small pure decisions that encode
  contract truth and benefit from direct Deno tests: an exact `(apiVersion,id)`
  pending key, lifecycle badge/label mapping, catalog resolution, and safe
  timestamp formatting. It must import the existing catalogs rather than copy
  them. HTTP orchestration and CSS classes should stay in the page/component.
- No `+page.server.ts` is required solely to call the app's own HTTP route.
  Existing settings panels such as `settings/canary/+page.svelte` load an
  authenticated API on mount, and the page has no additional server-only data.
  If SSR becomes a product requirement, call the server service boundary
  directly; do not make an internal loopback HTTP request.
- No client store is justified. The data has one route consumer, mutations
  return authoritative records, reload invalidates the entire list, and there is
  no execution stream to share or cache.

### Shared vs. Feature-Specific Code

| Component                           | Shared or Feature-Specific                  | Rationale                                                                                                                           |
| ----------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Capability labels and safety facts  | Shared, existing                            | Validator, host, documentation, and UI must agree. `$shared/plugins/capabilities.ts` is already pure and client-safe.               |
| Extension-point wiring/kind facts   | Shared, existing                            | Wiring is a host fact, not manifest-authored UI copy. `$shared/plugins/extensionPoints.ts` is authoritative.                        |
| Wire response types                 | Shared, generated                           | Contract fidelity requires using `$api/v1.d.ts`; a feature-local duplicate would drift.                                             |
| Plugin HTTP client                  | Feature-specific inline functions           | There is only one browser consumer and five simple same-origin endpoints. A generic API client would add indirection without reuse. |
| Plugin card                         | Feature-specific                            | The content and independent status dimensions are plugin-domain-specific; making `EntityManagementCard` would weaken semantics.     |
| Lifecycle/point presentation helper | Feature-specific pure helper                | The mapping is valuable for truthfulness and unit tests, but no other feature currently consumes plugin lifecycle presentation.     |
| Disabled/empty state                | Feature-specific markup using shared `Card` | The copy and actions differ and shared `EmptyState` has the wrong contract.                                                         |
| Runtime/run status                  | Not present; contract work required         | No shared or feature-specific helper can create evidence absent from the server contract.                                           |

## KISS Assessment

| Area              | Current Proposal                                                         | Simpler Alternative                                                                                         | Trade-off                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Data loading      | Create a plugin store/API repository                                     | Keep `pluginsEnabled`, `items`, `loading`, `loadError`, `reloading`, and pending identity in `+page.svelte` | Route state is not shared, so the simpler option avoids invalidation and subscription lifecycle code.                     |
| Detail inspection | List then fetch `GET /plugins/{apiVersion}/{id}` for each row or a modal | Render the complete `PluginRecord` already present in the list, optionally in a collapsible card            | Avoids N+1 reads and modal state; no data is lost because detail returns the same record shape.                           |
| Enable/disable    | Optimistically flip a local boolean and reconcile later                  | Wait for POST success and replace the exact row with `PluginMutationResponse.plugin`                        | Slightly less immediate animation, but timestamps and durable truth cannot go stale or falsely claim success.             |
| Reload            | Patch rows from aggregate counters                                       | POST reload, show the summary, then GET the authoritative list                                              | One additional small request; avoids inventing identities from counts that contain no records.                            |
| Concurrency       | Allow every card and reload to race                                      | One reload guard plus one pending identity (or a small pending-key set), with reload disabling row actions  | Slightly less concurrency, but eliminates stale response overwrites and mirrors the serialized host semantics.            |
| Error handling    | Build a general fetch/error library                                      | One feature-local `readPluginError(response, fallback)` that accepts only a non-empty string `error`        | Some duplication with other pages is acceptable; response-error handling is not yet standardized across three consumers.  |
| Presentation      | Create generic permission, lifecycle, and telemetry component systems    | Use `Badge`, plain lists, and one plugin card                                                               | Keeps plugin-specific vocabulary visible and auditable.                                                                   |
| Empty states      | Generalize `EmptyState.svelte`                                           | Use two small inline cards for disabled versus empty                                                        | Duplicates a little layout but preserves distinct meanings without changing a shared API.                                 |
| Runtime status    | Infer “unavailable” or “ran” from lifecycle fields                       | State that execution telemetry is not exposed; track contract expansion separately                          | Does not satisfy a full dynamic-telemetry requirement by itself, but remains truthful and prevents a false product claim. |
| Dependencies      | Add query/cache, form, or component libraries                            | Browser `fetch`, Svelte state, and existing UI components                                                   | No automatic retries/cache, which are unnecessary for explicit operator actions and `no-store` responses.                 |

## Abstraction vs. Repetition

### Extract (Worth Abstracting)

- **Authoritative plugin identity key:** the page must match mutation responses
  and pending state by both namespace and case-insensitive id. A pure
  `pluginIdentity(recordOrManifest): string` in feature-local `presentation.ts`
  prevents accidental id-only matching and is independently testable. Endpoint
  construction must still use the original exact values.
- **Catalog resolution for presentation:** resolving a returned point/capability
  occurs for every plugin and carries fail-closed behavior. A pure helper may
  return the existing descriptor or an explicit unsupported value; it must never
  manufacture policy metadata.
- **Lifecycle presentation mapping:** the lifecycle enum has seven values and
  the wording must avoid equating `registered` with active or `failed` with a
  recent run. A closed, exhaustively typed helper returning
  label/badge/explanation is worth a test because it encodes a correctness rule,
  not merely formatting.
- **Stable plugin API error parsing:** enable, disable, reload, and list retry
  all need the same safe `PluginErrorResponse` handling. Keep this one function
  route-local unless a third unrelated feature demonstrates the exact same
  stable-error contract.

### Repeat (Acceptable Duplication)

- **Disabled and enabled-empty cards:** two short markup branches are clearer
  than a generalized `PluginPageState` component because their semantics,
  severity, copy, and actions differ.
- **Enable and disable endpoint suffixes:** a simple ternary selecting `enable`
  or `disable` is clearer than a command registry or mutation class.
- **Badge markup for point and capability lists:** these are two domain concepts
  with different descriptors. A generic catalog-badge component would erase
  useful differences before a third use exists.
- **Feature-local fetch calls:** list, mutation, and reload have distinct
  response types and follow-up behavior. A universal typed fetch abstraction is
  not justified by three calls inside one route.

## Interface Design

### Public API Surfaces

Use the generated shapes directly:

```ts
import type { components } from '$api/v1.d.ts';

type PluginRecord = components['schemas']['PluginRecord'];
type PluginListResponse = components['schemas']['PluginListResponse'];
type PluginMutationResponse = components['schemas']['PluginMutationResponse'];
type PluginReloadResponse = components['schemas']['PluginReloadResponse'];
type PluginErrorResponse = components['schemas']['PluginErrorResponse'];
```

The page's useful feature-local functions can remain private:

```ts
async function loadPlugins(): Promise<void>;
async function setEnabled(
  plugin: PluginRecord,
  enabled: boolean
): Promise<void>;
async function reloadPlugins(): Promise<void>;
function replacePlugin(next: PluginRecord): void;
function pluginPath(plugin: PluginRecord, action: 'enable' | 'disable'): string;
```

`pluginPath` must call `encodeURIComponent` independently for both
`plugin.manifest.apiVersion` and `plugin.manifest.id`. Display the exact
authored values; do not trim, lowercase, or infer `PLUGIN_API_VERSION` in the
request path.

`PluginCard.svelte` should have a narrow presentation interface such as:

```ts
export let plugin: PluginRecord;
export let disabled = false;
export let pending = false;
// emit `enabledChange` with the requested boolean; the parent owns I/O
```

The card should not accept a fetch function, URL, store, or mutable response
object. The page should replace a row only from the successful server response.
A failed mutation leaves the previous row unchanged and emits an error alert. A
successful reload always refetches because its response is only aggregate
counts.

Immediate mutations mean there is no unsaved state and therefore no dirty-store
integration. Adding dirty tracking around an in-flight request would falsely
tell the operator that a local edit exists; the correct affordance is a
disabled/pending control.

### Extension Points

- Future point or capability ids enter through the versioned OpenAPI contract
  and shared catalogs. Exhaustive helper tests should fail when the lifecycle
  union changes, while unknown runtime values should render as unsupported and
  disable mutation rather than silently gaining semantics.
- A future detail route can reuse `PluginCard` or its pure presentation helpers,
  but it should be added only when detail obtains data not present in the list.
- A future telemetry contract should add explicit runtime availability and
  invocation facts to the OpenAPI source, regenerate both API artifacts,
  persist/serve those facts, and then add a dedicated run-status presentation
  block. The current card should reserve no fake fields and perform no polling
  until such a contract exists.
- Plugins are globally scoped today. Do not add an `arr_type` extension point or
  infer Radarr, Sonarr, or Lidarr compatibility from point names. Any future Arr
  scope must be explicit and contract-validated per Arr.

## Testability Patterns

### Recommended Patterns

- **Pure presentation tests:** test identity matching across API versions and id
  casing, lifecycle labels, wired-versus-declared resolution, capability catalog
  labels, and invalid/unknown defensive behavior without mounting Svelte. This
  follows the existing repository pattern of testing pure UI decisions such as
  `lib/client/ui/*/*Status.ts` and other helper modules with Deno.
- **Contract-type reuse:** construct fixtures with `satisfies PluginRecord` so
  generated contract changes break tests at compile time rather than leaving
  hand-written fixture shapes stale.
- **Source-authoritative mutations:** test that an enable/disable success
  replaces the complete row returned by the server (including `updatedAt`) and
  that failure retains the original. If request orchestration remains
  inseparable from the Svelte page, cover it with a focused Playwright route
  interception test instead of building a custom component-test harness.
- **Deterministic browser interception:** a focused E2E spec can intercept
  `/api/v1/plugins*` and verify feature-off, enabled-empty, populated, mutation
  success/error, reload/refetch, and accessible labels without needing a real
  plugin filesystem or unavailable WASM runtime.
- **Existing backend suite:** retain `deno task test plugins` as evidence for
  feature-off semantics, namespace identity, persistence, reload, and redaction.
  UI tests should not duplicate those database cases.
- **Navigation regression:** update `navigationShellLayout.test.ts`'s exact
  deep-link list. Verify the actual current behavior before claiming two
  snapshots changed: `navigationScopeFiltering.test.ts` snapshots top-level
  traversal, so a Settings child currently leaves its arrays unchanged.
- **Manual truthfulness check:** with `PLUGINS_ENABLED=false`, confirm an
  explanatory state rather than an error. With an enabled fixture, confirm
  separate labels for enabled intent, discovery, lifecycle, wired declarations,
  grants, and “execution telemetry unavailable.”

Suggested focused validation:

```bash
deno task check
deno task test plugins
deno test packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts \
  packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts \
  packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts \
  --allow-read --allow-env
deno task test:e2e
```

### Anti-patterns to Avoid

- **Optimistic toggles:** they briefly state durable intent that the server may
  reject and make rollback/error races harder to reason about.
- **Id-only row keys:** the registry namespace is `(apiVersion,id)`. Id-only
  keys can update the wrong row after a future API-version transition.
- **Per-card fetching:** detail returns no additional data and creates N+1
  requests and independent loading/error states.
- **Polling lifecycle fields:** no returned field is invocation telemetry, so
  polling only repeats the same non-evidence and wastes work.
- **String-prefix permission logic:** `read:` is not the policy boundary. Use
  the closed catalog's explicit metadata.
- **Treating null error as success:** `lastError:null` means no persisted
  lifecycle error, not that an invocation succeeded.
- **Using `state:'registered'` or `enabled:true` as “active”:** both are
  management/discovery facts, and the architecture explicitly reserves
  activation for a future runtime.
- **Rendering authored values as HTML:** names, descriptions, authors, ids, and
  safe error strings are still untrusted text. Use normal Svelte interpolation,
  never `{@html}` or `innerHTML`.
- **Dirty tracking for immediate actions:** there is no staged edit to protect.
  Use in-flight guards and authoritative responses.
- **A generic plugin SDK in the browser:** the management page consumes an
  internal same-origin API; it does not need the future plugin authoring SDK
  from issue #265.

## Build vs. Depend

| Need                          | Build Custom                                       | Use Library                                             | Recommendation                         | Rationale                                                                              |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| HTTP requests                 | Three small typed functions around browser `fetch` | Query/cache client or generated runtime SDK             | Build tiny feature-local functions     | Responses are `no-store`, actions are explicit, and no cross-route cache exists.       |
| API types                     | Handwritten interfaces                             | Existing generated `$api/v1.d.ts`                       | Use existing generated types           | This is the required contract-fidelity path and costs no dependency.                   |
| Human permission descriptions | Recreate labels in the component                   | Existing capability catalog                             | Use existing catalog                   | It already drives validator/host policy and prevents UI drift.                         |
| Wired/declaration status      | Infer from suffixes or hardcode two ids            | Existing extension-point catalog                        | Use existing catalog                   | `wired`, `kind`, `mutates`, and required grant are already authoritative.              |
| Cards, badges, controls       | New design system or external component kit        | Existing `$ui` components                               | Use existing components                | Styling, dark mode, keyboard behavior, and variants already exist.                     |
| Dates                         | Add a date library                                 | Native `Date` or existing `$shared/utils/dates` helpers | Reuse existing/native code             | The page needs only safe display of RFC 3339 timestamps, not timezone arithmetic.      |
| Component tests               | Add a Svelte test framework                        | Deno pure-helper tests plus existing Playwright         | Use existing test stack                | The correctness-heavy logic is pure; browser flows can use current E2E infrastructure. |
| Runtime telemetry             | Fabricate client state or scrape logs              | Contract-first backend fields/endpoints                 | Build backend contract work separately | Only the host/runtime can produce authoritative invocation evidence.                   |
| Sanitization                  | Add an HTML sanitizer                              | Svelte text interpolation                               | Use normal interpolation               | No rich HTML is required; escaping at render is safer and simpler.                     |

No new production or development dependency is warranted for #266's UI.

## Telemetry Truthfulness

The UI can prove only what `PluginRecord` actually returns:

| Field           | Truthful UI meaning                                          | Prohibited inference                                                                                             |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `enabled`       | Persisted administrator enablement intent                    | Active, loaded, running, healthy, or successfully executed                                                       |
| `discovered`    | Present in the latest successful accepted reconciliation     | Executable or runtime-ready                                                                                      |
| `state`         | Last persisted discovery/lifecycle state                     | Recent invocation outcome; current code normally persists `registered`/`unloaded` and reserves activation states |
| `registeredAt`  | Registration timestamp                                       | Last run time                                                                                                    |
| `updatedAt`     | Durable row update time, including enablement/reconciliation | Last execution time                                                                                              |
| `lastError`     | Safe last lifecycle error when one was persisted             | Last run error, runtime health, or successful execution when null                                                |
| Manifest point  | Plugin declaration                                           | Host wiring or invocation                                                                                        |
| Catalog `wired` | A real producer calls the host seam                          | A runtime accepted or completed the call                                                                         |

`PluginHost.dispatchOne()` currently catches runtime-unavailable and execution
errors, logs them, and does not update `plugin_registry`.
`UnavailablePluginExecutor` remains the production default. Thus a static notice
such as “Plugin management is available; this build does not expose execution
telemetry” is accurate, while a dynamic “runtime unavailable” badge is not
server-authoritative unless the contract gains a runtime-availability field.

If the acceptance criterion requires actual recent runs, the minimum truthful
contract should expose explicit facts such as runtime availability and a
nullable invocation record containing point, started/finished time, outcome, and
a redacted error. That change must begin in `docs/api/v1/schemas/plugins.yaml`,
flow through generated types and the allow-list mapper, and be backed by durable
or otherwise authoritative host state. It should not be simulated in the UI or
stored only in browser memory.

## Open Questions

1. Does #266 require dynamic recent invocation evidence now? If yes, a
   backend/OpenAPI child issue is a prerequisite; the current API cannot satisfy
   it.
2. Should enable/disable remain available for `discovered:false` retained rows?
   The API permits it and persistence is meaningful for reappearance, but the
   card must say it changes future intent only.
3. Should the page use switches or explicit Enable/Disable buttons? Both can
   reuse existing UI, but a button more naturally communicates an immediate
   request; a switch needs careful pending/error restoration.
4. The issue says to update two hard-coded nav snapshots, but current source
   shows only `navigationShellLayout.test.ts` snapshots Settings child deep
   links; `navigationScopeFiltering.test.ts` snapshots top-level order. Should
   the latter gain a new explicit Settings-child assertion, or is one changed
   snapshot plus the unchanged scope test the intended evidence?
5. Should a global reload block every row mutation or only prevent a second
   reload? Blocking all row actions is the simplest stale-response defense and
   aligns with serialized server operations.
6. Security research identified a separate origin/CSRF concern because mutation
   POSTs have no body and the project config currently trusts broad origins.
   Should that be fixed in this feature or a dedicated security child issue? The
   UI should at minimum use same-origin relative URLs, but client code cannot
   enforce the server origin policy.
