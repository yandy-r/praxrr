# Technical Research: Plugin Management UI (#266)

## Executive Summary

Issue #266 should add a client-facing management route at `/settings/plugins`
that consumes the already-shipped, authenticated `/api/v1/plugins*` contract
from issue #264. The current backend is complete for discovery inspection,
durable enable/disable intent, and atomic reload. No database migration, OpenAPI
edit, generated-type change, or new server endpoint is needed for those flows.

The page should load `GET /api/v1/plugins` on mount, render the exact
`PluginRecord` projection, perform enable/disable and reload with the existing
`POST` endpoints, replace local records only from successful response bodies,
and report outcomes through `alertStore.add`. Immediate server mutation means
there is no unsaved form state, so the dirty store is not applicable.

There is one material contract gap against #266's acceptance criteria: the API
does **not** expose runtime availability or recent execution evidence. `enabled`
is administrator intent, `discovered` is scan presence, `state` is the persisted
lifecycle state, and `lastError` is a safe lifecycle error. The shipped
`UnavailablePluginExecutor` still throws because issue #262 ended NO-GO;
observer dispatch failures are logged and isolated, not persisted. Therefore the
UI can truthfully show lifecycle status and `lastError`, but it cannot claim a
plugin ran, show a last-run time/result, or detect runtime readiness from the
existing response. The implementation must label this distinction explicitly.
Full recent-run acceptance requires separate backend/contract work; this
research does not invent that endpoint or schema.

## Evidence and Current-State Constraints

- Issue #264 is closed and its implementation report records passing
  list/get/enable/disable/reload, durable persistence, redacted shared response
  mapping, contract generation, and route tests.
- `docs/api/v1/schemas/plugins.yaml` and generated `$api/v1.d.ts` agree on the
  public shapes.
- `$server/plugins/responses.ts` is the allow-list boundary used by HTTP and
  MCP; the UI must not expect internal fields such as `sourceDir` or raw
  manifest JSON.
- `GET /api/v1/plugins` is the only read operation that degrades to a 200
  feature-off response: `{ pluginsEnabled: false, items: [] }`.
- Detail and enable/disable calls return 409 while the feature is off. Reload
  remains a successful 200 no-op summary with `pluginsEnabled:false` and
  `reloaded:false`.
- `$shared/plugins/capabilities.ts` already contains human-readable capability
  labels and descriptions and is pure/client-safe.
  `$shared/plugins/extensionPoints.ts` already contains authoritative `kind`,
  `wired`, `mutates`, and `requiredCapability` metadata. UI copy should derive
  from these catalogs rather than duplicate policy facts.
- Production call sites currently dispatch only `config.profileCompiled.observe`
  and `sync.previewComputed.observe`. The catalogs mark those two as wired; the
  other seven points are declared but unwired.
- The feature is global, not Arr-specific. No `arr_type` appears in the manifest
  or public plugin record, so the page must not infer Radarr/Sonarr/Lidarr
  compatibility.

## Architecture Design

### Component and Data Flow

```text
NAV_REGISTRY + Settings hub
          |
          v
/settings/plugins/+page.svelte
  |  onMount / retry                 | POST mutation
  |                                  |
  +--> GET /api/v1/plugins           +--> /plugins/{apiVersion}/{encoded id}/enable
  |        |                          |    /plugins/{apiVersion}/{encoded id}/disable
  |        v                          |        |
  |   PluginListResponse              |        v
  |        |                          |   PluginMutationResponse
  |        v                          |        |
  |   local items + feature state <---+--- replace exact keyed row
  |
  +--> POST /api/v1/plugins/reload
           |
           v
      PluginReloadResponse -> alert summary -> GET list again

Pure client metadata:
  PluginRecord.manifest.capabilities -> CAPABILITY_CATALOG -> label/description/safety facts
  PluginRecord.manifest.extensionPoints -> EXTENSION_POINTS -> kind/wired/mutates/grant mapping
```

The page owns request orchestration and global states. A focused presentation
component may render one plugin, but it should receive resolved catalog
descriptors and pending state as props; it should not fetch independently. This
prevents per-card request races and keeps feature-off/retry behavior in one
place.

### Recommended Components

