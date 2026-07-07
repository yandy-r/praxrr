# Task Breakdown: Resolved Config Viewer (Issue #25)

Source: `shared.md`, `feature-spec.md` (Task Breakdown Preview), `research-architecture.md`
(Integration Points), `research-patterns.md` (Testing Approach / Patterns to Follow). This
document refines the spec's 6-phase preview into implementation-grade tasks (1-3 primary files
each, explicit `blockedBy`, maximal safe parallelism) for a single shared feature branch/worktree.

## Executive Summary

The feature decomposes cleanly into **17 tasks across 7 phases (0-6) plus 2 cross-cutting
security tasks**, executable in **4 sequential batches** given unlimited parallel capacity. The
widest batch (Batch 1) has **6 fully independent tasks** -- contract authoring, the resolved
readers dispatch table, the `buildReadOnly` cache primitive, `liveDiff.ts`, and both small
security hardenings (SSRF centralization, fan-out limits) have zero dependencies on each other and
can start immediately. The two facts that most shape the graph: (1) `buildReadOnly` (Phase 2) has
no dependency on Phase 1's endpoint work and should start on day one in parallel with it, and (2)
live diff (Phase 3) is fully independent of the layer-breakdown work and can also start on day one
-- only the UI and the shared `resolvedConfigApi.test.ts` route-test file force a few tasks into
later batches purely for file-ordering, not functional dependency. No cycles exist in the
dependency graph.

A few shared/append-only files (`pcd/index.ts`, `resolvedConfigApi.test.ts`,
`arrCredentialRedactionRoutes.test.ts`, `+page.svelte`) are deliberately handled with different
strategies (documented in **Task Granularity Recommendations**) rather than blanket-serializing
every task that touches them, since forcing full serialization on trivial single-line/single-block
appends would meaningfully hurt parallelism for no real conflict risk.

## Recommended Phase Structure

Legend: **Files** = primary files created (C) or modified (M); test files are listed separately
where they don't count against the 1-3 primary file guidance. **blockedBy** = task IDs that must
land first.

### Phase 0 -- Contract & type generation

| Task                                                             | Files                                                                                                                                                                                                                                                                                                                                                                                            | blockedBy |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **P0-T1** -- Author OpenAPI contract, register, regenerate types | C: `docs/api/v1/paths/resolved-config.yaml`, `docs/api/v1/schemas/resolved-config.yaml`; M: `docs/api/v1/openapi.yaml` (register both via `$ref`, mirroring `compatibility.yaml`/`pcd-snapshots.yaml` lines); regenerated (do not hand-edit): `packages/praxrr-app/src/lib/api/v1.d.ts` (`deno task generate:api-types`), `packages/praxrr-api/{openapi.json,types.ts}` (`deno task bundle:api`) | --        |

Author the **entire** contract in one pass (all 4 endpoints: list, named, compare, diff; all 6
schemas: `ResolvedLayer`, `ResolvedEntityState`, `ResolvedEntityListResponse`,
`ResolvedInstanceState`, `CrossInstanceComparisonResponse`, `ResolvedLiveDiffResponse`; `$ref` into
`schemas/sync.yaml` for `EntityChange`/`FieldChange` rather than redefining) so downstream phases
never need a second contract commit or a second `generate:api-types`/`bundle:api` run.

### Phase 1 -- Resolved reads (layer=resolved)

| Task                                                           | Files                                                                                                                                                                                                                                                                                                                                                  | blockedBy    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| **P1-T1** -- Resolved readers dispatch table                   | C: `packages/praxrr-app/src/lib/server/pcd/resolved/readers.ts`, `.../resolved/types.ts` (entity/layer dispatch key types); M: `packages/praxrr-app/src/lib/server/pcd/index.ts` (add `// RESOLVED CONFIG` export section), `scripts/test.ts` (add `resolvedConfig` alias, see below); T: `packages/praxrr-app/src/tests/pcd/resolved/readers.test.ts` | --           |
| **P1-T2** -- List + named GET endpoints, `layer=resolved` only | C: `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts`, `.../[entityType]/[name]/+server.ts`, `packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts` (route-test file; **canonical creator**, see Task Granularity Recommendations)                                                                    | P0-T1, P1-T1 |

