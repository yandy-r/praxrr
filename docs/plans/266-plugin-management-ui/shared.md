# Plugin Management UI (#266)

The feature adds a client-owned `/settings/plugins` route over the existing
authenticated, redacted `/api/v1/plugins*` contract. The page owns list,
mutation, reload, stale, and error state; a presentation-only card and pure
helper module render each durable record using the generated API types and
client-safe capability/extension-point catalogs. Existing server services remain
the authority for serialized persistence and live registry publication, while a
scoped same-origin guard protects the three body-less mutation routes. The UI
must keep discovery, saved enablement intent, lifecycle evidence, point wiring,
and unavailable execution telemetry as separate facts.

## Relevant Files

- `packages/praxrr-app/src/routes/settings/plugins/+page.svelte`: New page-local
  state and request orchestration.
- `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`:
  New presentation-only plugin disclosure.
- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts`: New pure
  identity, URL, catalog, and label helpers.
- `packages/praxrr-app/src/lib/api/v1.d.ts`: Generated plugin response types
  consumed by UI/tests.
- `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts`: Authoritative
  human-readable grant and safety facts.
- `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts`: Authoritative
  point kind and wiring metadata.
- `packages/praxrr-app/src/lib/server/plugins/responses.ts`: Existing redacted
  management service/projection boundary.
- `packages/praxrr-app/src/lib/server/plugins/host.ts`: Existing serialized
  reload and enablement authority.
- `packages/praxrr-app/src/lib/server/db/queries/pluginRegistry.ts`: Existing
  durable identity and reconciliation semantics.
- `packages/praxrr-app/src/routes/api/v1/plugins/+server.ts`: Existing
  feature-aware list route.
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts`:
  Mutation route requiring Origin guard.
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/disable/+server.ts`:
  Mutation route requiring Origin guard.
- `packages/praxrr-app/src/routes/api/v1/plugins/reload/+server.ts`: Reload
  route requiring Origin guard.
- `packages/praxrr-app/src/routes/api/v1/plugins/_errors.ts`: Stable redacted
  route-error pattern.
- `packages/praxrr-app/src/routes/api/v1/mcp/+server.ts`: Existing
  absent/same/foreign-Origin precedent.
- `docs/api/v1/paths/plugins.yaml`: Portable path contract, including new
  documented 403 behavior.
- `docs/api/v1/schemas/plugins.yaml`: Existing portable plugin schemas and error
  vocabulary.
- `packages/praxrr-app/src/lib/server/navigation/registry.ts`: Canonical
  Settings child registry.
- `packages/praxrr-app/src/routes/settings/+page.svelte`: Settings landing-page
  destinations.
- `packages/praxrr-app/src/tests/routes/plugins.test.ts`: Existing migrated
  route/DB harness to extend.
- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts`: Exact
  deep-link snapshot.
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`: Add
  targeted Settings-child coverage.
- `packages/praxrr-app/src/tests/e2e/specs/config-health-trends-export.spec.ts`:
  Mocked API, hostile text, and reflow pattern.
- `scripts/test.ts`: Plugin alias must include any new presentation test.
- `ROADMAP.md`: Record UI delivery without claiming runtime or telemetry
  delivery.

## Relevant Tables

- `plugin_registry`: Existing API-version-qualified durable manifests,
  enablement intent, discovery, lifecycle state, safe lifecycle error, and
  timestamps; no schema change is required.

## Relevant Patterns

**Page-local request generations**: Keep route I/O state local and ignore stale
list responses; see
[`packages/praxrr-app/src/routes/drift/+page.svelte`](../../../packages/praxrr-app/src/routes/drift/+page.svelte).

**Pure route presentation helpers**: Put correctness-heavy URL/status mappings
beside the route and test them directly; see
[`packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts`](../../../packages/praxrr-app/src/routes/score-simulator/[databaseId]/urlState.ts).

**Server-authoritative mutations**: Retain confirmed UI state while pending,
then replace the full record returned by the service; the backend queue in
[`packages/praxrr-app/src/lib/server/plugins/host.ts`](../../../packages/praxrr-app/src/lib/server/plugins/host.ts)
remains the durable ordering authority.

**Two-stage reload**: Report aggregate reload counters, then refetch the
complete list; if refresh fails after commit, retain and stale-mark the prior
view.

**Generated contract plus shared catalogs**: Use `$api/v1.d.ts` for wire shapes
and `$shared/plugins` for permission/wiring meaning; never copy labels or infer
behavior from identifiers.

**Scoped same-origin mutation defense**: Permit absent Origin for authenticated
non-browser clients, permit exact same-origin requests, and reject
malformed/foreign browser origins before side effects; mirror
[`packages/praxrr-app/src/routes/api/v1/mcp/+server.ts`](../../../packages/praxrr-app/src/routes/api/v1/mcp/+server.ts).

**Direct route-handler tests**: Use migrated temporary DB state, typed fake
events, and `finally` restoration from
[`packages/praxrr-app/src/tests/routes/plugins.test.ts`](../../../packages/praxrr-app/src/tests/routes/plugins.test.ts).

**Svelte 5 without runes**: Use plain `let`, reactive statements, and `onclick`;
do not add `$state`, `on:click`, a global store, or dirty tracking for immediate
server mutations.

## Relevant Docs

**`docs/plans/266-plugin-management-ui/feature-spec.md`**: You _must_ read this
for accepted scope, truthful status semantics, security boundary, UX states, and
validation requirements.

**`docs/architecture/plugins.md`**: You _must_ read this when changing plugin
lifecycle, catalogs, host/service boundaries, or management behavior.

**`docs/api/v1/paths/plugins.yaml`**: You _must_ read this for exact endpoints,
responses, and feature-off semantics.

**`docs/api/v1/schemas/plugins.yaml`**: You _must_ read this for portable
fields, lifecycle/error meaning, and generated-type fidelity.

**`docs/ARCHITECTURE.md`**: You _must_ read the navigation-shell contract before
changing registry children or navigation tests.

**`docs/CONTRIBUTING.md`**: You _must_ read this for Svelte, alerts, route,
test, and formatting conventions.

**`docs/api/authentication.md`**: You _must_ read this when adding the Origin
guard so it supplements rather than replaces existing authentication.

**`ROADMAP.md`**: You _must_ read every plugin-system status entry before
marking #266 shipped; the runtime NO-GO and missing execution telemetry remain
deferred.
