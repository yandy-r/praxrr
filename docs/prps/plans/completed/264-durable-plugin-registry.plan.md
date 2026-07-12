# Plan: Durable Plugin Registry and Management API

## Summary

Persist plugin discovery and enablement by API-version-qualified identity, add atomic in-process
reload/reconciliation, and expose the state through authenticated `/api/v1/plugins*` routes plus a
redacted read-only MCP tool. The implementation remains behind `PLUGINS_ENABLED`, does not expand the
runtime/capability model, and keeps the YAML, generated declarations, and packaged API artifacts in
lockstep.

## User Story

As a Praxrr administrator, I want plugin discovery and enablement to survive restarts and be
manageable through an API, so that a future management UI can operate without restarting Praxrr.

## Problem → Solution

Boot-only in-memory scan with no lifecycle API → transactional durable reconciliation, atomic
registry snapshots, authenticated management endpoints, and read-only MCP visibility.

## Metadata

- **Complexity**: XL
- **Source PRD**: `docs/prps/specs/264-durable-plugin-registry.spec.md`
- **PRD Phase**: N/A
- **Estimated Files**: 29

## Batches

Tasks grouped by dependency for parallel execution. Tasks within the same batch run concurrently;
batches run in order.

| Batch | Tasks         | Depends On | Parallel Width |
| ----- | ------------- | ---------- | -------------- |
| B1    | 1.1, 1.2, 1.3 | —          | 3              |
| B2    | 2.1, 2.2, 2.3 | B1         | 3              |
| B3    | 3.1, 3.2, 3.3 | B2         | 3              |
| B4    | 4.1, 4.2, 4.3 | B3         | 3              |
| B5    | 5.1           | B4         | 1              |

- **Total tasks**: 13
- **Total batches**: 5
- **Max parallel width**: 3

## Worktree Setup

- **Parent**: ~/.claude-worktrees/praxrr-264-durable-plugin-registry/ (branch: feat/264-durable-plugin-registry)

---

## Testing Strategy

### Unit Tests

| Test                          | Input                                        | Expected Output                                                  | Edge Case? |
| ----------------------------- | -------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| Registry snapshot replacement | Duplicate/cross-version entries              | Reject duplicate without mutating old snapshot; isolate versions | Yes        |
| Repository reconciliation     | New, missing, changed, reappearing manifests | Preserve enablement and exact identity; update discovery state   | Yes        |
| Restart persistence           | Close/reopen DB and host                     | Same enablement and metadata restored                            | Yes        |
| Host reload                   | Valid, invalid, empty, and failing scans     | Counts precise; old snapshot retained on unexpected failure      | Yes        |
| Reload concurrency            | Two callers behind a promise gate            | One scan/reconcile; both observe the same result                 | Yes        |
| HTTP management               | Every route/status and feature flag state    | OpenAPI-shaped response and correct mutation                     | Yes        |
| MCP listing                   | Disabled and populated states                | Read-only descriptor and redacted structured result              | Yes        |
| Contract lockstep             | YAML, generated declaration, package bundle  | Exact schema/property/status parity                              | Yes        |

### Edge Cases Checklist

- [ ] Empty/whitespace `apiVersion` or plugin id rejected without trimming valid persisted values
- [ ] Case variants collide only within the same API-version namespace
- [ ] Same id in two API versions remains isolated
- [ ] Empty, missing, non-directory, malformed, duplicate, and over-limit plugin scans
- [ ] Plugin disappearance and reappearance preserve enablement
- [ ] Manifest metadata update preserves enablement
- [ ] Unexpected filesystem or database failure rolls back and preserves previous memory state
- [ ] Concurrent reloads are single-flight
- [ ] Feature-off list/reload/mutations are graceful and non-mutating
- [ ] Public HTTP/MCP bytes contain no `sourceDir`, absolute plugin path, raw manifest, or planted secret
- [ ] No implicit Radarr/Sonarr/Lidarr mapping or fallback

---

## Validation Commands

### Generated Contract

```bash
deno task generate:api-types
deno task bundle:api
git diff --exit-code -- packages/praxrr-app/src/lib/api/v1.d.ts packages/praxrr-api/openapi.json packages/praxrr-api/types.ts
```

