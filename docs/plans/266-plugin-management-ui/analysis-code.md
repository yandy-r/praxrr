# Code Analysis: 266 Plugin Management UI

## Executive Summary

The implementation should be a thin, client-owned `/settings/plugins` route over
the existing generated plugin management API. Keep correctness-heavy mapping and
URL construction in a pure `presentation.ts`, keep the card presentation-only,
and keep all request sequencing in `+page.svelte`; the server remains
authoritative through `responses.ts`, `PluginHost`, and `pluginRegistryQueries`.
The only new server behavior is a reusable route-local Origin guard applied
before the three mutation handlers perform side effects.

The highest-risk code details are semantic, not algorithmic: `enabled` is
persisted intent rather than runtime activation; `lastError` is lifecycle
evidence rather than a run error; no execution telemetry exists; retained
`discovered:false` records remain actionable; reload returns counters rather
than records; and all manifest-authored strings must remain ordinary escaped
Svelte text.

## Existing Code Structure

### Browser and Presentation Boundary

- `packages/praxrr-app/src/routes/settings/plugins/+page.svelte` does not yet
  exist. It should own list loading, feature-off/empty/populated/error/stale
  states, per-plugin pending state, reload pending state, request generations,
  alerts, and the reload-then-refetch sequence.
- `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`
  should receive a generated `PluginRecord` plus already-derived presentation
  facts and dispatch action intent upward. It must not fetch, mutate the record,
  import server modules, or infer runtime status.
- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts` should be
  pure and browser/server test-safe: composite identity keys, independently
  encoded mutation URLs, lifecycle labels/variants, capability views,
  extension-point views, and missing/enablement wording.
- `packages/praxrr-app/src/lib/api/v1.d.ts` supplies the wire types:
  `PluginRecord`, `PluginListResponse`, `PluginMutationResponse`,
  `PluginReloadResponse`, and `PluginErrorResponse`. Do not hand-copy these
  interfaces into the route.
- `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts` and
  `extensionPoints.ts` are pure catalogs. They are the only source of capability
  labels/safety facts and declared-point wiring/kind facts.

### HTTP, Service, and Persistence Boundary

- The list route calls `listPlugins()` and returns the existing redacted
  projection with `no-store`.
- Enable/disable routes validate non-empty path params, call
  `setPluginEnabled(...)`, translate disabled/not found/internal outcomes, and
  return the complete updated `PluginRecord`.
- Reload calls `reloadPlugins()` and returns only aggregate counters. It does
  not return the new registry list.
- `packages/praxrr-app/src/lib/server/plugins/responses.ts` is the public
  allow-list boundary. It copies only generated portable fields and deliberately
  excludes source directories and raw database/manifest fields.
- `packages/praxrr-app/src/lib/server/plugins/host.ts` serializes reload and
  enablement through `operationTail`, coalesces concurrent reloads with
  `reloadInFlight`, commits enablement before publishing it to the live
  registry, and publishes reload snapshots only after successful reconciliation.
- `packages/praxrr-app/src/lib/server/db/queries/pluginRegistry.ts` owns
  composite identity, parameterized SQL, transactionally reconciled discovery,
  enablement retention, and tombstone pruning. The UI needs no migration,
  page-server database loader, or new repository method.

### Navigation and Documentation Boundary

- `packages/praxrr-app/src/lib/server/navigation/registry.ts` has a single
  `settings.settings` parent whose children are built with `buildChild(...)` and
  stable integer order.
- `packages/praxrr-app/src/routes/settings/+page.svelte` separately owns the
  Settings landing list. Adding only the nav registry entry will not add the
  page tile.
- `docs/api/v1/paths/plugins.yaml` is the path-level source of truth. The new
  `403 PluginErrorResponse` behavior for enable, disable, and reload must be
  documented there. The schema file can remain unchanged.
- `ROADMAP.md` has multiple plugin/runtime statements; update the UI status
  without changing the runtime NO-GO or claiming execution telemetry.

## Implementation Patterns

### 1. Page-Local Latest-Request-Wins State

`packages/praxrr-app/src/routes/drift/+page.svelte` demonstrates a monotonically
increasing request ID:

```ts
const requestId = ++summaryRequestId;
const response = await fetch(url);
if (requestId !== summaryRequestId) return;
// parse and apply
if (requestId === summaryRequestId) loading = false;
```

Use the same shape for plugin list loads. A newer explicit refresh or
post-reload refresh must invalidate an older response before the older response
can replace `items`, `pluginsEnabled`, error, or stale state. Keep the
request-generation check after both `fetch` and `response.json()` because either
can settle late.

Suggested page state is explicit rather than one overloaded boolean:

```ts
let items: PluginRecord[] = [];
let pluginsEnabled: boolean | null = null;
let loading = true;
let loadError: string | null = null;
let staleReason: string | null = null;
let listRequestId = 0;
let reloadPending = false;
let pendingIdentities = new Set<string>();
```

Because Svelte assignment drives reactivity, update `Set` immutably (create a
new set and reassign) rather than mutating it in place and expecting markup to
react.

### 2. Pessimistic, Server-Authoritative Mutations

The drift/canary settings pages use a pending guard, parse a response, hydrate
from server state, alert, and clear pending in `finally`. For plugins, keep the
confirmed `record.enabled` visible while pending; do not optimistically flip it.
On `200`, replace the complete matching record from
`PluginMutationResponse.plugin`. On `404`, refetch because the durable row may
have been pruned. On `409`, refetch and allow the page to transition to the
normal feature-off state.

Key records with a collision-safe composite identity rather than `id` alone. A
helper such as `pluginIdentityKey(apiVersion, id)` should normalize the ID
consistently with backend case-insensitive identity and retain the exact
API-version namespace. The user-facing ID remains the exact persisted value.

### 3. Two-Stage Reload

The reload response is only:

```ts
{
  (pluginsEnabled, reloaded, discovered, registered, rejected, missing);
}
```

Therefore the correct sequence is
`POST reload -> retain/report counters -> GET list`. Do not treat the reload
response as list state. If POST succeeds and GET fails, report that
reconciliation succeeded, keep the prior items, mark them stale, and provide a
refresh retry. Do not rewrite this as “reload failed.”

The backend already serializes operations and single-flights reloads, but the
page still needs a global reload guard to prevent duplicate UX and stale
response application. Either disable all mutations during reload or use a shared
page operation generation so a row mutation response cannot overwrite a later
reload/refetch.

### 4. Pure Presentation Helpers

`packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`
demonstrates route-adjacent pure helpers with exported types/functions and
direct Deno tests. Follow that boundary rather than placing catalog logic inside
Svelte markup.

Recommended pure outputs:

```ts
type CapabilityView = {
  id: PluginCapabilityId;
  label: string;
  description: string;
  observeOnly: true;
  touchesSecrets: false;
};

