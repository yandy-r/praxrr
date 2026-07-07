# Resolved Config Viewer Implementation Plan

Issue #25 surfaces the PCD cache's already-resolved configuration state through a new read-only
`$pcd/resolved/*` server service, four contract-first endpoints under
`/api/v1/pcd/{databaseId}/resolved/**`, and a viewer page at `/resolved-config/[databaseId]` with
a base/user/resolved layer toggle, single-instance live diff, and cross-instance comparison. The
only net-new server primitive is `PCDCache.buildReadOnly({ layers })` — a side-effect-free,
ephemeral, never-registered replay variant of `build()`; everything else composes existing
machinery (`entities/serialize.ts` readers, `sync/preview` diff engine + orchestrator + rate
limits, parity-map route/page patterns). Security constraints are load-bearing: no
`{@html}`/`marked.*` in any new component (C1), SSRF guard centralized in
`getArrInstanceClient()` (W1), sanitized reason enums instead of raw error text (W2), instance
cap + rate window for fan-out (W3), canonical `isArrAppType()` validation (W4), and
`arrInstancesQueries`-only instance access (W5).

## Worktree Setup

- **Parent**: ~/.claude-worktrees/praxrr-resolved-config-viewer/ (branch: feat/resolved-config-viewer)

> **Plan-file handoff**: `parallel-plan.md` and `shared.md` live in `docs/plans/resolved-config-viewer/`
> (main checkout). The implementor moves them into the feature worktree once created — never copied
> or synced.

## Critically Relevant Files and Documentation

- docs/plans/resolved-config-viewer/shared.md: file-level context map — required reading for every task
- docs/plans/resolved-config-viewer/feature-spec.md: feature contract (API shapes, business rules, security requirements)
- docs/plans/resolved-config-viewer/analysis-code.md: line-level anatomy of `PCDCache.build()`, serializer inventory, section-payload shapes, `readers.ts`/`buildReadOnly` sketches
- docs/plans/resolved-config-viewer/analysis-context.md: cross-cutting concerns, constraints, verified corrections
- docs/plans/resolved-config-viewer/analysis-tasks.md: dependency rationale and shared-file strategies
- packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts: handler shape to copy verbatim
- packages/praxrr-app/src/lib/server/pcd/database/cache.ts: `buildReadOnly` extraction target
- packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts: the 15 reader functions
- packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts: `generatePreview()` reuse for live diff
- packages/praxrr-app/src/routes/parity-map/+page.server.ts: page-load pattern
- packages/praxrr-app/src/tests/routes/parityMapApi.test.ts: route-test fixture recipe
- CLAUDE.md (repo root): Cross-Arr Semantic Validation Policy, Portable Contract Fidelity, Arr Cutover Guardrails

## Implementation Plan

### Phase 1: Foundation (all independent — Batch 1)

#### Task 1.1: Author full OpenAPI contract and regenerate types Depends on [none]

**READ THESE BEFORE TASK**

- docs/api/v1/paths/compatibility.yaml
- docs/api/v1/schemas/compatibility.yaml
- docs/api/v1/schemas/sync.yaml
- docs/api/v1/openapi.yaml (registration line patterns ~L347-349, ~L615-616, ~L1329-1333)
- docs/plans/resolved-config-viewer/feature-spec.md (API Design + Data Models sections)

**Instructions**

Files to Create

- docs/api/v1/paths/resolved-config.yaml
- docs/api/v1/schemas/resolved-config.yaml

Files to Modify

- docs/api/v1/openapi.yaml
- packages/praxrr-app/src/lib/api/v1.d.ts (regenerated — never hand-edited)
- packages/praxrr-api/openapi.json, packages/praxrr-api/types.ts (regenerated via bundle)

