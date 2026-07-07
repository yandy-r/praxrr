# Architecture Research: resolved-config-viewer

## System Overview

The PCD subsystem compiles an in-memory SQLite cache per database instance by replaying
schema→base→tweaks→user SQL ops (`loadAllOperations`) through `PCDCache.build()`, which is
the **only** method that executes ops, evaluates value guards, and writes `pcd_op_history` —
and it is only ever invoked from `database/compiler.ts#compile()`, the sole place a `PCDCache`
is registered into the module-level `registry.ts` map. The sync-preview pipeline
(`sync/preview/orchestrator.ts#generatePreview()`) is a fully separate, read-only path that
fetches a fresh Arr client, runs each section syncer's `generatePreview()`, and produces
`EntityChange[]`/`FieldChange[]` via `sync/preview/diff.ts#diffToFieldChanges()` — this diff
engine has zero dependency on PCDCache and is directly reusable. `entities/serialize.ts`
already reads the compiled cache into arr-agnostic `Portable*` shapes, but only as 15 discrete
named functions (no generic `(entityType, arrType)` dispatcher exists yet). All feature-spec
architectural claims were verified against source; the only material corrections are noted
below (rate-limiter signature, and DEFAULT/empty array-key-strategy behavior nuances).

## Relevant Components (path: role)

- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts` — `PCDCache` class; `build()` (L38-296),
  `registerHelperFunctions()` (SQL `qp/cf/dp/mp/tag` lookups), `isBuilt()`, `getRawDb()`, `close()`,
  `kb` getter, `query()`/`queryOne()`, `validateSql()`. `built` is a private boolean flag.
- `packages/praxrr-app/src/lib/server/pcd/database/registry.ts` — module-level `Map<number, PCDCache>`;
  exports `setCache`, `getCache`, `hasCache`, `deleteCache`, `getCachedDatabaseIds`, `clearAllCaches`.
  A `buildReadOnly` cache must **never** call `setCache`.
- `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts` — `compile(pcdPath, databaseInstanceId)`
  is the only caller of `new PCDCache(...).build()` and the only place that calls `setCache`;
  also runs `autoResolveOverrideConflicts()` post-swap. `invalidate()`/`invalidateAll()` close+delete.
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts` — `pcdManager` singleton; `getCache(id)`
  thin wrapper over `registry.getCache`; `getAll()`, `getById()` over `databaseInstancesQueries`.
- `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts` — `loadAllOperations(pcdPath, databaseInstanceId)`:
  exact 4-stage order (schema files → base published DB ops → base draft DB ops offset by
  `DRAFT_SEQUENCE_BASE = 3_000_000_000` → tweaks files → user published DB ops).
- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts` (385 lines) — 15 `serialize*(cache, name)`
  functions (delay profile, regex, custom format, quality profile, per-arr naming ×3, per-arr media
  settings ×3, per-arr quality definitions ×3, Lidarr metadata profile). Each throws a generic
  `Error` string on not-found — a new `readers.ts` must catch/translate to 404, no dispatcher exists.
- `packages/praxrr-app/src/lib/shared/pcd/portable.ts` — `Portable*` TypeScript shapes returned by serialize.ts.
- `packages/praxrr-app/src/lib/server/sync/preview/diff.ts` — `diffToFieldChanges(current, desired, options)`,
  `DiffOptions { ignoredFields?, arrayKeyStrategies?, nullAndMissingAreEqual? }`,
  `PreviewArrayKeyStrategy { path, selectKey }`; `DEFAULT_IGNORED_FIELDS` strips `id/links/created/updated/...`;
  `DEFAULT_ARRAY_KEY_STRATEGIES` is an **empty array** — per-entity strategies live in `sectionDiffs.ts`.
- `packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts` — `diffEntityCollection()`,
  `diffSingletonEntity()`, `diffUnidentifiedPayload()`; exported strategy constants
  `CUSTOM_FORMAT_ARRAY_KEY_STRATEGIES`, `QUALITY_PROFILE_ARRAY_KEY_STRATEGIES`,
  `QUALITY_DEFINITION_ARRAY_KEY_STRATEGIES`, `METADATA_PROFILE_ARRAY_KEY_STRATEGIES` — reuse these for
  `layerDiff.ts` and `liveDiff.ts` rather than redefining key strategies.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts` — `generatePreview(input: GeneratePreviewInput): Promise<GeneratePreviewResult>`.
  Builds its **own** short-lived Arr client via `getArrInstanceClient(arrType, instance.id, instance.url, undefined, createArrInstanceClientCache())`
  and calls `client.close()` in a `finally` — no full-section-result caching; every call re-fetches
  live. Runs **all** resolved sections/entities, no per-entity filter param — confirms the spec's
  "filter full-section result" decision is the only option without a new syncer variant.
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts` — `FieldChange`, `EntityChange`,
  `SyncPreviewAction`, `SyncPreviewArrType = Exclude<ArrType, 'all' | 'chaptarr'>`, per-section preview
  payload shapes (`QualityProfilesPreview`, `DelayProfilesPreview`, `MediaManagementPreview`,
  `MetadataProfilesPreview`).
- `packages/praxrr-app/src/lib/server/sync/preview/limits.ts` — `registerPreviewCreateAttempt(instanceId: number, nowMs: number): boolean`
  (6 requests / 60s window per instance) — **note: takes `nowMs` as a required second argument**,
  spec text omits it.
- `packages/praxrr-app/src/lib/server/sync/namespace.ts` — `findNamespaceMatch()`, `normalizeNamespaceDisplayName()`,
  `stripNamespaceSuffix()`, `hasNamespaceSuffix()`, `getNamespaceIndex()`.
- `packages/praxrr-app/src/lib/server/sync/mappings.ts` — `SyncArrType = Exclude<ArrType, 'all'>`,
  `SYNC_SECTION_ORDER`, `isSyncSectionSupported(arrType, section)`, per-arr section-support tables.
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts` — `getArrInstanceClient(type, instanceId, url, options?, cache?)`
  reads `arrInstanceCredentialsQueries`/`arrInstancesQueries`, decrypts key, calls `createArrClient()`
  (`utils/arr/factory.ts`) — **confirmed: neither function calls `assertSafeArrUrl()`**.
- `packages/praxrr-app/src/lib/server/utils/arr/urlSafety.ts` — `assertSafeArrUrl()` at L81; only
  called today from `routes/api/v1/setup/test-connection/+server.ts#POST` and
  `routes/arr/test/+server.ts#POST` — verifies spec finding W1 exactly.
- `packages/praxrr-app/src/lib/server/utils/arr/testConnectionReason.ts` — `TestConnectionReason =
  'unreachable' | 'unauthorized' | 'invalid_response' | 'timeout'`; `toFailureReason()`, `reasonFromStatus()`.
- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts` — `isArrAppType(value): value is ArrAppType`,
  `ARR_APP_TYPES`, `supportsFeature()`.
- `packages/praxrr-app/src/lib/server/navigation/registry.ts` — `NAV_REGISTRY: ArrCapabilityAwareNavItem[]`,
  `NAV_GROUPS`; parity-map entry (`id: 'overview.parity_map', href: '/parity-map'`) and score-simulator
  entry (`id: 'policies.score_simulator', href: '/score-simulator'`) are the direct registration precedent
  for a new `resolved-config` nav item.
- `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts` — canonical thin-handler
  pattern: `if (!locals.user && !locals.authBypass) return 401`; strict `/^\d+$/` databaseId check;
  `pcdManager.getCache(databaseId)` + `!cache?.isBuilt()` → **400** "Database not found" (not 404);
  static payload module-level memoization.
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts` — page-load precedent:
  `pcdManager.getAll()`, `pcdManager.getCache(id)`, throws SvelteKit `error(404, ...)` when cache
  missing (page convention differs from API's 400 — both exist in the codebase).
- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/` — existing sibling folders `lidarr-metadata-profiles/`,
  `snapshots/`; **no `resolved/` folder exists yet** (net-new).
- `docs/api/v1/openapi.yaml` — paths/schemas registered via `$ref: './paths/{file}.yaml#/{key}'` and
  `$ref: './schemas/{file}.yaml#/{Name}'`; `docs/api/v1/paths/` and `docs/api/v1/schemas/` currently
  have no `resolved-config.yaml` (net-new, confirmed by directory listing).
- `deno.json` — `generate:api-types` runs `npx openapi-typescript docs/api/v1/openapi.yaml -o packages/praxrr-app/src/lib/api/v1.d.ts`;
  `bundle:api` runs `scripts/bundle-api.ts`; `publish:api` chains bundle + `praxrr-api` package publish.
- `scripts/test.ts` — flat `aliases: Record<string,string>` map (e.g. `filters`, `upgrades`, `logger`);
  adding a `resolved` alias is a one-line map entry pointing at the new test file/dir.
- `packages/praxrr-app/src/lib/client/ui/meta/JsonView.svelte`,
  `packages/praxrr-app/src/routes/databases/[id]/changes/components/FieldDiffTable.svelte`,
  `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte` — all three
  UI precedents cited in the spec exist at these exact paths. **Confirmed C1**:
  `FieldDiffTable.svelte` is in the `grep -l "marked.parse\|{@html}"` result set alongside
  `Markdown.svelte`, `JsonView.svelte`, `CodeBlock.svelte`, `TestsDiffTable.svelte` — the
  unsanitized-markdown pattern is real and must not be copied into new diff/tree components.

## Data Flow

**Mutating build path (today, `compile()` → `PCDCache.build()`):**

1. `compiler.ts#compile()` instantiates `new PCDCache(pcdPath, databaseInstanceId)` and calls `.build()`.
2. `build()` reads `conflict_strategy` from `databaseInstancesQueries.getById()`, lists **all published
   user ops** and **prior conflicted/conflicted_pending history** up front (cache.ts L41-64).
3. Opens `:memory:` SQLite (`int64: true`), enables FKs, registers `qp/cf/dp/mp/tag` SQL helper functions
   (L67-82, L302-353).
4. Calls `loadAllOperations(pcdPath, databaseInstanceId)` then `validateOperations(operations)` (L85-86)
   — this is the schema→base→tweaks→user ordering from `loadOps.ts`.
5. Computes per-layer `CacheBuildStats` counts (L89-95).
6. **Op execution loop** (L98-274) — for each operation: `parseOpId(operation.filepath)` determines
   `trackHistory` (true only for `pcd_ops:<id>` filepaths, i.e. base/user DB ops — schema/tweaks file
   ops are untracked); executes `this.db.exec(operation.sql)`; on success, if tracked, runs
   `evaluateValueGuardApply()` (value-guard/conflict-strategy gate), conditionally auto-drops the op
   (`pcdOpsQueries.update(id, {state:'dropped'})`) or records `pcdOpHistoryQueries.create(...)`; on
   SQL error, runs `evaluateValueGuardError()` to decide whether to swallow (record conflict history)
   or rethrow. **This is the exact block `buildReadOnly({layers})` must skip entirely** — a
   read-only/layer-subset build should execute ops but never touch `pcdOpsQueries.update`,
   `pcdOpHistoryQueries.create`, or the value-guard evaluators.
7. Sets `this.built = true`, returns `stats`; on any thrown error, calls
   `disableDatabaseInstance(this.databaseInstanceId)` (side effect on the *real* instance row — another
   reason `buildReadOnly` must not share this catch path for ephemeral/base-only builds) and `this.close()`.
8. Back in `compile()`: `setCache(databaseInstanceId, cache)` registers the new cache and closes the
   old one; then `autoResolveOverrideConflicts()` runs post-swap (guarded by `autoOverrideLocks`).

**Read-only base-only variant (`buildReadOnly({layers})`, to be added):** must reuse steps 1-5 (or a
subset — `layers: ['schema','base','tweaks']` per Business Rule 3 excludes the `user` stage entirely,
so `loadAllOperations`'s 4th push (`loadDbOps(..., 'user', ...)`) must be skippable at the call site,
not filtered post-hoc) and step 6's `this.db.exec(operation.sql)` execution, but must skip the entire
value-guard/history/auto-drop branch (L104-273) — i.e., extract a `trackHistory`-conditional block into
a toggle so `buildReadOnly` runs with `trackHistory` forced `false` for every operation. It must never
call `setCache`/register into `registry.ts`, and its own `catch` must not call
`disableDatabaseInstance()`.

**Sync preview flow (`generatePreview()`):** resolves sections to run (explicit list or auto-detect via
`handler.hasConfig(instanceId)`), opens **one** short-lived Arr client for the whole call, iterates
sections calling `handler.createSyncer(client, instance)` → `syncer.generatePreview()` → per-section
`EntityChange[]` (via `sectionDiffs.ts` helpers internally, per syncer), accumulates a summary, and
closes the client in `finally`. There is no per-entity filter parameter — a single-entity live diff
must fetch/compute the whole section result and filter client-side by `entityType`+`name`, exactly as
the spec's Decision #2 assumes.

## Integration Points

- **`pcd/resolved/*` new module** — plugs into `packages/praxrr-app/src/lib/server/pcd/`, sibling to
  `entities/`, `database/`, `migration/`, `ops/`; must be re-exported from `pcd/index.ts` (currently
  has no `resolved` export — confirmed by reading the file's full export list: manager, cache/registry/compiler,
  writer, manifest, dependencies, operations, snapshots, errors — no resolved-state exports exist).
- **Cache access**: use `pcdManager.getCache(databaseId)` (matches both `compatibility/parity` and
  `score-simulator` precedents) rather than importing `registry.getCache` directly, for consistency
  with existing route code, then `cache?.isBuilt()` gate.
- **Routes**: `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/` is a new sibling to
  the existing `lidarr-metadata-profiles/` and `snapshots/` folders under `[databaseId]/`; follow the
  same `+server.ts` per dynamic segment convention (`[entityType]/+server.ts`, `[entityType]/[name]/+server.ts`,
  `.../[name]/compare/+server.ts`, `.../[name]/diff/+server.ts`).
- **OpenAPI**: add `docs/api/v1/paths/resolved-config.yaml` and `docs/api/v1/schemas/resolved-config.yaml`,
  then register each path/schema in `docs/api/v1/openapi.yaml` using the same `$ref` pattern used for
  `compatibility.yaml`/`pcd-snapshots.yaml`/`score-simulator.yaml` (verified at openapi.yaml lines ~347-349,
  ~615-616, ~1329-1333). Then run `deno task generate:api-types` (regenerates `packages/praxrr-app/src/lib/api/v1.d.ts`
  via `npx openapi-typescript`) and `deno task bundle:api` (runs `scripts/bundle-api.ts` for the
  `packages/praxrr-api` mirror) — both must run before route handlers reference `components['schemas'][...]`
  types (parity endpoint does exactly this: `type ParityMapResponse = components['schemas']['ParityMapResponse']`).
- **Navigation**: add one entry to `NAV_REGISTRY` in `packages/praxrr-app/src/lib/server/navigation/registry.ts`,
  following the `overview.parity_map`/`policies.score_simulator` object shape (`id`, `label`, `href`,
  `groupId: ensureGroupId(...)`, `order`, `arrScope`, `mobilePriority`, `iconKey`, `emoji`, `hasChildren`).
- **SSRF centralization (W1)**: the natural choke point is `getArrInstanceClient()` in
  `arrInstanceClients.ts` (calls `createArrClient()` from `factory.ts`) — confirmed neither function
  currently calls `assertSafeArrUrl()`; only two routes call it directly today. Centralizing in
  `getArrInstanceClient()` protects `generatePreview()`-based live diff/compare for free since
  `orchestrator.ts` already routes all Arr client creation through that function.
- **Rate limiting for `/compare`**: `sync/preview/limits.ts#registerPreviewCreateAttempt(instanceId, nowMs)`
  is per-instance/6-per-60s and reusable for the `/diff` endpoint per spec; a *new* `resolved/limits.ts`
  is still needed for the instance-count cap (8) since no existing helper caps request-level fan-out —
  `utils/rateLimit.ts#registerRateLimitAttempt(key, opts?)` is the generic building block (window
  30s/max 8 by default, both overridable) for a per-user/per-request window if desired.
- **Test alias**: `scripts/test.ts`'s `aliases` map is a flat object; add `resolved: 'packages/praxrr-app/src/tests/pcd/resolved'`
  (or specific file) alongside `filters`/`upgrades`/`logger` entries.

## Key Dependencies

- `$pcd/database/cache.ts` (`PCDCache`) — modify (`buildReadOnly`), do not duplicate logic; extraction
  point is the op-execution loop at cache.ts L98-274 and the value-guard-tracking conditional at L100-102.
- `$pcd/database/registry.ts` — read-only consumer only (`getCache`); `buildReadOnly` output must never
  reach `setCache`.
- `$pcd/ops/loadOps.ts` (`loadAllOperations`) — layer source of truth; a layer-subset build needs either
  a new parameter here or to slice/duplicate the 4-stage push sequence for `resolved/layers.ts`.
- `$pcd/entities/serialize.ts` — 15 named `serialize*` functions; `pcd/resolved/readers.ts` needs a
  manual `(entityType, arrType) → serializeFn` dispatch table since none exists.
- `$shared/pcd/portable.ts` — `Portable*` return types for the dispatch table above.
- `$sync/preview/diff.ts` (`diffToFieldChanges`, `DiffOptions`, `PreviewArrayKeyStrategy`) — verbatim
  reuse for `layerDiff.ts`.
- `$sync/preview/sectionDiffs.ts` (array-key-strategy constants, `diffSingletonEntity`,
  `diffEntityCollection`) — verbatim reuse for `layerDiff.ts`/`liveDiff.ts` to stay consistent with sync
  preview's per-entity-type key strategies rather than re-deriving them.
- `$sync/preview/orchestrator.ts` (`generatePreview`) — verbatim reuse for `liveDiff.ts`; no filtering
  hook exists, so `liveDiff.ts` must post-filter `GeneratePreviewResult` section payloads by entity name.
- `$sync/preview/limits.ts` (`registerPreviewCreateAttempt`) — reuse for `/diff`, note 2-arg signature.
- `$sync/namespace.ts` (`findNamespaceMatch`, `normalizeNamespaceDisplayName`) — reuse for namespace-aware
  entity matching in `liveDiff.ts`/`compare.ts`.
- `$sync/mappings.ts` (`isSyncSectionSupported`, `SyncArrType`) — gate section/arr_type combinations.
- `$shared/arr/capabilities.ts` (`isArrAppType`, `ARR_APP_TYPES`) — canonical arr_type validation allowlist.
- `$arr/arrInstanceClients.ts` (`getArrInstanceClient`) / `$arr/factory.ts` (`createArrClient`) — modify
  one of these two to centralize `assertSafeArrUrl()` (W1); `urlSafety.ts` exports the guard itself.
- `$arr/testConnectionReason.ts` (`TestConnectionReason`, `toFailureReason`, `reasonFromStatus`) — pattern
  to extend for sanitized per-instance error reasons in live-diff/compare responses (W2).
- `$db/queries/arrInstances.ts` (`arrInstancesQueries`) — only sanctioned instance-row accessor (W5);
  never raw `SELECT`.
- `packages/praxrr-app/src/lib/server/navigation/registry.ts` — add nav entry.
- `deno.json` tasks `generate:api-types`, `bundle:api` — must run after every OpenAPI contract change.