| Component/module                                       | Responsibility                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `routes/settings/plugins/+page.svelte`                 | Own list loading, feature-off/error/empty states, mutation serialization, reload/refetch, alert feedback, and page composition.                              |
| `routes/settings/plugins/components/PluginCard.svelte` | Render identity, lifecycle badges, discovery/enablement, extension-point facts, capability grants, lifecycle error, timestamps, and action controls. No I/O. |
| `$shared/plugins/capabilities.ts`                      | Existing source for capability label, description, and deny-by-construction facts. Reuse unchanged.                                                          |
| `$shared/plugins/extensionPoints.ts`                   | Existing source for wired/declared and observe/transform/provider truth. Reuse unchanged.                                                                    |
| `$api/v1.d.ts`                                         | Existing generated contract types. Import type aliases; do not copy handwritten response interfaces.                                                         |

A separate client store is unnecessary. This state belongs to one route, has no
cross-route consumer, and is refreshed from the authoritative endpoint after
reload. Local component state is the smaller and more testable boundary.

### Page State Model

Use explicit, orthogonal variables rather than deriving backend facts from one
status string:

```ts
type PluginRecord = components['schemas']['PluginRecord'];
type PluginListResponse = components['schemas']['PluginListResponse'];
type PluginMutationResponse = components['schemas']['PluginMutationResponse'];
type PluginReloadResponse = components['schemas']['PluginReloadResponse'];
type PluginErrorResponse = components['schemas']['PluginErrorResponse'];

let loading = true;
let loadError: string | null = null;
let pluginsEnabled = false;
let items: PluginRecord[] = [];
let reloading = false;
let pendingIdentity: string | null = null;
```

The identity key must include both namespace and id, for example
`${manifest.apiVersion}\u0000${manifest.id.toLowerCase()}`. It is only a client
pending key; endpoint construction must keep the original persisted `apiVersion`
and `id`, each passed through `encodeURIComponent`. Do not trim either value or
infer `PLUGIN_API_VERSION`.

Only one reload or mutation should be admitted at a time. This avoids an older
mutation response overwriting a newer reload result in local state, even though
the host already serializes durable operations server-side. Disable all action
controls while `reloading` and disable the affected plugin's toggle while a
mutation is pending.

### Rendering Rules

Each plugin should display these independent facts:

- Identity: exact `name`, `id`, `version`, optional `author` and `description`,
  plus `apiVersion` and advisory `engines.praxrr` where present.
- Discovery: `discovered:true` means present in the latest successful scan;
  false means the durable row remains as an unloaded/missing plugin.
- Enablement: `enabled` is persisted administrator intent only. Disable the
  toggle when the feature is off, during an operation, or when
  `discovered:false` if the product decision is to prevent enabling absent code.
  The API itself permits durable enablement on missing rows, so this last UI
  restriction must be settled rather than assumed.
- Lifecycle: display the exact `state`, with `registered` described as
  registered/discovered rather than active. `activated` and `failed` are
  reserved states, not proof of current runtime health.
- Lifecycle error: show `lastError` only when non-null and label it "Last
  lifecycle error". Never label it "last run error."
- Extension points: resolve every id through `getExtensionPoint`. Show `wired`
  versus "declared, not wired," plus kind. This is the authoritative way to
  avoid implying that every manifest declaration currently executes.
- Capabilities: resolve through `getCapability` and show its label and
  description. Add one shared safety statement based on the closed catalog:
  grants are read-only and expose no credentials, network, filesystem, database,
  environment, or write access. Do not generate that assertion from string
  prefixes alone.
- Run telemetry: show an explicit "Execution telemetry unavailable in this
  build" state. Do not synthesize a recent run from `registeredAt`, `updatedAt`,
  `state`, or `lastError`.

### Loading, Empty, and Failure States

1. Initial load: show an in-page loading state until `GET /api/v1/plugins`
   resolves.
2. Feature disabled: when the 200 body has `pluginsEnabled:false`, render a
   first-class explanation that `PLUGINS_ENABLED` is off and that
   enable/disable/reload controls are unavailable. This is not an error alert.
3. Feature enabled, no rows: explain that no validated plugins have been
   discovered and that reload rescans `PLUGINS_DIR`; provide the reload action.