type ExtensionPointView = {
  id: PluginExtensionPointId;
  kind: ExtensionPointKind;
  wired: boolean;
  mutates: boolean;
};
```

Build these via `getCapability` and `getExtensionPoint`. Fail closed if
generated wire values and the catalog somehow drift; do not generate labels by
splitting IDs. Tests should enumerate every current capability/point and prove
wired-vs-declared and mutating-vs-observe language.

### 5. Independent Path-Segment Encoding

The mutation URL helper must encode components, not a completed path:

```ts
export function pluginMutationUrl(
  plugin: PluginRecord,
  action: 'enable' | 'disable'
): string {
  const version = encodeURIComponent(plugin.manifest.apiVersion);
  const id = encodeURIComponent(plugin.manifest.id);
  return `/api/v1/plugins/${version}/${id}/${action}`;
}
```

Unit tests should use delimiter-bearing synthetic values even though the current
manifest validator is stricter; the helper contract must remain correct if
grammar expands. Do not use `encodeURI` on the completed string.

### 6. Ordinary Svelte Text Rendering

Every manifest field and `lastError` is authored/untrusted. Svelte interpolation
such as `{plugin.manifest.name}` is correct. Do not use `{@html}`, `innerHTML`,
HTML-capable markdown, dynamically generated style content, or string-built
markup. The config-health E2E spec supplies a strong hostile-text pattern using
literal `<svg>`, `<img onerror>`, and `<script>` strings and verifies they
remain inert.

### 7. Alert Plus Persistent Status

Use `alertStore.add('success' | 'error' | 'info', message)` for transient action
feedback, mirroring existing settings pages, but also retain inline page/row
error or stale status. Alerts auto-dismiss and are not a sufficient recovery
surface. Use `aria-busy` on the affected region and a polite live/status element
for routine async completion.

### 8. Scoped Origin Guard Before Side Effects

`packages/praxrr-app/src/routes/api/v1/mcp/+server.ts` is the direct precedent:

```ts
const origin = request.headers.get('origin');
if (origin !== null) {
  let sameOrigin = false;
  try {
    sameOrigin = new URL(origin).origin === url.origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) return new Response(null, { status: 403 });
}
```

For plugin routes, centralize this behavior in a small route-local helper that
returns `Response | null`, but return the stable plugin error shape and
`Cache-Control: no-store`. Call it at the top of enable, disable, and reload,
before identity mutation/service calls. Absent Origin remains allowed for
authenticated CLI clients; malformed/foreign Origin returns 403. The global auth
hook still runs before route code.

## Integration Points and File Changes

### Create

| File                                                                                                      | Responsibility                                                 | Dependencies                                                     |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/praxrr-app/src/routes/settings/plugins/presentation.ts`                                         | Pure identity, URL, catalog, lifecycle, and wording helpers    | Generated API types; `$shared/plugins` only                      |
| `packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts`                               | Exhaustive helper/semantic tests                               | `presentation.ts`; no DB/browser                                 |
| `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`                            | Responsive accessible disclosure and controlled action UI      | `PluginRecord`/view types; existing Badge/Card/button primitives |
| `packages/praxrr-app/src/routes/settings/plugins/+page.svelte`                                            | I/O and explicit UI state machine                              | generated types, `PluginCard`, presentation helper, alerts       |
| Plugin route-local Origin helper (for example `packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts`) | Same/absent/foreign/malformed Origin decision and redacted 403 | SvelteKit `json`, existing plugin error mapper                   |
| `packages/praxrr-app/src/tests/e2e/specs/plugin-management.spec.ts`                                       | Mocked API flows, hostile text, controls, and reflow           | Playwright existing fixtures                                     |

### Modify

| File                                                        | Exact integration                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Three plugin mutation `+server.ts` files                    | Accept `{ request, url, params? }`, invoke Origin helper before service side effects                                           |
| `packages/praxrr-app/src/tests/routes/plugins.test.ts`      | Upgrade fake events with real/fake request headers and URL; prove guard outcomes and zero side effects                         |
| `docs/api/v1/paths/plugins.yaml`                            | Add documented `403 PluginErrorResponse` to enable, disable, reload                                                            |
| Generated API artifacts                                     | Regenerate after path-contract update; keep app and `packages/praxrr-api` portable artifacts in lockstep per repository policy |
| `packages/praxrr-app/src/lib/server/navigation/registry.ts` | Add `settings.plugins` with stable order; renumber following children deliberately                                             |
| `packages/praxrr-app/src/routes/settings/+page.svelte`      | Add Plugins item/icon/description                                                                                              |
| Two navigation test files                                   | Add exact deep link and meaningful Settings-child assertion                                                                    |
| `scripts/test.ts`                                           | Add presentation test path to `plugins` alias if it lives outside currently covered directories                                |
| `ROADMAP.md`                                                | Mark management UI delivered; explicitly preserve runtime/telemetry deferred state                                             |

### Do Not Modify

