# Cross-Arr Parity Map — tech-designer discovery (issue #14)

All paths verified against branch `feat/cross-arr-parity-map`. Design §7's 22-item plan is accurate;
path corrections table lists the few prose/alias mismatches. Every named symbol/line below was read.

## Patterns to Mirror → SERVICE_PATTERN

| Category | File:Lines | Pattern | Key Snippet (≤5 lines) |
|---|---|---|---|
| Support predicate (derive support, never copy) | `packages/praxrr-app/src/lib/shared/arr/capabilities.ts:298-305` | `supportsArrWorkflow`/`supportsArrSyncSurface` read the const `ARR_APPS` grid; `parity.ts` calls these instead of a 4th map | `export function supportsArrSyncSurface(type: ArrAppType, surface: ArrSyncSurface): boolean {`<br>`  return ARR_APPS[type].capabilities.sync[surface];` |
| Non-regression `as-const-satisfies` pin | `capabilities.ts:168-205` + `:53-60` | `X = {...} as const satisfies {literal}; void X;` compile-time freeze — mirror for `PARITY_NON_REGRESSION_CHECK` | `const ARR_CAPABILITY_NON_REGRESSION_CHECK = { radarr: ARR_APPS.radarr.capabilities, ... } as const satisfies {...};`<br>`void ARR_CAPABILITY_NON_REGRESSION_CHECK;` |
| Total `Record` bridge (compile-time fail-fast) | `capabilities.ts:44-50` | `ARR_SYNC_SURFACES = [...] as const satisfies readonly ArrSyncSurface[]` — same shape for `PARITY_ENTITY_TO_SYNC_SURFACE` totality | `export const ARR_SYNC_SURFACES = ['quality_profiles','custom_formats','delay_profiles','media_management','metadata_profiles'] as const satisfies readonly ArrSyncSurface[];` |
| API v1 GET handler (contract-typed, fail-fast 400) | `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts:20-22,306-321,487` | Import `components['schemas'][...]`; parse query; `json({error} satisfies ErrorResponse,{status:400})`; final `catch`→500 | `type ErrorResponse = components['schemas']['ErrorResponse'];`<br>`if (!instanceId) return json({ error: 'instanceId is required' } satisfies ErrorResponse, { status: 400 });` |
| Module-level static cache (zero-DB tier) | `packages/praxrr-app/src/routes/api/v1/openapi.json/+server.ts:6,16-23` | `let cachedSpec = null; if(!cachedSpec){...} return json(cachedSpec)` — build parity matrix+catalog once, reuse | `let cachedSpec: unknown = null;`<br>`export const GET: RequestHandler = async () => { if (!cachedSpec) { ... } return json(cachedSpec); };` |
| `databaseId → PCDCache` resolution | `arr/library/+server.ts:11,253,277` | `pcdManager.getCache(db.id)` + `.isBuilt()` guard is the endpoint idiom (delegates to registry) | `import { pcdManager } from '$pcd/index.ts';`<br>`const dbCache = pcdManager.getCache(db.id); if (!dbCache?.isBuilt()) continue;` |
| `+page.server.ts` load | `packages/praxrr-app/src/routes/settings/general/+page.server.ts:13-21` | `export const load = () => {...}` returns data object; throws on missing — parity load reads `?databaseId=` and calls `computeProfileCompatibility(cache)` | `export const load = () => { const logSetting = logSettingsQueries.get(); if (!logSetting) throw new Error(...); return {...}; };` |

## Patterns to Mirror → REPOSITORY_PATTERN