Author the ENTIRE contract in one pass so no later task re-touches OpenAPI: four path items
(list `GET /pcd/{databaseId}/resolved/{entityType}`, named `GET .../{name}`, compare
`GET .../{name}/compare`, diff `GET .../{name}/diff`) and six schemas (`ResolvedLayer`
enum base|user|resolved; `ResolvedEntityState` { databaseId, entityType, name, layer, present,
entity?, overrides?, hasPendingConflict (boolean — value-guard conflict indicator, Business Rule 6) };
`ResolvedEntityListResponse`; `ResolvedInstanceState` { instanceId,
instanceName, arrType, compatible, present, desired?, actual?, error? — error is a closed reason
enum string }; `CrossInstanceComparisonResponse`; `ResolvedLiveDiffResponse`). `$ref`
`EntityChange`/`FieldChange` from `./sync.yaml` — do not redefine. Mirror compatibility.yaml's
operationId/tags/response conventions (200/400/401/404/429/500 per feature-spec error tables).
Register every path and every named schema individually in openapi.yaml. Then run
`deno task generate:api-types` and `deno task bundle:api`. Verify `components['schemas']['ResolvedEntityState']`
exists in packages/praxrr-app/src/lib/api/v1.d.ts. Gotcha: query params (`layer`, `arrType`,
`instanceIds`, `includeLive`, `instanceId`) must be documented on the path items; `docs/api/errors.md`
holds the status-code conventions.

#### Task 1.2: Resolved readers dispatch table Depends on [none]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts
- docs/plans/resolved-config-viewer/analysis-code.md (readers.ts dispatch table shape + serializer inventory table)
- packages/praxrr-app/src/lib/server/pcd/index.ts
- scripts/test.ts

**Instructions**

Files to Create

- packages/praxrr-app/src/lib/server/pcd/resolved/readers.ts
- packages/praxrr-app/src/lib/server/pcd/resolved/types.ts

Files to Modify

- packages/praxrr-app/src/lib/server/pcd/index.ts
- scripts/test.ts

Create `types.ts` with the `ResolvedEntityType` union (delayProfile, regularExpression,
customFormat, qualityProfile, naming, mediaSettings, qualityDefinitions, lidarrMetadataProfile),
`ResolvedLayer` type, and reader-fn types. Create `readers.ts` with two hand-written tables
exactly as sketched in analysis-code.md: `ARR_AGNOSTIC_READERS` (delayProfile, regularExpression,
customFormat, qualityProfile → matching `serialize*` fns) and `PER_ARR_READERS` (naming,
mediaSettings, qualityDefinitions → per-arr fns; lidarrMetadataProfile → lidarr only). Export a
`readResolvedEntity(cache, entityType, arrType | undefined, name)` that: requires `arrType` for
per-arr types (throw a typed validation error when missing/unmapped — NO sibling fallback, per
Cross-Arr policy), rejects `arrType` for agnostic types, and propagates serialize.ts's
`Error('... not found')` for the route to map to 404. Also export a `listResolvedEntityNames(cache,
entityType, arrType?)` helper (Kysely reads over cache tables — `quality_profiles`,
`custom_formats`, `delay_profiles`, `regular_expressions`, `{arr}_naming`, `{arr}_media_settings`,
`{arr}_quality_definitions` name lists, `lidarr_metadata_profiles`) for the list endpoint. Add a
`// ==== RESOLVED CONFIG ====` banner section to pcd/index.ts re-exporting the public surface (own
export lines only — later tasks append their own). Add the test alias to scripts/test.ts:
`resolvedConfig: 'packages/praxrr-app/src/tests/pcd/resolved,packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts'`.
Write packages/praxrr-app/src/tests/pcd/resolved/readers.test.ts (pure Deno.test + minimal
in-memory-SQLite cache fixture per parityMapApi.test.ts recipe): dispatch correctness, fail-fast on
(lidarrMetadataProfile, radarr) and missing-arrType cases, 404-shaped Error propagation.

#### Task 1.3: PCDCache.buildReadOnly primitive Depends on [none]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/pcd/database/cache.ts (entire file)
- packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts
- docs/plans/resolved-config-viewer/analysis-code.md (build() anatomy + buildReadOnly sketch + gotchas)
- packages/praxrr-app/src/tests/pcd/snapshots/service.test.ts (patch-and-restore idiom)

**Instructions**

Files to Create

- packages/praxrr-app/src/tests/pcd/resolved/cacheBuildReadOnly.test.ts

Files to Modify

- packages/praxrr-app/src/lib/server/pcd/database/cache.ts

