# Task Structure Analysis: 266 Plugin Management UI

## Executive Summary

Implement #266 as four dependency chains that converge late: (1) pure
presentation contract to card/page UI, (2) feature-local Origin guard to route
application and route tests, (3) navigation registration to navigation
regressions, and (4) API/operator documentation after behavior is fixed. The
chains are largely file-disjoint and can run in parallel, but each task should
own only 1-3 files and leave repository-wide formatting, full validation,
roadmap closeout, and graph refresh to a final integration task.

No task should add a database migration, new API operation, global client store,
`+page.server.ts`, runtime executor, invocation telemetry, polling, or a detail
N+1 flow. The existing generated plugin record, redacted response service, host
queue, and shared catalogs remain authoritative.

## Recommended Phase Structure

### Phase 1: Independent foundations

Run these concurrently because they have disjoint ownership and no source
dependency on each other:

- **T1 — Pure presentation contract and unit tests**
- **T2 — Scoped plugin mutation Origin guard**
- **T5 — Settings navigation registration**

Phase 1 fixes the interfaces used by downstream tasks: UI helpers, the server
guard signature, and the final navigation child identity/order.

### Phase 2: First consumers

Run dependency-ready tasks concurrently:

- **T3 — Apply Origin guard to all unsafe plugin routes** depends on T2.
- **T6 — PluginCard presentation component** depends on T1.
- **T8 — Navigation regression tests** depends on T5.
- **T10 — Document Origin behavior in OpenAPI** depends on T2's stable 403
  behavior.

These tasks remain file-disjoint. T3 deliberately owns all three mutation route
files so guard placement is consistent. T8 owns both named navigation tests so
exact order and targeted child coverage are reviewed together.

### Phase 3: Stateful route and server regression evidence

- **T4 — Mutation Origin/no-side-effect route tests** depends on T2 and T3.
- **T7 — Management page orchestration** depends on T1 and T6.

T4 and T7 can run concurrently. They touch unrelated server-test and UI-page
surfaces. T7 should be the only task that owns browser request orchestration and
authoritative page state.

### Phase 4: End-to-end and durable documentation

- **T9 — Plugin management Playwright coverage** depends on T7 and T5.
- **T11 — Plugin architecture and operator guide** depends on T7, T3, and T10.
- **T12 — Documentation indexes and API reference navigation** depends on T10
  and T11.
- **T13 — ROADMAP status closeout** depends on T4, T7, T8, T9, T10, and T11.

T9 and T11 may run in parallel. T12 waits for the final guide path/title. T13 is
intentionally late so the roadmap cannot claim the UI/security work shipped
before implementation evidence exists.

### Phase 5: Integration validation

- **T14 — Cross-cutting validation and graph refresh** depends on every
  implementation/docs task.

This task should make no feature-design changes. It resolves
formatting/type/test integration only, runs the complete validation ladder,
checks the final diff for scope/wording truthfulness, and updates the knowledge
graph if available.

## Task Granularity Recommendations

### T1 — Pure presentation contract and focused unit tests

**Goal:** Encode correctness-heavy identity, endpoint, lifecycle, catalog,
sorting, and wording rules without network or Svelte state.

**Owned files (3):**

- Create `packages/praxrr-app/src/routes/settings/plugins/presentation.ts`
- Create
  `packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts`
- Modify `scripts/test.ts`

**Required behavior:**

- Derive `PluginRecord` and related types from `$api/v1.d.ts`.
- Build a collision-safe composite key from exact `apiVersion` and lower-cased
  `id`.
- Encode `apiVersion` and `id` independently in enable/disable URLs.
- Resolve all capability and extension-point metadata from `$shared/plugins`; no
  copied policy labels.
- Keep discovery, durable intent, lifecycle, lifecycle error, wiring, and
  unavailable execution evidence separate.
- Provide retained-record “when rediscovered” wording and stable
  discovered-first/name/identity sort.
- Add the new presentation test to the existing `plugins` test alias.

**Validation:**

```bash
deno task test packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts
deno task test plugins
deno fmt --check packages/praxrr-app/src/routes/settings/plugins/presentation.ts packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts scripts/test.ts
```

### T2 — Scoped plugin mutation Origin guard

**Goal:** Define one pure, redacted same-origin decision for the plugin route
family.

**Owned files (1):**

- Create `packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts`

**Required behavior:**