`readers.ts` is a manual `(entityType, arrType) -> serializeFn` dispatch table delegating to
`entities/serialize.ts`'s 15 existing `serialize*` functions (no re-derivation), throwing the same
`Error('X "name" not found')` shape on miss for the route to translate to 404 -- copy the
`compatibility/parity/+server.ts` five-step handler shape verbatim (auth-first -> `/^\d+$/`
databaseId -> `pcdManager.getCache(id)?.isBuilt()` guard, 400 not 404 -> try/catch sanitized
`logger.error` -> generic 500 -> `satisfies components['schemas'][...]`).

`scripts/test.ts` alias (added once, in P1-T1, never touched again -- the value is a
directory-plus-file comma-joined string, so later tasks only need to add files _under_ the already
registered directory or append to the already-registered file):

```
resolvedConfig: 'packages/praxrr-app/src/tests/pcd/resolved,packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts'
```

### Phase 2 -- Layer breakdown (the hard part)

| Task                                                                                                       | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | blockedBy    |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **P2-T1** -- `buildReadOnly({ layers })` primitive                                                         | M: `packages/praxrr-app/src/lib/server/pcd/database/cache.ts` (extract the op-execution loop L98-274; add `buildReadOnly` that forces `trackHistory=false` for every op, skips `evaluateValueGuardApply/Error`, `pcdOpsQueries.update`, `pcdOpHistoryQueries.create`, never calls `setCache`, and its own catch path must not call `disableDatabaseInstance()`), `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts` (add an option to skip the 4th/user-ops push -- must be skippable at the call site per Business Rule 3, not filtered post-hoc); T: `packages/praxrr-app/src/tests/pcd/resolved/cacheBuildReadOnly.test.ts` | --           |
| **P2-T2** -- `layers.ts` + `layerDiff.ts`                                                                  | C: `packages/praxrr-app/src/lib/server/pcd/resolved/layers.ts` (ephemeral base-only build/close wrapper over `buildReadOnly`), `.../resolved/layerDiff.ts` (`diffToFieldChanges(baseOnlyPortable, resolvedPortable, options)` wrapper reusing `sectionDiffs.ts` array-key strategies); M: `pcd/index.ts` (append export -- see Task Granularity Recommendations); T: `packages/praxrr-app/src/tests/pcd/resolved/{layers,layerDiff}.test.ts`                                                                                                                                                                                        | P1-T1, P2-T1 |
| **P2-T3** -- Wire `layer=base\|user` into the Phase 1 endpoints; SSRF centralization landed by now (SEC-1) | M: **same two route files as P1-T2** (`[entityType]/+server.ts`, `[entityType]/[name]/+server.ts`), **same route test file as P1-T2** (`resolvedConfigApi.test.ts`, appended `layer=base`/`layer=user` cases)                                                                                                                                                                                                                                                                                                                                                                                                                       | P1-T2, P2-T2 |

`layerDiff.ts` calls `readers.ts`'s _same_ serialize function against both the ephemeral base-only
cache (from `layers.ts`) and the real resolved cache (via `pcdManager.getCache`) to get two
comparable `Portable*` payloads before diffing -- this is why P2-T2 depends on P1-T1, not just
P2-T1. P2-T1's test must assert **zero calls** to `pcdOpsQueries.update`/`pcdOpHistoryQueries.create`
(Success Criterion: "Layer-view requests perform zero writes"); recommended approach is
patch-and-restore spies on those two query modules plus a small synthetic op list, per
`research-patterns.md`'s testing conventions -- not a full production ops replay.