EXPECT: The second generation/bundle pass produces no diff and all three artifacts match source YAML.

### Static Analysis

```bash
deno task check
```

EXPECT: Zero server or client type errors.

### Focused Unit and Integration Tests

```bash
deno task test plugins
deno task test packages/praxrr-app/src/tests/base/bundleApiContract.test.ts
```

EXPECT: All plugin, persistence, route, MCP, and contract tests pass.

### Full Test Suite

```bash
deno task test
```

EXPECT: No regressions.

### Formatting, Lint, and Whitespace

```bash
deno task lint
deno task format:check
git diff --check
```

EXPECT: No scoped lint/format/whitespace errors and no repository gate failures.

### Database Validation

```bash
deno task test packages/praxrr-app/src/tests/db/pluginRegistryQueries.test.ts
```

EXPECT: Migration order, idempotent full migration runs, restart persistence, and reconciliation pass.

### Graph Maintenance

```bash
graphify update .
```

EXPECT: Knowledge graph update succeeds from the canonical checkout after implementation.

### Manual Validation

- [ ] Start with `PLUGINS_ENABLED=on` and a valid plugin, disable it, restart, and confirm disabled state.
- [ ] Remove the plugin, reload, confirm `discovered=false`; restore it, reload, confirm enablement retained.
- [ ] Call list/get/enable/disable/reload with authenticated API access and verify response contracts.
- [ ] Start with `PLUGINS_ENABLED=off`; verify list/reload degrade and mutations do not alter persisted rows.
- [ ] Call MCP `tools/list` and `list_plugins`; verify read-only metadata and no local path disclosure.

---

## Acceptance Criteria

- [ ] Enable/disable state and validated discovered metadata survive application/database restart.
- [ ] Admin reload rescans `PLUGINS_DIR`, reconciles missing/reappearing plugins, and publishes an atomic registry snapshot without process restart.
- [ ] `/api/v1/plugins` list/get/enable/disable/reload work, remain auth-gated, preserve API-version identity, and degrade gracefully when `PLUGINS_ENABLED` is off.
- [ ] Only enabled and currently discovered plugins are eligible for dispatch; no response claims runtime execution.
- [ ] OpenAPI YAML, runtime mappings, generated app declarations, and bundled `praxrr-api` artifacts are in lockstep.
- [ ] Read-only MCP `list_plugins` uses the shared allow-list mapper and exposes no path/raw/secret material.
- [ ] `ROADMAP.md` and plugin architecture docs accurately describe #264 and retain the #262 runtime no-go boundary.
- [ ] Issue #264's test plan plus focused DB/routes/MCP/contract tests and the full suite pass.

## Completion Checklist

- [ ] All 13 tasks completed in dependency order
- [ ] Every listed file change is implemented or explicitly removed from scope with evidence
- [ ] Migration version is unique against freshly fetched `origin/main`
- [ ] App migration is not registered in PCD base ops
- [ ] Code follows discovered repository, transaction, response, route, and test patterns
- [ ] Exact persisted identifiers/names are preserved; empty inputs are rejected
- [ ] Error handling and structured logging match the optional-subsystem contract
- [ ] Tests cover restart, disappearance/reappearance, concurrency, rollback, feature-off, and redaction
- [ ] Contract generation/bundling is reproducible with no second-pass drift
- [ ] `deno task check`, focused tests, full tests, lint/format, and `git diff --check` pass
- [ ] `ROADMAP.md`, architecture docs, and graph are updated
- [ ] No UI/runtime/observe/SDK/marketplace scope additions
- [ ] Self-contained — no implementation questions remain

## Risks

| Risk                                                | Likelihood | Impact | Mitigation                                                                           |
| --------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------ |
| Main adds migration `20260724` before merge         | M          | M      | Fetch/rebase and rebump file/import/symbol/test expectations before final validation |
| Reload failure creates empty/partial state          | M          | H      | Successful scan first, one DB transaction, atomic snapshot publication last          |
| Concurrent reload races with itself                 | M          | H      | Synchronously installed shared in-flight promise and deterministic gate test         |
| Enabled is misread as executed                      | M          | M      | Keep execution status out of this contract and document #262 runtime no-go           |
| Persisted JSON drifts from shared manifest contract | M          | H      | Validate on load/reconcile and exclude invalid rows from active snapshot             |
| Source paths leak through spread serialization      | M          | H      | One generated-type allow-list mapper plus byte-level HTTP/MCP redaction tests        |
| Contract artifacts drift                            | M          | H      | Source/bundle/generated comparison test and clean second generation pass             |