- Export
  `rejectCrossOriginPluginMutation(request: Request, url: URL): Response | null`.
- Permit absent Origin for authenticated non-browser clients.
- Permit a parsed Origin only when its `.origin` exactly equals `url.origin`.
- Reject malformed/foreign Origin with stable 403 output that does not echo
  submitted values.
- Optionally reject explicit `Sec-Fetch-Site: cross-site`, but never require
  fetch metadata.
- Do not add CORS headers, auth logic, global CSRF changes, or read-route
  behavior.

**Validation:** type/format checking is sufficient here; behavioral coverage
belongs to T4 after route application.

```bash
deno check packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts
deno fmt --check packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts
```

### T3 — Apply the guard to all unsafe plugin routes

**Goal:** Reject unsafe browser requests before validation, feature checks, host
calls, scanning, or durable writes.

**Depends on:** T2.

**Owned files (3):**

- Modify
  `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts`
- Modify
  `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/disable/+server.ts`
- Modify `packages/praxrr-app/src/routes/api/v1/plugins/reload/+server.ts`

**Required behavior:** Each `POST` receives `{ request, url, ... }`, calls the
shared guard as its first branch, and immediately returns a rejection.
List/detail routes and all existing no-store/domain outcomes remain unchanged.

**Validation:**

```bash
deno task check:server
deno fmt --check 'packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts' 'packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/disable/+server.ts' packages/praxrr-app/src/routes/api/v1/plugins/reload/+server.ts
```

### T4 — Mutation Origin and no-side-effect route tests

**Goal:** Prove the guard policy on every mutation shape and preserve existing
API regressions.

**Depends on:** T2, T3.

**Owned files (1):**

- Modify `packages/praxrr-app/src/tests/routes/plugins.test.ts`

**Required behavior:**

- Update typed fake events to include real `Request` and `URL` inputs without
  weakening handler typing.
- Cover same-origin pass, absent-Origin CLI pass, malformed-Origin 403, and
  foreign-Origin 403 for enable, disable, and reload.
- Assert rejected enable/disable preserves the durable enabled value.
- Assert rejected reload performs no scan/reconcile or durable/live snapshot
  change.
- Preserve feature-off, exact namespace, case-insensitive ID, redaction, reload
  retention, and `Cache-Control: no-store` coverage.

**Validation:**

```bash
deno task test packages/praxrr-app/src/tests/routes/plugins.test.ts
deno task test plugins
```

### T5 — Register the Settings destination

**Goal:** Make the route globally discoverable, including while
`PLUGINS_ENABLED` is off.

**Owned files (2):**

- Modify `packages/praxrr-app/src/lib/server/navigation/registry.ts`
- Modify `packages/praxrr-app/src/routes/settings/+page.svelte`

**Required behavior:** Add `settings.plugins` as a child of the existing
Settings parent with stable order and `/settings/plugins`; add the equivalent
Settings-hub row using an existing Lucide icon and truthful management
description. Do not feature-gate or add a top-level nav item.

**Validation:**

```bash
deno task check:client
deno fmt --check packages/praxrr-app/src/lib/server/navigation/registry.ts packages/praxrr-app/src/routes/settings/+page.svelte
```

### T6 — Presentation-only PluginCard

**Goal:** Render one durable plugin as accessible, responsive, independent facts
and expose a stable enable/disable action contract to the parent.

**Depends on:** T1.

**Owned files (1):**

- Create
  `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`

**Required behavior:**

- Accept a generated `PluginRecord`, pending/disabled state, inline error/retry
  state, and callback/ event owned by the page; never fetch or retain a second
  authoritative copy.
- Use native disclosure/action controls with stable plugin-specific accessible
  names.
- Render exact identity, metadata, discovery, confirmed intent, lifecycle,
  catalog-backed point/grant facts, lifecycle error, timestamps, and “Execution
  telemetry unavailable in this build.”
- Treat `registered` neutrally; use visible text in addition to color.
- Render all authored/error content via ordinary interpolation only; no
  `{@html}`.
- Use Svelte 5 without runes and new-code `onclick` convention.

**Validation:**

```bash
deno task check:client
deno fmt --check packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte
```

### T7 — Management page state machine and API orchestration

**Goal:** Implement the complete `/settings/plugins` operator workflow over
existing endpoints.

**Depends on:** T1, T6.

**Owned files (1):**

- Create `packages/praxrr-app/src/routes/settings/plugins/+page.svelte`