Add `async buildReadOnly(options: { layers: ReadonlySet<'schema'|'base'|'tweaks'|'user'> }): Promise<void>`
as a sibling method to `build()` following the sketch in analysis-code.md: fresh
`Database(':memory:', { int64: true })` + `PRAGMA foreign_keys = ON` + Kysely +
`registerHelperFunctions()`, `loadAllOperations()` then post-load
`.filter((op) => options.layers.has(op.layer))` (do NOT modify loadOps.ts — the returned array is
already fully sorted, so filtering preserves relative order), `validateOperations()`, then a bare
per-op `this.db.exec(operation.sql)` inside its own try/catch that `logger.warn`s and continues.
MUST NOT call: `evaluateValueGuardApply/Error`, `pcdOpsQueries.update`,
`pcdOpHistoryQueries.create`, `disableDatabaseInstance`, or `setCache`. Set `built = true` at the
end so `kb`/`query()` work; callers own `close()`. Keep `build()` byte-identical in behavior — if
you extract shared bootstrap (open DB + helpers), do it as a small private method used by both;
do not restructure the write path's guard/history logic. Test with patch-and-restore spies
(patchTarget on `pcdOpsQueries.update`, `pcdOpHistoryQueries.create` + patched loadAllOperations
returning a synthetic op list across all four layers, patchLoggerForTest): assert layer filtering
works (user ops excluded when layers = schema+base+tweaks), zero calls to both spied writers, a
failing op is skipped without aborting, and `isBuilt()` is true after. Never run a real
`PCDCache.build()` in tests.

#### Task 1.4: liveDiff service module Depends on [1.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts
- packages/praxrr-app/src/lib/server/sync/preview/types.ts (section payload shapes)
- packages/praxrr-app/src/lib/server/sync/namespace.ts (findNamespaceMatch)
- packages/praxrr-app/src/lib/server/utils/arr/testConnectionReason.ts (reason-enum pattern)
- docs/plans/resolved-config-viewer/analysis-code.md (liveDiff composition + payload-shape table)

**Instructions**

Files to Create

- packages/praxrr-app/src/lib/server/pcd/resolved/liveDiff.ts
- packages/praxrr-app/src/tests/pcd/resolved/liveDiff.test.ts

Files to Modify

- packages/praxrr-app/src/lib/server/pcd/resolved/index barrel is NOT created — append one export line to packages/praxrr-app/src/lib/server/pcd/index.ts

Create `liveDiff.ts` exporting `computeLiveDiff({ instance, entityType, name, nowMs })`: map
`ResolvedEntityType` → sync `SectionType` (qualityProfile/customFormat → qualityProfiles;
delayProfile → delayProfiles; naming/mediaSettings/qualityDefinitions → mediaManagement;
lidarrMetadataProfile → metadataProfiles; `regularExpression` has NO sync SectionType — short-circuit
it to `{ reason: 'unsupported' }` before any gating/preview call, and add a test case for it); gate
first with `isSyncSectionSupported(arrType, section)` (return `{ reason: 'unsupported' }` — never a
misleading empty diff; note: Sonarr-v3-app custom-format unavailability surfaces as a sanitized
per-section failure reason, not a crash — app-version probing is explicitly deferred out of v1); call
`generatePreview({ instance, sections: [section], nowMs })`; locate the entity's `EntityChange`
per the shape table (arrays `.find()` by namespace-aware name via `findNamespaceMatch`; singletons
direct field access); return the `EntityChange` (its `.fields` is already the diff — never
re-diff). Define a local closed reason union
(`'unreachable'|'timeout'|'unauthorized'|'invalid_response'|'unsupported'|'not_found'`) with pure
mapping helpers following testConnectionReason.ts — raw `error.message` never escapes (full detail
via `logger.error` only). Pure given inputs: takes the `ArrInstance` row (caller fetches via
`arrInstancesQueries`), performs no DB writes, never calls `arrNamespaceQueries.getOrCreate`. Test
with patch-and-restore stubs of `generatePreview` (synthetic GeneratePreviewResult payloads):
per-arr gating (metadataProfiles on radarr → unsupported), array vs singleton location, suffix-name
matching, error→reason mapping.

#### Task 1.5: Centralize SSRF guard in getArrInstanceClient (W1) Depends on [none]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts
- packages/praxrr-app/src/lib/server/utils/arr/urlSafety.ts

**Instructions**

Files to Create

- packages/praxrr-app/src/tests/base/arrInstanceClientUrlSafety.test.ts (or extend an existing urlSafety test file if one exists)

