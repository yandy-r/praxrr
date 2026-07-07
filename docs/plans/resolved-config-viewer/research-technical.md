# Resolved Config Viewer — Technical Research & Design

> Issue #25 — Display the fully resolved configuration state (base ops + user ops +
> overrides) for each managed PCD entity, with layer breakdown, cross-instance
> comparison, and diff against live Arr state.

## Executive Summary

The PCD in-memory cache (`PCDCache`) **is already the fully-resolved state**: it is an
ephemeral SQLite DB built by replaying every op layer (schema → base → tweaks → user) in
order. Entity read functions (`customFormats/list.ts`, the quality-profile
transformer/compatibility readers) query that compiled cache directly, so surfacing
"resolved" state is largely a matter of exposing existing readers through a new
`/api/v1` read surface — **no new app-DB tables or migrations required**.

The two comparative features reuse infrastructure that already exists:

- **Layer breakdown** (base-only vs user-overrides vs resolved) requires one new
  capability: a **read-only, side-effect-free replay of a layer subset** (schema+base+
  tweaks, omitting user ops) to produce the "base-only" cache, then diffing it against the
  live resolved cache. The existing `loadAllOperations` + `PCDCache` machinery does the
  replay; today's `build()` also performs value-guard/op-history side effects that a
  read-only view must skip.
- **Live diff (desired vs actual)** already exists as the **sync preview pipeline**
  (`$sync/preview/*`): it transforms the resolved cache into per-Arr payloads, fetches
  live Arr state, and diffs with `diffToFieldChanges()` producing `EntityChange`/
  `FieldChange`. The viewer reuses the syncers' `generatePreview()` and the
  `SyncPreviewEntityDiff.svelte` renderer, filtered to a single entity, under the existing
  per-instance rate limiter.
- **Cross-instance comparison** composes the per-Arr transform (arr-type specific) across
  selected instances and compares each instance's transformed-desired (and optionally live)
  state, gated per `arr_type` with no sibling fallback (Cross-Arr policy).

The diff engine (`diffToFieldChanges`), the diff UI (`SyncPreviewEntityDiff.svelte`), and
the comparison-page pattern (`parity-map/`) are all directly reusable.

---

## Architecture Design

### Component / data-flow diagram

```
                       ┌─────────────────────────── App DB (SQLite / Kysely) ───────────────────────────┐
                       │  pcd_ops (origin=base|user, state, sql, desired_state, metadata)                │
                       │  pcd_op_history (apply/conflict per op)                                          │
                       └───────────────┬──────────────────────────────────────────────────────────────-─┘
                                       │ loadAllOperations(pcdPath, dbId)   [schema→base→tweaks→user]
                                       ▼
   registry cache (resolved)   ┌──────────────────────┐        ephemeral read-only build (base-only)
   pcdManager.getCache(dbId) ─►│      PCDCache        │◄──── LayeredView.build(dbId, layers=[schema,base,tweaks])
                               │  in-mem SQLite (kb)  │            (NO value-guard, NO op-history)
                               └─────────┬────────────┘
                                         │  entity readers query cache.kb (Kysely)
                                         ▼
   ┌─────────── resolved-state service (NEW: $pcd/resolved/*) ───────────┐
   │  readResolvedEntity(cache, entityType, name?) → canonical payload    │
   │  readLayerView(dbId, entityType, layer) → base | user | resolved     │
   │      · base     = readResolvedEntity(baseOnlyCache)                   │
   │      · resolved = readResolvedEntity(registryCache)                  │
   │      · user     = diffEntities(base, resolved) → FieldChange[]        │
   └───────────────┬─────────────────────────────────┬───────────────────┘
                   │                                  │
   GET /pcd/{id}/resolved/{type}[/{name}]?layer=      │ (cross-instance / live diff branch)
                   │                                  ▼
                   │                 ┌──── sync preview reuse (existing $sync/preview) ────┐
                   │                 │ per section syncer.generatePreview():               │
                   │                 │   desired = transform(resolved cache, arr_type)     │
                   │                 │   actual  = ArrClient.getX()  (rate-limited)        │
                   │                 │   diffToFieldChanges → EntityChange/FieldChange     │
                   │                 └──────────────────────────────────────────────────-─┘
                   ▼                                  ▼
        SvelteKit routes /routes/api/v1/pcd/[databaseId]/resolved/**   (contract-first)
                   ▼
   Client: entity-editor panel + standalone viewer
     · layer toggle tabs ($ui/navigation/tabs)  · tree/table ($ui/table)
     · diff rows (reuse SyncPreviewEntityDiff.svelte)  · comparison grid (parity-map pattern)
```