## Notes

- GitHub's live hierarchy on 2026-07-11 shows #264 has no child issues. It is one child of #267; sibling
  issues #263, #265, and #266 remain outside this plan.
- Dependency #262 is closed with a Deno/Extism runtime no-go. This plan delivers durable management
  intent and API state without representing runtime availability or execution success.
- The migration is for Praxrr's app SQLite database. The Arr cutover rule requiring
  `seedBuiltInBaseOps.ts` applies only to built-in PCD base ops and is intentionally not triggered.
- All implementation occurs in the single feature worktree named above; no child worktrees or fan-in
  merge steps are allowed.

## Patterns to Mirror

Code patterns discovered in the codebase. Follow these exactly.

### NAMESPACE_IDENTITY

```ts
// SOURCE: packages/praxrr-app/src/lib/server/plugins/registry.ts:42-48
const namespace = this.namespaceFor(manifest.apiVersion);
const key = manifest.id.toLowerCase();
if (namespace.has(key)) {
  throw new Error(
    `Duplicate plugin id '${manifest.id}' within apiVersion '${manifest.apiVersion}'`
  );
}
```

Normalize only the lookup identity. Preserve authored `apiVersion`, `id`, and `name` values exactly.

### MIGRATION_PATTERN

```ts
// SOURCE: packages/praxrr-app/src/lib/server/db/migrations/20260711_create_quality_goal_bindings.ts:19-23
CREATE TABLE quality_goal_bindings (
  database_id INTEGER NOT NULL,
  profile_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  PRIMARY KEY (database_id, profile_name, arr_type)
```

Use a new app-database migration with snake_case columns, finite checks, timestamps, and a
case-insensitive composite unique index. Do not touch PCD base ops.

### REPOSITORY_PATTERN

```ts
// SOURCE: packages/praxrr-app/src/lib/server/db/queries/qualityGoalBindings.ts:29-34
export const qualityGoalBindingQueries = {
  get(...): QualityGoalBindingRow | undefined { ... },
  upsert(input): QualityGoalBindingRow {
    db.execute(`INSERT ... ON CONFLICT ...`);
    return this.get(...);
```

Colocate row types, camelCase inputs, parameterized raw SQL, and a named `*Queries` object.

### TRANSACTION_PATTERN

```ts
// SOURCE: packages/praxrr-app/src/lib/server/db/db.ts:213-220
async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
  this.beginTransaction();
  const result = await fn();
  this.commit();
  return result;
}
```

Reconciliation is one outer transaction; its query helpers must not open nested transactions.

### SNAPSHOT_AND_SINGLE_FLIGHT

```ts
// SOURCE: packages/praxrr-app/src/lib/server/security/dnsTransport.ts:236-243
let work = this.inFlight.get(key);
if (work === undefined) {
  work = this.resolveAndCache(...);
  this.inFlight.set(key, work);
}
```

Store the reload promise before awaiting it, clear only the owning promise in `finally`, and publish
the completed registry snapshot only after the database transaction commits.

### ERROR_HANDLING

```ts
// SOURCE: packages/praxrr-app/src/lib/server/plugins/host.ts:192-200
if (!result.ok) {
  await logger.warn('Skipping plugin with invalid manifest', {
    source: LOG_SOURCE,
    meta: { dir: entry.dir, issues: result.errors }
  });
```

Expected bad manifests are isolated, counted, and skipped. Unexpected scan/database errors propagate
to the startup warn-and-continue wrapper or route error mapper without clearing the previous snapshot.

### RESPONSE_MAPPER

```ts
// SOURCE: packages/praxrr-app/src/lib/server/security/responses.ts:231-235
export function toSummaryResponse(report): SecurityPostureSummaryResponse {
  return {
    engineVersion: report.engineVersion,
    generatedAt: report.generatedAt,
```

