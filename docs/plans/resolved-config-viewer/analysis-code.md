# Resolved Config Viewer — Code-Level Analysis

## Executive Summary

The feature is additive glue over three already-solid subsystems: `PCDCache` (in-memory SQLite replay of ops), `pcd/entities/serialize.ts` (15 hand-written `serialize*` functions returning `Portable*` shapes), and the sync-preview diff engine (`diffToFieldChanges` + `diffEntityCollection`/`diffSingletonEntity`). No dispatcher, generic entity registry, or layer-filter mechanism exists yet in any of these three subsystems — every extraction point (`buildReadOnly`, a readers dispatch table, a layer-scoped op loader) must be net-new code that calls into the existing per-entity/per-arr functions, never a refactor of them. The `parity` endpoint + its route test is a complete, minimal, copy-paste template for the four new endpoints.

## Existing Code Structure

### `PCDCache.build()` — full anatomy (`packages/praxrr-app/src/lib/server/pcd/database/cache.ts` L38-296)

Constructor fields (private): `db: Database | null`, `kysely: Kysely<PCDDatabase> | null`, `pcdPath: string`, `databaseInstanceId: number`, `built: boolean`. All private — no protected hooks for subclassing; a `buildReadOnly` must live as a sibling method that constructs its own throwaway `Database`/`Kysely` pair (mirrors `build()` steps 1-2 verbatim), since there's no way to reuse an already-built instance's `db`/`kysely` without also inheriting `built=true` / registry state.

`build()` control flow, in order:

1. Read `databaseInstancesQueries.getById(this.databaseInstanceId)` for `conflict_strategy`.
2. Read `pcdOpsQueries.listByDatabaseAndOrigin(id, 'user', {states:['published']})` → `userOpsById` map — **write-path-only, drop entirely for buildReadOnly**.
3. Read `pcdOpHistoryQueries.listLatestByDatabaseWithOps(id, ['conflicted','conflicted_pending'])` → `priorConflicts` map — **write-path-only, drop**.
4. `new Database(':memory:', {int64:true})`, `PRAGMA foreign_keys=ON`, `new Kysely(...)` — **keep, identical for buildReadOnly**.
5. `this.registerHelperFunctions()` (`qp`, `cf`, `dp`, `mp`, `tag` SQL scalar fns via `this.db.function(...)`) — **keep; ops SQL may call these**.
6. `await loadAllOperations(this.pcdPath, this.databaseInstanceId)` then `validateOperations(operations)` — **keep, but buildReadOnly needs a layer-truncated variant**.
7. Per-op loop (L98-274): for each `operation` —
   - `opId = parseOpId(operation.filepath)` (only non-null for DB-sourced ops, i.e. `filepath` starts with `pcd_ops:`; schema/tweaks file-based ops always have `opId===null` and `trackHistory=false`).
   - `this.db.exec(operation.sql)` inside try/catch — **the only truly required side effect; keep unconditionally**.
   - On success: if `trackHistory`, run the full value-guard gate (`evaluateValueGuardApply`), potentially auto-drop the op (`pcdOpsQueries.update(id,{state:'dropped'})` — **mutates app DB, must not run in buildReadOnly**), and `pcdOpHistoryQueries.create(...)` — **must not run in buildReadOnly**.
   - On failure: `evaluateValueGuardError`, possibly `pcdOpHistoryQueries.create(...)`, `continue` (swallow so remaining ops still run).
8. `this.built = true`; return `stats` (schema/base/tweaks/user counts + timing).
9. Outer catch: `logger.error(...)`, `await disableDatabaseInstance(this.databaseInstanceId)` (**mutates app DB — never call from buildReadOnly**), `this.close()`, rethrow.

`registerHelperFunctions()` (private, L302-353) is pure `this.db.function(...)` registration — zero DB writes, safe to call verbatim from a buildReadOnly path.