### Phase 3 -- Live diff (independent of Phase 2; can start Batch 1)

| Task                                        | Files                                                                                                                                                                                                                                                                                                                     | blockedBy                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **P3-T1** -- `liveDiff.ts`                  | C: `packages/praxrr-app/src/lib/server/pcd/resolved/liveDiff.ts` (calls `generatePreview()`, filters the returned `EntityChange[]` client-side by `entityType`+`name` -- no per-entity filter exists upstream -- namespace-aware via `findNamespaceMatch`; defines its own local closed reason union, e.g. `'unreachable' | 'timeout'                                           | 'rate-limited' | 'unsupported' | 'not-found'`, following `testConnectionReason.ts`'s pattern rather than forwarding `error.message`); M: `pcd/index.ts`(append export); T:`packages/praxrr-app/src/tests/pcd/resolved/liveDiff.test.ts` | --  |
| **P3-T2** -- `GET .../[name]/diff` endpoint | C: `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/diff/+server.ts`; M: `resolvedConfigApi.test.ts` (appended diff cases)                                                                                                                                                            | P0-T1, P3-T1, P1-T2 (file-ordering only, see below) |

P3-T2's dependency on P1-T2 is **not functional** -- it exists solely because both tasks touch the
shared `resolvedConfigApi.test.ts` file and P1-T2 is that file's canonical creator (see Task
Granularity Recommendations). The `/diff` handler reuses the existing
`registerPreviewCreateAttempt(instanceId, nowMs)` limiter verbatim (6/60s per instance, **note the
required second argument** -- spec text omits it, `research-architecture.md` confirms the real
signature).

### Phase 4 -- Cross-instance comparison