| Category | File:Lines | Pattern | Key Snippet (≤5 lines) |
|---|---|---|---|
| QUALITIES-filtered mapping reader (EXTRACT verbatim) | `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts:59-82` | Read `quality_api_mappings` by `arr_type`, keep only `api_name ∈ QUALITIES[arrType]`, seed lowercased name set — the compat-algorithm core | `const supportedApiNames = new Set(Object.keys(QUALITIES[arrType]));`<br>`if (!supportedApiNames.has(apiName)) continue;`<br>`supportedQualityNames.add(qualityName.toLowerCase());` |
| Enabled-quality intersection + arr-specific-score fallback | `list.ts:88-159` | direct + group-member enabled qualities → intersect; zero-enabled → require `quality_profile_custom_formats.arr_type=arrType` ownership | `if (!enabledQualityNames || enabledQualityNames.size === 0) { if (hasArrSpecificScores.has(profile.name)) compatibleProfileNames.add(profile.name); continue; }` |
| Kysely over PCDCache | `list.ts:38-64` | `const db = cache.kb; db.selectFrom('quality_api_mappings').select([...]).where('arr_type','=',arrType).execute()` | `const db = cache.kb;`<br>`await db.selectFrom('quality_api_mappings').select(['quality_name','api_name']).where('arr_type','=',arrType).execute();` |
| In-memory cache registry (test injection) | `packages/praxrr-app/src/lib/server/pcd/database/registry.ts:16,23,37` | `setCache(id,cache)` / `getCache(id)` / `deleteCache(id)` — endpoint tests patch a cache then hit GET | `export function setCache(databaseInstanceId: number, cache: PCDCache): void { ... }`<br>`export function getCache(databaseInstanceId: number): PCDCache \| undefined { ... }` |
| Arr type/app enums | `packages/praxrr-app/src/lib/shared/pcd/types.ts:805-812` | `ARR_APP_TYPES` const tuple + `ArrAppType`/`ArrType` derived; iterate `ARR_APP_TYPES` explicitly (no sibling fallback) | `export const ARR_APP_TYPES = ['radarr','sonarr','lidarr'] as const;`<br>`export type ArrAppType = (typeof ARR_APP_TYPES)[number];` |

## Files to Change

