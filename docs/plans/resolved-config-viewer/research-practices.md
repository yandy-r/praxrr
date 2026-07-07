# Resolved Config Viewer — Engineering Practices Research

## Executive Summary

Praxrr already has almost every primitive the Resolved Config Viewer (issue #25) needs: `PCDCache` is
literally the resolved state (schema+base+tweaks+user ops executed in order into an in-memory SQLite DB),
`pcd/entities/serialize.ts` already reads full resolved entities out of that cache into arr-agnostic
`Portable*` shapes, and `sync/preview/diff.ts` + `sync/preview/sectionDiffs.ts` are a generic, already-tested,
dependency-free structural diff engine built for exactly this "desired vs current" comparison (used today by
sync preview, PR #7's target). The Cross-Arr Parity Map (PR #14) supplies the matrix/table/badge UI pattern
and the route-level "static payload + per-database dynamic computation" server pattern. The main net-new work
is (1) a thin `pcd/resolved/` read module that composes existing per-entity `serialize.ts`/`read.ts` functions
rather than a new generic entity dispatcher, and (2) a way to build a layer-scoped (base-only) ephemeral
`PCDCache` for the layer-breakdown toggle, since `OperationLayer` today only distinguishes `'base'|'user'` at
the op-authoring level, not at cache-read time.

## Existing Reusable Code

| Module/Utility                                                                                                                                                                                                                                   | Location                                                                                                                                                                                                       | Purpose                                                                                                                                                                                                                       | How to Reuse                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PCDCache`                                                                                                                                                                                                                                       | `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`                                                                                                                                                     | In-memory SQLite compiled from schema+base+tweaks+user ops executed in order — this _is_ "resolved state". `cache.kb` (Kysely) / `cache.query`/`queryOne` (raw SQL) are the read surface.                                     | Read directly for the "resolved" tab. `cache.build()` returns `CacheBuildStats{schema,base,tweaks,user,timing}` confirming layer op counts and that builds are cheap (ms-scale, in-memory).                                                                                        |
| `loadAllOperations()`                                                                                                                                                                                                                            | `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`                                                                                                                                                        | Loads ops in strict layer order: schema (files) → base published+draft (DB) → tweaks (files) → user published (DB).                                                                                                           | Reuse to build a **layer-scoped** ephemeral cache (e.g. schema+base only) for the "base only" toggle — filter the returned `Operation[]` by `layer` before feeding to a cache-build routine, rather than inventing a new op loader.                                                |
| `getCache()` / `getCachedDatabaseIds()`, `pcdManager`                                                                                                                                                                                            | `packages/praxrr-app/src/lib/server/pcd/database/registry.ts`, `pcd/core/manager.ts`, re-exported via `$pcd/index.ts`                                                                                          | Registry access to the live, always-resolved cache per database instance.                                                                                                                                                     | Use `pcdManager.getCache(databaseId)` for the "resolved" (default) view exactly as `routes/api/v1/compatibility/parity/+server.ts` does (`pcdManager.getCache(databaseId)` + `cache?.isBuilt()` guard).                                                                            |
| `serializeQualityProfile`, `serializeCustomFormat`, `serializeDelayProfile`, `serializeRegularExpression`, etc.                                                                                                                                  | `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`                                                                                                                                                 | **Already reads full resolved entities from `PCDCache` and returns arr-agnostic `Portable*` shapes.** Doc comment: "Used by clone (serialize → rename → deserialize) and future export."                                      | This is the primary reuse target for "resolved entity state per entity type." Call the existing per-entity-type function directly (`serializeQualityProfile(cache, name)`) instead of writing new SQL/Kysely reads.                                                                |
| `Portable*` types (`PortableQualityProfile`, `PortableCustomFormat`, `PortableDelayProfile`, …)                                                                                                                                                  | `packages/praxrr-app/src/lib/shared/pcd/portable.ts`                                                                                                                                                           | Canonical arr-agnostic contract already used by export, clone, and TRaSH-guide migration.                                                                                                                                     | Use as the viewer's canonical "resolved" JSON shape (matches `JsonView.svelte`'s raw-JSON needs and keeps the viewer decoupled from any single Arr's payload shape).                                                                                                               |
| `diffToFieldChanges()`                                                                                                                                                                                                                           | `packages/praxrr-app/src/lib/server/sync/preview/diff.ts`                                                                                                                                                      | Generic deep structural diff → `FieldChange[]`. Handles array key strategies, ignores volatile fields (id/links/timestamps), treats `null`/missing as equal. Zero external dependency.                                        | **This is the diff engine.** Reuse verbatim for (a) base-layer vs resolved-layer field diff, (b) instance-A vs instance-B cross-instance comparison, (c) resolved-PCD vs live-Arr diff. Do not write a second comparator.                                                          |
| `diffEntityCollection()`, `diffSingletonEntity()`, `diffUnidentifiedPayload()`, `QUALITY_PROFILE_ARRAY_KEY_STRATEGIES`, `CUSTOM_FORMAT_ARRAY_KEY_STRATEGIES`, `QUALITY_DEFINITION_ARRAY_KEY_STRATEGIES`, `METADATA_PROFILE_ARRAY_KEY_STRATEGIES` | `packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts`                                                                                                                                              | Entity-collection-level diff orchestration with per-entity-type array key strategies (e.g. `formatItems` keyed by `format`, `items` keyed by quality name) and namespace-aware name matching.                                 | Reuse the exported key-strategy constants directly for the viewer's diff computation instead of re-deriving array comparison keys per entity type.                                                                                                                                 |
| `generatePreview()` (orchestrator) + `QualityProfileSyncer.generatePreview()` / other section syncers                                                                                                                                            | `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`, `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts` (and `mediaManagement/`, `delayProfiles/`, `metadataProfiles/` syncers) | **Already builds "desired" Arr payloads from PCD, fetches live Arr state via `BaseSyncer`, and diffs them** into `create`/`update`/`delete`/`unchanged` `EntityChange[]` per section. Read-only, no writes.                   | This _is_ the "diff against live Arr state" the viewer needs. Reuse it directly (or a narrowed single-entity variant) instead of re-implementing PCD→Arr payload building + comparison. This is also the direct overlap point with issue #7 (sync preview) — see Interface Design. |
| `computeCompatibleProfileNames()`, `computeProfileCompatibility()`                                                                                                                                                                               | `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/compatibility.ts`                                                                                                                             | Cross-Arr-type compatibility computed per `arr_type` directly from cache, explicit `ARR_APP_TYPES` iteration, no sibling-app fallback.                                                                                        | Template for the viewer's "cross-instance comparison" logic — compatibility/mapping must stay resolved per `arr_type`, never inferred across apps (per CLAUDE.md Cross-Arr Semantic Validation Policy).                                                                            |
| `PARITY_ENTITIES`, `PARITY_ENTITY_LABELS`, `buildParityRows()`                                                                                                                                                                                   | `packages/praxrr-app/src/lib/shared/arr/parity.ts`, `parityRows.ts`                                                                                                                                            | Static entity×app matrix data + row builder, used by PR #14.                                                                                                                                                                  | Pattern (not code) reuse: same "static data + derived matrix rows" approach if the viewer needs an entity×instance compatibility summary.                                                                                                                                          |
| `GET /api/v1/compatibility/parity`                                                                                                                                                                                                               | `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts`                                                                                                                                        | Route pattern: module-level cached static payload + optional `databaseId` query param triggering dynamic per-database computation; explicit `cache?.isBuilt()` guard returning 400 (not 404) for an unbuilt/unknown database. | Copy this shape for `GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}` — static shell + cache-guarded dynamic body.                                                                                                                                                       |
| `ParityMatrix.svelte`, `CompatibilityBadges.svelte`                                                                                                                                                                                              | `packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte`, `packages/praxrr-app/src/lib/client/ui/parity/CompatibilityBadges.svelte`                                                                     | Matrix/comparison UI built entirely from generic `$ui/table/Table.svelte` + `$ui/badge/Badge.svelte` + `Column<T>` type — no bespoke grid component.                                                                          | Reuse `Table`/`Badge`/`Column<T>` the same way for a cross-instance comparison table; do not build a new grid component.                                                                                                                                                           |
| `Tabs.svelte` + href-based sub-route layout pattern                                                                                                                                                                                              | `packages/praxrr-app/src/lib/client/ui/navigation/tabs/Tabs.svelte`, `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/+layout.svelte` (General/Scoring/Qualities tabs)                       | Existing convention for per-entity detail sub-routes: a `+layout.svelte` computes `tabs` from `$page.url.pathname` and renders `<Tabs>` + `<slot />`.                                                                         | Reuse directly for the layer-breakdown toggle (Base / User Overrides / Resolved) as three sub-routes/tabs under a per-entity detail page, matching the existing quality-profile detail page shape.                                                                                 |
| `JsonView.svelte`                                                                                                                                                                                                                                | `packages/praxrr-app/src/lib/client/ui/meta/JsonView.svelte`                                                                                                                                                   | Already renders arbitrary JSON with `highlight.js` syntax highlighting (JSON + SQL languages registered), used today in `settings/logs` and `dev/components`.                                                                 | Reuse verbatim for the viewer's "raw JSON" mode of a resolved entity — no new JSON viewer/highlighter needed.                                                                                                                                                                      |
| `pcd/ops/draftChanges.ts`                                                                                                                                                                                                                        | `packages/praxrr-app/src/lib/server/pcd/ops/draftChanges.ts`                                                                                                                                                   | A **separate, pre-existing** field-level before/after diff renderer operating on a single op's stored `desired_state`/metadata (used for the conflicts/drafts review UI), distinct from `diffToFieldChanges`.                 | Do not reuse for the viewer — it's op-scoped, not entity-state-scoped, and conflating the two diff mechanisms is a modularity risk (see Abstraction vs. Repetition).                                                                                                               |
| `StoredDesiredState`, `getDesiredTo()`, `WriteOptions.desiredState`                                                                                                                                                                              | `packages/praxrr-app/src/lib/server/pcd/conflicts/overrideUtils.ts`, `pcd/core/types.ts`                                                                                                                       | Ops can carry a `desired_state` JSON payload explicitly documented as "Optional desired state payload for diff/UI".                                                                                                           | Only reliable for some user ops (individual entity update ops), not batch SQL ops — do not depend on this as the _only_ source for the "user overrides" layer view; prefer the layer-scoped-cache approach for completeness.                                                       |
| `parseOperationLayer()`, `OperationLayer`                                                                                                                                                                                                        | `packages/praxrr-app/src/lib/server/pcd/utils/operationLayer.ts`, `pcd/core/types.ts`                                                                                                                          | `OperationLayer = 'base' \| 'user'` — the _write-target_ layer, not a read-time layer filter. Physical build layers are `'schema'\|'base'\|'tweaks'\|'user'` (`Operation.layer`).                                             | Do not conflate: the viewer's "base only" toggle needs an `Operation.layer`-based filter (schema+base, or schema+base+tweaks), not `OperationLayer`.                                                                                                                               |
| `packages/praxrr-app/src/tests/base/syncPreviewDiff.test.ts`                                                                                                                                                                                     | test file                                                                                                                                                                                                      | Pure Deno.test unit tests directly against `diffToFieldChanges`, no server/DB bootstrap.                                                                                                                                      | Mirror this shape for new layer/diff pure-function tests.                                                                                                                                                                                                                          |
| `packages/praxrr-app/src/tests/routes/parityMapApi.test.ts`, `tests/arr/parityMap.test.ts`                                                                                                                                                       | test files                                                                                                                                                                                                     | Route-level vs domain-logic-level test split for the parity feature.                                                                                                                                                          | Mirror as `tests/routes/resolvedConfigApi.test.ts` (route/API) + `tests/pcd/resolved/*.test.ts` (pure logic).                                                                                                                                                                      |

## Modularity Design

### Recommended module boundaries

- **`packages/praxrr-app/src/lib/server/pcd/resolved/`** (new, server-only) — owns:
  - `read.ts`: one function per entity type that composes the existing `entities/serialize.ts` functions
    (`serializeQualityProfile`, `serializeCustomFormat`, …) — do not add a new SQL/Kysely layer here.
  - `layers.ts`: builds an ephemeral, layer-filtered `PCDCache`-equivalent for the "base only" view by
    reusing `loadAllOperations()` and filtering `Operation[]` by `layer` before execution (see KISS
    Assessment for why this beats persisting multiple caches).
  - `types.ts`: `ResolvedConfigView` / `ConfigLayer = 'base' | 'resolved'` types (server-side only; keep
    separate from the sync-preview `SyncPreviewSection`/`EntityChange` types even though the shapes rhyme —
    the viewer is read-only and per-entity, sync preview is per-instance-and-section).
- **Diff logic stays in `sync/preview/`** (`diff.ts`, `sectionDiffs.ts`). The viewer module **imports from**
  `$sync/preview/diff.ts` and `$sync/preview/sectionDiffs.ts` rather than vendoring a copy. This creates a
  one-directional dependency `pcd/resolved -> sync/preview`, which is acceptable: `sync/preview/diff.ts` is
  already a pure, dependency-free utility module with no knowledge of PCD internals. Do **not** invert this
  (i.e., do not move diff.ts into `pcd/` and have `sync` depend on it) without also updating every existing
  `sync/*/syncer.ts` import — that's a larger, unrelated refactor and out of scope for this feature.
- **Cross-instance comparison** (comparing the same PCD entity's _sync output_ across two Arr instances) is
  really "call `syncer.generatePreview()` per instance, diff the two `EntityChange[]` results" — this belongs
  in `pcd/resolved/` as a thin orchestration function, not in `sync/preview/` itself, since it's a
  viewer-specific read-only aggregation, not a new preview lifecycle.
- **Routes**: `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/...` (server) and a page under
  an existing entity's detail route (e.g. `quality-profiles/[databaseId]/[id]/resolved/+page.svelte`) using
  the same `+layout.svelte` + `Tabs` pattern already in place for General/Scoring/Qualities.

### Shared vs. feature-specific

| Concern                        | Shared (reuse as-is)                                                     | Feature-specific (new, small)                                                      |
| ------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Resolved entity reads          | `pcd/entities/serialize.ts` functions                                    | `pcd/resolved/read.ts` (thin composition wrapper)                                  |
| Structural diff                | `sync/preview/diff.ts`, `sectionDiffs.ts`                                | none — call directly                                                               |
| Live-Arr desired/current fetch | `sync/preview/orchestrator.ts`, per-section syncers' `generatePreview()` | none — call directly                                                               |
| Layer-scoped cache build       | `pcd/ops/loadOps.ts` (`loadAllOperations`), `PCDCache` build mechanics   | `pcd/resolved/layers.ts` (op-array filter + ephemeral cache)                       |
| Matrix/table UI                | `$ui/table/Table.svelte`, `$ui/badge/Badge.svelte`                       | New `Column<T>` config per view (data only, no new component)                      |
| Tab navigation                 | `$ui/navigation/tabs/Tabs.svelte`                                        | New tab list per entity `+layout.svelte`                                           |
| Raw JSON display               | `$ui/meta/JsonView.svelte`                                               | none                                                                               |
| Cross-Arr compatibility        | `pcd/entities/qualityProfiles/compatibility.ts` pattern                  | Extend only if the viewer needs non-quality-profile compatibility (not yet proven) |

## KISS Assessment

| Temptation                                                                                            | Verdict           | Rationale                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build a generic, config-driven diff engine (JSON-patch style, works for any shape)                    | **Reject**        | `diffToFieldChanges` already handles arbitrary nested JSON with configurable array-key strategies and is battle-tested by sync preview. A second, "more generic" engine would duplicate ~300 lines of already-correct, already-tested logic (`sync/preview/diff.ts`).                                                                                                                  |
| Add new DB tables to persist "resolved snapshots" per layer                                           | **Reject**        | `PCDCache` (in-memory SQLite) + `pcd_ops` (layer-tagged) are already the source of truth. `CacheBuildStats.timing` shows builds are cheap; there's no evidence a persisted materialized view is needed for a read-only viewer.                                                                                                                                                         |
| Permanently maintain a second, always-live "base-only" `PCDCache` per database in `registry.ts`       | **Reject**        | Doubles (or triples, with tweaks-only) the in-memory SQLite footprint per database for a feature only used when a user opens the layer toggle. Build an ephemeral layer-filtered cache **on demand** per view request instead — same pattern the codebase already uses for ephemeral state (`sync/preview/store.ts` TTL cache is the precedent for "cheap, ephemeral, not persisted"). |
| One generic "compare any two entities regardless of arr_type" comparator for cross-instance view      | **Reject**        | Violates the Cross-Arr Semantic Validation Policy (CLAUDE.md) — comparisons must resolve per `arr_type` (mirrors `computeCompatibleProfileNames`'s explicit per-`arr_type` iteration, no sibling fallback).                                                                                                                                                                            |
| A fully generic "entity type registry" with dynamic dispatch (`getResolvedEntity(type: string, ...)`) | **Reject for v1** | No existing precedent in `pcd/entities/` — every entity type has its own file/function (`serialize.ts`, `general/read.ts`, etc.). Introducing indirection here for ~5 entity types (custom formats, quality profiles, delay profiles, media management, metadata profiles) is premature; apply rule of three (see below).                                                              |
| A brand-new "comparison view" Svelte component from scratch                                           | **Reject**        | `Table.svelte` + `Badge.svelte` + `Column<T>` already produce a matrix view (`ParityMatrix.svelte`); reuse directly.                                                                                                                                                                                                                                                                   |

## Abstraction vs. Repetition

- **Repeat correctly**: `pcd/entities/serialize.ts` already has one function per entity type
  (`serializeDelayProfile`, `serializeRegularExpression`, `serializeCustomFormat`, …) instead of one generic
  reader. The resolved-config-viewer's read layer should follow the exact same shape — a
  `pcd/resolved/read.ts` with one thin function per entity type that delegates to the matching `serialize*`
  function. This matches the existing directory-per-entity-type convention throughout `pcd/entities/*` and
  avoids introducing a registry/dispatch abstraction that doesn't exist anywhere else in that tree.
- **Rule of three already crossed for array-diff key strategies**: `sectionDiffs.ts` already defines four
  array-key-strategy constants (`QUALITY_PROFILE_ARRAY_KEY_STRATEGIES`, `CUSTOM_FORMAT_ARRAY_KEY_STRATEGIES`,
  `QUALITY_DEFINITION_ARRAY_KEY_STRATEGIES`, `METADATA_PROFILE_ARRAY_KEY_STRATEGIES`) — the pattern is
  established; a viewer needing delay-profile or naming-entity array diffing should add a fifth constant in
  the same file/shape, not invent a new mechanism.
- **Where per-`arr_type` duplication is correct** (per CLAUDE.md Cross-Arr Semantic Validation Policy):
  - Quality mapping / compatibility resolution (`computeCompatibleProfileNames`) is intentionally
    `arr_type`-parameterized with no fallback between apps. The viewer's cross-instance comparison and any
    "is this profile valid for this Arr type" indicator must replicate this per-`arr_type` resolution, never
    a generic "works for all Arrs" shortcut.
  - `quality-definitions` is `native` per app (own tables: `radarr_quality_definitions`,
    `sonarr_quality_definitions`, `lidarr_quality_definitions` per `NATIVE_ENTITY_APPS` in
    `shared/arr/parity.ts`) — a resolved view for quality definitions must read the correct per-app table,
    not a shared one.
  - `metadata_profiles` is Lidarr-only (`native: ['lidarr']`) — the viewer must not render/attempt a
    metadata-profile resolved view for Radarr/Sonarr instances; gate on `arr_type` capability
    (`supportsArrSyncSurface`) exactly as `getEntitySupportStatus()` does.
- **Do not conflate the two existing diff mechanisms**: `sync/preview/diff.ts` (full resolved-entity
  structural diff) and `pcd/ops/draftChanges.ts` (single-op before/after diff from `desired_state`) solve
  different problems for different UIs (sync preview vs. draft/conflict review). The viewer needs the former;
  resist the urge to "unify" both into one diff abstraction — they operate on different inputs (full entity
  vs. single op) and merging them would entangle two independently-evolving features.

## Interface Design

Proposed public surface (server), so #7 (sync preview), #15 (drift detection), and #26 (dependency graph) can
build on it without re-deriving resolved state or diff logic:

```ts
// packages/praxrr-app/src/lib/server/pcd/resolved/read.ts
export async function getResolvedQualityProfile(
  cache: PCDCache,
  name: string
): Promise<PortableQualityProfile>;
export async function getResolvedCustomFormat(
  cache: PCDCache,
  name: string
): Promise<PortableCustomFormat>;
// ...one per entity type, delegating to entities/serialize.ts

// packages/praxrr-app/src/lib/server/pcd/resolved/layers.ts
export type ConfigLayer = 'base' | 'resolved'; // 'tweaks' deliberately excluded from v1 UI toggle (see Open Questions)
export async function buildLayerScopedCache(
  pcdPath: string,
  databaseInstanceId: number,
  layer: ConfigLayer
): Promise<PCDCache>;

// packages/praxrr-app/src/lib/server/pcd/resolved/diff.ts
export function diffEntityLayers(
  baseEntity: unknown,
  resolvedEntity: unknown
): FieldChange[]; // thin wrapper over diffToFieldChanges
export function diffAgainstLiveArr(
  desired: unknown,
  current: unknown,
  entityType: ParityEntity
): FieldChange[]; // wrapper selecting the right array-key strategy from sectionDiffs.ts
```

- **#7 (sync preview)**: the viewer's "diff against live Arr" mode should call the _same_
  `generatePreview()` / per-section `syncer.generatePreview()` functions sync preview uses (or a
  single-entity-narrowed variant of them), not a parallel comparator — this keeps sync preview and the viewer
  from silently drifting apart on what "changed" means (ignored fields, array-key strategies, namespace
  matching all live in one place: `sync/preview/`).
- **#15 (drift detection)**: a scheduled job can call the exact same `EntityChange[]`-producing functions on
  a cron and diff the result against the last stored summary — no new comparator needed, only new
  scheduling/persistence around the existing read-only preview functions.
- **#26 (dependency graph)**: `getReferencedCustomFormatNames()` (already in
  `packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`) already computes quality-profile →
  custom-format references for sync. A future dependency-graph feature should consume this function (and its
  siblings, if added for other entity types) as its edge source rather than re-deriving references from raw
  cache rows.
- Keep `pcd/resolved/*` functions **pure given a `PCDCache` input** (no direct DB/registry access inside the
  comparator functions) so callers control which cache (resolved vs. layer-scoped vs. another instance's) is
  passed in — this is what makes the same functions reusable by #7/#15/#26 without parameter creep.

## Testability Patterns

- **Pure functions, no I/O**: `diffToFieldChanges`, `diffEntityCollection`, `computeCompatibleProfileNames`
  are all callable with plain data/an already-built `PCDCache` and return data — no hidden network/DB calls
  inside the comparison logic itself. The new `pcd/resolved/diff.ts` and `layers.ts` functions should follow
  this shape exactly: given ops/entities, return `FieldChange[]`/`PortableX`, with all I/O (cache building,
  Arr fetches) happening in thin callers.
- **Mirror existing test layout**:
  - `packages/praxrr-app/src/tests/base/syncPreviewDiff.test.ts` — pure `Deno.test` against `diffToFieldChanges`
    with no server bootstrap. Add `packages/praxrr-app/src/tests/pcd/resolved/diff.test.ts` in the same style
    for `diffEntityLayers`/`diffAgainstLiveArr`.
  - `packages/praxrr-app/src/tests/pcd/snapshots/service.test.ts`, `packages/praxrr-app/src/tests/pcd/migration/*`
    — existing precedent for `tests/pcd/<feature>/*.test.ts` subdirectories; add `tests/pcd/resolved/`.
  - `packages/praxrr-app/src/tests/routes/parityMapApi.test.ts` — route-level test hitting the actual
    `+server.ts` handler; mirror as `tests/routes/resolvedConfigApi.test.ts`.
  - `packages/praxrr-app/src/tests/arr/parityMap.test.ts` — domain-logic test separate from the route test;
    mirror as `tests/pcd/resolved/*` for layer/entity logic vs. `tests/routes/*` for HTTP wiring.
- **Test alias**: add an entry to `scripts/test.ts` (pattern already used for `filters`, `normalize`,
  `upgrades`, etc.), e.g. `resolvedConfig: 'packages/praxrr-app/src/tests/pcd/resolved'`, so
  `deno task test resolvedConfig` works standalone during development.
- **Cross-Arr checklist** (per CLAUDE.md, required for Arr-touching changes): any test covering the
  cross-instance/live-Arr diff mode must assert per-`arr_type` behavior explicitly (e.g. a Lidarr-only
  metadata-profile fixture should not silently pass for a Radarr instance) rather than asserting once and
  assuming the other two Arr types behave identically.

## Build vs. Depend

| Need                                                               | Decision                                                                                                      | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural diff (desired vs. current, base vs. resolved)           | **Build (already built)** — reuse `diffToFieldChanges`                                                        | `deno.json` imports contain no diff library (`marked`, `simple-icons`, `highlight.js`, `croner`, `@std/yaml`, `@felix/bcrypt`, `@soapbox/kysely-deno-sqlite`, `@std/assert` — that's the full npm/jsr surface). All existing diffing (`sync/preview/diff.ts`, `pcd/ops/draftChanges.ts`) is hand-rolled. Adding `deep-diff`/`microdiff`/`fast-json-patch` would duplicate working code and introduce a dependency-hygiene violation per CLAUDE.md ("check whether an existing one does the job"). |
| JSON syntax highlighting for raw view                              | **Depend (already present)** — reuse `highlight.js` via `$ui/meta/JsonView.svelte`                            | Already a project dependency (`npm:highlight.js@^11.11.1`) used in `settings/logs` and `dev/components`; no new dependency needed.                                                                                                                                                                                                                                                                                                                                                                |
| Side-by-side/inline diff rendering (visual diff of two JSON blobs) | **Build, small**                                                                                              | `FieldChange[]` output from `diffToFieldChanges` is already structured (`field`, `type`, `current`, `desired`) — a small Svelte component rendering that list (reusing `Table`/`Badge` for change-type coloring) is simpler than pulling in a visual-diff library (e.g. `jsondiffpatch`) for a feature with a handful of entity shapes.                                                                                                                                                           |
| Layer-scoped cache build                                           | **Build**                                                                                                     | Reuses existing `loadAllOperations()` + `PCDCache` build path with an op-array filter; no library applies here since this is PCD-specific op-layer semantics.                                                                                                                                                                                                                                                                                                                                     |
| Cross-instance/live-Arr fetch                                      | **Build (already built)** — reuse `BaseArrClient` via `getArrInstanceClient()` and `syncer.generatePreview()` | Already implemented for sync preview; no new HTTP client needed.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Open Questions

1. **Does the layer toggle need a `tweaks` sub-view?** The feature description says "base only / user
   overrides / resolved" (2 real layers + resolved), but the cache build pipeline has 4 physical layers
   (`schema`, `base`, `tweaks`, `user`). Confirm whether `tweaks` should be folded into "base" for display
   purposes (proposed default above) or exposed as its own toggle state.
2. **Single-entity vs. full-section live-Arr diff**: `syncer.generatePreview()` computes diffs for an entire
   section (e.g. all quality profiles) in one call. Does the viewer need a per-entity-scoped variant (to avoid
   fetching/diffing every profile when a user just wants one), or is reusing the full-section result and
   filtering client-side acceptable for expected data volumes?
3. **Cross-instance comparison scope**: should it compare the _desired_ PCD payload across two instances
   (arr_type-normalized) or compare each instance's _live_ state against the other? These are different
   semantics (config-authoring parity vs. runtime drift-between-instances) and the UI/API contract should
   name them distinctly to avoid the ambiguity the Cross-Arr policy warns against.
4. **Ephemeral cache lifetime for layer-scoped builds**: should a layer-scoped `PCDCache` be built fresh per
   HTTP request (simplest, recommended) or cached briefly (e.g. `sync/preview/store.ts`-style TTL keyed by
   `databaseId+layer`) if profiling shows repeated rebuilds are a hot path? Start with per-request and only
   add caching if `CacheBuildStats.timing` data shows it's warranted (KISS).
5. **Ownership of `pcd/resolved/diff.ts` vs. `sync/preview/`**: this research recommends `pcd/resolved`
   depend on `sync/preview` (one-directional). Confirm the team is comfortable with that dependency direction
   before implementation, since `pcd/` has historically been the lower-level module and `sync/` the
   higher-level consumer.