Use a positive allow-list mapper derived from generated OpenAPI component types. Do not serialize an
internal `RegisteredPlugin` object or `sourceDir` directly.

### ROUTE_OUTCOME_MAPPING

```ts
// SOURCE: packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/recompute/+server.ts:59-63
if (outcome.kind === 'in_flight') return json(..., { status: 409 });
if (outcome.kind === 'skipped') return json(..., { status: 404 });
if (outcome.kind === 'error') return json(..., { status: 500 });
return json(toDetailResponse(outcome.report) satisfies DetailResponse);
```

Route handlers remain thin and map discriminated service outcomes to contract-defined statuses.

### TEST_STRUCTURE

```ts
// SOURCE: packages/praxrr-app/src/tests/db/syncHistoryQueries.test.ts:22-27
await db.initialize();
await runMigrations();
await fn();
db.close();
await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
```

Persistence, route, and MCP tests use isolated real SQLite files and the complete migration chain.

---

## Files to Change

| File                                                                                  | Action | Justification                                                             |
| ------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/db/migrations/20260724_create_plugin_registry.ts` | CREATE | Durable app-DB table and indexes; rebump if main's high-water changes     |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`                                 | UPDATE | Import and register the migration exactly once                            |
| `packages/praxrr-app/src/lib/server/db/queries/pluginRegistry.ts`                     | CREATE | List/get/reconcile/set-enabled repository                                 |
| `packages/praxrr-app/src/lib/server/plugins/registry.ts`                              | UPDATE | Enabled/discovered entries and atomic snapshot replacement                |
| `packages/praxrr-app/src/lib/server/plugins/host.ts`                                  | UPDATE | Serialized reload, candidate validation, reconciliation, safe publication |
| `packages/praxrr-app/src/lib/server/plugins/responses.ts`                             | CREATE | Generated-type aliases and allow-list public mapping                      |
| `packages/praxrr-app/src/lib/server/plugins/index.ts`                                 | UPDATE | Export new service/result/response types                                  |
| `docs/api/v1/openapi.yaml`                                                            | UPDATE | Register Plugins tag, paths, and component schemas                        |
| `docs/api/v1/paths/plugins.yaml`                                                      | CREATE | List/get/enable/disable/reload operations and response statuses           |
| `docs/api/v1/schemas/plugins.yaml`                                                    | CREATE | Plugin item, list/detail, reload, mutation, and error schemas             |
| `docs/api/v1/paths/mcp.yaml`                                                          | UPDATE | Document `list_plugins` in the runtime-discovered read-only surface       |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                                             | UPDATE | Generated OpenAPI declarations                                            |
| `packages/praxrr-api/openapi.json`                                                    | UPDATE | Bundled public API contract                                               |
| `packages/praxrr-api/types.ts`                                                        | UPDATE | Bundled generated declarations                                            |
| `packages/praxrr-app/src/routes/api/v1/plugins/+server.ts`                            | CREATE | Authenticated feature-aware list route                                    |
| `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/+server.ts`          | CREATE | Namespace-qualified detail route                                          |
| `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts`   | CREATE | Enable mutation route                                                     |
| `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/disable/+server.ts`  | CREATE | Disable mutation route                                                    |
| `packages/praxrr-app/src/routes/api/v1/plugins/reload/+server.ts`                     | CREATE | Admin reload route                                                        |
| `packages/praxrr-app/src/lib/server/mcp/tools.ts`                                     | UPDATE | Add direct read-only `list_plugins` handler                               |
| `packages/praxrr-app/src/tests/db/pluginRegistryQueries.test.ts`                      | CREATE | Migration, reconciliation, restart, and no-trim persistence tests         |
| `packages/praxrr-app/src/tests/plugins/registry.test.ts`                              | UPDATE | Snapshot replacement and enabled/discovered selection tests               |
| `packages/praxrr-app/src/tests/plugins/host.test.ts`                                  | UPDATE | Reload, rollback, serialization, disabled behavior, restart tests         |
| `packages/praxrr-app/src/tests/routes/plugins.test.ts`                                | CREATE | Full list/get/toggle/reload HTTP behavior                                 |
| `packages/praxrr-app/src/tests/mcp/mcp.test.ts`                                       | UPDATE | Tool count, feature-off/list behavior, redaction                          |
| `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts`                        | UPDATE | Pin source/bundle/generated plugin contract lockstep                      |
| `scripts/test.ts`                                                                     | UPDATE | Extend `plugins` alias to DB/routes/MCP targets needed by #264            |
| `docs/architecture/plugins.md`                                                        | UPDATE | Replace Phase-1 in-memory-only lifecycle description                      |
| `ROADMAP.md`                                                                          | UPDATE | Record #264 delivery while preserving runtime no-go/deferred context      |