### New components (server)

- **`$pcd/resolved/layeredView.ts`** — read-only, side-effect-free layer-subset replay.
  Produces a "base-only" `PCDCache`-equivalent handle (schema + base + tweaks, user ops
  omitted). Must reuse `loadAllOperations()` output, filter by `operation.layer`, and
  execute into a fresh in-memory SQLite **without** the value-guard/op-history block that
  `PCDCache.build()` runs. Two clean shapes:
  - **Preferred:** add `PCDCache.buildReadOnly(opts: { layers?: OperationLayer[] })` to
    `database/cache.ts` that shares the SQLite/Kysely setup + helper-function registration
    but skips the `evaluateValueGuardApply`/`pcdOpHistoryQueries.create` path. Keeps op
    execution logic in one place (DRY) and honors the ~500-line soft cap by extracting the
    op-execution loop.
  - Alternative: a standalone `LayeredCacheBuilder` that imports `loadAllOperations` +
    `registerHelperFunctions`. Rejected — duplicates helper-function + Kysely wiring.
- **`$pcd/resolved/readers.ts`** — thin dispatch over existing per-entity readers so the
  same code serves resolved and base-only caches:
  - custom formats → `entities/customFormats/list.ts#list(cache)`
  - quality profiles → `qualityProfiles/list.ts` + `sync/qualityProfiles/transformer.ts#fetchQualityProfileFromPcd(cache, name, arrType)`
  - delay / metadata / media-management → existing `entities/**/read.ts`
    Dispatch **must** key on `entityType` (+ `arr_type` where the reader is arr-specific);
    fail-fast on unknown/ambiguous type (Cross-Arr policy).
- **`$pcd/resolved/layerDiff.ts`** — wraps `diffToFieldChanges()` (from
  `$sync/preview/diff.ts`) to compute the "user overrides" view as `FieldChange[]` between
  base-only and resolved payloads. Reuse the array-key strategies already defined in
  `$sync/preview/sectionDiffs.ts` (`QUALITY_PROFILE_ARRAY_KEY_STRATEGIES`,
  `CUSTOM_FORMAT_ARRAY_KEY_STRATEGIES`) so nested arrays match by stable key, not index.
- **`$pcd/resolved/liveDiff.ts`** — orchestrates a single-entity desired-vs-actual diff by
  invoking the relevant section syncer's `generatePreview()` (via the existing preview
  orchestrator) and filtering `EntityChange[]` to the requested entity name (accounting for
  the namespace suffix — see Gotchas). Reuses `registerPreviewCreateAttempt()` for
  rate-limiting; does **not** open an independent unmetered Arr fetch path.

### New components (client)

- **Standalone page** `routes/resolved-config/[databaseId]/+page.svelte` (+`+page.server.ts`)
  — mirrors `parity-map/`: database picker, entity-type selector, layer-toggle tabs
  (`base` / `overrides` / `resolved`), tree/table body, and a comparison mode.
- **Editor panel** — a `ResolvedStatePanel.svelte` embedded in existing entity editors
  (custom-formats, quality-profiles) as a collapsible `$ui/form/DisclosureSection`.
- **Reused diff renderer** — `SyncPreviewEntityDiff.svelte` (already renders
  `EntityChange`→field table with current/desired columns) for both the "overrides" layer
  view and the live diff. Cross-instance grid reuses `$ui/table/Table.svelte` +
  `$ui/badge/Badge.svelte` in the `ParityMatrix.svelte` layout style.

### Integration points

- `pcdManager.getCache(databaseId)` (`core/manager.ts`) — the resolved cache handle.
- `getCache` / `getCachedDatabaseIds` (`database/registry.ts`) — registry access.
- `$sync/preview/orchestrator.ts#generatePreview` + `$sync/preview/store.ts` +
  `$sync/preview/limits.ts` — the live-diff engine and its rate limiter.
