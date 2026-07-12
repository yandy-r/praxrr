# Plugin Management UI (#266) Implementation Plan

Implement `/settings/plugins` as a page-local Svelte management console over the
existing redacted plugin API, with pure catalog-backed presentation helpers and
a presentation-only card. Preserve the server as the authority for durable
intent and reload ordering, add a scoped same-origin guard to the three
body-less mutation routes, and keep OpenAPI plus bundled API artifacts
synchronized. Integrate the route into Settings, cover the complete
state/race/accessibility matrix, update durable docs and `ROADMAP.md`, and never
infer runtime or recent-run evidence that the contract does not expose.

Execution occurs in the already-created worktree
`/home/yandy/Projects/github.com/yandy-r/praxrr/.claude/worktrees/266-plugin-management-ui`
on branch `feat/266-plugin-management-ui`; implementation must not create
another worktree.

## Critically Relevant Files and Documentation

- `docs/plans/266-plugin-management-ui/feature-spec.md`: Accepted product, UX,
  security, and scope decisions.
- `docs/plans/266-plugin-management-ui/shared.md`: Condensed implementation
  context and patterns.
- `docs/architecture/plugins.md`: Plugin boundaries, lifecycle, catalogs, and
  management semantics.
- `docs/api/v1/paths/plugins.yaml`: Portable endpoint contract and response
  source.
- `docs/api/v1/schemas/plugins.yaml`: Portable record/lifecycle/error meanings.
- `packages/praxrr-app/src/lib/api/v1.d.ts`: Generated browser wire types.
- `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts`: Grant labels and
  safety authority.
- `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts`: Point kind
  and wiring authority.
- `packages/praxrr-app/src/lib/server/plugins/responses.ts`: Redacted management
  projection.
- `packages/praxrr-app/src/lib/server/plugins/host.ts`: Serialized durable
  mutation/reload authority.
- `packages/praxrr-app/src/routes/api/v1/mcp/+server.ts`:
  Same/absent/foreign-Origin precedent.
- `packages/praxrr-app/src/tests/routes/plugins.test.ts`: Existing migrated
  route/DB harness.
- `packages/praxrr-app/src/routes/drift/+page.svelte`: Latest-request-wins
  page-local state pattern.
- `packages/praxrr-app/src/lib/server/navigation/registry.ts`: Canonical
  Settings child registry.
- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts`: Exact
  navigation deep links.
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`: Scope
  compatibility contract.
- `packages/praxrr-app/src/tests/e2e/specs/config-health-trends-export.spec.ts`:
  Mocked API, hostile text, and reflow pattern.
- `scripts/test.ts`: Focused test alias registry.
- `ROADMAP.md`: Plugin-system shipped/deferred source of truth.

## Implementation Plan

### Phase 1: Independent Contracts and Discovery

#### Task 1.1: Build the Pure Plugin Presentation Contract Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/266-plugin-management-ui/feature-spec.md`
- `packages/praxrr-app/src/lib/api/v1.d.ts`
- `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts`
- `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts`
- `packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts`

Files to Modify

- `scripts/test.ts`

Implement generated-type aliases, composite `(apiVersion,id.toLowerCase())`
keys, independently encoded mutation URLs, discovered-first stable sorting,
exhaustive lifecycle vocabulary, missing-row “when rediscovered” wording, and
catalog-backed capability/point views. Keep lifecycle, intent, wiring, and
unavailable execution telemetry separate and fail closed on impossible catalog
drift. Test every lifecycle/capability/point, namespace/casing collisions,
delimiter-bearing URL segments, sorting, and prohibited active/running
inferences. Add the suite to the `plugins` test alias.

**Validation**: Run the new presentation test and `deno task test plugins`; both
must pass.

#### Task 1.2: Define the Scoped Plugin Mutation Origin Guard Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/mcp/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/plugins/_errors.ts`
- `docs/api/authentication.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts`

Files to Modify

- None.