| File | Action | Justification |
|---|---|---|
| `packages/praxrr-app/src/lib/shared/arr/parity.ts` | New | Entity axis + tri-state derivation from `supportsArrSyncSurface` via total bridge; `NATIVE_ENTITY_APPS`; `PARITY_NON_REGRESSION_CHECK`. Confirmed absent from `shared/arr/` (only capabilities/displayName/instanceUrl.ts). |
| `packages/praxrr-app/src/lib/shared/arr/semanticDifferences.ts` | New | Authored catalog; the only net-new prose. `UNSUPPORTED_*_REASONS` maps at `mappings.ts:37,39` are empty `{}` — confirmed no existing home. |
| `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/compatibility.ts` | New | Single compat surface extracted from `list.ts:59-159`. Confirmed absent (dir has create/delete/index/list.ts only). |
| `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts` | Mod | Delegate lines 59-159 to `computeCompatibleProfileNames`; keep filter at :159 behavior-preserving. |
| `docs/api/v1/paths/compatibility.yaml` | New | `getCompatibilityParity` op, tag `compatibility`. paths/ has no compatibility.yaml. |
| `docs/api/v1/schemas/compatibility.yaml` | New | `ParityMapResponse`/`ArrSemanticDifference`/`ProfileCompatibility`; reuse `ErrorResponse` (root `components.schemas` @ `openapi.yaml:663`). |
| `docs/api/v1/openapi.yaml` | Mod | Add path `$ref` under `paths:` (@36), schema `$ref`s under `components.schemas:` (@615), `tags:` entry (@14). `bundle-api.ts` drops any schema file not root-`$ref`'d. |
| `packages/praxrr-app/src/lib/api/v1.d.ts` | Regen | `deno task generate:api-types` (`npx openapi-typescript ... -o v1.d.ts`, deno.json:69). Scrub ~3300-line version noise ([[v1dts-generator-drift]], CI-ungated). |
| `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts` | New | GET: static tier module-cached + DB tier via `pcdManager.getCache` + `computeProfileCompatibility` when `?databaseId=`; 400 on bad id. New `compatibility/` route dir. |
| `packages/praxrr-app/src/routes/parity-map/parityRows.ts` | New | Pure Svelte-free row builder. `parity-map/` route dir does not exist. |
| `packages/praxrr-app/src/lib/client/ui/parity/CompatibilityBadges.svelte` | New | Reusable "Usable by" chip row. `ui/parity/` does not exist. |
| `packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte` | New | `Table.svelte` (`Column<ParityRow>`, `types.ts:13`) + status `Badge` (variants success/warning/info @ `Badge.svelte:8-26`); mirror `media-management/[databaseId]/quality-definitions/views/TableView.svelte`. |
| `packages/praxrr-app/src/routes/parity-map/SemanticDifferences.svelte` | New | Warning cards grouped by scope; render `detail`+`suggestion`. |
| `packages/praxrr-app/src/routes/parity-map/+page.svelte` | New | Shell composing matrix + cards + compat table. `<svelte:head><title>` pattern. |
| `packages/praxrr-app/src/routes/parity-map/+page.server.ts` | New | `async load` reading `?databaseId=`, calling `computeProfileCompatibility(cache)`; DB picker options. |
| `packages/praxrr-app/src/lib/client/navigation/iconMap.ts` | Mod | Import + register `LayoutGrid` in `NAV_ICON_MAP` (@15, currently 10 icons); `resolveNavIcon` returns `undefined` if unregistered (@28). |
| `packages/praxrr-app/src/lib/server/navigation/registry.ts` | Mod | Append one item to `NAV_REGISTRY` (@68) under `ensureGroupId('overview')`, `arrScope: scopeAll`, `iconKey:'LayoutGrid'`, no `requiredFeature`. |
| `packages/praxrr-app/src/tests/arr/parityMap.test.ts` | New | Tri-state truth table, bridge totality, axis↔`isMediaManagementSubsectionSupported` pin, catalog invariants. Mirror `tests/arr/resolveArrTargets.test.ts`. |
| `packages/praxrr-app/src/tests/pcd/qualityProfileCompatibility.test.ts` | New | Extracted-predicate + list.ts delegation equivalence. Mirror `tests/arr/lidarrQualityMappingPrereqs.test.ts`. |
| `packages/praxrr-app/src/tests/routes/parityMapApi.test.ts` | New | Endpoint status/shape/contract types. Mirror `tests/routes/uiPreferencesApi.test.ts` (confirmed exists). |
| `packages/praxrr-api/openapi.json`, `packages/praxrr-api/types.ts` | Regen | `deno task bundle:api` (deno.json:94 → `scripts/bundle-api.ts`). Both files confirmed present. |
| `scripts/test.ts` | Mod (optional) | Add `parity` alias to `aliases` map (@11). |

## Step-by-Step Tasks (draft, dependency-aware)