- `$sync/mappings.ts#SUPPORTED_SYNC_SECTIONS` / `isSyncSectionSupported(arrType, section)`
  — per-arr capability gating for live diff and cross-instance comparison.
- `$db/queries/arrInstances.ts#arrInstancesQueries` — instance lookup for comparison/diff.

---

## Data Models

### Existing tables leveraged (no changes)

App DB (`praxrr.db`, Kysely):

- **`pcd_ops`** (`$db/queries/pcdOps.ts`): `id, database_id, origin('base'|'user'),
state('published'|'draft'|'superseded'|'dropped'|'orphaned'),
source('repo'|'local'|'import'), filename, op_number, sequence, sql, metadata,
desired_state, content_hash, last_seen_in_repo_at, superseded_by_op_id, …`.
  `desired_state` (per-op JSON snapshot) is useful metadata but is **not** the resolved
  entity — the cache replay is authoritative.
- **`pcd_op_history`** (`$db/queries/pcdOpHistory.ts`): apply/conflict status per op; used
  only to annotate which user ops conflicted (optional badge in the overrides view).

Compiled in-memory PCD cache tables (`PCDDatabase` in `$shared/pcd/types.ts`, queried via
`cache.kb`): `custom_formats`, `custom_format_conditions`, `custom_format_tags`,
`custom_format_tests`, `quality_profiles`, `quality_profile_qualities`,
`quality_profile_custom_formats`, `quality_group_members`, `quality_api_mappings`,
`delay_profiles`, `lidarr_metadata_profiles`, `tags`, and media-management/naming/quality-
definition tables. These are the resolved-state source.

**New app-DB schema: none.** The base-only layer view is an ephemeral replay; user-override
diffs are computed on the fly. This aligns with the issue's "PCD cache is already the
resolved state — surface it".

### Resolved-payload shapes

Reuse the already-published **`Portable*`** OpenAPI schemas as the canonical, arr-agnostic
resolved-entity shapes (`PortableQualityProfile`, `PortableCustomFormat`,
`PortableDelayProfile`, `PortableLidarrMetadataProfile`, `PortableRegularExpression`, …
already in `docs/api/v1/schemas/pcd.yaml`). This keeps the viewer contract-faithful and
avoids inventing a parallel entity shape.

New wrapper schemas (add to `docs/api/v1/schemas/`):

```yaml
ResolvedLayer:
  type: string
  enum: [base, user, resolved] # base-only | user-overrides | fully-resolved

ResolvedEntityState:
  type: object
  required: [databaseId, entityType, name, layer, present]
  properties:
    databaseId: { type: integer }
    entityType:
      type: string
      enum:
        [
          custom_formats,
          quality_profiles,
          delay_profiles,
          metadata_profiles,
          regular_expressions,
          quality_definitions,
          naming,
          media_management,
        ]
    name: { type: string }
    layer: { $ref: '#/ResolvedLayer' }
    present:
      {
        type: boolean,
        description: false when the entity does not exist in this layer,
      }
    # For layer=base|resolved: the canonical entity snapshot.
    entity:
      description: Canonical Portable* payload for the entity type (null when layer=user)
      nullable: true
    # For layer=user: field-level overrides vs base-only, reusing the sync FieldChange shape.
    overrides:
      type: array
      nullable: true
      items: { $ref: '../openapi.yaml#/components/schemas/FieldChange' }

ResolvedEntityListResponse:
  type: object
  required: [databaseId, entityType, layer, entities]
  properties:
    databaseId: { type: integer }
    entityType: { type: string }
    layer: { $ref: '#/ResolvedLayer' }
    entities:
      type: array
      items: { $ref: '#/ResolvedEntityState' }
```

Cross-instance + live diff schemas (reuse `EntityChange`/`FieldChange` from
`schemas/sync.yaml`):