Files to Modify

- packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts

Call `assertSafeArrUrl(url)` at the top of `getArrInstanceClient()` (before credential decryption
— fail fast, both return paths covered). `assertSafeArrUrl` deliberately allows RFC1918/loopback
(LAN Arr instances are legitimate) and blocks cloud-metadata/link-local/non-http(s) — so existing
tests and dev setups keep working. Blast radius: this guards every existing Arr-fetch path
(sync preview, arr/library, releases, upgrades) — that is the point (the guard currently has zero
call sites in the app beyond two test-connection routes). Add tests: metadata IP
(`http://169.254.169.254`) throws; `http://192.168.1.10:7878` and `http://localhost:8989` pass
(stub credential lookup via patch-and-restore so no real DB is needed).

#### Task 1.6: Fan-out limits module (W3) Depends on [1.4]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/utils/rateLimit.ts
- packages/praxrr-app/src/lib/server/sync/preview/limits.ts (shape precedent)

**Instructions**

Files to Create

- packages/praxrr-app/src/lib/server/pcd/resolved/limits.ts
- packages/praxrr-app/src/tests/pcd/resolved/limits.test.ts

Files to Modify

- packages/praxrr-app/src/lib/server/pcd/index.ts (append own export line under the RESOLVED CONFIG banner — dependency on 1.4 exists solely to serialize this shared-file append after 1.2 → 1.4)