**Required behavior:**

- Load `GET /api/v1/plugins` on mount via relative URLs and generated response
  types.
- Distinguish initial loading, failed load, feature-off, enabled-empty,
  populated, pending, stale, and recoverable error states.
- Keep confirmed records visible during work and replace a complete row only
  from a successful mutation response.
- Guard per-identity mutation and global reload concurrency; use request
  generation (and optionally abort) to prevent stale list responses overwriting
  newer state.
- On 404 preserve/refetch; on 409 refetch into feature-off; otherwise retain row
  and offer retry.
- Execute reload as POST, announce all counters, then refetch. If refetch fails
  after commit, retain old rows, mark stale, and say reload completed but
  refresh failed.
- Use `alertStore` plus persistent inline/live status, `aria-busy`, and no dirty
  store.
- Disable row mutations during global reload to match the server's serialized
  semantics.
- Do not call detail per record, poll, persist browser state, or infer
  runtime/run status.

**Validation:**

```bash
deno task check:client
deno fmt --check packages/praxrr-app/src/routes/settings/plugins/+page.svelte
```

### T8 — Navigation regression coverage

**Goal:** Prove the new child is stable and globally scope-compatible without
altering top-level nav semantics.

**Depends on:** T5.

**Owned files (2):**

- Modify `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts`
- Modify `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`

**Required behavior:** Add `/settings/plugins` to the exact deep-link sequence.
In the scope test, add a targeted assertion that `settings.plugins` remains a
child for `all`, Radarr, Sonarr, and Lidarr; do not manufacture changes to
top-level/bottom-nav snapshots.

**Validation:**

```bash
deno task test packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts
deno task test packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts
```

### T9 — Deterministic Playwright management coverage

**Goal:** Exercise the browser-visible state machine, accessibility,
responsiveness, and escaped authored content without requiring a real plugin
directory.

**Depends on:** T5, T7.

**Owned files (1):**

- Create `packages/praxrr-app/src/tests/e2e/specs/plugin-management.spec.ts`

**Required behavior:** Use generated schema types and route interception to
cover feature-off, enabled-empty, populated/retained records, enable/disable
success and failure, 404/409 refetch, reload counters, committed reload plus
failed refetch/stale UI, and stale response ordering. Include keyboard access,
stable accessible names, `aria-live`/busy behavior, 320 CSS-pixel reflow, and
hostile manifest/error strings proving escaped text/no injected DOM.

**Validation:**

```bash
deno task test:e2e -- packages/praxrr-app/src/tests/e2e/specs/plugin-management.spec.ts
```

If the task wrapper does not forward Playwright arguments, use the repository's
Playwright command with the single spec path while the E2E server is running.

### T10 — Document the scoped 403 contract and regenerate types

**Goal:** Keep portable path documentation and generated client types aligned
with the new route behavior without changing plugin data models.

**Depends on:** T2.

**Owned files (2):**

- Modify `docs/api/v1/paths/plugins.yaml`
- Regenerate `packages/praxrr-app/src/lib/api/v1.d.ts`

**Required behavior:** Document 403 for enable/disable/reload as malformed or
foreign browser Origin, state that absent Origin remains valid for authenticated
non-browser clients, and reuse the stable response actually chosen in T2. Do not
add a new endpoint, telemetry field, CORS promise, or change the existing plugin
schemas unless generator validation proves a schema is required.

**Validation:**

```bash
deno task generate:api-types
git diff --exit-code -- packages/praxrr-app/src/lib/api/v1.d.ts
deno task check:server
```

The `git diff --exit-code` check is run only after regeneration has produced and
staged/accepted the expected generated change, or by regenerating a second time
to prove determinism.

### T11 — Update plugin architecture and add operator guide

**Goal:** Make durable documentation match current #263/#264/#266 reality
without implying runtime delivery.

**Depends on:** T3, T7, T10.

**Owned files (2):**

- Modify `docs/architecture/plugins.md`
- Create `docs/features/plugin-management.md`

**Required behavior:**

- Correct stale “zero/no production call-site” statements: the two observe
  producers are wired, but dispatch remains inert through
  `UnavailablePluginExecutor` until a compliant runtime ships.
- Verify extension point kinds/grants against current shared catalogs.
- Add the UI/redacted API/catalog data flow and scoped Origin guard boundary.
- Explain route discovery, `PLUGINS_ENABLED`/`PLUGINS_DIR`, reload counters,
  retained missing records, durable intent versus discovery/lifecycle, and
  unavailable execution telemetry.