4. Request/network/internal failure: retain no inferred plugin state on initial
   failure, render a retry action, and use the redacted
   `PluginErrorResponse.error` when available. For a mutation failure, retain
   the prior row and report via `alertStore.add('error', ...)`.
5. Runtime unavailable: page management remains usable. Present the
   release-level execution limitation separately from HTTP availability. The
   current API has no runtime-health bit.

`EmptyState.svelte` requires a navigation button and fills most of the viewport,
so it is not a clean fit for both disabled and zero-plugin states without
changing its public API. Prefer a small inline state card using existing
neutral/warning styles, or extend that shared component only if another consumer
benefits.

## Data Models

### Persistent Data

No schema or migration change is proposed for #266. The UI reads the existing
`plugin_registry` projection created by #264. Its public record is:

| Field                      | Public type                | Required | Meaning/constraint                                                             |
| -------------------------- | -------------------------- | -------- | ------------------------------------------------------------------------------ |
| `manifest.apiVersion`      | `string`                   | yes      | Exact namespace, length 1-32; never inferred or trimmed.                       |
| `manifest.id`              | `string`                   | yes      | Exact persisted id, length 1-253; lookup is case-insensitive within namespace. |
| `manifest.name`            | `string`                   | yes      | Exact persisted display name, length 1-256.                                    |
| `manifest.version`         | `string`                   | yes      | Manifest version, length 1-128.                                                |
| `manifest.runtime`         | `'wasm'`                   | yes      | Declared runtime format; not runtime availability.                             |
| `manifest.entry`           | `string`                   | yes      | Manifest-relative entry, not an absolute source path.                          |
| `manifest.extensionPoints` | `PluginExtensionPointId[]` | yes      | 1-9 closed identifiers.                                                        |
| `manifest.capabilities`    | `PluginCapabilityId[]`     | yes      | 0-4 closed, read-only identifiers.                                             |
| `manifest.description`     | `string`                   | no       | At most 2048 characters.                                                       |
| `manifest.author`          | `string`                   | no       | At most 256 characters.                                                        |
| `manifest.engines.praxrr`  | `string`                   | no       | Advisory constraint only.                                                      |
| `enabled`                  | `boolean`                  | yes      | Durable administrator intent, not activation.                                  |
| `discovered`               | `boolean`                  | yes      | Presence in latest successful reconciliation.                                  |
| `state`                    | closed lifecycle enum      | yes      | Last recorded lifecycle state.                                                 |
| `registeredAt`             | RFC 3339 string            | yes      | Registration timestamp, not execution time.                                    |
| `lastError`                | `string \| null`           | yes      | Safe lifecycle error, not a guaranteed execution error.                        |
| `createdAt` / `updatedAt`  | RFC 3339 string            | yes      | Durable record timestamps.                                                     |

The database key remains `(api_version, plugin_id COLLATE NOCASE)`. The UI must
not add a second identity scheme or treat `id` alone as globally unique.

### Client View Data

No persisted client model is needed. Resolve display metadata directly from the
pure catalogs:

```ts
const capability = getCapability(id); // label, description, mutates:false, touchesSecrets:false
const point = getExtensionPoint(id); // kind, wired, mutates, requiredCapability
```

Generated API types are the wire source of truth. The pure catalogs are
presentation/policy sources; they do not widen the API response and require no
JSON serialization.

## Existing API Design (Consumed Unchanged)

All paths are under `/api/v1`; authentication is inherited from the existing
global hook. No request body is defined for any plugin operation.

### `GET /plugins`

Success 200:

```json
{
  "pluginsEnabled": true,
  "items": [
    {
      "manifest": {
        "apiVersion": "1",
        "id": "com.example.observer",
        "name": "Example Observer",
        "version": "1.0.0",
        "runtime": "wasm",
        "entry": "plugin.wasm",
        "extensionPoints": ["sync.previewComputed.observe"],
        "capabilities": ["read:sync-preview"],
        "author": "Example"
      },
      "enabled": true,
      "discovered": true,
      "state": "registered",
      "registeredAt": "2026-07-12T00:00:00.000Z",
      "lastError": null,
      "createdAt": "2026-07-12T00:00:00.000Z",
      "updatedAt": "2026-07-12T00:00:00.000Z"
    }
  ]
}
```