Export a pure `rejectCrossOriginPluginMutation(request, url)` returning
`Response | null`. Permit absent Origin for authenticated non-browser clients
and exact same-origin values; reject malformed, foreign, or explicit cross-site
browser requests with an empty 403 response and `Cache-Control:no-store`,
matching the MCP precedent without inventing a plugin error code. Do not echo
Origin, add CORS/auth logic, or change global CSRF settings.

**Validation**:
`deno check packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts` must pass.

#### Task 1.3: Register the Plugins Settings Destination Depends on [none]

**READ THESE BEFORE TASK**

- `docs/ARCHITECTURE.md`
- `packages/praxrr-app/src/lib/server/navigation/registry.ts`
- `packages/praxrr-app/src/routes/settings/+page.svelte`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/navigation/registry.ts`
- `packages/praxrr-app/src/routes/settings/+page.svelte`

Add a globally visible `settings.plugins` child at `/settings/plugins` and a
matching Settings-hub row with an existing Lucide icon. Keep it reachable when
the feature is off, preserve deterministic child order, and do not add a
top-level or Arr-scoped item.

**Validation**: `deno task check:client` must pass.

### Phase 2: First Consumers

#### Task 2.1: Apply Origin Protection to All Plugin Mutations Depends on [1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts`
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/disable/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/plugins/reload/+server.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/disable/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/plugins/reload/+server.ts`

Accept `request` and `url`, call the shared guard as the first handler branch,
and return rejection before identity validation, feature checks, host calls,
scans, or durable writes. Preserve all existing list/detail behavior, domain
statuses, and no-store responses.

**Validation**: `deno task check:server` must pass.

#### Task 2.2: Implement the Presentation-Only Plugin Card Depends on [1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts`
- `packages/praxrr-app/src/lib/client/ui/card/CollapsibleCard.svelte`
- `packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`
- `packages/praxrr-app/src/lib/client/ui/button/Button.svelte`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`

Files to Modify

- None.

Render exact identity, discovery, confirmed intent, lifecycle, timestamps,
lifecycle error, catalog-backed declarations/grants, deny-by-construction
safety, and “Execution telemetry unavailable in this build” as independent
facts. Use a native accessible disclosure and explicit pessimistic
Enable/Disable action rather than the self-mutating Toggle. Keep I/O/authority
in the parent, avoid nested interactive headers, use `onclick` without runes,
and render all authored/error strings as ordinary escaped text.

Pin the component contract as `plugin`, `pending`, `disabled`, optional row
error/retry inputs, and one parent-owned action callback. Never place an action
inside a disclosure button/header.

**Validation**: `deno task check:client` must pass.

#### Task 2.3: Update Both Navigation Regression Contracts Depends on [1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts`
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`
- `packages/praxrr-app/src/lib/server/navigation/registry.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts`
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`

Insert `/settings/plugins` into the exact deep-link sequence. Add a targeted
assertion that the Plugins child remains present beneath Settings for
all/Radarr/Sonarr/Lidarr scopes; keep top-level and bottom-nav expectations
unchanged.

**Validation**: Both named navigation test files must pass when run directly.

#### Task 2.4: Document the New 403 Path Contract and Regenerate App Types Depends on [1.2]

**READ THESE BEFORE TASK**

- `docs/api/v1/paths/plugins.yaml`
- `docs/api/v1/schemas/plugins.yaml`
- `deno.json`

**Instructions**

Files to Create

- None.

Files to Modify

- `docs/api/v1/paths/plugins.yaml`
- `packages/praxrr-app/src/lib/api/v1.d.ts` (generated)

Add accurate empty 403 responses for enable/disable/reload, with no content
schema or invented `PluginErrorCode`. Document same-origin browser enforcement
and absent-Origin non-browser compatibility; do not add telemetry, CORS
promises, or new operations. Run `deno task generate:api-types` and never
hand-edit the generated file.

**Validation**: Generate app types twice, run `deno task check:server`, and
prove the second generation produces no new diff.

### Phase 3: Stateful Behavior and Contract Evidence