- Do not document rejected identities/details, runtime readiness, last run, or
  unsupported grants.

**Validation:** targeted format/link checks available in the docs workflow, plus
manual comparison to the generated schema and shared catalogs.

### T12 — Documentation indexes and general API references

**Goal:** Make the operator guide and plugin API discoverable from existing
documentation maps.

**Depends on:** T10, T11.

**Owned files (3):**

- Modify `docs/README.md`
- Modify `docs/features/README.md`
- Modify `docs/api/endpoints.md`

**Required behavior:** Link the plugin architecture/operator guide and list the
management route family with feature-off and Origin behavior. If general error
guidance requires a plugin-specific 403 entry, substitute `docs/api/errors.md`
for one of these files or create a separate 1-file task; do not exceed three
files in one ownership unit.

**Validation:** run the repository docs link/build check if available; otherwise
verify every new relative link and OpenAPI path manually.

### T13 — ROADMAP closeout

**Goal:** Record completed management UI while preserving the runtime NO-GO and
telemetry gap.

**Depends on:** T4, T7, T8, T9, T10, T11.

**Owned files (1):**

- Modify `ROADMAP.md`

**Required behavior:** Update all relevant #35/#266 locations consistently:
dated shipped entry, deferred narrative, status table, advanced-capability
checklist, and deferred watchlist. State that the UI manages discovery/durable
intent and displays lifecycle evidence; explicitly retain compliant runtime
execution and structured telemetry as deferred. Remove “#266 incomplete” only
after its tests and security guard pass.

**Validation:** search the full file for `#266`, `plugin`, `runtime`, and
`telemetry` to catch contradictory old claims; run Markdown formatting checks.

### T14 — Cross-cutting validation and graph refresh

**Goal:** Integrate all completed tasks and prove repository health without
expanding scope.

**Depends on:** T1-T13.

**Owned files:** No planned feature files. Only minimal integration corrections
in the owning task's files; route conflicting fixes back to the prior owner when
parallel agents remain active.

**Validation ladder:**

```bash
deno task test packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts
deno task test packages/praxrr-app/src/tests/routes/plugins.test.ts
deno task test packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts
deno task test packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts
deno task test plugins
deno task check
deno task lint
deno task test
deno task test:e2e -- packages/praxrr-app/src/tests/e2e/specs/plugin-management.spec.ts
deno task generate:api-types
graphify update .
git diff --check
```

Run `graphify update .` only when graphify output/tooling exists in the
implementation checkout; the current planning worktree has no `graphify-out/`.
Regenerate API types a second time and ensure no new diff to prove contract
determinism.

## Dependency Analysis

```text
T1 presentation helpers/tests ──> T6 PluginCard ──> T7 page ──> T9 E2E ──┐
                                                                      │
T2 Origin guard ──> T3 route application ──> T4 route security tests ─┤
       └──────────────────────────────> T10 OpenAPI/types ─────────────┤
                                                                      ├─> T13 ROADMAP
T5 nav registration ──> T8 navigation tests ──────────────────────────┤
       └──────────────────────────────> T9 E2E ────────────────────────┤
                                                                      │
T3 + T7 + T10 ──> T11 architecture/operator docs ──> T12 indexes ────┘

T1-T13 ──> T14 full integration validation
```

### Critical path

The longest functional path is `T1 -> T6 -> T7 -> T9 -> T13 -> T14`. Begin T1
immediately and keep T6's component contract narrow so page orchestration is not
delayed. The security path `T2 -> T3 -> T4` is shorter but is a merge gate
because browser mutation exposure cannot ship without it.

### Hard merge gates

- T4 foreign/malformed-Origin and no-side-effect evidence.
- T7 truthful state semantics and authoritative reload/refetch behavior.
- T8 both named navigation regressions.
- T9 escaped-text, keyboard, narrow viewport, and stale/error browser evidence.
- T10 OpenAPI/runtime fidelity for the new 403 behavior.
- T13 no runtime/telemetry overclaim.
- T14 type/lint/unit/E2E and diff cleanliness.

## File-to-Task Mapping