Feature-off success 200 is exactly `{ "pluginsEnabled": false, "items": [] }`. A
500 returns `PluginErrorResponse` with `code:'internal_error'` and a redacted
`error` string.

### `GET /plugins/{apiVersion}/{id}`

This detail endpoint returns `{ pluginsEnabled:true, plugin:PluginRecord }`. It
is optional for the proposed list/card UI because the list already carries the
complete public record. Calling it for every card would create an N+1 read with
no additional data. Reserve it for a future deep-link detail route.

Errors: 400 `invalid_identity`, 404 `plugin_not_found`, 409 `plugins_disabled`,
500 `internal_error`.

### `POST /plugins/{apiVersion}/{id}/enable`

### `POST /plugins/{apiVersion}/{id}/disable`

Both return 200 `{ pluginsEnabled:true, plugin:PluginRecord }`. On success,
replace the exact local row with the returned record rather than toggling a
local boolean optimistically. This preserves server timestamps and any
concurrent lifecycle facts.

Errors: 400 `invalid_identity`, 404 `plugin_not_found`, 409 `plugins_disabled`
(or management conflict described by the OpenAPI operation), 500
`internal_error`. The current route maps all non-disabled internal conflicts
through the service's redacted internal error path; the client must use status
plus the returned stable error body, not parse arbitrary server text.

### `POST /plugins/reload`

Success 200:

```json
{
  "pluginsEnabled": true,
  "reloaded": true,
  "discovered": 3,
  "registered": 2,
  "rejected": 1,
  "missing": 0
}
```

Feature-off success is 200 with `pluginsEnabled:false`, `reloaded:false`, and
all counters zero. After an enabled reload, always refetch the list; the summary
has no records. Report the four counters in the success alert. A 500 means the
prior in-memory snapshot remains usable, so retain the current UI list and offer
retry.

### Error Reader

Use one local helper that safely attempts `response.json()` and accepts only a
non-empty string `error`; otherwise fall back to
`Plugin operation failed (HTTP ${response.status})`. Do not display raw thrown
objects or assume every failure response is JSON.

## System Constraints

### Security and Contract Fidelity

- Do not expose or request source directories, absolute paths, raw manifests,
  credentials, or logs.
- Reuse the exact public allow-list response; never spread an unknown response
  into the view model.
- Use only closed catalog metadata for human-readable permissions. Unknown ids
  should render as an unsupported contract value and disable mutation for that
  record rather than silently fabricate a label, although generated types make
  this a defensive runtime check.
- Preserve exact authored identifiers and names. URL-encode path segments; do
  not trim them.
- Do not claim network/filesystem/write denial based only on current plugin
  content. It is a property of the closed capability catalog shipped by this
  build.
- No Arr semantic dispatch is involved. If future plugin metadata adds Arr
  scope, it must be an explicit contract addition with per-Arr validation; this
  UI must not guess it now.

### Performance and Scalability

- One list request is sufficient; do not call detail per row.
- The durable repository bounds missing-plugin tombstones at 256, so the
  management list is small.
- Catalog resolution over four capabilities and nine points is negligible; a
  `Map` can be created once if desired, but no cache/store layer is justified.
- Serialize UI mutations to avoid stale response application. The backend
  independently serializes reload and enablement commits.
- No polling is warranted because the API exposes no changing execution
  telemetry. Reload is an explicit user action.

### Compatibility and Svelte Conventions

- Svelte 5 without runes: use ordinary `let`, `$:` and `on:click`/component
  events.
- Use `onMount` for the authenticated client fetch, matching settings/canary and
  other API-backed pages. The page can SSR a loading shell without calling its
  own HTTP endpoint internally.
- Use existing `Button`, `Badge`, `Card`/`CollapsibleCard`, `Toggle`, and alert
  components where they fit. Do not introduce a modal; no confirmation is
  required for reversible enablement intent or reload.
- Dirty tracking is intentionally absent because each interaction commits
  immediately and updates from the server response. If the design changes to
  staged multi-plugin edits, dirty tracking then becomes required.
- Ensure controls expose text/ARIA labels and keyboard behavior. `Toggle.svelte`
  already provides switch semantics, but the label must distinguish each plugin.