## NOT Building

- A plugin management page or any Svelte UI (#266).
- A WASM/Extism executor or a claim that enabled means executed (#262 remains a runtime no-go).
- New observe-point wiring (#263), SDK/docs package (#265), remote install, marketplace, auto-update,
  signing, trust, provenance, or new capabilities.
- Arr-specific plugin filtering until an explicit manifest contract defines per-Arr semantics.
- Persisting or exposing unvalidated raw manifests, absolute `sourceDir` paths, credentials, or secrets.
- Any PCD schema/base-op migration or `seedBuiltInBaseOps.ts` registration.

---

## Step-by-Step Tasks

### Task 1.1: Add durable plugin storage — Depends on none

- **BATCH**: B1
- **ACTION**: Create and register the next unique app-DB migration plus a typed plugin registry query repository.
- **IMPLEMENT**: Add a table keyed by exact `api_version` plus case-insensitive `plugin_id`, validated manifest JSON, `enabled`, `discovered`, lifecycle/error fields, and timestamps. Implement parameterized list/get/set-enabled and one transaction-safe reconcile that marks missing rows undiscovered, upserts current manifests while preserving existing enablement, and returns the committed rows.
- **MIRROR**: `MIGRATION_PATTERN`, `REPOSITORY_PATTERN`, and `TRANSACTION_PATTERN`.
- **IMPORTS**: `Migration`, `db`, shared plugin manifest/lifecycle types, `validatePluginManifest`.
- **GOTCHA**: Recheck main's migration high-water before PR; do not trim persisted identifiers; do not register an app table in PCD base ops; do not nest transactions.
- **VALIDATE**: `deno check packages/praxrr-app/src/lib/server/db/queries/pluginRegistry.ts packages/praxrr-app/src/lib/server/db/migrations/20260724_create_plugin_registry.ts`

### Task 1.2: Define and generate the plugin API contract — Depends on none

- **BATCH**: B1
- **ACTION**: Add modular OpenAPI paths/schemas for list, get, enable, disable, and reload, then regenerate and bundle all contract artifacts.
- **IMPLEMENT**: Include `pluginsEnabled`, API-version-qualified identity, manifest metadata, `enabled`, `discovered`, lifecycle/error/timestamps, reload counters, and explicit disabled/not-found/conflict/error responses. Mount every path in the root spec, export the schema family, update the MCP description, run generation followed by bundling, and format the generated JSON.
- **MIRROR**: `docs/api/v1/paths/canary.yaml`, `docs/api/v1/schemas/canary.yaml`, and the contract pipeline in `docs/api/v1/openapi.yaml`.
- **IMPORTS**: OpenAPI `$ref` paths only.
- **GOTCHA**: The bundler imports a schema file only after a root component references it; generated `v1.d.ts`, package `openapi.json`, and package `types.ts` must all be committed.
- **VALIDATE**: `deno task generate:api-types && deno task bundle:api && git diff --exit-code -- packages/praxrr-app/src/lib/api/v1.d.ts packages/praxrr-api/openapi.json packages/praxrr-api/types.ts` after a second generation/bundle run.

### Task 1.3: Make registry snapshots lifecycle-aware — Depends on none

- **BATCH**: B1
- **ACTION**: Extend the in-memory registry model for durable state and atomic full-snapshot replacement.
- **IMPLEMENT**: Add explicit `enabled` and `discovered` fields, preserve API-version namespace/case-insensitive identity, provide a candidate/snapshot replacement API, and ensure point selection includes only enabled+discovered entries. Keep `sourceDir` internal and update the server barrel exports.
- **MIRROR**: `NAMESPACE_IDENTITY` and `SNAPSHOT_AND_SINGLE_FLIGHT`.
- **IMPORTS**: Existing shared plugin types only; no DB import in the pure registry container.
- **GOTCHA**: Replacement must reject duplicate keys before mutating current state; a wrong API-version lookup never falls back to the current version.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/plugins/registry.test.ts`

### Task 2.1: Implement serialized host reconciliation and reload — Depends on 1.1, 1.3

- **BATCH**: B2
- **ACTION**: Refactor `PluginHost` to build a validated candidate, reconcile it transactionally, and publish a replacement registry snapshot through one serialized initialize/reload path.
- **IMPLEMENT**: Return a typed summary for enabled/disabled reloads, preserve the prior in-memory snapshot on unexpected scan/DB failure, retain per-manifest skip-and-log behavior, and make concurrent callers share one in-flight promise. `reset()` remains an explicit memory clear, while reload no longer clears first.
- **MIRROR**: `ERROR_HANDLING`, `SNAPSHOT_AND_SINGLE_FLIGHT`, and the existing host completion log.
- **IMPORTS**: `pluginRegistryQueries`, extended `PluginRegistry` types, scanner, validator, config/logger.
- **GOTCHA**: Feature-off reload must not scan or mutate; a missing plugin directory is a successful empty reconciliation, but an unexpected filesystem error must not mark all rows missing.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/plugins/host.test.ts`

### Task 2.2: Create the shared redacted plugin service/response boundary — Depends on 1.1, 1.2

- **BATCH**: B2
- **ACTION**: Add generated-type aliases and allow-list mappers/services for list, get, toggle, and reload route consumption.
- **IMPLEMENT**: Map durable rows to public manifest/state objects without `sourceDir` or raw JSON, expose feature-off list semantics, and return discriminated outcomes for disabled, not-found, conflict/in-flight, and success cases. Reuse this boundary from HTTP and MCP.
- **MIRROR**: `RESPONSE_MAPPER` and `ROUTE_OUTCOME_MAPPING`.
- **IMPORTS**: `components` from `$api/v1.d.ts`, config, plugin queries/host, shared plugin manifest types.
- **GOTCHA**: Runtime validators and mapped fields must exactly match generated OpenAPI fields; never spread a DB row or internal registry entry into a response.
- **VALIDATE**: `deno check packages/praxrr-app/src/lib/server/plugins/responses.ts`

### Task 2.3: Pin migration, repository, and registry behavior — Depends on 1.1, 1.3

- **BATCH**: B2
- **ACTION**: Add real-SQLite persistence tests and extend registry unit tests.
- **IMPLEMENT**: Cover migration registration/order, first discovery defaults, restart persistence, enable/disable survival, missing/reappearing reconciliation, manifest update with preserved decision, case-insensitive identity, API-version isolation, no-trim fidelity, malformed persisted JSON rejection, atomic replacement, and enabled/discovered point filtering.
- **MIRROR**: `TEST_STRUCTURE` plus existing `registry.test.ts` namespace assertions.
- **IMPORTS**: `runMigrations`, `db`, `config`, plugin queries/registry, std assertions.
- **GOTCHA**: Restore global DB/config state in `finally`; prove exact stored strings, not merely case-insensitive lookup success.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/db/pluginRegistryQueries.test.ts packages/praxrr-app/src/tests/plugins/registry.test.ts`

### Task 3.1: Implement authenticated plugin management routes — Depends on 2.1, 2.2

- **BATCH**: B3
- **ACTION**: Add thin SvelteKit handlers for list, get, enable, disable, and reload.
- **IMPLEMENT**: Parse path parameters without trimming persisted identity, reject empty values, call the shared service, and map outcomes to the OpenAPI statuses. Rely on the existing hook for authentication and emit `no-store` on management reads/responses where state can change.
- **MIRROR**: `ROUTE_OUTCOME_MAPPING` and existing `/api/v1/config-health` route handlers.
- **IMPORTS**: SvelteKit `json`/`RequestHandler`, plugin service/response types.
- **GOTCHA**: Do not infer `PLUGIN_API_VERSION` or sibling Arr semantics; route identity must remain `(apiVersion, id)` and plugin routes must not join public-path allowlists.
- **VALIDATE**: `deno check packages/praxrr-app/src/routes/api/v1/plugins/**/*.ts`

### Task 3.2: Add read-only MCP plugin parity — Depends on 2.2

- **BATCH**: B3
- **ACTION**: Register a closed-input `list_plugins` MCP tool using the same feature-aware redacted list mapper.
- **IMPLEMENT**: Add one `TOOLS` entry with `readOnlyHint: true`, no mutation arguments or handler, and direct service invocation. Update MCP tests for the tool count, descriptor, disabled behavior, persisted plugin listing, and serialized absence of source paths/raw manifest material.
- **MIRROR**: The `TOOLS` registry and final serializer redaction pattern.
- **IMPORTS**: Plugin list service/mapper; existing MCP types only.
- **GOTCHA**: MCP is runtime-discovered, so no new dispatch case exists; safety rests on the absence of write tools, not just the annotation.
- **VALIDATE**: `deno task test mcp`

### Task 3.3: Update test routing, architecture docs, and roadmap — Depends on 2.1, 2.2

- **BATCH**: B3
- **ACTION**: Extend the `plugins` test alias and document the delivered durable lifecycle in architecture and `ROADMAP.md`.
- **IMPLEMENT**: Make the alias cover shared/plugin, DB, route, and relevant MCP tests. Update architecture diagrams/text from strictly in-memory to durable-reconciled management while preserving the sole-I/O/redaction boundary; add a dated roadmap delivery entry and update the deferred status language honestly around #262's runtime no-go.
- **MIRROR**: Existing `scripts/test.ts` feature aliases, `docs/architecture/plugins.md`, and dated ROADMAP delivery rows.
- **IMPORTS**: None.
- **GOTCHA**: Do not claim the runtime executes plugins or mark sibling #263/#265/#266 complete; note #264 has no GitHub child issues.
- **VALIDATE**: `deno task test plugins` and `npx prettier --check scripts/test.ts docs/architecture/plugins.md ROADMAP.md`

### Task 4.1: Test host reload safety and restart semantics — Depends on 2.1, 3.1

- **BATCH**: B4
- **ACTION**: Expand host tests for the durable lifecycle and single-flight reload behavior.
- **IMPLEMENT**: Cover boot restore, enabled-only dispatch, feature-off no-op, missing-directory empty reconciliation, enable/disable across host instances, concurrent reload sharing, manifest rejection counts, and unexpected scan/reconcile failure preserving the previous registry and database state.
- **MIRROR**: Injected scan dependency tests and manually released promise gates from `TEST_STRUCTURE` research.
- **IMPORTS**: Host/registry/query modules, temp filesystem helpers, std assertions.
- **GOTCHA**: Tests that alter singleton registry, config, executor, or database must restore them even on failure.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/plugins/host.test.ts`

### Task 4.2: Test every HTTP management contract — Depends on 3.1

- **BATCH**: B4
- **ACTION**: Add migrated route tests for all endpoint success and failure paths.
- **IMPLEMENT**: Exercise feature-off list/reload/mutation, list/get success, exact namespace lookup, empty/missing identity, not found, enable, disable, reload discovery/removal/reappearance, no-store headers, response field allow-listing, and route authentication classification without adding a public path.
- **MIRROR**: Migrated route fixture in `packages/praxrr-app/src/tests/routes/configHealth.test.ts`.
- **IMPORTS**: Route handlers, config/db/migrations, plugin host/query modules, std assertions.
- **GOTCHA**: `config.pluginsEnabled` is constructor-cached; use the repository's test override/injection pattern rather than relying on late environment mutation.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/routes/plugins.test.ts`

### Task 4.3: Pin portable contract fidelity — Depends on 1.2, 3.1, 3.2

- **BATCH**: B4
- **ACTION**: Extend bundle contract tests to compare plugin source schemas, bundled schemas, generated samples, and live route/MCP fields.
- **IMPLEMENT**: Assert required properties/enums/status responses and prove a second generate+bundle run is clean. Include byte-level assertions that absolute source directories and planted secret-like raw fields never appear in HTTP or MCP output.
- **MIRROR**: Existing `bundleApiContract.test.ts` source/bundle/generated comparison and MCP redaction tests.
- **IMPORTS**: YAML parser, generated component types, route/MCP helpers, std assertions.
- **GOTCHA**: Contract tests must fail if only one of YAML, generated declarations, or package bundle changes.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/base/bundleApiContract.test.ts packages/praxrr-app/src/tests/routes/plugins.test.ts packages/praxrr-app/src/tests/mcp/mcp.test.ts`

### Task 5.1: Run completion validation and drift audit — Depends on 4.1, 4.2, 4.3

- **BATCH**: B5
- **ACTION**: Run focused, contract, static, formatting, whitespace, full-suite, and graph update gates; resolve every scoped failure.
- **IMPLEMENT**: Re-fetch/rebase main before final migration-number audit, rerun generation/bundling and verify no drift, then run every command below. Update `graphify-out` from the canonical checkout after code changes without adding its ignored artifacts to the PR.
- **MIRROR**: Repository commands in `CLAUDE.md` and the issue #264 test plan.
- **IMPORTS**: None.
- **GOTCHA**: A narrow plugin test is not evidence for the full contract or suite; distinguish but do not ignore unrelated pre-existing noise, and never merge with a scoped failure.
- **VALIDATE**: All commands in `Validation Commands` complete with their stated expectations.

---

## UX Design

### Before

```text
boot -> scan PLUGINS_DIR -> in-memory registry -> restart required for every change
```

### After

```text
boot/admin reload -> validate complete scan -> transactional reconcile -> atomic registry snapshot
admin/API/MCP     -> redacted durable state (feature flag explicit; source paths never exposed)
```

### Interaction Changes

| Touchpoint   | Before               | After                                                   | Notes                           |
| ------------ | -------------------- | ------------------------------------------------------- | ------------------------------- |
| Startup      | Rebuilds only memory | Reconciles durable rows, then publishes memory snapshot | Still warn-and-continue         |
| Admin reload | Process restart      | `POST /api/v1/plugins/reload`                           | Serialized/single-flight        |
| Enablement   | Not available        | Explicit API-version-qualified enable/disable           | Persists across absence/restart |
| Read API     | None                 | List/get with `pluginsEnabled` state                    | Existing hook provides auth     |
| MCP          | No plugin visibility | Read-only `list_plugins`                                | Same redacted mapper as HTTP    |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority       | File                                                           | Lines   | Why                                                    |
| -------------- | -------------------------------------------------------------- | ------- | ------------------------------------------------------ |
| P0 (critical)  | `docs/prps/specs/264-durable-plugin-registry.spec.md`          | all     | Authoritative scope and resolved design decisions      |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/plugins/registry.ts`       | all     | Existing API-version namespace and identity rules      |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/plugins/host.ts`           | all     | Discovery, degradation, dispatch, and logging boundary |
| P0 (critical)  | `packages/praxrr-app/src/lib/shared/plugins/validator.ts`      | all     | Exact no-trim validation contract                      |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/db/migrations.ts`          | 1-418   | Migration registration/high-water ordering             |
| P1 (important) | `packages/praxrr-app/src/lib/server/db/db.ts`                  | 103-226 | Parameterized queries and transaction wrapper          |
| P1 (important) | `docs/api/v1/openapi.yaml`                                     | all     | Modular path/schema registration                       |
| P1 (important) | `packages/praxrr-app/src/lib/server/mcp/tools.ts`              | 123-427 | Static read-only tool registry and handler pattern     |
| P1 (important) | `packages/praxrr-app/src/hooks.server.ts`                      | 42-75   | Migration-before-plugin startup and graceful failure   |
| P2 (reference) | `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts` | 181-213 | Source/bundle/generated contract-lockstep test pattern |
| P2 (reference) | `packages/praxrr-app/src/tests/mcp/mcp.test.ts`                | all     | Migrated fixture and secret-redaction assertions       |

## External Documentation

No external research needed. The feature uses repository-native SQLite, SvelteKit, OpenAPI, and MCP
patterns without adding a library or runtime dependency.

---