```yaml
ResolvedInstanceState:
  type: object
  required: [instanceId, instanceName, arrType, present]
  properties:
    instanceId: { type: integer }
    instanceName: { type: string }
    arrType: { type: string, enum: [radarr, sonarr, lidarr] }
    compatible:
      {
        type: boolean,
        description: false when entity/section unsupported for this arrType,
      }
    present: { type: boolean }
    desired:
      { description: arr-type transformed desired payload, nullable: true }
    actual:
      {
        description: live Arr state (only when includeLive=true),
        nullable: true,
      }

CrossInstanceComparisonResponse:
  type: object
  required: [databaseId, entityType, name, instances]
  properties:
    databaseId: { type: integer }
    entityType: { type: string }
    name: { type: string }
    instances:
      type: array
      items: { $ref: '#/ResolvedInstanceState' }
    # Pairwise field diffs desired-vs-desired (and desired-vs-actual when live), keyed by instanceId.
    diffs:
      type: array
      items:
        type: object
        required: [instanceId, changes]
        properties:
          instanceId: { type: integer }
          changes:
            type: array
            items: { $ref: '../openapi.yaml#/components/schemas/EntityChange' }

ResolvedLiveDiffResponse:
  type: object
  required: [databaseId, entityType, name, instanceId, arrType, changes]
  properties:
    databaseId: { type: integer }
    entityType: { type: string }
    name: { type: string }
    instanceId: { type: integer }
    arrType: { type: string, enum: [radarr, sonarr, lidarr] }
    changes:
      type: array
      items: { $ref: '../openapi.yaml#/components/schemas/EntityChange' }
```

Example `ResolvedEntityState` (layer=user, quality profile with an override):

```json
{
  "databaseId": 3,
  "entityType": "quality_profiles",
  "name": "HD Bluray + WEB",
  "layer": "user",
  "present": true,
  "entity": null,
  "overrides": [
    {
      "field": "minimumScore",
      "type": "changed",
      "current": 0,
      "desired": 100
    },
    {
      "field": "customFormatScores[\"Remux Tier 01\"].score",
      "type": "changed",
      "current": 0,
      "desired": 1500
    }
  ]
}
```

---

## API Design

All endpoints are **PCD-scoped** and live under the existing `/pcd/{databaseId}/…` family
(consistent with `pcd/{databaseId}/lidarr-metadata-profiles`, `pcd/{databaseId}/snapshots`).
Contract-first: define in `docs/api/v1/` first, run `deno task generate:api-types`, then
implement.

Auth: fail-closed exactly like `compatibility/parity/+server.ts` —
`if (!locals.user && !locals.authBypass) return 401`.

### 1. Resolved entity state (with layer)

```
GET /api/v1/pcd/{databaseId}/resolved/{entityType}
GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}
```

Query params:

- `layer` = `base | user | resolved` (default `resolved`).
- `arrType` = `radarr | sonarr | lidarr` — **required** for arr-specific entity types
  (e.g. quality profiles whose CF scores/qualities are per-arr); rejected/ignored for
  arr-agnostic types. Fail-fast on missing when required.

Responses:

- `200` → `ResolvedEntityListResponse` (list form) or `ResolvedEntityState` (named form).
- `400` — invalid/non-digit `databaseId`, unknown `entityType`, missing required `arrType`,
  or **cache not built/disabled** (mirror parity's deliberate 400-not-404 for unbuilt DB).
- `401` — unauthenticated.
- `404` — named entity not found in the requested layer (or return `present:false` at 200;
  choose `present:false` for the list-consistent shape, `404` only for the named endpoint's
  hard miss — decide in Open Questions).
- `500` — replay/read failure (log via `logger.error`, generic message).

Server: `routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts` and
`.../[entityType]/[name]/+server.ts`. `layer=resolved` reads `pcdManager.getCache(id)`;
`layer=base` builds the ephemeral base-only cache; `layer=user` computes both and diffs.

### 2. Cross-instance comparison

```
GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}/compare
```

Query params:

- `instanceIds` = comma-separated Arr instance IDs (required; cap e.g. ≤ 8).
- `includeLive` = `true|false` (default `false`). When `true`, performs rate-limited live
  fetches per instance.

Behavior: for each instance, resolve its `arr_type`, gate compatibility
(`isSyncSectionSupported`), transform the resolved entity to that arr's desired payload
(reuse the section transformer, e.g. `transformQualityProfileWithSuffix`), and — if
`includeLive` — fetch actual via the Arr client. Returns
`CrossInstanceComparisonResponse` with per-instance state and pairwise diffs.

Errors: `400` (bad ids/cap exceeded/unbuilt cache), `401`, `404` (entity/instance missing),
`429` (per-instance live-fetch rate limit tripped), `500`.

Server: `.../[entityType]/[name]/compare/+server.ts`.

### 3. Live diff (desired vs actual, single instance)

```
GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}/diff?instanceId={id}
```

Behavior: invoke the section syncer's `generatePreview()` (via preview orchestrator) for the
instance, filter `EntityChange[]` to `{name}` (suffix-aware), return
`ResolvedLiveDiffResponse`. Enforce `registerPreviewCreateAttempt(instanceId, now)`.

Errors: `400` (unbuilt cache / unsupported arrType / section unsupported for arrType),
`401`, `404` (instance/entity missing), `429` (rate limited), `500`.

Server: `.../[entityType]/[name]/diff/+server.ts`.

### Contract-first workflow (concrete)

1. Add `docs/api/v1/paths/resolved-config.yaml` with the three path objects
   (`resolvedEntity`, `resolvedEntityCompare`, `resolvedEntityLiveDiff`).
2. Add `docs/api/v1/schemas/resolved-config.yaml` with the wrapper schemas above.
3. Register in `docs/api/v1/openapi.yaml`: under `paths:` add the four route keys as
   `$ref: './paths/resolved-config.yaml#/…'` (follow the `/compatibility/parity` pattern at
   line ~615) and under `components.schemas` add the `$ref`s (pattern at line ~1329).
4. Run `deno task generate:api-types` → regenerates `packages/praxrr-app/src/lib/api/v1.d.ts`.
5. Run `deno task bundle:api` before any publish follow-up (regenerates the
   `packages/praxrr-api/openapi.json` + `types.ts` **mirror** — not hand-edited).
6. Implement handlers referencing `components['schemas'][…]` from `$api/v1.d.ts`.

---

## System Constraints

### Performance

- **Resolved reads are cheap**: `layer=resolved` is a set of Kysely queries against the
  already-built in-memory cache (`cache.kb`) — no rebuild, no I/O. Same cost profile as the
  existing `computeProfileCompatibility` / `list` readers.
- **Base-only replay cost**: building the ephemeral base-only cache re-executes schema+base+
  tweaks ops into a fresh `:memory:` SQLite. This is the same work `PCDCache.build()` does
  minus the user layer and minus value-guard/history — a few ms to tens of ms per the
  `CacheBuildStats.timing` already logged. Mitigations: (a) build lazily only for
  `layer=base|user`; (b) short-lived memoization keyed by `databaseId` + a cache-generation
  token invalidated on `compile()`/`invalidate()`; (c) never store it in the global registry
  (keep it out of the resolved-cache swap path). Prefer building on demand and `close()`-ing
  immediately to avoid leaking SQLite handles.
- **Live fetches are rate-limited per instance** via the existing
  `registerPreviewCreateAttempt` (6 requests / 60s per instance) plus the preview
  store cap (200) and 64 KB body limit. Cross-instance comparison with `includeLive=true`
  must register an attempt **per instance** and surface `429` rather than hammering Arr.
- **int64 caveat**: the cache opens SQLite with `{ int64: true }` (for byte-size columns).
  Resolved payloads may contain `BigInt`; serialize via a replacer that coerces `BigInt`→
  `number`/`string` before `json()` (SvelteKit `JSON.stringify` throws on BigInt).

### Security / auth

- Same fail-closed gate as parity: `locals.user || locals.authBypass`, else `401`.
- No Arr credentials in responses (existing clients redact); live-diff/compare return only
  transformed state, never tokens/URLs with secrets.
- Strict `databaseId` validation (`/^\d+$/`) and integer `instanceId` parsing, mirroring the
  parity endpoint's anti-`1e5`/`1abc` guard.

### Cross-Arr semantics (CLAUDE.md policy)

- The resolved cache is arr-agnostic canonical, but **quality-profile qualities and CF
  scores are per-`arr_type`** (`quality_profile_custom_formats.arr_type`,
  `quality_api_mappings` per arr). Layer/compare/live endpoints must dispatch by explicit
  `arr_type` and **never** fall back to a sibling app or to `arr_type='all'` scores as proof
  of compatibility (see `computeCompatibleProfileNames` — it deliberately ignores `'all'`).
- Radarr vs Sonarr vs Lidarr desired payloads differ (language handling, quality sets,
  Lidarr metadata profiles, media-management subsections). Reuse the **existing per-section
  transformers** (`sync/qualityProfiles/transformer.ts`, `sync/customFormats/transformer.ts`,
  etc.) rather than re-deriving payloads — they already encode the per-arr contract.
- Gate compare/live by `isSyncSectionSupported(arrType, section)`; mark
  `compatible:false` for unsupported combos instead of emitting a misleading empty diff.

---

## Codebase Changes

### Create (server)

- `packages/praxrr-app/src/lib/server/pcd/resolved/layeredView.ts` — base-only ephemeral
  replay handle (or the `PCDCache.buildReadOnly` extension, see below).
- `packages/praxrr-app/src/lib/server/pcd/resolved/readers.ts` — entityType→reader dispatch.
- `packages/praxrr-app/src/lib/server/pcd/resolved/layerDiff.ts` — base↔resolved override diff.
- `packages/praxrr-app/src/lib/server/pcd/resolved/liveDiff.ts` — single-entity desired↔actual.
- `packages/praxrr-app/src/lib/server/pcd/resolved/index.ts` — public surface.

### Create (routes / API)

- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts`
- `.../resolved/[entityType]/[name]/+server.ts`
- `.../resolved/[entityType]/[name]/compare/+server.ts`
- `.../resolved/[entityType]/[name]/diff/+server.ts`

### Create (spec — contract-first, do first)

- `docs/api/v1/paths/resolved-config.yaml`
- `docs/api/v1/schemas/resolved-config.yaml`

### Create (client)

- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.server.ts`
- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.svelte`
- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`
- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/CrossInstanceGrid.svelte`
  (reuse `ParityMatrix.svelte` layout idioms + `$ui/table/Table.svelte`).

### Modify

- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts` — extract the op-execution loop
  and add `buildReadOnly({ layers })` that skips value-guard + `pcdOpHistoryQueries.create`.
  (Keeps file within the ~500-line soft cap by factoring the loop into a helper.)
- `packages/praxrr-app/src/lib/server/pcd/index.ts` — re-export the resolved service.
- `docs/api/v1/openapi.yaml` — register new paths + schema `$ref`s.
- `packages/praxrr-app/src/lib/api/v1.d.ts` — regenerated (not hand-edited).
- `packages/praxrr-api/openapi.json` + `packages/praxrr-api/types.ts` — regenerated mirror
  via `deno task bundle:api` (governance: cross-repo mirror, do not hand-edit).
- Navigation registry (`$lib/server/navigation/registry.ts`) — add the viewer route if it
  should appear in nav (follow how `parity-map` is registered).
- Entity-editor pages (`routes/custom-formats/[databaseId]/**`,
  `routes/quality-profiles/[databaseId]/**`) — mount `ResolvedStatePanel.svelte`
  (optional, phase 2).

### Reuse (no change)

- `$sync/preview/diff.ts#diffToFieldChanges` — field-level diff engine.
- `$sync/preview/sectionDiffs.ts` — array-key strategies + `diffEntityCollection`.
- `$sync/preview/orchestrator.ts#generatePreview`, `store.ts`, `limits.ts` — live diff + rate limit.
- `routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte` — diff renderer.
- `sync/qualityProfiles/transformer.ts`, `sync/customFormats/transformer.ts` — per-arr transforms.
- `entities/customFormats/list.ts`, `qualityProfiles/list.ts`,
  `qualityProfiles/compatibility.ts` — resolved readers.
- `$shared/pcd/portable.ts` + `Portable*` OpenAPI schemas — canonical entity shapes.
- `parity-map/` page + `ParityMatrix.svelte` — comparison-page pattern.

### Dependencies

None new. `openapi-typescript` is already wired for `generate:api-types`; diffing, SQLite,
Kysely, Arr clients all exist.

---

## Technical Decisions

### D1 — Layer breakdown: selective replay vs op introspection

- **Option A (recommended): read-only layer-subset replay.** Reuse `loadAllOperations` +
  a side-effect-free `PCDCache.buildReadOnly({ layers })` to materialize the base-only
  cache, then run the same entity readers and diff against the live resolved cache.
- Option B: reconstruct entity state by parsing `pcd_ops.sql` / `desired_state` directly.
  Rejected — duplicates the SQL replay semantics the cache already encodes and drifts from
  the compiler.
- **Rationale:** A matches the issue's design note ("cache rebuilt by replaying ops"),
  keeps one source of truth for compilation, and reuses every existing reader. The only new
  primitive is a build variant that omits value-guard/history — a genuine correctness
  requirement (a read-only view must not write `pcd_op_history` or drop ops).

### D2 — Resolved payload shape: Portable canonical vs table-row

- **Recommended: canonical `Portable*` shapes** as the entity payload, since they are
  already OpenAPI-published, arr-agnostic, and used across export. The list/table readers
  (e.g. `CustomFormatTableRow`) are display-oriented; prefer Portable for the API contract
  and let the client render trees/tables from it. Where a Portable reader doesn't yet exist
  for an entity type, extend the existing `entities/**/read.ts` rather than invent a shape.
- **Rationale:** Portable Contract Fidelity — document only fields runtime actually returns
  for that `arr_type`; reuse published schemas to avoid contract drift.

### D3 — Live diff: reuse sync preview vs new per-entity Arr path

- **Recommended: reuse the sync-preview syncers' `generatePreview()`** and filter to one
  entity; do not build a second, unmetered Arr-fetch path.
- **Rationale:** the preview pipeline already encodes per-arr transforms, suffix handling,
  volatile-field ignoring, and array-key matching, and is already rate-limited. A bespoke
  per-entity fetch would duplicate transform logic and risk cross-Arr semantic drift. The
  cost is fetching a section's worth of Arr data to diff one entity — acceptable, and can be
  narrowed later by passing a section/entity filter into the syncer.

### D4 — Cross-instance comparison semantics

- **Recommended:** compare each instance's **transformed-desired** payload (arr-type
  specific), with optional live actual behind `includeLive`. Group/annotate by `arr_type`
  and mark `compatible:false` for unsupported combos.