Create `limits.ts` exporting `COMPARE_MAX_INSTANCES = 8`, `assertInstanceCountWithinCap(ids)`
(or boolean check) and `registerCompareAttempt(key: string): boolean` built on
`registerRateLimitAttempt` from `$utils/rateLimit.ts` (per-user/session window; sensible defaults,
e.g. 8 requests / 30s using the util's defaults). Keep it dependency-light and pure. Test: cap
boundary (8 ok, 9 rejected), window behavior via `resetRateLimitForTests()`.

### Phase 2: Core server composition (Batch 2)

#### Task 2.1: List + named resolved endpoints (layer=resolved) Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts
- packages/praxrr-app/src/tests/routes/parityMapApi.test.ts (fixture recipe)
- docs/plans/resolved-config-viewer/analysis-code.md (route triad + guidance)

**Instructions**

Files to Create

- packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts
- packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/+server.ts
- packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts

Copy the parity handler shape verbatim: auth-first 401 → `/^\d+$/` databaseId 400 →
`pcdManager.getCache(id)?.isBuilt()` 400 "Database not found" → try/catch sanitized `logger.error`
→ generic 500 → every response `satisfies components['schemas'][...]`. Validate `entityType`
against the readers table (400 unknown), `arrType` query param via `isArrAppType()` when present
(400 invalid; 400 missing-when-required for per-arr types; 400 present-for-agnostic types). This
task implements `layer=resolved` only (default): list endpoint returns
`ResolvedEntityListResponse` via `listResolvedEntityNames` + per-name reads (or names+present
without full payloads if the schema allows); named endpoint returns `ResolvedEntityState` with the
Portable payload, 404 when serialize throws not-found. Reject `layer=base|user` with 400 "layer
not yet supported" until Task 3.1 wires them (contract already documents them). BigInt gotcha: the
cache opens SQLite with int64 — pass payloads through a BigInt→Number/String replacer before
`json()`. Create resolvedConfigApi.test.ts (THE canonical creator — later tasks append): fixture
per parityMapApi recipe (in-memory SQLite + only the tables needed + `setCache`/`deleteCache`
try/finally); cases: 401 unauth, 400 bad databaseId/unknown entityType/unbuilt cache/bad arrType,
200 list, 200 named, 404 named miss.

#### Task 2.2: layers.ts + layerDiff.ts Depends on [1.2, 1.3, 1.6]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/pcd/resolved/readers.ts (from Task 1.2)
- packages/praxrr-app/src/lib/server/sync/preview/diff.ts
- packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts (strategy constants — note they use live-Arr field names)
- docs/plans/resolved-config-viewer/analysis-code.md (layerDiff composition + array-key gotcha)

**Instructions**

Files to Create

- packages/praxrr-app/src/lib/server/pcd/resolved/layers.ts
- packages/praxrr-app/src/lib/server/pcd/resolved/layerDiff.ts
- packages/praxrr-app/src/tests/pcd/resolved/layers.test.ts
- packages/praxrr-app/src/tests/pcd/resolved/layerDiff.test.ts

Files to Modify

- packages/praxrr-app/src/lib/server/pcd/index.ts (append own export line)

`layers.ts`: `withBaseOnlyCache(databaseId, fn)` — look up `pcdPath` via
`databaseInstancesQueries.getById(databaseId)` (its local path field), construct
`new PCDCache(pcdPath, databaseId)`, `await buildReadOnly({ layers: new Set(['schema','base','tweaks']) })`,
run `fn(cache)`, and `close()` in finally. Build per request; never register in the registry; no
memoization in v1 (KISS — note timing via CacheBuildStats-style log if cheap). `layerDiff.ts`:
`computeUserOverrides(baseEntity, resolvedEntity): FieldChange[]` wrapping `diffToFieldChanges`.
IMPORTANT: the exported `*_ARRAY_KEY_STRATEGIES` constants target live-Arr API field names —
define new Portable-field-named `PreviewArrayKeyStrategy[]` for Portable shapes (e.g. quality
profile `qualities`/`customFormatScores`, custom format `conditions` keyed by name) — inspect the
actual `Portable*` types in $shared/pcd/portable.ts and key every nested array by a stable
name/id, never index. Also export `resolveLayerState(databaseId, entityType, arrType, name, layer)`
composing readers + layers + diff: `resolved` → registry cache read; `base` → base-only cache
read (present:false when missing); `user` → read both, diff, `overrides: FieldChange[]`. Every
`ResolvedEntityState` must also carry `hasPendingConflict`: query
`pcdOpHistoryQueries.listLatestConflictsByDatabase(databaseId)` once per request and flag the
entity when any conflicted/conflicted_pending op targets it (match via op `metadata.entity`/
`metadata.name` — see `pcd/ops/draftChanges.ts` for the correlation precedent). This is Business
Rule 6: entities with pending value-guard conflicts must never present an unambiguous resolved
value. Tests:
pure layerDiff tests (no I/O — synthetic Portable objects, array reorder must not produce
changes when keyed), layers.ts test with patch-and-restore stubs (buildReadOnly spied — assert
close() always called, even on thrown fn).

#### Task 2.3: compare.ts (cross-instance) Depends on [1.2, 1.6, 2.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/pcd/resolved/readers.ts and limits.ts (from Tasks 1.2/1.6)
- packages/praxrr-app/src/lib/server/sync/mappings.ts (isSyncSectionSupported)
- packages/praxrr-app/src/lib/shared/arr/capabilities.ts (isArrAppType)
- docs/plans/resolved-config-viewer/feature-spec.md (CrossInstanceComparisonResponse semantics)

**Instructions**

Files to Create

- packages/praxrr-app/src/lib/server/pcd/resolved/compare.ts
- packages/praxrr-app/src/tests/pcd/resolved/compare.test.ts

Files to Modify

- packages/praxrr-app/src/lib/server/pcd/index.ts (append own export line)

`compare.ts`: `compareAcrossInstances({ cache, databaseId, entityType, name, instances, includeLive, nowMs })`
— for each instance (already fetched by the route via `arrInstancesQueries`): resolve `arr_type`
(validate with `isArrAppType`), gate entity-type support per arr (readers table + section support —
`compatible: false` with explicit reason when unsupported, never an empty diff), produce the
per-instance desired payload via the readers dispatch (per-arr reader where applicable), and when
`includeLive` fetch live state per instance via `generatePreview` (register
`registerPreviewCreateAttempt(instanceId, nowMs)` per instance; per-instance failures become
sanitized reason statuses, not request failures — duplicate a local reason union, do NOT import
liveDiff's, to keep tasks independent). Compute pairwise diffs vs the first compatible instance's
desired payload using `diffToFieldChanges` with the Portable-field strategies (import from
layerDiff if exported, else define locally — prefer importing the strategy constants from a shared
`pcd/resolved/` location if Task 2.2 exported them; if not yet available, define locally and leave
a TODO consolidation note). Enforce nothing about rate limits here beyond per-instance preview
attempts — the request-level cap/window lives in the route (Task 3.3). Tests: patch-and-restore
stubs; mixed-arr_type set (radarr+sonarr+lidarr) with lidarrMetadataProfile → only lidarr
compatible; instance failure → reason status while others succeed; desired-only mode does zero
network calls.

### Phase 3: Remaining endpoints + page shell (Batch 3)

#### Task 3.1: Wire layer=base|user into the resolved endpoints Depends on [2.1, 2.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts (from Task 2.1)
- packages/praxrr-app/src/lib/server/pcd/resolved/layers.ts + layerDiff.ts (from Task 2.2)

**Instructions**

Files to Modify

- packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts
- packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/+server.ts
- packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts (append cases)

Replace the 400 "layer not yet supported" stub with `resolveLayerState` dispatch: `layer=base`
returns the base-only Portable payload (`present:false` + `entity:null` when the entity only
exists via user ops); `layer=user` returns `overrides: FieldChange[]` (empty array when no
overrides — the UI renders the explicit "matches base" state); named-miss semantics per
feature-spec: 404 only for hard miss in resolved layer, `present:false` otherwise. Ensure the
ephemeral cache is built at most once per request (list endpoint with layer=base must not rebuild
per entity — build once, read all names). Append route tests: layer=base returns base values
(fixture: cache with base + user rows diverging — simulate via two registered fixtures or a
patched withBaseOnlyCache), layer=user returns the field diff, layer=user with no user ops returns
empty overrides, zero writes assertion (spies on pcdOpsQueries/pcdOpHistoryQueries during a
layer=base request).

#### Task 3.2: GET .../diff endpoint Depends on [1.1, 1.4, 2.1, 3.1]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/pcd/resolved/liveDiff.ts (from Task 1.4)
- packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts (rate-limit precedent)
- packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts (append — created by Task 2.1)

**Instructions**

Files to Create

- packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/diff/+server.ts

Files to Modify

- packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts (append cases)

Parity-shape handler: validate `instanceId` query param (integer, `arrInstancesQueries.getById`
404 when missing), enforce `registerPreviewCreateAttempt(instanceId, Date.now())` → 429 (note the
required two-arg signature), call `computeLiveDiff`, return `ResolvedLiveDiffResponse`
(`changes: [EntityChange]` or empty for in-sync; unsupported (arrType, entityType) → 400 with the
sanitized reason). Never echo raw error text; instance URL/API key never appear in any response.
Append tests: 429 after limit exhaustion (reset helper in finally), 404 unknown instance, 400
unsupported combo, 200 with stubbed liveDiff.

#### Task 3.3: GET .../compare endpoint Depends on [1.1, 1.6, 2.3, 2.1, 3.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/pcd/resolved/compare.ts + limits.ts (from Tasks 2.3/1.6)
- packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts (append — created by Task 2.1)

**Instructions**

Files to Create

- packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/compare/+server.ts

Files to Modify

- packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts (append cases)

Parity-shape handler: parse `instanceIds` (comma-separated; validate EACH element as a positive
integer; existence-check each via `arrInstancesQueries.getById`; 400 on any invalid), enforce the
instance cap (`COMPARE_MAX_INSTANCES` = 8 → 400 above) and the per-user window
(`registerCompareAttempt` keyed by user/session id or 'global' fallback → 429), parse `includeLive`
boolean (register per-instance preview attempts only when true), call `compareAcrossInstances`,
return `CrossInstanceComparisonResponse`. Per-instance failures are inline `error` reason statuses
— the request succeeds with partial results. Append tests: cap exceeded → 400, 429 window, mixed
compatible/incompatible instances, credential absence in response payload.

#### Task 3.4: Viewer page shell + resolved panel + navigation Depends on [2.1]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/routes/parity-map/+page.server.ts
- packages/praxrr-app/src/routes/parity-map/+page.svelte
- packages/praxrr-app/src/lib/client/ui/meta/JsonView.svelte
- packages/praxrr-app/src/lib/server/navigation/registry.ts (parity_map / score_simulator entries)
- docs/plans/resolved-config-viewer/research-ux.md (workflows + empty states) — skim

**Instructions**

Files to Create

- packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.server.ts
- packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.svelte
- packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte

Files to Modify

- packages/praxrr-app/src/lib/server/navigation/registry.ts

`+page.server.ts` mirrors parity-map: digit-regex validation, `pcdManager.getAll()` for the
database picker, `{ error?: string }` inline in data (no SvelteKit error page). `+page.svelte`:
Svelte 4 style ONLY (`export let data`, `$:`, plain `let`, `on:click`/`on:change`); database picker
(`<select on:change>` → `goto()` with `?databaseId=`), entity-type selector + entity-name picker
(fetch from the list endpoint), and — critically — an extensible tab/section registry
(`{ id, label, component }[]`) so Tasks 4.2/4.3 each add one array entry without touching the same
render ladder. Empty-state ladder: no databases / none selected / no entities / populated.
`ResolvedStatePanel.svelte`: fetches the named endpoint (`layer=resolved`), renders the Portable
payload as a field table + `JsonView.svelte` raw toggle; the layer segmented control (Toggle-based,
3 segments) is present but Base/User segments disabled with a "coming in this PR" stub until Task
4.1 (they land in the same PR — keep the disabled state only at this task's commit). ALL values
rendered as escaped `{value}` text — no `{@html}`, no `marked.*` (C1). Add one NAV_REGISTRY entry
(id e.g. `overview.resolved_config`, href `/resolved-config`, follow the parity_map shape
including groupId/order/arrScope/mobilePriority/iconKey/emoji). Note: if the nav item needs a
databaseId-less landing, mirror how parity-map's href works (it's a plain page href — check the
existing entry and match it; the page itself handles "none selected").

### Phase 4: UI completion + final verification (Batch 4)

#### Task 4.1: Layer toggle UI (base/user/resolved) Depends on [3.4, 3.1]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte (ACTION_META/FIELD_META triple-encoding)
- packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte (from Task 3.4)
- packages/praxrr-app/src/lib/client/ui/state/EmptyState.svelte

**Instructions**

Files to Modify

- packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte

Enable the Base and User segments: `base` re-fetches with `layer=base` and renders the same field
table against the base payload (with `present:false` handled as an explicit "does not exist in
base" state); `user` fetches `layer=user` and renders the `FieldChange[]` table reusing the
glyph+color+label triple-encoding vocabulary from SyncPreviewEntityDiff (field / type
added|changed|removed / current / desired columns — keep FieldChange's added/changed/removed
vocabulary, distinct from EntityChange's create/update/delete). Explicit informational empty state
for zero overrides: "No user overrides — resolved state matches base" (EmptyState, not error
styling). When `hasPendingConflict` is true on any layer response, render a warning badge
("Pending value-guard conflict") linking to `/databases/{databaseId}/conflicts` — the resolved
value must never look unambiguous while a conflict is pending (Business Rule 6). Escaped text
only. Loading skeleton while layer fetches; segmented control disabled during fetch.

#### Task 4.2: Live diff panel Depends on [3.4, 3.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte
- packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.svelte (tab registry from Task 3.4)
- docs/plans/resolved-config-viewer/research-ux.md (error-states table) — skim

**Instructions**

Files to Create

- packages/praxrr-app/src/routes/resolved-config/[databaseId]/LiveDiffPanel.svelte

Files to Modify

- packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.svelte (one additive tab-registry entry)

Instance selector (fetch instances from the existing instances API/page-data — never render
api_key; only name/type/url-host), "Check against live" action calling the /diff endpoint. Render
the returned EntityChange.fields with the triple-encoded diff table. Three UNAMBIGUOUS terminal
states: (1) in-sync positive state ("In sync — no differences"), (2) differences table, (3)
check-failed state with the sanitized reason (`unreachable`/`timeout`/`rate-limited`...) + retry
affordance — an empty diff must NEVER be conflatable with a failed check. 429 → explicit
rate-limit message with retry hint, not a silent spinner. Desired side context renders instantly
(already loaded); only the live check waits.

#### Task 4.3: Cross-instance comparison grid Depends on [3.4, 3.3, 4.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte (Table/Badge/Column idiom)
- packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.svelte (tab registry from Task 3.4)

**Instructions**

Files to Create

- packages/praxrr-app/src/routes/resolved-config/[databaseId]/CrossInstanceGrid.svelte

Files to Modify

- packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.svelte (one additive tab-registry entry)

Multi-select up to 8 instances; call /compare (desired-only by default; `includeLive` checkbox).
Render with `$ui/table/Table.svelte` + `Badge.svelte` + `Column<T>[]` exactly per ParityMatrix —
no bespoke grid. Column headers: instance name + arrType badge + status (compatible / incompatible
reason / error reason). Per-instance columns resolve independently — a failed instance shows its
sanitized reason inline while others render. Diff cells use glyph+text (never color-only). Cap
feedback: selecting a 9th instance is prevented client-side with a message mirroring the server
cap.

#### Task 4.4: Redaction + CORS + preview-equivalence regression sweep Depends on [2.1, 3.1, 3.2, 3.3, 3.4]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts (BaseTest registration pattern)
- docs/plans/resolved-config-viewer/feature-spec.md (Success Criteria)

**Instructions**

Files to Create

- packages/praxrr-app/src/tests/pcd/resolved/equivalence.test.ts (small — see below)

Files to Modify

- packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts

Add one redaction case per new surface (list, named, diff, compare, and the page load): seed a
fixture with a known SECRET_VALUE as an instance api_key, call each handler/load, and
`assertPayloadNoLeak` + `assertFalse('api_key' in payload)` on every response. Add a
CORS-absence assertion (A2): each new endpoint's response has no `Access-Control-Allow-Origin`
header. Equivalence test (Success Criterion 1): with one shared fixture cache, assert the named
resolved endpoint's entity payload equals `serialize*`'s direct output for the same entity (they
must share the same code path — this is a tripwire against future drift, cheap to assert).

## Advice

- Same-file appends are serialized via explicit micro-dependencies because all tasks share ONE
  worktree (concurrent same-file edits would clobber, not merge): `pcd/index.ts` appends run
  1.2 → 1.4 → 2.2 → 2.3; `tests/routes/resolvedConfigApi.test.ts` appends run 2.1 → 3.1 → 3.2 →
  3.3; `+page.svelte` tab entries run 3.4 → 4.2 → 4.3. Do not remove these ordering edges to
  "win back" parallelism. Everything else is file-disjoint per batch — keep it that way.
- Run `deno task generate:api-types` + `deno task bundle:api` exactly once (Task 1.1). If a later
  task finds a contract gap, amend the contract first and regenerate — never hand-edit
  `v1.d.ts`/`openapi.json`, and never let a handler ship an undocumented field (Portable Contract
  Fidelity).
- `registerPreviewCreateAttempt(instanceId, nowMs)` takes TWO required args. `SUPPORTED_SYNC_SECTIONS`
  is module-private — use `isSyncSectionSupported()`/`getUnsupportedSyncSectionReason()`.
  `arrNamespaceQueries.getOrCreate` mutates — resolved paths may only use `.get()` or the pure
  `findNamespaceMatch()`.
- The exported `*_ARRAY_KEY_STRATEGIES` diff strategies use live-Arr API field names; layer diffs
  operate on `Portable*` shapes and need their own strategy paths (quality items by quality name,
  CF scores by format name, conditions by name) or array reorders will read as spurious changes.
- `buildReadOnly` must stay a parallel method: no value guards, no history writes, no
  `pcd_ops.state` mutation, no `disableDatabaseInstance`, never registered via `setCache`, caller
  owns `close()`. The zero-write test (spies on `pcdOpsQueries.update` +
  `pcdOpHistoryQueries.create`) is the feature's most important regression tripwire.
- Formatting: trust `.prettierrc` (2-space, 120 width, es5 trailing commas) — CLAUDE.md's prose is
  stale — and run `deno task format` before every commit. Svelte components follow the actual
  codebase convention (`export let`, `$:`, `on:click`) — no runes, no `onclick=`.
- Security is a merge gate, not polish: no `{@html}`/`marked.*` anywhere in new components (C1);
  raw `error.message` never in a response body (W2); every handler validates `arrType` via
  `isArrAppType()` (W4); instance metadata only via `arrInstancesQueries` (W5).
- Verification per task: `deno task lint`, `deno task check`, `deno task test resolvedConfig`; for
  Arr-touching tasks, explicitly walk CLAUDE.md's Cross-Arr checklist (per-arr semantics verified,
  explicit arr_type dispatch, fail-fast on ambiguity) — assert per-arr behavior in tests, not just
  radarr.