## Codebase Changes

### Files to Create

| File                                                                           | Change                                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/routes/settings/plugins/+page.svelte`                 | New route shell, list/mutation/reload orchestration, feature-off/loading/error/empty states.                                    |
| `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte` | Present one plugin and its catalog-resolved grants/points without fetching.                                                     |
| `packages/praxrr-app/src/tests/e2e/specs/plugin-management.spec.ts`            | Focused UI flow using intercepted plugin API responses so disabled, list, mutation, reload, and error states are deterministic. |

A `+page.server.ts` is not required: there is no additional server-only data,
and client fetch is the established pattern for API-backed settings panels. A
separate client store/helper should be added only if tests show the request code
cannot be exercised cleanly in the page.

### Files to Modify

| File                                                               | Change                                                                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/navigation/registry.ts`        | Add `settings.plugins` child for `/settings/plugins`; keep it globally visible so feature-off users can reach the explanatory page. |
| `packages/praxrr-app/src/routes/settings/+page.svelte`             | Add the Plugins settings-hub row with an existing or imported Lucide plugin/puzzle icon.                                            |
| `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts` | Add `/settings/plugins` to the exact deep-link snapshot at the same child order.                                                    |
| `ROADMAP.md`                                                       | Record shipped #266 behavior and the execution-telemetry limitation accurately.                                                     |

The current repository has only one nav test whose expected array includes
settings child links: `navigationShellLayout.test.ts`'s `deepLinks`.
`navigationScopeFiltering.test.ts` snapshots top-level sidebar/bottom-nav hrefs
only, so a `/settings/plugins` child does not change its arrays. Run both tests
because issue #266 calls out the pair and because they are not part of the
normal CI test selection, but do not modify the second test merely to
manufacture a diff. The settings landing page is the other hardcoded navigation
surface that does require an edit.

### Files Explicitly Unchanged

- `docs/api/v1/openapi.yaml`, `docs/api/v1/paths/plugins.yaml`,
  `docs/api/v1/schemas/plugins.yaml`
- generated `packages/praxrr-app/src/lib/api/v1.d.ts` and packaged API artifacts
- app database migrations and `$db/queries/pluginRegistry.ts`
- `$server/plugins/*`, unless a separately approved telemetry child issue
  expands the backend
- `seedBuiltInBaseOps.ts` (this feature has no PCD base ops)

## Test Strategy

### Pure/Focused UI Behavior

If catalog-to-view logic is extracted to a small `.ts` module, add Deno tests
for:

- all four capabilities resolve to the exact catalog labels/descriptions;
- all nine points resolve and preserve `wired`, `kind`, `mutates`, and required
  capability;
- lifecycle/display mapping never maps `enabled` or `registered` to
  running/active;
- `lastError` is labeled lifecycle-only and null produces no error panel;
- endpoint identity segments preserve values and are URL-encoded.

Do not create a helper solely to chase unit coverage; Playwright interception
can verify the page's observable behavior directly.

### Navigation Tests

Run explicitly:

```bash
deno test packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts \
  packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts
```

Assert `/settings/plugins` is present once in deep links, settings child order
is deterministic, and the top-level/bottom navigation remains unchanged.

### E2E Contract/UI Tests

Intercept `/api/v1/plugins*` in Playwright so no local WASM artifact or mutable
plugin directory is required. Cover:

1. GET returns `pluginsEnabled:false`: disabled explanation is visible, no error
   banner, actions are unavailable.
2. GET returns enabled with records: exact identity, author/version, discovery
   and lifecycle state, catalog-derived capability descriptions, wired/unwired
   point labels, lifecycle error, and telemetry-unavailable message render.
3. Enable/disable: correct namespace/id URL is posted, control is
   pending-disabled, returned record replaces the row, and success alert
   appears.
4. Mutation 404/409/500 and network failure: prior state remains, redacted error
   appears in an alert, and control recovers.
5. Reload: POST once, show summary alert, then refetch list; feature-off no-op
   is not described as a successful rescan.
6. Initial GET 500/network failure: graceful retry surface; successful retry
   hydrates the page.
7. `discovered:false`: missing/unloaded semantics are clear and are not shown as
   running.
