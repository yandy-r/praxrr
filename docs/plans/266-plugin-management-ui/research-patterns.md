# Pattern Research: 266-plugin-management-ui

## Architectural Patterns

**Thin Svelte route with page-local browser state**: Client-fetched operational
pages own request state in the route component, use `onMount` for the initial
request, and keep request flags and errors local instead of adding a store or
query library.

- `packages/praxrr-app/src/routes/drift/+page.svelte`: `summary`, `loading`,
  `loadError`, and `summaryRequestId` live in the page; a monotonically
  increasing request id prevents an older response from replacing newer state.
- `packages/praxrr-app/src/routes/dependency-graph/[databaseId]/+page.svelte`:
  uses the same request-id check before assigning response data and before
  clearing `loading`.
- Plugin management should follow this shape in
  `packages/praxrr-app/src/routes/settings/plugins/+page.svelte`: one list
  request, local confirmed records, page-level reload state, and
  per-composite-identity mutation state. It does not need the dirty store
  because every action persists immediately and then accepts
  server-authoritative state.

**Route orchestration plus presentation-only component**: Existing pages compose
reusable `$ui` primitives while keeping I/O in the page. Feature-specific
display logic belongs beside the route when it is not broadly reusable.

- `packages/praxrr-app/src/routes/settings/notifications/+page.svelte`: owns
  action/loading state and composes `Table`, `Badge`, `Button`, and feature
  components.
- `packages/praxrr-app/src/routes/settings/notifications/components/NotificationHistory.svelte`:
  illustrates the route-local component directory convention.
- For this feature, the page should own fetch/mutation/reload behavior and pass
  a complete generated `PluginRecord` plus pending state into
  `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`.
  The card should emit an intent event; it should not fetch or optimistically
  mutate the record.

**Pure presentation contract beside the route**: Correctness-heavy formatting,
catalog lookups, identity keys, and endpoint construction should be plain
TypeScript so they can be tested without mounting Svelte.

- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts` and
  `packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts`:
  route-local pure helpers are imported directly into Deno tests and exercised
  with malformed, empty, Unicode, and round-trip cases.
- `packages/praxrr-app/src/lib/client/ui/canary/canaryStatus.ts` and other
  `$ui/*Status.ts` modules: closed status values map to labels/variants in pure
  modules rather than being scattered through markup.
- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts` should own
  the composite identity key, the URL helper that independently applies
  `encodeURIComponent` to `apiVersion` and `id`, lifecycle labels/badge
  variants, capability/extension-point view models, and truthful
  missing/telemetry wording.

**Generated wire types and shared client-safe catalogs are authoritative**: The
plugin HTTP contract is already generated, and shared plugin catalogs are
explicitly pure and safe for client imports.

- `packages/praxrr-app/src/lib/api/v1.d.ts`: provides `PluginRecord`,
  `PluginListResponse`, `PluginMutationResponse`, `PluginReloadResponse`, and
  `PluginErrorResponse` under `components['schemas']`.
- `packages/praxrr-app/src/lib/server/plugins/responses.ts`: demonstrates the
  expected aliases and explicit allow-listed projection; it deliberately avoids
  structural spreads from durable rows.
- `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts`:
  `CAPABILITY_CATALOG` is the single source for grant labels, descriptions,
  compatibility, and the deny-by-construction `mutates: false` /
  `touchesSecrets: false` facts.
- `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts`:
  `EXTENSION_POINTS` is the single source for point kind, wiring, mutation,
  interface version, and required capability.
- `packages/praxrr-app/src/lib/shared/plugins/index.ts`: is the intended barrel
  for client/server imports. The UI should look up each declared id in these
  catalogs and fail visibly/closed if an impossible unknown value reaches
  presentation code; it must not create a second label or wiring map.

**Settings navigation is registry-backed with a separate hub**: A Settings
destination requires two intentional changes.

- `packages/praxrr-app/src/lib/server/navigation/registry.ts`: the sole
  top-level item is `settings.settings`; its ordered `children` are created with
  `buildChild`. Add a globally visible `settings.plugins` child and renumber
  later children as needed. Do not add another top-level nav item or Arr feature
  requirement.
- `packages/praxrr-app/src/routes/settings/+page.svelte`: the Settings hub
  independently maintains `settingsItems`, using a lucide icon, label, href,
  description, and color class. Add Plugins here even when `PLUGINS_ENABLED` is
  off so the route can explain deployment configuration.

**Authenticated management routes with explicit portable responses**: Plugin
routes are normal SvelteKit `RequestHandler`s. Global auth runs before them,
while handlers validate plugin-specific inputs and always return portable,
non-cached JSON.

- `packages/praxrr-app/src/hooks.server.ts`: all non-public routes flow through
  `getAuthState`; unauthenticated API requests receive 401. There is no
  route-local role layer.
- `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`: plugin paths
  are absent from `PUBLIC_PATHS`, so both reads and mutations stay
  session/API-key authenticated.
- `packages/praxrr-app/src/routes/api/v1/plugins/+server.ts` and
  `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/+server.ts`:
  handlers use generated service outcomes, explicit status mapping, and
  `Cache-Control: no-store`.
- `packages/praxrr-app/src/routes/api/v1/plugins/_errors.ts`: internal
  diagnostics are logged server-side and a stable `internal_error` body is
  returned. The new origin rejection should likewise return fixed/redacted JSON,
  never the supplied Origin or raw exception text.

**Scoped security helper before mutation**: The repository currently has no
reusable same-origin request guard for these body-less POST routes.
`packages/praxrr-app/svelte.config.js` configures `csrf.trustedOrigins: ['*']`,
so relying on framework body-origin checking is not an available pattern here.

- Put a small feature-local pure guard/helper under the existing plugin
  route/service boundary (for example beside
  `packages/praxrr-app/src/routes/api/v1/plugins/_errors.ts`) and call it at the
  start of enable, disable, and reload.
- Accept an absent `Origin` for authenticated CLI/API-key callers; reject
  malformed origins and any parsed origin not exactly equal to `url.origin`;
  optionally reject explicit `Sec-Fetch-Site: cross-site` as defense in depth.
- Apply it before identity validation, host queue access, reload, or durable
  writes. Do not change the GET routes, add CORS headers, or broaden this
  feature into global proxy/CSRF configuration.

## Code Conventions

- Svelte code is TypeScript and this repository's current convention is Svelte 5
  event attributes such as `onclick`, not runes and not new `on:click` usage.
  Existing older components contain legacy handlers, but new feature code should
  follow the project rule and examples such as
  `packages/praxrr-app/src/lib/client/ui/card/CollapsibleCard.svelte`.
- Formatting is tabs, single quotes, no trailing commas, and a 100-character
  print width; imports use configured aliases such as `$api`, `$shared`, `$ui`,
  and `$alerts` rather than long relative paths where an alias exists.
- Generated response types should be aliased from `components['schemas']`; do
  not hand-copy the API interface.
- Composite identity must remain exact `apiVersion` plus case-insensitive `id`.
  Use a canonical helper for pending maps/record replacement, and build paths by
  encoding the two segments independently. Do not concatenate an unencoded
  namespace/id pair or key rows by `id` alone.
- Server responses are authoritative. During enable/disable, retain the
  confirmed badge/value, disable only the affected action, and replace the
  entire matching record from `PluginMutationResponse.plugin` on success.
- Reload is a distinct two-stage operation: preserve current records, POST
  reload, report its aggregate counters, then GET the list. A failed refetch
  after a committed reload marks the current view stale; it must not relabel the
  reload itself as failed.
- `$ui/card/Card.svelte`, `$ui/badge/Badge.svelte`, and
  `$ui/button/Button.svelte` provide the established visual primitives. `Card`
  must not become a row-wide interactive wrapper when it contains disclosure and
  mutation controls. Use a native disclosure button or a route-local accessible
  card implementation.
- `$ui/toggle/Toggle.svelte` mutates its local `checked` value before
  dispatching. That is risky for a pessimistic, controlled server-authoritative
  switch. Prefer explicit Enable/Disable `Button`s unless the implementation
  proves the toggle is immediately reset from its prop without a false transient
  state.
- Render manifest names, descriptions, authors, ids, versions, entries, and
  `lastError` through ordinary Svelte text interpolation. Do not use `{@html}`,
  `Markdown`, title-only tooltips, or client storage for authored/error content.
- Separate feature availability, discovery, persisted intent, lifecycle state,
  point wiring, and telemetry evidence. Do not compress them into one
  “healthy/running” badge. `registeredAt` is registration time and `lastError`
  is a lifecycle error, not a run timestamp/error.

## Error Handling

- Client fetches should attempt the generated `PluginErrorResponse`, then fall
  back to an action-specific HTTP status message if JSON parsing fails. Catch
  network exceptions with a stable fallback.
- Initial list failure gets a persistent inline error/retry state. If confirmed
  records already exist, later refresh failures retain them and mark them stale
  instead of clearing the page. Alerts supplement rather than replace this
  recoverable inline state.
- Follow `packages/praxrr-app/src/routes/drift/+page.svelte` for stale-response
  suppression and
  `alertStore.add('success' | 'error' | 'warning' | 'info', message)` for
  transient outcomes.
- A mutation 404 means the record changed or was pruned: preserve current state
  until an authoritative list refetch, explain the change, and do not fabricate
  a replacement. A 409 means feature/registry state changed: refetch and
  transition to the returned feature-off/list state.
- Reload rejection reports only the contract's aggregate `rejected` counter. The
  API does not expose rejected identities or diagnostic detail, so the UI must
  not infer it.
- Server handlers already map `disabled` to 409, `not_found` to 404, invalid
  identities to 400, and internal errors to a logged/redacted 500. The origin
  guard should return 403 with `Cache-Control: no-store` and a stable body while
  ensuring no host/database method is called.

## Testing Approach

**Pure Deno contract tests**

- Add
  `packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts`
  and import `presentation.ts` directly, following
  `scoreSimulatorUrlState.test.ts`.
- Cover independent URL encoding for slashes, spaces, percent characters,
  Unicode, and hostile-looking strings; composite-key collision resistance;
  case-insensitive id matching without changing the displayed exact id; every
  closed lifecycle state; discovered versus retained-missing wording; and
  explicit “execution telemetry unavailable” output.
- Iterate every `CAPABILITY_CATALOG` and `EXTENSION_POINTS` entry so
  labels/wiring/safety facts remain catalog-backed and exhaustive. Assert
  unknown ids fail closed rather than being silently presented as wired or safe.

**Direct route-handler security tests**

- Extend `packages/praxrr-app/src/tests/routes/plugins.test.ts`. It already
  imports GET/POST handlers directly, constructs typed fake events, initializes
  a temporary migrated DB, toggles `pluginsEnabled`, verifies durable state, and
  restores monkey-patched host methods in `finally` blocks.
- Update event builders to supply `request` and `url`. Test same-origin Origin,
  absent Origin, foreign Origin, malformed Origin, and optionally
  `Sec-Fetch-Site: cross-site` for all three mutation routes.
- For every rejected request, assert 403, `Cache-Control: no-store`, the exact
  redacted body, and unchanged durable state/zero reload or host calls. Retain
  the existing test that `isPublicPath` is false for all plugin routes.
- Preserve existing feature-off, namespace, redaction, missing-record, reload
  persistence, and internal-error tests; they are the regression contract the UI
  consumes.

**Navigation regression tests**

- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts` asserts the
  complete deep-link sequence. Insert `/settings/plugins` at the
  registry-defined position without changing the top-level href list.
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`
  currently focuses on top-level Arr scope. Add a targeted assertion that
  `settings.plugins` is present under `settings.settings` for every scope rather
  than making an unrelated expected top-level array change.

**Playwright UI tests**

- Place the spec under `packages/praxrr-app/src/tests/e2e/specs/`, which is
  configured by root `playwright.config.ts`; tests run serially with one worker.
- Follow `config-health-trends-export.spec.ts` and
  `sync-preview-reviewed-plan.spec.ts`: authenticate through the real
  setup/login flow, intercept API requests with `page.route`, use role/name
  locators, and fulfill deterministic JSON fixtures.
- Exercise feature-off, enabled-empty, populated/discovered, retained-missing,
  initial failure/retry, enable/disable, reload counters,
  reload-success/refetch-failure stale state, and 404/409 recovery. Assert exact
  request method and independently encoded path segments, plus prevention of
  duplicate per-row mutations and concurrent reload.
- Include hostile manifest/error strings and assert they appear as text while no
  injected element/script executes, matching the hostile-content technique in
  `config-health-trends-export.spec.ts`.
- Verify disclosure and actions by keyboard, stable accessible names, focus
  preservation, disabled/pending states, `aria-busy`, and a polite
  `role="status"`/`aria-live="polite"` region. At a 320px viewport, compare
  document/body scroll width to viewport width and verify usable touch-control
  dimensions, following that same E2E spec.

## Patterns to Follow

1. Import generated plugin schemas and the shared plugin barrel; create no
   duplicate client contract or catalog.
2. Put I/O and explicit loading/disabled/empty/populated/stale/error state in
   `+page.svelte`; keep `PluginCard` presentation-only and correctness-heavy
   mappings in `presentation.ts`.
3. Use request generations, a global reload guard, and per-composite-identity
   pending guards; retain confirmed data until a successful authoritative
   response.
4. Add Plugins to both the Settings registry children and Settings hub, keeping
   it visible in feature-off state.
5. Reuse Card/Badge/Button styling but use native, non-nested interactive
   controls and truthful independent labels.
6. Add a feature-local pure same-origin guard before every plugin POST; preserve
   auth, absent-Origin clients, no-store headers, redacted errors, and unchanged
   GET behavior.
7. Validate pure mappings, route security/no-mutation behavior, navigation
   placement, and deterministic browser UX at desktop and 320px widths.