- `plugin_registry`, migrations, or query semantics;
- `responses.ts` public projection merely for UI convenience;
- plugin executor/runtime, SDK, or discovery scanner;
- global auth modes, session cookie, or global CSRF configuration;
- a global client store or dirty-tracking system;
- API schemas to invent run/telemetry fields.

## Code Conventions

- TypeScript/Svelte formatting is tabs, single quotes, no trailing commas,
  100-character print width; run the repository formatter rather than
  hand-formatting large markup.
- New Svelte code follows the repository instruction: Svelte 5 without runes and
  event attributes such as `onclick`. Some older components/pages still use
  `on:click`; do not copy that legacy syntax into new code.
- Use plain `let`, `$:` only where useful, `onMount`, typed function parameters,
  and generated types. Do not use `$state`, `$derived`, `any`, or unvalidated
  structural casts across the fetch boundary.
- Imports use aliases (`$api`, `$shared`, `$ui`, `$alerts`) and `.ts` extensions
  for local TypeScript imports.
- Use native buttons with `type="button"`; pair color badges with visible text;
  make action names stable for assistive technology.
- Prefer one-way/controlled component data. The page owns mutation state; the
  card emits intent.

## Dependencies and Services

No dependency addition is needed. Existing surfaces cover the feature:

- generated `$api/v1.d.ts` for wire types;
- `$shared/plugins` catalogs for catalog truth;
- Svelte `onMount` and page-local variables for lifecycle/state;
- native `fetch`, `URL`, and `encodeURIComponent` for HTTP;
- `$alerts/store` for feedback;
- existing `$ui/card`, `$ui/badge`, `$ui/button`, and state primitives where
  their behavior fits;
- Lucide icons already present in the application.

No external service, marketplace, remote asset, analytics/telemetry service, or
WASM runtime participates.

## Gotchas and Warnings

### Semantic Correctness

1. `enabled` is persisted administrator intent. Never label it active, running,
   loaded, or successfully executed.
2. `discovered:false` is a retained durable row, not necessarily an error. Keep
   it visible and phrase enablement as applying when rediscovered.
3. `state` is lifecycle state, not run status. `activated` in the closed enum
   still does not supply current runtime availability or a successful run.
4. `lastError` is a safe lifecycle error. Do not call it a recent run error.
5. `registeredAt`, `createdAt`, and `updatedAt` are database timestamps, not
   last-run timestamps.
6. No execution telemetry fields exist. Render a fixed unavailable statement; do
   not inspect server logs or executor state from the browser.
7. Declared extension points may be unwired. Show both exact declaration and
   catalog wiring; do not filter unwired declarations away.

### Component Selection

- Existing `Toggle.svelte` immediately mutates its own `checked` prop before
  dispatch. That conflicts with the required pessimistic/server-confirmed
  behavior and can double-toggle through its nested `IconCheckbox` event path.
  Prefer an explicit native/Button enable/disable action, or create a genuinely
  controlled wrapper whose visible state always comes from the confirmed record.
  Do not use Toggle unchanged.
- `CollapsibleCard.svelte` can be used without `sectionKey`, but its header is
  already a button. Keep enable/ disable actions inside the expanded slot so
  interactive elements are not nested inside the disclosure button. Its slot
  unmounts when collapsed, so pending/action state must live in the page, not
  inside card-local component state.
- `EmptyState.svelte` requires a link action and uses viewport-height centering;
  feature-off and enabled-empty states need different optional controls, so an
  inline page-specific state card may fit better.

### HTTP and Error Handling

- `fetch` resolves on `4xx/5xx`; check `response.ok` before applying JSON.
- Parse plugin errors as the stable `{ code, error }` contract, but handle `401`
  from the global hook separately because it is not a `PluginErrorResponse`.
- Do not show raw `response.text()`, exception messages from the backend, or
  unexpected response bodies.
- A `409` from mutation means feature state changed; a `404` means the row
  changed/pruned. Both require a list refetch rather than a local guess.