| Task | ACTION | IMPLEMENT (2-3 sentences) | Depends on |
|---|---|---|---|
| T1 | CREATE `parity.ts` | Add `ParityEntity`/`PARITY_ENTITIES`, `PARITY_ENTITY_TO_SYNC_SURFACE` (total `Record<ParityEntity,ArrSyncSurface>`), `NATIVE_ENTITY_APPS`, `getEntitySupportStatus` calling `supportsArrSyncSurface`, and a `PARITY_NON_REGRESSION_CHECK` void-pin. Import `ArrSyncSurface`/`ArrAppType`/`supportsArrSyncSurface` from `capabilities.ts`. | — |
| T2 | CREATE `semanticDifferences.ts` | Define `ArrSemanticDifference` + `ParityScope = ParityEntity \| ArrWorkflowSurface` and the 8 authored entries (§5.2) with `suggestion`+`sourceRefs`. Import `ParityEntity` from T1, `ArrWorkflowSurface`/`ArrAppType` from `capabilities.ts`. | T1 |
| T3 | CREATE `compatibility.ts` | Extract `list.ts:59-159` into `computeCompatibleProfileNames(cache,arrType)` (QUALITIES-filtered reader + enabled-intersection + arr-score fallback) and `computeProfileCompatibility(cache)` iterating `ARR_APP_TYPES`. Import `QUALITIES`, `PCDCache`, `ARR_APP_TYPES`. | — (parallel w/ T1) |
| T4 | MODIFY `list.ts` | Replace the inline `arrType` block (59-159) with `const compatible = await computeCompatibleProfileNames(cache, arrType); profiles = profiles.filter(p => compatible.has(p.name));`. Behavior-preserving. Same file as no other task. | T3 |
| T5 | CREATE `paths/compatibility.yaml` | `GET /compatibility/parity`, optional `databaseId` query, tag `compatibility`, `200`→`ParityMapResponse`, `400/401/500`→`ErrorResponse`. | T1,T2 (shape) |
| T6 | CREATE `schemas/compatibility.yaml` | `ParityMapResponse` (entities/apps/matrix/semanticDifferences/optional profiles), `ArrSemanticDifference`, `ProfileCompatibility`; `$ref` `common.yaml` ErrorResponse. | T1,T2 |
| T7 | MODIFY `openapi.yaml` | Register path `$ref` (@36), each schema under `components.schemas` (@615), and a `tags` entry (@14). Single-file edit. | T5,T6 |
| T8 | REGEN `v1.d.ts` | `deno task generate:api-types`, then scrub tool-version noise to a reviewable diff. | T7 |
| T9 | CREATE `parity/+server.ts` | GET: build+module-cache static payload (matrix from `parity.ts`, catalog from T2); when `?databaseId=` present, parse int, `pcdManager.getCache(id)`, 400 on invalid/unknown, call `computeProfileCompatibility`. Type response as `components['schemas']['ParityMapResponse']`. | T1,T2,T3,T8 |
| T10 | CREATE `parityRows.ts` | Pure builder mapping `PARITY_ENTITIES` → one `ParityRow` per entity with per-app `getEntitySupportStatus`. Svelte-free, unit-testable. | T1 |
| T11 | CREATE `CompatibilityBadges.svelte` | Legacy Svelte (`export let`, `$:`, `on:`) chip row rendering `compatibleArrTypes` via `Badge`. | T1 |
| T12 | CREATE `ParityMatrix.svelte` | `Table.svelte` with `Column<ParityRow>[]` + `<svelte:fragment slot="cell">` switch on app key → `<Badge variant>` (success/info/warning); app headers use `getArrAppMetadata().label`+logo+`var(--arr-<type>-color)`. | T10 |
| T13 | CREATE `SemanticDifferences.svelte` | Warning cards grouped by `scope`, rendering `summary`/`detail`/`suggestion`. | T2 |
| T14 | CREATE `+page.svelte` | Compose T12+T13+ (when DB linked) compat table via T11; `<svelte:head><title>Parity Map - Praxrr</title>` + inline h1/p. | T11,T12,T13 |
| T15 | CREATE `+page.server.ts` | `async load({ url })` reading `?databaseId=`; static tier always; `pcdManager.getCache` + `computeProfileCompatibility` when present; return DB picker options. | T3 |
| T16 | MODIFY `iconMap.ts` | Import `LayoutGrid` from `lucide-svelte`, add to `NAV_ICON_MAP`. Distinct file. | — |
| T17 | MODIFY `registry.ts` | Append the `/parity-map` overview nav item. Distinct file. | — |
| T18 | CREATE `tests/arr/parityMap.test.ts` | Tri-state truth table, bridge totality, axis↔capabilities consistency, `quality_definitions`↔`isMediaManagementSubsectionSupported(app,'qualityDefinitions')` pin, catalog invariants, `parityRows` shape. | T1,T2,T10 |
| T19 | CREATE `tests/pcd/qualityProfileCompatibility.test.ts` | In-memory Kysely `:memory:` fixture; assert compat verdicts + QUALITIES-filter exclusion + list.ts delegation equivalence (enabled + zero-enabled fallback). | T3,T4 |
| T20 | CREATE `tests/routes/parityMapApi.test.ts` | `import { GET }`; no-id→200 without `profiles`; valid `?databaseId=` (patched via `setCache`/`deleteCache`)→200 with `profiles`; bad id→400. | T9 |
| T21 | REGEN `praxrr-api` mirror | `deno task bundle:api` → `packages/praxrr-api/openapi.json`+`types.ts`. | T7 |
| T22 | MODIFY `scripts/test.ts` | Add `parity` alias (optional convenience). | — |