8. Responsive/keyboard smoke: actions have accessible names and toggle is
   operable by keyboard.

### Existing Backend Regression Tests

The UI should not change these contracts, but the focused suite provides
evidence that assumptions still hold:

```bash
deno task test plugins
deno task test packages/praxrr-app/src/tests/routes/plugins.test.ts
deno task check
```

Run `deno task test:e2e` if the environment supports the full suite; at minimum
run the new plugin management spec directly. Finish with `graphify update .`
after code modifications per repository instructions.

## Technical Decisions

### Decision 1: `/settings/plugins`, not a top-level `/plugins`

**Options:** top-level management route; settings child route.

**Recommendation:** `/settings/plugins`.

**Rationale:** this is an operator configuration/lifecycle surface, the settings
hub already groups security/jobs/backups/notifications, and a child avoids
spending scarce top-level/mobile navigation space. Keep it visible even while
disabled so operators can discover the feature flag.

### Decision 2: Client fetch against the public API

**Options:** call server service from `+page.server.ts`; server-side fetch the
HTTP route; client fetch from the page.

**Recommendation:** client fetch.

**Rationale:** #266 explicitly validates the management API integration,
mutations are client interactions, and existing settings/canary establishes this
pattern. It also gives a real retryable runtime-unavailable/API-unavailable
state without duplicating service calls outside the public contract.

### Decision 3: Reuse shared catalogs for human-readable grants

**Options:** handwritten UI label maps; render raw ids; import the pure
catalogs.

**Recommendation:** import `getCapability`/`getExtensionPoint` or their catalogs
from `$shared/plugins`.

**Rationale:** labels, descriptions, least-privilege mapping, and wired status
already have one client-safe source of truth. Copying them into UI would create
contract drift.

### Decision 4: Server-authoritative mutation updates

**Options:** optimistic local toggle; await response and replace record.

**Recommendation:** await and replace.

**Rationale:** enablement is durable intent, responses carry new
timestamps/lifecycle facts, and failure must leave the displayed truth
unchanged. The latency is local-app HTTP and does not justify optimistic
rollback complexity.

### Decision 5: No dirty tracking for immediate actions

**Options:** mark the page dirty after toggle; persist each action immediately.

**Recommendation:** immediate persistence, no dirty marker.

**Rationale:** there is no Save/Cancel transaction. Marking an already-committed
change dirty would produce a false navigation warning.

### Decision 6: Do not fabricate recent-run state

**Options:** infer from lifecycle fields; display no run information; expand the
backend contract in this issue.

**Recommendation:** display lifecycle facts plus an explicit
execution-telemetry-unavailable state, and track the missing run contract as a
child dependency if full acceptance is mandatory.

**Rationale:** `registeredAt` is registration time, `updatedAt` is durable row
mutation time, `lastError` is lifecycle-only, and executor errors are not
persisted. Any inferred run result would violate the issue's transparency goal
and #264's explicit management-intent contract.

## Open Questions

1. **Blocking acceptance decision:** Is #266 allowed to state "execution
   telemetry unavailable in this build," or must a child issue first add runtime
   readiness and per-plugin run evidence to the API? The current contract cannot
   satisfy "recent run status" literally.
2. Should `enabled` be mutable while `discovered:false`? The backend
   intentionally preserves and can change intent for missing plugins, but a UI
   toggle on absent code may confuse operators. Either choice must explain that
   intent applies if the plugin reappears.
3. Should lifecycle `lastError` remain visible after a plugin becomes unloaded?
   The API returns it, but reconciliation currently clears it when marking
   missing rows, so the UI cannot promise error history.
4. Is a detail deep link required now? The list response already contains every
   public field; a detail route adds navigation and test cost without more data.
   A card/disclosure list is the lean recommendation.
5. Should the static runtime-unavailable explanation name the #262 NO-GO
   decision, or use stable product copy that remains correct until a
   runtime-health contract exists? Stable product copy is less likely to become
   stale, but it must not imply runtime detection.
6. The issue mentions "the two nav snapshot tests." Current code shows only
   `navigationShellLayout.test.ts` contains settings child hrefs;
   `navigationScopeFiltering.test.ts` covers top-level links. Confirm that
   running both without modifying the unaffected snapshot meets the intended
   regression requirement.