| Task                                           | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | blockedBy                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **P4-T1** -- `compare.ts`                      | C: `packages/praxrr-app/src/lib/server/pcd/resolved/compare.ts` (per-instance transformed-desired payloads via `readers.ts`; `arr_type` gating via `isArrAppType()`/`isSyncSectionSupported()`, no sibling fallback; defines its own local reason union -- duplicated from, not imported from, `liveDiff.ts`'s, to preserve independence -- see Task Granularity Recommendations); M: `pcd/index.ts` (append export); T: `packages/praxrr-app/src/tests/pcd/resolved/compare.test.ts` | P1-T1, SEC-2                             |
| **P4-T2** -- `GET .../[name]/compare` endpoint | C: `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/compare/+server.ts`; M: `resolvedConfigApi.test.ts` (appended compare cases)                                                                                                                                                                                                                                                                                                                  | P0-T1, P4-T1, P1-T2 (file-ordering only) |

Per the given ordering fact, compare's dependency set is explicitly **readers + per-arr transforms

- limits** -- not `liveDiff.ts`. `includeLive=true` may optionally reuse `liveDiff.ts`'s function
  as a soft, non-blocking integration (land after P3-T1 if taken; a small local
  `generatePreview()`-based fetch is an acceptable alternative that keeps P4-T1 fully independent of
  Phase 3).

### Phase 5 -- UI

| Task                                                     | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | blockedBy    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **P5-T1** -- Page shell + resolved view + nav entry      | C: `packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.server.ts`, `+page.svelte` (**must define an extensible tab/section registry** -- see Task Granularity Recommendations), `ResolvedStatePanel.svelte` (resolved-layer-only content: `JsonView.svelte` raw mode + entity table, Layer segmented control present but Base/User disabled/stubbed); M: `packages/praxrr-app/src/lib/server/navigation/registry.ts` (append one `NAV_REGISTRY` entry, following `overview.parity_map`/`policies.score_simulator` shape) | P1-T2        |
| **P5-T2** -- Layer toggle (Base / User overrides) wiring | M: `ResolvedStatePanel.svelte` (enable Base/User segments; render `FieldChange[]` table for `layer=user` using `SyncPreviewEntityDiff`'s `ACTION_META`/`FIELD_META` glyph+color+label triple-encoding -- escaped `{value}` text only, no `{@html}`/`marked.*`; explicit "resolved matches base" empty state)                                                                                                                                                                                                                            | P5-T1, P2-T3 |
| **P5-T3** -- Live diff panel                             | C: `packages/praxrr-app/src/routes/resolved-config/[databaseId]/LiveDiffPanel.svelte` (instance selector, per-instance skeleton/error/retry states, sanitized reason display, "in sync" vs "check failed" distinct empty states); M: `+page.svelte` (one additive tab-registry entry)                                                                                                                                                                                                                                                   | P5-T1, P3-T2 |
| **P5-T4** -- Cross-instance comparison grid              | C: `packages/praxrr-app/src/routes/resolved-config/[databaseId]/CrossInstanceGrid.svelte` (`Table.svelte` + `Badge.svelte` + `Column<T>[]`, `ParityMatrix.svelte` idiom -- do not build a bespoke grid); M: `+page.svelte` (one additive tab-registry entry)                                                                                                                                                                                                                                                                            | P5-T1, P4-T2 |

All new components render values as escaped `{value}` text only -- **no `{@html}` / `marked.parse()`
anywhere** (the security-critical C1 constraint; `FieldDiffTable.svelte` is the anti-pattern to not
copy). Svelte 4-style throughout: `export let`, `$:`, plain `let`, `on:click`/`on:change` -- the
codebase's actual convention, not CLAUDE.md's `onclick` wording.

### Phase 6 -- Cross-cutting verification (final gate)

| Task                                                                          | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                   | blockedBy                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **P6-T1** -- Redaction + CORS + resolved/preview-equivalence regression sweep | M: `packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts` (one `run...RedactionTest()` case per new route -- list, named, diff, compare -- asserting `assertPayloadNoLeak`/`assertFalse('api_key' in payload)`); C or M: a CORS-headers-absent assertion (A2) and a resolved-view-vs-sync-preview-desired-payload equivalence assertion (Success Criterion 1), placed alongside the redaction cases or in a small adjacent test file | P1-T2, P2-T3, P3-T2, P4-T2 |

### Cross-cutting security tasks (parallel track, Batch 1)

| Task                                   | Files                                                                                                                                                                                                                                                                      | blockedBy |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **SEC-1** -- SSRF centralization (W1)  | M: `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts` (call `assertSafeArrUrl(url)` inside `getArrInstanceClient()` before `createArrClient()`); T: new/extended unit test asserting the guard fires and existing legitimate LAN/RFC1918 URLs still pass | --        |
| **SEC-2** -- `resolved/limits.ts` (W3) | C: `packages/praxrr-app/src/lib/server/pcd/resolved/limits.ts` (instance cap = 8; per-user/request window via `$utils/rateLimit.ts#registerRateLimitAttempt`); T: `packages/praxrr-app/src/tests/pcd/resolved/limits.test.ts`                                              | --        |

SEC-1 has zero call-site changes required anywhere else -- it's an internal guard inside the single
existing choke point (`getArrInstanceClient()`), so it transparently protects `generatePreview()`
(and therefore `liveDiff.ts`/`compare.ts`) "for free" regardless of when it lands, though Batch 1
is recommended for defense-in-depth before any live-fetch code path goes live.

## Task Granularity Recommendations

1. **No separate "501 skeleton" phase.** The spec's Phase 0 preview lists route skeletons as a
   distinct step from Phase 1's real endpoints; this plan merges them because both would touch the
   _same_ `[entityType]/+server.ts` / `[entityType]/[name]/+server.ts` files, and per the
   same-file-must-be-sequential-or-same-task rule, a skeleton-then-fill pass on identical files is
   pure churn. Building the real `layer=resolved` handler directly in P1-T2 is strictly cheaper.
2. **`pcd/index.ts` treated as a low-risk trivial-append file, not a serialization point.** Four
   tasks (P1-T1, P2-T2, P3-T1, P4-T1) each add one distinct, non-overlapping export line under the
   `// RESOLVED CONFIG` banner. Forcing full batch-level serialization on single-line additive
   exports would cost real parallelism (P3-T1 in particular has zero functional reason to wait) for
   a conflict class that resolves in seconds via git. Recommendation: each task's commit touches
   only its own export line; rebase-on-conflict if two land in the same window.
3. **`resolvedConfigApi.test.ts` is treated differently -- real file-creation ordering, not just
   append-risk.** Unlike `pcd/index.ts`, this file must _exist_ before anything can append to it, so
   P1-T2 is designated the canonical creator; P2-T3 (already same-file-sequential with P1-T2 for
   the route handlers themselves), P3-T2, and P4-T2 each carry a **file-ordering-only** `blockedBy`
   edge on P1-T2 in addition to their real functional dependencies. This is the one place this plan
   adds a dependency edge purely for file safety rather than logic -- flagged explicitly in the
   Dependency Analysis below so it isn't mistaken for a functional coupling.
4. **`arrCredentialRedactionRoutes.test.ts` is consolidated into one late task (P6-T1), not
   distributed across the four route tasks.** Unlike the two append-only files above, each
   redaction case requires its own fixture/assertion block referencing route-specific response
   shapes -- less trivial to interleave safely, and the spec's success criteria treat "no credential
   leakage across all new surfaces" as one coherent gate. One task after all four routes exist is
   both safer and matches how `research-patterns.md` describes the suite (one class, one `run()`).
5. **`+page.svelte` needs an explicit extension-point design in P5-T1** (a tab/section registry
   array, e.g. `{ id, label, component }[]`) specifically so P5-T3 (live diff) and P5-T4
   (cross-instance) can each add one independent array entry in parallel rather than both editing
   the same conditional-render ladder. Without this, Phase 5 would serialize further than
   necessary. `ResolvedStatePanel.svelte`'s P5-T1->P5-T2 relationship is a _real_ sequential
   dependency (P5-T2 enables logic P5-T1 stubbed, not an independent addition) and is not a
   candidate for this treatment.
6. **Sanitized reason enums are intentionally duplicated, not shared**, between `liveDiff.ts`
   (P3-T1) and `compare.ts` (P4-T1) rather than centralized in `resolved/types.ts`. This keeps both
   tasks -- which the spec explicitly wants independent -- free of a cross-file dependency on each
   other or on a shared file `P1-T1` would otherwise need to keep growing. If the two unions drift
   in practice, a fast-follow refactor to `resolved/reasons.ts` is cheap.
7. **Every Arr-touching task (P1-T1, P2-T2, P3-T1, P4-T1) must independently satisfy the repo's
   Cross-Arr Semantic Validation Policy checklist** (CLAUDE.md) -- API semantics, schema/field
   mappings, explicit `arr_type` dispatch with no sibling fallback, fail-fast on ambiguous mappings
   -- as part of that task's own completion criteria, not as a separate task.

## Dependency Analysis

`blockedBy` graph (task -> tasks that must complete first). `(file-order)` marks edges that exist
only for shared-file safety, not functional logic -- see Task Granularity Recommendation #3.

```
P0-T1            : []
P1-T1            : []
P2-T1            : []
P3-T1            : []
SEC-1            : []
SEC-2            : []

P1-T2            : [P0-T1, P1-T1]
P2-T2            : [P1-T1, P2-T1]
P4-T1            : [P1-T1, SEC-2]

P2-T3            : [P1-T2, P2-T2]
P3-T2            : [P0-T1, P3-T1, P1-T2 (file-order)]
P4-T2            : [P0-T1, P4-T1, P1-T2 (file-order)]
P5-T1            : [P1-T2]

P5-T2            : [P5-T1, P2-T3]
P5-T3            : [P5-T1, P3-T2]
P5-T4            : [P5-T1, P4-T2]
P6-T1            : [P1-T2, P2-T3, P3-T2, P4-T2]
```

**Cycle check**: every edge points from a later-scheduled task to an earlier one; topologically
sorting by the batch numbers below succeeds with no back-edges -- **no cycles**.

## File-to-Task Mapping

Every file has exactly one **owning (creating) task**; files with more than one contributing task
list the follow-on tasks as **(sequential append)**.

| File                                                     | Owning task                  | Sequential appends                     |
| -------------------------------------------------------- | ---------------------------- | -------------------------------------- |
| `docs/api/v1/paths/resolved-config.yaml`                 | P0-T1                        | --                                     |
| `docs/api/v1/schemas/resolved-config.yaml`               | P0-T1                        | --                                     |
| `docs/api/v1/openapi.yaml`                               | P0-T1 (registration lines)   | --                                     |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                | P0-T1 (generated)            | --                                     |
| `packages/praxrr-api/openapi.json`, `types.ts`           | P0-T1 (generated)            | --                                     |
| `pcd/resolved/readers.ts`                                | P1-T1                        | --                                     |
| `pcd/resolved/types.ts`                                  | P1-T1                        | --                                     |
| `pcd/index.ts`                                           | P1-T1 (first section)        | P2-T2, P3-T1, P4-T1 (own export lines) |
| `scripts/test.ts`                                        | P1-T1                        | -- (never touched again)               |
| `tests/pcd/resolved/readers.test.ts`                     | P1-T1                        | --                                     |
| `routes/.../resolved/[entityType]/+server.ts`            | P1-T2                        | P2-T3 (adds layer=base\|user)          |
| `routes/.../resolved/[entityType]/[name]/+server.ts`     | P1-T2                        | P2-T3 (adds layer=base\|user)          |
| `tests/routes/resolvedConfigApi.test.ts`                 | P1-T2 (creates)              | P2-T3, P3-T2, P4-T2 (append cases)     |
| `pcd/database/cache.ts`                                  | P2-T1                        | --                                     |
| `pcd/ops/loadOps.ts`                                     | P2-T1                        | --                                     |
| `tests/pcd/resolved/cacheBuildReadOnly.test.ts`          | P2-T1                        | --                                     |
| `pcd/resolved/layers.ts`                                 | P2-T2                        | --                                     |
| `pcd/resolved/layerDiff.ts`                              | P2-T2                        | --                                     |
| `tests/pcd/resolved/{layers,layerDiff}.test.ts`          | P2-T2                        | --                                     |
| `pcd/resolved/liveDiff.ts`                               | P3-T1                        | --                                     |
| `tests/pcd/resolved/liveDiff.test.ts`                    | P3-T1                        | --                                     |
| `routes/.../[name]/diff/+server.ts`                      | P3-T2                        | --                                     |
| `pcd/resolved/compare.ts`                                | P4-T1                        | --                                     |
| `tests/pcd/resolved/compare.test.ts`                     | P4-T1                        | --                                     |
| `routes/.../[name]/compare/+server.ts`                   | P4-T2                        | --                                     |
| `resolved-config/[databaseId]/+page.server.ts`           | P5-T1                        | --                                     |
| `resolved-config/[databaseId]/+page.svelte`              | P5-T1 (shell + tab registry) | P5-T3, P5-T4 (one tab entry each)      |
| `resolved-config/[databaseId]/ResolvedStatePanel.svelte` | P5-T1 (resolved-only)        | P5-T2 (enables base/user)              |
| `navigation/registry.ts`                                 | P5-T1                        | --                                     |
| `resolved-config/[databaseId]/LiveDiffPanel.svelte`      | P5-T3                        | --                                     |
| `resolved-config/[databaseId]/CrossInstanceGrid.svelte`  | P5-T4                        | --                                     |
| `tests/base/arrCredentialRedactionRoutes.test.ts`        | P6-T1                        | --                                     |
| `utils/arr/arrInstanceClients.ts`                        | SEC-1                        | --                                     |
| `pcd/resolved/limits.ts`                                 | SEC-2                        | --                                     |
| `tests/pcd/resolved/limits.test.ts`                      | SEC-2                        | --                                     |

Files explicitly marked "reuse, no change" per `shared.md` (`sync/preview/diff.ts`,
`sectionDiffs.ts`, `orchestrator.ts`, `namespace.ts`, `mappings.ts`, `entities/serialize.ts`,
`arrInstances.ts`, `testConnectionReason.ts`, `JsonView.svelte`, `Table.svelte`, `Badge.svelte`,
`EmptyState.svelte`, `Toggle.svelte`) are consumed by multiple tasks but never modified by this
feature -- not listed above since they have no owning task.

## Optimization Opportunities

Four batches, given unlimited parallel capacity per batch (batch size = number of tasks with all
`blockedBy` entries satisfied by the end of the previous batch):

| Batch | Tasks (count)                                    | Notes                                                                                                                                                                                      |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | P0-T1, P1-T1, P2-T1, P3-T1, SEC-1, SEC-2 (**6**) | Zero cross-dependencies. This is the highest-leverage batch -- contract, readers, `buildReadOnly`, live-diff core, and both security hardenings all start day one.                         |
| **2** | P1-T2, P2-T2, P4-T1 (**3**)                      | Each depends only on Batch-1 outputs; none share files with each other.                                                                                                                    |
| **3** | P2-T3, P3-T2, P4-T2, P5-T1 (**4**)               | P2-T3 is same-file-sequential with P1-T2 (expected); P3-T2/P4-T2 carry the file-order-only edge on P1-T2 explained above; P5-T1 starts as soon as the resolved-only endpoint exists.       |
| **4** | P5-T2, P5-T3, P5-T4, P6-T1 (**4**)               | P5-T3/P5-T4 are parallel-safe _because_ P5-T1 established the tab-registry extension point (Task Granularity Recommendation #5); P6-T1's dependencies are all satisfied by end of Batch 3. |

**Critical path** (longest chain, 4 hops): `P1-T1 -> P4-T1 -> P4-T2 -> P5-T4` (or equivalently
`P1-T1 -> P1-T2 -> P2-T3 -> P5-T2`) -- 4 batches is the minimum achievable regardless of engineer
count, since Phase 5's per-endpoint UI panels each strictly follow their backend endpoint and the
page shell.

**Biggest parallelism win vs. a naive phase-by-phase read of the spec**: Phase 2's `buildReadOnly`
primitive (P2-T1) and Phase 3's `liveDiff.ts` (P3-T1) both start in Batch 1 rather than waiting on
Phase 1, exactly as the given ordering facts require -- a literal phase-by-phase execution would
otherwise waste 1-2 batches of idle capacity on these two tracks.

## Implementation Strategy Recommendations

1. **Single shared worktree, batch-ordered commits.** Create one feature branch/worktree (e.g.
   `~/.claude-worktrees/praxrr-resolved-config-viewer/`) per repo convention; all 17 tasks commit
   to it. Within a batch, parallel tasks are file-disjoint by construction (see File-to-Task
   Mapping) except the two documented trivial-append files (`pcd/index.ts`,
   `resolvedConfigApi.test.ts`), which resolve via small independent hunks/rebase, not planning
   avoidance.
2. **Run `deno task generate:api-types` and `deno task bundle:api` exactly once**, at the end of
   P0-T1, covering the full contract. No later task should touch the OpenAPI YAML or regenerate
   types -- if a later task discovers a contract gap, that's a signal to amend P0-T1 before
   proceeding, not to bolt on a second contract commit.
3. **Test fixtures**: follow `research-patterns.md`'s two confirmed recipes exclusively -- (a)
   minimal in-memory SQLite (`new Database(':memory:', {int64:true})` + hand-written
   `CREATE TABLE`/`INSERT` scoped to only the tables the handler under test reads, registered via
   `setCache`/`deleteCache` in `try/finally`) for route tests, or (b) patch-and-restore
   monkey-patching (`patchTarget`, `patchLoggerForTest`) for pure PCD-module tests. **No task should
   ever call a real `PCDCache.build()`** in a test, including P2-T1's zero-write assertion (spy on
   `pcdOpsQueries.update`/`pcdOpHistoryQueries.create` instead of exercising the real op pipeline).
4. **Verification gate before any task is marked done**: `deno task lint`, `deno task check`,
   `deno task test resolvedConfig` (the alias registered in P1-T1) must all pass, plus -- for
   Arr-touching tasks -- the CLAUDE.md Cross-Arr Semantic Validation Policy checklist and Portable
   Contract Fidelity checklist must be explicitly walked, not assumed from shape-similarity to
   Radarr/Sonarr.
5. **Batch 4 is the natural PR/review boundary** for the full feature -- by its end, all 4 endpoints,
   the layer breakdown, live diff, cross-instance compare, the full UI, and the security regression
   sweep are complete and mutually verified (P6-T1 depends on every route). Earlier batches can
   still be reviewed incrementally (e.g., Batch 1+2 as a "server core" PR, Batch 3+4 as "endpoints +
   UI") if smaller PRs are preferred, per CLAUDE.md's "small, focused PRs" guidance -- the batch
   boundaries were chosen so each is a coherent, independently reviewable slice.
6. **Do not skip SEC-1** even though nothing in this plan has a hard functional dependency on it --
   it is the only task that closes the SSRF gap for every live-fetch path this feature adds
   (`liveDiff.ts`, `compare.ts` `includeLive`), and it costs one file. Land it in Batch 1 as
   planned rather than deferring it as a "nice to have."

## Assumptions / Open Verification Items

These were not confirmed against source (per the research docs' own scope) and should be verified
by the task owner before implementation, not treated as load-bearing planning facts:

- Exact existing test-directory convention for `cache.ts` (no pre-existing `tests/pcd/database/`
  path was named in the research docs); this plan places the new `buildReadOnly` test under
  `tests/pcd/resolved/cacheBuildReadOnly.test.ts` to keep it inside the newly registered
  `resolvedConfig` alias -- confirm no naming collision with an existing cache test suite.
- Whether `deno task test <dir>` recurses into nested test files added by later tasks under
  `tests/pcd/resolved/` without further `scripts/test.ts` edits (assumed yes, standard Deno
  `deno test <dir>` behavior; the `resolvedConfig` alias's directory component relies on this).

## Relevant Docs

- `docs/plans/resolved-config-viewer/shared.md` -- file-level contract and pattern index (must-read
  for every task).
- `docs/plans/resolved-config-viewer/feature-spec.md` -- API shapes, business rules, phasing this
  breakdown refines.
- `docs/plans/resolved-config-viewer/research-architecture.md` -- exact `cache.ts`/`loadOps.ts`
  extraction points and verified signatures (P2-T1, P2-T2).
- `docs/plans/resolved-config-viewer/research-integration.md` -- contract-system mechanics, rate
  limiter signature correction (P0-T1, P3-T2, P4-T1).
- `docs/plans/resolved-config-viewer/research-patterns.md` -- copy-paste-grade route/test patterns;
  source of the `resolvedConfigApi.test.ts`/`resolvedConfig` alias naming used throughout this
  document (all Phase 1-4 tasks).
- `CLAUDE.md` (repo root) -- Cross-Arr Semantic Validation Policy, Portable Contract Fidelity, Arr
  Cutover Guardrails (every Arr-touching task).