- **Rationale:** the resolved _desired_ is one per database; meaningful cross-instance
  divergence is exactly the per-arr transform + live drift. Enforcing per-arr gating honors
  the Cross-Arr policy and avoids presenting a radarr-shaped profile as if valid for lidarr.

### D5 — Endpoint placement

- **Recommended:** `/api/v1/pcd/{databaseId}/resolved/**` (PCD-scoped), not
  `/compatibility/**`. Rationale: resolved state is a property of a PCD database + its
  entities; comparison/diff are sub-resources of a named entity. Keeps discovery aligned
  with the existing `/pcd/{databaseId}/…` family.

---

## Open Questions

1. **Named-miss status code**: for `GET …/resolved/{type}/{name}` when the entity is absent
   in the requested layer — return `200` with `present:false` (list-consistent) or `404`?
   Recommend `present:false` for `layer=user`/comparisons and `404` only for a hard named
   miss on `layer=resolved`. Needs confirmation.
2. **User-override granularity**: is field-level `FieldChange[]` (base↔resolved) the desired
   "user overrides" representation, or should it also surface the originating `pcd_ops` rows
   (op id, conflict state from `pcd_op_history`) for provenance? The latter adds a join but
   enables "which op set this".
3. **TRaSH-sourced profiles**: sync mixes PCD ops with TRaSH Guide entities (not in
   `pcd_ops`). Is the viewer strictly PCD-entity-scoped (recommended), or must it also
   render resolved TRaSH-derived profiles? If the latter, live diff must reconcile the
   TRaSH batch path in the syncer.
4. **Namespace suffix in live/compare**: synced Arr entities carry an invisible namespace
   suffix (`getNamespaceSuffix`). The single-entity live-diff filter must match on the
   suffixed name per (instance, database). Confirm the suffix is derivable read-only
   (`arrNamespaceQueries.getOrCreate` mutates) — may need a read-only `get` variant to avoid
   creating namespace rows during a preview.
5. **Base-only cache lifetime**: build-per-request vs a short-TTL memo invalidated by
   `compile()`/`invalidate()`. Confirm acceptable given typical op counts (the
   `CacheBuildStats.timing` logs give real numbers per linked DB).
6. **Media-management / naming entities**: these are singletons (not name-keyed). Confirm the
   route shape for non-name-keyed entity types (likely `…/resolved/{entityType}` without
   `{name}`).