| File                                                | Owner task | Change type         |
| --------------------------------------------------- | ---------- | ------------------- |
| `routes/settings/plugins/presentation.ts`           | T1         | Create              |
| `tests/routes/pluginManagementPresentation.test.ts` | T1         | Create              |
| `scripts/test.ts`                                   | T1         | Modify plugin alias |
| `routes/api/v1/plugins/_origin.ts`                  | T2         | Create              |
| `plugins/.../enable/+server.ts`                     | T3         | Modify              |
| `plugins/.../disable/+server.ts`                    | T3         | Modify              |
| `plugins/reload/+server.ts`                         | T3         | Modify              |
| `tests/routes/plugins.test.ts`                      | T4         | Modify              |
| `lib/server/navigation/registry.ts`                 | T5         | Modify              |
| `routes/settings/+page.svelte`                      | T5         | Modify              |
| `settings/plugins/components/PluginCard.svelte`     | T6         | Create              |
| `settings/plugins/+page.svelte`                     | T7         | Create              |
| `tests/base/navigationShellLayout.test.ts`          | T8         | Modify              |
| `tests/base/navigationScopeFiltering.test.ts`       | T8         | Modify              |
| `tests/e2e/specs/plugin-management.spec.ts`         | T9         | Create              |
| `docs/api/v1/paths/plugins.yaml`                    | T10        | Modify              |
| `lib/api/v1.d.ts`                                   | T10        | Regenerate          |
| `docs/architecture/plugins.md`                      | T11        | Modify              |
| `docs/features/plugin-management.md`                | T11        | Create              |
| `docs/README.md`                                    | T12        | Modify              |
| `docs/features/README.md`                           | T12        | Modify              |
| `docs/api/endpoints.md`                             | T12        | Modify              |
| `ROADMAP.md`                                        | T13        | Modify              |

No source file has multiple task owners. `T14` is an integration gate, not a
second owner.

## Safe Parallel Batches

| Batch | Tasks           | Why safe                                                                               |
| ----- | --------------- | -------------------------------------------------------------------------------------- |
| A     | T1, T2, T5      | Disjoint helper/test-script, server guard, and navigation files                        |
| B     | T3, T6, T8, T10 | Each consumes a completed foundation and owns disjoint route/component/test/docs files |
| C     | T4, T7          | Server route test and client page have no overlap                                      |
| D     | T9, T11         | E2E spec and durable docs are disjoint after behavior stabilizes                       |
| E     | T12             | Waits for final guide path and API wording                                             |
| F     | T13             | Late single-owner product-status closeout                                              |
| G     | T14             | Serial final validation/integration                                                    |

Agents must not run `deno task format` during parallel batches because it can
rewrite files owned by other tasks. Use targeted `deno fmt --check`/Prettier
checks during task work; reserve any required write-formatting for the file
owner or final serial integration.

## Optimization Opportunities

- T1's exhaustive catalog tests replace duplicated UI assertions and give T6/T7
  stable pure inputs.
- T2 centralizes a policy that would otherwise be copied across three handlers;
  T3 can then be a mechanical, easily reviewed integration.
- T5/T8 can finish independently of UI/API work, reducing the critical path.
- T9 should intercept the five existing API routes instead of building a real
  plugin filesystem E2E fixture; server persistence/security is already covered
  more deterministically by T4.
- T10 changes only path responses and generated output; avoid touching plugin
  data schemas unless the selected stable 403 body genuinely requires it.
- T11 and T12 split durable content from indexes to keep each task below three
  files and prevent documentation link names changing concurrently.

## Implementation Strategy Recommendations

- Freeze the T1 helper exports and T6 component props before T7 begins;
  downstream UI changes should not move fetch/state logic into the card or
  helpers.
- Freeze the T2 403 response shape before T3, T4, and T10 begin so runtime,
  tests, and OpenAPI cannot drift.
- Keep route tests in the existing migrated harness; do not create a second DB
  fixture framework.
- Treat `PluginReloadResponse` as counters only. The authoritative list always
  comes from the second GET, and partial refresh failure is a distinct
  success-plus-stale state.
- Preserve exact authored display values. Lower-case only for identity matching;
  independently encode raw route segments.
- Keep the page discoverable while feature-off and do not introduce client-only
  authorization.
- Review final copy against this invariant: enabled is intent, discovered is
  scan presence, `lastError` is lifecycle error, wired is host metadata, and no
  current field proves execution.
- If implementation reveals a need to change OpenAPI schemas, stop and
  re-evaluate scope before editing `docs/api/v1/schemas/plugins.yaml`; the
  accepted feature does not add telemetry or a new persisted model.