#### Task 3.1: Prove Origin Rejection Has No Side Effects Depends on [2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/routes/plugins.test.ts`
- `packages/praxrr-app/src/tests/mcp/mcp.test.ts`
- `packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/tests/routes/plugins.test.ts`

Upgrade fake events with real `Request`/`URL` inputs. Cover same-origin and
absent-Origin success plus foreign/malformed/cross-site 403 for enable, disable,
and reload. Assert rejected toggles preserve durable intent and rejected reload
performs no scan/reconcile/live change. Preserve all existing feature-off,
namespace, redaction, persistence, and no-store coverage.

Also prove foreign Origin does not alter GET list/detail behavior.

**Validation**: The focused route test and `deno task test plugins` must pass.

#### Task 3.2: Implement the Plugin Management Page State Machine Depends on [1.1, 2.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/drift/+page.svelte`
- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts`
- `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`
- `docs/plans/266-plugin-management-ui/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/settings/plugins/+page.svelte`

Files to Modify

- None.

Load the list on mount and distinguish loading, feature-off, enabled-empty,
populated, stale, and failed states. Use request generations, per-identity
pending guards, and a global reload guard; keep confirmed state while pending
and replace only complete successful records. Handle 401 distinctly, 404/409
with refetch, stable redacted fallbacks, and reload as counters then
authoritative GET. If refresh fails after committed reload, retain/stale-mark
rows and report partial success. Combine alerts with persistent accessible
status/retry, disable row work during reload, avoid detail N+1, polling, browser
persistence, dirty tracking, and runtime inference.

Treat `{pluginsEnabled:false,reloaded:false}` as feature-off rather than a
successful scan. When `rejected > 0`, show aggregate warning/log guidance only
and never invent identities or reasons.

**Validation**: `deno task check:client` must pass.

#### Task 3.3: Regenerate and Verify the Portable API Bundle Depends on [2.4]

**READ THESE BEFORE TASK**

- `scripts/bundle-api.ts`
- `packages/praxrr-api/README.md`
- `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-api/openapi.json` (generated)
- `packages/praxrr-api/types.ts` (generated)

Run `deno task bundle:api`, format generated outputs as required, run the bundle
contract tests, then regenerate a second time and prove no drift. Preserve
workspace/mirror contract fidelity.

**Validation**: Bundle twice, run the bundle API contract test, and prove the
second bundle produces no new diff.

### Phase 4: Browser Evidence and Durable Documentation

#### Task 4.1: Add Deterministic Plugin Management Playwright Coverage Depends on [1.3, 3.2]

**READ THESE BEFORE TASK**

- `playwright.config.ts`
- `packages/praxrr-app/src/tests/e2e/specs/config-health-trends-export.spec.ts`
- `packages/praxrr-app/src/routes/settings/plugins/+page.svelte`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/e2e/specs/plugin-management.spec.ts`

Files to Modify

- None.

Intercept the plugin APIs with generated-type fixtures. Cover feature-off,
enabled-empty, discovered and retained rows, mutation success/failure, 404/409
refetch, reload counters, committed reload plus failed refresh, duplicate/stale
requests, and escaped hostile manifest/error text. Verify keyboard
disclosure/actions, stable names, busy/live status, focus, touch targets, dark
styling, and 320px reflow without a real plugin directory/runtime.

Explicitly verify feature-off reload, aggregate-only rejected privacy, focus
restoration, touch-target dimensions, dark-theme readability, and no document
overflow at 320 CSS pixels.

**Validation**: The focused Playwright spec must pass with zero failures.

#### Task 4.2: Update Plugin Architecture and Add the Operator Guide Depends on [2.1, 3.2, 3.3]

**READ THESE BEFORE TASK**

- `docs/architecture/plugins.md`
- `docs/features/README.md`
- `docs/plans/266-plugin-management-ui/feature-spec.md`

**Instructions**

Files to Create

- `docs/features/plugin-management.md`

Files to Modify

- `docs/architecture/plugins.md`