Batching note: no two tasks edit the same file, so same-file conflicts are nil. Sequential chains:
`T3→T4`, `T1→T2→{T5,T6}→T7→{T8,T21}`, `T8→T9→T20`, `T1→T10→T12→T14`, `T2→T13→T14`, `T3→{T15,T19}`.
Fully parallel at start: T1, T3, T16, T17, T22.

## Path corrections (design paths that do NOT match the codebase)

| Design path | Real path / status |
|---|---|
| §6.1 diagram `pcdManager.getCache(id)` | CORRECT — `pcdManager.getCache` exists and is the endpoint idiom (`arr/library/+server.ts:253,277`). §9's `setCache`/`deleteCache` are the registry-level test-injection API (`$pcd/database/registry.ts:16,37`). Both real; consistent (manager delegates to registry). No change. |
| §5.2 entry 6 sourceRef `$upgrades/processor.ts` | ALIAS DOES NOT EXIST — no `$upgrades/` path alias (CLAUDE.md alias table + deno.json). File is real at `packages/praxrr-app/src/lib/server/upgrades/processor.ts`; write the prose sourceRef as `$lib/server/upgrades/processor.ts`. Prose-only (catalog string, not an import). |
| §9 "mirror `lidarrCapabilityGates.test.ts`" | File is under `tests/upgrades/`, not `tests/arr/`: `packages/praxrr-app/src/tests/upgrades/lidarrCapabilityGates.test.ts`. Mirror reference only; new test still lands in `tests/arr/`. |
| §6.3 step 6 / §7 #21 `deno run -A scripts/bundle-api.ts` | Script path CORRECT; the deno task alias is `bundle:api` (deno.json:94), not `bundle-api`. Both invocations valid. |
| §5.1 `quality_definitions` bridge → `media_management` | VERIFIED — `qualityDefinitions` is a `BASE_SYNC_MEDIA_MANAGEMENT_SUBSECTIONS` member (`mappings.ts:27`), absent from `ARR_SYNC_SURFACES` (`capabilities.ts:44-50`). Bridge is correct; test pin uses `isMediaManagementSubsectionSupported` (`mappings.ts:47`, takes `SyncArrType` ≡ `ArrAppType`). |
| §4 `packages/praxrr-schema/ops/0.schema.sql` (arr_type unconstrained VARCHAR) | Not re-read this pass; schema file path exists per CLAUDE.md schema-precedence note. Low risk — treat as verified-by-doc. |

Verified-correct anchors (no change): `capabilities.ts:168` pin; `list.ts:59-163`/`66-82`/`135-159`; `mappings.ts:27,37,39,205 (QUALITIES),657 (getLanguageForProfile),86 (INDEXER_FLAGS radarr internal=32/scene=128, sonarr/lidarr 8/16)`; `transformer.ts:95 (LIDARR_SUPPORTED_CONDITION_TYPES)`; `delayProfiles/syncer.ts:317 (resolveTargetDelayProfile)`; `$db/queries/arrSync.ts`; `app.css:357-359` color vars; assets `Radarr.svg/Sonarr.svg/Lidarr.png`; `Badge.svelte:8-26` variants; `table/types.ts:13` `Column<T>`; `openapi.json/+server.ts` module cache; `uiPreferencesApi.test.ts`; migration `20260216_enforce_native_lidarr_quality_mappings.ts`.