- Preserve `Cache-Control: no-store` on the new 403 response.
- The Origin helper must be invoked before `setPluginEnabled`/`reloadPlugins`; a
  status-only test without asserting unchanged durable state or zero reload
  calls is insufficient.

### Contract Fidelity

- The current OpenAPI path docs do not list 403. Once the guard is introduced,
  update the path source and regenerate app/portable types/artifacts together.
  Do not edit generated files by hand.
- Do not change plugin schema fields to satisfy “recent run” wording. Missing
  telemetry is an explicit product state, not an implementation gap to fill
  inside #266.
- Shared catalog imports are client-safe; server `responses.ts`, host, registry,
  config, and DB imports are not. `presentation.ts` and Svelte components must
  never import `$server` or `$db`.

### Concurrency

- A per-identity pending set prevents contradictory enable/disable requests for
  one plugin; a global reload guard prevents duplicate reload UX.
- Decide and test interaction between reload and row actions. The simplest
  correct policy disables row actions during reload and disables reload while
  any row mutation is pending.
- Request IDs must protect both success and failure paths. A stale failure must
  not replace a newer successful list with an error.
- Reassign arrays/sets after updates so Svelte notices changes; keyed each
  blocks should use a composite key, not ID alone.

### Navigation and Test Coverage

- Settings has two registries: the shell registry and landing-page array. Update
  both.
- The user explicitly requires two navigation regression tests. Add
  `/settings/plugins` to the deep-link test and a targeted child assertion to
  scope filtering; do not satisfy the second requirement with a meaningless
  array change.
- `scripts/test.ts` currently maps `plugins` to shared/server/DB/route/MCP
  paths. A new presentation test in `src/tests/routes` is not included
  automatically unless named explicitly in that alias.
- The config-health Playwright spec provides hostile-string and
  320/375/390/768/1280 reflow patterns. Reuse those patterns with mocked plugin
  endpoints, including assertions that injected elements/scripts do not appear
  or execute.

## Task-Specific Guidance

### Presentation Helper Task

- Implement and exhaustively test composite identity, URL encoding, lifecycle
  wording, enablement/missing wording, capability mapping, and extension-point
  mapping first.
- Use `satisfies` against generated/catalog-derived types to catch drift.
- Include malicious/long strings only as returned values; helpers must never
  create HTML.

### Mutation Security Task

- Add one route-local helper and call it from enable, disable, and reload.
- Expand direct route fake events to contain `Request.headers` and `URL`,
  mirroring MCP tests.
- Test same, absent, foreign, malformed Origin and explicit no-side-effect
  evidence.
- Update OpenAPI path responses and regenerate contract artifacts in the same
  task so portable fidelity never enters a broken intermediate state.

### Page and Card Task

- Build the explicit state machine over one list request; do not call detail per
  card.
- Keep confirmed data visible during reload and mutation; display inline
  stale/error states plus alerts.
- Use native disclosure/action semantics and ordinary interpolation.
- Make the telemetry-unavailable and deny-by-construction capability
  explanations visible, not tooltip-only.
- Verify 320 CSS-pixel reflow and 44px-equivalent touch targets for primary
  controls.

### Navigation and Completion Task

- Add route discoverability in both navigation sources and update both named
  tests.
- Add the presentation test to the `plugins` alias.
- Update roadmap language after implementation evidence, preserving deferred
  runtime/telemetry.
- Run focused presentation, plugin route, catalog, navigation, and E2E tests
  before broad `check`, lint, and build validation.

## Recommended Dependency Order

1. Pure presentation helpers and their unit tests.
2. Origin guard, route tests, and contract regeneration; independent of the
   browser UI after helper/API shape decisions are fixed.
3. Plugin card using helper outputs; can proceed in parallel with server
   security.
4. Page orchestration after helper signatures/card events are stable.
5. Navigation integration can proceed independently, then join page work.
6. E2E, roadmap, graph update, and broad validation after all integration pieces
   land.