`close()` (L373-383) destroys `kysely` and closes `db`, resets `built=false`. A `buildReadOnly`-produced instance can safely set `built=true` at the end so downstream `cache.kb`/`cache.query()` calls behave identically to a normal cache, and its caller must call `close()` and must never `setCache()` it (registry.ts's `caches` map must never see an ephemeral cache).

**Net-new method shape (not present today, must be added):**

```ts
async buildReadOnly(options: { layers: ReadonlySet<'schema'|'base'|'tweaks'|'user'> }): Promise<void> {
  this.db = new Database(':memory:', { int64: true });
  this.db.exec('PRAGMA foreign_keys = ON');
  this.kysely = new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: this.db }) });
  this.registerHelperFunctions();
  const allOperations = await loadAllOperations(this.pcdPath, this.databaseInstanceId);
  const operations = allOperations.filter((op) => options.layers.has(op.layer));
  validateOperations(operations);
  for (const operation of operations) {
    try {
      this.db.exec(operation.sql);
    } catch (error) {
      await logger.warn('buildReadOnly: skipping op that failed to apply', {
        source: 'PCDCache', meta: { error: String(error), layer: operation.layer, filename: operation.filename },
      });
    }
  }
  this.built = true;
}
```

This never calls `setCache`, `disableDatabaseInstance`, `pcdOpsQueries.update`, or `pcdOpHistoryQueries.create`.

### `loadAllOperations()` — layer boundaries (`packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`)

Pushes exactly 4 stages, unconditionally, in this order (no early-exit param exists today):

1. `schemaOps` — files under resolved schema deps path, layer `'schema'`.
2. `basePublished` — `loadDbOps(id, 'base', ['published'])`, layer `'base'`.
3. `baseDrafts` — `loadDbOps(id, 'base', ['draft'], DRAFT_SEQUENCE_BASE=3_000_000_000)`, layer `'base'` (order-offset only, same `layer` tag as published).
4. `tweakOps` — files under `${pcdPath}/tweaks`, layer `'tweaks'`.
5. `userOps` — `loadDbOps(id, 'user', ['published'])`, layer `'user'`.

**There is no `layers`/`stopAtLayer` param on `loadAllOperations` today.** Best approach: post-load `.filter(op => layers.has(op.layer))` on the returned `Operation[]` inside `buildReadOnly` — zero changes to `loadOps.ts`, correct because `compareOperations` already sorts the fully-combined array by `order` → `filename` → `filepath`, so filtering after the fact preserves correct relative ordering within kept layers, and no modification is needed to the shared `build()` write path.

### `pcd/entities/serialize.ts` — reader function inventory

All 15 functions have signature `(cache: PCDCache, name: string) => Promise<Portable*>`, throw a plain `Error(...)` (not a typed error class) on miss, and are **not** grouped by any dispatcher today. Inventory:

| Function                            | Return type                                                         | Arr-scoped?                                  | Notes                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `serializeDelayProfile`             | `PortableDelayProfile`                                              | no (shared)                                  | delegates to `delayProfileQueries.getByName`                                                             |
| `serializeRegularExpression`        | `PortableRegularExpression`                                         | no (shared)                                  | direct `cache.kb` query + tag join                                                                       |
| `serializeCustomFormat`             | `PortableCustomFormat`                                              | no (shared)                                  | conditions via `cfQueries.getConditionsForEvaluation`, tests via `cfQueries.listTests`                   |
| `serializeQualityProfile`           | `PortableQualityProfile`                                            | no (shared)                                  | `qpQueries.qualities(cache, 0, name)` — databaseId param unused per inline comment                       |
| `serializeRadarrNaming`             | `PortableRadarrNaming`                                              | **radarr**                                   | `namingQueries.getRadarrByName`                                                                          |
| `serializeSonarrNaming`             | `PortableSonarrNaming`                                              | **sonarr**                                   | `namingQueries.getSonarrByName`                                                                          |
| `serializeLidarrNaming`             | `PortableLidarrNaming`                                              | **lidarr**                                   | `namingQueries.getLidarrByName`; throws on any null required field via `requireLidarrNamingField` helper |
| `serializeRadarrMediaSettings`      | `PortableMediaSettings`                                             | **radarr**                                   |                                                                                                          |
| `serializeSonarrMediaSettings`      | `PortableMediaSettings`                                             | **sonarr**                                   |                                                                                                          |
| `serializeLidarrMediaSettings`      | `PortableLidarrMediaSettings` (= `PortableMediaSettings`)           | **lidarr**                                   |                                                                                                          |
| `serializeRadarrQualityDefinitions` | `PortableQualityDefinitions`                                        | **radarr**                                   |                                                                                                          |
| `serializeSonarrQualityDefinitions` | `PortableQualityDefinitions`                                        | **sonarr**                                   |                                                                                                          |
| `serializeLidarrQualityDefinitions` | `PortableLidarrQualityDefinitions` (= `PortableQualityDefinitions`) | **lidarr**                                   |                                                                                                          |
| `serializeLidarrMetadataProfile`    | `PortableLidarrMetadataProfile`                                     | **lidarr only, no radarr/sonarr equivalent** | 3 parallel queries via `Promise.all` for primary/secondary/release-status types                          |

`quality_profiles`, `custom_formats`, `delay_profiles`, `regular_expressions` are **name-keyed, arr-agnostic**. `naming`, `media_settings`, `quality_definitions` are **name-keyed AND per-arr-app** (3 separate serialize functions each, 3 separate cache tables each: `{radarr,sonarr,lidarr}_naming` etc.). `lidarr_metadata_profiles` is **lidarr-only**. This maps directly onto the `(entityType, arrType) → fn` readers dispatch table the feature needs.

### Sync-preview orchestrator — exact section payload shapes

`generatePreview(input: GeneratePreviewInput): Promise<GeneratePreviewResult>` (`orchestrator.ts`):

- `resolveSections()`: if no `sections` requested, runs `SYNC_SECTION_ORDER.filter(s => getSection(s).hasConfig(instanceId))`. **No per-entity filter exists anywhere in this file** — liveDiff must post-filter section payloads by `entityType`+`name` itself.
- One shared Arr client per call: `getArrInstanceClient(arrType, instance.id, instance.url, undefined, createArrInstanceClientCache())`, closed in a `finally { client.close(); }` around the whole per-section loop (not per-section).
- Per-section try/catch: failure in one section pushes an error string and a `{section, result:null, error, skipped:false}` outcome but does not abort remaining sections.

**Where `EntityChange[]` actually lives** inside each section payload (`types.ts` L42-63):

```ts
interface QualityProfilesPreview {
  section: 'qualityProfiles';
  customFormats: readonly EntityChange[];
  qualityProfiles: readonly EntityChange[];
}
interface DelayProfilesPreview {
  section: 'delayProfiles';
  profile: EntityChange | null;
}
interface MediaManagementPreview {
  section: 'mediaManagement';
  naming: EntityChange | null;
  qualityDefinitions: readonly EntityChange[];
  mediaSettings: EntityChange | null;
}
interface MetadataProfilesPreview {
  section: 'metadataProfiles';
  profile: EntityChange | null;
}
```

`qualityProfiles`/`customFormats`/`qualityDefinitions` are **arrays** (collection diff via `diffEntityCollection`); `delayProfiles.profile`, `mediaManagement.naming`, `mediaManagement.mediaSettings`, `metadataProfiles.profile` are **singleton `EntityChange | null`** (via `diffSingletonEntity`). A liveDiff wrapper must know which shape applies per entity type — array-find-by-name vs direct-null-check.

`GeneratePreviewResult` (L47-62): `qualityProfiles`/`delayProfiles`/`mediaManagement`/`metadataProfiles` each `SectionPayload | null` (null when section wasn't run/skipped/errored), plus `sectionOutcomes: SyncPreviewSectionOutcome[]` for per-section error/skip introspection.

### Diff engine primitives (reuse verbatim)

`diffToFieldChanges(current, desired, options?: DiffOptions): FieldChange[]` (`diff.ts`) is pure/synchronous/recursive. `DEFAULT_IGNORED_FIELDS` strips `id/links/created/updated/createdAt/updatedAt/revision/lastExecution*/lastModified/dateAdded/dateUpdated`; `nullAndMissingAreEqual` defaults `true`; arrays without a registered `PreviewArrayKeyStrategy` for their dot-path fall back to **index-position** comparison (gotcha: reordering without content change reads as N adds + N removes unless a strategy is registered for that path).

`diffEntityCollection<TDesired,TCurrent>(params)` and `diffSingletonEntity<TDesired,TCurrent>(params)` (`sectionDiffs.ts`) handle namespace matching (`findNamespaceMatch`: exact → stripped-suffix → tie-break) and the create/update/delete/unchanged state machine. Exported strategy constants — `CUSTOM_FORMAT_ARRAY_KEY_STRATEGIES` (`specifications` keyed `name:implementation`), `QUALITY_PROFILE_ARRAY_KEY_STRATEGIES` (`items`/`items.items` keyed by quality name, `formatItems` keyed by format id), `QUALITY_DEFINITION_ARRAY_KEY_STRATEGIES`, `METADATA_PROFILE_ARRAY_KEY_STRATEGIES` — **target live-Arr-API field names** (e.g. `primaryAlbumTypes`), NOT `Portable*` field names (e.g. `PortableLidarrMetadataProfile.primaryTypes`). A layerDiff over Portable objects needs its own strategy paths, not a verbatim reuse of these constants.

### Parity handler — literal copy template (`compatibility/parity/+server.ts`, 84 lines)

1. `if (!locals.user && !locals.authBypass) return json({error:'Unauthorized'} satisfies ErrorResponse, {status:401})`.
2. Optional module-level static-payload cache (only relevant if an endpoint has a static tier).
3. `url.searchParams.get('databaseId')`; strict `/^\d+$/.test(...)` else `400 {error:'Invalid databaseId'}` (rejects `"1e5"`, `"1abc"`, `" 1"`).
4. `pcdManager.getCache(databaseId)?.isBuilt()` guard → **400** (not 404) `{error:'Database not found'}` — explicit comment: deliberately 400, "unknown/unbuilt database is a caller input problem," no sibling-app fallback.
5. try/catch: `logger.error(msg, {source, meta:{databaseId, error: error instanceof Error ? error.message : String(error)}})` then generic 500 `{error:'...'}`; raw error text never reaches the client.
6. Every response literal `satisfies components['schemas'][...]` from `$api/v1.d.ts`.

## Implementation Patterns

### `readers.ts` dispatch table shape (net-new, does not exist)

```ts
type ResolvedEntityType =
  | 'delayProfile'
  | 'regularExpression'
  | 'customFormat'
  | 'qualityProfile'
  | 'naming'
  | 'mediaSettings'
  | 'qualityDefinitions'
  | 'lidarrMetadataProfile';

const ARR_AGNOSTIC_READERS: Partial<
  Record<
    ResolvedEntityType,
    (cache: PCDCache, name: string) => Promise<unknown>
  >
> = {
  delayProfile: serializeDelayProfile,
  regularExpression: serializeRegularExpression,
  customFormat: serializeCustomFormat,
  qualityProfile: serializeQualityProfile,
};

const PER_ARR_READERS: Partial<
  Record<
    ResolvedEntityType,
    Partial<
      Record<ArrAppType, (cache: PCDCache, name: string) => Promise<unknown>>
    >
  >
> = {
  naming: {
    radarr: serializeRadarrNaming,
    sonarr: serializeSonarrNaming,
    lidarr: serializeLidarrNaming,
  },
  mediaSettings: {
    radarr: serializeRadarrMediaSettings,
    sonarr: serializeSonarrMediaSettings,
    lidarr: serializeLidarrMediaSettings,
  },
  qualityDefinitions: {
    radarr: serializeRadarrQualityDefinitions,
    sonarr: serializeSonarrQualityDefinitions,
    lidarr: serializeLidarrQualityDefinitions,
  },
  lidarrMetadataProfile: { lidarr: serializeLidarrMetadataProfile }, // radarr/sonarr keys intentionally absent
};
```

Fail fast (throw) on any `(entityType, arrType)` combo missing from the tables — no implicit sibling fallback, per CLAUDE.md's Cross-Arr Semantic Validation Policy. `serializeLidarrMetadataProfile` having no radarr/sonarr counterpart is the concrete proof case.

### buildReadOnly caller pattern

No "get or build" convenience exists for read-only ephemeral caches — every caller constructs `new PCDCache(pcdPath, databaseId)` itself, calls `buildReadOnly({layers})`, uses it, then explicitly `close()`s it. `pcdPath` comes from `databaseInstancesQueries.getById(id).local_path`. `compiler.ts`'s `compile()` (the only `build()`/`setCache()` caller) must not be touched.

### Route auth/validation/error triad (applies to all 4 new endpoints)

```ts
if (!locals.user && !locals.authBypass)
  return json({ error: 'Unauthorized' } satisfies ErrorResponse, {
    status: 401,
  });
if (!/^\d+$/.test(params.databaseId))
  return json({ error: 'Invalid databaseId' } satisfies ErrorResponse, {
    status: 400,
  });
const databaseId = Number.parseInt(params.databaseId, 10);
const cache = pcdManager.getCache(databaseId); // registered cache, existence/health gate only
if (!cache?.isBuilt())
  return json({ error: 'Database not found' } satisfies ErrorResponse, {
    status: 400,
  });
try {
  // "current" reads can use the registered cache directly (already fully-resolved);
  // layer-scoped reads need a fresh buildReadOnly ephemeral cache.
} catch (error) {
  await logger.error('...', {
    source: '...',
    meta: {
      databaseId,
      error: error instanceof Error ? error.message : String(error),
    },
  });
  return json({ error: 'Generic sanitized message' } satisfies ErrorResponse, {
    status: 500,
  });
}
```

### Diff wrapper composition (layerDiff / liveDiff)

- **layerDiff**: build two `PCDCache` via `buildReadOnly` with different `layers` sets, read the same entity via the readers dispatch table from both, call `diffToFieldChanges(fromEntity, toEntity, { arrayKeyStrategies: <Portable-field-named strategy> })` directly — no `diffEntityCollection`/`diffSingletonEntity` (those add create/update/delete action semantics irrelevant to a same-entity layer diff).
- **liveDiff**: call `generatePreview({ instance, sections: [<mapped section>] })`, then locate the specific `EntityChange` inside the returned section payload (array `.find()` vs singleton field access per the shape table above) — do not re-diff; `EntityChange.fields` is already the answer.

## Integration Points

### Files to create

- `packages/praxrr-app/src/lib/server/pcd/resolved/readers.ts` — deep-imports the 15 `serialize*` fns from `$pcd/entities/serialize.ts` (not currently re-exported from `pcd/index.ts`).
- `packages/praxrr-app/src/lib/server/pcd/resolved/layerDiff.ts` — imports `PCDCache`, `databaseInstancesQueries`, `readers.ts`, `diffToFieldChanges`/`PreviewArrayKeyStrategy` from `$sync/preview/diff.ts` (safe direction: `sync/preview/diff.ts` imports nothing from `pcd/`).
- `packages/praxrr-app/src/lib/server/pcd/resolved/liveDiff.ts` — imports `generatePreview`/types from `$sync/preview/orchestrator.ts`, `arrInstancesQueries`, `isSyncSectionSupported`/`SyncArrType` from `$sync/mappings.ts`.
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts` — **modify**: add `buildReadOnly`.
- `packages/praxrr-app/src/lib/server/pcd/index.ts` — **modify**: add `// RESOLVED CONFIG` banner section export.
- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts`, `.../[entityType]/[name]/+server.ts`, `.../compare/+server.ts`, `.../diff/+server.ts` — import `pcdManager` from `$pcd/index.ts`, `logger`, `components` from `$api/v1.d.ts`, relevant `resolved/*` function.
- `docs/api/v1/paths/resolved-config.yaml`, `docs/api/v1/schemas/resolved-config.yaml` — mirror `compatibility.yaml` structure exactly (operationId, tags, integer path params, 200/400/401/404/500 responses).
- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.server.ts` — mirrors `parity-map/+page.server.ts` (digit-regex validation, inline `{error}` in data, `pcdManager.getAll()` picker).
- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.svelte` + child components — mirror `parity-map` idiom + `SyncPreviewEntityDiff.svelte` diff rendering.

### Files to modify (beyond cache.ts)

- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts` — add `assertSafeArrUrl(url)` call inside `getArrInstanceClient` before `createArrClient(type, url, apiKey, options)` (currently `url` is never validated at either of its two return points, L92/L120).
- `docs/api/v1/openapi.yaml` — register new paths (mirror L615-616) and schemas (mirror L1329-1333).
- `packages/praxrr-app/src/lib/server/navigation/registry.ts` — add one `NAV_REGISTRY` entry.
- `scripts/test.ts` — add a `resolvedConfig` alias.

## Code Conventions

- **No generic entity dispatcher precedent** — every dispatch-by-entity-type need in this codebase is hand-written per-case (explicit `Record`/`switch`), not metadata/reflection-driven.
- **`satisfies components['schemas'][...]`** on every JSON response literal, not `as` casts.
- **Sanitized error responses**: `logger.error` gets real error text in `meta`; HTTP body gets a fixed generic string — no exceptions found in the reference handler.
- **`await logger.<level>(...)`** everywhere — logger methods are Promise-returning.
- **Kysely style**: `cache.kb.selectFrom(...).select([...]).where(...).executeTakeFirst()/.execute()`; snake_case DB columns manually mapped to camelCase Portable fields inside each `serialize*` function (no ORM auto-camelCasing).
- **`readonly` arrays/fields** throughout `sync/preview/types.ts` and `sectionDiffs.ts` params.

## Dependencies and Services

- `PCDCache` ← `loadAllOperations` ← `pcdOpsQueries` (app DB) + filesystem (`schema/ops`, `tweaks/`) — `buildReadOnly` shares this graph, minus history/state-mutation calls.
- `readers.ts` ← `serialize.ts` ← `cache.kb` + sub-entity query modules (`delayProfiles/`, `customFormats/`, `qualityProfiles/`, `mediaManagement/{naming,media-settings,quality-definitions}/`).
- `liveDiff.ts` ← `generatePreview` ← `getArrInstanceClient` (network I/O) ← `arrInstanceCredentialsQueries`/`arrInstancesQueries` — the only new path performing outbound network calls; layerDiff and list/get endpoints are pure local SQLite reads.
- Contract generation: `deno task generate:api-types` then `deno task bundle:api`, required after any `docs/api/v1/**/*.yaml` edit before handlers can `import type { components }`.

## Gotchas and Warnings

- `buildReadOnly` must build a fresh `Database`/`Kysely` per requested layer combination — there's no way to "un-apply" already-executed SQL, so comparing base-only vs base+tweaks requires two separate ephemeral builds, not one incrementally extended cache.
- `opId` is `null` for schema/tweaks-layer ops (`parseOpId` only recognizes `pcd_ops:<id>` filepaths) — `trackHistory` is always `false` there even in real `build()`, so skipping history tracking in `buildReadOnly` loses no additional provenance for those layers.
- `quality_profiles`/`custom_formats`/`delay_profiles` carry no arr-scoping on the profile row itself; per-arr compatibility is _computed_ (via `computeProfileCompatibility` / `quality_api_mappings`), not stored — reuse `computeProfileCompatibility` from `$pcd/entities/qualityProfiles/compatibility.ts` rather than re-deriving.
- `SUPPORTED_SYNC_SECTIONS` in `mappings.ts` is module-private; only `isSyncSectionSupported`/`getUnsupportedSyncSectionReason` are exported. `metadataProfiles` is lidarr-only — liveDiff must call `isSyncSectionSupported` before `generatePreview`, else an unsupported section just silently returns `null` with no explicit "unsupported" signal.
- The existing `*_ARRAY_KEY_STRATEGIES` constants in `sectionDiffs.ts` target **live-Arr-API field names** (e.g. `primaryAlbumTypes`), not `Portable*` field names (e.g. `PortableLidarrMetadataProfile.primaryTypes`/`secondaryTypes`/`releaseStatuses`) — a layerDiff over Portable objects needs its own strategy paths, not verbatim reuse.
- `FieldDiffTable.svelte` renders diff values through unsanitized `marked.parse()` + `{@html}` (lines 19, 197, 251) — a real unpatched XSS vector. Do not copy; use plain `{value}` text interpolation.
- `getArrInstanceClient` never validates `url` today (SSRF-relevant) — `assertSafeArrUrl` must be added inside it, which affects every existing caller (preview, library pull, upgrades), not just resolved-config — worth flagging as a blast-radius consideration in the plan.
- `registerHelperFunctions()` SQL scalar functions (`cf`, `qp`, `dp`, `mp`, `tag`) throw hard errors on missing lookups — defensively wrap each op execution in `buildReadOnly` in its own try/catch (as sketched above) rather than letting one bad op abort the entire read.

## Task-Specific Guidance

- Implement `buildReadOnly` exactly as sketched: same bootstrap as `build()`, post-load `.filter()` on `operations`, bare try/catch-and-continue per op (log via `logger.warn`, no gate evaluation since there's no reliable op id to gate on), `built=true` at the end; document that callers own `close()` and must never `setCache()`.
- Build `readers.ts` as flat lookup tables keyed by an 8-entry `ResolvedEntityType` union, with a `PER_ARR_READERS` sub-table only for `naming`/`mediaSettings`/`qualityDefinitions` plus a lidarr-only special case for `lidarrMetadataProfile`; throw on any unmapped `(entityType, arrType)`.
- For `layerDiff`, write new Portable-field-named array-key-strategies where needed and call `diffToFieldChanges` directly — skip `diffEntityCollection`/`diffSingletonEntity`.
- For `liveDiff`, gate with `isSyncSectionSupported` first, then locate the `EntityChange` in the returned section payload per its shape (array-find vs singleton-field) — never re-diff.
- Route handlers: copy the parity `+server.ts` auth → digit-regex → `isBuilt()` → try/catch → `satisfies` skeleton verbatim; add entityType/arrType validation against the `readers.ts` tables (400 for unknown type/arrType combos, 404 for well-formed-but-not-found-by-name, distinct from the 400 "database not found/unbuilt" case).