Correct stale pre-#263 call-site claims, verify point/grant tables from current
catalogs, and add the UI/redacted API/catalog/Origin-guard flow. The operator
guide must explain Settings discovery, `PLUGINS_ENABLED`/`PLUGINS_DIR`, reload
counters, missing records, intent versus lifecycle, and unavailable execution
telemetry without claiming runtime health, rejected identities, or unsupported
grants.

**Validation**: Markdown formatting and the repository docs link/build check
must pass for both files.

#### Task 4.3: Link Plugin Management from Documentation Indexes Depends on [4.2]

**READ THESE BEFORE TASK**

- `docs/README.md`
- `docs/features/README.md`
- `docs/api/endpoints.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `docs/README.md`
- `docs/features/README.md`
- `docs/api/endpoints.md`

Link the architecture/operator guide and list the management route family with
feature-off and Origin behavior. Keep links valid and avoid duplicating the
generated API reference.

**Validation**: Markdown formatting and the repository docs link/build check
must pass for all three files.

### Phase 5: Integrated Validation

#### Task 5.1: Run the Full Completion and Drift Audit Depends on [2.3, 3.1, 3.3, 4.1, 4.3]

**READ THESE BEFORE TASK**

- `deno.json`
- `scripts/test.ts`
- `docs/plans/266-plugin-management-ui/feature-spec.md`
- `docs/plans/266-plugin-management-ui/parallel-plan.md`

**Instructions**

Files to Create

- None.

Files to Modify

- None; report every defect to its owning task before rerunning this audit.

Run focused presentation, route, navigation, bundle, and Playwright tests; then
`deno task check`, `deno task lint`, `deno task test`, documentation/build
checks appropriate to changed docs, `deno task generate:api-types`,
`deno task bundle:api`, and second-pass drift comparisons. Keep all commands in
this worktree. If graph context is absent, seed ignored graph metadata into this
worktree without modifying another checkout, then run `graphify update .`;
otherwise record the tooling gap. Require zero focused/full failures,
deterministic generated output, `git diff --check`, formatted changed files,
full issue acceptance, security no-side-effects, accessibility evidence, and no
runtime/telemetry overclaims.

**Validation**: The command ladder above is the gate; do not advance until every
applicable command passes.

#### Task 5.2: Close Out ROADMAP Status Truthfully Depends on [5.1, 4.2, 4.3]

**READ THESE BEFORE TASK**

- `ROADMAP.md`
- `docs/plans/266-plugin-management-ui/feature-spec.md`
- `docs/architecture/plugins.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `ROADMAP.md`

Only after Task 5.1 is green, update every relevant #35/#266 shipped/deferred
statement and add the dated delivery entry. State that management UI,
discovery/intent controls, lifecycle evidence, and honest telemetry absence
shipped; retain compliant runtime execution and structured telemetry as deferred
after the #262 NO-GO.

**Validation**: Search all `#266`, plugin, runtime, and telemetry references for
contradictions, then run `deno fmt --check ROADMAP.md && git diff --check`.

## Advice

- Freeze Task 1.1 helper exports and Task 1.2 error shape before their consumers
  begin; this prevents UI, tests, OpenAPI, and server responses from drifting in
  parallel.
- Do not use the existing self-mutating Toggle unchanged; explicit buttons
  preserve the required pessimistic, server-confirmed state and screen-reader
  truth.
- Reload success and list-refresh success are separate outcomes. Never erase the
  committed result or confirmed rows because the second request failed.
- Lowercase only the ID for client matching; display and independently encode
  the exact returned `apiVersion` and `id` values.
- Keep the Origin guard before every side effect and prove no mutation/scan
  occurred, not merely that the status was 403.
- Treat generated app and portable API files as outputs only. Regenerate twice
  and include bundle parity tests whenever path responses change.
- The route stays visible while `PLUGINS_ENABLED` is false because the disabled
  page is part of the feature, not an error or hidden capability.
- Review every final status label against the invariant: enabled is intent,
  discovered is scan presence, `lastError` is lifecycle-only, wired is host
  metadata, and no current field proves a run.
