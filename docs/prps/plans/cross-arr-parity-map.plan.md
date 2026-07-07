# Plan: Cross-Arr Parity Map (issue #14)

## Summary

Ship a read-only **Cross-Arr Parity Map**: a standalone `/parity-map` page plus a contract-first
`GET /api/v1/compatibility/parity` endpoint that render an entity×app tri-state support matrix
(custom formats, quality profiles, quality definitions, delay profiles, metadata profiles ×
Radarr/Sonarr/Lidarr), a curated per-`arr_type` **semantic-differences** catalog (same API shape /
different domain semantics), and live per-profile **compatibility** ("which Arr apps can use this
quality profile") computed from the linked PCD. Support facts are **derived** from the existing
`$shared/arr/capabilities.ts` registry (no duplicate boolean map); the compatibility algorithm is
**extracted once** from `qualityProfiles/list.ts` and reused by both the endpoint and the list path.

## User Story

As a Praxrr user curating cross-Arr configuration (PCDs), I want a read-only parity map that shows
which config entities each Arr app supports, flags same-API-shape/different-semantics cases, and shows
which apps can use a given quality profile, so that I see incompatibilities **before** syncing instead
of discovering them only when a sync silently skips or misbehaves.

## Problem → Solution

Cross-Arr support facts and semantic divergences live only in ~7 server-only files (`capabilities.ts`
per-app booleans + scattered `mappings.ts`/`transformer.ts`/`syncer.ts` logic) with **zero
user-visible surface**, so "looks-portable" configs fail on apply → A standalone `/parity-map` page
plus a contract-first `GET /api/v1/compatibility/parity` endpoint render the entity×app tri-state
matrix (derived from `capabilities.ts`), a per-`arr_type` semantic-warnings catalog, and live
per-profile compatibility computed from the linked PCD by the one extracted `list.ts` algorithm.

## Metadata

- **Complexity**: XL (22 files — 12 new, 8 modified/regenerated, 3 test files)
- **Source design**: `docs/prps/designs/cross-arr-parity-map.design.md` (authoritative — winner "Live Parity Map — DB-Augmented Capability Registry")
- **Source issue**: GitHub #14 (Phase 2 UX & Onboarding, priority medium; parent #6; related #24, #34)
- **Estimated Files**: 22
- **Research Dispatch**: Enhanced (7 standalone `ycc:prp-researcher` sub-agents)
- **Execution Mode**: Parallel (7 batches, max width 6)

## Batches

Tasks grouped by dependency for parallel execution. Tasks within the same batch run concurrently;
batches run in order. No two tasks in the same batch touch the same file (verified — all 22 tasks edit
distinct files).

| Batch | Tasks                     | Depends On | Parallel Width |
| ----- | ------------------------- | ---------- | -------------- |
| B1    | 1, 3, 16, 17, 22          | —          | 5              |
| B2    | 2, 4, 10, 11, 15          | B1         | 5              |
| B3    | 5, 6, 12, 13, 18, 19      | B1, B2     | 6              |
| B4    | 7, 14                     | B3         | 2              |
| B5    | 8, 21                     | B4         | 2              |
| B6    | 9                         | B5         | 1              |
| B7    | 20                        | B6         | 1              |

- **Total tasks**: 22
- **Total batches**: 7
- **Max parallel width**: 6

---

## UX Design

### Before

- No parity surface exists: `NAV_REGISTRY` has no `/parity-map` entry; the closest overview item is `Databases` (`registry.ts:68-80`). Nothing shows cross-Arr support at a glance.
- Cross-Arr divergences are invisible in the UI — support facts live only in server code (`capabilities.ts:302-305`); semantic gaps (Lidarr audio qualities, Radarr-only `quality_modifier`, delay-profile default divergence) are scattered across `$sync/*` with no client render path.
- No "which apps can use this profile" answer anywhere; app-compat is computed server-side in `qualityProfiles/list.ts` purely to **filter** sync selection, never displayed.
- Per-app visual language already exists but is unused for a matrix: `Badge` supports `radarr/sonarr/lidarr` variants → `var(--arr-<type>-color)` (`Badge.svelte:27-45`; colors `app.css:357-359`; logos `$lib/client/assets/{Radarr.svg,Sonarr.svg,Lidarr.png}`).

### After

- New top-level `/parity-map` page reachable from the **Overview** nav group (`iconKey: 'LayoutGrid'`, `arrScope: 'all'`, `requiredFeature` UNSET), rendering the static matrix with zero network round-trip.
- Entity × app **matrix** via `Table.svelte`: rows = 5 entities; app columns headed by `getArrAppMetadata(type).label` + logo + `var(--arr-<type>-color)`; each cell a tri-state `Badge` — **success=native, info=shared, warning=unsupported**.
- **Semantic-difference cards** grouped by scope render the ≥8 curated warnings (`detail` = "explain why", `suggestion` = "suggest alternatives").
- When `?databaseId=` is supplied, a per-profile **"Usable by"** compatibility table appears (reusable `CompatibilityBadges.svelte` chip row); copy states "based on enabled qualities."
- A **database picker** navigates to `/parity-map?databaseId=<id>`; with no DBs linked the profile section shows an empty state while the static matrix/warnings still render. Everything informs, never blocks.

### Interaction Changes

| Touchpoint      | Before                                            | After                                                                                             | Notes                                    |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Nav discovery   | No parity item (`registry.ts:68-80`)              | New Overview entry `href:'/parity-map'`, `arrScope:'all'`, `requiredFeature` UNSET                 | Sidebar/mobile render generically        |
| Nav icon        | `NAV_ICON_MAP` has no `LayoutGrid` (`iconMap.ts`) | Register `LayoutGrid`; unregistered `iconKey` → `resolveNavIcon` returns `undefined` (icon gone)  | Must-do wiring                           |
| Support view    | Server-only booleans, never rendered              | `Table.svelte` matrix; cell via named `slot="cell"` switch on `column.key` → `<Badge variant>`    | `Badge.svelte:19-30` variant map         |
| Semantic gaps   | Scattered `$sync/*`, invisible                    | Warning cards grouped by scope, `detail`+`suggestion`                                              | Static tier, no DB call                  |
| Profile compat  | Only filters sync UI (`list.ts`)                  | Rendered "Usable by: Radarr · Sonarr" chips when `?databaseId=` present                            | Same extracted predicate                 |
| DB selection    | Auto-redirect + localStorage (`score-simulator`)  | Explicit picker → `/parity-map?databaseId=<id>`; no auto-resolve (OQ3)                             | Page + API both read explicit id         |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority       | File                                                                                  | Lines     | Why                                                                 |
| -------------- | ------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| P0 (critical)  | `docs/prps/designs/cross-arr-parity-map.design.md`                                    | all       | Authoritative design: data model, architecture, semantic catalog    |
| P0 (critical)  | `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`                              | 35-60, 88-165, 168-237, 298-330 | Support registry, `as const satisfies` pins, predicates to derive from |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts`             | 38-163    | Compatibility algorithm to EXTRACT (QUALITIES-∩ reader + fallback)  |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts`            | all       | Exports/wiring for the entity module (where `list`/`compatibility` live) |
| P1 (important) | `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`                        | 1-22, 253-328, 487-497 | GET handler: contract types, `parseInt`+400, cache guard, 500 catch |
| P1 (important) | `packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts`                     | 1-60      | Simple GET: auth 401 + query parse 400 (mirror for endpoint)        |
| P1 (important) | `packages/praxrr-app/src/routes/api/v1/openapi.json/+server.ts`                       | 1-23      | Module-level static-cache tier (mirror for static parity tier)      |
| P1 (important) | `docs/api/v1/openapi.yaml`                                                             | 1-45, 610-664 | Root registration of paths/schemas/tags; `ErrorResponse` shape  |
| P1 (important) | `docs/api/v1/paths/system.yaml` + `docs/api/v1/schemas/arr.yaml`                       | 1-30 each | Path/schema fragment authoring style                                |
| P1 (important) | `scripts/bundle-api.ts`                                                                | 39-108    | Bundle drops any schema file not root-`$ref`'d (registration gotcha) |
| P1 (important) | `packages/praxrr-app/src/lib/client/ui/table/Table.svelte` + `table/types.ts`         | 1-40, all | `Column<T>` + named `slot="cell" let:row let:column` render         |
| P1 (important) | `packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`                            | 1-45      | Variants (success/info/warning + radarr/sonarr/lidarr); legacy events |
| P1 (important) | `packages/praxrr-app/src/lib/client/navigation/iconMap.ts`                            | all       | `NAV_ICON_MAP` + `resolveNavIcon` (register `LayoutGrid`)           |
| P1 (important) | `packages/praxrr-app/src/lib/server/navigation/registry.ts`                           | 60-90     | `NAV_REGISTRY` append pattern (`ensureGroupId`, `arrScope`, `iconKey`) |
| P2 (reference) | `packages/praxrr-app/src/tests/arr/resolveArrTargets.test.ts`                         | all       | Pure-module Deno.test + `@std/assert` style                         |
| P2 (reference) | `packages/praxrr-app/src/tests/arr/lidarrQualityMappingPrereqs.test.ts`               | 1-49, 87-123 | In-memory `@jsr/db__sqlite` Kysely PCD fixture                   |
| P2 (reference) | `packages/praxrr-app/src/tests/routes/uiPreferencesApi.test.ts`                       | 1-19, 110-166 | Endpoint handler test (import GET, `Parameters<typeof GET>[0]`)  |
| P2 (reference) | `packages/praxrr-app/src/routes/score-simulator/+page.svelte`                         | 14-46     | DB-scoped page + picker/empty-state pattern                         |

## External Documentation

| Topic                  | Source                                                                 | Key Takeaway                                                                                       |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Type generation        | `deno.json:69` → `npx openapi-typescript docs/api/v1/openapi.yaml -o packages/praxrr-app/src/lib/api/v1.d.ts` | `deno task generate:api-types` regen adds ~3300 lines of tool-version noise (CI ungated) — scrub to a reviewable diff |
| JSR mirror bundling    | `deno.json:94` → `scripts/bundle-api.ts`                              | `deno task bundle:api` flattens the multi-file spec → `packages/praxrr-api/{openapi.json,types.ts}`; run after contract changes |
| SvelteKit endpoint     | `@sveltejs/kit` `RequestHandler` + `json()`                          | `export const GET: RequestHandler = async ({ locals, url }) => …`; responses via `json(payload, { status })` |

_This is an INTERNAL feature — no third-party API/SDK. The "API" is the app's own contract-first `/api/v1` surface._

---

## Patterns to Mirror

Code patterns discovered in the codebase. Follow these exactly.

### NAMING_CONVENTION

```ts
// SOURCE: capabilities.ts:35-50 — ordered literal arrays pinned with `as const satisfies readonly X[]`
export const ARR_SYNC_SURFACES = [
  'quality_profiles', 'custom_formats', 'delay_profiles', 'media_management', 'metadata_profiles',
] as const satisfies readonly ArrSyncSurface[];
// → mirror as: export const PARITY_ENTITIES = [...] as const satisfies readonly ParityEntity[];
// SCREAMING_SNAKE const registries (ARR_APPS, ARR_APP_TYPES) → PARITY_ENTITIES, NATIVE_ENTITY_APPS, ARR_SEMANTIC_DIFFERENCES
// Predicates named supports*/get*/is* → getEntitySupportStatus. Type-only imports: `import { type X } from '$shared/...ts'` WITH .ts suffix.
```

### NON_REGRESSION_PIN (compile-time freeze — mirror for `PARITY_NON_REGRESSION_CHECK`)

```ts
// SOURCE: capabilities.ts:168-205, 235-237
const ARR_CAPABILITY_NON_REGRESSION_CHECK = {
  radarr: ARR_APPS.radarr.capabilities, sonarr: ARR_APPS.sonarr.capabilities,
} as const satisfies { radarr: { /* literal */ }; sonarr: { /* literal */ } };
void ARR_CAPABILITY_NON_REGRESSION_CHECK;
```

### SUPPORT_DERIVATION (never copy a 4th boolean map)

```ts
// SOURCE: capabilities.ts:298-305 — parity.ts calls these; only native/shared is authored
export function supportsArrSyncSurface(type: ArrAppType, surface: ArrSyncSurface): boolean {
  return ARR_APPS[type].capabilities.sync[surface];
}
// getEntitySupportStatus(app, entity): 'unsupported' when !supportsArrSyncSurface(app, BRIDGE[entity]); else native/shared from NATIVE_ENTITY_APPS.
```

### COMPATIBILITY_ALGORITHM (extract verbatim from list.ts, then delegate)

```ts
// SOURCE: list.ts:59-82 — QUALITIES-filtered mapping reader (transitional-row guard)
const supportedApiNames = new Set(Object.keys(QUALITIES[arrType]));
for (const row of mappingRows) { if (!supportedApiNames.has(row.api_name)) continue; supportedQualityNames.add(row.quality_name.toLowerCase()); }
if (supportedQualityNames.size === 0) return [];   // never trust arr_type='all'
// SOURCE: list.ts:135-159 — zero-enabled → arr-specific-score fallback (where arr_type = arrType only)
if (!enabledQualityNames || enabledQualityNames.size === 0) { if (hasArrSpecificScores.has(profile.name)) compatibleProfileNames.add(profile.name); continue; }
```

### ERROR_HANDLING (endpoint fail-fast — mirror `arr/library` + `ui-preferences`)

```ts
// SOURCE: arr/library/+server.ts:307-316 — auth 401, param parse 400 (deviate: unknown cache → 400 not 404)
type ErrorResponse = components['schemas']['ErrorResponse'];
if (!locals.user) return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
const id = parseInt(raw, 10);
if (isNaN(id) || id < 0) return json({ error: 'Invalid databaseId' } satisfies ErrorResponse, { status: 400 });
// SOURCE: arr/library/+server.ts:253-254 — cache-built guard; unbuilt/absent → 400 (never 500)
const cache = pcdManager.getCache(id); if (!cache?.isBuilt()) return json({ error: 'Database not found' } satisfies ErrorResponse, { status: 400 });
```

### STATIC_CACHE_TIER (module-level cache — mirror `openapi.json/+server.ts`)

```ts
// SOURCE: openapi.json/+server.ts:6,16-23 — build once, reuse; DB touched only when ?databaseId= present
let cachedStatic: ParityMapResponse | null = null;
export const GET: RequestHandler = async ({ locals, url }) => {
  if (!cachedStatic) cachedStatic = { entities, apps, matrix, semanticDifferences };
  // ... optional DB tier appends `profiles`
};
```

### CONTRACT_TYPING (handler locked to OpenAPI)

```ts
// SOURCE: arr/library/+server.ts:20-22
import type { components } from '$api/v1.d.ts';
type ParityMapResponse = components['schemas']['ParityMapResponse'];
```

### TABLE_RENDER (matrix — mirror `Table.svelte` + `types.ts`)

```svelte
<!-- SOURCE: Table.svelte:195 + types.ts:12-35 — Column<T> + named cell slot -->
<Table {columns} rows={parityRows}>
  <svelte:fragment slot="cell" let:row let:column>
    {#if column.key === 'radarr' || column.key === 'sonarr' || column.key === 'lidarr'}
      <Badge variant={statusVariant(row[column.key])}>{row[column.key]}</Badge>
    {/if}
  </svelte:fragment>
</Table>
```

### TEST_STRUCTURE (Deno.test + @std/assert; in-memory Kysely; endpoint handler import)

```ts
// SOURCE: resolveArrTargets.test.ts:1-8 — pure module
import { assertEquals } from '@std/assert';
import { getEntitySupportStatus } from '$shared/arr/parity.ts';
Deno.test('parity: metadata_profiles → unsupported/unsupported/native', () => { /* ... */ });
// SOURCE: lidarrQualityMappingPrereqs.test.ts:32-49 — in-memory PCD fixture
const db = new Database(':memory:', { int64: true });
const kb = new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: db }) });
const cache = { kb } as unknown as PCDCache; // try { ... } finally { await kb.destroy(); db.close(); }
// SOURCE: uiPreferencesApi.test.ts:1-19 — endpoint: import GET, Parameters<typeof GET>[0], build event as GetEvent
```

### SVELTE_LEGACY_EVENTS (⚠ mirror existing components — NOT runes, NOT `onclick`)

```svelte
<!-- SOURCE: Badge.svelte / Button.svelte / Table.svelte — repo is LEGACY-event mode -->
<script lang="ts">
  export let variant: BadgeVariant = 'default'; // props via export let
  $: classes = computeClasses(variant);          // reactivity via $:
</script>
<button on:click={handler}>...</button>            <!-- events via on:click, NOT onclick -->
<!-- ⚠ CLAUDE.md says "onclick handlers, no $state/$derived" — the actual repo uses on:click + export let + $:. Mirror the codebase; run `deno task format` (.prettierrc.json: 2-space/single-quote/semi/~120w). -->
```

---

## Files to Change

| File                                                                                          | Action  | Justification                                                                 |
| --------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/shared/arr/parity.ts`                                            | CREATE  | Entity axis + tri-state derivation from `supportsArrSyncSurface` via total bridge; `NATIVE_ENTITY_APPS`; `PARITY_NON_REGRESSION_CHECK` |
| `packages/praxrr-app/src/lib/shared/arr/semanticDifferences.ts`                               | CREATE  | Authored per-`arr_type` catalog (≥8 entries) — the only net-new prose        |
| `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/compatibility.ts`            | CREATE  | Single compat surface extracted from `list.ts:59-159`                        |
| `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts`                     | UPDATE  | Delegate lines 59-159 to `computeCompatibleProfileNames` (behavior-preserving) |
| `docs/api/v1/paths/compatibility.yaml`                                                         | CREATE  | `getCompatibilityParity` GET op, tag `compatibility`                          |
| `docs/api/v1/schemas/compatibility.yaml`                                                       | CREATE  | `ParityMapResponse`, `ArrSemanticDifference`, `ProfileCompatibility` schemas |
| `docs/api/v1/openapi.yaml`                                                                     | UPDATE  | Register path `$ref`, schema `$ref`s, `tags` entry (bundle-api drops unreferenced files) |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                                                      | REGEN   | `deno task generate:api-types`; scrub tool-version noise                     |
| `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts`                        | CREATE  | GET: static tier module-cached + DB tier via `computeProfileCompatibility` when `?databaseId=`; fail-fast 400 |
| `packages/praxrr-app/src/routes/parity-map/parityRows.ts`                                      | CREATE  | Pure, Svelte-free matrix-row builder (unit-testable)                         |
| `packages/praxrr-app/src/lib/client/ui/parity/CompatibilityBadges.svelte`                      | CREATE  | Reusable "Usable by: …" chip row (drop-in for the deferred inline editor)    |
| `packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte`                                | CREATE  | Entity × app matrix via `Table.svelte` + status `Badge`s + per-app colored headers/logos |
| `packages/praxrr-app/src/routes/parity-map/SemanticDifferences.svelte`                         | CREATE  | Warning cards grouped by scope; renders `detail` + `suggestion`             |
| `packages/praxrr-app/src/routes/parity-map/+page.svelte`                                       | CREATE  | Page shell composing matrix + semantic cards + (when DB linked) profile-compat table |
| `packages/praxrr-app/src/routes/parity-map/+page.server.ts`                                    | CREATE  | Load: static tier always; reads optional `?databaseId=`, calls `computeProfileCompatibility`; DB picker options |
| `packages/praxrr-app/src/lib/client/navigation/iconMap.ts`                                     | UPDATE  | Import + register `LayoutGrid` in `NAV_ICON_MAP`                             |
| `packages/praxrr-app/src/lib/server/navigation/registry.ts`                                    | UPDATE  | Append one `overview` nav entry (`/parity-map`, `arrScope: all`, no `requiredFeature`) |
| `packages/praxrr-app/src/tests/arr/parityMap.test.ts`                                          | CREATE  | Tri-state truth table, bridge totality, axis↔subsection pin, catalog invariants |
| `packages/praxrr-app/src/tests/pcd/qualityProfileCompatibility.test.ts`                        | CREATE  | Extracted-predicate + `list.ts` delegation-equivalence with in-memory fixture |
| `packages/praxrr-app/src/tests/routes/parityMapApi.test.ts`                                    | CREATE  | Endpoint status + shape + contract types (static / `?databaseId=` / 400)     |
| `packages/praxrr-api/openapi.json`, `packages/praxrr-api/types.ts`                             | REGEN   | `deno task bundle:api` (JSR mirror)                                          |
| `scripts/test.ts`                                                                              | UPDATE  | Add `parity` alias to the aliases map (convenience)                          |

## NOT Building

- **Inline quality-profile-editor "Usable by" indicator** — `CompatibilityBadges.svelte` ships now, but wiring it into the editor's own `+page.server.ts` load is deferred (design §3, §8). This PR is a **disclosed partial** of the issue's component 3.
- **Apply-time interactive migration hints** — MVP ships the data (`detail`/`suggestion`) on the standalone page; the interactive `alertStore.add('warning', …)` wiring into the sync/apply flow (`routes/arr/[id]/sync/+page.server.ts`) is deferred (relates to #24).
- **Populating `UNSUPPORTED_SYNC_SECTION_REASONS` / `UNSUPPORTED_MEDIA_MANAGEMENT_SUBSECTION_REASONS`** (`mappings.ts:37,39`) from the catalog — camelCase↔snake_case convergence bridge is plan-of-record but deferred.
- **Server-side semantic-fact consolidation** (`transformer.ts`/`syncer.ts`/`mappings.ts` → catalog as sync's source).
- **DB-backed quality-name-level matrix augmentation** (per-`quality_definitions` size diffs).
- **A 4th boolean support map** — support MUST be derived from `supportsArrSyncSurface`; only `native`/`shared` is authored. (Anti-drift invariant.)
- **Reclassifying Lidarr `quality_profiles`/`quality_definitions` as `native` on value (audio) grounds** — status rubric is schema-shape-only; value divergence is a **semantic warning** (OQ1).
- **Ecosystem expansion** (#34 Readarr/Whisparr) and **#24 adapter layer** consuming the endpoint.
- **Pre-login/setup-wizard availability** — route stays auth-gated; NOT added to `PUBLIC_PATHS`.
- **Pagination / lazy-load of `profiles`** — bounded (`ARR_APP_TYPES × profiles`); return all inline (OQ4).

---

## Step-by-Step Tasks

### Task 1: Create `parity.ts` (entity axis + tri-state derivation) — Depends on [none]

- **BATCH**: B1
- **ACTION**: Create `packages/praxrr-app/src/lib/shared/arr/parity.ts`.
- **IMPLEMENT**: Define `ParityEntity` = `'custom_formats' | 'quality_profiles' | 'quality_definitions' | 'delay_profiles' | 'metadata_profiles'` and `PARITY_ENTITIES` (`as const satisfies readonly ParityEntity[]`). Define `PARITY_ENTITY_TO_SYNC_SURFACE` as a **total** `Record<ParityEntity, ArrSyncSurface>` (bridge `quality_definitions → 'media_management'`). Define `NATIVE_ENTITY_APPS` (the only authored native-vs-shared refinement; per OQ1 Lidarr `quality_profiles` stays `shared`, `quality_definitions` is `native` for all). Export `getEntitySupportStatus(app, entity): 'native' | 'shared' | 'unsupported'` — return `'unsupported'` when `!supportsArrSyncSurface(app, PARITY_ENTITY_TO_SYNC_SURFACE[entity])`, else `native`/`shared` from `NATIVE_ENTITY_APPS`. Add a `PARITY_NON_REGRESSION_CHECK` void-pin.
- **MIRROR**: NAMING_CONVENTION, NON_REGRESSION_PIN, SUPPORT_DERIVATION.
- **IMPORTS**: `import { type ArrAppType, type ArrSyncSurface, supportsArrSyncSurface } from '$shared/arr/capabilities.ts';` and `ARR_APP_TYPES` from `$shared/pcd/types.ts`.
- **GOTCHA**: Do NOT author an `unsupported` map — derive it. Total `Record` gives compile-time fail-fast on an unmapped entity.
- **VALIDATE**: `deno task check:server`; covered by Task 18 tests.

### Task 2: Create `semanticDifferences.ts` (catalog) — Depends on [1]

- **BATCH**: B2
- **ACTION**: Create `packages/praxrr-app/src/lib/shared/arr/semanticDifferences.ts`.
- **IMPLEMENT**: Define `ArrSemanticDifference` (`{ scope: ParityScope; apps: ArrAppType[]; summary: string; detail: string; suggestion?: string; sourceRefs: string[] }`) with `ParityScope = ParityEntity | ArrWorkflowSurface`, and `ARR_SEMANTIC_DIFFERENCES` (≥8 entries from design §5.2: Lidarr audio qualities, Radarr-only `quality_modifier`, Sonarr-only `release_type`, indexer-flag bit divergence, delay-profile default-id divergence, metadata-profiles Lidarr-only, upgrades Radarr-only, rename Lidarr-unsupported). Use `$lib/server/upgrades/processor.ts` (NOT `$upgrades/`) in prose sourceRefs.
- **MIRROR**: NAMING_CONVENTION.
- **IMPORTS**: `type ParityEntity` from `./parity.ts`; `type ArrWorkflowSurface, type ArrAppType` from `./capabilities.ts`.
- **GOTCHA**: `$upgrades/` alias does not exist — sourceRefs are prose strings, not imports.
- **VALIDATE**: `deno task check:server`; catalog invariants asserted in Task 18.

### Task 3: Create `compatibility.ts` (extract algorithm) — Depends on [none]

- **BATCH**: B1
- **ACTION**: Create `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/compatibility.ts`.
- **IMPLEMENT**: Extract `list.ts:59-159` verbatim into `computeCompatibleProfileNames(cache, arrType): Promise<Set<string>>` (QUALITIES-∩ reader + enabled-quality intersection + arr-specific-score fallback) and `computeProfileCompatibility(cache): Promise<ProfileCompatibility[]>` that iterates `ARR_APP_TYPES` explicitly and returns per-profile `{ name, compatibleArrTypes, basis: 'enabled-qualities' }`.
- **MIRROR**: COMPATIBILITY_ALGORITHM.
- **IMPORTS**: `QUALITIES` from `$sync/mappings.ts`; `type PCDCache` from `$pcd/database/cache.ts`; `ARR_APP_TYPES`/`type ArrAppType` from `$shared/pcd/types.ts`; `cache.kb` Kysely.
- **GOTCHA**: Keep the QUALITIES-filter (`api_name ∈ QUALITIES[arrType]`) and the `arr_type = arrType` fallback (never `'all'`) — this excludes transitional pre-`20260216` Lidarr rows.
- **VALIDATE**: `deno task check:server`; Task 19 pins behavior.

### Task 4: Refactor `list.ts` to delegate — Depends on [3]

- **BATCH**: B2
- **ACTION**: Modify `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts`.
- **IMPLEMENT**: Replace the inline `arrType` compatibility block (59-159) with `const compatible = await computeCompatibleProfileNames(cache, arrType); profiles = profiles.filter((p) => compatible.has(p.name));`. Behavior-preserving.
- **MIRROR**: COMPATIBILITY_ALGORITHM (delegation).
- **IMPORTS**: `computeCompatibleProfileNames` from `./compatibility.ts`.
- **GOTCHA**: Load-bearing — this filter feeds live sync-selection UI, not just the map. Output set must be identical pre/post.
- **VALIDATE**: `deno task test filters` (existing) + Task 19 delegation-equivalence test.

### Task 5: Author `paths/compatibility.yaml` — Depends on [1, 2]

- **BATCH**: B3
- **ACTION**: Create `docs/api/v1/paths/compatibility.yaml`.
- **IMPLEMENT**: `getCompatibilityParity` GET op: optional `databaseId` query param (integer), tag `compatibility`, `200`→`ParityMapResponse`, `400`/`401`/`500`→`ErrorResponse`.
- **MIRROR**: api-researcher path-fragment authoring (`paths/system.yaml`).
- **GOTCHA**: OpenAPI 3.1; reuse existing `ErrorResponse` schema (`$ref`), don't redeclare.
- **VALIDATE**: referenced by Task 7; validated when `deno task generate:api-types` succeeds (Task 8).

### Task 6: Author `schemas/compatibility.yaml` — Depends on [1, 2]

- **BATCH**: B3
- **ACTION**: Create `docs/api/v1/schemas/compatibility.yaml`.
- **IMPLEMENT**: `ParityMapResponse` (`entities`, `apps`, `matrix`, `semanticDifferences`, optional `profiles`), `ArrSemanticDifference`, `ProfileCompatibility` (`name`, `compatibleArrTypes`, `basis`). Plain JSON-Schema top-level keys.
- **MIRROR**: schema-fragment authoring (`schemas/arr.yaml`).
- **GOTCHA**: Match field names/types exactly to `parity.ts`/`semanticDifferences.ts`/`compatibility.ts` runtime shapes.
- **VALIDATE**: Task 8 regen; Task 20 asserts the handler's response matches these types.

### Task 7: Register in `openapi.yaml` — Depends on [5, 6]

- **BATCH**: B4
- **ACTION**: Modify `docs/api/v1/openapi.yaml`.
- **IMPLEMENT**: Add `/compatibility/parity` path `$ref` under `paths:`, each new schema under `components.schemas` as `Name: { $ref: './schemas/compatibility.yaml#/Name' }`, and a `tags:` entry `compatibility`.
- **MIRROR**: root-registration pattern (api-researcher).
- **GOTCHA**: `bundle-api.ts` DROPS any schema file not root-`$ref`'d — every new schema MUST be registered under `components.schemas`.
- **VALIDATE**: `deno task generate:api-types` succeeds (Task 8) and the bundle (Task 21) contains the schemas.

### Task 8: Regenerate `v1.d.ts` — Depends on [7]

- **BATCH**: B5
- **ACTION**: Regenerate `packages/praxrr-app/src/lib/api/v1.d.ts`.
- **IMPLEMENT**: Run `deno task generate:api-types`. Then scrub the diff to only the new `ParityMapResponse`/`ArrSemanticDifference`/`ProfileCompatibility` types — discard the ~3300-line tool-version churn.
- **MIRROR**: the existing generated-types layout in `v1.d.ts` (`components['schemas'][...]`); commit only the net-new type additions.
- **GOTCHA**: CI does not gate this file; a noisy diff is a review burden. Keep the committed diff reviewable (memory `v1dts-generator-drift`).
- **VALIDATE**: `git diff --stat packages/praxrr-app/src/lib/api/v1.d.ts` shows only the new-type additions; `deno task check` green.

### Task 9: Create endpoint `parity/+server.ts` — Depends on [1, 2, 3, 8]

- **BATCH**: B6
- **ACTION**: Create `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts`.
- **IMPLEMENT**: `GET: RequestHandler`. Auth-guard → 401. Build the static payload (matrix from `parity.ts` via `parityRows`/`getEntitySupportStatus`, catalog from `semanticDifferences.ts`) once into a module-level cache. When `?databaseId=` present: `parseInt`+validate → 400 on `NaN`/negative/`'all'`/unknown; `pcdManager.getCache(id)` + `isBuilt()` guard → 400 if absent/unbuilt (deliberately NOT 404); call `computeProfileCompatibility(cache)` and attach `profiles`. Type the response as `components['schemas']['ParityMapResponse']`.
- **MIRROR**: STATIC_CACHE_TIER, ERROR_HANDLING, CONTRACT_TYPING.
- **IMPORTS**: `json` from `@sveltejs/kit`; `type RequestHandler` from `./$types`; `type components` from `$api/v1.d.ts`; `pcdManager` from `$pcd/index.ts`; parity/catalog/compat modules.
- **GOTCHA**: No sibling fallback; never log `url.search` (API key can arrive via `?apikey=`); 500 catch returns generic `ErrorResponse`, logs with `meta` not stack.
- **VALIDATE**: `deno task check:server`; Task 20 tests all branches.

### Task 10: Create `parityRows.ts` (pure row builder) — Depends on [1]

- **BATCH**: B2
- **ACTION**: Create `packages/praxrr-app/src/routes/parity-map/parityRows.ts`.
- **IMPLEMENT**: Pure, Svelte-free `buildParityRows()` mapping each `PARITY_ENTITIES` entry to one `ParityRow` (`{ entity, label, radarr, sonarr, lidarr }`) via `getEntitySupportStatus`.
- **MIRROR**: SUPPORT_DERIVATION.
- **IMPORTS**: `PARITY_ENTITIES`, `getEntitySupportStatus` from `$shared/arr/parity.ts`; `ARR_APP_TYPES` from `$shared/pcd/types.ts`.
- **GOTCHA**: No Svelte imports — must be unit-testable in a Deno test.
- **VALIDATE**: `deno task check`; row shape asserted in Task 18.

### Task 11: Create `CompatibilityBadges.svelte` — Depends on [1]

- **BATCH**: B2
- **ACTION**: Create `packages/praxrr-app/src/lib/client/ui/parity/CompatibilityBadges.svelte`.
- **IMPLEMENT**: Reusable "Usable by:" chip row — `export let compatibleArrTypes: ArrAppType[]`; render each as `<Badge variant={type}>` (radarr/sonarr/lidarr variants). Empty → muted "None".
- **MIRROR**: SVELTE_LEGACY_EVENTS; `Badge.svelte`.
- **IMPORTS**: `Badge` from `$ui/badge/Badge.svelte`; `getArrAppMetadata` from `$shared/arr/capabilities.ts`.
- **GOTCHA**: Legacy events (`export let`, `$:`), NOT runes/`onclick`.
- **VALIDATE**: `deno task check:client` (svelte-check).

### Task 12: Create `ParityMatrix.svelte` — Depends on [10]

- **BATCH**: B3
- **ACTION**: Create `packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte`.
- **IMPLEMENT**: Render `Table.svelte` with `Column<ParityRow>[]` (entity + 3 app columns). Named `slot="cell"` switches on `column.key`: app columns → `<Badge variant={statusVariant(row[key])}>` (success=native, info=shared, warning=unsupported). App headers show `getArrAppMetadata(type).label` + logo + `var(--arr-<type>-color)`.
- **MIRROR**: TABLE_RENDER, SVELTE_LEGACY_EVENTS.
- **IMPORTS**: `Table` from `$ui/table/Table.svelte`; `type Column` from `$ui/table/types.ts`; `Badge`; `getArrAppMetadata`, `ARR_APP_TYPES`; logo assets from `$lib/client/assets/`.
- **GOTCHA**: `ArrAppMetadata` carries `label`/`iconKey`, not a logo path — import logos as assets.
- **VALIDATE**: `deno task check:client`.

### Task 13: Create `SemanticDifferences.svelte` — Depends on [2]

- **BATCH**: B3
- **ACTION**: Create `packages/praxrr-app/src/routes/parity-map/SemanticDifferences.svelte`.
- **IMPLEMENT**: Group `ARR_SEMANTIC_DIFFERENCES` by `scope`; render warning cards with `summary`, `detail` ("explain why"), optional `suggestion` ("suggest alternatives"), and per-app badges.
- **MIRROR**: SVELTE_LEGACY_EVENTS; `Badge`.
- **IMPORTS**: `ARR_SEMANTIC_DIFFERENCES` from `$shared/arr/semanticDifferences.ts`; `Badge`; `getArrAppMetadata`.
- **GOTCHA**: Inform-only — no interactive controls, no gating.
- **VALIDATE**: `deno task check:client`.

### Task 14: Create `+page.svelte` (page shell) — Depends on [11, 12, 13]

- **BATCH**: B4
- **ACTION**: Create `packages/praxrr-app/src/routes/parity-map/+page.svelte`.
- **IMPLEMENT**: `export let data`. `<svelte:head><title>Parity Map - Praxrr</title></svelte:head>` + h1/intro. Render `<ParityMatrix />` + `<SemanticDifferences />` always; when `data.profiles` present render a per-profile table using `CompatibilityBadges`; include a DB picker (navigates to `/parity-map?databaseId=<id>`); empty-state for the profile section when no DB linked/picked.
- **MIRROR**: `score-simulator/+page.svelte` picker/empty-state; SVELTE_LEGACY_EVENTS.
- **IMPORTS**: the three components; `goto` from `$app/navigation` (if picker navigates).
- **GOTCHA**: Static matrix/warnings render independent of DB; only the profile section is DB-gated.
- **VALIDATE**: `deno task check:client`; `deno task dev` renders `/parity-map`.

### Task 15: Create `+page.server.ts` (load) — Depends on [3]

- **BATCH**: B2
- **ACTION**: Create `packages/praxrr-app/src/routes/parity-map/+page.server.ts`.
- **IMPLEMENT**: `export const load = async ({ url }) => {...}`. Always return static data (matrix rows, catalog) — or let the client import the static modules and only return DB-dependent data. Read `?databaseId=`; if present + valid, `pcdManager.getCache(id)` + `isBuilt()` guard, call `computeProfileCompatibility(cache)`; return `profiles` + linked-DB picker options; invalid id → return an error flag (page still renders static tier).
- **MIRROR**: `settings/general/+page.server.ts` load; SUPPORT_DERIVATION.
- **IMPORTS**: `computeProfileCompatibility` from `$pcd/entities/qualityProfiles/compatibility.ts`; `pcdManager`; DB-instances query for picker options.
- **GOTCHA**: No auto-resolve of a "primary" DB (OQ3) — profiles only when `?databaseId=` explicitly supplied.
- **VALIDATE**: `deno task check:server`; page load exercised via `deno task dev`.

### Task 16: Register `LayoutGrid` icon — Depends on [none]

- **BATCH**: B1
- **ACTION**: Modify `packages/praxrr-app/src/lib/client/navigation/iconMap.ts`.
- **IMPLEMENT**: Import `LayoutGrid` from `lucide-svelte`; add `LayoutGrid` to `NAV_ICON_MAP`.
- **MIRROR**: existing entries in `NAV_ICON_MAP`.
- **GOTCHA**: `resolveNavIcon` returns `undefined` for an unregistered `iconKey` → the nav icon silently vanishes.
- **VALIDATE**: `deno task check:client`; nav icon appears in `deno task dev`.

### Task 17: Append nav registry entry — Depends on [none]

- **BATCH**: B1
- **ACTION**: Modify `packages/praxrr-app/src/lib/server/navigation/registry.ts`.
- **IMPLEMENT**: Append one item to `NAV_REGISTRY` under the `overview` group: `href: '/parity-map'`, label `Parity Map`, `iconKey: 'LayoutGrid'`, `arrScope: scopeAll`, no `requiredFeature`.
- **MIRROR**: the existing `Databases` overview entry (`registry.ts:68-80`).
- **GOTCHA**: Setting `requiredFeature` would hide the app-agnostic map behind the arr-scope selector — leave UNSET.
- **VALIDATE**: `deno task check:server`; nav entry appears in `deno task dev`.

### Task 18: Create `tests/arr/parityMap.test.ts` — Depends on [1, 2, 10]

- **BATCH**: B3
- **ACTION**: Create `packages/praxrr-app/src/tests/arr/parityMap.test.ts`.
- **IMPLEMENT**: Assert the tri-state truth table for every `(entity × app)` (metadata_profiles→`unsupported/unsupported/native`; quality_definitions→`native/native/native`; custom_formats/quality_profiles/delay_profiles→`shared/shared/shared`); bridge totality; axis↔capabilities consistency (`unsupported` ⇔ `!supportsArrSyncSurface`); `quality_definitions ↔ isMediaManagementSubsectionSupported(app, 'qualityDefinitions')` pin; catalog invariants (apps ⊆ `ARR_APP_TYPES`, valid `scope`, non-empty `summary`/`detail`/`sourceRefs`); `buildParityRows` shape.
- **MIRROR**: TEST_STRUCTURE (`resolveArrTargets.test.ts`).
- **IMPORTS**: `assertEquals` from `@std/assert`; parity/catalog/rows modules; `isMediaManagementSubsectionSupported` from `$sync/mappings.ts`.
- **GOTCHA**: `lidarrCapabilityGates.test.ts` lives under `tests/upgrades/` — mirror reference only; this file lands in `tests/arr/`.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/arr/parityMap.test.ts`.

### Task 19: Create `tests/pcd/qualityProfileCompatibility.test.ts` — Depends on [3, 4]

- **BATCH**: B3
- **ACTION**: Create `packages/praxrr-app/src/tests/pcd/qualityProfileCompatibility.test.ts`.
- **IMPLEMENT**: In-memory `Kysely<PCDDatabase>` over `@jsr/db__sqlite` `:memory:`; inline `CREATE TABLE quality_api_mappings` + profile/qualities tables + rows per `arr_type`. Assert: video profile → `[radarr, sonarr]` not `lidarr`; audio profile → `[lidarr]`; zero-enabled profile with an arr-specific score → compatible via fallback; transitional pre-`20260216` Lidarr row excluded by the QUALITIES filter. **Delegation-equivalence**: `list(cache, arrType)` returns the same filtered profile set pre/post refactor (enabled path + zero-enabled fallback).
- **MIRROR**: TEST_STRUCTURE (`lidarrQualityMappingPrereqs.test.ts` fixture); copy `createCacheFixture` verbatim.
- **IMPORTS**: `Database` from `@jsr/db__sqlite`; `Kysely`, `DenoSqlite3Dialect`; `type PCDDatabase`/`PCDCache`; compat + list modules.
- **GOTCHA**: `try { … } finally { await kb.destroy(); db.close(); }`.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/pcd/qualityProfileCompatibility.test.ts`.

### Task 20: Create `tests/routes/parityMapApi.test.ts` — Depends on [9]

- **BATCH**: B7
- **ACTION**: Create `packages/praxrr-app/src/tests/routes/parityMapApi.test.ts`.
- **IMPLEMENT**: `import { GET } from '../../routes/api/v1/compatibility/parity/+server.ts'`; `type GetEvent = Parameters<typeof GET>[0]`. Assert: no `databaseId` → 200 with `matrix`+`semanticDifferences`, NO `profiles`; valid `?databaseId=` (cache patched via `setCache`/`deleteCache`) → 200 with `profiles`; invalid/unknown/`'all'` id → 400 `{error}`; unauthenticated → 401. Type-assert response as `components['schemas']['ParityMapResponse']`.
- **MIRROR**: TEST_STRUCTURE (`uiPreferencesApi.test.ts`); leading `/// <reference path="../../app.d.ts" />` + `eslint-disable`.
- **IMPORTS**: `assertEquals`; `setCache`/`deleteCache` from `$pcd/database/registry.ts`; `type components`.
- **GOTCHA**: Build the event as `Partial<GetEvent>` with `request`/`url`/`locals` then cast `as GetEvent`.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/routes/parityMapApi.test.ts`.

### Task 21: Regenerate JSR mirror — Depends on [7]

- **BATCH**: B5
- **ACTION**: Regenerate `packages/praxrr-api/openapi.json` + `packages/praxrr-api/types.ts`.
- **IMPLEMENT**: Run `deno task bundle:api` (`scripts/bundle-api.ts`).
- **MIRROR**: `scripts/bundle-api.ts` bundling flow (root `components.schemas` → flattened `openapi.json` + JSDoc-injected `types.ts`).
- **GOTCHA**: Confirm the new `compatibility.yaml` schemas appear in `openapi.json` — `bundle-api` drops any schema file not root-registered in `openapi.yaml` (Task 7).
- **VALIDATE**: `git diff packages/praxrr-api/openapi.json` shows the new path + schemas.

### Task 22: Add `parity` test alias (optional) — Depends on [none]

- **BATCH**: B1
- **ACTION**: Modify `scripts/test.ts`.
- **IMPLEMENT**: Add `parity` → `packages/praxrr-app/src/tests/arr/parityMap.test.ts` (or the parity test dir) to the `aliases` map.
- **MIRROR**: existing alias entries (`scripts/test.ts:11`).
- **GOTCHA**: Convenience only — raw paths already work.
- **VALIDATE**: `deno task test parity` runs the parity test(s).

---

## Testing Strategy

### Unit Tests

| Test                                        | Input                                                        | Expected Output                                              | Edge Case? |
| ------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ---------- |
| `parityMap` truth table                     | `getEntitySupportStatus(app, entity)` for all 15 cells      | metadata→`u/u/native`; qualdefs→`native×3`; cf/qp/delay→`shared×3` | No |
| `parityMap` bridge totality                 | `PARITY_ENTITY_TO_SYNC_SURFACE`                             | every `ParityEntity` mapped (typecheck + runtime)           | Yes        |
| `parityMap` axis↔capabilities consistency   | each `unsupported` cell                                     | equals `!supportsArrSyncSurface(app, bridge[entity])`       | Yes        |
| `parityMap` qualdefs↔subsection pin         | `getEntitySupportStatus(app, 'quality_definitions')`        | `!== 'unsupported'` iff `isMediaManagementSubsectionSupported(app, 'qualityDefinitions')` | Yes |
| `parityMap` catalog invariants              | `ARR_SEMANTIC_DIFFERENCES`                                  | ≥8 entries; apps⊆`ARR_APP_TYPES`; valid scope; non-empty summary/detail/sourceRefs | Yes |
| `qualityProfileCompatibility` video profile | PCD fixture w/ video qualities enabled                     | `compatibleArrTypes = [radarr, sonarr]`                      | No         |
| `qualityProfileCompatibility` audio profile | PCD fixture w/ audio (FLAC) qualities                      | `compatibleArrTypes = [lidarr]`                              | No         |
| `qualityProfileCompatibility` zero-enabled  | profile w/ no enabled qualities + arr-specific score row   | compatible via fallback                                     | Yes        |
| `qualityProfileCompatibility` transitional  | pre-`20260216` Sonarr-cloned Lidarr `quality_api_mappings` row | excluded by QUALITIES filter                            | Yes        |
| `qualityProfileCompatibility` delegation    | `list(cache, arrType)` pre/post refactor                   | identical filtered profile set (enabled + fallback paths)   | Yes        |
| `parityMapApi` static                       | `GET` no `databaseId`, authed                              | 200; `matrix`+`semanticDifferences`; NO `profiles`          | No         |
| `parityMapApi` DB tier                      | `GET ?databaseId=<valid>` (patched cache)                 | 200 with `profiles[]`                                       | No         |
| `parityMapApi` fail-fast                    | `GET ?databaseId=abc` / `all` / unknown                   | 400 `{error}`                                              | Yes        |
| `parityMapApi` auth                         | `GET` unauthenticated                                      | 401 `{error}`                                              | Yes        |

### Edge Cases Checklist

- [x] Invalid/non-numeric/`'all'`/negative/unknown `databaseId` → 400 (not 404, not 500)
- [x] Absent/unbuilt PCD cache → 400 (guarded by `isBuilt()`)
- [x] Transitional pre-`20260216` Lidarr rows excluded from compat
- [x] Zero-enabled quality profile (arr-specific-score fallback)
- [x] No DBs linked → static matrix/warnings still render; profile section empty state
- [x] Unauthenticated request → 401 (route not in `PUBLIC_PATHS`)

---

## Validation Commands

> **Deno PATH**: prepend `~/.deno/bin` before `deno` in non-interactive shells (memory `deno-toolchain-path`), e.g. `PATH="$HOME/.deno/bin:$PATH" deno task check`.

### Static Analysis

```bash
deno task check        # deno check (server) + svelte-check (client)
```

EXPECT: Zero type errors

### Lint & Format

```bash
deno task format       # Prettier write (.prettierrc.json: 2-space/single-quote/semi/es5/~120w)
deno task lint         # prettier --check . && eslint .
```

EXPECT: Clean

### Unit Tests

```bash
deno task test packages/praxrr-app/src/tests/arr/parityMap.test.ts
deno task test packages/praxrr-app/src/tests/pcd/qualityProfileCompatibility.test.ts
deno task test packages/praxrr-app/src/tests/routes/parityMapApi.test.ts
deno task test filters   # existing quality-profile list filter tests (regression)
```

EXPECT: All pass

### Full Test Suite

```bash
deno task test
```

EXPECT: No regressions

### Contract Regeneration

```bash
deno task generate:api-types   # regen v1.d.ts (scrub tool-version noise to reviewable diff)
deno task bundle:api           # regen packages/praxrr-api/{openapi.json,types.ts}
```

EXPECT: New `ParityMapResponse`/`ArrSemanticDifference`/`ProfileCompatibility` present; no ~3300-line churn committed

### Browser Validation

```bash
deno task dev                  # http://localhost:6969/parity-map
```

EXPECT: Matrix + semantic cards render; nav `LayoutGrid` icon visible; `?databaseId=<id>` shows "Usable by" chips

### Manual Validation

- [ ] `/parity-map` renders the 5×3 matrix with tri-state badges (success/info/warning)
- [ ] Nav entry + `LayoutGrid` icon appear in the Overview group
- [ ] Semantic-difference cards show `detail` + `suggestion`
- [ ] Selecting a database shows per-profile "Usable by" chips; deselecting hides them; static tier persists

---

## Acceptance Criteria

- [ ] `/parity-map` renders a 5-entity × 3-app matrix; every cell derived via `getEntitySupportStatus`→`supportsArrSyncSurface` (no 4th boolean map)
- [ ] Tri-state truth table holds (metadata→`u/u/native`; qualdefs→`native×3`; cf/qp/delay→`shared×3`)
- [ ] `PARITY_ENTITY_TO_SYNC_SURFACE` is a total `Record` (compile-time fail-fast)
- [ ] Semantic catalog ≥8 entries with valid invariants; page renders `detail` + `suggestion` as inform-only cards
- [ ] `GET /api/v1/compatibility/parity`: no id → 200 without `profiles`; valid `?databaseId=` → 200 with `profiles[]` (`basis:'enabled-qualities'`); invalid/unknown/`'all'` → 400; unauth → 401
- [ ] Per-profile compat via the single extracted `computeCompatibleProfileNames`; `list.ts` delegates with identical output pre/post (delegation-equivalence test green)
- [ ] Compat uses enabled ∩ `QUALITIES[arrType]` + arr-specific-score fallback; never `arr_type='all'`
- [ ] Nav entry + `LayoutGrid` registered in `NAV_ICON_MAP`
- [ ] Contract-first: schemas authored in OpenAPI, types regenerated + scrubbed, handler typed from `components['schemas']`
- [ ] Feature is inform-only (no mutation, no gating)
- [ ] Deferred scope NOT shipped (no inline editor wiring, no apply-time `alertStore` hints)
- [ ] `deno task check` + `deno task lint` + all tests green

## Completion Checklist

- [ ] Code follows discovered patterns (derive support; single compat algorithm; legacy Svelte events)
- [ ] `deno task check` green (server `deno check` + client `svelte-check`)
- [ ] `deno task lint` green; `deno task format` run (`.prettierrc.json`, NOT CLAUDE.md tabs/100w)
- [ ] `v1.d.ts` regenerated AND scrubbed to a reviewable diff (only new types)
- [ ] JSR mirror regenerated (`deno task bundle:api`); new schemas present in `openapi.json`
- [ ] Every new `compatibility.yaml` schema registered under root `openapi.yaml` `components.schemas`
- [ ] `LayoutGrid` imported from `lucide-svelte` + registered; nav entry `requiredFeature` UNSET, `arrScope: scopeAll`
- [ ] New components use Svelte legacy-event mode (no runes / no `onclick`)
- [ ] Cross-Arr Semantic Validation 4-box checklist affirmed in PR body
- [ ] All three test files green; `filters` regression test green
- [ ] Deferred scope disclosed in the PR body (inline editor, apply-time hints, `UNSUPPORTED_*_REASONS`)
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `list.ts` refactor regresses profile-list filtering (load-bearing, feeds live sync-selection UI) | Medium | High | Delegation-only change + delegation-equivalence test (enabled + zero-enabled fallback) |
| `v1.d.ts` regen emits ~3300 lines of tool-version noise (CI ungated) | High | Medium | Regenerate deliberately, scrub to a reviewable diff (memory `v1dts-generator-drift`) |
| Multi-source drift — support facts copied instead of derived | Medium | High | Derive via `supportsArrSyncSurface`; only native/shared authored; `PARITY_NON_REGRESSION_CHECK` + axis↔capabilities test |
| Unknown/`'all'` `databaseId` not fail-fast (registry `getCache`→`undefined`) | Medium | High | Explicit `parseInt`+reject → 400; no sibling fallback (deviate from `simulate/score`'s 404) |
| Transitional pre-`20260216` Lidarr `quality_api_mappings` rows pollute compat | Medium | High | QUALITIES-∩ reader (`api_name ∈ QUALITIES[arrType]`); never trust `arr_type='all'` |
| `bundle-api.ts` silently drops an unreferenced `compatibility.yaml` schema | Medium | Medium | Register every schema under root `components.schemas`; verify in regenerated bundle |
| Nav icon silently vanishes if `iconKey` unregistered | Medium | Low | Register `LayoutGrid` in `NAV_ICON_MAP` in the same change as the registry entry |
| Convention confusion from CLAUDE.md (runes/`onclick`/tabs) | Medium | Medium | Mirror `Badge`/`Button`/`Table` (legacy `on:click`/`export let`/`$:`); `deno task format` |
| `quality_definitions` latent false-positive for a future app (derived from coarser `media_management`) | Low | Medium | Explicit bridge + subsection-pin test binding to `isMediaManagementSubsectionSupported` |

## Notes

- **One authored layer, everything else derived.** The ONLY net-new support data is `NATIVE_ENTITY_APPS`; tri-state `unsupported` is computed from `supportsArrSyncSurface`. No 4th boolean map — primary anti-drift invariant.
- **One compatibility algorithm.** `compatibility.ts` is the single implementation; both the endpoint and `list.ts` consume it. No fork.
- **Two tiers, strict.** Static tier (`parity.ts` + `semanticDifferences.ts`) is client-importable, zero-DB; PCD cache read ONLY when `?databaseId=` present. Keep the boundary clean or the "zero round-trip matrix" property breaks.
- **CLAUDE.md is wrong twice — trust the design + memory.** (1) Formatting is `.prettierrc.json` (2-space/single-quote/semi/~120w), NOT tabs/100w. (2) Svelte is legacy-event mode (`export let`/`$:`/`on:click`), NOT runes/`onclick`. New code copying CLAUDE.md conventions will fail lint/review.
- **OQ1–OQ4 resolved (do not re-litigate):** OQ1 schema-shape taxonomy (Lidarr quality profiles stay `shared`; audio disjointness is a warning); OQ2 preserve `list.ts` enabled-qualities semantics with "based on enabled qualities" copy; OQ3 `profiles` iff `?databaseId=` supplied; OQ4 all verdicts inline.
- **Cross-Arr Semantic Validation checklist** (CLAUDE.md policy + design §4) is structurally satisfied: per-`arr_type` resolution, no sibling fallback, total-`Record` fail-fast, explicit `ARR_APP_TYPES` iteration. The PR body must affirm all four boxes.
- **Confidence Score: 9/10** — design + 7-researcher verification align on every path; the one residual is the mechanical `v1.d.ts` scrub.

